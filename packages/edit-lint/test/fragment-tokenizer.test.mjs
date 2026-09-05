import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";
import { migrateFixtureTree } from "./helpers/v2-fixture.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(packageRoot, "test", "fixtures", "fragment-tokenizer");

async function lintCase(id) {
  const project = await mkdtemp(join(tmpdir(), "edit-lint-fragment-tokenizer-"));
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

test("@property syntax containing <number> remains one balanced overlay root", async () => {
  const result = await lintCase("css-property");
  assert.deepEqual(findingsFor(result, "overlays.html-root"), []);
});

test("a <text> marker in the leading CSS comment is ignored by the HTML tokenizer", async () => {
  const result = await lintCase("css-comment");
  assert.deepEqual(findingsFor(result, "overlays.html-root"), []);
});

test("a <b> string in application/json script content is ignored by the HTML tokenizer", async () => {
  const result = await lintCase("script-json");
  assert.deepEqual(findingsFor(result, "overlays.html-root"), []);
});

test("a genuinely unbalanced fragment still reports overlays.html-root as an error", async () => {
  const result = await lintCase("unbalanced");
  const findings = findingsFor(result, "overlays.html-root");
  assert.equal(findings.length, 1, JSON.stringify(result.findings, null, 2));
  assert.equal(findings[0].severity, "error");
});

test("root data-start always warns and a mismatched value also keeps the existing error", async (t) => {
  await t.test("matching data-start warns without overlays.data-attributes", async () => {
    const result = await lintCase("root-data-matched");
    const warnings = findingsFor(result, "overlays.root-data-attributes");
    assert.equal(warnings.length, 1, JSON.stringify(result.findings, null, 2));
    assert.equal(warnings[0].severity, "warning");
    assert.deepEqual(findingsFor(result, "overlays.data-attributes"), []);
  });

  await t.test("mismatched data-start warns and reports overlays.data-attributes", async () => {
    const result = await lintCase("root-data-mismatched");
    const warnings = findingsFor(result, "overlays.root-data-attributes");
    assert.equal(warnings.length, 1, JSON.stringify(result.findings, null, 2));
    assert.equal(warnings[0].severity, "warning");
    const errors = findingsFor(result, "overlays.data-attributes");
    assert.equal(errors.length, 1, JSON.stringify(result.findings, null, 2));
    assert.equal(errors[0].severity, "error");
  });
});
