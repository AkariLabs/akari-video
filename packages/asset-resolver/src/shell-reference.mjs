// Thin shell entry point: keep the ledger and containment rules in project-references.
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';
import { readProjectReferences, resolveLibraryFallbackAsync } from './project-references.mjs';

const within = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

export async function resolveProjectAssetPath(project, declaredPath, env = process.env, context) {
  const normalized = declaredPath.replaceAll('\\', '/');
  if (path.isAbsolute(normalized) || normalized.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('素材パスがプロジェクトの外を指しています');
  }
  const root = context?.projectRoot ?? await realpath(project);
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
  const references = context?.references ?? await readProjectReferences(root);
  for (const akariAssetsDir of (context?.libraryRoots ?? resolveAssetLibraryRoots(env).read)) {
    const found = await resolveLibraryFallbackAsync({ declaredPath: normalized, references, akariAssetsDir,
      rootRealpaths: context?.rootRealpaths });
    if (found) return found;
  }
  return null;
}

/** Enumerate only ledger-authorized files, in library read order; no symlink traversal. */
export async function listProjectReferenceAssets(project, env = process.env, context) {
  const references = context?.references ?? await readProjectReferences(project);
  const libraryRoots = context?.libraryRoots ?? resolveAssetLibraryRoots(env).read;
  const rootRealpaths = context?.rootRealpaths ?? new Map();
  return Promise.all(references.map(async reference => {
    const files = new Map();
    let libraryDir;
    if ([reference.category, reference.id].some(value => !value || value === '.' || value === '..' || /[\\/]/.test(value))) {
      return { ...reference, files: [] };
    }
    for (const root of libraryRoots) {
      const directory = path.resolve(root, reference.category, reference.id);
      if (!within(path.resolve(root), directory)) continue;
      const lexicalRoot = path.resolve(root);
      let actualRoot = rootRealpaths.get(lexicalRoot);
      if (!actualRoot) {
        actualRoot = realpath(lexicalRoot);
        rootRealpaths.set(lexicalRoot, actualRoot);
      }
      try { if (!within(await actualRoot, await realpath(directory))) continue; } catch { continue; }
      const walk = async (dir, prefix = '') => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const name = prefix + entry.name;
          if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${name}/`);
          else {
            const absolute = await resolveLibraryFallbackAsync({
              declaredPath: `assets/${reference.category}/${reference.id}/${name}`, references, akariAssetsDir: root,
              rootRealpaths,
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
  const context = { projectRoot: await realpath(project), references: await readProjectReferences(project),
    libraryRoots: resolveAssetLibraryRoots(env).read, rootRealpaths: new Map() };
  for (const asset of await listProjectReferenceAssets(project, env, context)) {
    for (const file of asset.files) paths.add(`assets/${asset.category}/${asset.id}/${file.name}`);
  }
  const resolved = await Promise.all([...paths].map(async declared =>
    [declared, await resolveProjectAssetPath(project, declared, env, context)]));
  for (const [declared, actual] of resolved) {
    if (actual) uris[declared.replaceAll('\\', '/')] = pathToFileURL(actual).href;
  }
  return uris;
}
