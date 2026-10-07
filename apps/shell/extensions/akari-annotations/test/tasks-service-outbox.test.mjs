import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariTasksServiceImpl } from '../lib/node/akari-tasks-service.js';

async function fixture(fn) {
  const root = await fs.mkdtemp(join(tmpdir(), 'akari-outbox-'));
  const reviewPath = join(root, 'review.json');
  await fs.mkdir(join(root, '.akari'));
  await fs.writeFile(reviewPath, '{"version":0,"annotations":[]}\n');
  const before = await fs.readFile(reviewPath);
  const mtime = (await fs.stat(reviewPath)).mtimeMs;
  const service = new AkariTasksServiceImpl();
  const request = { projectRootUri: pathToFileURL(root).toString() };
  try {
    await fn({ service, request, root });
    assert.deepEqual(await fs.readFile(reviewPath), before);
    assert.equal((await fs.stat(reviewPath)).mtimeMs, mtime);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('依頼文を原子的に作り、同名を上書きしない', async () => fixture(async ({ service, request, root }) => {
  const outbox = join(root, '.akari', 'cache', 'outbox');
  assert.equal(await service.nextBatchId(request), 'b-0001');
  await service.writeOutbox({ ...request, batchId: 'b-0001', markdown: '最初\n' });
  assert.equal(await fs.readFile(join(outbox, 'b-0001.md'), 'utf8'), '最初\n');
  assert.deepEqual(await fs.readdir(outbox), ['b-0001.md']);
  await assert.rejects(service.writeOutbox({ ...request, batchId: 'b-0001', markdown: '上書き' }), /EEXIST/);
  assert.equal(await fs.readFile(join(outbox, 'b-0001.md'), 'utf8'), '最初\n');
  assert.equal(await service.nextBatchId(request), 'b-0002');
  await assert.rejects(service.writeOutbox({ ...request, batchId: '../x', markdown: '危険' }));
}));

test('tasks.json とファイル名の大きい番号を採用する', async () => fixture(async ({ service, request, root }) => {
  await fs.writeFile(join(root, '.akari', 'tasks.json'), JSON.stringify({ version: 0, tasks: [
    { id: 't-0001', source: 'annotation', state: 'sent', createdAt: '', batchId: 'b-0123' }
  ] }));
  assert.equal(await service.nextBatchId(request), 'b-0124');
  await service.writeOutbox({ ...request, batchId: 'b-9999', markdown: '本文' });
  assert.equal(await service.nextBatchId(request), 'b-10000');
}));

test('プロジェクト外へ出るシンボリックリンクを拒否する', async () => fixture(async ({ service, request, root }) => {
  const outside = await fs.mkdtemp(join(tmpdir(), 'akari-outside-'));
  try {
    await fs.symlink(outside, join(root, '.akari', 'cache'));
    await assert.rejects(service.writeOutbox({ ...request, batchId: 'b-0001', markdown: '本文' }), /プロジェクト外/);
    await assert.rejects(service.nextBatchId(request), /プロジェクト外/);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally { await fs.rm(outside, { recursive: true, force: true }); }
}));
