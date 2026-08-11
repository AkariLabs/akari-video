import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCutStartEnds,
  mapSourceTimeToTimeline,
  cutHasDefaultFraming,
  letterboxContainTransform,
  coverFitLayer,
} from '../bin/finger-frame/timeline-map.mjs';

test('resolveCutStartEnds: 明示 at の無い逐次カットは累積で並ぶ（transition_out 無し）', () => {
  const cuts = [{ in: 0, out: 5 }, { in: 0, out: 3 }];
  const result = resolveCutStartEnds(cuts);
  assert.deepEqual(result, [{ start: 0, end: 5 }, { start: 5, end: 8 }]);
});

test('resolveCutStartEnds: 明示 at を持つ gap-aware カットはその位置をそのまま使う', () => {
  const cuts = [{ in: 0, out: 5, at: 0, track: 0 }, { in: 0, out: 3, at: 10, track: 0 }];
  const result = resolveCutStartEnds(cuts);
  assert.deepEqual(result, [{ start: 0, end: 5 }, { start: 10, end: 13 }]);
});

test('mapSourceTimeToTimeline: speed 適用込みで写像する', () => {
  const cut = { in: 2, out: 6, speed: 2 };
  const t = mapSourceTimeToTimeline(cut, 10, 4);
  assert.ok(Math.abs(t - 11) < 1e-9); // 10 + (4-2)/2
});

test('mapSourceTimeToTimeline: speed 省略時は等速（1.0）', () => {
  const cut = { in: 2, out: 6 };
  const t = mapSourceTimeToTimeline(cut, 10, 4);
  assert.ok(Math.abs(t - 12) < 1e-9); // 10 + (4-2)/1
});

test('cutHasDefaultFraming: framing/transform 無しは true', () => {
  assert.equal(cutHasDefaultFraming({}), true);
  assert.equal(cutHasDefaultFraming({ in: 0, out: 5 }), true);
});

test('cutHasDefaultFraming: 単位元の transform（x=0,y=0,scale=1,rotate=0）も true', () => {
  assert.equal(cutHasDefaultFraming({ transform: { x: 0, y: 0, scale: 1, rotate: 0 } }), true);
});

test('cutHasDefaultFraming: framing.crop / framing.keyframes / 非単位元 transform はいずれも false', () => {
  assert.equal(cutHasDefaultFraming({ framing: { crop: { x: 0, y: 0, w: 0.5, h: 0.5 } } }), false);
  assert.equal(cutHasDefaultFraming({ framing: { keyframes: [{ t: 0 }, { t: 1 }] } }), false);
  assert.equal(cutHasDefaultFraming({ transform: { scale: 1.5 } }), false);
  assert.equal(cutHasDefaultFraming({ transform: { x: 10 } }), false);
});

test('letterboxContainTransform: 縦横比が一致するときは恒等写像', () => {
  const transform = letterboxContainTransform(1920, 1080, 1280, 720);
  const [x, y] = transform([0.25, 0.75]);
  assert.ok(Math.abs(x - 0.25) < 1e-9);
  assert.ok(Math.abs(y - 0.75) < 1e-9);
});

test('letterboxContainTransform: 縦横比が異なるとレターボックス（contain）で中心寄せされる', () => {
  // 横長ソース(1920x1080)を縦長キャンバス(1080x1920)へ contain フィット。
  const transform = letterboxContainTransform(1920, 1080, 1080, 1920);
  const [cx, cy] = transform([0.5, 0.5]);
  assert.ok(Math.abs(cx - 0.5) < 1e-9);
  assert.ok(Math.abs(cy - 0.5) < 1e-9, '中心は中心に写るはず');
  const [tlx, tly] = transform([0, 0]);
  assert.ok(Math.abs(tlx - 0) < 1e-9);
  assert.ok(tly > 0.3 && tly < 0.35, `上下に黒帯が入るため y=0 は 0 に写らないはず（実測 ${tly}）`);
  const [brx, bry] = transform([1, 1]);
  assert.ok(Math.abs(brx - 1) < 1e-9);
  assert.ok(bry > 0.65 && bry < 0.7, `実測 ${bry}`);
});

test('coverFitLayer: 縦横比が一致するときは crop 無し・scale のみ', () => {
  const { crop, scale } = coverFitLayer(1920, 1080, 960, 540);
  assert.equal(crop, null);
  assert.ok(Math.abs(scale - 0.5) < 1e-9);
});

test('coverFitLayer: キャンバスより横長のソースは左右をクロップし、クロップ後にキャンバスへちょうど一致する', () => {
  const canvasWidth = 1920;
  const canvasHeight = 1080; // 16:9
  const sourceWidth = 2000;
  const sourceHeight = 1000; // 2:1 (キャンバスより横長)
  const { crop, scale } = coverFitLayer(sourceWidth, sourceHeight, canvasWidth, canvasHeight);
  assert.ok(crop);
  assert.ok(Math.abs(crop.y - 0) < 1e-9);
  assert.ok(Math.abs(crop.h - 1) < 1e-9);
  const croppedWidth = sourceWidth * crop.w;
  const croppedHeight = sourceHeight * crop.h;
  assert.ok(Math.abs(croppedWidth * scale - canvasWidth) < 1e-6);
  assert.ok(Math.abs(croppedHeight * scale - canvasHeight) < 1e-6);
});

test('coverFitLayer: キャンバスより縦長のソースは上下をクロップし、クロップ後にキャンバスへちょうど一致する', () => {
  const canvasWidth = 1920;
  const canvasHeight = 1080;
  const sourceWidth = 800;
  const sourceHeight = 1200; // 縦長
  const { crop, scale } = coverFitLayer(sourceWidth, sourceHeight, canvasWidth, canvasHeight);
  assert.ok(crop);
  assert.ok(Math.abs(crop.x - 0) < 1e-9);
  assert.ok(Math.abs(crop.w - 1) < 1e-9);
  const croppedWidth = sourceWidth * crop.w;
  const croppedHeight = sourceHeight * crop.h;
  assert.ok(Math.abs(croppedWidth * scale - canvasWidth) < 1e-6);
  assert.ok(Math.abs(croppedHeight * scale - canvasHeight) < 1e-6);
});
