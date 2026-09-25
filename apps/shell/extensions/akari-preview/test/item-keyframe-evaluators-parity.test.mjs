import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { interpolateKeyframes } from '../../../../../packages/overlay-runtime/src/keyframes.mjs';
import { computeLayerKeyframesVisual as webLayerVisual } from '../../../../../packages/preview-server/public/layer-keyframes-visual.js';
import { evaluatedItemTransform, evaluatedItemOpacity } from '../../../../../packages/edit-store/lib/index.js';
import { computeLayerKeyframesVisual as shellLayerVisual } from '../lib/common/layer-keyframes-visual.js';

// KF-1: edit-store の書き込み層が作る「まとまりが揃った点」は、書き出し（evaluateItemMotion /
// interpolateKeyframes）・edit-store・シェルのプレビュー・preview-server の 5 つの評価器で同じ値になる。
// シェルの評価器は build 後の lib/ を読むので、このテストは build:ext の後に走る shell レーンに置く
// （edit-store 側の同名テストはシェルを除いた 4 評価器の版）。
const require = createRequire(import.meta.url);
const { evaluateItemMotion } = require('../../../../../packages/overlay-runtime/src/item-motion.js');

const html = () => ({ id: 'item', at: 0, duration: 150,
  source: { kind: 'html', path: 'overlays/title.html' },
  transform: { x: 12, y: 25, scale: .8, rotate: 7 }, opacity: .7 });
const at = (item, frame) => ({ ...evaluatedItemTransform(item, frame), opacity: evaluatedItemOpacity(item, frame) });

test('five evaluators agree on complete points: 1/2/3 points, with and without easing', () => {
  for (const count of [1, 2, 3]) for (const easing of [false, true]) {
    const values = [
      { t: 0, transform: { x: -100, y: 25, scale: .5, scaleX: .5, scaleY: .5, rotate: -30 }, opacity: .2 },
      { t: 60, transform: { x: 100, y: -45, scale: 1.5, scaleX: 1.5, scaleY: 1.5, rotate: 90 }, opacity: .8 },
      { t: 120, transform: { x: 40, y: 70, scale: 1, scaleX: 1, scaleY: 1, rotate: 15 }, opacity: .5 }
    ].slice(0, count).map((point, index) => easing && index > 0 ? { ...point, easing: 'ease-in-out' } : point);
    const item = { ...html(), transform: { ...values[0].transform }, opacity: values[0].opacity,
      keyframes: count === 1 ? [values[0], { t: 1 }] : values };
    const secondsPoints = item.keyframes.map(point => ({ ...point, t: point.t / 30 }));
    for (const frame of [0, 15, 30, 60, 90, 120, 149]) {
      const motion = evaluateItemMotion({ ...item, fps: 30 }, frame / 30);
      const linear = interpolateKeyframes(item.keyframes, frame,
        { statics: { ...item.transform, opacity: item.opacity } });
      const store = at(item, frame);
      const shell = shellLayerVisual(secondsPoints, frame / 30, item.transform);
      const web = webLayerVisual(secondsPoints, frame / 30);
      for (const field of ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'opacity']) {
        const outcomes = [motion[field], linear[field], store[field],
          field === 'opacity' ? shell.opacity : shell.transform[field],
          field === 'opacity' ? web.opacity : web.transform[field]];
        for (const value of outcomes) assert.ok(Math.abs(value - outcomes[0]) < 1e-5,
          `${field} count=${count} easing=${easing} frame=${frame}: ${outcomes.join(', ')}`);
      }
    }
  }
});

test('five evaluators agree on canonical uniform size points ({ scale } without scaleX/scaleY)', () => {
  // 書き込み後の正規化（normalizeTransform）は scaleX === scaleY の点を { scale } へ畳む。実機の保存形。
  const keyframes = [
    { t: 10, transform: { x: -60, y: 30, scale: .6 }, opacity: 1 },
    { t: 100, transform: { x: 90, y: -20, scale: 1.5 }, opacity: .3, easing: 'ease-in-out' }
  ];
  const item = { ...html(), transform: { x: -60, y: 30, scale: .6, rotate: 7 }, opacity: 1, keyframes };
  const secondsPoints = keyframes.map(point => ({ ...point, t: point.t / 30 }));
  for (const frame of [0, 10, 40, 55, 100, 140]) {
    const motion = evaluateItemMotion({ ...item, fps: 30 }, frame / 30);
    const linear = interpolateKeyframes(item.keyframes, frame, { statics: { ...item.transform, opacity: item.opacity } });
    const store = at(item, frame);
    const shell = shellLayerVisual(secondsPoints, frame / 30, item.transform);
    const web = webLayerVisual(secondsPoints, frame / 30);
    // 点が宣言したまとまりだけを比べる（宣言の無い rotate は各経路が静的値を別に合成する）
    for (const field of ['x', 'y', 'scale', 'opacity']) {
      const outcomes = [motion[field], linear[field], store[field],
        field === 'opacity' ? shell.opacity : shell.transform[field],
        field === 'opacity' ? web.opacity : web.transform[field]];
      for (const value of outcomes) assert.ok(Math.abs(value - outcomes[0]) < 1e-5,
        `${field} frame=${frame}: ${outcomes.join(', ')}`);
    }
    for (const axis of ['scaleX', 'scaleY']) {
      const derived = [motion[axis] ?? motion.scale, store[axis], shell.transform[axis] ?? shell.transform.scale,
        web.transform[axis] ?? web.transform.scale];
      for (const value of derived) assert.ok(Math.abs(value - store.scale) < 1e-5, `${axis} frame=${frame}: ${derived.join(', ')}`);
    }
  }
});
