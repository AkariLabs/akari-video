import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveDaihonFocusRowId, isValidDaihonWordRange } = require('../lib/common/daihon-focus-target.js');

test('explicit row IDs take priority over time, including missing IDs', () => {
  assert.equal(resolveDaihonFocusRowId(['a', 'b'], 'b', { captionId: 'a', atSeconds: 0 }), 'a');
  assert.equal(resolveDaihonFocusRowId(['a'], 'a', { captionId: 'missing', atSeconds: 0 }), undefined);
  assert.equal(resolveDaihonFocusRowId(['a'], 'a', { captionId: '', atSeconds: 0 }), undefined);
});

test('time resolution is used only when time is supplied without a row ID', () => {
  assert.equal(resolveDaihonFocusRowId(['a'], 'a', { atSeconds: 0 }), 'a');
  assert.equal(resolveDaihonFocusRowId(['a'], null, { atSeconds: 8 }), undefined);
  assert.equal(resolveDaihonFocusRowId(['a'], 'a', {}), undefined);
});

test('word ranges include both endpoints and require ordered integer indices within the row', () => {
  assert.equal(isValidDaihonWordRange(3, { from: 0, to: 2 }), true);
  assert.equal(isValidDaihonWordRange(3, { from: 2, to: 2 }), true);
  for (const range of [undefined, { from: 2, to: 1 }, { from: -1, to: 1 },
    { from: 0.5, to: 1 }, { from: 0, to: 1.5 }, { from: 0, to: 3 },
    { from: NaN, to: 1 }, { from: 0, to: Infinity }]) {
    assert.equal(isValidDaihonWordRange(3, range), false);
  }
  assert.equal(isValidDaihonWordRange(0, { from: 0, to: 0 }), false);
});
