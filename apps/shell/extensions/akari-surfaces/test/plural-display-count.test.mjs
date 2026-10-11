import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setLanguage, t } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { pluralCountForDisplay } = require('../lib/common/plural-display-count.js');

test('narration seconds follow the displayed precision', () => {
    try {
        setLanguage('en');
        for (const [display, unit] of [['1', 'second'], ['1.0', 'seconds'], ['1.00', 'seconds'], ['2', 'seconds']]) {
            assert.match(t('surfaces.settings.narrationSeconds.message', { avatar: 'Voice', date: '2026-10-11', duration: display, n: pluralCountForDisplay(display) }), new RegExp(`${display.replace('.', '\\.')} ${unit}$`));
        }
        setLanguage('ja');
        assert.equal(t('surfaces.settings.narrationSeconds.message', { avatar: 'Voice', date: '2026-10-11', duration: '1.0', n: pluralCountForDisplay('1.0') }), 'Voice · 2026-10-11 · 1.0 秒');
    } finally {
        setLanguage(undefined);
    }
});
