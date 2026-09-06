import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('akari-annotations-widget.ts', source, ts.ScriptTarget.Latest, true);
const widgetClass = ast.statements.find(statement => ts.isClassDeclaration(statement)
  && statement.members.some(member => member.name?.getText(ast) === 'dispatchPreviewEvent'));
const dispatch = widgetClass.members.find(member => member.name?.getText(ast) === 'dispatchPreviewEvent');
const constants = ast.statements.filter(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration =>
    ['TIMELINE_ADJUST_BYPASS_EVENT', 'PREVIEW_ADJUST_BYPASS_QUERY_EVENT'].includes(declaration.name.getText(ast))));
// Run the complete bypass scope, including registration and disposal, from the real widget.
const start = source.indexOf('let bypass: AdjustBypassRequest | undefined;');
const end = source.indexOf('const requestKeyframe =', start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(`${constants.map(node => node.getText(ast)).join('\n')}
class Handler {
  ${dispatch.getText(ast)}
  init() { ${source.slice(start, end)} }
}`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;

function fixture() {
  const window = new EventTarget();
  const disposables = [];
  const events = [];
  window.addEventListener('akari.timeline.adjustBypass', event => events.push(event.detail));
  const Handler = new Function('window', 'CustomEvent', 'Disposable', `${code}\nreturn Handler;`)(
    window, CustomEvent, { create: dispose => ({ dispose }) }
  );
  const context = new Handler();
  context.selectionModel = {};
  context.location = { editUri: { toString: () => 'file:///project/edit.json' } };
  context.toDispose = { push: disposable => disposables.push(disposable) };
  context.init();
  return {
    context, events,
    query: () => window.dispatchEvent(new CustomEvent('akari.preview.adjustBypassQuery', {
      detail: { key: 'file:///project/edit.json' }
    })),
    dispose: () => disposables.forEach(disposable => disposable.dispose()),
  };
}

test('query replays the current bypass target through the real preview event dispatcher', () => {
  const { context, events, query } = fixture();
  for (const target of [{ kind: 'cut', index: 1 }, { kind: 'item', id: 'item-a' }]) {
    context.selectionModel.requestAdjustBypass({ target, enabled: true });
    events.length = 0;
    query();
    assert.deepEqual(events, [{ editUri: 'file:///project/edit.json', target, enabled: true }]);
  }
});

test('query emits nothing without bypass, including after A/B is disabled', () => {
  const { context, events, query } = fixture();
  query();
  assert.deepEqual(events, []);
  const target = { kind: 'cut', index: 0 };
  context.selectionModel.requestAdjustBypass({ target, enabled: true });
  context.selectionModel.requestAdjustBypass({ target, enabled: false });
  events.length = 0;
  query();
  assert.deepEqual(events, []);
});

test('dispose removes the query listener even when another owner keeps bypass state alive', () => {
  const { context, events, query, dispose } = fixture();
  context.selectionModel.requestAdjustBypass({ target: { kind: 'cut', index: 0 }, enabled: true });
  // Prevent the existing ownership cleanup from clearing bypass; silence must come from removal.
  context.selectionModel.requestAdjustBypass = () => {};
  dispose();
  events.length = 0;
  query();
  assert.deepEqual(events, []);
});
