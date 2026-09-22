// Thin shell entry point: keep the ledger and containment rules in project-references.
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';
import { readProjectReferences, resolveLibraryFallback } from './project-references.mjs';

const within = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

export async function resolveProjectAssetPath(project, declaredPath, env = process.env) {
  const normalized = declaredPath.replaceAll('\\', '/');
  if (path.isAbsolute(normalized) || normalized.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('素材パスがプロジェクトの外を指しています');
  }
  const root = await realpath(project);
  const local = path.resolve(root, normalized);
  if (!within(root, local)) throw new Error('素材パスがプロジェクトの外を指しています');
  // An existing local entry always wins, including a broken or escaping symlink:
  // never silently replace an invalid project entry with a library file.
  let exists = false;
  try { await lstat(local); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let ancestor = path.dirname(local);
  while (within(root, ancestor)) {
    try {
      if (!within(root, await realpath(ancestor))) throw new Error('素材パスがプロジェクトの外を指しています');
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    ancestor = path.dirname(ancestor);
  }
  if (exists) {
    const actual = await realpath(local);
    if (!within(root, actual)) throw new Error('素材パスがプロジェクトの外を指しています');
    return (await stat(actual)).isFile() ? actual : null;
  }
  const references = await readProjectReferences(root);
  for (const akariAssetsDir of resolveAssetLibraryRoots(env).read) {
    const found = resolveLibraryFallback({ declaredPath: normalized, references, akariAssetsDir });
    if (found) return found;
  }
  return null;
}

/** Enumerate only ledger-authorized files, in library read order; no symlink traversal. */
export async function listProjectReferenceAssets(project, env = process.env) {
  const references = await readProjectReferences(project);
  return Promise.all(references.map(async reference => {
    const files = new Map();
    let libraryDir;
    if ([reference.category, reference.id].some(value => !value || value === '.' || value === '..' || /[\\/]/.test(value))) {
      return { ...reference, files: [] };
    }
    for (const root of resolveAssetLibraryRoots(env).read) {
      const directory = path.resolve(root, reference.category, reference.id);
      if (!within(path.resolve(root), directory)) continue;
      try { if (!within(await realpath(root), await realpath(directory))) continue; } catch { continue; }
      const walk = async (dir, prefix = '') => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const name = prefix + entry.name;
          if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${name}/`);
          else {
            const absolute = resolveLibraryFallback({
              declaredPath: `assets/${reference.category}/${reference.id}/${name}`, references, akariAssetsDir: root,
            });
            if (absolute && !files.has(name)) {
              libraryDir ??= directory;
              files.set(name, { name, path: absolute, bytes: (await stat(absolute)).size });
            }
          }
        }
      };
      try { await walk(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return { ...reference, libraryDir, files: [...files.values()] };
  }));
}

/** Resolve before synchronous timeline rendering, including audio and thumbnail consumers. */
export async function projectReferenceMediaUris(project, env = process.env, declaredPaths = []) {
  const uris = {};
  const paths = new Set(declaredPaths);
  for (const asset of await listProjectReferenceAssets(project, env)) {
    for (const file of asset.files) paths.add(`assets/${asset.category}/${asset.id}/${file.name}`);
  }
  for (const declared of paths) {
    const actual = await resolveProjectAssetPath(project, declared, env);
    if (actual) uris[declared.replaceAll('\\', '/')] = pathToFileURL(actual).href;
  }
  return uris;
}
