import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";
import { migrateFixtureTree } from "./helpers/v2-fixture.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(packageRoot, "test", "fixtures", "overlay-motion-rules");
const mapFixture = new URL("../../schemas/examples/world-map-v3-flat-valid/planning/world-map.json", import.meta.url);

async function lintCase(t, mutate = value => value) {
  const project = await mkdtemp(join(tmpdir(), "edit-lint-world-scene-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await cp(fixture, project, { recursive: true });
  const worldMap = JSON.parse(await readFile(mapFixture, "utf8"));
  const descriptor = mutate({
    schemaVersion: 1, kind: "flat", frame: { width: 1920, height: 1080 },
    worlds: worldMap.worlds, zones: worldMap.zones, cameraStops: worldMap.cameraStops,
    edges: worldMap.edges, retainedNodes: worldMap.retainedNodes,
  });
  await mkdir(join(project, "planning"), { recursive: true });
  await writeFile(join(project, "planning/world-map.json"), JSON.stringify(worldMap));
  await mkdir(join(project, "overlays"), { recursive: true });
  await writeFile(join(project, "overlays/world.html"), `<div><script type="application/json" data-akari-world-scene>${JSON.stringify(descriptor)}</script></div>`);
  const editPath = join(project, "edit.json");
  const edit = JSON.parse(await readFile(editPath, "utf8"));
  edit.overlays = [{ id: "world", html: "overlays/world.html", start: 0, duration: 1 }];
  await writeFile(editPath, JSON.stringify(edit));
  await migrateFixtureTree(project);
  const result = await lintProject(project, { writeReports: false });
  return result.findings.filter(finding => finding.check === "overlays.world-scene-declaration");
}

test("world scene declaration matches world-map ids and times", async t => {
  assert.deepEqual(await lintCase(t), []);
  const shape = await lintCase(t, descriptor => ({ ...descriptor, schemaVersion: 2 }));
  assert.equal(shape.length, 1); assert.equal(shape[0].severity, "error");
  const mismatch = await lintCase(t, descriptor => ({ ...descriptor, edges: descriptor.edges.map((edge, index) => index ? edge : { ...edge, t0: edge.t0 + 0.1 }) }));
  assert.equal(mismatch.length, 1); assert.match(mismatch[0].message, /edges の時刻/u);
});
