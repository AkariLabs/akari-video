import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { BLENDSHAPE_NAMES } from "./artifacts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, "../../references/vision-tracks.schema.json"), "utf8"));

test("face-expression kind と detection が additive に配線される", () => {
  assert.ok(schema.properties.kind.enum.includes("face-expression"));
  assert.ok(schema.$defs.detection.anyOf.some((entry) => entry.$ref === "#/$defs/faceExpressionDetection"));
  assert.deepEqual(schema.$defs.faceExpressionDetection.required, ["head", "blendshapes", "conf"]);
  assert.deepEqual(schema.$defs.faceExpressionHead.required, ["yaw", "pitch", "roll"]);
});

test("MediaPipe blendshape は既知 52 キーだけを 0..1 で受ける", () => {
  assert.equal(BLENDSHAPE_NAMES.length, 52);
  assert.equal(new Set(BLENDSHAPE_NAMES).size, 52);
  assert.deepEqual(schema.$defs.blendshapeName.enum, BLENDSHAPE_NAMES);
  assert.equal(schema.$defs.faceExpressionBlendshapes.minProperties, 52);
  assert.equal(schema.$defs.faceExpressionBlendshapes.maxProperties, 52);
  assert.deepEqual(schema.$defs.faceExpressionBlendshapes.additionalProperties, { $ref: "#/$defs/unit" });
});

test("provider provenance は runtime/model URL/SHA を optional に記録できる", () => {
  const provider = schema.properties.provider;
  assert.ok(!provider.required.includes("runtime"));
  assert.equal(provider.properties.model_sha256.pattern, "^[0-9a-f]{64}$");
});
