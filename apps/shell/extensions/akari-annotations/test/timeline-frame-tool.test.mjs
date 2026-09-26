import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { insertItem, indexEditV2Items } from '../lib/common/edit-v2-mutations.js';
import { initialTabFor, tabsForKind } from '../lib/browser/inspector/tab-model.js';
import { captionEditFocusWithinMarkedWidget } from '../lib/common/caption-edit-focus.js';

const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
function method(name, next) {
  return source.slice(source.indexOf(`    ${name}(`), source.indexOf(`    ${next}(`, source.indexOf(`    ${name}(`)));
}
// Actual window handler, including editable, IME and modifier guards.
const start = source.indexOf('const keydown = (event) => {');
const end = source.indexOf('\n        };', start) + '\n        };'.length;
const keydownCode = source.slice(start, end);
const createKeydown = new Function('document', 'review_tool_mode_1', 'caption_edit_focus_1', `${keydownCode}; return keydown;`);
for (const [key, mode] of [['v', 'select'], ['V', 'select'], ['c', 'razor'], ['f', 'frame'], ['a', 'select'], ['b', 'razor']]) {
  test(`key ${key} switches to ${mode}`, () => {
    const widget = { isAttached: true, toolMode: 'other', flushStripRender() {}, isEditableTarget: t => !!t?.editable,
      setToolMode(value) { this.toolMode = value; } };
    const handler = createKeydown.call(widget, { activeElement: null }, { isImeCompositionKeydown: e => e.isComposing }, { captionEditFocusWithinMarkedWidget });
    handler({ key, preventDefault() {}, stopPropagation() {} });
    assert.equal(widget.toolMode, mode);
  });
}
for (const changes of [{ key: 'c', metaKey: true }, { key: 'v', ctrlKey: true }, { key: 'f', metaKey: true },
  { key: 'f', altKey: true }, { key: 'f', isComposing: true }, { key: 'f', target: { editable: true } },
  { key: 'c', active: { editable: true } }]) {
  test(`shortcut guard ${JSON.stringify(changes)}`, () => {
    const widget = { isAttached: true, toolMode: 'select', flushStripRender() {}, isEditableTarget: t => !!t?.editable,
      copySelectedItem() {}, pasteClipboard() {}, setToolMode() { assert.fail('mode changed'); } };
    const handler = createKeydown.call(widget, { activeElement: changes.active }, { isImeCompositionKeydown: e => e.isComposing }, { captionEditFocusWithinMarkedWidget });
    handler({ preventDefault() {}, stopPropagation() {}, ...changes });
    assert.equal(widget.toolMode, 'select');
  });
}
const commitStart = source.indexOf('    async commitEmptyFrame(');
const CommitWidget = new Function('edit_v2_mutations_1', 'akari_annotations_commands_2', `return class { ${source.slice(commitStart, source.indexOf('    onStripPointerDown(', commitStart))} }`)
  ({ insertItem, indexEditV2Items }, { OPEN_AKARI_INSPECTOR_ID: 'akari.inspector.open' });
function commitFixture(service) {
  let doc = { version: 2, output: { fps: 30 }, sources: [], tracks: [{ id: 'v', lane: 'visual', items: [] }] };
  const before = JSON.stringify(doc), history = [], notices = [], commands = [];
  const uri = { toString: () => 'file:///fixture' };
  const widget = Object.assign(new CommitWidget(), {
    location: { root: uri, editUri: uri }, annotationsService: service,
    showNotice(message) { notices.push(message); },
    commands: { async executeCommand(id, options) { commands.push({ id, options, selection: widget.selection }); } },
    cutItemIds: [], timelineTreeRows: [], errorMessage: e => e.message,
    applySelection(selection) { this.selection = selection; },
    async commitEditMutation(label, mutate) {
      const old = doc; doc = mutate(doc); history.push({ label, undo: () => { doc = old; } });
      this.cutItemIds = doc.tracks[0].items.map(item => item.id);
    }
  });
  return { widget, before, history, notices, commands, get doc() { return doc; } };
}
test('PNG failure leaves edit and undo stack unchanged', async () => {
  const f = commitFixture({ createEmptyGenerationFrame: async () => { throw new Error('PNG failed'); } });
  await f.widget.commitEmptyFrame('v', { at: 30, duration: 75 }, 30);
  assert.equal(JSON.stringify(f.doc), f.before);
  assert.equal(f.history.length, 0);
  assert.deepEqual(f.notices, ['空の枠を置けません: PNG failed']);
  assert.equal(f.commands.length, 0);
});
test('PNG resolves before a single mutation; undo removes item and source together', async () => {
  let finish;
  const f = commitFixture({ createEmptyGenerationFrame: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.widget.commitEmptyFrame('v', { at: 30, duration: 75 }, 30);
  assert.equal(JSON.stringify(f.doc), f.before);
  finish({ relativePath: 'assets/generated/frame.png' }); await pending;
  assert.equal(f.history.length, 1);
  assert.equal(f.doc.sources.length, 1);
  assert.deepEqual(f.doc.tracks[0].items[0].source, { kind: 'media', src: 'frame-src-1', in: 0, out: 2.5 });
  assert.equal(f.doc.tracks[0].items[0].duration, 75);
  assert.deepEqual(f.widget.selection, { kind: 'cut', index: 0 });
  f.history[0].undo(); assert.equal(JSON.stringify(f.doc), f.before);
});
test('successful frame selects the item before revealing inspector without attachOnly or explicit tab', async () => {
  const f = commitFixture({ createEmptyGenerationFrame: async () => ({ relativePath: 'assets/generated/frame.png' }) });
  await f.widget.commitEmptyFrame('v', { at: 30, duration: 75 }, 30);
  assert.deepEqual(f.commands, [{ id: 'akari.inspector.open', options: undefined, selection: { kind: 'cut', index: 0 } }]);
  assert.deepEqual(f.notices, ['空の枠を置きました。']);
});
test('planned empty frame keeps a saved video tab', () => {
  assert.equal(initialTabFor({ kind: 'cut', tabs: tabsForKind('cut', { src: 'frame.png', generationAvailable: true }),
    generationTodo: true, persisted: 'video', clipKey: 'new', previousClipKey: 'old' }), 'video');
});
test('frame capture prevents clip listeners and is confined to frame mode', () => {
  assert.match(source, /if \(this.toolMode === 'frame'\)\s*this.onStripPointerDown\(event\);\s*}, true\)/);
  assert.match(method('onStripPointerDown', 'timelineSelectionFromElement'), /stopImmediatePropagation\(\)/);
  assert.match(source, /cancelFrameDraw\(\);\s*return;/);
});
