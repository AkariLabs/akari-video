import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { computeTransitionVisual } from '../lib/common/transition-visual.js';

const { TRANSITION_BY_ID, TRANSITION_VOCABULARY } = createRequire(import.meta.url)(
  '../../../../../packages/edit-store/lib/index.js'
);
const visual = (type, progress) => {
  const definition = TRANSITION_BY_ID[type];
  return computeTransitionVisual(definition.previewKind, progress, definition.labelJa);
};

test('正準 29 種はすべてレシピまたは明示フォールバックへ解決される', () => {
  assert.equal(TRANSITION_VOCABULARY.length, 29);
  for (const definition of TRANSITION_VOCABULARY) {
    const result = visual(definition.id, 0.5);
    assert.equal(result.progress, 0.5, definition.id);
    if (definition.previewKind === 'fallback') {
      assert.match(result.fallbackLabel, new RegExp(definition.labelJa), definition.id);
      assert.match(result.fallbackLabel, /プレビュー近似なし/u, definition.id);
    } else {
      assert.equal(result.fallbackLabel, '', definition.id);
    }
  }
});

test('dissolve / fade は線形クロスする', () => {
  for (const type of ['dissolve', 'fade']) {
    assert.equal(visual(type, 0.25).outgoingOpacity, 0.75);
    assert.equal(visual(type, 0.25).incomingOpacity, 0.25);
  }
});

test('fade-black / fade-white は指定の非対称 plate 式を使う', () => {
  assert.equal(visual('fade-black', 0.5).plateColor, '#000');
  assert.equal(visual('fade-white', 0.5).plateColor, '#fff');
  for (const [progress, expected] of [[0.125, 0.69], [0.25, 1], [0.75, 0.36]]) {
    assert.ok(Math.abs(visual('fade-black', progress).plateOpacity - expected) <= 0.01, String(progress));
  }
});

test('fade-grays は mid(p) を両レイヤーの grayscale へ適用する', () => {
  assert.equal(visual('fade-grays', 0.25).outgoingFilter, 'grayscale(0.5)');
  assert.equal(visual('fade-grays', 0.25).incomingFilter, 'grayscale(0.5)');
});

test('wipe 4 方向は incoming clip-path で開く', () => {
  assert.equal(visual('wipe-left', 0.25).incomingClipPath, 'inset(0 0 0 75%)');
  assert.equal(visual('wipe-right', 0.25).incomingClipPath, 'inset(0 75% 0 0)');
  assert.equal(visual('wipe-up', 0.25).incomingClipPath, 'inset(75% 0 0 0)');
  assert.equal(visual('wipe-down', 0.25).incomingClipPath, 'inset(0 0 75% 0)');
});

test('slide / cover は指定方向の transform を返す', () => {
  assert.equal(visual('slide-left', 0.25).outgoingTransform, 'translateX(-25%)');
  assert.equal(visual('slide-left', 0.25).incomingTransform, 'translateX(75%)');
  assert.equal(visual('slide-down', 0.25).outgoingTransform, 'translateY(25%)');
  assert.equal(visual('cover-right', 0.25).incomingTransform, 'translateX(-75%)');
  assert.equal(visual('cover-up', 0.25).incomingTransform, 'translateY(75%)');
});

test('reveal 4 方向は zSwap + outgoing transform で前景を抜く', () => {
  assert.equal(visual('reveal-left', 0.25).outgoingTransform, 'translateX(-25%)');
  assert.equal(visual('reveal-right', 0.25).outgoingTransform, 'translateX(25%)');
  assert.equal(visual('reveal-up', 0.25).outgoingTransform, 'translateY(-25%)');
  assert.equal(visual('reveal-down', 0.25).outgoingTransform, 'translateY(25%)');
  for (const type of ['reveal-left', 'reveal-right', 'reveal-up', 'reveal-down']) {
    assert.equal(visual(type, 0.25).zSwap, true, type);
    assert.equal(visual(type, 0.25).incomingClipPath, 'none', type);
  }
});

test('circle / radial は指定のフェザー式を mask へ直列化する', () => {
  assert.equal(
    visual('circle-open', 0.5).incomingMask,
    'radial-gradient(circle farthest-corner, #000 15%, transparent 85%)'
  );
  assert.equal(
    visual('circle-close', 0.5).outgoingMask,
    'radial-gradient(circle farthest-corner, #000 15%, transparent 85%)'
  );
  assert.equal(
    visual('radial', 0.5).incomingMask,
    'conic-gradient(from 0deg, #000 164deg, transparent 196deg)'
  );
});

test('zoom / squeeze は zSwap の outgoing 変形を返す', () => {
  const zoom = visual('zoom-in', 0.8);
  assert.equal(zoom.outgoingTransform, 'scale(2.2)');
  assert.ok(Math.abs(zoom.outgoingOpacity - 0.5) < 1e-9);
  assert.equal(zoom.outgoingFilter, 'blur(4.800000000000001px)');
  assert.equal(zoom.zSwap, true);
  assert.equal(visual('squeeze-h', 0.25).outgoingTransform, 'scaleY(0.75)');
  assert.equal(visual('squeeze-v', 0.25).outgoingTransform, 'scaleX(0.75)');
});

test('未知種別は汎用クロス + type 文字列ラベルへ落ちる', () => {
  const result = computeTransitionVisual('fallback', 0.25, 'future-transition');
  assert.equal(result.outgoingOpacity, 0.75);
  assert.equal(result.incomingOpacity, 0.25);
  assert.equal(result.fallbackLabel, 'future-transition — プレビュー近似なし');
});
