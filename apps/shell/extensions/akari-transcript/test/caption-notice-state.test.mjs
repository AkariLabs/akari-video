import { createRequire as createI18nRequire } from 'node:module';
globalThis.t = createI18nRequire(import.meta.url)('../lib/browser/transcript-text.js').t;
globalThis.assessCutOutcome = createI18nRequire(import.meta.url)('../lib/common/daihon-cut-outcome.js').assessCutOutcome;
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
process.on('exit', () => setLanguage(undefined));
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCaptionNotices } from '../lib/common/caption-notice-state.js';

test('連続する同文通知は 1 つにまとめ、別の通知は出す', () => {
    assert.deepEqual(nextCaptionNotices(undefined, ['文字範囲 1 件が外れました',
        '文字範囲 1 件が外れました', '強調 1 件が外れました']), {
        show: ['文字範囲 1 件が外れました', '強調 1 件が外れました'],
        last: '強調 1 件が外れました'
    });
    assert.deepEqual(nextCaptionNotices('強調 1 件が外れました', ['強調 1 件が外れました']), {
        show: [], last: '強調 1 件が外れました'
    });
});
