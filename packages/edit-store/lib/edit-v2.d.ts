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
export type EasingV2 = string;
export interface KeyframeV2 {
    /** アイテム内のローカル時間（整数フレーム、item.at を 0 とする）。 */
    t: number;
    transform?: TransformV2;
    crop?: CropV2;
    perspective?: Record<string, unknown>;
    opacity?: number;
    gain_db?: number;
    animator?: Record<string, {
        offset?: number;
        start?: number;
        end?: number;
    }>;
    easing?: EasingV2 | Record<string, EasingV2>;
    [key: string]: unknown;
}
export interface KeyframesReferenceV2 {
    path: string;
    count: number;
}
export interface MotionV0 {
    in?: {
        preset: string;
        duration: number;
        ease?: string;
        amount?: number;
    };
    out?: {
        preset: string;
        duration: number;
        ease?: string;
        amount?: number;
    };
    loop?: {
        preset: string;
        period: number;
        ease?: string;
        amount?: number;
    };
}
export interface AnimatorV0 {
    id: string;
    basis: 'chars' | 'words' | 'lines' | 'segments';
    shape: 'ramp' | 'triangle' | 'round' | 'smooth' | 'square' | 'ramp-down';
    start: number;
    end: number;
    offset: number;
    randomize?: {
        seed: number;
    };
    amount: Record<string, number>;
    ease?: string;
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
    speed?: number;
    pitch_semitones?: number;
    formant?: 'preserve' | 'shift';
}
export interface HtmlSourceV2 {
    kind: 'html';
    path: string;
    part?: string;
    style?: Record<string, string>;
    text?: string;
    exclude?: string[];
    derivedFrom?: string;
    vars?: Record<string, unknown>;
    params?: Record<string, string>;
}
export type ShapeKindV0 = 'rect' | 'rounded-rect' | 'ellipse' | 'line' | 'arrow' | 'speech-bubble';
export interface ShapeParamsV0 {
    width?: number;
    height?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    cornerRadius?: number;
}
export interface ShapeSourceV2 {
    kind: 'shape';
    shape: ShapeKindV0;
    params?: ShapeParamsV0;
}
export interface TelopSourceV2 {
    kind: 'telop';
    preset: string;
    params?: Record<string, unknown>;
    baked?: string;
    from?: string;
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
export interface GroupSourceV2 {
    kind: 'group';
}
export interface CaptionsSourceV2 {
    kind: 'captions';
    path: 'captions.json';
    exclude?: string[];
}
export interface CaptionSourceV2 {
    kind: 'caption';
    path: 'captions.json';
    id: string;
}
export type SourceV2 = MediaSourceV2 | HtmlSourceV2 | ShapeSourceV2 | TelopSourceV2 | FilterSourceV2 | GroupSourceV2 | CaptionsSourceV2 | CaptionSourceV2;
export interface AdjustBasicV0 {
    exposure?: number;
    contrast?: number;
    highlights?: number;
    shadows?: number;
    blacks?: number;
    whites?: number;
    temperature?: number;
    tint?: number;
    vibrance?: number;
    saturation?: number;
}
export interface AdjustLutV0 {
    lut: string;
    intensity?: number;
}
export interface AdjustCurvePointV1 {
    in: number;
    out: number;
}
export interface AdjustCurvesV1 {
    master?: AdjustCurvePointV1[];
    r?: AdjustCurvePointV1[];
    g?: AdjustCurvePointV1[];
    b?: AdjustCurvePointV1[];
}
export interface AdjustWheelV1 {
    r?: number;
    g?: number;
    b?: number;
}
export interface AdjustWheelsV1 {
    lift?: AdjustWheelV1;
    gamma?: AdjustWheelV1;
    gain?: AdjustWheelV1;
    offset?: AdjustWheelV1;
}
export interface AdjustHuePointV1 {
    hue: number;
    value: number;
}
export interface AdjustHueCurvesV1 {
    hue?: AdjustHuePointV1[];
    sat?: AdjustHuePointV1[];
    luma?: AdjustHuePointV1[];
}
export interface AdjustV1 {
    basic?: AdjustBasicV0;
    lut?: AdjustLutV0 | null;
    curves?: AdjustCurvesV1;
    wheels?: AdjustWheelsV1;
    hue?: AdjustHueCurvesV1;
    sections?: {
        basic?: boolean;
        lut?: boolean;
        curves?: boolean;
        wheels?: boolean;
        hue?: boolean;
    };
}
/** @deprecated Use AdjustV1. */
export type AdjustV0 = AdjustV1;
export interface ItemV2Base {
    id: string;
    name?: string;
    hidden?: boolean;
    locked?: boolean;
    /** 出力タイムライン上の絶対位置（整数フレーム）。 */
    at: number;
    /** 表示・再生尺（整数フレーム）。 */
    duration: number;
    anchor?: {
        caption: string;
        range?: {
            start: number;
            end: number;
        };
        offset?: number;
        duration?: 'caption' | 'own';
    };
    transform?: TransformV2;
    opacity?: number;
    blend?: BlendModeV2;
    crop?: CropV2;
    adjust?: AdjustV1;
    perspective?: Record<string, unknown>;
    motion?: MotionV0;
    animator?: AnimatorV0[];
    /** inline keyframes. The lazy reference spelling is exposed as InternalItem.keyframesRef. */
    keyframes?: KeyframeV2[];
    items?: ItemV2[];
}
export type MediaItemV2 = ItemV2Base & {
    source: MediaSourceV2;
    /** sources[].id of a gray-h264-fullrange mask video. */
    mask?: string;
};
export type ItemV2 = MediaItemV2 | (ItemV2Base & {
    source: HtmlSourceV2;
}) | (ItemV2Base & {
    source: ShapeSourceV2;
}) | (ItemV2Base & {
    source: TelopSourceV2;
}) | (ItemV2Base & {
    source: FilterSourceV2;
}) | (ItemV2Base & {
    source: GroupSourceV2;
}) | (ItemV2Base & {
    source: CaptionsSourceV2;
}) | (ItemV2Base & {
    source: CaptionSourceV2;
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
    name?: string;
    hidden?: boolean;
    locked?: boolean;
    /** 出力タイムライン上の絶対位置（整数フレーム）。 */
    at: number;
    /** 出力尺（整数フレーム）。0 は実尺未解決のセンチネル。 */
    duration: number;
    /** 省略時は sfx。 */
    role?: AudioRoleV2;
    source: AudioMediaSourceV2;
    gain_db?: number;
    denoise?: {
        method: 'fft' | 'nlm';
        strength: number;
    };
    lowcut_hz?: number;
    keyframes?: KeyframeV2[];
    fade_in?: number;
    fade_out?: number;
    ducking?: boolean;
    duck_db?: number;
    duck_attack?: number;
    duck_release?: number;
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
