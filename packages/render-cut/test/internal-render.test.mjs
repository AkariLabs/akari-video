import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildTelopRasterCommands,
  internalTrackZ,
  readRenderEdit,
  renderItemKind,
} from "../src/internal-render.mjs";
import { renderProject } from "../src/render-cut.mjs";
import { resolveFfmpeg } from "../../media-bin/src/index.mjs";

const fixture = {
  version: 2,
  output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: "main", path: "main.mp4", proxy: null }],
  tracks: [
    { id: "top-first", lane: "visual", items: [
      { id: "filter", at: 0, duration: 30, source: { kind: "filter", filter: { type: "invert" } } },
      { id: "main-cut", at: 0, duration: 30, source: { kind: "media", src: "main", in: 0, out: 1 } },
    ] },
    { id: "telop", lane: "visual", items: [
      { id: "name", at: 0, duration: 30, source: { kind: "telop", preset: "ref3_name_rounded" } },
    ] },
  ],
};

test("v2 renderer view dispatches mixed-track items by source.kind", () => {
  const { internal, edit } = readRenderEdit(JSON.stringify(fixture), "/tmp/render");
  assert.equal(internalTrackZ(internal, internal.tracks[0]), 0);
  assert.equal(internalTrackZ(internal, internal.tracks[1]), 1);
  assert.deepEqual(internal.tracks[0].items.map(renderItemKind), ["layer", "cut"]);
  assert.equal(edit.cuts.length, 1);
  assert.equal(edit.layers.length, 2);
  assert.equal(edit.layers[0].kind, "filter");
  assert.equal(edit.layers[1].kind, "baked");
  assert.match(edit.layers[1].src, /telop-[a-f0-9]{16}\.mov$/u);
});

test("unbaked telop produces a deterministic rasterize command while baked is reused", () => {
  const { internal } = readRenderEdit(JSON.stringify(fixture), "/tmp/render");
  const commands = buildTelopRasterCommands(internal, "/tmp/render");
  assert.equal(commands.length, 1);
  assert.match(commands[0].output, /telop-[a-f0-9]{16}\.mov$/u);
  assert.ok(commands[0].args.includes("--no-preview-proxy"));

  const bakedFixture = structuredClone(fixture);
  bakedFixture.tracks[1].items[0].source.baked = "cached.mov";
  const baked = readRenderEdit(JSON.stringify(bakedFixture), "/tmp/render");
  assert.equal(buildTelopRasterCommands(baked.internal, "/tmp/render").length, 0);
  assert.equal(baked.edit.layers.find(layer => layer.id === "name").src, "cached.mov");
});

test("renderProject plans v2 mixed source.kind tracks in normalized bottom-to-top order", async (t) => {
  const project = mkdtempSync(join(tmpdir(), "akari-v2-render-plan-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  execFileSync(resolveFfmpeg(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=1",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    join(project, "main.mp4"),
  ]);
  writeFileSync(join(project, "overlay.html"), "<div style=\"color:white\">overlay</div>");
  const edit = {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: "main", path: "main.mp4", proxy: null }],
    tracks: [
      { id: "video", lane: "visual", items: [
        { id: "cut", at: 0, duration: 30, source: { kind: "media", src: "main", in: 0, out: 1 } },
      ] },
      { id: "filter", lane: "visual", items: [
        { id: "invert", at: 0, duration: 30, source: { kind: "filter", filter: { type: "invert" } } },
      ] },
      { id: "html", lane: "visual", items: [
        { id: "html", at: 0, duration: 30, source: { kind: "html", path: "overlay.html" } },
      ] },
      { id: "telop", lane: "visual", items: [
        { id: "name", at: 0, duration: 30, source: { kind: "telop", preset: "ref3_name_rounded" } },
      ] },
    ],
  };
  writeFileSync(join(project, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`);
  const state = await renderProject(project, { planOnly: true, force: true });
  assert.deepEqual(
    state.plan.commands.track_stack.stages.map(stage => stage.kind),
    ["cuts", "layers", "overlays", "layers"],
  );
  assert.equal(state.plan.commands.telops.length, 1);
  assert.equal(state.plan.commands.telops[0].id, "name");
});
