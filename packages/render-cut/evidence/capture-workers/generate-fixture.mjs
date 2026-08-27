import { realpath, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateCaptionOverlays } from "../../src/captions.mjs";
import { renderOverlaySheet } from "../../src/rasterize.mjs";

export const FIXTURE = Object.freeze({
  seed: 0x41c4a9,
  width: 1920,
  height: 1080,
  fps: 30,
  durationSeconds: 120,
  captionDurationSeconds: 4,
  wordsPerCaption: 6,
});

const PHRASES = [
  ["光", "が", "街", "を", "照ら", "す"],
  ["声", "を", "未来", "へ", "つな", "ぐ"],
  ["風", "と", "希望", "を", "抱き", "しめる"],
  ["夢", "の", "続きを", "今", "描き", "だす"],
  ["星", "が", "静か", "に", "歌い", "だす"],
  ["朝", "の", "扉", "を", "共に", "開く"],
];

export async function generateFixture(outputDirectory) {
  const root = resolve(outputDirectory);
  await mkdir(root, { recursive: true });
  const random = xorshift32(FIXTURE.seed);
  const captions = [];
  const captionCount = FIXTURE.durationSeconds / FIXTURE.captionDurationSeconds;
  for (let index = 0; index < captionCount; index += 1) {
    const start = index * FIXTURE.captionDurationSeconds;
    const end = start + FIXTURE.captionDurationSeconds;
    const source = PHRASES[Math.floor(random() * PHRASES.length)];
    const rotation = Math.floor(random() * source.length);
    const tokens = [...source.slice(rotation), ...source.slice(0, rotation)];
    const wordDuration = FIXTURE.captionDurationSeconds / FIXTURE.wordsPerCaption;
    captions.push({
      id: `c-${String(index + 1).padStart(4, "0")}`,
      start,
      end,
      text: tokens.join(""),
      style: "karaoke",
      words: tokens.map((text, wordIndex) => ({
        start: start + wordIndex * wordDuration,
        end: start + (wordIndex + 1) * wordDuration,
        text,
      })),
    });
  }

  const edit = {
    version: 0,
    output: { width: FIXTURE.width, height: FIXTURE.height, fps: FIXTURE.fps },
    source: { path: "source.mp4", proxy: null },
    cuts: [{ in: 0, out: FIXTURE.durationSeconds }],
    overlays: [],
  };
  const overlays = generateCaptionOverlays(captions, edit.cuts, {
    output: edit.output,
    sourceCount: 1,
  });
  const sheet = renderOverlaySheet({
    overlays,
    edit,
    projectRoot: root,
    duration: FIXTURE.durationSeconds,
  });
  const fixtureDescription = {
    ...FIXTURE,
    captionCount,
    style: "karaoke",
    textLanguage: "ja",
  };
  await Promise.all([
    writeFile(joinPath(root, "captions.json"), `${JSON.stringify(captions, null, 2)}\n`, "utf8"),
    writeFile(joinPath(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`, "utf8"),
    writeFile(joinPath(root, "fixture.json"), `${JSON.stringify(fixtureDescription, null, 2)}\n`, "utf8"),
    writeFile(joinPath(root, "overlay-sheet.html"), sheet, "utf8"),
  ]);
  return { root, captions, edit, sheetPath: joinPath(root, "overlay-sheet.html") };
}

function xorshift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function joinPath(root, name) {
  return resolve(root, name);
}

async function isMainModule() {
  if (!process.argv[1]) return false;
  const [entryPath, modulePath] = await Promise.all([
    realpath(process.argv[1]).catch(() => null),
    realpath(fileURLToPath(import.meta.url)).catch(() => null),
  ]);
  return entryPath !== null && entryPath === modulePath;
}

if (await isMainModule()) {
  const outputDirectory = process.argv[2];
  if (!outputDirectory) {
    console.error("Usage: node generate-fixture.mjs <output-directory>");
    process.exitCode = 2;
  } else {
    const generated = await generateFixture(outputDirectory);
    console.log(generated.root);
  }
}
