import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRenderClipMedia,
  filmstripCellCount,
  isMediaCacheFailure,
  mediaCacheRequestAttempt,
} from '../lib/common/clip-media-policy.js';

test('帯幅40px・トラック高48pxを跨いでも正のサイズならメディアを描く', () => {
  for (const width of [100, 40, 39, 20, 1, 0.001, Number.MIN_VALUE]) {
    for (const height of [100, 48, 47, 1, 0.001, Number.MIN_VALUE]) {
      assert.equal(canRenderClipMedia(width, height, 'file:///clip.mp4'), true);
    }
  }
});

test('正の領域または動画URIが無い場合だけ描画を止める', () => {
  for (const size of [0, -1, Number.NaN, -Infinity]) {
    assert.equal(canRenderClipMedia(size, 48, 'video'), false);
    assert.equal(canRenderClipMedia(40, size, 'video'), false);
  }
  assert.equal(canRenderClipMedia(40, 48, ''), false);
});

test('36pxセルの端数を切り上げ、右端まで覆い、極小幅でも1コマ残す', () => {
  for (const [width, expected] of [[0.001, 1], [20, 1], [36, 1], [36.01, 2], [40, 2], [72, 2], [73, 3]]) {
    const count = filmstripCellCount(width, 36);
    assert.equal(count, expected);
    assert.ok(count * 36 >= width);
    assert.ok((count - 1) * 36 < width);
  }
});

test('不正なセル幅でも0除算・NaN・負セル数を作らない', () => {
  for (const width of [Number.MIN_VALUE, 0, -1, Number.NaN, Infinity]) {
    for (const cellWidth of [36, Number.MIN_VALUE, 0, -1, Number.NaN, Infinity]) {
      const count = filmstripCellCount(width, cellWidth);
      assert.ok(Number.isFinite(count) && Number.isInteger(count) && count >= 1);
    }
  }
});

test('両キャッシュは初回失敗から5秒後の描画要求で1回だけ再試行する', () => {
  for (const key of ['video:0', 'source:0:10']) {
    const cache = new Map();
    const request = now => {
      const attempt = mediaCacheRequestAttempt(cache.get(key), now);
      if (attempt !== undefined) cache.set(key, 'pending');
      return attempt;
    };
    const firstAttempt = request(1000);
    assert.equal(firstAttempt, 0);
    assert.equal(request(1001), undefined);
    assert.equal(request(20000), undefined); // inflight は時間経過でも重複取得しない
    cache.set(key, { status: 'unavailable', failedAt: 21000, attempt: firstAttempt });
    assert.equal(isMediaCacheFailure(cache.get(key)), true);
    assert.equal(request(20999), undefined);
    assert.equal(request(25999), undefined);
    const retryAttempt = request(26000);
    assert.equal(retryAttempt, 1);
    assert.equal(request(26000), undefined); // 同じ描画パスからの重複要求
    cache.set(key, { status: 'unavailable', failedAt: 27000, attempt: retryAttempt });
    assert.equal(request(32000), undefined);
    assert.equal(request(Number.MAX_SAFE_INTEGER), undefined);
    assert.deepEqual([...cache.keys()], [key]);
  }
});

test('成功したサムネ・チャンクは時間が経過しても再取得しない', () => {
  for (const entry of ['data:image/png;base64,ready', { atlasUri: 'atlas', frameCount: 4 }]) {
    assert.equal(isMediaCacheFailure(entry), false);
    assert.equal(mediaCacheRequestAttempt(entry, Number.MAX_SAFE_INTEGER), undefined);
  }
});
