import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { appendAnnotationsAtomic } from '../bin/core/review-store.mjs';

async function project(run) {
  const root = await mkdtemp(join(tmpdir(), 'issue69-compile-'));
  try { await run(root, join(root, 'review.json')); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('別セッションの記録済み ID を review.json が無くても再利用しない', async () => project(async (root, review) => {
  await mkdir(join(root, 'review/sessions/s-0011'), { recursive: true });
  await writeFile(join(root, 'review/sessions/s-0011/session.json'), JSON.stringify({ compiledAnnotations: ['a-0009'] }));
  const added = await appendAnnotationsAtomic(review, [{ text: '新規' }, { text: '次' }]);
  assert.deepEqual(added.map(item => item.id), ['a-0010', 'a-0011']);
}));

test('壊れた review.json は書き換えずに停止する', async () => project(async (_root, review) => {
  const broken = '{"version":0,"annotations":[';
  await writeFile(review, broken);
  await assert.rejects(appendAnnotationsAtomic(review, [{ text: '新規' }]));
  assert.equal(await readFile(review, 'utf8'), broken);
}));

test('外部の追記後も既存の全注釈を残す', async () => project(async (_root, review) => {
  await appendAnnotationsAtomic(review, [{ text: '初回' }]);
  await appendAnnotationsAtomic(review, [{ text: '外部' }]);
  const added = await appendAnnotationsAtomic(review, [{ text: '後続' }]);
  assert.equal(added[0].id, 'a-0003');
  assert.deepEqual(JSON.parse(await readFile(review, 'utf8')).annotations.map(item => item.text), ['初回', '外部', '後続']);
}));

test('古い空ロックを回復して追記する', async () => project(async (_root, review) => {
  const lock = `${review}.lock`;
  await mkdir(lock);
  const old = new Date(Date.now() - 61_000);
  await utimes(lock, old, old);
  const added = await appendAnnotationsAtomic(review, [{ text: '回復' }]);
  assert.equal(added[0].id, 'a-0001');
  await assert.rejects(readFile(lock), { code: 'ENOENT' });
}));

test('キャンバスのコンパイル記録済み ID を再利用しない', async () => project(async (root, review) => {
  const canvas = join(root, 'review/canvas/c-0001');
  await mkdir(canvas, { recursive: true });
  await writeFile(join(canvas, 'canvas.json'), JSON.stringify({ compiledAnnotations: ['a-0014'] }));
  const added = await appendAnnotationsAtomic(review, [{ text: '新規' }]);
  assert.equal(added[0].id, 'a-0015');
}));
