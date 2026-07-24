import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-plan-comments.mjs");
const fixtureRoot = join(packageRoot, "fixtures", "plan-comments");

function run(fixture) {
  return spawnSync(process.execPath, [cliPath, join(fixtureRoot, fixture, "plan-comments.json")], {
    encoding: "utf8",
  });
}

test("valid plan-comments passes without findings", () => {
  const executed = run("valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("unknown top-level and comment fields still pass (tolerant reader)", () => {
  const executed = run("valid-unknown-fields");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("missing version fails", () => {
  const executed = run("invalid-missing-version");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /version は必須です/);
});

test("unknown pass value fails", () => {
  const executed = run("invalid-bad-pass");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /pass は structure \/ scaffold \/ final/);
});

test("comments not an array fails", () => {
  const executed = run("invalid-comments-not-array");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /comments は配列である必要があります/);
});

test("missing required comment field fails", () => {
  const executed = run("invalid-missing-comment-field");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /comments\[0\]\.target_id は必須です/);
});

test("unknown target_kind value fails", () => {
  const executed = run("invalid-bad-target-kind");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /target_kind は shot \/ slot \/ cut/);
});

test("non-numeric target_id for an index-based target_kind fails", () => {
  const executed = run("invalid-bad-target-id-for-index-kind");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /配列インデックスの数字文字列である必要があります: s-hook/);
});

test("newer plan-comments.json version stops honestly", () => {
  const executed = run("unsupported-version");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /新しい形式です。スキル \/ アプリを更新してください/);
});
