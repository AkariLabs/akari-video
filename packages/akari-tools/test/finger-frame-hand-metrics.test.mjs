import assert from 'node:assert/strict';
import test from 'node:test';

import { extractHandSamples } from '../bin/finger-frame/hand-metrics.mjs';

test('extractHandSamples: chirality ごとに thumb_tip/index_tip から距離を計算する', () => {
  const samples = [
    {
      t: 0,
      detections: [
        { chirality: 'left', conf: 0.9, joints: { thumb_tip: [0.2, 0.5], index_tip: [0.3, 0.5] } },
        { chirality: 'right', conf: 0.9, joints: { thumb_tip: [0.7, 0.5], index_tip: [0.6, 0.5] } },
      ],
    },
  ];
  const out = extractHandSamples(samples, { sourceWidth: 1000, sourceHeight: 1000 });
  assert.equal(out.length, 1);
  assert.ok(out[0].left);
  assert.ok(out[0].right);
  // 正方形ソース（1000x1000）では正規化距離 = raw 距離。0.1 * 1000 / 1000 = 0.1。
  assert.ok(Math.abs(out[0].left.dist - 0.1) < 1e-9);
  assert.ok(Math.abs(out[0].right.dist - 0.1) < 1e-9);
});

test('extractHandSamples: アスペクト比補正 -- 横長ソースでは縦方向の生座標差が横方向より小さく正規化されて出てくる', () => {
  // 1920x1080（16:9）で、同じ生座標差 0.1 を横方向・縦方向それぞれに与える。
  const samples = [
    {
      t: 0,
      detections: [
        // 横方向 0.1 の差（左手）
        { chirality: 'left', conf: 0.9, joints: { thumb_tip: [0.4, 0.5], index_tip: [0.5, 0.5] } },
        // 縦方向 0.1 の差（右手）
        { chirality: 'right', conf: 0.9, joints: { thumb_tip: [0.5, 0.4], index_tip: [0.5, 0.5] } },
      ],
    },
  ];
  const out = extractHandSamples(samples, { sourceWidth: 1920, sourceHeight: 1080 });
  // 横方向の生差 0.1 は 1920px 分、縦方向の生差 0.1 は 1080px 分 -- ピクセル換算後に width で
  // 正規化しているので、横方向は 192px/1920=0.1、縦方向は 108px/1920=0.05625 になるはず。
  assert.ok(Math.abs(out[0].left.dist - 0.1) < 1e-9);
  assert.ok(Math.abs(out[0].right.dist - 0.05625) < 1e-9);
  assert.ok(out[0].left.dist > out[0].right.dist, 'アスペクト補正なしだと両者は同じ 0.1 になってしまうはず');
});

test('extractHandSamples: thumb/index の片方が欠けている検出はその手を null にする', () => {
  const samples = [
    { t: 0, detections: [{ chirality: 'left', conf: 0.9, joints: { thumb_tip: [0.2, 0.5] } }] },
  ];
  const out = extractHandSamples(samples, { sourceWidth: 100, sourceHeight: 100 });
  assert.equal(out[0].left, null);
  assert.equal(out[0].right, null);
});

test('extractHandSamples: chirality unknown は無視する', () => {
  const samples = [
    { t: 0, detections: [{ chirality: 'unknown', conf: 0.9, joints: { thumb_tip: [0.2, 0.5], index_tip: [0.3, 0.5] } }] },
  ];
  const out = extractHandSamples(samples, { sourceWidth: 100, sourceHeight: 100 });
  assert.equal(out[0].left, null);
  assert.equal(out[0].right, null);
});

test('extractHandSamples: detections が空のサンプルは left/right とも null', () => {
  const out = extractHandSamples([{ t: 0, detections: [] }], { sourceWidth: 100, sourceHeight: 100 });
  assert.equal(out[0].left, null);
  assert.equal(out[0].right, null);
});

test('extractHandSamples: sourceWidth/sourceHeight が不正なら例外', () => {
  assert.throws(() => extractHandSamples([], { sourceWidth: 0, sourceHeight: 100 }));
  assert.throws(() => extractHandSamples([], { sourceWidth: 100, sourceHeight: -1 }));
});
