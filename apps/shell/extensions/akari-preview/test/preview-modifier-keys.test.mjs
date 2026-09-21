import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('all four native snap bypass guards use current move Alt, never Shift', () => {
  const guards = [...source.matchAll(/if \((moveEvent\.(?:altKey|shiftKey) \|\| !window\.akari\.interaction[^)]*)\)/g)].map(m => m[1]);
  assert.equal(guards.length, 4);
  for (const guard of guards) {
    const bypass = new Function('moveEvent', 'window', `return ${guard};`);
    const window = { akari: { interaction: { computeAnchorResizeSnap() {} } } };
    for (const [altKey, shiftKey, expected] of [[false, false, false], [true, false, true], [false, true, false], [true, true, true], [false, false, false]]) {
      assert.equal(bypass({ altKey, shiftKey }, window), expected);
    }
  }
});

test('layer rotation rounds the absolute angle only while move Shift is held', () => {
  const start = source.indexOf('beginMediaTransformDrag(layerDragTarget(entry), event, (moveEvent, original) => {', source.indexOf("if (kind === 'rotate')"));
  const callback = source.slice(start, source.indexOf('\n                        });', start) + '\n                        });'.length);
  const context = { center: { x: 0, y: 0 }, startAngle: 0, event: {}, entry: {}, layerDragTarget: v => v,
    beginMediaTransformDrag: (_target, _event, fn) => { context.rotate = fn; } };
  vm.runInNewContext(callback, context);
  for (const angle of [23, -23, 179, -179]) {
    const point = { clientX: Math.cos(angle * Math.PI / 180), clientY: Math.sin(angle * Math.PI / 180) };
    for (const shiftKey of [false, true, false]) {
      const value = context.rotate({ ...point, shiftKey }, { rotate: 4 }).rotate;
      assert.ok(Math.abs(value - (shiftKey ? Math.round((angle + 4) / 15) * 15 : angle + 4)) < 1e-9);
    }
  }
});

function eventSurface() {
  const handlers = new Map(), attrs = new Map(), styles = new Map();
  return { handlers, attrs, styles, textContent: '',
    addEventListener: (type, fn) => handlers.set(type, fn), removeEventListener: type => handlers.delete(type),
    getAttribute: key => attrs.get(key) ?? null, setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: key => attrs.delete(key), querySelector: () => null,
    classList: { add() {}, remove() {} }, focus() {},
    style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) }
  };
}

test('caption rotation live preview and persisted patch use the latest move Shift; Alt targets stay intact', async () => {
  for (const finalShift of [true, false]) {
    const window = eventSurface(), captionPlate = eventSurface(), writes = [];
    window.akari = { engine: { captionWrite: async (id, patch) => writes.push({ id, patch }) } };
    const context = { window, captionPlate, selectedCaptionIds: new Set(['c1']), captions: [{ id: 'c1' }, { id: 'c2' }],
      captionAltAll: false, selectCaption() {}, setCaptionGroupMode() {},
      captionHandleTargets: (_selected, id, all, alt) => alt ? all : [id],
      captionVisualRect: () => ({ left: -1, right: 1, top: -1, bottom: 1 }),
      captionOutputPoint: (x, y) => ({ x, y }), CLICK_THRESHOLD_PX: 0, selectionDragActive: false,
      captionHandleRotateValue: (_base, _center, _start, now) => now.x,
      updateCaptionSelectBoxForRect() {}, updateCaptionSelectBox() {}, pendingCaptionDragReload: false };
    vm.runInNewContext(between('            const beginCaptionHandleDrag =', "            captionPlate.addEventListener('pointerdown'") + '\nthis.begin = beginCaptionHandleDrag;', context);
    context.begin({ clientX: 0, clientY: 10, pointerId: 1, altKey: true, preventDefault() {}, stopPropagation() {} },
      { getAttribute: () => 'rot' }, { textStyle: {} }, 'c1');
    for (const shiftKey of [false, true, finalShift]) {
      window.handlers.get('pointermove')({ pointerId: 1, clientX: 23, clientY: 10, shiftKey });
      assert.equal(captionPlate.styles.get('--caption-rotate'), shiftKey ? '30deg' : '23deg');
    }
    window.handlers.get('pointerup')({ pointerId: 1 });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ id: 'c1', patch: {
      plateTransform: { captionIds: ['c1', 'c2'], rotate: finalShift ? 30 : 23 }
    } }]);
  }
});

test('existing caption Escape cancels without writes, ignores IME, keeps selection; Enter and blur save', async () => {
  const captionPlate = eventSurface(), writes = [], cue = { id: 'c1', text: 'Original' };
  const context = { captionPlate, captions: [cue], activeCaptionEdit: null, activeCaption: null, isPlaying: false,
    selectedCaptionId: 'c1', selectCaption() {}, deselectCaption() {}, outputTime: 1,
    renderCaption: () => { captionPlate.textContent = cue.text; },
    window: { getSelection: () => null, AkariEditKernel: { findActiveCaption: () => cue },
      akari: { engine: { captionWrite: async (id, patch) => writes.push({ id, patch }) } } } };
  vm.runInNewContext(between('            const restoreCaptionEditAttribute =', '            const beginCaptionHandleDrag =') + '\nthis.begin = beginCaptionEdit;', context);
  const key = (value, isComposing = false) => captionPlate.handlers.get('keydown')({ target: captionPlate,
    key: value, isComposing, preventDefault() {}, stopPropagation() {} });
  context.begin(cue); captionPlate.textContent = 'Changed'; key('Escape', true);
  assert.ok(context.activeCaptionEdit); assert.equal(captionPlate.textContent, 'Changed');
  key('Escape');
  assert.equal(context.activeCaptionEdit, null); assert.equal(captionPlate.textContent, 'Original');
  assert.equal(context.selectedCaptionId, 'c1'); assert.deepEqual(writes, []);
  captionPlate.handlers.get('blur')({ target: captionPlate }); assert.deepEqual(writes, []);
  for (const end of ['Enter', 'blur']) {
    context.begin(cue); captionPlate.textContent = end;
    if (end === 'Enter') key(end); else captionPlate.handlers.get('blur')({ target: captionPlate });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cue.text, end);
  }
  assert.equal(writes.length, 2);
});
