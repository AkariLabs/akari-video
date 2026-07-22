import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-edit.mjs");
const exampleRoot = join(packageRoot, "examples");

function run(exampleDir) {
  return spawnSync(process.execPath, [cliPath, join(exampleRoot, exampleDir, "edit.json")], {
    encoding: "utf8",
  });
}

test("existing v0 sample passes unchanged (non-regression)", () => {
  const executed = run("edit-v0-sample");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("existing v1 sample passes unchanged (non-regression)", () => {
  const executed = run("edit-v1-sample");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("narration with bgm and full provenance passes", () => {
  const executed = run("edit-narration-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("narration id must match n-#### pattern", () => {
  const executed = run("edit-narration-invalid-id");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /audio\.narration\[0\]\.id は n- に続く 4 桁の数字である必要があります/,
  );
});

test("narration gain_db must stay within [-60, 12]", () => {
  const executed = run("edit-narration-gain-out-of-range");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /audio\.narration\[0\]\.gain_db は -60 から 12 の範囲の有限数である必要があります/,
  );
});

test("narration provenance is required", () => {
  const executed = run("edit-narration-missing-provenance");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /audio\.narration\[0\]\.provenance は object である必要があります/,
  );
});

test("voicevox provider requires credit", () => {
  const executed = run("edit-narration-voicevox-missing-credit");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /audio\.narration\[0\]\.provenance\.credit は provider が voicevox のとき必須です/,
  );
});

test("bgm + sfx (2 items) + narration coexist and pass", () => {
  const executed = run("edit-bgm-sfx-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("bgm.path is required", () => {
  const executed = run("edit-bgm-missing-path");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.bgm\.path は空でない文字列である必要があります/);
});

test("bgm/sfx gain_db must stay within [-60, 12]", () => {
  const executed = run("edit-bgm-sfx-gain-out-of-range");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /audio\.bgm\.gain_db は -60 から 12 の範囲の有限数である必要があります/,
  );
  assert.match(
    executed.stderr,
    /audio\.sfx\[0\]\.gain_db は -60 から 12 の範囲の有限数である必要があります/,
  );
});

test("bgm.ducking must be a boolean", () => {
  const executed = run("edit-bgm-ducking-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.bgm\.ducking は boolean である必要があります/);
});

test("sfx[].t must be a non-negative finite number", () => {
  const executed = run("edit-sfx-t-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /audio\.sfx\[0\]\.t は 0 以上の有限数である必要があります/);
});

test("v1 (sources form) with bgm/sfx passes ($defs/audio is shared by v0 and v1)", () => {
  const executed = run("edit-v1-bgm-sfx-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});
