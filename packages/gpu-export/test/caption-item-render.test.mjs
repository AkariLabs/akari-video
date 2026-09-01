import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadAndBuildGpuPage } from "../src/page-builder.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "../../render-cut/test/fixtures/caption-item-render");

test("GPU page classifies the detached caption item without dropping it", async () => {
  const result = await loadAndBuildGpuPage({
    projectRoot: fixtureRoot,
    editPath: join(fixtureRoot, "edit.json"),
    fps: 30,
    width: 640,
    height: 360,
    duration: 5,
  });

  const overlay = result.edit.overlays.find(candidate => candidate.id === "c2-out");
  assert.equal(overlay.start, 61 / 30);
  assert.equal(overlay.duration, 1);
  assert.equal(overlay.z, 2);
  assert.deepEqual(result.spriteManifest.statics.map(({ id, z }) => ({ id, z })), [
    { id: "order-html", z: 3 },
  ]);
  const classification = result.eligibility.entries.find(entry =>
    entry.kind === "overlay" && entry.id === "c2-out");
  assert.ok(classification);
  // 字幕断片の @font-face の file URL と animation-timing は HTML overlay 判定に当たり、same / dom にはならない。
  // gpu-export 側を変えない限り degraded のままで、GPU は fail-closed に OSR へフォールバックする。
  assert.equal(classification.classification, "degraded");
  assert.equal(result.eligibility.eligible, false);
  assert.match(classification.reason, /font-face-external-resource/u);
});
