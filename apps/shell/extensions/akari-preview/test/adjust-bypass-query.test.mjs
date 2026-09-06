import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('akari-preview-open-handler.ts', source, ts.ScriptTarget.Latest, true);
const handlerClass = ast.statements.find(statement => ts.isClassDeclaration(statement)
  && statement.members.some(member => member.name?.getText(ast) === 'getOrOpenPreview'));
const names = ['getOrOpenPreview', 'withOpenTimeout', 'discardPreviewWidget'];
const methods = names.map(name => {
  const method = handlerClass.members.find(member => member.name?.getText(ast) === name);
  assert.ok(method, name);
  return method.getText(ast);
});
const constants = ast.statements.filter(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => [
    'PREVIEW_ADJUST_BYPASS_QUERY_EVENT', 'TIMELINE_ADJUST_BYPASS_EVENT',
    'PREVIEW_OPEN_ATTEMPTS', 'PREVIEW_OPEN_TIMEOUT_MS',
  ].includes(declaration.name.getText(ast))));
const start = source.indexOf('const onAdjustBypass =');
const end = source.indexOf('registerTimelineSetting<', start);
assert.ok(start >= 0 && end > start);
// Execute the actual open lifecycle and unchanged bypass listener without starting Theia's UI.
const code = ts.transpileModule(`${constants.map(node => node.getText(ast)).join('\n')}
class Handler {
  ${methods.join('\n')}
  listen() { ${source.slice(start, end)} }
}`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;

function fixture() {
  const window = new EventTarget();
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  const Handler = new Function('window', 'CustomEvent', 'URI', 'WebviewWidget', `${code}\nreturn Handler;`)(
    window, CustomEvent, URI, { FACTORY_ID: 'webview' }
  );
  const context = new Handler();
  context.openOutputPreviews = new Map();
  context.openPreviews = new Map();
  context.pendingOutputInitialSeek = new Map();
  context.lifecycleDisposables = [];
  context.retryWidgetSequence = 0;
  context.hash = value => value;
  context.disposePreviewStreams = async () => {};
  const widgets = [];
  const order = [];
  context.widgetManager = {
    getOrCreateWidget: async () => {
      const widget = {
        isAttached: false, isDisposed: false, messages: [],
        sendMessage(message) { this.messages.push(message); },
        dispose() { this.isDisposed = true; this.isAttached = false; },
      };
      widgets.push(widget);
      return widget;
    },
  };
  context.configurePreview = async (widget, uri, kind) => {
    const previews = kind === 'output' ? context.openOutputPreviews : context.openPreviews;
    previews.set(uri.normalizePath().toString(), widget);
    // Match refreshPreview: summary is only available at the end of async configuration.
    await Promise.resolve();
    widget.akariPreviewSummary = { cuts: [{ id: 'cut-a' }, { id: 'cut-b' }] };
    widget.akariPreviewConfigured = true;
    order.push('summary');
  };
  context.shell = { addWidget: widget => { widget.isAttached = true; order.push('attach'); } };
  context.listen();
  const queries = [];
  window.addEventListener('akari.preview.adjustBypassQuery', event => {
    queries.push(event.detail);
    order.push('query');
  });
  const uri = new URI('file:///project/sub/../edit.json');
  const key = uri.normalizePath().toString();
  return {
    context, window, uri, key, queries, widgets, order,
    open: (kind = 'output') => context.getOrOpenPreview(uri, { area: 'main' }, kind),
  };
}

test('new output widget queries once after summary and attach; reuse and reattach do not query', async () => {
  const { open, queries, order, key } = fixture();
  const widget = await open();
  assert.deepEqual(order, ['summary', 'attach', 'query']);
  assert.deepEqual(queries, [{ key }]);
  assert.equal(key, 'file:///project/edit.json');
  assert.equal(await open(), widget);
  widget.isAttached = false;
  assert.equal(await open(), widget);
  assert.equal(widget.isAttached, true);
  assert.deepEqual(queries, [{ key }]);
  widget.dispose();
  assert.notEqual(await open(), widget);
  assert.deepEqual(queries, [{ key }, { key }]);
});

test('raw preview does not query adjust bypass', async () => {
  const { open, queries } = fixture();
  assert.equal((await open('raw')).isAttached, true);
  assert.deepEqual(queries, []);
});

test('query reply restores cut ID and webview postMessage when output is opened and recreated', async () => {
  const { open, window, uri, queries } = fixture();
  const target = { kind: 'cut', index: 1 };
  const reply = enabled => window.dispatchEvent(new CustomEvent('akari.timeline.adjustBypass', {
    detail: { editUri: uri.toString(), target, enabled }
  }));
  window.addEventListener('akari.preview.adjustBypassQuery', () => reply(true));
  const first = await open();
  assert.deepEqual([...first.akariPreviewAdjustBypassIds], ['cut-b']);
  assert.deepEqual(first.messages, [{ type: 'akari-preview-adjust-bypass', target, enabled: true }]);
  first.dispose();
  const reopened = await open();
  assert.notEqual(reopened, first);
  assert.equal(queries.length, 2);
  assert.deepEqual([...reopened.akariPreviewAdjustBypassIds], ['cut-b']);
  assert.deepEqual(reopened.messages, [{ type: 'akari-preview-adjust-bypass', target, enabled: true }]);
  reply(false);
  assert.deepEqual([...reopened.akariPreviewAdjustBypassIds], []);
  assert.deepEqual(reopened.messages.at(-1), { type: 'akari-preview-adjust-bypass', target, enabled: false });
});
