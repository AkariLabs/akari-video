import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-review.mjs");
const fixtureRoot = join(packageRoot, "fixtures", "review");
const sampleRoot = join(packageRoot, "examples", "review-v1-sample");

function run(fixture) {
  return spawnSync(process.execPath, [cliPath, join(fixtureRoot, fixture, "review.json")], {
    encoding: "utf8",
  });
}

test("valid review.json (video + doc: + image: targets) passes", () => {
  const executed = run("valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("example review-v1-sample still passes (regression, contract-2026-07-15 v0)", () => {
  const executed = spawnSync(process.execPath, [cliPath, join(sampleRoot, "review.json")], {
    encoding: "utf8",
  });
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("sourceT: null on a video-face annotation (no doc:/image: target) fails", () => {
  const executed = run("invalid-video-null-sourcet");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /sourceT は target が doc: \/ image: のときに限り null を許容します/);
});

test("doc: target without #block-id fails", () => {
  const executed = run("invalid-malformed-doc-target");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /target は doc:<プロジェクト相対パス>#<block-id> の形式である必要があります/);
});

test("image: target without a path fails", () => {
  const executed = run("invalid-malformed-image-target");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /target は image:<プロジェクト相対パス> の形式である必要があります/);
});
