import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-review.mjs");
const fixtureRoot = join(packageRoot, "fixtures", "review");
const sampleRoot = join(packageRoot, "examples", "review-v1-sample");

function fixtureReview(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, name, "review.json"), "utf8"));
}

test("content-rect schema requires frame and keeps sessionRef optional but non-empty", () => {
  const schema = JSON.parse(readFileSync(join(packageRoot, "review.schema.json"), "utf8"));
  const contentRect = schema.$defs.stroke.oneOf.find((branch) => branch.properties.space.const === "content-rect");
  assert.ok(contentRect.required.includes("frame"));
  assert.ok(!contentRect.required.includes("sessionRef"));
  assert.deepEqual(contentRect.properties.sessionRef, { $ref: "#/$defs/nonEmptyString" });
});

test("review schema validates absent, present, empty, and non-string content-rect sessionRef", () => {
  const schema = JSON.parse(readFileSync(join(packageRoot, "review.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const direct = fixtureReview("valid-strokes-direct");
  assert.equal(validate(direct), true, JSON.stringify(validate.errors));
  for (const [sessionRef, expected] of [["s-0001/st-0001", true], ["", false], [5, false], [null, false]]) {
    const review = structuredClone(direct);
    review.annotations[0].strokes[0].sessionRef = sessionRef;
    assert.equal(validate(review), expected, `${String(sessionRef)}: ${JSON.stringify(validate.errors)}`);
  }
});

function run(fixture) {
  return spawnSync(process.execPath, [cliPath, join(fixtureRoot, fixture, "review.json")], {
    encoding: "utf8",
  });
}

test("valid review.json (video + doc: + image: targets) passes", () => {
  const executed = run("valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("example review-v1-sample still passes (regression, contract-2026-07-15 v0)", () => {
  const executed = spawnSync(process.execPath, [cliPath, join(sampleRoot, "review.json")], {
    encoding: "utf8",
  });
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("sourceT: null on a video-face annotation (no doc:/image: target) fails", () => {
  const executed = run("invalid-video-null-sourcet");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /sourceT は target が doc: \/ image: \/ canvas: のときに限り null を許容します/);
});

test("doc: target without #block-id fails", () => {
  const executed = run("invalid-malformed-doc-target");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /target は doc:<プロジェクト相対パス>#<block-id> の形式である必要があります/);
});

test("image: target without a path fails", () => {
  const executed = run("invalid-malformed-image-target");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /target は image:<プロジェクト相対パス> の形式である必要があります/);
});

test("strokes: content-rect (frame + sessionRef) and image-rect (frame omitted) both pass", () => {
  const executed = run("valid-strokes");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("content-rect stroke with sessionRef still passes validate-review", () => {
  const executed = run("valid-strokes");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("content-rect stroke without sessionRef passes and preserves point order", () => {
  const executed = run("valid-strokes-direct");
  assert.equal(executed.status, 0, executed.stderr);
  const review = JSON.parse(readFileSync(join(fixtureRoot, "valid-strokes-direct", "review.json"), "utf8"));
  assert.equal(review.annotations[0].input, "typed");
  assert.ok(!Object.hasOwn(review.annotations[0], "session"));
  assert.deepEqual(review.annotations[0].strokes[0].points, [[0.7, 0.8], [0.5, 0.4], [0.2, 0.6]]);
});

test("content-rect stroke with empty sessionRef fails", () => {
  const executed = run("invalid-strokes-content-rect-empty-sessionref");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /sessionRef を持たせる場合は空でない文字列である必要があります/);
});

test("content-rect stroke with a non-string sessionRef fails validate-review", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-review-sessionref-"));
  try {
    for (const sessionRef of [5, null]) {
      const review = fixtureReview("valid-strokes-direct");
      review.annotations[0].strokes[0].sessionRef = sessionRef;
      const reviewPath = join(directory, "review.json");
      await writeFile(reviewPath, `${JSON.stringify(review)}\n`, "utf8");
      const executed = spawnSync(process.execPath, [cliPath, reviewPath], { encoding: "utf8" });
      assert.equal(executed.status, 1, String(sessionRef));
      assert.match(executed.stderr, /sessionRef を持たせる場合は空でない文字列である必要があります/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("strokes with an unrecognized space value fails", () => {
  const executed = run("invalid-strokes-bad-space");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /\.space は content-rect \/ image-rect \/ canvas-rect のいずれかである必要があります/);
});

test("image-rect strokes with a frame present fails (frame is a content-rect-only field)", () => {
  const executed = run("invalid-strokes-image-rect-with-frame");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /image-rect では省略する必要があります/);
});

test("canvas: target with canvas-rect strokes (frame omitted, canvasRef optional) passes (contract-2026-07-26-canvas-surface §4)", () => {
  const executed = run("valid-canvas-target");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("canvas: target without a valid c-NNNN id fails", () => {
  const executed = run("invalid-malformed-canvas-target");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /target は canvas:<c-NNNN> の形式である必要があります/);
});

test("canvas-rect strokes with a frame present fails (frame is a content-rect-only field)", () => {
  const executed = run("invalid-strokes-canvas-rect-with-frame");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /canvas-rect では省略する必要があります/);
});

test("input: \"session\" passes (rider r1 — review セッション契約 §6 で昇格済みの enum を回収)", () => {
  const executed = run("valid-input-session");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("open / addressed / resolved lifecycle statuses all pass", () => {
  const executed = run("valid-status-lifecycle");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("unknown annotation input fails", () => {
  const executed = run("invalid-input-unknown");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /typed \/ voice \/ session/);
});

test("unknown annotation status fails", () => {
  const executed = run("invalid-status-unknown");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /open \/ addressed \/ resolved/);
});

test("rider r1 regression: skills/edit-from-review dev-fixture (2 pre-existing input:\"session\" records) now passes", () => {
  const fixturePath = join(
    packageRoot, "..", "..", "skills", "edit-from-review", "dev-fixtures", "fixture-project", "review.json",
  );
  const executed = spawnSync(process.execPath, [cliPath, fixturePath], { encoding: "utf8" });
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});
