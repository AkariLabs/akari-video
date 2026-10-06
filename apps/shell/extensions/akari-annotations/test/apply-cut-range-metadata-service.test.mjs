import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { splitCutAudio } from '@akari-video/edit-store';

const text = value => `${JSON.stringify(value, null, 2)}\n`;
const uri = path => pathToFileURL(path).toString();

async function run(source, range) {
  const root = await mkdtemp(join(tmpdir(), 'akari-cut-meta-'));
  const editPath = join(root, 'edit.json');
  await writeFile(editPath, source);
  await writeFile(join(root, 'captions.json'), '[]\n');
  const service = new AkariAnnotationsServiceImpl();
  const result = await service.applyCutRanges({ editUri: uri(editPath), projectRootUri: uri(root), ranges: [range], label: 'カット' });
  return { root, editPath, result, source: await readFile(editPath, 'utf8') };
}

test('v1 applyCutRanges は reason / label を cuts に残し、省略した不一致 range はバイト不変', async t => {
  const source = text({ version: 1, fps: 30, source: 'base.mp4', sources: [{ id: 'base', path: 'base.mp4' }], cuts: [{ src: 'base', in: 0, out: 10 }], overlays: [], audio: { sfx: [], narration: [] } });
  const applied = await run(source, { in: 2, out: 8, kind: 'silence', reason: 'silence', label: '無音' });
  t.after(() => rm(applied.root, { recursive: true, force: true }));
  assert.deepEqual(JSON.parse(applied.source).cuts.map(cut => [cut.reason, cut.label]), [['silence', '無音'], ['silence', '無音']]);
  const unchanged = await run(source, { in: 20, out: 21, kind: 'silence' });
  t.after(() => rm(unchanged.root, { recursive: true, force: true }));
  assert.equal(unchanged.source, source);
});

test('v2 applyCutRanges は reason / label を media items に残し、省略した不一致 range はバイト不変', async t => {
  const source = text({ version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [{ id: 'base', path: 'base.mp4' }], tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'clip', at: 0, duration: 300, source: { kind: 'media', src: 'base', in: 0, out: 10 } }] }] });
  const applied = await run(source, { in: 2, out: 8, kind: 'row', reason: 'word', label: '言い直し' });
  t.after(() => rm(applied.root, { recursive: true, force: true }));
  assert.deepEqual(JSON.parse(applied.source).tracks[0].items.map(item => [item.reason, item.label]), [['word', '言い直し'], ['word', '言い直し']]);
  const unchanged = await run(source, { in: 20, out: 21, kind: 'row' });
  t.after(() => rm(unchanged.root, { recursive: true, force: true }));
  assert.equal(unchanged.source, source);
});

test('分離音声のカットは beforeSource を書き戻す 1 回の履歴復元で映像と音声が戻る', async t => {
  const original = { version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'base', path: 'base.mp4' }], tracks: [
      { id: 'v', lane: 'visual', items: [{ id: 'clip', at: 0, duration: 300,
        source: { kind: 'media', src: 'base', in: 0, out: 10 } }] }
    ] };
  const split = splitCutAudio(original, { cutId: 'clip', hasAudio: true }).document;
  const before = text(split);
  const applied = await run(before, { in: 3, out: 3.5, kind: 'filler', captionId: 'base', label: 'えー' });
  t.after(() => rm(applied.root, { recursive: true, force: true }));
  assert.equal(applied.result.beforeSource, before);
  const cut = JSON.parse(applied.source);
  const cutVisual = cut.tracks.find(track => track.lane === 'visual').items;
  const cutAudio = cut.tracks.find(track => track.lane === 'audio').items;
  assert.deepEqual(cutAudio.map(item => [item.at, item.duration, item.source.in, item.source.out]),
    cutVisual.map(item => [item.at, item.duration, item.source.in, item.source.out]));
  await writeFile(applied.editPath, applied.result.beforeSource);
  const undone = await readFile(applied.editPath, 'utf8');
  assert.equal(undone, before);
  const restored = JSON.parse(undone);
  assert.deepEqual(restored.tracks.find(track => track.lane === 'visual').items.map(item => [item.at, item.duration]), [[0, 300]]);
  assert.deepEqual(restored.tracks.find(track => track.lane === 'audio').items.map(item =>
    [item.at, item.duration, item.source.in, item.source.out, item.link]), [[0, 300, 0, 10, 'clip']]);
});
