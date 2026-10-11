import { createRequire as createI18nRequire } from 'node:module';
globalThis.t = createI18nRequire(import.meta.url)('../lib/browser/transcript-text.js').t;
globalThis.assessCutOutcome = createI18nRequire(import.meta.url)('../lib/common/daihon-cut-outcome.js').assessCutOutcome;
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
process.on('exit', () => setLanguage(undefined));
import assert from 'node:assert/strict';
import test from 'node:test';
import { activeDaihonFragment } from '../lib/common/daihon-fragment-highlight.js';

test('再生時刻を現在の表示断片と本文範囲へ写像する', () => {
  const fragments = ['今日はね', 'YouTube', 'の撮影を'];
  assert.deepEqual(activeDaihonFragment(fragments.join(''), fragments, 10, 16, 13, 0.5), {
    index: 1, from: 4, to: 11,
  });
  assert.equal(activeDaihonFragment(fragments.join(''), fragments, 10, 16, 16, 0.5), null);
});
