import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { normalizeEdit, baseTimelineDuration } from "../src/edit-model.mjs";
import { buildFcpxml } from "../src/fcpxml.mjs";
import { buildXmeml } from "../src/xmeml.mjs";
import { frameDuration } from "../src/time.mjs";

const require = createRequire(import.meta.url);
const { migrateEditToV2 } = require("../../edit-store/lib/migrate/index.js");

test("変換前 v1 と変換後 v2 の書き出しはクリップ数・開始終了・トラック順が一致する", () => {
  const v1 = {
    version: 1,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: "main", path: "main.mp4", proxy: null }],
    cuts: [
      { id: "c1", src: "main", in: 0, out: 4 },
      { id: "c2", src: "main", in: 10, out: 12 },
    ],
    layers: [{ id: "title", t: 1, duration: 2, kind: "baked", src: "title.mov", preset: "title" }],
    overlays: [],
    timeline: { tracks: [
      { id: "title-row", kind: "layers", ref: 0 },
      { id: "main-row", kind: "cuts", ref: 0 },
    ] },
  };
  // 変更前の v1 意味論から固定した期待値（秒を 30fps の start/end に直したもの）。
  const expected = [
    [{ name: "title", start: 30, end: 90 }],
    [{ name: "c1", start: 0, end: 120 }, { name: "c2", start: 120, end: 180 }],
  ];

  const migrated = migrateEditToV2(v1);
  assert.equal(migrated.ok, true, migrated.blockers?.join("\n"));
  const model = normalizeEdit(migrated.doc, "/tmp/migration-regression");
  const { xml } = buildXmeml(model, {
    durations: new Map([["main.mp4", 12], ["title.mov", 2]]),
    frameDur: frameDuration(30),
    totalDuration: baseTimelineDuration(model),
  });

  assert.deepEqual(readVideoTrackClips(xml), expected);
  assert.equal(readVideoTrackClips(xml).flat().length, expected.flat().length);
});

test("migrate 後に edit.audio.* から射影された audio item は dropped に出さない", () => {
  const v1 = {
    version: 1,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: "main", path: "main.mp4", proxy: null }],
    cuts: [{ id: "c1", src: "main", in: 0, out: 4 }],
    overlays: [],
    layers: [],
    audio: {
      narration: [{ id: "n-0001", path: "narration.mp3", t: 0.5 }],
      sfx: [{ id: "s-0001", path: "hit.wav", t: 1, in: 0, out: 1 }],
      bgm: { path: "bgm.mp3", gain_db: -18 },
    },
  };
  const migrated = migrateEditToV2(v1);
  assert.equal(migrated.ok, true, migrated.blockers?.join("\n"));
  const model = normalizeEdit(migrated.doc, "/tmp/migrated-audio");
  const context = buildContext(model, [
    ["main.mp4", 4], ["narration.mp3", 2], ["hit.wav", 1], ["bgm.mp3", 4],
  ]);
  const fcpxml = buildFcpxml(model, context);
  const xmeml = buildXmeml(model, context);

  assert.equal(model.unsupportedItems.filter((entry) => entry.field.startsWith("tracks[")).length, 0);
  assert.equal(fcpxml.dropped.filter((entry) => entry.field.startsWith("tracks[")).length, 0);
  assert.equal(xmeml.dropped.filter((entry) => entry.field.startsWith("tracks[")).length, 0);
  assert.match(fcpxml.xml, /name="n-0001"/);
  assert.match(xmeml.xml, /<name>n-0001<\/name>/);
});

test("migrate 後に media になった layer も blend を報告し、item.id をクリップ名に保つ", () => {
  const v1 = {
    version: 1,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: "main", path: "main.mp4", proxy: null }],
    cuts: [{ id: "c1", src: "main", in: 0, out: 4 }],
    overlays: [],
    layers: [{ id: "l-0001", t: 1, duration: 2, kind: "baked", src: "title.mov", blend: "screen" }],
  };
  const migrated = migrateEditToV2(v1);
  assert.equal(migrated.ok, true, migrated.blockers?.join("\n"));
  const model = normalizeEdit(migrated.doc, "/tmp/migrated-layer");
  const layer = model.videoTracks.flatMap((track) => track.clips).find((clip) => clip.id === "l-0001");
  assert.equal(layer.kind, "media");
  const context = buildContext(model, [["main.mp4", 4], ["title.mov", 2]]);
  const fcpxml = buildFcpxml(model, context);
  const xmeml = buildXmeml(model, context);

  assert.match(fcpxml.xml, /name="l-0001"/);
  assert.match(fcpxml.xml, /<adjust-blend amount="1" mode="screen"\/>/);
  assert.ok(fcpxml.warnings.some((warning) => warning.includes('blend mode "screen"')));
  assert.match(xmeml.xml, /<name>l-0001<\/name>/);
  assert.ok(xmeml.warnings.some((warning) => warning.includes("items[l-0001] blend=screen")));
});

function buildContext(model, durations) {
  return {
    durations: new Map(durations),
    frameDur: frameDuration(model.output.fps),
    totalDuration: baseTimelineDuration(model),
  };
}

function readVideoTrackClips(xml) {
  const video = xml.match(/^      <video>([\s\S]*?)^      <\/video>$/m)?.[1] ?? "";
  return [...video.matchAll(/^        <track>([\s\S]*?)^        <\/track>$/gm)].map((trackMatch) =>
    [...trackMatch[1].matchAll(/^          <clipitem[^>]*>([\s\S]*?)^          <\/clipitem>$/gm)].map((clipMatch) => {
      const body = clipMatch[1];
      return {
        name: body.match(/<name>([^<]+)<\/name>/)?.[1],
        start: Number(body.match(/<start>(\d+)<\/start>/)?.[1]),
        end: Number(body.match(/<end>(\d+)<\/end>/)?.[1]),
      };
    }));
}
