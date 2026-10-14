import { t as annotationT, setLanguage as setAnnotationLanguage } from '@akari-video/i18n';
import * as annotationI18n from '@akari-video/i18n';
import { setLanguage } from '@akari-video/i18n';

import assert from 'node:assert/strict';
import { readAllSourceText } from './helpers/widget-source.mjs';
import { readFileSync } from 'node:fs';
import test from 'node:test';

setAnnotationLanguage('ja');
globalThis.t = annotationT;
globalThis.i18n_1 = annotationI18n;
test.beforeEach(() => { setAnnotationLanguage('ja'); globalThis.t = annotationT; globalThis.i18n_1 = annotationI18n; });
test.after(() => { setAnnotationLanguage(undefined); delete globalThis.t; delete globalThis.i18n_1; });

setLanguage('ja');
test.after(() => setLanguage(undefined));

const dialog = readFileSync(new URL('../src/browser/akari-audio-keyframe-dialog.ts', import.meta.url), 'utf8');
const widget = readAllSourceText();
const menu = readFileSync(new URL('../src/browser/akari-timeline-context-menu.ts', import.meta.url), 'utf8');
const ja = JSON.parse(readFileSync(new URL('../../../../../packages/i18n/locales/ja/annotations.json', import.meta.url), 'utf8'));

function section(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

test('専用画面は既存流儀どおり AbstractDialog を継承し適用・キャンセルを持つ', () => {
  assert.match(dialog, /extends AbstractDialog<AkariAudioKeyframeDialogValue>/u);
  assert.match(dialog, /this\.appendAcceptButton\(t\('annotations\.audioKeyframeDialog\.action\.apply'\)\)/u);
  assert.match(dialog, /this\.appendCloseButton\(t\('annotations\.audioKeyframeDialog\.text\.cancel'\)\)/u);
  assert.equal(ja['annotations.audioKeyframeDialog.action.apply'], '適用');
  assert.equal(ja['annotations.audioKeyframeDialog.text.cancel'], 'キャンセル');
});

test('波形背景は T9 の source 秒窓スライスと BGM ループタイルを再利用する', () => {
  const peaks = section(dialog, 'protected displayPeaks()', 'protected hitTestPoint(');
  assert.match(peaks, /audioLoopTilePeaks\(this\.props\.fullPeaks/u);
  assert.match(peaks, /audioSourceSliceWindow\(/u);
  assert.match(dialog, /const WAVEFORM_HEIGHT_PX = 140;/u);
});

test('dB グリッドは指定 5 本を描き 0 dB だけを強調する', () => {
  const grid = section(dialog, 'protected paintDbGrid()', 'protected paintEnvelope()');
  assert.match(dialog, /const DB_GRID_VALUES = \[6, 0, -6, -12, -24\] as const;/u);
  assert.match(grid, /db === 0 \? 'rgba\(255,255,255,\.68\)'/u);
  assert.match(grid, /db === 0 \? 1\.5 : 1/u);
});

test('空白 pointerdown は px 逆写像・フレームスナップ・衝突判定を通して点を追加する', () => {
  const pointer = section(dialog, 'protected wirePointerEvents()', 'protected redraw()');
  assert.match(pointer, /audioKeyframePxToTime\(/u);
  assert.match(pointer, /snapAudioKeyframeTime\(/u);
  assert.match(pointer, /validateAudioKeyframeTime\(this\.points, t\)/u);
  assert.match(pointer, /this\.points\.push\(/u);
});

test('点ドラッグは移動元を除外した同一 t 判定を行い衝突時は移動しない', () => {
  const pointer = section(dialog, 'protected wirePointerEvents()', 'protected redraw()');
  assert.match(pointer, /validateAudioKeyframeTime\(this\.points, t, this\.selectedIndex\)/u);
  assert.match(pointer, /this\.showNotice\(validation\.message\);\s*return;/u);
  assert.match(pointer, /selected\.t = t;/u);
});

test('点クリック選択は t 秒・gain_db・easing の入力欄へ同期する', () => {
  assert.match(dialog, /this\.configureNumberInput\(this\.timeInput, t\('annotations\.audioKeyframeDialog\.text\.tSeconds'\)/u);
  assert.equal(ja['annotations.audioKeyframeDialog.text.tSeconds'], 't 秒');
  assert.match(dialog, /this\.configureNumberInput\(this\.gainInput, 'gain_db'/u);
  assert.match(dialog, /const EASING_VALUES = \['linear', 'hold', 'ease-in-out'\]/u);
  assert.match(dialog, /this\.selectPoint\(hitIndex\)/u);
});

test('Delete キーと削除ボタンは同じ選択点削除経路へ配線される', () => {
  assert.match(dialog, /event\.key === 'Delete' \|\| event\.key === 'Backspace'/u);
  assert.match(dialog, /this\.deleteButton\.addEventListener\('click', \(\) => this\.deleteSelectedPoint\(\)\)/u);
  assert.match(dialog, /this\.points\.splice\(this\.selectedIndex, 1\)/u);
});

test('折れ線プレビューは hold の水平線と段差を描く', () => {
  const envelope = section(dialog, 'protected paintEnvelope()', 'protected displayPeaks()');
  assert.match(envelope, /if \(previous\.easing === 'hold'\)/u);
  assert.match(envelope, /this\.ctx\.lineTo\(x, audioKeyframeDbToPx\(this\.displayGainDb\(previous\)/u);
  assert.match(envelope, /this\.ctx\.lineTo\(x, y\)/u);
});

test('Esc はダイアログを閉じて変更を適用しない', () => {
  assert.match(dialog, /if \(event\.key === 'Escape'\)/u);
  assert.match(dialog, /this\.close\(\)/u);
});

test('適用値は t 昇順で、v2 だけ表示秒を整数フレームへ戻す', () => {
  const value = section(dialog, 'get value()', '\n    }\n}');
  assert.match(value, /sort\(\(left, right\) => left\.t - right\.t\)/u);
  assert.match(value, /this\.props\.keyframeFrames \? Math\.round\(point\.t \* this\.props\.fps\) : point\.t/u);
});

test('呼び出し側はダイアログ結果を既存 audio-keyframes write へ渡し 0 点を null にする', () => {
  const open = section(widget, 'protected async openAudioKeyframeEditor(', 'protected exitAudioTrimmerMode(');
  assert.match(open, /new AkariAudioKeyframeDialog\(/u);
  assert.match(open, /await dialog\.open\(\)/u);
  assert.match(open, /this\.handleInspectorWrite\(\{/u);
  assert.match(open, /kind: 'audio-keyframes'/u);
  assert.match(open, /value: dialogValue\.keyframes\.length > 0 \? dialogValue\.keyframes : null/u);
});

test('全体ゲイン欄はdB範囲と0.5刻みを持ち未設定を0表示する', () => {
  assert.match(dialog, /configureNumberInput\(this\.overallGainInput, t\('annotations\.audioKeyframeDialog\.text\.overallGain'\), '0\.5'\)/u);
  assert.equal(ja['annotations.audioKeyframeDialog.text.overallGain'], '全体ゲイン');
  assert.match(dialog, /this\.overallGainInput\.min = String\(AUDIO_KEYFRAME_MIN_DB\)/u);
  assert.match(dialog, /this\.overallGainInput\.max = String\(AUDIO_KEYFRAME_MAX_DB\)/u);
  assert.match(dialog, /this\.overallGainDb = normalizeAudioKeyframeGainDb\(props\.gainDb\)/u);
  assert.match(dialog, /this\.labeledControl\(t\('annotations\.audioKeyframeDialog\.text\.overallGainDb'\), this\.overallGainInput\)/u);
  assert.equal(ja['annotations.audioKeyframeDialog.text.overallGainDb'], '全体ゲイン (dB)');
});

test('全体ゲイン入力はinputイベントごとに波形を即時再描画する', () => {
  assert.match(dialog, /overallGainInput\.addEventListener\('input', \(\) => this\.commitOverallGainInput\(\)\)/u);
  const commit = section(dialog, 'protected commitOverallGainInput()', 'protected commitTimeInput()');
  assert.match(commit, /this\.overallGainDb = normalizeAudioKeyframeGainDb\(value\)/u);
  assert.match(commit, /this\.redraw\(\)/u);
  assert.match(dialog, /audioLoudnessBucketColors\(peaks, \{\s*gainDb: this\.overallGainDb/u);
});

test('全体ゲイン変更はエンベロープ曲線と点位置にも即時反映する', () => {
  const envelope = section(dialog, 'protected paintEnvelope()', 'protected displayPeaks()');
  assert.match(envelope, /audioKeyframeDbToPx\(this\.displayGainDb\(first\)/u);
  assert.match(envelope, /audioKeyframeDbToPx\(this\.displayGainDb\(current\)/u);
  assert.match(dialog, /return point\.gainDb \+ this\.overallGainDb;/u);
});

test('ダイアログの適用値は keyframes・gainDb・フェード形を返す', () => {
  const value = section(dialog, 'get value()', '\n    }\n}');
  assert.match(value, /const keyframes = \[\.\.\.this\.points\]/u);
  assert.match(value, /keyframes, gainDb: this\.overallGainDb/u);
  assert.match(value, /fadeInShape: this\.fadeInShapeInput\.value/u);
  assert.match(value, /fadeOutShape: this\.fadeOutShapeInput\.value/u);
});

test('widgetはkeyframes成功後に変更された全体ゲインだけを書き込む', () => {
  const open = section(widget, 'protected async openAudioKeyframeEditor(', 'protected exitAudioTrimmerMode(');
  const keyframeWrite = open.indexOf("kind: 'audio-keyframes'");
  const gainWrite = open.indexOf("kind: 'bgm-gain'");
  assert.ok(keyframeWrite >= 0 && gainWrite > keyframeWrite);
  assert.match(open, /if \(dialogValue\.gainDb === \(audio\.gainDb \?\? 0\)\) return;/u);
  assert.match(open, /kind: 'bgm-gain', value: dialogValue\.gainDb/u);
  assert.match(open, /kind: 'narration-gain', id, value: dialogValue\.gainDb/u);
  assert.match(open, /kind: 'sfx-gain', id, value: dialogValue\.gainDb/u);
  assert.doesNotMatch(open, /value: dialogValue\.gainDb \|\| null/u);
});

test('widgetはkeyframesと全体ゲインの失敗を別々の通知で示す', () => {
  const open = section(widget, 'protected async openAudioKeyframeEditor(', 'protected exitAudioTrimmerMode(');
  assert.match(open, /t\('annotations\.timeline\.text\.failedToWriteVolumeKeyframe'/u);
  assert.equal(ja['annotations.timeline.text.failedToWriteVolumeKeyframe'], '音量キーフレームの書き込みに失敗しました: {reason}');
  assert.match(open, /t\('annotations\.timeline\.text\.failedToWriteOverallGain'/u);
  assert.equal(ja['annotations.timeline.text.failedToWriteOverallGain'], '全体ゲインの書き込みに失敗しました: {reason}');
  assert.match(open, /if \(!keyframeResult\.ok\) \{[\s\S]*return;/u);
});

test('SFX の pointerup ダブルクリックはトリマーではなく専用エディタを開く', () => {
  const pointerup = section(widget, "if (state.kind === 'audio'", 'const selected = this.selectionFromDragState(state);');
  assert.match(pointerup, /this\.openAudioKeyframeEditor\(state\.id\)/u);
  assert.doesNotMatch(pointerup, /this\.toggleAudioTrimmerMode\(state\.id\)/u);
});

test('BGM と narration のダブルクリックも専用エディタを開く', () => {
  assert.match(widget, /addEventListener\('dblclick'[\s\S]*this\.openAudioKeyframeEditor\(bgm\.id\)/u);
  assert.match(widget, /addEventListener\('dblclick'[\s\S]*this\.openAudioKeyframeEditor\(narration\.id\)/u);
});

test('SFX のコンテキストメニューは削除前にトリム（in\/out）を合成する', () => {
  assert.match(menu, /export function withAudioTrimMenuItem\(/u);
  assert.match(menu, /\{ id: 'audio-trim', label: t\('annotations\.timelineContextMenu\.text\.trimInOut'\) \}/u);
  assert.equal(ja['annotations.timelineContextMenu.text.trimInOut'], 'トリム（in/out）');
  assert.match(menu, /items\.findIndex\(item => item\.id === 'delete'\)/u);
  assert.match(widget, /withAudioTrimMenuItem\(/u);
});

test('トリムメニューの選択だけが既存 toggleAudioTrimmerMode へディスパッチされる', () => {
  const dispatch = section(widget, 'protected dispatchTimelineClipMenuAction(', "if (id === 'copy')");
  assert.match(dispatch, /if \(id === 'audio-trim'\)/u);
  assert.match(dispatch, /this\.toggleAudioTrimmerMode\(item\.id\)/u);
});
