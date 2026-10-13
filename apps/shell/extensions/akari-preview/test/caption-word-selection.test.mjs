import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captionWordSelectionBoxes } from '../lib/common/caption-word-selection-geometry.js';
import { selectedCaptionRangesMessage } from '../lib/common/caption-word-selection-message.js';
import { previewBootstrapScript } from '../lib/browser/preview-script-bootstrap.js';

const rect = (left, top, width, height = 12) => ({ left, right: left + width,
  top, bottom: top + height, width, height });

test('同じ見た目の行の文字矩形は一箱にまとまる', () => {
  assert.deepEqual(captionWordSelectionBoxes([rect(10, 20, 8), rect(18, 20, 9)]),
    [rect(10, 20, 17)]);
});

test('別の run の span を間に挟んでも同じ行は一箱にまとまる', () => {
  assert.deepEqual(captionWordSelectionBoxes([rect(10, 20, 8), rect(27, 20, 7)]),
    [rect(10, 20, 24)]);
});

test('選んだ文字が二行にまたがると二箱になる', () => {
  assert.deepEqual(captionWordSelectionBoxes([rect(10, 20, 8), rect(10, 40, 6)]),
    [rect(10, 20, 8), rect(10, 40, 6)]);
});

test('幅ゼロの文字矩形は枠に含めない', () => {
  assert.deepEqual(captionWordSelectionBoxes([rect(10, 20, 8), rect(18, 20, 0)]),
    [rect(10, 20, 8)]);
});

test('host は同じ editUri の語選択だけを webview メッセージに直す', () => {
  const detail = { editUri: 'file:///a/edit.json', ranges: [{ captionId: 'c-1', from: 1, to: 3 }] };
  assert.deepEqual(selectedCaptionRangesMessage(detail, detail.editUri),
    { type: 'akari-preview-set-selected-caption-ranges', ranges: detail.ranges });
  assert.equal(selectedCaptionRangesMessage(detail, 'file:///b/edit.json'), undefined);
  const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
  assert.match(source, /daihonWordSelections\.set\(key, message\.ranges\)/u);
  assert.match(source, /this\.daihonWordSelections\.has\(key\)/u);
});

test('webview は空の選択を受けると枠の要素を消す', () => {
  const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
  assert.match(source, /message\?\.type !== 'akari-preview-set-selected-caption-ranges'/u);
  assert.match(source, /selectedCaptionWordRanges = ranges/u);
  assert.match(source, /captionWordSelectionLayer\.replaceChildren\(\)/u);
  assert.match(source, /captionWordSelectionLayer\.hidden = !selectedCaptionWordRanges\.length/u);
  assert.match(source, /wordBoxObserver\.disconnect\(\)/u);
  assert.match(source, /wordBoxObserver\.observe\(captionLayer/u);
  assert.match(source, /wordBoxObserver\.observe\(previewStage/u);
  assert.match(source, /wordBoxResize\.observe\(previewChrome\)/u);
  assert.match(source, /wordBoxFrame = requestAnimationFrame\(drawSelectedCaptionWordBoxes\)/u);
  assert.match(source, /!video\.paused \? 100 - \(Date\.now\(\) - lastWordBoxDraw\)/u);
  assert.match(source, /window\.addEventListener\('akari-frame-engine-seek', queueSelectedCaptionWordBoxes\)/u);
  assert.match(source, /row\.plate\.querySelector\('\[contenteditable="true"\]'\)/u);
  assert.match(source, /if \(caption\.manualFragment\) continue/u);
});

test('表示方針の自動断片は順序と書記素数で選択範囲との共通部分だけを囲む', () => {
  const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
  const projection = readFileSync(new URL('../src/browser/akari-preview-captions.ts', import.meta.url), 'utf8');
  assert.match(projection, /fragmentIndex: cue\.fragment_index/u);
  assert.match(projection, /fragmentCount: cue\.fragment_count/u);
  assert.match(source, /parts\.slice\(0, caption\.fragmentIndex - 1\)/u);
  assert.match(source, /const from = Math\.max\(0, selected\.from - offset\)/u);
  assert.match(source, /const to = Math\.min\(count, selected\.to - offset\)/u);
});

test('選んだ文字の枠を含む webview 注入スクリプトは構文として有効', () => {
  assert.doesNotThrow(() => new Function(previewBootstrapScript()));
});
