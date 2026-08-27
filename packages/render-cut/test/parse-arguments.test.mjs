import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments, resolveCaptureWorkers } from "../src/render-cut.mjs";

test("parseArguments defaults engine to auto while quality/encoder/fps stay undefined and progress stays false", () => {
  const options = parseArguments(["/project"]);
  assert.equal(options.engine, "auto");
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
  assert.throws(() => parseArguments(["/project", "--encoder", "future-encoder"]), /--encoder must be one of/);
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

test("parseArguments accepts capture workers in space and equals forms", () => {
  assert.deepEqual(
    parseArguments(["/project", "--capture-workers", "3"], {}),
    {
      projectRoot: "/project",
      planOnly: false,
      out: null,
      force: false,
      help: false,
      quality: undefined,
      encoder: undefined,
      engine: "auto",
      fps: undefined,
      captureWorkers: 3,
      captureWorkersSource: "cli",
      progress: false,
    },
  );
  const equalsForm = parseArguments(["/project", "--capture-workers=4"], {});
  assert.equal(equalsForm.captureWorkers, 4);
  assert.equal(equalsForm.captureWorkersSource, "cli");
});

test("capture worker parsing rejects invalid values", () => {
  for (const value of ["0", "-1", "1.5", "not-a-number", ""]) {
    assert.throws(
      () => parseArguments(["/project", `--capture-workers=${value}`], {}),
      new RegExp(`--capture-workers must be a positive integer, got:`),
    );
  }
  assert.throws(
    () => parseArguments(["/project", "--capture-workers"], {}),
    /--capture-workers requires a value/,
  );
});

test("AKARI_CAPTURE_WORKERS is the fallback and CLI has priority", () => {
  const fromEnvironment = parseArguments(["/project"], { AKARI_CAPTURE_WORKERS: "2" });
  assert.equal(fromEnvironment.captureWorkers, 2);
  assert.equal(fromEnvironment.captureWorkersSource, "env");

  const fromCli = parseArguments(
    ["/project", "--capture-workers", "4"],
    { AKARI_CAPTURE_WORKERS: "2" },
  );
  assert.equal(fromCli.captureWorkers, 4);
  assert.equal(fromCli.captureWorkersSource, "cli");
});

test("automatic capture workers are conservative for 3D and bounded for 2D", () => {
  assert.deepEqual(resolveCaptureWorkers({
    hasThreeDimensionalOverlay: false,
    parallelism: 8,
  }), { workers: 4, source: "auto" });
  assert.deepEqual(resolveCaptureWorkers({
    hasThreeDimensionalOverlay: false,
    parallelism: 3,
  }), { workers: 1, source: "auto" });
  assert.deepEqual(resolveCaptureWorkers({
    hasThreeDimensionalOverlay: true,
    parallelism: 8,
  }), { workers: 1, source: "auto" });
  assert.deepEqual(resolveCaptureWorkers({
    requestedWorkers: 4,
    requestedSource: "cli",
    hasThreeDimensionalOverlay: true,
    parallelism: 8,
  }), { workers: 4, source: "cli" });
});
