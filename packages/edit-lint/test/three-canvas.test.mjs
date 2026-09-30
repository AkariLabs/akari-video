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
const scene = '<script type="application/json" data-akari-3d-scene>{"texts":[{"id":"t","text":"A"}]}</script>';

async function lintCase(t, html, inline = false) {
  const directory = await mkdtemp(join(tmpdir(), "edit-lint-three-canvas-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, "project");
  await cp(base, project, { recursive: true });
  const editPath = join(project, "edit.json");
  const edit = JSON.parse(await readFile(editPath, "utf8"));
  edit.source.path = join(project, "sample.mp4");
  edit.overlays = [{ id: "three", html: inline ? html : join(project, "overlays/three.html"), start: 0, duration: 1 }];
  if (!inline) await writeFile(join(project, "overlays/three.html"), html);
  await writeFile(editPath, JSON.stringify(edit));
  await migrateFixtureTree(project);
  const migrated = JSON.parse(await readFile(editPath, "utf8"));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.tracks.some(track => track.items?.some(item => item.source?.kind === "html")), true);
  const result = await lintProject(project, { writeReports: false });
  return result.findings.filter(finding => finding.check === "overlays.three-canvas");
}

test("3D canvas lint checks explicit target, legacy ambiguity, and invalid markers", async t => {
  const cases = [
    { html: `<div><canvas data-akari-3d-canvas></canvas><canvas></canvas>${scene}</div>`, count: 0 },
    { html: `<div><canvas></canvas>${scene}</div>`, count: 0 },
    { html: `<div><canvas></canvas><canvas></canvas>${scene}</div>`, severity: "warning" },
    { html: `<div><canvas data-akari-3d-canvas></canvas><canvas data-akari-3d-canvas></canvas>${scene}</div>`, severity: "error" },
    { html: `<div data-akari-3d-canvas><canvas></canvas>${scene}</div>`, severity: "error" },
  ];
  for (const item of cases) {
    const findings = await lintCase(t, item.html);
    assert.equal(findings.length, item.count ?? 1, JSON.stringify(findings));
    if (item.severity) assert.equal(findings[0].severity, item.severity);
    if (item.severity === "warning") {
      assert.match(findings[0].message, /first canvas in document order/u);
      assert.match(findings[0].message, /data-akari-3d-canvas/u);
    }
  }
});

test("3D canvas lint ignores comments and raw script/style contents", async t => {
  const html = `<div><!-- <canvas data-akari-3d-canvas></canvas> -->
    <script>const ignored = '<canvas data-akari-3d-canvas></canvas>';</script>
    <style>/* <canvas data-akari-3d-canvas></canvas> */</style>
    <canvas></canvas><canvas></canvas>${scene}</div>`;
  const findings = await lintCase(t, html);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
});

test("3D canvas lint also checks inline html items after v2 migration", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas><canvas></canvas>${scene}</div>`, true);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
});

test("3D canvas lint leaves fragments without a scene declaration alone", async t => {
  assert.deepEqual(await lintCase(t, "<div><canvas></canvas><canvas></canvas></div>"), []);
});
