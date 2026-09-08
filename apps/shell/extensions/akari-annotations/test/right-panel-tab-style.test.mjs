import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const sourceText = readFileSync(new URL('../src/browser/right-panel-tab-style.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('right-panel-tab-style.ts', sourceText, ts.ScriptTarget.Latest, true);

test('#shell-tab-akari-review-panel-widget has no individual CSS margin or margin-top', () => {
    const declaration = source.statements.filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations])
        .find(node => node.name.getText(source) === 'RIGHT_PANEL_TAB_STYLE_CSS');
    assert.ok(declaration?.initializer, 'style export');
    assert.ok(ts.isStringLiteral(declaration.initializer) || ts.isNoSubstitutionTemplateLiteral(declaration.initializer));
    // このスタイルは注釈タブ専用。margin: 0 で上書きせず、共通のタブ間隔をそのまま使う。
    assert.doesNotMatch(declaration.initializer.text, /\bmargin(?:-[\w-]+)?\s*:/i);
    const code = ts.createPrinter({ removeComments: true }).printFile(source);
    assert.doesNotMatch(code, /--akari-review-tab-margin-top|applyReviewTabMarginTop|watchReviewTabCentering/);
    assert.doesNotMatch(code, /\.style\b|\b(?:ResizeObserver|MutationObserver)\b/);
});

test('installer retains its exported LuminoUpdatable signature', () => {
    const installer = source.statements.find(node => ts.isFunctionDeclaration(node)
        && node.name?.text === 'installRightPanelTabStyle');
    assert.ok(installer?.modifiers?.some(node => node.kind === ts.SyntaxKind.ExportKeyword));
    assert.equal(installer.parameters.length, 1);
    assert.equal(installer.parameters[0].name.getText(source), 'tabBar');
    assert.equal(installer.parameters[0].type.getText(source), 'LuminoUpdatable');
    assert.equal(installer.type.getText(source), 'void');
    const updatable = source.statements.find(node => ts.isInterfaceDeclaration(node)
        && node.name.text === 'LuminoUpdatable');
    assert.ok(updatable?.modifiers?.some(node => node.kind === ts.SyntaxKind.ExportKeyword));
});
