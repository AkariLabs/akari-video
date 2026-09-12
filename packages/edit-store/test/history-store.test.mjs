import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { list, restore, snapshot } from '../lib/history-store.js';

const project = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-history-'));
  await writeFile(path.join(root, 'edit.json'), 'edit-0\n');
  await writeFile(path.join(root, 'captions.json'), 'captions-0\n');
  return root;
};

test('snapshot は両ファイルと sha256 付き meta.json を保存する', async t => {
  const root = await project();
  t.after(() => import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })));
  const entry = await snapshot({ projectDir: root, label: '字幕を編集', files: ['edit.json', 'captions.json'], now: new Date('2026-09-12T12:34:56.789Z') });
  assert.ok(entry);
  assert.deepEqual(entry.files, ['edit.json', 'captions.json']);
  assert.equal((await readFile(path.join(root, '.akari/history', entry.id, 'edit.json'), 'utf8')), 'edit-0\n');
  const meta = JSON.parse(await readFile(path.join(root, '.akari/history', entry.id, 'meta.json'), 'utf8'));
  assert.equal(meta.label, '字幕を編集');
  assert.match(meta.sha256['captions.json'], /^[a-f0-9]{64}$/);
});

test('101 件目の snapshot で最古のディレクトリを削除する', async t => {
  const root = await project();
  t.after(() => import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })));
  for (let index = 0; index < 101; index += 1) {
    await snapshot({ projectDir: root, label: `edit ${index}`, keep: 100, now: new Date(Date.UTC(2026, 0, 1, 0, 0, index)) });
  }
  const directories = (await readdir(path.join(root, '.akari/history'), { withFileTypes: true })).filter(entry => entry.isDirectory());
  assert.equal(directories.length, 100);
  assert.equal((await list(root)).some(entry => entry.label === 'edit 0'), false);
});

test('restore は現状を先に保存して両ファイルをバイト一致で戻す', async t => {
  const root = await project();
  t.after(() => import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })));
  const target = await snapshot({ projectDir: root, label: '最初' });
  await writeFile(path.join(root, 'edit.json'), 'edit-1\n');
  await writeFile(path.join(root, 'captions.json'), 'captions-1\n');
  const result = await restore(root, target.id);
  assert.equal(await readFile(path.join(root, 'edit.json'), 'utf8'), 'edit-0\n');
  assert.equal(await readFile(path.join(root, 'captions.json'), 'utf8'), 'captions-0\n');
  assert.equal(result.snapshot.label, `restore-from-${target.id}`);
  assert.equal((await list(root)).length, 2);
});

test('list は新形式と旧 edit-<ts>.json を新しい順で返し、旧形式を変更しない', async t => {
  const root = await project();
  t.after(() => import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true })));
  const directory = path.join(root, '.akari/history');
  await mkdir(directory, { recursive: true });
  const legacy = path.join(directory, 'edit-2026-01-01.json');
  await writeFile(legacy, '{"version":1}\n');
  const before = await stat(legacy);
  await snapshot({ projectDir: root, label: '新形式', now: new Date('2030-01-01T00:00:00Z') });
  const entries = await list(root);
  assert.equal(entries[0].label, '新形式');
  assert.equal(entries[1].legacy, true);
  assert.equal((await stat(legacy)).mtimeMs, before.mtimeMs);
});
