import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');

function method(name, dependencies = {}) {
  const member = widget.members.find(node => node.name?.getText(ast) === name);
  assert.ok(member, name);
  const code = ts.transpileModule(`class Handler { ${member.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
  }).outputText;
  return new Function(...Object.keys(dependencies), `${code}\nreturn Handler.prototype.${name};`)(
    ...Object.values(dependencies));
}

globalThis.Element ??= class { closest() { return null; } };

function emitter() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    fire(type, event) { listeners.get(type)?.({ type, ...event }); },
    setPointerCapture() {},
    querySelectorAll: () => []
  };
}

function marqueeState() {
  const state = {
    selectionMarquee: { style: { display: 'block' } },
    canvasRange: { at: 20, duration: 30 },
    preserveMarqueeRange: false,
    selection: { kind: 'item', id: 'old' },
    multiSelection: [],
    selectedGap: undefined,
    playheadT: 0,
    visualPlaying: false,
    previewBagSelection: undefined,
    selectionKey: selection => selection?.id,
    exitTrimmerModeUnlessSelected() {},
    pushSelectionSnapshot() {},
    applySelectionClass() {},
    publishPrimaryPreviewSelection() {},
    syncRightPane() {},
    preparePhotoForSelection() {},
    revealOutputPreview() {},
    clearMarqueeRange: method('clearMarqueeRange'),
    applySelection: method('applySelection')
  };
  return state;
}

test('changing or clearing selection removes the marquee and canvas range', () => {
  for (const selection of [{ kind: 'item', id: 'other' }, undefined]) {
    const state = marqueeState();
    state.applySelection(selection);
    assert.equal(state.selectionMarquee.style.display, 'none');
    assert.equal(state.canvasRange, undefined);
  }
});

test('selection methods keep their three-argument and no-argument signatures', () => {
  assert.match(source, /protected applySelection\(selection: TimelineSelection, notifyPreview = true, directSingle = false\): void \{/u);
  assert.match(source, /protected pushSelectionSnapshot\(\): void \{/u);
});

test('selection snapshot preserves the range only during marquee commit', () => {
  const state = marqueeState();
  state.selectionModel = { inspectorOwner: {} };
  state.pushSelectionSnapshot = method('pushSelectionSnapshot');
  state.preserveMarqueeRange = true;
  state.pushSelectionSnapshot();
  assert.equal(state.selectionMarquee.style.display, 'block');
  assert.deepEqual(state.canvasRange, { at: 20, duration: 30 });
  state.preserveMarqueeRange = false;
  state.pushSelectionSnapshot();
  assert.equal(state.selectionMarquee.style.display, 'none');
  assert.equal(state.canvasRange, undefined);
});

test('a committed marquee retains its canvas range until another selection is made', () => {
  const state = marqueeState();
  state.strip = emitter();
  state.toolMode = 'select';
  state.editDocument = { version: 2 };
  state.fps = 30;
  state.timelineOverlay = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  state.timeAtClientX = x => x / 10;
  state.timelineSelectionFromElement = () => ({ kind: 'item', id: 'marquee-hit' });
  state.strip.querySelectorAll = () => [{ getBoundingClientRect: () => ({ left: 110, right: 130, top: 110, bottom: 125 }) }];
  state.onStripPointerDown = method('onStripPointerDown', {
    DRAG_THRESHOLD_PX: 3,
    canvasRangeFrames: (start, end) => ({ at: start, duration: end - start })
  });
  const pointer = (x, y) => ({ pointerId: 1, button: 0, clientX: x, clientY: y, target: new Element() });
  state.onStripPointerDown(pointer(100, 100));
  state.strip.fire('pointermove', pointer(140, 130));
  state.strip.fire('pointerup', pointer(140, 130));
  assert.equal(state.selectionMarquee.style.display, 'block');
  assert.deepEqual(state.canvasRange, { at: 10, duration: 4 });
  assert.equal(state.preserveMarqueeRange, false);
  state.applySelection({ kind: 'item', id: 'another' });
  assert.equal(state.selectionMarquee.style.display, 'none');
  assert.equal(state.canvasRange, undefined);
});

test('successful immediate multi deletion clears selection and its marquee', async () => {
  const state = marqueeState();
  state.location = { editUri: 'edit.json' };
  state.editDocument = { version: 2 };
  state.multiSelection = [{ kind: 'layer', id: 'one' }, { kind: 'layer', id: 'two' }];
  state.linkedPairForSelection = () => undefined;
  state.isTrackLocked = () => false;
  state.trackIdOfSelection = () => 'v1';
  state.commitImmediateItemMutation = async () => {};
  state.selectionModel = { inspectorOwner: {} };
  state.pushSelectionSnapshot = method('pushSelectionSnapshot');
  state.performDeleteMultiSelected = method('performDeleteMultiSelected');
  state.footer = { textContent: '' };
  await state.performDeleteMultiSelected();
  assert.deepEqual(state.multiSelection, []);
  assert.equal(state.selection, undefined);
  assert.equal(state.selectionMarquee.style.display, 'none');
  assert.equal(state.canvasRange, undefined);
});

test('Escape clears a range even when no item is selected', () => {
  let keydown;
  const visit = node => {
    if (!keydown && ts.isVariableDeclaration(node) && node.name.getText(ast) === 'keydown') keydown = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(widget);
  assert.ok(keydown);
  const code = ts.transpileModule(`function create() { return ${keydown.getText(ast)}; }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
  }).outputText;
  class HTMLElement { closest() { return null; } }
  const body = new HTMLElement();
  const document = { body, activeElement: body, querySelectorAll: () => [] };
  const state = marqueeState();
  state.selection = undefined;
  state.isAttached = true;
  state.focusScope = { rootId: null };
  state.node = { contains: () => false };
  state.isEditableTarget = () => false;
  const create = new Function('document', 'HTMLElement', 'isImeCompositionKeydown',
    'captionEditFocusWithinMarkedWidget', `${code}\nreturn create;`)(
    document, HTMLElement, () => false, () => false);
  const keydownHandler = create.call(state);
  let prevented = false;
  keydownHandler({ key: 'Escape', target: body,
    preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  assert.equal(state.selectionMarquee.style.display, 'none');
  assert.equal(state.canvasRange, undefined);
});

test('range clearing also works without a marquee element', () => {
  const state = marqueeState();
  state.selectionMarquee = undefined;
  state.clearMarqueeRange();
  assert.equal(state.canvasRange, undefined);
});

test('reload and both successful deletion paths clear stale selection state', () => {
  const reload = source.slice(source.indexOf('protected async reloadEdit('),
    source.indexOf('protected async reloadEdit(') + 400);
  assert.match(reload, /clearMarqueeRange\(\)/u);
  const deletion = source.slice(source.indexOf('protected async performDeleteMultiSelected('),
    source.indexOf('protected async performDeleteMultiSelected(') + 9000);
  assert.match(deletion, /await this\.commitImmediateItemMutation[\s\S]*?this\.multiSelection = \[\];[\s\S]*?this\.selection = undefined;[\s\S]*?this\.pushSelectionSnapshot\(\)/u);
  assert.match(deletion, /if \(immediateCaptions\)[\s\S]*?this\.multiSelection = \[\];[\s\S]*?this\.selection = undefined;[\s\S]*?this\.pushSelectionSnapshot\(\)/u);
});
