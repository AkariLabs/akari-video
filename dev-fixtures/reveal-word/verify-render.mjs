// ラッパー自身の検証スクリプト（task 2026-08-07-caption-word-reveal 受け入れ条件 1-5）。
// 製品ソースではなく検証用フィクスチャ。render-cut の本番ラスタライザ経路
// （renderOverlaySheet + captureWithPuppeteer）だけを使って画素を実測する。
//
// 使い方: node dev-fixtures/reveal-word/verify-render.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const baselineRoot = process.env.AKARI_BASELINE_ROOT;
const outRoot = process.env.AKARI_VERIFY_OUT ?? join(here, "out");

const { generateCaptionOverlays } = await import(join(repoRoot, "packages/render-cut/src/captions.mjs"));
const { renderOverlaySheet, captureWithPuppeteer } = await import(join(repoRoot, "packages/render-cut/src/rasterize.mjs"));
const { findChromePath } = await import(join(repoRoot, "packages/render-cut/src/render-cut.mjs"));

const chromePath = await findChromePath();
if (!chromePath) throw new Error("headless Chrome not found");

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 30;
const DURATION = 2;
const BACKGROUND = "#1b2a4a"; // rgb(27,42,74)
const BACKGROUND_RGB = [0x1b, 0x2a, 0x4a];

const edit = { output: { width: WIDTH, height: HEIGHT, fps: FPS } };
const cuts = [{ in: 0, out: DURATION }];

const revealWordCaption = {
  id: "c-0001",
  start: 0,
  end: DURATION,
  text: "前後左右",
  speaker: null,
  sourceRef: null,
  edited: false,
  style: "reveal-word",
  words: [
    { start: 0.0, end: 0.5, text: "前" },
    { start: 0.5, end: 1.0, text: "後" },
    { start: 1.0, end: 1.5, text: "左" },
    { start: 1.5, end: 2.0, text: "右" },
  ],
};

function backgroundOverlay() {
  return {
    id: "background",
    html: `<div style="position:absolute;inset:0;background:${BACKGROUND}"></div>`,
    start: 0,
    duration: DURATION,
    transform: { x: 0, y: 0, scale: 1, rotate: 0 },
    vars: {},
  };
}

async function renderFrames(overlays, directory) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const sheetPath = join(directory, "overlay-sheet.html");
  const framesDirectory = join(directory, "frames");
  await writeFile(
    sheetPath,
    renderOverlaySheet({ overlays, edit, projectRoot: repoRoot, duration: DURATION }),
    "utf8",
  );
  await captureWithPuppeteer({
    sheetPath,
    chromePath,
    framesDirectory,
    overlayMovPath: join(directory, "overlay.mov"),
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    duration: DURATION,
    ffmpegCommand: "ffmpeg",
    timeoutMs: 120_000,
  });
  return framesDirectory;
}

function framePath(framesDirectory, seconds) {
  const index = Math.round(seconds * FPS) + 1;
  return join(framesDirectory, `frame-${String(index).padStart(8, "0")}.png`);
}

function decodeRgba(path) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", path,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ], { encoding: "buffer", maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`ffmpeg decode failed: ${result.stderr.toString("utf8")}`);
  return result.stdout;
}

function pixelAt(buffer, x, y) {
  const offset = (y * WIDTH + x) * 4;
  return [buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]];
}

// 「その語が出た」ことに一番強く効いている画素を選ぶ: after が最も白く、before が背景色のままの点。
function locateRevealedPixel(before, after) {
  let best = null;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const b = pixelAt(before, x, y);
      const a = pixelAt(after, x, y);
      const beforeIsBackground = b[0] === BACKGROUND_RGB[0] && b[1] === BACKGROUND_RGB[1] && b[2] === BACKGROUND_RGB[2];
      if (!beforeIsBackground) continue;
      const whiteness = Math.min(a[0], a[1], a[2]);
      if (best === null || whiteness > best.whiteness) best = { x, y, whiteness, before: b, after: a };
    }
  }
  return best;
}

async function hashDirectory(framesDirectory) {
  const names = (await readdir(framesDirectory)).filter(name => name.endsWith(".png")).sort();
  const hash = createHash("sha256");
  for (const name of names) {
    hash.update(name);
    hash.update(await readFile(join(framesDirectory, name)));
  }
  return { hash: hash.digest("hex"), frames: names.length };
}

const report = { chromePath, width: WIDTH, height: HEIGHT, fps: FPS, duration: DURATION, checks: {} };
await mkdir(outRoot, { recursive: true });

// ---- 受け入れ条件 1 / 3: 語の開始前後 2 フレームの画素、および字幕終了直前の保持 ----
const revealWordOverlays = [backgroundOverlay(), ...generateCaptionOverlays([revealWordCaption], cuts, {})];
const runA = await renderFrames(revealWordOverlays, join(outRoot, "reveal-word-run-a"));
const runB = await renderFrames(revealWordOverlays, join(outRoot, "reveal-word-run-b"));

const wordStart = 0.5; // 2 語目「後」
const beforeSeconds = wordStart - 2 / FPS;
const afterSeconds = wordStart + 2 / FPS;
const endingSeconds = DURATION - 1 / FPS;

const beforeBuffer = decodeRgba(framePath(runA, beforeSeconds));
const afterBuffer = decodeRgba(framePath(runA, afterSeconds));
const endingBuffer = decodeRgba(framePath(runA, endingSeconds));

const spot = locateRevealedPixel(beforeBuffer, afterBuffer);
if (!spot) throw new Error("no revealed pixel found");
report.checks.reveal_pixel = {
  word: "後",
  word_start_seconds: wordStart,
  coordinate: { x: spot.x, y: spot.y },
  before_seconds: Number(beforeSeconds.toFixed(4)),
  after_seconds: Number(afterSeconds.toFixed(4)),
  ending_seconds: Number(endingSeconds.toFixed(4)),
  before_rgba: pixelAt(beforeBuffer, spot.x, spot.y),
  after_rgba: pixelAt(afterBuffer, spot.x, spot.y),
  ending_rgba: pixelAt(endingBuffer, spot.x, spot.y),
  background_rgb: BACKGROUND_RGB,
};

// 語が現れる領域全体でも「読み上げ前は背景のまま」を確認する（1 画素の偶然を排除）。
let differingPixels = 0;
for (let index = 0; index < beforeBuffer.length; index += 4) {
  if (beforeBuffer[index] !== BACKGROUND_RGB[0]
    || beforeBuffer[index + 1] !== BACKGROUND_RGB[1]
    || beforeBuffer[index + 2] !== BACKGROUND_RGB[2]) differingPixels += 1;
}
report.checks.reveal_pixel.non_background_pixels_before = differingPixels;

let differingAfter = 0;
for (let index = 0; index < afterBuffer.length; index += 4) {
  if (afterBuffer[index] !== BACKGROUND_RGB[0]
    || afterBuffer[index + 1] !== BACKGROUND_RGB[1]
    || afterBuffer[index + 2] !== BACKGROUND_RGB[2]) differingAfter += 1;
}
report.checks.reveal_pixel.non_background_pixels_after = differingAfter;

// ---- 受け入れ条件 2: seek 安全（同一入力の 2 回レンダリングが全フレームでバイト一致） ----
const hashA = await hashDirectory(runA);
const hashB = await hashDirectory(runB);
report.checks.seek_safety = {
  run_a: hashA,
  run_b: hashB,
  identical: hashA.hash === hashB.hash,
};

// ---- 受け入れ条件 4: words[] を持たない reveal-word の警告と素の表示への落ち ----
const warnings = [];
const [{ html: plainHtml }] = generateCaptionOverlays([{
  ...revealWordCaption,
  words: undefined,
}], cuts, { onWarning: warning => warnings.push(warning) });
report.checks.without_words = {
  warnings,
  has_reveal_word_markup: /reveal-word/u.test(plainHtml),
  plain_root: /<div class="akari-caption">/u.test(plainHtml),
};

// ---- 受け入れ条件 5: 既存 3 種のバイト同一（新旧レンダリング比較） ----
if (baselineRoot) {
  const baselineCaptions = await import(join(baselineRoot, "packages/render-cut/src/captions.mjs"));
  const styleResults = {};
  for (const style of ["karaoke", "pop", "reveal"]) {
    const caption = { ...revealWordCaption, style };
    const newOverlays = [backgroundOverlay(), ...generateCaptionOverlays([caption], cuts, {})];
    const oldOverlays = [backgroundOverlay(), ...baselineCaptions.generateCaptionOverlays([caption], cuts, {})];
    const normalize = value => value.split(baselineRoot).join("<ROOT>").split(repoRoot).join("<ROOT>");
    const newHtml = normalize(newOverlays.map(item => item.html).join("\n"));
    const oldHtml = normalize(oldOverlays.map(item => item.html).join("\n"));
    const newFrames = await renderFrames(newOverlays, join(outRoot, `style-${style}-new`));
    const oldFrames = await renderFrames(oldOverlays, join(outRoot, `style-${style}-old`));
    const newHash = await hashDirectory(newFrames);
    const oldHash = await hashDirectory(oldFrames);
    styleResults[style] = {
      html_identical: newHtml === oldHtml,
      html_sha256: createHash("sha256").update(newHtml).digest("hex"),
      new_frames: newHash,
      old_frames: oldHash,
      frames_identical: newHash.hash === oldHash.hash,
    };
  }
  report.checks.existing_styles = styleResults;
} else {
  report.checks.existing_styles = "skipped (AKARI_BASELINE_ROOT unset)";
}

await writeFile(join(outRoot, "verify-render.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
