import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "fill-caption-words.mjs");

function analysisWith(words) {
  return {
    version: 0,
    source: "source.mp4",
    transcript: [{ start: 0, end: 4, text: "境界をまたぐ字幕です", ...(words === undefined ? {} : { words }) }],
    keyframes: [],
    events: [],
    tracks: { speakers: [], faces: [], person_matte: null },
  };
}

function run(analysisPath, captionsPath, args = []) {
  return spawnSync(process.execPath, [cliPath, "--analysis", analysisPath, "--captions", captionsPath, ...args], {
    encoding: "utf8",
  });
}

async function withFixture(analysis, captions, callback) {
  const root = await mkdtemp(join(tmpdir(), "fill-caption-words-"));
  const analysisPath = join(root, "analysis.json");
  const captionsPath = join(root, "captions.json");
  await writeFile(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`);
  await writeFile(captionsPath, `${JSON.stringify(captions, null, 2)}\n`);
  try {
    await callback({ analysisPath, captionsPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const WORDS = [
  { start: 0.5, end: 1, text: "左外" },
  { start: 0.9, end: 1.1, text: "左交差" },
  { start: 1.2, end: 1.8, text: "内側" },
  { start: 1.9, end: 2.1, text: "右交差" },
  { start: 2, end: 2.5, text: "右外" },
];

test("strict interval intersection copies whole words without clipping, and dry-run does not write", async () => {
  const captions = [{ id: "c-1", start: 1, end: 2, text: "字幕", speaker: null, sourceRef: null, edited: false }];
  await withFixture(analysisWith(WORDS), captions, async ({ analysisPath, captionsPath }) => {
    const before = await readFile(captionsPath, "utf8");
    const dryRun = run(analysisPath, captionsPath, ["--dry-run"]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /^--- /m);
    assert.equal(await readFile(captionsPath, "utf8"), before);

    const result = run(analysisPath, captionsPath);
    assert.equal(result.status, 0, result.stderr);
    const [caption] = JSON.parse(await readFile(captionsPath, "utf8"));
    assert.deepEqual(caption.words, [WORDS[1], WORDS[2], WORDS[3]]);
  });
});

test("existing words are skipped by default and overwritten only with --force", async () => {
  const existingWords = [{ start: 1.3, end: 1.4, text: "既存" }];
  const captions = [{ id: "c-1", start: 1, end: 2, text: "字幕", words: existingWords }];
  await withFixture(analysisWith(WORDS), captions, async ({ analysisPath, captionsPath }) => {
    const skipped = run(analysisPath, captionsPath);
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.match(skipped.stdout, /既存 words 1 件をスキップ/);
    assert.deepEqual(JSON.parse(await readFile(captionsPath, "utf8"))[0].words, existingWords);

    const forced = run(analysisPath, captionsPath, ["--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.deepEqual(JSON.parse(await readFile(captionsPath, "utf8"))[0].words, [WORDS[1], WORDS[2], WORDS[3]]);
  });
});

test("an analysis without transcript words is a byte-preserving no-op with an explicit message", async () => {
  const captions = [{ id: "c-1", start: 1, end: 2, text: "字幕", style: "karaoke" }];
  await withFixture(analysisWith(undefined), captions, async ({ analysisPath, captionsPath }) => {
    const before = await readFile(captionsPath, "utf8");
    const result = run(analysisPath, captionsPath);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /words 0 件・充填対象なし/);
    assert.equal(await readFile(captionsPath, "utf8"), before);
  });
});

test("filling words preserves every other captions.json field, including style", async () => {
  const caption = {
    id: "c-1",
    start: 1,
    end: 2,
    text: "字幕",
    speaker: "speaker-a",
    sourceRef: { segment: 0 },
    edited: true,
    style: "karaoke",
    extensionData: { keep: ["all", "values"] },
  };
  await withFixture(analysisWith(WORDS), [caption], async ({ analysisPath, captionsPath }) => {
    const result = run(analysisPath, captionsPath);
    assert.equal(result.status, 0, result.stderr);
    const [updated] = JSON.parse(await readFile(captionsPath, "utf8"));
    const { words, ...withoutWords } = updated;
    assert.deepEqual(withoutWords, caption);
    assert.deepEqual(words, [WORDS[1], WORDS[2], WORDS[3]]);
  });
});
