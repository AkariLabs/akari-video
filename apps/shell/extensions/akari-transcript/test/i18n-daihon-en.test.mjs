import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { t } = require('../lib/browser/transcript-text.js');

test('script widget notices use Japanese and English catalog copy', () => {
  try {
    setLanguage('ja');
    assert.equal(t('transcript.akariDaihonWidget.ui.noCaptionsYetCreateOneSeeHereMessage'), 'まだ字幕がありません。字幕を作成するとここに表示されます');
    assert.equal(t('transcript.akariDaihonWidget.ui.unsavedLabel'), ' 未保存');
    setLanguage('en');
    assert.equal(t('transcript.akariDaihonWidget.ui.noCaptionsYetCreateOneSeeHereMessage'), 'No captions yet. Create one to see it here.');
    assert.equal(t('transcript.akariDaihonWidget.ui.unsavedLabel'), ' Unsaved');
  } finally { setLanguage(undefined); }
});
