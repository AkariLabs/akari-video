// clip-path に頼らず、pointer-events 規約だけで選択と素通しが成立し、
// オーバーフローを含む描画ピクセルを欠損させないことを headless Chrome で検証する。
// 実行: node --test packages/overlay-runtime/test-harness/pointer-events-hit-region.test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const WIDTH = 640;
const HEIGHT = 360;

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
    #overlay-stage {
      position: relative;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      overflow: hidden;
      pointer-events: none;
      background: rgb(17, 17, 22);
    }
  </style>
</head>
<body>
  <div id="overlay-stage"></div>
  <script>${inlineScript(runtime)}</script>
  <script>${inlineScript(interaction)}</script>
</body>
</html>`;
}

async function openHarness(t) {
  const puppeteer = loadPuppeteer();
  const tempDir = mkdtempSync(join(tmpdir(), "pointer-events-hit-region-test-"));
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

async function mount(page, overlays) {
  await page.evaluate(async (entries) => {
    await window.akari.runtime.mount({
      output: { width: 640, height: 360, fps: 30 },
      overlays: entries.map((entry) => ({
        start: 0,
        duration: 4,
        ...entry,
      })),
    });
    window.akari.runtime.tick(1, false);
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame))
    );
  }, overlays);
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

function assertPixels(pixels, expected, label) {
  for (const [index, pixel] of pixels.entries()) {
    const maximumChannelDifference = Math.max(
      ...pixel.map((channel, channelIndex) =>
        Math.abs(channel - expected[channelIndex])
      )
    );
    assert.ok(
      maximumChannelDifference <= 8,
      `${label} ${index} の色が欠けています: ${JSON.stringify({ pixel, maximumChannelDifference })}`
    );
  }
}

test("(a) 断片が描いている場所の実クリックでその断片を選択する", async (t) => {
  const page = await openHarness(t);
  await mount(page, [{
    id: "painted-fragment",
    html: `
      <div class="painted-fragment">選択</div>
      <style>
        .painted-fragment {
          position: absolute;
          left: 120px;
          top: 90px;
          width: 220px;
          height: 100px;
          display: grid;
          place-items: center;
          background: rgb(230, 72, 32);
          color: white;
        }
      </style>`,
  }]);

  await page.mouse.click(230, 140);
  const result = await page.evaluate(() => {
    const container = document.querySelector('[data-overlay-id="painted-fragment"]');
    return {
      selected: container.getAttribute("data-akari-interaction-selected"),
      containerPointerEvents: container.style.pointerEvents,
      fragmentPointerEvents: container.querySelector(".painted-fragment").style.pointerEvents,
    };
  });
  assert.deepEqual(result, {
    selected: "true",
    containerPointerEvents: "none",
    fragmentPointerEvents: "auto",
  });
});

test("(b) 全画面透明ラッパーの空白を実クリックすると下のオーバーレイへ素通しする", async (t) => {
  const page = await openHarness(t);
  await mount(page, [
    {
      id: "lower-overlay",
      html: `
        <div class="lower-wrapper"><div class="lower-overlay"></div></div>
        <style>
          .lower-wrapper { position: absolute; inset: 0; }
          .lower-overlay { position: absolute; inset: 0; background: rgb(24, 88, 180); }
        </style>`,
    },
    {
      id: "transparent-wrapper",
      html: `
        <div class="transparent-wrapper"><div class="small-plate">上</div></div>
        <style>
          .transparent-wrapper { position: absolute; inset: 0; }
          .small-plate {
            position: absolute;
            left: 40px;
            top: 40px;
            width: 120px;
            height: 64px;
            background: rgb(240, 180, 20);
          }
        </style>`,
    },
  ]);

  await page.mouse.click(520, 280);
  const result = await page.evaluate(() => {
    const lower = document.querySelector('[data-overlay-id="lower-overlay"]');
    const upper = document.querySelector('[data-overlay-id="transparent-wrapper"]');
    return {
      lowerSelected: lower.getAttribute("data-akari-interaction-selected"),
      upperSelected: upper.getAttribute("data-akari-interaction-selected"),
      lowerPointerEvents: lower.querySelector(".lower-overlay").style.pointerEvents,
      wrapperPointerEvents: upper.querySelector(".transparent-wrapper").style.pointerEvents,
      platePointerEvents: upper.querySelector(".small-plate").style.pointerEvents,
    };
  });
  assert.deepEqual(result, {
    lowerSelected: "true",
    upperSelected: null,
    lowerPointerEvents: "auto",
    wrapperPointerEvents: "none",
    platePointerEvents: "auto",
  });
});

test("(c) 全画面を描くルート断片を選択でき、背景の実ピクセルが無傷", async (t) => {
  const page = await openHarness(t);
  await mount(page, [{
    id: "full-frame",
    html: `
      <div class="full-frame"><div class="full-frame__text">アカリ</div></div>
      <style>
        .full-frame {
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgb(0, 128, 255), rgb(0, 128, 255));
        }
        .full-frame__text {
          position: absolute;
          left: 220px;
          top: 135px;
          width: 200px;
          height: 90px;
          display: grid;
          place-items: center;
          color: white;
          font: 700 48px/1 sans-serif;
        }
      </style>`,
  }]);

  const pixels = await screenshotPixels(page, [
    { x: 4, y: 4 },
    { x: WIDTH - 5, y: 4 },
    { x: 4, y: HEIGHT - 5 },
    { x: WIDTH - 5, y: HEIGHT - 5 },
  ]);
  assertPixels(pixels, [0, 128, 255], "全画面背景");

  await page.mouse.click(520, 300);
  const blankResult = await page.evaluate(() => {
    const container = document.querySelector('[data-overlay-id="full-frame"]');
    return {
      selected: container.getAttribute("data-akari-interaction-selected"),
      rootPointerEvents: container.querySelector(".full-frame").style.pointerEvents,
      textPointerEvents: container.querySelector(".full-frame__text").style.pointerEvents,
      clipPath: container.style.clipPath,
    };
  });
  assert.deepEqual(blankResult, {
    selected: null,
    rootPointerEvents: "none",
    textPointerEvents: "auto",
    clipPath: "",
  });

  await page.mouse.click(320, 180);
  const selected = await page.evaluate(() =>
    document.querySelector('[data-overlay-id="full-frame"]')
      ?.getAttribute("data-akari-interaction-selected")
  );
  assert.equal(selected, "true");
});

test("(d) overflow:visible でルート外へはみ出す描画の実ピクセルが欠けない", async (t) => {
  const page = await openHarness(t);
  await mount(page, [{
    id: "overflow-visible",
    html: `
      <div class="overflow-root"><div class="overflow-child"></div></div>
      <style>
        .overflow-root {
          position: absolute;
          left: 250px;
          top: 140px;
          width: 100px;
          height: 80px;
          overflow: visible;
        }
        .overflow-child {
          position: absolute;
          left: -80px;
          top: -50px;
          width: 260px;
          height: 180px;
          background: rgb(255, 0, 170);
        }
      </style>`,
  }]);

  const pixels = await screenshotPixels(page, [
    { x: 180, y: 100 },
    { x: 420, y: 100 },
    { x: 180, y: 260 },
    { x: 420, y: 260 },
  ]);
  assertPixels(pixels, [255, 0, 170], "ルート外の overflow 描画");
  const result = await page.evaluate(() => {
    const container = document.querySelector('[data-overlay-id="overflow-visible"]');
    return {
      clipPath: container.style.clipPath,
      rootPointerEvents: container.querySelector(".overflow-root").style.pointerEvents,
      childPointerEvents: container.querySelector(".overflow-child").style.pointerEvents,
    };
  });
  assert.deepEqual(result, {
    clipPath: "",
    rootPointerEvents: "none",
    childPointerEvents: "auto",
  });
});
