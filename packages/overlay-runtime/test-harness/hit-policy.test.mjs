// overlay-runtime の既存ブラウザハーネスを headless Chrome から実行し、
// document.body.dataset.testStatus が pass へ到達することを機械検証する。
// 実行: node --test packages/overlay-runtime/test-harness/hit-policy.test.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
function loadPuppeteer() {
  const roots = [resolve(HERE, "../../render-cut")];
  const gitFile = resolve(HERE, "../../../.git");
  // .git は git worktree では「gitdir: ...」を書いたファイル、通常の clone では
  // ディレクトリ。existsSync だけで通すと clone 側で readFileSync が EISDIR で落ちる。
  if (existsSync(gitFile) && statSync(gitFile).isFile()) {
    const gitDir = readFileSync(gitFile, "utf8").trim().replace(/^gitdir:\s*/, "");
    const marker = `${join(".git", "worktrees")}/`;
    const markerIndex = gitDir.indexOf(marker);
    if (markerIndex >= 0) {
      roots.push(join(gitDir.slice(0, markerIndex), "packages/render-cut"));
    }
  }

  for (const root of roots) {
    try {
      return createRequire(`${root}/`)("puppeteer-core");
    } catch {
      // worktree に依存が無い場合は、git common dir からメイン checkout を試す。
    }
  }
  throw new Error("puppeteer-core を解決できません");
}

function cachedChromeCandidates() {
  const root = join(homedir(), ".cache/puppeteer/chrome-headless-shell");
  if (!existsSync(root)) return [];
  const directories = (path) =>
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  return directories(root)
    .sort()
    .reverse()
    .flatMap((build) =>
      directories(join(root, build)).map((platform) =>
        join(root, build, platform, "chrome-headless-shell")
      )
    )
    .filter((candidate) => existsSync(candidate));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    ...cachedChromeCandidates(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const chrome = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!chrome) throw new Error("headless Chrome が見つかりません");
  return chrome;
}

test("data-akari-hit とルート素通しのブラウザハーネスが PASS する", async (t) => {
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "shell",
    pipe: true,
    args: [
      "--single-process",
      "--no-zygote",
      "--allow-file-access-from-files",
      "--disable-gpu",
    ],
  });
  t.after(() => browser.close());

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(HERE, "index.html")).href, {
    waitUntil: "load",
  });
  await page.waitForFunction(
    () => ["pass", "fail"].includes(document.body.dataset.testStatus),
    { timeout: 20000 }
  );

  const result = await page.evaluate(() => ({
    status: document.body.dataset.testStatus,
    log: document.getElementById("harness-log")?.textContent ?? "",
  }));
  assert.equal(result.status, "pass", result.log);
});
