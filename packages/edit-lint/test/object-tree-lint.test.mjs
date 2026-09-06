import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";

test("unknown motion presets warn once per seat with the complete nested item path", async () => {
  const root = await mkdtemp(join(tmpdir(), "akari-motion-preset-lint-"));
  try {
    const child = { id: "child", at: 0, duration: 90, source: { kind: "telop", preset: "title" } };
    const edit = {
      version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
      tracks: [{ id: "visual", lane: "visual", items: [
        { id: "parent", at: 0, duration: 90, source: { kind: "group" }, items: [child] },
      ] }],
    };
    const warningsFor = async motion => {
      child.motion = motion;
      await writeFile(join(root, "edit.json"), JSON.stringify(edit));
      const result = await lintProject(root, { writeReports: false });
      return result.findings.filter(finding => finding.check === "motion.unknown-preset")
        .map(({ severity, path }) => ({ severity, path }));
    };
    const warning = seat => ({ severity: "warning", path: `edit.json#tracks[0].items[0].items[0].motion.${seat}` });
    assert.deepEqual(await warningsFor({ in: { preset: "future", duration: 12 },
      out: { preset: "fade", duration: 12 }, loop: { preset: "pulse", period: 30 } }), [warning("in")]);
    assert.deepEqual(await warningsFor({ in: { preset: "pulse", duration: 12 },
      out: { preset: "future", duration: 12 }, loop: { preset: "fade", period: 30 } }),
    [warning("in"), warning("loop"), warning("out")]);
    for (const preset of ["fade", "slide-up", "slide-down", "slide-left", "slide-right", "scale", "wipe"]) {
      assert.deepEqual(await warningsFor({ in: { preset, duration: 12 }, out: { preset, duration: 12 } }), []);
    }
    for (const preset of ["pulse", "float", "spin"]) {
      assert.deepEqual(await warningsFor({ loop: { preset, period: 30 } }), []);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
