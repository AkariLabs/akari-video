import assert from "node:assert/strict";
import test from "node:test";

import { computeAudioOverlapLayout } from "../lib/common/audio-overlap-layout.js";

test("重なりが無ければ overrides も syntheticTracks も空（無変更のケース）", () => {
  const items = [
    { id: "sfx-0", track: 0, start: 0, end: 5 },
    { id: "sfx-1", track: 0, start: 10, end: 15 },
  ];
  const result = computeAudioOverlapLayout(items, [0]);
  assert.equal(result.overrides.size, 0);
  assert.deepEqual(result.syntheticTracks, []);
});

test("2件が重なると後者だけ表示上の新トラックへ振り分けられる（先着 = ref 据え置き）", () => {
  // dogfood 実データ相当: bgm-outro-morning.wav（114.749〜157.19）と kirakira-24.mp3（144.35〜148.44）が
  // 同一 track（暗黙 0）内で重なる（R6c1 報告の実測ケース）。
  const items = [
    { id: "sfx-7", track: 0, start: 114.749, end: 157.19 },
    { id: "sfx-8", track: 0, start: 144.35, end: 148.44 },
  ];
  const result = computeAudioOverlapLayout(items, [0]);
  assert.equal(result.overrides.size, 1);
  assert.equal(result.overrides.has("sfx-7"), false);
  assert.equal(result.overrides.get("sfx-8"), 1);
  assert.deepEqual(result.syntheticTracks, [{ id: "t-audio-auto-0-1", ref: 1 }]);
});

test("宣言済み ref が既にある場合、新トラックの ref は最大宣言 ref+1 から採番される（衝突回避）", () => {
  const items = [
    { id: "sfx-0", track: 0, start: 0, end: 10 },
    { id: "sfx-1", track: 0, start: 5, end: 15 },
  ];
  // ref 0 と ref 1 が両方とも実宣言済み（ユーザーが手動で作った2本目のオーディオトラック）。
  const result = computeAudioOverlapLayout(items, [0, 1]);
  assert.equal(result.overrides.get("sfx-1"), 2);
  assert.deepEqual(result.syntheticTracks, [{ id: "t-audio-auto-0-1", ref: 2 }]);
});

test("3件が同時に重なると3本目は1本目・2本目のどちらとも別の新トラックへ分かれる", () => {
  const items = [
    { id: "a", track: 0, start: 0, end: 10 },
    { id: "b", track: 0, start: 1, end: 9 },
    { id: "c", track: 0, start: 2, end: 8 },
  ];
  const result = computeAudioOverlapLayout(items, [0]);
  assert.equal(result.overrides.has("a"), false);
  assert.equal(result.overrides.get("b"), 1);
  assert.equal(result.overrides.get("c"), 2);
  assert.equal(result.syntheticTracks.length, 2);
});

test("時間的に離れた2件が同じ新トラックを共有できる（lane は (ref,lane) 単位で固定 ref）", () => {
  // A(0-5) と B(3-8) が重なる → B は lane1 の新トラックへ。D(3-8 と重ならない、20-25) も
  // A と重なる（C, 21-26）が B とは重ならない → B・D は互いに重ならないため同じ lane1 トラックを共有できる。
  const items = [
    { id: "a", track: 0, start: 0, end: 5 },
    { id: "b", track: 0, start: 3, end: 8 },
    { id: "c", track: 0, start: 20, end: 26 },
    { id: "d", track: 0, start: 21, end: 25 },
  ];
  const result = computeAudioOverlapLayout(items, [0]);
  assert.equal(result.overrides.get("b"), result.overrides.get("d"));
  assert.equal(result.syntheticTracks.length, 1);
});

test("異なる ref の重なりはそれぞれ独立に解決され、新トラックの ref は重複しない", () => {
  const items = [
    { id: "a0", track: 0, start: 0, end: 10 },
    { id: "b0", track: 0, start: 1, end: 9 },
    { id: "a1", track: 1, start: 0, end: 10 },
    { id: "b1", track: 1, start: 1, end: 9 },
  ];
  const result = computeAudioOverlapLayout(items, [0, 1]);
  const refForRef0 = result.overrides.get("b0");
  const refForRef1 = result.overrides.get("b1");
  assert.notEqual(refForRef0, refForRef1);
  assert.equal(result.syntheticTracks.length, 2);
});

test("決定的: 同じ入力に対して常に同じ振り分けを返す", () => {
  const items = [
    { id: "sfx-3", track: 0, start: 5, end: 20 },
    { id: "sfx-1", track: 0, start: 0, end: 6 },
    { id: "sfx-2", track: 0, start: 4, end: 9 },
  ];
  const first = computeAudioOverlapLayout(items, [0]);
  const second = computeAudioOverlapLayout(items, [0]);
  assert.deepEqual([...first.overrides.entries()], [...second.overrides.entries()]);
  assert.deepEqual(first.syntheticTracks, second.syntheticTracks);
});

test("宣言済みトラックのみで sfx が無い場合は何も振り分けない", () => {
  const result = computeAudioOverlapLayout([], [0, 1]);
  assert.equal(result.overrides.size, 0);
  assert.deepEqual(result.syntheticTracks, []);
});

test("宣言なき ref（表示専用トラックへドラッグ後に書き戻された track）にもプレースホルダ行ができる", () => {
  // 実測で再現したバグ: ユーザーが sfx を自動配置の表示専用トラック（virtual ref）へドラッグし、
  // その ref が sfx.track として書き戻された後、次回計算時にその ref は declaredRefs（実宣言）
  // には無い。行が無いと該当 sfx が描画先を失って消えてしまう。
  const items = [
    { id: "sfx-0", track: 0, start: 0, end: 5 },
    { id: "taiko", track: 1, start: 20, end: 23 }, // 宣言済みでない ref1 を直接指す（重ならない単独項目）
  ];
  const result = computeAudioOverlapLayout(items, [0]);
  assert.equal(result.overrides.size, 0); // lane0 のまま、override は不要
  assert.deepEqual(result.syntheticTracks, [{ id: "t-audio-implied-1", ref: 1 }]);
});

test("宣言なき ref のプレースホルダと、重なりによる virtual ref の採番が衝突しない", () => {
  const items = [
    { id: "a", track: 0, start: 0, end: 10 },
    { id: "b", track: 0, start: 1, end: 9 }, // ref0 内で重なる → 新しい virtual ref が必要
    { id: "taiko", track: 1, start: 20, end: 23 }, // 宣言なき ref1（プレースホルダ必要）
  ];
  const result = computeAudioOverlapLayout(items, [0]);
  const refs = result.syntheticTracks.map((track) => track.ref);
  assert.equal(new Set(refs).size, refs.length); // ref の重複が無い
  assert.ok(result.syntheticTracks.some((track) => track.id === "t-audio-implied-1" && track.ref === 1));
  const overlapTrack = result.syntheticTracks.find((track) => track.id !== "t-audio-implied-1");
  assert.ok(overlapTrack && overlapTrack.ref === 2); // max(allRefs)+1 = max(0,1)+1 = 2
  assert.equal(result.overrides.get("b"), 2);
});
