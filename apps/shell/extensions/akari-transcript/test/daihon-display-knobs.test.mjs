import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampDaihonMaxLineUnits,
  daihonDisplayLabel,
  readDaihonDisplayKnobs,
  validateDaihonCustomLines,
  writeDaihonDisplayKnobs
} from '../lib/common/daihon-display-knobs.js';

test('object と配列のルートを既定値つきで読む', () => {
  assert.deepEqual(readDaihonDisplayKnobs([]), { maxLineUnits: 18, lines: 1, wrap: 'multi' });
  assert.deepEqual(readDaihonDisplayKnobs({ display_policy: {
    max_line_units: 22, lines: 3, wrap: 'fold'
  } }), { maxLineUnits: 22, lines: 3, wrap: 'fold' });
});

test('UI 値を書き、配列ルートは captions を保った object 形式へ包む', () => {
  const captions = [{ id: 'c-1', text: '字幕本文' }];
  const written = writeDaihonDisplayKnobs(captions, { maxLineUnits: 12, lines: 2, wrap: 'fold' });
  assert.equal(written.captions, captions);
  assert.deepEqual(written.display_policy, {
    mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
    unit_metric: 'ascii-half-other-one-v1', max_line_units: 12,
    minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 2, wrap: 'fold'
  });
});

test('既存 policy の非 UI 値と object ルートの兄弟キーを保つ', () => {
  const written = writeDaihonDisplayKnobs({ meta: 'KEEP', display_policy: {
    minimum_fragment_duration_seconds: 0.5, locale: 'en', break_hints: { protected_terms: ['AKARI'] }
  } }, { maxLineUnits: 20, lines: 1, wrap: 'multi' });
  assert.equal(written.meta, 'KEEP');
  assert.equal(written.display_policy.minimum_fragment_duration_seconds, 0.5);
  assert.equal(written.display_policy.locale, 'en');
  assert.deepEqual(written.display_policy.break_hints, { protected_terms: ['AKARI'] });
});

test('カスタム行数は 4〜6 だけを受理する', () => {
  assert.equal(validateDaihonCustomLines('4'), 4);
  assert.equal(validateDaihonCustomLines(6), 6);
  assert.equal(validateDaihonCustomLines(3), null);
  assert.equal(validateDaihonCustomLines(7), null);
});

test('スライダー値を 10〜28 にクランプしラベルを作る', () => {
  assert.equal(clampDaihonMaxLineUnits(4), 10);
  assert.equal(clampDaihonMaxLineUnits(40), 28);
  assert.equal(daihonDisplayLabel({ maxLineUnits: 18, lines: 1 }), '18字 · 1行');
});
