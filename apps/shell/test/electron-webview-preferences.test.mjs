import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../node_modules/@theia/core/lib/electron-main/electron-main-application.js', import.meta.url), 'utf8');

test('main window webview setting retains every Theia default web preference', () => {
    const file = ts.createSourceFile('electron-main-application.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let defaults;
    function visit(node) {
        if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'getDefaultOptions') {
            const returned = node.body.statements.find(ts.isReturnStatement)?.expression;
            assert.ok(returned && ts.isObjectLiteralExpression(returned));
            const webPreferences = returned.properties.find(property => property.name?.getText(file) === 'webPreferences');
            assert.ok(webPreferences && ts.isPropertyAssignment(webPreferences));
            defaults = Object.fromEntries(webPreferences.initializer.properties.map(property => [
                property.name.getText(file), property.initializer.kind === ts.SyntaxKind.TrueKeyword
            ]));
            assert.match(returned.getText(file), /\.\.\.this\.config\.electron\?\.windowOptions/);
        }
        ts.forEachChild(node, visit);
    }
    visit(file);
    assert.ok(defaults, 'Theia getDefaultOptions webPreferences found');
    const actual = packageJson.theia.frontend.config.electron.windowOptions.webPreferences;
    assert.deepEqual(actual, { ...defaults, webviewTag: true });
    assert.equal(packageJson.theia.electron.windowOptions, undefined);
});
