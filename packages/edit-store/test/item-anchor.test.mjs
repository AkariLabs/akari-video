import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearItemAnchor,
  resolveItemAnchor,
  resolveItemAnchors,
  setItemAnchor,
  toAnchorCaptions,
} from '../lib/index.js';

const captions = [
  { id: 'c-0001', start: 2, end: 4 },
  { id: 'c-0002', start: 3, end: 3.5 },
];

function htmlItem(overrides = {}) {
  return {
    id: 'box',
    at: 0,
    duration: 1,
    source: { kind: 'html', path: 'overlays/box.html' },
    anchor: { caption: 'c-0001' },
    ...overrides,
  };
}

function editWith(item = htmlItem(), cuts = [
  { id: 'cut', at: 0, duration: 100, source: { kind: 'media', src: 'main', in: 0, out: 10 } },
]) {
  return {
    version: 2,
    output: { width: 320, height: 180, fps: 10 },
    sources: [{ id: 'main', path: 'assets/source.mp4' }],
    tracks: [
      { id: 'v-main', lane: 'visual', items: cuts },
      { id: 'v-overlay', lane: 'visual', items: [item] },
    ],
  };
}

function resolved(item, rows = captions, cuts) {
  return resolveItemAnchors(editWith(item, cuts), rows).edit.tracks[1].items[0];
}

test('行全体を at / duration のキャッシュへ解決する', () => {
  const item = resolved(htmlItem());
  assert.deepEqual({ at: item.at, duration: item.duration }, { at: 20, duration: 20 });
});

test('range は字幕内の source 秒区間だけを使う', () => {
  const item = resolved(htmlItem({ anchor: { caption: 'c-0001', range: { start: 2.5, end: 3 } } }));
  assert.deepEqual({ at: item.at, duration: item.duration }, { at: 25, duration: 5 });
});

test('正の offset は解決開始フレームへ加算する', () => {
  assert.equal(resolved(htmlItem({ anchor: { caption: 'c-0001', offset: 3 } })).at, 23);
});

test('負の offset はクランプせず返す', () => {
  assert.equal(resolved(htmlItem({ anchor: { caption: 'c-0001', offset: -25 } })).at, -5);
});

test('duration: own は既存の duration キャッシュを保持する', () => {
  const item = resolved(htmlItem({ duration: 7, anchor: { caption: 'c-0001', duration: 'own' } }));
  assert.deepEqual({ at: item.at, duration: item.duration }, { at: 20, duration: 7 });
});

test('純グループ内の子は親相対 at へ解決する', () => {
  const group = {
    id: 'group', at: 10, duration: 80, source: { kind: 'group' },
    items: [htmlItem()],
  };
  const item = resolved(group).items[0];
  assert.equal(item.at, 10);
});

test('親自身がアンカー付きなら親を先に解決してから子を解く', () => {
  const group = {
    id: 'group', at: 0, duration: 1, source: { kind: 'group' },
    anchor: { caption: 'c-0001' },
    items: [htmlItem({ anchor: { caption: 'c-0002' } })],
  };
  const item = resolved(group);
  assert.deepEqual({ at: item.at, duration: item.duration }, { at: 20, duration: 20 });
  assert.deepEqual({ at: item.items[0].at, duration: item.items[0].duration }, { at: 10, duration: 5 });
});

test('range の開始がカット内なら次の保持区間の先頭へスナップする', () => {
  const cuts = [
    { id: 'cut-a', at: 0, duration: 20, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
    { id: 'cut-b', at: 20, duration: 60, source: { kind: 'media', src: 'main', in: 4, out: 10 } },
  ];
  const item = resolved(
    htmlItem({ anchor: { caption: 'c-0001', range: { start: 3, end: 5 } } }),
    captions,
    cuts,
  );
  assert.deepEqual({ at: item.at, duration: item.duration }, { at: 20, duration: 10 });
});

test('range 全体がカット内ならキャッシュを保って unresolvable を返す', () => {
  const cuts = [
    { id: 'cut-a', at: 0, duration: 20, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
    { id: 'cut-b', at: 20, duration: 60, source: { kind: 'media', src: 'main', in: 4, out: 10 } },
  ];
  const edit = editWith(
    htmlItem({ at: 8, duration: 9, anchor: { caption: 'c-0001', range: { start: 2.2, end: 3.8 } } }),
    cuts,
  );
  const result = resolveItemAnchors(edit, captions);
  assert.strictEqual(result.edit, edit);
  assert.deepEqual(result.warnings, [{ id: 'box', reason: 'removed-range' }]);
});

test('timeDomain: output は sourceToOutput を通さない', () => {
  const item = resolved(htmlItem(), [{ id: 'c-0001', start: 5, end: 6, timeDomain: 'output' }]);
  assert.deepEqual({ at: item.at, duration: item.duration }, { at: 50, duration: 10 });
});

test('キャッシュに変化が無ければ edit は入力と同じ参照を返す', () => {
  const edit = editWith(htmlItem({ at: 20, duration: 20 }));
  const result = resolveItemAnchors(edit, captions);
  assert.strictEqual(result.edit, edit);
  assert.deepEqual(result.changes, []);
});

test('参照字幕が無ければキャッシュと入力参照を保って warning を返す', () => {
  const edit = editWith(htmlItem({ at: 7, duration: 8, anchor: { caption: 'c-9999' } }));
  const result = resolveItemAnchors(edit, captions);
  assert.strictEqual(result.edit, edit);
  assert.deepEqual(result.warnings, [{ id: 'box', reason: 'caption-not-found' }]);
});

test('resolveItemAnchor は duration: own と親相対を一度に計算する', () => {
  const result = resolveItemAnchor(
    htmlItem({ duration: 9, anchor: { caption: 'c-0001', duration: 'own' } }),
    {
      caption: captions[0],
      segments: [{ kind: 'src', outStart: 0, outEnd: 10, cutIndex: 0, in: 0, out: 10, speed: 1 }],
      fps: 10,
      parentAtFrames: 5,
    },
  );
  assert.deepEqual(result, { at: 15, duration: 9 });
});

test('setItemAnchor は anchor と解決キャッシュを同じ edit へ書く', () => {
  const edit = editWith(htmlItem({ at: 1, duration: 1, anchor: undefined }));
  const result = setItemAnchor(edit, 'box', { caption: 'c-0001' }, captions);
  assert.strictEqual(result.edit, edit);
  assert.deepEqual(edit.tracks[1].items[0].anchor, { caption: 'c-0001' });
  assert.deepEqual(
    { at: edit.tracks[1].items[0].at, duration: edit.tracks[1].items[0].duration },
    { at: 20, duration: 20 },
  );
});

test('clearItemAnchor は at / duration を焼き込みのまま残す', () => {
  const edit = editWith(htmlItem({ at: 20, duration: 20 }));
  clearItemAnchor(edit, 'box');
  assert.equal('anchor' in edit.tracks[1].items[0], false);
  assert.deepEqual(
    { at: edit.tracks[1].items[0].at, duration: edit.tracks[1].items[0].duration },
    { at: 20, duration: 20 },
  );
});

test('toAnchorCaptions は配列ルートを最小形へ正規化する', () => {
  assert.deepEqual(toAnchorCaptions([{ id: 'c-0001', start: 1, end: 2, text: 'x' }]), [
    { id: 'c-0001', start: 1, end: 2 },
  ]);
});

test('toAnchorCaptions は object ルートの captions[] を読む', () => {
  assert.deepEqual(toAnchorCaptions({ captions: [{ id: 'c-0002', start: 2, end: 3 }] }), [
    { id: 'c-0002', start: 2, end: 3 },
  ]);
});

test('toAnchorCaptions は id・start・end が不正な要素を除外する', () => {
  assert.deepEqual(toAnchorCaptions([
    null,
    { id: '', start: 0, end: 1 },
    { id: 'c-0001', start: Number.NaN, end: 1 },
    { id: 'c-0002', start: 0, end: Number.POSITIVE_INFINITY },
    { id: 'c-0003', start: 0, end: 1 },
  ]), [{ id: 'c-0003', start: 0, end: 1 }]);
});

test('toAnchorCaptions は time_domain: output を camelCase へ写す', () => {
  assert.deepEqual(toAnchorCaptions([
    { id: 'c-0001', start: 0, end: 1, time_domain: 'output' },
  ]), [{ id: 'c-0001', start: 0, end: 1, timeDomain: 'output' }]);
});

test('toAnchorCaptions は CaptionRecord の timeDomain: output を受ける', () => {
  assert.deepEqual(toAnchorCaptions([
    { id: 'c-0001', start: 0, end: 1, timeDomain: 'output' },
  ]), [{ id: 'c-0001', start: 0, end: 1, timeDomain: 'output' }]);
});

test('toAnchorCaptions は timeDomain と time_domain が競合すると camelCase を優先する', () => {
  assert.deepEqual(toAnchorCaptions([
    { id: 'c-0001', start: 0, end: 1, timeDomain: 'source', time_domain: 'output' },
  ]), [{ id: 'c-0001', start: 0, end: 1 }]);
});

test('toAnchorCaptions は空配列を空のまま返す', () => {
  assert.deepEqual(toAnchorCaptions([]), []);
});

test('toAnchorCaptions は非 object ルートを空配列にする', () => {
  for (const raw of [null, 1, 'captions', true, { captions: null }]) {
    assert.deepEqual(toAnchorCaptions(raw), []);
  }
});
