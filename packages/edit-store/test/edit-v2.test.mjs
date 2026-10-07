import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readEditV2, setSourceSyncGroup } from "../lib/edit-v2.js";

test('同期の組は保存・解除でき、未知素材と重複所属を拒否する', () => {
  const value = { version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'cam', path: 'cam.mp4' }, { id: 'mic', path: 'mic.wav' }],
    tracks: [{ id: 'v', lane: 'visual', items: [] }] };
  const synced = setSourceSyncGroup(value, 'mic', 'cam');
  assert.deepEqual(readEditV2(synced).sync_groups, [{ id: 'sync-cam-mic', members: [
    { source: 'cam', offset_sec: 0 }, { source: 'mic', offset_sec: 0 },
  ] }]);
  assert.equal(setSourceSyncGroup(synced, 'mic').sync_groups, undefined);
  assert.throws(() => setSourceSyncGroup(value, 'mic', 'missing'), /素材/);
  const duplicate = structuredClone(synced);
  duplicate.sync_groups.push({ id: 'another', members: [
    { source: 'cam', offset_sec: 0 }, { source: 'mic', offset_sec: 0 },
  ] });
  assert.throws(() => readEditV2(duplicate), /1 つの組/);
  const three = structuredClone(synced);
  three.sources.push({ id: 'mic2', path: 'mic2.wav' });
  three.sync_groups[0].members.push({ source: 'mic2', offset_sec: 1 });
  assert.deepEqual(setSourceSyncGroup(three, 'mic').sync_groups[0].members,
    [{ source: 'cam', offset_sec: 0 }, { source: 'mic2', offset_sec: 1 }]);
  const alternate = structuredClone(three);
  alternate.sync_groups[0].members = [
    { source: 'mic', offset_sec: 0 }, { source: 'cam', offset_sec: 1 },
    { source: 'mic2', offset_sec: 2 } ];
  assert.deepEqual(setSourceSyncGroup(alternate, 'mic').sync_groups[0].members,
    [{ source: 'cam', offset_sec: 0 }, { source: 'mic2', offset_sec: 1 }]);
});
import { serializeEdit } from "../lib/canonical.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "edit-v2.json");

test('readEditV2 accepts audio cut_edge and rejects invalid edges', () => {
  const value = { version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4' }], tracks: [
      { id: 'v', lane: 'visual', items: [{ id: 'clip', at: 0, duration: 90,
        source: { kind: 'media', src: 'main', in: 0, out: 3 }, audio: false }] },
      { id: 'a', lane: 'audio', items: [{ id: 'voice', at: 0, duration: 90,
        role: 'speech', link: 'clip', source: { kind: 'media', src: 'main', in: 0, out: 3 },
        cut_edge: { in: 0, out: 3, at: -2 } }] },
    ] };
  assert.deepEqual(readEditV2(value).tracks[1].items[0].cut_edge, { in: 0, out: 3, at: -2 });
  for (const edge of [{ in: 2, out: 2, at: 0 }, { in: -1, out: 3, at: 0 },
    { in: 0, out: 3, at: 0.5 }, { in: 0, out: 3, at: 0, extra: true }]) {
    value.tracks[1].items[0].cut_edge = edge;
    assert.throws(() => readEditV2(value), /cut_edge/);
  }
});

test('media captions on/off survive strict reading and serialization, while other uses fail', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  for (const captions of ['on', 'off']) {
    const value = structuredClone(fixture);
    value.tracks[3].items[0].captions = captions;
    const read = readEditV2(value);
    assert.equal(read.tracks[3].items[0].captions, captions);
    const serializable = { ...read, tracks: read.tracks.map(({ z: _z, ...track }) => track) };
    assert.equal(readEditV2(serializeEdit(serializable)).tracks[3].items[0].captions, captions);
  }
  const invalid = structuredClone(fixture);
  invalid.tracks[3].items[0].captions = 'maybe';
  assert.throws(() => readEditV2(invalid), /captions/);
  const html = structuredClone(fixture);
  html.tracks[6].items[0].captions = 'off';
  assert.throws(() => readEditV2(html), /captions/);
});

test('photo crop rotation and frame survive reading with closed bounds', async () => {
  const value = JSON.parse(await readFile(fixturePath, 'utf8'));
  const item = value.tracks[3].items[0];
  item.crop = { x: .1, y: .1, w: .8, h: .8, rotate: 5 };
  item.frame = { stroke: { color: '#ff8040', width: 8 }, cornerRadius: 40 };
  const read = readEditV2(value).tracks[3].items[0];
  assert.deepEqual(read.crop, item.crop);
  assert.deepEqual(read.frame, item.frame);
  for (const bad of [46, Infinity]) {
    const rejected = structuredClone(value);
    rejected.tracks[3].items[0].crop.rotate = bad;
    assert.throws(() => readEditV2(rejected), /crop.rotate/);
  }
});

test("visual media source accepts embedded speech gain and mute with closed types and ranges", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  const source = value.tracks[3].items[0].source;
  Object.assign(source, { gain_db: -12, mute: true });
  assert.deepEqual(readEditV2(value).tracks[3].items[0].source, source);
  for (const [key, invalid] of [['gain_db', -61], ['gain_db', 13], ['gain_db', Infinity], ['mute', 'true']]) {
    const rejected = structuredClone(value);
    rejected.tracks[3].items[0].source[key] = invalid;
    assert.throws(() => readEditV2(rejected), new RegExp(`tracks\\[3\\]\\.items\\[0\\]\\.source\\.${key}`));
  }
});

test("readEditV2 reads all source kinds and preserves bottom-to-top track order", async () => {
  const text = await readFile(fixturePath, "utf8");
  const edit = readEditV2(text);

  assert.equal(edit.version, 2);
  assert.equal(edit.output.fps, 30);
  assert.deepEqual(edit.tracks.map((track) => track.id), [
    "a-sfx", "a-narration", "a-bgm", "v-main", "captions", "v-filter", "v-html", "v-telop",
  ]);
  assert.deepEqual(edit.tracks.map((track) => track.z), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(edit.tracks[0].lane, "audio");
  assert.deepEqual(edit.tracks.slice(0, 3).map((track) => track.items[0].role ?? "sfx"), ["sfx", "narration", "bgm"]);
  assert.deepEqual(edit.tracks[4].content, { from: "captions.json" });
  assert.deepEqual(
    edit.tracks.flatMap((track) => (track.items ?? []).map((item) => item.source.kind)),
    ["media", "media", "media", "media", "filter", "html", "telop"],
  );
  assert.deepEqual(
    {
      gain_db: edit.tracks[2].items[0].gain_db,
      fade_in: edit.tracks[2].items[0].fade_in,
      fade_out: edit.tracks[2].items[0].fade_out,
      ducking: edit.tracks[2].items[0].ducking,
    },
    { gain_db: -18, fade_in: 1.25, fade_out: 2.5, ducking: true },
  );
  assert.equal(edit.tracks[7].name, "最前面へ入れ替え済み");
});

test("readEditV2 rejects v0/v1 instead of converting them", () => {
  assert.throws(
    () => readEditV2({ version: 1, output: {}, sources: [], tracks: [] }),
    /v0\/v1 はこの reader の対象外/,
  );
});

test("readEditV2 rejects removed top-level vocabulary as undefined keys", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  for (const [key, extension] of [
    ["beats", []],
    ["emphasis_words", []],
    ["direction", {}],
  ]) {
    assert.throws(
      () => readEditV2({ ...value, [key]: extension }),
      new RegExp(`edit\\.json.*未定義キー.*${key}`),
    );
  }
});

test("readEditV2 guides users to move emphasis_words to captions.json", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));

  assert.throws(
    () => readEditV2({ ...value, emphasis_words: [] }),
    (error) => {
      assert.match(error.message, /未定義キー.*emphasis_words/);
      assert.match(error.message, /captions\.json.*トップレベル emphasis_words\[\].*移してください/);
      assert.match(error.message, /contract-2026-08-23-captions-emphasis-words-v0\.md/);
      return true;
    },
  );
});

test("readEditV2 gives recovery guidance for other unknown keys", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));

  assert.throws(
    () => readEditV2({ ...value, unexpected_key: true }),
    /未定義キー.*unexpected_key.*v2 の語彙にありません.*\.akari\/backup\//,
  );
});

test("readEditV2 reports closed source and item violations with a path", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  value.tracks[6].items[0].source.in = 0;
  assert.throws(() => readEditV2(value), /tracks\[6\]\.items\[0\]\.source.*未定義キー/);

  const topLevel = JSON.parse(await readFile(fixturePath, "utf8"));
  topLevel.tracks[7].items[0].textStyle = {};
  assert.throws(() => readEditV2(topLevel), /tracks\[7\]\.items\[0\].*textStyle/);

  const validParams = JSON.parse(await readFile(fixturePath, "utf8"));
  validParams.tracks[6].items[0].source.params = { title: "第1章" };
  assert.doesNotThrow(() => readEditV2(validParams));

  const invalidParams = structuredClone(validParams);
  invalidParams.tracks[6].items[0].source.params.title = 1;
  assert.throws(() => readEditV2(invalidParams), /source\.params\.title.*文字列/);
});

test("readEditV2 validates audio item roles and closed audio item shape", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  const invalidRole = structuredClone(value);
  invalidRole.tracks[0].items[0].role = "dialogue";
  assert.throws(() => readEditV2(invalidRole), /tracks\[0\]\.items\[0\]\.role.*sfx\/narration\/bgm/);

  const visualField = structuredClone(value);
  visualField.tracks[0].items[0].transform = { scale: 1 };
  assert.throws(() => readEditV2(visualField), /tracks\[0\]\.items\[0\].*transform/);
});

test("readEditV2 validates audio item fields and accepts duration: 0 with omitted role", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  value.tracks[2].items[0].fade_in = -1;
  assert.throws(() => readEditV2(value), /fade_in.*0 以上/);

  const sentinel = JSON.parse(await readFile(fixturePath, "utf8"));
  sentinel.tracks[0].items[0].duration = 0;
  delete sentinel.tracks[0].items[0].role;
  delete sentinel.tracks[0].items[0].source.out;
  assert.doesNotThrow(() => readEditV2(sentinel));
});

test("readEditV2 accepts clip adjust v0 and rejects closed/ranged violations", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  value.tracks[3].items[0].adjust = {
    basic: { exposure: 0.5, contrast: -0.25, highlights: 0.1, shadows: -0.1 },
    lut: { lut: "cinematic-warm", intensity: 0.75 },
    sections: { basic: true, lut: false },
  };
  assert.doesNotThrow(() => readEditV2(value));

  const rangeInvalid = structuredClone(value);
  rangeInvalid.tracks[3].items[0].adjust.basic.exposure = 3.01;
  assert.throws(() => readEditV2(rangeInvalid), /adjust\.basic\.exposure.*-3\.\.3/u);

  const unknownInvalid = structuredClone(value);
  unknownInvalid.tracks[3].items[0].adjust.basic.gamma = 0.2;
  assert.throws(() => readEditV2(unknownInvalid), /adjust\.basic.*未定義キー.*gamma/u);

  const lutInvalid = structuredClone(value);
  lutInvalid.tracks[3].items[0].adjust.lut.lut = "";
  assert.throws(() => readEditV2(lutInvalid), /adjust\.lut\.lut.*空でない文字列/u);

  const nullLut = structuredClone(value);
  nullLut.tracks[3].items[0].adjust.lut = null;
  assert.doesNotThrow(() => readEditV2(nullLut));
});

test("readEditV2 accepts and validates narration metadata on audio items", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  const narration = value.tracks[1].items[0];
  narration.script = "表示原稿";
  narration.reading = "よみげんこう";
  narration.provenance = {
    provider: "voicevox", engine: "voicevox-0.25.2", voice: "speaker:13",
    credit: "VOICEVOX:青山龍星", generated_at: "2026-08-03T08:37:37.627Z",
  };
  assert.doesNotThrow(() => readEditV2(value));

  const missingProvider = structuredClone(value);
  delete missingProvider.tracks[1].items[0].provenance.provider;
  assert.throws(() => readEditV2(missingProvider), /provenance\.provider/);

  const missingVoicevoxCredit = structuredClone(value);
  delete missingVoicevoxCredit.tracks[1].items[0].provenance.credit;
  assert.throws(() => readEditV2(missingVoicevoxCredit), /provenance\.credit/);
});

test("readEditV2 rejects fractional or negative v2 keyframe frames", async () => {
  const fractional = JSON.parse(await readFile(fixturePath, "utf8"));
  fractional.tracks[3].items[0].keyframes = [{ t: 0 }, { t: 1.5 }];
  assert.throws(() => readEditV2(fractional), /tracks\[3\].*keyframes\[1\]\.t.*整数/);

  const negative = JSON.parse(await readFile(fixturePath, "utf8"));
  negative.tracks[3].items[0].keyframes = [{ t: 0 }, { t: -1 }];
  assert.throws(() => readEditV2(negative), /tracks\[3\].*keyframes\[1\]\.t.*0 以上の整数/);
});

test("readEditV2 keeps unknown additive keyframe properties tolerant", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  value.tracks[3].items[0].keyframes = [
    { t: 0, future_channel: { value: 1 } },
    { t: 10, future_channel: { value: 2 } },
  ];
  const edit = readEditV2(value);
  assert.deepEqual(edit.tracks[3].items[0].keyframes[0].future_channel, { value: 1 });
});

test("readEditV2 accepts migration-only visual/audio vocabulary without relaxing frame integers", () => {
  const edit = readEditV2({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: "main", path: "main.mp4" }],
    tracks: [{ id: "v1", lane: "visual", items: [{
      id: "c1", at: 0, duration: 30,
      perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] },
      source: {
        kind: "media", src: "main", in: 0, out: 1, speed: 1,
        framing: {}, transition_out: null, freeze: null, fx: [], chroma_key: null,
      },
    }, {
      id: "h1", at: 30, duration: 30,
      source: { kind: "html", path: "overlay.html", vars: { title: "A" } },
    }] }],
    audio: { sfx: [{ path: "hit.wav", t: 0.5 }] },
    captions: [{ id: "c-1", text: "A" }],
  });
  assert.equal(edit.audio.sfx[0].t, 0.5);
  assert.deepEqual(edit.tracks[0].items[1].source.vars, { title: "A" });
});
