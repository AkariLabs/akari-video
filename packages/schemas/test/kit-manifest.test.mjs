import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const exampleRoot = join(packageRoot, "examples");
const cliPath = join(packageRoot, "bin", "validate-kit-manifest.mjs");
const schema = JSON.parse(readFileSync(join(packageRoot, "kit-manifest.schema.json"), "utf8"));
const validate = new Ajv2020({ strict: false }).compile(schema);

function readManifest(fixture) {
  return JSON.parse(readFileSync(join(exampleRoot, fixture, "manifest.json"), "utf8"));
}

function run(fixture, ...args) {
  return spawnSync(process.execPath, [cliPath, join(exampleRoot, fixture), ...args], {
    encoding: "utf8",
  });
}

test("kit manifest schema accepts the valid schemaVersion 1 fixture", () => {
  assert.equal(validate(readManifest("kit-manifest-v1-valid")), true, JSON.stringify(validate.errors));
});

test("kit manifest schema rejects a missing required field", () => {
  assert.equal(validate(readManifest("kit-manifest-v1-invalid-missing-required")), false);
  assert.ok(validate.errors?.some((error) => error.keyword === "required" && error.params.missingProperty === "license"));
});

test("kit manifest schema rejects a kind other than kit", () => {
  assert.equal(validate(readManifest("kit-manifest-v1-invalid-kind")), false);
  assert.ok(validate.errors?.some((error) => error.instancePath === "/kind" && error.keyword === "const"));
});

test("validate-kit-manifest accepts the valid fixture", () => {
  const executed = run("kit-manifest-v1-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr, "");
});

const invalidCases = [
  ["kit-manifest-v1-invalid-missing-required", /必須フィールドがありません: license/],
  ["kit-manifest-v1-invalid-kind", /kind は "kit" である必要があります/],
  ["kit-manifest-v1-invalid-skill-dir", /skills\[0\]\.dir が見つかりません/],
  ["kit-manifest-v1-invalid-skill-name", /SKILL\.md frontmatter の name が一致しません/],
  ["kit-manifest-v1-invalid-runtime", /未登録の runtime id があります: no-such-runtime/],
  ["kit-manifest-v1-name-collision", /公開スキル名と重複しています: edit-lint/],
];

for (const [fixture, message] of invalidCases) {
  test(`validate-kit-manifest rejects ${fixture}`, () => {
    const executed = run(fixture);
    assert.equal(executed.status, 1, executed.stderr);
    assert.match(executed.stderr, message);
  });
}

test("validate-kit-manifest --json emits the documented result shape", () => {
  const executed = run("kit-manifest-v1-valid", "--json");
  assert.equal(executed.status, 0, executed.stderr);
  const result = JSON.parse(executed.stdout);
  assert.deepEqual(Object.keys(result), ["ok", "errors", "warnings"]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("--public-skills switches collision checking to the supplied empty directory", () => {
  const emptySkills = mkdtempSync(join(tmpdir(), "akari-public-skills-"));
  try {
    const executed = run("kit-manifest-v1-name-collision", "--public-skills", emptySkills);
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stdout, /^OK: /);
  } finally {
    rmSync(emptySkills, { recursive: true, force: true });
  }
});
