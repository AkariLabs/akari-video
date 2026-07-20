import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-plan.mjs");
const fixtureRoot = join(packageRoot, "fixtures", "plan");

function run(fixture) {
  return spawnSync(process.execPath, [cliPath, join(fixtureRoot, fixture, "plan.json")], {
    encoding: "utf8",
  });
}

test("valid plan passes without findings", () => {
  const executed = run("valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("duplicate slot ids fail", () => {
  const executed = run("invalid-duplicate-slot-id");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /slots\[\]\.id が重複しています: s-dup/);
});

test("missing required slot field fails", () => {
  const executed = run("invalid-missing-required-field");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /target_duration_seconds は必須です/);
});

test("unknown confidence value fails", () => {
  const executed = run("invalid-bad-confidence-enum");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /confidence は proposed \/ locked \/ filled/);
});

test("constraint referencing a missing slot fails", () => {
  const executed = run("invalid-constraint-bad-applies-to");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /applies_to が slots\[\]\.id を参照していません: s-nope/);
});

test("dangling media path fails", () => {
  const executed = run("invalid-dangling-media-path");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /image_path が実ファイルに解決できません/);
});

test("newer plan.json version stops honestly", () => {
  const executed = run("unsupported-version");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /新しい形式です。スキル \/ アプリを更新してください/);
});

test("confidence gaps and duration_exact drift warn without failing", () => {
  const executed = run("warns-confidence-gap");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stderr, /fill\.method が未決/);
  assert.match(executed.stderr, /media がすべて null/);
  assert.match(executed.stderr, /duration_exact .* と一致していません/);
  assert.match(executed.stdout, /warnings\)/);
});
