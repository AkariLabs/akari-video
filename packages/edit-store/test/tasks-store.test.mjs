import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readTasksFile, writeTasksFile, withTasksLock, nextTaskId, applyTaskPatch,
  deriveTasks, toOverlayEntry, importSentAnnotationIds
} from '../lib/tasks-store.js';

const base = { id: 't-0001', source: 'annotation', state: 'unsent', createdAt: '2026-10-07T00:00:00Z' };
async function temporary(fn) {
  const root = await fs.mkdtemp(join(tmpdir(), 'akari-tasks-'));
  try { return await fn(join(root, '.akari', 'tasks.json'), root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}
const review = (status = 'open', text = 'BGM を遅らせる') => JSON.stringify({ version: 0, annotations: [{
  id: 'a-0001', status, text, input: 'session', target: 'ui:timeline', sourceT: 3,
  sourceRange: null, createdAt: '2026-10-07T00:00:00Z',
  response: status === 'addressed' ? { summary: '編集', action: 'edited', respondedAt: '2026-10-07T01:00:00Z' } : null
}] });

test('無い・壊れた・新しい版・必須欠けを寛容に読む', async () => temporary(async file => {
  assert.deepEqual((await readTasksFile(file)).doc, { version: 0, tasks: [] });
  await fs.mkdir(join(file, '..'), { recursive: true });
  await fs.writeFile(file, '{bad');
  assert.equal((await readTasksFile(file)).reason, 'broken');
  await fs.writeFile(file, JSON.stringify({ version: 1, tasks: [] }));
  assert.equal((await readTasksFile(file)).reason, 'newer');
  await fs.writeFile(file, JSON.stringify({ version: 0, tasks: [{ id: 't-0001' }] }));
  const read = await readTasksFile(file);
  assert.equal(read.ok, true);
  assert.ok(read.warnings.length >= 3);
  assert.equal(read.doc.tasks.length, 1);
}));

test('未知の top・task・state・source を残して別タスクを更新する', async () => temporary(async file => {
  const unknown = { id: 't-0100', source: 'future', state: 'paused', createdAt: 'x', extra: { deep: true } };
  const original = { version: 0, futureTop: { x: 1 }, tasks: [unknown, base] };
  await fs.mkdir(join(file, '..'), { recursive: true });
  await fs.writeFile(file, JSON.stringify(original));
  const read = await readTasksFile(file);
  assert.equal(read.ok, true);
  assert.ok(read.warnings.length);
  read.doc.tasks[1] = applyTaskPatch(read.doc.tasks[1], { priority: 'high' }, 'human');
  await writeTasksFile(file, read.doc);
  const actual = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(actual.futureTop, original.futureTop);
  assert.deepEqual(actual.tasks[0], unknown);
}));

test('書き込み失敗と壊れた元ファイルは上書きしない', async () => temporary(async file => {
  await fs.mkdir(join(file, '..'), { recursive: true });
  const source = JSON.stringify({ version: 0, tasks: [base] });
  await fs.writeFile(file, source);
  await fs.mkdir(`${file}.tmp`);
  await assert.rejects(writeTasksFile(file, { version: 0, tasks: [] }));
  assert.equal(await fs.readFile(file, 'utf8'), source);
  await fs.rmdir(`${file}.tmp`);
  await fs.writeFile(file, '{bad');
  await assert.rejects(writeTasksFile(file, { version: 0, tasks: [] }));
  assert.equal(await fs.readFile(file, 'utf8'), '{bad');
}));

test('並行 20 件で id が重複せず、古いロックを回収する', async () => temporary(async file => {
  await Promise.all(Array.from({ length: 20 }, () => withTasksLock(file, async () => {
    const read = await readTasksFile(file);
    const doc = read.doc;
    doc.tasks.push({ ...base, id: nextTaskId(doc.tasks) });
    await writeTasksFile(file, doc);
  })));
  const read = await readTasksFile(file);
  assert.equal(read.doc.tasks.length, 20);
  assert.equal(new Set(read.doc.tasks.map(t => t.id)).size, 20);
  await fs.mkdir(`${file}.lock`);
  const old = new Date(Date.now() - 61_000);
  await fs.utimes(`${file}.lock`, old, old);
  await withTasksLock(file, async () => undefined);
  await assert.rejects(fs.stat(`${file}.lock`), { code: 'ENOENT' });
}));

test('状態遷移の許可・拒否と agent の制限', () => {
  const move = (from, to, source = 'annotation', actor = 'human', outcome) =>
    applyTaskPatch({ ...base, source, state: from }, { state: to, ...(outcome ? { outcome } : {}) }, actor);
  for (const [from, to, source, actor] of [
    ['unsent', 'sent'], ['sent', 'review'], ['sent', 'done', 'lint', 'app'],
    ['review', 'done'], ['review', 'unsent']
  ]) assert.equal(move(from, to, source, actor).state, to);
  for (const [from, to, source, actor] of [
    ['unsent', 'review'], ['sent', 'unsent'], ['done', 'review'], ['sent', 'done'],
    ['review', 'done', 'annotation', 'agent']
  ]) assert.throws(() => move(from, to, source, actor));
  for (const from of ['unsent', 'sent', 'review', 'done']) {
    assert.equal(move(from, 'done', 'annotation', 'human', 'dismissed').state, 'done');
  }
  assert.throws(() => move('review', 'done', 'annotation', 'agent', 'dismissed'));
  assert.throws(() => applyTaskPatch(base, { id: 't-0002' }, 'human'));
  assert.throws(() => applyTaskPatch({ ...base, ref: { kind: 'annotation', id: 'a-0001' } }, { body: '写し' }, 'human'));
  assert.equal(nextTaskId([{ id: 't-0003' }, { id: 't-0008' }]), 't-0009');
});

test('注釈の写像・食い違い・孤児・要確認・壊れた review', () => {
  const empty = { version: 0, tasks: [] };
  assert.equal(deriveTasks(review(), empty).tasks[0].state, 'unsent');
  assert.equal(deriveTasks(review(), empty).tasks[0].priority, 'normal');
  assert.equal(deriveTasks(review('addressed'), empty).tasks[0].state, 'review');
  assert.equal(deriveTasks(review('resolved'), empty).tasks[0].state, 'done');
  const overlay = { version: 0, tasks: [{ ...base, state: 'sent', ref: { kind: 'annotation', id: 'a-0001' }, body: '古い本文' }] };
  assert.equal(deriveTasks(review(), overlay).tasks[0].state, 'sent');
  assert.equal(deriveTasks(review('addressed'), overlay).tasks[0].outcome, 'edited');
  const dismissed = { version: 0, tasks: [{ ...base, state: 'done', outcome: 'dismissed', ref: { kind: 'annotation', id: 'a-0001' } }] };
  assert.equal(deriveTasks(review('addressed'), dismissed).tasks[0].state, 'done');
  assert.equal(deriveTasks(review('addressed'), dismissed).tasks[0].outcome, 'dismissed');
  assert.equal(deriveTasks(review('resolved'), overlay).tasks[0].state, 'done');
  assert.equal(deriveTasks(review('open', '[要確認] 調整'), overlay).tasks[0].gate, 'ask');
  assert.equal(deriveTasks(review(), { version: 0, tasks: [{ ...base, state: 'review', ref: { kind: 'annotation', id: 'a-0001' } }] }).tasks[0].state, 'unsent');
  assert.equal(deriveTasks('', overlay).tasks[0].orphaned, true);
  assert.ok(deriveTasks('{bad', empty).warnings.length);
  assert.deepEqual(deriveTasks('', empty).tasks, []);
  assert.equal(deriveTasks('', { version: 0, tasks: [null, { id: 't-0002' }] }).tasks.filter(task => task.unknown).length, 2);
  assert.equal(toOverlayEntry(deriveTasks(review(), empty).tasks[0]).body, undefined);
});

test('送信済み注釈の移行は既存行を保持して重複しない', () => {
  const doc = { version: 0, tasks: [base] };
  const imported = importSentAnnotationIds(doc, ['a-0001', 'a-0001', 'bad']);
  assert.equal(imported.tasks.length, 2);
  assert.equal(imported.tasks[1].state, 'sent');
  assert.deepEqual(doc.tasks, [base]);
});

test('deriveTasks は review.json のバイト列と更新時刻を変えない', async () => temporary(async (_file, root) => {
  const file = join(root, 'review.json');
  await fs.writeFile(file, review());
  const before = await fs.readFile(file);
  const mtime = (await fs.stat(file)).mtimeMs;
  deriveTasks((await fs.readFile(file)).toString('utf8'), { version: 0, tasks: [] });
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal((await fs.stat(file)).mtimeMs, mtime);
}));
