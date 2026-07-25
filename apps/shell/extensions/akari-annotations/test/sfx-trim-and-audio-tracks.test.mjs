import assert from "node:assert/strict";
import test from "node:test";

import { trimSfxInSource, parseEdit } from "../lib/common/edit-store.js";
import { deriveTracks, deriveDefaultTimelineTracks } from "../lib/common/derive-timeline-tracks.js";

const sfxSource = `{
  "cuts": [{ "in": 0, "out": 2 }],
  "overlays": [],
  "audio": {
    "sfx": [
      { "path": "a.mp3", "t": 1 },
      { "path": "b.mp3", "t": 3, "track": 1, "in": 0.5, "out": 2.5 }
    ]
  }
}
`;

test("trimSfxInSource writes in/out without touching t when nextT is omitted", () => {
  const updated = trimSfxInSource(sfxSource, 0, 0.2, 1.2);
  const parsed = JSON.parse(updated);
  assert.equal(parsed.audio.sfx[0].in, 0.2);
  assert.equal(parsed.audio.sfx[0].out, 1.2);
  assert.equal(parsed.audio.sfx[0].t, 1);
});

test("trimSfxInSource shifts t when nextT is given (left-edge trim, cut-trim と同じ操作感)", () => {
  const updated = trimSfxInSource(sfxSource, 1, 1.0, 2.5, 3.5);
  const parsed = JSON.parse(updated);
  assert.equal(parsed.audio.sfx[1].in, 1.0);
  assert.equal(parsed.audio.sfx[1].out, 2.5);
  assert.equal(parsed.audio.sfx[1].t, 3.5);
});

test("trimSfxInSource with null removes in/out (undo back to implicit 省略時意味論)", () => {
  const updated = trimSfxInSource(sfxSource, 1, null, null);
  const parsed = JSON.parse(updated);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.audio.sfx[1], "in"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.audio.sfx[1], "out"), false);
});

test("trimSfxInSource rejects invalid or too-short ranges", () => {
  assert.throws(() => trimSfxInSource(sfxSource, 0, 0, 0.05), /短すぎます/u);
  assert.throws(() => trimSfxInSource(sfxSource, 0, -1, 2), /in が不正/u);
  assert.throws(() => trimSfxInSource(sfxSource, 0, 0, 0), /out が不正/u);
});

const multiTrackAudioSource = JSON.stringify({
  version: 1,
  output: { width: 1920, height: 1080, fps: 30 },
  cuts: [{ src: "s1", in: 0, out: 2, track: 0 }],
  overlays: [],
  audio: {
    sfx: [
      { path: "a.mp3", t: 1, track: 0 },
      { path: "b.mp3", t: 2, track: 1 }
    ]
  },
  timeline: {
    tracks: [
      { id: "t1", kind: "cuts", ref: 0 },
      { id: "t2", kind: "audio", ref: 0 },
      { id: "t3", kind: "audio", ref: 1 }
    ]
  }
});

test("parseEdit keeps multiple declared audio timeline tracks (R6c 複数音声トラック化)", () => {
  const parsed = parseEdit(multiTrackAudioSource);
  const audioTracks = parsed.timeline.tracks.filter(track => track.kind === "audio");
  assert.equal(audioTracks.length, 2);
  assert.deepEqual(audioTracks.map(track => track.ref), [0, 1]);
  assert.equal(parsed.warnings.some(warning => warning.includes("重複")), false);
});

test("deriveTracks collects multiple audio track numbers like cuts/layers/overlays", () => {
  const edit = {
    cuts: [{ track: 0 }],
    audio: { sfx: [{ track: 0 }, { track: 2 }] }
  };
  const derived = deriveTracks(edit);
  const audioRefs = derived.filter(track => track.kind === "audio").map(track => track.ref);
  assert.deepEqual(audioRefs, [0, 2]);
});

test("deriveDefaultTimelineTracks places the audio group first in storage order (widget の [...tracks].reverse() 規約で画面最下段になる)", () => {
  const edit = {
    cuts: [{ track: 0 }],
    layers: [{ track: 0 }],
    audio: { sfx: [{ track: 0 }] }
  };
  const derived = deriveDefaultTimelineTracks(edit);
  assert.equal(derived[0].kind, "audio");
  assert.equal(derived[1].kind, "cuts");
  assert.equal(derived[2].kind, "layers");
});
