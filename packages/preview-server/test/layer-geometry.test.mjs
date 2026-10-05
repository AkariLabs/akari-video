import assert from 'node:assert/strict';
import test from 'node:test';
import {
  outputSizePx, cropOf, layerIntrinsicSize, perspectiveOf, layerRectForVideoRect,
  CROP_MIN, clampCrop, layerTransformOf, layerPerspectiveNow, perspectivePresetCorners,
} from '../public/layer-geometry.js';

const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];

test('layer-geometry cropOf keeps source-relative defaults and bounds', () => {
  const cases = [
    [{}, { x: 0, y: 0, w: 1, h: 1 }],
    [{ layerCropX: '0.1', layerCropY: '0.2', layerCropW: '0.8', layerCropH: '0.7' }, { x: 0.1, y: 0.2, w: 0.8, h: 0.7 }],
    [{ layerCropX: '0', layerCropY: '0', layerCropW: '0', layerCropH: '0' }, { x: 0, y: 0, w: 1, h: 1 }],
    [{ layerCropX: '-0.2', layerCropY: 'bad', layerCropW: '-1', layerCropH: '-2' }, { x: -0.2, y: 0, w: 1, h: 1 }],
    [{ layerCropW: 'NaN', layerCropH: 'NaN' }, { x: 0, y: 0, w: 1, h: 1 }],
  ];
  for (const [dataset, expected] of cases) assert.deepStrictEqual(cropOf({ dataset }), expected);
});

test('layer-geometry layerIntrinsicSize reads media dimensions', () => {
  const cases = [
    [{ videoWidth: 640, videoHeight: 360 }, { width: 640, height: 360 }],
    [{}, { width: 0, height: 0 }],
    [{ videoWidth: 'x' }, { width: 0, height: 0 }],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(layerIntrinsicSize(input), expected);
});

test('layer-geometry perspectiveOf accepts only four parsed corners', () => {
  const cases = [
    [{}, null],
    [{ layerPerspectiveCorners: '{bad' }, null],
    [{ layerPerspectiveCorners: '[[0,0],[1,0],[0,1]]' }, null],
    [{ layerPerspectiveCorners: JSON.stringify(corners) }, { corners }],
  ];
  for (const [dataset, expected] of cases) assert.deepStrictEqual(perspectiveOf({ dataset }), expected);
});

test('layer-geometry CROP_MIN stays at the authored boundary', () => {
  assert.strictEqual(CROP_MIN, 0.02);
});

test('layer-geometry clampCrop constrains width, height, and origin', () => {
  const cases = [
    [[-0.2, 1.3, 2, -1], { x: 0, y: 0.98, w: 1, h: 0.02 }],
    [[0.25, 0.5, NaN, Infinity], { x: 0, y: 0, w: 1, h: 1 }],
    [[1, 1, 0.02, 0.02], { x: 0.98, y: 0.98, w: 0.02, h: 0.02 }],
    [[0, 0, 0, 0], { x: 0, y: 0, w: 0.02, h: 0.02 }],
    [[-Infinity, Infinity, 0.4, 0.6], { x: 0, y: 0, w: 0.4, h: 0.6 }],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(clampCrop(...input), expected);
});

test('layer-geometry layerTransformOf reads zero and optional axis scales', () => {
  const cases = [
    [{}, { x: 0, y: 0, scale: 1, rotate: 0 }],
    [{ layerX: '12', layerY: '-7', layerScale: '0.5', layerScaleX: '0', layerScaleY: '1.5', layerRotate: '45' }, { x: 12, y: -7, scale: 0.5, scaleX: 0, scaleY: 1.5, rotate: 45 }],
    [{ layerX: 'NaN', layerScale: '0', layerRotate: 'bad' }, { x: 0, y: 0, scale: 1, rotate: 0 }],
  ];
  for (const [dataset, expected] of cases) assert.deepStrictEqual(layerTransformOf({ dataset }), expected);
});

test('layer-geometry layerPerspectiveNow reads valid corner arrays', () => {
  const cases = [
    [{}, null],
    [{ layerPerspectiveCorners: '{bad' }, null],
    [{ layerPerspectiveCorners: '[[0,0],[1,0],[0,1]]' }, null],
    [{ layerPerspectiveCorners: JSON.stringify(corners) }, corners],
  ];
  for (const [dataset, expected] of cases) assert.deepStrictEqual(layerPerspectiveNow({ dataset }), expected);
});

test('layer-geometry perspectivePresetCorners expands every side and angle', () => {
  const half30 = Math.sin(30 * Math.PI / 180) / 2;
  const half90 = 0.45;
  const cases = [
    [['right', 0], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['right', 30], [[0, 0], [1, half30], [0, 1], [1, 1 - half30]]],
    [['right', 90], [[0, 0], [1, half90], [0, 1], [1, 1 - half90]]],
    [['right', 'abc'], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['right', undefined], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['left', 0], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['left', 30], [[0, half30], [1, 0], [0, 1 - half30], [1, 1]]],
    [['left', 90], [[0, half90], [1, 0], [0, 1 - half90], [1, 1]]],
    [['left', 'abc'], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['left', undefined], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['top', 0], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['top', 30], [[half30, 0], [1 - half30, 0], [0, 1], [1, 1]]],
    [['top', 90], [[half90, 0], [1 - half90, 0], [0, 1], [1, 1]]],
    [['top', 'abc'], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['top', undefined], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['bottom', 0], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['bottom', 30], [[0, 0], [1, 0], [half30, 1], [1 - half30, 1]]],
    [['bottom', 90], [[0, 0], [1, 0], [half90, 1], [1 - half90, 1]]],
    [['bottom', 'abc'], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['bottom', undefined], [[0, 0], [1, 0], [0, 1], [1, 1]]],
    [['other', 0], null],
    [['other', 30], null],
    [['other', 90], null],
    [['other', 'abc'], null],
    [['other', undefined], null],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(perspectivePresetCorners(...input), expected);
});

test('layer-geometry outputSizePx retains source summary defaults', () => {
  const cases = [
    [undefined, { width: 1280, height: 720 }],
    [null, { width: 1280, height: 720 }],
    [{}, { width: 1280, height: 720 }],
    [{ output: {} }, { width: 1280, height: 720 }],
    [{ output: null }, { width: 1280, height: 720 }],
    [{ output: { width: 1920, height: 1080 } }, { width: 1920, height: 1080 }],
    [{ output: { width: 1080, height: 1920 } }, { width: 1080, height: 1920 }],
    [{ output: { width: 0, height: 0 } }, { width: 1280, height: 720 }],
    [{ output: { width: -1, height: -1 } }, { width: 1280, height: 720 }],
    [{ output: { width: 'abc', height: 'abc' } }, { width: 1280, height: 720 }],
    [{ output: { width: '640', height: '360' } }, { width: 640, height: 360 }],
    [{ output: { width: 800 } }, { width: 800, height: 720 }],
    [{ output: { height: 600 } }, { width: 1280, height: 600 }],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(outputSizePx(input), expected);
});

test('layer-geometry layerRectForVideoRect preserves rotation and output basis', () => {
  const rect = { x: 64, y: 18, w: 512, h: 324 };
  const origin = { x: 0, y: 0 };
  const cases = [
    [[undefined, { x: 0, y: 0, scale: 0.5, rotate: 0 }, { x: 0, y: 0, w: 640, h: 360 }, { x: 320, y: 180 }], { left: 480, top: 270, width: 320, height: 180, rotOffX: 0, rotOffY: 0 }],
    [[undefined, { x: 0, y: 0, scale: 1, scaleX: 0.75, scaleY: 1.25, rotate: 0 }, rect, origin], { left: 688, top: 382.5, width: 384, height: 405, rotOffX: 240, rotOffY: 225 }],
    [[undefined, { x: 0, y: 0, scale: 1, rotate: 90 }, rect, origin], { left: 204, top: 518, width: 512, height: 324, rotOffX: -179.99999999999997, rotOffY: 320 }],
    [[undefined, { x: 0, y: 0, scale: 1, rotate: 45 }, rect, origin], { left: 482.99494936611666, top: 551.5533905932738, width: 512, height: 324, rotOffX: 98.99494936611667, rotOffY: 353.5533905932738 }],
    [[undefined, { x: 0, y: 0, scale: 0.8, rotate: -30 }, rect, origin], { left: 728.9025033688163, top: 227.10765814495917, width: 409.6, height: 259.2, rotOffX: 293.7025033688163, rotOffY: -3.2923418550408172 }],
    [[{ output: { width: 1920, height: 1080 } }, { x: 120, y: -45, scale: 0.5, rotate: 0 }, rect, origin], { left: 1112, top: 504, width: 256, height: 162, rotOffX: 160, rotOffY: 90 }],
    [[{ output: { width: 1080, height: 1920 } }, { x: 0, y: 0, scale: 0.5, rotate: 0 }, rect, origin], { left: 572, top: 969, width: 256, height: 162, rotOffX: 160, rotOffY: 90 }],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(layerRectForVideoRect(...input), expected);
});
