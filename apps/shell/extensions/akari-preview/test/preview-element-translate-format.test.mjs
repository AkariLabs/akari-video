import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPreviewElementStyleAllowed } from '../lib/common/preview-element-write.js';

const element = translate => ({ ref: '.box[0]', tag: 'div', style: { translate } });
const sentTranslate = /^-?\d+(?:\.\d{1,2})?px -?\d+(?:\.\d{1,2})?px$/u;

test('translate accepts exactly two plain decimal px values', () => {
  assert.match('0px 0px', sentTranslate);
  assert.match('-12.34px 0.01px', sentTranslate);
  for (const value of ['+1px 0px', '.5px 4px', '0px 1.234px', '1e-7px 0px']) {
    assert.doesNotMatch(value, sentTranslate);
  }
  for (const value of ['0px 0px', '-12.34px +0.01px', '.5px 4px']) {
    assert.doesNotThrow(() => assertPreviewElementStyleAllowed(element(value)), value);
  }
  for (const value of ['12px', '1e-7px 0px', '0px -2E+3px', '1px 2px 3px']) {
    assert.throws(() => assertPreviewElementStyleAllowed(element(value)), /許可されない値: translate/u, value);
  }
});
