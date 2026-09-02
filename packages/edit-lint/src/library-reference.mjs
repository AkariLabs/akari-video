import { lstatSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export function readProjectReferences(projectRoot) {
  try {
    const parsed = JSON.parse(readFileSync(
      join(projectRoot, ".akari", "asset-references.json"),
      "utf8",
    ));
    if (parsed?.version !== 0 || !Array.isArray(parsed.references)) return [];
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

export function resolveAkariAssetsDir(env = process.env) {
  return resolve(env.AKARI_HOME || join(os.homedir(), ".akari"), "assets");
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
  akariAssetsDir = resolveAkariAssetsDir(),
}) {
  const parts = declaredAssetParts(projectRoot, declaredPath);
  if (!parts || !references.some(
    (entry) => entry.category === parts.category && entry.id === parts.id,
  )) return { matched: false, path: null, libraryRoot: null };

  const lexicalRoot = resolve(akariAssetsDir);
  const lexicalTarget = resolve(lexicalRoot, parts.category, parts.id, ...parts.rest);
  if (!isWithin(lexicalRoot, lexicalTarget)) {
    return { matched: true, path: null, libraryRoot: null };
  }
  try {
    const actualRoot = realpathSync(lexicalRoot);
    const actualTarget = realpathSync(lexicalTarget);
    if (!isWithin(actualRoot, actualTarget) || !lstatSync(actualTarget).isFile()) {
      return { matched: true, path: null, libraryRoot: actualRoot };
    }
    return { matched: true, path: actualTarget, libraryRoot: actualRoot };
  } catch {
    return { matched: true, path: null, libraryRoot: null };
  }
}

function isWithin(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}
