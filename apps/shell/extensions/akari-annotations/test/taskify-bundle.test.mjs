import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBundle, writeBundle } from '../lib/node/taskify/taskify-bundle.js';
const canvas = { id: 'c-0001', memo: '字幕を動かす', backdrop: { editSha256: 'old' },
  subject: { playhead: { outputT: 6, src: 'a.mp4', sourceT: 2, cutIndex: 0 }, selection: ['cut:0'] } };
const ink = { schema: 'akari.ink.v0', space: 'canvas-rect', aspect: { w: 16, h: 9 },
  objects: [{ id: 'ink-1', type: 'arrow', color: '', x: .1, y: .2, from: [.1, .2], to: [.4, .5], strokeWidth: .01 }] };
const base = { canvas, ink, paper: Buffer.from('paper'), backdrop: Buffer.from('backdrop'), includeBackdrop: true,
  editText: JSON.stringify({ cuts: [{ src: 'a.mp4', start: 0, end: 10 }], overlays: [] }) };
test('bundle is byte stable, uses typed memo, and marks stale editing', () => {
  const first = buildBundle(base), second = buildBundle(base);
  assert.equal(first.context, second.context); assert.deepEqual(first.files, second.files);
  assert.match(first.context, /typed: 字幕を動かす/); assert.match(first.context, /stale:true/);
  assert.match(first.context, /矢印/); assert.equal('audio.wav' in first.files, false);
});
test('transcript speech only; disabling backdrop leaves only white paper', async () => {
  const value = buildBundle({ ...base, includeBackdrop: false, paper: Buffer.from('white'),
    transcript: { segments: [{ t0: 1, t1: 2, text: '話した', kind: 'speech' },
      { t0: 2, t1: 3, text: '無視', kind: 'noise' }] } });
  const dir = await mkdtemp(join(tmpdir(), 'taskify-bundle-')); await writeBundle(dir, value);
  assert.deepEqual((await readdir(dir)).sort(), ['context.md', 'paper.png']);
  assert.match(value.context, /話した/); assert.doesNotMatch(value.context, /無視/);
  assert.match(value.context, /画面内の物の矩形/);
});
