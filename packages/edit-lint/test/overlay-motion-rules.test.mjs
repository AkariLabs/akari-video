import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";
import { migrateFixtureTree } from "./helpers/v2-fixture.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(packageRoot, "test", "fixtures", "overlay-motion-rules");

async function lintCase(id) {
  const project = await mkdtemp(join(tmpdir(), "edit-lint-overlay-motion-rules-"));
  try {
    await cp(fixture, project, { recursive: true });
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    edit.overlays = edit.overlays.filter((overlay) => overlay.id === id);
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    await migrateFixtureTree(project);
    return await lintProject(project, { writeReports: false });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

function findingsFor(result, check) {
  return result.findings.filter((finding) => finding.check === check);
}

test("sparse keyframes warn with the keyframes name and missing property", async () => {
  const result = await lintCase("keyframes-sparse");
  const findings = findingsFor(result, "overlays.keyframes-sparse");
  assert.equal(findings.length, 1, JSON.stringify(result.findings, null, 2));
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /sparse-entry/u);
  assert.match(findings[0].message, /opacity/u);
});

test("dense keyframes do not warn", async () => {
  const result = await lintCase("keyframes-dense");
  assert.deepEqual(findingsFor(result, "overlays.keyframes-sparse"), []);
});

test("a hidden base with a visible animation endpoint warns", async () => {
  const result = await lintCase("base-hidden");
  const findings = findingsFor(result, "overlays.base-hidden-state");
  assert.equal(findings.length, 1, JSON.stringify(result.findings, null, 2));
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /reveal-card/u);
});

test("a base matching the final resting state does not warn", async () => {
  const result = await lintCase("base-final");
  assert.deepEqual(findingsFor(result, "overlays.base-hidden-state"), []);
});

test("preserve-3d on an opacity-animated element warns", async () => {
  const result = await lintCase("preserve-opacity");
  const findings = findingsFor(result, "overlays.preserve-3d-opacity-animation");
  assert.equal(findings.length, 1, JSON.stringify(result.findings, null, 2));
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /Blink/u);
});

test("opacity animated on a parent of the preserve-3d element does not warn", async () => {
  const result = await lintCase("preserve-parent-opacity");
  assert.deepEqual(findingsFor(result, "overlays.preserve-3d-opacity-animation"), []);
});
