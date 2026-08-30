import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(packageRoot, "test", "fixtures");
const schema = JSON.parse(await readFile(join(packageRoot, "edit.schema.json"), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

async function fixture(name) {
  return JSON.parse(await readFile(join(fixtureRoot, name), "utf8"));
}

test("object-tree fixtures (a) through (h) are accepted", async () => {
  for (const name of [
    "object-tree-a-group.json", "object-tree-b-nested.json", "object-tree-c-html-bag.json",
    "object-tree-d-captions.json", "object-tree-e-keyframes-ref.json",
    "object-tree-f-motion-animator.json", "object-tree-g-z-order.json", "object-tree-h-content.json",
  ]) {
    const value = await fixture(name);
    assert.equal(validate(value), true, `${name}: ${JSON.stringify(validate.errors, null, 2)}`);
  }
});

test("group source rejects in/out", async () => {
  const value = await fixture("object-tree-a-group.json");
  value.tracks[0].items[0].source.in = 0;
  value.tracks[0].items[0].source.out = 1;
  assert.equal(validate(value), false);
});

test("caption source rejects part", async () => {
  const value = await fixture("object-tree-d-captions.json");
  value.tracks[0].items[0].items[0].source.part = "B";
  assert.equal(validate(value), false);
});

test("keyframe point without t is rejected", async () => {
  const value = await fixture("object-tree-f-motion-animator.json");
  delete value.tracks[0].items[0].keyframes[0].t;
  assert.equal(validate(value), false);
});

test("keyframeV2 remains tolerant of additive unknown properties", async () => {
  const value = await fixture("object-tree-f-motion-animator.json");
  value.tracks[0].items[0].keyframes[0].future_channel = { value: 1 };
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
});

test("closed item/source shapes still reject unrelated keys", async () => {
  const value = await fixture("object-tree-f-motion-animator.json");
  value.tracks[0].items[0].textStyle = {};
  assert.equal(validate(value), false);
  assert.ok(validate.errors?.some(error => error.keyword === "additionalProperties"));
});

test("validate-motion accepts the contract bag and rejects missing version", async () => {
  const motionPath = join(fixtureRoot, "motion", "g-motion.json");
  const valid = spawnSync(process.execPath, [join(packageRoot, "bin", "validate-motion.mjs"), motionPath], { encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);

  const invalidPath = join(fixtureRoot, "motion", "missing-version.json");
  const invalid = JSON.parse(await readFile(motionPath, "utf8"));
  delete invalid.version;
  await writeFile(invalidPath, JSON.stringify(invalid));
  try {
    const result = spawnSync(process.execPath, [join(packageRoot, "bin", "validate-motion.mjs"), invalidPath], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /version/);
  } finally {
    await rm(invalidPath, { force: true });
  }
});

test("validate-edit applies inline ordering and reference paths recursively", async () => {
  const root = await mkdtemp(join(tmpdir(), "akari-validate-edit-tree-"));
  try {
    const value = await fixture("object-tree-b-nested.json");
    const leaf = value.tracks[0].items[0].items[0].items[0];
    leaf.keyframes = [{ t: 10 }, { t: 10 }];
    const editPath = join(root, "edit.json");
    await writeFile(editPath, JSON.stringify(value));
    const duplicate = spawnSync(process.execPath, [join(packageRoot, "bin", "validate-edit.mjs"), editPath], { encoding: "utf8" });
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /昇順かつ重複禁止/);

    leaf.keyframes = { path: "outside/root.json", count: 2 };
    await writeFile(editPath, JSON.stringify(value));
    const outside = spawnSync(process.execPath, [join(packageRoot, "bin", "validate-edit.mjs"), editPath], { encoding: "utf8" });
    assert.equal(outside.status, 1);
    assert.match(outside.stderr, /motion\/ 配下/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
