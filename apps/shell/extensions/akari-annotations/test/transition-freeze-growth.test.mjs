import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionFreezeSnapshot, transitionFreezeGrowth } from '../lib/common/transition-freeze-growth.js';

const ids = ['a', 'b', 'c'];
const plan = (earlierId, laterId, incoming = 0, outgoing = 0, extra = {}) => ({
  earlierId: String(earlierId), laterId: String(laterId), state: 'ok', legacyOverlap: false,
  freezeIncomingSeconds: incoming, freezeOutgoingSeconds: outgoing,
  freezeOutgoingUnknown: false, ...extra
});
const changes = (before, after) => transitionFreezeGrowth(transitionFreezeSnapshot(before, ids), after, ids);

test('freeze growth reports incoming, outgoing, both sides, and multiple boundaries', () => {
  const before = [plan(0, 1, 0.1, 0.1), plan(1, 2, 0, 0.1)];
  assert.deepEqual(changes(before, [plan(0, 1, 0.2, 0.1), plan(1, 2, 0, 0.2)]), [
    { from: 1, to: 2, seconds: '0.30' }, { from: 2, to: 3, seconds: '0.20' }
  ]);
  assert.deepEqual(changes([plan(0, 1, 0.1, 0.1)], [plan(0, 1, 0.2, 0.2)]),
    [{ from: 1, to: 2, seconds: '0.40' }]);
});

test('freeze growth ignores decreases, equal values, rounded noise, missing and ineffective boundaries', () => {
  const before = [plan(0, 1, 0.1, 0.1)];
  assert.deepEqual(changes(before, [plan(0, 1, 0.05, 0.1)]), []);
  assert.deepEqual(changes(before, before), []);
  assert.deepEqual(changes(before, [plan(0, 1, 0.100001, 0.1)]), []);
  assert.deepEqual(changes(before, []), []);
  assert.deepEqual(changes(before, [plan(0, 1, 0.3, 0.1, { state: 'none' })]), []);
  assert.deepEqual(changes(before, [plan(0, 1, 0.3, 0.1, { legacyOverlap: true })]), []);
  assert.deepEqual(transitionFreezeGrowth(transitionFreezeSnapshot(before, ids),
    [plan(0, 1, 0.3, 0.1)], ids, ['a', 'b']), []);
});

test('an unknown outgoing side is excluded while known incoming growth remains visible', () => {
  const unknown = plan(0, 1, 0.1, 0.4, { freezeOutgoingUnknown: true });
  assert.deepEqual(changes([unknown], [plan(0, 1, 0.1, 0.5)]), []);
  assert.deepEqual(changes([unknown], [plan(0, 1, 0.2, 0.5)]),
    [{ from: 1, to: 2, seconds: '0.70' }]);
  assert.deepEqual(changes([plan(0, 1, 0.1, 0.1)],
    [plan(0, 1, 0.2, 0.5, { freezeOutgoingUnknown: true })]),
    [{ from: 1, to: 2, seconds: '0.20' }]);
});

test('growth follows the same item pair when clip indices change', () => {
  const previous = transitionFreezeSnapshot([plan(0, 1, 0.1, 0)], ['a', 'b']);
  const after = [plan(1, 2, 0.2, 0)];
  assert.deepEqual(transitionFreezeGrowth(previous, after, ['x', 'a', 'b']),
    [{ from: 2, to: 3, seconds: '0.20' }]);
});
