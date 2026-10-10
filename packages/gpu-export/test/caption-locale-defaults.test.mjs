import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCaptionWordMode } from '../src/eligibility.mjs';

test('GPU caption classification follows locale portrait limits', () => {
  const cue = { start: 0, end: 2, text: 'hello world again',
    words: [{ start: 0, end: 1, text: 'hello' }, { start: 1, end: 2, text: 'world again' }] };
  const output = { width: 1080, height: 1920 };
  assert.notEqual(classifyCaptionWordMode({ cue, output, locale: 'en-US' }).effectiveStyle, 'reveal');
  assert.equal(classifyCaptionWordMode({ cue, output, locale: 'ja' }).effectiveStyle, 'reveal');
});
