// Library writes have one destination; reads also cover the previous location.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';

export const ASSET_CATEGORIES = ['overlay', 'still', 'scene3d', 'audio', 'broll', 'font'];
function roots(env) {
  return resolveAssetLibraryRoots(typeof env === 'string' ? { AKARI_HOME: env } : env);
}
export function localAssetDir(env, category, id) {
  return path.join(roots(env).write, category, id);
}
export function cachedAssetDir(env, category, id) {
  for (const root of roots(env).read) {
    const dir = path.resolve(root, category, id);
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
    for (const category of ASSET_CATEGORIES) {
      let ids;
      try { ids = readdirSync(path.join(root, category)); } catch { continue; }
      for (const id of ids) if (!id.startsWith('.') && isAssetCached(env, category, id)) installed.add(`${category}/${id}`);
    }
  }
  return installed;
}

export function sourceFields(item, inCatalog = false) {
  const allTags = Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string') : [];
  const machine = tag => /^(origin:|site:|folder:|pack:)/.test(tag) || tag === 'license:subscription';
  const value = prefix => allTags.find(tag => tag.startsWith(prefix))?.slice(prefix.length) ?? null;
  return {
    sourceKind: inCatalog ? 'lab' : allTags.includes('origin:site') ? 'site'
      : allTags.includes('origin:own') ? 'own' : item.source?.url ? 'site' : 'own',
    tags: allTags.filter(tag => !machine(tag)), machineTags: allTags.filter(machine),
    folder: value('folder:'), site: value('site:'), subscription: allTags.includes('license:subscription'),
    creditText: item.creditText ?? null,
  };
}

// Same unique, immediate-child rule as shell resolveLibraryAssetMedia. Do not pick
// an arbitrary take when a meta.json asset contains several media files.
export function primaryMediaFile(category, files) {
  const patterns = {
    audio: /\.(wav|mp3|m4a|aac|flac|ogg|aif|aiff)$/i,
    broll: /\.(mp4|mov|m4v|webm|mkv|avi)$/i,
    still: /\.(png|jpg|jpeg|gif|webp|svg)$/i,
    font: /\.(ttf|otf|woff|woff2)$/i, scene3d: /\.(glb|gltf)$/i,
  };
  const candidates = files.filter(file => !file.name.includes('/') && patterns[category]?.test(file.name)
    && (category !== 'still' || file.name.toLowerCase() !== 'preview.png'));
  return candidates.length === 1 ? candidates[0].name : null;
}

/** Read actual files, never a stale files[] declaration in metadata. */
export function readLocalLibraryItem(env, category, id) {
  const libraryDir = cachedAssetDir(env, category, id);
  if (!libraryDir) return null;
  const warnings = [];
  let meta = {};
  try {
    const parsed = JSON.parse(readFileSync(path.join(libraryDir, 'meta.json'), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || typeof parsed.title !== 'string' || !parsed.title.trim()
      || parsed.category !== category || parsed.id !== id
      || !Array.isArray(parsed.tags) || parsed.tags.some(tag => typeof tag !== 'string')
      || !parsed.license || typeof parsed.license !== 'object') throw new Error('invalid display metadata');
    meta = parsed;
  } catch (error) { warnings.push(`meta.json: ${error.message}`); }
  const files = [];
  function walk(dir, prefix = '') {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), `${name}/`);
        else if (entry.isFile()) {
          try { files.push({ name, bytes: statSync(path.join(dir, entry.name)).size }); }
          catch (error) { warnings.push(`${name}: ${error.message}`); }
        }
      }
    } catch (error) { warnings.push(`files: ${error.message}`); }
  }
  walk(libraryDir);
  let creditText = null;
  try { creditText = readFileSync(path.join(libraryDir, 'CREDIT.txt'), 'utf8').split(/\r?\n/)[0].trim() || null; }
  catch (error) { if (error.code !== 'ENOENT') warnings.push(`CREDIT.txt: ${error.message}`); }
  const info = statSync(libraryDir);
  return {
    ...meta, id, category: meta.category ?? category, title: meta.title ?? id, tags: meta.tags ?? [],
    files, preview: files.some(file => file.name === 'preview.png') ? 'preview.png' : null,
    mediaFile: primaryMediaFile(category, files), libraryDir,
    addedAt: new Date(info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs).toISOString(),
    creditText, warnings, state: 'cached',
  };
}
