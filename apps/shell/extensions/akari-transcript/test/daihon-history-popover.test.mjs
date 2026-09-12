import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const l1 = await readFile(new URL('../evidence/daihon-history/scripts/l1-daihon-history.mjs', import.meta.url), 'utf8');

test('台本ヘッダに履歴ボタンと幅 360 の履歴ポップオーバーがある', () => {
  assert.match(source, /historyButton\.textContent = '🕘 履歴'/u);
  assert.match(source, /openPop\(anchor, 360\)/u);
  assert.match(source, /'↩ ここまで戻す'/u);
});

test('復元後は共有 undo スタックを clear して通知する', () => {
  assert.match(source, /restoreEditHistory\([\s\S]*this\.historyService\.clear\(\)/u);
  assert.match(source, /取り消し履歴はリセットされました/u);
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
