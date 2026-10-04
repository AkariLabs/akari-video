import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEdit,
  sourceRangeToTimelineRanges,
  sourcePointToTimeline,
  baseTimelineDuration,
} from "../src/edit-model.mjs";
import { collectBaseDropped } from "../src/dropped.mjs";

const edit = {
  version: 2,
  output: { width: 1080, height: 1920, fps: 30 },
  sources: [{ id: "main", path: "main.mp4", proxy: null }],
  tracks: [
    {
      id: "background", lane: "visual", items: [
        { id: "c1", at: 0, duration: 150, source: { kind: "media", src: "main", in: 0, out: 5 } },
        { id: "c2", at: 120, duration: 75, source: { kind: "media", src: "main", in: 10, out: 15, speed: 2 } },
      ],
    },
    {
      id: "graphics", lane: "visual", items: [
        { id: "title", at: 30, duration: 60, source: { kind: "telop", preset: "title", baked: "title.mov" } },
      ],
    },
  ],
};

test("normalizeEdit: v2 の整数フレームを一度だけ秒へ変換し、tracks[] 順を z とする", () => {
  const model = normalizeEdit(edit, "/tmp/proj");
  assert.deepEqual(model.videoTracks.map((track) => [track.id, track.z]), [["background", 0], ["graphics", 1]]);
  assert.deepEqual(model.videoTracks[0].clips.map((clip) => [clip.at, clip.duration]), [[0, 5], [4, 2.5]]);
  assert.equal(model.layers[0].path, "title.mov");
  assert.equal(model.projectName, "proj");
  assert.equal(baseTimelineDuration(model), 6.5);
});

test("normalizeEdit: v1 は読み取らず移行を要求する", () => {
  assert.throws(() => normalizeEdit({ version: 1 }, "/tmp/proj"), /version 1|v1|変換/);
});

test("sourceRangeToTimelineRanges: source 秒アンカーを絶対配置と speed 込みで写す", () => {
  const model = normalizeEdit(edit, "/tmp/proj");
  const ranges = sourceRangeToTimelineRanges(11, 12, model.cuts, "main");
  assert.deepEqual(ranges.map((range) => [range.start, range.duration]), [[4.5, 0.5]]);
});

test("sourcePointToTimeline: どの media item にも含まれなければ null", () => {
  const model = normalizeEdit(edit, "/tmp/proj");
  assert.equal(sourcePointToTimeline(2, model.cuts, "main"), 2);
  assert.equal(sourcePointToTimeline(7, model.cuts, "main"), null);
  assert.equal(sourcePointToTimeline(2, model.cuts, "other"), null);
});

test("source.kind: baked telop だけをクリップ化し、未焼成 html/telop と filter は dropped 候補にする", () => {
  const model = normalizeEdit({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [],
    tracks: [{ id: "graphics", lane: "visual", items: [
      { id: "html", at: 0, duration: 30, source: { kind: "html", path: "title.html" } },
      { id: "raw-telop", at: 30, duration: 30, source: { kind: "telop", preset: "title" } },
      { id: "baked-telop", at: 60, duration: 30, source: { kind: "telop", preset: "title", baked: "title.mov" } },
      { id: "filter", at: 90, duration: 30, source: { kind: "filter", filter: { type: "invert" } } },
    ] }],
  }, "/tmp/proj");
  assert.deepEqual(model.layers.map((layer) => layer.id), ["baked-telop"]);
  assert.deepEqual(model.unsupportedItems.map((entry) => entry.field), [
    "tracks[graphics].items[html].source",
    "tracks[graphics].items[raw-telop].source",
    "tracks[graphics].items[filter].source",
  ]);
});

test("手書き v2 の audio track item は sfx として書き出す", () => {
  const model = normalizeEdit({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: "music", path: "music.wav" }],
    tracks: [{ id: "audio", lane: "audio", items: [
      { id: "music", at: 0, duration: 120, source: { kind: "media", src: "music", in: 0, out: 4 } },
    ] }],
  }, "/tmp/proj");
  assert.deepEqual(model.sfx.map(({ id, path, t, in: sourceIn, out, track }) => ({ id, path, t, in: sourceIn, out, track })), [
    { id: "music", path: "music.wav", t: 0, in: 0, out: 4, track: 0 },
  ]);
  assert.deepEqual(collectBaseDropped(model).map((entry) => entry.field), []);
});

test("NLE 書き出し対象外となる mute と speech だけを dropped 候補に残す", () => {
  const model = normalizeEdit({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: "voice", path: "voice.wav" }],
    tracks: [
      { id: "audio", lane: "audio", items: [
        { id: "active", at: 0, duration: 30, source: { kind: "media", src: "voice", in: 0, out: 1 } },
        { id: "mute-item", at: 30, duration: 30, mute: true, source: { kind: "media", src: "voice", in: 0, out: 1 } },
        { id: "speech", at: 60, duration: 30, role: "speech", source: { kind: "media", src: "voice", in: 0, out: 1 } },
      ] },
      { id: "muted-track", lane: "audio", muted: true, items: [
        { id: "mute-track", at: 90, duration: 30, source: { kind: "media", src: "voice", in: 0, out: 1 } },
      ] },
    ],
  }, "/tmp/proj");
  assert.deepEqual(model.sfx.map((item) => item.id), ["active"]);
  assert.deepEqual(model.unsupportedItems.map((entry) => entry.field), [
    "tracks[audio].items[mute-item]", "tracks[audio].items[speech]", "tracks[muted-track].items[mute-track]",
  ]);
});

test("トップレベル audio.* だけの入力は従来の宣言をそのまま使う", () => {
  const audio = {
    narration: [{ id: "n", path: "n.wav", t: 0.5, gain_db: -3 }],
    sfx: [{ id: "s", path: "s.wav", t: 1, in: 0.25, out: 1.25, track: 2, gain_db: -6 }],
    bgm: { path: "b.wav", in: 1, fadeIn: 0.5, fadeOut: 1, gain_db: -18, ducking: true },
    master: { loudnorm: -14 },
  };
  const model = normalizeEdit({ ...edit, audio }, "/tmp/proj");
  assert.deepEqual({ narration: model.narration, sfx: model.sfx, bgm: model.bgm, master: model.master }, audio);
});
