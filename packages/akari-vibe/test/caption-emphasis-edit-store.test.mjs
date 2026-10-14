import test from 'node:test';
import assert from 'node:assert/strict';
import operation from '../src/ops-exec/caption_shift_emphasis_word.mjs';

test('強調語の採番は実行環境の editStore を使う', () => {
  const line = { id: 'c-1', src: 's1', start: 0, end: 1, text: '猫',
    words: [{ text: '猫', start: 0.2, end: 0.8 }] };
  const source = JSON.stringify({ captions: [line] });
  const base = { captions: [line], captionsSource: source, source: '{}', segments: [], log: [] };
  const decision = { target: 'caption_c_1', caption_emphasis_word: '猫' };
  let calls = 0;
  const env = { ...base, editStore: {
    nextEmphasisWordId: () => { calls++; return 'e-0042'; },
    parseCaptions: () => ({ captions: [line] }), readEditV2: () => ({})
  } };
  operation.apply(env, decision);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(env.captionsSource).emphasis_words[0].id, 'e-0042');

  const missing = { ...base, log: [], editStore: {
    parseCaptions: () => ({ captions: [line] }), readEditV2: () => ({})
  } };
  operation.apply(missing, decision);
  assert.equal(missing.captionsSource, source);
  assert.match(missing.log[0], /強調語の id を採番できません/);
});
