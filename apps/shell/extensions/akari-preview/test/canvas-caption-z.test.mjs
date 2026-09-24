import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasCaptionZPlan } from '../lib/common/canvas-caption-z.js';

test('キャンバスの子だけ背景の段へ上げ、外の字幕は元の段に残す', () => {
  const z = id => ({ cb: 1, kt: 2 })[id] ?? -1;
  const plan = canvasCaptionZPlan([
    { id: 'cap-c-0001', canvasTrackId: 'kt' }, { id: 'c-0002' }
  ], 'cb', z);
  assert.equal(plan.split, true);
  assert.equal(plan.layerZ, 1);
  assert.deepEqual([...plan.plateZ], [['cap-c-0001', 2], ['c-0002', 1]]);
  assert.equal(canvasCaptionZPlan([{ id: 'c-0002' }], 'cb', z).split, false);
});
