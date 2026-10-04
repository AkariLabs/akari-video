import assert from 'node:assert/strict';
import { readSourceFile, findMember, findTopLevelVariable } from './helpers/widget-source.mjs';
import test from 'node:test';
import ts from 'typescript';

const source = readSourceFile('widget').text;
const ast = readSourceFile('widget').ast;
const dispatch = findMember('dispatchPreviewEvent', { in: 'widget' }).node;
const bypassRequest = findMember('inspectorRequestAdjustBypass', { in: 'widget' }).node;
const constants = ['TIMELINE_ADJUST_BYPASS_EVENT', 'PREVIEW_ADJUST_BYPASS_QUERY_EVENT']
  .map(name => findTopLevelVariable(name, { in: 'widget' }).statement)
  .sort((a, b) => a.pos - b.pos);
// Run the complete bypass scope, including registration and disposal, from the real widget.
const start = source.indexOf('const onAdjustBypassQuery =');
const end = source.indexOf('this.toDispose.push(this.selectionModel.onChanged', start);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(`${constants.map(node => node.getText(ast)).join('\n')}
class Handler {
  ${dispatch.getText(ast)}
  ${bypassRequest.getText(ast)}
  init() {
    this.selectionModel.inspectorOwner = this;
    this.selectionModel.requestAdjustBypass = this.inspectorRequestAdjustBypass;
    ${source.slice(start, end)}
  }
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
