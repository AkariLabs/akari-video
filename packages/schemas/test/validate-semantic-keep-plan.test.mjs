import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { createRequire } from "node:module";

import { validateSemanticKeepPlanSemantics } from "../../../skills/edit-plan/bin/contract-semantics.mjs";

const schema = JSON.parse(await readFile(new URL("../semantic-keep-plan.schema.json", import.meta.url), "utf8"));
const validateCanonical = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
const require = createRequire(import.meta.url);
const generated = require(path.resolve(import.meta.dirname, "../../../skills/edit-plan/bin/generated/contract-validators.cjs"));

function validPlan() {
  return {
    version: 1,
    kind: "akari-semantic-keep-plan-v1",
    intended_edit_version: 1,
    candidate_frame_rate: 30,
    sources: [{ id: "desk", path: "assets/desk.mp4" }],
    occurrences: [{ source_index: 0, range: { mode: "explicit", in: 0, out: 12 } }],
  };
}

test("canonical and generated validators accept the closed keep-plan contract", () => {
  const value = validPlan();
  assert.equal(validateCanonical(value), true, JSON.stringify(validateCanonical.errors));
  assert.equal(generated.validateSemanticKeepPlan(value), true, JSON.stringify(generated.validateSemanticKeepPlan.errors));
  assert.equal(validateSemanticKeepPlanSemantics(value), true);
});

test("schema parity rejects unknown fields and unsupported frame rates", () => {
  for (const mutate of [
    (value) => { value.unknown = true; },
    (value) => { value.candidate_frame_rate = 60; },
    (value) => { value.occurrences[0].range.out = 0; },
    (value) => { value.sources[0].path = "/absolute/source.mp4"; },
    (value) => { value.sources[0].path = "../outside.mp4"; },
  ]) {
    const value = validPlan();
    mutate(value);
    assert.equal(validateCanonical(value), false);
    assert.equal(generated.validateSemanticKeepPlan(value), false);
  }
});

test("semantic layer enforces v0 source form, unique v1 ids, and occurrence references", () => {
  const duplicate = validPlan();
  duplicate.sources.push({ id: "desk", path: "assets/other.mp4" });
  assert.throws(() => validateSemanticKeepPlanSemantics(duplicate), { code: "KEEP_PLAN_INVALID" });

  const dangling = validPlan();
  dangling.occurrences[0].source_index = 1;
  assert.throws(() => validateSemanticKeepPlanSemantics(dangling), { code: "KEEP_PLAN_INVALID" });

  const v0 = validPlan();
  v0.intended_edit_version = 0;
  assert.throws(() => validateSemanticKeepPlanSemantics(v0), { code: "KEEP_PLAN_INVALID" });
  v0.sources[0].id = null;
  assert.equal(validateSemanticKeepPlanSemantics(v0), true);
});
