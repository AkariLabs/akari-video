export type LaneV2 = 'visual' | 'audio';
export interface OutputV2 {
    width: number;
    height: number;
    fps: number;
    look?: unknown;
    encoding?: unknown;
    [key: string]: unknown;
}
export interface EditSourceV2 {
    id: string;
    path: string;
    proxy?: string | null;
    chroma_key?: Record<string, unknown> | null;
}
export interface TransformV2 {
    x?: number;
    y?: number;
    scale?: number;
    rotate?: number;
}
export interface CropV2 {
    x: number;
    y: number;
    w: number;
    h: number;
    [key: string]: unknown;
}
export interface KeyframeV2 {
    /** アイテム内のローカル時間（整数フレーム、item.at を 0 とする）。 */
    t: number;
    transform?: TransformV2;
    crop?: CropV2;
    perspective?: Record<string, unknown>;
    easing?: 'linear' | 'ease-in-out';
    [key: string]: unknown;
}
export type BlendModeV2 = 'normal' | 'screen' | 'multiply' | 'add' | 'difference' | 'darken' | 'lighten' | 'overlay' | 'hardlight' | 'softlight';
export interface MediaSourceV2 {
    kind: 'media';
    src: string;
    in: number;
    out: number;
    framing?: Record<string, unknown>;
    transition_out?: Record<string, unknown> | null;
    freeze?: Record<string, unknown> | null;
    fx?: unknown[];
    speed?: number;
    chroma_key?: Record<string, unknown> | null;
}
export interface AudioMediaSourceV2 {
    kind: 'media';
    src: string;
    /** 素材ファイル内のトリム開始（秒）。省略時は 0。 */
    in?: number;
    /** 素材ファイル内のトリム終端（秒）。省略時はファイル末尾。 */
    out?: number;
}
export interface HtmlSourceV2 {
    kind: 'html';
    path: string;
    vars?: Record<string, unknown>;
    params?: Record<string, string>;
}
export interface TelopSourceV2 {
    kind: 'telop';
    preset: string;
    params?: Record<string, unknown>;
    baked?: string;
}
export type FilterV2 = {
    type: 'invert';
} | {
    type: 'lut';
    id: string;
    intensity?: number;
} | {
    type: 'saturation';
    value: number;
};
export interface FilterSourceV2 {
    kind: 'filter';
    filter: FilterV2;
}
export type SourceV2 = MediaSourceV2 | HtmlSourceV2 | TelopSourceV2 | FilterSourceV2;
export interface ItemV2Base {
    id: string;
    /** 出力タイムライン上の絶対位置（整数フレーム）。 */
    at: number;
    /** 表示・再生尺（整数フレーム）。 */
    duration: number;
    transform?: TransformV2;
    opacity?: number;
    blend?: BlendModeV2;
    crop?: CropV2;
    perspective?: Record<string, unknown>;
    keyframes?: KeyframeV2[];
}
export type ItemV2 = (ItemV2Base & {
    source: MediaSourceV2;
}) | (ItemV2Base & {
    source: HtmlSourceV2;
}) | (ItemV2Base & {
    source: TelopSourceV2;
}) | (ItemV2Base & {
    source: FilterSourceV2;
});
export type AudioRoleV2 = 'sfx' | 'narration' | 'bgm';
export interface NarrationProvenanceV2 {
    provider: string;
    engine?: string;
    voice?: string;
    credit?: string;
    generated_at?: string;
    [key: string]: unknown;
}
export interface AudioMediaItemV2 {
    id: string;
    /** 出力タイムライン上の絶対位置（整数フレーム）。 */
    at: number;
    /** 出力尺（整数フレーム）。0 は実尺未解決のセンチネル。 */
    duration: number;
    /** 省略時は sfx。 */
    role?: AudioRoleV2;
    source: AudioMediaSourceV2;
    gain_db?: number;
    fade_in?: number;
    fade_out?: number;
    ducking?: boolean;
    script?: string;
    reading?: string;
    provenance?: NarrationProvenanceV2;
}
export interface CaptionTrackContentV2 {
    from: 'captions.json';
}
export interface VisualItemsTrackV2 {
    id: string;
    lane: 'visual';
    name?: string;
    items: ItemV2[];
}
export interface AudioItemsTrackV2 {
    id: string;
    lane: 'audio';
    name?: string;
    items: AudioMediaItemV2[];
}
export type ItemsTrackV2 = VisualItemsTrackV2 | AudioItemsTrackV2;
export interface ContentTrackV2 {
    id: string;
    lane: LaneV2;
    name?: string;
    content: CaptionTrackContentV2;
}
export type TrackV2 = ItemsTrackV2 | ContentTrackV2;
export interface EditV2 {
    version: 2;
    output: OutputV2;
    sources: EditSourceV2[];
    /** 配列順が下から上の合成 z 順。 */
    tracks: TrackV2[];
    /**
     * 旧 v2 fixture が持つ top-level audio の互換 fallback。新規の SFX / narration / BGM は
     * audio lane の items で宣言する。
     */
    audio?: unknown;
    captions?: unknown[];
    thumbnail?: Record<string, unknown>;
}
export type InternalTrackV2 = TrackV2 & {
    /** 0 が最背面。tracks の配列添字と常に一致する。 */
    z: number;
};
export interface InternalEditV2 {
    version: 2;
    output: OutputV2;
    sources: EditSourceV2[];
    /** 入力順を保持した下→上のトラック列。 */
    tracks: InternalTrackV2[];
    audio?: unknown;
    captions?: unknown[];
    thumbnail?: Record<string, unknown>;
}
/**
 * edit.json v2 だけを検証して内部表現へ読む。v0/v1 の変換は意図的に扱わない。
 * tracks の配列順を保持し、各 track に z（0 = 最背面）を付ける。
 */
export declare function readEditV2(json: unknown): InternalEditV2;
