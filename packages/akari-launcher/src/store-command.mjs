import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, renameSync, rmSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
import { readOwnVersion } from './update-check.mjs';
import { resolveLauncherAssets } from './repo-assets.mjs';
import { cliText } from './i18n.mjs';
const creatorRootModulePath = resolveLauncherAssets().creatorRootModulePath;
const creatorRoot = creatorRootModulePath ? await import(pathToFileURL(creatorRootModulePath).href) : null;
function resolveAssetLibraryRoots(env) {
  if (!creatorRoot) throw new Error(cliText('cli.store.error.creatorRootMissing'));
  return creatorRoot.resolveAssetLibraryRoots(env);
}
import {
  checkRequires,
  enableHint,
  ensureKitsMarketplace,
  linkKitAssets,
  linkKitPlaybooks,
  linkKitSkills,
  readKitManifest,
  readKitsLedger,
  registerKitAssets,
  removeKit,
  writeKitsLedger
} from './kits.mjs';

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

function readAssetMeta(assetRoot) {
  try {
    return readJsonFile(path.join(assetRoot, 'meta.json'));
  } catch {
    return null;
  }
}

function declaredTier(...sources) {
  for (const source of sources) {
    if (source && Object.hasOwn(source, 'tier')) return source.tier === 'free' ? 'free' : 'pro';
  }
  for (const source of sources) {
    if (source?.price === 0) return 'free';
    if (typeof source?.price === 'number' && source.price > 0) return 'pro';
  }
  return 'pro';
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
    throw new Error(cliText('cli.store.pack.error.pathOutside', { path: parts.join('/') }));
  }
  return candidate;
}

function flattenPackContents(pack, packRoot) {
  if (!Array.isArray(pack?.contents)) {
    throw new Error(cliText('cli.store.pack.error.contentsMissing'));
  }

  const items = [];
  for (const entry of pack.contents) {
    const candidates = Array.isArray(entry?.assets)
      ? entry.assets.map((asset) => ({ asset, parentTitle: entry.title }))
      : [{ asset: entry, parentTitle: null }];
    if (candidates.length === 0) {
      throw new Error(cliText('cli.store.pack.error.assetsEmpty'));
    }

    for (const { asset, parentTitle } of candidates) {
      if (!asset || !isSafePathSegment(asset.id)
        || typeof asset.path !== 'string' || !asset.path) {
        throw new Error(cliText('cli.store.pack.error.invalidAsset'));
      }
      const assetRoot = pathWithin(packRoot, asset.path);
      const meta = readAssetMeta(assetRoot);
      if (!Array.isArray(asset.files) || asset.files.length === 0) {
        throw new Error(cliText('cli.store.pack.error.filesMissing', { id: asset.id }));
      }
      const files = asset.files.map((file) => {
        if (!file || typeof file.path !== 'string' || !file.path
          || !Number.isInteger(file.bytes) || file.bytes < 0
          || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
          throw new Error(cliText('cli.store.pack.error.invalidFiles', { id: asset.id }));
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
        throw new Error(cliText('cli.store.pack.error.itemVersionMissing', { id: asset.id }));
      }
      items.push({
        id: asset.id,
        title: (typeof asset.title === 'string' && asset.title)
          || (typeof meta?.title === 'string' && meta.title)
          || (typeof parentTitle === 'string' && parentTitle)
          || asset.id,
        tier: declaredTier(asset, meta, pack),
        path: asset.path,
        version,
        files
      });
    }
  }
  return items;
}

function registerInstalledPack(env, productId, packPath) {
  const indexPath = path.join(resolveAssetLibraryRoots(env).write, 'installed.json');
  const packRoot = path.dirname(packPath);
  const pack = readJsonFile(packPath);
  if ((typeof pack?.version !== 'string' && typeof pack?.version !== 'number')) {
    throw new Error(cliText('cli.store.pack.error.versionMissing'));
  }
  let index = { schema: INSTALLED_ASSETS_SCHEMA, packs: {} };

  if (existsSync(indexPath)) {
    index = readJsonFile(indexPath);
    if (index?.schema !== INSTALLED_ASSETS_SCHEMA
      || !index.packs || typeof index.packs !== 'object' || Array.isArray(index.packs)) {
      throw new Error(cliText('cli.store.pack.error.indexInvalid', { path: indexPath }));
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

    log(cliText('cli.store.connect.openBrowser'));
    log(cliText('cli.store.connect.code', { code: start.userCode }));
    log(`  URL: ${start.verificationUrl}`);
    if (!args.includes('--no-open')) {
      openBrowser(start.verificationUrl);
    }
    log(cliText('cli.store.connect.waiting'));

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
        log(cliText('cli.store.connect.expired'));
        return { exitCode: 1 };
      }
      return { exitCode: claim.status === 'approved' ? 0 : 1 };
    }
    log(cliText('cli.store.connect.timeout'));
    return { exitCode: 1 };
  }

  if (sub === 'status') {
    const creds = readCredentials(env);
    if (!creds) {
      log(cliText('cli.store.status.disconnectedGuide'));
      return { exitCode: 1 };
    }
    const { data, error } = await fetchStoreEntitlements(fetchImpl, creds.url, creds.token);
    if (error) {
      log(cliText('cli.store.status.checkFailed', { message: error }));
      return { exitCode: 1 };
    }
    log(cliText('cli.store.status.connected', { email: data.email, url: creds.url }));
    formatStoreEntitlements(data, log);
    const kits = readKitsLedger(resolveAkariHome(env)).kits;
    if (kits.length > 0) {
      log(cliText('cli.store.status.kits'));
      for (const kit of kits) {
        log(cliText('cli.store.status.kitRow', { id: kit.id, version: kit.version, skills: (kit.skills ?? []).join(', ') || cliText('cli.store.status.none'), count: (kit.assets ?? []).length, n: (kit.assets ?? []).length }));
      }
    }
    return { exitCode: 0 };
  }

  if (sub === 'uninstall') {
    const productId = args[1];
    if (!isSafePathSegment(productId) || productId.startsWith('--')) {
      log(cliText('cli.store.help.uninstallUsage'));
      return { exitCode: 1 };
    }
    if (!removeKit(resolveAkariHome(env), productId, env)) {
      log(cliText('cli.store.uninstall.notFound', { id: productId }));
      return { exitCode: 1 };
    }
    log(cliText('cli.store.uninstall.complete', { id: productId }));
    return { exitCode: 0 };
  }

  if (sub === 'download') {
    const productId = args[1];
    if (!isSafePathSegment(productId) || productId.startsWith('--')) {
      log(cliText('cli.store.help.downloadUsage'));
      return { exitCode: 1 };
    }
    const creds = readCredentials(env);
    const publicBase = (options.baseUrl ?? creds?.url ?? DEFAULT_STORE_BASE_URL).replace(/\/$/, '');
    let freeProduct;
    try {
      const listing = await fetchImpl(`${publicBase}/products`);
      if (listing.ok) {
        const data = await readJsonResponse(listing);
        freeProduct = data?.products?.find(item => item.id === productId && item.tier === 'free'
          && Number.isInteger(item.current_version) && item.current_version >= 1);
      }
    } catch { /* Paid download remains available when the public catalog is offline. */ }
    if (!freeProduct) {
      // Lab の無料の作り方（playbook）は商品データベースに載らず、無料 R2 の公開カタログ（/assets/catalog.json）にだけ載る。
      // その行の files[0].key を /assets/<key> から取り、sha256 を照合して保存する。
      try {
        const catalogResponse = await fetchImpl(new URL('/assets/catalog.json', publicBase).href);
        if (catalogResponse.ok) {
          const catalog = await readJsonResponse(catalogResponse);
          const row = catalog?.items?.find(item => item?.id === productId && item?.category === 'playbook' && item?.tier === 'free'
            && Number.isInteger(item?.version) && item.version >= 1 && typeof item?.files?.[0]?.key === 'string');
          const key = row?.files?.[0]?.key;
          if (row && /^[a-z0-9][a-z0-9/._-]*\.zip$/.test(key) && !key.includes('..')) {
            const response = await fetchImpl(new URL(`/assets/${key}`, publicBase).href);
            if (!response.ok) {
              log(cliText('cli.store.download.httpFailed', { status: response.status }));
              return { exitCode: 1 };
            }
            const bytes = Buffer.from(await response.arrayBuffer());
            const expected = row.files[0].sha256;
            if (typeof expected === 'string' && createHash('sha256').update(bytes).digest('hex') !== expected) {
              log(cliText('cli.store.download.failed', { message: 'sha256 mismatch' }));
              return { exitCode: 1 };
            }
            const destDir = parseFlag(args, '--dest') ?? process.cwd();
            mkdirSync(destDir, { recursive: true });
            const filePath = path.join(destDir, `${productId}-v${row.version}.zip`);
            writeFileSync(filePath, bytes);
            log(cliText('cli.store.download.saved', { path: filePath }));
            return { exitCode: 0, filePath };
          }
        }
      } catch { /* 公開カタログが取れなければ従来の経路へ */ }
    }
    if (freeProduct) {
      const version = freeProduct.current_version;
      const assetUrl = new URL(`/assets/products/${productId}/v${version}/${productId}-v${version}.zip`, publicBase);
      try {
        const response = await fetchImpl(assetUrl.href);
        if (response.ok) {
          const destDir = parseFlag(args, '--dest') ?? process.cwd();
          mkdirSync(destDir, { recursive: true });
          const filePath = path.join(destDir, `${productId}-v${version}.zip`);
          writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
          log(cliText('cli.store.download.saved', { path: filePath }));
          return { exitCode: 0, filePath };
        }
        if (response.status !== 404 || !creds) {
          log(cliText('cli.store.download.httpFailed', { status: response.status }));
          return { exitCode: 1 };
        }
      } catch (error) {
        log(cliText('cli.store.download.failed', { message: error instanceof Error ? error.message : String(error) }));
        return { exitCode: 1 };
      }
    }
    if (!creds) {
      log(cliText('cli.store.status.disconnectedGuide'));
      return { exitCode: 1 };
    }
    let res;
    try {
      res = await fetchImpl(`${creds.url}/v1/download/${productId}`, {
        headers: { authorization: `Bearer ${creds.token}` }
      });
    } catch (error) {
      log(cliText('cli.store.download.failed', { message: error instanceof Error ? error.message : String(error) }));
      return { exitCode: 1 };
    }
    if (res.status === 403) {
      log(cliText('cli.store.download.notPurchased', { id: productId }));
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
          log(cliText('cli.store.download.bundleGuide', { components: componentList }));
          return { exitCode: 1 };
        }
      }
      if (res.status === 404 && data?.error === 'unknown_product') {
        log(cliText('cli.store.download.productMessage', { message: typeof data.message === 'string' ? data.message : cliText('cli.store.download.productMissing'), id: productId }));
        return { exitCode: 1 };
      }
      if (res.status === 404 && data?.error === 'artifact_missing') {
        log(typeof data.message === 'string'
          ? data.message
          : cliText('cli.store.download.notPublished'));
        return { exitCode: 1 };
      }
      log(cliText('cli.store.download.httpFailed', { status: res.status }));
      return { exitCode: 1 };
    }
    const destDir = parseFlag(args, '--dest') ?? process.cwd();
    mkdirSync(destDir, { recursive: true });
    const nameMatch = (res.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/);
    const fileName = nameMatch ? nameMatch[1] : `${productId}.zip`;
    const filePath = path.join(destDir, fileName);
    writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    log(cliText('cli.store.download.saved', { path: filePath }));
    return { exitCode: 0, filePath };
  }

  if (sub === 'install') {
    const productId = args[1];
    if (!isSafePathSegment(productId) || productId.startsWith('--')) {
      log(cliText('cli.store.help.installUsage'));
      return { exitCode: 1 };
    }
    const hasFrom = args.includes('--from') || args.includes('--from-file');
    const fromZip = parseFlag(args, '--from-file') ?? parseFlag(args, '--from');
    if (hasFrom && !fromZip) {
      log(cliText('cli.store.help.installUsage'));
      return { exitCode: 1 };
    }
    const stage = mkdtempSync(path.join(tmpdir(), 'akari-store-install-'));
    try {
      const dl = fromZip
        ? { exitCode: existsSync(fromZip) ? 0 : 1, filePath: path.resolve(fromZip) }
        : await runStoreCommand(['download', productId, '--dest', stage], options);
      if (fromZip && dl.exitCode !== 0) log(cliText('cli.store.install.zipMissing', { path: fromZip }));
      if (dl.exitCode !== 0) return { exitCode: 1 };
      const extractDir = path.join(stage, 'x');
      mkdirSync(extractDir, { recursive: true });
      // 共有 zip 展開器は tar → unzip → Expand-Archive の順で試す。
      const extracted = options.extract
        ? options.extract(dl.filePath, extractDir)
        : await (async () => {
            try {
              const checkoutModule = new URL('../../asset-resolver/src/paid-zip.mjs', import.meta.url);
              const vendorModule = new URL('../vendor/packages/asset-resolver/src/paid-zip.mjs', import.meta.url);
              const moduleUrl = existsSync(checkoutModule) ? checkoutModule : vendorModule;
              const { extractZipWithTools } = await import(moduleUrl.href);
              extractZipWithTools(dl.filePath, extractDir);
              return true;
            } catch (error) { log(error.message); return false; }
          })();
      if (!extracted) {
        log(cliText('cli.store.install.extractFailed', { path: dl.filePath }));
        return { exitCode: 1 };
      }

      if (productId === 'sounds-declaration-pack') {
        // パック同梱 README の導入手順どおり「declarations.json を 1 個置くだけ」
        const found = findFile(extractDir, 'declarations.json');
        if (!found) {
          log(cliText('cli.store.install.declarationsMissing'));
          return { exitCode: 1 };
        }
        const destDir = path.join(resolveAssetLibraryRoots(env).write, 'audio');
        mkdirSync(destDir, { recursive: true });
        const dest = path.join(destDir, 'declarations.json');
        if (existsSync(dest)) {
          const backup = `${dest}.bak-${Date.now()}`;
          copyFileSync(dest, backup);
          log(cliText('cli.store.install.declarationsBackedUp', { path: backup }));
        }
        copyFileSync(found, dest);
        log(cliText('cli.store.install.complete', { path: dest }));
        log(cliText('cli.store.install.bgmSuggestion'));
        return { exitCode: 0 };
      }

      // 既知の導入手順が無い商品は素材置き場に展開して README を案内
      const destDir = path.join(resolveAssetLibraryRoots(env).write, 'store', productId);
      rmSync(destDir, { recursive: true, force: true });
      cpSync(extractDir, destDir, { recursive: true });
      const readme = findFile(destDir, 'README.md');
      log(cliText('cli.store.install.extracted', { path: destDir }));
      if (readme) log(cliText('cli.store.install.instructions', { path: readme }));
      // 深い階層の無関係な manifest.json をキットと誤認すると、従来成功していた素材商品の
      // install を壊す。キットの規定位置は展開ルート、または zip が単一トップディレクトリを
      // 持つ場合のその直下だけとし、JSON として読めても kind !== kit なら完全に素通りする。
      let manifestPath = path.join(destDir, 'manifest.json');
      if (!existsSync(manifestPath)) {
        const rootEntries = readdirSync(destDir, { withFileTypes: true });
        manifestPath = rootEntries.length === 1 && rootEntries[0].isDirectory()
          ? path.join(destDir, rootEntries[0].name, 'manifest.json')
          : null;
        if (manifestPath && !existsSync(manifestPath)) manifestPath = null;
      }
      let manifest = null;
      if (manifestPath) {
        try {
          manifest = readKitManifest(path.dirname(manifestPath));
        } catch {
          log(cliText('cli.store.install.kitValidationFailed'));
          return { exitCode: 1 };
        }
      }
      if (manifest?.kind === 'kit') {
        const kitDir = path.dirname(manifestPath);
        const home = resolveAkariHome(env);
        const launcherAssets = options.assets ?? resolveLauncherAssets();
        const validator = launcherAssets.schemasSourceDir
          ? path.join(launcherAssets.schemasSourceDir, 'bin', 'validate-kit-manifest.mjs')
          : null;
        if (validator && existsSync(validator)) {
          const validateArgs = [validator, kitDir];
          if (launcherAssets.skillsSourceDir) validateArgs.push('--public-skills', launcherAssets.skillsSourceDir);
          const validation = (options.spawnSync ?? spawnSync)(process.execPath, validateArgs, { stdio: 'pipe' });
          if (validation.status !== 0) {
            log(cliText('cli.store.install.kitValidationFailed'));
            return { exitCode: 1 };
          }
        } else {
          // npm 配布物には schemas の検査 bin が無い場合がある。runtime と同じく、
          // 器の欠落で購入済みコンテンツを利用不能にしないため warning へ degrade する。
          log(cliText('cli.store.install.kitValidatorMissing'));
        }
        const requirementWarnings = [];
        let runtimeIds;
        const runtimePath = path.join(launcherAssets.repoRoot, 'packages', 'overlay-runtime', 'runtimes.mjs');
        if (existsSync(runtimePath)) {
          try {
            const runtimeModule = await import(pathToFileURL(runtimePath).href);
            runtimeIds = runtimeModule.runtimes.map((runtime) => runtime.id);
          } catch {
            runtimeIds = null;
          }
        }
        if (!runtimeIds) {
          // 通常の launcher 配布には overlay-runtime が入る。旧配布物や破損した
          // 配置で照合不能なら warning に落とし、要求 id を既知扱いして続行する。
          requirementWarnings.push(cliText('cli.store.install.runtimeRegistryMissing'));
          runtimeIds = manifest.requires?.runtimes ?? [];
        }
        let entitledProductIds = [];
        const credentials = readCredentials(env);
        if (credentials) {
          const entitlementResult = await fetchStoreEntitlements(fetchImpl, credentials.url, credentials.token);
          entitledProductIds = (entitlementResult.data?.entitlements ?? [])
            .map((entry) => entry.product_id ?? entry.id)
            .filter(Boolean);
        }
        const requires = checkRequires(manifest, {
          cliVersion: options.cliVersion ?? readOwnVersion(),
          runtimeIds,
          entitledProductIds
        });
        if (manifest.id !== productId) requires.blockers.push(cliText('cli.store.install.manifestMismatch', { manifestId: manifest.id, productId }));
        requires.ok = requires.blockers.length === 0;
        for (const warning of [...requirementWarnings, ...requires.warnings]) log(cliText('cli.store.install.warning', { warning }));
        if (!requires.ok) {
          for (const blocker of requires.blockers) log(cliText('cli.store.install.blocked', { blocker }));
          return { exitCode: 1 };
        }

        const hadSkillKit = readKitsLedger(home).kits.some(kit => Array.isArray(kit.skills) && kit.skills.length > 0);
        const assetLinks = linkKitAssets(kitDir, manifest, home, {
          env,
          assets: options.assets,
          spawnSyncImpl: options.spawnSync,
          platform: options.platform
        });
        const skillLinks = linkKitSkills(kitDir, manifest, home, { platform: options.platform });
        for (const warning of [...assetLinks.warnings, ...skillLinks.warnings]) log(cliText('cli.store.install.warning', { warning }));
        if (skillLinks.blockers.length > 0) {
          for (const blocker of skillLinks.blockers) log(cliText('cli.store.install.blocked', { blocker }));
          return { exitCode: 1 };
        }
        const playbookLinks = linkKitPlaybooks(kitDir, manifest, home, { platform: options.platform });
        for (const warning of playbookLinks.warnings) log(cliText('cli.store.install.warning', { warning }));
        registerKitAssets(home, manifest, kitDir, assetLinks.items, env);
        writeKitsLedger(home, {
          id: manifest.id,
          version: manifest.version,
          installedAt: new Date().toISOString(),
          kitDir,
          skills: skillLinks.linked,
          playbooks: playbookLinks.linked,
          assets: assetLinks.linked
        });
        ensureKitsMarketplace(home);
        if (skillLinks.linked.length > 0 && !hadSkillKit) log(enableHint());
      }
      const packPath = findFile(destDir, 'PACK.json');
      if (packPath) {
        const items = registerInstalledPack(env, productId, packPath);
        log(cliText('cli.store.install.assetsRegistered', { count: items.length, n: items.length }));
        if (items[0]) log(cliText('cli.store.install.nextStep', { id: items[0].id }));
      }
      return { exitCode: 0 };
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }

  if (sub === 'disconnect') {
    if (removeCredentials(env)) {
      log(cliText('cli.store.disconnect.complete'));
    } else {
      log(cliText('cli.store.disconnect.notConnected'));
    }
    return { exitCode: 0 };
  }

  for (const name of ['usage', 'connect', 'status', 'install', 'uninstall', 'download', 'disconnect']) {
    log(cliText(`cli.store.help.${name}`));
  }
  return { exitCode: sub ? 1 : 0 };
}
