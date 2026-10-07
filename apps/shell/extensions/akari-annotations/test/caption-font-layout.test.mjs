import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CAPTION_PANEL_CSS, createCaptionPanel } from '../lib/browser/inspector/caption-panels.js';

const source = readFileSync(new URL('../src/browser/inspector/caption-panels.ts', import.meta.url), 'utf8');

test('フォント行は棚と同じ高さ・余白で一行表示し、太さの左端を揃える', () => {
    assert.match(CAPTION_PANEL_CSS, /\.akari-caption-font-name \{[^}]*white-space:nowrap;[^}]*text-overflow:ellipsis/u);
    assert.match(CAPTION_PANEL_CSS, /\.akari-caption-font-row \{[^}]*min-height:54px/u);
    assert.match(CAPTION_PANEL_CSS, /\.akari-caption-font-row:hover,\.akari-caption-font-row:focus-within \{ background:var\(--akari-elevated\)/u);
    assert.match(CAPTION_PANEL_CSS, /\.akari-caption-font-row button \{[^}]*padding:5px 8px/u);
    assert.match(CAPTION_PANEL_CSS, /\.akari-caption-font-weights \{ grid-column:2/u);
    assert.match(CAPTION_PANEL_CSS, /\.akari-caption-font-weights button \{ padding:5px 3px/u);
});

test('フォント名と太さのボタンは内容に合わせて高くなり、28px より低くならない', () => {
    assert.match(CAPTION_PANEL_CSS,
        /\.akari-inspector-widget \.akari-caption-font-row button \{[^}]*height:auto;min-height:28px;/u);
    assert.match(CAPTION_PANEL_CSS,
        /\.akari-inspector-widget \.akari-caption-font-weights button \{[^}]*height:auto;min-height:28px;/u);
});

test('最近使える書体が無ければ最近使ったフォントの見出しも作らない', () => {
    assert.match(source, /if \(recent\.children\.length\) root\.append\(heading\(document, '最近使ったフォント'\), recent\)/u);
    const nodes = [];
    const document = { createElement(tagName) {
        const node = { tagName, children: [], attributes: {}, style: { setProperty() {} }, textContent: '',
            append(...children) { this.children.push(...children); }, setAttribute(key, value) { this.attributes[key] = value; },
            addEventListener() {} };
        nodes.push(node);
        return node;
    } };
    const state = { query: '', filtersOpen: false, filters: new Set(), recentFonts: ['missing'], recentStyles: [] };
    const actions = { close() {}, switchTo() {}, font() {}, style() {}, save() {}, openLibrary() {}, rerender() {},
        preview() {}, confirm() {}, escape() {} };
    const root = createCaptionPanel(document, 'font', state, [], new Map(), actions);
    assert.ok(root);
    assert.equal(nodes.some(node => node.textContent === '最近使ったフォント'), false);
});
