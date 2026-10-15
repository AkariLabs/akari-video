import assert from 'node:assert/strict';
import test from 'node:test';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decorator = () => () => {};
class BaseWidget {}
const stubs = {
  '@theia/core/lib/browser': { BaseWidget, open: () => {} },
  '@theia/core/lib/browser/dialogs': { AbstractDialog: class {}, ConfirmDialog: class {}, Dialog: {} },
  '@theia/core/lib/common': { CommandService: Symbol('CommandService'), nls: { localize: (_key, value) => value } },
  '@theia/core/lib/common/preferences': { PreferenceScope: { User: 0, Workspace: 1 } },
  '@theia/core/lib/common/quick-pick-service': {},
  '@theia/core/lib/common/uri': { default: class URI {} },
  '@theia/core/shared/inversify': { inject: decorator, injectable: decorator, postConstruct: decorator },
  '@theia/filesystem/lib/browser/file-service': {},
  '@theia/workspace/lib/browser/workspace-service': {},
  'akari-annotations/lib/browser/akari-edit-history-service': {},
  'akari-annotations/lib/browser/active-timeline': {},
  'akari-annotations/lib/common/akari-annotations-protocol': {},
  'akari-project/lib/common/akari-project-protocol': {}
};
const original = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.hasOwn(stubs, request)) return stubs[request];
  if (request.startsWith('@theia/') || request.startsWith('akari-annotations/')
    || request.startsWith('akari-project/')) return {};
  return original.call(this, request, parent, isMain);
};
let AkariDaihonWidget;
try { ({ AkariDaihonWidget } = require('../lib/browser/daihon/akari-daihon-widget.js')); }
finally { Module._load = original; }
const { readScriptLines } = require('../lib/common/daihon-script-lines.js');

const uri = { toString: () => '/project/planning/script.json' };
const before = readScriptLines({ version: 0, kind: 'akari-script', lines: [
  { id: 'p', kind: 'plan', at: 0, text: 'Before' }
] });
const after = readScriptLines({ version: 0, kind: 'akari-script', lines: [
  { id: 'p', kind: 'plan', at: 0, text: 'After' }
] });

test('script watcher echoes are ignored and external changes wait for inline editing to close', async () => {
  const widget = Object.create(AkariDaihonWidget.prototype);
  let source = JSON.stringify(before);
  let renders = 0;
  Object.assign(widget, { scriptUri: uri, scriptDocument: before, scriptReloadVersion: 0,
    scriptReloadPending: false, readText: async () => source, renderScriptLines: () => { renders++; } });
  await widget.reloadScriptLinesIfChanged();
  assert.equal(renders, 0);
  source = JSON.stringify(after);
  widget.scriptTextInput = {};
  await widget.reloadScriptLinesIfChanged();
  assert.equal(renders, 0);
  assert.equal(widget.scriptReloadPending, true);
  assert.equal(widget.scriptDocument.lines[0].text, 'Before');
  widget.scriptTextInput = undefined;
  widget.flushPendingScriptReload();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(renders, 1);
  assert.equal(widget.scriptDocument.lines[0].text, 'After');
});

test('mutation refuses existing invalid JSON before creating a temporary file', async () => {
  const widget = Object.create(AkariDaihonWidget.prototype);
  let writes = 0;
  const notices = [];
  Object.assign(widget, { scriptUri: uri, scriptWriteTail: Promise.resolve(),
    readText: async () => '{ "lines": [',
    fileService: { createFolder: async () => { writes++; }, writeFile: async () => { writes++; } },
    notifyError: message => notices.push(message) });
  await widget.mutateScript(document => document);
  assert.equal(writes, 0);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /JSON|Unexpected|Expected/u);
});

test('caption kind marker class is active only while script lines are visible', () => {
  const widget = Object.create(AkariDaihonWidget.prototype);
  const states = [];
  Object.assign(widget, { scriptUri: uri, scriptDocument: before, showScriptLines: true,
    rows: [], elements: new Map(), createScriptLine: () => ({}),
    rowsNode: { classList: { toggle: (_name, active) => states.push(active) },
      querySelectorAll: () => [], querySelector: () => null, appendChild() {} } });
  widget.renderScriptLines();
  widget.scriptDocument = readScriptLines(null);
  widget.renderScriptLines();
  widget.scriptDocument = before;
  widget.showScriptLines = false;
  widget.renderScriptLines();
  assert.deepEqual(states, [true, false, false]);
});
