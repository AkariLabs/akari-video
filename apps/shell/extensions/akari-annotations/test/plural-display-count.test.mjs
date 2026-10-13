import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setLanguage, t } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { pluralCountForDisplay } = require('../lib/common/plural-display-count.js');

test('displayed decimals use the English plural form', () => {
    try {
        setLanguage('en');
        for (const [display, expected] of [['1', '1 second'], ['1.0', '1.0 seconds'], ['1.00', '1.00 seconds'], ['2', '2 seconds']]) {
            assert.equal(t('annotations.timeline.text.lengthSeconds', { duration: display, n: pluralCountForDisplay(display) }), `Length ${expected}`);
        }
        setLanguage('ja');
        assert.equal(t('annotations.timeline.text.lengthSeconds', { duration: '1.00', n: pluralCountForDisplay('1.00') }), '長さ 1.00 秒');
    } finally {
        setLanguage(undefined);
    }
});
