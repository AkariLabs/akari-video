import assert from 'node:assert/strict';
import test from 'node:test';
import { setLanguage, t } from '@akari-video/i18n';
import { includesLocalizedValue, localizedPattern, matchesLocalizedValue } from '../lib/common/chat-localized-match.js';

const allow = 'chat.claudeStreamJson.ui.allowLabel';
const deny = 'chat.claudeStreamJson.ui.denyLabel';

test('permission answers and diagnostics match both catalogs in either UI language', () => {
  try {
    for (const language of ['ja', 'en']) {
      setLanguage(language);
      assert.equal(matchesLocalizedValue('許可', allow), true);
      assert.equal(matchesLocalizedValue('Allow', allow), true);
      assert.equal(matchesLocalizedValue('拒否', deny), true);
      assert.equal(matchesLocalizedValue('Deny', deny), true);
      assert.equal(includesLocalizedValue('Error: 会話が見つかりません', 'chat.akariChatService.ui.conversationNotFoundError'), true);
      assert.equal(includesLocalizedValue('Error: Conversation not found', 'chat.akariChatService.ui.conversationNotFoundError'), true);
      const pattern = localizedPattern([allow, deny], ['permission', 'denied', 'rejected']);
      for (const value of ['許可', '拒否', 'Allow', 'Deny', 'permission', 'denied', 'rejected']) {
        assert.match(value, pattern);
      }
    }
  } finally { setLanguage(undefined); }
});

test('agent choice instruction keeps its Japanese contract and has an English form', () => {
  const key = 'chat.claudeStreamJson.prompt.askFenceInstructionText';
  assert.equal(t(key, {}, 'ja'), '選択肢を出すときは ```akari-ask と JSON {"question":"…","options":[{"label":"…","description":"…"}]} のフェンスで出してください。フェンス以外に選択肢の説明を繰り返さないでください。');
  assert.match(t(key, {}, 'en'), /```akari-ask.*fenced block/u);
});
