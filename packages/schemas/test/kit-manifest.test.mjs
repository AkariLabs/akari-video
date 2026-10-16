import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from 'node:crypto';
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

test('kit validator includes depth 3 template/media contents', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'akari-template-kit-'));
  try {
    cpSync(join(exampleRoot, 'kit-manifest-v1-valid'), scratch, { recursive: true });
    const dir = join(scratch, 'playbooks', 'pixel');
    mkdirSync(join(dir, 'template', 'media'), { recursive: true });
    const bytes = Buffer.from('pixel');
    writeFileSync(join(dir, 'template', 'media', 'pixel.png'), bytes);
    writeFileSync(join(dir, 'template', 'item.json'), JSON.stringify({ id: 'group', at: 0, duration: 30,
      source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } }, items: [
        { id: 'image', at: 0, duration: 30, source: { kind: 'media', src: 'template/media/pixel.png', in: 0, out: 1 } }
      ] }));
    const book = JSON.parse(readFileSync(join(packageRoot, '..', 'project-scaffold', 'test', 'fixtures', 'playbook-sample', 'playbook.json')));
    Object.assign(book, { id: 'pixel', depth: 3, placeholders: [], template: { item: 'template/item.json', fps: 30, width: 1080,
      height: 1920, durationSec: 1, slots: [], media: [{ path: 'template/media/pixel.png',
        sha256: createHash('sha256').update(bytes).digest('hex'), license: 'CC0-1.0', source: 'own' }] } });
    writeFileSync(join(dir, 'playbook.json'), JSON.stringify(book));
    writeFileSync(join(dir, 'playbook.md'), readFileSync(join(packageRoot, '..', 'project-scaffold', 'test', 'fixtures', 'playbook-sample', 'playbook.md')));
    const manifest = JSON.parse(readFileSync(join(scratch, 'manifest.json')));
    manifest.playbooks = [{ dir: 'playbooks/pixel' }];
    writeFileSync(join(scratch, 'manifest.json'), JSON.stringify(manifest));
    const executed = spawnSync(process.execPath, [cliPath, scratch], { encoding: 'utf8' });
    assert.equal(executed.status, 0, executed.stderr);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
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
