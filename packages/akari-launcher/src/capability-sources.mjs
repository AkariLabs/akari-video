import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export function discoverCheckoutCapabilitySources(repoRoot, {
  trackedFiles = null,
  includeBinTargets = true,
} = {}) {
  const root = realpathSync(resolve(repoRoot));
  const tracked = trackedFiles ?? execFileSync("git", ["-C", root, "ls-files", "-z"], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf8").split("\0").filter(Boolean);
  const trackedSet = new Set(tracked);
  const selected = new Set(tracked.filter(isBaseCapabilitySource));
  const manifests = [...selected].filter((path) => /^packages\/[^/]+\/package\.json$/u.test(path)).sort(compare);
  for (const manifestPath of manifests) {
    const manifest = parseManifest(join(root, manifestPath), manifestPath);
    const packageRoot = dirname(manifestPath);
    for (const target of manifestBinTargets(manifest)) {
      if (typeof target !== "string" || target.trim() === "") {
        throw new Error(`${manifestPath} has an invalid package.json#bin target`);
      }
      const canonical = normalizeRelative(join(packageRoot, target));
      if (!isWithinRelative(packageRoot, canonical)) {
        throw new Error(`${manifestPath} package.json#bin escapes its package root: ${target}`);
      }
      if (!trackedSet.has(canonical)) {
        throw new Error(`${manifestPath} package.json#bin target is not tracked: ${canonical}`);
      }
      assertRegularContainedFile(root, canonical, `${manifestPath} package.json#bin`);
      if (includeBinTargets) selected.add(canonical);
    }
  }
  const paths = [...selected].sort(compare);
  for (const path of paths) assertRegularContainedFile(root, path, "capability source");
  return paths;
}

export function loadVendoredCapabilitySources(packageRoot) {
  const root = realpathSync(resolve(packageRoot));
  const manifestPath = join(root, "vendor", ".akari-capability-sources.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`vendored capability manifest is unavailable: ${messageOf(error)}`);
  }
  if (manifest?.version !== 1 || !Array.isArray(manifest.sources)) {
    throw new Error("vendored capability manifest has an unsupported shape");
  }
  const paths = [...manifest.sources];
  if (paths.some((path) => typeof path !== "string") || JSON.stringify(paths) !== JSON.stringify([...paths].sort(compare))) {
    throw new Error("vendored capability manifest source list is not sorted strings");
  }
  if (new Set(paths).size !== paths.length) throw new Error("vendored capability manifest contains duplicate sources");
  for (const path of paths) assertRegularContainedFile(join(root, "vendor"), path, "vendored capability source");
  return paths;
}

export function isCheckoutRepoRoot(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim() === realpathSync(root);
  } catch {
    return false;
  }
}

export function isBaseCapabilitySource(path) {
  return /^skills\/.+\.md$/u.test(path)
    || /^docs\/contract-[^/]+\.md$/u.test(path)
    || /^packages\/[^/]+\/README[^/]*\.md$/u.test(path)
    || /^packages\/[^/]+\/package\.json$/u.test(path);
}

export function manifestBinTargets(manifest) {
  if (typeof manifest?.bin === "string") return [manifest.bin];
  if (manifest?.bin && typeof manifest.bin === "object" && !Array.isArray(manifest.bin)) {
    return Object.keys(manifest.bin).sort(compare).map((key) => manifest.bin[key]);
  }
  return [];
}

function parseManifest(path, label) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("root must be an object");
    return value;
  } catch (error) {
    throw new Error(`${label} is not a valid package manifest: ${messageOf(error)}`);
  }
}

function assertRegularContainedFile(root, canonical, label) {
  if (typeof canonical !== "string" || canonical === "" || isAbsolute(canonical) || canonical.split(/[\\/]/u).includes("..")) {
    throw new Error(`${label} path is unsafe: ${String(canonical)}`);
  }
  const lexical = resolve(root, canonical);
  if (!existsSync(lexical)) throw new Error(`${label} does not exist: ${canonical}`);
  const actual = realpathSync(lexical);
  if (!isWithin(root, actual) || !lstatSync(lexical).isFile()) {
    throw new Error(`${label} is not a regular contained file: ${canonical}`);
  }
}

function normalizeRelative(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function isWithinRelative(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function isWithin(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function compare(left, right) {
  return left.localeCompare(right, "en");
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
