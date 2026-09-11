import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";

async function createProject(timing) {
  const root = await mkdtemp(join(tmpdir(), "akari-lint-vfr-"));
  const sourcePath = "assets/source.mp4";
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, sourcePath), "fixture");
  await writeFile(join(root, "edit.json"), `${JSON.stringify({
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: "main", path: sourcePath }],
    tracks: [{
      id: "visual",
      lane: "visual",
      items: [{
        id: "clip",
        at: 0,
        duration: 30,
        source: { kind: "media", src: "main", in: 0, out: 1 },
      }],
    }],
  }, null, 2)}\n`);
  if (timing !== undefined) {
    const sidecar = join(root, ".akari", "sidecars", `${sourcePath}.analysis`);
    await mkdir(sidecar, { recursive: true });
    await writeFile(join(sidecar, "analysis.json"), `${JSON.stringify({
      probe: { video: { frame_timing: timing } },
    })}\n`);
  }
  return root;
}

test("source.vfr warns from a referenced source sidecar and adds the optional drift advice", async () => {
  const root = await createProject({
    mode: "vfr",
    irregular_deltas: 5,
    max_deviation_ms: 1.7,
    cumulative_drift_ms: 18,
    nominal_frame_ms: 33.333,
  });
  try {
    const result = await lintProject(root, {
      media: false,
      writeReports: false,
    });
    const warnings = result.findings.filter((finding) => finding.check === "source.vfr");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].severity, "warning");
    assert.equal(warnings[0].message, "この素材は可変フレームレートです（ぶれ 5 回・最大 1.7 ms）。最近傍で写像しています。固定フレームレートに変換すると音ズレを防げます（任意）");
    assert.equal(warnings[0].path, "edit.json#sources[0].path");

    const withMedia = await lintProject(root, {
      media: true,
      ffprobeCommand: process.execPath,
      writeReports: false,
    });
    assert.equal(withMedia.findings.filter((finding) => finding.check === "source.vfr").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source.vfr stays silent for CFR and absent timing sidecars", async () => {
  for (const timing of [
    { mode: "cfr", irregular_deltas: 0, max_deviation_ms: 0, cumulative_drift_ms: 0, nominal_frame_ms: 33.333 },
    undefined,
  ]) {
    const root = await createProject(timing);
    try {
      const result = await lintProject(root, {
        media: false,
        writeReports: false,
      });
      assert.equal(result.findings.some((finding) => finding.check === "source.vfr"), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
