// 前タスクの残課題「誤ヒット変種の回帰 fixture」への蓋。
// 混在トラックの cuts が (kind, ref) だけでホーミングすると、kind:'cuts' の行が複数ある場合に
// 別トラックの行へ間借り表示される。合わせて html 専用パック多数の実プロジェクト級構成でも、
// 全アイテムが自分の行に 1 つずつ出ることを固定する。

import assert from 'node:assert/strict';
import test from 'node:test';

import editStore from '@akari-video/edit-store';
import { indexEditV2Items } from '../lib/common/edit-v2-mutations.js';
import { resolveItemRowLayout } from '../lib/common/item-row-layout.js';

const { projectLegacyEdit, readInternalEdit } = editStore;

const mixedCutsFixture = {
  version: 2,
  output: { width: 1080, height: 1920, fps: 30 },
  sources: [
    { id: 's01', path: 'assets/a.mp4' },
    { id: 's02', path: 'assets/b.mp4' },
    { id: 's03', path: 'assets/c.mp4' }
  ],
  tracks: [
    { id: 'v0', lane: 'visual', name: '導入背景', items: [
      { id: 'intro-01', at: 0, duration: 120,
        source: { kind: 'media', src: 's01', in: 0, out: 4 } },
      { id: 'intro-02', at: 120, duration: 120,
        source: { kind: 'media', src: 's01', in: 4, out: 8 } }
    ] },
    { id: 'v1', lane: 'visual', name: '本編', items: [
      { id: 'logo-01', at: 0, duration: 90,
        source: { kind: 'html', path: 'overlays/logo.html' } },
      { id: 'clip-01', at: 90, duration: 240,
        source: { kind: 'media', src: 's02', in: 0, out: 8 } },
      { id: 'clip-02', at: 330, duration: 90,
        source: { kind: 'media', src: 's02', in: 8, out: 11 } }
    ] },
    { id: 'v2', lane: 'visual', name: '差し込み', items: [
      { id: 'bstroll-01', at: 400, duration: 150,
        source: { kind: 'media', src: 's03', in: 0, out: 5 } }
    ] },
    { id: 'v3', lane: 'visual', name: 'テロップ帯', items: [
      { id: 'telop-01', at: 10, duration: 60,
        source: { kind: 'html', path: 'overlays/t.html' } },
      { id: 'inset-01', at: 560, duration: 120,
        source: { kind: 'media', src: 's03', in: 5, out: 9 } }
    ] }
  ]
};

function projectFixture(edit) {
  const internal = readInternalEdit(edit);
  const view = projectLegacyEdit(internal);
  const layouts = (view.timeline?.tracks ?? []).map(track => ({
    id: track.id,
    kind: track.kind,
    track: track.ref ?? 0
  }));
  return { internal, view, layouts, itemLocations: indexEditV2Items(edit) };
}

function legacyItemIds(internal, collection) {
  const ids = [];
  for (const track of internal.tracks) {
    for (const item of track.items) {
      if (item.legacy.collection === collection) {
        ids[item.legacy.index] = item.id;
      }
    }
  }
  return ids;
}

test("誤ヒット変種の前提: kind:'cuts' 行が 2 本あり、混在トラックの cuts が別トラックの ref を名乗る", () => {
  const { view } = projectFixture(mixedCutsFixture);

  assert.deepStrictEqual(view.timeline?.tracks.map(track => ({
    id: track.id,
    kind: track.kind,
    ref: track.ref
  })), [
    { id: 'v0', kind: 'cuts', ref: 0 },
    { id: 'v1', kind: 'overlays', ref: 0 },
    { id: 'v2', kind: 'cuts', ref: 1 },
    { id: 'v3', kind: 'overlays', ref: 1 }
  ]);
  assert.equal(view.timeline?.tracks.filter(track => track.kind === 'cuts').length, 2);
  assert.equal(view.cuts.length, 6);
  assert.equal(view.overlays.length, 2);
  assert.equal(view.layers.length, 0);
});

test('(kind, ref) だけのホーミングは混在トラックの cuts を別トラック行へ間借りさせる', () => {
  const { internal, view, layouts } = projectFixture(mixedCutsFixture);
  const cutItemIds = legacyItemIds(internal, 'cuts');
  const resolved = Object.fromEntries(view.cuts.map((cut, index) => [
    cutItemIds[index],
    resolveItemRowLayout(layouts, undefined, 'cuts', cut.track)?.id
  ]));

  assert.deepStrictEqual(resolved, {
    'intro-01': 'v0',
    'intro-02': 'v0',
    'clip-01': 'v0',
    'clip-02': 'v0',
    'bstroll-01': 'v2',
    'inset-01': 'v2'
  });
});

test('v2 トラック id 優先のホーミングは全 cuts を自分のトラック行へ戻す', () => {
  const { internal, view, layouts, itemLocations } = projectFixture(mixedCutsFixture);
  const expected = {
    'intro-01': 'v0',
    'intro-02': 'v0',
    'clip-01': 'v1',
    'clip-02': 'v1',
    'bstroll-01': 'v2',
    'inset-01': 'v3',
    'logo-01': 'v1',
    'telop-01': 'v3'
  };
  const resolved = {};
  let mishits = 0;
  let homeless = 0;

  for (const [collection, items, kind] of [
    ['cuts', view.cuts, 'cuts'],
    ['overlays', view.overlays, 'overlays']
  ]) {
    const itemIds = legacyItemIds(internal, collection);
    items.forEach((item, index) => {
      const itemId = itemIds[index];
      const layout = resolveItemRowLayout(
        layouts,
        itemLocations.get(itemId)?.trackId,
        kind,
        item.track
      );
      resolved[itemId] = layout?.id;
      if (layout === undefined) homeless += 1;
      else if (layout.id !== expected[itemId]) mishits += 1;
    });
  }

  assert.deepStrictEqual(resolved, expected);
  assert.equal(mishits, 0);
  assert.equal(homeless, 0);
});

const identityTransform = { x: 0, y: 0, scale: 1, rotate: 0 };

const reelTimings = {
  t1: [[0, 89], [89, 129], [218, 118], [336, 129], [465, 76], [541, 75], [616, 186],
    [802, 150], [952, 80], [1032, 78], [1110, 99], [1209, 139], [1348, 110]],
  't2-pack1': [[89, 130], [336, 130], [541, 76], [802, 151], [1032, 79], [1209, 140]],
  't2-pack2': [[465, 77], [616, 187], [952, 81], [1110, 100]],
  't12-pack1': [[89, 129], [336, 129], [465, 76], [541, 75], [616, 186], [802, 150],
    [952, 80], [1032, 78], [1110, 99], [1209, 139]],
  't22-pack1': [[1, 42], [89, 130], [340, 54], [395, 71], [1223, 57], [1300, 49], [1410, 48]],
  't22-pack2': [[34, 27], [89, 17], [218, 17], [345, 33], [465, 77], [1223, 71], [1348, 17]],
  't22-pack3': [[58, 31], [336, 17], [465, 17], [511, 28], [541, 76]],
  't22-pack4': [[59, 30], [541, 17], [616, 187]],
  't22-pack5': [[616, 17], [802, 151]],
  't22-pack6': [[802, 17], [952, 81]],
  't22-pack7': [[952, 17], [1032, 79]],
  't22-pack8': [[1032, 17], [1110, 100]],
  't22-pack9': [[1110, 17], [1209, 17]]
};

function mediaItems(prefix, timings, sourceIdAt, transform) {
  return timings.map(([at, duration], index) => ({
    id: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    at,
    duration,
    ...(transform === undefined ? {} : { transform: { ...transform } }),
    source: {
      kind: 'media',
      src: sourceIdAt(index),
      in: 0,
      out: Number((duration / 30).toFixed(4))
    }
  }));
}

function makeReelFixture() {
  const sources = [
    { id: 'v-a', path: 'assets/source/a.mp4' },
    { id: 'v-b', path: 'assets/source/b.mp4' },
    { id: 'matte-top', path: 'assets/matte/mask-top.webm' },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `person-${index + 1}`,
      path: `assets/source/person-${index + 1}.mp4`
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `a-${index + 1}`,
      path: `assets/audio/sfx-${index + 1}.wav`
    })),
    { id: 'a-bgm', path: 'assets/audio/bgm.wav' }
  ];
  const audioSfx = Array.from({ length: 32 }, (_, index) => ({
    id: `sfx-${String(index + 1).padStart(2, '0')}`,
    at: 20 + index * 45,
    duration: 12,
    source: {
      kind: 'media',
      src: `a-${index % 8 + 1}`,
      in: 0,
      out: Number((12 / 30).toFixed(4))
    }
  }));
  const usedPanelIds = new Set();
  let nextPanel = 1;
  const nextPanelId = (trackId, index) => {
    if (trackId === 't22-pack1' && index === 5) {
      usedPanelIds.add(12);
      return 'panel-12';
    }
    while (usedPanelIds.has(nextPanel)) nextPanel += 1;
    const panelNumber = nextPanel;
    usedPanelIds.add(panelNumber);
    nextPanel += 1;
    return `panel-${String(panelNumber).padStart(2, '0')}`;
  };
  const htmlTracks = Array.from({ length: 9 }, (_, trackIndex) => {
    const id = `t22-pack${trackIndex + 1}`;
    return {
      id,
      lane: 'visual',
      items: reelTimings[id].map(([at, duration], index) => {
        const itemId = nextPanelId(id, index);
        return {
          id: itemId,
          at,
          duration,
          transform: { ...identityTransform },
          source: { kind: 'html', path: `overlays/${itemId}.html` }
        };
      })
    };
  });

  return {
    version: 2,
    output: { width: 1080, height: 1920, fps: 30 },
    sources,
    tracks: [
      { id: 'audio-0', lane: 'audio', items: audioSfx },
      { id: 'audio-1', lane: 'audio', items: [
        { id: 'bgm-1', at: 0, duration: 0, role: 'bgm',
          source: { kind: 'media', src: 'a-bgm', in: 0 } }
      ] },
      { id: 't1', lane: 'visual', items: mediaItems(
        't1', reelTimings.t1, () => 'v-a', identityTransform
      ) },
      { id: 't2-pack1', lane: 'visual', items: mediaItems(
        't2-pack1', reelTimings['t2-pack1'], () => 'v-b', identityTransform
      ) },
      { id: 't2-pack2', lane: 'visual', items: mediaItems(
        't2-pack2', reelTimings['t2-pack2'], () => 'v-b', identityTransform
      ) },
      { id: 't12-pack1', lane: 'visual', items: mediaItems(
        't12-pack1', reelTimings['t12-pack1'], index => `person-${index + 1}`,
        { x: 0, y: 250, scale: 1, rotate: 0 }
      ) },
      ...htmlTracks
    ]
  };
}

test('akari-reel 相当の構成でも timeline.tracks は 15 行・種別と ref が宣言順どおりに並ぶ', () => {
  const { view } = projectFixture(makeReelFixture());

  assert.deepStrictEqual(view.timeline?.tracks.map(track => ({
    id: track.id,
    kind: track.kind,
    ref: track.ref
  })), [
    { id: 'audio-0', kind: 'audio', ref: 0 },
    { id: 'audio-1', kind: 'audio', ref: 1 },
    { id: 't1', kind: 'cuts', ref: 0 },
    { id: 't2-pack1', kind: 'cuts', ref: 1 },
    { id: 't2-pack2', kind: 'cuts', ref: 2 },
    { id: 't12-pack1', kind: 'layers', ref: 0 },
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `t22-pack${index + 1}`,
      kind: 'overlays',
      ref: index
    }))
  ]);
  assert.equal(view.cuts.length, 23);
  assert.equal(view.overlays.length, 32);
  assert.equal(view.layers.length, 10);
  assert.equal(view.audioSfx.length, 32);
  assert.equal(view.audioBgm === undefined ? 0 : 1, 1);
});

test('全 98 アイテムのチップが期待行に 1 つずつ解決される（panel-12 を含む）', () => {
  const fixture = makeReelFixture();
  const { internal, view, layouts, itemLocations } = projectFixture(fixture);
  const expectedTrackByItem = new Map();
  for (const track of fixture.tracks) {
    for (const item of track.items) {
      expectedTrackByItem.set(item.id, track.id);
    }
  }
  const panel12 = fixture.tracks.flatMap(track => track.items.map(item => ({ trackId: track.id, ...item })))
    .find(item => item.id === 'panel-12');

  assert.equal(expectedTrackByItem.size, 98);
  assert.deepStrictEqual(
    panel12 === undefined ? undefined : {
      trackId: panel12.trackId,
      at: panel12.at,
      duration: panel12.duration
    },
    { trackId: 't22-pack1', at: 1300, duration: 49 }
  );

  let mishits = 0;
  let homeless = 0;
  let resolvedCount = 0;
  const resolvedTrackByItem = new Map();
  const visualTracks = internal.tracks.filter(track => track.lane === 'visual');
  for (const track of visualTracks) {
    for (const item of track.items) {
      const kind = item.legacy.collection;
      const ref = item.legacy.value?.track ?? track.legacy.ref ?? 0;
      const layout = resolveItemRowLayout(
        layouts,
        itemLocations.get(item.id)?.trackId,
        kind,
        ref
      );
      resolvedTrackByItem.set(item.id, layout?.id);
      if (layout === undefined) homeless += 1;
      else {
        resolvedCount += 1;
        if (layout.id !== expectedTrackByItem.get(item.id)) mishits += 1;
      }
    }
  }

  const audioTracks = internal.tracks.filter(track => track.lane === 'audio');
  for (const track of audioTracks) {
    const layout = layouts.find(candidate =>
      candidate.kind === 'audio' && candidate.track === track.legacy.ref
    );
    for (const item of track.items) {
      resolvedTrackByItem.set(item.id, layout?.id);
      if (layout === undefined) homeless += 1;
      else {
        resolvedCount += 1;
        if (layout.id !== expectedTrackByItem.get(item.id)) mishits += 1;
      }
    }
  }

  assert.equal(visualTracks.flatMap(track => track.items).length, 65);
  assert.equal(audioTracks.flatMap(track => track.items).length, 33);
  assert.equal(view.cuts.length + view.overlays.length + view.layers.length, 65);
  assert.equal(view.audioSfx.length + (view.audioBgm === undefined ? 0 : 1), 33);
  assert.equal(mishits, 0);
  assert.equal(homeless, 0);
  assert.equal(resolvedCount, 98);
  assert.equal(resolvedCount, expectedTrackByItem.size);
  assert.equal(resolvedTrackByItem.get('panel-12'), 't22-pack1');
});
