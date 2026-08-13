// resolve(id): 「使った素材だけをオンデマンドで取得する」の核。
//
// キャッシュヒット → 即パスを返す。未取得 → 全ファイルを一時ディレクトリへ実体化 →
// sha256 検証 → （meta.json を持つ素材は）validate-asset で契約検証 →
// 全部通ってから ~/.akari/assets/<category>/<id>/ へ原子的に move する。
// 失敗は fail-closed（一時ディレクトリを破棄し、登録先には部分状態を残さない）。
// 有料未購入（locked）は resolve を拒否する。
//
// 有料 item（price > 0）は catalog に files[] を持たない（実体は非公開 R2 のまま）。entitled
// なら resolvePaidZip() が `/api/store/v1/download/<id>` から zip を取得し、展開 →
// checksums.txt 検証（paid-zip.mjs）→ 同じ validate-asset / 原子的 move の経路に合流する。

import { spawnSync } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './catalog.mjs';
import { resolveAkariHome, resolveEffectiveBase } from './env.mjs';
import { AssetResolverError } from './errors.mjs';
import { fetchEntitlements, readStoreCredentials } from './entitlements.mjs';
import { materialize, resolveFileLocation } from './fetch-file.mjs';
import { sha256File } from './hash.mjs';
import { isAssetCached, localAssetDir } from './library.mjs';
import { downloadPaidZip, extractZip, verifyPaidZipContents } from './paid-zip.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ の 1 つ上（パッケージ root）のさらに 2 つ上（packages/）のさらに 1 つ上（リポ root）。
// fetch-akari-sounds.mjs（packages/audio-library-setup/bin/）と同じ深さの相対規約。
const repoRoot = path.resolve(here, '..', '..', '..');
const VALIDATE_ASSET_SCRIPT = path.join(repoRoot, 'packages', 'schemas', 'bin', 'validate-asset.mjs');

export { AssetResolverError };

async function copyIntoProject(sourceDir, projectDir, category, id) {
  // ライブラリ（~/.akari/assets/<category>/<id>/）と同型に揃える（2026-08-04 決定）。
  // 素材箱側が「meta.json を含むディレクトリ = 1 カード」でグルーピングする際、
  // 深さではなくディレクトリ形で判定するため、置き場の形をライブラリと合わせておく必要はないが、
  // カテゴリ別に整理された配置の方が人間が見ても分かりやすいのでライブラリ型に統一する。
  const dest = path.join(path.resolve(projectDir), 'assets', category, id);
  await mkdir(path.dirname(dest), { recursive: true });
  await rm(dest, { recursive: true, force: true });

  if (process.platform === 'darwin') {
    // このマシンの Node（libuv）は clonefileat 相当が ENOSYS を返し、fs.cp の
    // COPYFILE_FICLONE では節約が効かない（前段 2026-08-09-project-copy-cow-clone で実測確認済み）。
    // BSD cp -c は clonefile(2) を Node を介さず直接使うため、同じ OS/FS 上で実際にクローンできる。
    const clone = spawnSync('/bin/cp', ['-Rc', sourceDir, dest], { stdio: 'ignore' });
    if (!clone.error && clone.status === 0) {
      return dest;
    }
    // クロスボリューム等で -c が失敗したケース。部分的に書かれた dest を掃除してから
    // fs.cp フォールバックへ渡す（既存の非 darwin 経路と同じ挙動に合流する）。
    await rm(dest, { recursive: true, force: true });
  }

  // COPYFILE_FICLONE（_FORCE ではない）: 対応 FS（APFS 等）では CoW クローンで実体化コピーを
  // 省略し、非対応環境では黙って通常コピーへフォールバックする（失敗しない）。
  await cp(sourceDir, dest, { recursive: true, mode: constants.COPYFILE_FICLONE });
  return dest;
}

async function moveIntoLibrary(tempDir, destDir) {
  await mkdir(path.dirname(destDir), { recursive: true });
  if (existsSync(destDir)) {
    await rm(destDir, { recursive: true, force: true });
  }
  try {
    await rename(tempDir, destDir);
  } catch (error) {
    // 一時ディレクトリと登録先が別ファイルシステムの場合（EXDEV）は copy + rm でフォールバック
    if (error && error.code === 'EXDEV') {
      await cp(tempDir, destDir, { recursive: true, mode: constants.COPYFILE_FICLONE });
      await rm(tempDir, { recursive: true, force: true });
      return;
    }
    throw error;
  }
}

/**
 * @param {string} id カタログの素材 id
 * @param {{ env?: object, fetchImpl?: Function, project?: string|null, force?: boolean }} options
 */
export async function resolve(id, { env = process.env, fetchImpl = fetch, project = null, force = false } = {}) {
  const home = resolveAkariHome(env);
  const catalog = await loadCatalog({ env, fetchImpl });
  const item = catalog.items.find((entry) => entry.id === id);
  if (!item) {
    throw new AssetResolverError(`未知の素材 id です: ${id}`, 'not_found');
  }

  const destDir = localAssetDir(home, item.category, item.id);

  // キャッシュヒット → 即返す（未購入だったとしても、一度取得済みなら手元にある実体をそのまま使う。
  // ゲートは「新規に取得するとき」だけにかける）
  if (!force && isAssetCached(home, item.category, item.id)) {
    const result = { id: item.id, category: item.category, dir: destDir, cached: true };
    if (project) result.projectDir = await copyIntoProject(destDir, project, item.category, item.id);
    return result;
  }

  const price = item.price ?? 0;
  const hasFiles = Array.isArray(item.files) && item.files.length > 0;
  if (price > 0) {
    const { ids: entitlements } = await fetchEntitlements({ env, fetchImpl });
    if (!entitlements.has(item.id)) {
      throw new AssetResolverError(
        `未購入の素材です（¥${price.toLocaleString()}）。ストアで購入してから再度お試しください: ${item.id}`,
        'locked',
      );
    }
    // 有料カタログ item は files[] を持たない設計（実体は非公開 R2 のまま。tools/publish-free.mjs
    // 側の掲載規律の裏返し）。entitled 済みなら zip ダウンロード経路（契約 §6/§8）で取得する。
    if (!hasFiles) {
      return resolvePaidZip(item, { env, fetchImpl, project, home, destDir });
    }
  }

  if (!hasFiles) {
    throw new AssetResolverError(`カタログに files[] がありません: ${item.id}`, 'invalid_catalog_item');
  }

  const base = resolveEffectiveBase(env, catalog);
  await mkdir(home, { recursive: true });
  const tempRoot = await mkdtemp(path.join(home, '.tmp-resolve-'));
  // validate-asset はディレクトリ名（basename）= id・親ディレクトリ名 = category を要求するので、
  // 一時ディレクトリの中にも同じ形（<tempRoot>/<category>/<id>/）を作っておく
  // （move 前後でパスの「形」を変えない — 検証した実体をそのまま登録先に置くだけにする）
  const tempAssetDir = path.join(tempRoot, item.category, item.id);

  try {
    await mkdir(tempAssetDir, { recursive: true });
    let hasMeta = false;
    for (const file of item.files) {
      if (typeof file.name !== 'string' || !file.name) {
        throw new AssetResolverError(`files[] エントリに name がありません: ${item.id}`, 'invalid_catalog_item');
      }
      if (file.name === 'meta.json') hasMeta = true;

      const destPath = path.join(tempAssetDir, file.name);
      const resolved = resolveFileLocation(base, file);
      await materialize(resolved, destPath, { fetchImpl });

      if (file.sha256) {
        const actual = await sha256File(destPath);
        if (actual !== file.sha256) {
          throw new AssetResolverError(
            `sha256 が一致しません（改竄または破損の可能性）: ${item.id}/${file.name}（期待 ${file.sha256} / 実際 ${actual}）`,
            'integrity',
          );
        }
      }
    }

    // still / scene3d 等、meta.json を実体に持つ素材は validate-asset で契約検証してから登録する
    if (hasMeta) {
      const result = spawnSync(process.execPath, [VALIDATE_ASSET_SCRIPT, tempAssetDir], { encoding: 'utf8' });
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
  if (project) result.projectDir = await copyIntoProject(destDir, project, item.category, item.id);
  return result;
}

/**
 * 有料素材の取得経路（契約 §6/§8）。entitled 済み（呼び出し元で確認済み）が前提。
 * zip 取得 → 展開 → checksums.txt 検証（paid-zip.mjs）→ 素材ペイロードを一時ディレクトリへ
 * コピー → （meta.json があれば）validate-asset → 全部通ってから登録先へ原子的に move する。
 * 無料経路（files[] ベース）と同じ fail-closed・一時ディレクトリ破棄の規律を踏襲する。
 */
async function resolvePaidZip(item, { env, fetchImpl, project, home, destDir }) {
  const credentials = await readStoreCredentials(env);
  if (!credentials) {
    // entitled 判定（fetchEntitlements）が通った直後にここへ来るので通常は発生しないが、
    // その間にトークンが失効した場合も黙って劣化させず拒否する（fail-closed）。
    throw new AssetResolverError(`ストア接続情報がありません（トークン失効の可能性）: ${item.id}`, 'locked');
  }

  await mkdir(home, { recursive: true });
  const tempRoot = await mkdtemp(path.join(home, '.tmp-resolve-'));
  const tempAssetDir = path.join(tempRoot, item.category, item.id);

  try {
    const zipPath = path.join(tempRoot, `${item.id}.zip`);
    await downloadPaidZip(item.id, credentials, zipPath, { env, fetchImpl });

    const extractedRoot = path.join(tempRoot, 'extracted');
    extractZip(zipPath, extractedRoot);
    const { packageDir, payloadFiles } = await verifyPaidZipContents(extractedRoot, item.id);

    await mkdir(tempAssetDir, { recursive: true });
    let hasMeta = false;
    for (const relPath of payloadFiles) {
      if (relPath === 'meta.json') hasMeta = true;
      await cp(path.join(packageDir, relPath), path.join(tempAssetDir, relPath), {
        mode: constants.COPYFILE_FICLONE,
      });
    }

    if (hasMeta) {
      const result = spawnSync(process.execPath, [VALIDATE_ASSET_SCRIPT, tempAssetDir], { encoding: 'utf8' });
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
  if (project) result.projectDir = await copyIntoProject(destDir, project, item.category, item.id);
  return result;
}
