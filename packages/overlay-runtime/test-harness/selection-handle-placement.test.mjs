import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const begin = source.indexOf('// BEGIN selection-handle-placement');
const end = source.indexOf('// END selection-handle-placement');
assert.ok(begin >= 0 && end > begin);
const { selectionHandlePlacement, resizePointerOffset, rotation3dRingDistance } = vm.runInNewContext(
  `${source.slice(begin, end)}; ({ selectionHandlePlacement, resizePointerOffset, rotation3dRingDistance })`);
const visible = { left: 0, top: 0, width: 200, height: 160 };
const viewport = { left: 0, top: 0, width: 800, height: 600 };
const place = (rect, menu = null, controls = null, ringDistance = null) =>
  selectionHandlePlacement(rect, visible, visible, menu, controls, viewport, ringDistance);

test('corners and move button stay inside the visible output for every overflowing side', () => {
  for (const rect of [
    { left: 30, top: -80, width: 100, height: 150 },
    { left: 30, top: 90, width: 100, height: 150 },
    { left: -80, top: 30, width: 150, height: 100 },
    { left: 130, top: 30, width: 150, height: 100 },
  ]) {
    const result = place(rect);
    assert.ok(result);
    for (const point of [...Object.values(result.corners), result.move]) {
      assert.ok(point.x >= result.visible.left + 7 && point.x <= result.visible.right - 7);
      assert.ok(point.y >= result.visible.top + 7 && point.y <= result.visible.bottom - 7);
    }
  }
});

test('resize keeps the original opposite corner when the visible handle is displaced', () => {
  const rect = { left: -50, top: -40, width: 180, height: 160 };
  const result = place(rect);
  assert.deepEqual({ ...result.anchors.nw }, { x: 130, y: 120 });
  const pointer = result.corners.nw;
  const dragged = { x: rect.left, y: rect.top };
  const offset = resizePointerOffset(dragged, pointer, true);
  assert.deepEqual({ x: pointer.x + offset.x, y: pointer.y + offset.y }, dragged);
});

test('a fully visible frame retains its original control positions', () => {
  assert.equal(place({ left: 30, top: 30, width: 100, height: 80 }), null);
});

test('relocated controls clear the menu and lower control bar', () => {
  const menu = { left: 0, top: 0, width: 200, height: 24 };
  const controls = { left: 0, top: 145, width: 200, height: 15 };
  const result = place({ left: -30, top: -30, width: 260, height: 220 }, [menu], controls);
  for (const point of [...Object.values(result.corners), result.move]) {
    assert.ok(point.y >= 31);
    assert.ok(point.y <= 136);
  }
});

test('a frame overflowing above and below keeps four separate visible corners', () => {
  const result = place({ left: 40, top: -80, width: 90, height: 320 });
  assert.ok(result);
  const { nw, ne, se, sw } = result.corners;
  assert.ok(ne.x - nw.x >= 25);
  assert.ok(se.x - sw.x >= 25);
  assert.ok(sw.y - nw.y >= 25);
  assert.ok(se.y - ne.y >= 25);
  assert.equal(new Set(Object.values(result.corners).map(point => `${point.x},${point.y}`)).size, 4);
  assert.equal(result.move.x, 146.5);
});

test('corners and move button avoid separate top and bottom bars', () => {
  const bars = [
    { left: 0, top: 0, width: 200, height: 24 },
    { left: 0, top: 136, width: 200, height: 24 },
  ];
  const result = place({ left: 40, top: -80, width: 90, height: 320 }, bars);
  assert.ok(result);
  const { nw, ne, se, sw } = result.corners;
  assert.ok(nw.y >= 31 && ne.y >= 31);
  assert.ok(sw.y <= 129 && se.y <= 129);
  assert.ok(sw.y - nw.y >= 25 && se.y - ne.y >= 25);
  assert.equal(result.move.x, 146.5);
  assert.ok(result.move.y > 24 && result.move.y < 136);
});

test('an unavoidable bar does not push a corner across the frame', () => {
  const result = place({ left: 40, top: -80, width: 90, height: 320 },
    [{ left: 0, top: 0, width: 200, height: 90 }]);
  assert.equal(result.corners.nw.y, 7);
  assert.equal(result.corners.ne.y, 7);
  assert.ok(result.corners.sw.y - result.corners.nw.y >= 25);
});

test('move button finds a free gap when its first six positions meet bars', () => {
  const bars = [
    { left: 0, top: 0, width: 200, height: 24 },
    { left: 0, top: 50, width: 200, height: 60 },
    { left: 0, top: 136, width: 200, height: 24 },
  ];
  const result = place({ left: -30, top: -80, width: 260, height: 320 }, bars);
  assert.ok(result.move.y >= 36.5 && result.move.y <= 37.5);
});

test('a move button overlapping the Y ring uses another position only when ring avoidance is supplied', () => {
  const rect = { left: 40, top: -80, width: 90, height: 320 };
  const center = { x: 86.5, y: 80 };
  const distance = (x, y) => rotation3dRingDistance(x, y, center, 60);
  const ordinary = place(rect);
  assert.deepEqual({ ...ordinary.move }, { x: 146.5, y: 80 });
  assert.ok(distance(ordinary.move.x, ordinary.move.y) < 22.5);
  const avoided = place(rect, null, null, distance);
  assert.notDeepEqual({ ...avoided.move }, { ...ordinary.move });
  assert.ok(distance(avoided.move.x, avoided.move.y) >= 22.5);
  assert.ok(avoided.move.x >= 14.5 && avoided.move.x <= 185.5);
  assert.ok(avoided.move.y >= 14.5 && avoided.move.y <= 145.5);
});
