import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const React = require('@theia/core/shared/react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildHomeStats, hasPreviewContent } = require('../lib/browser/home/home-model.js');
const { CurrentProjectBand, homePanelCss } = require('../lib/browser/home/home-panels.js');
const { installModeSwitchStyle } = require('../lib/browser/mode-switch/mode-switch-popup.js');

const render = (overrides = {}) => renderToStaticMarkup(React.createElement(CurrentProjectBand, {
    name: '試作', path: '/tmp/example', frames: [], stats: {}, canPreview: false,
    onPreview() {}, onStart() {}, onReveal() {}, onEdit() {}, onExport() {}, onSwitch() {}, onJoin() {}, onLauncher() {},
    ...overrides
}));

test('empty timeline has no playback affordance even when a source thumbnail exists', () => {
    const edit = { clips: [], sources: [{ path: 'assets/shot.mp4' }] };
    assert.equal(hasPreviewContent(edit), false);
    assert.equal(hasPreviewContent({ tracks: [{ items: [] }] }), false);
    assert.equal(hasPreviewContent({ tracks: [{ items: [{ id: 'shot' }] }] }), true);
    assert.equal(hasPreviewContent({ overlays: [{ html: 'title.html' }] }), true);
    const html = render({ frames: ['shot.jpg'], stats: buildHomeStats(edit, 1), canPreview: hasPreviewContent(edit) });
    assert.match(html, /src="shot.jpg"/);
    assert.doesNotMatch(html, /aria-label="出力プレビューで再生"|akari-current-play/);
});

test('missing poster shows a calm next step and zero statistics as dashes', () => {
    const stats = buildHomeStats({ duration_s: 0, clips: [], sources: [] }, 0, 0);
    assert.deepEqual(stats, { duration: '—', clips: '—', assets: '—', bytes: '—', lastExport: undefined });
    const html = render({ stats });
    assert.match(html, /data-akari-current-hero-empty="true"/);
    assert.match(html, /まだ映像がありません/);
    assert.match(html, /素材を入れて始める/);
    assert.match(html, /素材をドラッグしても取り込めます/);
    assert.doesNotMatch(html, /akari-current-play|data-akari-current-thumbnails/);
    assert.equal((html.match(/>—<\/b>/g) ?? []).length, 4);
    assert.match(homePanelCss, /\.akari-current-hero-empty\{[^}]*linear-gradient/);
});

test('a project with content can play when its poster is unavailable', () => {
    const html = render({ frames: [], canPreview: true });
    assert.match(html, /data-akari-current-hero-preview-placeholder="true"/);
    assert.match(html, /aria-label="出力プレビューで再生"/);
    assert.match(html, /akari-current-hero-empty/);
    assert.match(html, /akari-current-empty-icon/);
    assert.match(html, /サムネイルはありません/);
    assert.match(html, /akari-current-play/);
    assert.doesNotMatch(html, /まだ映像がありません|素材を入れて始める/);
    assert.match(homePanelCss, /\.akari-current-empty-title\{font-size:13px/);
    assert.match(homePanelCss, /\.akari-current-empty-hint\{[^}]*font-size:11px/);
});

test('a poster load failure keeps the preview click handler', () => {
    const compiled = readFileSync(new URL('../lib/browser/home/home-panels.js', import.meta.url), 'utf8');
    const mockedReact = { ...React, useState: () => ['missing.jpg', () => {}] };
    const exports = {};
    new Function('exports', 'require', compiled)(exports, id => id === '@theia/core/shared/react' ? mockedReact : require(id));
    const onPreview = () => {};
    const element = exports.CurrentProjectBand({
        name: '試作', path: '/tmp/example', frames: ['missing.jpg'], stats: {}, canPreview: true,
        onPreview, onStart() {}, onReveal() {}, onEdit() {}, onExport() {}, onSwitch() {}, onJoin() {}, onLauncher() {}
    });
    const find = node => {
        if (!node || typeof node !== 'object') return undefined;
        if (node.props?.['data-akari-current-hero-preview-placeholder'] === 'true') return node;
        return React.Children.toArray(node.props?.children).map(find).find(Boolean);
    };
    const hero = find(element);
    assert.equal(hero?.type, 'button');
    assert.equal(hero?.props['aria-label'], '出力プレビューで再生');
    assert.equal(hero?.props.onClick, onPreview);
});

test('the empty preview guard gives guidance while real open failures retain their error', () => {
    const source = readFileSync(new URL('../src/browser/akari-home-widget.tsx', import.meta.url), 'utf8');
    assert.match(source, /this\.messages\.info\('まだ映像がありません。素材を入れてください。'\)/);
    assert.match(source, /this\.messages\.error\('出力プレビューを開けませんでした。'\)/);
});

test('populated poster keeps playback control and missing small frames get light boxes', () => {
    const html = render({ frames: ['poster.jpg', 'second.jpg'], canPreview: true });
    assert.match(html, /aria-label="出力プレビューで再生"/);
    assert.match(html, /akari-current-play/);
    assert.equal((html.match(/data-akari-current-thumbnail=/g) ?? []).length, 5);
    assert.equal((html.match(/class="akari-current-thumbnail-empty"/g) ?? []).length, 3);
});

test('selected mode card and rail marker use the theme accent', () => {
    const previous = globalThis.document;
    const style = { id: '', textContent: '' };
    globalThis.document = {
        getElementById: () => null,
        createElement: () => style,
        head: { appendChild() {} }
    };
    try { installModeSwitchStyle(); } finally { globalThis.document = previous; }
    assert.match(style.textContent, /\.akari-mode-popup \.mo\.on[^}]*border-color: var\(--akari-accent/);
    assert.match(style.textContent, /\.akari-mode-popup \.mo\.on::before[^}]*background: var\(--akari-accent/);
    assert.match(style.textContent, /\.akari-mode-popup \.mo\.on > svg\s*\{[^}]*visibility: visible/);
    assert.match(style.textContent, /\.akari-mode-switch-selected \.akari-mode-switch-icon::after/);
});
