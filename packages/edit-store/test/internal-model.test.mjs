import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LegacyEditVersionError,
  projectLegacyEdit,
  readInternalEdit,
  readInternalSources,
  visualContentEndSeconds,
} from '../lib/index.js';

const base = () => ({
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [
    { id: 'main', path: 'main.mp4', proxy: null },
    { id: 'pip', path: 'pip.mp4', proxy: null },
  ],
  tracks: [
    { id: 'base', lane: 'visual', items: [
      { id: 'c1', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
    ] },
    { id: 'upper', lane: 'visual', items: [
      { id: 'l1', at: 15, duration: 30, source: { kind: 'media', src: 'pip', in: 0, out: 1 } },
    ] },
  ],
});
test('readInternalEdit accepts v2 and keeps integer frames authoritative', () => {
  const internal = readInternalEdit(base());
  assert.equal(internal.output.fps, 30);
  assert.equal(internal.tracks[0].items[0].atFrames, 0);
  assert.equal(internal.tracks[0].items[0].durationFrames, 60);
  assert.equal(internal.tracks[0].items[0].duration, 2);
});

test('readInternalEdit and readInternalSources reject legacy versions', () => {
  for (const version of [0, 1]) {
    assert.throws(() => readInternalEdit({ version }), LegacyEditVersionError);
    assert.throws(() => readInternalSources({ version }), LegacyEditVersionError);
  }
});

test('lowest visual media track projects to cuts and upper visual media projects to layers', () => {
  const view = projectLegacyEdit(readInternalEdit(base()));
  assert.equal(view.cuts.length, 1);
  assert.equal(view.cuts[0].src, 'main');
  assert.equal(view.layers.length, 1);
  assert.equal(view.layers[0].src, 'pip.mp4');
});

// P0 2026-08-20 track-identity-and-duration: オーナー実機報告の再現。「本編（V1）にあった動画を
// 新しい段（新規トラック）へ移す」操作そのものは、元のトラックを空にして新トラックへクリップを
// 積むだけ（apps/shell/extensions/akari-annotations の moveItemToNewTrack と同じ形）。
// この操作の前後でクリップの旧種別（cuts/layers）・総尺が変わらないことを保証する。
const movedToNewTrack = () => ({
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
  tracks: [
    // 元の本編トラックは空になって残る（moveItemToNewTrack は空トラックを削除しない）。
    { id: 'base', lane: 'visual', items: [] },
    // クリップの移動先として新設された段（画面上は「V5」のような新規トラック）。
    { id: 'new-track', lane: 'visual', items: [
      { id: 'c1', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
    ] },
  ],
});

test('本編クリップを新設の空トラックへ移しても cuts のまま（段を動かしても種別が変わらない）', () => {
  const beforeInternal = readInternalEdit(base());
  const afterInternal = readInternalEdit(movedToNewTrack());
  const beforeView = projectLegacyEdit(beforeInternal);
  const afterView = projectLegacyEdit(afterInternal);
  // 移動前: 'main' は base（先頭・非空の media トラック）にあり cuts。
  assert.equal(beforeView.cuts.length, 1);
  assert.equal(beforeView.cuts[0].src, 'main');
  // 移動後: base は空になったので資格を失い、new-track（唯一の非空 media トラック）が
  // 本編トラックを引き継ぐ。同じクリップは引き続き cuts のまま、layers へは落ちない。
  assert.equal(afterView.cuts.length, 1, 'moved clip should still project to cuts, not layers');
  assert.equal(afterView.cuts[0].src, 'main');
  assert.equal(afterView.layers.length, 0);
  // トラック側の旧種別ラベルも段に依存せず 'cuts' のまま（ラベル/色が変わらないことの土台）。
  const movedTrack = afterInternal.tracks.find(track => track.id === 'new-track');
  assert.equal(movedTrack.legacy.kind, 'cuts');
});

// P0 2026-08-20 track-identity-and-duration r2（wave-verify r1 差し戻し）:
// クリップを「新設の空トラック」ではなく「既に crop 付き PiP を持つ既存トラック」へ移すと、
// 昇格した mainVisualTrackId がトラック単位で一括 'cuts' 化し、動かしていない既存の PiP
// クリップまで 'layers' -> 'cuts' へ黙って再分類される回帰があった（cuts 経路は crop を読まず
// 全画面不透明合成のため見た目が壊れる）。track A の素の media クリップを track B（A より
// 配列順で後ろ、crop 付き PiP を持つ）へ移しても、B の PiP クリップは layers のままであること。
const trackAtoExistingTrackB = () => ({
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [
    { id: 'main', path: 'main.mp4', proxy: null },
    { id: 'pip', path: 'pip.mp4', proxy: null },
  ],
  tracks: [
    // 移動元。移動後は空になって残る。
    { id: 'a', lane: 'visual', items: [] },
    // 移動先。crop 付きの正当な PiP クリップが元々ある既存トラック（A より配列順で後ろ）。
    { id: 'b', lane: 'visual', items: [
      {
        id: 'pip-1', at: 0, duration: 60,
        source: { kind: 'media', src: 'pip', in: 0, out: 2 },
        crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 },
      },
      // A から移ってきた、素の全画面クリップ（crop/perspective/blend/keyframes 一切なし）。
      { id: 'c1', at: 60, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
    ] },
  ],
});

test('既存の crop 付き PiP トラックへクリップを移しても、動かしていない PiP は layers のまま（トラック単位で一括 cuts 化しない）', () => {
  const internal = readInternalEdit(trackAtoExistingTrackB());
  const view = projectLegacyEdit(internal);
  // b は非空の visual トラックの中で配列順最初（a は空）なので mainVisualTrackId は b。
  // それでも b 上の crop 付き PiP は cuts へ昇格せず layers のまま。
  assert.equal(view.layers.length, 1, JSON.stringify(view.layers));
  assert.equal(view.layers[0].src, 'pip.mp4');
  assert.ok('crop' in view.layers[0], 'PiP の crop 宣言が保持されていること');
  // 移ってきた素の media クリップだけが cuts になる。
  assert.equal(view.cuts.length, 1);
  assert.equal(view.cuts[0].src, 'main');
  // アイテム単位でも直接確認: b トラック内の 2 アイテムの legacy.collection が分かれていること。
  const trackB = internal.tracks.find(track => track.id === 'b');
  const collections = Object.fromEntries(trackB.items.map(item => [item.id, item.legacy.collection]));
  assert.deepEqual(collections, { 'pip-1': 'layers', c1: 'cuts' });
});

test('perspective / blend / keyframes を宣言するクリップも mainVisualTrack 上で cuts へ昇格しない', () => {
  const withVisualProps = (extra) => readInternalEdit({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: [
      { id: 'v1', lane: 'visual', items: [
        { id: 'clip', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 }, ...extra },
      ] },
    ],
  });
  for (const extra of [
    { perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } },
    { blend: 'screen' },
    { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 30, transform: { scale: 1.2 } }] },
  ]) {
    const internal = withVisualProps(extra);
    const item = internal.tracks[0].items[0];
    assert.equal(item.legacy.collection, 'layers', `${JSON.stringify(extra)} should stay layers even as the sole visual track`);
  }
});

test('visualContentEndSeconds は cuts/layers の振り分けに関わらず全 visual アイテムの最大終端を返す', () => {
  // fps=30。cuts 側は [0,2)s（60 フレーム）で終わるが、layers 側が [3,5)s（90〜150 フレーム）まで
  // 伸びている。旧 validateCuts のような「cuts だけの合計 2s」ではなく、visual 全体の最大終端 5s
  // （layers 側が決める）を返すことが本テストの要点 — 症状 2（総尺が cuts に引っ張られて縮む）の直接の回帰確認。
  const fixture = {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }, { id: 'pip', path: 'pip.mp4', proxy: null }],
    tracks: [
      { id: 'base', lane: 'visual', items: [
        { id: 'c1', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
      ] },
      { id: 'upper', lane: 'visual', items: [
        { id: 'l1', at: 90, duration: 60, source: { kind: 'media', src: 'pip', in: 0, out: 2 } },
      ] },
    ],
  };
  assert.equal(visualContentEndSeconds(readInternalEdit(fixture)), 5);
  // c1 だけの movedToNewTrack() でも 2s のまま — トラックを移しても値は変わらない。
  assert.equal(visualContentEndSeconds(readInternalEdit(movedToNewTrack())), 2);
});

test('readInternalSources returns the v2 source table', () => {
  assert.deepEqual(readInternalSources(base()).map(({ id, path }) => ({ id, path })), [
    { id: 'main', path: 'main.mp4' },
    { id: 'pip', path: 'pip.mp4' },
  ]);
});

test('v2 audio.sfx keeps zero-based ids and a one-second provisional display duration', () => {
  const internal = readInternalEdit({
    ...base(),
    audio: {
      sfx: [
        { path: 'a.wav', t: 27 },
        { path: '', t: 28 },
        { path: 'c.wav', t: 49, in: 0.5, out: 2 },
      ],
    },
  });
  const sfx = internal.tracks
    .filter(track => track.lane === 'audio')
    .flatMap(track => track.items);
  assert.deepEqual(sfx.map(item => item.id), ['sfx-0', 'sfx-2']);
  assert.deepEqual(sfx.map(item => item.atFrames), [810, 1470]);
  assert.deepEqual(sfx.map(item => item.durationFrames), [30, 45]);
});
