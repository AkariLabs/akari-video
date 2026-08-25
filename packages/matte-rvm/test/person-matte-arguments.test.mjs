import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DECODE_WIDTH,
  DEFAULT_FPS,
  DEFAULT_QUALITY,
  parseArguments,
} from "../../../skills/analyze-footage/bin/person-matte/person-matte.mjs";

test("person-matte keeps the existing non-best defaults", () => {
  const options = parseArguments([]);
  assert.equal(options.quality, DEFAULT_QUALITY);
  assert.equal(options.quality, "balanced");
  assert.equal(options.fps, DEFAULT_FPS);
  assert.equal(options.fps, 24);
  assert.equal(options.decodeWidth, DEFAULT_DECODE_WIDTH);
  assert.equal(options.decodeWidth, 1280);
  assert.equal(options.model, "mobilenetv3");
  assert.equal(options.modelExplicit, false);
});

test("person-matte accepts best with either managed model", () => {
  assert.equal(parseArguments(["--quality", "best"]).model, "mobilenetv3");
  assert.equal(
    parseArguments(["--quality", "best", "--model", "resnet50"]).model,
    "resnet50",
  );
});

test("person-matte rejects --model outside best", () => {
  assert.throws(
    () => parseArguments(["--quality", "balanced", "--model", "resnet50"]),
    /--model は --quality best のときだけ/,
  );
});

test("person-matte rejects an unknown model", () => {
  assert.throws(
    () => parseArguments(["--quality", "best", "--model", "unknown"]),
    /--model は mobilenetv3 \/ resnet50/,
  );
});
