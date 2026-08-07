import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureMediaPlaying } from '../public/media-playback-resume.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('一時停止中のシークでは再生を始めない', () => {
  let plays = 0;
  const media = { paused: true, play() { plays += 1; } };

  assert.equal(ensureMediaPlaying(media, false), false);
  assert.equal(plays, 0);
});

test('すでに再生中なら play を重ねない', () => {
  let plays = 0;
  const media = { paused: false, play() { plays += 1; } };

  assert.equal(ensureMediaPlaying(media, true), false);
  assert.equal(plays, 0);
});

test('未完了の play は多重発行しない', async () => {
  const first = deferred();
  let plays = 0;
  const media = { paused: true, play() { plays += 1; return first.promise; } };

  assert.equal(ensureMediaPlaying(media, true), true);
  assert.equal(ensureMediaPlaying(media, true), false);
  assert.equal(plays, 1);

  first.resolve();
  await first.promise;
});

test('読み込み待ちで play が失敗した後は次フレームで再試行する', async () => {
  const first = deferred();
  let plays = 0;
  const media = {
    paused: true,
    play() {
      plays += 1;
      return plays === 1 ? first.promise : Promise.resolve();
    },
  };

  assert.equal(ensureMediaPlaying(media, true), true);
  first.reject(new Error('not ready'));
  await first.promise.catch(() => undefined);

  assert.equal(ensureMediaPlaying(media, true), true);
  assert.equal(plays, 2);
});
