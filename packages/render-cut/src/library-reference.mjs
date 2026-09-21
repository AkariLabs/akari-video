import { lstatSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

// 参照台帳（.akari/asset-references.json）のスキーマ版数。edit.json の version とは無関係。
const REFERENCES_SCHEMA_VERSION = 0;

export function readProjectReferences(projectRoot) {
  try {
    const parsed = JSON.parse(readFileSync(
      join(projectRoot, ".akari", "asset-references.json"),
      "utf8",
    ));
    if (parsed?.version !== REFERENCES_SCHEMA_VERSION || !Array.isArray(parsed.references)) return [];
    return parsed.references.filter((entry) => entry !== null
      && typeof entry === "object"
      && !Array.isArray(entry)
      && typeof entry.id === "string"
      && entry.id.length > 0
      && typeof entry.category === "string"
      && entry.category.length > 0)
      .map((entry) => ({ id: entry.id, category: entry.category }));
  } catch {
    return [];
  }
}

// Mirrored from creator-root; keep both consumers covered by the same case table.
const LIBRARY_LOCATION_VERSION = 0;
export function resolveAssetLibraryRoots(env = process.env, { platform = process.platform } = {}) {
  const homeDir = platform === 'win32'
    ? env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : os.homedir())
    : env.HOME || os.homedir();
  const home = env.AKARI_HOME || join(homeDir, '.akari');
  const legacy = resolve(home, 'assets');
  let location;
  try {
    const parsed = JSON.parse(readFileSync(join(home, 'library-location.json'), 'utf8'));
    if (parsed?.version === LIBRARY_LOCATION_VERSION && typeof parsed.root === 'string'
      && isAbsolute(parsed.root) && ['pending', 'migrating', 'done', 'declined'].includes(parsed.state)) location = parsed;
  } catch { /* undecided */ }
  const write = env.AKARI_LIBRARY_ROOT ? resolve(env.AKARI_LIBRARY_ROOT)
    : location && ['migrating', 'done'].includes(location.state) ? resolve(location.root) : legacy;
  return { write, read: [...new Set([write, legacy])],
    source: env.AKARI_LIBRARY_ROOT ? 'env' : location && ['migrating', 'done'].includes(location.state) ? 'location' : 'legacy' };
}
export function resolveAkariAssetsDir(env = process.env) {
  return resolveAssetLibraryRoots(env).write;
}

function declaredAssetParts(projectRoot, declaredPath) {
  if (typeof declaredPath !== "string" || declaredPath.length === 0) return null;
  const rawSegments = declaredPath.replaceAll("\\", "/").split("/");
  if (rawSegments.some((segment) => segment === "." || segment === "..")) return null;
  const root = resolve(projectRoot);
  const lexical = isAbsolute(declaredPath) ? resolve(declaredPath) : resolve(root, declaredPath);
  if (!isWithin(root, lexical)) return null;
  const projectRelative = relative(root, lexical).replaceAll("\\", "/");
  const segments = projectRelative.split("/");
  if (segments.length < 4
      || segments[0] !== "assets"
      || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  return { category: segments[1], id: segments[2], rest: segments.slice(3) };
}

export function resolveLibraryFallback({
  projectRoot,
  declaredPath,
  references = readProjectReferences(projectRoot),
  akariAssetsDir,
  libraryRoots = akariAssetsDir ? [akariAssetsDir] : resolveAssetLibraryRoots().read,
}) {
  const parts = declaredAssetParts(projectRoot, declaredPath);
  if (!parts || !references.some(
    (entry) => entry.category === parts.category && entry.id === parts.id,
  )) return { matched: false, path: null, libraryRoot: null };

  for (const root of libraryRoots) {
    const lexicalRoot = resolve(root);
    const lexicalTarget = resolve(lexicalRoot, parts.category, parts.id, ...parts.rest);
    if (!isWithin(lexicalRoot, lexicalTarget)) continue;
    try {
      const actualRoot = realpathSync(lexicalRoot);
      const actualTarget = realpathSync(lexicalTarget);
      if (!isWithin(actualRoot, actualTarget) || !lstatSync(actualTarget).isFile()) continue;
      return { matched: true, path: actualTarget, libraryRoot: actualRoot };
    } catch { /* Try the previous location during migration. */ }
  }
  return { matched: true, path: null, libraryRoot: null };
}

function isWithin(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}
