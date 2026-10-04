import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { readHandlerSource, sliceBetween, methodBody } from './helpers/handler-source.mjs';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const ts = require('typescript');
const source = readHandlerSource();
const method = methodBody('doConfigurePreview', { source });
const tableText = sliceBetween('const firstWinsMessages =', 'disposables.push(widget.onMessage(message => {', { source: method });
const parsed = ts.createSourceFile('handler.ts', source, ts.ScriptTarget.Latest, true);
const find = (node, predicate) => {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
};
const methodNode = find(parsed, node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === 'doConfigurePreview');
assert.ok(methodNode);
const table = methodNode.body.statements.find(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === 'firstWinsMessages'));
assert.ok(table);
const entries = table.declarationList.declarations[0].initializer.arguments[0].elements;
const callback = find(methodNode, node => ts.isArrowFunction(node) && ts.isCallExpression(node.parent)
  && node.parent.expression.getText(parsed) === 'widget.onMessage');
assert.ok(callback);
const expected = [
  'akari-preview-caption-edit-focus', 'akari-preview-context-box', 'akari-preview-photo-analyze',
  'akari-preview-photo-brush-end', 'akari-preview-photo-stroke', 'akari-preview-photo-click',
  'akari-preview-photo-hover', 'akari-preview-photo-select-end', 'akari-preview-capture-frame',
  'akari-preview-capture-busy', 'akari-preview-expand-bag', 'akari-preview-diagnostics',
  'akari-preview-raw-audio-request', 'akari-preview-gesture', 'akari-preview-live-values'
];
const keys = entries.map(entry => {
  const key = entry.elements[0];
  return ts.isIdentifier(key) ? 'akari-preview-context-box' : key.text;
});

function paths(statement) {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return new Set(['return']);
  if (ts.isBlock(statement)) {
    let states = new Set(['continue']);
    for (const child of statement.statements) {
      const next = new Set();
      for (const state of states) {
        if (state === 'return') next.add(state);
        else for (const result of paths(child)) next.add(result);
      }
      states = next;
    }
    return states;
  }
  if (ts.isIfStatement(statement)) return new Set([...paths(statement.thenStatement),
    ...(statement.elseStatement ? paths(statement.elseStatement) : ['continue'])]);
  return new Set(['continue']);
}

test('first-wins message table has exactly the 15 distinct expected types', () => {
  assert.match(tableText, /new Map<string, \(message: any\) => boolean>/u);
  assert.equal(entries.length, 15);
  assert.equal(new Set(keys).size, 15);
  assert.deepEqual([...keys].sort(), [...expected].sort());
  assert.equal(entries[1].elements[0].getText(parsed), 'PREVIEW_CONTEXT_BOX_MESSAGE');
});

test('first-wins types and diagnostics guard are absent from remaining receiver branches', () => {
  const remaining = callback.body.statements.slice(1).map(statement => statement.getText(parsed)).join('\n');
  for (const type of expected) assert.ok(!remaining.includes(type), type);
  assert.ok(!remaining.includes('isPreviewDiagnosticsReport'));
  for (const statement of callback.body.statements.slice(1)) {
    if (!ts.isIfStatement(statement)) continue;
    const outcome = paths(statement.thenStatement);
    assert.ok(!(outcome.size === 1 && outcome.has('return')), statement.expression.getText(parsed));
  }
});

test('receiver calls the table once in its first statement', () => {
  const first = callback.body.statements[0].getText(parsed);
  assert.equal(first, 'if (firstWinsMessages.get(message?.type)?.(message)) return;');
  assert.equal((callback.body.getText(parsed).match(/firstWinsMessages\.get\(message\?\.type\)\?\.\(message\)/gu) ?? []).length, 1);
});

test('every table entry returns true when handled and false when its condition misses', () => {
  for (const entry of entries) {
    const arrow = entry.elements[1];
    assert.equal(arrow.body.statements.length, 2);
    assert.ok(ts.isIfStatement(arrow.body.statements[0]));
    assert.match(arrow.body.statements[0].thenStatement.getText(parsed), /return true;/u);
    assert.equal(arrow.body.statements[1].getText(parsed), 'return false;');
  }
});
