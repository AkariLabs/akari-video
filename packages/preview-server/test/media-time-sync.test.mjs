import assert from 'node:assert/strict';
import test from 'node:test';

import { syncMediaCurrentTime } from '../public/media-time-sync.js';

function fakeMedia({ currentTime = 0, seeking = false } = {}) {
  let value = currentTime;
  let writes = 0;
  return {
    media: {
      seeking,
      get currentTime() { return value; },
      set currentTime(next) { value = next; writes += 1; },
    },
    value: () => value,
    writes: () => writes,
  };
}

test('シーク中は目標時刻が大きく進んでも currentTime を再設定しない', () => {
  const fake = fakeMedia({ currentTime: 0.067, seeking: true });

  assert.equal(syncMediaCurrentTime(fake.media, 0.6, 0.35), false);
  assert.equal(fake.value(), 0.067);
  assert.equal(fake.writes(), 0);
});

test('シーク完了後にデッドバンドを超えたズレだけ補正する', () => {
  const fake = fakeMedia({ currentTime: 0.1, seeking: false });

  assert.equal(syncMediaCurrentTime(fake.media, 0.6, 0.35), true);
  assert.equal(fake.value(), 0.6);
  assert.equal(fake.writes(), 1);
});

test('デッドバンド内では currentTime を再設定しない', () => {
  const fake = fakeMedia({ currentTime: 0.4, seeking: false });

  assert.equal(syncMediaCurrentTime(fake.media, 0.6, 0.35), false);
  assert.equal(fake.value(), 0.4);
  assert.equal(fake.writes(), 0);
});

test('一時停止用の精密なしきい値では小さいズレも一度だけ補正する', () => {
  const fake = fakeMedia({ currentTime: 0.4, seeking: false });

  assert.equal(syncMediaCurrentTime(fake.media, 0.402, 0.001), true);
  assert.equal(fake.value(), 0.402);
  assert.equal(fake.writes(), 1);
});
