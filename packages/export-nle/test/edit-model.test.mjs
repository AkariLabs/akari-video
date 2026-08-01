import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEdit,
  computeCutTimelineOffsets,
  needsGapAwareCutTimeline,
  sourceRangeToTimelineRanges,
  sourcePointToTimeline,
  baseTimelineDuration,
  V0_SOURCE_ID,
} from "../src/edit-model.mjs";

const v1Edit = {
  version: 1,
  output: { width: 1080, height: 1920, fps: 30 },
  sources: [{ id: "main", path: "main.mp4", proxy: null }],
  cuts: [
    { src: "main", in: 0, out: 5, transition_out: { type: "dissolve", duration: 1 } },
    { src: "main", in: 10, out: 15, speed: 2 },
  ],
};

test("normalizeEdit: v0 は単一 source を合成 id で v1 相当へ", () => {
  const model = normalizeEdit({
    version: 0,
    output: { width: 1280, height: 720, fps: 30 },
    source: { path: "source.mp4" },
    cuts: [{ in: 0, out: 5 }],
  }, "/tmp/proj");
  assert.equal(model.sources[0].id, V0_SOURCE_ID);
  assert.equal(model.cuts[0].src, V0_SOURCE_ID);
  assert.equal(model.projectName, "proj");
});

test("computeCutTimelineOffsets: xfade 重複を差し引いた逐次連結（render-cut と同意味論）", () => {
  const model = normalizeEdit(v1Edit, "/tmp/proj");
  // cut1: 5s、xfade 1s → cut2 は 4s から。cut2 は speed 2 で 2.5s
  assert.deepEqual(model.placements, [
    { start: 0, duration: 5 },
    { start: 4, duration: 2.5 },
  ]);
  assert.equal(baseTimelineDuration(model), 6.5);
  assert.equal(model.gapAware, false);
});

test("needsGapAwareCutTimeline: at / track 指定で true", () => {
  assert.equal(needsGapAwareCutTimeline([{ in: 0, out: 5 }]), false);
  assert.equal(needsGapAwareCutTimeline([{ in: 0, out: 5, at: 2 }]), true);
  assert.equal(needsGapAwareCutTimeline([{ in: 0, out: 5, track: 1 }]), true);
});

test("sourceRangeToTimelineRanges: source 秒アンカーを speed 込みで timeline へ写す", () => {
  const model = normalizeEdit(v1Edit, "/tmp/proj");
  // source [11,12) は cut2（in 10 / speed 2）内 → timeline 4 + 0.5 から 0.5s
  const ranges = sourceRangeToTimelineRanges(11, 12, model.cuts, "main");
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, 4.5);
  assert.equal(ranges[0].duration, 0.5);
});

test("sourceRangeToTimelineRanges: カットを跨ぐ範囲は複数レンジに割れる", () => {
  const cuts = [
    { src: "main", in: 0, out: 5 },
    { src: "main", in: 10, out: 15 },
  ];
  const ranges = sourceRangeToTimelineRanges(4, 11, cuts, "main");
  assert.equal(ranges.length, 2);
  assert.deepEqual(ranges.map((range) => [range.start, range.duration]), [[4, 1], [5, 1]]);
});

test("sourcePointToTimeline: どのカットにも含まれなければ null", () => {
  const model = normalizeEdit(v1Edit, "/tmp/proj");
  assert.equal(sourcePointToTimeline(2, model.cuts, "main"), 2);
  assert.equal(sourcePointToTimeline(7, model.cuts, "main"), null);
  assert.equal(sourcePointToTimeline(2, model.cuts, "other"), null);
});
