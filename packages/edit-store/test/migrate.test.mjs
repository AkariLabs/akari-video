import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyMigration,
  detectEditVersion,
  migrateEditToV2,
  planMigration,
  revertMigration,
} from '../lib/migrate/index.js';
import { readEditV2 } from '../lib/edit-v2.js';

function base(version = 0) {
  return {
    version,
    output: { width: 1920, height: 1080, fps: 30 },
    ...(version === 0
      ? { source: { path: 'main.mp4', proxy: null } }
      : { sources: [{ id: 'main', path: 'main.mp4', proxy: null }] }),
    cuts: [{ ...(version === 1 ? { src: 'main' } : {}), in: 0, out: 1 }, { ...(version === 1 ? { src: 'main' } : {}), in: 2, out: 3 }],
    overlays: [],
  };
}

test('v0/v1 -> v2: 暗黙 at を絶対フレームに焼き、v2 reader を通す', () => {
  for (const version of [0, 1]) {
    const result = migrateEditToV2(base(version));
    assert.equal(result.ok, true);
    assert.deepEqual(result.doc.tracks[0].items.map(item => [item.at, item.duration]), [[0, 30], [30, 30]]);
    assert.doesNotThrow(() => readEditV2(result.doc));
  }
});

test('レイヤー動画の素材表追加・baked telop・audio・縦順を保つ', () => {
  const doc = base(1);
  doc.audio = { sfx: [{ path: 'hit.wav', t: 0.25, track: 2 }] };
  doc.layers = [
    { id: 'pip', t: 0, duration: 1, kind: 'video', src: 'pip.mp4', perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } },
    { id: 'title', t: 0, duration: 1, kind: 'baked', src: 'title.mov', preset: 'title', params: { text: 'A' }, track: 1 },
  ];
  doc.timeline = { tracks: [
    { id: 'main-row', kind: 'cuts', ref: 0 },
    { id: 'pip-row', kind: 'layers', ref: 0 },
    { id: 'title-row', kind: 'layers', ref: 1 },
    { id: 'audio-row', kind: 'audio', ref: 2 },
  ] };
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  assert.deepEqual(result.doc.tracks.map(track => track.id), ['main-row', 'pip-row', 'title-row', 'audio-row']);
  assert.equal(result.doc.sources.find(source => source.path === 'pip.mp4').id, 'l-1');
  assert.equal(result.doc.tracks[1].items[0].source.kind, 'media');
  assert.deepEqual(result.doc.tracks[2].items[0].source, { kind: 'telop', preset: 'title', params: { text: 'A' }, baked: 'title.mov' });
  assert.deepEqual(result.doc.audio, doc.audio);
});

test('transition_out・thumbnail・preset なし baked を損失なく v2 へ写す', () => {
  const doc = base();
  doc.cuts[0].transition_out = { type: 'dissolve', duration: 0.25 };
  doc.thumbnail = { path: 'assets/thumb.png' };
  doc.layers = [{ id: 'baked', t: 0, duration: 1, kind: 'baked', src: 'baked.mov' }];
  const result = migrateEditToV2(doc);
  assert.equal(result.ok, true);
  assert.deepEqual(result.doc.thumbnail, doc.thumbnail);
  assert.deepEqual(result.doc.tracks[0].items[0].source.transition_out, doc.cuts[0].transition_out);
  const layer = result.doc.tracks.find(track => track.items?.some(item => item.id === 'baked'));
  assert.equal(layer.items[0].source.kind, 'media');
  assert.equal(result.doc.sources.find(source => source.path === 'baked.mov').id, layer.items[0].source.src);
});

test('凍結方針: 未知フィールド・非整数 fps・未知 layer は blocker で止まる', () => {
  const unknown = { ...base(), direction: {} };
  assert.match(migrateEditToV2(unknown).blockers.join('\n'), /direction/);
  const fractional = base();
  fractional.output.fps = 29.97;
  assert.match(migrateEditToV2(fractional).blockers.join('\n'), /整数/);
  const layer = { ...base(), layers: [{ id: 'x', t: 0, duration: 1, kind: 'filter', filter: {} }] };
  assert.match(migrateEditToV2(layer).blockers.join('\n'), /video \/ image \/ baked/);
});

test('提案は書かず、承認適用で backup -> atomic write、1 手 undo で戻る', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-migrate-'));
  try {
    const editPath = join(root, 'edit.json');
    const before = `${JSON.stringify(base(), null, 2)}\n`;
    await writeFile(editPath, before);
    const proposal = planMigration(root, editPath, before, { now: new Date('2026-08-19T01:02:03.000Z') });
    assert.equal(await readFile(editPath, 'utf8'), before, '提案だけでは 1 バイトも変えない');
    await applyMigration(proposal);
    assert.equal(JSON.parse(await readFile(editPath, 'utf8')).version, 2);
    assert.equal(await readFile(proposal.backupPath, 'utf8'), before);
    await revertMigration(proposal);
    assert.equal(await readFile(editPath, 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('v2 は再変換せず、reader 往復も差分ゼロ', () => {
  const migrated = migrateEditToV2(base());
  const text = `${JSON.stringify(migrated.doc, null, 2)}\n`;
  assert.equal(detectEditVersion(JSON.parse(text)), 2);
  assert.equal(migrateEditToV2(JSON.parse(text)).ok, false);
  assert.deepEqual(readEditV2(text), readEditV2(`${JSON.stringify(JSON.parse(text), null, 2)}\n`));
});
