import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(packageRoot, "test", "fixtures", "overlay-box-sizing");

async function lintCase(id) {
  const project = await mkdtemp(join(tmpdir(), "edit-lint-overlay-box-sizing-"));
  try {
    await cp(fixture, project, { recursive: true });
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    edit.tracks[0].items = edit.tracks[0].items.filter((item) => item.id === id);
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    return await lintProject(project, { writeReports: false });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

function boxSizingFindings(result) {
  return result.findings.filter((finding) => finding.check === "overlays.box-sizing");
}

test("width plus padding without box-sizing warns and points at border-box", async () => {
  const findings = boxSizingFindings(await lintCase("warn"));
  assert.equal(findings.length, 1, JSON.stringify(findings, null, 2));
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /\.panel/u);
  assert.match(findings[0].message, /`box-sizing: border-box` を明記してください/u);
});

test("an explicit border-box declaration clears the warning", async () => {
  assert.deepEqual(boxSizingFindings(await lintCase("ok-explicit")), []);
});

test("a root-wide border-box declaration clears the warning for descendants", async () => {
  assert.deepEqual(boxSizingFindings(await lintCase("ok-universal")), []);
});

test("box-sizing on an unrelated selector does not clear the warning", async () => {
  const findings = boxSizingFindings(await lintCase("warn-unrelated"));
  assert.equal(findings.length, 1, JSON.stringify(findings, null, 2));
});

test("content-box does not clear the warning", async () => {
  const findings = boxSizingFindings(await lintCase("warn-content-box"));
  assert.equal(findings.length, 1, JSON.stringify(findings, null, 2));
});

test("width and padding declared in separate rules still warn", async () => {
  const findings = boxSizingFindings(await lintCase("warn-split"));
  assert.equal(findings.length, 1, JSON.stringify(findings, null, 2));
});

test("height plus border without box-sizing warns", async () => {
  const findings = boxSizingFindings(await lintCase("warn-height-border"));
  assert.equal(findings.length, 1, JSON.stringify(findings, null, 2));
});

test("descendant-only border-box does not cover the fragment root itself", async () => {
  const findings = boxSizingFindings(await lintCase("warn-root-only-descendants"));
  assert.equal(findings.length, 1, JSON.stringify(findings, null, 2));
});

test("an inline border-box declaration clears the warning", async () => {
  assert.deepEqual(boxSizingFindings(await lintCase("ok-inline-style")), []);
});

test("a fixed width without padding or border does not warn", async () => {
  assert.deepEqual(boxSizingFindings(await lintCase("ok-no-padding")), []);
});

test("intrinsic widths do not warn", async () => {
  assert.deepEqual(boxSizingFindings(await lintCase("ok-max-content")), []);
});

test("zero padding and zero border do not warn", async () => {
  assert.deepEqual(boxSizingFindings(await lintCase("ok-zero-space")), []);
});
