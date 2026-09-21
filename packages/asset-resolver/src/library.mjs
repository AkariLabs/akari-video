// Library writes have one destination; reads also cover the previous location.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';

function roots(env) {
  return resolveAssetLibraryRoots(typeof env === 'string' ? { AKARI_HOME: env } : env);
}
export function localAssetDir(env, category, id) {
  return path.join(roots(env).write, category, id);
}
export function cachedAssetDir(env, category, id) {
  for (const root of roots(env).read) {
    const dir = path.join(root, category, id);
    try { if (statSync(dir).isDirectory() && readdirSync(dir).length) return dir; } catch { /* next root */ }
  }
  return null;
}
export function isAssetCached(env, category, id) {
  return cachedAssetDir(env, category, id) !== null;
}
export function scanLocalLibrary(env) {
  const installed = new Set();
  for (const root of roots(env).read) {
    let categories;
    try { categories = readdirSync(root); } catch { continue; }
    for (const category of categories) {
      let ids;
      try { ids = readdirSync(path.join(root, category)); } catch { continue; }
      for (const id of ids) if (isAssetCached(env, category, id)) installed.add(`${category}/${id}`);
    }
  }
  return installed;
}
