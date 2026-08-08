import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLayerInLoadWindow,
  markLayerUnplayable,
  syncLayerLazyLoad,
} from '../public/layer-lazy-load.js';

function fakeLayerVideo(layer = { t: 10, duration: 3 }) {
  const calls = { pause: 0, load: 0, removed: [] };
  const el = {
    preload: 'none',
    src: '',
    pause() { calls.pause += 1; },
    load() { calls.load += 1; },
    removeAttribute(name) {
      calls.removed.push(name);
      if (name === 'src') this.src = '';
    },
  };
  return { lv: { el, layer, visible: false, loaded: false }, calls };
}

test('表示開始の1秒前から読み、終了1秒後に窓を閉じる', () => {
  const layer = { t: 10, duration: 3 };
  assert.equal(isLayerInLoadWindow(layer, 8.999), false);
  assert.equal(isLayerInLoadWindow(layer, 9), true);
  assert.equal(isLayerInLoadWindow(layer, 13.999), true);
  assert.equal(isLayerInLoadWindow(layer, 14), false);
});

test('窓へ入るまで src を設定せず、窓内の毎フレーム呼び出しも一度だけロードする', () => {
  const { lv, calls } = fakeLayerVideo();
  let resolves = 0;
  const source = () => { resolves += 1; return '/media/layer.preview.webm'; };

  assert.equal(syncLayerLazyLoad(lv, 5, source), false);
  assert.equal(lv.el.src, '');
  assert.equal(syncLayerLazyLoad(lv, 9, source), true);
  assert.equal(syncLayerLazyLoad(lv, 10, source), true);
  assert.equal(lv.el.src, '/media/layer.preview.webm');
  assert.equal(lv.el.preload, 'auto');
  assert.equal(resolves, 1);
  assert.deepEqual(calls, { pause: 0, load: 0, removed: [] });
});

test('窓を離れると removeAttribute(src) + load() で解放し、再入場時に復帰する', () => {
  const { lv, calls } = fakeLayerVideo();

  syncLayerLazyLoad(lv, 10, '/media/layer.preview.webm');
  assert.equal(syncLayerLazyLoad(lv, 14, '/media/layer.preview.webm'), false);
  assert.equal(lv.el.src, '');
  assert.equal(lv.el.preload, 'none');
  assert.deepEqual(calls, { pause: 1, load: 1, removed: ['src'] });

  assert.equal(syncLayerLazyLoad(lv, 11, '/media/layer.preview.webm'), true);
  assert.equal(lv.el.src, '/media/layer.preview.webm');
  assert.equal(lv.el.preload, 'auto');
});

test('一度 unplayable になったレイヤーは解放し、その後も再ロードしない', () => {
  const { lv, calls } = fakeLayerVideo();
  let resolves = 0;
  const source = () => { resolves += 1; return '/media/missing.preview.webm'; };

  syncLayerLazyLoad(lv, 10, source);
  markLayerUnplayable(lv);
  assert.equal(lv.unplayable, true);
  assert.equal(lv.loaded, false);
  assert.equal(lv.el.src, '');
  assert.deepEqual(calls, { pause: 1, load: 1, removed: ['src'] });

  assert.equal(syncLayerLazyLoad(lv, 10, source), false);
  assert.equal(syncLayerLazyLoad(lv, 5, source), false);
  assert.equal(resolves, 1);
  assert.deepEqual(calls, { pause: 1, load: 1, removed: ['src'] });
});
