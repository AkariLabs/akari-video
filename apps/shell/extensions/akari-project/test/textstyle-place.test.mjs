import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { presetShowcaseBottomPadding, textStylePlaceOptions } from '../lib/common/preset-showcase.js';

const widget = readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../src/common/library-home-view.ts', import.meta.url), 'utf8');

test('テキストスタイルだけが placeText の stylePreset 引数になる', () => {
  assert.deepEqual(textStylePlaceOptions({ kind: 'textstyle', id: 'telop-title' }), { stylePreset: 'telop-title' });
  assert.equal(textStylePlaceOptions({ kind: 'textanim', id: 'fade' }), undefined);
  assert.equal(textStylePlaceOptions({ kind: 'lut', id: 'warm' }), undefined);
  assert.equal(textStylePlaceOptions({ kind: 'textstyle', id: ' ' }), undefined);
});

test('マイスタイルの＋は見た目込みの placeText を一度だけ呼ぶ', () => {
  const start = widget.indexOf('protected async addMyStyleAtPlayhead(');
  const end = widget.indexOf('\n    protected ', start + 1);
  const body = widget.slice(start, end);
  assert.match(body, /executeCommand\('akari\.caption\.placeText', \{ myStyle: style \}\)/);
  assert.doesNotMatch(body, /akari\.mystyle\.apply/);
});

test('grid と list のテキストスタイルカードがドラッグと ＋ を持つ', () => {
  for (const method of ['renderPresetShowcaseListRow', 'renderPresetShowcaseCard']) {
    const start = widget.indexOf(`protected ${method}(`);
    const end = widget.indexOf('\n    protected ', start + 1);
    const body = widget.slice(start, end);
    assert.match(body, /data-akari-catalog-item=/);
    assert.match(body, /draggable=\{item\.kind === 'textstyle' \? true : undefined\}/);
    assert.match(body, /handleTextStyleDragStart/);
    assert.match(body, /renderTextStyleAddButton\(item\)/);
    assert.match(body, /draggable=\{item\.kind === 'textstyle' \? false : undefined\}/);
  }
  assert.match(widget, /data-akari-catalog-action='add'/);
  assert.match(widget, /executeCommand\('akari\.caption\.placeText', options\)/);
});

test('テキストスタイルの hint はタイムラインへの配置を案内する', () => {
  assert.match(home, /hint: 'タイムラインへドラッグ、＋でプレイヘッド位置に置く'/);
  assert.doesNotMatch(home, /プレビューへドラッグ/);
});

test('FAB を避ける下余白は textstyle の grid/list 共通の一覧だけに付く', () => {
  assert.equal(presetShowcaseBottomPadding('textstyle'), 110);
  assert.equal(presetShowcaseBottomPadding('textanim'), undefined);
  assert.equal(presetShowcaseBottomPadding('lut'), undefined);
  const showcase = widget.slice(widget.indexOf('protected renderPresetShowcase('), widget.indexOf('protected renderPresetShowcaseItem('));
  assert.match(showcase, /presetShowcaseBottomPadding\(kind\)/);
  assert.match(showcase, /style\.paddingBottom = `\$\{bottomPadding\}px`/);
});
