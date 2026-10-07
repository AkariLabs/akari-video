// F-50: akari-preview-open-handler.ts から機械移設した interface / type（実行時には残らない。宣言は無改変で `export` を足しただけ）。
import { PreviewLibraryDrop } from './preview-library-drop';
import URI from '@theia/core/lib/common/uri';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import type { AdjustCurvesV1, AdjustWheelsV1, AdjustHueCurvesV1, InternalEdit } from '@akari-video/edit-store';
import type { CaptionRunEdit } from '@akari-video/edit-store';
import type { PreviewItemWriteCommand } from '@akari-video/edit-store';
import type { ReadableTransitionType } from '@akari-video/edit-store';
import { PreviewDiagnosticsSession } from './preview-diagnostics';
import { PreviewAudioSidecarRequest, ReviewStrokeFrame, VideoStreamReference } from '../common/akari-preview-protocol';
import { type CaptionCuePosition, type CaptionToolStylePatch } from '../common/caption-zone-write';
import { ItemKeyframe } from '../common/item-keyframes-summary';
import { CutFraming } from '../common/cut-framing-visual';
import { CutFreeze } from '../common/cut-freeze-visual';
import {
    CaptionAnimatorSummary,
    LayerCropSummary,
    PhotoFrameSummary,
    LayerKeyframesSummary,
    LayerPerspectiveSummary,
    MotionSummary
} from '../common/edit-summary-fields';
import type { PreviewModelDiffInput } from '../common/preview-model-diff';
import { ReviewToolMode } from '../common/review-tool-mode';
import { PreviewCaption } from './akari-preview-captions';
import { ReviewTransportChange } from './review-session-recorder';
import type { CAPTION_ZONES } from './preview-host-constants';

export interface OverlayTransform {
    scaleX?: number;
    scaleY?: number;
    x?: number;
    y?: number;
    scale?: number;
    rotate?: number;
}

export interface EditSummaryOverlay {
    id: string;
    sourcePath?: string;
    html: string;
    start: number;
    duration: number;
    track: number;
    trackId: string;
    transform: OverlayTransform;
    vars: Record<string, string>;
    params: Record<string, string>;
    keyframes?: readonly ItemKeyframe[];
    keyframeUnit?: 'seconds' | 'frames';
    motion?: any;
    motionSource?: any;
    motionParents?: any[];
    opacity?: number;
    part?: string;
    parentId?: string;
    role?: 'background' | 'shape' | 'shape-line';
    blend: string;
}

export interface EditSummaryLayer {
    renderTrack?: number;
    in?: number;
    speed?: number;
    id: string;
    t: number;
    duration: number;
    kind: 'baked' | 'video';
    src?: string;
    sourceWidth?: number;
    sourceHeight?: number;
    /** Original file URI used only to target a decode-failure fallback request. */
    sourceUri?: string;
    /** v2 item.mask の動画ソース、または alpha intake が生成するマスクの asset stream URL。
     * frame-engine 面でアルファ層（.webm / .mov）を media-bin
     * alpha-intake に通したとき、src（色 mp4）と対になるマスク mp4 の asset stream URL。webview の engine
     * bootstrap はこれをマスクソースとして登録し、engine が kind 'matte' として色×マスク合成する
     * （Web UI の frameEngine.intake と同型）。両方ある場合は alpha intake を優先する。 */
    mask?: string;
    maskFeather?: number;
    regions?: readonly Record<string, unknown>[];
    erase?: readonly { mode: 'erase' | 'restore'; points: readonly (readonly [number, number])[]; size: number; hardness: number }[];
    flip?: { h?: boolean; v?: boolean };
    /** task 2026-08-10-image-layer-parity 司令塔裁定1: layers[].src の拡張子だけで判定する
     * 静止画フラグ（schema の kind は 'video' のまま不変）。webview 側はこれで <video>/<img> の
     * どちらを生成するか決める。'baked' は常に false（後述 isImageLayerSrc の呼び出し側コメント参照）。 */
    isImage: boolean;
    transform: OverlayTransform;
    opacity: number;
    blend: string;
    chromaKey?: VideoFxChromaKey;
    proxyMissing: boolean;
    /** 初回 open の臨界経路から外した telop ラスタだけに host が立てる。通常の baked は false/省略。 */
    deferredTelop?: boolean;
    retiredTelop?: boolean;
    track: number;
    trackId: string;
    /** edit.schema.json #/$defs/layerCrop（0..1 正規化・ソースフレーム相対・静的）。
     * common/edit-summary-fields.ts の normalizeLayerCropForSummary が担う。 */
    crop?: LayerCropSummary;
    frame?: PhotoFrameSummary;
    /** edit.schema.json #/$defs/layerPerspective（corner-pin パース変形・v0 静的）。
     * common/edit-summary-fields.ts の normalizeLayerPerspectiveForSummary が担う。 */
    perspective?: LayerPerspectiveSummary;
    keyframes?: LayerKeyframesSummary;
    motion?: MotionSummary;
    motionSource?: any;
    motionParents?: any[];
    adjust?: EditSummaryAdjust;
}

export interface EditSummaryFilter {
    id: string;
    t: number;
    duration: number;
    trackId: string;
    track: number;
    filter: { type?: string; value?: number; id?: string };
    adjust?: EditSummaryAdjust;
}

export interface EditSummaryAdjust {
    basic?: Record<string, number>;
    lut?: { lut: string; intensity?: number } | null;
    curves?: AdjustCurvesV1;
    wheels?: AdjustWheelsV1;
    hue?: AdjustHueCurvesV1;
    sections?: { basic?: boolean; lut?: boolean; curves?: boolean; wheels?: boolean; hue?: boolean };
}

export type PreviewCaptionClockDomain = 'source' | 'output' | 'legacy';

export type AnimatedPreviewCaption = PreviewCaption & CaptionAnimatorSummary;

export interface PreviewCaptionClockInput extends AnimatedPreviewCaption {
    /** 読込層だけが扱う時刻 domain。webview へ渡す前に必ず output へ正規化する。 */
    clockDomain: PreviewCaptionClockDomain;
    /** Original declaration, retained for placed-text manipulation after clock projection. */
    timeDomain?: 'source' | 'output';
    /** 複数 source の source-domain cue を該当 cut だけへ射影するための任意 source id。 */
    clockSourceId?: string;
    groupTransform?: OverlayTransform;
    groupOpacity?: number;
    groupTrackId?: string;
}

export interface OutputPreviewCaption extends PreviewCaptionClockInput {
    clockDomain: 'output';
}

export interface LoadedPreviewCaptions {
    captions: PreviewCaptionClockInput[];
    emphasisWords?: unknown;
}

export interface EditSummaryCut {
    audio?: false;
    mute?: boolean;
    /** v2 tracks[].items[].id（legacy でも内部表現が付けた安定 id）。 */
    id: string;
    /** meta.json サイドカーとの結線に使うプロジェクト相対パス。 */
    sourcePath?: string;
    /** 参照するソース id（v1 cuts[].src。v0 は既定 id）。webview はこれで <video> を切り替える */
    src: string;
    in: number;
    out: number;
    transform?: OverlayTransform;
    opacity?: number;
    /** render-cut の cut layer-style 経路と同じ source-frame-relative visual。 */
    crop?: LayerCropSummary;
    frame?: PhotoFrameSummary;
    perspective?: LayerPerspectiveSummary;
    keyframes?: LayerKeyframesSummary;
    motion?: MotionSummary;
    motionSource?: any;
    motionParents?: any[];
    speed?: number;
    gain_db?: number;
    gainDb?: number;
    volume_db?: number;
    transitionOut?: {
        type: ReadableTransitionType;
        duration: number;
    };
    at?: number;
    track: number;
    trackId: string;
    renderTrack: number;
    /** contract-2026-07-22-render-basics.md #6 (静的クロップ / ズームキーフレーム）。
     * 深いバリデーションは common/cut-framing-visual.ts の computeCutFramingVisual が担う
     * ため、ここでは「非配列オブジェクト」であることだけ確認して素通しする。 */
    framing?: CutFraming;
    /** contract-2026-07-22-render-basics.md #7（フリーズ）。同上、深いバリデーションは
     * common/cut-freeze-visual.ts の checkCutFreezeCrossing 側。 */
    freeze?: CutFreeze;
    chromaKey?: VideoFxChromaKey;
    adjust?: EditSummaryAdjust;
}

export type PreviewAudioSidecarState = 'ready' | 'queued' | 'generating' | 'no-audio' | 'failed' | 'unavailable';

export interface PreviewAudioSidecarRequestResult {
    state: PreviewAudioSidecarState | 'not-eligible' | 'not-needed';
    format?: 'flac' | 'pcm-s16le';
    sampleRate?: number;
    channels?: number;
    frames?: number;
    bytesPerSample?: number;
    key?: string;
    probe?: { fingerprint: string };
    bytes?: number;
    durationSec?: number;
    reason?: string;
    stream?: VideoStreamReference;
}

export interface PreviewAudioService {
    requestPreviewAudioSidecar(request: PreviewAudioSidecarRequest): Promise<PreviewAudioSidecarRequestResult>;
    sweepPreviewAudioSidecars(request: {
        projectRootUri: string; keepKeys: string[]; keepProbes?: string[]; minAgeMs?: number;
    }): Promise<{ removed: number; bytes: number }>;
}

export interface PreviewAudioPendingRequest {
    /** Independent speech uses narration sidecars but keeps its own summary collection. */
    audioCollection?: 'speech';
    at?: number;
    durationSec?: number;
    key?: string;
    state?: PreviewAudioSidecarRequestResult['state'];
    kind: 'speech' | 'bgm' | 'sfx' | 'narration';
    id: string;
    label: string;
    request: PreviewAudioSidecarRequest;
}

export interface PreviewAudioSidecarEntry {
    at: number;
    kind: PreviewAudioPendingRequest['kind'];
    item?: PreviewAudioPendingRequest;
    resolve?: () => Promise<PreviewAudioSidecarFields | undefined>;
}

export type PreviewAudioSidecarFields = Pick<EditSummarySpeech, 'sidecar' | 'sidecarState' | 'sidecarWarningEmitted'>;

export interface EditSummarySpeech {
    id: string;
    src: string;
    atSec: number;
    durationSec: number;
    inSec: number;
    outSec: number;
    speed: number;
    gainDb?: number;
    track?: number;
    materialDurationSec: number;
    sidecar?: PreviewAudioSidecarSummary;
    sidecarState?: PreviewAudioSidecarState;
    atempo?: { path: string; durationSec: number; generatedMs?: number };
    padBeforeSec?: number;
    padAfterSec?: number;
    crossfadeInSec?: number;
    crossfadeOutSec?: number;
    sidecarWarningEmitted?: boolean;
}

export interface PreviewAudioSidecarSummary {
    format?: 'flac' | 'pcm-s16le';
    sampleRate?: number;
    channels?: number;
    frames?: number;
    bytesPerSample?: number;
    path: string;
    durationSec: number;
    padBeforeSec: number;
    padAfterSec: number;
    generatedMs?: number;
    skipped?: boolean;
    bytes?: number;
}

export interface VideoFxBackground {
    type: 'color' | 'image';
    color?: string;
    url?: string;
}

export interface VideoFxChromaKey {
    color: string;
    similarity: number;
    blend: number;
    mode: 'source' | 'layer';
    background?: VideoFxBackground;
}

export interface EditSummaryVideoFx {
    look?: { cubeText: string; intensity: number };
    sources: Record<string, VideoFxChromaKey>;
}

export interface EditSummaryAudioSource {
    src: string;
    gainDb: number;
    keyframes?: Array<{ t: number; gainDb: number; easing?: string }>;
    sidecar?: PreviewAudioSidecarSummary;
    sidecarState?: PreviewAudioSidecarState;
}

export interface EditSummaryBgm extends EditSummaryAudioSource {
    id?: string;
    t?: number;
    duration?: number;
    track?: number;
    ducking: boolean;
    duckDb?: number;
    duckAttack?: number;
    duckRelease?: number;
    fadeIn?: number;
    fadeOut?: number;
    fadeInShape?: 'linear' | 'equal_power' | 's_curve' | 'slow';
    fadeOutShape?: 'linear' | 'equal_power' | 's_curve' | 'slow';
    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: file-internal start offset (素材秒).
    in?: number;
}

export interface EditSummaryTimedAudio extends EditSummaryAudioSource {
    role?: 'speech';
    duckKey?: boolean;
    id: string;
    t: number;
    track?: number;
    // SFX, narration and independent speech share a playback window = material's [in, out).
    // Omitted in/out are resolved against the decoded
    // buffer's real duration in the injected preview script (createPreviewAudio's decodeOne).
    in?: number;
    out?: number;
    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum (audio-clip-fades,
    // 2026-08-18; sfx only). edit.json spells these audio.sfx[].fade_in/fade_out (snake_case,
    // distinct from bgm's camelCase fadeIn/fadeOut) -- normalized to camelCase here to match this
    // file's own TS field-naming convention for every other JSON-sourced audio field.
    fadeIn?: number;
    fadeOut?: number;
    fadeInShape?: 'linear' | 'equal_power' | 's_curve' | 'slow';
    fadeOutShape?: 'linear' | 'equal_power' | 's_curve' | 'slow';
    ducking?: boolean;
    duckDb?: number;
    duckAttack?: number;
    duckRelease?: number;
}

export interface EditSummaryAudio {
    bgm?: EditSummaryBgm;
    bgms?: EditSummaryBgm[];
    sfx: EditSummaryTimedAudio[];
    narration: EditSummaryTimedAudio[];
    speech: EditSummaryTimedAudio[];
    embeddedSpeech?: EditSummarySpeech[];
}

export interface EditSummaryEmphasisWord {
    id: string;
    src?: string;
    t_start: number;
    t_end: number;
    word: string;
    emotion: string;
    style_hint?: string;
}

export interface EditSummaryTrackState {
    ref: number;
    muted?: boolean;
    hidden?: boolean;
}

export interface EditSummaryTracks {
    cuts?: EditSummaryTrackState[];
    layers?: EditSummaryTrackState[];
    audio?: EditSummaryTrackState[];
}

export interface EditSummaryTimelineTrack {
    id: string;
    z: number;
}

export interface PreviewSelectionNode {
    id: string;
    parentId: string | null;
    kind: 'group' | 'bag' | 'leaf';
    label: string;
    /** Composed output-space transform, used for a group translation write. */
    transform: OverlayTransform;
    localTransform?: OverlayTransform;
    at?: number;
    duration?: number;
    motion?: any;
    keyframes?: any[];
    opacity?: number;
    emptyCanvas?: { at: number; duration: number; intent?: string };
}

export interface EditSummary {
    tree?: PreviewSelectionNode[];
    /** geometry は幾何統一（別票）が入れる出力座標系マーカー。'source' = ソース実寸基準へ移行済み。 */
    output: { width: number; height: number; fps?: number; geometry?: string };
    /** 生 edit.json の version。cuts[].crop の書き戻しは v2 のみ（legacy schema に席が無い）。 */
    editVersion?: number;
    overlays: EditSummaryOverlay[];
    layers: EditSummaryLayer[];
    filters: EditSummaryFilter[];
    cuts: EditSummaryCut[];
    audio?: EditSummaryAudio;
    tracks?: EditSummaryTracks;
    timelineTracks?: EditSummaryTimelineTrack[];
    itemStackZ?: Record<string, number>;
    trackStackZ?: Record<string, number>;
    barrierZ?: number[];
    captionItemTrackIds?: Record<string, string>;
    captionTrackId?: string;
    hasCaptions?: boolean;
    hasInlineCaptions?: boolean;
    videoFx?: EditSummaryVideoFx;
    adjustLutCubeTexts?: Record<string, string>;
    indicators: string[];
}

export interface PreviewModel {
    previewAudioKeepKeys?: Set<string>;
    previewAudioKeepProbes?: Set<string>;
    previewAudioPendingRequests?: PreviewAudioPendingRequest[];
    previewAudioStreams?: Map<string, VideoStreamReference>;
    summary: EditSummary;
    editUri?: URI;
    relatedEditUri?: URI;
    sourceUri?: URI;
    /** ソース id → 実体 URI（v0 は既定 id ひとつ・v1/v2 は sources[] 全件） */
    sourcesById?: Map<string, { uri: URI; proxyUri?: URI }>;
    overlayUris: URI[];
    motionBagUris?: URI[];
    assetUris: URI[];
    assetStreamIds: string[];
    compositeError?: string;
    /** asset URI → この loadPreviewModel 呼び出しで開いた stream URL。差分更新時の URL 引継ぎ用。 */
    assetUrlByUri?: Map<string, string>;
    captionsUri?: URI;
    captions: AnimatedPreviewCaption[];
    captionAnimatorInternal?: InternalEdit;
    excludedCaptionIds?: string[];
    /**
     * まだソースが 1 つも宣言されていない edit.json（新規プロジェクト直後）。
     * `sourceUri` が無いのは「壊れている」からではなく「これから素材を入れる」からなので、
     * エラーではなく空の状態として案内する（refreshPreview 側で分岐）。
     */
    emptyProject?: boolean;
    emphasisWords?: EditSummaryEmphasisWord[];
    session?: {
        muted: boolean;
        captionsVisible: boolean;
        adjustBypassIds: string[];
        hiddenTracks: number[];
        hiddenTracksByScope: { cuts: number[]; layers: number[]; audio: number[] };
        mutedTracksByScope: { cuts: number[]; audio: number[]; layers: number[] };
        allTracksHiddenScopes: string[];
        allTracksMutedScopes: string[];
    };
}

export interface PreviewSetZoomMessage {
    type: 'akari-preview-set-zoom';
    scale?: number; fit?: boolean;
}

export interface PreviewSetRateMessage {
    type: 'akari-preview-set-rate';
    rate: number;
}

export interface PreviewSetPlaybackMessage {
    type: 'akari-preview-set-playback';
    playing: boolean;
}

export interface PreviewSetCropModeMessage {
    type: 'akari-preview-set-crop-mode';
    itemId?: string; on?: boolean;
}

export interface PreviewSetPerspectivePanelMessage {
    type: 'akari-preview-set-perspective-panel';
    itemId?: string; on?: boolean;
}

export interface PreviewPulseItemMessage {
    type: 'akari-preview-pulse-item';
    itemId: string;
}

export interface PreviewZoneHintMessage {
    type: 'akari-preview-zone-hint';
    zones: string[]; durationMs: number;
}

export interface OverlayWriteRequest {
    type: 'akari-preview-overlay-write';
    requestId: string;
    playheadSeconds?: number;
    overlayId: string;
    patch: {
        vars?: Record<string, unknown>;
        transform?: OverlayTransform;
        duplicate?: boolean;
        // 断片テキスト編集（contenteditable）の書き戻し。overlays[].html は契約上ファイル参照
        // なので、この値は edit.json ではなく参照先の断片ファイルへ書く
        html?: string;
        // 部品の文字は共有 HTML を変更せず、v2 source.text へ書き戻す。
        text?: string;
        // data-akari-slot の編集は共有テンプレを変更せず、v2 source.params へ書き戻す。
        params?: Record<string, string>;
        xyKeyframes?: Array<{ t: number; transform: { x: number; y: number } }>;
    };
}

export interface OverlayWriteBatchRequest {
    type: 'akari-preview-overlay-write-batch';
    requestId: string;
    playheadSeconds?: number;
    writes: Array<Pick<OverlayWriteRequest, 'overlayId' | 'patch'>>;
}

export interface MixedMoveRequest {
    type: 'akari-preview-mixed-move';
    requestId: string;
    writes: PreviewItemWriteCommand[];
    cuePositions: Array<{ captionId: string; value: CaptionCuePosition }>;
}

// ㉔ layers[].crop（0..1 正規化・ソースフレーム相対・静的。#/$defs/layerCrop）。
export interface LayerCropPatch {
    x: number;
    y: number;
    w: number;
    h: number;
    rotate?: number;
}

// ㉖ layers[].perspective（corner-pin パース変形。v0 静的。#/$defs/layerPerspective）。
export interface LayerPerspectivePatch {
    corners: [number, number][];
}

// CF-write: overlayWrite と同型の layers[] 版。追加/削除は CF-dnd（別レーン）の範囲のため対象外、
// transform/crop/perspective 変更のみ扱う（t/duration 変更は既存の timeline moveLayer 経路で
// 既に書き戻る）。perspective: null は「解除」（layer.perspective を削除）を表す。
export interface LayerWriteRequest {
    type: 'akari-preview-layer-write';
    requestId: string;
    playheadSeconds?: number;
    layerId: string;
    patch: {
        transform?: OverlayTransform;
        crop?: LayerCropPatch;
        perspective?: LayerPerspectivePatch | null;
        xyKeyframes?: Array<{ t: number; transform: { x: number; y: number } }>;
    };
}

// CF-write: layerWrite と同型の cuts[] 版（akari-preview-open-handler.ts:2780 layerWrite に倣う。
// ㉓ 本編ビデオのクリック選択+transform）。追加/削除・in/out はタイムライン側の既存経路の
// 対象のため扱わない。transform と（辺バークロップの）crop のみ。crop は cuts[] の
// layer-style 経路（ソース実寸基準）へ入るので、書けるのは edit.json version 2 だけ。
export interface CutWriteRequest {
    type: 'akari-preview-cut-write';
    requestId: string;
    playheadSeconds?: number;
    cutIndex: number;
    cutId?: string;
    patch: {
        transform?: OverlayTransform;
        crop?: LayerCropPatch;
    };
}

export type CaptionZoneValue = typeof CAPTION_ZONES[number];

export interface CaptionWriteRequest {
    type: 'akari-preview-caption-write';
    requestId: string;
    captionId: string;
    patch: { zone: CaptionZoneValue }
        | { text: string }
        | { duplicate: CaptionCuePosition }
        | { run: CaptionRunEdit }
        | { groupZone: CaptionZoneValue }
        | { groupPosition: CaptionCuePosition }
        | { cuePosition: CaptionCuePosition }
        | { cuePositions: { captionId: string; value: CaptionCuePosition }[] }
        | {
            plateTransform: {
                captionIds: string[];
                scale?: number;
                rotate?: number;
                wrapWidthPct?: number;
                backgroundPaddingPx?: 0;
                cuePosition?: {
                    captionId: string;
                    value: CaptionCuePosition;
                };
            };
        }
        | { cuePositionReset: true }
        | { cueGeometryReset: { captionIds: string[] } }
        | { toolStyle: { captionIds: string[]; change: CaptionToolStylePatch } };
}

export interface PreviewCaptionSelectedRequest {
    type: 'akari-preview-caption-selected';
    captionId: string | null;
}

// task/2026-08-09-drop-hevc-proxy: <video> の error イベントが MEDIA_ERR_DECODE(3) /
// MEDIA_ERR_SRC_NOT_SUPPORTED(4) のときだけ webview から届く（実際に再生できなかった、の一報）。
export interface HevcFallbackRequest {
    type: 'akari-preview-hevc-fallback-request';
    requestId: string;
    errorCode: number;
    /** Omitted by the primary/raw video for backward compatibility; set by layers and v2 items. */
    videoUri?: string;
}

export interface OpenOutputRequest {
    type: 'akari-preview-open-output-request';
}

export interface PreviewReviewStrokeStartRequest {
    type: 'akari-preview-review-stroke-start';
    frame: ReviewStrokeFrame;
}

export interface PreviewReviewStrokeEndRequest {
    type: 'akari-preview-review-stroke-end';
    points: Array<[number, number]>;
}

// task.md 指示4/6 (M2): rect ツールの開始/終了 (pen の start/end request と対をなす) と、
// pen-toggle からの mode 切替 request (右パネルのボタン/ショートカットと同じ setToolMode 経路)。
export interface PreviewReviewRectStartRequest {
    type: 'akari-preview-review-rect-start';
    frame: ReviewStrokeFrame;
}

export interface PreviewReviewRectEndRequest {
    type: 'akari-preview-review-rect-end';
    box: [number, number, number, number];
}

export interface PreviewReviewToolModeRequest {
    type: 'akari-preview-review-tool-mode-request';
    mode: ReviewToolMode;
}

export interface ReviewAnnotationStrokeRequest {
    editUri: string;
    sourceT: number;
    strokes: Array<{
        points: Array<[number, number]>;
        frame?: { sourceT?: number; cutIndex?: number | null };
    }>;
}

export interface RawPreviewAudioState {
    pageId: string;
    timer?: ReturnType<typeof setTimeout>;
    url?: string;
}

export interface PreviewWidgetMarker extends WebviewWidget {
    akariLibraryDrop?: PreviewLibraryDrop;
    akariPreviewFrameCaptureRequest?: string;
    akariPreviewAudioKeepKeys?: Set<string>;
    akariPreviewAudioKeepProbes?: Set<string>;
    akariPreviewAudioProjectRootUri?: string;
    akariPreviewAudioPendingRequests?: PreviewAudioPendingRequest[];
    akariPreviewAudioPollTimer?: ReturnType<typeof setTimeout>;
    akariPreviewAudioPollGeneration?: object;
    akariPreviewAudioSweepTimer?: ReturnType<typeof setTimeout>;
    akariPreviewAudioDisposeConnected?: boolean;
    akariPreviewConfigured?: boolean;
    akariPreviewConfiguration?: Promise<void>;
    akariPreviewRefresh?: Promise<void>;
    akariPreviewQueuedEditSource?: string;
    akariPreviewPlaybackPageId?: string;
    akariSwapReloading?: boolean;
    akariPreviewCaptionsUpdate?: Promise<void>;
    akariPreviewGenerationUpdate?: Promise<void>;
    akariPreviewModelSnapshot?: PreviewModelDiffInput;
    akariPreviewAssetUrlByUri?: Map<string, string>;
    akariPreviewEditUri?: URI;
    akariPreviewRelatedEditUri?: URI;
    akariPreviewVideoUri?: URI;
    /** Original source URIs the generated webview is allowed to request a fallback for. */
    akariPreviewFallbackSourceUris?: Set<string>;
    akariPreviewCaptionsUri?: URI;
    akariPreviewExcludedCaptionIds?: Set<string>;
    akariPreviewCaptionAnimatorInternal?: InternalEdit;
    akariPreviewTrackedResources?: Set<string>;
    akariPreviewTrackedSuffixes?: Set<string>;
    akariPreviewMotionBagResources?: Set<string>;
    akariPreviewMotionBagSuffixes?: Set<string>;
    akariPreviewStreamId?: string;
    /** v1 マルチソースで代表ソース以外に開いた動画ストリーム id（代表は akariPreviewStreamId） */
    akariPreviewExtraStreamIds?: string[];
    akariPreviewAssetStreamIds?: string[];
    akariPreviewAssetStreamIdByUri?: Map<string, string>;
    akariPreviewRawAudio?: RawPreviewAudioState;
    akariPreviewSummary?: EditSummary;
    akariPreviewSeekable?: boolean;
    akariPreviewMuted?: boolean;
    akariPreviewCaptionsVisible?: boolean;
    /** A/B 比較（contract-2026-09-05 D15）のバイパス対象 item。setHTML をまたいで保持する。 */
    akariPreviewAdjustBypassIds?: Set<string>;
    akariPreviewHiddenTracks?: Set<number>;
    akariPreviewHiddenTracksByScope?: { cuts?: number[]; layers?: number[]; audio?: number[] };
    akariPreviewMutedTracksByScope?: { cuts?: number[]; audio?: number[]; layers?: number[] };
    akariPreviewAllTracksMutedScopes?: string[];
    akariPreviewAllTracksHiddenScopes?: string[];
    /** forwardPlaybackTick が常時更新する直近再生位置。HEVC フォールバックのリロード時の
     *  再生位置復元に使う（raw kind は reviewTransportByEdit に乗らないため別経路が要る）。 */
    akariPreviewLastKnownTime?: number;
    akariPreviewLastKnownPlaying?: boolean;
    /** この widget が生きている間だけ保持するプレビュー再生速度。 */
    akariPreviewPlaybackRate?: number;
    akariPreviewFrameEngineOptOut?: boolean;
    /** 初期化の段を記録する診断セッション（不具合メモ 第11・12項）。 */
    akariPreviewDiagnostics?: PreviewDiagnosticsSession;
}

export interface TranscriptSeekRequest {
    videoUri?: string;
    time?: number;
    captionId?: string;
}

export interface EnsureVisibleRequest {
    editUri?: string;
}

export interface SeekOutputRequest {
    swapTrialToken?: string;
    seek?: boolean;
    waitForReady?: boolean;
    editUri?: string;
    time?: number;
}

export interface TogglePlaybackRequest {
    editUri?: string;
}

export interface CompactTracksRequest {
    editUri?: string;
}

export interface SetPreviewFullscreenRequest { editUri: string; on?: boolean; }
export interface SetPreviewViewZoomRequest { editUri: string; scale?: number; fit?: boolean; }
export interface SetPreviewPlaybackRateExternalRequest { editUri: string; rate: number; }
export type SetPreviewLoopRangeRequest =
    | { editUri: string; startSeconds: number; endSeconds: number }
    | { editUri: string; clear: true };
export interface PreviewPlaybackControlRequest { editUri: string; trialToken?: string; reason?: 'window_end'; }
export interface PreviewCropModeRequest { editUri: string; itemId?: string; on?: boolean; }
export interface PreviewPerspectivePanelRequest { editUri: string; itemId?: string; on?: boolean; }
export interface PulsePreviewItemRequest { editUri: string; itemId: string; }
export interface ShowPreviewZoneHintRequest { editUri: string; zones: string[]; durationMs?: number; }

export interface PreviewPlaybackTickRequest {
    type: 'akari-preview-playback-tick';
    pageId?: string;
    positionReady?: boolean;
    trialToken?: string;
    time: number;
    playing: boolean;
    rate?: number;
}

export interface PreviewPlaybackRateRequest {
    type: 'akari-preview-playback-rate';
    rate: number;
}

export interface PreviewOverlaySelectedRequest {
    type: 'akari-preview-overlay-selected';
    overlayId: string | null;
    overlayIds?: string[];
    scopeId?: string | null;
}

// CF-select: overlay 選択同期チャンネルの layers 版。
export interface PreviewLayerSelectedRequest {
    type: 'akari-preview-layer-selected';
    layerId: string | null;
}

// ㉓ overlay/layer 選択同期チャンネルの cut 版。安定 ID で inspector の同じ項目へ同期する。
export interface PreviewCutSelectedRequest {
    type: 'akari-preview-cut-selected';
    cutId: string | null;
}

export interface PreviewReviewTransportRequest {
    type: 'akari-preview-review-transport-event';
    event: ReviewTransportChange;
}

export interface ReviewSessionControlRequest {
    projectRootUri?: string;
    editUri?: string;
}

export interface ReviewSessionViewerSyncDetail {
    phase: 'attach' | 'tick' | 'detach';
    projectRootUri: string;
    editUri: string;
    sessionId: string;
    recT?: number;
    timelineT?: number;
}

// task.md 指示2/6: 右パネルのツールボタン列/ショートカットからの mode 切替 request
// （REVIEW_TOOL_MODE_SET_EVENT。akari-review-panel-widget.ts 側と文字列だけミラー）。
export interface ReviewToolModeSetRequest extends ReviewSessionControlRequest {
    mode?: ReviewToolMode;
}

export interface PreviewSessionSettings {
    selectionFloor?: string | null;
    muted: boolean;
    captionsVisible: boolean;
    hiddenTracks: Set<number>;
    hiddenTracksByScope: { cuts: Set<number>; layers: Set<number>; audio: Set<number> };
    mutedTracksByScope: { cuts: Set<number>; audio: Set<number>; layers: Set<number> };
    allTracksHiddenByScope: { cuts: boolean; layers: boolean; audio: boolean };
    allTracksMutedByScope: { cuts: boolean; audio: boolean; layers: boolean };
}

export interface TrackVisibilityV2Request {
    videoUri?: string;
    scope?: 'cuts' | 'overlays' | 'layers' | 'audio' | 'captions';
    track?: number | null;
    hidden?: boolean;
    muted?: boolean;
}
