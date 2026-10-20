import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lintProject } from "../src/edit-lint.mjs";
import { migrateFixtureTree } from "./helpers/v2-fixture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const base = join(here, "fixtures", "overlay-motion-rules");

async function lintCase(t, html) {
  const directory = await mkdtemp(join(tmpdir(), "edit-lint-three-html-anchor-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, "project");
  await cp(base, project, { recursive: true });
  const editPath = join(project, "edit.json");
  const edit = JSON.parse(await readFile(editPath, "utf8"));
  edit.source.path = join(project, "sample.mp4");
  edit.overlays = [{ id: "three", html: join(project, "overlays/three.html"), start: 0, duration: 1 }];
  await writeFile(join(project, "overlays/three.html"), html);
  await writeFile(editPath, JSON.stringify(edit));
  await migrateFixtureTree(project);
  const result = await lintProject(project, { writeReports: false });
  return result.findings.filter(finding => finding.check === "overlays.three-anchor");
}

const scene = '<script type="application/json" data-akari-3d-scene>{}</script>';

test("data-akari-3d-anchor accepts x,y,z and known origins inside a 3D fragment", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>
    <span data-akari-3d-anchor="0,1.5,-2e1" data-akari-3d-anchor-origin="center" data-akari-3d-anchor-occlude="true">地点</span>
    <span data-akari-3d-anchor="-1, 2, 3" data-akari-3d-anchor-origin="top-left" data-akari-3d-anchor-occlude="false">地点</span>
    ${scene}</div>`);
  assert.deepEqual(findings, []);
});

test("data-akari-3d-anchor rejects values that are not three numbers", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>
    <span data-akari-3d-anchor="1,2">a</span>
    <span data-akari-3d-anchor="1,2,x">b</span>
    <span data-akari-3d-anchor="1,2,3,4">c</span>
    <span data-akari-3d-anchor="">d</span>
    ${scene}</div>`);
  assert.equal(findings.length, 4);
  assert.ok(findings.every(finding => finding.severity === "error"));
  assert.ok(findings.every(finding => /three comma-separated numbers/u.test(finding.message)));
});

test("data-akari-3d-anchor outside a 3D fragment warns", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>
    <span data-akari-3d-anchor="0,0,0">label</span></div>`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /outside a 3D fragment/u);
});

test("anchor origin and occlude reject unknown values", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>
    <span data-akari-3d-anchor="0,0,0" data-akari-3d-anchor-origin="middle">a</span>
    <span data-akari-3d-anchor="0,0,0" data-akari-3d-anchor-occlude="yes">b</span>
    ${scene}</div>`);
  assert.equal(findings.length, 2);
  assert.ok(findings.every(finding => finding.severity === "error"));
  assert.ok(findings.some(finding => /origin must be one of/u.test(finding.message)));
  assert.ok(findings.some(finding => /occlude must be/u.test(finding.message)));
});

test("comments and scripts do not create false anchor findings", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>
    <!-- <span data-akari-3d-anchor="broken">ignored</span> -->
    <style>.x::before { content: "data-akari-3d-anchor=broken"; }</style>
    ${scene}</div>`);
  assert.deepEqual(findings, []);
});
