// 全画面断片ルート自身の背景が、子要素 bbox 用の clip-path で消える
// 回帰を headless Chrome の実描画ピクセルで防ぐ。
// 実行: node --test packages/overlay-runtime/test-harness/full-frame-background-clip.test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const WIDTH = 1920;
const HEIGHT = 1080;
const BACKGROUND = [0, 128, 255];

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

function inlineScript(source) {
  return source.replaceAll("</script", "<\\/script");
}

function buildHtml() {
  const runtime = readFileSync(join(SRC, "overlay-runtime.js"), "utf8");
  const interaction = readFileSync(join(SRC, "interaction.js"), "utf8");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
    #overlay-stage { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  </style>
</head>
<body>
  <div id="overlay-stage"></div>
  <script>${inlineScript(runtime)}</script>
  <script>${inlineScript(interaction)}</script>
</body>
</html>`;
}

const FULL_FRAME_FRAGMENT = `
<div class="fixture-full">
  <div class="fixture-full__text">アカリ</div>
</div>
<style>
  .fixture-full {
    position: relative;
    width: 1920px;
    height: 1080px;
    background: rgb(0, 128, 255);
  }
  .fixture-full__text {
    position: absolute;
    left: 160px;
    top: 440px;
    color: white;
    font: 700 64px/1 sans-serif;
  }
</style>
`;

async function openHarness(t) {
  const puppeteer = loadPuppeteer();
  const tempDir = mkdtempSync(join(tmpdir(), "full-frame-background-clip-test-"));
  const htmlPath = join(tempDir, "harness.html");
  writeFileSync(htmlPath, buildHtml(), "utf8");
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

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
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  return page;
}

async function screenshotPixels(page, points) {
  const screenshot = await page.screenshot({ type: "png" });
  return page.evaluate(async ({ source, samplePoints }) => {
    const image = new Image();
    await new Promise((resolveImage, rejectImage) => {
      image.addEventListener("load", resolveImage, { once: true });
      image.addEventListener("error", rejectImage, { once: true });
      image.src = `data:image/png;base64,${source}`;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    return samplePoints.map(({ x, y }) =>
      Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3))
    );
  }, { source: Buffer.from(screenshot).toString("base64"), samplePoints: points });
}

test("全画面断片ルートの背景を子要素 bbox でクリップしない", async (t) => {
  const page = await openHarness(t);

  const result = await page.evaluate(async (html) => {
    await window.akari.runtime.mount({
      overlays: [{ id: "full-frame", start: 0, duration: 4, html }],
    });
    window.akari.runtime.tick(2, false);
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame))
    );

    const container = document.querySelector('[data-overlay-id="full-frame"]');
    const root = container.querySelector(".fixture-full");
    const rect = root.getBoundingClientRect();
    return {
      clipPath: container.style.clipPath,
      corners: [
        { x: rect.left + 2, y: rect.top + 2 },
        { x: rect.right - 2, y: rect.top + 2 },
        { x: rect.left + 2, y: rect.bottom - 2 },
        { x: rect.right - 2, y: rect.bottom - 2 },
      ],
    };
  }, FULL_FRAME_FRAGMENT);

  assert.equal(result.clipPath, "");
  const pixels = await screenshotPixels(page, result.corners);
  for (const [index, pixel] of pixels.entries()) {
    const maximumChannelDifference = Math.max(
      ...pixel.map((channel, channelIndex) =>
        Math.abs(channel - BACKGROUND[channelIndex])
      )
    );
    assert.ok(
      maximumChannelDifference <= 8,
      `四隅 ${index} の背景色が欠けています: ${JSON.stringify({ pixel, maximumChannelDifference })}`
    );
  }
});
