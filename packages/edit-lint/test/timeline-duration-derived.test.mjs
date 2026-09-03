import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";

async function withProject({ visual = false }, callback) {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-duration-derived-"));
  try {
    await mkdir(join(root, "overlays"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "overlays", "one.html"), "<div>one</div>\n");
    await writeFile(join(root, "overlays", "two.html"), "<div>two</div>\n");
    await writeFile(join(root, "assets", "hit.wav"), "");
    if (visual) await writeFile(join(root, "assets", "main.mp4"), "");

    const sources = [{ id: "hit", path: "assets/hit.wav" }];
    const tracks = [
      { id: "overlays", lane: "visual", items: [
        { id: "one", at: 0, duration: 60, source: { kind: "html", path: "overlays/one.html" } },
        { id: "two", at: 60, duration: 90, source: { kind: "html", path: "overlays/two.html" } },
      ] },
      { id: "sfx", lane: "audio", items: [{
        id: "hit-1", at: 120, duration: 60, role: "sfx",
        source: { kind: "media", src: "hit", in: 0, out: 2 },
      }] },
    ];
    if (visual) {
      sources.push({ id: "main", path: "assets/main.mp4" });
      tracks.unshift({ id: "video", lane: "visual", items: [{
        id: "main-1", at: 0, duration: 180,
        source: { kind: "media", src: "main", in: 0, out: 6 },
      }] });
    }
    await writeFile(join(root, "edit.json"), `${JSON.stringify({
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources,
      tracks,
    }, null, 2)}\n`);
    await callback(await lintProject(root, { writeReports: false }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("html overlays + sfx だけの構成は導出尺で timeline 検査する", async () => {
  await withProject({ visual: false }, (result) => {
    assert.equal(result.findings.filter((finding) =>
      finding.severity === "error" && finding.check === "overlays.timeline").length, 0);
    assert.equal(result.findings.filter((finding) =>
      finding.severity === "error" && finding.check === "audio.sfx.timeline").length, 0);
    const derived = result.findings.filter((finding) => finding.check === "timeline.duration-derived");
    assert.equal(derived.length, 1, JSON.stringify(result.findings, null, 2));
    assert.equal(derived[0].severity, "info");
    assert.match(derived[0].message, /6 秒/u);
  });
});

test("映像素材がある構成で timeline.duration-derived は出ない", async () => {
  await withProject({ visual: true }, (result) => {
    assert.equal(
      result.findings.filter((finding) => finding.check === "timeline.duration-derived").length,
      0,
      JSON.stringify(result.findings, null, 2),
    );
  });
});
