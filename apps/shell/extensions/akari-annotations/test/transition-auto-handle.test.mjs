import { t as annotationT, setLanguage as setAnnotationLanguage } from '@akari-video/i18n';
import * as annotationI18n from '@akari-video/i18n';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAllSourceText } from './helpers/widget-source.mjs';
import test from 'node:test';

setAnnotationLanguage('ja');
globalThis.t = annotationT;
globalThis.i18n_1 = annotationI18n;
test.beforeEach(() => { setAnnotationLanguage('ja'); globalThis.t = annotationT; globalThis.i18n_1 = annotationI18n; });
test.after(() => { setAnnotationLanguage(undefined); delete globalThis.t; delete globalThis.i18n_1; });
const ja = JSON.parse(readFileSync(new URL('../../../../../packages/i18n/locales/ja/annotations.json', import.meta.url), 'utf8'));

const source = readAllSourceText();

const method = (startNeedle, endNeedle) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return source.slice(start, end);
};

test('family 選択・コマンド・削除は同じ宣言専用経路を使う', () => {
  const picker = method('protected openTransitionPicker', 'protected async applyTransitionOut');
  assert.match(picker, /this\.applyTransitionOut\(ref, \{/u);
  assert.match(picker, /this\.applyTransitionOut\(ref, null\)/u);
  assert.match(picker, /isTransitionType\(type\)/u);
  assert.match(picker, /this\.transitionPicker\?\.update\(\)/u);
  assert.doesNotMatch(picker, /slider|autoHandle/u);
});

test('突き合わせ境界は共通計画から書く値を決め trim を書かない', () => {
  const apply = method('protected async applyTransitionOut', 'protected nextSameTrackSegment');
  assert.match(apply, /cutOverlapFrames\(earlier, later, this\.fps\) === 0/u);
  assert.match(apply, /waitForTransitionMaterial\(earlier\.index\)/u);
  assert.match(apply, /commitEditMutation\([\s\S]*transitionPlanInDocument\(doc, ref\)/u);
  assert.match(apply, /decideTransitionWrite\(\{ clips: fresh\.track\.clips/u);
  assert.match(apply, /writtenNext = decision\.patch/u);
  assert.equal((apply.match(/commitEditMutation\(/gu) ?? []).length, 1);
  assert.doesNotMatch(apply, /setV2TransitionOutWithHandleInSource|autoHandle|maxExtendSeconds/u);
});

test('旧自動のりしろの削除救済も保存列内で境目を確認する', () => {
  const apply = method('protected async applyTransitionOut', 'protected nextSameTrackSegment');
  assert.equal((apply.match(/commitEditTextMutation\(/gu) ?? []).length, 0);
  assert.match(apply, /resolveBoundaryInDocument\(doc, ref/u);
  assert.match(apply, /boundary\.overlapFrames > 0/u);
  assert.match(apply, /removeV2TransitionOutWithHandleRetractInSource/u);
  assert.match(apply, /t\('annotations\.timeline\.text\.iDeletedTheTransitionAndAlsoRestoredThe'\)/u);
  assert.equal(ja['annotations.timeline.text.iDeletedTheTransitionAndAlsoRestoredThe'], 'トランジションを削除しました（のりしろも戻しました）。');
  assert.match(apply, /t\('annotations\.timeline\.text\.iDeletedTheTransitionOverlappingClipsRemain'\)/u);
  assert.equal(ja['annotations.timeline.text.iDeletedTheTransitionOverlappingClipsRemain'], 'トランジションを削除しました。クリップの重なりが残っています。');
  assert.match(apply, /this\.showNotice\(message\)/u);
});

test('text commit は before/after 1 組を 1 history に積み、undo/redo が同じ組を往復する', () => {
  const commit = method('protected async commitEditTextMutation', 'protected async writeEditSnapshotGuarded');
  assert.equal((commit.match(/this\.pushHistory\(/gu) ?? []).length, 1);
  assert.match(commit, /undo: async \(\) => \{[\s\S]*writeEditSnapshotGuarded\(before\)/u);
  assert.match(commit, /redo: async \(\) => \{[\s\S]*writeEditSnapshotGuarded\(after\)/u);
  assert.doesNotMatch(commit, /stringifyEditV2/u);
});

test('クランプ・不能は日本語通知され、不能と layers 退避は警告バッジ導線を持つ', () => {
  assert.match(source, /t\('annotations\.timeline\.text\.transitionIsShortenedToSecondsNotEnoughMaterial'/u);
  assert.equal(ja['annotations.timeline.text.transitionIsShortenedToSecondsNotEnoughMaterial_other'], 'トランジションが {duration} 秒に短くなります（素材の余りが足りません）');
  assert.match(source, /t\('transition\.boundary\.dead\.noHandle'\)/u);
  assert.equal(JSON.parse(readFileSync(new URL('../../../../../packages/i18n/locales/ja/transition.json', import.meta.url), 'utf8'))
    ['transition.boundary.dead.noHandle'], '素材の余りがないので、このトランジションは効いていません。トリムで余りを作るか、なしにしてください。');
  assert.match(source, /zeroOverlapTransitionIndexes\.has\(cutIndex\)/u);
  assert.match(source, /dataset\.akariLayerTransitionWarning = layer\.id/u);
  assert.match(source, /t\('annotations\.timeline\.text\.sinceThisClipOverlapsWithAnItemOn'/u);
  assert.equal(ja['annotations.timeline.text.sinceThisClipOverlapsWithAnItemOn'], 'このクリップは他トラックのアイテム（{itemId}）と重なっているため PiP 経路へ退避され、宣言したトランジションは書き出されません。重なりを解消するか、トランジションを削除してください。');
});
