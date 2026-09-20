import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampPanelSize,
  clampPanelX,
  isSameOriginPanelPath,
  normalizePanelMode,
  parseManifestPanel
} from '../lib/common/companion-panel-geometry.js';

test('パネルの大きさを境界内へ丸める', () => {
  assert.deepEqual(clampPanelSize(43, 43), { width: 44, height: 44 });
  assert.deepEqual(clampPanelSize(721, 361), { width: 720, height: 360 });
  assert.deepEqual(clampPanelSize(100.6, 100.4), { width: 101, height: 100 });
  assert.deepEqual(
    clampPanelSize(Number.NaN, Number.POSITIVE_INFINITY, { width: 120, height: 80 }),
    { width: 120, height: 80 }
  );
});

test('横位置は中央を既定にし画面内へ丸める', () => {
  assert.equal(clampPanelX(undefined, 1000, 360), 320);
  assert.equal(clampPanelX(-20, 1000, 360), 0);
  assert.equal(clampPanelX(900, 1000, 360), 640);
  assert.equal(clampPanelX(20, 30, 44), 0);
});

test('形は tab と pill だけを受ける', () => {
  assert.equal(normalizePanelMode('tab'), 'tab');
  assert.equal(normalizePanelMode('pill'), 'pill');
  assert.equal(normalizePanelMode('other', 'pill'), 'pill');
});

test('同じ origin の相対パスだけを受ける', () => {
  assert.equal(isSameOriginPanelPath('/panel'), true);
  assert.equal(isSameOriginPanelPath('/panel?k=fixture'), true);
  assert.equal(isSameOriginPanelPath('panel'), false);
  assert.equal(isSameOriginPanelPath('//evil/x'), false);
  assert.equal(isSameOriginPanelPath(`/${'a'.repeat(511)}`), true);
  assert.equal(isSameOriginPanelPath(`/${'a'.repeat(512)}`), false);
});

test('manifest の有効な枠情報だけを取り出す', () => {
  assert.deepEqual(parseManifestPanel({ panelPath: '/panel', panel: { width: 500, height: 240 } }), {
    panelPath: '/panel', panel: { width: 500, height: 240 }
  });
  assert.deepEqual(parseManifestPanel({ panelPath: '//evil/x', panel: { width: '500', height: 240 } }), {});
  assert.deepEqual(parseManifestPanel({ panel: { width: Number.NaN, height: 240 } }), {});
  assert.deepEqual(parseManifestPanel(undefined), {});
});
