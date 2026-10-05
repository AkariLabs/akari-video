import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/library-card-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('library-card-view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node)
    && ['Thumbnail', 'LibraryAssetCard'].includes(node.name?.text)).map(node => node.getText(ast)).join('\n');
const code = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2021,
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment' };
const Badge = () => null;
const { Thumbnail, LibraryAssetCard } = new Function('exports', 'React', 'PremiumCrownBadge', 'AssetStateMark', 'FavoriteStar',
    'LibraryDotsButton', 'AKARI_RADIUS', 'AKARI_SURFACE', 'AKARI_BORDER', 'AKARI_FAINT', 'ACCENT_LIGHT',
    `${code}\nreturn { Thumbnail, LibraryAssetCard };`)({}, React, Badge, Badge, Badge, Badge,
    { panel: 6, chip: 4 }, { raised: 'raised', card: 'card' }, { ghost: 'ghost' }, 'faint', 'accent');

function nodes(tree, predicate) {
    if (tree === null || tree === undefined || typeof tree !== 'object') return [];
    return [...(predicate(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, predicate))];
}

test('textstyle Pro カードは preview URL の見本と鍵を表示する', () => {
    const previewUrl = 'https://akari.video/lab/media/telop-rich-pack/textstyle/telop-fixture-style.png';
    const props = { item: { key: 'textstyle/telop-fixture-style', id: 'telop-fixture-style', category: 'textstyle',
        title: '字幕スタイルの見本', state: 'locked', previewUrl }, layout: 'grid', premium: true, cached: false,
        favorite: false, thumbnailBroken: false, placeholderIcon: 'placeholder', pickProps: {}, pickBadge: null,
        interactive: false, draggable: false, infoOpen: false, audioControl: null, audioError: null,
        uiTarget: { target: 'asset:textstyle/telop-fixture-style', label: '字幕スタイルの見本' },
        onDragStart() {}, onDragEnd() {}, onContextMenu() {}, onInfo() {}, onThumbnailError() {} };
    const card = LibraryAssetCard(props);
    assert.equal(card.props['data-akari-premium'], 'true');
    assert.equal(card.props['data-akari-catalog-item-state'], 'locked');
    assert.equal(nodes(card, node => node.type === Badge).length, 1);
    const thumbnail = nodes(card, node => node.type === Thumbnail)[0];
    assert.equal(Thumbnail(thumbnail.props).props.src, previewUrl);
});
