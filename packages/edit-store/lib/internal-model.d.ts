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
import { EditAudioBgm, EditAudioNarration, EditAudioSfx, EditBeat, EditCut, EditDefaultSource, EditLayer, EditOverlay, EditSource, EditTimelineTrack, TimelineTrackKind } from './edit-store';
/** v0（単一 source 宣言）へ読み込み層が割り当てる素材表の鍵。 */
export declare const DEFAULT_SOURCE_ID = "__default__";
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
export type InternalItemSource = InternalMediaSource | InternalHtmlSource | InternalTelopSource | InternalFilterSource;
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
    content?: {
        from: 'captions.json';
    };
    items: InternalItem[];
    /** 旧 (kind, ref) identity。Phase 3 まで残る種別別配列との対応に使う。 */
    legacy: {
        kind: TimelineTrackKind;
        ref?: number;
    };
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
export declare function readInternalEdit(source: string | unknown, options?: InternalReadOptions): InternalEdit;
/**
 * 素材表だけを読む軽い入口（版を知るのは同じくここだけ）。アイテムまで要らない照合
 * （生素材と edit.json の突き合わせ等）が、全文の読み取りを払わずに済むようにする。
 */
export declare function readInternalSources(source: string | unknown): InternalSource[];
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
    timeline?: {
        tracks: EditTimelineTrack[];
    };
    fps: number;
    warnings: string[];
}
/**
 * 内部表現 → 旧種別別配列。**`tracks[].items[]` だけを見て組み立てる**（生 JSON も版も見ない）。
 * まだ内部表現へ移せていない描画経路のための橋で、Phase 3 で消える。
 */
export declare function projectLegacyEdit(internal: InternalEdit): LegacyEditView;
/** 内部トラック → 旧 timeline.tracks 要素。 */
export declare function toLegacyTrack(track: InternalTrack): EditTimelineTrack;
/** `timeline.tracks` を宣言していないプロジェクトの既定行（読み込み層が導出した順のまま）。 */
export declare function derivedLegacyTracks(internal: InternalEdit): EditTimelineTrack[];
