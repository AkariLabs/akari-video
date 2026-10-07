import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoElementWriteConflict, isElementSelectionFileReference } from '../lib/common/preview-element-write.js';

test('host rejects element patches combined with every other write field', () => {
  const element = { ref: '.bar[2]', tag: 'div', style: { translate: '1px 2px' } };
  for (const [key, value] of Object.entries({ transform: {}, html: '', text: '', duplicate: false,
    params: {}, vars: {}, xyKeyframes: [] })) {
    assert.throws(() => assertNoElementWriteConflict({ element, [key]: value }), /同時に指定できません/, key);
  }
  assert.doesNotThrow(() => assertNoElementWriteConflict({ element }));
  assert.doesNotThrow(() => assertNoElementWriteConflict({ transform: {} }));
});

test('element selection capability requires a file reference', () => {
  for (const path of ['overlays/chart.html', ' assets/overlay/chart.html ', './chart.html']) {
    assert.equal(isElementSelectionFileReference(path), true, path);
  }
  for (const path of ['<div class="bar"></div>', ' \n <svg></svg>', '', '  ', null, undefined]) {
    assert.equal(isElementSelectionFileReference(path), false, String(path));
  }
});
