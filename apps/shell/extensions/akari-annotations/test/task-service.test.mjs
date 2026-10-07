import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskOperations, DebouncedTaskRefresh } from '../lib/browser/tasks/task-operations.js';
import { AkariTasksServiceImpl } from '../lib/node/akari-tasks-service.js';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function fixture(form = 'cli', inject = true) {
  const calls = [];
  const task = (id, extra = {}) => ({ id, source: 'annotation', state: 'unsent', body: '確認する', createdAt: '', ...extra });
  const items = [task('t-0001'), task('t-0002', { needsConfirm: true }), task('t-0003', { state: 'review' })];
  const backend = {
    async list() { calls.push('list'); return { tasks: items, warnings: [], file: 'ok' }; },
    async importSent({ ids }) { calls.push(['importSent', ids]); return { tasks: items, warnings: [], file: 'ok' }; },
    async update({ id, patch }) { calls.push(['update', id, patch]); const item = items.find(t => t.id === id); if (item) Object.assign(item, patch); return item ?? { id, ...patch }; },
    async nextBatchId() { calls.push('nextBatchId'); return 'b-0001'; },
    async writeOutbox(value) { calls.push(['writeOutbox', value]); }
  };
  const ports = {
    backend,
    async execute(id, ...args) {
      calls.push(['command', id, ...args]);
      if (id === 'akari.partner.deliveryTarget') return { form, agent: 'claude', focusCommandId: 'claude-vscode.focus' };
      if (id === 'akari.partner.injectPrompt') return inject;
      return true;
    },
    hasCommand: id => id === 'claude-vscode.focus',
    async copy(text) { calls.push(['copy', text]); },
    async getSentIds() { return ['a-0001']; },
    async resolveAnnotation(id) { calls.push(['resolve', id]); },
    info: text => calls.push(['info', text]),
    warn: text => calls.push(['warn', text]),
    error: text => calls.push(['error', text])
  };
  return { ops: new TaskOperations(ports), ports, backend, items, calls, task };
}

test('送る前に確認前と未送信以外を除き、PTY 失敗なら状態を保つ', async () => {
  const f = fixture('cli', false);
  const result = await f.ops.send(['t-0001', 't-0002', 't-0003'], f.items, 'file:///p');
  assert.deepEqual(result, { sent: [], skipped: 2, route: 'pty' });
  assert.equal(f.items[0].state, 'unsent');
  assert.equal(f.calls.some(c => Array.isArray(c) && c[0] === 'update'), false);
});

test('拡張形式はコピーとフォーカスの後に sent を記録する', async () => {
  const f = fixture('extension');
  const result = await f.ops.send(['t-0001'], f.items, 'file:///p');
  assert.deepEqual(result.sent, ['t-0001']);
  assert.equal(f.items[0].state, 'sent');
  assert.equal(f.items[0].sentTo.route, 'clipboard');
  assert.equal(f.calls.findIndex(c => c[0] === 'copy') < f.calls.findIndex(c => c[0] === 'update'), true);
  assert.equal(f.calls.some(c => c[1] === 'claude-vscode.focus'), true);
});

test('複数件は outbox を先に書き、依頼は 1 行', async () => {
  const f = fixture('cli');
  f.items[1].needsConfirm = false;
  const result = await f.ops.send(['t-0001', 't-0002'], f.items, 'file:///p');
  assert.deepEqual(result.sent, ['t-0001', 't-0002']);
  const outbox = f.calls.find(c => c[0] === 'writeOutbox')[1];
  assert.match(outbox.markdown, /### t-0001/);
  const prompt = f.calls.find(c => c[1] === 'akari.partner.injectPrompt')[2];
  assert.equal(prompt.includes('\n'), false);
  assert.equal(f.items[0].batchId, 'b-0001');
});

test('確認は注釈を先に解決し、失敗時には tasks を更新しない', async () => {
  const f = fixture();
  const reviewTask = f.task('t-0004', { state: 'review', ref: { kind: 'annotation', id: 'a-0004' } });
  await f.ops.confirm(reviewTask, 'file:///p');
  assert.deepEqual(f.calls.filter(c => c[0] === 'resolve' || c[0] === 'update').map(c => c[0]), ['resolve', 'update']);
  const g = fixture();
  g.ports.resolveAnnotation = async () => { throw new Error('失敗'); };
  await assert.rejects(g.ops.confirm(reviewTask, 'file:///p'));
  assert.equal(g.calls.some(c => c[0] === 'update'), false);
});

test('旧保存の送信済み注釈を 1 度だけ取り込み、更新通知をまとめる', async () => {
  const f = fixture();
  await f.ops.load('file:///p', 'file:///p/review.json');
  await f.ops.load('file:///p', 'file:///p/review.json');
  assert.equal(f.calls.filter(c => c[0] === 'importSent').length, 1);
  let count = 0;
  const scheduler = new DebouncedTaskRefresh(() => { count++; }, 10);
  scheduler.schedule(); scheduler.schedule(); scheduler.schedule();
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(count, 1);
});

test('実 backend で list・create・send・dismiss は review.json を変更しない', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'akari-task-flow-'));
  try {
    await fs.mkdir(join(root, '.akari'));
    const reviewPath = join(root, 'review.json');
    await fs.writeFile(reviewPath, '{"version":0,"annotations":[]}\n');
    const before = await fs.readFile(reviewPath);
    const mtime = (await fs.stat(reviewPath)).mtimeMs;
    const backend = new AkariTasksServiceImpl();
    const projectRootUri = pathToFileURL(root).toString();
    const created = await backend.create({ projectRootUri, task: { body: 'タスク' } });
    const ports = fixture('cli').ports;
    ports.backend = backend;
    const ops = new TaskOperations(ports);
    const tasks = await ops.load(projectRootUri, pathToFileURL(reviewPath).toString());
    await ops.send([created.id], tasks, projectRootUri);
    await backend.update({ projectRootUri, id: created.id, patch: { state: 'done', outcome: 'dismissed' }, actor: 'human' });
    assert.deepEqual(await fs.readFile(reviewPath), before);
    assert.equal((await fs.stat(reviewPath)).mtimeMs, mtime);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
