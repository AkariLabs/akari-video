import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";

test("object-tree lint emits every A1 check at the contracted severity", async () => {
  const root = await mkdtemp(join(tmpdir(), "akari-object-tree-lint-"));
  try {
    await mkdir(join(root, "overlays"), { recursive: true });
    await mkdir(join(root, "motion"), { recursive: true });
    await writeFile(join(root, "overlays", "parts.html"), '<div data-akari-part="A">A</div>\n');
    await writeFile(join(root, "motion", "g.json"), JSON.stringify({
      version: 0, group: "g", items: { moving: [{ t: 0 }, { t: 5 }] },
    }));
    await writeFile(join(root, "motion", "orphan.json"), JSON.stringify({
      version: 0, group: "orphan", items: {},
    }));
    const edit = {
      version: 2,
      output: { width: 640, height: 360, fps: 30 },
      sources: [],
      tracks: [
        { id: "v1", lane: "visual", items: [
          { id: "g", at: 0, duration: 10, motion: { in: { preset: "fade", duration: 6 }, out: { preset: "fade", duration: 6 } }, source: { kind: "group" }, items: [
            { id: "duplicate", at: 8, duration: 5, source: { kind: "telop", preset: "title" } },
          ] },
          { id: "overlap", at: 5, duration: 10, source: { kind: "telop", preset: "title" } },
        ] },
        { id: "parts", lane: "visual", items: [
          { id: "duplicate", at: 20, duration: 10, source: { kind: "html", path: "overlays/parts.html", part: "missing" } },
        ] },
        { id: "motion", lane: "visual", items: [
          { id: "moving", at: 30, duration: 10, keyframes: { path: "motion/g.json", count: 3 }, source: { kind: "telop", preset: "title" } },
        ] },
        { id: "empty", lane: "visual", items: [] },
        { id: "captions", lane: "visual", content: { from: "captions.json" } },
      ],
    };
    await writeFile(join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`);
    const result = await lintProject(root, { writeReports: false });
    const severities = new Map(result.findings.map(finding => [finding.check, finding.severity]));
    assert.deepEqual(Object.fromEntries([
      "v2.id-unique", "v2.child-in-parent", "v2.track-no-overlap", "v2.keyframes-ref",
      "v2.captions-content-deprecated", "v2.part-ref", "v2.empty-track", "motion.orphan",
      "motion.in-out-exceeds",
    ].map(check => [check, severities.get(check)])), {
      "v2.id-unique": "error",
      "v2.child-in-parent": "error",
      "v2.track-no-overlap": "error",
      "v2.keyframes-ref": "error",
      "v2.captions-content-deprecated": "warning",
      "v2.part-ref": "warning",
      "v2.empty-track": "info",
      "motion.orphan": "warning",
      "motion.in-out-exceeds": "error",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
