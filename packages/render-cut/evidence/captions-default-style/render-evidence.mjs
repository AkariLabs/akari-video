import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

import { generateCaptionOverlays } from "../../src/captions.mjs";
import { captureWithPuppeteer, renderOverlaySheet } from "../../src/rasterize.mjs";
import { chromePathCandidates } from "../../src/render-cut.mjs";

const evidenceDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(evidenceDirectory, "../../../..");
const [headlessChromePath] = await chromePathCandidates({ env: {}, systemCandidates: [] });
if (!headlessChromePath) throw new Error("Playwright headless Chrome was not found");
const sandboxCompatiblePuppeteer = {
  launch: (options) =>
    puppeteer.launch({
      ...options,
      executablePath: headlessChromePath,
      pipe: true,
      args: [...options.args, "--single-process", "--no-zygote"],
    }),
};
const outputPath = join(evidenceDirectory, "karaoke-mid-highlight.png");
const edit = {
  output: { width: 1280, height: 720, fps: 4 },
};
const captions = [
  {
    id: "karaoke-evidence",
    start: 0,
    end: 2,
    text: "今日は字幕の点灯を確認します",
    style: "karaoke",
    words: [
      { start: 0, end: 0.5, text: "今日は" },
      { start: 0.5, end: 1, text: "字幕の" },
      { start: 1, end: 1.5, text: "点灯を" },
      { start: 1.5, end: 2, text: "確認します" },
    ],
  },
];

await mkdir(evidenceDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(join(tmpdir(), "akari-caption-evidence-"));
try {
  const overlays = [
    {
      id: "contrast-background",
      html: '<div style="position:absolute;inset:0;background:linear-gradient(115deg,#f7d794 0%,#63cdda 50%,#786fa6 100%)"></div>',
      start: 0,
      duration: 2,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 },
      vars: {},
    },
    ...generateCaptionOverlays(captions, [{ in: 0, out: 2 }]),
  ];
  const sheetPath = join(temporaryDirectory, "overlay-sheet.html");
  const framesDirectory = join(temporaryDirectory, "frames");
  await writeFile(
    sheetPath,
    renderOverlaySheet({ overlays, edit, projectRoot, duration: 2 }),
    "utf8",
  );
  await captureWithPuppeteer({
    sheetPath,
    chromePath: headlessChromePath,
    framesDirectory,
    overlayMovPath: join(temporaryDirectory, "overlay.mov"),
    width: edit.output.width,
    height: edit.output.height,
    fps: edit.output.fps,
    duration: 2,
    ffmpegCommand: "ffmpeg",
    timeoutMs: 60_000,
    puppeteerModule: sandboxCompatiblePuppeteer,
  });
  // 4fps の 6 枚目は t=1.25s。先行語は点灯済み、次語は点灯前なので状態差を同時に確認できる。
  await copyFile(join(framesDirectory, "frame-00000006.png"), outputPath);
  console.log(outputPath);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
