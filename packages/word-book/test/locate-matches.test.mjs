import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMatcher, locateMatches } from '../src/index.mjs';

test('置換器と同じ語境界で元文字列の範囲を返す', () => {
  const matcher = buildMatcher([{ kind: 'term', surface: 'テロップ', variants: ['てろっぷ'], scope: 'user' }]);
  assert.deepEqual(locateMatches('てろっぷを出して', matcher), [
    { start: 0, end: 4, from: 'てろっぷ', to: 'テロップ', priority: 0, scope: 'user' }
  ]);
});
