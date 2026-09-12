// install-root — スキルのコピー先から AKARI Video の同梱物（packages/・media-bin/）を探す。
//
// このスキルはプロジェクトへ **コピー** される（packages/project-scaffold の copySkillsTree →
// <project>/.claude/skills/compile-review-session/）。したがって「自分の位置からの相対パス」は
// モノレポ checkout でしか成立せず、プロジェクト内のコピーからは packages/edit-store（v2 snapshot の
// 互換射影）も同梱 whisper-cli も見つからない（issue #70 / #72 の実体）。ここでは
// skills/manage-connections/bin/resolve-packages.mjs と同じ探索順に、デスクトップ版の Resources
// （`~/.akari/cli/bin` の shim が指す akari.mjs から逆算）を加えて候補ルートを列挙する。
//
// 探索順:
//   1. 自身の実体位置（realpath）から上方探索 — checkout / npm vendor / app Resources のどれでも当たる
//   2. AKARI_MONOREPO / AKARI_INSTALL_DIR
//   3. CLI インストール既定の ~/.akari/app
//   4. デスクトップ版: ~/.akari/cli/bin の shim（cli-provisioner が生成）に焼かれた
//      <Resources>/packages/akari-launcher/bin/akari.mjs から <Resources> と
//      <Resources>/packages/akari-launcher/vendor を導く
import { readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAUNCHER_ENTRY_PATTERN = /"([^"\r\n]*[\\/]packages[\\/]akari-launcher[\\/]bin[\\/]akari\.mjs)"/g;

function startDirectory(from) {
  const value = from instanceof URL || String(from).startsWith("file:")
    ? fileURLToPath(from)
    : path.resolve(String(from));
  let real = value;
  try {
    real = realpathSync(value);
  } catch {
    // 実体が無い位置（テストの仮想パス等）は与えられたまま扱う。
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

/** shim ファイルに焼かれた akari.mjs のパスから、デスクトップ版の Resources ルートを返す。 */
export function resourcesRootsFromShim(shimText) {
  const roots = [];
  for (const match of String(shimText ?? "").matchAll(LAUNCHER_ENTRY_PATTERN)) {
    // Windows の shim（akari.cmd）は区切りが backslash。実行中の OS に関わらず表記どおりに畳む。
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

/**
 * 候補ルートを優先順に返す（存在確認はしない — 診断表示にも使うため）。
 * @param {{ from?: string | URL, env?: NodeJS.ProcessEnv, homeDir?: string }} [options]
 */
export function candidateInstallRoots({ from = import.meta.url, env = process.env, homeDir = os.homedir() } = {}) {
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

/** `<root>/packages/<relative>` が実在する最初のパス。無ければ null。 */
export function resolvePackageFile(relative, options) {
  for (const root of candidateInstallRoots(options)) {
    const candidate = path.join(root, "packages", relative);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** 診断用: 上方探索の起点と、明示的な候補（env / ~/.akari/app / shim 由来）だけを短く並べる。 */
export function describeInstallSearch(options = {}) {
  const roots = candidateInstallRoots(options);
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const explicit = roots.filter((root) => (
    (env.AKARI_MONOREPO && root === path.resolve(env.AKARI_MONOREPO))
    || (env.AKARI_INSTALL_DIR && root === path.resolve(env.AKARI_INSTALL_DIR))
    || root === path.join(homeDir, ".akari", "app")
    || shimResourcesRoots(homeDir).some((resources) => root === resources || root === path.join(resources, "packages", "akari-launcher", "vendor"))
  ));
  return `上方探索の起点 ${roots[0]} / 明示候補 ${explicit.length > 0 ? explicit.join(", ") : "なし"}`
    + `（AKARI_MONOREPO / AKARI_INSTALL_DIR / ~/.akari/app / ~/.akari/cli/bin の shim が指す Resources）`;
}
