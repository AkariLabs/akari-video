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

    const warnings: string[] = [];
    const refCounters = new Map<TimelineTrackKind, number>();
    // どの段が「本編（cuts 相当）」かは、配列上の位置だけでなく段の**現在の中身**で決める。
    // 空トラックは資格外（そこに動画を移しても本編化しない）。段を新設して動画をそこへ動かすと、
    // 元の段は空になり、動かした先が資格を引き継ぐため、「動画を本編から別の段へ動かす」操作
    // そのものは本編判定を変えない（P0 2026-08-20 track-identity-and-duration）。
    const mainVisualTrackId = edit.tracks.find(track =>
        track.lane === 'visual' && 'items' in track && track.items.length > 0
    )?.id;
    const tracks: InternalTrack[] = edit.tracks.map(track => {
        const kind = legacyKindOfV2Track(track, track.id === mainVisualTrackId);
        const ref = kind === 'captions' ? undefined : nextRef(refCounters, kind);
        const items: InternalItem[] = [];
        if ('items' in track) {
            track.items.forEach((item, index) => {
                const built = buildV2Item(
                    item, index, fps, ref ?? 0, track.lane, track.id === mainVisualTrackId, pathOf
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

    addV2AudioItems(tracks, edit.audio, fps);
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

function legacyKindOfV2Track(track: TrackV2 & { z: number }, mainVisualTrack: boolean): TimelineTrackKind {
    if (!('items' in track)) {
        return 'captions';
    }
    if (track.lane === 'audio') {
        return 'audio';
    }
    switch (track.items[0]?.source.kind) {
        case 'html': return 'overlays';
        case 'telop':
        case 'filter': return 'layers';
        default: return mainVisualTrack ? 'cuts' : 'layers';
    }
}

function nextRef(counters: Map<TimelineTrackKind, number>, kind: TimelineTrackKind): number {
    const ref = counters.get(kind) ?? 0;
    counters.set(kind, ref + 1);
    return ref;
}

function buildV2Item(
    item: ItemV2,
    index: number,
    fps: number,
    ref: number,
    lane: InternalLane,
    mainVisualTrack: boolean,
    pathOf: (id: string) => string | undefined
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
                        legacy: { collection: 'sfx', index, value }
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
            // mainVisualTrack への昇格はトラック単位だが、cuts（concat チェーン）経路は
            // crop / perspective / blend / keyframes を読まない（render-cut の cut-transform.mjs /
            // track-compose.mjs が対応していない）。これらを宣言するアイテムは、たまたま昇格した
            // トラックに乗っていても常に layers 扱いにし、無関係な既存クリップが黙って
            // cuts へ再分類されて見た目が壊れないようにする（P0 2026-08-20 r2・wave-verify r1 差し戻し）。
            const hasLayerOnlyVisualProperties = item.crop !== undefined
                || item.perspective !== undefined
                || item.blend !== undefined
                || item.keyframes !== undefined;
            if (!mainVisualTrack || hasLayerOnlyVisualProperties) {
                const declaration = {
                    id: item.id, t: at, duration, kind: 'video', src: path ?? item.source.src,
                    track: ref, ...common, ...copyMediaSourceFields(item.source)
                };
                const value = declaration as unknown as EditLayer;
                return {
                    item: {
                        id: item.id, atFrames, durationFrames, at, duration, source,
                        declaration,
                        legacy: { collection: 'layers', index, value }
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
                    legacy: { collection: 'cuts', index, value }
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
                    legacy: { collection: 'overlays', index, value }
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
                    item: { id: item.id, atFrames, durationFrames, at, duration, source, declaration, legacy: { collection: 'layers', index } }
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
                item: { id: item.id, atFrames, durationFrames, at, duration, source, declaration, legacy: { collection: 'layers', index, value } }
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
                    legacy: { collection: 'layers', index }
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

/** v2 が秒のまま持ち越した audio を、表示用の audio lane へ落とさず射影する。 */
function addV2AudioItems(tracks: InternalTrack[], audioValue: unknown, fps: number): void {
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
            legacy: { collection: 'sfx', index, value }
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
            legacy: { collection: 'narration', index, value }
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
