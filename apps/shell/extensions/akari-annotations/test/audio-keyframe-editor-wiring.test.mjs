import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dialog = readFileSync(new URL('../src/browser/akari-audio-keyframe-dialog.ts', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../src/browser/akari-timeline-context-menu.ts', import.meta.url), 'utf8');

function section(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

test('専用画面は既存流儀どおり AbstractDialog を継承し適用・キャンセルを持つ', () => {
  assert.match(dialog, /extends AbstractDialog<AudioEnvelopeKeyframePayload\[\]>/u);
  assert.match(dialog, /this\.appendAcceptButton\('適用'\)/u);
  assert.match(dialog, /this\.appendCloseButton\('キャンセル'\)/u);
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
  assert.match(dialog, /this\.configureNumberInput\(this\.timeInput, 't 秒'/u);
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
  assert.match(envelope, /this\.ctx\.lineTo\(x, audioKeyframeDbToPx\(previous\.gainDb/u);
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
  assert.match(open, /value: keyframes\.length > 0 \? keyframes : null/u);
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
  assert.match(menu, /\{ id: 'audio-trim', label: 'トリム（in\/out）' \}/u);
  assert.match(menu, /items\.findIndex\(item => item\.id === 'delete'\)/u);
  assert.match(widget, /withAudioTrimMenuItem\(/u);
});

test('トリムメニューの選択だけが既存 toggleAudioTrimmerMode へディスパッチされる', () => {
  const dispatch = section(widget, 'protected dispatchTimelineClipMenuAction(', "if (id === 'copy')");
  assert.match(dispatch, /if \(id === 'audio-trim'\)/u);
  assert.match(dispatch, /this\.toggleAudioTrimmerMode\(item\.id\)/u);
});
