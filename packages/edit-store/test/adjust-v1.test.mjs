import assert from 'node:assert/strict';
import test from 'node:test';
import { readEditV2 } from '../lib/edit-v2.js';
import { validAdjust, invalidAdjustCases, editWithAdjust } from '../../schemas/test/fixtures/adjust-v1-cases.mjs';

test('readEditV2 preserves all adjustV1 sections and accepts boundary values', () => {
  const edit = readEditV2(editWithAdjust(validAdjust));
  assert.deepEqual(edit.tracks[0].items[0].adjust, validAdjust);
});
for (const [name, adjust, path, check] of invalidAdjustCases) {
  test('readEditV2 rejects ' + name + ' at its exact path even when bypassed', () => {
    assert.throws(() => readEditV2(editWithAdjust({ ...adjust, sections: { curves: false, wheels: false, hue: false } })), error => {
      // requireExactKeys uses the owning object's path and lists unknown keys.
      const owner = check === 'unknown-key' ? path.slice(0, path.lastIndexOf('.')) : path;
      return error.message.includes('tracks[0].items[0].adjust.' + owner)
        && (check !== 'unknown-key' || error.message.includes('未定義キーを使用できません: ' + path.slice(path.lastIndexOf('.') + 1)));
    });
  });
}
test('readEditV2 rejects nonfinite adjustment values and nonboolean sections', () => {
  for (const value of [NaN, Infinity, -Infinity, '0']) {
    assert.throws(() => readEditV2(editWithAdjust({ wheels: { lift: { r: value } } })), /wheels\.lift\.r/);
    assert.throws(() => readEditV2(editWithAdjust({ hue: { sat: [{ hue: 0, value }] } })), /hue\.sat\[0\]\.value/);
  }
  for (const section of ['curves', 'wheels', 'hue']) assert.throws(() => readEditV2(editWithAdjust({ sections: { [section]: 'off' } })), /sections/);
});
