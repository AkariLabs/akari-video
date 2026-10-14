import { createRequire as createI18nRequire } from 'node:module';
globalThis.t = createI18nRequire(import.meta.url)('../lib/browser/transcript-text.js').t;
globalThis.assessCutOutcome = createI18nRequire(import.meta.url)('../lib/common/daihon-cut-outcome.js').assessCutOutcome;
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
process.on('exit', () => setLanguage(undefined));
import assert from 'node:assert/strict';
import test from 'node:test';
import { readAllSourceText } from './helpers/daihon-source.mjs';

test('その他メニューから発話合わせ直し RPC と履歴へつなぐ', async () => {
    const source = readAllSourceText();
    assert.match(source, /this\.popButton\(t\('transcript\.daihon\.editor\.ongoingAlignSpeechAction'\)/);
    assert.equal(globalThis.t('transcript.daihon.editor.ongoingAlignSpeechAction'), '⏱ 発話に合わせ直す…');
    assert.match(source, /buildCaptions\(\{ projectRoot, \.\.\.\{ editUri: this\.editUri!\.toString\(\) \}, source: source\.id, retime: true \}\)/);
    assert.match(source, /withHistory\(t\('transcript\.daihon\.editor\.alignSpeechLabel'\)/);
    assert.equal(globalThis.t('transcript.daihon.editor.alignSpeechLabel'), '発話に合わせ直す');
    assert.match(source, /captionsRetimeLine\(moved, retimeSummary\)/);
});
