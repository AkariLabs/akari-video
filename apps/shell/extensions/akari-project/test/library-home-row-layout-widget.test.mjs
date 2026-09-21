import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test('ホームのカテゴリ行は4つの子の列・行を固定し、件数を右端に配置する', () => {
    const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
    assert.ok(widget, 'AkariRoleBucketsWidget が存在する');
    const method = widget.members.find(member => member.name?.getText(source) === 'renderLibraryCategoryRow');
    assert.ok(method?.body, 'renderLibraryCategoryRow が存在する');
    const statement = method.body.statements.find(ts.isReturnStatement);
    assert.ok(statement?.expression, 'カテゴリ行を返す');
    let button = statement.expression;
    while (ts.isParenthesizedExpression(button)) button = button.expression;
    assert.ok(ts.isJsxElement(button));
    assert.equal(button.openingElement.tagName.getText(source), 'button');
    const children = button.children.filter(child => !(ts.isJsxText(child) && !child.text.trim()));
    assert.equal(children.length, 4, 'button 直下の JSX 子要素は4つ');
    const expected = [
        ['category.icon', '1', '1 / span 2'],
        ['category.label', '2', '1'],
        ['category.hint', '2', '2'],
        ["soon ? '近日' : count", '3', '1 / span 2']
    ];
    children.forEach((child, index) => {
        assert.ok(ts.isJsxElement(child));
        const [content, column, row] = expected[index];
        assert.equal(child.children.map(node => node.getText(source)).join(''), `{${content}}`);
        const style = child.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'style');
        assert.ok(style?.initializer && ts.isJsxExpression(style.initializer));
        const object = style.initializer.expression;
        assert.ok(object && ts.isObjectLiteralExpression(object));
        const value = name => {
            const property = object.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(source) === name);
            assert.ok(property, `${content} の style に ${name} がある`);
            assert.ok(ts.isStringLiteral(property.initializer));
            return property.initializer.text;
        };
        assert.equal(value('gridColumn'), column, `${content} の列`);
        assert.equal(value('gridRow'), row, `${content} の行`);
        if (index === 3) {
            assert.equal(value('justifySelf'), 'end');
            assert.equal(value('fontVariantNumeric'), 'tabular-nums');
        }
    });
});
