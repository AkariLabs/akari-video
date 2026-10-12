import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { pluralCountForDisplay } = require('../lib/common/plural-display-count.js');
const { t } = require('../lib/browser/transcript-text.js');

test('character rate uses plural for displayed decimals', () => {
    try {
        setLanguage('en');
        assert.equal(t('transcript.daihon.qualityCheck.fastCharactersSecWithCountLabel', { value1: '1', n: pluralCountForDisplay('1') }), '⚡ Fast: 1 character/sec');
        assert.equal(t('transcript.daihon.qualityCheck.fastCharactersSecWithCountLabel', { value1: '1.0', n: pluralCountForDisplay('1.0') }), '⚡ Fast: 1.0 characters/sec');
        assert.equal(t('transcript.daihon.qualityCheck.fastCharactersSecWithCountLabel', { value1: '2', n: pluralCountForDisplay('2') }), '⚡ Fast: 2 characters/sec');
        setLanguage('ja');
        assert.equal(t('transcript.daihon.qualityCheck.fastCharactersSecWithCountLabel', { value1: '1.0', n: pluralCountForDisplay('1.0') }), '⚡ 速い 1.0 字/秒');
    } finally {
        setLanguage(undefined);
    }
});
