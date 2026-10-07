import test from 'node:test';
import assert from 'node:assert/strict';
import { orderNextTasks, pickNextRows, summarizeTasks } from '../lib/common/task-order.js';

const task = (id, extras = {}) => ({ id, source: 'annotation', state: 'unsent', createdAt: '2026-01-01', ...extras });

test('優先度、確認、rank、作成時刻、id の順で並ぶ', () => {
  const tasks = [
    task('t-9', { priority: 'low' }), task('t-8', { priority: 'high' }),
    task('t-7', { state: 'review', rank: 2 }), task('t-6', { rank: 1 }),
    task('t-5', { state: 'review', rank: 1, createdAt: '2026-01-02' }),
    task('t-4', { state: 'review', rank: 1 }), task('t-3', { state: 'sent' }),
    task('t-2', { state: 'done' })
  ];
  assert.deepEqual(orderNextTasks(tasks).map(t => t.id), ['t-8', 't-4', 't-5', 't-7', 't-6', 't-9']);
  assert.deepEqual(tasks.map(t => t.id).slice(0, 2), ['t-9', 't-8']);
});

test('次の 7 行には確認前も出し、件数は状態別', () => {
  const tasks = Array.from({ length: 9 }, (_, n) => task(`t-${n}`, { needsConfirm: n === 0 }));
  assert.equal(pickNextRows(tasks).length, 7);
  assert.equal(pickNextRows(tasks)[0].needsConfirm, true);
  assert.deepEqual(summarizeTasks([...tasks, task('sent', { state: 'sent' }), task('review', { state: 'review' })]),
    { unsent: 9, sent: 1, review: 1, done: 0 });
});
