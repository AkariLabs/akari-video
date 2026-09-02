import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";

function v2Edit() {
  return {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: "clip", path: "assets/clip.mp4", proxy: null }],
    tracks: [
      {
        id: "v1",
        lane: "visual",
        items: [
          { id: "cut-1", at: 0, duration: 90, source: { kind: "media", src: "clip", in: 0, out: 3 } },
        ],
      },
    ],
  };
}

function v0Edit() {
  return {
    version: 0,
    output: { width: 1920, height: 1080, fps: 30 },
    source: { path: "assets/clip.mp4", proxy: null },
    cuts: [{ in: 0, out: 3 }],
    overlays: [],
  };
}

async function withProject(edit, body) {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-geometry-"));
  try {
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "assets", "clip.mp4"), "fixture", "utf8");
    await writeFile(join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function lintWith(edit) {
  return withProject(edit, async (root) => {
    const result = await lintProject(root, { checkedAt: "2000-01-01T00:00:00.000Z", writeReports: false });
    return result.findings.filter(finding => finding.check === "geometry.fit-compat");
  });
}

test("未移行の v2 は geometry.fit-compat の warning を 1 件だけ出す", async () => {
  const findings = await lintWith(v2Edit());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  assert.equal(findings[0].path, "edit.json#output.geometry");
  assert.match(findings[0].message, /fit 互換モード/u);
  assert.match(findings[0].message, /normalize-geometry/u);
});

test("output.geometry: \"source\" が立っていれば出ない", async () => {
  const edit = v2Edit();
  edit.output.geometry = "source";
  assert.deepEqual(await lintWith(edit), []);
});

test("移行対象になり得る media item が無ければ出ない（crop 済み cut のみ）", async () => {
  const edit = v2Edit();
  edit.tracks[0].items[0].crop = { x: 0, y: 0, w: 0.5, h: 0.5 };
  assert.deepEqual(await lintWith(edit), []);
});

test("v0 では出ない（v0 はそもそも lint の入口で止まる）", async () => {
  await withProject(v0Edit(), async (root) => {
    await assert.rejects(
      lintProject(root, { checkedAt: "2000-01-01T00:00:00.000Z", writeReports: false }),
      /古い形式です/u,
    );
  });
});
