import { createRequire as createI18nRequire } from 'node:module';
globalThis.t = createI18nRequire(import.meta.url)('../lib/browser/transcript-text.js').t;
globalThis.assessCutOutcome = createI18nRequire(import.meta.url)('../lib/common/daihon-cut-outcome.js').assessCutOutcome;
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
process.on('exit', () => setLanguage(undefined));
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readAllSourceText } from './helpers/daihon-source.mjs';

const source = readAllSourceText();
const l1 = await readFile(new URL('../evidence/daihon-history/scripts/l1-daihon-history.mjs', import.meta.url), 'utf8');

test('その他メニューから幅 360 の履歴ポップオーバーを開く', () => {
  assert.match(source, /this\.popButton\(t\('transcript\.daihon\.editor\.editHistoryAction'\)/u);
  assert.equal(globalThis.t('transcript.daihon.editor.editHistoryAction'), '🕘 編集履歴');
  assert.match(source, /openPop\(anchor, 360\)/u);
  assert.match(source, /t\('transcript\.daihon\.editor\.restoreRestoreHereAction'\)/u);
  assert.equal(globalThis.t('transcript.daihon.editor.restoreRestoreHereAction'), '↩ ここまで戻す');
});

test('復元後は共有 undo スタックを clear して通知する', () => {
  assert.match(source, /restoreEditHistory\([\s\S]*this\.historyService\.clear\(\)/u);
  assert.match(source, /t\('transcript\.daihon\.editor\.restoredUndoHistoryResetWithValueNotice'/u);
  assert.match(globalThis.t('transcript.daihon.editor.restoredUndoHistoryResetWithValueNotice', { value1: 'A' }), /取り消し履歴はリセットされました/u);
});

test('push フックは snapshot RPC の失敗を警告だけにする', () => {
  assert.match(source, /onDidPush\([\s\S]*snapshotEditHistory\([\s\S]*\.catch\(error => \{[\s\S]*console\.warn/u);
});

test('L1 は隔離起動・4 手順・SS 3 枚・自 PID cleanup を宣言する', () => {
  assert.match(l1, /AKARI_HOME:/u);
  assert.match(l1, /--user-data-dir=/u);
  assert.match(l1, /detached: false/u);
  assert.equal([...l1.matchAll(/await step\('/gu)].length, 4);
  assert.deepEqual([...l1.matchAll(/'0[123]-[^']+\.png'/gu)].map(match => match[0]).filter((value, index, all) => all.indexOf(value) === index).length, 3);
  assert.match(l1, /electron\.kill\('SIGTERM'\)/u);
  assert.match(l1, /<WORKTREE>/u);
  assert.match(l1, /<HOME>/u);
  assert.match(l1, /<TMP>/u);
});
