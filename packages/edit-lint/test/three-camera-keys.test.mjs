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
const scene = (camera, extra = {}) =>
  `<script type="application/json" data-akari-3d-scene>${JSON.stringify({ texts: [{ id: "t", text: "A" }], camera, ...extra })}</script>`;

async function lintCase(t, body, inline = false) {
  const directory = await mkdtemp(join(tmpdir(), "edit-lint-three-camera-keys-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, "project");
  await cp(base, project, { recursive: true });
  const editPath = join(project, "edit.json");
  const edit = JSON.parse(await readFile(editPath, "utf8"));
  edit.source.path = join(project, "sample.mp4");
  edit.overlays = [{ id: "three", html: inline ? body : join(project, "overlays/three.html"), start: 0, duration: 1 }];
  if (!inline) await writeFile(join(project, "overlays/three.html"), body);
  await writeFile(editPath, JSON.stringify(edit));
  await migrateFixtureTree(project);
  const result = await lintProject(project, { writeReports: false });
  return result.findings.filter(finding => finding.check === "overlays.three-camera-keys");
}

const keys = (...entries) => ({ keys: entries });

test("camera.keys lint accepts ascending keys, one key, and the two ease names", async t => {
  const cases = [
    keys(
      { t: 0, position: [0, 1, 5], lookAt: [0, 0, 0] },
      { t: 1.5, position: [2, 1, 4], lookAt: [0, 0.5, 0], ease: "easeInOut" },
      { t: 3, position: [-2, 0.5, 6], lookAt: [0, 0, 0], ease: "linear" },
    ),
    keys({ t: 2, position: [0, 0, 3], lookAt: [0, 0, 0] }),
  ];
  for (const camera of cases) {
    assert.deepEqual(await lintCase(t, `<div><canvas></canvas>${scene(camera)}</div>`), []);
  }
});

test("camera.keys lint rejects descending t without sorting, with both times in the reason", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>${scene(keys(
    { t: 2, position: [0, 0, 0], lookAt: [0, 0, 0] },
    { t: 1, position: [1, 0, 0], lookAt: [1, 0, 0] },
  ))}</div>`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.match(findings[0].message, /ascending t/u);
  assert.match(findings[0].message, /keys\[1\]\.t=1/u);
  assert.match(findings[0].message, /keys\[0\]\.t=2/u);
  assert.match(findings[0].message, /not sorted automatically/u);
});

test("camera.keys lint rejects duplicate t", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>${scene(keys(
    { t: 1, position: [0, 0, 0], lookAt: [0, 0, 0] },
    { t: 1, position: [1, 0, 0], lookAt: [1, 0, 0] },
  ))}</div>`);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /ascending t/u);
});

test("camera.keys lint rejects bad shape and unknown ease / field", async t => {
  const cases = [
    { camera: keys(), message: /non-empty array/u },
    { camera: keys({ t: "1", position: [0, 0, 0], lookAt: [0, 0, 0] }), message: /\.t must be a finite number/u },
    { camera: keys({ t: 0, position: [0, 0], lookAt: [0, 0, 0] }), message: /\.position must be an array of 3/u },
    { camera: keys({ t: 0, position: [0, 0, 0], lookAt: [0, 0, 0], ease: "out-cubic" }), message: /linear.*easeInOut/u },
    { camera: keys({ t: 0, position: [0, 0, 0], lookAt: [0, 0, 0], lookat: [0, 0, 0] }), message: /unknown field: lookat/u },
  ];
  for (const item of cases) {
    const findings = await lintCase(t, `<div><canvas></canvas>${scene(item.camera)}</div>`);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.match(findings[0].message, item.message);
  }
});

test("camera.keys lint also checks inline html items", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>${scene(keys(
    { t: 2, position: [0, 0, 0], lookAt: [0, 0, 0] },
    { t: 1, position: [1, 0, 0], lookAt: [1, 0, 0] },
  ))}</div>`, true);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
});

test("camera.keys lint ignores commented-out declarations and scenes without keys", async t => {
  const commented = `<div><canvas></canvas><!-- ${scene(keys(
    { t: 2, position: [0, 0, 0], lookAt: [0, 0, 0] },
    { t: 1, position: [1, 0, 0], lookAt: [1, 0, 0] },
  ))} --></div>`;
  assert.deepEqual(await lintCase(t, commented), []);
  assert.deepEqual(await lintCase(t, `<div><canvas></canvas>${scene({ position: [0, 0, 3], lookAt: [0, 0, 0] })}</div>`), []);
});
