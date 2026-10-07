import test from 'node:test';
import assert from 'node:assert/strict';
import { availableActions } from '../lib/common/task-actions.js';

const task = (state, extra = {}) => ({ id: 't-0001', source: 'annotation', state, createdAt: '', ...extra });
const ids = t => availableActions(t).map(action => action.id);

test('状態機械の各カード操作', () => {
  assert.deepEqual(ids(task('unsent')), ['send', 'dismiss']);
  assert.deepEqual(ids(task('unsent', { needsConfirm: true })), ['dismiss']);
  assert.deepEqual(ids(task('sent')), ['dismiss']);
  assert.deepEqual(ids(task('sent', { sentTo: { route: 'clipboard' } })), ['markPasted', 'dismiss']);
  assert.deepEqual(ids(task('sent', { sentTo: { route: 'clipboard', pasted: true } })), ['dismiss']);
  assert.deepEqual(ids(task('review', { ref: { kind: 'annotation', id: 'a-0001' } })), ['confirm', 'dismiss']);
  assert.deepEqual(ids(task('review')), ['confirm', 'retry', 'dismiss']);
  assert.deepEqual(ids(task('review', { source: 'lint', ref: { kind: 'lint', id: 'x' } })), ['confirm', 'retry', 'dismiss']);
  assert.deepEqual(ids(task('done')), []);
  assert.deepEqual(ids(task('future', { unknown: true })), []);
  assert.equal(availableActions(task('unsent', { gate: 'ask' }))[0].confirm, true);
  assert.equal(availableActions(task('unsent', { risk: 'outbound' }))[0].confirm, true);
});
