// 同じ規則が compile-review-session/bin/core/install-root.mjs にもある。
// 変えるときは setup-chat-approval/bin/resolve-packages.mjs を含む全部を同時に直す。
import { readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SETUP_GUIDE = "セットアップするには次を実行してください: curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash";
const LAUNCHER_ENTRY_PATTERN = /"([^"\r\n]*[\\/]packages[\\/]akari-launcher[\\/]bin[\\/]akari\.mjs)"/g;

function startDirectory(from) {
  const value = from instanceof URL || String(from).startsWith("file:")
    ? fileURLToPath(from)
    : path.resolve(String(from));
  let real = value;
  try {
    real = realpathSync(value);
  } catch {
    // 実体が無い位置は与えられたまま扱う。
  }
  try {
    if (statSync(real).isDirectory()) return real;
  } catch {
    // ファイルまたは不在 → 親から探索する。
  }
  return path.dirname(real);
}

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resourcesRootsFromShim(shimText) {
  const roots = [];
  for (const match of String(shimText ?? "").matchAll(LAUNCHER_ENTRY_PATTERN)) {
    const impl = match[1].includes("\\") ? path.win32 : path;
    const resources = impl.resolve(impl.dirname(match[1]), "..", "..", "..");
    if (!roots.includes(resources)) roots.push(resources);
  }
  return roots;
}

function shimResourcesRoots(homeDir) {
  const shimDirectory = path.join(homeDir, ".akari", "cli", "bin");
  const roots = [];
  for (const name of ["akari", "akari.cmd"]) {
    const shimPath = path.join(shimDirectory, name);
    if (!isFile(shimPath)) continue;
    try {
      roots.push(...resourcesRootsFromShim(readFileSync(shimPath, "utf8")));
    } catch {
      // 読めない shim は無視する。
    }
  }
  return roots;
}

function candidateInstallRoots({ from = import.meta.url, env = process.env, homeDir = os.homedir() } = {}) {
  const roots = [];
  const push = (root) => {
    if (root && !roots.includes(root)) roots.push(root);
  };
  let directory = startDirectory(from);
  while (true) {
    push(directory);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  if (env.AKARI_MONOREPO) push(path.resolve(env.AKARI_MONOREPO));
  if (env.AKARI_INSTALL_DIR) push(path.resolve(env.AKARI_INSTALL_DIR));
  push(path.join(homeDir, ".akari", "app"));
  for (const resources of shimResourcesRoots(homeDir)) {
    push(resources);
    push(path.join(resources, "packages", "akari-launcher", "vendor"));
  }
  return roots;
}

function launcherVersion(root) {
  const launcher = root.endsWith(path.join("packages", "akari-launcher", "vendor"))
    ? path.join(root, "..", "package.json")
    : path.join(root, "packages", "akari-launcher", "package.json");
  try {
    const version = JSON.parse(readFileSync(launcher, "utf8")).version;
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(version);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null] : null;
  } catch {
    return null;
  }
}

function compareVersions(left, right) {
  if (!left) return right ? -1 : 0;
  if (!right) return 1;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  if (left[3] === right[3]) return 0;
  if (left[3] === null) return 1;
  if (right[3] === null) return -1;
  return left[3].localeCompare(right[3], undefined, { numeric: true });
}

export function resolvePackageFile(relative, { from = import.meta.url, env = process.env, homeDir = os.homedir() } = {}) {
  const roots = candidateInstallRoots({ from, env, homeDir });
  const priority = new Set();
  let directory = startDirectory(from);
  while (true) {
    priority.add(directory);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  if (env.AKARI_MONOREPO) priority.add(path.resolve(env.AKARI_MONOREPO));
  if (env.AKARI_INSTALL_DIR) priority.add(path.resolve(env.AKARI_INSTALL_DIR));
  const entries = roots.map((root, index) => ({
    root, index, file: path.join(root, "packages", relative),
  })).filter((entry) => isFile(entry.file));
  const preferred = entries.find((entry) => priority.has(entry.root));
  if (preferred) return preferred.file;
  entries.sort((left, right) => compareVersions(launcherVersion(right.root), launcherVersion(left.root)) || left.index - right.index);
  if (entries[0]) return entries[0].file;
  throw new Error(SETUP_GUIDE);
}

export async function importPackage(relative, options) {
  const absolutePath = resolvePackageFile(relative, options);
  return import(pathToFileURL(absolutePath).href);
}
