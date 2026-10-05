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

function marqueeState(hitCount) {
  const listeners = new Map();
  const items = Array.from({ length: hitCount }, (_, index) => ({
    id: `hit-${index}`,
    getBoundingClientRect: () => ({ left: 110 + index * 5, right: 120 + index * 5, top: 110, bottom: 125 })
  }));
  return {
    strip: {
      setPointerCapture() {},
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
      querySelectorAll: () => items,
      fire(type, event) { listeners.get(type)?.({ type, ...event }); }
    },
    toolMode: 'select',
    editDocument: { version: 2 },
    fps: 30,
    selectionMarquee: { style: { display: 'none' } },
    timelineOverlay: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    timeAtClientX: x => x / 10,
    timelineSelectionFromElement: element => ({ kind: 'item', id: element.id }),
    selectionKey: selection => selection?.id,
    selection: { kind: 'item', id: 'previous' },
    multiSelection: [],
    exitTrimmerModeUnlessSelected() {},
    pushSelectionSnapshot() {},
    applySelectionClass() {},
    publishPrimaryPreviewSelection() {},
    syncRightPane() {},
    clearMarqueeRange: method('clearMarqueeRange'),
    applySelection: method('applySelection'),
    onStripPointerDown: method('onStripPointerDown', {
      DRAG_THRESHOLD_PX: 3,
      canvasRangeFrames: (start, end) => ({ at: start * 30, duration: (end - start) * 30 })
    })
  };
}

function commitMarquee(state) {
  const pointer = (x, y) => ({ pointerId: 1, button: 0, clientX: x, clientY: y, target: new Element() });
  state.onStripPointerDown(pointer(100, 100));
  state.strip.fire('pointermove', pointer(140, 130));
  state.strip.fire('pointerup', pointer(140, 130));
}

test('releasing a marquee with three selected items hides its rectangle and keeps the range', () => {
  const state = marqueeState(3);
  commitMarquee(state);
  assert.deepEqual(state.multiSelection.map(item => item.id), ['hit-0', 'hit-1', 'hit-2']);
  assert.equal(state.selectionMarquee.style.display, 'none');
  assert.deepEqual(state.canvasRange, { at: 300, duration: 120 });
});

test('releasing a marquee with no hits hides its rectangle and keeps the range', () => {
  const state = marqueeState(0);
  commitMarquee(state);
  assert.equal(state.selection, undefined);
  assert.deepEqual(state.multiSelection, []);
  assert.equal(state.selectionMarquee.style.display, 'none');
  assert.deepEqual(state.canvasRange, { at: 300, duration: 120 });
});

test('right-clicking a committed empty range offers canvas creation with that range', () => {
  let menu;
  const state = marqueeState(0);
  state.openEmptyTimelineCanvasMenu = method('openEmptyTimelineCanvasMenu', {
    closeTimelineContextMenu() {},
    openTimelineContextMenu(options) { menu = options; }
  });
  const created = [];
  state.createCanvasAt = (...args) => { created.push(args); };
  commitMarquee(state);
  let prevented = false;
  state.openEmptyTimelineCanvasMenu({ clientX: 150, clientY: 130, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.ok(menu.items.some(item => item.id === 'create-canvas-range' && item.label === 'キャンバスを作る'));
  menu.onSelect('create-canvas-range');
  assert.deepEqual(created, [[10, 4]]);
  assert.equal(state.canvasRange, undefined);
});
