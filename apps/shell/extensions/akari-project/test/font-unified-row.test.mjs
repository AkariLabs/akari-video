import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { libraryFontLabel } = require('../lib/common/library-font-label.js');
const { fontPreviewPath } = require('../lib/common/library-shelf-visuals.js');
const { libraryHoverPreview } = require('../lib/common/library-hover-preview.js');
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment' };
const LibraryDotsButton = () => null;
const source = await readFile(new URL('../src/browser/library-text-look-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('library-text-look-view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'LibraryTextFontRow');
assert.ok(declaration);
const compiled = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS }
}).outputText;
const context = vm.createContext({ exports: {}, React, libraryFontLabel, fontPreviewPath, LibraryDotsButton,
    AKARI_RADIUS: { panel: 6 }, AKARI_SURFACE: { raised: 'raised' }, AKARI_INK: 'ink', AKARI_BORDER: { ghost: 'ghost' } });
vm.runInContext(compiled, context);
const { LibraryTextFontRow } = context.exports;

function nodes(tree, predicate) {
    if (!tree || typeof tree !== 'object') return [];
    return [...(predicate(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, predicate))];
}

test('31 書体すべて同じ高さの行で、見本・状態・ホバーを持つ', async () => {
    const catalog = new URL('../../../../../catalog/font/', import.meta.url);
    const ids = (await readdir(catalog, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
    assert.equal(ids.length, 31);
    let images = 0;
    for (const id of ids) {
        const files = await readdir(new URL(`${id}/`, catalog));
        const meta = JSON.parse(await readFile(new URL(`${id}/meta.json`, catalog), 'utf8'));
        const hasImage = files.includes('row.webp');
        const item = { id, key: `font/${id}`, title: meta.title, sourceUrl: meta.source?.url,
            previewUrl: hasImage ? `file:///catalog/font/${id}/row.webp` : undefined };
        const card = { props: { availability: { status: hasImage ? 'available' : 'source' },
            favorite: id === 'noto-sans-jp', onApply() {}, onDragStart() {}, onDragEnd() {}, onContextMenu() {}, onInfo() {} } };
        const row = LibraryTextFontRow({ item, card });
        assert.equal(row.props['data-akari-font-card'], id);
        assert.equal(row.props.style.height, '60px');
        assert.equal(row.props.style.flexDirection, 'column');
        const primary = nodes(row, node => node.props?.['data-akari-font-primary'] !== undefined)[0];
        assert.equal(primary.props.style.width, '100%');
        assert.equal(primary.children[0].props.style.width, '100%');
        assert.equal(nodes(primary, node => node.type === LibraryDotsButton).length, 0);
        assert.equal(nodes(row, node => node.props?.['data-akari-font-secondary'] !== undefined).length, 1);
        assert.equal(row.props['data-akari-hover-preview-kind'], 'font');
        assert.equal(row.props['data-akari-hover-preview-src'], hasImage ? `file:///catalog/font/${id}/sample.webp` : undefined);
        const secondary = nodes(row, node => node.props?.['data-akari-font-secondary'] !== undefined)[0];
        assert.equal(nodes(secondary, node => node.props?.['data-akari-font-status'] !== undefined).length, 1);
        const english = nodes(secondary, node => node.props?.['data-akari-font-english'] !== undefined)[0];
        assert.equal(english.props.title, libraryFontLabel(id, meta.title).english ?? meta.title);
        assert.equal(english.props.style.minWidth, 0);
        assert.equal(english.props.style.flex, '1 1 0');
        assert.equal(nodes(secondary, node => node.type === LibraryDotsButton).length, 1);
        assert.equal(secondary.children.at(-1).type, LibraryDotsButton);
        assert.equal(nodes(secondary, node => node.props?.['data-akari-font-status'] !== undefined)[0].props.style.flex, '0 1 auto');
        if (id === 'noto-sans-jp') assert.equal(nodes(secondary, node => node.props?.['aria-label'] === 'お気に入り').length, 1);
        if (hasImage) {
            images++;
            const preview = nodes(row, node => node.props?.['data-akari-font-preview'] !== undefined)[0];
            assert.equal(preview.props.style.height, '32px');
            assert.match(preview.props.style.mask, /left center \/ auto 32px no-repeat/u);
        } else {
            const name = nodes(row, node => node.props?.['data-akari-font-name'] !== undefined)[0];
            assert.equal(name.props.style.height, undefined);
            assert.equal(name.props.style.lineHeight, '32px');
            assert.equal(name.props.style.fontFamily, 'sans-serif');
            assert.equal(name.props.style.fontSize, '22px');
        }
        assert.equal(libraryHoverPreview('font', row.props['data-akari-hover-preview-src'], undefined,
            row.props['data-akari-hover-preview-source'])?.kind, 'font');
    }
    assert.equal(images, 13);
});
