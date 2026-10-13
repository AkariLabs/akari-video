import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
const sharedFixtures = join(repoRoot, "packages", "schemas", "fixtures", "review");
const validateReviewCli = join(repoRoot, "packages", "schemas", "bin", "validate-review.mjs");

async function withReviewProject(callback) {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-review-sessionref-"));
  try {
    await mkdir(join(projectRoot, "assets"), { recursive: true });
    await writeFile(join(projectRoot, "assets", "source.mp4"), "fixture", "utf8");
    await writeFile(join(projectRoot, "edit.json"), `${JSON.stringify({
      version: 1,
      output: { width: 1920, height: 1080, fps: 30 },
      sources: [{ id: "s1", path: "assets/source.mp4", proxy: null }],
      cuts: [{ src: "s1", in: 0, out: 200 }],
      overlays: [],
    }, null, 2)}\n`, "utf8");
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function reviewErrors(result) {
  return result.findings.filter((finding) => finding.severity === "error" && finding.check.startsWith("review."));
}

test("edit-lint validates absent, present, empty, and non-string content-rect sessionRef", async () => {
  const direct = JSON.parse(await readFile(join(sharedFixtures, "valid-strokes-direct", "review.json"), "utf8"));
  await withReviewProject(async (projectRoot) => {
    for (const [label, sessionRef, valid] of [
      ["absent", undefined, true],
      ["present", "s-0001/st-0001", true],
      ["empty", "", false],
      ["number", 5, false],
      ["null", null, false],
    ]) {
      const review = structuredClone(direct);
      if (label !== "absent") review.annotations[0].strokes[0].sessionRef = sessionRef;
      await writeFile(join(projectRoot, "review.json"), `${JSON.stringify(review)}\n`, "utf8");
      const result = await lintProject(projectRoot, { checkedAt: "2026-08-03T00:00:00.000Z" });
      const errors = reviewErrors(result);
      assert.equal(errors.length === 0, valid, `${label}: ${JSON.stringify(errors)}`);
    }
  });
});

test("edit-lint leaves non-monotonic content-rect points in review.json unchanged", async () => {
  const review = JSON.parse(await readFile(join(sharedFixtures, "valid-strokes-direct", "review.json"), "utf8"));
  review.annotations[0].strokes[0].points = [[0.8, 0.7], [0.2, 0.3], [0.6, 0.1], [0.4, 0.9]];
  await withReviewProject(async (projectRoot) => {
    const reviewPath = join(projectRoot, "review.json");
    await writeFile(reviewPath, `${JSON.stringify(review)}\n`, "utf8");
    const before = await readFile(reviewPath);
    const result = await lintProject(projectRoot, { checkedAt: "2026-08-03T00:00:00.000Z" });
    assert.deepEqual(reviewErrors(result), []);
    assert.deepEqual(await readFile(reviewPath), before);
  });
});

test("review schema validator and edit-lint share the complete valid/invalid fixture matrix", async () => {
  const fixtureNames = (await readdir(sharedFixtures)).sort((left, right) => left.localeCompare(right, "en"));
  assert.ok(fixtureNames.includes("valid-input-session"));
  assert.ok(fixtureNames.includes("valid-strokes"));
  assert.ok(fixtureNames.includes("valid-strokes-direct"));
  assert.ok(fixtureNames.includes("invalid-strokes-content-rect-empty-sessionref"));
  assert.ok(fixtureNames.includes("valid-status-lifecycle"));

  for (const fixtureName of fixtureNames) {
    const expectedValid = fixtureName === "valid" || fixtureName.startsWith("valid-");
    const sourceReview = join(sharedFixtures, fixtureName, "review.json");
    const schemaResult = spawnSync(process.execPath, [validateReviewCli, sourceReview], { encoding: "utf8" });
    assert.equal(
      schemaResult.status === 0,
      expectedValid,
      `${fixtureName}: validate-review mismatch\n${schemaResult.stderr}`,
    );

    const projectRoot = await mkdtemp(join(tmpdir(), `akari-review-parity-${fixtureName}-`));
    try {
      await mkdir(join(projectRoot, "assets"), { recursive: true });
      await writeFile(join(projectRoot, "assets", "source.mp4"), "fixture", "utf8");
      await writeFile(
        join(projectRoot, "edit.json"),
        `${JSON.stringify({
          version: 1,
          output: { width: 1920, height: 1080, fps: 30 },
          sources: [{ id: "s1", path: "assets/source.mp4", proxy: null }],
          cuts: [{ src: "s1", in: 0, out: 200 }],
          overlays: [],
        }, null, 2)}\n`,
        "utf8",
      );
      await cp(sourceReview, join(projectRoot, "review.json"));

      const result = await lintProject(projectRoot, { checkedAt: "2026-08-03T00:00:00.000Z" });
      const reviewErrors = result.findings.filter(
        (finding) => finding.severity === "error" && finding.check.startsWith("review."),
      );
      assert.equal(
        reviewErrors.length === 0,
        expectedValid,
        `${fixtureName}: edit-lint mismatch\n${JSON.stringify(reviewErrors, null, 2)}`,
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  }
});
