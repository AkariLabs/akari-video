import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { catalogItemsWithoutShelvedTelops, isTelopAsset, textTelopItems } from '../lib/common/library-telop-shelf.js';
import { isPremiumLocked } from '../lib/common/library-filter.js';
import { storeProductUrl } from '../lib/common/asset-catalog-view.js';

test('テロップ棚は overlay のタグまたは telop- ID だけを選ぶ', () => {
    const items = [
        { category: 'overlay', id: 'telop-rich-one', tags: [], key: 'overlay/telop-rich-one' },
        { category: 'overlay', id: 'caption-plate', tags: ['telop'], key: 'overlay/caption-plate' },
        { category: 'overlay', id: 'grain', tags: [], key: 'overlay/grain' },
        { category: 'still', id: 'telop-preview', tags: ['telop'], key: 'still/telop-preview' }
    ];
    assert.deepEqual(textTelopItems(items).map(item => item.key),
        ['overlay/telop-rich-one', 'overlay/caption-plate']);
    assert.equal(isTelopAsset(items[2]), false);
});

test('overlay category excludes telops but search can find them', () => {
    const telop = { category: 'overlay', id: 'telop-title', tags: ['telop'] };
    const frame = { category: 'overlay', id: 'frame', tags: [] };
    assert.deepEqual(catalogItemsWithoutShelvedTelops([telop, frame], 'overlay', ''), [frame]);
    assert.deepEqual(catalogItemsWithoutShelvedTelops([telop, frame], 'overlay', 'telop'), [telop, frame]);
    assert.deepEqual(catalogItemsWithoutShelvedTelops([telop, frame], 'all', ''), [telop, frame]);
});

test('パックの Lab 導線は素材 id でなく product_id を開く', () => {
    const raw = readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('widget.tsx', raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
    const method = widget.members.find(member => member.name?.getText(ast) === 'openLibraryLab').getText(ast);
    const code = ts.transpileModule(`class Link { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const Link = new Function('storeProductUrl', `${code}\nreturn Link;`)(storeProductUrl);
    const link = new Link();
    const urls = [];
    link.storeConnection = { url: 'https://akari.video/api/store' };
    link.windowService = { openNewWindow: url => urls.push(url) };
    link.openLibraryLab({ id: 'telop-fixture', product_id: 'telop-rich-pack-01' });
    assert.match(urls[0], /telop-rich-pack-01/);
    assert.doesNotMatch(urls[0], /telop-fixture/);
});

test('テキスト棚の有料テロップは王冠 1 つで、押すと促しのシートだけを出す', () => {
    const raw = readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('widget.tsx', raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
    const method = widget.members.find(member => member.name?.getText(ast) === 'renderTextLookPage').getText(ast);
    const code = ts.transpileModule(`class Shelf { ${method} }`, { compilerOptions: {
        target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React } }).outputText;
    const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
    const Shelf = new Function('React', 'LibraryTextTelopPage', 'LibraryAssetCard', 'LibraryTextFontRow',
        'textTelopItems', `${code}\nreturn Shelf;`)(React, 'text-page', 'card', 'font-row', textTelopItems);
    const shelf = new Shelf();
    const locked = { origin: 'resolver', category: 'overlay', id: 'telop-fixture', key: 'overlay/telop-fixture',
        title: '有料テロップ', tags: ['telop'], state: 'locked', price: 1980 };
    const free = { ...locked, id: 'telop-free', key: 'overlay/telop-free', state: 'available', price: 0 };
    const calls = [];
    shelf.ensureLibraryStyleFonts = () => {};
    shelf.filteredPresetShowcaseItems = () => [];
    shelf.filteredCatalogItems = () => [locked, free];
    shelf.renderMyStyles = () => null;
    shelf.libraryAssetCardProps = item => ({ premium: isPremiumLocked(item) });
    shelf.showPremiumPrompt = key => {
        if (key !== locked.key) return false;
        calls.push(['prompt', key]); return true;
    };
    shelf.addCatalogAssetAtPlayhead = item => calls.push(['place', item.key]);
    const page = shelf.renderTextLookPage();
    const cards = page.props.telops;
    assert.equal(cards.length, 2);
    assert.equal(cards[0].props.premium, true);
    assert.equal(cards[1].props.premium, false);
    cards[0].props.onPreview();
    cards[1].props.onPreview();
    assert.deepEqual(calls, [['prompt', locked.key], ['place', free.key]]);
});
