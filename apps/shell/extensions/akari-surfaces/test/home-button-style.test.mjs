import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('ホームの button は共通段か data-akari-* を持つ', () => {
    const file = 'akari-home-widget.tsx';
    const source = ts.createSourceFile(file, readFileSync(new URL(`../src/browser/${file}`, import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let count = 0;
    const visit = node => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'button') {
            count++;
            const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
            const classAttr = attrs.find(attr => attr.name.getText(source) === 'className');
            const classValue = classAttr?.initializer?.getText(source) ?? '';
            const hasData = attrs.some(attr => attr.name.getText(source).startsWith('data-akari-'));
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            assert.ok(classValue.includes('theia-button') || hasData,
                `${file}:${line} の button には theia-button か data-akari-* が必要`);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(count > 0, `${file} に検査対象の button がない`);
});
