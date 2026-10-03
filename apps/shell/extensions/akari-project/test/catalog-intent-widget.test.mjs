import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('akari-role-buckets-widget.tsx',
    readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
assert.ok(widget);
const member = name => widget.members.find(node => node.name?.getText(source) === name);
const calls = (node, expression) => {
    const found = [];
    const visit = child => {
        if (ts.isCallExpression(child) && child.expression.getText(source) === expression) found.push(child);
        ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
};

test('initial catalog load defaults to automatic and the backend receives the intent', () => {
    const initialize = member('init');
    const initialCalls = calls(initialize, 'this.loadAssetCatalogView');
    assert.ok(initialCalls.some(call => call.arguments.length === 0));
    assert.ok(initialCalls.every(call => call.arguments.length === 0 || call.arguments[0].getText(source) === "'automatic'"));
    const loader = member('loadAssetCatalogView');
    assert.match(loader.parameters[0].getText(source), /intent: 'automatic' \| 'user' = 'automatic'/);
    assert.equal(calls(loader, 'this.projectService.getAssetCatalogView')[0].arguments[1].getText(source), 'intent');
});

test('retry button and a user-opened library segment request user intent', () => {
    const retry = member('renderCatalogResolverRetry');
    assert.ok(retry, 'catalog retry renderer');
    assert.match(retry.getText(source), /data-akari-catalog-retry[\s\S]*?loadAssetCatalogView\('user'\)/);
    const select = member('selectTopView');
    assert.equal(calls(select, 'this.loadAssetCatalogView')[0].arguments[0].getText(source), "'user'");
    const controls = member('renderTopControls');
    assert.match(controls.getText(source), /data-akari-panel-segment=\{item\.view\}[\s\S]*?onClick=\{\(\) => this\.selectTopView\(item\.view\)\}/);
});
