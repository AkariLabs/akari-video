import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/browser/library-text-telop-page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('library-text-telop-page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const code = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node))
    .map(node => node.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2021,
        jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Children: { toArray: children => children }, isValidElement: item => !!item?.props,
    useState: initial => [initial, () => {}], useRef: () => ({ current: null }), useEffect: () => {} };
const context = vm.createContext({ exports: {}, React, AKARI_BORDER: { hairline: 'line', ghost: 'ghost', edge: 'edge' },
    AKARI_INK: 'ink', AKARI_RADIUS: { panel: 6 }, AKARI_SURFACE: { card: 'card', raised: 'raised', elevated: 'elevated' } });
vm.runInContext(`${code}\nthis.LibraryTextTelopPage = LibraryTextTelopPage`, context);
const { LibraryTextTelopPage } = context;

function nodes(tree, predicate) {
    if (!tree || typeof tree !== 'object') return [];
    return [...(predicate(tree) ? [tree] : []), ...(tree.children ?? []).flatMap(child => nodes(child, predicate))];
}

test('テキストのページはスタイル・フォント・テロップを切り替え、テロップカードを同じ棚に置く', () => {
    const calls = [];
    const props = { onBack() {}, onPlace() {}, onTabChange: tab => calls.push(tab),
        styles: 'styles', myStyles: 'my-styles', motions: 'motions', fonts: 'fonts',
        telops: [React.createElement('paid', { premium: true }), React.createElement('free', { premium: false })] };
    const style = LibraryTextTelopPage({ ...props, tab: 'style' });
    assert.equal(nodes(style, node => node.props.role === 'tab').length, 3);
    nodes(style, node => node.props['data-akari-library-text-switch'] === 'telop')[0].props.onClick();
    assert.deepEqual(calls, ['telop']);
    const telop = LibraryTextTelopPage({ ...props, tab: 'telop' });
    assert.equal(nodes(telop, node => node.props['data-akari-text-look-section'] === 'telop').length, 1);
    assert.equal(nodes(telop, node => node.type === 'paid').length, 1);
    assert.equal(nodes(telop, node => node.type === 'free').length, 1);
    assert.equal(nodes(telop, node => node.props['data-akari-text-look-section'] === 'style').length, 0);
});
