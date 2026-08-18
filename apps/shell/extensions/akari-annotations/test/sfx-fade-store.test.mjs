import assert from "node:assert/strict";
import test from "node:test";

import { setSfxFadeInSource } from "../lib/common/sfx-fade-store.js";
import { parseEdit } from "../lib/common/edit-store.js";

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum (audio-clip-fades,
// 2026-08-18): audio.sfx[].fade_in/fade_out write-back. setSfxFadeInSource is a
// self-contained implementation local to this extension (task 2026-08-18-audio-clip-fades's
// file boundary excludes packages/edit-store, where the "正本" for edit.json text-surgery
// would otherwise live -- see sfx-fade-store.ts's header comment), so it is tested directly
// here rather than through packages/edit-store's own test suite.

const sfxSource = `{
  "cuts": [{ "in": 0, "out": 4 }],
  "overlays": [],
  "audio": {
    "sfx": [
      { "path": "a.mp3", "t": 1, "in": 0.5, "out": 1.5 },
      { "path": "b.mp3", "t": 2, "fade_in": 0.3, "fade_out": 0.4 }
    ]
  }
}
`;

test("setSfxFadeInSource appends fade_in/fade_out when absent", () => {
  const updated = setSfxFadeInSource(sfxSource, 0, { fadeIn: 0.2, fadeOut: 0.25 });
  const parsed = JSON.parse(updated);
  assert.equal(parsed.audio.sfx[0].fade_in, 0.2);
  assert.equal(parsed.audio.sfx[0].fade_out, 0.25);
  // untouched sibling fields (in/out/t) survive the round trip
  assert.equal(parsed.audio.sfx[0].in, 0.5);
  assert.equal(parsed.audio.sfx[0].out, 1.5);
  assert.equal(parsed.audio.sfx[0].t, 1);
});

test("setSfxFadeInSource replaces an existing fade_in/fade_out in place", () => {
  const updated = setSfxFadeInSource(sfxSource, 1, { fadeIn: 0.6 });
  const parsed = JSON.parse(updated);
  assert.equal(parsed.audio.sfx[1].fade_in, 0.6);
  assert.equal(parsed.audio.sfx[1].fade_out, 0.4); // untouched (only fadeIn was passed)
});

test("setSfxFadeInSource with null removes the field (undo back to implicit 省略時意味論)", () => {
  const updated = setSfxFadeInSource(sfxSource, 1, { fadeIn: null, fadeOut: null });
  const parsed = JSON.parse(updated);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.audio.sfx[1], "fade_in"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.audio.sfx[1], "fade_out"), false);
});

test("setSfxFadeInSource rejects negative values", () => {
  assert.throws(() => setSfxFadeInSource(sfxSource, 0, { fadeIn: -1 }), /fade_in は 0 以上/u);
  assert.throws(() => setSfxFadeInSource(sfxSource, 0, { fadeOut: -1 }), /fade_out は 0 以上/u);
});

test("setSfxFadeInSource requires at least one field", () => {
  assert.throws(() => setSfxFadeInSource(sfxSource, 0, {}), /変更する fade フィールドを指定/u);
});

test("setSfxFadeInSource only touches the targeted sfx index (sibling items untouched)", () => {
  const updated = setSfxFadeInSource(sfxSource, 0, { fadeIn: 0.9 });
  const parsed = JSON.parse(updated);
  assert.equal(parsed.audio.sfx[0].fade_in, 0.9);
  assert.equal(parsed.audio.sfx[1].fade_in, 0.3); // sfx[1] untouched
  assert.equal(parsed.audio.sfx[1].fade_out, 0.4);
});

// widget's withSfxFade() merges rawValue.audio.sfx[N].fade_in/fade_out into parsed.audioSfx by
// the "sfx-N" id index (parsed.audioSfx can skip invalid raw entries, so array position alone
// is not reliable -- see akari-annotations-widget.ts's EditAudioSfxWithFade header comment).
// This test locks down the id numbering parseEdit produces, which withSfxFade depends on.
test("parseEdit's audioSfx[].id numbering matches the raw array index even when an earlier item is skipped (regression guard for withSfxFade's id-based lookup)", () => {
  const source = JSON.stringify({
    version: 0,
    output: { width: 1280, height: 720, fps: 30 },
    source: { path: "s.mp4", proxy: null },
    cuts: [{ in: 0, out: 10 }],
    overlays: [],
    audio: {
      sfx: [
        { path: "ok0.mp3", t: 1 },
        { path: "", t: 2 }, // invalid (empty path) -- parseEdit skips this one
        { path: "ok2.mp3", t: 3, fade_in: 0.2 }
      ]
    }
  });
  const parsed = parseEdit(source);
  assert.equal(parsed.audioSfx.length, 2);
  assert.deepEqual(parsed.audioSfx.map(item => item.id), ["sfx-0", "sfx-2"]);
});
