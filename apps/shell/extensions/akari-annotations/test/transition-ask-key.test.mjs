import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionAskKey } from '../lib/common/transition-ask-key.js';

test('confirmation consumes every key and gives buttons only their local actions', () => {
  for (const [key, expected] of [
    ['Escape', 'cancel'], ['Tab', 'cycle'], ['Enter', 'press'], [' ', 'press'],
    ['Delete', 'block'], ['Backspace', 'block'], ['z', 'block'], ['Spacebar', 'block']
  ]) assert.equal(transitionAskKey(key), expected);
});
