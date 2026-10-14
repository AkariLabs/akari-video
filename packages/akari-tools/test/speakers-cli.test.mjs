import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { setLanguage } from "../../i18n/index.mjs";

import { runSpeakersCli } from "../bin/speakers.mjs";

setLanguage("ja");
after(() => setLanguage(undefined));

const temporaryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.tmp-lane");
const json = async file => JSON.parse(await readFile(file, "utf8"));

test("set・list・clear は辞書の他キーと側ファイルの決定を保つ", async t => {
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot, "speaker-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "channels", "demo", "videos", "clip");
  const channel = path.dirname(path.dirname(project));
  const source = path.join(project, "assets", "source.wav");
  const dictionaryPath = path.join(project, ".akari", "dictionary.json");
  const voicesPath = path.join(project, ".akari", "sidecars", "assets", "source.wav.analysis", "voices.json");
  await mkdir(path.dirname(source), { recursive: true });
  await mkdir(path.dirname(voicesPath), { recursive: true });
  await writeFile(source, "音声");
  await writeFile(dictionaryPath, JSON.stringify({ other: 7, speakers: { B: { name: "既存" } } }));
  await writeFile(voicesPath, JSON.stringify({ schema: "akari.voices/0", speakers: { A: { seconds: 2, suggestion: { name: "候補", score: .8, level: "strong" } } }, decided: { B: "demo/old" } }));
  await writeFile(path.join(channel, "people.json"), JSON.stringify({ entries: [{ kind: "person", id: "p1", name: "一郎" }] }));
  const lines = [], errors = [];
  const options = { cwd: project, stdout: line => lines.push(line), stderr: line => errors.push(line) };
  assert.equal(await runSpeakersCli(["set", "assets/source.wav", "A", "--person", "demo/p1"], options), 0);
  assert.deepEqual((await json(dictionaryPath)).speakers.A, { name: "一郎", person: "demo/p1" });
  assert.equal((await json(voicesPath)).decided.A, "demo/p1");
  assert.equal(await runSpeakersCli(["set", "assets/source.wav", "A", "--name", "呼び名"], options), 0);
  assert.equal((await json(dictionaryPath)).speakers.A.name, "呼び名");
  assert.equal((await json(voicesPath)).decided.A, "demo/p1");
  assert.equal(await runSpeakersCli(["list", "assets/source.wav", "--json"], options), 0);
  const rows = JSON.parse(lines.at(-1)).speakers;
  assert.equal(rows.find(row => row.id === "A").seconds, 2);
  assert.equal(rows.find(row => row.id === "A").suggestion.level, "strong");
  assert.equal(rows.find(row => row.id === "A").decided.name, "呼び名");
  assert.equal(await runSpeakersCli(["set", "assets/source.wav", "A", "--clear"], options), 0);
  assert.equal(Object.hasOwn((await json(dictionaryPath)).speakers, "A"), false);
  assert.equal((await json(dictionaryPath)).other, 7);
  assert.deepEqual((await json(dictionaryPath)).speakers.B, { name: "既存" });
  assert.equal(Object.hasOwn((await json(voicesPath)).decided, "A"), false);
  assert.deepEqual(errors, []);
});

test("プロジェクト外の素材は拒む", async t => {
  const source = process.platform === "win32"
    ? path.join(process.env.SystemRoot, "System32", "drivers", "etc", "hosts")
    : "/etc/hosts";
  const errors = [];
  assert.equal(await runSpeakersCli(["list", source], { cwd: path.dirname(source), stderr: line => errors.push(line) }), 1);
  assert.match(errors[0], /プロジェクト内/);
});
