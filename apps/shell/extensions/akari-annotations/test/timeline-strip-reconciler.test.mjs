import assert from 'node:assert/strict';
import test from 'node:test';

import { isRangeMounted, planKeyedReconciliation } from '../lib/browser/timeline-strip-reconciler.js';

function applyPlan(current, desired, plan) {
  const result = current.filter(key => !plan.removals.includes(key));
  for (const { key, beforeKey } of plan.moves) {
    const oldIndex = result.indexOf(key);
    if (oldIndex >= 0) result.splice(oldIndex, 1);
    const beforeIndex = beforeKey === undefined ? result.length : result.indexOf(beforeKey);
    result.splice(beforeIndex, 0, key);
  }
  assert.deepEqual(result, desired);
}

test('keyed 差分は追加・削除と LIS に基づく最小移動を返す', () => {
  const current = ['band:a', 'cut:1', 'cut:2', 'pin:x'];
  const desired = ['band:a', 'cut:2', 'cut:1', 'cut:3'];
  const plan = planKeyedReconciliation(current, desired);
  assert.deepEqual(plan.removals, ['pin:x']);
  assert.equal(plan.moves.filter(move => current.includes(move.key)).length, 1);
  assert.equal(plan.moves.filter(move => !current.includes(move.key)).length, 1);
  applyPlan(current, desired, plan);
});

test('keyed 差分後の順序は全再構築の desired 順と一致する', () => {
  const cases = [
    [['band:a', 'tree:x', 'cut:0'], ['band:a', 'cut:0', 'tree:x']],
    [['a', 'b', 'c', 'd'], ['d', 'b', 'a', 'c']],
    [[], ['tick:0', 'tick:1']],
  ];
  for (const [current, desired] of cases) applyPlan(current, desired, planKeyedReconciliation(current, desired));
});

test('可視幅 ±50% margin の境界は開区間交差で mount を決める', () => {
  assert.equal(isRangeMounted(49.999, 50, 100, 100), false);
  assert.equal(isRangeMounted(49.999, 50.001, 100, 100), true);
  assert.equal(isRangeMounted(249.999, 250.001, 100, 100), true);
  assert.equal(isRangeMounted(250, 251, 100, 100), false);
  assert.equal(isRangeMounted(100, 200, 100, 100), true);
});
