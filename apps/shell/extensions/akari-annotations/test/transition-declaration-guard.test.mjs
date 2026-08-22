import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');

test('宣言前ガードは edit.json 書き込みより先に return する', () => {
  const start = source.indexOf('protected async applyTransitionOut');
  const end = source.indexOf('protected unsupportedTransitionTrack', start);
  const method = source.slice(start, end);
  const guard = method.indexOf('if (next && this.unsupportedTransitionTrack(cutIndex) !== undefined)');
  const noWriteReturn = method.indexOf('return;', guard);
  const write = method.indexOf("commitEditMutation('トランジションを変更'");
  assert.ok(guard >= 0 && noWriteReturn > guard && write > noWriteReturn, method);
});

test('既存の非対応宣言はクリップ警告のワンクリックで null 手術へ進む', () => {
  assert.match(source, /dataset\.akariUnsupportedTransition = String\(segment\.index\)/);
  assert.match(source, /warning\.addEventListener\('click',[\s\S]*applyTransitionOut\(segment\.index, null\)/);
});

test('ポップオーバーは非対応理由を日本語で表示し付与ボタンを無効化する', () => {
  const start = source.indexOf('protected openTransitionPopup');
  const end = source.indexOf('protected async applyTransitionOut', start);
  const method = source.slice(start, end);
  assert.match(method, /dataset\.akariTransitionGuard/);
  assert.match(method, /warning\.textContent = this\.unsupportedTransitionMessage/);
  assert.match(method, /button\.disabled = unsupportedTrack !== undefined/);
});
