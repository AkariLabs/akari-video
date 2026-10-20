// 実機バグ 2026-10-20 §1（task/2026-10-20-cuts-keep-declared-at）の再現。
//
// v2 の visual トラックが複数あり、各 media アイテムが `at` を明示しているのに、
// プレビュー / capture / 書き出しで 1 本の cuts 連結にまとめられ、宣言時刻を失って
// 前詰めに並ぶ（報告: 166.8 秒から前詰め・totalDuration 206.2 秒 / edit.json は 177.2 秒）。
//
// 原因は旧 cuts 投影の `track` が「種別（cuts / layers / overlays）ごとの ref」だったこと。
// 3D テロップ（html）など別種別のアイテムを含む背景トラックの media は overlays の ref を
// 持ち、純粋な cuts トラックの ref と同じ番号に衝突する。cuts 連結のキーはこの `track` 一枚
// なので、別々の物理トラックが 1 本の連結チェーンに混ざり、後続アイテムの `at` が捨てられる。
//
// ここでは edit-store のモデル層（readInternalEdit → projectLegacyEdit →
// computeCutTrackSegments / buildTimelineMap）だけで、報告の構成の各 media アイテムが
// 宣言 `at` に配置され、総尺が edit.json の尺（177.2 秒）と一致することを検査する。
// 連結チェーンの実挙動（直前の終端より前の at は捨てる）も同じテスト内で再現する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimelineMap,
  computeCutTrackSegments,
  projectLegacyEdit,
  readInternalEdit,
} from '../lib/index.js';

const FPS = 30;
const seconds = frames => frames / FPS;

/** 報告 §1 の構成。背景トラックには 3D 地形（html）があり、その後に静止画 1 枚が続く。 */
function reportedFixture() {
  return {
    version: 2,
    output: { width: 1920, height: 1080, fps: FPS },
    sources: [
      { id: 'bg', path: 'assets/bg.png' },
      { id: 'photo-1', path: 'assets/photo-1.jpg' },
      { id: 'photo-2', path: 'assets/photo-2.jpg' },
      { id: 'card', path: 'assets/card.png' },
    ],
    tracks: [
      {
        id: 'bg-track',
        lane: 'visual',
        items: [
          { id: 'terrain', at: 0, duration: 5004, source: { kind: 'html', path: 'overlays/terrain.html' } },
          { id: 'bg-1', at: 5004, duration: 312, source: { kind: 'media', src: 'bg', in: 0, out: 312 } },
        ],
      },
      {
        id: 'photo-track',
        lane: 'visual',
        items: [
          { id: 'photo-1', at: 1000, duration: 300, source: { kind: 'media', src: 'photo-1', in: 0, out: 300 } },
          { id: 'photo-2', at: 1400, duration: 300, source: { kind: 'media', src: 'photo-2', in: 0, out: 300 } },
        ],
      },
      {
        id: 'card-track',
        lane: 'visual',
        items: [
          { id: 'card-1', at: 390, duration: 150, source: { kind: 'media', src: 'card', in: 0, out: 150 } },
        ],
      },
    ],
  };
}

/** 宣言 at → 実際の連結位置。プレビュー / capture / 書き出しの normalizedCuts と同じ規則。 */
function placeLikeCutChain(cuts) {
  const cursorByTrack = new Map();
  const stripped = cuts.map(cut => {
    const track = Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0;
    const cursor = cursorByTrack.get(track) ?? 0;
    const explicitAt = Number.isFinite(cut.at) && cut.at >= 0 ? Number(cut.at) : null;
    const keepAt = explicitAt !== null && explicitAt > cursor + 1e-6;
    const at = keepAt ? explicitAt : cursor;
    cursorByTrack.set(track, at + (Number(cut.out) - Number(cut.in)) / (cut.speed ?? 1));
    const { at: _at, track: _track, ...rest } = cut;
    return { ...rest, ...(keepAt ? { at } : {}), track };
  });
  return computeCutTrackSegments(stripped);
}

test('報告 §1: 別トラックの単独静止画が宣言 at に出る（1 本の cuts 連結に混ぜない）', () => {
  const internal = readInternalEdit(reportedFixture());
  const legacy = projectLegacyEdit(internal);
  const cuts = legacy.cuts;
  const placed = placeLikeCutChain(cuts);

  const declared = new Map();
  for (const cut of cuts) declared.set(String(cut.src), Number(cut.at));
  const actual = new Map();
  for (const segment of placed) actual.set(String(cuts[segment.index].src), segment.at);

  // 各 media アイテムの出力時刻 = 宣言 at（報告の 13.0 / 33.3 / 46.7 / 166.8 秒）。
  for (const [src, at] of declared) {
    assert.ok(Math.abs(actual.get(src) - at) <= 1 / FPS,
      `${src}: declared at ${at} but placed at ${actual.get(src)}`);
  }
  assert.deepEqual([...actual.entries()].sort((a, b) => a[1] - b[1]).map(([src, at]) => [src, Number(at.toFixed(3))]), [
    ['card', 13], ['photo-1', 33.333], ['photo-2', 46.667], ['bg', 166.8],
  ]);

  // 物理トラックごとに別の連結キー。3 トラックが同じ番号に潰れていないこと。
  const trackBySrc = new Map(cuts.map(cut => [String(cut.src), cut.track]));
  assert.equal(new Set([trackBySrc.get('bg'), trackBySrc.get('photo-1'), trackBySrc.get('card')]).size, 3,
    `distinct cut track keys, got ${JSON.stringify([...trackBySrc])}`);
  assert.equal(trackBySrc.get('photo-1'), trackBySrc.get('photo-2'), 'same track keeps one chain');

  // 総尺は edit.json の尺（最後の静止画の終端 177.2 秒）と同じ。
  assert.ok(Math.abs(seconds(5004 + 312) - 177.2) < 1e-9);
  assert.ok(Math.abs(buildTimelineMap(cuts).totalDuration - 177.2) <= 1 / FPS,
    `totalDuration ${buildTimelineMap(cuts).totalDuration}`);
});

test('単一トラックの連続カットは従来どおり at 無しでも連結される', () => {
  const internal = readInternalEdit({
    version: 2,
    output: { width: 1920, height: 1080, fps: FPS },
    sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
    tracks: [{
      id: 'v1', lane: 'visual', items: [
        { id: 'a1', at: 0, duration: 30, source: { kind: 'media', src: 'a', in: 0, out: 1 } },
        { id: 'b1', at: 30, duration: 30, source: { kind: 'media', src: 'b', in: 0, out: 1 } },
      ],
    }],
  });
  const cuts = projectLegacyEdit(internal).cuts;
  const placed = computeCutTrackSegments(cuts);
  assert.deepEqual(placed.map(segment => segment.at), [0, 1]);
  assert.equal(new Set(cuts.map(cut => cut.track)).size, 1);
});

test('同一トラックで時間が重なる media は従来どおり layers のまま', () => {
  const internal = readInternalEdit({
    version: 2,
    output: { width: 1920, height: 1080, fps: FPS },
    sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
    tracks: [{
      id: 'v1', lane: 'visual', items: [
        { id: 'a1', at: 0, duration: 60, source: { kind: 'media', src: 'a', in: 0, out: 2 } },
        { id: 'b1', at: 15, duration: 60, source: { kind: 'media', src: 'b', in: 0, out: 2 } },
      ],
    }],
  });
  const legacy = projectLegacyEdit(internal);
  assert.equal(legacy.cuts.length, 0);
  assert.deepEqual(legacy.layers.map(layer => layer.id), ['a1', 'b1']);
});
