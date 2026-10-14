import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runMediaCli } from "../bin/media.mjs";
import { runToolsCli } from "../bin/tools.mjs";
import { WHISPER_MODEL, installWhisperModel } from "../src/media/whisper-model.mjs";
import { transcribeMedia } from "../src/media/transcribe.mjs";
import { fixture } from "./fixtures/transcribe-compare/helpers.mjs";

const sink = () => { const chunks = []; return { chunks, write: (text) => { chunks.push(text); } }; };
const fakeModel = (body) => ({ file: "ggml-fake.bin", url: "https://example.invalid/ggml-fake.bin", sha256: createHash("sha256").update(body).digest("hex") });
const fakeFetch = (body, calls = []) => async (url) => { calls.push(url); return new Response(body, { status: 200, headers: { "content-length": String(body.length) } }); };
const tempHome = async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "akari-whisper-cli-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true, force: true })));
  return home;
};

test("the shipped model definition is the large-v3-turbo q5_0 pin", () => {
  assert.equal(WHISPER_MODEL.file, "ggml-large-v3-turbo-q5_0.bin");
  assert.match(WHISPER_MODEL.sha256, /^[0-9a-f]{64}$/);
  assert.ok(WHISPER_MODEL.url.endsWith(`/${WHISPER_MODEL.file}`));
});

test("install whisper downloads, verifies, and is idempotent", async (t) => {
  const home = await tempHome(t);
  const body = Buffer.from("fake ggml payload");
  const model = fakeModel(body);
  const calls = [];
  const out = sink(); const err = sink();
  const code = await runToolsCli(["install", "whisper", "--json"], { homeDir: home, stdout: out, stderr: err, fetchImpl: fakeFetch(body, calls), whisperModel: model });
  assert.equal(code, 0);
  const destination = path.join(home, ".akari", "tools", "models", model.file);
  assert.deepEqual(await readFile(destination), body);
  assert.equal(JSON.parse(out.chunks.join("")).outcome, "installed");
  assert.deepEqual(await readdir(path.dirname(destination)), [model.file]);
  assert.ok(err.chunks.some((line) => /100%/.test(line)));

  const again = sink();
  assert.equal(await runToolsCli(["install", "whisper", "--json"], { homeDir: home, stdout: again, stderr: sink(), fetchImpl: fakeFetch(body, calls), whisperModel: model }), 0);
  assert.equal(JSON.parse(again.chunks.join("")).outcome, "unchanged");
  assert.equal(calls.length, 1);
});

test("install whisper rejects a checksum mismatch and leaves nothing behind", async (t) => {
  const home = await tempHome(t);
  const model = fakeModel(Buffer.from("expected"));
  const result = await installWhisperModel({ homeDir: home, fetchImpl: fakeFetch(Buffer.from("tampered")), model });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(await readdir(path.join(home, ".akari", "tools", "models")), []);
  const http = await installWhisperModel({ homeDir: home, fetchImpl: async () => new Response("no", { status: 404 }), model });
  assert.equal(http.outcome, "failed");
  assert.match(http.message, /404/);
});

test("status whisper reports a model under ~/.akari/tools/models", async (t) => {
  const home = await tempHome(t);
  const env = { WHISPER_CPP_MODEL: undefined };
  await mkdir(path.join(home, ".akari", "tools", "models"), { recursive: true });
  await writeFile(path.join(home, ".akari", "tools", "models", "ggml-x.bin"), "x");
  const ready = sink();
  assert.equal(await runToolsCli(["status", "whisper", "--json"], { env, homeDir: home, stdout: ready, stderr: sink() }), 0);
  assert.equal(JSON.parse(ready.chunks.join("")).state, "ready");
});

test("tools usage mentions install whisper", async () => {
  const out = sink();
  assert.equal(await runToolsCli(["--help"], { stdout: out }), 0);
  assert.match(out.chunks.join(""), /install voice\|whisper/);
  assert.equal(await runToolsCli(["install", "nothing"], { stdout: out, stderr: sink() }), 2);
});

test("media --help works for every subcommand and transcribe lists its real options", async () => {
  for (const command of ["probe", "grab", "filmstrip", "waveform", "transcribe", "transcribe-diff", "transcribe-cuts", "audio-level"]) {
    for (const flag of ["--help", "-h"]) {
      const lines = []; const errors = [];
      assert.equal(await runMediaCli([command, flag], { stdout: (line) => lines.push(line), stderr: (line) => errors.push(line) }), 0, `${command} ${flag}`);
      assert.deepEqual(errors, []);
      assert.match(lines.join("\n"), /akari media/);
    }
  }
  const lines = [];
  await runMediaCli(["transcribe", "--help"], { stdout: (line) => lines.push(line) });
  const text = lines.join("\n");
  for (const option of ["--in", "--out", "--backend", "--lang", "speech-analyzer|whisper-cpp|cloud:<id>"]) assert.ok(text.includes(option), option);
});

test("SpeechAnalyzer failure without whisper explains how to get a model and keeps the original reason", async (t) => {
  const f = await fixture(t, []);
  const reason = '{"error":"Speech model installation request unavailable","code":5}';
  const options = { ...f.options, backend: undefined, speechAnalyzerAvailable: true, whisperAvailable: false, unrecognized: false, uiLanguage: "ja",
    backendRunner: async () => { throw new Error(reason); } };
  await assert.rejects(transcribeMedia(f.target, options), (error) => {
    assert.equal(error.code, "WHISPER_UNAVAILABLE");
    assert.equal(error.cause.message, reason);
    for (const expected of [reason, "akari tools install whisper", "WHISPER_CPP_MODEL", ".akari/tools/models", "ggml"]) {
      assert.ok(error.message.includes(expected), expected);
    }
    return true;
  });
  await assert.rejects(transcribeMedia(f.target, { ...options, uiLanguage: "en" }), /Fix \(any one\)[\s\S]*akari tools install whisper/);
});

test('whisper-model.mjs はアプリの backend（cjs）に束ねられるので top-level await を持つ i18n を引かない', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../src/media/whisper-model.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ["']\.\.\/i18n\.mjs["']/);
});
