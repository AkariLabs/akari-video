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

function scene(texts) {
  return `<script type="application/json" data-akari-3d-scene>${JSON.stringify({ texts })}</script>`;
}

async function lintCase(t, html, inline = false) {
  const directory = await mkdtemp(join(tmpdir(), "edit-lint-three-text-flags-"));
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
  return result.findings.filter(finding => finding.check === "overlays.three-text-flags");
}

test("texts[] billboard / screenSpace accept booleans and omission", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>${scene([
    { id: "plain", text: "A" },
    { id: "flags", text: "B", billboard: true, screenSpace: false },
  ])}</div>`);
  assert.deepEqual(findings, []);
});

test("texts[] billboard / screenSpace reject non-boolean values by id", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>${scene([
    { id: "title", text: "A", billboard: "true", screenSpace: 1 },
  ])}</div>`);
  assert.equal(findings.length, 2);
  assert.ok(findings.every(finding => finding.severity === "error"));
  assert.ok(findings.some(finding => /texts\[title\]\.billboard must be a boolean/u.test(finding.message)));
  assert.ok(findings.some(finding => /texts\[title\]\.screenSpace must be a boolean/u.test(finding.message)));
});

test("texts[] text flag lint also checks inline html items after v2 migration", async t => {
  const findings = await lintCase(t, `<div><canvas></canvas>${scene([
    { id: "inline", text: "A", billboard: null },
  ])}</div>`, true);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /texts\[inline\]\.billboard must be a boolean/u);
});

test("text flag lint leaves fragments without a scene declaration alone", async t => {
  assert.deepEqual(await lintCase(t, "<div><canvas></canvas><p>no scene</p></div>"), []);
});
