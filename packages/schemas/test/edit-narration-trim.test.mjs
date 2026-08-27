import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(packageRoot, "edit.schema.json"), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const fixturePath = join(packageRoot, "examples", "edit-narration-trim-valid", "edit.json");

test("narration in/out の有効な素材秒窓を受理する", () => {
  const value = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
});

test("narration in は非負、out は正数に制限する", () => {
  const base = JSON.parse(readFileSync(fixturePath, "utf8"));
  for (const [field, invalid] of [["in", -1], ["out", 0]]) {
    const value = structuredClone(base);
    value.audio.narration[0][field] = invalid;
    assert.equal(validate(value), false, field);
    assert.ok(
      validate.errors?.some(error => error.instancePath === `/audio/narration/0/${field}`),
      JSON.stringify(validate.errors, null, 2),
    );
  }
});
