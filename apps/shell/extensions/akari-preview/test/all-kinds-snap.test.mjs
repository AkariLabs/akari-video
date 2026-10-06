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
