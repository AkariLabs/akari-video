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
  const guard = method.indexOf('if (next && (this.unsupportedTransitionTrack(cutIndex) !== undefined');
  const adjacency = method.indexOf('this.nonAdjacentTransitionTarget(cutIndex) !== undefined', guard);
  const noWriteReturn = method.indexOf('return;', guard);
  const write = method.indexOf("commitEditMutation('トランジションを変更'");
  assert.ok(guard >= 0 && adjacency > guard && noWriteReturn > adjacency && write > noWriteReturn, method);
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
  assert.match(method, /button\.disabled = unsupportedTrack !== undefined \|\| unsupportedAdjacency !== undefined/);
});

test('非隣接の宣言済み transition_out はクリップ警告へ統合され固定文言を返す', () => {
  const start = source.indexOf('protected unsupportedDeclaredTransitionIndexes');
  const end = source.indexOf('protected renderTrackHeaders', start);
  const methods = source.slice(start, end);
  assert.match(methods, /nonAdjacentDeclaredTransitionIndexes\(\)/);
  assert.match(methods, /segment\.transitionOut[\s\S]*nonAdjacentTransitionTarget\(segment\.index\)/);
  assert.match(source, /このトランジションは次のクリップとの間にすき間があるため書き出されません。/);
  assert.match(source, /すき間を詰めるか、トランジションを削除してください。/);
});

test('非隣接判定は同一トラックの後続 cut がある場合だけ共有カーネルへ委ねる', () => {
  const start = source.indexOf('protected nonAdjacentTransitionTarget');
  const end = source.indexOf('protected nonAdjacentDeclaredTransitionIndexes', start);
  const method = source.slice(start, end);
  assert.match(method, /for \(let laterPosition = position \+ 1; laterPosition < this\.segments\.length; laterPosition\+\+\)/);
  assert.match(method, /if \(candidate\.track === earlier\.track\)[\s\S]*later = candidate;[\s\S]*break;/);
  assert.match(method, /if \(!later \|\| areCutsAdjacent\(earlier, later, this\.fps\)\)/);
  assert.match(method, /return later\.index/);
});

test('描画は非対応 transition の Set を一度だけ計算してクリップと境界で共有する', () => {
  const start = source.indexOf('protected renderStrip(): void');
  const end = source.indexOf('protected laneBand', start);
  const method = source.slice(start, end);
  assert.equal((method.match(/unsupportedDeclaredTransitionIndexes\(\)/g) ?? []).length, 1);
  assert.match(method, /const unsupportedDeclaredTransitions = this\.unsupportedDeclaredTransitionIndexes\(\)/);
  assert.match(method, /unsupportedDeclaredTransitions\.has\(segment\.index\)/);
  assert.match(method, /this\.renderTransitionBoundaries\(unsupportedDeclaredTransitions\)/);
});
