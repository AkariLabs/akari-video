import assert from "node:assert/strict";
import test from "node:test";

import {
  filmstripChunkIndexFor,
  keyframePolyline,
  planFilmstripChunk,
  waveformBucketForLocalPx,
  waveformHeightForPeak,
} from "../lib/common/filmstrip-geometry.js";
import { FILMSTRIP_CHUNK_SECONDS } from "../lib/common/akari-annotations-protocol.js";

test("filmstripChunkIndexFor はソース秒を FILMSTRIP_CHUNK_SECONDS 単位の等間隔グリッドへ丸める", () => {
  assert.equal(filmstripChunkIndexFor(0), 0);
  assert.equal(filmstripChunkIndexFor(FILMSTRIP_CHUNK_SECONDS - 0.01), 0);
  assert.equal(filmstripChunkIndexFor(FILMSTRIP_CHUNK_SECONDS), 1);
  assert.equal(filmstripChunkIndexFor(FILMSTRIP_CHUNK_SECONDS * 2.5), 2);
  // 負値（境界誤差等）は 0 側にクランプする。
  assert.equal(filmstripChunkIndexFor(-1), 0);
});

test("planFilmstripChunk は 62 分素材で末尾チャンクだけ短くなる（62分実測相当）", () => {
  const durationSeconds = 3745.83; // T2 実測の 62 分素材の実尺
  const lastFullIndex = Math.floor(durationSeconds / FILMSTRIP_CHUNK_SECONDS) - 1;
  const full = planFilmstripChunk(durationSeconds, lastFullIndex);
  assert.equal(full.chunkDurationSeconds, FILMSTRIP_CHUNK_SECONDS);

  const tailIndex = lastFullIndex + 1;
  const tail = planFilmstripChunk(durationSeconds, tailIndex);
  assert.ok(tail.chunkDurationSeconds > 0 && tail.chunkDurationSeconds < FILMSTRIP_CHUNK_SECONDS);
  assert.equal(tail.chunkStartSeconds, tailIndex * FILMSTRIP_CHUNK_SECONDS);
  assert.ok(Math.abs(tail.chunkStartSeconds + tail.chunkDurationSeconds - durationSeconds) < 1e-9);

  // 素材の実尺を超える chunkIndex は範囲外として undefined。
  assert.equal(planFilmstripChunk(durationSeconds, tailIndex + 1), undefined);
});

test("planFilmstripChunk は不正な durationSeconds を拒否する", () => {
  assert.equal(planFilmstripChunk(0, 0), undefined);
  assert.equal(planFilmstripChunk(-5, 0), undefined);
});

test("waveformBucketForLocalPx はズーム100%（offset=0・可視幅=fullClipWidthPx）で peaks 全域へ均等割りする", () => {
  const bucketCount = 200;
  const fullClipWidthPx = 400; // 1 バケツ = 2px
  assert.equal(waveformBucketForLocalPx(0, fullClipWidthPx, bucketCount), 0);
  assert.equal(waveformBucketForLocalPx(399, fullClipWidthPx, bucketCount), 199);
  assert.equal(waveformBucketForLocalPx(200, fullClipWidthPx, bucketCount), 100);
});

test("waveformBucketForLocalPx は高倍率ズーム時、可視サブ区間のバケツだけを指す（全区間の圧縮を防ぐ）", () => {
  const bucketCount = 200;
  const fullClipWidthPx = 20000; // クリップがビュー窓から大きくはみ出す高倍率相当
  // クリップの見かけ上の中央付近だけが可視 → その付近のバケツのみが返る。
  const bucketAtStart = waveformBucketForLocalPx(10000, fullClipWidthPx, bucketCount);
  const bucketAtEnd = waveformBucketForLocalPx(10100, fullClipWidthPx, bucketCount);
  assert.equal(bucketAtStart, 100);
  assert.equal(bucketAtEnd, 101);
  // 先頭・末尾バケツ（0 と 199）には触れない = 全区間の圧縮波形にはならない。
  assert.notEqual(bucketAtStart, 0);
  assert.notEqual(bucketAtEnd, bucketCount - 1);
});

test("waveformBucketForLocalPx は境界外・不正入力を安全にクランプする", () => {
  assert.equal(waveformBucketForLocalPx(-10, 400, 200), 0);
  assert.equal(waveformBucketForLocalPx(10000, 400, 200), 199);
  assert.equal(waveformBucketForLocalPx(100, 0, 200), 0);
  assert.equal(waveformBucketForLocalPx(100, 400, 0), 0);
});

test('waveformHeightForPeak は -48 dB 床の固定対数スケールを使う', () => {
  assert.equal(waveformHeightForPeak(1), 1);
  assert.ok(Math.abs(waveformHeightForPeak(0.5) - 0.8745708351) < 1e-9);
  assert.equal(waveformHeightForPeak(0.001), 0);
  assert.equal(waveformHeightForPeak(0), 0);
});

test('keyframePolyline は -24..+12 dB を帯の上下へ写す', () => {
  assert.deepEqual(keyframePolyline([
    { t: 0, gainDb: 12 }, { t: 5, gainDb: -6 }, { t: 10, gainDb: -24 }
  ], { duration: 10, width: 100, height: 36 }), [
    { x: 0, y: 0 }, { x: 50, y: 18 }, { x: 100, y: 36 }
  ]);
});

test('keyframePolyline は時刻と dB の範囲外をクランプして時刻順にする', () => {
  assert.deepEqual(keyframePolyline([
    { t: 12, gainDb: -60 }, { t: -2, gainDb: 20 }
  ], { duration: 10, width: 100, height: 36 }), [
    { x: 0, y: 0 }, { x: 100, y: 36 }
  ]);
});

test('keyframePolyline は描画不能な帯では空配列を返す', () => {
  const point = [{ t: 0, gainDb: 0 }];
  assert.deepEqual(keyframePolyline(point, { duration: 0, width: 100, height: 20 }), []);
  assert.deepEqual(keyframePolyline(point, { duration: 1, width: 0, height: 20 }), []);
  assert.deepEqual(keyframePolyline(point, { duration: 1, width: 100, height: 0 }), []);
});
