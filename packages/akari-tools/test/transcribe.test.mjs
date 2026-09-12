import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { transcribeMedia } from "../src/media/transcribe.mjs";
import { UNRECOGNIZED_ALGO_VERSION } from "../src/media/unrecognized-spans.mjs";
import { fixture, json, putJson } from "./fixtures/transcribe-compare/helpers.mjs";

const gapSegments = () => [{
  start: 0, end: 4, text: "前中後",
  words: [
    { start: 0, end: 0.5, text: "前" },
    { start: 1, end: 1.5, text: "中" },
    { start: 2.5, end: 4, text: "後" },
  ],
}];
const speechOptions = (f) => ({
  ...f.options, backend: "speech-analyzer", speechAnalyzerAvailable: true, wordBook: false,
  silencesRunner: async () => [], backendRunner: async () => gapSegments(),
});
const cacheDirectory = (f) => path.join(f.project, ".akari/cache/transcribe");
const transcriptPath = (f, backend = "speech-analyzer") => path.join(f.directory, "transcripts", `${backend}.json`);
const spanCount = (result) => result.segments.reduce((count, segment) => count + (segment.unrecognized?.length ?? 0), 0);

test("backend の speaker は空でない文字列だけを segment へ写す", async (t) => {
  const withSpeaker = await fixture(t, []);
  const spoken = await transcribeMedia(withSpeaker.target, {
    ...speechOptions(withSpeaker), unrecognized: false,
    backendRunner: async () => [{ ...gapSegments()[0], speaker: "speaker-2" }],
  });
  assert.equal(spoken.segments[0].speaker, "speaker-2");
  assert.deepEqual(Object.keys(spoken.segments[0]).slice(0, 5), ["start", "end", "text", "speaker", "words"]);

  const withoutSpeaker = await fixture(t, []);
  const local = await transcribeMedia(withoutSpeaker.target, {
    ...speechOptions(withoutSpeaker), unrecognized: false,
  });
  assert.equal(Object.hasOwn(local.segments[0], "speaker"), false);
  assert.deepEqual(local.segments[0], gapSegments()[0]);
  assert.equal(JSON.stringify(local.segments[0]), JSON.stringify(gapSegments()[0]));
});

test("cache hit でも閾値を変えて再計算し、ASR は一度しか実行しない", async (t) => {
  const f = await fixture(t, []);
  let calls = 0;
  let silenceCalls = 0;
  const options = {
    ...speechOptions(f),
    backendRunner: async () => { calls += 1; return gapSegments(); },
    silencesRunner: async () => { silenceCalls += 1; return []; },
  };
  const first = await transcribeMedia(f.target, options);
  const second = await transcribeMedia(f.target, { ...options, unrecognizedMinGap: 0.45 });
  assert.equal(spanCount(first), 1);
  assert.equal(spanCount(second), 2);
  assert.deepEqual(first.cache, { hit: false, key: second.cache.key });
  assert.deepEqual(second.cache, { hit: true, key: first.cache.key });
  assert.equal(calls, 1);
  assert.equal(silenceCalls, 2);
  const files = await readdir(cacheDirectory(f));
  assert.equal(files.length, 1);
  assert.deepEqual((await json(path.join(cacheDirectory(f), files[0]))).segments, gapSegments());
  assert.deepEqual((await json(transcriptPath(f))).segments, second.segments);
});

test("旧 cache の span と版を除去し、現在の既定で再計算する", async (t) => {
  const f = await fixture(t, []);
  const sha256 = createHash("sha256").update(await readFile(path.join(f.project, f.target))).digest("hex");
  const key = `${sha256}-0-30-speech-analyzer-auto`;
  await mkdir(cacheDirectory(f), { recursive: true });
  const file = path.join(cacheDirectory(f), `${key}.json`);
  await putJson(file, {
    path: f.target, range: { in: 0, out: 30 }, backend: "speech-analyzer", no_speech: false,
    cache: { hit: false, key }, generated_at: f.options.now.toISOString(),
    segments: [
      { ...gapSegments()[0], unrecognized: [{ start: 0.5, end: 1 }], unrecognized_algo_version: 1 },
      { start: 5, end: 8, text: "端", words: [{ start: 6, end: 7, text: "端" }],
        unrecognized: [{ start: 5, end: 6 }, { start: 7, end: 8 }], unrecognized_algo_version: 1 },
    ],
  });
  const before = await readFile(file, "utf8");
  const options = { ...speechOptions(f), backendRunner: async () => assert.fail("旧 cache hit で ASR を実行した") };
  const result = await transcribeMedia(f.target, options);
  assert.deepEqual(result.cache, { hit: true, key });
  assert.deepEqual(result.segments[0].unrecognized, [{ start: 1.5, end: 2.5 }]);
  assert.equal(result.segments[0].unrecognized_algo_version, UNRECOGNIZED_ALGO_VERSION);
  assert.equal(Object.hasOwn(result.segments[1], "unrecognized"), false);
  assert.equal(Object.hasOwn(result.segments[1], "unrecognized_algo_version"), false);
  const disabled = await transcribeMedia(f.target, { ...options, unrecognized: false });
  assert.equal(spanCount(disabled), 0);
  assert.ok(disabled.segments.every((segment) => !Object.hasOwn(segment, "unrecognized_algo_version")));
  assert.equal(await readFile(file, "utf8"), before);
});

test("transcripts の segment に判定版を記録し、span と top-level の外形を保つ", async (t) => {
  const f = await fixture(t, []);
  await transcribeMedia(f.target, speechOptions(f));
  const transcript = await json(transcriptPath(f));
  assert.deepEqual(Object.keys(transcript), ["version", "backend", "generated_at", "source", "elapsed_sec", "cost_usd", "segments"]);
  assert.equal(transcript.segments[0].unrecognized_algo_version, UNRECOGNIZED_ALGO_VERSION);
  assert.deepEqual(transcript.segments[0].unrecognized, [{ start: 1.5, end: 2.5 }]);
});

test("cache に markers を保持し、無効から有効への変更でも端のマーカーを再計算する", async (t) => {
  const f = await fixture(t, []);
  const segments = [{ start: 0, end: 3, text: "語", words: [{ start: 1, end: 2, text: "語" }],
    markers: [{ start: 2.2, end: 2.4 }] }];
  let calls = 0;
  const options = { ...speechOptions(f),
    backendRunner: async () => { calls += 1; return segments; },
    silencesRunner: async () => [{ start: 0, end: 30 }],
  };
  const first = await transcribeMedia(f.target, { ...options, unrecognized: false });
  assert.deepEqual(first.segments, [{ start: 0, end: 3, text: "語", words: segments[0].words }]);
  assert.deepEqual((await json(transcriptPath(f))).segments, first.segments);
  const [file] = await readdir(cacheDirectory(f));
  assert.deepEqual((await json(path.join(cacheDirectory(f), file))).segments, segments);
  const second = await transcribeMedia(f.target, options);
  assert.equal(second.cache.hit, true);
  assert.equal(calls, 1);
  assert.deepEqual(second.segments[0].unrecognized, [{ start: 2.2, end: 2.4 }]);
  assert.equal(Object.hasOwn(second.segments[0], "markers"), false);
  assert.deepEqual((await json(transcriptPath(f))).segments, second.segments);
});

for (const empty of [false, true]) {
  test(`cloud cache は cost・range・生成日時と no_speech=${empty} を保持する`, async (t) => {
    const f = await fixture(t, []);
    await putJson(path.join(f.project, ".akari/connections.json"), { providers: [{ id: "scribe", doctor: { status: "ok" } }] });
    let calls = 0;
    const options = { ...speechOptions(f), backend: "cloud:scribe", in: 5, out: 10,
      backendRunner: async () => { calls += 1; return { cost_estimate_usd: 0.03, segments: empty ? [] : gapSegments() }; },
    };
    const first = await transcribeMedia(f.target, options);
    const later = new Date("2026-09-08T02:00:00Z");
    const second = await transcribeMedia(f.target, { ...options, now: later, unrecognizedMinGap: 0.45 });
    assert.equal(calls, 1);
    assert.deepEqual(second.cache, { hit: true, key: first.cache.key });
    for (const result of [first, second]) {
      assert.equal(result.backend, "cloud:scribe");
      assert.equal(result.cost_usd, 0.03);
      assert.equal(result.no_speech, empty);
      assert.deepEqual(result.range, { in: 5, out: 10 });
      assert.equal(result.generated_at, f.options.now.toISOString());
    }
    assert.equal(spanCount(first), empty ? 0 : 1);
    assert.equal(spanCount(second), empty ? 0 : 2);
    const transcript = await json(transcriptPath(f, "cloud-scribe"));
    assert.equal(transcript.generated_at, later.toISOString());
    assert.equal(transcript.cost_usd, 0.03);
    assert.deepEqual(transcript.segments, second.segments);
  });
}
