import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../../render-cut/src/render-cut.mjs";

test("render-cut --engine は未指定を保ち legacy と osr を解釈する", () => {
  assert.equal(parseArguments(["proj"]).engine, undefined);
  assert.equal(parseArguments(["proj", "--engine", "legacy"]).engine, "legacy");
  assert.equal(parseArguments(["proj", "--engine", "osr"]).engine, "osr");
  assert.throws(() => parseArguments(["proj", "--engine", "bogus"]), /--engine/);
});
