// 入場アニメーションを途中へシークしたとき、0% 姿勢で確定した clip-path が
// 最終姿勢の断片を丸ごと消す回帰を headless Chrome の実描画で防ぐ。
// 実行: node --test packages/overlay-runtime/test-harness/entry-animation-hit-region.test.mjs
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  if (existsSync(gitFile)) {
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

test("入場アニメを現在時刻へ合わせてから clip-path を測り、CTA 全体を残す", async (t) => {
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

  const result = await page.evaluate(async (html) => {
    await window.akari.runtime.mount({
      overlays: [{ id: "cta", start: 10, duration: 4, html }],
    });
    // 表示区間の中ほどへ直接シークする。入場アニメは完了姿勢になる。
    window.akari.runtime.tick(12, false);
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame))
    );

    const container = document.querySelector('[data-overlay-id="cta"]');
    const anchor = container.querySelector(".fixture-cta__anchor");
    const containerRect = container.getBoundingClientRect();
    const bbox = anchor.getBoundingClientRect();
    const clipPath = container.style.clipPath;
    const match = clipPath.match(/^inset\(([^)]+)\)$/);
    const values = match
      ? match[1]
          .trim()
          .split(/\s+/)
          .map((value) => {
            const percent = value.match(/^([-+\d.eE]+)%$/);
            return percent ? Number(percent[1]) : Number.NaN;
          })
      : [];
    const [top, right, bottom, left] =
      values.length === 1
        ? [values[0], values[0], values[0], values[0]]
        : values.length === 2
          ? [values[0], values[1], values[0], values[1]]
          : values.length === 3
            ? [values[0], values[1], values[2], values[1]]
            : values;
    const clip =
      values.length >= 1 && values.length <= 4 &&
      [top, right, bottom, left].every(Number.isFinite)
      ? {
          top: containerRect.top + (containerRect.height * top) / 100,
          right: containerRect.right - (containerRect.width * right) / 100,
          bottom: containerRect.bottom - (containerRect.height * bottom) / 100,
          left: containerRect.left + (containerRect.width * left) / 100,
        }
      : null;
    const center = { x: (bbox.left + bbox.right) / 2, y: (bbox.top + bbox.bottom) / 2 };
    const hit = document.elementFromPoint(center.x, center.y);

    return {
      clipPath,
      clip,
      bbox: {
        top: bbox.top,
        right: bbox.right,
        bottom: bbox.bottom,
        left: bbox.left,
      },
      hit: hit ? `${hit.tagName}.${hit.className}` : null,
      hitIsDescendant: Boolean(hit && container.contains(hit)),
    };
  }, ENTRY_ANIMATION_FRAGMENT);

  assert.ok(result.clip, `clip-path が inset(...) ではありません: ${result.clipPath}`);
  const epsilon = 0.5;
  assert.ok(
    result.clip.top <= result.bbox.top + epsilon &&
      result.clip.right >= result.bbox.right - epsilon &&
      result.clip.bottom >= result.bbox.bottom - epsilon &&
      result.clip.left <= result.bbox.left + epsilon,
    `clip 矩形が現在姿勢の bbox を内包していません: ${JSON.stringify(result)}`
  );
  assert.equal(
    result.hitIsDescendant,
    true,
    `bbox 中心の elementFromPoint が CTA の子孫ではありません: ${JSON.stringify(result)}`
  );
});
