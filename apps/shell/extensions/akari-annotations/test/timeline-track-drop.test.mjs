import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampTimelinePanelDropPoint,
  hitTestTimelineTrackDrop,
  planDragAutoScroll
} from '../lib/common/timeline-track-drop.js';

const layouts = [
  { id: 'v3', lane: 'visual', acceptsItems: true, rawIndex: 5, track: 2, top: 20, height: 40 },
  { id: 'captions', lane: 'visual', acceptsItems: false, rawIndex: 4, track: 0, top: 66, height: 36 },
  { id: 'v2', lane: 'visual', acceptsItems: true, rawIndex: 3, track: 1, top: 108, height: 40 },
  { id: 'audio', lane: 'audio', acceptsItems: true, rawIndex: 0, track: 0, top: 154, height: 40 }
];

test('差し込み帯を離れた段本体は既存段へ配置する', () => {
  for (const y of [112, 120, 138, 147]) {
    assert.deepEqual(hitTestTimelineTrackDrop(y, layouts, 2), {
      track: 1, top: 108, height: 40, rejected: false, targetTrackId: 'v2'
    });
  }
});

test('隣接段の境界は差し込み先を返す', () => {
  const adjacent = [
    { id: 'v3', lane: 'visual', acceptsItems: true, rawIndex: 4, track: 2, top: 20, height: 40 },
    { id: 'v2', lane: 'visual', acceptsItems: true, rawIndex: 3, track: 1, top: 66, height: 40 }
  ];
  assert.equal(hitTestTimelineTrackDrop(62, adjacent, 2).insertIndex, 4);
  assert.equal(hitTestTimelineTrackDrop(65, adjacent, 2).insertIndex, 4);
  assert.equal(hitTestTimelineTrackDrop(62, adjacent, 2).top, 63);
  assert.equal(hitTestTimelineTrackDrop(72, adjacent, 2).targetTrackId, 'v2');
});

test('最上段の外側へ出たときだけ新しい最上段を tracks[] の末尾側へ作る', () => {
  assert.deepEqual(hitTestTimelineTrackDrop(19, layouts, 1), {
    track: 1, top: 20, height: 40, rejected: false, insertIndex: 6
  });
  assert.equal(hitTestTimelineTrackDrop(20, layouts, 1).targetTrackId, 'v3');
});

test('content 型字幕が最上段でも字幕の帯の上は正当な最上段挿入になる', () => {
  const captionsOnTop = [
    { ...layouts[1], rawIndex: 6, top: 20 },
    { ...layouts[0], top: 62 },
    { ...layouts[2], top: 108 },
    { ...layouts[3], top: 154 }
  ];
  assert.deepEqual(hitTestTimelineTrackDrop(19, captionsOnTop, 2), {
    track: 2, top: 20, height: 40, rejected: false, insertIndex: 7
  });
  assert.equal(hitTestTimelineTrackDrop(30, captionsOnTop, 2).rejected, true);
});

test('visual 群の下端外側では最下段 visual を挿入し、audio 本体では拒否する', () => {
  assert.deepEqual(hitTestTimelineTrackDrop(150, layouts, 2), {
    track: 2, top: 148, height: 40, rejected: false, insertIndex: 3
  });
  assert.equal(hitTestTimelineTrackDrop(155, layouts, 2).rejected, true);
});

test('最上段から遠く上でも新しい最上段を作る', () => {
  assert.deepEqual(hitTestTimelineTrackDrop(-1000, layouts, 2), {
    track: 2, top: 20, height: 40, rejected: false, insertIndex: 6
  });
});

test('audio が無ければ最下段から遠く下でも新しい最下段 visual を作る', () => {
  const withoutAudio = layouts.filter(layout => layout.lane !== 'audio');
  assert.deepEqual(hitTestTimelineTrackDrop(1000, withoutAudio, 2), {
    track: 2, top: 148, height: 40, rejected: false, insertIndex: 3
  });
});

test('audio 本体は距離に関わらず lane 越えとして拒否する', () => {
  assert.equal(hitTestTimelineTrackDrop(155, layouts, 2).rejected, true);
});

const panelRects = {
  panelRect: { left: 0, right: 500, top: 0, bottom: 300 },
  headerColumnRect: { left: 0, right: 100, top: 50, bottom: 250 },
  stripRect: { left: 100, right: 500, top: 50, bottom: 250 }
};

test('パネル内の素材ドロップ座標を 5 ゾーンへ固定する', () => {
  const cases = [
    [{ pointerX: 101, pointerY: 51 }, { x: 101, y: 51, zone: 'strip' }],
    [{ pointerX: 499, pointerY: 249 }, { x: 499, y: 249, zone: 'strip' }],
    [{ pointerX: 100, pointerY: 49 }, { x: 100, y: 51, zone: 'ruler-above' }],
    [{ pointerX: 499, pointerY: 0 }, { x: 499, y: 51, zone: 'ruler-above' }],
    [{ pointerX: 100, pointerY: 250 }, { x: 100, y: 249, zone: 'below-strip' }],
    [{ pointerX: 499, pointerY: 299 }, { x: 499, y: 249, zone: 'below-strip' }],
    [{ pointerX: 99, pointerY: 50 }, { x: 101, y: 50, zone: 'header-column' }],
    [{ pointerX: 0, pointerY: 249 }, { x: 101, y: 249, zone: 'header-column' }],
    [{ pointerX: -1, pointerY: 50 }, { x: -1, y: 50, zone: 'outside' }],
    [{ pointerX: 501, pointerY: 250 }, { x: 501, y: 250, zone: 'outside' }]
  ];
  for (const [pointer, expected] of cases) {
    assert.deepEqual(clampTimelinePanelDropPoint({ ...pointer, ...panelRects }), expected);
  }
});

test('素材ドラッグの縦オートスクロールは上下 24px だけ 8px 動かす', () => {
  const stripRect = panelRects.stripRect;
  for (const [pointerY, deltaY] of [
    [49, 0], [50, -8], [74, -8], [75, 0], [225, 0], [226, 8], [249, 8], [250, 0]
  ]) {
    assert.deepEqual(planDragAutoScroll({ pointerY, stripRect, edge: 24, step: 8 }), { deltaY });
  }
});
