import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { elementAxes, elementPoint, elementHandlePoints, elementBoxSize, elementLocalDelta,
  elementAngle, elementHandleLayout, elementBoxCompanions } from '../src/element-geometry.mjs';

test('element geometry body is copied verbatim into interaction', () => {
  const source = readFileSync(new URL('../src/element-geometry.mjs', import.meta.url), 'utf8');
  const interaction = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
  const marked = text => text.slice(text.indexOf('// BEGIN element-geometry'),
    text.indexOf('// END element-geometry') + '// END element-geometry'.length);
  assert.equal(marked(interaction), marked(source));
});

test('axes, opposite points and local deltas retain rotated coordinates', () => {
  const axes = elementAxes({ x: 40, y: 20 }, { x: 40, y: 22 }, { x: 37, y: 20 });
  assert.deepEqual(axes, { x: { x: 0, y: 2 }, y: { x: -3, y: 0 } });
  const geometry = { center: { x: 40, y: 20 }, width: 20, height: 10, axes };
  assert.deepEqual(elementPoint(geometry, 1, -1), { x: 55, y: 40 });
  assert.deepEqual(elementHandlePoints(geometry, 'ne').anchor, { x: 25, y: 0 });
  assert.deepEqual(elementLocalDelta({ x: -9, y: 8 }, axes), { x: 4, y: 3 });
});

test('edge changes one axis, corners stay proportional unless Shift, minimum is four', () => {
  assert.deepEqual(elementBoxSize(40, 80, 'n', { x: 20, y: -30 }, false), { width: 40, height: 110 });
  assert.deepEqual(elementBoxSize(40, 80, 'se', { x: 20, y: 40 }, false), { width: 60, height: 120 });
  assert.deepEqual(elementBoxSize(40, 80, 'se', { x: 20, y: 10 }, true), { width: 60, height: 90 });
  assert.deepEqual(elementBoxSize(40, 80, 'nw', { x: 999, y: 999 }, true), { width: 4, height: 4 });
});

test('edge and both corner modes stop at 4px without flipping', () => {
  assert.deepEqual(elementBoxSize(40, 80, 'w', { x: 1000, y: 0 }, false),
    { width: 4, height: 80 });
  assert.deepEqual(elementBoxSize(40, 80, 'nw', { x: 1000, y: 1000 }, false),
    { width: 4, height: 8 });
  assert.deepEqual(elementBoxSize(40, 80, 'nw', { x: 1000, y: 1000 }, true),
    { width: 4, height: 4 });
  const proportional = elementBoxSize(40, 80, 'nw', { x: 1000, y: 1000 }, false);
  assert.equal(proportional.width / proportional.height, 40 / 80);
});

test('rotation snap and small handle layout', () => {
  assert.equal(elementAngle(32.4, false), 32.4);
  assert.equal(elementAngle(32.4, true), 30);
  assert.deepEqual(elementHandleLayout(24, 16), { hideHorizontalEdges: true,
    hideVerticalEdges: true, outsideX: true, outsideY: true,
    cornerOffsetX: 14, cornerOffsetY: 14, rotateTop: -32 });
});

test('companions only include properties needed for effective box dimensions', () => {
  assert.deepEqual(elementBoxCompanions({ boxSizing: 'content-box', display: 'inline', flex: '0 1 auto',
    minWidth: '50px', maxWidth: '100px', minHeight: '0px', maxHeight: 'none' },
  { display: 'flex' }, 40, 60), { 'box-sizing': 'border-box', display: 'inline-block',
    flex: '0 0 auto', 'min-width': '0px' });
  assert.deepEqual(elementBoxCompanions({ boxSizing: 'border-box', display: 'block', flex: '0 0 auto',
    minWidth: '0px', maxWidth: 'none', minHeight: '0px', maxHeight: 'none' },
  { display: 'block' }, 40, 60), {});
});

const boxStyle = { boxSizing: 'border-box', display: 'block', flex: '0 0 auto',
  minWidth: '0px', maxWidth: 'none', minHeight: '0px', maxHeight: 'none' };

test('max-width is cleared only when it blocks the requested width', () => {
  assert.deepEqual(elementBoxCompanions({ ...boxStyle, maxWidth: '30px' }, null, 40, null),
    { 'max-width': 'none' });
  assert.deepEqual(elementBoxCompanions({ ...boxStyle, maxWidth: '50px' }, null, 40, null), {});
});

test('min-height and max-height are cleared only when they block height', () => {
  assert.deepEqual(elementBoxCompanions({ ...boxStyle, minHeight: '60px' }, null, null, 40),
    { 'min-height': '0px' });
  assert.deepEqual(elementBoxCompanions({ ...boxStyle, maxHeight: '30px' }, null, null, 40),
    { 'max-height': 'none' });
});

test('inline-flex parent fixes flex while width-only ignores height constraints', () => {
  assert.deepEqual(elementBoxCompanions({ ...boxStyle, flex: '0 1 auto', minHeight: '60px',
    maxHeight: '30px' }, { display: 'inline-flex' }, 40, null), { flex: '0 0 auto' });
});

test('already effective companion properties add nothing', () => {
  assert.deepEqual(elementBoxCompanions(boxStyle, { display: 'flex' }, 40, 60), {});
});
