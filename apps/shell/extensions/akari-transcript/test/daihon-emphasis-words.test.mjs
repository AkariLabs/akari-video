import { createRequire as createI18nRequire } from 'node:module';
globalThis.t = createI18nRequire(import.meta.url)('../lib/browser/transcript-text.js').t;
globalThis.assessCutOutcome = createI18nRequire(import.meta.url)('../lib/common/daihon-cut-outcome.js').assessCutOutcome;
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
process.on('exit', () => setLanguage(undefined));
import assert from 'node:assert/strict'; import test from 'node:test';
import { emphasisIdsCovering, planEmphasisUpserts, readEmphasisWords } from '../lib/browser/daihon/daihon-emphasis-words.js';
test('reads object root only and plans one neutral record per range', () => {
  assert.equal(readEmphasisWords('[]').length, 0);
  assert.equal(readEmphasisWords('{"emphasis_words":[{"id":"e-0001"}]}').length, 1);
  assert.deepEqual(planEmphasisUpserts([{ t_start: 1, t_end: 2, word: '語' }], 'neon'),
    [{ t_start: 1, t_end: 2, word: '語', emotion: 'neutral', style_preset: 'neon', inherit_caption_size: true }]);
});
test('covering ids require matching optional src and overlap', () => assert.deepEqual(emphasisIdsCovering([
  { id: 'e-0001', t_start: 1, t_end: 2, word: 'a', emotion: 'neutral' },
  { id: 'e-0002', src: 'x', t_start: 1, t_end: 2, word: 'b', emotion: 'neutral' }
], [{ t_start: 1.5, t_end: 3 }]), ['e-0001']));

test('台本の強調 upsert は素材の目印を保持する', () => {
  assert.deepEqual(planEmphasisUpserts([{ src: 'camera-a', t_start: 1, t_end: 2, word: '語' }], 'neon'),
    [{ src: 'camera-a', t_start: 1, t_end: 2, word: '語', emotion: 'neutral', style_preset: 'neon', inherit_caption_size: true }]);
});

test('素材付きの選択範囲は素材のない旧強調も覆う', () => {
  const existing = [
    { id: 'e-0001', t_start: 1, t_end: 2, word: '語', emotion: 'neutral', style_preset: 'neon' },
    { id: 'e-0002', src: 'camera-b', t_start: 1, t_end: 2, word: '語', emotion: 'neutral' }
  ];
  assert.deepEqual(emphasisIdsCovering(existing, [{ src: 'camera-a', t_start: 1.5, t_end: 2.5 }]), ['e-0001']);
});

test('別の語プリセットを当てるとき旧強調が削除対象に入る', () => {
  const existing = [{ id: 'e-0001', t_start: 1, t_end: 2, word: '語', emotion: 'neutral', style_preset: 'neon' }];
  const spans = [{ src: 'camera-a', t_start: 1, t_end: 2, word: '語' }];
  assert.deepEqual(emphasisIdsCovering(existing, spans), ['e-0001']);
  assert.deepEqual(planEmphasisUpserts(spans, 'bold'),
    [{ src: 'camera-a', t_start: 1, t_end: 2, word: '語', emotion: 'neutral', style_preset: 'bold', inherit_caption_size: true }]);
});

test('強調を外すとき素材のない旧強調が削除対象に入る', () => {
  const source = '{"emphasis_words":[{"id":"e-0001","t_start":1,"t_end":2,"word":"語","emotion":"neutral"}]}';
  assert.deepEqual(emphasisIdsCovering(readEmphasisWords(source),
    [{ src: 'camera-a', t_start: 1, t_end: 2 }]), ['e-0001']);
});
