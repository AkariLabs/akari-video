// 入場アニメーションを途中へシークしたときも、最終姿勢の CTA 全体が
// pointer-events 規約だけでクリック可能なことを headless Chrome の実クリックで防ぐ。
// 実行: node --test packages/overlay-runtime/test-harness/entry-animation-hit-region.test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const WIDTH = 1080;
const HEIGHT = 1920;

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

const ENTRY_ANIMATION_FRAGMENT = `
<div class="fixture-cta">
  <div class="fixture-cta__anchor"><span>アカリ</span></div>
</div>
<style>
  .fixture-cta {
    position: absolute;
    inset: 0;
    perspective: 900px;
  }
  .fixture-cta__anchor {
    position: absolute;
    left: 90px;
    top: 960px;
    width: 900px;
    height: 240px;
    display: grid;
    place-items: center;
    opacity: 0;
    color: white;
    background: #e74420;
    font: 900 120px/1 sans-serif;
    transform-style: preserve-3d;
    transform-origin: center;
  }
  [data-akari-active] .fixture-cta__anchor {
    animation: fixture-cta-in 800ms ease-out both;
  }
  @keyframes fixture-cta-in {
    0% {
      opacity: 0;
      transform: translate3d(420px, -150px, -900px) rotateY(-34deg) rotateX(20deg) scale(0.62);
    }
    100% {
      opacity: 1;
      transform: translate3d(0, 0, 0) rotateY(0) rotateX(0) scale(1);
    }
  }
</style>
`;

async function openHarness(t) {
  const puppeteer = loadPuppeteer();
  const tempDir = mkdtempSync(join(tmpdir(), "entry-animation-hit-region-test-"));
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

async function mountAndTickContinuously(page, end = 12) {
  await page.evaluate(async ({ html, endTime }) => {
    await window.akari.runtime.mount({
      overlays: [{ id: "cta", start: 10, duration: 4, html }],
    });

    const waitForAnimationFrame = () =>
      new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    let timelineTime = 9.9;
    while (timelineTime < endTime) {
      window.akari.runtime.tick(timelineTime, true);
      await waitForAnimationFrame();
      timelineTime += 0.033;
    }
    window.akari.runtime.tick(endTime, true);
    await waitForAnimationFrame();
  }, { html: ENTRY_ANIMATION_FRAGMENT, endTime: end });
}

async function waitForFrames(page, count) {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    }
  }, count);
}

async function measureHitRegion(page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-overlay-id="cta"]');
    const anchor = container.querySelector(".fixture-cta__anchor");
    const bbox = anchor.getBoundingClientRect();

    return {
      bbox: {
        top: bbox.top,
        right: bbox.right,
        bottom: bbox.bottom,
        left: bbox.left,
      },
      containerPointerEvents: container.style.pointerEvents,
      anchorPointerEvents: anchor.style.pointerEvents,
    };
  });
}

async function assertHitRegion(page, result) {
  assert.equal(result.containerPointerEvents, "none");
  assert.equal(result.anchorPointerEvents, "auto");
  const inset = 4;
  const points = [
    { x: (result.bbox.left + result.bbox.right) / 2, y: (result.bbox.top + result.bbox.bottom) / 2 },
    { x: result.bbox.left + inset, y: result.bbox.top + inset },
    { x: result.bbox.right - inset, y: result.bbox.top + inset },
    { x: result.bbox.left + inset, y: result.bbox.bottom - inset },
    { x: result.bbox.right - inset, y: result.bbox.bottom - inset },
  ];
  for (const point of points) {
    await page.evaluate(() => window.akari.interaction.clearSelection());
    await page.mouse.click(point.x, point.y);
    const selected = await page.evaluate(() =>
      document.querySelector('[data-overlay-id="cta"]')
        ?.getAttribute("data-akari-interaction-selected")
    );
    assert.equal(
      selected,
      "true",
      `CTA 内の実クリックが選択されません: ${JSON.stringify({ point, result })}`
    );
  }
}

test("入場アニメを現在時刻へ合わせてから当たり判定を確定し、CTA 全体を残す", async (t) => {
  const page = await openHarness(t);

  await page.evaluate(async (html) => {
    await window.akari.runtime.mount({
      overlays: [{ id: "cta", start: 10, duration: 4, html }],
    });
    // 表示区間の中ほどへ直接シークする。入場アニメは完了姿勢になる。
    window.akari.runtime.tick(12, false);
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame))
    );
  }, ENTRY_ANIMATION_FRAGMENT);

  const result = await measureHitRegion(page);

  await assertHitRegion(page, result);
});

test("overlay.start を小刻みに跨ぐ連続再生でも、入場アニメ完了後の CTA 全体を拾う", async (t) => {
  const page = await openHarness(t);

  await mountAndTickContinuously(page);
  await waitForFrames(page, 2);

  const result = await measureHitRegion(page);

  await assertHitRegion(page, result);
});

test("入場アニメ完了後はヒット領域同期を呼び直さない（可視な間ずっと呼び続けない）", async (t) => {
  const page = await openHarness(t);

  await page.evaluate(() => {
    const originalSyncOverlayHitRegion = window.akari.interaction.syncOverlayHitRegion;
    window.__syncOverlayHitRegionCalls = 0;
    window.akari.interaction.syncOverlayHitRegion = (...args) => {
      window.__syncOverlayHitRegionCalls += 1;
      return originalSyncOverlayHitRegion(...args);
    };
  });
  await mountAndTickContinuously(page, 10.9);

  const callsDuringEntry = await page.evaluate(() => window.__syncOverlayHitRegionCalls);
  assert.ok(
    callsDuringEntry >= 2,
    `入場中にヒット領域同期が複数回呼ばれていません: ${JSON.stringify({ callsDuringEntry })}`
  );

  await page.evaluate(async () => {
    const waitForAnimationFrame = () =>
      new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    for (let index = 1; index <= 5; index += 1) {
      window.akari.runtime.tick(10.9 + index * 0.033, true);
      await waitForAnimationFrame();
    }
  });
  const callsAfterEntry = await page.evaluate(() => window.__syncOverlayHitRegionCalls);
  assert.equal(
    callsAfterEntry - callsDuringEntry,
    0,
    `入場完了後もヒット領域同期を呼んでいます: ${JSON.stringify({
      callsDuringEntry,
      callsAfterEntry,
    })}`
  );
});
