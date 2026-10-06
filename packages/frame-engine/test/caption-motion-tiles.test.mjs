import assert from 'node:assert/strict';
import test from 'node:test';
import { captionMotionTiles } from '../dist/timeline/caption-motion-tiles.js';
import { typewriterStepTiming } from '../../render-cut/src/caption-typewriter.mjs';

const plateRect = { x: 0, y: 0, width: 100, height: 60 };
const textureRect = { ...plateRect };
const rects = Array.from({ length: 7 }, (_, index) => [{
  x: 10 + (index < 4 ? index : index - 4) * 10,
  y: index < 4 ? 10 : 35,
  width: 8,
  height: 12,
}]);
const characters = rects.map((value, index) => ({ rects: value,
  ...typewriterStepTiming(7, index, .6, .6, 1) }));
const tilesAt = (localSeconds, options = {}) => captionMotionTiles({ plateRect, textureRect,
  characters, localSeconds, ...options });

test('typewriter entrance reveals whole grapheme rectangles and preserves line breaks', () => {
  assert.deepEqual(tilesAt(.3, { typewriterIn: true }).map(({ x, y }) => [x, y]),
    [[10, 10], [20, 10], [30, 10]]);
  assert.deepEqual(tilesAt(.61, { typewriterIn: true }).map(({ x, y }) => [x, y]),
    [[10, 10], [20, 10], [30, 10], [40, 10], [10, 35], [20, 35], [30, 35]]);
});

test('typewriter exit removes earlier graphemes and leaves the trailing line visible', () => {
  assert.deepEqual(tilesAt(.8, { typewriterOut: true }).map(({ x, y }) => [x, y]),
    [[20, 35], [30, 35]]);
  assert.deepEqual(tilesAt(.3, { typewriterIn: true, typewriterOut: true }).map(({ x, y }) => [x, y]),
    [[10, 10], [20, 10], [30, 10]]);
});

test('typewriter fractional opacity follows the shared 0.01 second CSS transition', () => {
  const second = characters[1];
  const tiles = tilesAt(second.inDelay + .005, { typewriterIn: true });
  assert.ok(Math.abs(tiles[1].opacity - .5) < 1e-10);
});

test('wipe and glitch clips intersect grapheme tiles in plate coordinates', () => {
  const wipe = tilesAt(.61, { typewriterIn: true,
    clip: { x: .25, y: 0, width: .5, height: 1 } });
  assert.deepEqual(wipe.map(({ x, y, width }) => [x, y, width]),
    [[25, 10, 3], [30, 10, 8], [40, 10, 8], [25, 35, 3], [30, 35, 8]]);
  const glitch = tilesAt(.61, { typewriterIn: true,
    slices: [{ x: 0, y: .5, width: 1, height: .5 }] });
  assert.deepEqual(glitch.map(({ x, y }) => [x, y]), [[10, 35], [20, 35], [30, 35]]);
});

test('plain sprite returns only the plate clip tile, with no clip fast path', () => {
  assert.equal(tilesAt(.5), null);
  assert.deepEqual(tilesAt(.5, { clip: { x: 0, y: .5, width: 1, height: .5 } }),
    [{ x: 0, y: 30, width: 100, height: 30 }]);
});
