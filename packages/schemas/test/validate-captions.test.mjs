import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");
const cliPath = join(packageRoot, "bin", "validate-captions.mjs");
const exampleRoot = join(packageRoot, "examples");

function runPath(captionsPath) {
  return spawnSync(process.execPath, [cliPath, captionsPath], { encoding: "utf8" });
}

function run(exampleDir) {
  return runPath(join(exampleRoot, exampleDir, "captions.json"));
}

for (const example of [
  "captions-text-style-omitted-valid",
  "captions-text-style-default-only-valid",
  "captions-text-style-record-override-valid",
]) {
  test(`${example} passes`, () => {
    const executed = run(example);
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stdout, /^OK: /);
  });
}

for (const [example, message] of [
  ["captions-text-style-opacity-out-of-range-invalid", /background\.opacity/],
  ["captions-text-style-zone-invalid", /\.zone/],
  ["captions-text-style-size-non-positive-invalid", /\.size_px/],
  ["captions-text-style-color-non-hex-invalid", /\.color/],
]) {
  test(`${example} fails deterministically`, () => {
    const executed = run(example);
    assert.equal(executed.status, 1, executed.stdout);
    assert.match(executed.stderr, /^NG: /);
    assert.match(executed.stderr, message);
  });
}

for (const captionsPath of [
  "packages/edit-lint/fixtures/captions-words-valid/captions.json",
  "packages/edit-lint/fixtures/captions-reveal-valid/captions.json",
  "packages/edit-lint/fixtures/captions-display-text-valid/captions.json",
  "skills/address-review/dev-fixtures/fixture-project/captions.json",
  "apps/shell/extensions/akari-annotations/evidence/timeline-tracks/fixture/captions.json",
]) {
  test(`existing captions remain valid unchanged: ${captionsPath}`, () => {
    const executed = runPath(join(repositoryRoot, captionsPath));
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stdout, /^OK: /);
  });
}
