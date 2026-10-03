import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { insertItem, indexEditV2Items } from '../lib/common/edit-v2-mutations.js';
import { initialTabFor, tabsForKind } from '../lib/browser/inspector/tab-model.js';
import { emptyFrameTransform } from '../lib/browser/inspector/frame-geometry.js';
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
const CommitWidget = new Function('edit_v2_mutations_1', 'akari_annotations_commands_2', 'frame_geometry_1', `return class { ${source.slice(commitStart, source.indexOf('    onStripPointerDown(', commitStart))} }`)
  ({ insertItem, indexEditV2Items }, { OPEN_AKARI_INSPECTOR_ID: 'akari.inspector.open' }, { emptyFrameTransform });
function commitFixture(service, tracks = [{ id: 'v', lane: 'visual', items: [] }]) {
  let doc = { version: 2, output: { fps: 30 }, sources: [], tracks };
  const before = JSON.stringify(doc), history = [], notices = [], commands = [];
  const uri = { toString: () => 'file:///fixture' };
  const widget = Object.assign(new CommitWidget(), {
    location: { root: uri, editUri: uri }, annotationsService: service,
    showNotice(message) { notices.push(message); },
    commands: { async executeCommand(id, options) { commands.push({ id, options, selection: widget.selection }); } },
    cutItemIds: [], timelineTreeRows: [], errorMessage: e => e.message,
    playhead: { style: {} }, percent: seconds => seconds * 10, requestSeek: async () => {},
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
test('successful frame moves the playhead to its frame-accurate start', async () => {
  const f = commitFixture({ createEmptyGenerationFrame: async () => ({ relativePath: 'assets/generated/frame.png' }) });
  f.widget.playhead = { style: {} };
  f.widget.percent = seconds => seconds * 10;
  f.widget.requestSeek = async (seconds, options) => { f.seeks = [...(f.seeks ?? []), { seconds, options }]; };
  await f.widget.commitEmptyFrame('v', { at: 37, duration: 30 }, 30);
  assert.equal(f.widget.playheadT, 37 / 30);
  assert.equal(f.widget.playhead.style.left, `${(37 / 30) * 10}%`);
  assert.deepEqual(f.seeks, [{ seconds: 37 / 30, options: { domain: 'output' } }]);
  assert.deepEqual(f.widget.selection, { kind: 'cut', index: 0 });
});
test('new frame above occupied video carries half-scale centered transform in edit v2', async () => {
  const f = commitFixture({ createEmptyGenerationFrame: async () => ({ relativePath: 'assets/generated/frame.png' }) }, [
    { id: 'v', lane: 'visual', items: [{ id: 'base', at: 0, duration: 90 }] },
    { id: 'v2', lane: 'visual', items: [] }
  ]);
  await f.widget.commitEmptyFrame('v2', { at: 30, duration: 30 }, 30);
  assert.deepEqual(f.doc.tracks[1].items[0].transform, { x: 0, y: 0, scale: 0.5 });
  assert.equal(f.history.length, 1);
});
test('planned empty frame opens home ahead of a saved video tab', () => {
  assert.equal(initialTabFor({ kind: 'cut', tabs: tabsForKind('cut', { src: 'frame.png', generationAvailable: true }),
    generationTodo: true, persisted: 'video', clipKey: 'new', previousClipKey: 'old' }), 'edit');
});
test('frame capture intercepts empty space and leaves clip listeners active', () => {
  assert.match(source, /if \(this.toolMode === 'frame' && !this.frameToolSelectionTarget\(event\)\)\s*this.onStripPointerDown\(event\);\s*}, true\)/);
  assert.match(method('onStripPointerDown', 'timelineSelectionFromElement'), /stopImmediatePropagation\(\)/);
  assert.match(source, /cancelFrameDraw\(\);\s*return;/);
});

test('frame mode click on an existing clip reaches its selection handler', () => {
  const start = source.indexOf('    installDragListeners(');
  const end = source.indexOf('    updateDragPreview(', start);
  assert.ok(start >= 0 && end > start);
  const Widget = new Function(`return class { ${source.slice(start, end)} }`)();
  const listeners = new Map();
  const clip = { style: {}, dataset: {}, addEventListener(type, listener) { listeners.set(type, listener); },
    setPointerCapture() {} };
  const widget = Object.assign(new Widget(), {
    toolMode: 'frame', dragListenerConfigs: new Map(), dragListenerInstalled: new Set(),
    expandedChipHitRect: () => ({}), trackIdOfDrag: () => 'v', isTrackLocked: () => false,
    createDragGhost: () => ({ remove() {} }), strip: { appendChild() {} },
    updateTrimAffordance() {}, cancelDrag() { this.dragState = undefined; },
    detectCutDoubleClick: () => false, selectionFromDragState: () => ({ kind: 'cut', index: 1 }),
    shouldToggleMultiSelection: () => false, applySelection(selection) { this.selection = selection; }
  });
  widget.installDragListeners(clip, () => ({ kind: 'cut-move', index: 1 }));
  const event = { button: 0, pointerId: 1, clientX: 20, clientY: 20,
    preventDefault() {}, stopPropagation() {} };
  listeners.get('pointerdown')(event);
  listeners.get('pointerup')(event);
  assert.deepEqual(widget.selection, { kind: 'cut', index: 1 });
  assert.equal(widget.toolMode, 'frame');
});

test('frame mode lets occupied targets select and starts drawing on empty space', () => {
  const begin = source.indexOf('    frameToolSelectionTarget(');
  const end = source.indexOf('    timelineSelectionFromElement(', begin);
  assert.ok(begin >= 0 && end > begin);
  class Target {
    constructor(occupied) { this.occupied = occupied; }
    closest() { return this.occupied ? {} : null; }
  }
  const Widget = new Function('Element', `return class { ${source.slice(begin, end)} }`)(Target);
  const widget = new Widget();
  widget.toolMode = 'frame';
  let selected = null, drawn = 0, stopped = 0;
  widget.beginFrameDraw = () => { drawn++; };
  const dispatch = target => {
    stopped = 0;
    const event = { target, button: 0, preventDefault() {}, stopImmediatePropagation() { stopped++; } };
    if (!widget.frameToolSelectionTarget(event)) widget.onStripPointerDown(event);
    if (!stopped && target.occupied) selected = 'clip';
    if (!stopped) widget.onStripPointerDown(event);
  };
  dispatch(new Target(true));
  assert.equal(selected, 'clip');
  assert.equal(drawn, 0);
  assert.equal(widget.toolMode, 'frame');
  dispatch(new Target(false));
  assert.ok(drawn > 0);
  assert.equal(widget.toolMode, 'frame');
});
