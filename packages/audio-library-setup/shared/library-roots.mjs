import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';

export function audioReadRoots(libraryRoot, env = process.env) {
  const roots = resolveAssetLibraryRoots(env);
  return path.resolve(libraryRoot) === path.join(roots.write, 'audio')
    ? roots.read.map(root => path.join(root, 'audio')) : [libraryRoot];
}
export function audioReadPath(libraryRoot, ...parts) {
  return audioReadRoots(libraryRoot).map(root => path.join(root, ...parts)).find(existsSync)
    ?? path.join(libraryRoot, ...parts);
}
export function audioDirectories(libraryRoot) {
  const entries = new Map();
  for (const root of audioReadRoots(libraryRoot)) {
    let children;
    try { children = readdirSync(root, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of children) if (!entries.has(entry.name)) entries.set(entry.name, { entry, root });
  }
  return [...entries.values()];
}
export function readAudioDeclarations(libraryRoot) {
  const result = {};
  for (const root of audioReadRoots(libraryRoot).reverse()) {
    try {
      const data = JSON.parse(readFileSync(path.join(root, 'declarations.json'), 'utf8'));
      if (data && typeof data === 'object' && !Array.isArray(data)) Object.assign(result, data);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return result;
}
