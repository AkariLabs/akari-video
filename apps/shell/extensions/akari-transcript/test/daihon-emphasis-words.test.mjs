import assert from 'node:assert/strict'; import test from 'node:test';
import { emphasisIdsCovering, planEmphasisUpserts, readEmphasisWords } from '../lib/browser/daihon/daihon-emphasis-words.js';
test('reads object root only and plans one neutral record per range', () => {
  assert.equal(readEmphasisWords('[]').length, 0);
  assert.equal(readEmphasisWords('{"emphasis_words":[{"id":"e-0001"}]}').length, 1);
  assert.deepEqual(planEmphasisUpserts([{ t_start: 1, t_end: 2, word: '語' }], 'neon'),
    [{ t_start: 1, t_end: 2, word: '語', emotion: 'neutral', style_preset: 'neon' }]);
});
test('covering ids require matching optional src and overlap', () => assert.deepEqual(emphasisIdsCovering([
  { id: 'e-0001', t_start: 1, t_end: 2, word: 'a', emotion: 'neutral' },
  { id: 'e-0002', src: 'x', t_start: 1, t_end: 2, word: 'b', emotion: 'neutral' }
], [{ t_start: 1.5, t_end: 3 }]), ['e-0001']));
