import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DECLICK_RAMP_SECONDS,
  MEDIA_SEEK_READY_RECHECK_MS,
  createAudioDeClickController,
  transitionApproximationGain,
  waitForMediaSeekCompletion,
} from '../public/audio-declick.js';

function fakeGainParam(value = 1) {
  const calls = [];
  return {
    value,
    calls,
    cancelScheduledValues(at) { calls.push(['cancel', at]); },
    setValueAtTime(next, at) { this.value = next; calls.push(['set', next, at]); },
    linearRampToValueAtTime(next, at) { this.value = next; calls.push(['ramp', next, at]); },
  };
}

test('シークは 12ms のフェードアウト後に適用し、完了後にだけ 12ms で復帰する', async () => {
  const gain = fakeGainParam();
  const timers = [];
  const ctx = { currentTime: 10 };
  const controller = createAudioDeClickController({
    audioContext: ctx,
    gainNode: { gain },
    delay(fn, ms) { timers.push({ fn, ms }); return timers.length; },
  });
  let applied = false;
  let completeSeek;
  const completion = new Promise((resolve) => { completeSeek = resolve; });

  assert.equal(controller.request(() => { applied = true; return completion; }), true);
  assert.equal(applied, false);
  assert.equal(timers[0].ms, DECLICK_RAMP_SECONDS * 1000);
  assert.deepEqual(gain.calls.slice(0, 3), [
    ['cancel', 10],
    ['set', 1, 10],
    ['ramp', 0, 10 + DECLICK_RAMP_SECONDS],
  ]);

  ctx.currentTime = 10 + DECLICK_RAMP_SECONDS;
  timers[0].fn();
  assert.equal(applied, true);
  assert.equal(gain.calls.filter(([kind, value]) => kind === 'ramp' && value === 1).length, 0);

  ctx.currentTime = 10.1;
  completeSeek();
  await completion;
  await Promise.resolve();
  assert.deepEqual(gain.calls.slice(-3), [
    ['cancel', ctx.currentTime],
    ['set', 0, ctx.currentTime],
    ['ramp', 1, ctx.currentTime + DECLICK_RAMP_SECONDS],
  ]);
});

test('再生ループ中の追従要求はランプを増殖させず最新位置だけを適用する', () => {
  const gain = fakeGainParam();
  const timers = [];
  const controller = createAudioDeClickController({
    audioContext: { currentTime: 0 },
    gainNode: { gain },
    delay(fn) { timers.push(fn); return timers.length; },
  });
  const applied = [];

  assert.equal(controller.request(() => applied.push(1)), true);
  assert.equal(controller.request(() => applied.push(2)), false);
  assert.equal(controller.request(() => applied.push(3)), false);
  assert.equal(gain.calls.filter(([kind]) => kind === 'ramp').length, 1);
  timers[0]();
  assert.deepEqual(applied, [3]);
});

test('デコード待ち中の新しいシークだけが復帰ランプを解放する', async () => {
  const gain = fakeGainParam();
  const timers = [];
  const ctx = { currentTime: 0 };
  const controller = createAudioDeClickController({
    audioContext: ctx,
    gainNode: { gain },
    delay(fn) { timers.push(fn); return timers.length; },
  });
  let finishFirst;
  let finishSecond;
  const first = new Promise(resolve => { finishFirst = resolve; });
  const second = new Promise(resolve => { finishSecond = resolve; });

  controller.request(() => first);
  timers[0]();
  assert.equal(controller.request(() => second), true);
  finishFirst();
  await first;
  await Promise.resolve();
  assert.equal(gain.calls.filter(([kind, value]) => kind === 'ramp' && value === 1).length, 0);

  ctx.currentTime = 0.2;
  finishSecond();
  await second;
  await Promise.resolve();
  assert.equal(gain.calls.filter(([kind, value]) => kind === 'ramp' && value === 1).length, 1);
});

function fakeMedia({ src = 'http://example.test/a.mp4', currentTime = 15, readyState = 2 } = {}) {
  const target = new EventTarget();
  Object.assign(target, { src, currentSrc: src, currentTime, readyState, seeking: false });
  return target;
}

test('同一ソース内シークは seeked まで完了しない', async () => {
  const media = fakeMedia();
  const timers = [];
  let completed = false;
  const ready = waitForMediaSeekCompletion({
    mediaElement: media,
    sourceChanged: false,
    target: 15,
    expectedSource: media.src,
    delay(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearDelay() {},
  }).then(() => { completed = true; });

  media.dispatchEvent(new Event('loadeddata'));
  await Promise.resolve();
  assert.equal(completed, false);
  media.dispatchEvent(new Event('seeked'));
  await ready;
  assert.equal(completed, true);
  assert.equal(timers[0].ms, MEDIA_SEEK_READY_RECHECK_MS);
});

test('別ソース切替は loadeddata と seeked の両方を待つ', async () => {
  const media = fakeMedia({ src: 'http://example.test/b.mp4' });
  let completed = false;
  const ready = waitForMediaSeekCompletion({
    mediaElement: media,
    sourceChanged: true,
    target: 15,
    expectedSource: media.src,
    delay() { return 1; },
    clearDelay() {},
  }).then(() => { completed = true; });

  media.dispatchEvent(new Event('seeked'));
  await Promise.resolve();
  assert.equal(completed, false);
  media.dispatchEvent(new Event('loadeddata'));
  await ready;
  assert.equal(completed, true);
});

test('750ms フォールバックは実データとシーク完了を確認できるまでミュートを解かない', async () => {
  const media = fakeMedia({ readyState: 1 });
  media.seeking = true;
  const timers = [];
  let completed = false;
  const ready = waitForMediaSeekCompletion({
    mediaElement: media,
    sourceChanged: false,
    target: 15,
    expectedSource: media.src,
    delay(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearDelay() {},
  }).then(() => { completed = true; });

  timers[0].fn();
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(timers[1].ms, MEDIA_SEEK_READY_RECHECK_MS);

  media.seeking = false;
  media.readyState = 2;
  timers[1].fn();
  await ready;
  assert.equal(completed, true);
});

test('transition 近似は宣言 duration 全体で fade-out → fade-in する', () => {
  const boundaries = [{ at: 5, duration: 0.2 }];
  assert.equal(transitionApproximationGain(4.89, boundaries), 1);
  assert.ok(Math.abs(transitionApproximationGain(4.95, boundaries) - 0.5) < 1e-9);
  assert.equal(transitionApproximationGain(5, boundaries), 0);
  assert.ok(Math.abs(transitionApproximationGain(5.05, boundaries) - 0.5) < 1e-9);
  assert.equal(transitionApproximationGain(5.11, boundaries), 1);
});
