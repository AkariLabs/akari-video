import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { editStore } from '../src/edit-store.mjs';
import { library } from '../src/exec-support/insert_from_library_search.mjs';
import op, { stillImageFile } from '../src/ops-exec/insert_from_library_add.mjs';

// 手元の catalog-cache.json に依らず、リポの assets/ を歩いた台帳で試す。
process.env.AKARI_LIBRARY_SOURCE = 'walk';

test('stillImageFile は直下の画像 1 枚（preview.png 以外）だけを選ぶ', () => {
  const dir = 'assets/still/bg-forest-mist';
  const files = ['bg.png', 'preview.png', 'fragment.html', 'meta.json'].map(name => `${dir}/${name}`);
  assert.equal(stillImageFile(files, dir), `${dir}/bg.png`);
  assert.equal(stillImageFile([`${dir}/a.png`, `${dir}/b.jpg`], dir), null);
  assert.equal(stillImageFile([`${dir}/preview.png`], dir), null);
  assert.equal(stillImageFile([`${dir}/sub/a.png`], dir), null);
});

test('ライブラリの静止画は fragment.html ではなく画像として置く', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'vibe-still-image-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'bg-test-still');
  mkdirSync(directory, { recursive: true });
  for (const name of ['bg.png', 'preview.png', 'fragment.html', 'meta.json']) writeFileSync(path.join(directory, name), 'x');
  const asset = { id: 'bg-test-still', category: 'still', title: 'テスト背景', tags: [], directory };
  library.push(asset);
  t.after(() => { const index = library.indexOf(asset); if (index >= 0) library.splice(index, 1); });
  const env = {
    edit: { version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [], tracks: [] },
    editStore, log: [], playheadT: 2, ctx: {}
  };
  op.apply(env, { w11_asset: 'bg-test-still', w11_reference: 'direct', w11_at: 'playhead' });
  const item = env.edit.tracks.find(track => track.id === 'w11-library')?.items?.[0];
  assert.ok(item, env.log.join('\n'));
  assert.equal(item.source.kind, 'media');
  const source = env.edit.sources.find(entry => entry.id === item.source.src);
  assert.equal(source.path, path.join(directory, 'bg.png').replaceAll('\\', '/'));
  assert.equal(item.at, 60);
  assert.equal(item.duration, 150);
});
