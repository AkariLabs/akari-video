// Puppeteer / Chrome-for-Testing の起動共通処理。
//
// パッケージ追加インストール禁止のため、既存インストール済みの puppeteer を
// createRequire で再利用する（原型 render-v3.mjs / qa-capture-v3.mjs と同じ方式）。
// マシン固有の絶対パスをテンプレ本体に持ち込まないため、解決順は:
//   1. 環境変数 KAISETSU_PUPPETEER_PKG（puppeteer が見つかる package.json への絶対パス）
//   2. テンプレの設置位置（このファイル）から上方向に node_modules/puppeteer を探索
//      （公開リポにテンプレを同梱すれば、リポ直下の node_modules がそのまま見つかる想定）
//   3. どちらも見つからなければ、原因と対処法が分かるエラーメッセージで停止
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function findAncestorWithPuppeteer(startDir) {
  let dir = startDir;
  for (;;) {
    if (existsSync(path.join(dir, "node_modules", "puppeteer"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // ファイルシステムルートに到達
    dir = parent;
  }
}

export async function loadPuppeteer() {
  const envPkg = process.env.KAISETSU_PUPPETEER_PKG;
  if (envPkg) {
    const resolved = path.resolve(envPkg);
    if (!existsSync(resolved)) {
      throw new Error(`KAISETSU_PUPPETEER_PKG が指すファイルが存在しない: ${resolved}`);
    }
    return createRequire(resolved)("puppeteer");
  }

  const ancestor = await findAncestorWithPuppeteer(__dirname);
  if (ancestor) {
    return createRequire(path.join(ancestor, "package.json"))("puppeteer");
  }

  throw new Error(
    "puppeteer が見つからない。次のいずれかで解決してください:\n" +
    "  (1) 環境変数 KAISETSU_PUPPETEER_PKG に puppeteer がインストール済みの " +
    "package.json への絶対パスを設定する\n" +
    "  (2) このテンプレート（" + __dirname + " 配下）より上位のディレクトリに " +
    "node_modules/puppeteer をインストールする\n" +
    "（パッケージの新規インストールは本テンプレートの境界規則で禁止 — 既存インストール先を指定すること）",
  );
}

export async function findChromeExecutable(puppeteer) {
  const pinned = await puppeteer.executablePath();
  if (existsSync(pinned)) return pinned;
  const cacheRoot = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
  const entries = await readdir(cacheRoot).catch(() => []);
  const candidates = entries.filter((e) => e.startsWith("mac_arm-") || e.startsWith("mac-"));
  candidates.sort().reverse();
  for (const dir of candidates) {
    const exe = path.join(
      cacheRoot, dir, "chrome-mac-arm64", "Google Chrome for Testing.app",
      "Contents", "MacOS", "Google Chrome for Testing",
    );
    if (existsSync(exe)) return exe;
  }
  throw new Error("No usable Chrome-for-Testing binary found under " + cacheRoot);
}

export const LAUNCH_ARGS = [
  "--no-sandbox", "--disable-gpu", "--enable-unsafe-swiftshader",
  "--use-angle=swiftshader", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check", "--force-color-profile=srgb",
];

export async function launchBrowser(puppeteer, chromePath) {
  return puppeteer.launch({ headless: true, executablePath: chromePath, args: LAUNCH_ARGS });
}
