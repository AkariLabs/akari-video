import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-generation-meta.mjs");
const fixtureRoot = join(packageRoot, "fixtures", "generation-meta");

for (const fixture of ["planned", "generating", "stale", "done", "failed", "still", "still-next", "planned-next", "generating-placeholder"]) {
  test(`${fixture}.json は generation-meta v1 に適合する`, () => {
    const executed = spawnSync(process.execPath, [cliPath, join(fixtureRoot, `${fixture}.json`)], {
      encoding: "utf8",
    });
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stdout, /^OK: /);
    assert.equal(executed.stderr.trim(), "");
  });
}

test("引数なしは使い方を表示して exit code 2", () => {
  const executed = spawnSync(process.execPath, [cliPath], { encoding: "utf8" });
  assert.equal(executed.status, 2);
  assert.match(executed.stderr, /使い方:/);
});

test("未定義キーを持つサイドカーは NG になる", () => {
  const done = JSON.parse(fs.readFileSync(join(fixtureRoot, "done.json"), "utf8"));
  done.provenance.provider_request_id = "not-allowed";
  const result = validateTemporary(done);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^NG: /);
  assert.match(result.stderr, /未定義キー provider_request_id/);
});

test("status generating で job.request_id が無いと NG になる", () => {
  const generating = JSON.parse(fs.readFileSync(join(fixtureRoot, "generating.json"), "utf8"));
  delete generating.job.request_id;
  const result = validateTemporary(generating);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\/job に必須キー request_id がありません/);
});

test("status done で result が無いと NG になる", () => {
  const done = JSON.parse(fs.readFileSync(join(fixtureRoot, "done.json"), "utf8"));
  delete done.result;
  const result = validateTemporary(done);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\/ に必須キー result がありません/);
});

test("inputs.extra はモデル固有引数を保存できる", () => {
  const done = JSON.parse(fs.readFileSync(join(fixtureRoot, "done.json"), "utf8"));
  done.inputs.extra = { prompt_expansion_mode: "off" };
  const result = validateTemporary(done);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^OK: /);
});

test("audio planned kind is accepted and unknown kind is rejected", () => {
  const planned = JSON.parse(fs.readFileSync(join(fixtureRoot, "planned.json"), "utf8"));
  planned.kind = "audio";
  planned.inputs.prompt = "";
  assert.equal(validateTemporary(planned).status, 0);
  planned.kind = "unknown";
  assert.equal(validateTemporary(planned).status, 1);
});

function validateTemporary(value) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generation-meta-schema-"));
  const target = path.join(root, "sample.mp4.meta.json");
  try {
    fs.writeFileSync(target, JSON.stringify(value));
    return spawnSync(process.execPath, [cliPath, target], { encoding: "utf8" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const [fixture, mutate] of [
  ["still-next", (meta) => { meta.next.kind = "still"; }],
  ["generating-placeholder", (meta) => { meta.placeholder.sha256 = "invalid"; }],
]) {
  test(`${fixture} の不正な next / placeholder を拒否する`, () => {
    const meta = JSON.parse(fs.readFileSync(join(fixtureRoot, `${fixture}.json`), "utf8"));
    mutate(meta);
    assert.equal(validateTemporary(meta).status, 1);
  });
}
