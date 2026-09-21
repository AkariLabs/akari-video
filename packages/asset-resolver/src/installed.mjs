// `akari store install` が書くローカル導入索引を、カタログ item の形へ変換する。

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';

export const INSTALLED_ASSETS_SCHEMA = 'akari-installed-assets/v0';

export function installedAssetsPath(env = process.env) {
  return path.join(resolveAssetLibraryRoots(env).write, 'installed.json');
}

function localPathWithin(root, ...parts) {
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, ...parts);
  if (candidate !== absoluteRoot && !candidate.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`導入済み素材のパスがパック外を指しています: ${parts.join('/')}`);
  }
  return candidate;
}

function isSafePathSegment(value) {
  return typeof value === 'string' && value.length > 0
    && value !== '.' && value !== '..'
    && !value.includes('/') && !value.includes('\\');
}

function categoryFromItemPath(itemPath) {
  const segments = itemPath.replaceAll('\\', '/').split('/').filter(Boolean);
  return segments[0] === 'assets' && isSafePathSegment(segments[1]) ? segments[1] : 'pack';
}

function catalogItem(packId, pack, item) {
  if (!item || !isSafePathSegment(item.id)
    || typeof item.title !== 'string' || !item.title
    || typeof item.path !== 'string' || !item.path
    || item.version === undefined || item.version === null) {
    throw new Error(`導入済み素材索引に不正な item があります: ${packId}`);
  }
  if (!Array.isArray(item.files) || item.files.length === 0) {
    throw new Error(`導入済み素材索引の item に files[] がありません: ${item.id}`);
  }
  const itemRoots = (pack.readRoots ?? [pack.root]).map(root => localPathWithin(root, item.path));

  return {
    id: item.id,
    title: item.title,
    category: categoryFromItemPath(item.path),
    version: item.version,
    price: 0,
    source: 'installed',
    files: item.files.map((file) => {
      if (!file || typeof file.path !== 'string' || !file.path
        || !Number.isInteger(file.bytes) || file.bytes < 0
        || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        throw new Error(`導入済み素材索引の files[] が不正です: ${item.id}`);
      }
      return {
        name: file.path,
        local_path: itemRoots.map(root => localPathWithin(root, file.path)).find(existsSync)
          ?? localPathWithin(itemRoots[0], file.path),
        sha256: file.sha256,
        bytes: file.bytes,
      };
    }),
  };
}

/** installed.json が無ければ空配列、壊れていれば明示エラーを返す。 */
export async function loadInstalledItems(env = process.env) {
  const roots = resolveAssetLibraryRoots(env).read;
  const byId = new Map();
  for (const libraryRoot of [...roots].reverse()) {
    const indexPath = path.join(libraryRoot, 'installed.json');
    let index;
    try {
      index = JSON.parse(await readFile(indexPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error(`導入済み素材索引を読めません: ${indexPath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (index?.schema !== INSTALLED_ASSETS_SCHEMA
      || !index.packs || typeof index.packs !== 'object' || Array.isArray(index.packs)) {
      throw new Error(`導入済み素材索引の形式が想定と違います: ${indexPath}`);
    }

    for (const [packId, pack] of Object.entries(index.packs)) {
      if (!isSafePathSegment(packId)
        || !pack || typeof pack.root !== 'string' || !path.isAbsolute(pack.root)
        || (typeof pack.version !== 'string' && typeof pack.version !== 'number')
        || typeof pack.installedAt !== 'string' || !pack.installedAt
        || !Array.isArray(pack.items)) {
        throw new Error(`導入済み素材索引に不正な pack があります: ${packId}`);
      }
      const originalRoot = roots.find(root => {
        try { localPathWithin(path.join(root, 'store', packId), pack.root); return true; } catch { return false; }
      });
      if (!originalRoot) throw new Error(`導入済み素材の root がパック外を指しています: ${pack.root}`);
      const relativeRoot = path.relative(originalRoot, pack.root);
      const readablePack = { ...pack, readRoots: roots.map(root => path.join(root, relativeRoot)) };
      for (const item of pack.items) {
        const normalized = catalogItem(packId, readablePack, item);
        byId.set(normalized.id, normalized);
      }
    }
  }
  return [...byId.values()];
}

/** 同じ id は installed item で置換し、ローカルだけの item は末尾へ足す。 */
export function mergeInstalledItems(catalog, installedItems) {
  const items = [...catalog.items];
  const positions = new Map(items.map((item, index) => [item.id, index]));
  for (const item of installedItems) {
    const position = positions.get(item.id);
    if (position === undefined) {
      positions.set(item.id, items.length);
      items.push(item);
    } else {
      items[position] = item;
    }
  }
  return { ...catalog, items };
}
