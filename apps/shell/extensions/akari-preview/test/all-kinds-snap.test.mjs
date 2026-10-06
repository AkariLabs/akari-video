import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();

test('preview registers visible photo and caption bounds and excludes the moving item', () => {
  let provider;
  const layer = { spec: { id: 'photo' }, video: { isConnected: true,
    style: { display: '' }, hidden: false } };
  const caption = { caption: { id: 'caption' }, plate: { isConnected: true,
    style: { display: '' }, hidden: false } };
  const context = { layerEntries: [layer], captionRows: new Map([['caption', caption]]),
    layerVisualTransformNow: () => ({}),
    layerOutputBoundsForTransform: () => ({ left: 10, right: 110, top: 20, bottom: 70,
      centerX: 60, centerY: 45 }),
    cutInteractionSegment: () => null,
    captionVisualRect: () => ({ left: 200, right: 300, top: 100, bottom: 140 }),
    window: { akari: { interaction: { setExtraSnapTargets(fn) { provider = fn; } } } }
  };
  vm.createContext(context);
  const start = source.indexOf('window.akari.interaction?.setExtraSnapTargets?.(moving => {');
  const end = source.indexOf('const captionTransformValues =', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  assert.deepEqual(Array.from(provider(), item => item.centerX), [60, 250]);
  assert.deepEqual(Array.from(provider({ kind: 'layer', id: 'photo' }), item => item.centerX), [250]);
  assert.deepEqual(Array.from(provider({ kind: 'caption', id: 'caption' }), item => item.centerX), [60]);
  layer.video.style.display = 'none';
  assert.equal(provider().length, 1);
});

test('caption move snaps after the pointer stops for 96 ms', () => {
  let timer;
  let calls = 0;
  const plate = { style: { translate: '' } };
  const context = {
    pointerId: 1, cueId: 'caption', startClientX: 0, startClientY: 0, moved: false,
    CLICK_THRESHOLD_PX: 3, outputFrame: { width: 1000, height: 600 },
    startOutputPoint: { x: 0, y: 0 }, captionOutputPoint: (x, y) => ({ x, y }),
    groupMode: false, clampOn: false, captionSnapEnabled: true,
    startPlateRect: { left: 20, right: 120, top: 30, bottom: 70 },
    dragSnap: { x: null, y: null }, multiMove: false,
    startPlateTranslate: { x: 0, y: 0 }, captionPlate: plate,
    captionVisualRect: () => ({}), captionLayoutRect: () => ({}), updateCaptionSelectBoxForRect() {},
    setTimeout(fn, ms) { assert.equal(ms, 96); timer = fn; return 1; },
    clearTimeout() { timer = null; },
    window: { akari: { interaction: {
      computeSnapCorrection() { calls += 1; return { x: calls === 2 ? { correction: 3 } : null,
        y: null }; },
      showSnapGuides() {}, hideSnapGuides() {}
    } } }
  };
  vm.createContext(context);
  const start = source.indexOf('let settleTimer = null;', source.indexOf('const onCaptionPointerDown ='));
  const end = source.indexOf('let captionFinished = false;', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end) + '\nlet captionFinished = false;', context);
  vm.runInContext('onMove({ pointerId: 1, clientX: 97, clientY: 20, shiftKey: false });', context);
  assert.equal(calls, 1);
  assert.equal(typeof timer, 'function');
  const stopped = timer;
  timer = null;
  stopped();
  assert.equal(calls, 2);
  assert.equal(plate.style.translate, '100px 20px');
  assert.equal(timer, null);
});

test('caption corner and wrap handle use the shared scale solver', () => {
  const calls = [];
  const interaction = {
    computeAnchorResizeSnap(input) { calls.push(['corner', input.movingItem.kind]);
      return { scale: 2.05, snapX: { target: 305 }, snapY: null }; },
    computeScaleSnap(input) { calls.push(['wrap', input.movingItem.kind]);
      return { scale: input.scale + 5, snapX: { target: 305 }, snapY: null }; },
    hideSnapGuides() {}
  };
  const context = { kind: 'se', rect: { left: 100, right: 200, top: 100, bottom: 200 },
    layoutRect: {}, baseScale: 1, baseRotate: 0, now: {}, start: {}, cueId: 'caption',
    handleSnap: { x: null, y: null }, moveEvent: { metaKey: false, ctrlKey: false },
    captionCornerTransformFn: () => ({ left: 100, top: 100, width: 200, height: 200, scale: 2 }),
    window: { akari: { interaction } } };
  vm.createContext(context);
  const corner = source.indexOf('const next = captionCornerTransformFn(kind, layoutRect');
  const cornerEnd = source.indexOf('const outputWidth =', corner);
  assert.ok(corner >= 0 && cornerEnd > corner);
  vm.runInContext(source.slice(corner, cornerEnd) + '\nthis.cornerResult = next;', context);
  assert.equal(context.cornerResult.scale, 2.05);
  assert.deepEqual(calls[0], ['corner', 'caption']);

  Object.assign(context, { kind: 'e', patch: { wrapWidthPct: 20 },
    captionPlate: { style: { setProperty(name, value) { context.lastStyle = [name, value]; } } },
    captionVisualRect: () => ({ left: 100, right: 200, top: 100, bottom: 200 }) });
  const wrap = source.indexOf("if (kind === 'e' || kind === 'w') {", cornerEnd);
  const wrapEnd = source.indexOf('lastPatch = patch;', wrap);
  assert.ok(wrap >= 0 && wrapEnd > wrap);
  vm.runInContext(source.slice(wrap, wrapEnd), context);
  assert.equal(context.patch.wrapWidthPct, 21);
  assert.deepEqual(calls[1], ['wrap', 'caption']);
  context.kind = 'w';
  context.summary = { output: { width: 1000 } };
  context.patch = { wrapWidthPct: 20, cuePosition: { value: { position: { x: .1 } } } };
  context.captionPlate.style.getPropertyValue = () => '10%';
  vm.runInContext(source.slice(wrap, wrapEnd), context);
  assert.equal(context.patch.cuePosition.value.position.x, .095);
});

test('mixed selection snaps its union box and passes all moving IDs', () => {
  let received;
  const rows = [{ item: { kind: 'caption', id: 'caption' }, element: { style: {} },
    translate: { x: 0, y: 0 } },
  { item: { kind: 'layer', id: 'photo' }, element: { style: {} },
    translate: { x: 0, y: 0 } }];
  const context = { pointerId: 1, rows, moved: true, CLICK_THRESHOLD_PX: 3,
    origin: { x: 0, y: 0 }, delta: { x: 0, y: 0 }, dragSnap: { x: null, y: null },
    groupBounds: { left: 100, right: 300, top: 100, bottom: 250 },
    captionOutputPoint: (x, y) => ({ x, y }), captionVisualRect: () => ({}),
    captionLayoutRect: () => ({}),
    window: { akari: { interaction: {
      computeSnapCorrection(bounds, _previous, moving) {
        received = { bounds, moving }; return { x: { correction: 5, target: 305 }, y: null };
      }, showSnapGuides() {}, hideSnapGuides() {}
    } } } };
  vm.createContext(context);
  const start = source.indexOf('const move = next => {', source.indexOf('const groupBounds = outputRects.every(Boolean)'));
  const end = source.indexOf('let finished = false;', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end) + '\nthis.moveMixed = move;', context);
  context.moveMixed({ pointerId: 1, clientX: 0, clientY: 0, preventDefault() {} });
  assert.equal(received.bounds.right, 300);
  assert.deepEqual(Array.from(received.moving.ids), ['caption', 'photo']);
  assert.equal(rows[0].element.style.translate, '5px 0px');
});

test('photo and cut resize pass their own identity and visible bounds to the shared solver', () => {
  const layer = source.slice(source.indexOf('const startBounds = layerOutputBoundsForTransform(entry'),
    source.indexOf('const report = !options', source.indexOf('const startBounds = layerOutputBoundsForTransform(entry')));
  const cut = source.slice(source.indexOf('const startBounds = cutOutputBoundsForTransform(cutVisualTransformNow());'),
    source.indexOf('const photoCutPoint =', source.indexOf('const startBounds = cutOutputBoundsForTransform(cutVisualTransformNow());')));
  assert.match(layer, /computeAnchorResizeSnap\(\{[\s\S]*?startBounds,[\s\S]*?movingItem: \{ kind: 'layer'/);
  assert.match(cut, /computeAnchorResizeSnap\(\{[\s\S]*?startBounds,[\s\S]*?movingItem: \{ kind: 'cut'/);
});
