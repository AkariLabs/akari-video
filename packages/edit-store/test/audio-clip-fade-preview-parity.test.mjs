import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { renderFixture } from '../../render-cut/test/helpers/cut-audio-supply.mjs';
import { unsplitFixture } from './helpers/cut-audio-supply.mjs';

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 追記（audio-clip-fades）は、
// audio クリップの fade_in / fade_out を書き出しとプレビューの 3 面すべてで同じ意味論に
// すると決めている。第20項の修正は書き出し（internal-model の互換投影 + plan.mjs の afade）
// までで止まっており、buildWebAudioSchedule は narration / speech に baseGain のフラット
// 1 イベントしか組まなかった — 冒頭 1 秒のフェードインと末尾 0.25 秒のフェードアウトが
// プレビューでは聞こえないのに書き出すと掛かる、という食い違いが残っていた。
//
// lib/ は生成物なので（他レーンと共有・再生成はしない）、ここでは src/audio-schedule.ts を
// 直接 import して実装そのものを検査する。
const testDirectory = dirname(fileURLToPath(import.meta.url));
register('./helpers/ts-module-loader.mjs', pathToFileURL(`${testDirectory}/`));
const { buildWebAudioSchedule } = await import(
  pathToFileURL(join(testDirectory, '../src/audio-schedule.ts')).href
);

const closeTo = (actual, expected, message = '') => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message} expected ${expected}, got ${actual}`);
};

const shape = events => events.map(event => [event.offsetSec, event.value, event.method]);

/** renderFixture が ffprobe を固定で 12 秒と答えるので、decode 実尺もそれに合わせる。 */
const MATERIAL_DURATION_SEC = 12;

// -----------------------------------------------------------------------------
// 単体: gain events の形
// -----------------------------------------------------------------------------

test('narration / speech の fade_in / fade_out がプレビューの gain events になる', () => {
  // 不具合メモ 第20項の実値: 冒頭 1 秒のフェードイン・末尾 0.25 秒のフェードアウト。
  const result = buildWebAudioSchedule({
    timelineDurationSec: 20,
    startAtSec: 0,
    audio: {
      narration: [{
        id: 'audio-main', durationSec: 12, t: 2, in: 0, out: 4, gain_db: -2,
        fade_in: 1, fade_out: 0.25,
      }],
      // 音声レーンの role:'speech' はプレビューでは kind 'narration'（duckKey）として流れる。
      speech: undefined,
    },
  });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.items.length, 1);
  const narration = result.items[0];
  assert.equal(narration.kind, 'narration');
  closeTo(narration.durationSec, 4);
  const baseGain = Math.pow(10, -2 / 20);
  assert.deepEqual(narration.gainEvents.map(event => [event.offsetSec, event.method]), [
    [0, 'set'], [1, 'linear'], [3.75, 'linear'], [4, 'linear'],
  ]);
  closeTo(narration.gainEvents[0].value, 0, 'フェードイン始点は無音');
  closeTo(narration.gainEvents[1].value, baseGain, 'フェードイン終点は baseGain');
  closeTo(narration.gainEvents[2].value, baseGain, 'フェードアウト始点は baseGain');
  closeTo(narration.gainEvents[3].value, 0, 'フェードアウト終点は無音');
});

test('role:speech の音声アイテム（duckKey）も同じフェードを受ける', () => {
  const result = buildWebAudioSchedule({
    timelineDurationSec: 20,
    startAtSec: 0,
    audio: {
      narration: [{
        id: 'voice', durationSec: 12, t: 2, in: 0, out: 4, duration: 4, duckKey: true,
        fade_in: 1, fade_out: 0.25,
      }],
    },
  });
  assert.equal(result.items.length, 1);
  assert.deepEqual(shape(result.items[0].gainEvents), [
    [0, 0, 'set'], [1, 1, 'linear'], [3.75, 1, 'linear'], [4, 0, 'linear'],
  ]);
  // duckKey は narration 由来の duck 区間ではなく speech 鍵として扱われ続ける。
  assert.deepEqual(result.duckIntervals, [{ startSec: 2, endSec: 6 }]);
});

test('narration のフェードは実効尺の半分まで、fade_in / fade_out 独立にクランプされる', () => {
  const both = buildWebAudioSchedule({
    timelineDurationSec: 20,
    startAtSec: 0,
    audio: { narration: [{ id: 'n', durationSec: 12, t: 2, in: 0, out: 4, fade_in: 4, fade_out: 4 }] },
  });
  // 実効尺 4 秒 → 天井 2 秒。両端が 2 秒で出会うので中間点は 1 つ。
  assert.deepEqual(shape(both.items[0].gainEvents), [
    [0, 0, 'set'], [2, 1, 'linear'], [4, 0, 'linear'],
  ]);

  // 片側だけ超過しても、もう片側は宣言値のまま（独立クランプ）。
  const asymmetric = buildWebAudioSchedule({
    timelineDurationSec: 20,
    startAtSec: 0,
    audio: { narration: [{ id: 'n', durationSec: 12, t: 2, in: 0, out: 4, fade_in: 4, fade_out: 0.25 }] },
  });
  assert.deepEqual(shape(asymmetric.items[0].gainEvents), [
    [0, 0, 'set'], [2, 1, 'linear'], [3.75, 1, 'linear'], [4, 0, 'linear'],
  ]);
});

test('narration のフェード窓はタイムライン末尾で切った尺を基準にする', () => {
  // t=2 の 4 秒クリップだが、タイムラインは 4 秒で終わる。render-cut の
  // narrationDuration = Math.min(track.durationSec, Math.max(0, duration - track.t)) と同じ
  // 2 秒窓を基準にするので、フェードアウトは 1.75 秒（窓内）から始まる。
  const result = buildWebAudioSchedule({
    timelineDurationSec: 4,
    startAtSec: 0,
    audio: { narration: [{ id: 'n', durationSec: 12, t: 2, in: 0, out: 4, fade_in: 1, fade_out: 0.25 }] },
  });
  assert.equal(result.items.length, 1);
  closeTo(result.items[0].durationSec, 2);
  assert.deepEqual(shape(result.items[0].gainEvents), [
    [0, 0, 'set'], [1, 1, 'linear'], [1.75, 1, 'linear'], [2, 0, 'linear'],
  ]);
});

test('narration のフェードは fade_in / fadeIn の両綴りを読む', () => {
  const snake = buildWebAudioSchedule({
    timelineDurationSec: 20, startAtSec: 0,
    audio: { narration: [{ id: 'n', durationSec: 12, t: 2, in: 0, out: 4, fade_in: 1, fade_out: 0.25 }] },
  });
  const camel = buildWebAudioSchedule({
    timelineDurationSec: 20, startAtSec: 0,
    audio: { narration: [{ id: 'n', durationSec: 12, t: 2, in: 0, out: 4, fadeIn: 1, fadeOut: 0.25 }] },
  });
  // 両綴りが同じ形になること。フラット同士の一致で通らないよう、形そのものも固定する。
  const expected = [[0, 0, 'set'], [1, 1, 'linear'], [3.75, 1, 'linear'], [4, 0, 'linear']];
  assert.deepEqual(shape(snake.items[0].gainEvents), expected);
  assert.deepEqual(shape(camel.items[0].gainEvents), expected);
});

test('途中シークでも narration のフェードの掛かり方は変わらない', () => {
  const declaration = {
    id: 'n', durationSec: 12, t: 2, in: 0, out: 4, fade_in: 1, fade_out: 0.25,
  };
  // フェードインの途中（クリップ頭から 0.5 秒）で再開する。
  const seeked = buildWebAudioSchedule({
    timelineDurationSec: 20, startAtSec: 2.5, audio: { narration: [declaration] },
  });
  assert.deepEqual(seeked.items[0].gainEvents.map(event => event.offsetSec), [0, 0.5, 3.25, 3.5]);
  closeTo(seeked.items[0].gainEvents[0].value, 0.5, 'シーク地点のフェード倍率');
  closeTo(seeked.items[0].gainEvents[1].value, 1);
  closeTo(seeked.items[0].gainEvents[3].value, 0);

  // フェードアウトの途中（クリップ頭から 3.875 秒 = 残り 0.125 秒）で再開する。
  const late = buildWebAudioSchedule({
    timelineDurationSec: 20, startAtSec: 5.875, audio: { narration: [declaration] },
  });
  closeTo(late.items[0].gainEvents[0].value, 0.5, '残り半分のフェードアウト倍率');
  closeTo(late.items[0].gainEvents[late.items[0].gainEvents.length - 1].value, 0);
});

// -----------------------------------------------------------------------------
// 単体: 既存挙動の無退行
// -----------------------------------------------------------------------------

test('フェード未宣言の narration / speech は従来どおりフラットな 1 イベント', () => {
  for (const fade of [
    {},
    { fade_in: 0, fade_out: 0 },
    { fade_in: -1, fade_out: -1 },
    { fade_in: Number.NaN, fade_out: Number.POSITIVE_INFINITY },
    { fade_in: null, fade_out: 'いち' },
  ]) {
    const result = buildWebAudioSchedule({
      timelineDurationSec: 20,
      startAtSec: 0,
      audio: {
        narration: [
          { id: 'n', durationSec: 12, t: 2, in: 0, out: 4, gain_db: -2, ...fade },
          { id: 'voice', durationSec: 12, t: 8, in: 0, out: 4, duration: 4, duckKey: true, ...fade },
        ],
      },
    });
    assert.equal(result.items.length, 2, JSON.stringify(fade));
    for (const item of result.items) {
      assert.equal(item.gainEvents.length, 1, JSON.stringify(fade));
      assert.deepEqual(item.gainEvents[0], {
        offsetSec: 0, value: Math.pow(10, item.gainDb / 20), method: 'set',
      }, JSON.stringify(fade));
    }
  }
});

test('sfx と bgm の gainEvents は変更前と同じ（audio-schedule.test.mjs と同一 fixture）', () => {
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
  const bgm = result.items.find(item => item.kind === 'bgm');
  assert.deepEqual(bgm.gainEvents.map(event => [event.offsetSec, event.method]), [
    [0, 'set'], [2, 'linear'], [16, 'linear'], [20, 'linear'],
  ]);
  closeTo(bgm.gainEvents[0].value, 0);
  closeTo(bgm.gainEvents[1].value, Math.pow(10, -6 / 20));
  closeTo(bgm.gainEvents[3].value, 0);

  const sfx = result.items.find(item => item.kind === 'sfx');
  assert.deepEqual(sfx.gainEvents.map(event => [event.offsetSec, event.method]), [
    [0, 'set'], [1, 'linear'], [2, 'linear'], [3, 'linear'],
  ]);
  closeTo(sfx.gainEvents[0].value, 0);
  closeTo(sfx.gainEvents[1].value, Math.pow(10, -6 / 20));
  closeTo(sfx.gainEvents[3].value, 0);

  // sfx のフェード窓はタイムライン末尾で切らない（render-cut も trim.effectiveDuration を
  // そのまま使う）。narration とはここだけ窓の取り方が違う。
  const tail = buildWebAudioSchedule({
    timelineDurationSec: 4,
    startAtSec: 0,
    audio: { sfx: [{ id: 'hit', durationSec: 12, t: 2, in: 0, out: 4, fade_in: 1, fade_out: 0.25 }] },
  });
  assert.deepEqual(shape(tail.items[0].gainEvents), [[0, 0, 'set'], [1, 1, 'linear'], [2, 1, 'linear']]);

  const narration = result.items.find(item => item.kind === 'narration');
  assert.deepEqual(narration.gainEvents, [{ offsetSec: 0, value: 1, method: 'set' }]);
});

// -----------------------------------------------------------------------------
// 書き出し（render-cut）との一致
// -----------------------------------------------------------------------------

const graphOf = command => command.args[command.args.indexOf('-filter_complex') + 1];
const timelineDurationOf = command => Number(command.args[command.args.indexOf('-t') + 1]);

/** 生成コマンドの afade 対（st / d）を取り出す。fixture は必ず 1 クリップだけ持つ。 */
const afadesOf = graph => Object.fromEntries([...graph.matchAll(
  /afade=t=(in|out):st=([\d.]+):d=([\d.]+)/gu,
)].map(match => [match[1], { st: Number(match[2]), d: Number(match[3]) }]));

/**
 * gain events の折れ線から afade 相当の形（フェードインの尺・フェードアウトの開始と尺）を
 * 復元する。フェードインは窓頭の無音からの立ち上がり、フェードアウトは窓末尾の無音への
 * 落ち込みなので、両端のイベントだけを見れば決まる。
 */
function fadesOfGainEvents(events) {
  const fades = {};
  if (events.length > 1 && events[0].value < 1e-12) {
    fades.in = { st: events[0].offsetSec, d: events[1].offsetSec - events[0].offsetSec };
  }
  if (events.length > 1 && events[events.length - 1].value < 1e-12) {
    const start = events[events.length - 2].offsetSec;
    fades.out = { st: start, d: events[events.length - 1].offsetSec - start };
  }
  return fades;
}

/** legacy audio view + 固定 decode 実尺 → プレビューの schedule 入力。 */
const decodedAudioView = view => ({
  ...(view.bgm ? { bgm: { ...view.bgm, durationSec: MATERIAL_DURATION_SEC } } : {}),
  sfx: (view.sfx ?? []).map(item => ({ ...item, durationSec: MATERIAL_DURATION_SEC })),
  // プレビュー（akari-preview）は role:'speech' の音声アイテムを duckKey 付きの
  // narration として schedule へ渡す。
  narration: [
    ...(view.narration ?? []).map(item => ({ ...item, durationSec: MATERIAL_DURATION_SEC })),
    ...(view.speech ?? []).map(item => ({
      ...item, durationSec: MATERIAL_DURATION_SEC, duckKey: true,
    })),
  ],
});

const singleAudioItemFixture = item => {
  const doc = unsplitFixture();
  doc.tracks[1].items = [item];
  return doc;
};

// at 60 / fps 30 = t 2s、source [0, 4) = 実効尺 4 秒。ffprobe は 12 秒を返す。
const clip = patch => ({
  id: 'audio-main', at: 60, duration: 120, gain_db: -2,
  source: { kind: 'media', src: 'main', in: 0, out: 4 },
  ...patch,
});

test('同じ宣言から render-cut の afade と プレビューの gain events が一致する', () => {
  const table = [
    // 第20項の実値。
    ['narration fade_in 1 / fade_out 0.25', clip({ role: 'narration', fade_in: 1, fade_out: 0.25 }),
      { in: { st: 0, d: 1 }, out: { st: 3.75, d: 0.25 } }],
    // 実効尺の半分でのクランプ。
    ['narration クランプ（両側）', clip({ role: 'narration', fade_in: 4, fade_out: 4 }),
      { in: { st: 0, d: 2 }, out: { st: 2, d: 2 } }],
    ['narration クランプ（片側のみ）', clip({ role: 'narration', fade_in: 4, fade_out: 0.25 }),
      { in: { st: 0, d: 2 }, out: { st: 3.75, d: 0.25 } }],
    // 宣言尺（duration 60 = 2 秒）でタイムラインが終わるので、窓は 2 秒に切られる。
    ['narration 窓がタイムライン末尾で切れる',
      clip({ role: 'narration', duration: 60, fade_in: 1, fade_out: 0.25 }),
      { in: { st: 0, d: 1 }, out: { st: 1.75, d: 0.25 } }],
    ['片側だけの宣言（fade_in のみ）', clip({ role: 'narration', fade_in: 1 }),
      { in: { st: 0, d: 1 } }],
    ['片側だけの宣言（fade_out のみ）', clip({ role: 'narration', fade_out: 0.25 }),
      { out: { st: 3.75, d: 0.25 } }],
    // 素材実尺（renderFixture の ffprobe = 12 秒）を超える out は素材末尾へクランプされ、
    // 窓はさらにタイムライン末尾（宣言尺 4 秒 → 6 秒）で切られる。
    ['narration out が素材実尺を超える',
      clip({ role: 'narration', source: { kind: 'media', src: 'main', in: 0, out: 20 }, fade_in: 1, fade_out: 0.25 }),
      { in: { st: 0, d: 1 }, out: { st: 3.75, d: 0.25 } }],
    // 音声レーンの role:'speech'（会話音声）。
    ['speech fade_in 1 / fade_out 0.25', clip({ role: 'speech', fade_in: 1, fade_out: 0.25 }),
      { in: { st: 0, d: 1 }, out: { st: 3.75, d: 0.25 } }],
    // role:'speech' だけは宣言尺が [in, out) より短いとそこで切られる（plan.mjs の
    // kind === 'speech' 分岐 / プレビューの duckKey + spec.duration 分岐）。
    ['speech 宣言尺が [in, out) より短い',
      clip({ role: 'speech', duration: 60, fade_in: 1, fade_out: 0.25 }),
      { in: { st: 0, d: 1 }, out: { st: 1.75, d: 0.25 } }],
    // sfx は元から一致していた側。窓の取り方を変えていないことの確認。
    ['sfx fade_in 1 / fade_out 0.25', clip({ role: 'sfx', fade_in: 1, fade_out: 0.25 }),
      { in: { st: 0, d: 1 }, out: { st: 3.75, d: 0.25 } }],
    // 未宣言はどちらもフェードなし。
    ['narration フェード未宣言', clip({ role: 'narration' }), {}],
    ['speech フェード未宣言', clip({ role: 'speech' }), {}],
  ];

  for (const [name, item, expected] of table) {
    renderFixture(singleAudioItemFixture(item), 'osr', ({ edit, plan }) => {
      const mix = plan.commands.audio_mix;
      const rendered = afadesOf(graphOf(mix));
      assert.deepEqual(rendered, expected, `${name}: render-cut の afade`);

      const schedule = buildWebAudioSchedule({
        timelineDurationSec: timelineDurationOf(mix),
        startAtSec: 0,
        audio: decodedAudioView(edit.audio),
      });
      assert.equal(schedule.items.length, 1, `${name}: schedule は 1 クリップ`);
      assert.deepEqual(
        fadesOfGainEvents(schedule.items[0].gainEvents), rendered,
        `${name}: プレビューの gain events が書き出しの afade と食い違う`,
      );
    });
  }
});

test('render-cut と一致検査の表がフェード無しの経路も踏んでいる', () => {
  // 表がクランプ・片側宣言・未宣言の全分岐を実際に通ったことを固定する（空振り防止）。
  renderFixture(singleAudioItemFixture(clip({ role: 'narration' })), 'osr', ({ plan }) => {
    assert.doesNotMatch(graphOf(plan.commands.audio_mix), /afade=/u);
  });
});
