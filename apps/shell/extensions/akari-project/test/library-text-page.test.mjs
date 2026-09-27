import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { libraryFontLabel } from '../lib/common/library-font-label.js';
import { fontPreviewPath } from '../lib/common/library-shelf-visuals.js';

const source = readFileSync(new URL('../src/browser/library-text-look-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('library-text-look-view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const members = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
const code = ts.transpileModule(members, { compilerOptions: { target: ts.ScriptTarget.ES2021,
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {},
    children: children.flat(Infinity) }) };
const LibraryDotsButton = props => React.createElement('dots', props);
const { LibraryTextLookPage, LibraryTextFontRow } = new Function('exports', 'React', 'AKARI_BORDER', 'AKARI_INK',
    'AKARI_RADIUS', 'AKARI_SURFACE', 'libraryFontLabel', 'fontPreviewPath', 'LibraryDotsButton',
    `${code}\nreturn { LibraryTextLookPage, LibraryTextFontRow };`)(
    {}, React, { hairline: 'line', ghost: 'ghost', edge: 'edge' }, 'ink', { panel: 6, chip: 4 },
    { card: 'card', raised: 'raised', elevated: 'elevated' }, libraryFontLabel, fontPreviewPath, LibraryDotsButton);

function nodes(tree, predicate) {
    if (tree === null || tree === undefined || typeof tree !== 'object') return [];
    return [...(predicate(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, predicate))];
}

test('テキストページはスタイルとフォントだけを切り替え、アニメをスタイル棚に置く', () => {
    const calls = [];
    const props = { onBack: () => calls.push('back'), onPlace: () => calls.push('place'),
        onTabChange: tab => calls.push(tab), styles: 'style-cards', myStyles: 'my-styles',
        motions: 'motion-cards', fonts: [React.createElement(LibraryTextFontRow, { item: { id: 'noto-sans-jp' } })] };
    const style = LibraryTextLookPage({ ...props, tab: 'style' });
    assert.equal(nodes(style, node => node.props['data-akari-text-look-section'] === 'style').length, 1);
    assert.equal(nodes(style, node => node.props['data-akari-text-look-section'] === 'motion').length, 0);
    assert.equal(nodes(style, node => node.props['data-akari-text-look-section'] === 'font').length, 0);
    assert.equal(nodes(style, node => node.props.role === 'tab').length, 2);
    nodes(style, node => node.props['data-akari-library-place-text'])[0].props.onClick();
    nodes(style, node => node.props['data-akari-library-text-switch'] === 'font')[0].props.onClick();
    assert.deepEqual(calls, ['place', 'font']);
    const font = LibraryTextLookPage({ ...props, tab: 'font' });
    assert.equal(nodes(font, node => node.props['data-akari-text-look-section'] === 'font').length, 1);
    assert.equal(nodes(font, node => node.props['data-akari-text-look-section'] === 'style').length, 0);
    assert.equal(nodes(font, node => node.type === LibraryTextFontRow).length, 1);
    nodes(font, node => node.props['data-akari-library-back'])[0].props.onClick();
    assert.equal(calls.at(-1), 'back');
});

test('フォントは1行1書体で、名前は重複せず、元カードの押下とドラッグを使う', () => {
    const calls = [];
    const handlers = {
        favorite: false,
        onApply: () => calls.push('apply'),
        onDragStart: () => calls.push('drag-start'),
        onDragEnd: () => calls.push('drag-end'),
        onContextMenu: () => calls.push('menu'),
        onInfo: () => calls.push('info')
    };
    const card = React.createElement('font-card', handlers);
    const item = { id: 'noto-sans-jp', key: 'font/noto-sans-jp', title: 'Noto Sans JP' };
    const row = LibraryTextFontRow({ item, faceFamily: 'AKARI Noto Sans JP', card });
    assert.equal(row.props['data-akari-font-card'], item.id);
    assert.equal(row.props['data-akari-catalog-item'], item.key);
    assert.equal(row.props.draggable, true);
    assert.equal(nodes(row, node => node.props['data-akari-font-name']).length, 1);
    assert.equal(nodes(row, node => node.props['data-akari-font-english']).length, 1);
    assert.equal(nodes(row, node => node.type === 'img').length, 0, '登録済みの面を使う');
    assert.equal(nodes(row, node => node.props['data-akari-font-name'])[0].props.style.fontFamily,
        '"AKARI Noto Sans JP", sans-serif');
    assert.equal(row.props.style.flexDirection, 'row', '登録済みの面は横並び');
    for (const attribute of ['data-akari-font-name', 'data-akari-font-english']) {
        const text = nodes(row, node => node.props[attribute])[0];
        assert.equal(text.props.style.whiteSpace, 'nowrap');
        assert.equal(text.props.style.textOverflow, 'ellipsis');
    }
    row.props.onClick(); row.props.onDragStart(); row.props.onDragEnd(); row.props.onContextMenu();
    nodes(row, node => node.type === LibraryDotsButton)[0].props.onOpen();
    assert.deepEqual(calls, ['apply', 'drag-start', 'drag-end', 'menu', 'info']);

    const remote = LibraryTextFontRow({ item: { id: '851-chikara-dzuyoku', key: 'font/851-chikara-dzuyoku',
        title: '851チカラヅヨク', previewUrl: 'preview.png' }, card });
    assert.equal(remote.props.style.flexDirection, 'column', 'プレビュー行は縦積み');
    const remoteName = nodes(remote, node => node.props['data-akari-font-name'])[0];
    assert.equal(remoteName.props.style.whiteSpace, 'nowrap');
    assert.equal(remoteName.props.style.textOverflow, 'ellipsis');
    const preview = nodes(remote, node => node.props['data-akari-font-preview'])[0];
    assert.equal(preview.props.style.width, '100%');
    assert.equal(preview.props.style.height, '44px');
    assert.equal(preview.children[0].props.style.objectPosition, 'left center');
    const stacked = remote.children[0];
    assert.equal(stacked.children[1], preview, '画像は名前の後に来る');
    assert.equal(nodes(stacked.children[0], node => node === remoteName).length, 1);
    assert.equal(nodes(remote, node => node.type === 'img').length, 1, '未取得書体は既存プレビューを使う');
    assert.equal(nodes(remote, node => node.props['data-akari-font-english']).length, 0, '同じ名前を二度出さない');

    const english = LibraryTextFontRow({ item: { id: 'ab-kirigirisu', key: 'font/ab-kirigirisu',
        title: 'AB-kirigirisu（ABキリギリス）', previewUrl: 'preview.png' }, card });
    const englishName = nodes(english, node => node.props['data-akari-font-english'])[0];
    assert.equal(englishName.props.style.whiteSpace, 'nowrap');
    assert.equal(englishName.props.style.textOverflow, 'ellipsis');
    const withoutPreview = LibraryTextFontRow({ item: { id: 'other', key: 'font/other', title: 'その他' }, card });
    assert.equal(nodes(withoutPreview, node => node.type === 'small' && node.children.includes('見本は取得後')).length, 1);
});
