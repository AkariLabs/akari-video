// 編集モードで stage 面に落ちる背景クリックと、前面の実ヒット先を検証する。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");

function loadPuppeteer() {
  const roots = [resolve(HERE, "../../render-cut")];
  const gitFile = resolve(HERE, "../../../.git");
  if (existsSync(gitFile) && statSync(gitFile).isFile()) {
    const gitDir = readFileSync(gitFile, "utf8").trim().replace(/^gitdir:\s*/, "");
    const marker = `${join(".git", "worktrees")}/`;
    const markerIndex = gitDir.indexOf(marker);
    if (markerIndex >= 0) roots.push(join(gitDir.slice(0, markerIndex), "packages/render-cut"));
  }
  for (const root of roots) {
    try { return createRequire(`${root}/`)("puppeteer-core"); } catch { /* Try the main checkout. */ }
  }
  throw new Error("puppeteer-core を解決できません");
}

function inlineScript(source) {
  return source.replaceAll("</script", "<\\/script");
}

async function openHarness(t) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: 640px; height: 360px; overflow: hidden; }
    #overlay-stage { position: relative; width: 640px; height: 360px;
      overflow: hidden; pointer-events: auto; }
  </style></head><body><div id="overlay-stage"></div>
  <script>${inlineScript(readFileSync(join(SRC, "overlay-runtime.js"), "utf8"))}</script>
  <script>${inlineScript(readFileSync(join(SRC, "interaction.js"), "utf8"))}</script>
  </body></html>`;
  const tempDir = mkdtempSync(join(tmpdir(), "background-board-stage-click-"));
  const htmlPath = join(tempDir, "harness.html");
  writeFileSync(htmlPath, html, "utf8");
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const browser = await loadPuppeteer().launch({
    executablePath: process.env.AKARI_TEST_CHROME_PATH || process.env.CHROME_PATH,
    headless: "shell",
    pipe: true,
    dumpio: process.env.AKARI_TEST_BROWSER_DUMPIO === "1",
    // Linux の CI ランナーはサンドボックスを張れない（hit-policy.test.mjs ほかと同じ流儀）。
    args: [...(process.platform === "linux" ? ["--no-sandbox"] : []),
      "--single-process", "--no-zygote", "--allow-file-access-from-files", "--disable-gpu"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  return page;
}

async function mount(page, overlays) {
  await page.evaluate(async (entries) => {
    await window.akari.runtime.mount({
      output: { width: 640, height: 360, fps: 30 },
      overlays: entries.map((entry) => ({ start: 0, duration: 4, ...entry })),
    });
    window.akari.runtime.tick(1, false);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  }, overlays);
}

async function selectedIds(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-akari-interaction-selected="true"]')]
    .map((element) => element.dataset.overlayId));
}

test("編集 stage の背景板を選べ、透明ラッパーと実ヒット先の選択を守る", async (t) => {
  const page = await openHarness(t);
  await mount(page, [
    {
      id: "background",
      role: "background",
      html: `<style>.bg-root { position: absolute; inset: 0; background: rgb(20, 90, 160); }</style>
        <div class="bg-root"></div>`,
    },
    {
      id: "lower-third",
      html: `<div class="lower-third" style="position:absolute;left:180px;top:260px;
        width:280px;height:70px;background:rgb(220, 80, 40)"></div>`,
    },
    {
      id: "transparent-wrapper",
      html: `<div class="transparent-wrapper" style="position:absolute;inset:0">
        <div style="position:absolute;left:40px;top:40px;width:100px;height:50px;
          background:rgb(240, 190, 30)"></div></div>`,
    },
  ]);

  assert.equal(await page.evaluate(() => document.elementFromPoint(500, 150)?.id), "overlay-stage");
  await page.mouse.click(500, 150);
  assert.deepEqual(await selectedIds(page), ["background"]);

  await page.mouse.click(300, 290);
  assert.deepEqual(await selectedIds(page), ["lower-third"]);

  await page.mouse.click(520, 280);
  assert.deepEqual(await selectedIds(page), ["background"]);

  await page.mouse.click(300, 290);
  await page.evaluate(() => {
    const blocker = document.createElement("div");
    blocker.id = "transparent-host-layer";
    Object.assign(blocker.style, { position: "fixed", inset: "0", zIndex: "999999",
      background: "transparent", pointerEvents: "auto" });
    document.body.append(blocker);
  });
  assert.equal(await page.evaluate(() => document.elementFromPoint(500, 150)?.id), "transparent-host-layer");
  await page.mouse.click(500, 150);
  assert.ok(!(await selectedIds(page)).includes("background"));

  await page.evaluate(() => document.getElementById("transparent-host-layer").remove());
  await mount(page, [{
    id: "role-less-full-frame",
    html: `<div style="position:absolute;inset:0;background:rgb(20, 90, 160)"></div>`,
  }]);
  await page.mouse.click(500, 150);
  assert.deepEqual(await selectedIds(page), ["role-less-full-frame"]);
});
