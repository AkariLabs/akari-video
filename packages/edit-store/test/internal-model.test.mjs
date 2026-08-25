import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findCrossTrackLayerEvacuations,
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

test('v2 audio tracks project sfx, narration, and bgm to their exact legacy shapes', () => {
  const edit = {
    ...base(),
    sources: [
      ...base().sources,
      { id: 'hit', path: 'hit.wav', proxy: null },
      { id: 'voice', path: 'voice.wav', proxy: null },
      { id: 'music', path: 'music.wav', proxy: null },
    ],
    tracks: [
      { id: 'narration', lane: 'audio', items: [{
        id: 'n-0001', at: 30, duration: 60, role: 'narration', gain_db: 1.5,
        script: 'hello', reading: 'こんにちは',
        provenance: { provider: 'human', engine: 'studio', voice: 'owner', generated_at: '2026-08-21T00:00:00Z' },
        source: { kind: 'media', src: 'voice', in: 0, out: 2 },
      }] },
      { id: 'sfx-0', lane: 'audio', items: [{
        id: 'hit-1', at: 45, duration: 15, gain_db: -6, fade_in: 0.1, fade_out: 0.2,
        source: { kind: 'media', src: 'hit', in: 0.25, out: 0.75 },
      }] },
      { id: 'bgm', lane: 'audio', items: [{
        id: 'music-item', at: 0, duration: 300, role: 'bgm',
        fade_in: 1.25, fade_out: 2.5, gain_db: -18, ducking: true,
        source: { kind: 'media', src: 'music', in: 0, out: 10 },
      }] },
      { id: 'sfx-1', lane: 'audio', items: [{
        id: 'hit-2', at: 90, duration: 0, role: 'sfx',
        source: { kind: 'media', src: 'hit' },
      }] },
      ...base().tracks,
    ],
  };
  const internal = readInternalEdit(edit);
  const view = projectLegacyEdit(internal);

  assert.deepEqual(view.audioSfx, [
    { id: 'hit-1', t: 1.5, duration: 0.5, path: 'hit.wav', track: 1, in: 0.25, out: 0.75, gainDb: -6 },
    { id: 'hit-2', t: 3, duration: 0, path: 'hit.wav', track: 3, in: 0 },
  ]);
  assert.deepEqual(view.audioNarration, [
    {
      id: 'n-0001', t: 1, path: 'voice.wav', track: 0, gainDb: 1.5, script: 'hello', reading: 'こんにちは',
      provenance: { provider: 'human', engine: 'studio', voice: 'owner', generated_at: '2026-08-21T00:00:00Z' },
    },
  ]);
  assert.deepEqual(view.audioBgm, {
    id: 'bgm', path: 'music.wav', track: 2, fadeIn: 1.25, fadeOut: 2.5, gainDb: -18, ducking: true,
  });
  assert.notEqual(view.audioNarration[0].track, view.audioBgm.track);
  assert.deepEqual(internal.tracks.slice(0, 4).map(track => track.legacy.ref), [0, 1, 2, 3]);
  assert.deepEqual(internal.tracks.slice(0, 4).map(track => track.items[0].legacy.collection), [
    'narration', 'sfx', 'bgm', 'sfx',
  ]);
  assert.deepEqual(
    { fade_in: internal.tracks[1].items[0].declaration.fade_in, fade_out: internal.tracks[1].items[0].declaration.fade_out },
    { fade_in: 0.1, fade_out: 0.2 },
  );
  assert.equal(internal.tracks[2].items[0].declaration.in, 0);
  assert.deepEqual(internal.tracks[3].items[0].source, {
    kind: 'media', sourceId: 'hit', path: 'hit.wav', in: 0, out: 0,
  });
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
  assert.equal(byId['cut-1'].legacy.collection, 'cuts', 'the bottom item remains the opaque cuts base');
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

test('partially overlapping media items on the same track both classify layers', () => {
  const edit = {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: [
      { id: 't1', lane: 'visual', items: [
        { id: 'cut-1', at: 0, duration: 120, source: { kind: 'media', src: 'main', in: 0, out: 4 } },
        // [120,180) と [150,240) は [150,180) の 30 frames だけ交差する。
        { id: 'cut-3', at: 120, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
        { id: 'cut-2', at: 150, duration: 90, source: { kind: 'media', src: 'main', in: 10, out: 13 } },
      ] },
    ],
  };
  const internal = readInternalEdit(edit);
  const items = internal.tracks.flatMap(track => track.items);
  const byId = Object.fromEntries(items.map(item => [item.id, item]));
  assert.equal(byId['cut-1'].legacy.collection, 'cuts', 'the untouched leading item is unaffected');
  assert.equal(byId['cut-3'].legacy.collection, 'layers');
  assert.equal(byId['cut-2'].legacy.collection, 'layers');
});

test('cross-track interval intersection keeps the bottom media as cuts, sends the upper media to layers, and preserves declarations', () => {
  const edit = {
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [
      { id: 'photo-a', path: 'photo-a.png', proxy: null },
      { id: 'photo-b', path: 'photo-b.png', proxy: null },
    ],
    tracks: [
      { id: 'v1', lane: 'visual', items: [
        { id: 'a', at: 0, duration: 360, transform: { scale: 1, x: 0, y: 0 },
          source: { kind: 'media', src: 'photo-a', in: 0, out: 12 } },
      ] },
      { id: 'v4', lane: 'visual', items: [
        { id: 'b', at: 120, duration: 120, transform: { scale: 0.5, x: 0, y: 0 },
          source: { kind: 'media', src: 'photo-b', in: 0, out: 4 } },
      ] },
    ],
  };
  const internal = readInternalEdit(edit);
  const [back, front] = internal.tracks;
  assert.equal(back.z, 0);
  assert.equal(front.z, 1);
  assert.deepEqual([back.legacy.kind, front.legacy.kind], ['cuts', 'layers']);
  assert.deepEqual([back.legacy.ref, front.legacy.ref], [0, 0]);
  assert.equal(back.items[0].legacy.collection, 'cuts');
  assert.equal(front.items[0].legacy.collection, 'layers');
  assert.deepEqual(
    [back.items[0].atFrames, back.items[0].durationFrames, back.items[0].declaration.transform],
    [0, 360, { scale: 1, x: 0, y: 0 }],
  );
  assert.deepEqual(
    [front.items[0].atFrames, front.items[0].durationFrames, front.items[0].declaration.transform],
    [120, 120, { scale: 0.5, x: 0, y: 0 }],
  );
  assert.deepEqual(
    [back.items[0].source.in, back.items[0].source.out, front.items[0].source.in, front.items[0].source.out],
    [0, 12, 0, 4],
    'engine selection does not change either item source window',
  );
  const view = projectLegacyEdit(internal);
  assert.deepEqual(view.cuts.map(cut => cut.src), ['photo-a'], 'bottom track remains the renderable base');
  assert.deepEqual(view.layers.map(layer => layer.id), ['b'], 'upper track is composited by layers');
  assert.deepEqual(view.layers.map(layer => layer.track), [0]);
});

test('cross-track layer evacuation reports the exact overlapping cause and frame interval', () => {
  const edit = {
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: [
      { id: 'v0', lane: 'visual', items: [
        { id: 'bg-1', at: 0, duration: 92,
          source: { kind: 'media', src: 'main', in: 0, out: 92 / 30 } },
      ] },
      { id: 'v1', lane: 'visual', items: [
        { id: 'clip-01', at: 90, duration: 60, crop: { x: 0, y: 0, w: 0.8, h: 1 },
          source: { kind: 'media', src: 'main', in: 0, out: 2,
            transition_out: { type: 'dissolve', duration: 1 } } },
        { id: 'clip-02', at: 150, duration: 60,
          source: { kind: 'media', src: 'main', in: 2, out: 4 } },
      ] },
    ],
  };
  assert.deepEqual(findCrossTrackLayerEvacuations(edit), [{
    itemId: 'clip-01',
    trackId: 'v1',
    causeItemId: 'bg-1',
    causeTrackId: 'v0',
    overlapStartFrames: 90,
    overlapEndFrames: 92,
  }]);
  const internal = readInternalEdit(edit);
  assert.equal(internal.tracks[1].items[0].legacy.collection, 'layers');
});

test('cross-track intersection with a full-frame opaque upper item keeps both media items on cuts', () => {
  const internal = readInternalEdit(base());
  assert.deepEqual(internal.tracks.map(track => track.items[0].legacy.collection), ['cuts', 'cuts']);
  assert.deepEqual(internal.tracks.map(track => track.legacy.kind), ['cuts', 'cuts']);
  assert.equal(projectLegacyEdit(internal).layers.length, 0);
});

test('cross-track intersection routes every declared non-full-frame upper shape to layers', () => {
  const upperShapes = [
    { transform: { scale: 0.8 } },
    { transform: { x: 1 } },
    { transform: { y: -1 } },
    { transform: { rotate: 1 } },
    { crop: { x: 0, y: 0, w: 0.9, h: 1 } },
    { opacity: 0.9 },
    { keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 30, transform: { scale: 1 } }] },
  ];
  for (const extra of upperShapes) {
    const edit = base();
    Object.assign(edit.tracks[1].items[0], extra);
    const internal = readInternalEdit(edit);
    assert.equal(
      internal.tracks[1].items[0].legacy.collection,
      'layers',
      `${JSON.stringify(extra)} should route the cross-track upper item to layers`,
    );
  }
});

test('media intervals that only touch at an endpoint do not classify as overlapping', () => {
  const edit = {
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: [
      { id: 'v1', lane: 'visual', items: [
        { id: 'a', at: 0, duration: 60, source: { kind: 'media', src: 'main', in: 0, out: 2 } },
      ] },
      { id: 'v2', lane: 'visual', items: [
        { id: 'b', at: 60, duration: 60, source: { kind: 'media', src: 'main', in: 2, out: 4 } },
      ] },
    ],
  };
  const internal = readInternalEdit(edit);
  assert.deepEqual(internal.tracks.map(track => track.items[0].legacy.collection), ['cuts', 'cuts']);
  assert.deepEqual(internal.tracks.map(track => track.legacy.kind), ['cuts', 'cuts']);
});

test('non-overlapping media project keeps the cuts engine selection unchanged', () => {
  const edit = base();
  edit.tracks[1].items[0].at = 60;
  const internal = readInternalEdit(edit);
  assert.deepEqual(internal.tracks.map(track => track.items[0].legacy.collection), ['cuts', 'cuts']);
  assert.equal(projectLegacyEdit(internal).layers.length, 0);
});

// r3 (Codex re-review, MINOR): two zero-duration items sharing the same at are empty intervals
// that can never actually be visible at the same instant -- not a genuine overlap, even though
// their at AND duration are both exactly equal (the same shape the "fully overlapping"
// exact-match rule above otherwise flags).
//
// r4 (Codex re-review, MAJOR) projects item.duration === 0 (schema-valid, see edit-v2.ts's
// requireInteger(value.duration, 0, ...) minimum) into a true zero-length segment
// (cutOut === cutIn) instead of the pre-r4 bug (cutOut fell back to item.source.out with no
// speed compensation, silently rendering a supposedly-invisible 0-duration item as a real,
// multi-second clip at normal speed).
//
// r5 (Codex re-review) tried dropping this zero-length segment ENTIRELY at this projection stage
// (legacy.value: undefined) instead of emitting it as a degenerate cut, reasoning that it gets
// rejected downstream anyway. r6 (Codex re-review) found that drop itself broken -- a second,
// separate render-cut projection path (internal-render.mjs's projectRendererCompatibilityEdit)
// reconstructs in/out directly and never reads legacy.value at all, so duration:0 could still
// leak into that path; and a dropped item still consumed a legacy.index slot while vanishing from
// projectLegacyEdit's own array, risking a UI index desync (edit/delete/drag landing on the wrong
// item) -- a new BLOCKER, not a fix. r6's control-tower adjudication: duration:0 stays
// schema-valid and projects to a real (degenerate) cut here exactly like r4, byte-identical;
// catching it is edit-lint's job at the front door (see edit-lint.mjs's own test suite for the
// duration:0-specific rejection), not this projection layer's.
test('two zero-duration items sharing the same at are not treated as an overlap, and each still projects to a real (degenerate, in === out) cut here -- rejecting duration:0 is edit-lint\'s job, not this layer\'s', () => {
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
  // Projection: cutOut must equal cutIn (a true zero-length segment), not item.source.out (which
  // would silently play the item's entire declared source span at normal speed) -- byte-identical
  // to r4, unaffected by r5's now-reverted drop attempt.
  assert.deepEqual(
    { in: byId['zero-a'].legacy.value.in, out: byId['zero-a'].legacy.value.out },
    { in: 0, out: 0 },
    'zero-a must project to a true zero-length segment (cutOut === cutIn === item.source.in), not its full declared source span',
  );
  assert.deepEqual(
    { in: byId['zero-b'].legacy.value.in, out: byId['zero-b'].legacy.value.out },
    { in: 2, out: 2 },
    'zero-b must project to a true zero-length segment starting at its own declared source.in (2), not its full declared source span',
  );
  assert.equal(byId['zero-a'].legacy.value.speed, undefined, 'speed is moot for a zero-length segment and must stay unset');
});

// r5 (Codex re-review, real regression this task's own r4 fix introduced): the short-circuit
// condition MUST key off the item's own declared output duration (durationFrames === 0), not the
// freeze-adjusted playbackDuration -- a whole-region freeze (a genuinely positive duration where
// ALL of it is a frozen hold, e.g. duration: 1s + freeze.duration_sec: 1s) also has
// playbackDuration === 0, but is a completely different, legitimate case: the clip IS visible for
// its full declared duration, it just never advances past its first frame. r4's own
// playbackDuration===0 check collapsed this to a literal zero-frame trim window too, which starves
// freeze's own seed-frame acquisition of anything to hold.
test('a whole-region freeze (positive duration, entirely covered by freeze) is not treated as a zero-duration item', () => {
  const edit = {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'main.mp4', proxy: null }],
    tracks: [
      { id: 't1', lane: 'visual', items: [
        {
          id: 'frozen', at: 0, duration: 30,
          source: { kind: 'media', src: 'main', in: 0, out: 1, freeze: { at_sec: 0, duration_sec: 1 } },
        },
      ] },
    ],
  };
  const internal = readInternalEdit(edit);
  const item = internal.tracks[0].items[0];
  assert.notEqual(item.legacy.value, undefined, 'a whole-region freeze clip has a real, positive duration and must not be dropped like a genuine duration:0 item');
  assert.ok(item.legacy.value.out > item.legacy.value.in, `expected a non-empty trim window to seed the freeze hold from, got ${JSON.stringify(item.legacy.value)}`);
});
