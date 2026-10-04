import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { normalizeEdit, baseTimelineDuration } from "../src/edit-model.mjs";
import { buildFcpxml } from "../src/fcpxml.mjs";
import { buildXmeml } from "../src/xmeml.mjs";
import { frameDuration } from "../src/time.mjs";
import { collectBaseDropped } from "../src/dropped.mjs";

const require = createRequire(import.meta.url);
const { migrateEditToV2 } = require("../../edit-store/lib/migrate/index.js");

const output = { width: 1920, height: 1080, fps: 30 };
const sources = [
  { id: "picture", path: "picture.mp4" },
  { id: "voice", path: "voice.wav" },
  { id: "hit", path: "hit.wav" },
  { id: "swish", path: "swish.wav" },
  { id: "music", path: "music.wav" },
];
const picture = { id: "picture-track", lane: "visual", items: [
  { id: "picture-item", at: 0, duration: 300, source: { kind: "media", src: "picture", in: 0, out: 10 } },
] };
const legacy = {
  version: 2, output, sources, tracks: [picture],
  audio: {
    narration: [{ id: "n-1", path: "voice.wav", t: 0.5, gain_db: -3 }],
    sfx: [
      { id: "s-0", path: "hit.wav", t: 1, in: 0.25, out: 1.25, track: 0, gain_db: -6 },
      { id: "s-1", path: "swish.wav", t: 2, track: 1, gain_db: -9 },
    ],
    bgm: { path: "music.wav", in: 0.5, fadeIn: 0.5, fadeOut: 1, gain_db: -18 },
  },
};
const tracksFirst = {
  version: 2, output, sources,
  tracks: [picture,
    { id: "voice-track", lane: "audio", items: [
      { id: "n-1", at: 15, duration: 0, role: "narration", gain_db: -3,
        provenance: { provider: "test-tts" }, source: { kind: "media", src: "voice", in: 0 } },
    ] },
    { id: "sfx-track-0", lane: "audio", items: [
      { id: "s-0", at: 30, duration: 30, gain_db: -6,
        source: { kind: "media", src: "hit", in: 0.25, out: 1.25 } },
    ] },
    { id: "sfx-track-1", lane: "audio", items: [
      { id: "s-1", at: 60, duration: 0, gain_db: -9,
        source: { kind: "media", src: "swish", in: 0 } },
    ] },
    { id: "bgm-track", lane: "audio", items: [
      { id: "bgm", at: 0, duration: 0, role: "bgm", gain_db: -18, fade_in: 0.5, fade_out: 1,
        source: { kind: "media", src: "music", in: 0.5 } },
    ] },
  ],
};

for (const durations of [new Map(), new Map([
  ["picture.mp4", 10], ["voice.wav", 2], ["hit.wav", 2], ["swish.wav", 1], ["music.wav", 3],
])]) {
  const label = durations.size ? "実尺あり" : "実尺なし";
  test(`v2 audio の宣言と tracks[] は FCPXML / xmeml で音声配置が同じ (${label})`, () => {
    const fromDeclaration = normalizeEdit(legacy, "/tmp/v2-audio");
    const fromTracks = normalizeEdit(tracksFirst, "/tmp/v2-audio");
    const build = (model) => ({
      durations,
      frameDur: frameDuration(30),
      totalDuration: baseTimelineDuration(model),
    });
    for (const writer of [buildFcpxml, buildXmeml]) {
      const expected = writer(fromDeclaration, build(fromDeclaration));
      const actual = writer(fromTracks, build(fromTracks));
      assert.equal(actual.xml, expected.xml, `${writer.name}: 音声の時刻・長さ・名前・gain・トラック配置`);
      assert.deepEqual(actual.warnings, expected.warnings);
      assert.deepEqual(actual.dropped, expected.dropped);
    }
  });
}

test("tracks[] の bgm item の ducking は dropped に報告し、トップレベル宣言があれば優先する", () => {
  const withItemDucking = structuredClone(tracksFirst);
  withItemDucking.tracks.at(-1).items[0].ducking = true;
  withItemDucking.audio = { master: { loudnorm: -14 } };
  const model = normalizeEdit(withItemDucking, "/tmp/v2-audio");
  assert.equal(model.bgm?.ducking, true);
  assert.deepEqual(collectBaseDropped(model).map((entry) => entry.field), ["audio.bgm.ducking", "audio.master"]);

  withItemDucking.audio.bgm = { path: "music.wav", ducking: false };
  const withDeclaration = normalizeEdit(withItemDucking, "/tmp/v2-audio");
  assert.equal(withDeclaration.bgm?.ducking, false);
  assert.deepEqual(collectBaseDropped(withDeclaration).map((entry) => entry.field), ["audio.master"]);
});

test("migrate 後の bgm ducking と master はトップレベル版と同じ dropped field に残る", () => {
  const audio = { bgm: { path: "music.wav", ducking: true }, master: { loudnorm: -14 } };
  const topLevel = normalizeEdit({ version: 2, output, sources, tracks: [picture], audio }, "/tmp/v2-audio");
  const v1 = {
    version: 1, output, sources, cuts: [{ id: "picture-item", src: "picture", in: 0, out: 10 }],
    layers: [], overlays: [], audio,
  };
  const migrated = migrateEditToV2(v1);
  assert.equal(migrated.ok, true, migrated.blockers?.join("\n"));
  const fromTracks = normalizeEdit(migrated.doc, "/tmp/v2-audio");
  assert.equal(fromTracks.bgm?.ducking, true);
  assert.deepEqual(
    collectBaseDropped(fromTracks).map((entry) => entry.field).sort(),
    collectBaseDropped(topLevel).map((entry) => entry.field).sort(),
  );
});

test("単数 BGM ビューに収まらない 2 本目の bgm item は dropped 候補に残す", () => {
  const edit = structuredClone(tracksFirst);
  edit.sources.push({ id: "second-music", path: "second-music.wav" });
  edit.tracks.push({ id: "second-bgm", lane: "audio", items: [
    { id: "bgm-2", at: 150, duration: 0, role: "bgm", source: { kind: "media", src: "second-music", in: 0 } },
  ] });
  const model = normalizeEdit(edit, "/tmp/v2-audio");
  assert.equal(model.bgm.path, "music.wav");
  assert.deepEqual(model.unsupportedItems.map((entry) => entry.field), ["tracks[second-bgm].items[bgm-2]"]);
  assert.match(model.unsupportedItems[0].reason, /bgm を 1 本しか扱わない/);
  assert.ok(model.unsupportedItems[0].hint);
});

test("0 秒より後の bgm 開始位置だけを dropped に報告する", () => {
  const edit = structuredClone(tracksFirst);
  assert.deepEqual(normalizeEdit(edit, "/tmp/v2-audio").unsupportedItems, []);
  edit.tracks.at(-1).items[0].at = 45;
  const model = normalizeEdit(edit, "/tmp/v2-audio");
  assert.equal(model.bgm.path, "music.wav");
  assert.deepEqual(model.unsupportedItems.map((entry) => entry.field), ["tracks[bgm-track].items[bgm].at"]);
  assert.match(model.unsupportedItems[0].reason, /bgm を 0 秒始まりで配置するため開始位置は移らない/);
  assert.ok(model.unsupportedItems[0].hint);
  assert.deepEqual(collectBaseDropped(model).map((entry) => entry.field), ["tracks[bgm-track].items[bgm].at"]);
  const context = { durations: new Map([["music.wav", 3]]), frameDur: frameDuration(30), totalDuration: baseTimelineDuration(model) };
  for (const writer of [buildFcpxml, buildXmeml]) {
    const result = writer(model, context);
    assert.match(result.xml, /music\.wav/);
    assert.deepEqual(result.dropped.map((entry) => entry.field), ["tracks[bgm-track].items[bgm].at"]);
  }
});
