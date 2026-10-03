import assert from 'node:assert/strict';
import { readSourceFile, findMember } from './helpers/role-buckets-source.mjs';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';
const { isEditDataFileName } = createRequire(import.meta.url)('../lib/common/edit-data-file.js');

const source = readSourceFile('outputs').ast;
const method = findMember('renderOutputCard', { in: 'outputs' }).node;
const tokens = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/common/akari-surface-tokens.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText)(tokens);
const code = ts.transpileModule(`class Renderer { ${method.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React }
}).outputText;
const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
const Renderer = new Function('React', ...Object.keys(tokens), 'revealInFileManagerActionLabel', 'isEditDataFileName', `${code}\nreturn Renderer;`)(React, ...Object.values(tokens), label => label, isEditDataFileName);
const renderer = new Renderer();
renderer.outputIcon = () => 'codicon codicon-layers';
renderer.formatOutputMeta = () => 'JSON';
const render = (name, kind = 'data') => renderer.renderOutputCard({ name, kind, uri: { toString: () => name }, relativePath: name });

test('編集データは既存の accentTint で強調し、全カードの枠と角丸は対称で同じ', () => {
    const edit = render('edit.json');
    const normal = render('captions.json');
    const variant = render('edit.v20.json');
    assert.equal(variant.props.style.background, edit.props.style.background);
    assert.equal(edit.props.style.background, 'var(--theia-akariTheme-accentTint)');
    assert.equal(normal.props.style.background, tokens.AKARI_SURFACE.raised);
    assert.notEqual(edit.props.style.background, normal.props.style.background);
    for (const card of [edit, normal, render('review.json'), render('edit.json', 'export')]) {
        if (card !== edit) assert.equal(card.props.style.background, tokens.AKARI_SURFACE.raised);
        assert.equal(card.props.style.border, tokens.AKARI_BORDER.ghost);
        assert.equal(card.props.style.borderRadius, `${tokens.AKARI_RADIUS.panel}px`);
        assert.deepEqual(Object.keys(card.props.style).filter(key => /^border/.test(key)), ['borderRadius', 'border']);
        assert.equal(card.props.onMouseEnter, undefined, 'hover で強調面を上書きしない');
        assert.equal(card.props.className, undefined);
    }
    assert.equal(render('edit.json', 'export').props.style.background, normal.props.style.background);
    assert.doesNotMatch(method.getText(source), /borderLeft|borderInlineStart/);
});

test('編集データの強調属性・太字・明るいアイコンを保持する', () => {
    for (const [name, emphasis, weight, opacity] of [
        ['edit.json', 'edit', 600, 0.85], ['edit.v20.json', 'edit', 600, 0.85], ['captions.json', undefined, undefined, 0.55]
    ]) {
        const card = render(name);
        assert.equal(card.props['data-akari-output-emphasis'], emphasis);
        assert.equal(card.children[0].children[0].props.style.opacity, opacity);
        assert.equal(card.children[1].children[0].props.style.fontWeight, weight);
    }
});
