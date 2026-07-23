import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateCaptionOverlays } from "../../src/captions.mjs";
import { renderOverlaySheet } from "../../src/rasterize.mjs";
import { chromePathCandidates } from "../../src/render-cut.mjs";

const evidenceDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(evidenceDirectory, "../../../..");
const [chromePath] = await chromePathCandidates({ env: {}, systemCandidates: [] });
if (!chromePath) throw new Error("Headless Chrome was not found");

const edit = { output: { width: 1280, height: 720, fps: 10 } };
const captions = [
  {
    id: "c-reveal",
    start: 0,
    end: 2,
    text: "最初の文節、次の文節です",
    style: "reveal",
    words: [
      { start: 0, end: 1, text: "最初の文節、" },
      { start: 1, end: 2, text: "次の文節です" },
    ],
  },
  {
    id: "c-danger",
    start: 2,
    end: 4,
    text: "この操作は危険です",
    style: "karaoke",
    words: [
      { start: 2, end: 2.7, text: "この操作は" },
      { start: 2.7, end: 3.4, text: "危険" },
      { start: 3.4, end: 4, text: "です" },
    ],
  },
];
const emphasisWords = [{
  id: "e-0001",
  t_start: 2.7,
  t_end: 3.4,
  word: "危険",
  emotion: "pain",
  style_hint: "danger",
}];
const samples = [
  { time: 0.9, name: "reveal-before-switch.png" },
  { time: 1.1, name: "reveal-after-switch.png" },
  { time: 2.5, name: "danger-before-word.png" },
  { time: 3.0, name: "danger-word.png" },
];

await mkdir(evidenceDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(join(tmpdir(), "akari-caption-direction-"));
try {
  const overlays = [
    {
      id: "background",
      html: '<div style="position:absolute;inset:0;background:linear-gradient(120deg,#17223b,#263859 55%,#6b2d3d)"></div>',
      start: 0,
      duration: 4,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 },
      vars: {},
    },
    ...generateCaptionOverlays(captions, [{ in: 0, out: 4 }], { emphasisWords }),
  ];
  const sheetPath = join(temporaryDirectory, "overlay-sheet.html");
  const seekAtQueryTime = `
  <script>
    window.__akariReady
      .then(() => window.__akariSeek(Number(new URLSearchParams(location.search).get('time'))))
      .then(() => { document.documentElement.dataset.evidenceReady = 'true'; });
  </script>`;
  const sheet = renderOverlaySheet({ overlays, edit, projectRoot, duration: 4 })
    .replace("</body>", `${seekAtQueryTime}\n</body>`);
  await writeFile(
    sheetPath,
    sheet,
    "utf8",
  );
  for (const { time, name } of samples) {
    const outputPath = join(evidenceDirectory, name);
    const result = spawnSync(chromePath, [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-sandbox",
      "--single-process",
      "--no-zygote",
      "--allow-file-access-from-files",
      "--force-device-scale-factor=1",
      `--window-size=${edit.output.width},${edit.output.height}`,
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=1000",
      `--screenshot=${outputPath}`,
      `${pathToFileURL(sheetPath).href}?time=${time}`,
    ], {
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(
        `Headless Chrome evidence capture failed (${result.signal ?? `exit ${result.status}`}): ${result.stderr || result.stdout}`,
      );
    }
  }
  await writeFile(
    join(evidenceDirectory, "render-run-log.json"),
    `${JSON.stringify({
      renderer: "deterministicHeadlessBrowser+__akariSeek",
      chromePath,
      fps: edit.output.fps,
      samples,
      revealCaptionId: "c-reveal",
      dangerEmphasisId: "e-0001",
    }, null, 2)}\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
