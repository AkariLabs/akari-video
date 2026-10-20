import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { respondToAnnotation } from '../bin/core/review-store.mjs';

const response = { id: 'a-0001', action: 'edited', summary: '修正済み', respondedAt: '2026-01-01T00:00:00Z' };
test('外部追加後の応答は追加行を残す', async () => {
  const root = await mkdtemp(join(tmpdir(), 'issue69-address-'));
  const review = join(root, 'review.json');
  try {
    const annotations = [
      { id: 'a-0001', text: '対象', status: 'open', response: null },
      { id: 'a-0002', text: '外部追加', status: 'open', response: null },
    ];
    await writeFile(review, JSON.stringify({ version: 0, annotations }, null, 2) + '\n');
    const result = await respondToAnnotation(review, response);
    assert.equal(result.ok, true);
    const after = JSON.parse(await readFile(review, 'utf8')).annotations;
    assert.equal(after.length, 2);
    assert.equal(after[0].status, 'addressed');
    assert.deepEqual(after[1], annotations[1]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('古い空ロックを回復して応答する', async () => {
  const root = await mkdtemp(join(tmpdir(), 'issue69-address-lock-'));
  const review = join(root, 'review.json');
  const lock = `${review}.lock`;
  try {
    await writeFile(review, JSON.stringify({ version: 0, annotations: [{
      id: 'a-0001', text: '対象', status: 'open', response: null
    }] }) + '\n');
    await mkdir(lock);
    const old = new Date(Date.now() - 61_000);
    await utimes(lock, old, old);
    assert.equal((await respondToAnnotation(review, response)).ok, true);
    await assert.rejects(readFile(lock), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
