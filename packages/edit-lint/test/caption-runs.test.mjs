import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaptionRunRanges } from '../src/edit-lint.mjs';

test('run ranges use displayed grapheme count and flag empty and overflow', () => {
  const caption = { text: 'raw', display_text: '👩‍👩‍👧‍👦é', runs: [
    { from: 0, to: 2 }, { from: 1, to: 1 }, { from: 0, to: 3 }
  ] };
  assert.deepEqual(validateCaptionRunRanges(caption).map(item => item.index), [1, 2]);
});
