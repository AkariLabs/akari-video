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

// P0 2026-08-21 render-path-unification: 段（トラック）は media の旧種別に一切影響しない
// （legacyKindOfV2Track/buildV2Item はもう track 位置を見ない — needsLayersEngine 参照）。
// 素の media アイテムはどの段にあっても常に 'cuts'。
test('every plain media item projects to cuts regardless of which visual track it is on', () => {
  const view = projectLegacyEdit(readInternalEdit(base()));
  assert.equal(view.cuts.length, 2, JSON.stringify(view.cuts));
  assert.deepEqual(view.cuts.map(cut => cut.src).sort(), ['main', 'pip']);
  assert.equal(view.layers.length, 0);
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
  const afterInternal = readInternalEdit(movedToNewTrack());
  const afterView = projectLegacyEdit(afterInternal);
  // 移動後: 段が空トラック + 新設トラックだけの構成でも、素の media クリップは常に cuts。
  assert.equal(afterView.cuts.length, 1, 'moved clip should still project to cuts, not layers');
  assert.equal(afterView.cuts[0].src, 'main');
  assert.equal(afterView.layers.length, 0);
  // トラック側の旧種別ラベルも段に依存せず 'cuts' のまま（ラベル/色が変わらないことの土台）。
  const movedTrack = afterInternal.tracks.find(track => track.id === 'new-track');
  assert.equal(movedTrack.legacy.kind, 'cuts');
});

// P0 2026-08-21 render-path-unification（wave-verify r1/r2 差し戻しを経て、経路統合へ裁定）:
// r1/r2 は「トラック単位で一括昇格する」実装のまま item 単位の除外フィールドを積み増す
// ヒューリスティックだったため、反例トポロジ（挟まれた既存トラックの無関係クリップが
// 巻き込まれて昇格・降格する）が 2 回連続で見つかった。r3 は render-cut の cuts 経路自体に
// crop/perspective(静的)/keyframes(crop・transform)を実装して layers 相当の機能を持たせ、
// mainVisualTrack という「段に基づく推測」を完全に撤去した。今は crop を宣言していても
// 段に関わらず常に 'cuts'（render-cut の cut-transform.mjs が対応 — 詳細は report.md）。
// track A の素の media クリップを track B（crop 付き PiP を持つ既存トラック）へ移しても、
// 動かしていない B の PiP は crop 宣言を保ったまま 'cuts' で描かれ続ける（'layers' へは
// 落ちない — もう 'layers' へ落とす理由が無い）。
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

test('既存の crop 付き PiP トラックへクリップを移しても、動かしていない PiP は crop 宣言を保ったまま cuts のまま', () => {
  const internal = readInternalEdit(trackAtoExistingTrackB());
  const view = projectLegacyEdit(internal);
  // どちらも素の media（blend/perspective-keyframes 無し）なので、段に関わらずどちらも cuts。
  assert.equal(view.layers.length, 0, JSON.stringify(view.layers));
  assert.equal(view.cuts.length, 2, JSON.stringify(view.cuts));
  assert.deepEqual(view.cuts.map(cut => cut.src).sort(), ['main', 'pip']);
  // crop 宣言そのものは失われず declaration に残っている（render-cut が cuts 経路でも
  // crop を読めるよう cut-transform.mjs 側で実装済み。projectLegacyEdit の投影先である
  // internal.tracks[].items[].declaration で直接確認する）。
  const trackB = internal.tracks.find(track => track.id === 'b');
  const pip = trackB.items.find(item => item.id === 'pip-1');
  assert.equal(pip.legacy.collection, 'cuts');
  assert.deepEqual(pip.declaration.crop, { x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
});

test('非 normal blend を宣言するクリップだけは、段に関わらず常に layers のまま（cuts へ昇格しない）', () => {
  // 唯一残った 'layers' が必要な理由: blend は合成時（前面までに何があるか）に依存する演算で、
  // それは layers.mjs にしか実装が無い（アイテム自身の宣言だけで決まり、段は見ない）。
  const withBlend = readInternalEdit({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: [
      { id: 'v1', lane: 'visual', items: [
        { id: 'clip', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 }, blend: 'screen' },
      ] },
    ],
  });
  assert.equal(withBlend.tracks[0].items[0].legacy.collection, 'layers');

  // blend: 'normal'（既定と同値の明示宣言）は非対象 — cuts のまま。
  const withNormalBlend = readInternalEdit({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: [
      { id: 'v1', lane: 'visual', items: [
        { id: 'clip', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 }, blend: 'normal' },
      ] },
    ],
  });
  assert.equal(withNormalBlend.tracks[0].items[0].legacy.collection, 'cuts');
});

test('静的な perspective・crop/transform keyframes は cuts へ昇格する（cuts 経路が実装済みのため）', () => {
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
    { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 30, transform: { scale: 1.2 } }] },
    { keyframes: [{ t: 0, crop: { x: 0, y: 0, w: 1, h: 1 } }, { t: 30, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }] },
  ]) {
    const internal = withVisualProps(extra);
    const item = internal.tracks[0].items[0];
    assert.equal(item.legacy.collection, 'cuts', `${JSON.stringify(extra)} should be cuts (render-cut now implements this)`);
  }
});

test('アニメーションする perspective keyframe は layers のまま（cuts 経路は静的 perspective のみ対応）', () => {
  const internal = readInternalEdit({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: [
      { id: 'v1', lane: 'visual', items: [
        {
          id: 'clip', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 },
          keyframes: [
            { t: 0, perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] } },
            { t: 30, perspective: { corners: [[0.1, 0], [1, 0], [0, 1], [0.9, 1]] } },
          ],
        },
      ] },
    ],
  });
  assert.equal(internal.tracks[0].items[0].legacy.collection, 'layers');
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

// P0 2026-08-21 render-path-unification (Lead 指摘・L1 fork 発見のドラッグ例外の根治):
// legacy.index はトラック横断で一意・宣言順の通し番号でなければならない。以前は
// track.items.forEach のトラックごとにリセットされる index をそのまま使っていたため、
// 複数の cuts トラックが同じ「cuts」collection へ寄与すると legacy.index が衝突していた
// （2 本目以降のトラックのクリップが 1 本目のクリップと同じ legacy.index を名乗る）。
// apps/shell/extensions/akari-annotations の widget は legacy.index をキーにした配列
// （cutItemIds）でクリップの id を引くため、衝突が起きると 2 本目以降のクリップをドラッグした
// ときに id を特定できず例外を投げていた（mainVisualTrackId があった旧実装では「中身のある
// cuts トラックは常に高々 1 本」だったため、この衝突が実プロジェクトで到達不能だった —
// 経路統合で複数の cuts トラックが通常状態になり、初めて踏めるようになった）。
test('legacy.index stays globally unique and declaration-ordered across multiple cuts tracks (widget cutItemIds collision fix)', () => {
  const edit = {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [
      { id: 'main', path: 'main.mp4', proxy: null },
      { id: 'pip', path: 'pip.mp4', proxy: null },
    ],
    tracks: [
      { id: 't1', lane: 'visual', items: [
        { id: 'c1', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
        { id: 'c2', at: 60, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
      ] },
      { id: 't2', lane: 'visual', items: [
        { id: 'c3', at: 0, duration: 60, source: { kind: 'media', src: 'pip', in: 0, out: 2 } },
      ] },
    ],
  };
  const internal = readInternalEdit(edit);
  const cutItems = internal.tracks.flatMap(track => track.items)
    .filter(item => item.legacy.collection === 'cuts');
  // 一意性: 3 本とも異なる legacy.index を持つ（衝突ゼロ）。
  const indexes = cutItems.map(item => item.legacy.index);
  assert.deepEqual(new Set(indexes).size, indexes.length, `legacy.index must be unique, got ${JSON.stringify(indexes)}`);
  // 宣言順（トラック配列順→トラック内 item 順）と一致する: c1, c2, c3 の順で 0,1,2。
  assert.deepEqual(
    cutItems.map(item => ({ id: item.id, index: item.legacy.index })),
    [{ id: 'c1', index: 0 }, { id: 'c2', index: 1 }, { id: 'c3', index: 2 }],
  );
  // widget が cutItemIds[index] = item.id で組む配列を模倣し、2 本目トラックのクリップ（c3）が
  // 1 本目トラックのクリップ（c1）を上書きしていないこと、全スロットが埋まっていることを確認する。
  const cutItemIds = [];
  for (const item of cutItems) cutItemIds[item.legacy.index] = item.id;
  assert.deepEqual(cutItemIds, ['c1', 'c2', 'c3']);
  // projectLegacyEdit の cuts[] も同じ理由でトラック横断の宣言順のまま組まれることを確認する
  // （以前は legacy.index の衝突により Array.sort の安定ソートで他トラックの要素が割り込み、
  // 宣言順と異なる並びになり得た）。
  const view = projectLegacyEdit(internal);
  assert.deepEqual(view.cuts.map(cut => cut.src), ['main', 'main', 'pip']);
});

// 同一トラックへ 3 本以上のクリップが乗っても衝突しないことも確認する（team lead 指示 2:
// 「複数 cuts トラック構成で 2 本目のクリップの... 段移動が例外なく成立」の前提となる、
// 段を移した後もクリップの id が一意に解決できることの直接確認）。
test('legacy.index survives moving a clip into an existing multi-item cuts track without colliding', () => {
  const before = {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [
      { id: 'main', path: 'main.mp4', proxy: null },
      { id: 'pip', path: 'pip.mp4', proxy: null },
    ],
    tracks: [
      { id: 't1', lane: 'visual', items: [
        { id: 'moved-1', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
      ] },
      { id: 't2', lane: 'visual', items: [
        { id: 'c1', at: 0, duration: 60, source: { kind: 'media', src: 'pip', in: 0, out: 2 } },
        { id: 'c2', at: 60, duration: 60, source: { kind: 'media', src: 'pip', in: 0, out: 2 } },
      ] },
    ],
  };
  // moved-1 が t1 から t2 の末尾へ移った後の状態。
  const after = {
    ...before,
    tracks: [
      { id: 't1', lane: 'visual', items: [] },
      { id: 't2', lane: 'visual', items: [
        { id: 'c1', at: 0, duration: 60, source: { kind: 'media', src: 'pip', in: 0, out: 2 } },
        { id: 'c2', at: 60, duration: 60, source: { kind: 'media', src: 'pip', in: 0, out: 2 } },
        { id: 'moved-1', at: 120, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
      ] },
    ],
  };
  for (const edit of [before, after]) {
    const internal = readInternalEdit(edit);
    const cutItems = internal.tracks.flatMap(track => track.items)
      .filter(item => item.legacy.collection === 'cuts');
    const indexes = cutItems.map(item => item.legacy.index);
    assert.deepEqual(new Set(indexes).size, indexes.length, `legacy.index must be unique after the move, got ${JSON.stringify(indexes)}`);
    // 全アイテムに欠番なく id が引ける（widget の cutItemId() が例外を投げない条件そのもの）。
    const cutItemIds = [];
    for (const item of cutItems) cutItemIds[item.legacy.index] = item.id;
    for (let index = 0; index < cutItems.length; index += 1) {
      assert.ok(cutItemIds[index], `cutItemIds[${index}] must resolve to an item id, got ${JSON.stringify(cutItemIds)}`);
    }
  }
});

// P0 2026-08-21 render-path-unification (実測で発見: fieldtest/2026-08-06-pip-perspective-crop-check
// の実プロジェクトで再現): 'cuts'（concat チェーン）は同一トラック上の複数アイテムを
// 「順に連結される別セグメント」として扱う構造的前提を持つ。同じトラックに at/duration が
// 完全に重なる 2 つの media アイテム（例: 2 本の PiP が同時に映る）が乗っていると、
// buildMultiSourceCutCommand の concat がそれらを連結した 1 本の内部クリップにしてしまい、
// resolveCutTrackRanges が出力尺ぶんだけ先頭から trim するため、後ろに連結されたアイテムが
// 黙って描画から消える。時間的に重なるアイテムは常に 'layers'（独立した重ね合わせを正しく
// 表現できる唯一の経路）へ倒すことで防ぐ。
test('media items on the same track with fully overlapping at/duration both classify layers (concat cannot represent simultaneous overlap)', () => {
  const edit = {
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [
      { id: 'main', path: 'main.mp4', proxy: null },
      { id: 'pip', path: 'pip.mp4', proxy: null },
    ],
    tracks: [
      { id: 't1', lane: 'visual', items: [
        { id: 'cut-1', at: 0, duration: 240, source: { kind: 'media', src: 'main', in: 0, out: 8 } },
      ] },
      { id: 't2', lane: 'visual', items: [
        { id: 'pip-a', at: 0, duration: 240, transform: { scale: 0.7 }, crop: { x: 0.2, y: 0.3, w: 0.5, h: 0.3 },
          source: { kind: 'media', src: 'pip', in: 0, out: 8 } },
        { id: 'pip-b', at: 0, duration: 240, perspective: { corners: [[0, 0], [1, 0.2], [0, 1], [1, 0.8]] },
          source: { kind: 'media', src: 'pip', in: 0, out: 8 } },
      ] },
    ],
  };
  const internal = readInternalEdit(edit);
  const items = internal.tracks.flatMap(track => track.items);
  const byId = Object.fromEntries(items.map(item => [item.id, item]));
  assert.equal(byId['cut-1'].legacy.collection, 'cuts', 'the untouched base track is unaffected');
  assert.equal(byId['pip-a'].legacy.collection, 'layers', 'a fully-overlapping same-track item cannot be represented by concat');
  assert.equal(byId['pip-b'].legacy.collection, 'layers', 'its overlapping sibling is likewise forced to layers');
});

// A same-track transition_out crossfade is a DELIBERATE, narrow overlap (the tail of one cut
// blending into the head of the next) that the cuts/concat engine's own xfade support already
// represents correctly -- it must NOT be caught by the overlap rule above, or every existing
// transition_out project would be wrongly forced onto the layers engine.
test('a same-track transition_out crossfade overlap does not force layers (concat already represents it via xfade)', () => {
  const edit = {
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: [
      { id: 't1', lane: 'visual', items: [
        { id: 'c1', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2, transition_out: { type: 'dissolve', duration: 1 } } },
        { id: 'c2', at: 30, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
      ] },
    ],
  };
  const internal = readInternalEdit(edit);
  const items = internal.tracks.flatMap(track => track.items);
  const byId = Object.fromEntries(items.map(item => [item.id, item]));
  assert.equal(byId['c1'].legacy.collection, 'cuts', 'transition_out overlap stays on the cuts/xfade path');
  assert.equal(byId['c2'].legacy.collection, 'cuts', 'its crossfade partner likewise stays on cuts');
});

// r2 (合流前ゲート検収 REJECT・実測 apps/shell/extensions/akari-annotations 204/205 で発見):
// apps/shell/extensions/akari-annotations の insertCutIntoEdit（sequential モード）は、
// timeline-material-insert.ts 自身のコメントどおり「既存アイテムの at を再計算しない」契約を
// 持つ。タイムライン中間へ挿入すると、新規挿入アイテムの at（= 挿入前に後続アイテムが占めていた
// 位置）と、まだ古い at のままの後続アイテムが、同じ at で始まる部分的な重なりを起こす
// （実測: cut-1[0,120) の直後に 2s のクリップを挿入すると、新規アイテムは at=120/duration=60、
// 後続の既存アイテムは古い at=120/duration=90 のまま残る -- duration が異なるので完全一致ではない）。
// これは配列順で連結されるべき 3 アイテムの、片方だけがまだ書き戻されていない一時的に不正確な
// at であって、本当に同時に映る PiP ではない。上の "fully overlapping" テストとの対比:
// あちらは at・duration とも完全一致（同一区間）、こちらは at のみ一致（duration が違う =
// 部分的な重なり）。narrowed computeOverlappingItemIds はこの違いで両者を区別できなければならない。
test('a sequential mid-array insert leaving a stale, partially-overlapping trailing at does not force layers', () => {
  const edit = {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: [
      { id: 't1', lane: 'visual', items: [
        { id: 'cut-1', at: 0, duration: 120, source: { kind: 'media', src: 'main', in: 0, out: 4 } },
        // 新規挿入アイテム（cut-3 相当）: at=120/duration=60（2s @30fps）。
        { id: 'cut-3', at: 120, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
        // 既存アイテム（cut-2 相当）: at はまだ古いまま（挿入前の位置 120）。duration は
        // 別（90）なので cut-3 と完全一致ではない -- 部分的な重なりのみ。
        { id: 'cut-2', at: 120, duration: 90, source: { kind: 'media', src: 'main', in: 10, out: 13 } },
      ] },
    ],
  };
  const internal = readInternalEdit(edit);
  const items = internal.tracks.flatMap(track => track.items);
  const byId = Object.fromEntries(items.map(item => [item.id, item]));
  assert.equal(byId['cut-1'].legacy.collection, 'cuts', 'the untouched leading item is unaffected');
  assert.equal(byId['cut-3'].legacy.collection, 'cuts', 'the newly-inserted item stays on cuts (not a genuine PiP overlap)');
  assert.equal(byId['cut-2'].legacy.collection, 'cuts', 'the stale-at trailing item stays on cuts (not a genuine PiP overlap)');
});

// r3 (Codex re-review, MINOR): two zero-duration items sharing the same at are empty intervals
// that can never actually be visible at the same instant -- not a genuine overlap, even though
// their at AND duration are both exactly equal (the same shape the "fully overlapping"
// exact-match rule above otherwise flags).
test('two zero-duration items sharing the same at are not treated as an overlap (an empty interval never overlaps)', () => {
  const edit = {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: [
      { id: 't1', lane: 'visual', items: [
        { id: 'zero-a', at: 60, duration: 0, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
        { id: 'zero-b', at: 60, duration: 0, source: { kind: 'media', src: 'main', in: 2, out: 4 } },
      ] },
    ],
  };
  const internal = readInternalEdit(edit);
  const items = internal.tracks.flatMap(track => track.items);
  const byId = Object.fromEntries(items.map(item => [item.id, item]));
  assert.equal(byId['zero-a'].legacy.collection, 'cuts', 'a zero-duration item is not a genuine overlap');
  assert.equal(byId['zero-b'].legacy.collection, 'cuts', 'nor is its same-at, zero-duration sibling');
});
