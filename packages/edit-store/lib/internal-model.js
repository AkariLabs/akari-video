"use strict";
/**
 * edit.json v2 を tracks-first の内部表現へ読む。
 * トラック配列順が下→上の合成順で、時刻は整数フレーム宣言を正本とする。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readInternalEdit = readInternalEdit;
exports.readInternalSources = readInternalSources;
exports.visualContentEndSeconds = visualContentEndSeconds;
exports.findCrossTrackLayerEvacuations = findCrossTrackLayerEvacuations;
exports.projectLegacyEdit = projectLegacyEdit;
exports.toLegacyTrack = toLegacyTrack;
exports.derivedLegacyTracks = derivedLegacyTracks;
const edit_v2_1 = require("./edit-v2");
const cut_adjacency_1 = require("./cut-adjacency");
const error_1 = require("./migrate/error");
/**
 * edit.json v2 を内部表現へ読む。v0/v1 は凍結変換ユニットのみが読む。
 * 文字列でもパース済みオブジェクトでも受け取る。
 */
function readInternalEdit(source, options) {
    const text = typeof source === 'string' ? source : JSON.stringify(source);
    if (typeof text !== 'string') {
        throw new Error('編集データの形式を確認できません。');
    }
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('編集データの形式を確認できません。');
    }
    const record = raw;
    if (record.version !== 2) {
        throw new error_1.LegacyEditVersionError(typeof record.version === 'number' ? record.version : -1);
    }
    return readV2Internal(record);
}
/**
 * 素材表だけを読む軽い入口（版を知るのは同じくここだけ）。アイテムまで要らない照合
 * （生素材と edit.json の突き合わせ等）が、全文の読み取りを払わずに済むようにする。
 */
function readInternalSources(source) {
    const raw = toRecord(source);
    if (!raw) {
        return [];
    }
    if (raw.version !== 2) {
        throw new error_1.LegacyEditVersionError(typeof raw.version === 'number' ? raw.version : -1);
    }
    return readV2Internal(raw).sources;
}
/**
 * 総尺の正本定義: 映像本体（cuts + layers 相当。source.kind が media / telop / filter）の
 * 全 visual トラックのアイテムの最大終端（出力秒）。「本編（cuts）かどうか」の旧種別は見ない
 * ため、段（トラック）を移動しても値が変わらない。edit-lint と render-cut の両方がこの 1 関数を
 * 共有し、定義がずれないようにする（P0 2026-08-20 track-identity-and-duration 指示 2）。
 * html（overlays）は含めない: overlays / captions / audio はこの尺に収まっているかを
 * 検証される側であり、検証対象自身を尺の分母に混ぜると常に「収まっている」判定になってしまう。
 */
function visualContentEndSeconds(internal) {
    let maxEnd = 0;
    for (const track of internal.tracks) {
        if (track.lane !== 'visual')
            continue;
        for (const item of track.items) {
            if (item.source.kind === 'html')
                continue;
            maxEnd = Math.max(maxEnd, item.at + item.duration);
        }
    }
    return maxEnd;
}
function toRecord(source) {
    try {
        const text = typeof source === 'string' ? source : JSON.stringify(source);
        if (typeof text !== 'string') {
            return undefined;
        }
        const parsed = JSON.parse(text);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
// ---------------------------------------------------------------------------
// v2
// ---------------------------------------------------------------------------
function readV2Internal(raw) {
    const edit = (0, edit_v2_1.readEditV2)(raw);
    const fps = edit.output.fps;
    const sources = edit.sources.map(entry => ({
        id: entry.id,
        declaredPath: entry.path,
        path: entry.path,
        declaredProxy: entry.proxy,
        proxy: entry.proxy ?? null,
        ...(entry.chroma_key !== undefined && entry.chroma_key !== null ? { chromaKey: entry.chroma_key } : {}),
        declarationPath: `sources[${entry.id}]`,
        isDefault: false
    }));
    const pathOf = (id) => sources.find(entry => entry.id === id)?.path;
    const chromaKeyOf = (id) => sources.find(entry => entry.id === id)?.chromaKey;
    const warnings = [];
    const refCounters = new Map();
    // P0 2026-08-21 render-path-unification (Lead 指摘・L1 fork 発見のドラッグ例外の根治):
    // legacy.index はトラック横断で一意な「宣言順の通し番号」でなければならない。以前は
    // track.items.forEach の**トラックごとにリセットされる** index をそのまま使っていたため、
    // 複数トラックが同じ legacy.collection（cuts/layers/overlays/sfx）へ寄与すると
    // index が衝突していた。mainVisualTrackId があった旧実装では「中身のある cuts トラックは
    // 常に高々 1 本」だったため踏まなかったが、統合後は複数の cuts トラックが通常状態になり、
    // apps/shell/extensions/akari-annotations の cutItemIds（legacy.index をキーにした配列）が
    // 後勝ちで上書き・穴あきになり、2 本目以降のトラックのクリップをドラッグすると
    // cutItemId() が例外を投げていた（同じ根から packages/render-cut/src/internal-render.mjs の
    // projectRendererCompatibilityEdit・packages/edit-store/src/internal-model.ts の
    // projectLegacyEdit 双方の「legacy.index で安定ソートして配列を組む」処理も、
    // 衝突する index のせいで宣言順とは違う順に並び替わり得た）。
    // legacyIndexCounters で collection 別に通し番号を発行し、buildV2Item 内の全 7 箇所の
    // legacy.index 代入をこれに差し替える。
    const legacyIndexCounters = new Map();
    // P0 2026-08-21 render-path-unification: どの段（トラック）にあるかは、もう source.kind:'media'
    // アイテムの旧種別（cuts/layers）に一切影響しない。render-cut の cuts 経路
    // （packages/render-cut/src/cut-transform.mjs）が transform/crop/perspective/keyframes/
    // transition_out/speed/freeze の全機能集合を持つに至ったため、位置による「本編か否か」の
    // 推測（旧 mainVisualTrackId）自体を撤去した。media アイテムの旧種別は常に 'cuts'
    // （= layers 相当の見た目・機能も含めて描ける唯一の経路）。'layers' に残るのは、
    // まだ cuts 経路へ移していない機能（非 normal blend の合成時ブレンド演算・
    // アニメーションする perspective）を宣言するアイテムと、cuts の構造では同時表示できない
    // 時間重なりだけ（needsLayersEngine / computeOverlappingItemIds 参照）。
    // cuts の winner-take-all 経路では、同一トラック内だけでなく別 visual トラック間の
    // 同時表示も表現できない。先に全 visual media アイテムを横断して区間交差を求め、
    // 参加したアイテムを各トラックの build へ同じ集合として渡す。これにより preview / render
    // の両方が、トラックごとに独立した要素を合成できる layers 経路を選ぶ。
    const overlappingItemIds = computeOverlappingItemIds(edit.tracks.flatMap(track => 'items' in track && track.lane === 'visual' ? [track.items] : []), pathOf);
    const tracks = edit.tracks.map(track => {
        // P0 2026-08-21 render-path-unification (実測で発覚): 'cuts' 経路（concat チェーン）は
        // 同じトラック上の複数アイテムを「順番に連結される別セグメント」として扱う構造的前提を
        // 持つ。同じトラックに時間的に重なる（同時に映る）2 アイテムが乗っていると、
        // buildMultiSourceCutCommand の concat はそれらを連結された 1 本の内部クリップにしてしまい、
        // resolveCutTrackRanges が出力尺ぶんだけを先頭から trim するため、後ろに連結された
        // アイテムが黙って描画から消える（実測: fieldtest/2026-08-06-pip-perspective-crop-check
        // で pip-perspective-demo が消失することを非回帰監査で発見）。'layers' 経路は各アイテムを
        // 独立した重ね合わせとして扱うため、重なりを正しく表現できる唯一の経路である。
        // そのため、同一トラック内で他アイテムと時間区間が重なる media アイテムは、宣言内容に
        // 関わらず常に 'layers' 扱いにする（段の位置ではなく、そのトラック自身の中身が
        // 構造的に 'cuts' で表現不可能かどうかで決まる — 推測の再導入にはあたらない）。
        // legacyKindOfV2Track（トラック単位の旧種別・ref 採番元）にも同じ判定を渡す:
        // track.items[0] だけを見て 'cuts' と判定すると、実際には items[0] が重なりで 'layers' に
        // 倒れているのに track 自体は 'cuts' 名乗ったままになり、usesDefaultInternalTrackOrder が
        // 無関係に buildTrackStackPlan（実際には不要な余分なエンコード世代）へ倒れてしまう
        // （非回帰監査で実測: pip-perspective-crop-check が本来要らない track_stack を経由していた）。
        const kind = legacyKindOfV2Track(track, chromaKeyOf, overlappingItemIds);
        const ref = kind === 'captions' ? undefined : nextRef(refCounters, kind);
        const items = [];
        if ('items' in track) {
            track.items.forEach(item => {
                const built = buildV2Item(item, fps, ref ?? 0, track.lane, pathOf, chromaKeyOf, legacyIndexCounters, overlappingItemIds.has(item.id));
                if (built.warning) {
                    warnings.push(built.warning);
                }
                items.push(built.item);
            });
        }
        return {
            id: track.id,
            lane: track.lane,
            z: track.z,
            ...(track.name !== undefined ? { name: track.name } : {}),
            origin: 'declared',
            ...('content' in track ? { content: { from: 'captions.json' } } : {}),
            items,
            legacy: { kind, ...(ref === undefined ? {} : { ref }) }
        };
    });
    // 旧 top-level audio と tracks[] 音声が同居すると、後者に加えてこの fallback も射影される。
    // どちらを優先するかは未裁定なので、旧 fixture の互換挙動を変えず二重計上の可能性を残す。
    addV2AudioItems(tracks, edit.audio, fps, legacyIndexCounters);
    synthesizeHiddenTransitionHandlesForRender(tracks, fps);
    return {
        output: {
            width: edit.output.width,
            height: edit.output.height,
            fps,
            ...(edit.output.look !== undefined ? { look: edit.output.look } : {})
        },
        sources,
        sourceTableDeclared: true,
        emptyProject: sources.length === 0,
        tracks,
        tracksDeclared: true,
        warnings,
        declaration: {
            ...(edit.audio !== undefined ? { audio: edit.audio } : {}),
            ...(edit.captions !== undefined ? { captions: edit.captions } : {})
        }
    };
}
/**
 * render-cut に加え shell プレビューの summary と Web UI の readRenderEdit も
 * item.declaration を読む。そのため出荷プレビューはこの合成済み実重なりを既存窓として描く。
 * UI / lint が読む item の at/duration/source と legacy.value は生タイムラインのまま保ち、
 * 突き合わせ境界の隠れのりしろだけを declaration 上の物理重なりへ合成して既存
 * xfade/acrossfade と 2 つのプレビューへ渡す。生 cuts を直接読む消費者の隠れのりしろ経路とは
 * packages/edit-store/test/transition-window-path-equivalence.test.mjs で等価性を固定する。
 */
function synthesizeHiddenTransitionHandlesForRender(tracks, fps) {
    const speedOf = (item) => {
        const speed = item.declaration.speed;
        return typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : 1;
    };
    for (const track of tracks) {
        if (track.lane !== 'visual')
            continue;
        const cuts = track.items.filter((item) => item.legacy.collection === 'cuts' && item.source.kind === 'media');
        for (let index = 0; index + 1 < cuts.length; index++) {
            const outgoing = cuts[index];
            const incoming = cuts[index + 1];
            if ((0, cut_adjacency_1.cutOverlapFrames)({ tlEnd: outgoing.at + outgoing.duration }, { tlStart: incoming.at }, fps) !== 0)
                continue;
            const transition = outgoing.declaration.transition_out;
            if (!isRecord(transition)
                || typeof transition.duration !== 'number'
                || !Number.isFinite(transition.duration)
                || transition.duration <= 0)
                continue;
            const incomingSpeed = speedOf(incoming);
            const incomingStill = (0, cut_adjacency_1.isStillImageSourcePath)(incoming.source.path);
            const plan = (0, cut_adjacency_1.planTransitionHandleWindow)({
                declaredSeconds: transition.duration,
                outgoingTailRoomSeconds: Number.POSITIVE_INFINITY,
                incomingHeadRoomSeconds: incomingStill
                    ? Number.POSITIVE_INFINITY : incoming.source.in / incomingSpeed,
                outgoingDurationSeconds: outgoing.duration,
                incomingDurationSeconds: incoming.duration
            });
            if (plan.effectiveSeconds <= 0)
                continue;
            const outgoingSpeed = speedOf(outgoing);
            outgoing.declaration = {
                ...outgoing.declaration,
                out: Number(outgoing.declaration.out) + plan.halfSeconds * outgoingSpeed,
                transition_out: { ...transition, duration: plan.effectiveSeconds }
            };
            incoming.declaration = incomingStill
                ? {
                    ...incoming.declaration,
                    at: Number(incoming.declaration.at) - plan.halfSeconds,
                    out: Number(incoming.declaration.out) + plan.halfSeconds * incomingSpeed
                }
                : {
                    ...incoming.declaration,
                    at: Number(incoming.declaration.at) - plan.halfSeconds,
                    in: Number(incoming.declaration.in) - plan.halfSeconds * incomingSpeed
                };
        }
    }
}
function legacyKindOfV2Track(track, chromaKeyOf, overlappingItemIds) {
    if (!('items' in track)) {
        return 'captions';
    }
    if (track.lane === 'audio') {
        return 'audio';
    }
    const first = track.items[0];
    switch (first?.source.kind) {
        case 'html': return 'overlays';
        case 'telop':
        case 'filter': return 'layers';
        // 空トラック（first === undefined）は中身が無く旧種別は名目上のものでしかない。'layers' を
        // 既定にする: 'cuts' にすると、このトラックも nextRef の 'cuts' カウンタを消費して
        // しまい、後続の実際に中身がある cuts トラックの ref 番号がずれる
        // （旧 track: N を見る needsGapAwareCutTimeline が誤って gap-aware 経路へ倒れる）。
        // 'layers' は別カウンタなので、空トラックの存在が実クリップの分類・ref に影響しない
        // （P0 2026-08-20 track-identity-and-duration r1 で踏んだのと同じ罠）。
        default: return first === undefined
            || track.items.some(item => overlappingItemIds.has(item.id))
            || needsLayersEngine(first, chromaKeyOf, overlappingItemIds.has(first.id))
            ? 'layers' : 'cuts';
    }
}
// P0 2026-08-21 render-path-unification: cuts 経路（packages/render-cut/src/cut-transform.mjs）へ
// まだ移していない機能を宣言する media アイテム、または computeOverlappingItemIds が
// 同時表示のために指定した media アイテムだけが 'layers' に残る。機能判定自体は段を見ないが、
// 重なり判定は宣言された時刻とトラックの z 関係を使う。
// - blend: 'normal' 以外は合成時（前面までに何があるか）に依存するブレンド演算が要り、
//   それは packages/render-cut/src/layers.mjs にしか実装が無い
// - perspective keyframes: ffmpeg の perspective フィルタはフレームごとの式評価に対応しないため、
//   layers.mjs は宣言全体を静的な複数レイヤーへ事前展開している（layer-keyframes.mjs の
//   expandLayerForPerspectiveKeyframes）。この展開は t/duration ベースの layers 配列専用で、
//   at/in/out ベースの cuts 配列へは未移植（本タスクのスコープ外。report.md 参照）
// chromaKeyOf: 宣言（item.source.chroma_key）が無いときは素材表の既定（sources[].chroma_key）に
// フォールバックする（copyMediaSourceFields / appendMultiSourceChromaKey と同じ解決順）。
function needsLayersEngine(item, chromaKeyOf, hasOverlappingSibling = false) {
    if (item.source.kind !== 'media')
        return false;
    if ('mask' in item && item.mask !== undefined)
        return true;
    if (item.blend !== undefined && item.blend !== 'normal')
        return true;
    if (Array.isArray(item.keyframes) && item.keyframes.some(point => point && typeof point === 'object' && 'perspective' in point && point.perspective !== undefined))
        return true;
    // cuts 経路の chroma_key（packages/render-cut/src/plan.mjs の appendMultiSourceChromaKey）と
    // layers 経路の chroma_key（layers.mjs）は意味が異なる: cuts はキー抜き部分を「指定/既定の
    // 背景色・背景画像で塗りつぶす」実装、layers は「透過にして下のトラックを見せる」実装で、
    // background 差し替えの手段を持たない（layers.mjs 自身が宣言時に警告する）。
    // どちらを選ぶかは「background を宣言したか」というアイテム自身の宣言だけで決まる
    // （段の位置には依存しない）: background 宣言ありは cuts でしか実現できないため cuts へ、
    // background 宣言なし（透過して下を見せる意図）は layers へ。
    const chromaKey = item.source.chroma_key ?? chromaKeyOf?.(item.source.src);
    if (chromaKey !== undefined && chromaKey !== null) {
        const hasBackground = typeof chromaKey === 'object'
            && typeof chromaKey.background === 'string'
            && chromaKey.background.length > 0;
        if (!hasBackground)
            return true;
    }
    // 'cuts'（concat チェーン）は同一トラック上の複数アイテムを「順に連結される別セグメント」
    // として扱う構造的前提を持つ。同じトラックに時間的に重なる 2 アイテムが乗っていると、
    // concat はそれらを連結した 1 本の内部クリップにしてしまい、出力尺ぶんだけを先頭から
    // trim するため、後ろに連結されたアイテムが黙って描画から消える（readV2Internal の
    // computeOverlappingItemIds 呼び出し側コメント参照。実測で発見: fieldtest の
    // pip-perspective-crop-check で同一トラックの 2 番目の PiP が消失していた）。
    if (hasOverlappingSibling)
        return true;
    return false;
}
function analyzeOverlappingItems(itemGroups, pathOf) {
    const overlapping = new Set();
    const crossTrackEvacuations = [];
    const entries = itemGroups.flatMap((group, trackIndex) => group.items.map(item => ({ item, trackIndex, trackId: group.trackId })));
    for (let i = 0; i < entries.length; i++) {
        const { item: a, trackIndex: aTrackIndex, trackId: aTrackId } = entries[i];
        if (a.source.kind !== 'media')
            continue;
        for (let j = i + 1; j < entries.length; j++) {
            const { item: b, trackIndex: bTrackIndex, trackId: bTrackId } = entries[j];
            if (b.source.kind !== 'media')
                continue;
            if (!(a.at < b.at + b.duration && b.at < a.at + a.duration))
                continue;
            const sameTrack = aTrackIndex === bTrackIndex;
            if (sameTrack
                && (a.source.transition_out !== undefined || b.source.transition_out !== undefined))
                continue;
            if (sameTrack) {
                overlapping.add(a.id);
                overlapping.add(b.id);
            }
            else {
                const upperIsA = aTrackIndex > bTrackIndex;
                const upper = upperIsA ? a : b;
                const lower = upperIsA ? b : a;
                if (needsCrossTrackLayers(upper, pathOf)) {
                    overlapping.add(upper.id);
                    crossTrackEvacuations.push({
                        itemId: upper.id,
                        trackId: upperIsA ? aTrackId : bTrackId,
                        causeItemId: lower.id,
                        causeTrackId: upperIsA ? bTrackId : aTrackId,
                        overlapStartFrames: Math.max(a.at, b.at),
                        overlapEndFrames: Math.min(a.at + a.duration, b.at + b.duration)
                    });
                }
            }
        }
    }
    return { itemIds: overlapping, crossTrackEvacuations };
}
function computeOverlappingItemIds(itemGroups, pathOf) {
    return analyzeOverlappingItems(itemGroups.map((items, index) => ({
        items,
        trackId: String(index)
    })), pathOf).itemIds;
}
/**
 * 別 visual track との重なりが原因で upper item が layers へ退避される組を返す。
 * edit-lint と UI は理由文言に必要な相手 id を、この単一定義から得る。
 */
function findCrossTrackLayerEvacuations(edit) {
    const parsed = (0, edit_v2_1.readEditV2)(edit);
    const pathOf = (id) => parsed.sources.find(entry => entry.id === id)?.path;
    return analyzeOverlappingItems(parsed.tracks.flatMap(track => track.lane === 'visual' && 'items' in track
        ? [{ items: track.items, trackId: track.id }]
        : []), pathOf).crossTrackEvacuations;
}
// cuts の winner-take-all が下段を隠してよいのは、上段が全画面を不透明に覆う場合だけ。
// transform の単位元を明示しただけなら従来経路を維持する。crop / 半透明 / keyframes は、
// 現在または途中フレームで下段が見える可能性があるため宣言の存在だけで layers へ退避する。
// 加えて、アルファを運べるコンテナ（webm / mov — 本製品のマット生成パイプラインの出力形式）は
// 宣言からは不透明を証明できないため、単位元 transform でも layers へ退避する。単位元 transform の
// 全画面アルファ webm（例: mask-top.webm）が cuts に残ると、プレビューの平坦化で
// マットが本編の勝者になり「ソース範囲がほぼ同一の縮退セグメント群」を作って
// 再生ヘッドが境界で巻き戻る（2026-08-26 akari-reel 実機・15.5s→11.2s ループの真因）。
// 静止画（png 等）は退避先の layers 経路が video 前提のため対象外（従来どおり cuts に残す）。
const ALPHA_CAPABLE_MEDIA_SOURCE_PATTERN = /\.(webm|mov)$/iu;
function isAlphaCapableMediaSourcePath(path) {
    return typeof path === 'string' && ALPHA_CAPABLE_MEDIA_SOURCE_PATTERN.test(path);
}
function needsCrossTrackLayers(item, pathOf) {
    const transform = item.transform;
    return (transform?.scale !== undefined && transform.scale !== 1)
        || (transform?.x !== undefined && transform.x !== 0)
        || (transform?.y !== undefined && transform.y !== 0)
        || (transform?.rotate !== undefined && transform.rotate !== 0)
        || item.crop !== undefined
        || (item.opacity !== undefined && item.opacity < 1)
        || item.keyframes !== undefined
        || (item.source.kind === 'media' && 'mask' in item && item.mask !== undefined)
        || (item.source.kind === 'media' && isAlphaCapableMediaSourcePath(pathOf?.(item.source.src)));
}
function nextRef(counters, kind) {
    const ref = counters.get(kind) ?? 0;
    counters.set(kind, ref + 1);
    return ref;
}
// P0 2026-08-21 render-path-unification: legacy.collection（cuts/layers/overlays/sfx）ごとに
// トラック横断で一意・宣言順（trackの配列順→そのtrack内のitem順）の通し番号を発行する。
// readV2Internal 自身の comment 参照（Lead 指摘・L1 fork 発見のドラッグ例外の根治）。
function nextLegacyIndex(counters, collection) {
    const index = counters.get(collection) ?? 0;
    counters.set(collection, index + 1);
    return index;
}
function buildV2Item(item, fps, ref, lane, pathOf, chromaKeyOf, legacyIndexCounters, hasOverlappingSibling = false) {
    if (lane === 'audio') {
        return buildV2AudioItem(item, fps, ref, pathOf, legacyIndexCounters);
    }
    return buildV2VisualItem(item, fps, ref, pathOf, chromaKeyOf, legacyIndexCounters, hasOverlappingSibling);
}
function buildV2VisualItem(item, fps, ref, pathOf, chromaKeyOf, legacyIndexCounters, hasOverlappingSibling = false) {
    const atFrames = item.at;
    const durationFrames = item.duration;
    const at = atFrames / fps;
    const duration = durationFrames / fps;
    const keyframes = item.keyframes?.map(keyframe => ({ ...keyframe, t: keyframe.t / fps }));
    const common = {
        ...(item.transform !== undefined ? { transform: item.transform } : {}),
        ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
        ...(item.blend !== undefined ? { blend: item.blend } : {}),
        ...(item.crop !== undefined ? { crop: item.crop } : {}),
        ...(item.perspective !== undefined ? { perspective: item.perspective } : {}),
        ...(keyframes !== undefined ? { keyframes } : {}),
        ...(item.source.kind === 'media' && 'mask' in item && item.mask !== undefined
            ? { mask: pathOf(item.mask) ?? item.mask } : {})
    };
    switch (item.source.kind) {
        case 'media': {
            const path = pathOf(item.source.src);
            const source = {
                kind: 'media',
                sourceId: item.source.src,
                ...(path !== undefined ? { path } : {}),
                in: item.source.in,
                out: item.source.out
            };
            // 1 フレーム以内の差は速度変更ではなく尺合わせなので、trim の素材窓を詰める。
            // それを超える差だけを本物の速度変更として旧 cuts[].speed へ写す。
            const span = item.source.out - item.source.in;
            const freezeSeconds = isRecord(item.source.freeze)
                && typeof item.source.freeze.duration_sec === 'number'
                && Number.isFinite(item.source.freeze.duration_sec)
                ? Math.max(0, item.source.freeze.duration_sec) : 0;
            const playbackDuration = Math.max(0, duration - freezeSeconds);
            // r4 (Codex re-review, MAJOR): a genuine zero output duration (item.duration === 0,
            // schema-valid per requireInteger's own minimum of 0 -- see edit-v2.ts) used to fall
            // through the `!alignsDuration` branch below (span=out-in is almost always far more
            // than one frame away from playbackDuration=0, so alignsDuration is false) straight to
            // `cutOut = item.source.out`, with speed left undefined because the speed formula
            // (span / playbackDuration) would divide by zero -- projecting a supposedly-invisible
            // 0-duration item as a REAL cut playing its entire declared source span at normal
            // speed. A zero output duration means zero output duration regardless of how much
            // source range happens to be declared alongside it, so this is checked first and
            // short-circuits straight to a true zero-length segment (cutOut = cutIn); speed is
            // moot for a zero-length segment either way.
            //
            // r5 (Codex re-review): the short-circuit condition must be `durationFrames === 0`
            // (the item's own DECLARED output duration), not `playbackDuration === 0` -- those two
            // are NOT the same thing. A whole-region freeze (e.g. duration: 1s with
            // freeze.duration_sec: 1s -- hold a single seed frame for the entire declared,
            // genuinely positive, 1-second duration) also has playbackDuration === 0 (all of that
            // 1 second is frozen hold, zero of it is "moving playback"), but this is a completely
            // different, legitimate case from a true zero-duration item: the clip IS visible for a
            // full second, it just never advances past its first frame. Short-circuiting THIS case
            // to cutOut = cutIn as well collapsed its trim window to a literal zero-frame stream,
            // which starves freeze's own seed-frame acquisition (appendFreezeAwareVideoTrim,
            // packages/render-cut/src/cut-freeze.mjs) of any frame to hold at all. Checking the
            // item's own declared duration directly, instead of the freeze-adjusted
            // playbackDuration, leaves every positive-duration freeze clip on exactly the
            // pre-r4 alignsDuration/speed logic below (byte-identical to before this whole
            // duration:0 investigation started), and only ever short-circuits a genuinely
            // zero-duration item.
            const alignsDuration = Math.abs(span - playbackDuration) <= 1 / fps + 1e-9;
            const cutOut = durationFrames === 0
                ? item.source.in
                : (alignsDuration ? item.source.in + playbackDuration : item.source.out);
            const speed = playbackDuration > 0 && !alignsDuration ? span / playbackDuration : undefined;
            // r5 (Codex re-review) tried dropping a zero-length projected segment
            // (durationFrames === 0) ENTIRELY at this stage (legacy.value: undefined) rather than
            // emitting it as a degenerate cut, reasoning that it is rejected downstream anyway by
            // both edit-lint's cuts.range check and render-cut's validateEditShape.
            //
            // r6 (Codex re-review) found that drop was itself broken and reverted it: (a)
            // render-cut has a SEPARATE projection path (internal-render.mjs's
            // projectRendererCompatibilityEdit, consumed by plan.mjs's track-stack construction)
            // that reconstructs in/out itself directly rather than reading legacy.value, so the
            // drop never actually reached that path -- a duration:0 item could still leak into a
            // render attempt through it. (b) A dropped item still consumes a legacy.index slot
            // (nextLegacyIndex below still runs) but vanishes from projectLegacyEdit's own
            // cuts[]/layers[] output, so any UI code that correlates "the Nth declared item" with
            // "the Nth projected legacy entry" (e.g. cutItemIds) could desync and a user's
            // edit/delete/drag could land on the WRONG item -- a new BLOCKER, not a fix. (c) the
            // "reuses the established telop/filter legacy.value:undefined pattern" framing was
            // itself inaccurate: that case re-inserts a declaration into layers via a DIFFERENT
            // branch (see the telop/filter case elsewhere in this file), it does not silently drop
            // the item, so it was never really the same mechanism.
            //
            // Final adjudication (r6, control-tower call): duration:0 stays schema-valid but is
            // caught at the FRONT DOOR by edit-lint with a clear, purpose-built error message
            // (see edit-lint.mjs's own duration:0 check) -- neither the projection nor rendering
            // paths need to special-case it at all. This function projects a zero output duration
            // exactly like r4 did: a real (degenerate, in === out) cut/layer, using the
            // durationFrames === 0 short-circuit above (kept from r5 -- see that comment) purely
            // to make cutOut deterministic (cutIn, not a leftover full source span) for whatever
            // downstream code inspects it before lint has a chance to reject the project.
            // P0 2026-08-21 render-path-unification: 段（トラック）は一切見ない。needsLayersEngine
            // が false の media アイテムは常に 'cuts'（render-cut の cut-transform.mjs が
            // transform/crop/perspective/keyframes/transition_out/speed/freeze の全機能集合を持つ）。
            if (needsLayersEngine(item, chromaKeyOf, hasOverlappingSibling)) {
                const declaration = {
                    id: item.id, t: at, duration, kind: 'video', src: path ?? item.source.src,
                    track: ref, ...common, ...copyMediaSourceFields(item.source)
                };
                const value = declaration;
                return {
                    item: {
                        id: item.id, atFrames, durationFrames, at, duration, source,
                        declaration,
                        legacy: { collection: 'layers', index: nextLegacyIndex(legacyIndexCounters, 'layers'), value }
                    }
                };
            }
            const value = {
                in: item.source.in,
                out: cutOut,
                src: item.source.src,
                at,
                track: ref,
                ...(speed !== undefined ? { speed } : {}),
                ...(item.transform !== undefined ? { transform: item.transform } : {}),
                ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
                ...copyMediaSourceFields(item.source)
            };
            return {
                item: {
                    id: item.id, atFrames, durationFrames, at, duration, source,
                    declaration: {
                        id: item.id, src: item.source.src, in: item.source.in, out: cutOut, at, track: ref,
                        ...common, ...copyMediaSourceFields(item.source), ...(speed !== undefined ? { speed } : {})
                    },
                    legacy: { collection: 'cuts', index: nextLegacyIndex(legacyIndexCounters, 'cuts'), value }
                }
            };
        }
        case 'html': {
            const declaration = {
                id: item.id, html: item.source.path, start: at, duration, track: ref,
                ...(item.source.vars !== undefined ? { vars: item.source.vars } : {}),
                ...(item.source.params !== undefined ? { params: item.source.params } : {}), ...common
            };
            const value = {
                id: item.id,
                start: at,
                duration,
                track: ref,
                payload: declaration
            };
            return {
                item: {
                    id: item.id, atFrames, durationFrames, at, duration,
                    source: {
                        kind: 'html', html: item.source.path,
                        ...(item.source.params !== undefined ? { params: item.source.params } : {})
                    },
                    declaration,
                    legacy: { collection: 'overlays', index: nextLegacyIndex(legacyIndexCounters, 'overlays'), value }
                }
            };
        }
        case 'telop': {
            const source = {
                kind: 'telop',
                preset: item.source.preset,
                ...(item.source.params !== undefined ? { params: item.source.params } : {}),
                ...(item.source.baked !== undefined ? { baked: item.source.baked } : {})
            };
            const declaration = {
                id: item.id, t: at, duration, kind: 'baked', src: item.source.baked,
                preset: item.source.preset, params: item.source.params, track: ref, ...common
            };
            if (item.source.baked === undefined) {
                return {
                    item: { id: item.id, atFrames, durationFrames, at, duration, source, declaration, legacy: { collection: 'layers', index: nextLegacyIndex(legacyIndexCounters, 'layers') } }
                };
            }
            const value = {
                id: item.id,
                t: at,
                duration,
                kind: 'baked',
                src: item.source.baked,
                track: ref,
                ...(item.source.preset !== undefined ? { preset: item.source.preset } : {}),
                ...(item.transform !== undefined ? { transform: item.transform } : {}),
                ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
                ...(item.blend !== undefined ? { blend: item.blend } : {})
            };
            return {
                item: { id: item.id, atFrames, durationFrames, at, duration, source, declaration, legacy: { collection: 'layers', index: nextLegacyIndex(legacyIndexCounters, 'layers'), value } }
            };
        }
        default: {
            const source = { kind: 'filter', filter: item.source.filter };
            return {
                item: {
                    id: item.id, atFrames, durationFrames, at, duration, source,
                    declaration: {
                        id: item.id, t: at, duration, kind: 'filter',
                        filter: item.source.filter, track: ref, ...common
                    },
                    legacy: { collection: 'layers', index: nextLegacyIndex(legacyIndexCounters, 'layers') }
                }
            };
        }
    }
}
function buildV2AudioItem(item, fps, ref, pathOf, legacyIndexCounters) {
    const atFrames = item.at;
    const durationFrames = item.duration;
    const at = atFrames / fps;
    const duration = durationFrames / fps;
    const inSeconds = item.source.in ?? 0;
    const path = pathOf(item.source.src);
    const source = {
        kind: 'media',
        sourceId: item.source.src,
        ...(path !== undefined ? { path } : {}),
        in: inSeconds,
        out: item.source.out ?? inSeconds
    };
    const resolvedPath = path ?? item.source.src;
    const role = item.role ?? 'sfx';
    if (role === 'narration') {
        const value = {
            id: item.id,
            t: at,
            path: resolvedPath,
            track: ref,
            ...(item.gain_db !== undefined ? { gainDb: item.gain_db } : {}),
            ...(item.source.in !== undefined ? { in: item.source.in } : {}),
            ...(item.source.out !== undefined ? { out: item.source.out } : {}),
            ...(item.script !== undefined ? { script: item.script } : {}),
            ...(item.reading !== undefined ? { reading: item.reading } : {}),
            ...(item.provenance !== undefined ? { provenance: structuredClone(item.provenance) } : {})
        };
        return {
            item: {
                id: item.id, atFrames, durationFrames, at, duration, source,
                declaration: {
                    id: item.id, t: at, path: resolvedPath,
                    ...(item.gain_db !== undefined ? { gain_db: item.gain_db } : {}),
                    ...(item.source.in !== undefined ? { in: item.source.in } : {}),
                    ...(item.source.out !== undefined ? { out: item.source.out } : {}),
                    ...(item.script !== undefined ? { script: item.script } : {}),
                    ...(item.reading !== undefined ? { reading: item.reading } : {}),
                    ...(item.provenance !== undefined ? { provenance: structuredClone(item.provenance) } : {})
                },
                legacy: {
                    collection: 'narration',
                    index: nextLegacyIndex(legacyIndexCounters, 'narration'),
                    value
                }
            }
        };
    }
    if (role === 'bgm') {
        const value = {
            id: 'bgm',
            path: resolvedPath,
            track: ref,
            ...(item.fade_in !== undefined ? { fadeIn: item.fade_in } : {}),
            ...(item.fade_out !== undefined ? { fadeOut: item.fade_out } : {}),
            ...(item.gain_db !== undefined ? { gainDb: item.gain_db } : {}),
            ...(item.ducking !== undefined ? { ducking: item.ducking } : {})
        };
        return {
            item: {
                id: item.id, atFrames, durationFrames, at, duration, source,
                declaration: {
                    path: resolvedPath,
                    ...(item.source.in !== undefined ? { in: item.source.in } : {}),
                    ...(item.fade_in !== undefined ? { fadeIn: item.fade_in } : {}),
                    ...(item.fade_out !== undefined ? { fadeOut: item.fade_out } : {}),
                    ...(item.gain_db !== undefined ? { gain_db: item.gain_db } : {}),
                    ...(item.ducking !== undefined ? { ducking: item.ducking } : {})
                },
                legacy: { collection: 'bgm', index: 0, value }
            }
        };
    }
    const value = {
        id: item.id,
        t: at,
        duration,
        path: resolvedPath,
        track: ref,
        in: inSeconds,
        ...(item.source.out !== undefined ? { out: item.source.out } : {}),
        ...(item.gain_db !== undefined ? { gainDb: item.gain_db } : {})
    };
    return {
        item: {
            id: item.id, atFrames, durationFrames, at, duration, source,
            declaration: {
                id: item.id, t: at, duration, path: resolvedPath, track: ref,
                in: inSeconds,
                ...(item.source.out !== undefined ? { out: item.source.out } : {}),
                ...(item.gain_db !== undefined ? { gain_db: item.gain_db } : {}),
                ...(item.fade_in !== undefined ? { fade_in: item.fade_in } : {}),
                ...(item.fade_out !== undefined ? { fade_out: item.fade_out } : {})
            },
            legacy: { collection: 'sfx', index: nextLegacyIndex(legacyIndexCounters, 'sfx'), value }
        }
    };
}
function copyMediaSourceFields(source) {
    return {
        ...(source.framing !== undefined ? { framing: source.framing } : {}),
        ...(source.transition_out !== undefined ? { transition_out: source.transition_out } : {}),
        ...(source.freeze !== undefined ? { freeze: source.freeze } : {}),
        ...(source.fx !== undefined ? { fx: source.fx } : {}),
        ...(source.speed !== undefined ? { speed: source.speed } : {}),
        ...(source.chroma_key !== undefined ? { chroma_key: source.chroma_key } : {})
    };
}
/**
 * v2 が秒のまま持ち越した audio を、表示用の audio lane へ落とさず射影する。
 * legacyIndexCounters は buildV2Item と共有する（P0 2026-08-21 render-path-unification:
 * 'sfx' コレクションは audio-lane トラックの items 経由（buildV2Item）とここ
 * （edit.audio.sfx[]）の両方から寄与し得るため、同じカウンタでトラック横断・呼び出し元横断の
 * 一意性を保つ。narration/bgm も audio-lane items とこの fallback の両経路から寄与し得るため、
 * 同じ仕組みで統一しておく）。
 */
function addV2AudioItems(tracks, audioValue, fps, legacyIndexCounters) {
    const audio = isRecord(audioValue) ? audioValue : undefined;
    if (!audio)
        return;
    const ensureTrack = (ref) => {
        let track = tracks.find(candidate => candidate.lane === 'audio' && (candidate.legacy.ref ?? 0) === ref);
        if (!track) {
            track = {
                id: `implicit-audio-${ref}`,
                lane: 'audio', z: tracks.length, origin: 'implicit', items: [], legacy: { kind: 'audio', ref }
            };
            tracks.push(track);
        }
        return track;
    };
    const sfx = Array.isArray(audio.sfx) ? audio.sfx : [];
    sfx.forEach((entry, index) => {
        if (!isRecord(entry) || typeof entry.path !== 'string' || !entry.path.trim() || typeof entry.t !== 'number')
            return;
        const ref = normalizeTrackNumber(entry.track);
        const start = typeof entry.in === 'number' ? entry.in : 0;
        // 実尺がまだ解決できない最小宣言では、タイムライン上で操作できる 1 秒の
        // 仮尺を与える。素材尺を読むレンダー経路は生の audio.sfx を使うため、
        // これは表示専用の従来互換値である。
        const end = typeof entry.out === 'number' && entry.out > start ? entry.out : start + 1;
        const duration = Math.max(0, end - start);
        const value = {
            id: typeof entry.id === 'string' ? entry.id : `sfx-${index}`,
            t: entry.t, duration, path: entry.path, track: ref, in: start,
            ...(end > start ? { out: end } : {}),
            ...(typeof entry.gain_db === 'number' ? { gainDb: entry.gain_db } : {})
        };
        ensureTrack(ref).items.push({
            id: value.id,
            atFrames: Math.round(value.t * fps), durationFrames: Math.round(duration * fps),
            at: value.t, duration,
            source: { kind: 'media', path: value.path, in: start, out: end },
            declaration: entry,
            legacy: { collection: 'sfx', index: nextLegacyIndex(legacyIndexCounters, 'sfx'), value }
        });
    });
    const narration = Array.isArray(audio.narration) ? audio.narration : [];
    narration.forEach((entry, index) => {
        if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.t !== 'number')
            return;
        const start = typeof entry.in === 'number' ? entry.in : 0;
        const end = typeof entry.out === 'number' ? entry.out : start;
        const duration = Math.max(0, end - start);
        const value = {
            id: typeof entry.id === 'string' ? entry.id : `n-${String(index + 1).padStart(4, '0')}`,
            t: entry.t, path: entry.path,
            ...(typeof entry.gain_db === 'number' ? { gainDb: entry.gain_db } : {}),
            ...(typeof entry.in === 'number' ? { in: entry.in } : {}),
            ...(typeof entry.out === 'number' ? { out: entry.out } : {}),
            ...(typeof entry.script === 'string' ? { script: entry.script } : {}),
            ...(typeof entry.reading === 'string' ? { reading: entry.reading } : {}),
            ...(isRecord(entry.provenance)
                ? { provenance: structuredClone(entry.provenance) } : {})
        };
        ensureTrack(0).items.push({
            id: value.id, atFrames: Math.round(value.t * fps), durationFrames: Math.round(duration * fps),
            at: value.t, duration,
            source: { kind: 'media', path: value.path, in: start, out: end },
            declaration: entry,
            legacy: { collection: 'narration', index: nextLegacyIndex(legacyIndexCounters, 'narration'), value }
        });
    });
    if (isRecord(audio.bgm) && typeof audio.bgm.path === 'string') {
        const entry = audio.bgm;
        const value = {
            id: 'bgm', path: entry.path,
            ...(typeof entry.fadeIn === 'number' ? { fadeIn: entry.fadeIn } : {}),
            ...(typeof entry.fadeOut === 'number' ? { fadeOut: entry.fadeOut } : {}),
            ...(typeof entry.gain_db === 'number' ? { gainDb: entry.gain_db } : {}),
            ...(typeof entry.ducking === 'boolean' ? { ducking: entry.ducking } : {})
        };
        ensureTrack(0).items.push({
            id: 'bgm', atFrames: 0, durationFrames: 0, at: 0, duration: 0,
            source: { kind: 'media', path: value.path, in: 0, out: 0 },
            declaration: entry,
            legacy: { collection: 'bgm', index: 0, value }
        });
    }
    tracks.forEach((track, index) => { track.z = index; });
}
/**
 * 内部表現 → 旧種別別配列。**`tracks[].items[]` だけを見て組み立てる**（生 JSON も版も見ない）。
 * まだ内部表現へ移せていない描画経路のための橋で、Phase 3 で消える。
 */
function projectLegacyEdit(internal) {
    const cuts = [];
    const overlays = [];
    const layers = [];
    const audioSfx = [];
    const audioNarration = [];
    let audioBgm;
    for (const track of internal.tracks) {
        for (const item of track.items) {
            const value = item.legacy.value;
            if (value === undefined) {
                // 未焼成 telop / filter は旧型 EditLayer に完全には表せないが、
                // 消費者から黙って消すより宣言レコードを運ぶ方が安全。
                if (item.source.kind === 'telop' || item.source.kind === 'filter') {
                    layers.push({ index: item.legacy.index, value: item.declaration });
                }
                continue;
            }
            switch (item.source.kind) {
                case 'media':
                    // 同じ「読んで重ねるだけの素材」でも旧宣言では 4 つの配列に散っていた
                    // （cuts / layers(video) / audio.sfx / audio.narration / audio.bgm）。
                    // 内部表現では 1 種別なので、旧配列への振り分けだけが collection を見る。
                    switch (item.legacy.collection) {
                        case 'sfx':
                            audioSfx.push({ index: item.legacy.index, value: value });
                            break;
                        case 'narration':
                            audioNarration.push({ index: item.legacy.index, value: value });
                            break;
                        case 'bgm':
                            audioBgm = value;
                            break;
                        case 'layers':
                            layers.push({ index: item.legacy.index, value: value });
                            break;
                        default:
                            cuts.push({ index: item.legacy.index, value: value });
                            break;
                    }
                    break;
                case 'html':
                    overlays.push({ index: item.legacy.index, value: value });
                    break;
                case 'telop':
                case 'filter':
                    layers.push({ index: item.legacy.index, value: value });
                    break;
                default:
                    break;
            }
        }
    }
    const declaredTracks = internal.tracks
        .filter(track => track.origin === 'declared')
        .map(toLegacyTrack);
    return {
        cuts: byDeclarationOrder(cuts),
        ...(internal.sourceTableDeclared
            ? {
                sources: internal.sources
                    .filter(entry => entry.path !== undefined)
                    .map(entry => ({ id: entry.id, path: entry.path, proxy: entry.proxy }))
            }
            : {}),
        overlays: byDeclarationOrder(overlays),
        ...(internal.beats !== undefined ? { beats: internal.beats } : {}),
        layers: byDeclarationOrder(layers),
        audioSfx: byDeclarationOrder(audioSfx),
        audioNarration: byDeclarationOrder(audioNarration),
        ...(audioBgm ? { audioBgm } : {}),
        ...(internal.tracksDeclared ? { timeline: { tracks: declaredTracks } } : {}),
        fps: internal.output.fps,
        warnings: internal.warnings
    };
}
/** 内部トラック → 旧 timeline.tracks 要素。 */
function toLegacyTrack(track) {
    return {
        id: track.id,
        kind: track.legacy.kind,
        ...(track.legacy.ref === undefined ? {} : { ref: track.legacy.ref }),
        ...(track.name === undefined ? {} : { label: track.name }),
        ...(track.muted === undefined ? {} : { muted: track.muted }),
        ...(track.hidden === undefined ? {} : { hidden: track.hidden }),
        ...(track.locked === undefined ? {} : { locked: track.locked })
    };
}
/** `timeline.tracks` を宣言していないプロジェクトの既定行（読み込み層が導出した順のまま）。 */
function derivedLegacyTracks(internal) {
    return internal.tracks.filter(track => track.origin === 'derived').map(toLegacyTrack);
}
function byDeclarationOrder(entries) {
    return [...entries].sort((left, right) => left.index - right.index).map(entry => entry.value);
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function normalizeTrackNumber(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
