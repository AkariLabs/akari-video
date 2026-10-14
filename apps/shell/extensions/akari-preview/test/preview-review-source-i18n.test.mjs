import assert from 'node:assert/strict';
import test from 'node:test';
import { setLanguage } from '@akari-video/i18n';
import { previewChatReviewScript } from '../lib/browser/preview-chat-review.js';

test('raw review source identity stays stable when the UI language changes', () => {
  try {
    for (const language of ['ja', 'en']) {
      setLanguage(language);
      const script = previewChatReviewScript();
      assert.match(script, /initial\.kind === 'output' \? 'edit\.json' : "動画"/u);
      assert.doesNotThrow(() => new Function(script));
      assert.match(script, language === 'ja' ? /書き出し動画/u : /Exported video/u);
    }
  } finally { setLanguage(undefined); }
});
