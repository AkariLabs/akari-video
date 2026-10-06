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

test('one scale solver covers corners, edges, rotated boxes, item centres, canvas and 6px boundary', () => {
  const g = snapHarness().context.akariHandleGeometry;
  const canvas = { width: 1000, height: 600 };
  const at = scale => ({ left: 100, right: 100 + 100 * scale, top: 100, bottom: 200 });
  const other = box(210, 310, 100, 200);
  for (const gesture of ['corner', 'edge']) {
    const snap = g.snapScale({ scale: 1.05, at, others: [other], canvas });
    assert.equal(snap.snapX?.kind, 'item', gesture);
    assert.ok(Math.abs(snap.scale - 1.1) < 1e-9, gesture);
  }
  const centre = g.snapScale({ scale: 1.05, at, others: [box(125, 185, 100, 200)], canvas });
  assert.equal(centre.snapX?.target, 155);
  const edge = g.snapScale({ scale: 1.96, at, canvas: { width: 300, height: 600 } });
  assert.equal(edge.snapX?.target, 300);
  const inRange = g.snapScale({ scale: 1.04, at, others: [other], canvas });
  assert.equal(inRange.snapX?.target, 210);
  const outRange = g.snapScale({ scale: 1.03, at, others: [other], canvas });
  assert.equal(outRange.snapX, null);
  const angle = Math.PI / 6;
  const rotated = scale => {
    const points = [[0, 0], [100 * scale, 0], [0, 40], [100 * scale, 40]]
      .map(([x, y]) => ({ x: 250 + x * Math.cos(angle) - y * Math.sin(angle),
        y: 150 + x * Math.sin(angle) + y * Math.cos(angle) }));
    return { left: Math.min(...points.map(point => point.x)), right: Math.max(...points.map(point => point.x)),
      top: Math.min(...points.map(point => point.y)), bottom: Math.max(...points.map(point => point.y)) };
  };
  const right = rotated(1.1).right;
  const rotatedSnap = g.snapScale({ scale: 1.05, at: rotated,
    others: [box(right, right + 80, 0, 50)], canvas });
  assert.ok(Math.abs(rotatedSnap.scale - 1.1) < 1e-9);
});

test('every movable kind and gesture shares item targets within five pixels', () => {
  const kinds = ['html', 'shape', 'line', 'sticker', 'layer', 'cut', 'caption', 'text'];
  const gestures = ['move', 'corner', 'edge', 'group', 'mixed'];
  for (const kind of kinds) for (const gesture of gestures) {
    const h = snapHarness();
    const other = box(305, 405, 10, 110);
    h.context.setExtraSnapTargets(() => [other]);
    if (gesture === 'move' || gesture === 'group' || gesture === 'mixed') {
      assert.equal(h.snap(box(200, 300, 300, 400), null, { kind }).x?.target, 305,
        `${kind}/${gesture}`);
    } else {
      const solved = h.context.akariHandleGeometry.snapScale({ scale: 2,
        at: value => ({ left: 100, right: 100 + 100 * value, top: 300, bottom: 400 }),
        others: [other], canvas: { width: 1000, height: 600 } });
      assert.equal(solved.snapX?.target, 305, `${kind}/${gesture}`);
    }
  }
});

test('single-overlay corner path applies the shared scale correction', () => {
  const h = snapHarness();
  h.context.setExtraSnapTargets(() => [box(305, 405, 0, 100)]);
  const applied = [];
  Object.assign(h.context, {
    activeResize: { pointerId: 1, group: false, edge: null,
      container: { dataset: { role: 'shape' } }, overlayId: 'moving',
      anchorStageX: 100, anchorStageY: 300, draggedStageX: 200, draggedStageY: 400,
      pointerOffsetX: 0, pointerOffsetY: 0, rotation: 0,
      startScaleX: 1, startScaleY: 1, startBounds: box(100, 200, 300, 400),
      snapX: null, snapY: null },
    stageLocalPoint: (x, y) => ({ x, y }), isTelopOverlay: () => false,
    applyAxisResize: (_resize, x, y) => applied.push([x, y]),
    clampScale: value => value, showSnapGuides() {}, hideSnapGuides() {}
  });
  vm.runInContext(interaction.slice(interaction.indexOf('function computeAnchorResizeSnap('),
    interaction.indexOf('function applyResizeTransformAt(')), h.context);
  vm.runInContext(interaction.slice(interaction.indexOf('function updateResize('),
    interaction.indexOf('function cancelResize(')), h.context);
  h.context.updateResize({ pointerId: 1, clientX: 300, clientY: 500, cancelable: false });
  assert.ok(Math.abs(applied.at(-1)[0] - 2.05) < 1e-9);
  assert.equal(applied.at(-1)[0], applied.at(-1)[1]);
});

test('canvas target helper is only called by the central movement fallback', () => {
  assert.equal([...interaction.matchAll(/canvasSnapTargets\(/g)].length, 2);
  assert.match(interaction, /function snapTargetsFor\(moving = null\)/);
  assert.match(interaction, /function axisResizeSnap[\s\S]*?computeScaleSnap\(/);
});
