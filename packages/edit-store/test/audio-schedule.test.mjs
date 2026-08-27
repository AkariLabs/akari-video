import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STATIC_DUCK_GAIN_DB,
  buildWebAudioSchedule,
} from '../lib/index.js';

const closeTo = (actual, expected, message = '') => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message} expected ${expected}, got ${actual}`);
};

test('trim / fade / gain / track / ducking を一つの決定論的予定表へ落とす', () => {
  const result = buildWebAudioSchedule({
    timelineDurationSec: 20,
    startAtSec: 0,
    audio: {
      bgm: {
        id: 'bed', durationSec: 5, in: 3, gain_db: -6, ducking: true,
        fadeIn: 2, fadeOut: 4,
      },
      sfx: [{
        id: 'hit', durationSec: 5, t: 2, in: 1, out: 4, gainDb: -6,
        fade_in: 1, fade_out: 1, track: 2,
      }],
      narration: [{ id: 'n-0001', durationSec: 4, t: 5, in: 1, out: 3 }],
    },
  });

  assert.deepEqual(result.duckIntervals, [{ startSec: 5, endSec: 7 }]);
  assert.equal(result.items.length, 3);
  const bgm = result.items.find(item => item.kind === 'bgm');
  assert.equal(bgm.sourceOffsetSec, 3);
  assert.equal(bgm.durationSec, 20);
  assert.equal(bgm.loop, true);
  assert.deepEqual(bgm.gainEvents.map(event => [event.offsetSec, event.method]), [
    [0, 'set'], [2, 'linear'], [16, 'linear'], [20, 'linear'],
  ]);
  closeTo(bgm.gainEvents[0].value, 0);
  closeTo(bgm.gainEvents[1].value, Math.pow(10, -6 / 20));
  closeTo(bgm.gainEvents[3].value, 0);
  assert.deepEqual(bgm.duckingEvents.map(event => event.offsetSec), [0, 5, 7]);
  closeTo(bgm.duckingEvents[0].value, 1);
  closeTo(bgm.duckingEvents[1].value, Math.pow(10, STATIC_DUCK_GAIN_DB / 20));
  closeTo(bgm.duckingEvents[2].value, 1);

  const sfx = result.items.find(item => item.kind === 'sfx');
  assert.equal(sfx.track, 2);
  assert.equal(sfx.delaySec, 2);
  assert.equal(sfx.sourceOffsetSec, 1);
  assert.equal(sfx.durationSec, 3);
  assert.deepEqual(sfx.gainEvents.map(event => [event.offsetSec, event.method]), [
    [0, 'set'], [1, 'linear'], [2, 'linear'], [3, 'linear'],
  ]);
  closeTo(sfx.gainEvents[0].value, 0);
  closeTo(sfx.gainEvents[1].value, Math.pow(10, -6 / 20));
  closeTo(sfx.gainEvents[3].value, 0);

  const narration = result.items.find(item => item.kind === 'narration');
  assert.equal(narration.sourceOffsetSec, 1);
  assert.equal(narration.durationSec, 2);
});

test('途中シークは BGM loop offset と進行中 timed item の source offset を合成する', () => {
  const result = buildWebAudioSchedule({
    timelineDurationSec: 12,
    startAtSec: 2.5,
    audio: {
      bgm: { durationSec: 5, in: 3 },
      sfx: [{ id: 'long', durationSec: 5, t: 2, in: 1, out: 4, fade_in: 1 }],
      narration: [{ id: 'n-0001', durationSec: 4, t: 1, in: 0.5, out: 3.5 }],
    },
  });
  const bgm = result.items.find(item => item.kind === 'bgm');
  closeTo(bgm.sourceOffsetSec, 0.5, 'loop offset');

  const sfx = result.items.find(item => item.kind === 'sfx');
  closeTo(sfx.sourceOffsetSec, 1.5, 'sfx source offset');
  closeTo(sfx.durationSec, 2.5, 'sfx available duration');
  closeTo(sfx.gainEvents[0].value, 0.5, 'seeked fade multiplier');

  const narration = result.items.find(item => item.kind === 'narration');
  closeTo(narration.sourceOffsetSec, 2, 'narration source offset');
  closeTo(narration.durationSec, 1.5, 'narration available duration');
});

test('loop:false の BGM は t/in/seek 後に素材末尾で停止する', () => {
  const result = buildWebAudioSchedule({
    timelineDurationSec: 20,
    startAtSec: 4,
    audio: { bgm: { durationSec: 5, t: 2, in: 1, loop: false } },
  });
  assert.equal(result.items.length, 1);
  const bgm = result.items[0];
  assert.equal(bgm.loop, false);
  assert.equal(bgm.sourceOffsetSec, 3);
  assert.equal(bgm.durationSec, 2);
  assert.equal(bgm.timelineEndSec, 6);
});

test('不正値は音声要素単位で劣化し、有限 gain はクランプする', () => {
  const result = buildWebAudioSchedule({
    timelineDurationSec: 10,
    startAtSec: Number.NaN,
    audio: {
      bgm: { durationSec: 4, in: 99, gainDb: 99 },
      sfx: [
        { id: 'bad-gain', durationSec: 1, t: 0, gain_db: Number.NaN },
        { id: 'bad-time', durationSec: 1, t: -1 },
        { id: 'bad-trim', durationSec: 1, t: 0, in: 1 },
      ],
      narration: [{ id: 'n-0001', durationSec: 2, t: 1, in: 3 }],
    },
  });
  assert.equal(result.startAtSec, 0);
  assert.deepEqual(result.items.map(item => item.kind), ['bgm', 'narration']);
  assert.equal(result.items[0].gainDb, 12);
  assert.equal(result.items[0].sourceOffsetSec, 0);
  assert.equal(result.items[1].sourceOffsetSec, 0);
  assert.ok(result.warnings.some(warning => /gain_db clamped/u.test(warning)));
  assert.ok(result.warnings.some(warning => /gain_db is not finite/u.test(warning)));
  assert.ok(result.warnings.some(warning => /t is outside/u.test(warning)));
  assert.ok(result.warnings.some(warning => /clamped to 0s/u.test(warning)));
});

test('既存 Web UI / shell の loop・timed・fade 数式と多数のシーク点で一致する', () => {
  for (let step = 0; step <= 100; step += 1) {
    const startAtSec = step / 10;
    const result = buildWebAudioSchedule({
      timelineDurationSec: 12,
      startAtSec,
      audio: {
        bgm: { durationSec: 3.25, in: 1.2 },
        sfx: [{ id: 'clip', durationSec: 5, t: 2, in: 0.5, out: 4.5, fade_in: 1, fade_out: 1 }],
      },
    });
    const bgm = result.items.find(item => item.kind === 'bgm');
    closeTo(bgm.sourceOffsetSec, (1.2 + startAtSec) % 3.25, `bgm seek=${startAtSec}`);

    const sfx = result.items.find(item => item.kind === 'sfx');
    const end = 6;
    const shouldSchedule = end > startAtSec;
    assert.equal(Boolean(sfx), shouldSchedule, `sfx presence seek=${startAtSec}`);
    if (!sfx) continue;
    const elapsed = Math.max(0, startAtSec - 2);
    const delay = Math.max(0, 2 - startAtSec);
    closeTo(sfx.delaySec, delay, `sfx delay seek=${startAtSec}`);
    closeTo(sfx.sourceOffsetSec, 0.5 + elapsed, `sfx offset seek=${startAtSec}`);
    closeTo(sfx.durationSec, Math.min(4 - elapsed, 12 - startAtSec - delay), `sfx duration seek=${startAtSec}`);
  }
});
