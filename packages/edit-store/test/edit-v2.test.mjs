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
  assert.deepEqual(edit.tracks.slice(0, 3).map((track) => track.role), ["sfx", "narration", "bgm"]);
  assert.deepEqual(edit.tracks[4].content, { from: "captions.json" });
  assert.deepEqual(
    edit.tracks.flatMap((track) => (track.items ?? []).map((item) => item.source.kind)),
    ["media", "media", "media", "media", "filter", "html", "telop"],
  );
  assert.equal(edit.tracks[1].items[0].script, "AKARI Videoへようこそ");
  assert.deepEqual(
    {
      gain_db: edit.tracks[2].items[0].source.gain_db,
      fade_in: edit.tracks[2].items[0].source.fade_in,
      fade_out: edit.tracks[2].items[0].source.fade_out,
      ducking: edit.tracks[2].items[0].source.ducking,
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

test("readEditV2 reports closed source and item violations with a path", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  value.tracks[6].items[0].source.in = 0;
  assert.throws(() => readEditV2(value), /tracks\[6\]\.items\[0\]\.source.*未定義キー/);

  const topLevel = JSON.parse(await readFile(fixturePath, "utf8"));
  topLevel.tracks[7].items[0].textStyle = {};
  assert.throws(() => readEditV2(topLevel), /tracks\[7\]\.items\[0\].*textStyle/);
});

test("readEditV2 validates audio roles and BGM cardinality", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  const invalidRole = structuredClone(value);
  invalidRole.tracks[0].role = "dialogue";
  assert.throws(() => readEditV2(invalidRole), /tracks\[0\]\.role.*sfx\/narration\/bgm/);

  const multipleBgmTracks = structuredClone(value);
  multipleBgmTracks.tracks.push({ id: "a-bgm-2", lane: "audio", role: "bgm", items: [] });
  assert.throws(() => readEditV2(multipleBgmTracks), /tracks.*bgm.*1 本以下/);

  const multipleBgmItems = structuredClone(value);
  multipleBgmItems.tracks[2].items.push({
    ...structuredClone(multipleBgmItems.tracks[2].items[0]),
    id: "music-2",
    at: 300,
  });
  assert.throws(() => readEditV2(multipleBgmItems), /tracks\[2\]\.items.*1 個以下/);
});

test("readEditV2 validates new audio source and narration item fields", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  value.tracks[2].items[0].source.fade_in = -1;
  assert.throws(() => readEditV2(value), /fade_in.*0 以上/);

  const invalidScript = JSON.parse(await readFile(fixturePath, "utf8"));
  invalidScript.tracks[1].items[0].script = 42;
  assert.throws(() => readEditV2(invalidScript), /script.*文字列/);
});

test("readEditV2 rejects fractional or negative v2 keyframe frames", async () => {
  const fractional = JSON.parse(await readFile(fixturePath, "utf8"));
  fractional.tracks[1].items[0].keyframes = [{ t: 0 }, { t: 1.5 }];
  assert.throws(() => readEditV2(fractional), /keyframes\[1\]\.t.*整数/);

  const negative = JSON.parse(await readFile(fixturePath, "utf8"));
  negative.tracks[1].items[0].keyframes = [{ t: 0 }, { t: -1 }];
  assert.throws(() => readEditV2(negative), /keyframes\[1\]\.t.*0 以上の整数/);
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
