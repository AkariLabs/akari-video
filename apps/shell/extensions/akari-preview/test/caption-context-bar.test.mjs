import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { barItems } from '../lib/common/context-bar-view.js';
import { CAPTION_PRESETS, CAPTION_TOOL_KEYS, captionFontChoices, captionMoreItems } from '../lib/common/caption-context-bar.js';
import { previewContextBarPageScript } from '../lib/browser/preview-context-bar-page.js';

const require = createRequire(import.meta.url);
const { PreviewContextBar } = require('../lib/browser/preview-context-bar.js');

const state = { editUri: 'file:///edit.json', selectedId: 'cue-1', kind: 'caption',
    item: { textStyle: { color: '#ffffff' } }, sourcePath: null, parentId: null,
    locked: false, hasCorners: false, multi: 0, styleCopy: null,
    output: { width: 1920, height: 1080 }, lockedIds: [] };

test('字幕の上のメニューとその他の項目', () => {
    assert.deepEqual(barItems(state).map(({ key, label }) => [key, label]), [
        ['captionPreset', '字幕のスタイル'], ['captionCushion', '座布団'],
        ['captionTextColor', '文字の色'], ['captionStrokeColor', '縁取りの色'],
        ['captionBold', '太字'], ['captionFont', 'フォント'], ['captionSize', '大きさ'],
        ['captionSpacing', '行間・字間'], ['captionStroke', '縁取り'],
        ['captionSep', ''], ['captionMore', 'その他']
    ]);
    assert.equal(barItems(state).at(-2).kind, 'separator');
    assert.equal(barItems(state).at(-1).kind, 'window');
    assert.deepEqual(captionMoreItems(), [
        { key: 'captionMyStyleSave', label: 'マイスタイルに保存' },
        { key: 'captionInspector', label: 'インスペクターを開く' }
    ]);
    assert.equal(CAPTION_PRESETS.length, 6);
    assert.ok(CAPTION_PRESETS.some(item => item.key === 'subtitle-standard'));
    const fonts = captionFontChoices('Noto Serif JP');
    assert.equal(fonts.filter(name => name === 'Noto Serif JP').length, 1);
    assert.ok(fonts.includes('BIZ UDGothic'));
    assert.ok(fonts.includes('Dela Gothic One'));
    assert.deepEqual(barItems({ ...state, selectedId: null }), []);
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

test('その他の窓は字幕の 2 行に空のショートカット欄を出さない', () => {
    const view = { moreOpen: true, state, more: { hidden: true, innerHTML: '' }, mac: true, canPaste: false };
    PreviewContextBar.prototype.renderMore.call(view);
    assert.equal(view.more.hidden, false);
    assert.equal(view.more.innerHTML.includes('<kbd>'), false);
    assert.deepEqual([...view.more.innerHTML.matchAll(/data-akari-menu-item="([^"]+)"/gu)].map(match => match[1]),
        ['captionMyStyleSave', 'captionInspector']);
    view.state = { ...state, kind: 'shape' };
    PreviewContextBar.prototype.renderMore.call(view);
    assert.equal([...view.more.innerHTML.matchAll(/<kbd>/gu)].length, 5);
});

test('字幕選択の箱とライブ見た目の口が webview にある', () => {
    assert.match(previewContextBarPageScript, /getElementById\('caption-select-box'\)/u);
    assert.match(previewContextBarPageScript, /akari-preview-caption-style-live/u);
    assert.doesNotThrow(() => new Function(previewContextBarPageScript));
});
