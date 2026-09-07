import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { writeWordBookFile } from "../../word-book/src/index.mjs";
import { runCaptionsCli } from "../bin/captions.mjs";
import { analysisPathForTarget } from "../src/media/record.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "akari-captions-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const edit = { version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [{ id: "s1", path: "source/a.mp4" }], tracks: [{ id: "v1", lane: "visual", items: [{ id: "clip-1", at: 0, duration: 360, source: { kind: "media", src: "s1", in: 0, out: 12 } }] }] };
  await mkdir(path.join(root, "source"));
  await writeFile(path.join(root, "source/a.mp4"), "dummy");
  await writeFile(path.join(root, "edit.json"), JSON.stringify(edit));
  const analysisPath = analysisPathForTarget({ projectRoot: root, projectRelative: "source/a.mp4" });
  await mkdir(path.dirname(analysisPath), { recursive: true });
  const transcript = [0, 4, 8].map((start) => ({ start, end: start + 2, text: "こんにちは", words: [{ start, end: start + 2, text: "こんにちは" }] }));
  await writeFile(analysisPath, JSON.stringify({ version: 0, transcript }));
  const captionsPath = path.join(root, "captions.json");
  const run = async (...args) => {
    const stdout = [], stderr = [];
    const code = await runCaptionsCli([root, ...args], { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) });
    return { code, stdout, stderr };
  };
  return { root, edit, analysisPath, captionsPath, run };
}

test("writes schema-valid deterministic captions and leaves edit.json intact", async (t) => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.root, "edit.json"), "utf8");
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr.join("\n"));
  assert.deepEqual(JSON.parse(result.stdout[0]), { captions: 3, warnings: [], path: f.captionsPath, word_book: { applied: 0 } });
  assert.equal(result.stdout.length, 1);
  assert.match(result.stderr[0], /v2.captions-track-undeclared/);
  const source = await readFile(f.captionsPath, "utf8");
  assert.equal(JSON.parse(source).captions[0].src, "s1");
  const validator = fileURLToPath(new URL("../../schemas/bin/validate-captions.mjs", import.meta.url));
  const checked = spawnSync(process.execPath, [validator, f.captionsPath], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.equal((await f.run("--json")).code, 0);
  assert.equal(await readFile(f.captionsPath, "utf8"), source);
  assert.equal(await readFile(path.join(f.root, "edit.json"), "utf8"), before);
});

test("dry-run emits the candidate and summary without writing", async (t) => {
  const f = await fixture(t);
  const result = await f.run("--dry-run");
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout[0]).captions.length, 3);
  assert.equal(JSON.parse(result.stdout[1]).captions, 3);
  assert.equal(existsSync(f.captionsPath), false);
});

test("edited captions require force and retain all root settings", async (t) => {
  const f = await fixture(t);
  const settings = { default_text_style: { font_size: 42 }, display_policy: { mode: "single_line_sequential", algorithm: "a4-ja-two-fragment-v1", unit_metric: "ascii-half-other-one-v1", max_line_units: 18, minimum_fragment_duration_seconds: 1, locale: "ja" }, emphasis_words: [] };
  const before = JSON.stringify({ ...settings, captions: [{ edited: true, text: "manual" }] });
  await writeFile(f.captionsPath, before);
  const refused = await f.run();
  assert.equal(refused.code, 1);
  assert.match(refused.stderr[0], /手直し済み/);
  assert.equal(await readFile(f.captionsPath, "utf8"), before);
  assert.equal((await f.run("--force")).code, 0);
  const { captions, ...retained } = JSON.parse(await readFile(f.captionsPath, "utf8"));
  assert.deepEqual(retained, settings);
  assert.equal(captions.length, 3);
  assert.ok(captions.every((cue) => cue.edited === false));
  assert.equal((await f.run()).code, 0);
  assert.deepEqual(JSON.parse(await readFile(f.captionsPath, "utf8")).default_text_style, settings.default_text_style);
});

test("array roots convert to objects and retain overwrite protection", async (t) => {
  const f = await fixture(t);
  await writeFile(f.captionsPath, JSON.stringify([{ edited: true }]));
  assert.equal((await f.run()).code, 1);
  assert.equal((await f.run("--force")).code, 0);
  assert.ok(Array.isArray(JSON.parse(await readFile(f.captionsPath, "utf8")).captions));
});

test("multiple sources require selection; IDs take precedence over paths", async (t) => {
  const f = await fixture(t);
  f.edit.sources.push({ id: "source/a.mp4", path: "source/b.mp4" });
  await writeFile(path.join(f.root, "edit.json"), JSON.stringify(f.edit));
  const refused = await f.run();
  assert.equal(refused.code, 1);
  assert.match(refused.stderr[0], /s1, source\/a.mp4/);
  assert.equal((await f.run("--source", "s1")).code, 0);
  assert.equal((await f.run("--source", "./source/a.mp4")).code, 0);
  assert.equal((await f.run("--source", path.join(f.root, "source/a.mp4"))).code, 0);
  assert.equal((await f.run("--source", "source/a.mp4")).code, 1);
});

test("missing or empty transcripts do not write captions", async (t) => {
  const f = await fixture(t);
  await rm(f.analysisPath);
  const missing = await f.run();
  assert.equal(missing.code, 1);
  assert.match(missing.stderr[0], /文字起こしがありません/);
  await writeFile(f.analysisPath, JSON.stringify({ transcript: [] }));
  const empty = await f.run();
  assert.equal(empty.code, 1);
  assert.match(empty.stderr[0], /発話がありません/);
  assert.equal(existsSync(f.captionsPath), false);
});

test("options are forwarded and invalid values fail without writing", async (t) => {
  const f = await fixture(t);
  for (const args of [["--unknown"], ["--readout"], ["--readout", "NaN"], ["--min-duration", "-1"], ["--max-chars", "1.5"]]) {
    assert.equal((await f.run(...args)).code, 1);
    assert.equal(existsSync(f.captionsPath), false);
  }
  const result = await f.run("--dry-run", "--readout", "0.5", "--min-duration", "3", "--max-chars", "2");
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout[0]).captions[0].end, 3);
});

test("help and no arguments print usage", async () => {
  for (const args of [[], ["--help"]]) {
    const lines = [];
    assert.equal(await runCaptionsCli(args, { stdout: (line) => lines.push(line) }), 0);
    assert.equal(lines[0].split("\n")[0], "使い方: akari captions <project-dir> [options]");
  }
});

test("split and limit options control phrase boundaries", async (t) => {
  const f = await fixture(t);
  const text = "あいうえおかきくけこさしすせそたちつてとなにぬねの";
  const words = Array.from(text).map((text, i) => ({ text, start: i * 0.2, end: (i + 1) * 0.2 }));
  await writeFile(f.analysisPath, JSON.stringify({ transcript: [{ start: 0, end: 5, text, words }] }));
  for (const [args, count] of [[[], 2], [["--max-chars", "0"], 1], [["--max-chars", "0", "--max-seconds", "2"], 3]]) {
    const result = await f.run("--dry-run", ...args);
    assert.equal(result.code, 0, result.stderr.join("\n"));
    assert.equal(JSON.parse(result.stdout[0]).captions.length, count);
  }
  await writeFile(f.analysisPath, JSON.stringify({ transcript: [{ start: 0, end: 4, text: "前。後", words: [{ text: "前。", start: 0, end: 1 }, { text: "後", start: 2, end: 4 }] }] }));
  assert.equal(JSON.parse((await f.run("--dry-run")).stdout[0]).captions.length, 2);
  assert.equal(JSON.parse((await f.run("--dry-run", "--split", "none")).stdout[0]).captions.length, 1);
  await writeFile(f.analysisPath, JSON.stringify({ transcript: [{ start: 0, end: 4, text: "前後", words: [{ text: "前", start: 0, end: 1 }, { text: "後", start: 2, end: 4 }] }] }));
  assert.equal(JSON.parse((await f.run("--dry-run", "--pause", "2")).stdout[0]).captions.length, 1);
  for (const args of [["--split", "bad"], ["--pause", "-1"], ["--max-seconds", "NaN"]]) assert.equal((await f.run(...args)).code, 1);
});

test("word books apply by default and explicitly, count changed records, and honor opt-out", async (t) => {
  const f = await fixture(t);
  const book = { version: 0, entries: [{ surface: "動画編集", variants: ["動画面集"], kind: "term" }] };
  const extra = path.join(f.root, "extra.json");
  await writeWordBookFile(extra, book);
  const text = "動画面集動画面集";
  await writeFile(f.analysisPath, JSON.stringify({ transcript: [{ start: 0, end: 4, text, words: [{ text: "動画面集", start: 0, end: 2 }, { text: "動画面集", start: 2, end: 4 }] }] }));
  const explicit = await f.run("--dry-run", "--word-book", extra);
  assert.equal(explicit.code, 0, explicit.stderr.join("\n"));
  assert.equal(JSON.parse(explicit.stdout[0]).captions[0].text, "動画編集動画編集");
  assert.equal(JSON.parse(explicit.stdout[1]).word_book.applied, 1);
  assert.equal(existsSync(f.captionsPath), false);
  const disabled = await f.run("--dry-run", "--word-book", extra, "--no-word-book");
  assert.equal(JSON.parse(disabled.stdout[0]).captions[0].text, text);
  assert.equal(JSON.parse(disabled.stdout[1]).word_book.applied, 0);
  await writeWordBookFile(path.join(f.root, ".akari/memory/word-book.json"), book);
  const automatic = await f.run();
  assert.equal(automatic.code, 0, automatic.stderr.join("\n"));
  assert.equal(JSON.parse(automatic.stdout[0]).word_book.applied, 1);
  assert.equal(JSON.parse(await readFile(f.captionsPath, "utf8")).captions[0].text, "動画編集動画編集");
  assert.equal(JSON.parse((await f.run("--dry-run", "--no-word-book")).stdout[1]).word_book.applied, 0);
});

test("probe duration caps the final caption", async (t) => {
  const f = await fixture(t);
  const analysis = JSON.parse(await readFile(f.analysisPath, "utf8"));
  analysis.probe = { duration_s: 10 };
  await writeFile(f.analysisPath, JSON.stringify(analysis));
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr.join("\n"));
  assert.equal(JSON.parse(await readFile(f.captionsPath, "utf8")).captions.at(-1).end, 10);
});
