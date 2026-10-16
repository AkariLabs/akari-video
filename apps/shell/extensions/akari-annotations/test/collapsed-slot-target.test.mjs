import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { collapsedPlanSlotAt } = require('../lib/browser/timeline/canvas-row-drop.js');
test('collapsed group exposes its plan child at the drop frame', () => {
  const group = { id: 'root', at: 10, duration: 60, source: { kind: 'group' }, items: [
    { id: 'slot', at: 20, duration: 20, source: { kind: 'group', canvas: { origin: 'plan' } }, items: [] }
  ] };
  assert.equal(collapsedPlanSlotAt(group, 31), 'slot');
  assert.equal(collapsedPlanSlotAt(group, 20), undefined);
});
