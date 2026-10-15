import assert from 'node:assert/strict';
import test from 'node:test';
import { setLanguage } from '@akari-video/i18n';
import { thinkingLabel, permissionLabel, contextUsage } from '../lib/browser/chat-view-logic.js';

test('chat copy follows the selected language', () => {
  try {
    setLanguage('ja');
    assert.equal(permissionLabel('auto'), '自動');
    assert.equal(thinkingLabel(0, 2000, false), '考えています… 2 秒');
    setLanguage('en');
    assert.equal(permissionLabel('auto'), 'Automatic');
    assert.equal(thinkingLabel(0, 2000, false), 'Thinking… 2s');
    assert.match(contextUsage(20, 100).label, /^Usage:/);
  } finally { setLanguage(undefined); }
});

test('running tool headings finish in the selected language for either input language', async () => {
  const { finishedTitle } = await import('../lib/node/adapters/codex-app-server.js');
  try {
    setLanguage('ja');
    assert.equal(finishedTitle('書いています file'), '書きました file');
    assert.equal(finishedTitle('Writing file'), '書きました file');
    setLanguage('en');
    assert.equal(finishedTitle('書いています file'), 'Wrote file');
    assert.equal(finishedTitle('Writing file'), 'Wrote file');
  } finally { setLanguage(undefined); }
});
