import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../src/render-cut.mjs";

test("parseArguments backward-compat: omitting the new flags leaves quality/encoder/fps undefined and progress false", () => {
  const options = parseArguments(["/project"]);
  assert.equal(options.quality, undefined);
  assert.equal(options.encoder, undefined);
  assert.equal(options.fps, undefined);
  assert.equal(options.progress, false);
  assert.equal(options.out, null);
});

test("parseArguments accepts --quality/--encoder/--fps/--progress in both space and = forms", () => {
  const spaceForm = parseArguments(["/project", "--quality", "high", "--encoder", "videotoolbox", "--fps", "24", "--progress"]);
  assert.equal(spaceForm.quality, "high");
  assert.equal(spaceForm.encoder, "videotoolbox");
  assert.equal(spaceForm.fps, 24);
  assert.equal(spaceForm.progress, true);

  const equalsForm = parseArguments(["/project", "--quality=light", "--encoder=x264", "--fps=60"]);
  assert.equal(equalsForm.quality, "light");
  assert.equal(equalsForm.encoder, "x264");
  assert.equal(equalsForm.fps, 60);
});

test("parseArguments rejects an unknown --quality value", () => {
  assert.throws(() => parseArguments(["/project", "--quality", "ultra"]), /--quality must be one of/);
});

test("parseArguments rejects an unknown --encoder value", () => {
  assert.throws(() => parseArguments(["/project", "--encoder", "nvenc"]), /--encoder must be one of/);
});

test("parseArguments rejects a non-positive --fps", () => {
  assert.throws(() => parseArguments(["/project", "--fps", "0"]), /--fps must be a positive number/);
  assert.throws(() => parseArguments(["/project", "--fps", "-5"]), /--fps must be a positive number/);
  assert.throws(() => parseArguments(["/project", "--fps", "notanumber"]), /--fps must be a positive number/);
});

test("parseArguments still requires --quality/--encoder/--fps to have a value", () => {
  assert.throws(() => parseArguments(["/project", "--quality"]), /--quality requires a value/);
  assert.throws(() => parseArguments(["/project", "--encoder"]), /--encoder requires a value/);
  assert.throws(() => parseArguments(["/project", "--fps"]), /--fps requires a number/);
});

test("parseArguments keeps existing --out/--plan-only/--force behavior unchanged", () => {
  const options = parseArguments(["/project", "--out", "exports/x.mp4", "--plan-only", "--force"]);
  assert.equal(options.out, "exports/x.mp4");
  assert.equal(options.planOnly, true);
  assert.equal(options.force, true);
});
