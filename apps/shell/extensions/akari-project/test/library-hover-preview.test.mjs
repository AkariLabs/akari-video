import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { libraryHoverPreview, LIBRARY_HOVER_DELAY_MS } = require('../lib/common/library-hover-preview.js');
const { pngPreviewWidth } = require('../lib/node/thumbnail-cache.js');

function compileDeclarations(relative, names, jsx = false) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true,
        jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const selected = ast.statements.filter(node =>
        (ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
        || (ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => names.includes(decl.name.getText(ast)))));
    return ts.transpileModule(selected.map(node => node.getText(ast)).join('\n'), {
        compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None }
    }).outputText;
}

const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment', Children: { toArray: value => value }, isValidElement: item => !!item?.props,
    useState: initial => [initial, () => {}], useRef: () => ({ current: null }), useEffect: () => {} };
const context = vm.createContext({ exports: {}, React, libraryHoverPreview, LIBRARY_HOVER_DESCRIPTION_ID: 'preview',
    AKARI_RADIUS: { panel: 6, chip: 4 }, AKARI_SURFACE: { raised: 'raised', card: 'card', elevated: 'elevated' },
    AKARI_BORDER: { ghost: 'ghost', hairline: 'line', edge: 'edge' }, AKARI_INK: 'ink', AKARI_FAINT: 'faint',
    ACCENT_LIGHT: 'accent', PremiumCrownBadge: () => null, AssetStateMark: () => null,
    FavoriteStar: () => null, LibraryDotsButton: () => null, ShelfHeading: () => null,
    TELOP_PAGE_SIZE: 24, GRID: { display: 'grid' } });
vm.runInContext(`${compileDeclarations('../src/browser/library-card-view.tsx', ['Thumbnail', 'LibraryAssetCard'], true)}
this.Thumbnail = Thumbnail; this.LibraryAssetCard = LibraryAssetCard;`, context);
vm.runInContext(`${compileDeclarations('../src/browser/library-text-telop-page.tsx', ['LibraryTextTelopPage'], true)}
this.LibraryTextTelopPage = LibraryTextTelopPage;`, context);

function nodes(tree, predicate) {
    if (!tree || typeof tree !== 'object') return [];
    return [...(predicate(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, predicate))];
}

test('見本の選び方・寸法・遅延', () => {
    assert.equal(LIBRARY_HOVER_DELAY_MS, 400);
    assert.deepEqual(libraryHoverPreview('font', 'file:///sample.webp', undefined, 'https://example.com'),
        { src: 'file:///sample.webp', source: 'https://example.com', kind: 'font', width: 320, height: 200 });
    assert.equal(libraryHoverPreview('font')?.src, undefined);
    assert.deepEqual(libraryHoverPreview('overlay', 'file:///preview.png'),
        { src: 'file:///preview.png', kind: 'asset', width: 320, height: 180 });
    assert.equal(libraryHoverPreview('asset', 'file:///preview.png')?.src, 'file:///preview.png');
    assert.deepEqual(libraryHoverPreview('transition', 'file:///poster.webp', 'file:///strip.webp'),
        { src: 'file:///strip.webp', kind: 'transition', width: 192, height: 108 });
    assert.deepEqual(libraryHoverPreview('overlay', 'file:///preview.png', 'file:///strip.webp'),
        { src: 'file:///strip.webp', kind: 'transition', width: 192, height: 108 });
    assert.deepEqual(libraryHoverPreview('overlay', undefined, 'file:///strip.webp'),
        { src: 'file:///strip.webp', kind: 'transition', width: 192, height: 108 });
    assert.equal(libraryHoverPreview('audio', 'file:///preview.png'), undefined);
});

test('カードは縮小画像を遅延デコードし、Enter でプレビューする', () => {
    const preview = () => { calls++; };
    let calls = 0;
    const item = { key: 'overlay/example', category: 'overlay', title: '見本', previewUrl: 'file:///full.png',
        thumbUrl: 'file:///thumb.webp' };
    const props = { item, layout: 'grid', premium: false, cached: true, favorite: false, thumbnailBroken: false,
        placeholderIcon: 'placeholder', pickProps: {}, pickBadge: null, interactive: true, draggable: true,
        infoOpen: false, audioControl: null, audioError: null, uiTarget: { target: 'asset:overlay/example', label: '見本' },
        onDragStart() {}, onDragEnd() {}, onContextMenu() {}, onInfo() {}, onThumbnailError() {}, onPreview: preview };
    const card = context.LibraryAssetCard(props);
    assert.equal(card.props['data-akari-hover-preview-src'], item.previewUrl);
    assert.equal(card.props.tabIndex, 0);
    assert.equal(card.props['aria-describedby'], 'preview');
    card.props.onKeyDown({ key: 'Enter', target: card, currentTarget: card, preventDefault() {} });
    assert.equal(calls, 1);
    const keyboardCard = context.LibraryAssetCard({ ...props, onKeyboardPreview: () => { calls += 10; } });
    keyboardCard.props.onKeyDown({ key: 'Enter', target: keyboardCard, currentTarget: keyboardCard, preventDefault() {} });
    assert.equal(calls, 11);
    const thumbnail = nodes(card, node => node.type === context.Thumbnail)[0];
    const image = context.Thumbnail(thumbnail.props);
    assert.equal(image.props.src, item.thumbUrl);
    assert.equal(image.props.loading, 'lazy');
    assert.equal(image.props.decoding, 'async');
    assert.equal(image.props.width, 480);
    assert.equal(image.props.height, 270);
    const withStrip = context.LibraryAssetCard({ ...props, item: { ...item,
        previewStripUrl: 'file:///strip.webp' } });
    assert.equal(withStrip.props['data-akari-hover-preview-src'], 'file:///strip.webp');
    assert.equal(withStrip.props['data-akari-hover-preview-strip'], 'file:///strip.webp');
    assert.equal(withStrip.props['data-akari-hover-preview-kind'], 'transition');
    assert.equal(context.Thumbnail(nodes(withStrip, node => node.type === context.Thumbnail)[0].props).props.src,
        item.thumbUrl);
});

test('テロップ棚の初回描画は 24 件以下', () => {
    const cards = Array.from({ length: 71 }, (_, index) => React.createElement('card', { key: index }));
    const page = context.LibraryTextTelopPage({ onBack() {}, onPlace() {}, onTabChange() {}, tab: 'telop',
        styles: null, myStyles: null, motions: null, fonts: null, telops: cards });
    assert.equal(nodes(page, node => node.type === 'card').length, 24);
    assert.equal(nodes(page, node => node.props['data-akari-telop-more'] !== undefined).length, 1);
    const original = React.useState;
    React.useState = () => [{ key: 'previous-filter', limit: 96 }, () => {}];
    try {
        const filtered = context.LibraryTextTelopPage({ onBack() {}, onPlace() {}, onTabChange() {}, tab: 'telop',
            styles: null, myStyles: null, motions: null, fonts: null, telops: cards.slice(0, 40) });
        assert.equal(nodes(filtered, node => node.type === 'card').length, 24);
    } finally { React.useState = original; }
});

test('大きい PNG の幅をヘッダから読む', async () => {
    const width = await pngPreviewWidth(new URL('../../../../../catalog/font/reggae-one/preview.png', import.meta.url).pathname);
    assert.ok(width > 0);
});

test('小窓は一つだけで、移動・Esc・離脱・ドラッグ・Tab に応答する', () => {
    const timers = new Map();
    const listeners = () => {
        const map = new Map();
        return { addEventListener(name, callback) { map.set(name, callback); },
            removeEventListener(name) { map.delete(name); }, fire(name, event = {}) { map.get(name)?.(event); } };
    };
    class FakeElement {
        constructor(src) {
            this.dataset = { akariHoverPreviewKind: 'asset', akariHoverPreviewSrc: src,
                akariHoverPreviewLabel: src };
            this.title = src;
            this.isConnected = true;
        }
        closest() { return this; }
        contains(other) { return this === other; }
        querySelector() { return null; }
        getBoundingClientRect() { return { left: 10, right: 110, top: 10 }; }
    }
    const cards = [new FakeElement('one.png'), new FakeElement('two.png')];
    const root = { ...listeners(), contains(card) { return cards.includes(card); } };
    const document = { ...listeners(), body: {} };
    const window = { ...listeners(), innerWidth: 800, innerHeight: 600 };
    let active;
    let mounted = false;
    const refs = [{ current: undefined }, { current: false }];
    let refIndex = 0;
    const hooks = { ...React, useState: () => [active, value => { active = value; }],
        useRef: () => refs[refIndex++], useEffect(callback) { if (!mounted) { callback(); mounted = true; } } };
    const ui = vm.createContext({ exports: {}, React: hooks, createPortal: tree => tree,
        libraryHoverPreview, LIBRARY_HOVER_DELAY_MS, LIBRARY_HOVER_DESCRIPTION_ID: 'preview',
        hoverPopupPosition: () => ({ left: 120, top: 10 }), Element: FakeElement, document, window,
        setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); } });
    vm.runInContext(`${compileDeclarations('../src/browser/library-hover-preview.tsx', ['CSS', 'LibraryHoverPreview'], true)}
this.LibraryHoverPreview = LibraryHoverPreview;`, ui);
    const render = () => { refIndex = 0; return ui.LibraryHoverPreview({ root, enabled: true, blocked: false, pageKey: 'overlay' }); };
    const count = () => nodes(render(), node => node.props?.['data-akari-library-hover-preview'] !== undefined).length;
    const flush = () => { for (const callback of [...timers.values()]) callback(); timers.clear(); };
    assert.equal(count(), 0);
    root.fire('pointerover', { target: cards[0], relatedTarget: null });
    assert.equal(count(), 0);
    flush();
    assert.equal(count(), 1);
    root.fire('pointerout', { target: cards[0], relatedTarget: cards[1] });
    root.fire('pointerover', { target: cards[1], relatedTarget: cards[0] });
    flush();
    assert.equal(count(), 1);
    document.fire('keydown', { key: 'Escape' });
    assert.equal(count(), 0);
    root.fire('focusin', { target: cards[0], relatedTarget: null });
    flush();
    assert.equal(count(), 1);
    root.fire('focusout', { target: cards[0], relatedTarget: null });
    assert.equal(count(), 0);
    root.fire('pointerover', { target: cards[0], relatedTarget: null });
    flush();
    document.fire('dragstart');
    assert.equal(count(), 0);
    root.fire('pointerover', { target: cards[0], relatedTarget: null });
    assert.equal(timers.size, 0);
    document.fire('dragend');
});
