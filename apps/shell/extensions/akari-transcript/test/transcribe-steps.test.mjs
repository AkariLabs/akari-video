import { createRequire as createI18nRequire } from 'node:module';
globalThis.t = createI18nRequire(import.meta.url)('../lib/browser/transcript-text.js').t;
globalThis.assessCutOutcome = createI18nRequire(import.meta.url)('../lib/common/daihon-cut-outcome.js').assessCutOutcome;
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
process.on('exit', () => setLanguage(undefined));
import '../src/common/transcribe-steps.test.mjs';
