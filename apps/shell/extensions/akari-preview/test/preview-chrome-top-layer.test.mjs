import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { previewMotionBoxHitAt, previewMotionGeometryTransform, previewMotionLiveItem } from '../lib/common/preview-motion-geometry.js';
import { previewChromeLocalPoint, previewChromeMenuOffset, previewChromeRectClear, placePreviewChromeToolbar, refreshPreviewChromeOnGeometryChange } from '../lib/common/preview-chrome-placement.js';
import { placePreviewLayerActions } from '../lib/common/preview-layer-action-placement.js';
import { previewSelectionHandlesStyle } from '../lib/browser/preview-selection-handles-style.js';
import { previewContextBarPageScript } from '../lib/browser/preview-context-bar-page.js';

const require = createRequire(import.meta.url);
const { evaluateItemMotion } = require('../../../../../packages/overlay-runtime/src/item-motion.js');
const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('every preview helper embedded with toString runs in an isolated scope', () => {
  const isolated = fn => new Function('return (' + fn.toString() + ')')();
  const viewport = { left: 0, top: 0, width: 400, height: 300 };
  const selection = { left: 150, top: 100, width: 100, height: 50 };
  assert.ok(isolated(placePreviewLayerActions)(viewport, selection, null));
  assert.deepEqual(isolated(previewMotionLiveItem)(
    { transform: { x: 0 }, keyframes: [{}] },
    { x: 10, y: 5, scale: 2, rotate: 30 }).transform,
    { x: 10, y: 5, scale: 2, rotate: 30 });
  assert.equal(isolated(previewMotionGeometryTransform)(
    { x: 0, y: 0, scale: 1, rotate: 0 },
    { x: 10, y: 5, scale: 2, rotate: 30 }).rotate, 30);
  assert.equal(isolated(previewMotionBoxHitAt)(
    { centerX: 0, centerY: 0, width: 20, height: 20, rotate: 0 }, { x: 1, y: 1 }), true);
  assert.deepEqual(isolated(previewChromeMenuOffset)(viewport, selection,
    { left: 140, top: 50, width: 120, height: 36 }), { x: 0, y: 0 });
  assert.deepEqual(isolated(previewChromeLocalPoint)(selection,
    { width: 100, height: 50 }, 0, 1, { x: 200, y: 125 }), { x: 50, y: 25 });
  assert.equal(isolated(previewChromeRectClear)(viewport,
    { left: 140, top: 50, width: 120, height: 36 }, [selection]), true);
  assert.ok(isolated(placePreviewChromeToolbar)(viewport, selection,
    { width: 120, height: 36 }));
  const refresh = { layer() {}, cut() {}, crop() {}, caption() {} };
  assert.equal(typeof isolated(refreshPreviewChromeOnGeometryChange)(null,
    viewport, viewport, refresh), 'string');
});

test('zoom, pan, and pane resize refresh every selection control once per geometry change', () => {
  const calls = { layer: 0, cut: 0, crop: 0, caption: 0 };
  const refresh = Object.fromEntries(Object.keys(calls).map(key => [key, () => { calls[key]++; }]));
  const pane = { left: 0, top: 0, width: 400, height: 300 };
  const stage = { left: 100, top: 50, width: 200, height: 100 };
  let key = refreshPreviewChromeOnGeometryChange(null, stage, pane, refresh);
  key = refreshPreviewChromeOnGeometryChange(key, stage, pane, refresh);
  assert.deepEqual(calls, { layer: 1, cut: 1, crop: 1, caption: 1 });
  key = refreshPreviewChromeOnGeometryChange(key, { ...stage, width: 260 }, pane, refresh);
  key = refreshPreviewChromeOnGeometryChange(key, { ...stage, left: 80, width: 260 }, pane, refresh);
  refreshPreviewChromeOnGeometryChange(key, { ...stage, left: 80, width: 260 },
    { ...pane, width: 350 }, refresh);
  assert.deepEqual(calls, { layer: 4, cut: 4, crop: 4, caption: 4 });
  assert.match(handler, /previousChromeGeometry = refreshPreviewChromeOnGeometryChangeFn\(\s*previousChromeGeometry, rect, viewport, chromeRefreshers\)/u);
  assert.match(handler, /cut: \(\) => updateCutSelectBox\(\)/u);
});

test('live scale and rotation replace saved and keyed geometry without losing parent motion', () => {
  const item = { at: 0, duration: 2, fps: 30,
    transform: { x: 0, y: 0, scale: 1, rotate: 0 },
    keyframes: [{ t: 0, transform: { scale: 1, rotate: 0 } },
      { t: 2, transform: { scale: 2, rotate: 30 } }] };
  const live = { x: 40, y: 20, scale: 1.6, rotate: 45 };
  const plain = previewMotionGeometryTransform(live,
    evaluateItemMotion(previewMotionLiveItem(item, live), 1));
  assert.equal(plain.scale, 1.6);
  assert.equal(plain.rotate, 45);
  assert.equal(plain.x, 40);
  const parent = { at: 0, duration: 2, fps: 30,
    transform: { x: 100, y: 50, scale: 2, rotate: 90 } };
  const animated = previewMotionGeometryTransform(live,
    evaluateItemMotion(previewMotionLiveItem(item, live), 1, [parent]));
  assert.equal(animated.scale, 3.2);
  assert.equal(animated.rotate, 135);
  assert.ok(Math.abs(animated.x - 60) < 1e-9);
  assert.ok(Math.abs(animated.y - 130) < 1e-9);
  assert.deepEqual(item.keyframes[1].transform, { scale: 2, rotate: 30 });
});

test('live geometry follows an unanimated item and retains its entrance motion', () => {
  const saved = { at: 0, duration: 4, fps: 30,
    transform: { x: 0, y: 0, scale: 1, rotate: 0 } };
  const live = { x: 12, y: 18, scale: 1.4, rotate: -25 };
  assert.deepEqual(previewMotionGeometryTransform(live,
    evaluateItemMotion(previewMotionLiveItem(saved, live), .5)),
    { ...live, scaleX: live.scale, scaleY: live.scale });
  const entrance = { ...saved, motion: { in: { preset: 'slide-up', duration: 30, amount: 100 } } };
  const visible = previewMotionGeometryTransform(live,
    evaluateItemMotion(previewMotionLiveItem(entrance, live), .5));
  assert.equal(visible.scale, live.scale);
  assert.equal(visible.rotate, live.rotate);
  assert.notEqual(visible.y, live.y);
});

test('floating controls stay in the viewport at top and bottom and invert frame rotation', () => {
  const viewport = { left: 0, top: 0, width: 400, height: 300 };
  assert.deepEqual(previewChromeMenuOffset(viewport,
    { left: 5, top: 5, width: 20, height: 20 },
    { left: -40, top: -30, width: 120, height: 28 }), { x: 44, y: 61 });
  const bottom = previewChromeMenuOffset(viewport,
    { left: 100, top: 275, width: 30, height: 20 },
    { left: 100, top: 320, width: 60, height: 24 });
  assert.equal(bottom.y, -75);
  const local = previewChromeLocalPoint(
    { left: 100, top: 100, width: 100, height: 50 },
    { width: 100, height: 50 }, 90, 1, { x: 150, y: 75 });
  assert.ok(Math.abs(local.x) < 1e-9);
  assert.ok(Math.abs(local.y - 25) < 1e-9);
});

test('caption toolbar is horizontal and avoids the selected frame and action buttons', () => {
  assert.match(handler, /#caption-select-box \.akari-caption-select-tools \{[^\n]*flex-wrap: nowrap; width: max-content;/u);
  const viewport = { left: 0, top: 0, width: 400, height: 200 };
  const anchor = { left: 150, top: 2, width: 100, height: 60 };
  const action = { left: 180, top: 75, width: 25, height: 25 };
  const toolbar = placePreviewChromeToolbar(viewport, anchor, { width: 120, height: 36 }, [action]);
  const overlaps = (a, b) => a.left < b.left + b.width && a.left + a.width > b.left
    && a.top < b.top + b.height && a.top + a.height > b.top;
  assert.equal(overlaps(toolbar, anchor), false);
  assert.equal(overlaps(toolbar, action), false);
  assert.ok(toolbar.left >= 0 && toolbar.left + toolbar.width <= viewport.width);
  assert.ok(toolbar.top >= 0 && toolbar.top + toolbar.height <= viewport.height);
});

test('a selected frame above the viewport still places its toolbar inside the pane', () => {
  const viewport = { left: 0, top: 0, width: 400, height: 300 };
  for (const top of [-24, -300]) {
    const toolbar = placePreviewChromeToolbar(viewport,
      { left: 180, top, width: 100, height: 40 }, { width: 120, height: 36 });
    assert.ok(toolbar.left >= 4 && toolbar.left + toolbar.width <= 396);
    assert.ok(toolbar.top >= 4 && toolbar.top + toolbar.height <= 296);
  }
});

test('run menu and palette avoid the toolbar, selected frame, and action buttons', () => {
  const viewport = { left: 0, top: 0, width: 600, height: 400 };
  const toolbar = { left: 200, top: 124, width: 140, height: 36 };
  const selection = { left: 230, top: 170, width: 80, height: 60 };
  const actions = [{ left: 240, top: 255, width: 25, height: 25 },
    { left: 268, top: 255, width: 25, height: 25 }];
  const overlaps = (a, b) => a.left < b.left + b.width && a.left + a.width > b.left
    && a.top < b.top + b.height && a.top + a.height > b.top;
  assert.equal(previewChromeRectClear(viewport,
    { left: 20, top: 20, width: 180, height: 100 }, [toolbar, selection, ...actions]), true);
  assert.equal(previewChromeRectClear(viewport,
    { left: 220, top: 125, width: 180, height: 100 }, [toolbar, selection, ...actions]), false);
  for (const size of [{ width: 180, height: 100 }, { width: 214, height: 180 }]) {
    const popup = placePreviewChromeToolbar(viewport, toolbar, size, [selection, ...actions]);
    assert.equal([toolbar, selection, ...actions].some(rect => overlaps(popup, rect)), false);
    assert.ok(popup.left >= 0 && popup.left + popup.width <= viewport.width);
    assert.ok(popup.top >= 0 && popup.top + popup.height <= viewport.height);
  }
});

test('fitting the toolbar clears a previous fixed position when the natural position fits', () => {
  const start = handler.indexOf('const fitCaptionSelectTools = () => {');
  const end = handler.indexOf('const syncRunSelection =', start);
  assert.ok(start >= 0 && end > start);
  const natural = { left: 140, top: 54, width: 120, height: 36 };
  const tools = { style: { left: '17px', top: '30px', bottom: 'auto' },
    getBoundingClientRect() { return this.style.left ? { ...natural, left: 157, top: 130 } : natural; } };
  const captionSelectBox = { style: { setProperty() {} },
    querySelector: () => tools, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 150, top: 100, width: 100, height: 40 }) };
  vm.runInNewContext(handler.slice(start, end) + 'fitCaptionSelectTools();', {
    captionSelectBox, currentRunSelection: () => null,
    previewPane: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) },
    previewStage: { offsetWidth: 400, getBoundingClientRect: () => ({ width: 400 }) },
    placePreviewChromeToolbarFn: placePreviewChromeToolbar
  });
  assert.deepEqual(tools.style, { left: '', top: '', bottom: '' });
});

test('selection chrome is outside the clipped stage and caption handles share that layer', () => {
  assert.match(handler, /document\.body\.appendChild\(previewChrome\)/u);
  assert.match(handler, /previewChrome\.appendChild\(element\)/u);
  assert.match(handler, /captionSelectBox\.appendChild\(handleBox\)/u);
  assert.match(handler, /captionSelectBox\.addEventListener\('pointerdown'/u);
  assert.match(handler, /previewChrome\.style\.transform = 'scale\('/u);
  assert.match(handler, /html\.akari-gen-capturing #preview-chrome-layer/u);
});

test('all transform classes hide the toolbar and busy report, and guides are orange', () => {
  assert.match(previewSelectionHandlesStyle,
    /body:is\(\.akari-caption-moving, \.akari-caption-transforming, \.akari-media-moving, \.akari-media-transforming\) :is\(#caption-select-box \.akari-caption-select-tools/u);
  assert.match(previewContextBarPageScript, /body\.contains\('akari-caption-transforming'\)/u);
  assert.match(previewContextBarPageScript, /pointerHeld/u);
  assert.match(previewSelectionHandlesStyle, /\.akari-interaction-snap-guide\[data-akari-interaction\] \{ position: fixed; background: #ff8b2c; \}/u);
  assert.match(previewSelectionHandlesStyle, /is-vertical[^\n]*#ff8b2c/u);
  assert.match(previewSelectionHandlesStyle, /is-horizontal[^\n]*#ff8b2c/u);
});
