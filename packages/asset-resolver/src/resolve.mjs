import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';
// resolve(ref): 「使った素材だけをオンデマンドで取得する」の核。
//
// キャッシュヒット → 即パスを返す。未取得 → 全ファイルを一時ディレクトリへ実体化 →
// sha256 検証 → validate-asset で契約検証（無料経路は meta.json を持つ素材のみ・有料経路は必須）→
// 全部通ってから <ライブラリの置き場>/<category>/<id>/ へ原子的に move する。
// 失敗は fail-closed（一時ディレクトリを破棄し、登録先には部分状態を残さない）。
// 有料未購入（locked）は resolve を拒否する。
//
// Pro item は公開 catalog に files[] を持たない。記述子 API から 1 件ずつ取得する。
// 記述子が asset_not_found のときだけ、従来の束 zip を予備経路として使う。

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { loadCatalogForResolveAsync, cachedAssetDirAsync } from './resolve-async-library.mjs';
import { resolveEffectiveBase } from './env.mjs';
import { AssetResolverError } from './errors.mjs';
import { fetchEntitlements, readStoreCredentials } from './entitlements.mjs';
import { materialize, resolveFileLocation } from './fetch-file.mjs';
import { sha256File } from './hash.mjs';
import { downloadPaidZip, extractZip, verifyPaidZipContents } from './paid-zip.mjs';
import { recordProjectReference } from './project-references.mjs';
import { fetchProAssetDescriptor, storeFailure } from './pro-asset.mjs';
import { assetTier, isAssetEntitled } from './tier.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ の 1 つ上（パッケージ root）のさらに 2 つ上（packages/）のさらに 1 つ上（リポ root）。
// fetch-akari-sounds.mjs（packages/audio-library-setup/bin/）と同じ深さの相対規約。
const repoRoot = path.resolve(here, '..', '..', '..');
const VALIDATE_ASSET_SCRIPT = path.join(repoRoot, 'packages', 'schemas', 'bin', 'validate-asset.mjs');

let validationQueue = Promise.resolve();
let validationRun = 0;

class ValidationExit extends Error {
  constructor(status) {
    super('validate-asset exited');
    this.status = status;
  }
}

async function validateAsset(assetDir) {
  const run = validationQueue.then(async () => {
    const original = {
      argv: process.argv, exit: process.exit, exitCode: process.exitCode,
      log: console.log, warn: console.warn, error: console.error,
    };
    let stdout = '';
    let stderr = '';
    try {
      process.argv = [process.execPath, VALIDATE_ASSET_SCRIPT, assetDir];
      process.exitCode = 0;
      process.exit = code => { throw new ValidationExit(code ?? process.exitCode ?? 0); };
      console.log = (...args) => { stdout += `${format(...args)}\n`; };
      // 新しい validator は WARN を console.warn へ出す（同一プロセスでも出力に含める）
      console.warn = (...args) => { stderr += `${format(...args)}\n`; };
      console.error = (...args) => { stderr += `${format(...args)}\n`; };
      try {
        await import(`${pathToFileURL(VALIDATE_ASSET_SCRIPT).href}?v=${++validationRun}`);
        return { status: Number(process.exitCode ?? 0), stdout, stderr };
      } catch (error) {
        if (error instanceof ValidationExit) return { status: Number(error.status), stdout, stderr };
        throw error;
      }
    } finally {
      process.argv = original.argv;
      process.exit = original.exit;
      process.exitCode = original.exitCode;
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    }
  });
  validationQueue = run.then(() => {}, () => {});
  try {
    return await run;
  } catch {
    // Module loading failures are outside the validator's ordinary NG result.
    return new Promise((resolveResult, reject) => {
      const child = spawn(process.execPath, [VALIDATE_ASSET_SCRIPT, assetDir]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', status => resolveResult({ status, stdout, stderr }));
    });
  }
}

export { AssetResolverError };

// overlay-runtime は resolver の依存にしない。断片ルートの変換規則は両方を同じテストで固定する。
export function withoutFragmentRootTiming(source, { preserveNaturalDuration = false } = {}) {
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<', cursor);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4);
      if (end < 0) throw new Error('HTML コメントが閉じていません');
      cursor = end + 3;
      continue;
    }
    const tag = /^<([A-Za-z][\w:-]*)(?:"[^"]*"|'[^']*'|[^'">])*>/u.exec(source.slice(start));
    if (!tag) { cursor = start + 1; continue; }
    if (/^(?:style|script)$/iu.test(tag[1])) {
      const closing = new RegExp(`</${tag[1]}\\s*>`, 'iu').exec(source.slice(start + tag[0].length));
      if (!closing) throw new Error('HTML の前置要素が閉じていません');
      cursor = start + tag[0].length + closing.index + closing[0].length;
      continue;
    }
    if (/^link$/iu.test(tag[1])) { cursor = start + tag[0].length; continue; }
    const nameEnd = tag[1].length + 1;
    const attributes = tag[0].slice(nameEnd, -1);
    const tokens = /([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gu;
    const removals = [];
    let duration = null;
    let hasNaturalDuration = false;
    for (const token of attributes.matchAll(tokens)) {
      if (preserveNaturalDuration && /^data-akari-natural-duration$/iu.test(token[1])) hasNaturalDuration = true;
      if (!/^data-(?:start|duration)$/iu.test(token[1])) continue;
      if (preserveNaturalDuration && /^data-duration$/iu.test(token[1])) {
        const value = token[0].match(/=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/u)?.slice(1).find(part => part !== undefined);
        if (value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0) duration = value;
      }
      let from = token.index;
      while (from > 0 && /\s/u.test(attributes[from - 1])) from--;
      removals.push([from, token.index + token[0].length]);
    }
    let changed = attributes;
    for (const [from, to] of removals.reverse()) changed = changed.slice(0, from) + changed.slice(to);
    if (preserveNaturalDuration && !hasNaturalDuration && duration !== null) changed += ` data-akari-natural-duration="${duration}"`;
    return source.slice(0, start + nameEnd) + changed + source.slice(start + tag[0].length - 1);
  }
  throw new Error('HTML 断片のルート要素がありません');
}

/** category/id を優先し、bare id はカタログ内で一意な場合だけ解決する。 */
export function findCatalogItem(catalog, ref) {
  if (typeof ref === 'string' && ref.includes('/')) {
    const item = catalog.items.find((entry) => `${entry.category}/${entry.id}` === ref);
    if (item) return item;
  } else {
    const matches = catalog.items.filter((entry) => entry.id === ref);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const candidates = matches.map((entry) => `${entry.category}/${entry.id}`);
      const error = new AssetResolverError(`素材 id が曖昧です: ${ref}（候補: ${candidates.join(', ')}）`, 'ambiguous_id');
      error.candidates = candidates;
      throw error;
    }
  }
  throw new AssetResolverError(`未知の素材参照です: ${ref}`, 'not_found');
}

export async function copyIntoProject(sourceDir, projectDir, category, id) {
  // ライブラリ（<ライブラリの置き場>/<category>/<id>/）と同型に揃える（2026-08-04 決定）。
  // 素材箱側が「meta.json を含むディレクトリ = 1 カード」でグルーピングする際、
  // 深さではなくディレクトリ形で判定するため、置き場の形をライブラリと合わせておく必要はないが、
  // カテゴリ別に整理された配置の方が人間が見ても分かりやすいのでライブラリ型に統一する。
  const realSourceDir = await realpath(sourceDir);
  const dest = path.join(path.resolve(projectDir), 'assets', category, id);
  await mkdir(path.dirname(dest), { recursive: true });
  await rm(dest, { recursive: true, force: true });

  if (process.platform === 'darwin') {
    // このマシンの Node（libuv）は clonefileat 相当が ENOSYS を返し、fs.cp の
    // COPYFILE_FICLONE では節約が効かない（前段 2026-08-09-project-copy-cow-clone で実測確認済み）。
    // BSD cp -c は clonefile(2) を Node を介さず直接使うため、同じ OS/FS 上で実際にクローンできる。
    const cloned = await new Promise(resolveResult => {
      const child = spawn('/bin/cp', ['-Rc', realSourceDir, dest], { stdio: 'ignore' });
      child.on('error', () => resolveResult(false));
      child.on('close', code => resolveResult(code === 0));
    });
    if (cloned) {
      try {
        await normalizeCopiedFragments(dest, category);
      } catch (error) {
        await rm(dest, { recursive: true, force: true });
        throw error;
      }
      return dest;
    }
    // クロスボリューム等で -c が失敗したケース。部分的に書かれた dest を掃除してから
    // fs.cp フォールバックへ渡す（既存の非 darwin 経路と同じ挙動に合流する）。
    await rm(dest, { recursive: true, force: true });
  }

  // COPYFILE_FICLONE（_FORCE ではない）: 対応 FS（APFS 等）では CoW クローンで実体化コピーを
  // 省略し、非対応環境では黙って通常コピーへフォールバックする（失敗しない）。
  await cp(realSourceDir, dest, { recursive: true, mode: constants.COPYFILE_FICLONE });
  try {
    await normalizeCopiedFragments(dest, category);
  } catch (error) {
    await rm(dest, { recursive: true, force: true });
    throw error;
  }
  return dest;
}

async function normalizeCopiedFragments(dest, category) {
  if (category !== 'overlay' && category !== 'scene3d') return;
  const files = ['fragment.html'];
  const variants = path.join(dest, 'variants');
  const variantInfo = await lstat(variants).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (variantInfo && !variantInfo.isDirectory()) throw new Error('variants が通常のディレクトリではありません');
  for (const entry of variantInfo ? await readdir(variants) : []) {
    if (entry.endsWith('.html')) files.push(path.join('variants', entry));
  }
  for (const file of files) {
    const target = path.join(dest, file);
    const info = await lstat(target).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info === null) continue;
    if (!info.isFile()) throw new Error(`断片ファイルが通常のファイルではありません: ${file}`);
    const source = await readFile(target, 'utf8');
    const cleaned = withoutFragmentRootTiming(source, { preserveNaturalDuration: true });
    if (cleaned !== source) await writeFile(target, cleaned);
  }
}

async function moveIntoLibrary(tempDir, destDir) {
  await mkdir(path.dirname(destDir), { recursive: true });
  if (await stat(destDir).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) {
    await rm(destDir, { recursive: true, force: true });
  }
  try {
    await rename(tempDir, destDir);
  } catch (error) {
    // 一時ディレクトリと登録先が別ファイルシステムの場合（EXDEV）は copy + rm でフォールバック
    if (error && error.code === 'EXDEV') {
      try {
        await cp(tempDir, destDir, { recursive: true, mode: constants.COPYFILE_FICLONE });
      } catch (copyError) {
        await rm(destDir, { recursive: true, force: true });
        throw copyError;
      }
      await rm(tempDir, { recursive: true, force: true });
      return;
    }
    throw error;
  }
}

async function backfillLegacyMetaTier(metaPath, item) {
  let meta;
  try {
    meta = JSON.parse(await readFile(metaPath, 'utf8'));
  } catch {
    return;
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || Object.hasOwn(meta, 'tier')) return;
  // R2 に公開済みの旧 meta.json（tier 導入前・price のみ）を、sha256 検証済みのうえでカタログの tier で補う互換経路。R2 の meta.json を tier 付きで上げ直したら外せる。
  meta.tier = assetTier(item);
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
}

async function fetchFilesInto(files, tempAssetDir, item, { base, fetchImpl, timeouts, request, checkBytes = false, proUrlsOnly = false }) {
  for (const file of files) {
    if (typeof file.name !== 'string' || !file.name) {
      throw new AssetResolverError(`files[] エントリに name がありません: ${item.id}`, 'invalid_catalog_item');
    }
  }
  for (let start = 0; start < files.length; start += 4) {
    const batch = files.slice(start, start + 4);
    const results = await Promise.allSettled(batch.map(async file => {
      const destPath = path.join(tempAssetDir, file.name);
      const resolved = proUrlsOnly ? { location: file.url, remote: true } : resolveFileLocation(base, file);
      await materialize(resolved, destPath, { fetchImpl, timeouts, request, ...(proUrlsOnly ? { maxBytes: file.bytes } : {}) });
      if (file.sha256) {
        const actual = await sha256File(destPath);
        if (actual !== file.sha256) {
          throw new AssetResolverError(
            `sha256 が一致しません（改竄または破損の可能性）: ${item.id}/${file.name}（期待 ${file.sha256} / 実際 ${actual}）`,
            'integrity',
          );
        }
      }
      if (checkBytes) {
        const actual = (await stat(destPath)).size;
        if (actual !== file.bytes) {
          throw new AssetResolverError(`bytes が一致しません: ${item.id}/${file.name}（期待 ${file.bytes} / 実際 ${actual}）`, 'integrity');
        }
      }
    }));
    const stale = checkBytes && results.find(result => result.status === 'rejected'
      && result.reason?.status === 409 && result.reason?.storeCode === 'stale_version');
    if (stale) throw stale.reason;
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
}

async function resolveProAsset(item, credentials, options) {
  const { env, fetchImpl, project, reference, home, destDir, timeouts } = options;
  for (let attempt = 0; attempt < 2; attempt++) {
    let tempRoot;
    try {
      const descriptor = await fetchProAssetDescriptor(item, credentials, { env, fetchImpl, timeouts });
      if (descriptor === null) return resolvePaidZip(item, options);
      await mkdir(home, { recursive: true });
      tempRoot = await mkdtemp(path.join(home, '.tmp-resolve-'));
      const tempAssetDir = path.join(tempRoot, item.category, item.id);
      await mkdir(tempAssetDir, { recursive: true });
      try {
        await fetchFilesInto(descriptor.files, tempAssetDir, item, {
          base: null, fetchImpl, timeouts, checkBytes: true, proUrlsOnly: true,
          request: { headers: { authorization: `Bearer ${credentials.token}` }, redirect: 'error' },
        });
      } catch (error) {
        if (error.status === 401) {
          const failure = storeFailure(error.status, { error: error.storeCode }, 'Pro 素材のファイル取得');
          failure.message += `。${error.message}。トークン失効の可能性があります。akari store connect をやり直してください`;
          throw failure;
        }
        if (error.status === 403 && error.storeCode === 'pro_required') {
          throw new AssetResolverError(
            `Pro 素材は all-access-pass（Lifetime パス）または購入済み product_id が必要です: ${item.id}（${error.message}）`,
            'locked',
          );
        }
        if (error.status) throw storeFailure(error.status, { error: error.storeCode, message: error.message }, 'Pro 素材のファイル取得');
        if (error instanceof AssetResolverError) throw error;
        throw new AssetResolverError(`Pro 素材のファイル取得に失敗しました: ${error.message}`, error.message?.includes('時間切れ') ? 'timeout' : 'download_failed');
      }
      await backfillLegacyMetaTier(path.join(tempAssetDir, 'meta.json'), item);
      const validation = await validateAsset(tempAssetDir);
      if (validation.status !== 0) {
        const output = `${validation.stdout ?? ''}${validation.stderr ?? ''}`.trim();
        throw new AssetResolverError(`validate-asset 検証に失敗しました: ${item.id}\n${output}`, 'validation');
      }
      await moveIntoLibrary(tempAssetDir, destDir);
      const result = { id: item.id, category: item.category, dir: destDir, cached: false };
      if (project && reference) {
        await recordProjectReference(project, item);
        result.referenced = true;
      } else if (project) {
        result.projectDir = await copyIntoProject(destDir, project, item.category, item.id);
      }
      return result;
    } catch (error) {
      if (error.status === 409 && error.storeCode === 'stale_version' && attempt === 0) continue;
      throw error;
    } finally {
      if (tempRoot) await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * @param {string} ref カタログの category/id。bare id は一意な場合のみ互換解決する
 * @param {{ env?: object, fetchImpl?: Function, project?: string|null, force?: boolean, reference?: boolean }} options
 */
export async function resolve(
  ref,
  { env = process.env, fetchImpl = fetch, project = null, force = false, reference = false, timeouts } = {},
) {
  const home = resolveAssetLibraryRoots(env).write;
  // A qualified reference already names the local directory. Avoid parsing the
  // large catalog on the common placement path; uncached and bare IDs still use it.
  const localRef = typeof ref === 'string' ? ref.split('/') : [];
  const qualified = localRef.length === 2 && localRef.every(part => part.length > 0
    && part !== '.' && part !== '..' && !/[\\\0]/.test(part));
  if (!force && qualified) {
    const cachedDir = await cachedAssetDirAsync(env, localRef[0], localRef[1]);
    if (cachedDir) {
      const result = { id: localRef[1], category: localRef[0], dir: cachedDir, cached: true };
      if (project && reference) {
        await recordProjectReference(project, { id: localRef[1], category: localRef[0] });
        result.referenced = true;
      } else if (project) {
        result.projectDir = await copyIntoProject(cachedDir, project, localRef[0], localRef[1]);
      }
      return result;
    }
  }
  const catalog = await loadCatalogForResolveAsync(ref, { env, fetchImpl, timeouts });
  const item = findCatalogItem(catalog, ref);

  const tier = assetTier(item);
  const hasFiles = Array.isArray(item.files) && item.files.length > 0;
  const destDir = path.join(home, item.category, item.id);

  // キャッシュヒット → 即返す（未購入だったとしても、一度取得済みなら手元にある実体をそのまま使う。
  // ゲートは「新規に取得するとき」だけにかける）
  const cachedDir = await cachedAssetDirAsync(env, item.category, item.id);
  if (!force && cachedDir) {
    const result = { id: item.id, category: item.category, dir: cachedDir, cached: true };
    if (project && reference) {
      await recordProjectReference(project, item);
      result.referenced = true;
    } else if (project) {
      result.projectDir = await copyIntoProject(cachedDir, project, item.category, item.id);
    }
    return result;
  }

  if (tier === 'pro' && hasFiles && item.source !== 'installed') {
    throw new AssetResolverError(`Pro カタログ item に files[] を含められません: ${item.id}`, 'invalid_catalog_item');
  }

  if (tier === 'pro' && item.source !== 'installed') {
    const entitlementsResult = await fetchEntitlements({ env, fetchImpl, timeouts });
    if (entitlementsResult.error?.includes('時間切れ')) throw new AssetResolverError(entitlementsResult.error, 'timeout');
    if (!isAssetEntitled(item, entitlementsResult)) {
      throw new AssetResolverError(
        `Pro 素材は all-access-pass（Lifetime パス）または購入済み product_id が必要です: ${item.id}`,
        'locked',
      );
    }
    if (!hasFiles) {
      const credentials = await readStoreCredentials(env);
      if (!credentials) {
        throw new AssetResolverError(`AKARI アカウントの接続情報がありません（トークン失効の可能性）: ${item.id}`, 'locked');
      }
      return resolveProAsset(item, credentials, { env, fetchImpl, project, reference, home, destDir, timeouts });
    }
  }

  if (!hasFiles) {
    throw new AssetResolverError(`カタログに files[] がありません: ${item.id}`, 'invalid_catalog_item');
  }

  const base = item.source === 'installed' ? null : resolveEffectiveBase(env, catalog);
  await mkdir(home, { recursive: true });
  const tempRoot = await mkdtemp(path.join(home, '.tmp-resolve-'));
  // validate-asset はディレクトリ名（basename）= id・親ディレクトリ名 = category を要求するので、
  // 一時ディレクトリの中にも同じ形（<tempRoot>/<category>/<id>/）を作っておく
  // （move 前後でパスの「形」を変えない — 検証した実体をそのまま登録先に置くだけにする）
  const tempAssetDir = path.join(tempRoot, item.category, item.id);

  try {
    await mkdir(tempAssetDir, { recursive: true });
    const hasMeta = item.files.some(file => file.name === 'meta.json');
    await fetchFilesInto(item.files, tempAssetDir, item, { base, fetchImpl, timeouts });

    // still / scene3d 等、meta.json を実体に持つ素材は validate-asset で契約検証してから登録する
    if (hasMeta) {
      await backfillLegacyMetaTier(path.join(tempAssetDir, 'meta.json'), item);
      const result = await validateAsset(tempAssetDir);
      if (result.status !== 0) {
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
        throw new AssetResolverError(`validate-asset 検証に失敗しました: ${item.id}\n${output}`, 'validation');
      }
    }

    await moveIntoLibrary(tempAssetDir, destDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }

  const result = { id: item.id, category: item.category, dir: destDir, cached: false };
  if (project && reference) {
    await recordProjectReference(project, item);
    result.referenced = true;
  } else if (project) {
    result.projectDir = await copyIntoProject(destDir, project, item.category, item.id);
  }
  return result;
}

/**
 * 有料素材の取得経路（契約 §6/§8）。entitled 済み（呼び出し元で確認済み）が前提。
 * zip 取得 → 展開 → checksums.txt 検証（paid-zip.mjs）→ 素材ペイロードを一時ディレクトリへ
 * コピー → （meta.json があれば）validate-asset → 全部通ってから登録先へ原子的に move する。
 * 無料経路（files[] ベース）と同じ fail-closed・一時ディレクトリ破棄の規律を踏襲する。
 */
async function resolvePaidZip(item, { env, fetchImpl, project, reference, home, destDir, timeouts }) {
  const credentials = await readStoreCredentials(env);
  if (!credentials) {
    // entitled 判定（fetchEntitlements）が通った直後にここへ来るので通常は発生しないが、
    // その間にトークンが失効した場合も黙って劣化させず拒否する（fail-closed）。
    throw new AssetResolverError(`AKARI アカウントの接続情報がありません（トークン失効の可能性）: ${item.id}`, 'locked');
  }

  await mkdir(home, { recursive: true });
  const tempRoot = await mkdtemp(path.join(home, '.tmp-resolve-'));
  const tempAssetDir = path.join(tempRoot, item.category, item.id);

  try {
    const productId = item.product_id ?? item.id;
    const zipPath = path.join(tempRoot, `${productId}.zip`);
    await downloadPaidZip(productId, credentials, zipPath, { env, fetchImpl, timeouts });

    const extractedRoot = path.join(tempRoot, 'extracted');
    extractZip(zipPath, extractedRoot);
    const { packageDir, payloadFiles } = await verifyPaidZipContents(extractedRoot, productId);

    // パックは assets/<category>/<id>/ と assets/<id>/ の両配置を受け付ける。
    // 契約 v0 のフラット形状（zip 直下に meta.json / 本体）も
    // 引き続き受け付ける。どちらの形でも、ライブラリへ入るのは素材ディレクトリの中身だけ
    // （PACK.json / docs はライブラリに混ぜない — 全量が必要なら `akari store download` が zip を渡す）。
    const prefixes = [`assets/${item.category}/${item.id}/`, `assets/${item.id}/`];
    const nestedPrefix = prefixes.find(prefix => payloadFiles.some(file => file.startsWith(prefix)));
    const nestedFiles = nestedPrefix
      ? payloadFiles.filter(file => file.startsWith(nestedPrefix)).map(file => file.slice(nestedPrefix.length))
      : [];
    // A shared product zip may contain many assets. Never copy a sibling into this item's directory.
    if (item.product_id && item.product_id !== item.id && !nestedPrefix) {
      throw new AssetResolverError(`パック内に対象素材がありません: ${item.id}`, 'integrity');
    }
    const payloadRoot = nestedPrefix ? path.join(packageDir, nestedPrefix) : packageDir;
    const assetFiles = nestedPrefix ? nestedFiles : payloadFiles;

    // 有料素材は meta.json 必須（契約検証を必ず通す）。形の取り違えを「meta.json の無い素材」と
    // 誤認して検証スキップのまま通した前歴（#25）があるため fail-closed に倒す
    if (!assetFiles.includes('meta.json')) {
      throw new AssetResolverError(
        `有料素材の zip に meta.json がありません（期待: assets/<category>/<id>/meta.json または zip 直下）: ${item.id}`,
        'integrity',
      );
    }

    await mkdir(tempAssetDir, { recursive: true });
    for (const relPath of assetFiles) {
      const destFile = path.join(tempAssetDir, relPath);
      await mkdir(path.dirname(destFile), { recursive: true });
      await cp(path.join(payloadRoot, relPath), destFile, {
        mode: constants.COPYFILE_FICLONE,
      });
    }

    await backfillLegacyMetaTier(path.join(tempAssetDir, 'meta.json'), item);

    {
      const result = await validateAsset(tempAssetDir);
      if (result.status !== 0) {
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
        throw new AssetResolverError(`validate-asset 検証に失敗しました: ${item.id}\n${output}`, 'validation');
      }
    }

    await moveIntoLibrary(tempAssetDir, destDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }

  const result = { id: item.id, category: item.category, dir: destDir, cached: false };
  if (project && reference) {
    await recordProjectReference(project, item);
    result.referenced = true;
  } else if (project) {
    result.projectDir = await copyIntoProject(destDir, project, item.category, item.id);
  }
  return result;
}
