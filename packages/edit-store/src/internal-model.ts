/**
 * 内部表現（edit.json v2 の形 = `tracks[].items[]`）と、**版を知る唯一の場所**。
 *
 * 契約: 内部リポ `planning/notes-2026-08-18-timeline-latency-and-track-model.md` §9〜§11
 * （タスク `2026-08-18-edit-json-v2-internal-model` / Phase 1）。
 *
 * 方針:
 *   - `readInternalEdit()` より下流は「edit.json の版」を知らない。v0 / v1 / v2 のどれを渡しても
 *     同じ `InternalEdit` が返る。版で分岐してよいのは本ファイル（と `parseEdit` / `readEditV2`）だけ
 *   - トラックが正本。`tracks` の配列順が下→上の合成順で、`z` は配列添字と常に一致する
 *     （z の権威は `timeline.tracks` の配列順ただ一つ — タスク 5 の不変条件をそのまま引き継ぐ）
 *   - アイテムの種別は `source.kind`（`media` / `html` / `telop` / `filter`）1 軸。
 *     焼いたテロップは別種別ではなく `telop` の `baked`（= キャッシュ）で、**焼く前後で id は変わらない**
 *   - 相対参照は読み込み層で解決する。`item.at` は常に絶対値（v0/v1 の「前のカットの終端に詰まる」
 *     暗黙 at は `computeCutTrackSegments` で解決済み）
 *
 * 時間の単位:
 *   v2 は `atFrames` / `durationFrames` が出力時間の正本で、`at` / `duration` はこの読み込み層だけで
 *   `frames / output.fps` へ射影する。v0/v1 は移行前の秒宣言を 1 ビットも動かさず、対応する出力
 *   フレーム番号を `atFrames` / `durationFrames` に付記するだけなので、秒とフレームの射影が一致
 *   しない場合がある。レガシー宣言の格子化は v2 変換器の責務とする。
 */

import {
    EditAudioBgm,
    EditAudioNarration,
    EditAudioSfx,
    EditBeat,
    EditCut,
    EditDefaultSource,
    EditLayer,
    EditOverlay,
    EditSource,
    EditTimelineTrack,
    LayerBlendMode,
    TimelineTrackKind,
    computeCutTrackSegments,
    parseEdit
} from './edit-store';
import { ItemV2, TrackV2, readEditV2 } from './edit-v2';

/** v0（単一 source 宣言）へ読み込み層が割り当てる素材表の鍵。 */
export const DEFAULT_SOURCE_ID = '__default__';

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
 * 旧宣言（種別別配列）との対応。Phase 3（write-and-migrate）で書き込み経路が内部表現へ
 * 移るまで残る橋。v2 入力でも同じ型付きビューを合成するので、消費者は版を知らずに描ける。
 */
export interface InternalItemLegacy {
    collection: LegacyCollection;
    /** 宣言配列内の添字（v0/v1 では edit.json の配列添字 = テキスト手術の宛先）。 */
    index: number;
    /** 種別別の型付きビュー。旧読み取り器が受け付けなかった宣言では undefined。 */
    value?: EditCut | EditOverlay | EditLayer | EditAudioSfx | EditAudioNarration | EditAudioBgm;
}

export interface InternalItem {
    /** 宣言の id。焼く前後・版をまたいでも同じ 1 個のクリップは同じ id を保つ。 */
    id: string;
    /** 出力タイムライン上の絶対位置（整数フレーム）。v2 では正本、v0/v1 では宣言秒が乗るフレーム。 */
    atFrames: number;
    /** 出力尺（整数フレーム）。v2 では正本、v0/v1 では丸めた境界差。実尺未解決時は 0。 */
    durationFrames: number;
    /** 出力秒。v2 は `atFrames / output.fps`。v0/v1 は宣言どおりで、暗黙 at だけ解決済み。 */
    at: number;
    /** 出力秒。v2 は `durationFrames / output.fps`。v0/v1 は宣言どおり。 */
    duration: number;
    source: InternalItemSource;
    /**
     * 内部表現の宣言レコード。キー語彙は内部表現が固定し、v0 / v1 / v2 のどれから来ても
     * 同じキーで載る。深い視覚プロパティ（crop / perspective / keyframes / framing / freeze /
     * vars）の値検証は各消費者の既存検証器がそのまま行う（パリティ契約 §2.2.1 の
     * 「独立に導出した検証を共有バグで隠さない」を保つため、ここでは検証しない）。
     */
    declaration: Record<string, unknown>;
    legacy: InternalItemLegacy;
}

type InternalItemDraft = Omit<InternalItem, 'atFrames' | 'durationFrames'>;

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
    /** 出力の格子。v2 は integer 限定、v0/v1 は宣言どおり（既定 30）。 */
    fps: number;
    look?: unknown;
}

export interface InternalSource {
    /** 素材表の鍵。v0 の単一 source 宣言には読み込み層が `DEFAULT_SOURCE_ID` を割り当てる。 */
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
     * 単一素材宣言（旧 v0 の `source`）か。**basename 照合の後方互換はこの表記にだけ効く**
     * — 消費者は版ではなくこの性質を見る。
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
    /** 素材表。v0 の単一 source 宣言も鍵 1 個の表に正規化する。 */
    sources: InternalSource[];
    /**
     * 素材表として宣言されていたか（旧 v1 の `sources[]`）。単一宣言・宣言なしとの差を
     * 旧経路が要求するあいだだけ残す（Phase 3 で消える）。
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
 * edit.json（v0 / v1 / v2）を内部表現へ読む。**版で分岐してよい唯一の入口**。
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
    if (record.version === 2) {
        return readV2Internal(record);
    }
    return readLegacyInternal(record, text, options?.hasCaptions === true);
}

// ---------------------------------------------------------------------------
// v0 / v1
// ---------------------------------------------------------------------------

function readLegacyInternal(raw: Record<string, unknown>, text: string, hasCaptions: boolean): InternalEdit {
    const parsed = parseEdit(text);
    const sourceTableDeclared = Array.isArray(raw.sources);
    const sources = readLegacySources(raw);
    const trackDefs = parsed.timeline?.tracks ?? deriveLegacyTrackDefs(raw, hasCaptions);
    const tracksDeclared = parsed.timeline?.tracks !== undefined;

    const builder = new TrackBuilder(trackDefs, tracksDeclared ? 'declared' : 'derived', parsed.fps);
    const pathOf = (id: string | undefined): string | undefined =>
        sources.find(entry => entry.id === (id ?? DEFAULT_SOURCE_ID))?.path;

    // cuts — 暗黙 at（前のカットの終端に詰まる）をここで解決し、以降は絶対値だけを見せる。
    const rawCuts = Array.isArray(raw.cuts) ? raw.cuts as unknown[] : [];
    const segments = computeCutTrackSegments(parsed.cuts);
    const segmentByIndex = new Map<number, { at: number; duration: number }>();
    const cursorByTrack = new Map<number, number>();
    const previousIndexByTrack = new Map<number, number>();
    for (const segment of segments) {
        const cut = parsed.cuts[segment.index];
        const rawCut = declarationOf(rawCuts[parsed.origins.cuts[segment.index]]);
        const freezeSec = freezeDurationSeconds(rawCut.freeze);
        const hasExplicitAt = typeof cut.at === 'number' && Number.isFinite(cut.at) && cut.at >= 0;
        const previousIndex = previousIndexByTrack.get(segment.track);
        const transitionOverlap = !hasExplicitAt && previousIndex !== undefined
            ? parsed.cuts[previousIndex].transitionOut?.duration ?? 0 : 0;
        const at = hasExplicitAt ? segment.at : (cursorByTrack.get(segment.track) ?? 0) - transitionOverlap;
        const duration = segment.duration + freezeSec;
        segmentByIndex.set(segment.index, { at, duration });
        cursorByTrack.set(segment.track, at + duration);
        previousIndexByTrack.set(segment.track, segment.index);
    }
    for (let position = 0; position < parsed.cuts.length; position++) {
        const cut = parsed.cuts[position];
        const index = parsed.origins.cuts[position];
        const resolved = segmentByIndex.get(position);
        builder.add('cuts', cut.track ?? 0, {
            id: legacyItemId('cut', index),
            at: resolved?.at ?? cut.at ?? 0,
            duration: resolved?.duration ?? (cut.out - cut.in) / (cut.speed ?? 1),
            source: {
                kind: 'media',
                ...(cut.src !== undefined ? { sourceId: cut.src } : { sourceId: DEFAULT_SOURCE_ID }),
                ...(pathOf(cut.src) !== undefined ? { path: pathOf(cut.src) as string } : {}),
                in: cut.in,
                out: cut.out
            },
            declaration: declarationOf(rawCuts[index]),
            legacy: { collection: 'cuts', index, value: cut }
        });
    }
    // parseEdit が読み飛ばした宣言も内部表現には残す（消費者の独立検証がまだ拾うため）。
    addUnparsedLegacyItems(builder, rawCuts, parsed.origins.cuts, 'cuts', index => ({
        id: legacyItemId('cut', index),
        at: 0,
        duration: 0,
        source: { kind: 'media', in: 0, out: 0 } as InternalMediaSource,
        declaration: declarationOf(rawCuts[index]),
        legacy: { collection: 'cuts', index }
    }), index => trackNumberOf(rawCuts[index]));

    const rawOverlays = Array.isArray(raw.overlays) ? raw.overlays as unknown[] : [];
    for (let position = 0; position < parsed.overlays.length; position++) {
        const overlay = parsed.overlays[position];
        const index = parsed.origins.overlays[position];
        builder.add('overlays', overlay.track, {
            id: overlay.id,
            at: overlay.start,
            duration: overlay.duration,
            source: { kind: 'html', html: htmlOf(overlay.payload) },
            declaration: declarationOf(rawOverlays[index]),
            legacy: { collection: 'overlays', index, value: overlay }
        });
    }
    addUnparsedLegacyItems(builder, rawOverlays, parsed.origins.overlays, 'overlays', index => ({
        id: textOr(rawOverlays[index], 'id', legacyItemId('overlay', index)),
        at: 0,
        duration: 0,
        source: { kind: 'html', html: htmlOf(rawOverlays[index]) } as InternalHtmlSource,
        declaration: declarationOf(rawOverlays[index]),
        legacy: { collection: 'overlays', index }
    }), index => trackNumberOf(rawOverlays[index]));

    const rawLayers = Array.isArray(raw.layers) ? raw.layers as unknown[] : [];
    for (let position = 0; position < parsed.layers.length; position++) {
        const layer = parsed.layers[position];
        const index = parsed.origins.layers[position];
        builder.add('layers', layer.track ?? 0, {
            id: layer.id,
            at: layer.t,
            duration: layer.duration,
            source: layerSourceOf(layer),
            declaration: declarationOf(rawLayers[index]),
            legacy: { collection: 'layers', index, value: layer }
        });
    }
    addUnparsedLegacyItems(builder, rawLayers, parsed.origins.layers, 'layers', index => ({
        id: textOr(rawLayers[index], 'id', legacyItemId('layer', index)),
        at: 0,
        duration: 0,
        source: rawLayerSourceOf(rawLayers[index]),
        declaration: declarationOf(rawLayers[index]),
        legacy: { collection: 'layers', index }
    }), index => trackNumberOf(rawLayers[index]));

    const rawAudio = isRecord(raw.audio) ? raw.audio : undefined;
    const rawSfx = Array.isArray(rawAudio?.sfx) ? rawAudio?.sfx as unknown[] : [];
    for (let position = 0; position < parsed.audioSfx.length; position++) {
        const sfx = parsed.audioSfx[position];
        const index = parsed.origins.audioSfx[position];
        builder.add('audio', sfx.track ?? 0, {
            id: sfx.id,
            at: sfx.t,
            duration: sfx.duration,
            source: {
                kind: 'media',
                path: sfx.path,
                in: sfx.in ?? 0,
                out: sfx.out ?? (sfx.in ?? 0) + sfx.duration
            },
            declaration: declarationOf(rawSfx[index]),
            legacy: { collection: 'sfx', index, value: sfx }
        });
    }
    const rawNarration = Array.isArray(rawAudio?.narration) ? rawAudio?.narration as unknown[] : [];
    for (let position = 0; position < parsed.audioNarration.length; position++) {
        const narration = parsed.audioNarration[position];
        const index = parsed.origins.audioNarration[position];
        builder.add('audio', 0, {
            id: narration.id,
            at: narration.t,
            // 実尺は音声ファイルから解決するため宣言には無い（消費者が ffprobe 結果で埋める）。
            duration: 0,
            source: { kind: 'media', path: narration.path, in: 0, out: 0 },
            declaration: declarationOf(rawNarration[index]),
            legacy: { collection: 'narration', index, value: narration }
        });
    }
    if (parsed.audioBgm) {
        builder.add('audio', 0, {
            id: parsed.audioBgm.id,
            at: 0,
            duration: 0,
            source: { kind: 'media', path: parsed.audioBgm.path, in: 0, out: 0 },
            declaration: declarationOf(rawAudio?.bgm),
            legacy: { collection: 'bgm', index: 0, value: parsed.audioBgm }
        });
    }

    const output: InternalOutput = { fps: parsed.fps };
    const rawOutput = isRecord(raw.output) ? raw.output : undefined;
    if (typeof rawOutput?.width === 'number') output.width = rawOutput.width;
    if (typeof rawOutput?.height === 'number') output.height = rawOutput.height;
    if (rawOutput?.look !== undefined) output.look = rawOutput.look;

    return {
        output,
        sources,
        sourceTableDeclared,
        emptyProject: sourceTableDeclared
            ? (raw.sources as unknown[]).length === 0
            : raw.source === undefined || raw.source === null,
        tracks: builder.finish(),
        ...(parsed.beats !== undefined ? { beats: parsed.beats } : {}),
        tracksDeclared,
        warnings: parsed.warnings,
        declaration: {
            ...(raw.audio !== undefined ? { audio: raw.audio } : {}),
            ...(raw.captions !== undefined ? { captions: raw.captions } : {}),
            ...(raw.emphasis_words !== undefined ? { emphasisWords: raw.emphasis_words } : {}),
            ...(raw.tracks !== undefined ? { trackStates: raw.tracks } : {})
        }
    };
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
    if (raw.version === 2) {
        return readV2Internal(raw).sources;
    }
    return readLegacySources(raw);
}

function readLegacySources(raw: Record<string, unknown>): InternalSource[] {
    if (Array.isArray(raw.sources)) {
        return (raw.sources as unknown[]).map((entry, index) => {
            const record = isRecord(entry) ? entry : {};
            const id = typeof record.id === 'string' && record.id ? record.id : '';
            // 検証規則は旧読み取り器（parseEdit の sources ループ）と同じ:
            // id / path が非空文字列で、proxy は null か文字列（省略は不可）。
            const valid = id !== '' && typeof record.path === 'string' && record.path
                && (record.proxy === null || typeof record.proxy === 'string');
            return {
                id,
                declaredPath: record.path,
                ...(valid ? { path: record.path as string } : {}),
                declaredProxy: record.proxy,
                proxy: valid ? (record.proxy as string | null) : null,
                ...(record.chroma_key !== undefined ? { chromaKey: record.chroma_key } : {}),
                declarationPath: `sources[${id || String(index)}]`,
                isDefault: false
            };
        });
    }
    if (raw.source === undefined || raw.source === null) {
        return [];
    }
    // 宣言そのものが壊れていても表から落とさない（消費者の既存検証が「path が不正」と言えるように）。
    const record = isRecord(raw.source) ? raw.source : {};
    // 単一宣言だけは proxy 省略を許す（旧読み取り器の既定 source 規則と同じ）。
    const valid = typeof record.path === 'string' && record.path
        && (record.proxy === undefined || record.proxy === null || typeof record.proxy === 'string');
    return [{
        id: DEFAULT_SOURCE_ID,
        declaredPath: record.path,
        ...(valid ? { path: record.path as string } : {}),
        declaredProxy: record.proxy,
        proxy: valid ? ((record.proxy as string | null | undefined) ?? null) : null,
        ...(record.chroma_key !== undefined ? { chromaKey: record.chroma_key } : {}),
        declarationPath: 'source',
        isDefault: true
    }];
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

/**
 * `timeline.tracks` 省略時の既定トラック列。旧 `deriveTracks`（apps/shell 側の表示用導出 /
 * packages/edit-lint の正本）と同じ規則で、**生宣言**（parseEdit が読み飛ばした要素も含む）から
 * 導く。ここを parsed 由来に変えると行数が変わる = 画面表示が変わるので生宣言を見る。
 */
function deriveLegacyTrackDefs(raw: Record<string, unknown>, hasCaptions: boolean): EditTimelineTrack[] {
    const derived: EditTimelineTrack[] = [];
    const append = (kind: TimelineTrackKind, ref?: number): void => {
        derived.push({ id: `t${derived.length + 1}`, kind, ...(ref === undefined ? {} : { ref }) });
    };
    for (const kind of ['cuts', 'layers', 'overlays'] as const) {
        for (const ref of collectTrackNumbers(raw[kind])) {
            append(kind, ref);
        }
    }
    const inlineCaptions = Array.isArray(raw.captions) && raw.captions.length > 0;
    if (hasCaptions || inlineCaptions) {
        append('captions');
    }
    const audio = isRecord(raw.audio) ? raw.audio : undefined;
    const audioTracks = new Set(collectTrackNumbers(audio?.sfx));
    if (Array.isArray(audio?.narration) && (audio?.narration as unknown[]).length > 0) {
        audioTracks.add(0);
    }
    if (isRecord(audio?.bgm)) {
        audioTracks.add(0);
    }
    for (const ref of [...audioTracks].sort((left, right) => left - right)) {
        append('audio', ref);
    }
    return derived;
}

function collectTrackNumbers(items: unknown): number[] {
    if (!Array.isArray(items)) {
        return [];
    }
    const tracks = new Set<number>();
    for (const item of items) {
        if (!isRecord(item)) {
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(item, 'track')) {
            tracks.add(0);
        } else if (Number.isInteger(item.track) && (item.track as number) >= 0) {
            tracks.add(item.track as number);
        }
    }
    return [...tracks].sort((left, right) => left - right);
}

function addUnparsedLegacyItems(
    builder: TrackBuilder,
    rawItems: readonly unknown[],
    acceptedIndexes: readonly number[],
    kind: TimelineTrackKind,
    make: (index: number) => InternalItemDraft,
    trackOf: (index: number) => number
): void {
    const accepted = new Set(acceptedIndexes);
    for (let index = 0; index < rawItems.length; index++) {
        if (accepted.has(index)) {
            continue;
        }
        builder.add(kind, trackOf(index), make(index));
    }
}

function layerSourceOf(layer: EditLayer): InternalItemSource {
    if (layer.kind === 'baked') {
        return {
            kind: 'telop',
            ...(layer.preset !== undefined ? { preset: layer.preset } : {}),
            baked: layer.src
        };
    }
    return { kind: 'media', path: layer.src, in: 0, out: layer.duration };
}

function rawLayerSourceOf(value: unknown): InternalItemSource {
    const record = isRecord(value) ? value : {};
    if (record.kind === 'filter') {
        return { kind: 'filter', filter: record.filter };
    }
    if (record.kind === 'baked') {
        return {
            kind: 'telop',
            ...(typeof record.preset === 'string' ? { preset: record.preset } : {}),
            ...(typeof record.params === 'object' && record.params !== null
                ? { params: record.params as Record<string, unknown> } : {}),
            ...(typeof record.src === 'string' ? { baked: record.src } : {})
        };
    }
    return {
        kind: 'media',
        ...(typeof record.src === 'string' ? { path: record.src } : {}),
        in: 0,
        out: typeof record.duration === 'number' ? record.duration : 0
    };
}

function htmlOf(value: unknown): string {
    const record = isRecord(value) ? value : {};
    return typeof record.html === 'string' ? record.html : '';
}

function trackNumberOf(value: unknown): number {
    const record = isRecord(value) ? value : {};
    return normalizeTrackNumber(record.track);
}

function legacyItemId(prefix: string, index: number): string {
    return `${prefix}-${index}`;
}

function textOr(value: unknown, key: string, fallback: string): string {
    const record = isRecord(value) ? value : {};
    return typeof record[key] === 'string' && record[key] ? record[key] as string : fallback;
}

function declarationOf(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

/** v0/v1 の秒宣言は保持し、対応する出力フレーム番号だけを付記する。 */
function materializeLegacyFrames(item: InternalItemDraft, fps: number): InternalItem {
    const atFrames = Math.round(item.at * fps);
    const endFrames = Math.round((item.at + item.duration) * fps);
    const durationFrames = item.duration === 0 ? 0 : Math.max(0, endFrames - atFrames);
    return {
        ...item,
        atFrames,
        durationFrames
    };
}

function freezeDurationSeconds(value: unknown): number {
    const freeze = isRecord(value) ? value : undefined;
    return typeof freeze?.duration_sec === 'number'
        && Number.isFinite(freeze.duration_sec) && freeze.duration_sec > 0
        ? freeze.duration_sec : 0;
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
    const tracks: InternalTrack[] = edit.tracks.map(track => {
        const kind = legacyKindOfV2Track(track);
        const ref = kind === 'captions' ? undefined : nextRef(refCounters, kind);
        const items: InternalItem[] = [];
        if ('items' in track) {
            track.items.forEach((item, index) => {
                const built = buildV2Item(item, index, fps, ref ?? 0, track.lane, pathOf);
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
        declaration: {}
    };
}

function legacyKindOfV2Track(track: TrackV2 & { z: number }): TimelineTrackKind {
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
        default: return 'cuts';
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
            const alignsDuration = Math.abs(span - duration) <= 1 / fps + 1e-9;
            const cutOut = alignsDuration ? item.source.in + duration : item.source.out;
            const speed = !alignsDuration && duration > 0 ? span / duration : undefined;
            const value: EditCut = {
                in: item.source.in,
                out: cutOut,
                src: item.source.src,
                at,
                track: ref,
                ...(speed !== undefined ? { speed } : {}),
                ...(item.transform !== undefined ? { transform: item.transform } : {}),
                ...(item.opacity !== undefined ? { opacity: item.opacity } : {})
            };
            return {
                item: {
                    id: item.id, atFrames, durationFrames, at, duration, source,
                    declaration: { id: item.id, src: item.source.src, in: item.source.in, out: cutOut, at, track: ref, ...common, ...(speed !== undefined ? { speed } : {}) },
                    legacy: { collection: 'cuts', index, value }
                }
            };
        }
        case 'html': {
            const declaration = { id: item.id, html: item.source.path, start: at, duration, track: ref, ...common };
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

// ---------------------------------------------------------------------------
// トラック組み立て
// ---------------------------------------------------------------------------

class TrackBuilder {
    protected readonly tracks: InternalTrack[] = [];
    protected readonly byKey = new Map<string, InternalTrack>();

    constructor(
        defs: readonly EditTimelineTrack[],
        origin: InternalTrackOrigin,
        private readonly fps: number
    ) {
        defs.forEach((def, index) => {
            const track: InternalTrack = {
                id: def.id,
                lane: def.kind === 'audio' ? 'audio' : 'visual',
                z: index,
                ...(def.label !== undefined ? { name: def.label } : {}),
                ...(def.muted !== undefined ? { muted: def.muted } : {}),
                ...(def.hidden !== undefined ? { hidden: def.hidden } : {}),
                ...(def.locked !== undefined ? { locked: def.locked } : {}),
                origin,
                ...(def.kind === 'captions' ? { content: { from: 'captions.json' as const } } : {}),
                items: [],
                legacy: { kind: def.kind, ...(def.ref === undefined ? {} : { ref: def.ref }) }
            };
            this.tracks.push(track);
            const key = trackKey(def.kind, def.ref);
            if (!this.byKey.has(key)) {
                this.byKey.set(key, track);
            }
        });
    }

    add(kind: TimelineTrackKind, ref: number, item: InternalItemDraft): void {
        const key = trackKey(kind, ref);
        let track = this.byKey.get(key);
        if (!track) {
            // 宣言に無いトラック番号のアイテムも内部表現からは落とさない（旧経路は種別別配列を
            // トラック宣言と独立に描くため、落とすと画面から消える）。
            track = {
                id: `implicit-${kind}-${ref}`,
                lane: kind === 'audio' ? 'audio' : 'visual',
                z: this.tracks.length,
                origin: 'implicit',
                items: [],
                legacy: { kind, ref }
            };
            this.tracks.push(track);
            this.byKey.set(key, track);
        }
        track.items.push(materializeLegacyFrames(item, this.fps));
    }

    finish(): InternalTrack[] {
        return this.tracks.map((track, index) => ({ ...track, z: index }));
    }
}

function trackKey(kind: TimelineTrackKind, ref?: number): string {
    return kind === 'captions' ? 'captions' : `${kind}:${ref ?? 0}`;
}

// ---------------------------------------------------------------------------
// 旧経路への射影（Phase 3 で消える橋）
// ---------------------------------------------------------------------------

export interface LegacyEditView {
    cuts: EditCut[];
    sources?: EditSource[];
    source?: EditDefaultSource;
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
        ...(defaultSourceOf(internal) ? { source: defaultSourceOf(internal) as EditDefaultSource } : {}),
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

function defaultSourceOf(internal: InternalEdit): EditDefaultSource | undefined {
    const entry = internal.sources.find(source => source.isDefault && source.path !== undefined);
    return entry ? { path: entry.path as string, proxy: entry.proxy } : undefined;
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
