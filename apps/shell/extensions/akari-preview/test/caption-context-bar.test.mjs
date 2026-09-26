import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { barItems } from '../lib/common/context-bar-view.js';
import { CAPTION_BAR_ORDER, CAPTION_TOOL_KEYS, captionEscapeClosesPopup, captionOverflowKeys,
    captionOverflowPressed, captionValueChanged, nextCaptionAlign, nextCaptionWindow } from '../lib/common/caption-context-bar.js';
import { previewContextBarPageScript } from '../lib/browser/preview-context-bar-page.js';

const require = createRequire(import.meta.url);
const { PreviewContextBar } = require('../lib/browser/preview-context-bar.js');

const state = { editUri: 'file:///edit.json', selectedId: 'cue-1', kind: 'caption',
    item: { textStyle: { color: '#ffffff' } }, sourcePath: null, parentId: null,
    locked: false, hasCorners: false, multi: 0, styleCopy: null,
    output: { width: 1920, height: 1080 }, lockedIds: [] };

test('字幕の上のメニューは試作 v2 の順で 1 段の項目を持つ', () => {
    assert.deepEqual(barItems(state).map(item => item.key), [...CAPTION_BAR_ORDER]);
    assert.equal(barItems(state).at(0).label, 'フォント');
    assert.equal(barItems(state).at(-1).label, 'スタイル');
    assert.deepEqual(barItems({ ...state, selectedId: null }), []);
});

test('狭い幅では右から畳みフォント・サイズ・スタイルを残す', () => {
    const widths = Object.fromEntries(CAPTION_BAR_ORDER.map(key => [key,
        key === 'captionFont' ? 94 : key === 'captionSize' ? 78
            : key === 'captionEffect' ? 60 : key === 'captionAnimation' ? 80
                : key === 'captionStyle' ? 50 : 30]));
    const hidden = captionOverflowKeys(widths, 330 - 28);
    assert.ok(hidden.length > 0);
    assert.ok(hidden.every(key => !['captionFont', 'captionSize', 'captionStyle'].includes(key)));
    assert.equal(hidden.at(-1), 'captionAnimation');
    assert.deepEqual(captionOverflowKeys(widths, 720 - 28), []);
    const css = readFileSync(new URL('../src/browser/preview-context-bar.ts', import.meta.url), 'utf8');
    assert.match(css, /\.akari-ctx-caption-item \{[^}]*width: 28px;[^}]*height: 28px/u);
    assert.match(css, /\.akari-ctx-caption-item\[data-font-button\] \{ width: 92px/u);
    assert.match(css, /const resize = new ResizeObserver\(\(\) => \{ this\.barSignature = ''; this\.render\(\); \}\)/u);
});

test('畳んだ押下項目は一覧と「…」の点で示す', () => {
    assert.equal(captionOverflowPressed(['captionItalic'], { italic: true }, null), true);
    assert.equal(captionOverflowPressed(['captionItalic'], { italic: false }, null), false);
    assert.equal(captionOverflowPressed(['captionStyle'], {}, 'style'), true);
    assert.equal(captionOverflowPressed(['captionAlign'], { align: 'right' }, null), true);
    assert.equal(captionOverflowPressed(['captionCase'], { textTransform: 'upper' }, null), true);
    assert.equal(captionOverflowPressed(['captionOpacity'], { opacity: 0.5 }, null), true);
    const view = { state: { item: { textStyle: { italic: true } } }, captionPanel: null, openWindow: null };
    const html = PreviewContextBar.prototype.captionButton.call(view, 'captionItalic');
    assert.match(html, /is-open[^>]*aria-pressed="true"/u);
    const css = readFileSync(new URL('../src/browser/preview-context-bar.ts', import.meta.url), 'utf8');
    assert.match(css, /\.akari-ctx-overflow\[aria-pressed="true"\]::after/u);
});

test('Esc は字幕の窓・「…」だけを閉じ、窓なしは選択解除へ渡す', () => {
    assert.equal(captionEscapeClosesPopup('caption', 'captionSpacing', false), true);
    assert.equal(captionEscapeClosesPopup('caption', null, true), true);
    assert.equal(captionEscapeClosesPopup('caption', null, false), false);
    assert.equal(captionEscapeClosesPopup('shape', null, true), true);
    assert.equal(captionValueChanged(48, undefined, 48), false);
    assert.equal(captionValueChanged(48, 72, 72), false);
    const host = readFileSync(new URL('../src/browser/preview-context-bar.ts', import.meta.url), 'utf8');
    assert.match(host, /button\.focus\(\{ preventScroll: true \}\)/u);
    assert.match(host, /event\.stopImmediatePropagation\(\)/u);
    assert.match(previewContextBarPageScript, /event\.stopImmediatePropagation\(\);[\s\S]*?reportContextBox\(\{ escape: true \}\)/u);
});

test('配置の巡回とミニポップアップの切り替え・閉じる規則', () => {
    assert.deepEqual([nextCaptionAlign(undefined), nextCaptionAlign('center'), nextCaptionAlign('right')],
        ['center', 'right', 'left']);
    assert.equal(nextCaptionWindow(null, 'captionTextColor'), 'captionTextColor');
    assert.equal(nextCaptionWindow('captionTextColor', 'captionSpacing'), 'captionSpacing');
    assert.equal(nextCaptionWindow('captionSpacing', 'captionSpacing'), null);
    assert.equal(nextCaptionWindow('captionOpacity', 'captionBold'), null);
});

test('下の通常表示は 4 操作だけで、範囲選択用は残る', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    const section = source.slice(source.indexOf('<div id="caption-select-box">'), source.indexOf('</div><div data-akari-run-menu'));
    const buttons = [...section.matchAll(/<button[^>]*data-caption-tool="([^"]+)"[^>]*>/gu)]
        .map(match => ({ key: match[1], html: match[0] }));
    assert.deepEqual(buttons.filter(button => !button.html.includes(' hidden') && !button.html.includes('data-akari-run-tool'))
        .map(button => button.key), CAPTION_TOOL_KEYS.slice(0, 3));
    assert.ok(buttons.find(button => button.key === 'reset')?.html.includes(' hidden'));
    assert.equal(buttons.filter(button => button.html.includes('data-akari-run-tool')).length, 8);
    assert.match(source, /\[data-caption-tool\]\[hidden\] \{ display: none; \}/u);
    assert.equal(section.match(/data-caption-optional-separator/gu)?.length, 1);
    assert.match(source, /\[data-caption-optional-separator\]:has\(~ \[data-akari-run-tool\]:not\(\[hidden\]\), ~ \[data-caption-tool="reset"\]:not\(\[hidden\]\)\) \{ display: block; \}/u);
});

test('畳んだ字幕項目はその他の窓で押せる', () => {
    const view = { moreOpen: true, state, more: { hidden: true, innerHTML: '' }, mac: true, canPaste: false,
        captionOverflow: ['captionUnderline', 'captionStyle'], captionPanel: null, openWindow: null,
        captionButton: PreviewContextBar.prototype.captionButton };
    PreviewContextBar.prototype.renderMore.call(view);
    assert.equal(view.more.hidden, false);
    assert.deepEqual([...view.more.innerHTML.matchAll(/data-akari-bar-item="([^"]+)"/gu)].map(match => match[1]),
        ['captionUnderline', 'captionStyle']);
    view.state = { ...state, kind: 'shape' };
    PreviewContextBar.prototype.renderMore.call(view);
    assert.equal([...view.more.innerHTML.matchAll(/<kbd>/gu)].length, 5);
});

test('字幕選択の箱とライブ見た目の口が webview にある', () => {
    assert.match(previewContextBarPageScript, /getElementById\('caption-select-box'\)/u);
    assert.match(previewContextBarPageScript, /akari-preview-caption-style-live/u);
    assert.doesNotThrow(() => new Function(previewContextBarPageScript));
});
