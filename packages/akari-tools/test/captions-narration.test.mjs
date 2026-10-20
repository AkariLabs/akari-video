import { after } from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';

setLanguage('ja');
after(() => setLanguage(undefined));
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCaptionsCli } from "../bin/captions.mjs";
import { analysisPathForTarget } from "../src/media/record.mjs";
import { buildCaptionsFromNarration, normalizeAlignmentText } from "../src/captions/narration.mjs";

const captionsValidator = new URL("../../schemas/bin/validate-captions.mjs", import.meta.url);

async function fixture(t, { narration = null, captions = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "akari-captions-narration-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const edit = {
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    ...(narration ? { audio: { narration } } : {}),
    tracks: [{
      id: "v1", lane: "visual", items: [{
        id: "captions", name: "字幕", at: 0, duration: 90,
        source: { kind: "captions", path: "captions.json" }, items: [],
      }],
    }],
  };
  await writeFile(path.join(root, "edit.json"), JSON.stringify(edit));
  if (captions) await writeFile(path.join(root, "captions.json"), JSON.stringify(captions));
  const captionsPath = path.join(root, "captions.json");
  const run = async (...args) => {
    const stdout = [], stderr = [];
    const code = await runCaptionsCli([root, ...args], {
      stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line),
    });
    return { code, stdout, stderr };
  };
  return { root, edit, captionsPath, run };
}

async function writeAudio(root, relative, transcript = null) {
  const absolute = path.join(root, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `audio:${relative}`);
  if (transcript) {
    const analysisPath = analysisPathForTarget({ projectRoot: root, projectRelative: relative });
    await mkdir(path.dirname(analysisPath), { recursive: true });
    await writeFile(analysisPath, JSON.stringify({ version: 0, transcript }));
  }
  return absolute;
}

async function writeCache(root, absolute, segments) {
  const digest = createHash("sha256").update(await readFile(absolute)).digest("hex");
  const directory = path.join(root, ".akari", "cache", "transcribe");
  await mkdir(directory, { recursive: true });
  const name = `${digest}-0-2-speech-analyzer-ja.json`;
  await writeFile(path.join(directory, name), JSON.stringify({
    path: "audio/cache.wav", range: { in: 0, out: 2 }, backend: "speech-analyzer",
    no_speech: false, segments, generated_at: "2026-10-20T00:00:00.000Z",
  }));
  return digest;
}

const exact = (times) => [{
  start: times[0], end: times.at(-1), text: "こんにちは世界",
  words: [
    { text: "こんにちは", start: times[0], end: (times[0] + times.at(-1)) / 2 },
    { text: "世界", start: (times[0] + times.at(-1)) / 2, end: times.at(-1) },
  ],
}];

test("narration captions use the script text, word times, and the t offset", async (t) => {
  const f = await fixture(t, {
    narration: [{ id: "n-0001", path: "audio/n1.wav", t: 7.5, script: "こんにちは、世界。", provenance: { provider: "human" } }],
  });
  await writeAudio(f.root, "audio/n1.wav", exact([0, 2]));
  const result = await f.run("--narration", "--json");
  assert.equal(result.code, 0, result.stderr.join("\n"));
  const summary = JSON.parse(result.stdout[0]);
  assert.equal(summary.narrations.length, 1);
  assert.equal(summary.narrations[0].id, "n-0001");
  assert.equal(summary.narrations[0].timing_source, "analysis");
  assert.equal(summary.interpolated, 0);
  const written = JSON.parse(await readFile(f.captionsPath, "utf8"));
  assert.equal(written.captions.length, 1);
  const caption = written.captions[0];
  assert.equal(caption.text, "こんにちは、世界。");
  assert.equal(caption.src, undefined);
  assert.equal(caption.time_domain, "output");
  assert.equal(caption.start, 7.5);
  assert.equal(caption.end, 9.8);
  assert.equal(caption.words[0].start, 7.5);
  assert.equal(caption.words.at(-1).end, 9.5);
  assert.equal(caption.words.map((word) => word.text).join(""), "こんにちは、世界。");
  const checked = spawnSync(process.execPath, [captionsValidator.pathname, f.captionsPath], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
}, { concurrency: false });

test("katakana, punctuation, and spacing differences align without interpolation", async (t) => {
  const f = await fixture(t, {
    narration: [{ id: "n-0001", path: "audio/n1.wav", t: 0, script: "カタカナ、世界。", provenance: { provider: "human" } }],
  });
  await writeAudio(f.root, "audio/n1.wav", [{
    start: 0, end: 2, text: "かたかな せかい",
    words: [{ text: "かたかな", start: 0, end: 1 }, { text: "せかい", start: 1, end: 2 }],
  }]);
  const result = await f.run("--narration", "--json");
  assert.equal(result.code, 0, result.stderr.join("\n"));
  const summary = JSON.parse(result.stdout[0]);
  assert.equal(summary.interpolated, 0);
  const caption = JSON.parse(await readFile(f.captionsPath, "utf8")).captions[0];
  assert.equal(caption.text, "カタカナ、世界。");
  assert.equal(caption.start, 0);
  assert.equal(normalizeAlignmentText("カタカナ、世界。 ＡＢＣ"), "かたかな世界abc");
}, { concurrency: false });

test("characters missing from the reading are interpolated and counted", async (t) => {
  const f = await fixture(t, {
    narration: [{ id: "n-0001", path: "audio/n1.wav", t: 2, script: "あいうえお", provenance: { provider: "human" } }],
  });
  await writeAudio(f.root, "audio/n1.wav", [{
    start: 0, end: 2, text: "あいえお",
    words: [{ text: "あいえお", start: 0, end: 2 }],
  }]);
  const result = await f.run("--narration", "--json");
  assert.equal(result.code, 0, result.stderr.join("\n"));
  const summary = JSON.parse(result.stdout[0]);
  assert.equal(summary.interpolated, 1);
  assert.equal(summary.narrations[0].interpolated, 1);
  const caption = JSON.parse(await readFile(f.captionsPath, "utf8")).captions[0];
  assert.equal(caption.text, "あいうえお");
  assert.equal(caption.words.length, 5);
  assert.equal(caption.words.map((word) => word.text).join(""), "あいうえお");
  assert.ok(caption.words.every((word, index) => index === 0 || word.start >= caption.words[index - 1].start));
  assert.ok(caption.start >= 2);
}, { concurrency: false });

test("multiple narrations keep separate segments and offsets", async (t) => {
  const f = await fixture(t, {
    narration: [
      { id: "n-0001", path: "audio/a.wav", t: 0, script: "一つ目です。", provenance: { provider: "human" } },
      { id: "n-0002", path: "audio/b.wav", t: 20, script: "二つ目です。", provenance: { provider: "human" } },
    ],
  });
  await writeAudio(f.root, "audio/a.wav", [{ start: 0, end: 1, text: "一つ目です",
    words: [{ text: "一つ目です", start: 0, end: 1 }] }]);
  await writeAudio(f.root, "audio/b.wav", [{ start: 0, end: 1, text: "二つ目です",
    words: [{ text: "二つ目です", start: 0, end: 1 }] }]);
  const result = await f.run("--narration", "--json");
  assert.equal(result.code, 0, result.stderr.join("\n"));
  const summary = JSON.parse(result.stdout[0]);
  assert.deepEqual(summary.narrations.map((item) => item.id), ["n-0001", "n-0002"]);
  assert.equal(summary.total, 2);
  const written = JSON.parse(await readFile(f.captionsPath, "utf8"));
  assert.deepEqual(written.captions.map((caption) => caption.text), ["一つ目です。", "二つ目です。"]);
  assert.equal(written.captions[0].start, 0);
  assert.ok(written.captions[1].start >= 20);
  assert.equal(new Set(written.captions.map((caption) => caption.id)).size, 2);
  assert.equal(new Set(written.captions.map((caption) => caption.sourceRef.segment)).size, 2);
}, { concurrency: false });

test("missing audio and missing word times skip the item, name it, and fail the run", async (t) => {
  const f = await fixture(t, {
    narration: [
      { id: "n-0001", path: "audio/good.wav", t: 0, script: "良い項目です。", provenance: { provider: "human" } },
      { id: "n-0002", path: "audio/missing.wav", t: 0, script: "音声なし。", provenance: { provider: "human" } },
      { id: "n-0003", path: "audio/untimed.wav", t: 0, script: "時刻なし。", provenance: { provider: "human" } },
    ],
    captions: { captions: [{
      id: "c-0002", start: 0, end: 1, text: "既存の二つ目", speaker: null,
      sourceRef: { segment: 1 }, edited: false, time_domain: "output",
    }] },
  });
  await writeAudio(f.root, "audio/good.wav", [{ start: 0, end: 1, text: "良い項目です",
    words: [{ text: "良い項目です", start: 0, end: 1 }] }]);
  await writeAudio(f.root, "audio/untimed.wav", null);
  const result = await f.run("--narration", "--json");
  assert.equal(result.code, 1);
  assert.match(result.stderr.join("\n"), /n-0002/u);
  assert.match(result.stderr.join("\n"), /n-0003/u);
  const summary = JSON.parse(result.stdout.at(-1));
  assert.deepEqual(summary.narrations.map((item) => item.id), ["n-0001"]);
  const written = JSON.parse(await readFile(f.captionsPath, "utf8"));
  assert.ok(written.captions.some((caption) => caption.text === "良い項目です。"));
  assert.ok(written.captions.some((caption) => caption.text === "既存の二つ目"));
}, { concurrency: false });

test("a transcribe cache entry supplies word times when no analysis exists", async (t) => {
  const f = await fixture(t, {
    narration: [{ id: "n-0001", path: "audio/cache.wav", t: 1, script: "キャッシュ", provenance: { provider: "human" } }],
  });
  const absolute = await writeAudio(f.root, "audio/cache.wav", null);
  await writeCache(f.root, absolute, [{ start: 0, end: 1, text: "きゃっしゅ",
    words: [{ text: "きゃっしゅ", start: 0, end: 1 }] }]);
  const result = await f.run("--narration", "--json");
  assert.equal(result.code, 0, result.stderr.join("\n"));
  const summary = JSON.parse(result.stdout[0]);
  assert.equal(summary.narrations[0].timing_source, "cache");
  assert.equal(summary.interpolated, 0);
  const caption = JSON.parse(await readFile(f.captionsPath, "utf8")).captions[0];
  assert.equal(caption.text, "キャッシュ");
  assert.equal(caption.start, 1);
}, { concurrency: false });

test("edited captions are protected by default and replaced with --force", async (t) => {
  const f = await fixture(t, {
    narration: [{ id: "n-0001", path: "audio/n1.wav", t: 0, script: "こんにちは、世界。", provenance: { provider: "human" } }],
    captions: { captions: [{
      id: "manual", start: 0, end: 1, text: "手直し", speaker: null,
      sourceRef: { segment: 0 }, edited: true, time_domain: "output",
    }] },
  });
  await writeAudio(f.root, "audio/n1.wav", exact([0, 2]));
  const protectedResult = await f.run("--narration", "--json");
  assert.equal(protectedResult.code, 0, protectedResult.stderr.join("\n"));
  assert.equal(JSON.parse(protectedResult.stdout[0]).protected, 1);
  let written = JSON.parse(await readFile(f.captionsPath, "utf8"));
  assert.equal(written.captions.find((caption) => caption.id === "manual").text, "手直し");
  const forced = await f.run("--narration", "--json", "--force");
  assert.equal(forced.code, 0, forced.stderr.join("\n"));
  written = JSON.parse(await readFile(f.captionsPath, "utf8"));
  assert.equal(written.captions.some((caption) => caption.text === "手直し"), false);
}, { concurrency: false });

test("--narration and --source are mutually exclusive and write nothing", async (t) => {
  const f = await fixture(t, {
    narration: [{ id: "n-0001", path: "audio/n1.wav", t: 0, script: "こんにちは。", provenance: { provider: "human" } }],
  });
  await writeAudio(f.root, "audio/n1.wav", exact([0, 2]));
  for (const args of [["--narration", "--source", "n-0001"], ["--narration", "--retime"]]) {
    const result = await f.run(...args);
    assert.equal(result.code, 1);
    assert.match(result.stderr[0], /--source|--retime/u);
    assert.equal(existsSync(f.captionsPath), false);
  }
}, { concurrency: false });

test("the flag may precede the project directory", async (t) => {
  const f = await fixture(t, {
    narration: [{ id: "n-0001", path: "audio/n1.wav", t: 0, script: "こんにちは、世界。", provenance: { provider: "human" } }],
  });
  await writeAudio(f.root, "audio/n1.wav", exact([0, 2]));
  const stdout = [], stderr = [];
  const code = await runCaptionsCli(["--narration", f.root, "--json"], {
    stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line),
  });
  assert.equal(code, 0, stderr.join("\n"));
  assert.equal(JSON.parse(stdout[0]).narrations[0].id, "n-0001");
}, { concurrency: false });

test("missing narration entries are an error and help documents --narration", async (t) => {
  const f = await fixture(t);
  const result = await f.run("--narration");
  assert.equal(result.code, 1);
  assert.match(result.stderr[0], /audio\.narration\[\]/u);
  assert.equal(existsSync(f.captionsPath), false);
  const help = [];
  assert.equal(await runCaptionsCli(["--help"], { stdout: (line) => help.push(line) }), 0);
  assert.match(help[0], /--narration/u);
}, { concurrency: false });

test("the pure alignment helper handles substitutions, insertions, and empty timings", () => {
  assert.equal(normalizeAlignmentText("カタカナ、ＡＢＣ"), "かたかなabc");
  const built = buildCaptionsFromNarration("今日は晴れ", [{
    start: 0, end: 2, text: "きょうははれ",
    words: [{ text: "きょうは", start: 0, end: 1 }, { text: "はれ", start: 1, end: 2 }],
  }], { t: 4, src: "n-0001", lang: "ja" });
  assert.equal(built.captions[0].start, 4);
  assert.equal(built.interpolated, 0);
  assert.throws(() => buildCaptionsFromNarration("こんにちは", [], { src: "n-0001" }), /timing-missing/u);
});
