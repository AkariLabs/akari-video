/**
 * edit.json v2 を tracks-first の内部表現へ読む。
 * トラック配列順が下→上の合成順で、時刻は整数フレーム宣言を正本とする。
 */
import { EditAudioBgm, EditAudioNarration, EditAudioSfx, EditBeat, EditCut, EditLayer, EditOverlay, EditSource, EditTimelineTrack, TimelineTrackKind } from './edit-store';
import { KeyframesReferenceV2 } from './edit-v2';
import { AnchorCaption } from './item-anchor';
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
    speed?: number;
    pitch_semitones?: number;
    formant?: 'preserve' | 'shift';
}
export interface InternalHtmlSource {
    kind: 'html';
    /** 断片ファイルのパス、またはインライン HTML。 */
    html: string;
    params?: Record<string, string>;
    part?: string;
    style?: Record<string, string>;
    text?: string;
    exclude?: string[];
    derivedFrom?: string;
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
    from?: string;
}
export interface InternalFilterSource {
    kind: 'filter';
    filter: unknown;
}
export interface InternalGroupSource {
    kind: 'group';
}
export interface InternalCaptionsSource {
    kind: 'captions';
    path: 'captions.json';
    exclude?: string[];
}
export interface InternalCaptionSource {
    kind: 'caption';
    path: 'captions.json';
    id: string;
}
export type InternalItemSource = InternalMediaSource | InternalHtmlSource | InternalTelopSource | InternalFilterSource | InternalGroupSource | InternalCaptionsSource | InternalCaptionSource;
/** 旧 edit.json の種別別配列の名前。v2 の `tracks[].items[]` は 'items'。 */
export type LegacyCollection = 'cuts' | 'overlays' | 'layers' | 'sfx' | 'narration' | 'bgm' | 'speech' | 'items';
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
    /** 明示された子。袋 projection は含まない。 */
    children: InternalItem[];
    /** 親があるときだけ宣言 id を保持する。 */
    parentId?: string;
    /** motion/ 袋参照。A1 ではファイルを解決しない。 */
    keyframesRef?: KeyframesReferenceV2;
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
    /** @deprecated Accepted for compatibility; split audio is always enabled. */
    allowCutAudioSplit?: boolean;
    /** captions.json に字幕があるか（字幕トラックの導出条件。既定 false）。 */
    hasCaptions?: boolean;
    /** 行アンカーを再解決するときの字幕。省略時はキャッシュ済み at / duration をそのまま読む。 */
    captions?: AnchorCaption[];
}
/**
 * edit.json v2 を内部表現へ読む。v0/v1 は凍結変換ユニットのみが読む。
 * 文字列でもパース済みオブジェクトでも受け取る。
 */
export declare function readInternalEdit(source: string | unknown, options?: InternalReadOptions): InternalEdit;
/**
 * 素材表だけを読む軽い入口（版を知るのは同じくここだけ）。アイテムまで要らない照合
 * （生素材と edit.json の突き合わせ等）が、全文の読み取りを払わずに済むようにする。
 */
export declare function readInternalSources(source: string | unknown): InternalSource[];
/**
 * 総尺の正本定義: 映像本体（cuts + layers 相当。source.kind が media / telop / filter）の
 * 全 visual トラックのアイテムの最大終端（出力秒）。「本編（cuts）かどうか」の旧種別は見ない
 * ため、段（トラック）を移動しても値が変わらない。edit-lint と render-cut の両方がこの 1 関数を
 * 共有し、定義がずれないようにする（P0 2026-08-20 track-identity-and-duration 指示 2）。
 * html（overlays）は含めない: overlays / captions / audio はこの尺に収まっているかを
 * 検証される側であり、検証対象自身を尺の分母に混ぜると常に「収まっている」判定になってしまう。
 */
export declare function visualContentEndSeconds(internal: InternalEdit): number;
/**
 * 出力タイムラインの総尺。映像本体がある間は visualContentEndSeconds を唯一の正本とし、
 * 映像本体が 0 秒のときだけ overlays / 字幕 / narration / sfx の最大終端へ後退する。
 * BGM は総尺に合わせて切られる素材なので、後退尺には含めない。
 */
export declare function timelineDurationSeconds(internal: InternalEdit): {
    seconds: number;
    basis: 'visual' | 'overlays-audio' | 'empty';
};
/** 全トラックの明示アイテムを、親→子の深さ優先で列挙する。 */
export declare function walkItems(internal: InternalEdit): Generator<InternalItem>;
export interface CrossTrackLayerEvacuation {
    itemId: string;
    trackId: string;
    causeItemId: string;
    causeTrackId: string;
    overlapStartFrames: number;
    overlapEndFrames: number;
}
/**
 * 別 visual track との重なりが原因で upper item が layers へ退避される組を返す。
 * edit-lint と UI は理由文言に必要な相手 id を、この単一定義から得る。
 */
export declare function findCrossTrackLayerEvacuations(edit: unknown): CrossTrackLayerEvacuation[];
export interface LegacyEditView {
    cuts: EditCut[];
    sources?: EditSource[];
    overlays: EditOverlay[];
    beats?: EditBeat[];
    layers: EditLayer[];
    audioSfx: EditAudioSfx[];
    audioNarration: EditAudioNarration[];
    audioSpeech?: EditAudioNarration[];
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
