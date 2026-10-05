import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const geometry = readFileSync(new URL('../src/handle-geometry.js', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');

function snapHarness() {
  let now = 0;
  const context = {
    stage: { children: [] }, selectedOverlay: null, selectionMembers: () => [],
    isSelectable: () => true, fragmentVideoBounds: element => element.bounds,
    outputSize: () => ({ width: 1000, height: 600 }), currentDisplayScale: () => 1,
    performance: { now: () => now }, extraSnapTargets: null,
    SNAP_DISTANCE: 6, SNAP_RELEASE_DISTANCE: 6,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(geometry, context);
  vm.runInContext(interaction.slice(interaction.indexOf('function closestAxisSnap('),
    interaction.indexOf('function applyDragSnapping(')), context);
  return { context, tick: ms => { now += ms; },
    snap: (bounds, previous = null, moving = null) => context.computeSnapCorrection(bounds, previous, moving) };
}

const box = (left, right, top, bottom) => ({ left, right, top, bottom,
  centerX: (left + right) / 2, centerY: (top + bottom) / 2 });

test('thin line ink centre snaps to the canvas centre before its stroke edges', () => {
  const h = snapHarness();
  const result = h.snap(box(200, 800, 300, 306), null, { kind: 'line' });
  assert.equal(result.y?.target, 300);
  assert.equal(result.y?.sourceIndex, 1);
  assert.equal(result.y?.correction, -3);
  const edge = h.snap(box(200, 800, 290, 296), null, { kind: 'line' });
  assert.equal(edge.y?.sourceIndex, 2);
  assert.equal(edge.y?.correction, 4);
});

test('shape can snap to a photo edge and its centre supplied outside the overlay stage', () => {
  const h = snapHarness();
  h.context.setExtraSnapTargets(() => [box(303, 503, 100, 300)]);
  const edge = h.snap(box(202, 302, 410, 460));
  assert.equal(edge.x?.kind, 'item');
  assert.equal(edge.x?.target, 303);
  assert.equal(edge.x?.correction, 1);
  const centre = h.snap(box(354, 454, 410, 460));
  assert.equal(centre.x?.target, 403);
  assert.equal(centre.x?.correction, -1);
});

test('equal-size stage overlays align centres despite a nearby canvas centre guide', () => {
  const h = snapHarness();
  const other = box(452, 552, 130, 190);
  h.context.stage.children.push({ bounds: other });
  h.context.selectedOverlay = { bounds: box(450, 550, 110, 170) };
  const moving = box(450, 550, 110, 170);
  const snap = h.snap(moving, null, { kind: 'shape' });
  assert.equal(snap.x?.kind, 'item');
  assert.equal(snap.x?.sourceIndex, 1);
  assert.equal(snap.x?.target, 502);
  assert.equal(snap.x?.correction, 2);
  const heldCanvas = h.snap(moving, { x: { kind: 'canvas', sourceIndex: 1, target: 500 },
    y: null }, { kind: 'shape' });
  assert.equal(heldCanvas.x?.kind, 'item');
  assert.equal(heldCanvas.x?.correction, 2);
  const v = snapHarness();
  v.context.stage.children.push({ bounds: box(110, 170, 272, 332) });
  const vertical = v.snap(box(110, 170, 270, 330), null, { kind: 'shape' });
  assert.equal(vertical.y?.kind, 'item');
  assert.equal(vertical.y?.sourceIndex, 1);
  assert.equal(vertical.y?.target, 302);
  assert.equal(vertical.y?.correction, 2);
});

test('HTML text visible-frame centre snaps to another item edge and canvas centre', () => {
  const h = snapHarness();
  h.context.setExtraSnapTargets(() => [box(405, 505, 100, 200)]);
  const item = h.snap(box(350, 458, 410, 450), null, { kind: 'html' });
  assert.equal(item.x?.sourceIndex, 1);
  assert.equal(item.x?.target, 405);
  assert.equal(item.x?.correction, 1);
  const canvas = h.snap(box(446, 552, 410, 450), null, { kind: 'html' });
  assert.equal(canvas.x?.sourceIndex, 1);
  assert.equal(canvas.x?.target, 500);
  assert.equal(canvas.x?.correction, 1);
});

test('nearly full-frame photo chooses the nearest edge or centre, with an edge winning an exact tie', () => {
  const h = snapHarness();
  const nearerCentre = h.snap(box(0.4, 999.2, 100, 200), null, { kind: 'layer' });
  assert.equal(nearerCentre.x?.sourceIndex, 1);
  assert.equal(nearerCentre.x?.target, 500);
  const tie = h.snap(box(0.25, 999.25, 100, 200), null, { kind: 'layer' });
  assert.equal(tie.x?.sourceIndex, 0);
  assert.equal(tie.x?.target, 0);
});

test('fast text overlay movement rechecks the same pointer after 96 ms and cancels on next move', () => {
  const timers = new Map(); let nextTimer = 0; const applied = [];
  const drag = { pointerId: 1, startClientX: 0, startClientY: 0,
    startStagePoint: { x: 0, y: 0 }, startX: 0, startY: 0, moved: true };
  const context = { activeDrag: drag, pendingBlank: null, activeLine: null,
    activeRotate: null, activeResize: null, clickOrigin: null,
    dragStartDistance: 3, stageLocalPoint: (x, y) => ({ x, y }), stageScaleFactor: () => 1,
    scheduleHover() {}, reportLivePose() {},
    applyDragSnapping(_drag, x, y) { applied.push([x, y]); },
    setTimeout(fn, ms) { assert.equal(ms, 96); timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    globalThis: { akariHandleGeometry: { axisLock: (x, y) => ({ x, y }) } }
  };
  vm.createContext(context);
  vm.runInContext(interaction.slice(interaction.indexOf('function clearDragSettleTimer('),
    interaction.indexOf('function onPointerUp(')), context);
  const event = { pointerId: 1, clientX: 97, clientY: 20, cancelable: false };
  context.onPointerMove(event);
  assert.equal(timers.size, 1);
  const first = [...timers.values()][0];
  context.onPointerMove({ ...event, clientX: 98 });
  assert.equal(timers.size, 1);
  assert.equal(timers.has(1), false);
  assert.notEqual(first, [...timers.values()][0]);
  const second = [...timers.values()][0];
  timers.delete(2);
  second();
  assert.deepEqual(applied, [[97, 20], [98, 20], [98, 20]]);
  assert.equal(timers.size, 0);
});
