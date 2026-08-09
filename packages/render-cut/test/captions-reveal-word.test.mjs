import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  generateCaptionOverlays,
  renderStyledCaptionFragment,
} from "../src/captions.mjs";
import { captureWithPuppeteer, renderOverlaySheet } from "../src/rasterize.mjs";
import { chromePathCandidates } from "../src/render-cut.mjs";

const testRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testRoot, "../../..");

const words = [
  { start: 1, end: 1.4, text: "読み" },
  { start: 1.4, end: 2, text: "上げる" },
];

test("reveal-word emits one delayed, seek-safe token per word and holds the visible state", () => {
  const fragment = renderStyledCaptionFragment(words, "reveal-word", {
    rangeStart: 1,
  });

  assert.match(fragment, /class="akari-caption akari-caption--reveal-word"/u);
  assert.match(
    fragment,
    /class="akari-caption__tok akari-caption__tok--reveal-word" style="--akari-tok-delay: 0s">読み<\/span>/u,
  );
  assert.match(
    fragment,
    /class="akari-caption__tok akari-caption__tok--reveal-word" style="--akari-tok-delay: 0\.4s">上げる<\/span>/u,
  );
  assert.doesNotMatch(fragment, /akari-caption__tok--reveal-word" style="[^"]*--akari-tok-dur/u);
  assert.match(fragment, /@keyframes akari-caption-reveal-word \{\s*0% \{ opacity: 0; \}\s*100% \{ opacity: 1; \}/u);
  assert.match(
    fragment,
    /animation: akari-caption-reveal-word 0\.01s var\(--akari-tok-delay, 0s\) linear both paused;/u,
  );
});

test("reveal-word keeps unread emphasized words on the reveal-word path", () => {
  const fragment = renderStyledCaptionFragment(words, "reveal-word", {
    rangeStart: 1,
    emphasisWords: [{
      id: "e-0001",
      t_start: 1.4,
      t_end: 2,
      word: "上げる",
      emotion: "emphasis",
      style_hint: "color-only",
    }],
  });

  assert.equal((fragment.match(/akari-caption__tok--reveal-word/g) ?? []).length, 3);
  assert.doesNotMatch(fragment, /data-emphasis-id="e-0001"/u);
});

test("reveal-word without words falls back to plain output and emits the dedicated warning", () => {
  const caption = {
    id: "c-0001",
    start: 0,
    end: 2,
    text: "読み上げる",
    speaker: null,
    sourceRef: null,
    edited: false,
    style: "reveal-word",
  };
  const warnings = [];
  const [{ html }] = generateCaptionOverlays([caption], [{ in: 0, out: 2 }], {
    onWarning: warning => warnings.push(warning),
  });

  assert.match(html, /<div class="akari-caption">/u);
  assert.doesNotMatch(html, /akari-caption--reveal-word/u);
  assert.deepEqual(warnings, [
    "captions.json item c-0001 requests reveal-word without words[]; rendered as plain text",
  ]);
});

test("existing word styles do not receive reveal-word markup or keyframes", () => {
  for (const style of ["karaoke", "pop", "reveal"]) {
    const fragment = renderStyledCaptionFragment(words, style, { rangeStart: 1, rangeEnd: 2 });
    assert.doesNotMatch(fragment, /reveal-word/u, style);
  }
});

test("real Chrome pixels reveal on the spoken frame, survive seeking, and remain visible", async t => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  let puppeteer;
  try {
    const shellRequire = createRequire(join(projectRoot, "apps/shell/package.json"));
    puppeteer = shellRequire("puppeteer-core");
  } catch {
    return t.skip("puppeteer-core unavailable");
  }
  const [chromePath] = await chromePathCandidates({ env: {}, systemCandidates: [] });
  if (!chromePath) return t.skip("Chrome unavailable");

  const edit = { output: { width: 640, height: 360, fps: 30 } };
  const duration = 2;
  const captionOverlays = generateCaptionOverlays([{
    id: "c-0001",
    start: 0,
    end: duration,
    text: "前後",
    speaker: null,
    sourceRef: null,
    edited: false,
    style: "reveal-word",
    words: [
      { start: 0, end: 0.5, text: "前" },
      { start: 0.5, end: duration, text: "後" },
    ],
  }], [{ in: 0, out: duration }]);
  const overlays = [{
    id: "background",
    html: '<div style="position:absolute;inset:0;background:#1b2a4a"></div>',
    start: 0,
    duration,
    transform: { x: 0, y: 0, scale: 1, rotate: 0 },
    vars: {},
  }, ...captionOverlays];

  const scratch = await mkdtemp(join(tmpdir(), "akari-reveal-word-pixels-"));
  try {
    const sheetPath = join(scratch, "overlay-sheet.html");
    await writeFile(
      sheetPath,
      renderOverlaySheet({ overlays, edit, projectRoot, duration }),
      "utf8",
    );
    const capture = async label => {
      const framesDirectory = join(scratch, `frames-${label}`);
      await captureWithPuppeteer({
        sheetPath,
        chromePath,
        framesDirectory,
        overlayMovPath: join(scratch, `overlay-${label}.mov`),
        width: edit.output.width,
        height: edit.output.height,
        fps: edit.output.fps,
        duration,
        ffmpegCommand: "ffmpeg",
        timeoutMs: 60_000,
        puppeteerModule: {
          launch: options => puppeteer.launch({
            ...options,
            executablePath: chromePath,
            pipe: true,
            args: [...options.args, "--single-process", "--no-zygote"],
          }),
        },
      });
      return framesDirectory;
    };

    const firstFrames = await capture("first");
    const secondFrames = await capture("second");
    const frameCount = duration * edit.output.fps;
    const framePath = (directory, number) => join(
      directory,
      `frame-${String(number).padStart(8, "0")}.png`,
    );
    const hashes = async directory => Promise.all(Array.from(
      { length: frameCount },
      async (_, index) => createHash("sha256")
        .update(await readFile(framePath(directory, index + 1)))
        .digest("hex"),
    ));
    assert.deepEqual(await hashes(secondFrames), await hashes(firstFrames));

    const rgba = path => {
      const decoded = spawnSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-i", path,
        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-",
      ], { encoding: "buffer" });
      assert.equal(decoded.status, 0, decoded.stderr.toString("utf8"));
      assert.equal(decoded.stdout.length, edit.output.width * edit.output.height * 4);
      return decoded.stdout;
    };
    const frameAt = seconds => Math.round(seconds * edit.output.fps) + 1;
    const before = rgba(framePath(firstFrames, frameAt(0.5 - 2 / 30)));
    const after = rgba(framePath(firstFrames, frameAt(0.5 + 2 / 30)));
    const ending = rgba(framePath(firstFrames, frameAt(duration - 1 / 30)));
    const background = [27, 42, 74, 255];
    const white = [255, 255, 255, 255];
    let sampleOffset = -1;
    for (let offset = 0; offset < before.length; offset += 4) {
      if (background.every((value, channel) => before[offset + channel] === value)
        && white.every((value, channel) => after[offset + channel] === value)) {
        sampleOffset = offset;
        break;
      }
    }
    assert.notEqual(sampleOffset, -1, "expected a word pixel that changes from background to white");
    assert.deepEqual([...before.subarray(sampleOffset, sampleOffset + 4)], background);
    assert.deepEqual([...after.subarray(sampleOffset, sampleOffset + 4)], white);
    assert.deepEqual([...ending.subarray(sampleOffset, sampleOffset + 4)], white);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
