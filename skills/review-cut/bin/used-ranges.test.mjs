import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deriveUsedRanges, mergeRanges } from "./used-ranges.mjs";

const cliPath = fileURLToPath(new URL("./used-ranges.mjs", import.meta.url));

test("v0 direct-path cuts merge overlapping and adjacent source ranges", () => {
  const result = deriveUsedRanges({
    version: 0,
    cuts: [
      { src: "assets/a.mp4", in: 0, out: 4, speed: 2 },
      { src: "assets/a.mp4", in: 3, out: 5 },
      { src: "assets/a.mp4", in: 5, out: 6, freeze: { at_sec: 0.5, duration_sec: 2 } },
      { src: "assets/b.mp4", in: 10, out: 12 },
    ],
  });

  assert.equal(result.timeline_duration_s, 9);
  assert.equal(result.cut_count, 4);
  assert.deepEqual(result.sources.map(({ src, path, ranges }) => ({ src, path, ranges })), [
    { src: "assets/a.mp4", path: "assets/a.mp4", ranges: [{ in: 0, out: 6 }] },
    { src: "assets/b.mp4", path: "assets/b.mp4", ranges: [{ in: 10, out: 12 }] },
  ]);
  assert.deepEqual(result.sources[0].uses.map((use) => use.timeline), [
    { in: 0, out: 2 },
    { in: 2, out: 4 },
    { in: 4, out: 7 },
  ]);
  assert.deepEqual(result.sources[0].uses[2].freeze, {
    at_sec: 0.5,
    duration_sec: 2,
    source_time_s: 5.5,
    timeline: { in: 4.5, out: 6.5 },
  });
  assert.equal(result.media_item_count, 4);
});

test("v0 accepts the canonical source object when cuts omit src", () => {
  const result = deriveUsedRanges({
    version: 0,
    source: { path: "assets/main.mov" },
    cuts: [{ in: 1.25, out: 2.75 }],
  });
  assert.deepEqual(result.sources[0].ranges, [{ in: 1.25, out: 2.75 }]);
  assert.equal(result.sources[0].src, "assets/main.mov");
});

test("v0 with no cuts reports whole-source usage without inventing a duration", () => {
  const result = deriveUsedRanges({
    version: 0,
    source: { path: "assets/full.mov" },
    cuts: [],
  });
  assert.equal(result.timeline_duration_s, null);
  assert.deepEqual(result.sources, [{
    src: "assets/full.mov",
    path: "assets/full.mov",
    whole_source: true,
    ranges: [],
    uses: [],
  }]);
  assert.match(result.warnings[0], /whole source/u);
});

test("v1 resolves source ids, keeps use order, and skips unknown ids with a warning", () => {
  const result = deriveUsedRanges({
    version: 1,
    sources: [
      { id: "s1", path: "assets/one.mp4" },
      { id: "s2", path: "assets/two.mp4" },
    ],
    cuts: [
      { src: "s2", in: 4, out: 7 },
      { src: "s1", in: 0, out: 2, speed: 0.5 },
      { src: "s2", in: 7, out: 8 },
      { src: "missing", in: 0, out: 1 },
    ],
  });

  assert.equal(result.timeline_duration_s, 8);
  assert.equal(result.cut_count, 3);
  assert.deepEqual(result.sources.map(({ src, path, ranges }) => ({ src, path, ranges })), [
    { src: "s2", path: "assets/two.mp4", ranges: [{ in: 4, out: 8 }] },
    { src: "s1", path: "assets/one.mp4", ranges: [{ in: 0, out: 2 }] },
  ]);
  assert.deepEqual(result.warnings, ["cuts[3].src does not reference a declared source; skipped"]);
});

test("v1 honors explicit at and keeps independent cursors per track", () => {
  const result = deriveUsedRanges({
    version: 1,
    sources: [{ id: "s1", path: "assets/one.mp4" }],
    cuts: [
      { src: "s1", in: 0, out: 2 },
      { src: "s1", in: 2, out: 3, at: 5 },
      { src: "s1", in: 3, out: 5 },
      { src: "s1", in: 10, out: 13, track: 1 },
      { src: "s1", in: 13, out: 14, track: 1, at: 10 },
      { src: "s1", in: 14, out: 15, track: 1 },
    ],
  });

  assert.deepEqual(result.sources[0].uses.map(({ track, timeline }) => ({ track, timeline })), [
    { track: 0, timeline: { in: 0, out: 2 } },
    { track: 0, timeline: { in: 5, out: 6 } },
    { track: 0, timeline: { in: 6, out: 8 } },
    { track: 1, timeline: { in: 0, out: 3 } },
    { track: 1, timeline: { in: 10, out: 11 } },
    { track: 1, timeline: { in: 11, out: 12 } },
  ]);
  assert.equal(result.timeline_duration_s, 12);
});

test("v0 honors explicit at and resumes implicit placement from that track end", () => {
  const result = deriveUsedRanges({
    version: 0,
    source: { path: "assets/main.mp4" },
    cuts: [
      { in: 0, out: 2, at: 4 },
      { in: 2, out: 3 },
      { in: 3, out: 5, track: 2, at: 10 },
      { in: 5, out: 6, track: 2 },
    ],
  });
  assert.deepEqual(result.sources[0].uses.map(({ track, timeline }) => ({ track, timeline })), [
    { track: 0, timeline: { in: 4, out: 6 } },
    { track: 0, timeline: { in: 6, out: 7 } },
    { track: 2, timeline: { in: 10, out: 12 } },
    { track: 2, timeline: { in: 12, out: 13 } },
  ]);
  assert.equal(result.timeline_duration_s, 13);
});

test("v2 converts output frames to timeline seconds using output.fps", () => {
  const result = deriveUsedRanges({
    version: 2,
    output: { width: 1920, height: 1080, fps: 24 },
    sources: [{ id: "s1", path: "assets/clip.mp4" }],
    tracks: [{
      id: "visual-main",
      lane: "visual",
      items: [{
        id: "clip-1",
        at: 48,
        duration: 72,
        source: { kind: "media", src: "s1", in: 10, out: 13 },
      }],
    }],
  });

  assert.deepEqual(result.sources[0].uses[0].timeline, { in: 2, out: 5 });
  assert.deepEqual(result.sources[0].ranges, [{ in: 10, out: 13 }]);
  assert.equal(result.timeline_duration_s, 5);
});

test("v2 excludes non-visual-media items from ranges and counts each item kind", () => {
  const result = deriveUsedRanges({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [
      { id: "video", path: "assets/video.mp4" },
      { id: "audio", path: "assets/audio.wav" },
    ],
    tracks: [
      {
        id: "visual",
        lane: "visual",
        items: [
          { id: "m", at: 0, duration: 30, source: { kind: "media", src: "video", in: 0, out: 1 } },
          { id: "h", at: 0, duration: 60, source: { kind: "html", path: "overlays/a.html" } },
          { id: "t", at: 0, duration: 90, source: { kind: "telop", preset: "chapter" } },
          { id: "f", at: 0, duration: 120, source: { kind: "filter", filter: { kind: "invert" } } },
        ],
      },
      {
        id: "audio",
        lane: "audio",
        items: [{ id: "a", at: 0, duration: 150, source: { kind: "media", src: "audio", in: 0, out: 5 } }],
      },
      { id: "captions", lane: "visual", content: { from: "captions.json" } },
    ],
  });

  assert.deepEqual(result.sources.map(({ src }) => src), ["video"]);
  assert.deepEqual({
    media: result.media_item_count,
    overlay: result.overlay_item_count,
    telop: result.telop_item_count,
    filter: result.filter_item_count,
    audioMedia: result.audio_media_item_count,
    captions: result.caption_track_count,
  }, { media: 1, overlay: 1, telop: 1, filter: 1, audioMedia: 1, captions: 1 });
  assert.equal(result.timeline_duration_s, 5);
});

test("v2 uses the maximum item end across tracks and merges overlapping ranges per src", () => {
  const result = deriveUsedRanges({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [
      { id: "a", path: "assets/a.mp4" },
      { id: "b", path: "assets/b.mp4" },
    ],
    tracks: [
      {
        id: "lower",
        lane: "visual",
        items: [
          { id: "a1", at: 0, duration: 90, source: { kind: "media", src: "a", in: 0, out: 4 } },
          { id: "a2", at: 90, duration: 60, source: { kind: "media", src: "a", in: 3, out: 6 } },
        ],
      },
      {
        id: "upper",
        lane: "visual",
        items: [{ id: "b1", at: 180, duration: 120, source: { kind: "media", src: "b", in: 20, out: 24 } }],
      },
    ],
  });

  assert.equal(result.timeline_duration_s, 10);
  assert.deepEqual(result.sources.map(({ src, ranges }) => ({ src, ranges })), [
    { src: "a", ranges: [{ in: 0, out: 6 }] },
    { src: "b", ranges: [{ in: 20, out: 24 }] },
  ]);
});

test("mergeRanges is deterministic for unsorted overlap and adjacency", () => {
  const input = [{ in: 8, out: 10 }, { in: 1, out: 4 }, { in: 4, out: 6 }, { in: 2, out: 3 }];
  assert.deepEqual(mergeRanges(input), [{ in: 1, out: 6 }, { in: 8, out: 10 }]);
  assert.deepEqual(mergeRanges(input), mergeRanges([...input].reverse()));
});

test("CLI reads a temporary fixture and emits byte-stable JSON", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "critique-cut-used-ranges-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const editPath = join(directory, "edit.json");
  await writeFile(editPath, `${JSON.stringify({
    version: 1,
    sources: [{ id: "s1", path: "assets/clip.mp4" }],
    cuts: [{ src: "s1", in: 2, out: 5, speed: 1.5 }],
  })}\n`, "utf8");

  const first = spawnSync(process.execPath, [cliPath, editPath], { encoding: "utf8" });
  const second = spawnSync(process.execPath, [cliPath, editPath], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(JSON.parse(first.stdout), {
    version: 1,
    timeline_duration_s: 2,
    cut_count: 1,
    media_item_count: 1,
    overlay_item_count: 0,
    telop_item_count: 0,
    filter_item_count: 0,
    audio_media_item_count: 0,
    caption_track_count: 0,
    unknown_item_count: 0,
    sources: [{
      src: "s1",
      path: "assets/clip.mp4",
      ranges: [{ in: 2, out: 5 }],
      uses: [{
        cut_index: 0,
        track: 0,
        source: { in: 2, out: 5 },
        timeline: { in: 0, out: 2 },
        speed: 1.5,
        freeze: null,
      }],
    }],
    warnings: [],
  });
});
