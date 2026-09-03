import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SETUP_GUIDE = "セットアップするには次を実行してください: curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash";

function startDirectory(from) {
  const value = from instanceof URL || String(from).startsWith("file:")
    ? fileURLToPath(from)
    : path.resolve(String(from));
  try {
    if (statSync(value).isDirectory()) return value;
  } catch {
    // 存在しないファイル位置も呼び出し元として扱えるよう、親から探索する。
  }
  return path.dirname(value);
}

function packageFile(root, relative) {
  const candidate = path.resolve(root, "packages", relative);
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

export function resolvePackageFile(relative, { from = import.meta.url, env = process.env } = {}) {
  let directory = startDirectory(from);
  while (true) {
    const found = packageFile(directory, relative);
    if (found) return found;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  if (env.AKARI_MONOREPO) {
    const found = packageFile(path.resolve(env.AKARI_MONOREPO), relative);
    if (found) return found;
  }

  const installDirectory = env.AKARI_INSTALL_DIR
    ? path.resolve(env.AKARI_INSTALL_DIR)
    : path.join(homedir(), ".akari", "app");
  if (existsSync(installDirectory)) {
    const found = packageFile(installDirectory, relative);
    if (found) return found;
  }

  throw new Error(SETUP_GUIDE);
}

export async function importPackage(relative, options) {
  const absolutePath = resolvePackageFile(relative, options);
  return import(pathToFileURL(absolutePath).href);
}
