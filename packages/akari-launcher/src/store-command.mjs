import { spawnSync } from 'node:child_process';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, renameSync, rmSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_STORE_BASE_URL,
  defaultOpenBrowser,
  fetchStoreEntitlements,
  formatStoreEntitlements,
  pollDeviceConnection,
  readCredentials,
  removeCredentials,
  resolveAkariHome,
  startDeviceConnection,
  validateAndSaveCredentials
} from './store-device-connect.mjs';

export { readCredentials, resolveCredentialsPath } from './store-device-connect.mjs';

/**
 * AKARI Store 連携（`akari store <connect|status|download|disconnect>`）。
 *
 * `connect` の既定は**デバイスコードフロー**（2026-08-03 オーナー要望「トークンの
 * 使い方とかみんなよくわからん」への回答）: ブラウザが開き、ログイン → 承認ボタンで
 * 完了する。トークンはユーザーの目に触れない。`--token akst_...` は上級者・自動化向けの
 * 手動フォールバック。取得したトークンで本体から「何を購入済みか」（entitlements API）と
 * 「配布物の取得」（download API）が使える。宣言パック等の展開（unlock）は
 * セットアップスキル側の仕事で、本コマンドはその土台のプリミティブだけを持つ。
 *
 * 規約は launcher の他コマンドと同じ:
 *   - `~/.akari` は AKARI_HOME で差し替え可能（テスト・隔離実行）
 *   - 副作用（fetch / openBrowser / sleep / log）は options で注入可能・node --test で実プロセス不要
 */

function parseFlag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(p, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return p;
    }
  }
  return null;
}

const INSTALLED_ASSETS_SCHEMA = 'akari-installed-assets/v0';

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function titleFromMeta(assetRoot) {
  try {
    const meta = readJsonFile(path.join(assetRoot, 'meta.json'));
    return typeof meta.title === 'string' && meta.title ? meta.title : null;
  } catch {
    return null;
  }
}

function isSafePathSegment(value) {
  return typeof value === 'string' && value.length > 0
    && value !== '.' && value !== '..'
    && !value.includes('/') && !value.includes('\\');
}

function pathWithin(root, ...parts) {
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, ...parts);
  if (candidate !== absoluteRoot && !candidate.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`PACK.json の path がパック外を指しています: ${parts.join('/')}`);
  }
  return candidate;
}

function flattenPackContents(pack, packRoot) {
  if (!Array.isArray(pack?.contents)) {
    throw new Error('PACK.json に contents[] がありません');
  }

  const items = [];
  for (const entry of pack.contents) {
    const candidates = Array.isArray(entry?.assets)
      ? entry.assets.map((asset) => ({ asset, parentTitle: entry.title }))
      : [{ asset: entry, parentTitle: null }];
    if (candidates.length === 0) {
      throw new Error('PACK.json の contents[] に空の assets[] があります');
    }

    for (const { asset, parentTitle } of candidates) {
      if (!asset || !isSafePathSegment(asset.id)
        || typeof asset.path !== 'string' || !asset.path) {
        throw new Error('PACK.json の contents[] に不正な id / path があります');
      }
      const assetRoot = pathWithin(packRoot, asset.path);
      if (!Array.isArray(asset.files) || asset.files.length === 0) {
        throw new Error(`PACK.json の item に files[] がありません: ${asset.id}`);
      }
      const files = asset.files.map((file) => {
        if (!file || typeof file.path !== 'string' || !file.path
          || !Number.isInteger(file.bytes) || file.bytes < 0
          || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
          throw new Error(`PACK.json の files[] が不正です: ${asset.id}`);
        }
        pathWithin(assetRoot, file.path);
        return {
          path: file.path,
          bytes: file.bytes,
          sha256: file.sha256
        };
      });
      const version = asset.version ?? pack.version;
      if (version === undefined || version === null) {
        throw new Error(`PACK.json の item に version がありません: ${asset.id}`);
      }
      items.push({
        id: asset.id,
        title: (typeof asset.title === 'string' && asset.title)
          || titleFromMeta(assetRoot)
          || (typeof parentTitle === 'string' && parentTitle)
          || asset.id,
        path: asset.path,
        version,
        files
      });
    }
  }
  return items;
}

function registerInstalledPack(env, productId, packPath) {
  const home = resolveAkariHome(env);
  const indexPath = path.join(home, 'assets', 'installed.json');
  const packRoot = path.dirname(packPath);
  const pack = readJsonFile(packPath);
  if ((typeof pack?.version !== 'string' && typeof pack?.version !== 'number')) {
    throw new Error('PACK.json に version がありません');
  }
  let index = { schema: INSTALLED_ASSETS_SCHEMA, packs: {} };

  if (existsSync(indexPath)) {
    index = readJsonFile(indexPath);
    if (index?.schema !== INSTALLED_ASSETS_SCHEMA
      || !index.packs || typeof index.packs !== 'object' || Array.isArray(index.packs)) {
      throw new Error(`導入済み素材索引の形式が想定と違います: ${indexPath}`);
    }
  }

  const items = flattenPackContents(pack, packRoot);
  index.packs[productId] = {
    version: pack.version,
    installedAt: new Date().toISOString(),
    root: packRoot,
    items
  };
  mkdirSync(path.dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.tmp-${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, indexPath);
  return items;
}

const KNOWN_BUNDLE_COMPONENTS = new Map([
  ['multi-device-combo', ['phone-pro-titanium', 'laptop-slim-aluminum', 'app-icon-squircle']]
]);

async function readJsonResponse(res) {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function componentIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((component) => typeof component === 'string'
      ? component
      : component?.id ?? component?.product_id)
    .filter((id) => typeof id === 'string' && id.length > 0);
}

function bundleDetails(data, productId) {
  const candidates = [data, data?.product, data?.status];
  const products = Array.isArray(data?.products) ? data.products : [];
  const matchingProduct = products.find((product) =>
    product?.id === productId || product?.product_id === productId);
  if (matchingProduct) candidates.push(matchingProduct);

  const bundle = candidates.find((candidate) => candidate?.kind === 'bundle');
  if (!bundle) return null;
  return { components: componentIds(bundle.components ?? data?.components) };
}

async function resolveBundleDetails(fetchImpl, creds, productId, errorData) {
  const knownComponents = KNOWN_BUNDLE_COMPONENTS.get(productId);
  if (knownComponents) return { components: knownComponents };

  const fromError = bundleDetails(errorData, productId);
  if (fromError) return fromError;

  try {
    const productsRes = await fetchImpl(`${creds.url}/products`);
    if (!productsRes.ok) return null;
    return bundleDetails(await readJsonResponse(productsRes), productId);
  } catch {
    return null;
  }
}

export async function runStoreCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const openBrowser = options.openBrowser ?? defaultOpenBrowser;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const sub = args[0];

  if (sub === 'connect') {
    const baseUrl = (parseFlag(args, '--url') ?? DEFAULT_STORE_BASE_URL).replace(/\/$/, '');

    // 手動フォールバック（自動化・上級者向け）
    const manualToken = parseFlag(args, '--token');
    if (manualToken) {
      const validation = await validateAndSaveCredentials({ fetchImpl, env, log }, baseUrl, manualToken);
      return { exitCode: validation.status === 'approved' ? 0 : 1 };
    }

    // 既定 = デバイスコードフロー: ブラウザでログイン → 承認ボタンだけで完了
    const start = await startDeviceConnection({ fetchImpl, baseUrl });
    if (start.status !== 'started') {
      log(start.error);
      return { exitCode: 1 };
    }

    log('ブラウザで AKARI Store を開いて接続を承認してください。');
    log(`  確認コード: ${start.userCode}`);
    log(`  URL: ${start.verificationUrl}`);
    if (!args.includes('--no-open')) {
      openBrowser(start.verificationUrl);
    }
    log('承認を待っています…（Ctrl+C で中止）');

    while (Date.now() < start.expiresAt) {
      await sleep(start.intervalMs);
      const claim = await pollDeviceConnection({
        fetchImpl,
        env,
        log,
        baseUrl,
        deviceCode: start.deviceCode
      });
      if (claim.status === 'network-error' || claim.status === 'pending') {
        continue;
      }
      if (claim.status === 'expired') {
        log('コードの有効期限が切れました。もう一度 `akari store connect` を実行してください。');
        return { exitCode: 1 };
      }
      return { exitCode: claim.status === 'approved' ? 0 : 1 };
    }
    log('承認の待機がタイムアウトしました。もう一度 `akari store connect` を実行してください。');
    return { exitCode: 1 };
  }

  if (sub === 'status') {
    const creds = readCredentials(env);
    if (!creds) {
      log('未接続です。`akari store connect` で接続してください。');
      return { exitCode: 1 };
    }
    const { data, error } = await fetchStoreEntitlements(fetchImpl, creds.url, creds.token);
    if (error) {
      log(`接続情報はありますが確認に失敗しました: ${error}`);
      return { exitCode: 1 };
    }
    log(`接続中: ${data.email}（${creds.url}）`);
    formatStoreEntitlements(data, log);
    return { exitCode: 0 };
  }

  if (sub === 'download') {
    const productId = args[1];
    if (!productId || productId.startsWith('--')) {
      log('使い方: akari store download <productId> [--dest <dir>]');
      return { exitCode: 1 };
    }
    const creds = readCredentials(env);
    if (!creds) {
      log('未接続です。`akari store connect` で接続してください。');
      return { exitCode: 1 };
    }
    let res;
    try {
      res = await fetchImpl(`${creds.url}/v1/download/${productId}`, {
        headers: { authorization: `Bearer ${creds.token}` }
      });
    } catch (error) {
      log(`ダウンロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      return { exitCode: 1 };
    }
    if (res.status === 403) {
      log(`この商品の購入が確認できません: ${productId}`);
      return { exitCode: 1 };
    }
    if (!res.ok) {
      const data = await readJsonResponse(res);
      if (res.status === 404) {
        const bundle = await resolveBundleDetails(fetchImpl, creds, productId, data);
        if (bundle) {
          const componentList = bundle.components.length > 0
            ? `: ${bundle.components.join(', ')}`
            : '';
          log(`セット商品は構成商品を個別に download してください${componentList}`);
          return { exitCode: 1 };
        }
      }
      if (res.status === 404 && data?.error === 'unknown_product') {
        log(`${typeof data.message === 'string' ? data.message : '商品が見つかりません'}（${productId}）`);
        return { exitCode: 1 };
      }
      if (res.status === 404 && data?.error === 'artifact_missing') {
        log(typeof data.message === 'string'
          ? data.message
          : '配布物が未入稿です。サポートへご連絡ください');
        return { exitCode: 1 };
      }
      log(`ダウンロードに失敗しました（${res.status}）`);
      return { exitCode: 1 };
    }
    const destDir = parseFlag(args, '--dest') ?? process.cwd();
    mkdirSync(destDir, { recursive: true });
    const nameMatch = (res.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/);
    const fileName = nameMatch ? nameMatch[1] : `${productId}.zip`;
    const filePath = path.join(destDir, fileName);
    writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    log(`保存しました: ${filePath}`);
    return { exitCode: 0, filePath };
  }

  if (sub === 'install') {
    const productId = args[1];
    if (!isSafePathSegment(productId) || productId.startsWith('--')) {
      log('使い方: akari store install <productId> [--from <zip>]');
      return { exitCode: 1 };
    }
    const hasFrom = args.includes('--from');
    const fromZip = parseFlag(args, '--from');
    if (hasFrom && !fromZip) {
      log('使い方: akari store install <productId> [--from <zip>]');
      return { exitCode: 1 };
    }
    const stage = mkdtempSync(path.join(tmpdir(), 'akari-store-install-'));
    try {
      const dl = fromZip
        ? { exitCode: existsSync(fromZip) ? 0 : 1, filePath: path.resolve(fromZip) }
        : await runStoreCommand(['download', productId, '--dest', stage], options);
      if (fromZip && dl.exitCode !== 0) log(`zip が見つかりません: ${fromZip}`);
      if (dl.exitCode !== 0) return { exitCode: 1 };
      const extractDir = path.join(stage, 'x');
      mkdirSync(extractDir, { recursive: true });
      // unzip 優先・無ければ bsdtar（Windows 10+ の tar は zip を読める）
      const extracted = options.extract
        ? options.extract(dl.filePath, extractDir)
        : ['unzip', 'tar'].some((tool) => {
            const cmdArgs = tool === 'unzip' ? ['-o', '-q', dl.filePath, '-d', extractDir] : ['-xf', dl.filePath, '-C', extractDir];
            try {
              return spawnSync(tool, cmdArgs, { stdio: 'ignore' }).status === 0;
            } catch {
              return false;
            }
          });
      if (!extracted) {
        log(`zip の展開に失敗しました。手動で展開してください: ${dl.filePath}`);
        return { exitCode: 1 };
      }

      if (productId === 'sounds-declaration-pack') {
        // パック同梱 README の導入手順どおり「declarations.json を 1 個置くだけ」
        const found = findFile(extractDir, 'declarations.json');
        if (!found) {
          log('パック内に declarations.json が見つかりませんでした。zip の中身を確認してください。');
          return { exitCode: 1 };
        }
        const destDir = path.join(resolveAkariHome(env), 'assets', 'audio');
        mkdirSync(destDir, { recursive: true });
        const dest = path.join(destDir, 'declarations.json');
        if (existsSync(dest)) {
          const backup = `${dest}.bak-${Date.now()}`;
          copyFileSync(dest, backup);
          log(`既存の declarations.json を退避しました: ${backup}`);
        }
        copyFileSync(found, dest);
        log(`導入しました: ${dest}`);
        log('AKARI Video の BGM 自動提案（suggest-bgm）が収録曲を実測 BPM・サビ頭出し付きで優先提案します。');
        return { exitCode: 0 };
      }

      // 既知の導入手順が無い商品は素材置き場に展開して README を案内
      const destDir = path.join(resolveAkariHome(env), 'assets', 'store', productId);
      rmSync(destDir, { recursive: true, force: true });
      cpSync(extractDir, destDir, { recursive: true });
      const readme = findFile(destDir, 'README.md');
      log(`展開しました: ${destDir}`);
      if (readme) log(`導入手順: ${readme}`);
      const packPath = findFile(destDir, 'PACK.json');
      if (packPath) {
        const items = registerInstalledPack(env, productId, packPath);
        log(`akari assets list に ${items.length} 件を登録しました`);
        if (items[0]) log(`次の一手: akari assets fetch ${items[0].id}`);
      }
      return { exitCode: 0 };
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }

  if (sub === 'disconnect') {
    if (removeCredentials(env)) {
      log('接続を解除しました（マイページ側のトークン失効もおすすめします）。');
    } else {
      log('未接続です。');
    }
    return { exitCode: 0 };
  }

  log('使い方: akari store <connect|status|install|download|disconnect>');
  log('  connect                              ブラウザで承認して接続（既定。--token akst_... で手動 / --no-open でブラウザを開かない / --url <base>）');
  log('  status                               接続状態と購入済み一覧');
  log('  install <productId> [--from <zip>]   購入済み商品の導入（--from は手元 zip / PACK.json 素材を installed 索引へ登録）');
  log('  download <productId> [--dest <dir>]  購入済み配布物の取得のみ');
  log('  disconnect                           接続解除');
  return { exitCode: sub ? 1 : 0 };
}
