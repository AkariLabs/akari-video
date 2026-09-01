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
import { buildPlan } from "../src/plan.mjs";
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

test("v2 renderer audio is derived from role-marked tracks while raw master is preserved", () => {
  const master = { denoise: "std", loudnorm: -14, true_peak_dbtp: -1.5 };
  const audioFixture = {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [
      { id: "main", path: "main.mp4", proxy: null },
      { id: "hit", path: "hit.wav", proxy: null },
      { id: "voice", path: "voice.wav", proxy: null },
      { id: "music", path: "music.wav", proxy: null },
    ],
    tracks: [
      { id: "video", lane: "visual", items: [{
        id: "main-cut", at: 0, duration: 300,
        source: { kind: "media", src: "main", in: 0, out: 10 },
      }] },
      { id: "sfx", lane: "audio", items: [{
        id: "hit-1", at: 30, duration: 15,
        gain_db: -6, fade_in: 0.1, fade_out: 0.2,
        source: { kind: "media", src: "hit", in: 0.25, out: 0.75 },
      }] },
      { id: "narration", lane: "audio", items: [{
        id: "n-0001", at: 60, duration: 90, role: "narration", gain_db: 1.5,
        source: { kind: "media", src: "voice", in: 0, out: 3 },
      }] },
      { id: "bgm", lane: "audio", items: [{
        id: "music-item", at: 0, duration: 300, role: "bgm",
        fade_in: 1.25, fade_out: 2.5, gain_db: -18, ducking: true,
        source: { kind: "media", src: "music", in: 0, out: 10 },
      }] },
    ],
    audio: { master },
  };

  const { edit } = readRenderEdit(audioFixture, "/tmp/render");
  assert.deepEqual(edit.audio.sfx, [{
    id: "hit-1", t: 1, duration: 0.5, path: "hit.wav", track: 0,
    in: 0.25, out: 0.75, fade_in: 0.1, fade_out: 0.2, gainDb: -6, gain_db: -6,
  }]);
  assert.deepEqual(edit.audio.narration, [{
    id: "n-0001", t: 2, path: "voice.wav", track: 1, in: 0, out: 3,
    gainDb: 1.5, gain_db: 1.5,
  }]);
  assert.deepEqual(edit.audio.bgm, {
    id: "bgm", path: "music.wav", track: 2, in: 0, fadeIn: 1.25, fadeOut: 2.5,
    gainDb: -18, ducking: true, gain_db: -18,
  });
  assert.notEqual(edit.audio.narration[0].track, edit.audio.bgm.track);
  assert.equal(edit.audio.master, master);
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
