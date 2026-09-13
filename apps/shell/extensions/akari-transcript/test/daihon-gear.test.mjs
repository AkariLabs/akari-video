import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  gearSpeechTrimSeconds,
  gearSpeechWindow,
  planSpeechTightApply,
  readDisplayTiming,
  readGearAnimationId,
  readGearStyle,
} from '../lib/common/daihon-gear.js';

test('readGearStyle は karaoke をそのまま読む', () => assert.equal(readGearStyle('karaoke'), 'karaoke'));
test('readGearStyle は未知値を plain にする', () => assert.equal(readGearStyle('pop'), 'plain'));
test('readDisplayTiming は speech-tight をそのまま読む', () =>
  assert.equal(readDisplayTiming('speech-tight'), 'speech-tight'));
test('readDisplayTiming は未知値を full にする', () => assert.equal(readDisplayTiming(null), 'full'));
test('readGearAnimationId は animation.in.id を読む', () =>
  assert.equal(readGearAnimationId({ animation: { in: { id: 'fade-up' } } }), 'fade-up'));
test('readGearAnimationId は壊れた text_style を null にする', () =>
  assert.equal(readGearAnimationId({ animation: { in: { id: 'Bad ID' } } }), null));

test('gearSpeechWindow は前後の無音を縮める', () => {
  assert.deepEqual(gearSpeechWindow([{ start: 1, end: 2 }, { start: 2.2, end: 3 }], 0, 4),
    { start: 1, end: 3 });
});
test('gearSpeechWindow は語なしを null にする', () => assert.equal(gearSpeechWindow([], 0, 4), null));
test('gearSpeechWindow は窓いっぱいなら null にする', () =>
  assert.equal(gearSpeechWindow([{ start: 0, end: 4 }], 0, 4), null));
test('gearSpeechTrimSeconds は前後の詰め秒を返す', () => {
  const trim = gearSpeechTrimSeconds([{ start: 0.42, end: 2.69 }], 0, 3);
  assert.deepEqual({ head: trim?.head.toFixed(2), tail: trim?.tail.toFixed(2) }, { head: '0.42', tail: '0.31' });
});
test('planSpeechTightApply は詰まる行だけを targets にする', () => {
  assert.deepEqual(planSpeechTightApply([
    { id: 'a', start: 0, end: 3, words: [{ start: 1, end: 2 }], displayTiming: 'full' },
    { id: 'b', start: 3, end: 4, words: [{ start: 3, end: 4 }] },
    { id: 'c' },
  ], 'speech-tight'), { targets: ['a'], skipped: ['b', 'c'] });
});
test('planSpeechTightApply はすでに speech-tight の行を targets に入れない', () => {
  assert.deepEqual(planSpeechTightApply([
    { id: 'a', start: 0, end: 3, words: [{ start: 1, end: 2 }], displayTiming: 'speech-tight' },
    { id: 'b', start: 0, end: 3, words: [{ start: 1, end: 2 }], displayTiming: 'full' },
  ], 'speech-tight'), { targets: ['b'], skipped: ['a'] });
});
test('planSpeechTightApply の full は speech-tight の行だけを targets にする', () => {
  assert.deepEqual(planSpeechTightApply([
    { id: 'a', displayTiming: 'speech-tight' },
    { id: 'b', words: [{ start: 1, end: 2 }], displayTiming: 'full' },
    { id: 'c' },
  ], 'full'), { targets: ['a'], skipped: ['b', 'c'] });
});
