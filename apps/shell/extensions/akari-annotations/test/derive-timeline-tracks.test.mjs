import assert from "node:assert/strict";
import test from "node:test";

import {
  computeTrackAutoNames,
  deriveDefaultTimelineTracks,
  withAudioDisplaySupplement,
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

// --- 2026-08-18 実機報告「BGM が鳴るのにタイムラインに出ない」 ---

// 意図的分岐 5: bgm だけのプロジェクト（sfx/narration 無し）でも audio トラックを導出する
test("deriveDefaultTimelineTracks derives an audio ref-0 track from audio.bgm alone", () => {
  const edit = {
    cuts: [{ track: 0 }],
    audio: { bgm: { path: "assets/audio/bgm.mp3", gain_db: -6 } },
  };
  const derived = deriveDefaultTimelineTracks(edit);
  const audioTracks = derived.filter((track) => track.kind === "audio");
  assert.equal(audioTracks.length, 1);
  assert.equal(audioTracks[0].ref, 0);
  // 音源グループは最下段固定（R6 契約 §1 裁定 1）= 既定順序で先頭
  assert.equal(derived[0].kind, "audio");
});

test("deriveDefaultTimelineTracks derives no audio track when audio is absent (non-regression)", () => {
  const derived = deriveDefaultTimelineTracks({ cuts: [{ track: 0 }] });
  assert.equal(derived.some((track) => track.kind === "audio"), false);
});

// 表示専用の音声レーン補完（字幕補完・裁定 2 と同型）
test("withAudioDisplaySupplement prepends an implied bottom-most audio row when bgm exists and no audio kind is declared", () => {
  const explicit = [
    { id: "t1", kind: "cuts", ref: 0 },
    { id: "t2", kind: "cuts", ref: 1 },
  ];
  const supplemented = withAudioDisplaySupplement(explicit, true);
  assert.equal(supplemented.length, 3);
  // 配列先頭 = 画面最下段（widget の displayTimelineTracks 規約）
  assert.deepEqual(supplemented[0], { id: "t-audio-implied", kind: "audio", ref: 0 });
  assert.deepEqual(supplemented.slice(1), explicit);
});

test("withAudioDisplaySupplement does not supplement when an audio kind exists (even hidden) — the declared row is the user's intent", () => {
  const withHiddenAudio = [
    { id: "a1", kind: "audio", ref: 0, hidden: true },
    { id: "t1", kind: "cuts", ref: 0 },
  ];
  const result = withAudioDisplaySupplement(withHiddenAudio, true);
  assert.deepEqual(result, withHiddenAudio);
});

test("withAudioDisplaySupplement is a no-op without bgm and never mutates its input", () => {
  const explicit = [{ id: "t1", kind: "cuts", ref: 0 }];
  const frozen = Object.freeze([...explicit]);
  assert.deepEqual(withAudioDisplaySupplement(frozen, false), explicit);
  assert.deepEqual(withAudioDisplaySupplement(frozen, true)[0].id, "t-audio-implied");
});
