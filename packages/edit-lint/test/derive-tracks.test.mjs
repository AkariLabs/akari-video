import assert from "node:assert/strict";
import test from "node:test";

import { deriveTracks } from "../src/derive-tracks.mjs";

test("empty edit data derives no tracks", () => {
  assert.deepEqual(deriveTracks({}), []);
});

test("visual tracks are grouped in default order and sorted by track number", () => {
  const edit = {
    cuts: [{ track: 3 }, {}, { track: 1 }, { track: 3 }],
    layers: [{ track: 2 }, { track: 0 }],
    overlays: [{ track: 4 }, { track: 1 }],
  };
  assert.deepEqual(deriveTracks(edit), [
    { id: "t1", kind: "cuts", ref: 0 },
    { id: "t2", kind: "cuts", ref: 1 },
    { id: "t3", kind: "cuts", ref: 3 },
    { id: "t4", kind: "layers", ref: 0 },
    { id: "t5", kind: "layers", ref: 2 },
    { id: "t6", kind: "overlays", ref: 1 },
    { id: "t7", kind: "overlays", ref: 4 },
  ]);
});

test("captions and audio each derive one trailing band when data exists", () => {
  const edit = {
    cuts: [{ track: 0 }],
    captions: [{ id: "c1" }, { id: "c2" }],
    audio: { sfx: [{ track: 0 }, { track: 2 }] },
  };
  assert.deepEqual(deriveTracks(edit), [
    { id: "t1", kind: "cuts", ref: 0 },
    { id: "t2", kind: "captions" },
    { id: "t3", kind: "audio", ref: 0 },
  ]);
});

test("derivation is deterministic and does not mutate its input", () => {
  const edit = {
    cuts: [{ track: 2 }, { track: 0 }],
    layers: [{ track: 1 }],
    audio: { sfx: [{ track: 0 }] },
  };
  const snapshot = structuredClone(edit);
  const first = deriveTracks(edit);
  const second = deriveTracks(edit);
  assert.deepEqual(second, first);
  assert.deepEqual(edit, snapshot);
});
