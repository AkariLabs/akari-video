import assert from 'node:assert/strict';
import test from 'node:test';

import { hitTestTimelineTrackDrop } from '../lib/common/timeline-track-drop.js';

const layouts = [
  { id: 'v3', lane: 'visual', acceptsItems: true, rawIndex: 5, track: 2, top: 20, height: 40 },
  { id: 'captions', lane: 'visual', acceptsItems: false, rawIndex: 4, track: 0, top: 66, height: 36 },
  { id: 'v2', lane: 'visual', acceptsItems: true, rawIndex: 3, track: 1, top: 108, height: 40 },
  { id: 'audio', lane: 'audio', acceptsItems: true, rawIndex: 0, track: 0, top: 154, height: 40 }
];

test('既存段の上端・下端でも段本体を優先し、緑線を出さない', () => {
  for (const y of [108, 109, 138, 147]) {
    assert.deepEqual(hitTestTimelineTrackDrop(y, layouts, 2), {
      track: 1, top: 108, height: 40, rejected: false, targetTrackId: 'v2'
    });
  }
});

test('隣接段の6pxギャップは新規段ではなく最寄りの既存段へ入る', () => {
  const adjacent = [
    { id: 'v3', lane: 'visual', acceptsItems: true, rawIndex: 4, track: 2, top: 20, height: 40 },
    { id: 'v2', lane: 'visual', acceptsItems: true, rawIndex: 3, track: 1, top: 66, height: 40 }
  ];
  assert.equal(hitTestTimelineTrackDrop(62, adjacent, 2).targetTrackId, 'v3');
  assert.equal(hitTestTimelineTrackDrop(65, adjacent, 2).targetTrackId, 'v2');
  assert.equal(hitTestTimelineTrackDrop(62, adjacent, 2).insertIndex, undefined);
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
