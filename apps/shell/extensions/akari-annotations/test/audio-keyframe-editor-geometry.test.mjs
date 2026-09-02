import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIO_KEYFRAME_MAX_DB,
  AUDIO_KEYFRAME_MIN_DB,
  audioKeyframeDbToPx,
  audioKeyframePxToDb,
  audioKeyframePxToTime,
  audioKeyframeTimeToPx,
  snapAudioKeyframeTime,
  validateAudioKeyframeTime,
} from '../lib/common/audio-keyframe-editor-geometry.js';

test('t→px は実効再生窓の 0・中央・末尾を fit-to-width へ写す', () => {
  assert.equal(audioKeyframeTimeToPx(0, 10, 800), 0);
  assert.equal(audioKeyframeTimeToPx(5, 10, 800), 400);
  assert.equal(audioKeyframeTimeToPx(10, 10, 800), 800);
});

test('t→px は時間の範囲外を実効再生窓の両端へクランプする', () => {
  assert.equal(audioKeyframeTimeToPx(-2, 10, 800), 0);
  assert.equal(audioKeyframeTimeToPx(12, 10, 800), 800);
});

test('px→t は 0・中央・末尾をクリップのローカル秒へ戻す', () => {
  assert.equal(audioKeyframePxToTime(0, 10, 800), 0);
  assert.equal(audioKeyframePxToTime(400, 10, 800), 5);
  assert.equal(audioKeyframePxToTime(800, 10, 800), 10);
});

test('px→t は範囲外 px を実効再生窓の両端へクランプする', () => {
  assert.equal(audioKeyframePxToTime(-1, 10, 800), 0);
  assert.equal(audioKeyframePxToTime(900, 10, 800), 10);
});

test('t↔px は有効範囲内で往復する', () => {
  const px = audioKeyframeTimeToPx(3.25, 13, 777);
  assert.ok(Math.abs(audioKeyframePxToTime(px, 13, 777) - 3.25) < 1e-12);
});

test('t↔px はゼロ尺・ゼロ幅・非有限入力を安全に 0 へ落とす', () => {
  assert.equal(audioKeyframeTimeToPx(1, 0, 800), 0);
  assert.equal(audioKeyframePxToTime(1, 10, 0), 0);
  assert.equal(audioKeyframeTimeToPx(Number.NaN, 10, 800), 0);
});

test('dB→px は +9 dB を上端、-30 dB を下端へ写す', () => {
  assert.equal(audioKeyframeDbToPx(AUDIO_KEYFRAME_MAX_DB, 180), 0);
  assert.equal(audioKeyframeDbToPx(AUDIO_KEYFRAME_MIN_DB, 180), 180);
  assert.equal(audioKeyframeDbToPx(0, 180), 180 * 9 / 39);
});

test('dB→px は表示範囲外を [-30,+9] dB の端へクランプする', () => {
  assert.equal(audioKeyframeDbToPx(100, 180), 0);
  assert.equal(audioKeyframeDbToPx(-100, 180), 180);
});

test('px→dB は上端・下端と範囲外クランプを返す', () => {
  assert.equal(audioKeyframePxToDb(0, 180), 9);
  assert.equal(audioKeyframePxToDb(180, 180), -30);
  assert.equal(audioKeyframePxToDb(-1, 180), 9);
  assert.equal(audioKeyframePxToDb(181, 180), -30);
});

test('dB↔px は表示範囲内で往復する', () => {
  const px = audioKeyframeDbToPx(-12.5, 173);
  assert.ok(Math.abs(audioKeyframePxToDb(px, 173) - (-12.5)) < 1e-12);
});

test('フレームスナップは最寄りフレームへ丸める', () => {
  assert.equal(snapAudioKeyframeTime(1.018, 30, 10), 31 / 30);
  assert.equal(snapAudioKeyframeTime(1.01, 30, 10), 1);
});

test('フレームスナップは時間境界をクランプし不正 fps ではクランプだけ行う', () => {
  assert.equal(snapAudioKeyframeTime(-1, 30, 10), 0);
  assert.equal(snapAudioKeyframeTime(11, 30, 10), 10);
  assert.equal(snapAudioKeyframeTime(1.234, 0, 10), 1.234);
});

test('追加先が既存点と同一 t なら拒否メッセージを返す', () => {
  assert.deepEqual(validateAudioKeyframeTime([{ t: 1 }, { t: 2 }], 2), {
    ok: false,
    message: '同じ時刻には複数のキーフレームを置けません。',
  });
});

test('移動元 index 自身だけは同一 t 衝突判定から除外する', () => {
  assert.deepEqual(validateAudioKeyframeTime([{ t: 1 }, { t: 2 }], 2, 1), { ok: true });
});

test('既存点と異なる t への追加・移動は許可する', () => {
  assert.deepEqual(validateAudioKeyframeTime([{ t: 1 }, { t: 2 }], 1.5), { ok: true });
});
