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

function scene(descriptor) {
  return `<script type="application/json" data-akari-3d-scene>${JSON.stringify(descriptor)}</script>`;
}

async function lintCase(t, html, inline = false) {
  const directory = await mkdtemp(join(tmpdir(), "edit-lint-three-renderer-"));
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
  const result = await lintProject(project, { writeReports: false });
  return result.findings.filter(finding => finding.check === "overlays.three-renderer");
}

test("data-akari-3d-scene.renderer accepts webgl / webgpu and omission", async t => {
  for (const descriptor of [
    { model: "model.glb" },
    { model: "model.glb", renderer: "webgl" },
    { model: "model.glb", renderer: "webgpu" },
  ]) {
    const findings = await lintCase(t, `<div><canvas></canvas>${scene(descriptor)}</div>`);
    assert.deepEqual(findings, []);
  }
});

test("data-akari-3d-scene.renderer rejects unknown values and non-strings", async t => {
  for (const renderer of ["webgpu2", "WebGPU", 1, null, true]) {
    const findings = await lintCase(t, `<div><canvas></canvas>${scene({ model: "model.glb", renderer })}</div>`);
    assert.equal(findings.length, 1, `renderer ${JSON.stringify(renderer)} must fail`);
    assert.equal(findings[0].severity, "error");
    assert.match(findings[0].message, /renderer must be "webgl" or "webgpu"/u);
  }
});

test("renderer lint also checks inline html items after v2 migration", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>${scene({ model: "model.glb", renderer: "gpu" })}</div>`, true);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /renderer must be "webgl" or "webgpu"/u);
});

test("renderer lint leaves fragments without a scene declaration alone", async t => {
  assert.deepEqual(await lintCase(t, "<div><canvas></canvas><p>no scene</p></div>"), []);
});
