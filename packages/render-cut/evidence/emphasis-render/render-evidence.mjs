import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateCaptionOverlays } from "../../src/captions.mjs";
import { captureWithPuppeteer, renderOverlaySheet } from "../../src/rasterize.mjs";
import { chromePathCandidates } from "../../src/render-cut.mjs";

const evidenceDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(evidenceDirectory, "../../../..");
const shellRequire = createRequire(join(projectRoot, "apps/shell/package.json"));
const puppeteer = shellRequire("puppeteer-core");
const [chromePath] = await chromePathCandidates({ env: {}, systemCandidates: [] });
if (!chromePath) throw new Error("Headless Chrome was not found");

const edit = { output: { width: 1280, height: 720, fps: 10 } };
const captions = [{
  id: "c-emphasis",
  start: 0,
  end: 2,
  text: "これはやばいです",
  style: "karaoke",
  words: [
    { start: 0, end: 0.7, text: "これは" },
    { start: 1, end: 1.9, text: "やばい" },
    { start: 1.9, end: 2, text: "です" },
  ],
}];
const emphasisWords = [{
  id: "e-0001",
  t_start: 1,
  t_end: 1.9,
  word: "やばい",
  emotion: "surprise",
  style_hint: "one-char-bang",
}];
const sampleTimes = [0.7, 1, 1.3];

await mkdir(evidenceDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(join(tmpdir(), "akari-emphasis-render-"));
try {
  const overlays = [
    {
      id: "background",
      html: '<div style="position:absolute;inset:0;background:#1b2a4a"></div>',
      start: 0,
      duration: 2,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 },
      vars: {},
    },
    ...generateCaptionOverlays(captions, [{ in: 0, out: 2 }], { emphasisWords }),
  ];
  const sheetPath = join(temporaryDirectory, "overlay-sheet.html");
  const framesDirectory = join(temporaryDirectory, "frames");
  await writeFile(sheetPath, renderOverlaySheet({ overlays, edit, projectRoot, duration: 2 }), "utf8");
  await captureWithPuppeteer({
    sheetPath,
    chromePath,
    framesDirectory,
    overlayMovPath: join(temporaryDirectory, "overlay.mov"),
    width: edit.output.width,
    height: edit.output.height,
    fps: edit.output.fps,
    duration: 2,
    ffmpegCommand: "ffmpeg",
    timeoutMs: 60_000,
    puppeteerModule: {
      launch: (options) => puppeteer.launch({
        ...options,
        executablePath: chromePath,
        pipe: true,
        args: [...options.args, "--single-process", "--no-zygote"],
      }),
    },
  });
  for (const time of sampleTimes) {
    const frameNumber = Math.round(time * edit.output.fps) + 1;
    await copyFile(
      join(framesDirectory, `frame-${String(frameNumber).padStart(8, "0")}.png`),
      join(evidenceDirectory, `render-t${time.toFixed(1)}.png`),
    );
  }
  await writeFile(
    join(evidenceDirectory, "render-run-log.json"),
    `${JSON.stringify({ renderer: "captureWithPuppeteer", fps: 10, sampleTimes, emphasisId: "e-0001" }, null, 2)}\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
