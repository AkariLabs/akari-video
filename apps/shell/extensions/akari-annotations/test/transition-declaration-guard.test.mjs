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

test('宣言前ガードは edit.json 書き込みより先に return する', () => {
  const start = source.indexOf('protected async applyTransitionOut');
  const end = source.indexOf('protected unsupportedTransitionTrack', start);
  const method = source.slice(start, end);
  const guard = method.indexOf('validateTransitionBoundaryWrite(ref, this.transitionBoundaryInputs()');
  const adjacency = method.indexOf('if (!validation.pairExists || transitionWriteIsBlocked(next, validation.blocks))', guard);
  const noWriteReturn = method.indexOf('return { ok: false, message };', guard);
  const write = method.indexOf("commitEditMutation(t('annotations.timeline.text.changeTransition')");
  const queuedGuard = method.indexOf('resolveBoundaryInDocument(doc, ref', write);
  assert.equal(ja['annotations.timeline.text.changeTransition'], 'トランジションを変更');
  assert.ok(guard >= 0 && adjacency > guard && noWriteReturn > adjacency && write > noWriteReturn, method);
  assert.ok(queuedGuard > write, method);
});

test('既存の非対応宣言はクリップ警告のワンクリックで null 手術へ進む', () => {
  assert.match(source, /dataset\.akariUnsupportedTransition = String\(segment\.index\)/);
  assert.match(source, /warning\.addEventListener\('click',[\s\S]*applyTransitionOut\(segment\.index, null\)/);
});

test('効かない宣言は理由画面を開き、書き込みガードを共有する', () => {
  const start = source.indexOf('protected openTransitionPicker');
  const end = source.indexOf('protected async applyTransitionOut', start);
  const method = source.slice(start, end);
  assert.match(method, /blockedReason,/u);
  assert.match(method, /this\.applyTransitionOut\(ref, null\)/u);
  assert.match(source, /transitionDeclarationIsDead\(!!declared, boundary\.blocks,/u);
  assert.match(source, /transitionWriteIsBlocked\(next, validation\.blocks\)/u);
});

test('非隣接の宣言済み transition_out はクリップ警告へ統合され固定文言を返す', () => {
  const start = source.indexOf('protected unsupportedDeclaredTransitionIndexes');
  const end = source.indexOf('protected renderTrackHeaders', start);
  const methods = source.slice(start, end);
  assert.match(methods, /this\.declaredTransitionAdjacencyWarnings/);
  assert.match(methods, /this\.zeroOverlapTransitionIndexes\.has\(cutIndex\)/);
  assert.match(source, /t\('annotations\.timeline\.text\.thisTransitionWillNotBeExportedBecauseThere'\)/);
  assert.match(source, /t\('annotations\.timeline\.text\.pleaseCloseTheGapOrRemoveTheTransition'\)/);
  assert.equal(ja['annotations.timeline.text.thisTransitionWillNotBeExportedBecauseThere'], 'このトランジションは次のクリップとの間にすき間があるため書き出されません。');
  assert.equal(ja['annotations.timeline.text.pleaseCloseTheGapOrRemoveTheTransition'], 'すき間を詰めるか、トランジションを削除してください。');
});

test('非隣接判定は同一トラックの後続 cut がある場合だけ共有カーネルへ委ねる', () => {
  const start = source.indexOf('protected nonAdjacentTransitionTarget');
  const end = source.indexOf('protected unsupportedTransitionMessage', start);
  const method = source.slice(start, end);
  assert.match(method, /this\.nonAdjacentTransitionTargetByCutIndex\.get\(cutIndex\)/);
  const helperStart = source.indexOf('protected nextSameTrackSegment');
  const helperEnd = source.indexOf('protected isStillImageCut', helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /this\.nextSameTrackSegmentByCutIndex\.get\(cutIndex\)/);
});

test('後続 cut・非隣接・zero-overlap は rebuildSegments の後方 1 パスだけでメモ化する', () => {
  const start = source.indexOf('protected rebuildSegments');
  const end = source.indexOf('protected async reloadAnalysis', start);
  const method = source.slice(start, end);
  assert.equal((method.match(/for \(let position = this\.segments\.length - 1/gu) ?? []).length, 1);
  assert.match(method, /const nextByTrack = new Map<number, OutputSegment>\(\)/u);
  assert.match(method, /unsupportedTrackTransitionByCutIndex\.set\(cutIndex, trackRef\)/u);
  assert.match(method, /nextSameTrackSegmentByCutIndex\.set\(earlier\.index, later\)/u);
  assert.match(method, /nonAdjacentTransitionTargetByCutIndex\.set\(earlier\.index, later\.index\)/u);
  assert.match(method, /transitionHandlePlanSync\(earlier, later\)\.effectiveSeconds <= 0/u);
  assert.match(method, /zeroOverlapTransitionIndexes\.add\(earlier\.index\)/u);
  const messages = source.slice(
    source.indexOf('protected unsupportedDeclaredTransitionIndexes'),
    source.indexOf('protected renderTrackHeaders'),
  );
  assert.doesNotMatch(messages, /\.filter\(|\.find\(|\.slice\(/u);
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
