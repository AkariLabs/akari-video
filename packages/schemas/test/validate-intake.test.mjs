import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-intake.mjs");
const fixtureRoot = join(packageRoot, "fixtures", "intake");

function run(caseName) {
  const target = join(fixtureRoot, caseName, "intake.json");
  return spawnSync(process.execPath, [cliPath, target], { encoding: "utf8" });
}

test("valid draft intake.json passes (empty tasks, undecided target)", () => {
  const executed = run("valid-draft");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("valid submitted intake.json passes (tasks + target + submitted_at set)", () => {
  const executed = run("valid-submitted");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("unknown task id is rejected (skill catalog enum enforcement)", () => {
  const executed = run("invalid-unknown-task");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /tasks\[1\] は transcribe-captions \/ silence-cut \/ bgm-sfx \/ narration \/ 3d-inserts のいずれかである必要があります/,
  );
});

test("status submitted without submitted_at is rejected", () => {
  const executed = run("invalid-missing-submitted-at");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /status が submitted のとき submitted_at は ISO 8601 日時である必要があります/,
  );
});

test("duration_s and keep_length: true are mutually exclusive", () => {
  const executed = run("invalid-target-exclusive");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /排他/);
});

test("duplicate task ids are rejected", () => {
  const executed = run("invalid-duplicate-task");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /tasks に重複があります: silence-cut/);
});

test("missing input file fails with a clear message", () => {
  const executed = spawnSync(
    process.execPath,
    [cliPath, join(fixtureRoot, "does-not-exist", "intake.json")],
    { encoding: "utf8" },
  );
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /intake\.json が見つかりません/);
});
