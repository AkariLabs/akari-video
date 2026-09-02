import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runWordBookCli } from "../bin/word-book.mjs";
import { writeWordBookFile } from "../../word-book/src/index.mjs";

async function fixture(name, { workspace = true } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), `word-book-cli-${name}-`));
  const root = path.join(temporary, "creator");
  const project = workspace ? path.join(root, "channels", "c", "videos", "p") : path.join(temporary, "project");
  await mkdir(path.join(project, ".akari"), { recursive: true });
  const env = { HOME: temporary, AKARI_HOME: path.join(temporary, "machine") };
  if (workspace) {
    await mkdir(path.join(root, ".akari"), { recursive: true });
    await writeFile(path.join(root, ".akari", "root.json"), JSON.stringify({ schema: "creator-root/v1" }));
    env.AKARI_CREATOR_ROOT = root;
  }
  return { temporary, root, project, env };
}

function io() {
  const lines = [];
  const errors = [];
  return { lines, errors, stdout: (line) => lines.push(line), stderr: (line) => errors.push(line) };
}

test("resolve --json は層と channel 勝ちの sources を返す", async () => {
  const value = await fixture("resolve");
  await writeWordBookFile(path.join(value.root, ".akari", "memory", "word-book.json"), { version: 0, entries: [{ surface: "AKARI Video", variants: ["workspace"], kind: "term" }] });
  await writeWordBookFile(path.join(value.root, "channels", "c", ".akari", "memory", "word-book.json"), { version: 0, entries: [{ surface: "AKARI Video", variants: ["channel"], kind: "term" }] });
  const output = io();
  assert.equal(await runWordBookCli(["resolve", "--project", value.project, "--json"], { ...output, env: value.env }), 0);
  const resolved = JSON.parse(output.lines[0]);
  assert.deepEqual(resolved.layers.map((layer) => layer.scope), ["project", "channel", "workspace", "builtin"]);
  assert.equal(resolved.sources["AKARI Video"], "channel");
  await rm(value.temporary, { recursive: true, force: true });
});

test("add は作業場なしの workspace scope を exit 2 で拒否する", async () => {
  const value = await fixture("reject", { workspace: false });
  const output = io();
  assert.equal(await runWordBookCli(["add", "--surface", "語", "--scope", "workspace", "--project", value.project], { ...output, env: value.env }), 2);
  assert.match(output.errors.join("\n"), /作業場がありません（お試しモード）/);
  await rm(value.temporary, { recursive: true, force: true });
});

test("add は channel scope に entry を追加する", async () => {
  const value = await fixture("add");
  const output = io();
  assert.equal(await runWordBookCli(["add", "--surface", "AKARI Video", "--variant", "あかりビデオ", "--protect-break", "--scope", "channel", "--project", value.project], { ...output, env: value.env }), 0);
  const file = path.join(value.root, "channels", "c", ".akari", "memory", "word-book.json");
  const book = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(book.entries[0].protect_break, true);
  assert.equal(book.entries[0].source, "manual");
  await rm(value.temporary, { recursive: true, force: true });
});

test("apply --dry-run は analysis と captions の件数だけを返す", async () => {
  const value = await fixture("dry-run");
  await prepareApplyFixture(value);
  const analysisPath = path.join(value.project, ".akari", "sidecars", "assets", "source.wav.analysis", "analysis.json");
  const before = readFileSync(analysisPath, "utf8");
  const output = io();
  assert.equal(await runWordBookCli(["apply", "--project", value.project, "--dry-run", "--json"], { ...output, env: value.env }), 0);
  const result = JSON.parse(output.lines[0]);
  assert.equal(result.analysis.stats.replaced, 1);
  assert.equal(result.captions.unedited_matches, 1);
  assert.equal(result.captions.edited_matches, 1);
  assert.equal(readFileSync(analysisPath, "utf8"), before);
  await rm(value.temporary, { recursive: true, force: true });
});

test("apply は analysis.json を更新し再実行は冪等", async () => {
  const value = await fixture("apply");
  await prepareApplyFixture(value);
  const output = io();
  assert.equal(await runWordBookCli(["apply", "--project", value.project, "--json"], { ...output, env: value.env }), 0);
  const analysisPath = path.join(value.project, ".akari", "sidecars", "assets", "source.wav.analysis", "analysis.json");
  const first = readFileSync(analysisPath, "utf8");
  const analysis = JSON.parse(first);
  assert.deepEqual(analysis.transcript[0].words[0], { start: 0, end: 0.9, text: "AKARI Video" });
  assert.equal(analysis.transcript[0].text, "AKARI Videoです");
  const secondOutput = io();
  assert.equal(await runWordBookCli(["apply", "--project", value.project, "--json"], { ...secondOutput, env: value.env }), 0);
  assert.equal(JSON.parse(secondOutput.lines[0]).analysis.stats.replaced, 0);
  assert.equal(readFileSync(analysisPath, "utf8"), first);
  await rm(value.temporary, { recursive: true, force: true });
});

test("validate は validator と同じ exit code を返す", async () => {
  const value = await fixture("validate", { workspace: false });
  const valid = path.join(value.temporary, "valid.json");
  const invalid = path.join(value.temporary, "invalid.json");
  await writeFile(valid, JSON.stringify({ version: 0, entries: [] }));
  await writeFile(invalid, JSON.stringify({ version: 1, entries: [] }));
  assert.equal(await runWordBookCli(["validate", valid], { ...io(), env: value.env }), 0);
  assert.equal(await runWordBookCli(["validate", invalid], { ...io(), env: value.env }), 1);
  await rm(value.temporary, { recursive: true, force: true });
});

async function prepareApplyFixture(value) {
  await writeWordBookFile(path.join(value.project, ".akari", "memory", "word-book.json"), { version: 0, entries: [{ surface: "AKARI Video", variants: ["あかりビデオ"], kind: "term" }] });
  const analysisDirectory = path.join(value.project, ".akari", "sidecars", "assets", "source.wav.analysis");
  await mkdir(analysisDirectory, { recursive: true });
  await writeFile(path.join(analysisDirectory, "analysis.json"), `${JSON.stringify({
    version: 0,
    source: "../../../../assets/source.wav",
    transcript: [{ text: "あかり ビデオです", start: 0, end: 1.2, words: [{ start: 0, end: 0.4, text: "あかり" }, { start: 0.4, end: 0.9, text: "ビデオ" }, { start: 0.9, end: 1.2, text: "です" }] }],
    keyframes: [], events: [], tracks: { speakers: [], faces: [], person_matte: null },
  }, null, 2)}\n`);
  await writeFile(path.join(value.project, "captions.json"), `${JSON.stringify({ captions: [
    { id: "c-0001", start: 0, end: 1, text: "あかりビデオ", speaker: null, sourceRef: null, edited: false, words: [{ start: 0, end: 1, text: "あかりビデオ" }] },
    { id: "c-0002", start: 1, end: 2, text: "あかりビデオ", speaker: null, sourceRef: null, edited: true, words: [{ start: 1, end: 2, text: "あかりビデオ" }] },
  ] }, null, 2)}\n`);
}
