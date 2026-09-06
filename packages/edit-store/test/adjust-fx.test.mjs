import assert from 'node:assert/strict';
import test from 'node:test';
import { readEditV2 } from '../lib/edit-v2.js';
import { editWithAdjust } from '../../schemas/test/fixtures/adjust-v1-cases.mjs';
import { fxExamples, invalidFxCases, validGroup2FxCases } from '../../schemas/test/fixtures/adjust-fx-cases.mjs';

for (const { name, check, edit } of fxExamples) {
  test('readEditV2 adjust fx example: ' + name, () => {
    if (check) {
      assert.throws(() => readEditV2(edit), check === 'adjust.fx.duplicate-id' ? /adjust\.fx\.duplicate-id/ : /adjust\.fx/);
    } else {
      assert.deepEqual(readEditV2(edit).tracks[0].items[0].adjust, edit.tracks[0].items[0].adjust);
    }
  });
}
test('readEditV2 validates fx even when bypassed, including nonfinite values and extra keys', () => {
  for (const [name, adjust] of invalidFxCases) {
    assert.throws(() => readEditV2(editWithAdjust(adjust)), /adjust/, name);
    if (adjust.fx !== undefined) assert.throws(() => readEditV2(editWithAdjust({ ...adjust, sections: { fx: false } })), /adjust\.fx/, name);
  }
});
test('readEditV2 preserves empty, default and disabled fx declarations', () => {
  for (const adjust of [{ fx: [] }, { fx: [{ id: 'blur' }] }, { fx: [{ id: 'vignette', amount: -1 }], sections: { fx: false } }]) {
    assert.deepEqual(readEditV2(editWithAdjust(adjust)).tracks[0].items[0].adjust, adjust);
  }
});

test('group two accepts defaults and inclusive boundaries with either section state', async () => {
  for (const value of validGroup2FxCases) for (const enabled of [true, false]) {
    const adjust = { ...value, sections: { fx: enabled } };
    assert.deepEqual(readEditV2(editWithAdjust(adjust)).tracks[0].items[0].adjust, adjust);
  }
});
