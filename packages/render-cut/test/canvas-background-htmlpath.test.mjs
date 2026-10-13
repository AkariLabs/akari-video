// 背景色のあるキャンバスを含むと、書き出しが「inline overlay html requires htmlPath」で必ず止まっていた。
// キャンバスの背景は edit.json から合成する中身直書きの HTML なので、図形と同じく出どころを edit.json にする。
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readRenderEdit } from "../src/internal-render.mjs";

test("キャンバスの背景の overlay は htmlPath に edit.json を持つ", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-canvas-background-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const edit = {
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [],
    tracks: [{ id: "v", lane: "visual", items: [{
      id: "canvas-1", at: 30, duration: 90, transform: { x: 40, y: 0, scale: 0.8 },
      source: { kind: "group", canvas: { origin: "user", durationMode: "fixed", background: { type: "color", color: "#202830" } } },
      items: [{ id: "title", at: 0, duration: 60, source: { kind: "html", path: "overlays/title.html" } }],
    }] }],
  };
  const rendered = readRenderEdit(JSON.stringify(edit), join(projectRoot, ".akari", "render-tmp"), { projectRoot, expandParts: true }).edit;
  const background = rendered.overlays.find((overlay) => overlay.id === "canvas-1:background");
  assert.ok(background, "キャンバスの背景の overlay がある");
  assert.equal(background.htmlPath, "edit.json");
  const child = rendered.overlays.find((overlay) => overlay.id === "title");
  assert.equal(child.html, "overlays/title.html");
});
