// Synchronous counterpart of shell-reference.mjs's resolveProjectAssetPath.
// It additionally confines library files to the ledger entry's id directory,
// matching the app's asset boundary.
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';
import { resolveLibraryFallback } from './project-references.mjs';

const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export function declaredProjectAssetPath(declaredPath) {
  if (typeof declaredPath !== 'string' || !declaredPath) throw new Error('素材パスがプロジェクトの外を指しています');
  const normalized = declaredPath.replaceAll('\\', '/');
  if (path.isAbsolute(normalized) || path.win32.isAbsolute(normalized)
      || normalized.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('素材パスがプロジェクトの外を指しています');
  }
  return normalized;
}

function readReferencesSync(projectDir) {
  // Sync counterpart of readProjectReferences: generation adapters resolve media synchronously.
  try {
    const value = JSON.parse(readFileSync(path.join(projectDir, '.akari', 'asset-references.json'), 'utf8'));
    return value?.version === 0 && Array.isArray(value.references) ? value.references : [];
  } catch { return []; }
}

/** Synchronous counterpart of resolveProjectAssetPath for generation adapters. */
export function resolveProjectAssetPathSync(project, declaredPath, env = process.env) {
  const normalized = declaredProjectAssetPath(declaredPath);
  const root = realpathSync(project);
  const local = path.resolve(root, normalized);
  if (!within(root, local)) throw new Error('素材パスがプロジェクトの外を指しています');

  // Match shell-reference: an invalid local entry must not fall through to the library.
  let exists = false;
  try { lstatSync(local); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let ancestor = path.dirname(local);
  while (within(root, ancestor)) {
    try {
      if (!within(root, realpathSync(ancestor))) throw new Error('素材パスがプロジェクトの外を指しています');
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    ancestor = path.dirname(ancestor);
  }
  if (exists) {
    const actual = realpathSync(local);
    if (!within(root, actual)) throw new Error('素材パスがプロジェクトの外を指しています');
    return statSync(actual).isFile() ? actual : null;
  }

  const references = readReferencesSync(root);
  const segments = normalized.split('/');
  for (const akariAssetsDir of resolveAssetLibraryRoots(env).read) {
    const found = resolveLibraryFallback({ declaredPath: normalized, references, akariAssetsDir });
    if (!found) continue;
    // The referenced asset's id directory is the containment boundary.
    const idDirectory = path.join(realpathSync(akariAssetsDir), segments[1], segments[2]);
    if (within(idDirectory, found)) return found;
  }
  return null;
}
