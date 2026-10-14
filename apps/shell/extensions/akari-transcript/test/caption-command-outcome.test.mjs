import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { setLanguage } from '@akari-video/i18n';
import { settleCaptionCommand } from '../lib/common/caption-command-outcome.js';
import { t } from '../lib/browser/transcript-text.js';
import { captionCommandHistory } from '../../akari-annotations/lib/browser/caption-command-history.js';

const actions = events => ({
  conflictNotice: '読み直しました',
  reload: async () => { events.push('reload'); },
  notify: message => events.push(`notice:${message}`),
  record: () => events.push('history')
});

test('競合では読み直して一度だけ知らせ、履歴を積まない', async () => {
  const events = [];
  await settleCaptionCommand({ ok: false, conflict: true, files: ['captions.json'], message: '競合' }, actions(events));
  assert.deepEqual(events, ['reload', 'notice:読み直しました']);
});

test('台本の競合通知と undo の競合エラーは辞書の文になる', async () => {
  setLanguage('ja');
  try {
    const notice = t('transcript.daihon.editor.reloadAfterConflictNotice');
    const events = [];
    await settleCaptionCommand({ ok: false, conflict: true, files: ['captions.json'], message: '競合' },
      { ...actions(events), conflictNotice: notice });
    assert.deepEqual(events, ['reload', `notice:${notice}`]);
    assert.doesNotMatch(notice, /^[a-z]+\.[A-Za-z.]+$/u);
    const entry = captionCommandHistory({ written: ['captions.json'],
      before: { 'captions.json': { hash: 'before', text: '前' } },
      after: { 'captions.json': { hash: 'after', text: '後' } }
    }, '字幕', { editUri: 'file:///edit.json', projectRootUri: 'file:///' },
    async () => ({ committed: false, conflict: true, files: ['captions.json'] }), async () => {});
    await assert.rejects(entry.undo(), error => {
      assert.doesNotMatch(error.message, /^[a-z]+\.[A-Za-z.]+$/u);
      assert.match(error.message, /ほかの変更/u);
      return true;
    });
  } finally { setLanguage(undefined); }
});

test('台本の t 呼び出しは他名前空間の鍵を使わない', () => {
  const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bt\('annotations\./u);
});

test('無効な要求は一度だけ知らせ、履歴を積まない', async () => {
  const events = [];
  await settleCaptionCommand({ ok: false, invalid: true, diagnostics: [], message: '範囲が不正' }, actions(events));
  assert.deepEqual(events, ['notice:範囲が不正']);
});

test('変化が無ければ履歴も読み直しも行わない', async () => {
  const events = [];
  await settleCaptionCommand({ ok: true, written: [], changed: [], notices: [], before: {}, after: {} }, actions(events));
  assert.deepEqual(events, []);
});

test('範囲への一回の書き込みを履歴一件にする', async () => {
  const events = [];
  await settleCaptionCommand({ ok: true, written: ['captions.json'], changed: ['captions[0].runs'],
    notices: [], before: {}, after: {} }, actions(events));
  assert.deepEqual(events, ['history', 'reload']);
});
