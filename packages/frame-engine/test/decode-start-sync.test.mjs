import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeStartSyncSample, precedingSyncSample } from '../dist/index.js';

// 実測パターン: iPhone HEVC（IMG_3335.mov, 1920x1080 / 30fps）の decode 順先頭 30 サンプル。
// decode 25 が CRA（pts 933333us）で、その直後の decode 26 は pts 866666us = CRA より前に表示される
// leading picture。CRA から流すと参照が欠けて RASL として捨てられ、目標フレームが出てこない。
const HEVC_OPEN_GOP = table([
  [0, 0, true], [1, 133333, false], [2, 66666, false], [3, 33333, false], [4, 100000, false],
  [5, 266666, false], [6, 200000, false], [7, 166666, false], [8, 233333, false],
  [9, 400000, false], [10, 333333, false], [11, 300000, false], [12, 366666, false],
  [13, 533333, false], [14, 466666, false], [15, 433333, false], [16, 500000, false],
  [17, 666666, false], [18, 600000, false], [19, 566666, false], [20, 633333, false],
  [21, 800000, false], [22, 733333, false], [23, 700000, false], [24, 766666, false],
  [25, 933333, true], [26, 866666, false], [27, 833333, false], [28, 900000, false],
  [29, 1066666, false],
]);

// pts === dts の closed GOP（iPhone H.264 素材の実測パターン）。
const CLOSED_GOP = table([
  [0, 0, true], [1, 33333, false], [2, 66666, false],
  [3, 100000, true], [4, 133333, false], [5, 166666, false],
]);

function table(rows) {
  return {
    samples: rows.map(([decodeIndex, timestampUs, isSync]) => ({ decodeIndex, timestampUs, isSync })),
  };
}

test('closed GOP: decodeStartSyncSample equals precedingSyncSample', () => {
  for (const sample of CLOSED_GOP.samples) {
    assert.equal(
      decodeStartSyncSample(CLOSED_GOP, sample),
      precedingSyncSample(CLOSED_GOP, sample.decodeIndex),
      `decode ${sample.decodeIndex}`,
    );
  }
  assert.equal(decodeStartSyncSample(CLOSED_GOP, CLOSED_GOP.samples[5]), 3);
});

test('open GOP: a leading picture decoded after a CRA starts from the previous sync', () => {
  // 落ちていた目標そのもの（866666us）。CRA(25) ではなく先頭 sync(0) から流す。
  assert.equal(decodeStartSyncSample(HEVC_OPEN_GOP, HEVC_OPEN_GOP.samples[26]), 0);
  assert.equal(decodeStartSyncSample(HEVC_OPEN_GOP, HEVC_OPEN_GOP.samples[27]), 0);
  assert.equal(decodeStartSyncSample(HEVC_OPEN_GOP, HEVC_OPEN_GOP.samples[28]), 0);
  // CRA 自身とそれ以降に表示されるフレームは CRA から流してよい。
  assert.equal(decodeStartSyncSample(HEVC_OPEN_GOP, HEVC_OPEN_GOP.samples[25]), 25);
  assert.equal(decodeStartSyncSample(HEVC_OPEN_GOP, HEVC_OPEN_GOP.samples[29]), 25);
  // GOP 0 内の並べ替えは sync 0 のまま。
  assert.equal(decodeStartSyncSample(HEVC_OPEN_GOP, HEVC_OPEN_GOP.samples[1]), 0);
  assert.equal(decodeStartSyncSample(HEVC_OPEN_GOP, HEVC_OPEN_GOP.samples[24]), 0);
});
