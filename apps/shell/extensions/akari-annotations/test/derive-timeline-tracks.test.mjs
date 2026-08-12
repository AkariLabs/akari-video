import assert from "node:assert/strict";
import test from "node:test";

import {
  computeTrackAutoNames,
  deriveDefaultTimelineTracks,
  withCaptionsDisplaySupplement,
} from "../lib/common/derive-timeline-tracks.js";

// captions.json あり + timeline 無し → captions レーン導出
test("deriveDefaultTimelineTracks includes a captions track when hasCaptions is true, even with no inline captions[] and no explicit timeline", () => {
  const edit = {
    cuts: [{ track: 0 }],
    overlays: [],
  };
  const withoutCaptionsJson = deriveDefaultTimelineTracks(edit, false);
  assert.equal(withoutCaptionsJson.some((track) => track.kind === "captions"), false);

  const withCaptionsJson = deriveDefaultTimelineTracks(edit, true);
  const captionsTracks = withCaptionsJson.filter((track) => track.kind === "captions");
  assert.equal(captionsTracks.length, 1);
});

test("deriveDefaultTimelineTracks keeps deriving captions from inline captions[] for backward compatibility (hasCaptions omitted)", () => {
  const edit = {
    cuts: [{ track: 0 }],
    captions: [{ id: "c1", start: 0, end: 1, text: "hi" }],
  };
  const derived = deriveDefaultTimelineTracks(edit);
  assert.equal(derived.some((track) => track.kind === "captions"), true);
});

// captions.json 無し + inline captions 無し → レーン無し（現行維持）
test("deriveDefaultTimelineTracks derives no captions lane when neither captions.json nor inline captions[] have content", () => {
  const edit = {
    cuts: [{ track: 0 }],
    captions: [],
  };
  const derived = deriveDefaultTimelineTracks(edit, false);
  assert.equal(derived.some((track) => track.kind === "captions"), false);
});

// captions.json あり + 明示 timeline（captions 無し）→ 表示補完
test("withCaptionsDisplaySupplement appends a synthetic captions track when the explicit track list lacks one", () => {
  const explicitTracks = [
    { id: "t1", kind: "audio", ref: 0 },
    { id: "t2", kind: "cuts", ref: 0 },
  ];
  const supplemented = withCaptionsDisplaySupplement(explicitTracks, true);
  assert.equal(supplemented.length, 3);
  assert.equal(supplemented[supplemented.length - 1].kind, "captions");
  // 元の配列は変更されない（純関数・edit.json への書き戻しは呼び出し側の責務ですらない）
  assert.equal(explicitTracks.length, 2);
});

test("withCaptionsDisplaySupplement is a no-op when captions.json has no segments", () => {
  const explicitTracks = [{ id: "t1", kind: "cuts", ref: 0 }];
  const supplemented = withCaptionsDisplaySupplement(explicitTracks, false);
  assert.deepEqual(supplemented, explicitTracks);
});

test("withCaptionsDisplaySupplement does not duplicate when a captions track already exists (even hidden:true — the intentional hide door)", () => {
  const explicitTracks = [
    { id: "t1", kind: "cuts", ref: 0 },
    { id: "t2", kind: "captions", hidden: true },
  ];
  const supplemented = withCaptionsDisplaySupplement(explicitTracks, true);
  assert.equal(supplemented.filter((track) => track.kind === "captions").length, 1);
  assert.equal(supplemented.find((track) => track.kind === "captions").hidden, true);
});

test("withCaptionsDisplaySupplement is idempotent regardless of how many times it runs (order-independence of edit.json / captions.json reloads)", () => {
  const explicitTracks = [{ id: "t1", kind: "cuts", ref: 0 }];
  const once = withCaptionsDisplaySupplement(explicitTracks, true);
  const twice = withCaptionsDisplaySupplement(once, true);
  assert.deepEqual(once, twice);
  // captions.json が後から空になった場合、次の再計算では補完対象から外れる
  const clearedAfterReload = withCaptionsDisplaySupplement(explicitTracks, false);
  assert.equal(clearedAfterReload.some((track) => track.kind === "captions"), false);
});

// 命名: audio/captions/映像系の 3 分類
test("computeTrackAutoNames splits tracks into A (audio) / T (captions) / V (cuts, layers, overlays) with per-group numbering from the bottom", () => {
  // 配列先頭 = 画面最下段（widget の [...tracks].reverse() 規約）
  const tracks = [
    { id: "t-audio-0", kind: "audio", ref: 0 },
    { id: "t-audio-1", kind: "audio", ref: 1 },
    { id: "t-cuts-0", kind: "cuts", ref: 0 },
    { id: "t-layers-0", kind: "layers", ref: 0 },
    { id: "t-overlays-0", kind: "overlays", ref: 0 },
    { id: "t-captions", kind: "captions" },
  ];
  const names = computeTrackAutoNames(tracks);
  assert.equal(names.get("t-audio-0"), "A1");
  assert.equal(names.get("t-audio-1"), "A2");
  assert.equal(names.get("t-cuts-0"), "V1");
  assert.equal(names.get("t-layers-0"), "V2");
  assert.equal(names.get("t-overlays-0"), "V3");
  assert.equal(names.get("t-captions"), "T1");
});

test("computeTrackAutoNames numbers multiple captions tracks independently of the video-kind (V) group", () => {
  const tracks = [
    { id: "t-audio-0", kind: "audio", ref: 0 },
    { id: "t-captions-1", kind: "captions" },
    { id: "t-cuts-0", kind: "cuts", ref: 0 },
    { id: "t-captions-2", kind: "captions" },
  ];
  const names = computeTrackAutoNames(tracks);
  assert.equal(names.get("t-audio-0"), "A1");
  assert.equal(names.get("t-captions-1"), "T1");
  assert.equal(names.get("t-cuts-0"), "V1");
  assert.equal(names.get("t-captions-2"), "T2");
});
