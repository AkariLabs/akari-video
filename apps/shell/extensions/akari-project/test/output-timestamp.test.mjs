import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { formatOutputTimestamp } = require('../lib/common/output-timestamp.js');

test('output times match the home format in English and keep the Japanese display', () => {
    const date = new Date(2026, 9, 11, 13, 38);
    try {
        setLanguage('en');
        assert.equal(formatOutputTimestamp(date.getTime()), date.toLocaleString('en-US'));
        setLanguage('ja');
        assert.equal(formatOutputTimestamp(date.getTime()), '2026-10-11 13:38');
    } finally {
        setLanguage(undefined);
    }
});
