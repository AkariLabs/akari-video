import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const files = [
    'akari-materials-pane.tsx',
    'akari-outputs-pane.tsx',
    'akari-role-buckets-widget.tsx'
];

for (const file of files) {
    test(`${file}: 素の button を増やさない`, () => {
        const source = ts.createSourceFile(file, readFileSync(new URL(`../src/browser/${file}`, import.meta.url), 'utf8'),
            ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        let count = 0;
        const visit = node => {
            if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'button') {
                count++;
                const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
                const classAttr = attrs.find(attr => attr.name.getText(source) === 'className');
                const hasData = attrs.some(attr => attr.name.getText(source).startsWith('data-akari-'));
                const classValue = classAttr?.initializer && ts.isStringLiteral(classAttr.initializer)
                    ? classAttr.initializer.text.trim()
                    : classAttr?.initializer?.getText(source).trim() ?? '';
                const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
                assert.ok(classValue.includes('theia-button') || hasData || classValue.length > 0,
                    `${file}:${line} の button には共通段、data-akari-*、または自前クラスが必要`);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        assert.ok(count > 0, `${file} に検査対象の button がない`);
    });
}
