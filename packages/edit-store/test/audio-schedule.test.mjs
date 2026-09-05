import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STATIC_DUCK_GAIN_DB,
  buildWebAudioSchedule,
  projectSpeechDeclarations,
} from '../lib/index.js';

const closeTo = (actual, expected, message = '') => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message} expected ${expected}, got ${actual}`);
};

test('muted speech cuts emit no declarations and preserve following cut timing', () => {
  for (const freeze of [undefined, { at_sec: 1, duration_sec: 2 }]) {
    const cuts = [
      { id: 'camera', src: 'main', in: 0, out: 4, ...(freeze ? { freeze } : {}) },
      { id: 'next', src: 'main', in: 4, out: 8, gain_db: -12 },
    ];
    const original = projectSpeechDeclarations(cuts, { fps: 30 });
    const muted = projectSpeechDeclarations([{ ...cuts[0], mute: true }, cuts[1]], { fps: 30 });
    assert.deepEqual(muted, original.filter(item => item.id === 'next-speech'));
    assert.equal(muted.length, 1);
    assert.equal(muted[0].gainDb, -12);
    assert.equal(muted[0].atSec, freeze ? 6 : 4);
    assert.deepEqual(projectSpeechDeclarations([{ ...cuts[0], mute: true }], { fps: 30 }), []);
    assert.deepEqual(projectSpeechDeclarations([{ ...cuts[0], mute: false, gain_db: 0 }, cuts[1]], { fps: 30 }), original);
  }
});

test('muted transition participants do not create speech declarations or throw', () => {
  const cuts = [
    { id: 'left', src: 'main', in: 0, out: 4, transition_out: { type: 'crossfade', duration: 1 } },
    { id: 'right', src: 'main', in: 4, out: 8 },
  ];
  for (const mutedIndex of [0, 1]) {
    const declarations = projectSpeechDeclarations(cuts.map((cut, index) => ({ ...cut, mute: index === mutedIndex })), { fps: 30 });
    assert.equal(declarations.length, 1);
    assert.equal(declarations[0].id, `${cuts[1 - mutedIndex].id}-speech`);
  }
});

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
  // 既定値変更 2026-09-02: attack 0.3 / release 0.8 のランプ端点。
  assert.deepEqual(bgm.envelopeEvents.map(event => event.offsetSec), [0, 4.7, 5, 7, 7.8, 20]);
  closeTo(bgm.envelopeEvents[0].value, 1);
  closeTo(bgm.envelopeEvents[2].value, Math.pow(10, STATIC_DUCK_GAIN_DB / 20));
  closeTo(bgm.envelopeEvents[4].value, 1);

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

test('ducking:true の SFX にも narration 鍵の envelopeEvents を出す', () => {
  const result = buildWebAudioSchedule({
    timelineDurationSec: 5,
    startAtSec: 0,
    audio: {
      sfx: [{ id: 'bed-sfx', durationSec: 5, t: 0, ducking: true, duck_db: -6 }],
      narration: [{ id: 'n-0001', durationSec: 1, t: 2 }],
    },
  });
  const sfx = result.items.find(item => item.kind === 'sfx');
  assert.ok(sfx.envelopeEvents.length > 0);
  assert.ok(sfx.envelopeEvents.some(event => event.method === 'exponential'
    && Math.abs(event.value - 10 ** (-6 / 20)) < 1e-9));
});

test('narration の ducking:true は対象として無視して envelopeEvents を作らない', () => {
  const result = buildWebAudioSchedule({
    timelineDurationSec: 3,
    startAtSec: 0,
    audio: { narration: [{ id: 'n-0001', durationSec: 2, t: 0, ducking: true }] },
  });
  assert.deepEqual(result.items[0].envelopeEvents, []);
});

test('既定 duck 値は旧固定 -12 dB と同じ exponential 値列になる', () => {
  const result = buildWebAudioSchedule({
    timelineDurationSec: 4,
    startAtSec: 0,
    audio: { bgm: { durationSec: 4, ducking: true } },
    speechKeyIntervals: [{ startSec: 1, endSec: 2 }],
  });
  const events = result.items[0].envelopeEvents;
  const plateau = events.filter(event => event.offsetSec >= 1 && event.offsetSec <= 2);
  assert.ok(plateau.length >= 2);
  plateau.forEach(event => closeTo(event.value, 10 ** (STATIC_DUCK_GAIN_DB / 20)));
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

test('speech は speed を素材時間軸へ適用し、シーク窓と素材末尾で出力尺も切り詰める', () => {
  const result = buildWebAudioSchedule({
    timelineDurationSec: 10,
    startAtSec: 2,
    audio: {
      bgm: { id: 'bed', durationSec: 2 },
      narration: [{ id: 'voice', durationSec: 1, t: 0 }],
      speech: [{
        id: 'cut-a-speech', src: 'source-a', atSec: 1, durationSec: 4,
        inSec: 10, outSec: 16, speed: 1.5, gainDb: -6, materialDurationSec: 15.4,
      }],
    },
  });
  const speech = result.items.find(item => item.kind === 'speech');
  closeTo(speech.timelineStartSec, 2);
  closeTo(speech.sourceOffsetSec, 11.5);
  closeTo(speech.durationSec, 2.6);
  closeTo(speech.playbackRate, 1.5);
  closeTo(speech.sourceDurationSec, 3.9);
  closeTo(speech.timelineEndSec, 4.6);
  closeTo(speech.gainEvents[0].value, Math.pow(10, -6 / 20));
  assert.deepEqual(speech.envelopeEvents, []);
  assert.deepEqual(result.duckIntervals, [{ startSec: 0, endSec: 1 }],
    'speech は narration だけから作る ducking 区間へ加わらない');

  for (const item of result.items.filter(item => item.kind !== 'speech')) {
    assert.equal(item.playbackRate, 1);
    assert.equal(item.sourceDurationSec, item.durationSec);
  }
});

test('旧 speech atempo は専用音声を 1 倍・区間先頭基準で予定する', () => {
  const result = buildWebAudioSchedule({
    timelineDurationSec: 10,
    startAtSec: 2,
    audio: {
      speech: [{
        id: 'fast', src: 'source-a', atSec: 1, durationSec: 4,
        inSec: 10, outSec: 16, speed: 1.5, materialDurationSec: 4,
        atempo: { path: '/cache/fast.wav', durationSec: 4 },
      }],
    },
  });
  assert.equal(result.warnings.length, 0);
  const speech = result.items[0];
  closeTo(speech.timelineStartSec, 2);
  closeTo(speech.sourceOffsetSec, 1);
  closeTo(speech.durationSec, 3);
  closeTo(speech.playbackRate, 1);
  closeTo(speech.sourceDurationSec, 3);
});

test('transition_out は両側 FLAC の 0.5 秒を線形 crossfade として重ねる', () => {
  const declarations = projectSpeechDeclarations([
    { id: 'a', src: 'source-a', in: 1, out: 5, transition_out: { type: 'dissolve', duration: 0.5 } },
    { id: 'b', src: 'source-b', in: 2, out: 6 },
  ], { fps: 30 });
  assert.equal(declarations[0].padAfterSec, 0.5);
  assert.equal(declarations[0].crossfadeOutSec, 0.5);
  assert.equal(declarations[1].padBeforeSec, 0.5);
  assert.equal(declarations[1].crossfadeInSec, 0.5);

  const speech = declarations.map(item => ({
    ...item,
    sidecar: {
      path: `/cache/${item.id}.flac`,
      durationSec: item.outSec - item.inSec + (item.padBeforeSec ?? 0) + (item.padAfterSec ?? 0),
      padBeforeSec: item.padBeforeSec ?? 0,
      padAfterSec: item.padAfterSec ?? 0,
    },
    materialDurationSec: 10,
  }));
  const result = buildWebAudioSchedule({ timelineDurationSec: 7.5, startAtSec: 0, audio: { speech } });
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.items.map(item => [item.id, item.timelineStartSec, item.timelineEndSec]), [
    ['a-speech', 0, 4],
    ['b-speech', 3.5, 7.5],
  ]);
  assert.deepEqual(result.items[0].gainEvents.map(event => [event.offsetSec, event.value]), [
    [0, 1], [3.5, 1], [4, 0],
  ]);
  assert.deepEqual(result.items[1].gainEvents.map(event => [event.offsetSec, event.value]), [
    [0, 0], [0.5, 1], [4, 1],
  ]);
});

test('cuts 投影は speed / gain / 暗黙配置を保ち、freeze hold を無音の二分割にする', () => {
  const speech = projectSpeechDeclarations([
    { id: 'fast', src: 'source-a', in: 1, out: 5, speed: 2, gain_db: -3 },
    {
      id: 'frozen', src: 'source-b', in: 0, out: 4, speed: 1,
      volume_db: -9, freeze: { at_sec: 1, duration_sec: 2 },
    },
    { id: 'tail', src: 'source-a', in: 6, out: 7, gainDb: -1 },
  ], { fps: 30 });

  assert.deepEqual(speech.map(item => ({
    id: item.id, src: item.src, atSec: item.atSec, durationSec: item.durationSec,
    inSec: item.inSec, outSec: item.outSec, speed: item.speed, gainDb: item.gainDb,
  })), [
    {
      id: 'fast-speech', src: 'source-a', atSec: 0, durationSec: 2,
      inSec: 1, outSec: 5, speed: 2, gainDb: -3,
    },
    {
      id: 'frozen-speech-pre', src: 'source-b', atSec: 2, durationSec: 1,
      inSec: 0, outSec: 1, speed: 1, gainDb: -9,
    },
    {
      id: 'frozen-speech-post', src: 'source-b', atSec: 5, durationSec: 3,
      inSec: 1, outSec: 4, speed: 1, gainDb: -9,
    },
    {
      id: 'tail-speech', src: 'source-a', atSec: 8, durationSec: 1,
      inSec: 6, outSec: 7, speed: 1, gainDb: -1,
    },
  ]);
});

test('speech 未指定時は既存三種の予定値を保ち、新規素材軸フィールドだけ 1 倍で補う', () => {
  const result = buildWebAudioSchedule({
    timelineDurationSec: 8,
    startAtSec: 1,
    audio: {
      bgm: { id: 'bgm', durationSec: 3 },
      sfx: [{ id: 'sfx', durationSec: 2, t: 2 }],
      narration: [{ id: 'narration', durationSec: 2, t: 3 }],
    },
  });
  assert.deepEqual(result.items.map(item => item.kind), ['bgm', 'sfx', 'narration']);
  assert.ok(result.items.every(item => item.playbackRate === 1));
  assert.ok(result.items.every(item => item.sourceDurationSec === item.durationSec));
});
