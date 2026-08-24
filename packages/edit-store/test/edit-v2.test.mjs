import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readEditV2 } from "../lib/edit-v2.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "edit-v2.json");

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
