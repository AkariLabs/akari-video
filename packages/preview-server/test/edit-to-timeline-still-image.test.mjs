import assert from 'node:assert/strict';
import test from 'node:test';

import { editToTimeline } from '../src/edit-to-timeline.mjs';

// docs/contract-2026-08-12-still-image-cut-source-v0.md 裁定1: editToTimeline() が組み立てる
// TimelineClip.mediaType は cuts[].src が解決する source.path の拡張子だけで決まる
// （packages/render-cut/src/layers.mjs の IMAGE_LAYER_SOURCE_PATTERN と同一集合）。

test('v1: mp4 source produces mediaType "video", png source produces mediaType "image"', () => {
  const edit = {
    version: 1,
    output: { fps: 30 },
    sources: [
      { id: 's1', path: 'assets/intro.mp4', proxy: null },
      { id: 's2', path: 'assets/title-card.png', proxy: null },
    ],
    cuts: [
      { src: 's1', in: 0, out: 2 },
      { src: 's2', in: 0, out: 1 },
    ],
  };
  const timeline = editToTimeline(edit, '/project');
  assert.equal(timeline.clips.length, 2);
  assert.equal(timeline.clips[0].mediaType, 'video');
  assert.equal(timeline.clips[1].mediaType, 'image');
});

test('renderer compatibility view keeps mediaType "video" on every clip (non-regression)', () => {
  const edit = {
    version: 1,
    output: { fps: 30 },
    sources: [{ id: 'main', path: 'assets/main.mp4' }],
    cuts: [
      { src: 'main', in: 0, out: 2 },
      { src: 'main', in: 5, out: 8 },
    ],
  };
  const timeline = editToTimeline(edit, '/project');
  assert.equal(timeline.clips.length, 2);
  for (const clip of timeline.clips) assert.equal(clip.mediaType, 'video');
});

test('mediaType detection is case-insensitive and covers the full still-image extension set', () => {
  const edit = {
    version: 1,
    output: { fps: 30 },
    sources: [
      { id: 'a', path: 'x.PNG', proxy: null },
      { id: 'b', path: 'x.jpg', proxy: null },
      { id: 'c', path: 'x.JPEG', proxy: null },
      { id: 'd', path: 'x.webp', proxy: null },
      { id: 'e', path: 'x.bmp', proxy: null },
      { id: 'f', path: 'x.gif', proxy: null },
      { id: 'g', path: 'x.mp4', proxy: null },
      { id: 'h', path: 'x.mov', proxy: null },
    ],
    cuts: 'abcdefgh'.split('').map((src) => ({ src, in: 0, out: 1 })),
  };
  const timeline = editToTimeline(edit, '/project');
  const byId = Object.fromEntries(timeline.clips.map((c, i) => [edit.cuts[i].src, c.mediaType]));
  assert.deepEqual(byId, {
    a: 'image', b: 'image', c: 'image', d: 'image', e: 'image', f: 'image',
    g: 'video', h: 'video',
  });
});
