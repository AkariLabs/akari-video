/**
 * edit.json v2 を tracks-first の内部表現へ読む。
 * トラック配列順が下→上の合成順で、時刻は整数フレーム宣言を正本とする。
 */

import {
    EditAudioBgm,
    EditAudioNarration,
    EditAudioSfx,
    EditBeat,
    EditCut,
    EditLayer,
    EditOverlay,
    EditSource,
    EditTimelineTrack,
    LayerBlendMode,
    TimelineTrackKind,
} from './edit-store';
import { ItemV2, TrackV2, readEditV2 } from './edit-v2';
import { LegacyEditVersionError } from './migrate/error';

export type InternalLane = 'visual' | 'audio';

/** 素材の出どころ。1 アイテム = 1 種別で、種別ごとの分岐はここ 1 軸に集約する。 */
export interface InternalMediaSource {
    kind: 'media';
    /** 素材表（`InternalEdit.sources`）の鍵。表に無い直接参照（旧 layers[].src 等）は undefined。 */
    sourceId?: string;
    /** 素材ファイルのパス（sourceId 経由なら素材表から解決した値）。 */
    path?: string;
    /** 素材内の再生区間（秒）。素材側は秒のまま（notes §10-1）。 */
    in: number;
    out: number;
}

export interface InternalHtmlSource {
    kind: 'html';
    /** 断片ファイルのパス、またはインライン HTML。 */
    html: string;
}

export interface InternalTelopSource {
    kind: 'telop';
    preset?: string;
    params?: Record<string, unknown>;
    /**
     * 焼き済みキャッシュ（アルファ付き mov 等）のパス。**種別ではなくキャッシュ**なので、
     * 焼く前後で `InternalItem.id` は変わらない（notes §9）。
     */
    baked?: string;
}

export interface InternalFilterSource {
    kind: 'filter';
    filter: unknown;
}

export type InternalItemSource =
    | InternalMediaSource
    | InternalHtmlSource
    | InternalTelopSource
    | InternalFilterSource;

/** 旧 edit.json の種別別配列の名前。v2 の `tracks[].items[]` は 'items'。 */
export type LegacyCollection = 'cuts' | 'overlays' | 'layers' | 'sfx' | 'narration' | 'bgm' | 'items';

/**
 * renderer 互換ビューとの対応。
 */
export interface InternalItemLegacy {
    collection: LegacyCollection;
    /** 宣言配列内の添字。 */
    index: number;
    /** 種別別の型付きビュー。旧読み取り器が受け付けなかった宣言では undefined。 */
    value?: EditCut | EditOverlay | EditLayer | EditAudioSfx | EditAudioNarration | EditAudioBgm;
}

export interface InternalItem {
    /** 宣言の id。焼く前後・版をまたいでも同じ 1 個のクリップは同じ id を保つ。 */
    id: string;
    /** 出力タイムライン上の絶対位置（整数フレーム、正本）。 */
    atFrames: number;
    /** 出力尺（整数フレーム、正本）。実尺未解決時は 0。 */
    durationFrames: number;
    /** 出力秒（`atFrames / output.fps`）。 */
    at: number;
    /** 出力秒（`durationFrames / output.fps`）。 */
    duration: number;
    source: InternalItemSource;
    /**
     * 内部表現の宣言レコード。深い視覚プロパティ（crop / perspective / keyframes / framing / freeze /
     * vars）の値検証は各消費者の既存検証器がそのまま行う（パリティ契約 §2.2.1 の
     * 「独立に導出した検証を共有バグで隠さない」を保つため、ここでは検証しない）。
     */
    declaration: Record<string, unknown>;
    legacy: InternalItemLegacy;
}

/** トラックの出どころ。'implicit' は宣言に無いトラック番号のアイテムを載せるために生やした行。 */
export type InternalTrackOrigin = 'declared' | 'derived' | 'implicit';

export interface InternalTrack {
    id: string;
    lane: InternalLane;
    /** 0 が最背面。`tracks` の配列添字と常に一致する。 */
    z: number;
    name?: string;
    muted?: boolean;
    hidden?: boolean;
    locked?: boolean;
    origin: InternalTrackOrigin;
    /** 字幕トラックの器（items を持たない）。 */
    content?: { from: 'captions.json' };
    items: InternalItem[];
    /** 旧 (kind, ref) identity。Phase 3 まで残る種別別配列との対応に使う。 */
    legacy: { kind: TimelineTrackKind; ref?: number };
}

export interface InternalOutput {
    width?: number;
    height?: number;
    /** 出力の格子（integer 限定）。 */
    fps: number;
    look?: unknown;
}

export interface InternalSource {
    /** 素材表の鍵。 */
    id: string;
    /** 宣言どおりのパス（未検証。消費者の既存検証がそのまま読む）。 */
    declaredPath: unknown;
    /** 検証済みパス。宣言が壊れていれば undefined。 */
    path?: string;
    declaredProxy?: unknown;
    proxy: string | null;
    chromaKey?: unknown;
    /** 診断メッセージ用の宣言位置（例 `sources[hero]` / `source`）。版名は含めない。 */
    declarationPath: string;
    /**
     * 既定素材として扱うかを示す意味フラグ。
     */
    isDefault: boolean;
}

/** まだ `items[]` へ移していない領域を、消費者が版を知らずに読むための宣言レコード。 */
export interface InternalEditDeclaration {
    /** 音声宣言そのもの（資産解決・マスター処理の検出に使う）。 */
    audio?: unknown;
    /** 埋め込み字幕（旧 `captions[]`）。字幕の正本は captions.json。 */
    captions?: unknown;
    emphasisWords?: unknown;
    /** 旧 `tracks`（トラック状態 muted/hidden）。 */
    trackStates?: unknown;
}

export interface InternalEdit {
    output: InternalOutput;
    /** 素材表。 */
    sources: InternalSource[];
    /**
     * 素材表として宣言されていたか。
     */
    sourceTableDeclared: boolean;
    /** 素材宣言が 1 つも無い = 素材投入前の新規プロジェクト。 */
    emptyProject: boolean;
    /** 下→上の合成順。配列添字 = z。 */
    tracks: InternalTrack[];
    /** 見せ場マーカー（クリップではないので items ではない）。宣言が無ければ undefined。 */
    beats?: EditBeat[];
    /** `timeline.tracks` が宣言されていたか。省略時は読み込み層が導出する。 */
    tracksDeclared: boolean;
    warnings: string[];
    declaration: InternalEditDeclaration;
}

export interface InternalReadOptions {
    /** captions.json に字幕があるか（字幕トラックの導出条件。既定 false）。 */
    hasCaptions?: boolean;
}

/**
 * edit.json v2 を内部表現へ読む。v0/v1 は凍結変換ユニットのみが読む。
 * 文字列でもパース済みオブジェクトでも受け取る。
 */
export function readInternalEdit(source: string | unknown, options?: InternalReadOptions): InternalEdit {
    const text = typeof source === 'string' ? source : JSON.stringify(source);
    if (typeof text !== 'string') {
        throw new Error('編集データの形式を確認できません。');
    }
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('編集データの形式を確認できません。');
    }
    const record = raw as Record<string, unknown>;
    if (record.version !== 2) {
        throw new LegacyEditVersionError(typeof record.version === 'number' ? record.version : -1);
    }
    return readV2Internal(record);
}

/**
 * 素材表だけを読む軽い入口（版を知るのは同じくここだけ）。アイテムまで要らない照合
 * （生素材と edit.json の突き合わせ等）が、全文の読み取りを払わずに済むようにする。
 */
export function readInternalSources(source: string | unknown): InternalSource[] {
    const raw = toRecord(source);
    if (!raw) {
        return [];
    }
    if (raw.version !== 2) {
        throw new LegacyEditVersionError(typeof raw.version === 'number' ? raw.version : -1);
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
export function visualContentEndSeconds(internal: InternalEdit): number {
    let maxEnd = 0;
    for (const track of internal.tracks) {
        if (track.lane !== 'visual') continue;
        for (const item of track.items) {
            if (item.source.kind === 'html') continue;
            maxEnd = Math.max(maxEnd, item.at + item.duration);
        }
    }
    return maxEnd;
}

function toRecord(source: string | unknown): Record<string, unknown> | undefined {
    try {
        const text = typeof source === 'string' ? source : JSON.stringify(source);
        if (typeof text !== 'string') {
            return undefined;
        }
        const parsed = JSON.parse(text) as unknown;
        return isRecord(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// v2
// ---------------------------------------------------------------------------

function readV2Internal(raw: Record<string, unknown>): InternalEdit {
    const edit = readEditV2(raw);
    const fps = edit.output.fps;
    const sources: InternalSource[] = edit.sources.map(entry => ({
        id: entry.id,
        declaredPath: entry.path,
        path: entry.path,
        declaredProxy: entry.proxy,
        proxy: entry.proxy ?? null,
        ...(entry.chroma_key !== undefined && entry.chroma_key !== null ? { chromaKey: entry.chroma_key } : {}),
        declarationPath: `sources[${entry.id}]`,
        isDefault: false
    }));
    const pathOf = (id: string): string | undefined => sources.find(entry => entry.id === id)?.path;
    const chromaKeyOf = (id: string): unknown => sources.find(entry => entry.id === id)?.chromaKey;

    const warnings: string[] = [];
    const refCounters = new Map<TimelineTrackKind, number>();
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
    const legacyIndexCounters = new Map<string, number>();
    // P0 2026-08-21 render-path-unification: どの段（トラック）にあるかは、もう source.kind:'media'
    // アイテムの旧種別（cuts/layers）に一切影響しない。render-cut の cuts 経路
    // （packages/render-cut/src/cut-transform.mjs）が transform/crop/perspective/keyframes/
    // transition_out/speed/freeze の全機能集合を持つに至ったため、位置による「本編か否か」の
    // 推測（旧 mainVisualTrackId）自体を撤去した。media アイテムの旧種別は常に 'cuts'
    // （= layers 相当の見た目・機能も含めて描ける唯一の経路）。'layers' に残るのは、
    // まだ cuts 経路へ移していない機能（非 normal blend の合成時ブレンド演算・
    // アニメーションする perspective）を宣言するアイテムだけ（needsLayersEngine 参照。
    // これも段ではなくアイテム自身の宣言だけで決まる）。
    const tracks: InternalTrack[] = edit.tracks.map(track => {
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
        const overlappingItemIds = 'items' in track ? computeOverlappingItemIds(track.items) : new Set<string>();
        const kind = legacyKindOfV2Track(track, chromaKeyOf, overlappingItemIds);
        const ref = kind === 'captions' ? undefined : nextRef(refCounters, kind);
        const items: InternalItem[] = [];
        if ('items' in track) {
            track.items.forEach(item => {
                const built = buildV2Item(
                    item, fps, ref ?? 0, track.lane, pathOf, chromaKeyOf, legacyIndexCounters,
                    overlappingItemIds.has(item.id)
                );
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
            origin: 'declared' as const,
            ...('content' in track ? { content: { from: 'captions.json' as const } } : {}),
            items,
            legacy: { kind, ...(ref === undefined ? {} : { ref }) }
        };
    });

    addV2AudioItems(tracks, edit.audio, fps, legacyIndexCounters);
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

function legacyKindOfV2Track(
    track: TrackV2 & { z: number },
    chromaKeyOf: (sourceId: string) => unknown,
    overlappingItemIds: ReadonlySet<string>
): TimelineTrackKind {
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
            || needsLayersEngine(first, chromaKeyOf, overlappingItemIds.has(first.id))
            ? 'layers' : 'cuts';
    }
}

// P0 2026-08-21 render-path-unification: cuts 経路（packages/render-cut/src/cut-transform.mjs）へ
// まだ移していない機能を宣言する media アイテムだけが 'layers' に残る。段（トラック）は一切見ない
// — アイテム自身の宣言だけで決まるので、移動しても判定は変わらない。
// - blend: 'normal' 以外は合成時（前面までに何があるか）に依存するブレンド演算が要り、
//   それは packages/render-cut/src/layers.mjs にしか実装が無い
// - perspective keyframes: ffmpeg の perspective フィルタはフレームごとの式評価に対応しないため、
//   layers.mjs は宣言全体を静的な複数レイヤーへ事前展開している（layer-keyframes.mjs の
//   expandLayerForPerspectiveKeyframes）。この展開は t/duration ベースの layers 配列専用で、
//   at/in/out ベースの cuts 配列へは未移植（本タスクのスコープ外。report.md 参照）
// chromaKeyOf: 宣言（item.source.chroma_key）が無いときは素材表の既定（sources[].chroma_key）に
// フォールバックする（copyMediaSourceFields / appendMultiSourceChromaKey と同じ解決順）。
function needsLayersEngine(
    item: ItemV2, chromaKeyOf?: (sourceId: string) => unknown, hasOverlappingSibling = false
): boolean {
    if (item.source.kind !== 'media') return false;
    if (item.blend !== undefined && item.blend !== 'normal') return true;
    if (Array.isArray(item.keyframes) && item.keyframes.some(point =>
        point && typeof point === 'object' && 'perspective' in point && point.perspective !== undefined
    )) return true;
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
            && typeof (chromaKey as { background?: unknown }).background === 'string'
            && (chromaKey as { background: string }).background.length > 0;
        if (!hasBackground) return true;
    }
    // 'cuts'（concat チェーン）は同一トラック上の複数アイテムを「順に連結される別セグメント」
    // として扱う構造的前提を持つ。同じトラックに時間的に重なる 2 アイテムが乗っていると、
    // concat はそれらを連結した 1 本の内部クリップにしてしまい、出力尺ぶんだけを先頭から
    // trim するため、後ろに連結されたアイテムが黙って描画から消える（readV2Internal の
    // computeOverlappingItemIds 呼び出し側コメント参照。実測で発見: fieldtest の
    // pip-perspective-crop-check で同一トラックの 2 番目の PiP が消失していた）。
    if (hasOverlappingSibling) return true;
    return false;
}

// P0 2026-08-21 render-path-unification: 'cuts' 経路は同一トラック上の複数アイテムを
// 「順に連結される別セグメント」として扱えるだけで、時間的に重なる（同時に映る）複数アイテムは
// 表現できない（buildMultiSourceCutCommand の concat 前提。needsLayersEngine 自身のコメント参照）。
// このトラックの items[] を総当りで比較し、他のどれかと時間区間が重なる media アイテムの id を
// 集める。
function computeOverlappingItemIds(items: readonly ItemV2[]): Set<string> {
    const overlapping = new Set<string>();
    for (let i = 0; i < items.length; i++) {
        const a = items[i];
        if (a.source.kind !== 'media') continue;
        for (let j = i + 1; j < items.length; j++) {
            const b = items[j];
            if (b.source.kind !== 'media') continue;
            const aStart = a.at;
            const aEnd = a.at + a.duration;
            const bStart = b.at;
            const bEnd = b.at + b.duration;
            if (aStart < bEnd && bStart < aEnd) {
                // cuts[].transition_out (a crossfade into the next cut) is a DELIBERATE, narrow
                // overlap between two otherwise-sequential same-track items -- the concat engine's
                // own xfade support (packages/render-cut/src/plan.mjs) already represents this
                // correctly, so it must not be caught by this "cuts can't represent overlap" rule
                // (only a genuine simultaneous-PiP overlap, with no transition_out involved at
                // all, structurally can't be represented by concat). Declaring transition_out on
                // either item in an overlapping pair is enough to exclude it: a real simultaneous
                // PiP overlay never declares transition_out (it has no "next clip" to transition
                // into within the same track).
                if (a.source.transition_out !== undefined || b.source.transition_out !== undefined) continue;
                overlapping.add(a.id);
                overlapping.add(b.id);
            }
        }
    }
    return overlapping;
}

function nextRef(counters: Map<TimelineTrackKind, number>, kind: TimelineTrackKind): number {
    const ref = counters.get(kind) ?? 0;
    counters.set(kind, ref + 1);
    return ref;
}

// P0 2026-08-21 render-path-unification: legacy.collection（cuts/layers/overlays/sfx）ごとに
// トラック横断で一意・宣言順（trackの配列順→そのtrack内のitem順）の通し番号を発行する。
// readV2Internal 自身の comment 参照（Lead 指摘・L1 fork 発見のドラッグ例外の根治）。
function nextLegacyIndex(counters: Map<string, number>, collection: string): number {
    const index = counters.get(collection) ?? 0;
    counters.set(collection, index + 1);
    return index;
}

function buildV2Item(
    item: ItemV2,
    fps: number,
    ref: number,
    lane: InternalLane,
    pathOf: (id: string) => string | undefined,
    chromaKeyOf: (sourceId: string) => unknown,
    legacyIndexCounters: Map<string, number>,
    hasOverlappingSibling = false
): { item: InternalItem; warning?: string } {
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
        ...(keyframes !== undefined ? { keyframes } : {})
    };
    switch (item.source.kind) {
        case 'media': {
            const path = pathOf(item.source.src);
            const source: InternalMediaSource = {
                kind: 'media',
                sourceId: item.source.src,
                ...(path !== undefined ? { path } : {}),
                in: item.source.in,
                out: item.source.out
            };
            if (lane === 'audio') {
                const value: EditAudioSfx = {
                    id: item.id,
                    t: at,
                    duration,
                    path: path ?? item.source.src,
                    track: ref,
                    in: item.source.in,
                    out: item.source.out
                };
                return {
                    item: {
                        id: item.id, atFrames, durationFrames, at, duration, source,
                        declaration: { id: item.id, t: at, duration, path: value.path, track: ref, in: value.in, out: value.out },
                        legacy: { collection: 'sfx', index: nextLegacyIndex(legacyIndexCounters, 'sfx'), value }
                    }
                };
            }
            // 1 フレーム以内の差は速度変更ではなく尺合わせなので、trim の素材窓を詰める。
            // それを超える差だけを本物の速度変更として旧 cuts[].speed へ写す。
            const span = item.source.out - item.source.in;
            const freezeSeconds = isRecord(item.source.freeze)
                && typeof item.source.freeze.duration_sec === 'number'
                && Number.isFinite(item.source.freeze.duration_sec)
                ? Math.max(0, item.source.freeze.duration_sec) : 0;
            const playbackDuration = Math.max(0, duration - freezeSeconds);
            const alignsDuration = Math.abs(span - playbackDuration) <= 1 / fps + 1e-9;
            const cutOut = alignsDuration ? item.source.in + playbackDuration : item.source.out;
            const speed = !alignsDuration && playbackDuration > 0 ? span / playbackDuration : undefined;
            // P0 2026-08-21 render-path-unification: 段（トラック）は一切見ない。needsLayersEngine
            // が false の media アイテムは常に 'cuts'（render-cut の cut-transform.mjs が
            // transform/crop/perspective/keyframes/transition_out/speed/freeze の全機能集合を持つ）。
            if (needsLayersEngine(item, chromaKeyOf, hasOverlappingSibling)) {
                const declaration = {
                    id: item.id, t: at, duration, kind: 'video', src: path ?? item.source.src,
                    track: ref, ...common, ...copyMediaSourceFields(item.source)
                };
                const value = declaration as unknown as EditLayer;
                return {
                    item: {
                        id: item.id, atFrames, durationFrames, at, duration, source,
                        declaration,
                        legacy: { collection: 'layers', index: nextLegacyIndex(legacyIndexCounters, 'layers'), value }
                    }
                };
            }
            const value: EditCut = {
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
                ...(item.source.vars !== undefined ? { vars: item.source.vars } : {}), ...common
            };
            const value: EditOverlay = {
                id: item.id,
                start: at,
                duration,
                track: ref,
                payload: declaration as Record<string, unknown>
            };
            return {
                item: {
                    id: item.id, atFrames, durationFrames, at, duration,
                    source: { kind: 'html', html: item.source.path },
                    declaration,
                    legacy: { collection: 'overlays', index: nextLegacyIndex(legacyIndexCounters, 'overlays'), value }
                }
            };
        }
        case 'telop': {
            const source: InternalTelopSource = {
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
            const value: EditLayer = {
                id: item.id,
                t: at,
                duration,
                kind: 'baked',
                src: item.source.baked,
                track: ref,
                ...(item.source.preset !== undefined ? { preset: item.source.preset } : {}),
                ...(item.transform !== undefined ? { transform: item.transform } : {}),
                ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
                ...(item.blend !== undefined ? { blend: item.blend as LayerBlendMode } : {})
            };
            return {
                item: { id: item.id, atFrames, durationFrames, at, duration, source, declaration, legacy: { collection: 'layers', index: nextLegacyIndex(legacyIndexCounters, 'layers'), value } }
            };
        }
        default: {
            const source: InternalFilterSource = { kind: 'filter', filter: item.source.filter };
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

function copyMediaSourceFields(source: Extract<ItemV2['source'], { kind: 'media' }>): Record<string, unknown> {
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
 * 一意性を保つ。narration/bgm はここでしか発行されないが、将来 'sfx' と同じ理由で衝突しないよう
 * 同じ仕組みで統一しておく）。
 */
function addV2AudioItems(
    tracks: InternalTrack[], audioValue: unknown, fps: number, legacyIndexCounters: Map<string, number>
): void {
    const audio = isRecord(audioValue) ? audioValue : undefined;
    if (!audio) return;
    const ensureTrack = (ref: number): InternalTrack => {
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
        if (!isRecord(entry) || typeof entry.path !== 'string' || !entry.path.trim() || typeof entry.t !== 'number') return;
        const ref = normalizeTrackNumber(entry.track);
        const start = typeof entry.in === 'number' ? entry.in : 0;
        // 実尺がまだ解決できない最小宣言では、タイムライン上で操作できる 1 秒の
        // 仮尺を与える。素材尺を読むレンダー経路は生の audio.sfx を使うため、
        // これは表示専用の従来互換値である。
        const end = typeof entry.out === 'number' && entry.out > start ? entry.out : start + 1;
        const duration = Math.max(0, end - start);
        const value: EditAudioSfx = {
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
        if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.t !== 'number') return;
        const value: EditAudioNarration = {
            id: typeof entry.id === 'string' ? entry.id : `n-${String(index + 1).padStart(4, '0')}`,
            t: entry.t, path: entry.path,
            ...(typeof entry.gain_db === 'number' ? { gainDb: entry.gain_db } : {}),
            ...(typeof entry.script === 'string' ? { script: entry.script } : {})
        };
        ensureTrack(0).items.push({
            id: value.id, atFrames: Math.round(value.t * fps), durationFrames: 0,
            at: value.t, duration: 0,
            source: { kind: 'media', path: value.path, in: 0, out: 0 },
            declaration: entry,
            legacy: { collection: 'narration', index: nextLegacyIndex(legacyIndexCounters, 'narration'), value }
        });
    });
    if (isRecord(audio.bgm) && typeof audio.bgm.path === 'string') {
        const entry = audio.bgm;
        const value: EditAudioBgm = {
            id: 'bgm', path: entry.path as string,
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

// ---------------------------------------------------------------------------
// 旧経路への射影（Phase 3 で消える橋）
// ---------------------------------------------------------------------------

export interface LegacyEditView {
    cuts: EditCut[];
    sources?: EditSource[];
    overlays: EditOverlay[];
    beats?: EditBeat[];
    layers: EditLayer[];
    audioSfx: EditAudioSfx[];
    audioNarration: EditAudioNarration[];
    audioBgm?: EditAudioBgm;
    timeline?: { tracks: EditTimelineTrack[] };
    fps: number;
    warnings: string[];
}

/**
 * 内部表現 → 旧種別別配列。**`tracks[].items[]` だけを見て組み立てる**（生 JSON も版も見ない）。
 * まだ内部表現へ移せていない描画経路のための橋で、Phase 3 で消える。
 */
export function projectLegacyEdit(internal: InternalEdit): LegacyEditView {
    const cuts: Array<{ index: number; value: EditCut }> = [];
    const overlays: Array<{ index: number; value: EditOverlay }> = [];
    const layers: Array<{ index: number; value: EditLayer }> = [];
    const audioSfx: Array<{ index: number; value: EditAudioSfx }> = [];
    const audioNarration: Array<{ index: number; value: EditAudioNarration }> = [];
    let audioBgm: EditAudioBgm | undefined;

    for (const track of internal.tracks) {
        for (const item of track.items) {
            const value = item.legacy.value;
            if (value === undefined) {
                // 未焼成 telop / filter は旧型 EditLayer に完全には表せないが、
                // 消費者から黙って消すより宣言レコードを運ぶ方が安全。
                if (item.source.kind === 'telop' || item.source.kind === 'filter') {
                    layers.push({ index: item.legacy.index, value: item.declaration as unknown as EditLayer });
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
                            audioSfx.push({ index: item.legacy.index, value: value as EditAudioSfx });
                            break;
                        case 'narration':
                            audioNarration.push({ index: item.legacy.index, value: value as EditAudioNarration });
                            break;
                        case 'bgm':
                            audioBgm = value as EditAudioBgm;
                            break;
                        case 'layers':
                            layers.push({ index: item.legacy.index, value: value as EditLayer });
                            break;
                        default:
                            cuts.push({ index: item.legacy.index, value: value as EditCut });
                            break;
                    }
                    break;
                case 'html':
                    overlays.push({ index: item.legacy.index, value: value as EditOverlay });
                    break;
                case 'telop':
                case 'filter':
                    layers.push({ index: item.legacy.index, value: value as EditLayer });
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
                    .map(entry => ({ id: entry.id, path: entry.path as string, proxy: entry.proxy }))
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
export function toLegacyTrack(track: InternalTrack): EditTimelineTrack {
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
export function derivedLegacyTracks(internal: InternalEdit): EditTimelineTrack[] {
    return internal.tracks.filter(track => track.origin === 'derived').map(toLegacyTrack);
}

function byDeclarationOrder<T>(entries: Array<{ index: number; value: T }>): T[] {
    return [...entries].sort((left, right) => left.index - right.index).map(entry => entry.value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTrackNumber(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
