import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { LIBRARY_DETAIL_GROUPS, LIBRARY_PRIMARY_TILES } from '../lib/common/library-home-view.js';

const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
const methods = ['readLibraryDetailsOpen', 'toggleLibraryDetails', 'placeLibraryText', 'renderLibraryPrimaryTile', 'renderLibraryHome'];
const code = ts.transpileModule(`class Handler { ${methods.map(name => {
    const member = widget.members.find(candidate => candidate.name?.getText(source) === name);
    assert.ok(member, `${name} が存在する`);
    return member.getText(source);
}).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React } }).outputText;
const storage = new Map();
const window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) };
const Handler = new Function('React', 'window', 'LIBRARY_PRIMARY_TILES', 'LIBRARY_DETAIL_GROUPS', 'AKARI_LIBRARY_DETAILS_STORAGE_KEY', 'AKARI_RADIUS', 'AKARI_SURFACE', 'AKARI_BORDER', 'AKARI_INK',
    `${code}\nreturn Handler;`)(React, window, LIBRARY_PRIMARY_TILES, LIBRARY_DETAIL_GROUPS,
    'akari.library.detailsOpen',
    { panel: 6 }, { card: '#111', raised: '#222' }, { ghost: '1px solid #333' }, '#fff');

function fixture() {
    const handler = new Handler();
    const calls = [];
    const errors = [];
    handler.catalogQuery = '';
    handler.libraryDetailsOpen = false;
    handler.commandService = { executeCommand: async (...args) => { calls.push(args); } };
    handler.messages = { error: message => errors.push(message) };
    handler.update = () => {};
    handler.renderRecentLibraryStrip = () => null;
    handler.renderLibraryMyCategory = category => React.createElement('span', { category: category.key });
    handler.renderLibraryCategoryRow = category => React.createElement('span', { category: category.key });
    handler.selectLibraryCategory = key => calls.push(['select', key]);
    return { handler, calls, errors };
}

function nodes(tree, predicate) {
    if (tree === null || tree === undefined || typeof tree !== 'object') return [];
    return [...(predicate(tree) ? [tree] : []), ...tree.children.flatMap(child => nodes(child, predicate))];
}

test('ホームは主要タイルを最上段に 9 枚描き、詳細は既定で描かない', () => {
    const { handler } = fixture();
    const home = handler.renderLibraryHome();
    const tiles = nodes(home, node => node.props['data-akari-library-primary-tile']);
    assert.deepEqual(tiles.map(node => node.props['data-akari-library-primary-tile']), LIBRARY_PRIMARY_TILES.map(tile => tile.key));
    assert.deepEqual(tiles.map(node => node.props['data-akari-library-tile-kind']), LIBRARY_PRIMARY_TILES.map(tile => tile.kind));
    const grid = nodes(home, node => node.props['data-akari-library-primary-tiles'] !== undefined)[0];
    assert.equal(grid.props.style.gridTemplateColumns, 'repeat(3, minmax(0, 1fr))');
    assert.equal(tiles[0].props['data-akari-library-category'], undefined);
    assert.equal(tiles[0].props.draggable, undefined);
    assert.deepEqual(tiles.slice(3).map(node => node.props['data-akari-library-category']),
        ['image', 'broll', 'bgm', 'sfx', 'overlay', 'scene3d']);
    assert.equal(tiles[1].props['data-akari-library-soon'], 'true');
    assert.equal(tiles[2].props['data-akari-library-soon'], 'true');
    assert.equal(nodes(home, node => node.props['data-akari-library-details'] !== undefined).length, 0);
    assert.equal(nodes(home, node => node.props['data-akari-library-details-toggle'] !== undefined)[0].props['aria-expanded'], false);
});

test('最近使った帯は 3×3 の後、詳細の開閉ボタンの前に描く', () => {
    const { handler } = fixture();
    handler.renderRecentLibraryStrip = () => React.createElement('section', { 'data-recent-strip': true });
    for (const open of [false, true]) {
        handler.libraryDetailsOpen = open;
        const children = handler.renderLibraryHome().children.filter(child => child && typeof child === 'object');
        assert.ok(nodes(children[0], node => node.props['data-akari-library-primary-tiles'] !== undefined).length === 1);
        assert.equal(children[1].props['data-recent-strip'], true);
        assert.equal(children[2].props['data-akari-library-details-toggle'], true);
    }
});

test('テキストは引数なし placeText、選ぶタイルはカテゴリ一覧へ進み、近日は押せない', async () => {
    const { handler, calls, errors } = fixture();
    handler.renderLibraryPrimaryTile(LIBRARY_PRIMARY_TILES[0]).props.onClick({ stopPropagation() {} });
    await Promise.resolve();
    assert.deepEqual(calls, [['akari.caption.placeText']]);
    handler.renderLibraryPrimaryTile(LIBRARY_PRIMARY_TILES[5]).props.onClick({ stopPropagation() {} });
    assert.deepEqual(calls[1], ['select', 'bgm']);
    const soon = handler.renderLibraryPrimaryTile(LIBRARY_PRIMARY_TILES[1]);
    assert.equal(soon.props.disabled, true);
    assert.equal(soon.props.onClick, undefined);
    handler.commandService.executeCommand = async () => { throw new Error('失敗'); };
    await handler.placeLibraryText();
    assert.deepEqual(errors, ['文字を置けません: 失敗']);
});

test('詳細の開閉を localStorage に記憶し、次のインスタンスで復元する', () => {
    storage.clear();
    const { handler } = fixture();
    assert.equal(handler.readLibraryDetailsOpen(), false);
    handler.renderLibraryHome();
    handler.toggleLibraryDetails();
    assert.equal(storage.get('akari.library.detailsOpen'), 'true');
    const openHome = handler.renderLibraryHome();
    assert.equal(nodes(openHome, node => node.props['data-akari-library-details-toggle'] !== undefined)[0].props['aria-expanded'], true);
    const details = nodes(openHome, node => node.props['data-akari-library-details'] !== undefined)[0];
    assert.ok(details);
    assert.deepEqual(nodes(details, node => node.props.category).map(node => node.props.category),
        LIBRARY_DETAIL_GROUPS.flatMap(group => group.categories.map(category => category.key)));
    const { handler: restored } = fixture();
    restored.libraryDetailsOpen = restored.readLibraryDetailsOpen();
    assert.equal(restored.libraryDetailsOpen, true);
    restored.toggleLibraryDetails();
    assert.equal(storage.get('akari.library.detailsOpen'), 'false');
});
