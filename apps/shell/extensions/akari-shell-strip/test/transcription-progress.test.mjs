import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { hasActiveTranscription } = require('../lib/common/transcription-progress.js');

test('transcription activity follows the job marker in either UI language', () => {
    try {
        for (const language of ['ja', 'en']) {
            setLanguage(language);
            const text = language === 'ja' ? '起こし中' : 'Transcribing';
            const active = { querySelector: selector => selector === '[data-akari-transcribe-progress]' ? { textContent: text } : null };
            const idle = { querySelector: () => null };
            assert.equal(hasActiveTranscription(active), true);
            assert.equal(hasActiveTranscription(idle), false);
        }
    } finally { setLanguage(undefined); }
});
