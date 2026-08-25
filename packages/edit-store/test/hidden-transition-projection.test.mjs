import assert from 'node:assert/strict';
import test from 'node:test';

import { projectLegacyEdit, readInternalEdit } from '../lib/index.js';
import {
  computeCutTimelineOffsets,
  needsGapAwareCutTimeline,
} from '../../render-cut/src/cut-timeline.mjs';

const fixture = (incomingPath = 'incoming.mp4') => ({
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [
    { id: 'a', path: 'outgoing.mp4' },
    { id: 'b', path: incomingPath },
  ],
  tracks: [{
    id: 'visual-main', lane: 'visual', items: [
      {
        id: 'a', at: 0, duration: 60,
        source: {
          kind: 'media', src: 'a', in: 0, out: 2,
          transition_out: { type: 'dissolve', duration: 1 },
        },
      },
      {
        id: 'b', at: 60, duration: 60,
        source: {
          kind: 'media', src: 'b', in: incomingPath.endsWith('.png') ? 0 : 1,
          out: incomingPath.endsWith('.png') ? 2 : 3,
        },
      },
    ],
  }],
});

test('レンダー投影だけが隠れのりしろを物理重なりへ合成する', () => {
  const internal = readInternalEdit(fixture());
  const [a, b] = internal.tracks[0].items;
  assert.deepEqual({ at: a.at, duration: a.duration, in: a.source.in, out: a.source.out }, {
    at: 0, duration: 2, in: 0, out: 2,
  });
  assert.deepEqual({ at: b.at, duration: b.duration, in: b.source.in, out: b.source.out }, {
    at: 2, duration: 2, in: 1, out: 3,
  });
  assert.deepEqual(projectLegacyEdit(internal).cuts.map(cut => ({ at: cut.at, in: cut.in, out: cut.out })), [
    { at: 0, in: 0, out: 2 },
    { at: 2, in: 1, out: 3 },
  ]);

  const cuts = [a.declaration, b.declaration];
  assert.equal(a.declaration.out, 2.5);
  assert.equal(a.declaration.transition_out.duration, 1);
  assert.equal(b.declaration.at, 1.5);
  assert.equal(b.declaration.in, 0.5);
  assert.equal(needsGapAwareCutTimeline(cuts), false);
  const offsets = computeCutTimelineOffsets(cuts);
  assert.equal(offsets[1].start, 1.5, 'xfade offset is t_cut - e/2');
  assert.equal(offsets[1].start + offsets[1].duration, 4, '総尺は合成前の 4 秒から不変');
});

test('incoming 静止画は in を負にせず out 側を加算して同じ窓へ載せる', () => {
  const internal = readInternalEdit(fixture('incoming.png'));
  const [, incoming] = internal.tracks[0].items;
  assert.equal(incoming.declaration.at, 1.5);
  assert.equal(incoming.declaration.in, 0);
  assert.equal(incoming.declaration.out, 2.5);
  assert.equal(needsGapAwareCutTimeline(internal.tracks[0].items.map(item => item.declaration)), false);
});

test('実重なり済みの旧データはレンダー宣言も byte-equivalent な値のまま', () => {
  const edit = fixture();
  edit.tracks[0].items[0].duration = 75;
  edit.tracks[0].items[0].source.out = 2.5;
  const internal = readInternalEdit(edit);
  const declarations = internal.tracks[0].items.map(item => item.declaration);
  assert.equal(declarations[0].out, 2.5);
  assert.equal(declarations[1].at, 2);
  assert.equal(declarations[1].in, 1);
});

test('A→B→C の連鎖では B の incoming/outgoing 合成が加算的に効く', () => {
  const edit = fixture();
  edit.sources.push({ id: 'c', path: 'third.mp4' });
  edit.tracks[0].items[1].source.transition_out = { type: 'dissolve', duration: 1 };
  edit.tracks[0].items.push({
    id: 'c', at: 120, duration: 60,
    source: { kind: 'media', src: 'c', in: 1, out: 3 },
  });
  const internal = readInternalEdit(edit);
  const declarations = internal.tracks[0].items.map(item => item.declaration);
  assert.deepEqual(declarations.map(cut => ({ at: cut.at, in: cut.in, out: cut.out })), [
    { at: 0, in: 0, out: 2.5 },
    { at: 1.5, in: 0.5, out: 3.5 },
    { at: 3.5, in: 0.5, out: 3 },
  ]);
  assert.equal(needsGapAwareCutTimeline(declarations), false);
  const offsets = computeCutTimelineOffsets(declarations);
  assert.equal(offsets[1].start, 1.5);
  assert.equal(offsets[2].start, 3.5);
  assert.equal(offsets[2].start + offsets[2].duration, 6);
});
