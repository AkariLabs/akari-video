import assert from "node:assert/strict";
import test from "node:test";

import {
  audioClipLocalGeometry,
  audioKeyframeMarkerPositions,
  audioLoopTilePeaks,
  audioSourceSliceWindow,
  audioWaveformBandLayout,
  audioWaveformCanvasPlacement,
  audioWaveformRepaintNeeded,
  audioWaveformSourceRect,
  filmstripChunkIndexFor,
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

test('audioSourceSliceWindow は speed 2 の表示4秒を source [1,9) へ換算する', () => {
  assert.deepEqual(audioSourceSliceWindow({ inSec: 1, displayDurationSec: 4, speed: 2 }), {
    startSec: 1,
    endSec: 9,
  });
});

test('audioSourceSliceWindow は speed 省略・不正値を1倍として扱う', () => {
  assert.deepEqual(audioSourceSliceWindow({ inSec: 1, displayDurationSec: 4 }), { startSec: 1, endSec: 5 });
  assert.deepEqual(audioSourceSliceWindow({ inSec: 1, displayDurationSec: 4, speed: 0 }), {
    startSec: 1,
    endSec: 5,
  });
});

test('audioLoopTilePeaks は1周目だけ in から始め2周目以降は素材先頭へ戻る', () => {
  const tiled = audioLoopTilePeaks([0, 1, 2, 3, 4, 5], {
    trackDurationSec: 6,
    timelineDurationSec: 12,
    inSec: 3,
  });
  assert.equal(tiled[0], 3);
  assert.equal(tiled[3], 0);
  assert.equal(tiled[9], 0);
});

test('audioLoopTilePeaks は timeline 1秒を source speed秒で進める', () => {
  assert.deepEqual(audioLoopTilePeaks([0, 1, 2, 3], {
    trackDurationSec: 4,
    timelineDurationSec: 4,
    speed: 2,
  }), [0, 2, 0, 2]);
});

test('audioLoopTilePeaks は長尺出力を maxBuckets で制限する', () => {
  assert.equal(audioLoopTilePeaks([0, 1, 2, 3], {
    trackDurationSec: 4,
    timelineDurationSec: 400,
    maxBuckets: 7,
  }).length, 7);
});

test('audioLoopTilePeaks は空波形・不正尺を空配列にする', () => {
  assert.deepEqual(audioLoopTilePeaks([], { trackDurationSec: 4, timelineDurationSec: 4 }), []);
  assert.deepEqual(audioLoopTilePeaks([1], { trackDurationSec: 0, timelineDurationSec: 4 }), []);
  assert.deepEqual(audioLoopTilePeaks([1], { trackDurationSec: 4, timelineDurationSec: 0 }), []);
});

test('audioClipLocalGeometry は完全可視クリップの offset を0にする', () => {
  assert.deepEqual(audioClipLocalGeometry({
    clipStartSec: 2,
    displayDurationSec: 4,
    layoutViewStartSec: 0,
    viewDurationSec: 10,
    stripWidthPx: 1000,
  }), { fullClipWidthPx: 400, clipLocalOffsetPx: 0 });
});

test('audioClipLocalGeometry は左端が -60% 窓より外なら隠れた幅を返す', () => {
  assert.deepEqual(audioClipLocalGeometry({
    clipStartSec: 2,
    displayDurationSec: 4,
    layoutViewStartSec: 10,
    viewDurationSec: 10,
    stripWidthPx: 1000,
  }), { fullClipWidthPx: 400, clipLocalOffsetPx: 200 });
});

test('audioClipLocalGeometry は不正入力を undefined にする', () => {
  const base = {
    clipStartSec: 0,
    displayDurationSec: 1,
    layoutViewStartSec: 0,
    viewDurationSec: 1,
    stripWidthPx: 100,
  };
  assert.equal(audioClipLocalGeometry({ ...base, displayDurationSec: 0 }), undefined);
  assert.equal(audioClipLocalGeometry({ ...base, viewDurationSec: 0 }), undefined);
  assert.equal(audioClipLocalGeometry({ ...base, stripWidthPx: Number.NaN }), undefined);
});

test('波形配置は左端がビュー外でもT0/T1をクリップの正しいローカル位置から切り出す', () => {
  assert.deepEqual(audioWaveformCanvasPlacement({
    clipStartSec: 0,
    clipDisplayDurationSec: 20,
    waveformStartSec: 0,
    waveformDisplayDurationSec: 20,
    fullClipWidthPx: 2000,
    clipLocalOffsetPx: 400,
    visibleWidthPx: 1600,
  }), {
    canvasLeftPx: 0,
    canvasWidthPx: 1600,
    waveformFullWidthPx: 2000,
    waveformOffsetPx: 400,
  });
});

test('波形配置はクリップ左端がビュー外かつcoverageが途中開始でも時刻位置を保つ', () => {
  assert.deepEqual(audioWaveformCanvasPlacement({
    clipStartSec: 0,
    clipDisplayDurationSec: 20,
    waveformStartSec: 10,
    waveformDisplayDurationSec: 5,
    fullClipWidthPx: 2000,
    clipLocalOffsetPx: 400,
    visibleWidthPx: 1600,
  }), {
    canvasLeftPx: 600,
    canvasWidthPx: 500,
    waveformFullWidthPx: 500,
    waveformOffsetPx: 0,
  });
});

test('波形配置はcoverage先頭がDOM原点より前ならマスター側だけを切り出す', () => {
  assert.deepEqual(audioWaveformCanvasPlacement({
    clipStartSec: 0,
    clipDisplayDurationSec: 20,
    waveformStartSec: 3,
    waveformDisplayDurationSec: 5,
    fullClipWidthPx: 2000,
    clipLocalOffsetPx: 400,
    visibleWidthPx: 1600,
  }), {
    canvasLeftPx: 0,
    canvasWidthPx: 400,
    waveformFullWidthPx: 500,
    waveformOffsetPx: 100,
  });
});

test('波形配置はクリップとcoverageが交差しなければ描画しない', () => {
  assert.equal(audioWaveformCanvasPlacement({
    clipStartSec: 0,
    clipDisplayDurationSec: 5,
    waveformStartSec: 6,
    waveformDisplayDurationSec: 1,
    fullClipWidthPx: 500,
    clipLocalOffsetPx: 0,
    visibleWidthPx: 500,
  }), undefined);
});

test('audioWaveformBandLayout はラベル後の残り領域中央へ90%高で置く', () => {
  assert.deepEqual(audioWaveformBandLayout(52, 18), { topPx: 19.5, heightPx: 31 });
});

test('audioWaveformBandLayout は高さを12pxで下限クランプする', () => {
  assert.deepEqual(audioWaveformBandLayout(28, 18), { topPx: 15, heightPx: 12 });
});

test('audioWaveformBandLayout は28pxの旧上限を越えて拡大する', () => {
  assert.deepEqual(audioWaveformBandLayout(100, 18), { topPx: 22, heightPx: 74 });
});

test('audioWaveformBandLayout は帯が収まらない高さでも要素外へ出さない', () => {
  assert.deepEqual(audioWaveformBandLayout(10, 18), { topPx: 0, heightPx: 12 });
});

test('audioKeyframeMarkerPositions は範囲外をクランプし非有限を除いて時刻順にする', () => {
  assert.deepEqual(audioKeyframeMarkerPositions([
    { t: 12 }, { t: Number.NaN }, { t: 5 }, { t: -2 },
  ], 10), [0, 0.5, 1]);
});

test('audioKeyframeMarkerPositions は不正な尺で空配列を返す', () => {
  assert.deepEqual(audioKeyframeMarkerPositions([{ t: 1 }], 0), []);
  assert.deepEqual(audioKeyframeMarkerPositions([{ t: 1 }], Number.NaN), []);
});

test('audioWaveformSourceRect は可視位置と幅をマスター座標へ写す', () => {
  assert.deepEqual(audioWaveformSourceRect({
    masterWidthPx: 100,
    fullClipWidthPx: 400,
    clipLocalOffsetPx: 100,
    visibleWidthPx: 200,
  }), { sourceXPx: 25, sourceWidthPx: 50 });
});

test('audioWaveformSourceRect はマスター末尾で source 幅をクランプする', () => {
  assert.deepEqual(audioWaveformSourceRect({
    masterWidthPx: 100,
    fullClipWidthPx: 400,
    clipLocalOffsetPx: 300,
    visibleWidthPx: 200,
  }), { sourceXPx: 75, sourceWidthPx: 25 });
  assert.equal(audioWaveformSourceRect({
    masterWidthPx: 0,
    fullClipWidthPx: 400,
    clipLocalOffsetPx: 0,
    visibleWidthPx: 200,
  }), undefined);
});

test('audioWaveformRepaintNeeded は5要素が同じなら再描画しない', () => {
  const state = { sliceKey: 'a', visibleWidth: 100, offset: 0, bandTop: 20, bandHeight: 12 };
  assert.equal(audioWaveformRepaintNeeded(state, { ...state }), false);
});

test('audioWaveformRepaintNeeded は初回またはいずれかの要素変更で再描画する', () => {
  const state = { sliceKey: 'a', visibleWidth: 100, offset: 0, bandTop: 20, bandHeight: 12 };
  assert.equal(audioWaveformRepaintNeeded(undefined, state), true);
  for (const next of [
    { ...state, sliceKey: 'b' },
    { ...state, visibleWidth: 101 },
    { ...state, offset: 1 },
    { ...state, left: 1 },
    { ...state, bandTop: 21 },
    { ...state, bandHeight: 13 },
  ]) {
    assert.equal(audioWaveformRepaintNeeded(state, next), true);
  }
});
