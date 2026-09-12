import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

const text = value => `${JSON.stringify(value, null, 2)}\n`;
const uri = path => pathToFileURL(path).toString();

async function run(source, range) {
  const root = await mkdtemp(join(tmpdir(), 'akari-cut-meta-'));
  const editPath = join(root, 'edit.json');
  await writeFile(editPath, source);
  await writeFile(join(root, 'captions.json'), '[]\n');
  const service = new AkariAnnotationsServiceImpl();
  await service.applyCutRanges({ editUri: uri(editPath), projectRootUri: uri(root), ranges: [range], label: 'カット' });
  return { root, source: await readFile(editPath, 'utf8') };
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
