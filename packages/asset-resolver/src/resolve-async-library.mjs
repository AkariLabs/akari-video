import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';
import { assetTier } from './tier.mjs';
import { loadCatalog, readCatalogCache } from './catalog.mjs';
import { mergeInstalledItems, INSTALLED_ASSETS_SCHEMA } from './installed.mjs';
import { resolveCatalogSource } from './env.mjs';

export async function cachedAssetDirAsync(env, category, id) {
  for (const root of resolveAssetLibraryRoots(env).read) {
    const dir = path.resolve(root, category, id);
    try {
      if ((await stat(dir)).isDirectory() && (await readdir(dir)).length) return dir;
    } catch { /* next root */ }
  }
  return null;
}

const safe = value => typeof value === 'string' && value.length > 0
  && value !== '.' && value !== '..' && !/[\\/]/.test(value);

function within(root, ...parts) {
  const base = path.resolve(root);
  const candidate = path.resolve(base, ...parts);
  if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) {
    throw new Error(`導入済み素材のパスがパック外を指しています: ${parts.join('/')}`);
  }
  return candidate;
}

async function installedItemsAsync(env) {
  const roots = resolveAssetLibraryRoots(env).read;
  const byId = new Map();
  for (const libraryRoot of [...roots].reverse()) {
    const indexPath = path.join(libraryRoot, 'installed.json');
    let index;
    try { index = JSON.parse(await readFile(indexPath, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error(`導入済み素材索引を読めません: ${indexPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (index?.schema !== INSTALLED_ASSETS_SCHEMA
        || !index.packs || typeof index.packs !== 'object' || Array.isArray(index.packs)) {
      throw new Error(`導入済み素材索引の形式が想定と違います: ${indexPath}`);
    }
    for (const [packId, pack] of Object.entries(index.packs)) {
      if (!safe(packId) || !pack || typeof pack.root !== 'string' || !path.isAbsolute(pack.root)
          || (typeof pack.version !== 'string' && typeof pack.version !== 'number')
          || typeof pack.installedAt !== 'string' || !pack.installedAt || !Array.isArray(pack.items)) {
        throw new Error(`導入済み素材索引に不正な pack があります: ${packId}`);
      }
      const originalRoot = roots.find(root => {
        try { within(path.join(root, 'store', packId), pack.root); return true; } catch { return false; }
      });
      if (!originalRoot) throw new Error(`導入済み素材の root がパック外を指しています: ${pack.root}`);
      const relativeRoot = path.relative(originalRoot, pack.root);
      const readRoots = roots.map(root => path.join(root, relativeRoot));
      for (const item of pack.items) {
        if (!item || !safe(item.id) || typeof item.title !== 'string' || !item.title
            || typeof item.path !== 'string' || !item.path || item.version == null) {
          throw new Error(`導入済み素材索引に不正な item があります: ${packId}`);
        }
        if (!Array.isArray(item.files) || item.files.length === 0) {
          throw new Error(`導入済み素材索引の item に files[] がありません: ${item.id}`);
        }
        const itemRoots = readRoots.map(root => within(root, item.path));
        let metaTier;
        for (const root of itemRoots) {
          try {
            const meta = JSON.parse(await readFile(path.join(root, 'meta.json'), 'utf8'));
            if (Object.hasOwn(meta, 'tier') || Object.hasOwn(meta, 'price')) metaTier = assetTier(meta);
            break;
          } catch (error) { if (error?.code !== 'ENOENT') break; }
        }
        const categoryParts = item.path.replaceAll('\\', '/').split('/').filter(Boolean);
        const category = categoryParts[0] === 'assets' && safe(categoryParts[1]) ? categoryParts[1] : 'pack';
        const files = await Promise.all(item.files.map(async file => {
          if (!file || typeof file.path !== 'string' || !file.path
              || !Number.isInteger(file.bytes) || file.bytes < 0
              || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
            throw new Error(`導入済み素材索引の files[] が不正です: ${item.id}`);
          }
          const candidates = itemRoots.map(root => within(root, file.path));
          let localPath = candidates[0];
          for (const candidate of candidates) {
            if (await stat(candidate).then(() => true, () => false)) { localPath = candidate; break; }
          }
          return { name: file.path, local_path: localPath, sha256: file.sha256, bytes: file.bytes };
        }));
        byId.set(item.id, { id: item.id, title: item.title, category, version: item.version,
          price: 0, ...((Object.hasOwn(item, 'tier') ? assetTier(item) : metaTier)
            ? { tier: Object.hasOwn(item, 'tier') ? assetTier(item) : metaTier } : {}),
          source: 'installed', files });
      }
    }
  }
  return [...byId.values()];
}

export async function loadCatalogForResolveAsync(ref, { env = process.env, fetchImpl = fetch, timeouts } = {}) {
  const matches = typeof ref === 'string' && ref.includes('/')
    ? item => `${item.category}/${item.id}` === ref : item => item.id === ref;
  const installedItems = await installedItemsAsync(env);
  if (installedItems.some(matches)) {
    return { schema: 'akari-assets-catalog/v0', version: null, base: null, items: installedItems };
  }
  if (resolveCatalogSource(env).kind === 'url') {
    const cached = await readCatalogCache(env);
    if (cached && cached.items.some(matches)) return mergeInstalledItems(cached, installedItems);
  }
  const catalog = await loadCatalog({ env, fetchImpl, timeouts, fallbackToCache: false, includeInstalled: false });
  return mergeInstalledItems(catalog, installedItems);
}
