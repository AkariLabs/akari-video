import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariTasksServiceImpl } from '../lib/node/akari-tasks-service.js';

const review = JSON.stringify({ version: 0, annotations: [{
  id: 'a-0001', text: '音を下げる', status: 'open', input: 'typed', target: null,
  sourceT: 1, sourceRange: null, createdAt: '2026-10-07T00:00:00Z'
}] }) + '\n';
async function fixture(fn) {
  const root = await fs.mkdtemp(join(tmpdir(), 'akari-tasks-service-'));
  await fs.mkdir(join(root, '.akari'));
  const reviewPath = join(root, 'review.json');
  await fs.writeFile(reviewPath, review);
  const request = { projectRootUri: pathToFileURL(root).toString() };
  try { return await fn(new AkariTasksServiceImpl(), request, root, reviewPath); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}
async function unchanged(path, action) {
  const before = await fs.readFile(path);
  const stat = await fs.stat(path);
  await action();
  assert.deepEqual(await fs.readFile(path), before);
  assert.equal((await fs.stat(path)).mtimeMs, stat.mtimeMs);
}

test('list・create・update・importSent は review.json を変更しない', async () => fixture(async (service, request, root, reviewPath) => {
  await unchanged(reviewPath, async () => {
    const listed = await service.list(request);
    assert.equal(listed.file, 'absent');
    assert.equal(listed.tasks[0].state, 'unsent');
  });
  let created;
  await unchanged(reviewPath, async () => {
    created = await service.create({ ...request, task: { body: '全体のテンポを上げる' } });
    assert.equal(created.id, 't-0001');
  });
  await unchanged(reviewPath, async () => {
    const updated = await service.update({ ...request, id: created.id, patch: { state: 'sent' }, actor: 'human' });
    assert.equal(updated.state, 'sent');
  });
  await unchanged(reviewPath, async () => {
    const listed = await service.importSent({ ...request, ids: ['a-0001'] });
    assert.equal(listed.file, 'ok');
    assert.equal(listed.tasks.length, 2);
    assert.equal(listed.tasks.find(t => t.source === 'annotation' && t.ref?.id === 'a-0001').state, 'sent');
  });
  assert.equal((await fs.readFile(join(root, '.akari', 'tasks.json'), 'utf8')).endsWith('\n'), true);
}));

test('壊れたファイル・新しい版は表示しても上書きしない', async () => fixture(async (service, request, root, reviewPath) => {
  const file = join(root, '.akari', 'tasks.json');
  for (const [content, expected] of [['{bad', 'broken'], [JSON.stringify({ version: 1, tasks: [] }), 'newer']]) {
    await fs.writeFile(file, content);
    await unchanged(reviewPath, async () => {
      assert.equal((await service.list(request)).file, expected);
      await assert.rejects(service.create({ ...request, task: { body: '追加' } }));
      await assert.rejects(service.update({ ...request, id: 't-0001', patch: { state: 'sent' }, actor: 'human' }));
      await assert.rejects(service.importSent({ ...request, ids: ['a-0001'] }));
    });
    assert.equal(await fs.readFile(file, 'utf8'), content);
  }
}));

test('注釈タスクの確認は tasks.json にだけ書き、注釈の正本を保つ', async () => fixture(async (service, request, root, reviewPath) => {
  const addressed = JSON.parse(review);
  addressed.annotations[0].status = 'addressed';
  addressed.annotations[0].response = { summary: '編集', action: 'edited', respondedAt: '2026-10-07T01:00:00Z' };
  await fs.writeFile(reviewPath, JSON.stringify(addressed) + '\n');
  const task = (await service.list(request)).tasks[0];
  assert.equal(task.state, 'review');
  await unchanged(reviewPath, () => service.update({ ...request, id: task.id, patch: { state: 'done' }, actor: 'human' }));
  const saved = JSON.parse(await fs.readFile(join(root, '.akari', 'tasks.json'), 'utf8'));
  assert.equal(saved.tasks[0].state, 'done');
  assert.equal(saved.tasks[0].body, undefined);
  assert.equal((await service.list(request)).tasks[0].state, 'review');
}));

test('プロジェクト外を指すサイドカーは拒否する', async () => fixture(async (service, request, root) => {
  const elsewhere = await fs.mkdtemp(join(tmpdir(), 'akari-tasks-outside-'));
  try {
    await fs.rmdir(join(root, '.akari'));
    await fs.symlink(elsewhere, join(root, '.akari'));
    await assert.rejects(service.create({ ...request, task: { body: '追加' } }), /プロジェクト外/);
    assert.deepEqual(await fs.readdir(elsewhere), []);
  } finally { await fs.rm(elsewhere, { recursive: true, force: true }); }
}));

test('並行 create 20 件の id は重複しない', async () => fixture(async (service, request, root) => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => service.create({ ...request, task: { body: `指示 ${i}` } })));
  const doc = JSON.parse(await fs.readFile(join(root, '.akari', 'tasks.json'), 'utf8'));
  assert.equal(doc.tasks.length, 20);
  assert.equal(new Set(doc.tasks.map(t => t.id)).size, 20);
}));
