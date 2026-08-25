import URI from '@theia/core/lib/common/uri';
import { Command, CommandRegistry, MessageService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import {
    ApplicationShell,
    FrontendApplicationContribution,
    OpenHandler,
    OpenerService,
    WidgetManager,
    open
} from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangesEvent, FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    buildTimelineMap,
    projectLegacyAudioView,
    resolveInternalTrackZ,
    resolvePreviewItemWrite,
    TRANSITION_VOCABULARY,
    TimelineSegment
} from '@akari-video/edit-store';
import type { EditV2 } from '@akari-video/edit-store';
import type { ReadableTransitionType } from '@akari-video/edit-store';
import {
    AkariPreviewService,
    OverlayRuntimeAssets,
    RasterizeTelopPreviewRequest,
    ReviewStrokeFrame
} from '../common/akari-preview-protocol';
import {
    bgmLoopOffsetSeconds,
    resolveBgmSourceOffset,
    resolveSfxTrimWindow,
    resolveTimedScheduleWindow,
    sfxFadeGainSchedule
} from '../common/audio-schedule';
import { classifyEditAssetPath, uncToFileUriString, windowsDriveToFileUriString } from '../common/edit-asset-path';
import { resolvePreviewCaptionTrackOrder } from '../common/caption-track-order';
import { persistCaptionText, persistCaptionZone } from '../common/caption-zone-write';
import { collectItems, hasInlineCaptions, readPreviewInternalEdit } from '../common/preview-items';
import {
    CAPTION_FONT_FAMILY,
    CAPTION_FONT_LOAD_DESCRIPTOR,
    captionFontFaceCss,
    RESOLVED_CAPTION_STYLE_VARIABLE_NAMES,
    RESOLVED_SINGLE_LINE_CAPTION_CSS,
    RESOLVED_SINGLE_LINE_FRAGMENT_CLOSE,
    RESOLVED_SINGLE_LINE_FRAGMENT_MIDDLE,
    RESOLVED_SINGLE_LINE_FRAGMENT_OPEN
} from '../common/caption-visual-contract';
import { CutFraming, computeCutFramingVisual } from '../common/cut-framing-visual';
import { CutFreeze, checkCutFreezeCrossing } from '../common/cut-freeze-visual';
import { computeLayerPerspectiveVisual } from '../common/layer-perspective-visual';
import { resolveDeferredTelopPlayback } from '../common/deferred-telop-playback';
import { computeTransitionVisual } from '../common/transition-visual';
import { cropAnchorCorrectedTransform } from '../common/layer-crop-anchor';
import { resolveLayerHitRegionClip } from '../common/layer-hit-region';
import { computeLayerKeyframesVisual } from '../common/layer-keyframes-visual';
import { layerResizeCornerPoint } from '../common/layer-resize-anchor';
import {
    buildCutSummaryFields,
    buildLayerSummaryBase,
    ChromaKeySummary,
    LayerCropSummary,
    LayerKeyframesSummary,
    LayerPerspectiveSummary,
    normalizeChromaKeyForSummary
} from '../common/edit-summary-fields';
import { normalizePersistentStrokeItems, PEN_TUNING } from '../common/pen-canvas-visuals';
import { fitPreviewCompositeRect } from '../common/preview-composite-layout';
import { outputTimeForSourceClock, resolveSourceClockPosition } from '../common/preview-playback-clock';
import { classifyPreviewModelUpdate } from '../common/preview-model-diff';
import type { PreviewModelDiffInput } from '../common/preview-model-diff';
import { resolvePreferredVideoUri } from '../common/video-proxy-resolution';
import { createRafThrottle } from '../common/raf-throttle';
import { normalizeRectFromPoints } from '../common/rect-tool-visual';
import {
    readCaptionsEmphasisWords,
    readLegacyEditEmphasisWords,
    resolvePreviewEmphasisWords
} from '../common/preview-emphasis-seat';
import {
    compactVisualTracks,
    trackCompactionProposalAfterMigration
} from '../common/track-compact';
import { editReferencesRawMedia } from '../common/related-edit-source';
import { resolveAnnotationStrokeCompositionSeconds } from '../common/review-stroke-seek';
import {
    resolveReviewPreviewEditUri,
    transitionRawPreviewFocus
} from '../common/review-preview-state';
import {
    isEditableEventTarget,
    ReviewToolMode,
    shouldStopEditableDeletionKeydown
} from '../common/review-tool-mode';
import { locatePreviewCaptions, parsePreviewCaptions, parseResolvedPreviewCaptions, PreviewCaption } from './akari-preview-captions';
import { resolveOutputOpenFocusMode } from './open-focus-mode';
import {
    ReviewSessionRecorder,
    ReviewSessionUiState,
    ReviewTransportChange,
    ReviewTransportSnapshot
} from './review-session-recorder';
import { ReviewSessionRecordingIndicator } from './review-session-recording-indicator';

export interface OverlayTransform {
    x?: number;
    y?: number;
    scale?: number;
    rotate?: number;
}

interface EditSummaryOverlay {
    id: string;
    html: string;
    start: number;
    duration: number;
    track: number;
    trackId: string;
    transform: OverlayTransform;
    vars: Record<string, string>;
    params: Record<string, string>;
}

interface EditSummaryLayer {
    id: string;
    t: number;
    duration: number;
    kind: 'baked' | 'video';
    src?: string;
    /** Original file URI used only to target a decode-failure fallback request. */
    sourceUri?: string;
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
    track: number;
    trackId: string;
    /** edit.schema.json #/$defs/layerCrop（0..1 正規化・ソースフレーム相対・静的）。
     * common/edit-summary-fields.ts の normalizeLayerCropForSummary が担う。 */
    crop?: LayerCropSummary;
    /** edit.schema.json #/$defs/layerPerspective（corner-pin パース変形・v0 静的）。
     * common/edit-summary-fields.ts の normalizeLayerPerspectiveForSummary が担う。 */
    perspective?: LayerPerspectiveSummary;
    keyframes?: LayerKeyframesSummary;
}

interface EditSummaryFilter {
    id: string;
    t: number;
    duration: number;
    trackId: string;
    track: number;
    filter: { type?: string; value?: number; id?: string };
}

// task 2026-08-10-image-layer-parity 司令塔裁定1: layers[].src の拡張子だけで静止画判定する
// （schema の kind は 'video' のまま不変）。render-cut 側の同じ判定
// （packages/render-cut/src/layers.mjs の isImageLayerSource）と対象拡張子集合を完全に揃える。
// 独立した関数として export しているのは webview 生成 HTML の外（この TS モジュール自身）から
// node --test で直接叩けるようにするため（test/image-layer-source.test.mjs）。
const IMAGE_LAYER_SRC_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/i;
export const isImageLayerSrc = (src: string | undefined): boolean =>
    typeof src === 'string' && IMAGE_LAYER_SRC_PATTERN.test(src);
const PREVIEW_COLOR_KEYWORDS = new Set([
    'black', 'white', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta', 'gray', 'grey',
    'orange', 'purple', 'pink', 'brown'
]);
const isPreviewColorLike = (value: string): boolean =>
    value.startsWith('#') || /^0x/iu.test(value) || PREVIEW_COLOR_KEYWORDS.has(value.toLowerCase());

type PreviewCaptionClockDomain = 'source' | 'output' | 'legacy';

interface PreviewCaptionClockInput extends PreviewCaption {
    /** 読込層だけが扱う時刻 domain。webview へ渡す前に必ず output へ正規化する。 */
    clockDomain: PreviewCaptionClockDomain;
    /** 複数 source の source-domain cue を該当 cut だけへ射影するための任意 source id。 */
    clockSourceId?: string;
}

interface OutputPreviewCaption extends PreviewCaptionClockInput {
    clockDomain: 'output';
}

interface LoadedPreviewCaptions {
    captions: PreviewCaptionClockInput[];
    emphasisWords?: unknown;
}

/**
 * 字幕時計の preview-extension 内部契約。
 *
 * - captions.schema で time_domain を明示した cue は source/output をそのまま使う。
 * - 未宣言の legacy cue は、宣言区間全体が明示 gap に収まる場合だけ output と確定し、
 *   それ以外は後方互換の source として cut map で output へ射影する。
 * - 戻り値は全件 clockDomain='output'。render 層は domain 判定を一切行わない。
 */
export const normalizePreviewCaptionClock = (
    captions: readonly PreviewCaptionClockInput[],
    segments: readonly TimelineSegment[]
): OutputPreviewCaption[] => {
    const epsilon = 0.000001;
    const output: OutputPreviewCaption[] = [];
    for (const caption of captions) {
        const legacyOutputCue = caption.clockDomain === 'legacy' && segments.some(segment =>
            segment.kind === 'gap'
            && caption.start >= segment.outStart - epsilon
            && caption.end <= segment.outEnd + epsilon
        );
        const domain = caption.clockDomain === 'legacy'
            ? (legacyOutputCue ? 'output' : 'source')
            : caption.clockDomain;
        if (domain === 'output' || segments.length === 0) {
            output.push({ ...caption, clockDomain: 'output' });
            continue;
        }
        let occurrence = 0;
        for (const segment of segments) {
            if (segment.kind !== 'src' || segment.in === undefined || segment.out === undefined) continue;
            if (caption.clockSourceId !== undefined && segment.src !== caption.clockSourceId) continue;
            const sourceStart = Math.max(caption.start, segment.in);
            const sourceEnd = Math.min(caption.end, segment.out);
            if (!(sourceEnd - sourceStart > epsilon)) continue;
            const speed = typeof segment.speed === 'number' && segment.speed > 0 ? segment.speed : 1;
            const projectTime = (sourceTime: number): number =>
                segment.outStart + (sourceTime - (segment.in ?? 0)) / speed;
            occurrence += 1;
            const sourceCueId = caption.sourceCueId ?? caption.id;
            const words = caption.words?.flatMap(word => {
                const wordStart = Math.max(word.start, sourceStart);
                const wordEnd = Math.min(word.end, sourceEnd);
                return wordEnd - wordStart > epsilon
                    ? [{ ...word, start: projectTime(wordStart), end: projectTime(wordEnd) }]
                    : [];
            });
            output.push({
                ...caption,
                ...(caption.id ? { id: `${caption.id}-output-${occurrence}` } : {}),
                ...(sourceCueId ? { sourceCueId } : {}),
                start: projectTime(sourceStart),
                end: projectTime(sourceEnd),
                ...(words && words.length > 0 ? { words } : { words: undefined }),
                clockDomain: 'output'
            });
        }
    }
    return output.sort((left, right) => left.start - right.start || left.end - right.end);
};
// caption-clock-normalizer:end

interface EditSummaryCut {
    /** v2 tracks[].items[].id（legacy でも内部表現が付けた安定 id）。 */
    id: string;
    /** 参照するソース id（v1 cuts[].src。v0 は既定 id）。webview はこれで <video> を切り替える */
    src: string;
    in: number;
    out: number;
    transform?: OverlayTransform;
    opacity?: number;
    /** render-cut の cut layer-style 経路と同じ source-frame-relative visual。 */
    crop?: LayerCropSummary;
    perspective?: LayerPerspectiveSummary;
    keyframes?: LayerKeyframesSummary;
    speed?: number;
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
}

interface VideoFxBackground {
    type: 'color' | 'image';
    color?: string;
    url?: string;
}

interface VideoFxChromaKey {
    color: string;
    similarity: number;
    blend: number;
    mode: 'source' | 'layer';
    background?: VideoFxBackground;
}

interface EditSummaryVideoFx {
    look?: { cubeText: string; intensity: number };
    sources: Record<string, VideoFxChromaKey>;
}

interface EditSummaryAudioSource {
    src: string;
    gainDb: number;
}

interface EditSummaryBgm extends EditSummaryAudioSource {
    ducking: boolean;
    fadeIn?: number;
    fadeOut?: number;
    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: file-internal start offset (素材秒).
    in?: number;
}

interface EditSummaryTimedAudio extends EditSummaryAudioSource {
    id: string;
    t: number;
    track?: number;
    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 (sfx only; narration is unaffected):
    // playback window = material's [in, out). Omitted in/out are resolved against the decoded
    // buffer's real duration in the injected preview script (createPreviewAudio's decodeOne).
    in?: number;
    out?: number;
    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum (audio-clip-fades,
    // 2026-08-18; sfx only). edit.json spells these audio.sfx[].fade_in/fade_out (snake_case,
    // distinct from bgm's camelCase fadeIn/fadeOut) -- normalized to camelCase here to match this
    // file's own TS field-naming convention for every other JSON-sourced audio field.
    fadeIn?: number;
    fadeOut?: number;
}

interface EditSummaryAudio {
    bgm?: EditSummaryBgm;
    sfx: EditSummaryTimedAudio[];
    narration: EditSummaryTimedAudio[];
}

interface EditSummaryEmphasisWord {
    id: string;
    src?: string;
    t_start: number;
    t_end: number;
    word: string;
    emotion: string;
    style_hint?: string;
}

interface EditSummaryTrackState {
    muted?: boolean;
    hidden?: boolean;
}

interface EditSummaryTracks {
    cuts?: EditSummaryTrackState[];
    layers?: EditSummaryTrackState[];
    audio?: EditSummaryTrackState[];
}

interface EditSummaryTimelineTrack {
    id: string;
    z: number;
}

interface EditSummary {
    output: { width: number; height: number; fps?: number };
    overlays: EditSummaryOverlay[];
    layers: EditSummaryLayer[];
    filters: EditSummaryFilter[];
    cuts: EditSummaryCut[];
    audio?: EditSummaryAudio;
    tracks?: EditSummaryTracks;
    timelineTracks?: EditSummaryTimelineTrack[];
    captionTrackId?: string;
    hasCaptions?: boolean;
    hasInlineCaptions?: boolean;
    videoFx?: EditSummaryVideoFx;
    indicators: string[];
}

interface PreviewModel {
    summary: EditSummary;
    editUri?: URI;
    relatedEditUri?: URI;
    sourceUri?: URI;
    /** ソース id → 実体 URI（v0 は既定 id ひとつ・v1/v2 は sources[] 全件） */
    sourcesById?: Map<string, { uri: URI; proxyUri?: URI }>;
    overlayUris: URI[];
    assetUris: URI[];
    assetStreamIds: string[];
    deferredTelops?: DeferredTelopPreview[];
    /** asset URI → この loadPreviewModel 呼び出しで開いた stream URL。差分更新時の URL 引継ぎ用。 */
    assetUrlByUri?: Map<string, string>;
    captionsUri?: URI;
    captions: PreviewCaption[];
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
        hiddenTracks: number[];
        hiddenTracksByScope: { cuts: number[]; layers: number[]; audio: number[] };
        mutedTracksByScope: { cuts: number[]; audio: number[]; layers: number[] };
        allTracksHiddenScopes: string[];
        allTracksMutedScopes: string[];
    };
}

interface DeferredTelopPreview {
    key: string;
    layerId: string;
    request: RasterizeTelopPreviewRequest;
}

interface OverlayWriteRequest {
    type: 'akari-preview-overlay-write';
    requestId: string;
    overlayId: string;
    patch: {
        vars?: Record<string, unknown>;
        transform?: OverlayTransform;
        // 断片テキスト編集（contenteditable）の書き戻し。overlays[].html は契約上ファイル参照
        // なので、この値は edit.json ではなく参照先の断片ファイルへ書く
        html?: string;
        // data-akari-slot の編集は共有テンプレを変更せず、v2 source.params へ書き戻す。
        params?: Record<string, string>;
    };
}

// ㉔ layers[].crop（0..1 正規化・ソースフレーム相対・静的。#/$defs/layerCrop）。
interface LayerCropPatch {
    x: number;
    y: number;
    w: number;
    h: number;
}

// ㉖ layers[].perspective（corner-pin パース変形。v0 静的。#/$defs/layerPerspective）。
interface LayerPerspectivePatch {
    corners: [number, number][];
}

// CF-write: overlayWrite と同型の layers[] 版。追加/削除は CF-dnd（別レーン）の範囲のため対象外、
// transform/crop/perspective 変更のみ扱う（t/duration 変更は既存の timeline moveLayer 経路で
// 既に書き戻る）。perspective: null は「解除」（layer.perspective を削除）を表す。
interface LayerWriteRequest {
    type: 'akari-preview-layer-write';
    requestId: string;
    layerId: string;
    patch: {
        transform?: OverlayTransform;
        crop?: LayerCropPatch;
        perspective?: LayerPerspectivePatch | null;
    };
}

// CF-write: layerWrite と同型の cuts[] 版（akari-preview-open-handler.ts:2780 layerWrite に倣う。
// ㉓ 本編ビデオのクリック選択+transform）。追加/削除・in/out はタイムライン側の既存経路の
// 対象のため扱わない。transform のみ。
interface CutWriteRequest {
    type: 'akari-preview-cut-write';
    requestId: string;
    cutIndex: number;
    cutId?: string;
    patch: {
        transform?: OverlayTransform;
    };
}

// ㉓ 字幕クリック選択+移動（v0 スコープ = 選択 + 位置移動の最小）。captions.json は
// zone が固定 9 値の enum（3x3 配置ゾーン、schemas/captions.schema.json）で自由座標が
// 無いため、書き戻しは「ドラッグ位置→最近傍 zone への吸着」で表現する（schema 追加なし。
// zone 語彙で表現できない自由配置が必要になった場合は実装せず report へ設計提案を書く
// 契約 §のとおり）。
const CAPTION_ZONES = [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
] as const;
type CaptionZoneValue = typeof CAPTION_ZONES[number];

interface CaptionWriteRequest {
    type: 'akari-preview-caption-write';
    requestId: string;
    captionId: string;
    patch: { zone: CaptionZoneValue; text?: never } | { text: string; zone?: never };
}

interface PreviewCaptionSelectedRequest {
    type: 'akari-preview-caption-selected';
    captionId: string | null;
}

interface WaveformFetchRequest {
    type: 'akari-preview-waveform-fetch';
    requestId: string;
}

// task/2026-08-09-drop-hevc-proxy: <video> の error イベントが MEDIA_ERR_DECODE(3) /
// MEDIA_ERR_SRC_NOT_SUPPORTED(4) のときだけ webview から届く（実際に再生できなかった、の一報）。
interface HevcFallbackRequest {
    type: 'akari-preview-hevc-fallback-request';
    requestId: string;
    errorCode: number;
    /** Omitted by the primary/raw video for backward compatibility; set by layers and v2 items. */
    videoUri?: string;
}

interface OpenOutputRequest {
    type: 'akari-preview-open-output-request';
}

interface PreviewReviewStrokeStartRequest {
    type: 'akari-preview-review-stroke-start';
    frame: ReviewStrokeFrame;
}

interface PreviewReviewStrokeEndRequest {
    type: 'akari-preview-review-stroke-end';
    points: Array<[number, number]>;
}

// task.md 指示4/6 (M2): rect ツールの開始/終了 (pen の start/end request と対をなす) と、
// pen-toggle からの mode 切替 request (右パネルのボタン/ショートカットと同じ setToolMode 経路)。
interface PreviewReviewRectStartRequest {
    type: 'akari-preview-review-rect-start';
    frame: ReviewStrokeFrame;
}

interface PreviewReviewRectEndRequest {
    type: 'akari-preview-review-rect-end';
    box: [number, number, number, number];
}

interface PreviewReviewToolModeRequest {
    type: 'akari-preview-review-tool-mode-request';
    mode: ReviewToolMode;
}

interface ReviewAnnotationStrokeRequest {
    editUri: string;
    sourceT: number;
    strokes: Array<{
        points: Array<[number, number]>;
        frame?: { sourceT?: number; cutIndex?: number | null };
    }>;
}

interface PreviewWidgetMarker extends WebviewWidget {
    akariPreviewConfigured?: boolean;
    akariPreviewConfiguration?: Promise<void>;
    akariPreviewRefresh?: Promise<void>;
    akariPreviewCaptionsUpdate?: Promise<void>;
    akariPreviewModelSnapshot?: PreviewModelDiffInput;
    akariPreviewAssetUrlByUri?: Map<string, string>;
    akariPreviewEditUri?: URI;
    akariPreviewRelatedEditUri?: URI;
    akariPreviewVideoUri?: URI;
    /** Original source URIs the generated webview is allowed to request a fallback for. */
    akariPreviewFallbackSourceUris?: Set<string>;
    akariPreviewCaptionsUri?: URI;
    akariPreviewTrackedResources?: Set<string>;
    akariPreviewTrackedSuffixes?: Set<string>;
    akariPreviewStreamId?: string;
    /** v1 マルチソースで代表ソース以外に開いた動画ストリーム id（代表は akariPreviewStreamId） */
    akariPreviewExtraStreamIds?: string[];
    akariPreviewAssetStreamIds?: string[];
    akariPreviewSummary?: EditSummary;
    akariPreviewDeferredTelopPending?: Set<string>;
    akariPreviewDeferredTelopExpected?: Map<string, string>;
    akariPreviewDeferredTelopReady?: Map<string, { key: string; stream: { id: string; url: string } }>;
    akariPreviewSeekable?: boolean;
    akariPreviewMuted?: boolean;
    akariPreviewCaptionsVisible?: boolean;
    akariPreviewHiddenTracks?: Set<number>;
    akariPreviewHiddenTracksByScope?: { cuts?: number[]; layers?: number[]; audio?: number[] };
    akariPreviewMutedTracksByScope?: { cuts?: number[]; audio?: number[]; layers?: number[] };
    akariPreviewAllTracksMutedScopes?: string[];
    akariPreviewAllTracksHiddenScopes?: string[];
    /** forwardPlaybackTick が常時更新する直近再生位置。HEVC フォールバックのリロード時の
     *  再生位置復元に使う（raw kind は reviewTransportByEdit に乗らないため別経路が要る）。 */
    akariPreviewLastKnownTime?: number;
}

// akari-transcript の AKARI_TRANSCRIPT_SEEK_REQUESTED.id（akari-transcript-commands.ts）とミラー。
// cross-package import を避けるため文字列 ID のみで CommandRegistry.registerHandler に後付け登録する。
const TRANSCRIPT_SEEK_COMMAND_ID = 'akari.transcript.seekRequested';
// akari-annotations 側の PREVIEW_PLAYBACK_TICK_EVENT とミラー。
const PREVIEW_PLAYBACK_TICK_EVENT = 'akari.preview.playbackTick';
// raw preview は editUri を持たないため、注釈パネルへ「現在フォーカス中の素材 URI + source 秒」を
// outer window の専用イベントで渡す。録音セッションの transport には合流させない。
const RAW_PREVIEW_ANNOTATION_STATE_EVENT = 'akari.preview.rawAnnotationState';
const TIMELINE_OVERLAY_SELECTED_EVENT = 'akari.timeline.overlaySelected';
// CF-select: overlay 選択同期チャンネルの layers 版（akari-annotations 側と文字列のみミラー）。
const TIMELINE_LAYER_SELECTED_EVENT = 'akari.timeline.layerSelected';
// 書き込み完了の直接通知。edit-store の atomic rename 完了 → akari-annotations backend →
// AkariAnnotationsClientImpl（frontend）が撒く window イベントで、**file watcher より先に**着く。
// akari-preview は akari-annotations を import できない（annotations → preview の一方向依存で
// 逆は循環）ため、他の拡張間チャンネルと同じく文字列のみミラーする。
// **ミラー元は `akari-annotations/src/browser/akari-annotations-client.ts` の
// EDIT_STORE_DID_WRITE_EVENT。片方だけ変えると通知が届かなくなる。**
const EDIT_STORE_DID_WRITE_EVENT = 'akari.editStore.didWrite';
// 直接通知で処理した書き込みを、後から来る watcher イベントで二重に処理しないための窓。
// akari-annotations 側の recentWrites（1 秒窓）と同型。
const RECENT_WRITE_WINDOW_MS = 1000;
const TIMELINE_SET_MUTED_EVENT = 'akari.timeline.setMuted';
const TIMELINE_SET_TRACK_VISIBILITY_EVENT = 'akari.timeline.setTrackVisibility';
const TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT = 'akari.timeline.setCaptionsVisibility';
const TIMELINE_SET_CLIPS_VISIBILITY_EVENT = 'akari.timeline.setClipsVisibility';
const TIMELINE_SET_OVERLAY_TRACK_MUTED_EVENT = 'akari.timeline.setOverlayTrackMuted';
const TIMELINE_SET_LAYERS_VISIBILITY_EVENT = 'akari.timeline.setLayersVisibility';
const TIMELINE_SET_LAYERS_MUTED_EVENT = 'akari.timeline.setLayersMuted';
const TIMELINE_SET_AUDIO_VISIBILITY_EVENT = 'akari.timeline.setAudioVisibility';
const TIMELINE_SET_AUDIO_MUTED_EVENT = 'akari.timeline.setAudioMuted';
const TIMELINE_SET_CAPTIONS_MUTED_EVENT = 'akari.timeline.setCaptionsMuted';
const TIMELINE_SET_BEATS_VISIBILITY_EVENT = 'akari.timeline.setBeatsVisibility';
const TIMELINE_SET_BEATS_MUTED_EVENT = 'akari.timeline.setBeatsMuted';
const TIMELINE_SYNC_TRACK_TOGGLES_EVENT = 'akari.timeline.syncTrackToggles';
// akari-annotations 側の TIMELINE_LIVE_TRANSFORM_EVENT とミラー（文字列のみ、cross-package import なし）。
// インスペクターのスクラブドラッグ中、書き込みなしで cuts/layers の transform/opacity をプレビューへ
// 即時反映する ephemeral イベント。
const TIMELINE_LIVE_TRANSFORM_EVENT = 'akari.timeline.liveTransform';
const PREVIEW_OVERLAY_SELECTED_EVENT = 'akari.preview.overlaySelected';
const PREVIEW_LAYER_SELECTED_EVENT = 'akari.preview.layerSelected';
// forwardOverlaySelection/forwardLayerSelection と同じ拡張間チャンネルの cut 版。
// payload は表示中 cut の安定 ID とし、タイムラインと inspector が同じ項目を引けるようにする。
const PREVIEW_CUT_SELECTED_EVENT = 'akari.preview.cutSelected';
// ㉓ 字幕版。既存 2 チャンネルと同じ配線パターンをここに追加するだけ
// （タイムライン側〔akari-annotations、編集禁止〕の購読は対象外）。
const PREVIEW_CAPTION_SELECTED_EVENT = 'akari.preview.captionSelected';
// akari-annotations の録音セクション側と文字列だけをミラーし、extension 間の npm 依存を作らない。
const REVIEW_SESSION_START_EVENT = 'akari.review.session.start';
const REVIEW_ANNOTATION_SHOW_STROKES_EVENT = 'akari.review.annotation.showStrokes';
const REVIEW_SESSION_STOP_EVENT = 'akari.review.session.stop';
const REVIEW_SESSION_REFRESH_EVENT = 'akari.review.session.refresh';
const REVIEW_SESSION_OPEN_FOLDER_EVENT = 'akari.review.session.openFolder';
const REVIEW_SESSION_STATE_EVENT = 'akari.review.session.state';
// M2 (task.md): 右パネルの選択/ペン/四角ボタンからの mode request。akari-annotations 側と
// 文字列だけミラーする（既存 5 定数と同じ配線パターン）。
const REVIEW_TOOL_MODE_SET_EVENT = 'akari.review.toolMode.set';
// M3 (task.md 指示2): 注釈パネルの「選択を解除」導線からの request。同じミラー配線パターン。
const REVIEW_UI_SELECTION_CLEAR_EVENT = 'akari.review.uiSelection.clear';

// akari-annotations の ATTACH_AKARI_ANNOTATIONS_PASSIVE.id（akari-annotations-commands.ts）とミラー。
// cross-package import を避けるため文字列 ID のみで CommandRegistry.executeCommand に渡す。
const ATTACH_TIMELINE_PASSIVE_COMMAND_ID = 'akari.annotations.attachPassive';

// タイムライン操作時にアウトプットプレビューのタブを前面へ出すための内部コマンド。
// label なし = コマンドパレット非表示（ATTACH_AKARI_ANNOTATIONS_PASSIVE と同じパターン）。
const ENSURE_PREVIEW_VISIBLE_COMMAND: Command = { id: 'akari.preview.ensureVisible' };
const SEEK_OUTPUT_PREVIEW_COMMAND: Command = { id: 'akari.preview.seekOutput' };
const TOGGLE_OUTPUT_PREVIEW_PLAYBACK_COMMAND: Command = { id: 'akari.preview.togglePlayback' };
const COMPACT_TRACKS_COMMAND: Command = { id: 'akari.preview.compactTracks' };
const COMPACT_TRACKS_ACTION = '整理する';
const KEEP_TRACKS_ACTION = '今はしない';
// task/2026-08-09-drop-hevc-proxy: withOpenTimeout はモデル読み込み・createVideoStream・
// setHTML だけを包む（webview 自体の起動・レンダリングは待たない — setHTML が返れば operation は
// 完了扱い）。resolveStreamVideoUri がもう resolveHevcProxy を呼ばなくなった今、この区間に
// メディアのデコードや変換は一切含まれない。実際の変換（handleHevcFallbackRequest 経由）は
// widget が開いた後、webview からの再生失敗通知に応じて別経路で走るため、この定数の対象外。
const PREVIEW_OPEN_TIMEOUT_MS = 10_000;
const PREVIEW_OPEN_ATTEMPTS = 2;
const PREVIEW_OPEN_ERROR_MESSAGE = '動画プレビューを開けませんでした。しばらく待ってから、もう一度お試しください。';

interface TranscriptSeekRequest {
    videoUri?: string;
    time?: number;
    captionId?: string;
}

interface EnsureVisibleRequest {
    editUri?: string;
}

interface SeekOutputRequest {
    editUri?: string;
    time?: number;
}

interface TogglePlaybackRequest {
    editUri?: string;
}

interface CompactTracksRequest {
    editUri?: string;
}

interface PreviewPlaybackTickRequest {
    type: 'akari-preview-playback-tick';
    time: number;
    playing: boolean;
    rate?: number;
}

interface PreviewOverlaySelectedRequest {
    type: 'akari-preview-overlay-selected';
    overlayId: string | null;
}

// CF-select: overlay 選択同期チャンネルの layers 版。
interface PreviewLayerSelectedRequest {
    type: 'akari-preview-layer-selected';
    layerId: string | null;
}

// ㉓ overlay/layer 選択同期チャンネルの cut 版。安定 ID で inspector の同じ項目へ同期する。
interface PreviewCutSelectedRequest {
    type: 'akari-preview-cut-selected';
    cutId: string | null;
}

interface PreviewReviewTransportRequest {
    type: 'akari-preview-review-transport-event';
    event: ReviewTransportChange;
}

interface ReviewSessionControlRequest {
    projectRootUri?: string;
    editUri?: string;
}

// task.md 指示2/6: 右パネルのツールボタン列/ショートカットからの mode 切替 request
// （REVIEW_TOOL_MODE_SET_EVENT。akari-review-panel-widget.ts 側と文字列だけミラー）。
interface ReviewToolModeSetRequest extends ReviewSessionControlRequest {
    mode?: ReviewToolMode;
}

interface PreviewSessionSettings {
    muted: boolean;
    captionsVisible: boolean;
    hiddenTracks: Set<number>;
    hiddenTracksByScope: { cuts: Set<number>; layers: Set<number>; audio: Set<number> };
    mutedTracksByScope: { cuts: Set<number>; audio: Set<number>; layers: Set<number> };
    allTracksHiddenByScope: { cuts: boolean; layers: boolean; audio: boolean };
    allTracksMutedByScope: { cuts: boolean; audio: boolean; layers: boolean };
}

interface TrackVisibilityV2Request {
    videoUri?: string;
    scope?: 'cuts' | 'overlays' | 'layers' | 'audio' | 'captions';
    track?: number | null;
    hidden?: boolean;
    muted?: boolean;
}

const EMPTY_SUMMARY: EditSummary = {
    output: { width: 1280, height: 720, fps: 30 },
    overlays: [],
    layers: [],
    filters: [],
    cuts: [],
    indicators: []
};
// v0（単一 source）を v1 と同じ「id → ソース」表で扱うための既定 id。
// cuts[].src を持たない v0 のカットは全てこの id を指す。

// ドットディレクトリ（.git/.akari/.claude 等）と node_modules は名前探索の対象外。
// スキル同梱の開発用フィクスチャ（.claude/skills/**/dev-fixtures/）を拾わないための除外。
const isSkippedSearchDirectory = (name: string): boolean => name.startsWith('.') || name === 'node_modules';
const PLAYABLE_VIDEO_MIME_TYPES = new Map<string, string>([
    ['.mp4', 'video/mp4'],
    ['.mov', 'video/mp4'],
    ['.m4v', 'video/mp4'],
    ['.webm', 'video/webm']
]);
const UNSUPPORTED_VIDEO_EXTENSIONS = new Set(['.mkv', '.avi', '.mts', '.m2ts', '.wmv']);
const CLAIMED_VIDEO_EXTENSIONS = new Set([
    ...PLAYABLE_VIDEO_MIME_TYPES.keys(),
    ...UNSUPPORTED_VIDEO_EXTENSIONS
]);
const UNSUPPORTED_FORMAT_MESSAGE = 'この形式はアプリ内プレビューに未対応です。書き出し後の MP4 をプレビューできます。';
const OUTSIDE_WORKSPACE_MESSAGE = 'ワークスペース外の動画はプレビューできません。';
// 新規プロジェクトの edit.json は素材が入る前は空（`{}`）。project-scaffold が作成時点で
// 置くようになった（2026-08-08）ため、素材を入れる前に「編集データ」を開くのが通常の順序に
// なった。ソース未宣言は不正ではないので、エラーではなくこの案内を出す。
const EMPTY_PROJECT_MESSAGE = 'まだ動画が入っていません。左の「素材」に動画をドラッグして取り込むと、ここで仕上がりを確認できます。';
const THREE_SCENE_KEYS = new Set([
    'model',
    'camera',
    'lights',
    'animationClip',
    'materialOverrides',
    // environment / shadows がここに無いと宣言ごと拒否され、model パスが空になって
    // preview の読み込みが失敗していた（export は別経路のため影響を受けていなかった）
    'environment',
    'shadows'
]);
const LAYER_BLEND_TO_CSS = new Map<string, string>([
    ['normal', 'normal'],
    ['screen', 'screen'],
    ['multiply', 'multiply'],
    ['add', 'plus-lighter'],
    ['difference', 'difference'],
    ['darken', 'darken'],
    ['lighten', 'lighten'],
    ['overlay', 'overlay'],
    ['hardlight', 'hard-light'],
    ['softlight', 'soft-light']
]);

@injectable()
export class AkariPreviewOpenHandler implements OpenHandler, FrontendApplicationContribution {
    readonly id = 'akari-preview-open-handler';
    // 「最近この URI へ書いた」台帳。URI 文字列キーと resourceSuffix キーの両方を入れる
    // （ワークスペース watcher は realpath 済みの URI で通知してくるため、シンボリックリンクを
    // 跨ぐワークスペースでは URI 文字列が食い違う。suffix なら一致する）。
    protected readonly recentWrites = new Map<string, number>();
    protected readonly openPreviews = new Map<string, PreviewWidgetMarker>();
    protected readonly openOutputPreviews = new Map<string, PreviewWidgetMarker>();
    protected readonly previewSessionSettings = new Map<string, PreviewSessionSettings>();
    protected readonly pendingOutputInitialSeek = new Map<string, number>();
    protected readonly reviewTransportByEdit = new Map<string, ReviewTransportSnapshot>();
    protected readonly lastRawEditVersionByUri = new Map<string, 0 | 1 | 2>();
    protected readonly migrationCompactionPrompted = new Set<string>();
    // task/2026-08-09-drop-hevc-proxy: 実際に再生失敗した動画（videoUri.toString() をキー）だけを
    // 憶えておくフォールバック台帳。既定経路（resolveStreamVideoUri）はここに載っている場合だけ
    // プロキシを使う。新規生成のトリガーは handleHevcFallbackRequest のみ（このプロセスの生存中は
    // 一度成功/失敗した判定を使い回す — アプリ再起動でクリアされる程度の弱いキャッシュで十分）。
    protected readonly hevcFallbackProxyUris = new Map<string, string>();
    protected readonly hevcFallbackAttempted = new Set<string>();
    protected overlayWriteTail = Promise.resolve();
    protected layerWriteTail = Promise.resolve();
    protected cutWriteTail = Promise.resolve();
    protected captionWriteTail = Promise.resolve();
    protected readonly lifecycleDisposables = new DisposableCollection();
    /** バックエンドでプロセス寿命中不変の約 13MB ランタイム資産を、frontend でも RPC 1 回に畳む。 */
    protected overlayRuntimeAssetsPromise: Promise<OverlayRuntimeAssets> | undefined;
    protected reviewSessionRecorder: ReviewSessionRecorder | undefined;
    protected reviewSessionRecordingIndicator: ReviewSessionRecordingIndicator | undefined;
    protected readonly reviewSessionStateByEdit = new Map<string, ReviewSessionUiState>();
    protected readonly reviewStrokeVisibilityByEdit = new Map<string, boolean>();
    protected retryWidgetSequence = 0;
    protected activeRawPreviewWidget: PreviewWidgetMarker | undefined;
    protected rawPreviewActivation = 0;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(AkariPreviewService)
    protected readonly previewService: AkariPreviewService;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    onStart(): void {
        this.reviewSessionRecordingIndicator = new ReviewSessionRecordingIndicator();
        this.reviewSessionRecorder = new ReviewSessionRecorder(
            this.previewService,
            state => {
                this.forwardReviewSessionState(state);
                queueMicrotask(() => this.syncReviewStrokeControls(state));
            }
        );
        this.widgetManager.onDidCreateWidget(event => {
            if (event.factoryId !== WebviewWidget.FACTORY_ID || !(event.widget instanceof WebviewWidget)) {
                return;
            }
            const { id, viewId } = event.widget.identifier;
            const kind = id.startsWith('akari-output-preview-') ? 'output'
                : id.startsWith('akari-preview-') ? 'raw' : undefined;
            if (kind && viewId) {
                const identityUri = new URI(viewId).normalizePath();
                const initialSeekTime = kind === 'output'
                    ? this.pendingOutputInitialSeek.get(identityUri.toString())
                    : undefined;
                void this.configurePreview(event.widget, identityUri, kind, initialSeekTime).catch(error => {
                    if (!event.widget.isDisposed) {
                        console.warn('[akari-preview] failed to configure created preview widget', viewId, error);
                    }
                });
            }
        });
        // 右の注釈パネルへ入力フォーカスを移しても main area の対象タブは変わらない。
        // activeWidget ではなく current main widget を見ることで、入力中も raw 素材文脈を維持する。
        this.lifecycleDisposables.push(this.shell.onDidChangeCurrentWidget(() => {
            this.syncRawPreviewAnnotationContext();
            this.syncReviewSessionStateForCurrentPreview();
        }));
        this.registerSeekHandler();
        this.registerEnsureVisibleCommand();
        this.registerOutputSeekCommand();
        this.registerTogglePlaybackCommand();
        this.registerCompactTracksCommand();
        const onTimelineOverlaySelected = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; overlayId?: string | null }>).detail;
            if (!detail?.editUri || (typeof detail.overlayId !== 'string' && detail.overlayId !== null)) {
                return;
            }
            let key: string;
            try {
                key = new URI(detail.editUri).normalizePath().toString();
            } catch {
                return;
            }
            const widget = this.openOutputPreviews.get(key);
            if (widget?.isAttached) {
                widget.sendMessage({ type: 'akari-preview-select-overlay', overlayId: detail.overlayId });
            }
        };
        window.addEventListener(TIMELINE_OVERLAY_SELECTED_EVENT, onTimelineOverlaySelected);
        this.lifecycleDisposables.push({
            dispose: () => window.removeEventListener(TIMELINE_OVERLAY_SELECTED_EVENT, onTimelineOverlaySelected)
        });
        // CF-select: タイムラインでレイヤーを選択 → 出力プレビュー側もハイライト（overlay と同型）。
        const onTimelineLayerSelected = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; layerId?: string | null }>).detail;
            if (!detail?.editUri || (typeof detail.layerId !== 'string' && detail.layerId !== null)) {
                return;
            }
            let key: string;
            try {
                key = new URI(detail.editUri).normalizePath().toString();
            } catch {
                return;
            }
            const widget = this.openOutputPreviews.get(key);
            if (widget?.isAttached) {
                widget.sendMessage({ type: 'akari-preview-select-layer', layerId: detail.layerId });
            }
        };
        window.addEventListener(TIMELINE_LAYER_SELECTED_EVENT, onTimelineLayerSelected);
        this.lifecycleDisposables.push({
            dispose: () => window.removeEventListener(TIMELINE_LAYER_SELECTED_EVENT, onTimelineLayerSelected)
        });
        const registerTimelineSetting = <T extends { editUri?: string }>(
            type: string,
            apply: (widget: PreviewWidgetMarker | undefined, detail: T, settings: PreviewSessionSettings) => void
        ): void => {
            const listener = (event: Event): void => {
                const detail = (event as CustomEvent<T>).detail;
                if (!detail?.editUri) {
                    return;
                }
                let key: string;
                try {
                    key = new URI(detail.editUri).normalizePath().toString();
                } catch {
                    return;
                }
                const settings = this.previewSessionSettings.get(key) ?? this.defaultSessionSettings();
                const widget = this.openOutputPreviews.get(key);
                apply(widget?.isAttached ? widget : undefined, detail, settings);
                this.previewSessionSettings.set(key, settings);
            };
            window.addEventListener(type, listener);
            this.lifecycleDisposables.push({ dispose: () => window.removeEventListener(type, listener) });
        };
        registerTimelineSetting<{ editUri?: string; muted?: boolean }>(TIMELINE_SET_MUTED_EVENT, (widget, detail, settings) => {
            if (typeof detail.muted !== 'boolean') return;
            settings.muted = detail.muted;
            if (widget) {
                widget.akariPreviewMuted = detail.muted;
                widget.sendMessage({ type: 'akari-preview-set-muted', muted: detail.muted });
            }
        });
        registerTimelineSetting<{ editUri?: string; track?: number; visible?: boolean }>(
            TIMELINE_SET_TRACK_VISIBILITY_EVENT, (widget, detail, settings) => {
                if (!Number.isInteger(detail.track) || detail.track! < 0 || typeof detail.visible !== 'boolean') return;
                if (detail.visible) settings.hiddenTracks.delete(detail.track!); else settings.hiddenTracks.add(detail.track!);
                if (widget) {
                    widget.akariPreviewHiddenTracks = new Set(settings.hiddenTracks);
                    widget.sendMessage({
                        type: 'akari-preview-set-track-visibility', track: detail.track, visible: detail.visible
                    });
                }
            }
        );
        const onTrackVisibilityV2 = (event: Event): void => {
            this.applyTrackVisibilityV2((event as CustomEvent<TrackVisibilityV2Request>).detail);
        };
        window.addEventListener(TIMELINE_SET_TRACK_VISIBILITY_EVENT, onTrackVisibilityV2);
        this.lifecycleDisposables.push({
            dispose: () => window.removeEventListener(TIMELINE_SET_TRACK_VISIBILITY_EVENT, onTrackVisibilityV2)
        });
        const onSyncTrackToggles = (event: Event): void => {
            const detail = (event as CustomEvent<{
                editUri?: string;
                cuts?: { hidden?: number[]; muted?: number[] };
                layers?: { hidden?: number[]; muted?: number[] };
            }>).detail;
            if (!detail?.editUri) return;
            this.applyTimelineTrackSync(detail.editUri, detail.cuts, detail.layers);
        };
        window.addEventListener(TIMELINE_SYNC_TRACK_TOGGLES_EVENT, onSyncTrackToggles);
        this.lifecycleDisposables.push({
            dispose: () => window.removeEventListener(TIMELINE_SYNC_TRACK_TOGGLES_EVENT, onSyncTrackToggles)
        });
        const registerTimelineSettingV2Adapter = <T extends { editUri?: string }>(
            type: string,
            toRequest: (detail: T) => Omit<TrackVisibilityV2Request, 'videoUri'>
        ): void => {
            const listener = (event: Event): void => {
                const detail = (event as CustomEvent<T>).detail;
                if (!detail?.editUri) return;
                this.applyTrackVisibilityV2({ ...toRequest(detail), videoUri: detail.editUri });
            };
            window.addEventListener(type, listener);
            this.lifecycleDisposables.push({ dispose: () => window.removeEventListener(type, listener) });
        };
        registerTimelineSettingV2Adapter<{ editUri?: string; visible?: boolean }>(
            TIMELINE_SET_CLIPS_VISIBILITY_EVENT,
            detail => ({
                scope: 'cuts', track: null,
                hidden: typeof detail.visible === 'boolean' ? !detail.visible : undefined
            })
        );
        registerTimelineSettingV2Adapter<{ editUri?: string; track?: number; muted?: boolean }>(
            TIMELINE_SET_OVERLAY_TRACK_MUTED_EVENT,
            detail => ({ scope: 'overlays', track: detail.track, muted: detail.muted })
        );
        registerTimelineSettingV2Adapter<{ editUri?: string; visible?: boolean }>(
            TIMELINE_SET_LAYERS_VISIBILITY_EVENT,
            detail => ({
                scope: 'layers', track: null,
                hidden: typeof detail.visible === 'boolean' ? !detail.visible : undefined
            })
        );
        registerTimelineSettingV2Adapter<{ editUri?: string; muted?: boolean }>(
            TIMELINE_SET_LAYERS_MUTED_EVENT,
            detail => ({ scope: 'layers', track: null, muted: detail.muted })
        );
        registerTimelineSettingV2Adapter<{ editUri?: string; visible?: boolean }>(
            TIMELINE_SET_AUDIO_VISIBILITY_EVENT,
            detail => ({
                scope: 'audio', track: null,
                hidden: typeof detail.visible === 'boolean' ? !detail.visible : undefined
            })
        );
        registerTimelineSettingV2Adapter<{ editUri?: string; muted?: boolean }>(
            TIMELINE_SET_AUDIO_MUTED_EVENT,
            detail => ({ scope: 'audio', track: null, muted: detail.muted })
        );
        // captions/beats はプレビュー側に音声・専用描画の対象がない（字幕に音声なし・beats はプレビュー非描画）。
        // 購読はするが意図的に no-op。
        const noopTimelineSetting = (): void => { /* no-op: プレビュー側に対応する状態がないスコープ */ };
        window.addEventListener(TIMELINE_SET_CAPTIONS_MUTED_EVENT, noopTimelineSetting);
        window.addEventListener(TIMELINE_SET_BEATS_VISIBILITY_EVENT, noopTimelineSetting);
        window.addEventListener(TIMELINE_SET_BEATS_MUTED_EVENT, noopTimelineSetting);
        this.lifecycleDisposables.push({
            dispose: () => {
                window.removeEventListener(TIMELINE_SET_CAPTIONS_MUTED_EVENT, noopTimelineSetting);
                window.removeEventListener(TIMELINE_SET_BEATS_VISIBILITY_EVENT, noopTimelineSetting);
                window.removeEventListener(TIMELINE_SET_BEATS_MUTED_EVENT, noopTimelineSetting);
            }
        });
        registerTimelineSetting<{ editUri?: string; visible?: boolean }>(
            TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT, (widget, detail, settings) => {
                if (typeof detail.visible !== 'boolean') return;
                settings.captionsVisible = detail.visible;
                if (widget) {
                    widget.akariPreviewCaptionsVisible = detail.visible;
                    widget.sendMessage({ type: 'akari-preview-set-captions-visibility', visible: detail.visible });
                }
            }
        );
        const onLiveTransform = (event: Event): void => {
            const detail = (event as CustomEvent<{
                editUri?: string;
                target?: { kind: 'cut'; index: number } | { kind: 'layer'; id: string };
                field?: string;
                value?: number;
            }>).detail;
            if (!detail?.editUri || !detail.target
                || (detail.target.kind !== 'cut' && detail.target.kind !== 'layer')
                || typeof detail.field !== 'string' || typeof detail.value !== 'number'
                || !Number.isFinite(detail.value)) {
                return;
            }
            let key: string;
            try {
                key = new URI(detail.editUri).normalizePath().toString();
            } catch {
                return;
            }
            const widget = this.openOutputPreviews.get(key);
            if (widget?.isAttached) {
                widget.sendMessage({
                    type: 'akari-preview-live-transform',
                    target: detail.target,
                    field: detail.field,
                    value: detail.value
                });
            }
        };
        window.addEventListener(TIMELINE_LIVE_TRANSFORM_EVENT, onLiveTransform);
        this.lifecycleDisposables.push({
            dispose: () => window.removeEventListener(TIMELINE_LIVE_TRANSFORM_EVENT, onLiveTransform)
        });
        this.registerReviewSessionEvents();
    }

    protected applyTrackVisibilityV2(detail: TrackVisibilityV2Request | undefined): void {
        if (!detail || typeof detail.videoUri !== 'string'
            || (detail.scope !== 'cuts' && detail.scope !== 'overlays' && detail.scope !== 'layers'
                && detail.scope !== 'audio' && detail.scope !== 'captions')) {
            return;
        }
        let key: string;
        try {
            key = new URI(detail.videoUri).normalizePath().toString();
        } catch {
            return;
        }
        const widget = this.openOutputPreviews.get(key);
        const settings = this.previewSessionSettings.get(key) ?? this.defaultSessionSettings();
        if (detail.scope === 'overlays') {
            if (!Number.isInteger(detail.track) || detail.track! < 0 || typeof detail.hidden !== 'boolean') return;
            if (detail.hidden) settings.hiddenTracks.add(detail.track!); else settings.hiddenTracks.delete(detail.track!);
            if (widget?.isAttached) {
                widget.akariPreviewHiddenTracks = new Set(settings.hiddenTracks);
                widget.sendMessage({
                    type: 'akari-preview-set-track-visibility', track: detail.track, visible: !detail.hidden
                });
            }
            this.previewSessionSettings.set(key, settings);
            return;
        }
        if (detail.scope === 'captions') {
            if (typeof detail.hidden !== 'boolean') return;
            settings.captionsVisible = !detail.hidden;
            if (widget?.isAttached) {
                widget.akariPreviewCaptionsVisible = !detail.hidden;
                widget.sendMessage({ type: 'akari-preview-set-captions-visibility', visible: !detail.hidden });
            }
            this.previewSessionSettings.set(key, settings);
            return;
        }
        if (typeof detail.hidden === 'boolean'
            && (detail.scope === 'cuts' || detail.scope === 'layers' || detail.scope === 'audio')) {
            if (detail.track === null) {
                settings.allTracksHiddenByScope[detail.scope] = detail.hidden;
            } else if (Number.isInteger(detail.track) && detail.track! >= 0) {
                if (detail.hidden) settings.hiddenTracksByScope[detail.scope].add(detail.track!);
                else settings.hiddenTracksByScope[detail.scope].delete(detail.track!);
            }
        }
        if (typeof detail.muted === 'boolean'
            && (detail.scope === 'cuts' || detail.scope === 'audio' || detail.scope === 'layers')) {
            if (detail.track === null) {
                settings.allTracksMutedByScope[detail.scope] = detail.muted;
            } else if (Number.isInteger(detail.track) && detail.track! >= 0) {
                if (detail.muted) settings.mutedTracksByScope[detail.scope].add(detail.track!);
                else settings.mutedTracksByScope[detail.scope].delete(detail.track!);
            }
        }
        this.previewSessionSettings.set(key, settings);
        if (widget?.isAttached) {
            widget.akariPreviewHiddenTracksByScope = {
                cuts: [...settings.hiddenTracksByScope.cuts],
                layers: [...settings.hiddenTracksByScope.layers],
                audio: [...settings.hiddenTracksByScope.audio]
            };
            widget.akariPreviewMutedTracksByScope = {
                cuts: [...settings.mutedTracksByScope.cuts],
                audio: [...settings.mutedTracksByScope.audio],
                layers: [...settings.mutedTracksByScope.layers]
            };
            widget.akariPreviewAllTracksHiddenScopes = Object.entries(settings.allTracksHiddenByScope)
                .filter(([, hidden]) => hidden).map(([scope]) => scope);
            widget.akariPreviewAllTracksMutedScopes = Object.entries(settings.allTracksMutedByScope)
                .filter(([, muted]) => muted).map(([scope]) => scope);
            widget.sendMessage({
                type: 'akari-preview-set-track-visibility-v2',
                scope: detail.scope,
                track: detail.track,
                hidden: detail.hidden,
                muted: detail.muted
            });
        }
    }

    protected applyTimelineTrackSync(
        videoUri: string,
        cuts?: { hidden?: number[]; muted?: number[] },
        layers?: { hidden?: number[]; muted?: number[] }
    ): void {
        let key: string;
        try {
            key = new URI(videoUri).normalizePath().toString();
        } catch {
            return;
        }
        const widget = this.openOutputPreviews.get(key);
        const settings = this.previewSessionSettings.get(key) ?? this.defaultSessionSettings();
        settings.hiddenTracksByScope.cuts = new Set(cuts?.hidden ?? []);
        settings.mutedTracksByScope.cuts = new Set(cuts?.muted ?? []);
        settings.hiddenTracksByScope.layers = new Set(layers?.hidden ?? []);
        settings.mutedTracksByScope.layers = new Set(layers?.muted ?? []);
        this.previewSessionSettings.set(key, settings);
        if (widget?.isAttached) {
            widget.akariPreviewHiddenTracksByScope = {
                cuts: [...settings.hiddenTracksByScope.cuts],
                layers: [...settings.hiddenTracksByScope.layers],
                audio: [...settings.hiddenTracksByScope.audio]
            };
            widget.akariPreviewMutedTracksByScope = {
                cuts: [...settings.mutedTracksByScope.cuts],
                audio: [...settings.mutedTracksByScope.audio],
                layers: [...settings.mutedTracksByScope.layers]
            };
            widget.sendMessage({
                type: 'akari-preview-set-track-visibility-v2-bulk',
                hiddenCuts: [...settings.hiddenTracksByScope.cuts],
                mutedCuts: [...settings.mutedTracksByScope.cuts],
                hiddenLayers: [...settings.hiddenTracksByScope.layers],
                mutedLayers: [...settings.mutedTracksByScope.layers]
            });
        }
    }

    protected defaultSessionSettings(): PreviewSessionSettings {
        return {
            muted: false,
            captionsVisible: true,
            hiddenTracks: new Set<number>(),
            hiddenTracksByScope: { cuts: new Set<number>(), layers: new Set<number>(), audio: new Set<number>() },
            mutedTracksByScope: { cuts: new Set<number>(), audio: new Set<number>(), layers: new Set<number>() },
            allTracksHiddenByScope: { cuts: false, layers: false, audio: false },
            allTracksMutedByScope: { cuts: false, audio: false, layers: false }
        };
    }

    onStop(): void {
        this.lifecycleDisposables.dispose();
        void this.reviewSessionRecorder?.dispose();
        this.reviewSessionRecorder = undefined;
        this.reviewSessionRecordingIndicator?.dispose();
        this.reviewSessionRecordingIndicator = undefined;
    }

    protected registerReviewSessionEvents(): void {
        const register = (type: string, listener: EventListener): void => {
            window.addEventListener(type, listener);
            this.lifecycleDisposables.push({ dispose: () => window.removeEventListener(type, listener) });
        };
        register(REVIEW_SESSION_START_EVENT, event => {
            const detail = (event as CustomEvent<ReviewSessionControlRequest>).detail;
            if (!detail?.projectRootUri || !detail.editUri || !this.reviewSessionRecorder) {
                return;
            }
            void this.startReviewSessionFromPanel(detail.projectRootUri, detail.editUri);
        });
        register(REVIEW_SESSION_STOP_EVENT, () => {
            void this.reviewSessionRecorder?.stop();
        });
        register(REVIEW_SESSION_REFRESH_EVENT, event => {
            const detail = (event as CustomEvent<ReviewSessionControlRequest>).detail;
            if (detail?.projectRootUri && detail.editUri) {
                void this.reviewSessionRecorder?.refresh(detail.projectRootUri, detail.editUri);
            }
        });
        register(REVIEW_SESSION_OPEN_FOLDER_EVENT, event => {
            const detail = (event as CustomEvent<ReviewSessionControlRequest>).detail;
            if (!detail?.projectRootUri) {
                return;
            }
            let sessionsUri: URI;
            try {
                sessionsUri = new URI(detail.projectRootUri).resolve('review/sessions').normalizePath();
            } catch {
                return;
            }
            void open(this.openerService, sessionsUri, { mode: 'activate' }).catch(error => {
                const detail = error instanceof Error ? error.message : String(error);
                this.messages.warn(`録音セッションの保存先を開けません: ${detail}`);
            });
        });
        register(REVIEW_ANNOTATION_SHOW_STROKES_EVENT, event => {
            const detail = (event as CustomEvent<ReviewAnnotationStrokeRequest>).detail;
            if (detail) {
                void this.showReviewAnnotationStrokes(detail);
            }
        });
        register(REVIEW_TOOL_MODE_SET_EVENT, event => {
            const detail = (event as CustomEvent<ReviewToolModeSetRequest>).detail;
            const editUri = detail?.editUri ? this.normalizeReviewEditUri(detail.editUri) : undefined;
            if (!editUri || !detail?.mode || !this.reviewSessionRecorder) {
                return;
            }
            this.reviewSessionRecorder.setToolMode(editUri, detail.mode);
        });
        register(REVIEW_UI_SELECTION_CLEAR_EVENT, event => {
            const detail = (event as CustomEvent<ReviewSessionControlRequest>).detail;
            const editUri = detail?.editUri ? this.normalizeReviewEditUri(detail.editUri) : undefined;
            if (!editUri || !this.reviewSessionRecorder) {
                return;
            }
            this.reviewSessionRecorder.clearUiSelection(editUri);
        });
    }

    protected async showReviewAnnotationStrokes(detail: ReviewAnnotationStrokeRequest): Promise<void> {
        const editUri = this.normalizeReviewEditUri(detail.editUri);
        if (!editUri || !Number.isFinite(detail.sourceT) || !Array.isArray(detail.strokes)) {
            return;
        }
        const visibility = await this.ensureVisible(editUri);
        const widget = this.openOutputPreviews.get(editUri);
        if (visibility === 'unavailable' || !widget?.isAttached) {
            return;
        }
        const cutIndex = this.resolveReviewStrokeCutIndex(detail.strokes);
        let compositionSeconds = detail.sourceT;
        try {
            const model = await this.loadPreviewModel(new URI(editUri));
            compositionSeconds = resolveAnnotationStrokeCompositionSeconds(
                model.summary.cuts, detail.sourceT, cutIndex
            );
        } catch {
            // edit.json が読めない場合は sourceT をそのまま composition 秒として扱う
            // （cuts なしの恒等写像と同じフォールバック）。
        }
        widget.sendMessage({ type: 'akari-preview-seek', time: compositionSeconds });
        widget.sendMessage({
            type: 'akari-preview-show-annotation-strokes',
            strokes: detail.strokes
        });
    }

    // strokes[].frame.cutIndex は同一 source 秒が複数カットに含まれる場合の多義解決に使う
    // （最初に見つかった有効な cutIndex を採用。ストローク群は同一 annotation・同一カットの想定）。
    protected resolveReviewStrokeCutIndex(
        strokes: ReviewAnnotationStrokeRequest['strokes']
    ): number | null {
        for (const stroke of strokes) {
            const cutIndex = stroke.frame?.cutIndex;
            if (Number.isInteger(cutIndex) && (cutIndex as number) >= 0) {
                return cutIndex as number;
            }
        }
        return null;
    }

    protected async startReviewSessionFromPanel(projectRootUri: string, requestedEditUri: string): Promise<void> {
        const recorder = this.reviewSessionRecorder;
        const editUri = this.normalizeReviewEditUri(requestedEditUri);
        if (!recorder || !editUri) {
            recorder?.reportError(projectRootUri, requestedEditUri, 'edit.json の場所を特定できません。');
            return;
        }
        const visibility = await this.ensureVisible(editUri);
        const widget = this.openOutputPreviews.get(editUri);
        if (visibility === 'unavailable' || !widget?.isAttached) {
            recorder.reportError(projectRootUri, editUri, '出力プレビューを開けませんでした。');
            return;
        }
        const transport = this.reviewTransportByEdit.get(editUri) ?? {
            timelineT: 0,
            playing: false,
            rate: 1
        };
        await recorder.start({
            projectRootUri,
            editUri,
            timelineT: transport.timelineT,
            playing: transport.playing
        }, transport);
    }

    protected normalizeReviewEditUri(value: string): string | undefined {
        try {
            return new URI(value).normalizePath().toString();
        } catch {
            return undefined;
        }
    }

    protected forwardReviewSessionState(state: ReviewSessionUiState): void {
        this.reviewSessionRecordingIndicator?.setActive(state.active);
        window.dispatchEvent(new CustomEvent(REVIEW_SESSION_STATE_EVENT, { detail: state }));
        const editUri = this.normalizeReviewEditUri(state.editUri);
        if (!editUri) {
            return;
        }
        this.reviewSessionStateByEdit.set(editUri, state);
        for (const widget of [...this.openOutputPreviews.values(), ...this.openPreviews.values()]) {
            this.applyReviewSessionStateToPreview(widget, state);
        }
    }

    /**
     * The annotation panel is owned by the sibling annotations extension. This task's file boundary
     * deliberately excludes it, so the preview extension installs an additive control into the
     * panel's stable data-* slots at runtime. Re-rendered session rows are decorated idempotently.
     */
    protected syncReviewStrokeControls(state: ReviewSessionUiState): void {
        const editUri = this.normalizeReviewEditUri(state.editUri);
        const panel = document.querySelector<HTMLElement>('[data-akari-ui="panel:review"]');
        const section = panel?.querySelector<HTMLElement>('[data-review-recording-section]');
        if (!editUri || !section) return;

        let label = section.querySelector<HTMLLabelElement>('[data-review-stroke-visibility]');
        if (!label) {
            label = document.createElement('label');
            label.setAttribute('data-review-stroke-visibility', '');
            Object.assign(label.style, {
                display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer'
            });
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.setAttribute('aria-label', '注釈描線を表示');
            const text = document.createElement('span');
            text.textContent = '描線を表示';
            label.append(input, text);
            const sessionList = section.querySelector('[data-review-session]')?.parentElement;
            section.insertBefore(label, sessionList ?? null);
        }
        const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        input.checked = this.reviewStrokeVisibilityByEdit.get(editUri) ?? true;
        input.onchange = () => this.setReviewStrokeVisibility(editUri!, input.checked);

        for (const row of Array.from(section.querySelectorAll<HTMLElement>('[data-review-session]'))) {
            const sessionId = row.getAttribute('data-review-session');
            if (!sessionId || row.querySelector('[data-review-session-strokes]')) continue;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theia-button secondary';
            button.textContent = '描線';
            button.title = `${sessionId} の保存済み描線を再表示`;
            button.setAttribute('data-review-session-strokes', sessionId);
            button.addEventListener('click', () => void this.showReviewSessionStrokes(state, sessionId));
            row.style.gridTemplateColumns = 'auto minmax(0, 1fr) auto auto';
            row.appendChild(button);
        }
    }

    protected setReviewStrokeVisibility(editUri: string, visible: boolean): void {
        this.reviewStrokeVisibilityByEdit.set(editUri, visible);
        for (const widget of [...this.openOutputPreviews.values(), ...this.openPreviews.values()]) {
            if (this.reviewEditUriForPreview(widget) === editUri && widget.isAttached) {
                widget.sendMessage({ type: 'akari-preview-set-stroke-visibility', visible });
            }
        }
    }

    protected async showReviewSessionStrokes(state: ReviewSessionUiState, sessionId: string): Promise<void> {
        const editUri = this.normalizeReviewEditUri(state.editUri);
        if (!editUri) return;
        const replay = await this.previewService.readReviewSessionStrokes({
            projectRootUri: state.projectRootUri,
            sessionId
        });
        const strokes = normalizePersistentStrokeItems(replay.strokes);
        if (strokes.length === 0) {
            this.messages.info(`${sessionId} に再表示できる描線はありません。`);
            return;
        }
        const visibility = await this.ensureVisible(editUri);
        const widget = this.openOutputPreviews.get(editUri);
        if (visibility === 'unavailable' || !widget?.isAttached) return;
        const first = replay.strokes[0];
        let compositionSeconds = first.frame.sourceT;
        try {
            const model = await this.loadPreviewModel(new URI(editUri));
            compositionSeconds = resolveAnnotationStrokeCompositionSeconds(
                model.summary.cuts, first.frame.sourceT, first.frame.cutIndex
            );
        } catch {
            // Keep the source-seconds fallback for old snapshots and partially repaired projects.
        }
        this.setReviewStrokeVisibility(editUri, true);
        this.syncReviewStrokeControls(state);
        widget.sendMessage({ type: 'akari-preview-seek', time: compositionSeconds });
        widget.sendMessage({
            type: 'akari-preview-show-session-strokes',
            sessionId,
            target: { tab: editUri, recT: first.recTStart },
            strokes: replay.strokes
        });
    }

    protected reviewEditUriForPreview(widget: PreviewWidgetMarker): string | undefined {
        return resolveReviewPreviewEditUri({
            editUri: widget.akariPreviewEditUri?.normalizePath().toString(),
            relatedEditUri: widget.akariPreviewRelatedEditUri?.normalizePath().toString()
        });
    }

    protected applyReviewSessionStateToPreview(
        widget: PreviewWidgetMarker,
        state: ReviewSessionUiState
    ): void {
        const previewEditUri = this.reviewEditUriForPreview(widget);
        const stateEditUri = this.normalizeReviewEditUri(state.editUri);
        if (!widget.isAttached || !previewEditUri || previewEditUri !== stateEditUri) {
            return;
        }
        widget.sendMessage({
            type: 'akari-preview-set-review-recording',
            active: state.active,
            mode: state.toolMode
        });
        widget.sendMessage({
            type: 'akari-preview-set-stroke-visibility',
            visible: this.reviewStrokeVisibilityByEdit.get(stateEditUri) ?? true
        });
    }

    protected syncReviewSessionStateForCurrentPreview(): void {
        const widget = this.shell.getCurrentWidget('main') as PreviewWidgetMarker | undefined;
        if (!widget || ![...this.openOutputPreviews.values(), ...this.openPreviews.values()].includes(widget)) {
            return;
        }
        const editUri = this.reviewEditUriForPreview(widget);
        const state = editUri ? this.reviewSessionStateByEdit.get(editUri) : undefined;
        if (state) {
            this.applyReviewSessionStateToPreview(widget, state);
        }
    }

    // 戻り値は 'seeked' | 'mismatched-asset' | 'no-preview' の3値で、'no-preview' は akari-transcript 側のフォールバックハンドラが返す。
    protected registerSeekHandler(): void {
        this.commandRegistry.registerHandler(TRANSCRIPT_SEEK_COMMAND_ID, {
            isEnabled: () => this.openPreviews.size > 0,
            execute: (request?: TranscriptSeekRequest) => {
                const widget = this.findSeekableWidget(request?.videoUri);
                if (widget && Number.isFinite(request?.time)) {
                    widget.sendMessage({ type: 'akari-preview-seek', time: request!.time });
                    return 'seeked';
                }
                return 'mismatched-asset';
            }
        });
    }

    protected findSeekableWidget(videoUri: string | undefined): PreviewWidgetMarker | undefined {
        if (!videoUri) {
            return undefined;
        }
        const key = new URI(videoUri).normalizePath().toString();
        const widget = this.openPreviews.get(key);
        return widget && widget.isAttached && widget.akariPreviewSeekable ? widget : undefined;
    }

    canHandle(uri: URI): number {
        return CLAIMED_VIDEO_EXTENSIONS.has(uri.path.ext.toLowerCase()) ? 1100 : 0;
    }

    async open(uri: URI, options?: any): Promise<WebviewWidget> {
        const identityUri = uri.normalizePath();
        try {
            const widget = await this.getOrOpenPreview(
                identityUri,
                options?.widgetOptions ?? { area: 'main' },
                'raw'
            );
            this.attachTimelinePassively();
            await this.shell.activateWidget(widget.id);
            return widget;
        } catch (error) {
            this.reportOpenFailure(identityUri, error);
            throw error;
        }
    }

    // task 2026-08-17-shell-right-panel-order-and-focus 指示3: edit.json は「開く」を全て
    // AkariOutputPreviewOpenHandler.canHandle(1200) が横取りするため、既にプレビューが出ている
    // 状態で再 open（別経路からの open を含む）しても表示中タブの焦点を奪わないことが必要。
    // 新規作成時（プレビューがまだ無い状態からの open）だけ activate し、既存 widget への
    // 再 open は revealWidget に留める。options.mode（Theia の WidgetOpenMode 相当）の明示指定が
    // あれば常にそれを優先する（resolveOutputOpenFocusMode 参照）。
    async openOutput(uri: URI, options?: any): Promise<WebviewWidget> {
        const editUri = uri.normalizePath();
        try {
            const existing = this.openOutputPreviews.get(editUri.toString());
            const wasAlreadyOpen = Boolean(existing?.akariPreviewConfigured && !existing.isDisposed);
            const widget = await this.getOrOpenPreview(
                editUri,
                options?.widgetOptions ?? { area: 'main' },
                'output'
            );
            this.attachTimelinePassively();
            const mode = resolveOutputOpenFocusMode(options?.mode, wasAlreadyOpen);
            if (mode === 'activate') {
                await this.shell.activateWidget(widget.id);
            } else if (mode === 'reveal') {
                this.shell.revealWidget(widget.id);
            }
            return widget;
        } catch (error) {
            this.reportOpenFailure(editUri, error);
            throw error;
        }
    }

    // 動画がプレビューで開かれるたびにタイムラインの自動アタッチを要求する。重複禁止・
    // セッション内の明示クローズの尊重・フォーカスを奪わない（reveal のみ）判断は
    // 呼び出し先（akari-annotations）に委ねる。取りこぼしてもプレビュー自体は開けるべきなので
    // 結果を待たず、失敗時は握りつぶす。
    protected attachTimelinePassively(): void {
        this.commandRegistry.executeCommand(ATTACH_TIMELINE_PASSIVE_COMMAND_ID)
            .catch(error => console.warn('[akari-preview] failed to auto-attach timeline', error));
    }

    // タイムライン側からの操作で、他のタブを見ていてもアウトプットプレビューのタブを
    // 必ず前面へ出すための内部コマンド。フォーカスは奪わない（revealWidget のみ）。
    protected registerEnsureVisibleCommand(): void {
        this.commandRegistry.registerCommand(ENSURE_PREVIEW_VISIBLE_COMMAND, {
            execute: (request?: EnsureVisibleRequest) => this.ensureVisible(request?.editUri)
        });
    }

    protected async ensureVisible(editUri: string | undefined): Promise<'revealed' | 'opened' | 'unavailable'> {
        if (!editUri) {
            return 'unavailable';
        }
        try {
            const uri = new URI(editUri).normalizePath();
            const existing = this.openOutputPreviews.get(uri.toString());
            if (existing?.akariPreviewConfigured && existing.isAttached && !existing.isDisposed) {
                this.shell.revealWidget(existing.id);
                return 'revealed';
            }
            const widget = await this.getOrOpenPreview(uri, { area: 'main' }, 'output');
            this.shell.revealWidget(widget.id);
            return 'opened';
        } catch (error) {
            this.reportOpenFailure(new URI(editUri), error);
            return 'unavailable';
        }
    }

    protected registerOutputSeekCommand(): void {
        this.commandRegistry.registerCommand(SEEK_OUTPUT_PREVIEW_COMMAND, {
            execute: (request?: SeekOutputRequest) => this.seekOutputPreview(request)
        });
    }

    protected registerTogglePlaybackCommand(): void {
        this.commandRegistry.registerCommand(TOGGLE_OUTPUT_PREVIEW_PLAYBACK_COMMAND, {
            execute: (request?: TogglePlaybackRequest) => this.toggleOutputPreviewPlayback(request)
        });
    }

    protected registerCompactTracksCommand(): void {
        this.commandRegistry.registerCommand(COMPACT_TRACKS_COMMAND, {
            execute: (request?: CompactTracksRequest) => this.compactTracks(request)
        });
    }

    protected async compactTracks(
        request: CompactTracksRequest | undefined
    ): Promise<'compacted' | 'unchanged' | 'unavailable'> {
        if (!request?.editUri) {
            return 'unavailable';
        }
        const editUri = new URI(request.editUri).normalizePath();
        if (!(await this.isInsideWorkspace(editUri))) {
            return 'unavailable';
        }
        const originalText = await this.readText(editUri);
        const parsed = JSON.parse(originalText) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
            || (parsed as { version?: unknown }).version !== 2) {
            return 'unavailable';
        }
        const compacted = compactVisualTracks(parsed as EditV2);
        if (!compacted.changed) {
            return 'unchanged';
        }
        const candidateText = `${JSON.stringify(compacted.edit, null, 2)}\n`;
        const lintResult = await this.previewService.lintEditCandidate({
            editUri: editUri.toString(),
            candidateText
        });
        if (!lintResult.pass) {
            throw new Error(lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
        }
        this.markRecentWrite(editUri);
        await this.fileService.writeFile(editUri, BinaryBuffer.fromString(candidateText));
        return 'compacted';
    }

    protected async offerTrackCompaction(
        editUri: URI,
        beforeTrackCount: number,
        afterTrackCount: number
    ): Promise<void> {
        const choice = await this.messages.info(
            `トラックを ${beforeTrackCount} 本 → ${afterTrackCount} 本に整理できます。整理しますか？`,
            COMPACT_TRACKS_ACTION,
            KEEP_TRACKS_ACTION
        );
        if (choice !== COMPACT_TRACKS_ACTION) {
            return;
        }
        try {
            await this.compactTracks({ editUri: editUri.toString() });
        } catch (error) {
            this.messages.error(`トラックを整理できませんでした: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected async toggleOutputPreviewPlayback(
        request: TogglePlaybackRequest | undefined
    ): Promise<'toggled' | 'unavailable'> {
        if (!request?.editUri) {
            return 'unavailable';
        }
        const editUri = new URI(request.editUri).normalizePath();
        const existing = this.openOutputPreviews.get(editUri.toString());
        if (existing?.akariPreviewConfigured && existing.isAttached && !existing.isDisposed) {
            existing.sendMessage({ type: 'akari-preview-toggle-playback' });
            return 'toggled';
        }
        return 'unavailable';
    }

    protected async seekOutputPreview(
        request: SeekOutputRequest | undefined
    ): Promise<'seeked' | 'mismatched-asset'> {
        if (!request?.editUri || !Number.isFinite(request.time)) {
            return 'mismatched-asset';
        }
        const editUri = new URI(request.editUri).normalizePath();
        const key = editUri.toString();
        const existing = this.openOutputPreviews.get(key);
        if (existing?.akariPreviewConfigured && existing.akariPreviewSeekable && !existing.isDisposed) {
            if (!existing.isAttached) {
                this.shell.addWidget(existing, { area: 'main' });
            }
            this.shell.revealWidget(existing.id);
            existing.sendMessage({ type: 'akari-preview-seek', time: request.time });
            return 'seeked';
        }
        try {
            const widget = await this.getOrOpenPreview(editUri, { area: 'main' }, 'output', request.time);
            this.shell.revealWidget(widget.id);
            this.attachTimelinePassively();
            return 'seeked';
        } catch (error) {
            this.reportOpenFailure(editUri, error);
            return 'mismatched-asset';
        }
    }

    protected async getOrOpenPreview(
        uri: URI,
        widgetOptions: any,
        kind: 'raw' | 'output',
        initialSeekTime?: number
    ): Promise<WebviewWidget> {
        const seekKey = uri.normalizePath().toString();
        const previews = kind === 'output' ? this.openOutputPreviews : this.openPreviews;
        const existing = previews.get(seekKey);
        if (existing?.akariPreviewConfigured && !existing.isDisposed) {
            if (!existing.isAttached) {
                this.shell.addWidget(existing, widgetOptions);
            }
            if (kind === 'output' && Number.isFinite(initialSeekTime)) {
                existing.sendMessage({ type: 'akari-preview-seek', time: initialSeekTime });
            }
            return existing;
        }

        if (kind === 'output' && Number.isFinite(initialSeekTime)) {
            this.pendingOutputInitialSeek.set(seekKey, initialSeekTime!);
        }
        const baseId = kind === 'output'
            ? `akari-output-preview-${this.hash(uri.toString())}`
            : `akari-preview-${this.hash(uri.toString())}`;
        let lastError: unknown;
        let useFreshIdentifier = false;
        for (let attempt = 1; attempt <= PREVIEW_OPEN_ATTEMPTS; attempt += 1) {
            const identifier = {
                id: useFreshIdentifier ? `${baseId}-retry-${++this.retryWidgetSequence}` : baseId,
                viewId: uri.toString()
            };
            let widget: WebviewWidget | undefined;
            let abandoned = false;
            const operation = (async (): Promise<WebviewWidget> => {
                widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, identifier);
                if (abandoned) {
                    this.discardPreviewWidget(widget, uri, kind);
                    throw new Error('Preview open attempt was superseded.');
                }
                await this.configurePreview(widget, uri, kind, initialSeekTime);
                if (abandoned || widget.isDisposed) {
                    this.discardPreviewWidget(widget, uri, kind);
                    throw new Error('Preview widget was disposed while opening.');
                }
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, widgetOptions);
                }
                return widget;
            })();
            try {
                return await this.withOpenTimeout(operation, uri);
            } catch (error) {
                abandoned = true;
                lastError = error;
                if (widget) {
                    this.discardPreviewWidget(widget, uri, kind);
                } else {
                    // WidgetManager は作成中 Promise を同じ ID で再利用する。作成自体が止まった場合は
                    // 次の試行だけ新しい ID にし、遅れて生成された widget は operation 側で破棄する。
                    useFreshIdentifier = true;
                }
                if (attempt < PREVIEW_OPEN_ATTEMPTS) {
                    console.warn(`[akari-preview] open attempt ${attempt} failed; retrying`, uri.toString(), error);
                }
            }
        }
        if (kind === 'output') {
            this.pendingOutputInitialSeek.delete(seekKey);
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    protected withOpenTimeout<T>(operation: Promise<T>, uri: URI): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                reject(new Error(`Timed out after ${PREVIEW_OPEN_TIMEOUT_MS}ms while opening ${uri.toString()}`));
            }, PREVIEW_OPEN_TIMEOUT_MS);
            operation.then(value => {
                window.clearTimeout(timeout);
                resolve(value);
            }, error => {
                window.clearTimeout(timeout);
                reject(error);
            });
        });
    }

    protected discardPreviewWidget(widget: WebviewWidget, uri: URI, kind: 'raw' | 'output'): void {
        const marker = widget as PreviewWidgetMarker;
        const seekKey = uri.normalizePath().toString();
        const previews = kind === 'output' ? this.openOutputPreviews : this.openPreviews;
        if (previews.get(seekKey) === marker) {
            previews.delete(seekKey);
        }
        if (!widget.isDisposed) {
            widget.dispose();
        }
        void this.disposePreviewStreams(marker);
    }

    protected reportOpenFailure(uri: URI, error: unknown): void {
        console.error('[akari-preview] failed to open preview', uri.toString(), error);
        // データ起因（TypeError = edit.json の検証エラー等）は「しばらく待て」では直らないので、
        // 実因メッセージをそのまま出す。原因不明のときだけ従来の汎用文言に落とす。
        const reason = error instanceof Error && error.message ? error.message : undefined;
        void this.messages.error(
            reason
                ? `${uri.path.base}: 動画プレビューを開けませんでした — ${reason}`
                : `${uri.path.base}: ${PREVIEW_OPEN_ERROR_MESSAGE}`
        );
    }

    protected async configurePreview(
        widget: WebviewWidget,
        identityUri: URI,
        kind: 'raw' | 'output',
        initialSeekTime?: number
    ): Promise<void> {
        const marker = widget as PreviewWidgetMarker;
        if (marker.akariPreviewConfiguration) {
            return marker.akariPreviewConfiguration;
        }
        marker.akariPreviewConfiguration = this.doConfigurePreview(marker, identityUri, kind, initialSeekTime);
        try {
            await marker.akariPreviewConfiguration;
        } finally {
            marker.akariPreviewConfiguration = undefined;
        }
    }

    protected async doConfigurePreview(
        widget: PreviewWidgetMarker,
        identityUri: URI,
        kind: 'raw' | 'output',
        initialSeekTime?: number
    ): Promise<void> {
        const seekKey = identityUri.normalizePath().toString();
        const previews = kind === 'output' ? this.openOutputPreviews : this.openPreviews;
        previews.set(seekKey, widget);
        const session = kind === 'output' ? this.previewSessionSettings.get(seekKey) : undefined;
        if (session) {
            widget.akariPreviewMuted = session.muted;
            widget.akariPreviewCaptionsVisible = session.captionsVisible;
            widget.akariPreviewHiddenTracks = new Set(session.hiddenTracks);
            widget.akariPreviewHiddenTracksByScope = {
                cuts: [...session.hiddenTracksByScope.cuts],
                layers: [...session.hiddenTracksByScope.layers],
                audio: [...session.hiddenTracksByScope.audio]
            };
            widget.akariPreviewMutedTracksByScope = {
                cuts: [...session.mutedTracksByScope.cuts],
                audio: [...session.mutedTracksByScope.audio],
                layers: [...session.mutedTracksByScope.layers]
            };
            widget.akariPreviewAllTracksHiddenScopes = Object.entries(session.allTracksHiddenByScope)
                .filter(([, hidden]) => hidden).map(([scope]) => scope);
            widget.akariPreviewAllTracksMutedScopes = Object.entries(session.allTracksMutedByScope)
                .filter(([, muted]) => muted).map(([scope]) => scope);
        }
        await this.refreshPreview(widget, identityUri, kind, initialSeekTime);
        if (kind === 'output') {
            this.pendingOutputInitialSeek.delete(seekKey);
        }

        if (widget.isDisposed) {
            return;
        }

        if (widget.akariPreviewConfigured) {
            return;
        }
        widget.akariPreviewConfigured = true;
        const disposables = new DisposableCollection();
        disposables.push(widget.onMessage(message => {
            if (this.isOverlayWriteRequest(message)) {
                this.overlayWriteTail = this.overlayWriteTail.then(() => this.handleOverlayWrite(widget, message));
            }
            if (this.isLayerWriteRequest(message)) {
                this.layerWriteTail = this.layerWriteTail.then(() => this.handleLayerWrite(widget, message));
            }
            if (this.isWaveformFetchRequest(message)) {
                void this.handleWaveformFetch(widget, message);
            }
            if (this.isHevcFallbackRequest(message)) {
                void this.handleHevcFallbackRequest(widget, identityUri, kind, message);
            }
            if (this.isOpenOutputRequest(message)) {
                void this.handleOpenOutputRequest(widget);
            }
            if (message?.type === 'akari-preview-fullscreen-fallback') {
                this.shell.toggleMaximized(widget);
            }
            if (this.isPlaybackTickRequest(message)) {
                this.forwardPlaybackTick(widget, message);
            }
            if (this.isOverlaySelectedRequest(message)) {
                this.forwardOverlaySelection(widget, message);
            }
            if (this.isLayerSelectedRequest(message)) {
                this.forwardLayerSelection(widget, message);
            }
            if (this.isCutSelectedRequest(message)) {
                this.forwardCutSelection(widget, message);
            }
            if (this.isCutWriteRequest(message)) {
                this.cutWriteTail = this.cutWriteTail.then(() => this.handleCutWrite(widget, message));
            }
            if (this.isCaptionSelectedRequest(message)) {
                this.forwardCaptionSelection(widget, message);
            }
            if (this.isCaptionWriteRequest(message)) {
                this.captionWriteTail = this.captionWriteTail.then(() => this.handleCaptionWrite(widget, message));
            }
            if (this.isReviewTransportRequest(message)) {
                this.forwardReviewTransport(widget, message);
            }
            if (this.isReviewStrokeStartRequest(message)) {
                this.forwardReviewStrokeStart(widget, message);
            }
            if (this.isReviewStrokeEndRequest(message)) {
                this.forwardReviewStrokeEnd(widget, message);
            }
            if (this.isReviewRectStartRequest(message)) {
                this.forwardReviewRectStart(widget, message);
            }
            if (this.isReviewRectEndRequest(message)) {
                this.forwardReviewRectEnd(widget, message);
            }
            if (this.isReviewToolModeRequest(message)) {
                this.forwardReviewToolModeRequest(widget, message);
            }
        }));
        const handleFilesChanged = (event: FileChangesEvent): void => {
            const tracked = widget.akariPreviewTrackedResources ?? new Set<string>();
            const trackedSuffixes = widget.akariPreviewTrackedSuffixes ?? new Set<string>();
            const captionsUri = widget.akariPreviewCaptionsUri;
            const captionsKey = captionsUri?.toString();
            const captionsSuffix = captionsUri ? this.resourceSuffix(captionsUri) : undefined;
            let captionsChanged = false;
            let previewChanged = false;
            let nonModelResourceChanged = false;
            const editKey = widget.akariPreviewEditUri?.toString();
            const editSuffix = widget.akariPreviewEditUri
                ? this.resourceSuffix(widget.akariPreviewEditUri) : undefined;
            for (const change of event.changes) {
                const key = change.resource.toString();
                // ワークスペースルートの watcher は登録時に realpath() で解決される
                // （@theia/filesystem の ParcelWatcher、拡張側からは変更不可）ため、シンボリック
                // リンクを跨ぐワークスペース（例: iCloud Desktop/Documents 同期）では通知される
                // URI の先頭が videoUri/editUri 生成時と食い違う。basename + 直上ディレクトリ名の
                // suffix 一致もフォールバックとして見る。
                const suffix = this.resourceSuffix(change.resource);
                const writtenAt = this.recentWriteAt(change.resource);
                if (key === captionsKey || (captionsSuffix !== undefined && suffix === captionsSuffix)) {
                    captionsChanged ||= Date.now() - writtenAt > RECENT_WRITE_WINDOW_MS;
                    continue;
                }
                if (tracked.has(key) || trackedSuffixes.has(suffix)) {
                    const externalChange = Date.now() - writtenAt > RECENT_WRITE_WINDOW_MS;
                    previewChanged ||= externalChange;
                    if (externalChange && key !== editKey && suffix !== editSuffix) {
                        nonModelResourceChanged = true;
                    }
                    continue;
                }
                previewChanged ||= !widget.akariPreviewEditUri && change.resource.path.base === 'edit.json';
            }
            if (captionsChanged) {
                this.queueCaptionsUpdate(widget);
            }
            if (previewChanged) {
                this.queueRefresh(widget, identityUri, kind, undefined, nonModelResourceChanged);
            }
        };
        // 書き込み完了の直接通知（watcher を待たない速い経路）。
        // watcher 経路は残したまま並走させ、こちらで処理した書き込みは recentWrites の窓で
        // 後から来る watcher イベントを落とす（= 同じ 1 回の編集で差分メッセージは 1 通だけ）。
        // 外部（CLI / 外部エディタ / AI パートナー）からの書き込みはこの通知が来ないので、
        // 従来どおり watcher 経路だけで更新される。
        const onEditStoreDidWrite = (event: Event): void => {
            if (kind !== 'output' || widget.isDisposed) {
                return;
            }
            const detail = (event as CustomEvent<{ uri?: unknown; content?: unknown }>).detail;
            if (typeof detail?.uri !== 'string' || typeof detail.content !== 'string') {
                return;
            }
            const editUri = widget.akariPreviewEditUri;
            if (!editUri) {
                return;
            }
            let written: URI;
            try {
                written = new URI(detail.uri);
            } catch {
                return;
            }
            // captions.json など edit.json 以外の直接通知は握らない（watcher 経路のまま）。
            // ここで recentWrites に印を付けてしまうと watcher 側まで落ちて更新が消えるため、
            // **一致した URI にだけ印を付ける**のが二重発火抑止と非回帰の両立点。
            if (written.toString() !== editUri.toString()
                && this.resourceSuffix(written) !== this.resourceSuffix(editUri)) {
                return;
            }
            this.markRecentWrite(written);
            this.markRecentWrite(editUri);
            this.queueRefresh(widget, identityUri, kind, undefined, false, detail.content);
        };
        window.addEventListener(EDIT_STORE_DID_WRITE_EVENT, onEditStoreDidWrite);
        disposables.push({
            dispose: () => window.removeEventListener(EDIT_STORE_DID_WRITE_EVENT, onEditStoreDidWrite)
        });
        for (const root of await this.workspaceService.roots) {
            disposables.push(await this.fileService.watch(root.resource, { recursive: true, excludes: [] }));
        }
        const videoUri = widget.akariPreviewVideoUri;
        if (videoUri && !(await this.isInsideWorkspace(videoUri))) {
            disposables.push(await this.fileService.watch(videoUri.parent, { recursive: true, excludes: [] }));
        }
        if (widget.isDisposed) {
            disposables.dispose();
            return;
        }
        // watch 登録時の初期イベントで、完成直後の HTML をもう一度ロードしない。
        // 実際のファイル変更は全 watch が確立した後から購読する。
        disposables.push(this.fileService.onDidFilesChange(handleFilesChanged));
        widget.disposed.connect(() => {
            disposables.dispose();
            if (previews.get(seekKey) === widget) {
                previews.delete(seekKey);
            }
            void this.disposePreviewStreams(widget);
        });
        const reviewEditUri = this.reviewEditUriForPreview(widget);
        const reviewState = reviewEditUri ? this.reviewSessionStateByEdit.get(reviewEditUri) : undefined;
        if (reviewState) {
            this.applyReviewSessionStateToPreview(widget, reviewState);
        }
    }

    protected isPlaybackTickRequest(message: any): message is PreviewPlaybackTickRequest {
        return message?.type === 'akari-preview-playback-tick'
            && Number.isFinite(message.time)
            && typeof message.playing === 'boolean'
            && (message.rate === undefined || (Number.isFinite(message.rate) && message.rate > 0));
    }

    protected forwardPlaybackTick(widget: PreviewWidgetMarker, message: PreviewPlaybackTickRequest): void {
        // editUri の有無に関わらず常時更新（HEVC フォールバックの再生位置復元用 — raw kind は
        // 下の reviewTransportByEdit に乗らないため、これが唯一の position 保持経路になる）。
        widget.akariPreviewLastKnownTime = message.time;
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            if (this.activeRawPreviewWidget === widget) {
                this.forwardRawPreviewAnnotationState(widget, 'playback');
            }
            return;
        }
        const normalizedEditUri = editUri.normalizePath().toString();
        const previous = this.reviewTransportByEdit.get(normalizedEditUri);
        this.reviewTransportByEdit.set(normalizedEditUri, {
            timelineT: message.time,
            playing: message.playing,
            rate: message.rate ?? previous?.rate ?? 1
        });
        this.reviewSessionRecorder?.handlePlaybackTick(normalizedEditUri, message.time, message.playing);
        window.dispatchEvent(new CustomEvent(PREVIEW_PLAYBACK_TICK_EVENT, {
            detail: {
                videoUri: normalizedEditUri,
                time: message.time,
                playing: message.playing
            }
        }));
    }

    protected forwardRawPreviewAnnotationState(
        widget: PreviewWidgetMarker,
        reason: 'focus' | 'playback'
    ): void {
        const mediaUri = widget.akariPreviewVideoUri?.normalizePath().toString();
        if (!mediaUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(RAW_PREVIEW_ANNOTATION_STATE_EVENT, {
            detail: {
                active: true,
                activation: this.rawPreviewActivation,
                mediaUri,
                sourceT: Number.isFinite(widget.akariPreviewLastKnownTime)
                    ? Math.max(0, widget.akariPreviewLastKnownTime!)
                    : 0,
                reason
            }
        }));
    }

    protected syncRawPreviewAnnotationContext(): void {
        const mainWidget = this.shell.getCurrentWidget('main');
        const rawWidget = [...this.openPreviews.values()].find(widget => widget === mainWidget);
        const transition = transitionRawPreviewFocus({
            activation: this.rawPreviewActivation,
            activeWidgetId: this.activeRawPreviewWidget?.id
        }, rawWidget?.id);
        if (!transition.changed) {
            return;
        }
        this.rawPreviewActivation = transition.activation;
        this.activeRawPreviewWidget = rawWidget;
        if (rawWidget) {
            this.forwardRawPreviewAnnotationState(rawWidget, 'focus');
            return;
        }
        window.dispatchEvent(new CustomEvent(RAW_PREVIEW_ANNOTATION_STATE_EVENT, {
            detail: { active: false, activation: this.rawPreviewActivation, reason: 'focus' }
        }));
    }

    protected isReviewTransportRequest(message: any): message is PreviewReviewTransportRequest {
        const event = message?.event;
        if (message?.type !== 'akari-preview-review-transport-event' || !event) {
            return false;
        }
        if ((event.type === 'play' || event.type === 'pause')
            && Number.isFinite(event.timelineT)) {
            return true;
        }
        if (event.type === 'seek' && Number.isFinite(event.from) && Number.isFinite(event.to)) {
            return true;
        }
        return event.type === 'rate' && Number.isFinite(event.value) && event.value > 0
            && Number.isFinite(event.timelineT);
    }

    protected forwardReviewTransport(widget: PreviewWidgetMarker, message: PreviewReviewTransportRequest): void {
        const editUri = widget.akariPreviewEditUri?.normalizePath().toString();
        if (!editUri) {
            return;
        }
        const previous = this.reviewTransportByEdit.get(editUri) ?? {
            timelineT: 0,
            playing: false,
            rate: 1
        };
        const change = message.event;
        if (change.type === 'play' || change.type === 'pause') {
            previous.timelineT = change.timelineT;
            previous.playing = change.type === 'play';
        } else if (change.type === 'seek') {
            previous.timelineT = change.to;
        } else {
            previous.timelineT = change.timelineT;
            previous.rate = change.value;
        }
        this.reviewTransportByEdit.set(editUri, previous);
        this.reviewSessionRecorder?.handleTransport(editUri, change);
    }

    protected isReviewStrokeStartRequest(message: any): message is PreviewReviewStrokeStartRequest {
        const frame = message?.frame;
        return message?.type === 'akari-preview-review-stroke-start'
            && Number.isFinite(frame?.timelineT)
            && Number.isFinite(frame?.sourceT)
            && (frame?.cutIndex === null
                || (Number.isInteger(frame?.cutIndex) && frame.cutIndex >= 0));
    }

    protected forwardReviewStrokeStart(
        widget: PreviewWidgetMarker,
        message: PreviewReviewStrokeStartRequest
    ): void {
        const editUri = this.reviewEditUriForPreview(widget);
        if (editUri) {
            this.reviewSessionRecorder?.handleStrokeStart(editUri, message.frame);
        }
    }

    protected isReviewStrokeEndRequest(message: any): message is PreviewReviewStrokeEndRequest {
        return message?.type === 'akari-preview-review-stroke-end'
            && Array.isArray(message.points);
    }

    protected forwardReviewStrokeEnd(
        widget: PreviewWidgetMarker,
        message: PreviewReviewStrokeEndRequest
    ): void {
        const editUri = this.reviewEditUriForPreview(widget);
        if (editUri) {
            this.reviewSessionRecorder?.handleStrokeEnd(editUri, message.points);
        }
    }

    // task.md 指示4: rect ツールの start/end -- pen の isReviewStrokeStartRequest/
    // forwardReviewStrokeStart と対をなす配線。
    protected isReviewRectStartRequest(message: any): message is PreviewReviewRectStartRequest {
        const frame = message?.frame;
        return message?.type === 'akari-preview-review-rect-start'
            && Number.isFinite(frame?.timelineT)
            && Number.isFinite(frame?.sourceT)
            && (frame?.cutIndex === null
                || (Number.isInteger(frame?.cutIndex) && frame.cutIndex >= 0));
    }

    protected forwardReviewRectStart(
        widget: PreviewWidgetMarker,
        message: PreviewReviewRectStartRequest
    ): void {
        const editUri = this.reviewEditUriForPreview(widget);
        if (editUri) {
            this.reviewSessionRecorder?.handleRectStart(editUri, message.frame);
        }
    }

    protected isReviewRectEndRequest(message: any): message is PreviewReviewRectEndRequest {
        const box = message?.box;
        return message?.type === 'akari-preview-review-rect-end'
            && Array.isArray(box) && box.length === 4 && box.every((value: unknown) => Number.isFinite(value));
    }

    protected forwardReviewRectEnd(
        widget: PreviewWidgetMarker,
        message: PreviewReviewRectEndRequest
    ): void {
        const editUri = this.reviewEditUriForPreview(widget);
        if (editUri) {
            this.reviewSessionRecorder?.handleRectEnd(editUri, message.box);
        }
    }

    // task.md 指示3: pen-toggle（既存入口）からの mode request。右パネルのボタン/ショートカット
    // と同じ ReviewSessionRecorder.setToolMode に着地させる（正本は host 側の 1 箇所のみ）。
    protected isReviewToolModeRequest(message: any): message is PreviewReviewToolModeRequest {
        return message?.type === 'akari-preview-review-tool-mode-request'
            && ['neutral', 'pen', 'rect', 'select'].includes(message?.mode);
    }

    protected forwardReviewToolModeRequest(
        widget: PreviewWidgetMarker,
        message: PreviewReviewToolModeRequest
    ): void {
        const editUri = this.reviewEditUriForPreview(widget);
        if (editUri) {
            this.reviewSessionRecorder?.setToolMode(editUri, message.mode);
        }
    }

    protected isOverlaySelectedRequest(message: any): message is PreviewOverlaySelectedRequest {
        return message?.type === 'akari-preview-overlay-selected'
            && (typeof message.overlayId === 'string' || message.overlayId === null);
    }

    protected forwardOverlaySelection(widget: PreviewWidgetMarker, message: PreviewOverlaySelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(PREVIEW_OVERLAY_SELECTED_EVENT, {
            detail: {
                videoUri: editUri.normalizePath().toString(),
                overlayId: message.overlayId
            }
        }));
    }

    protected isLayerSelectedRequest(message: any): message is PreviewLayerSelectedRequest {
        return message?.type === 'akari-preview-layer-selected'
            && (typeof message.layerId === 'string' || message.layerId === null);
    }

    protected forwardLayerSelection(widget: PreviewWidgetMarker, message: PreviewLayerSelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(PREVIEW_LAYER_SELECTED_EVENT, {
            detail: {
                editUri: editUri.normalizePath().toString(),
                layerId: message.layerId
            }
        }));
    }

    protected isCutSelectedRequest(message: any): message is PreviewCutSelectedRequest {
        return message?.type === 'akari-preview-cut-selected'
            && (typeof message.cutId === 'string' || message.cutId === null);
    }

    protected forwardCutSelection(widget: PreviewWidgetMarker, message: PreviewCutSelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(PREVIEW_CUT_SELECTED_EVENT, {
            detail: {
                editUri: editUri.normalizePath().toString(),
                cutId: message.cutId
            }
        }));
    }

    protected isCaptionSelectedRequest(message: any): message is PreviewCaptionSelectedRequest {
        return message?.type === 'akari-preview-caption-selected'
            && (typeof message.captionId === 'string' || message.captionId === null);
    }

    protected forwardCaptionSelection(widget: PreviewWidgetMarker, message: PreviewCaptionSelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(PREVIEW_CAPTION_SELECTED_EVENT, {
            detail: {
                editUri: editUri.normalizePath().toString(),
                captionId: message.captionId
            }
        }));
    }

    protected queueRefresh(
        widget: PreviewWidgetMarker,
        identityUri: URI,
        kind: 'raw' | 'output',
        seekTimeOverride?: number,
        forceRebuild = false,
        editSource?: string
    ): void {
        const previous = widget.akariPreviewRefresh ?? Promise.resolve();
        const refresh = (): Promise<void> => {
            const editUri = kind === 'output' ? widget.akariPreviewEditUri : undefined;
            const transport = editUri
                ? this.reviewTransportByEdit.get(editUri.normalizePath().toString())
                : undefined;
            // 裁定（第13報）は webview を再構築する場合だけ適用する: 直前の再生状態に関わらず
            // 一時停止、位置（timelineT）のみ復元する。差分更新は既存 DOM に message を送り、
            // シークも play/pause の変更も行わないため、再生位置と再生状態をそのまま保持する。
            return this.refreshPreview(
                widget,
                identityUri,
                kind,
                seekTimeOverride ?? transport?.timelineT,
                forceRebuild,
                editSource
            );
        };
        widget.akariPreviewRefresh = previous.then(
            refresh,
            refresh
        ).catch(error => console.error('[akari-preview] failed to refresh preview', error));
    }

    // basename + 直上ディレクトリ名からなる比較キー。ワークスペースルートの watcher が
    // realpath() 済みの絶対パスで通知してくる場合でも、シンボリックリンクを跨がない相対的な
    // 末尾は一致するため、tracked リソースの判定をこの suffix でも突き合わせられる。
    protected resourceSuffix(uri: URI): string {
        return `${uri.path.dir.base}/${uri.path.base}`;
    }

    /** 「今この URI へ書いた」印。URI キーと suffix キーの両方へ入れる（realpath 差の吸収）。 */
    protected markRecentWrite(uri: URI): void {
        const now = Date.now();
        this.recentWrites.set(uri.toString(), now);
        this.recentWrites.set(this.resourceSuffix(uri), now);
    }

    /** 直近の自己書き込み時刻。URI キーと suffix キーの新しい方を採る。 */
    protected recentWriteAt(uri: URI): number {
        return Math.max(
            this.recentWrites.get(uri.toString()) ?? 0,
            this.recentWrites.get(this.resourceSuffix(uri)) ?? 0
        );
    }

    protected queueCaptionsUpdate(widget: PreviewWidgetMarker): void {
        const previous = widget.akariPreviewCaptionsUpdate ?? Promise.resolve();
        widget.akariPreviewCaptionsUpdate = previous.then(async () => {
            const loaded = await this.loadPreviewCaptions(widget.akariPreviewCaptionsUri, widget.akariPreviewEditUri);
            const captions = normalizePreviewCaptionClock(
                loaded.captions,
                this.previewCaptionTimelineSegments(
                    widget.akariPreviewSummary?.cuts ?? [],
                    widget.akariPreviewSummary?.output?.fps
                )
            );
            widget.sendMessage({ type: 'akari-preview-captions-update', captions });
        }).catch(error => console.error('[akari-preview] failed to update captions', error));
    }

    /**
     * 未焼成 telop をプレビューの open 臨界経路から外す。初期 DOM は proxyMissing の
     * video 要素を持ち、完了時だけ既存 model-update チャンネルでその要素へ src を差す。
     */
    protected startDeferredTelopRasters(widget: PreviewWidgetMarker, model: PreviewModel): void {
        const tasks = model.deferredTelops ?? [];
        widget.akariPreviewDeferredTelopExpected = new Map(tasks.map(task => [task.layerId, task.key]));
        if (tasks.length === 0) return;
        const pending = widget.akariPreviewDeferredTelopPending ?? new Set<string>();
        const ready = widget.akariPreviewDeferredTelopReady
            ?? new Map<string, { key: string; stream: { id: string; url: string } }>();
        widget.akariPreviewDeferredTelopPending = pending;
        widget.akariPreviewDeferredTelopReady = ready;

        for (const task of tasks) {
            const cached = ready.get(task.layerId);
            if (cached?.key === task.key) {
                if (!this.applyDeferredTelopStream(widget, task, cached.stream)) {
                    ready.delete(task.layerId);
                    void this.disposeAssetStreams([cached.stream.id]);
                }
                continue;
            }
            if (pending.has(task.key)) continue;
            pending.add(task.key);
            void this.previewService.rasterizeTelopPreview(task.request).then(stream => {
                pending.delete(task.key);
                if (widget.isDisposed
                    || widget.akariPreviewDeferredTelopExpected?.get(task.layerId) !== task.key) {
                    return this.disposeAssetStreams([stream.id]);
                }
                if (!this.applyDeferredTelopStream(widget, task, stream)) {
                    return this.disposeAssetStreams([stream.id]);
                }
                ready.set(task.layerId, { key: task.key, stream });
                return undefined;
            }).catch(error => {
                pending.delete(task.key);
                if (widget.akariPreviewDeferredTelopExpected?.get(task.layerId) === task.key) {
                    console.warn(`[akari-preview] telop ${task.layerId} の非同期描画に失敗しました`, error);
                }
            });
        }
    }

    protected applyDeferredTelopStream(
        widget: PreviewWidgetMarker,
        task: DeferredTelopPreview,
        stream: { id: string; url: string }
    ): boolean {
        const summary = widget.akariPreviewSummary;
        if (!summary || widget.isDisposed
            || widget.akariPreviewDeferredTelopExpected?.get(task.layerId) !== task.key) return false;
        const index = summary.layers.findIndex(layer => layer.id === task.layerId);
        if (index < 0) return false;
        const layers = [...summary.layers];
        layers[index] = { ...layers[index], src: stream.url, proxyMissing: false };
        const nextSummary = { ...summary, layers };
        widget.akariPreviewSummary = nextSummary;
        widget.akariPreviewAssetStreamIds ??= [];
        if (!widget.akariPreviewAssetStreamIds.includes(stream.id)) {
            widget.akariPreviewAssetStreamIds.push(stream.id);
        }
        widget.sendMessage({ type: 'akari-preview-model-update', summary: nextSummary });
        return true;
    }

    protected previewModelSnapshot(model: PreviewModel, assets: OverlayRuntimeAssets): PreviewModelDiffInput {
        const assetUrlByUri = model.assetUrlByUri ?? new Map<string, string>();
        const replacements = [...assetUrlByUri.entries()].map(([uri, url]) => [url, `akari-asset:${uri}`] as const);
        return {
            sourceUris: [...(model.sourcesById ?? new Map<string, { uri: URI; proxyUri?: URI }>())].map(([id, value]) =>
                `${id}=${value.uri.toString()}|proxy=${value.proxyUri?.toString() ?? ''}`),
            assetUris: model.assetUris.map(uri => uri.toString()),
            overlayUris: model.overlayUris.map(uri => uri.toString()),
            output: { ...model.summary.output },
            overlayRuntimeAssets: [
                assets.threeJavaScript,
                assets.threeRuntimeJavaScript,
                assets.videoFxJavaScript,
                assets.runtimeJavaScript,
                assets.interactionJavaScript,
                assets.interactionCss,
                assets.webviewKernelJavaScript,
                assets.captionFontDataUri
            ],
            captions: model.captions,
            emphasisWords: model.emphasisWords ?? [],
            summary: this.replacePreviewAssetUrls(model.summary, replacements) as PreviewModelDiffInput['summary']
        };
    }

    protected replacePreviewAssetUrls(value: unknown, replacements: ReadonlyArray<readonly [string, string]>): unknown {
        if (typeof value === 'string') {
            let result = value;
            for (const [from, to] of replacements) {
                if (from) result = result.split(from).join(to);
            }
            return result;
        }
        if (Array.isArray(value)) {
            return value.map(item => this.replacePreviewAssetUrls(item, replacements));
        }
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value as Record<string, unknown>)
                .map(([key, item]) => [key, this.replacePreviewAssetUrls(item, replacements)]));
        }
        return value;
    }

    protected summaryWithPreviousAssetUrls(widget: PreviewWidgetMarker, model: PreviewModel): EditSummary {
        const previous = widget.akariPreviewAssetUrlByUri ?? new Map<string, string>();
        const replacements: Array<readonly [string, string]> = [];
        for (const [uri, nextUrl] of model.assetUrlByUri ? [...model.assetUrlByUri] : []) {
            const previousUrl = previous.get(uri);
            if (previousUrl && previousUrl !== nextUrl) replacements.push([nextUrl, previousUrl]);
        }
        return this.replacePreviewAssetUrls(model.summary, replacements) as EditSummary;
    }

    protected getOverlayRuntimeAssets(): Promise<OverlayRuntimeAssets> {
        if (!this.overlayRuntimeAssetsPromise) {
            const cached = this.previewService.getOverlayRuntimeAssets().catch(error => {
                if (this.overlayRuntimeAssetsPromise === cached) {
                    this.overlayRuntimeAssetsPromise = undefined;
                }
                throw error;
            });
            this.overlayRuntimeAssetsPromise = cached;
        }
        return this.overlayRuntimeAssetsPromise;
    }

    protected async refreshPreview(
        widget: PreviewWidgetMarker,
        identityUri: URI,
        kind: 'raw' | 'output',
        initialSeekTime?: number,
        forceRebuild = false,
        editSource?: string
    ): Promise<void> {
        if (widget.isDisposed) {
            return;
        }
        const [model, assets] = await Promise.all([
            kind === 'output' ? this.loadPreviewModel(identityUri, editSource) : this.loadRawPreviewModel(identityUri),
            this.getOverlayRuntimeAssets()
        ]);
        const nextSnapshot = this.previewModelSnapshot(model, assets);
        if (!forceRebuild && kind === 'output' && widget.akariPreviewModelSnapshot) {
            const updateKind = classifyPreviewModelUpdate(widget.akariPreviewModelSnapshot, nextSnapshot);
            if (updateKind === 'none') {
                this.startDeferredTelopRasters(widget, model);
                await this.disposeAssetStreams(model.assetStreamIds);
                return;
            }
            if (updateKind === 'incremental') {
                const summary = this.summaryWithPreviousAssetUrls(widget, model);
                widget.akariPreviewModelSnapshot = nextSnapshot;
                widget.akariPreviewSummary = summary;
                // cut map の変更は source-domain 字幕の output 区間も変える。モデル差分と同じ
                // 読込で正規化した cue を先に送り、model-update 内の同期 tick が古い字幕を
                // 1 フレーム描く余地を残さない。
                widget.sendMessage({ type: 'akari-preview-captions-update', captions: model.captions });
                widget.sendMessage({ type: 'akari-preview-model-update', summary });
                this.startDeferredTelopRasters(widget, model);
                await this.disposeAssetStreams(model.assetStreamIds);
                return;
            }
        }
        const videoUri = kind === 'output' ? model.sourceUri : identityUri;
        if (!videoUri) {
            await this.disposeAssetStreams(model.assetStreamIds);
            if (model.emptyProject) {
                this.showMessageCard(widget, identityUri, EMPTY_PROJECT_MESSAGE, identityUri, kind);
                return;
            }
            throw new Error(`${identityUri.toString()} の source.path を解決できませんでした。`);
        }
        const extension = videoUri.path.ext.toLowerCase();
        const mimeType = PLAYABLE_VIDEO_MIME_TYPES.get(extension);
        // 静止画 cut ソース（docs/contract-2026-08-12-still-image-cut-source-v0.md のシェル対応）:
        // 代表ソースが画像でもプレビューできる。<video> ではなく webview の
        // #preview-still + 壁時計クロック（gap セグメントと同じ機構）で表示する。
        // 判定は layers[] と同じ拡張子のみ（isImageLayerSrc）。raw プレビューは対象外。
        const primaryIsStillImage = kind === 'output' && isImageLayerSrc(videoUri.path.base);
        if (!mimeType && !primaryIsStillImage) {
            await this.disposeAssetStreams(model.assetStreamIds);
            this.showMessageCard(widget, videoUri, UNSUPPORTED_FORMAT_MESSAGE, identityUri, kind);
            return;
        }
        if (!(await this.isInsideWorkspace(videoUri))) {
            await this.disposeAssetStreams(model.assetStreamIds);
            this.showMessageCard(widget, videoUri, OUTSIDE_WORKSPACE_MESSAGE, identityUri, kind);
            return;
        }
        if (widget.isDisposed) {
            await this.disposeAssetStreams(model.assetStreamIds);
            return;
        }
        // HEVC (H.265) sources are unlikely to decode on Windows (see the win portability
        // audit §HEVC プレビュー in the internal repo). streamVideoUri is
        // what actually gets streamed to <video>; videoUri itself (source identity: captions
        // lookup, file watch, seek commands, title) stays untouched below.
        // 静止画は HEVC 検出（resolveStreamVideoUri）の対象外。ストリームも <video> 用では
        // なく画像レイヤーと同じ asset ストリームで配信する（同一ローカルサーバ由来なので
        // CSP は据え置きでよい）。
        const streamVideoUri = primaryIsStillImage ? videoUri : await this.resolveStreamVideoUri(videoUri, model);
        // task/2026-08-10-preview-bug-sweep (B1): ffprobe ground truth for the audio-detected
        // notice, run alongside createVideoStream so it adds no extra latency to open. Never
        // allowed to fail the whole open — an unknown result just suppresses the notice below.
        // 静止画に音声ストリームが無いのは仕様（契約 §2.2）であって異常ではないため、
        // probe せず「未確定」を渡して無音検知の通知を出させない。
        const [videoStream, hasSourceAudio] = await Promise.all([
            (primaryIsStillImage
                ? this.previewService.createAssetStream({ assetUri: streamVideoUri.toString() })
                : this.previewService.createVideoStream({ videoUri: streamVideoUri.toString() })
            ).catch(async (error: unknown) => {
                await this.disposeAssetStreams(model.assetStreamIds);
                throw error;
            }),
            primaryIsStillImage
                ? Promise.resolve<boolean | undefined>(undefined)
                : this.previewService.probeAudioPresence({ videoUri: videoUri.toString() })
                    .then(result => result.hasAudio)
                    .catch(() => undefined)
        ]);
        // v1 マルチソース: 代表ソース以外の cuts[].src 先も webview から再生できるよう
        // それぞれストリームを開く（代表ソースは上の videoStream を再利用）。
        // 全ストリームは同一のローカルサーバ由来なので CSP の media-src は据え置きでよい。
        // 静止画ソースは <video> に流せないため別表（imageSourceUrlById）に分け、webview は
        // この表にあるセグメントを #preview-still で表示する。
        const extraVideoStreams = new Map<string, { id: string; url: string }>();
        const imageAssetStreams = new Map<string, { id: string; url: string }>();
        const sourceUrlById: Record<string, string> = {};
        const imageSourceUrlById: Record<string, string> = {};
        if (kind === 'output' && model.sourcesById) {
            for (const [sourceId, entry] of model.sourcesById) {
                if (model.sourceUri && entry.uri.toString() === model.sourceUri.toString()) {
                    if (primaryIsStillImage) {
                        imageSourceUrlById[sourceId] = videoStream.url;
                    } else {
                        sourceUrlById[sourceId] = videoStream.url;
                    }
                    continue;
                }
                const entryIsStillImage = isImageLayerSrc(entry.uri.path.base);
                if ((!entryIsStillImage && !PLAYABLE_VIDEO_MIME_TYPES.has(entry.uri.path.ext.toLowerCase()))
                    || !(await this.isInsideWorkspace(entry.uri))) {
                    console.warn('[akari-preview] sources[] の素材を再生できません（形式か配置）', entry.uri.toString());
                    continue;
                }
                try {
                    if (entryIsStillImage) {
                        // 同じ画像を複数の source id が指すことがあるため URI 単位で使い回す
                        const key = entry.uri.toString();
                        let stream = imageAssetStreams.get(key);
                        if (!stream) {
                            stream = await this.previewService.createAssetStream({ assetUri: key });
                            imageAssetStreams.set(key, stream);
                        }
                        imageSourceUrlById[sourceId] = stream.url;
                        continue;
                    }
                    const streamUri = await this.resolveStreamVideoUri(entry.uri, model);
                    const stream = await this.previewService.createVideoStream({ videoUri: streamUri.toString() });
                    extraVideoStreams.set(sourceId, stream);
                    sourceUrlById[sourceId] = stream.url;
                } catch (error) {
                    console.warn('[akari-preview] sources[] のストリームを開けませんでした', entry.uri.toString(), error);
                }
            }
        }
        // このリフレッシュで開いた全ストリームの後始末（widget が先に破棄された場合用）。
        // 代表ストリームは静止画なら asset ストリームなので disposer を選び分ける。
        const disposeAcquiredStreams = async () => {
            await Promise.all([
                primaryIsStillImage
                    ? this.disposeAssetStreams([videoStream.id])
                    : this.disposeVideoStreamId(videoStream.id),
                ...[...extraVideoStreams.values()].map(stream => this.disposeVideoStreamId(stream.id)),
                this.disposeAssetStreams([...imageAssetStreams.values()].map(stream => stream.id)),
                this.disposeAssetStreams(model.assetStreamIds)
            ]);
        };
        if (widget.isDisposed) {
            await disposeAcquiredStreams();
            return;
        }
        await this.disposePreviewStreams(widget);
        if (widget.isDisposed) {
            await disposeAcquiredStreams();
            return;
        }
        widget.akariPreviewStreamId = primaryIsStillImage ? undefined : videoStream.id;
        widget.akariPreviewExtraStreamIds = [...extraVideoStreams.values()].map(stream => stream.id);
        widget.akariPreviewAssetStreamIds = [
            ...model.assetStreamIds,
            ...(primaryIsStillImage ? [videoStream.id] : []),
            ...[...imageAssetStreams.values()].map(stream => stream.id)
        ];
        widget.akariPreviewEditUri = model.editUri;
        widget.akariPreviewRelatedEditUri = model.relatedEditUri;
        widget.akariPreviewVideoUri = videoUri;
        widget.akariPreviewFallbackSourceUris = new Set([
            videoUri.toString(),
            ...[...(model.sourcesById?.values() ?? [])].map(source => source.uri.toString()),
            ...model.summary.layers.flatMap(layer => layer.sourceUri ? [layer.sourceUri] : [])
        ]);
        widget.akariPreviewCaptionsUri = model.captionsUri;
        const trackedUris = [
            ...(model.editUri ? [model.editUri] : []),
            ...(model.relatedEditUri ? [model.relatedEditUri] : []),
            ...(model.captionsUri ? [model.captionsUri] : []),
            ...model.overlayUris,
            ...model.assetUris
        ];
        widget.akariPreviewTrackedResources = new Set(trackedUris.map(uri => uri.toString()));
        widget.akariPreviewTrackedSuffixes = new Set(trackedUris.map(uri => this.resourceSuffix(uri)));
        widget.viewType = 'akari.preview';
        widget.title.label = kind === 'output' ? '出力プレビュー' : videoUri.path.base;
        widget.title.caption = kind === 'output' ? identityUri.toString() : videoUri.toString();
        widget.title.iconClass = 'codicon codicon-preview';
        widget.setContentOptions({
            allowScripts: true,
            allowForms: true
        });
        widget.akariPreviewSeekable = true;
        const hasScopedSession = widget.akariPreviewHiddenTracksByScope !== undefined
            || widget.akariPreviewMutedTracksByScope !== undefined
            || widget.akariPreviewAllTracksHiddenScopes !== undefined
            || widget.akariPreviewAllTracksMutedScopes !== undefined;
        if (!hasScopedSession) {
            const hiddenCuts = new Set<number>();
            const hiddenLayers = new Set<number>();
            const mutedCuts = new Set<number>();
            const mutedAudio = new Set<number>();
            model.summary.tracks?.cuts?.forEach((track, index) => {
                if (track.hidden === true) hiddenCuts.add(index);
                if (track.muted === true) mutedCuts.add(index);
            });
            model.summary.tracks?.layers?.forEach((track, index) => {
                if (track.hidden === true) hiddenLayers.add(index);
            });
            model.summary.tracks?.audio?.forEach((track, index) => {
                if (track.muted === true) mutedAudio.add(index);
            });
            widget.akariPreviewHiddenTracksByScope = { cuts: [...hiddenCuts], layers: [...hiddenLayers] };
            widget.akariPreviewMutedTracksByScope = { cuts: [...mutedCuts], audio: [...mutedAudio] };
            widget.akariPreviewAllTracksHiddenScopes = [];
            widget.akariPreviewAllTracksMutedScopes = [];
        }
        model.session = {
            muted: widget.akariPreviewMuted ?? false,
            captionsVisible: widget.akariPreviewCaptionsVisible ?? true,
            hiddenTracks: [...(widget.akariPreviewHiddenTracks ?? new Set<number>())],
            hiddenTracksByScope: {
                cuts: [...(widget.akariPreviewHiddenTracksByScope?.cuts ?? [])],
                layers: [...(widget.akariPreviewHiddenTracksByScope?.layers ?? [])],
                audio: [...(widget.akariPreviewHiddenTracksByScope?.audio ?? [])]
            },
            mutedTracksByScope: {
                cuts: [...(widget.akariPreviewMutedTracksByScope?.cuts ?? [])],
                audio: [...(widget.akariPreviewMutedTracksByScope?.audio ?? [])],
                layers: [...(widget.akariPreviewMutedTracksByScope?.layers ?? [])]
            },
            allTracksHiddenScopes: [...(widget.akariPreviewAllTracksHiddenScopes ?? [])],
            allTracksMutedScopes: [...(widget.akariPreviewAllTracksMutedScopes ?? [])]
        };
        if (model.editUri) {
            this.previewSessionSettings.set(model.editUri.normalizePath().toString(), {
                muted: model.session.muted,
                captionsVisible: model.session.captionsVisible,
                hiddenTracks: new Set(model.session.hiddenTracks),
                hiddenTracksByScope: {
                    cuts: new Set(model.session.hiddenTracksByScope.cuts),
                    layers: new Set(model.session.hiddenTracksByScope.layers),
                    audio: new Set(model.session.hiddenTracksByScope.audio)
                },
                mutedTracksByScope: {
                    cuts: new Set(model.session.mutedTracksByScope.cuts),
                    audio: new Set(model.session.mutedTracksByScope.audio),
                    layers: new Set(model.session.mutedTracksByScope.layers)
                },
                allTracksHiddenByScope: {
                    cuts: model.session.allTracksHiddenScopes.includes('cuts'),
                    layers: model.session.allTracksHiddenScopes.includes('layers'),
                    audio: model.session.allTracksHiddenScopes.includes('audio')
                },
                allTracksMutedByScope: {
                    cuts: model.session.allTracksMutedScopes.includes('cuts'),
                    audio: model.session.allTracksMutedScopes.includes('audio'),
                    layers: model.session.allTracksMutedScopes.includes('layers')
                }
            });
        }
        widget.setHTML(this.prepareHtml(
            videoUri,
            videoStream.url,
            model,
            assets,
            initialSeekTime,
            sourceUrlById,
            hasSourceAudio,
            imageSourceUrlById,
            primaryIsStillImage
        ));
        widget.akariPreviewModelSnapshot = nextSnapshot;
        widget.akariPreviewAssetUrlByUri = new Map(model.assetUrlByUri ? [...model.assetUrlByUri] : []);
        widget.akariPreviewSummary = model.summary;
        this.startDeferredTelopRasters(widget, model);
    }

    // Picks the URI that actually gets streamed to <video>. task/2026-08-09-drop-hevc-proxy:
    // in principle this just returns the source as-is — <video> decodes HEVC in hardware fine on
    // the platforms actually measured (see the task's internal report), so probing/transcoding
    // proactively was pure unnecessary latency (it was the cause of the 10s open timeout, not a
    // safety net for it). An explicit edit.json sources[].proxy still wins for the exact matching
    // source across v0/v1/v2 (pipeline-declared, so it is authoritative). The only
    // other case where this returns something other than videoUri is when that exact source
    // already failed to play once in this session and a proxy was generated for it — see
    // handleHevcFallbackRequest, the sole place that calls previewService.resolveHevcProxy (and
    // therefore the sole place that can trigger an ffmpeg transcode). No probing happens here.
    protected async resolveStreamVideoUri(
        videoUri: URI,
        model: Pick<PreviewModel, 'sourcesById'>
    ): Promise<URI> {
        const cachedProxyUri = this.hevcFallbackProxyUris.get(videoUri.toString());
        const resolved = resolvePreferredVideoUri(
            videoUri.toString(),
            [...(model.sourcesById?.values() ?? [])].map(source => ({
                uri: source.uri.toString(),
                ...(source.proxyUri ? { proxyUri: source.proxyUri.toString() } : {})
            })),
            cachedProxyUri
        );
        return resolved === videoUri.toString() ? videoUri : new URI(resolved);
    }

    protected showMessageCard(
        widget: PreviewWidgetMarker,
        videoUri: URI,
        message: string,
        identityUri: URI,
        kind: 'raw' | 'output'
    ): void {
        widget.akariPreviewModelSnapshot = undefined;
        widget.akariPreviewAssetUrlByUri = undefined;
        widget.akariPreviewSummary = undefined;
        widget.akariPreviewDeferredTelopExpected = new Map();
        widget.akariPreviewSeekable = false;
        void this.disposePreviewStreams(widget);
        widget.akariPreviewEditUri = kind === 'output' ? identityUri : undefined;
        widget.akariPreviewRelatedEditUri = undefined;
        widget.akariPreviewVideoUri = videoUri;
        widget.akariPreviewFallbackSourceUris = new Set([videoUri.toString()]);
        widget.akariPreviewCaptionsUri = undefined;
        widget.akariPreviewTrackedResources = new Set(kind === 'output' ? [identityUri.toString()] : []);
        widget.akariPreviewTrackedSuffixes = new Set(kind === 'output' ? [this.resourceSuffix(identityUri)] : []);
        widget.viewType = 'akari.preview';
        widget.title.label = kind === 'output' ? '出力プレビュー' : videoUri.path.base;
        widget.title.caption = kind === 'output' ? identityUri.toString() : videoUri.toString();
        widget.title.iconClass = 'codicon codicon-preview';
        widget.setContentOptions({ allowScripts: false, allowForms: false });
        widget.setHTML(this.prepareMessageHtml(message));
    }

    protected async loadRawPreviewModel(videoUri: URI): Promise<PreviewModel> {
        const relatedEditUri = await this.findEditJson(videoUri);
        return {
            summary: EMPTY_SUMMARY,
            relatedEditUri,
            overlayUris: [],
            assetUris: [],
            assetStreamIds: [],
            captions: []
        };
    }

    /**
     * editSource は「書き込み完了の直接通知（EDIT_STORE_DID_WRITE_EVENT）に載ってきた
     * edit.json の全文」。渡された場合は edit.json の再読込（readText = backend への
     * ファイル読み出し）を丸ごと省く。
     *
     * 省けないもの（通知に載っていないので省略の根拠が無い）:
     *   - captions.json の読み出し（loadPreviewCaptions）— 別ファイルで、内容は通知に含まれない
     *   - overlay 断片 HTML の読み出し / 資産ストリームの生成（createAssetStream）—
     *     いずれも edit.json が参照する「別の実体」の解決であり、edit.json の全文からは導けない
     */
    protected async loadPreviewModel(editUri: URI, editSource?: string): Promise<PreviewModel> {
        const [workspaceRoot] = await this.workspaceService.roots;
        const captionsUri = locatePreviewCaptions(editUri, workspaceRoot?.resource);
        // 字幕の解決（resolveCaptionDisplay = backend RPC）は edit.json の内容にも依存するので
        // 通知に全文が載っていても省けない（captions.json は別ファイルで通知に含まれない）。
        // edit.json 読み出しとは先に並走させる。正規化時には captions 段の導出へ必要なので
        // await する（loadPreviewCaptions は内部で catch して [] を返すため reject しない）。
        const captionsPromise = this.loadPreviewCaptions(captionsUri, editUri);
        const assetStreams = new Map<string, { id: string; url: string }>();
        const assetUris: URI[] = [];
        let sourceUri: URI | undefined;
        let legacyEmphasisWords: unknown;
        const sourcesById = new Map<string, { uri: URI; proxyUri?: URI }>();
        try {
            // 版を知るのは読み込み層（readInternalEdit）だけ。v0（単一 source）も v1（sources[]）も
            // v2（tracks[].items[]）も、ここから先は同じ内部表現として扱う。
            let editText = editSource ?? await this.readText(editUri);
            const rawEdit = (() => {
                try { return JSON.parse(editText) as unknown; } catch { return undefined; }
            })();
            const rawVersion = rawEdit && typeof rawEdit === 'object' && !Array.isArray(rawEdit)
                ? (rawEdit as { version?: unknown }).version
                : undefined;
            const editKey = editUri.normalizePath().toString();
            const previousRawVersion = this.lastRawEditVersionByUri.get(editKey);
            if (rawVersion === 0 || rawVersion === 1 || rawVersion === 2) {
                this.lastRawEditVersionByUri.set(editKey, rawVersion);
            }
            const migrationTransition = (previousRawVersion === 0 || previousRawVersion === 1)
                && rawVersion === 2;
            if (migrationTransition && !this.migrationCompactionPrompted.has(editKey)) {
                this.migrationCompactionPrompted.add(editKey);
                const proposal = trackCompactionProposalAfterMigration(previousRawVersion, rawEdit);
                if (proposal) {
                    // MessageService をモデル読込の await 鎖へ入れるとシェル起動を止め得る。
                    // 移行後の書き込み通知を消費した次の macrotask で、一度だけ非同期に提案する。
                    window.setTimeout(() => {
                        void this.offerTrackCompaction(
                            editUri,
                            proposal.beforeTrackCount,
                            proposal.afterTrackCount
                        );
                    }, 0);
                }
            }
            // audio には projectLegacyAudioView があるが emphasisWords の共有射影は無い。
            // 凍結 migration 前の v0/v1 生 JSON から旧席だけを退避し、後方互換入力にする。
            legacyEmphasisWords = readLegacyEditEmphasisWords(rawEdit);
            if (rawVersion !== 2) {
                const prepared = await this.previewService.prepareLegacyEdit({ editUri: editUri.toString() });
                if ('blockers' in prepared) {
                    throw new TypeError(`このプロジェクトは変換できません: ${prepared.blockers.join(' / ')}`);
                }
                editText = prepared.nextText;
                this.messages.warn(
                    `edit.json version ${prepared.version} を読み取り専用でプレビュしています。`
                    + '元ファイルは変更されていません。タイムラインか `akari migrate` で変換できます。'
                );
            }
            // timeline.tracks 未宣言時の captions 段は captions.json の実在に依存する。
            // 先に字幕解決を確定し、埋め込み字幕と合わせて正規化読込へ渡す。
            const loadedCaptions = await captionsPromise;
            const captions = loadedCaptions.captions;
            const internal = readPreviewInternalEdit(editText, captions.length > 0);
            const emphasisWords = this.normalizeEmphasisWords(resolvePreviewEmphasisWords(
                loadedCaptions.emphasisWords,
                legacyEmphasisWords
            ));
            const trackIdByItem = new Map(internal.tracks.flatMap(track =>
                track.items.map(item => [item, track.id] as const)));
            const declaredSources = internal.sources;
            // ソースの宣言が 1 つも無い = 素材投入前の新規プロジェクト。壊れた宣言（path が
            // 非文字列など）とは区別し、ここでは投げずに空プロジェクトとして返す
            // （呼び出し側が案内カードを出す）。
            if (internal.emptyProject) {
                return {
                    editUri,
                    summary: EMPTY_SUMMARY,
                    sourcesById,
                    overlayUris: [],
                    assetUris: [],
                    assetStreamIds: [],
                    captionsUri,
                    captions: normalizePreviewCaptionClock(captions, []),
                    emphasisWords,
                    emptyProject: true
                };
            }
            for (const declared of declaredSources) {
                const declaredPath = declared.declaredPath;
                if (typeof declaredPath !== 'string' || !declaredPath.trim()) {
                    // 宣言位置（`sources[hero]` / `source`）は読み込み層が付ける。版名は出さない。
                    throw new TypeError(`edit.json の ${declared.declarationPath}.path が不正です。`);
                }
                if (!declared.id) {
                    throw new TypeError('edit.json の sources[].id が不正です。');
                }
                const uri = this.resolveEditAssetUri(declaredPath, editUri);
                let proxyUri: URI | undefined;
                const declaredProxy = declared.declaredProxy;
                if (typeof declaredProxy === 'string' && declaredProxy.trim()) {
                    const candidate = this.resolveEditAssetUri(declaredProxy, editUri);
                    proxyUri = await this.fileService.exists(candidate) ? candidate : undefined;
                }
                sourcesById.set(declared.id, { uri, ...(proxyUri ? { proxyUri } : {}) });
            }
            // 代表ソース（字幕の探索・ファイル監視・タイトル・単一ソース時の従来経路）は
            // 先頭カットが参照するソース。無ければ宣言順の先頭。
            const cutItems = collectItems(internal, 'cuts');
            const firstCutSourceId = cutItems
                .map(item => item.declaration.src)
                .find((id: unknown) => typeof id === 'string' && sourcesById.has(id)) as string | undefined;
            const primaryId = firstCutSourceId ?? [...sourcesById.keys()][0];
            sourceUri = sourcesById.get(primaryId)?.uri;
            const isTruthyObject = (value: unknown): boolean => Boolean(value)
                && typeof value === 'object' && !Array.isArray(value);
            const width = this.positiveNumber(internal.output.width, EMPTY_SUMMARY.output.width);
            const height = this.positiveNumber(internal.output.height, EMPTY_SUMMARY.output.height);
            const videoFxFailures = new Set<string>();
            const resolveChromaKey = async (
                raw: ChromaKeySummary | undefined,
                mode: 'source' | 'layer'
            ): Promise<VideoFxChromaKey | undefined> => {
                if (!raw) return undefined;
                let background: VideoFxBackground | undefined;
                if (mode === 'source') {
                    const declaredBackground = raw.background ?? '0x000000';
                    if (isPreviewColorLike(declaredBackground)) {
                        background = { type: 'color', color: declaredBackground };
                    } else {
                        try {
                            const backgroundUri = this.resolveEditAssetUri(declaredBackground, editUri);
                            const key = backgroundUri.toString();
                            let stream = assetStreams.get(key);
                            if (!stream) {
                                stream = await this.previewService.createAssetStream({ assetUri: key });
                                assetStreams.set(key, stream);
                                assetUris.push(backgroundUri);
                            }
                            background = { type: 'image', url: stream.url };
                        } catch (error) {
                            videoFxFailures.add('クロマキー');
                            console.warn('[akari-preview] chroma background could not be resolved', error);
                            return undefined;
                        }
                    }
                }
                return {
                    color: raw.color,
                    similarity: raw.similarity,
                    blend: raw.blend,
                    mode,
                    ...(background ? { background } : {})
                };
            };
            let look: EditSummaryVideoFx['look'];
            const rawLook = internal.output.look;
            if (isTruthyObject(rawLook) && typeof (rawLook as { lut?: unknown }).lut === 'string') {
                try {
                    look = {
                        cubeText: await this.previewService.readVideoFxLut({
                            projectRootUri: editUri.parent.toString(),
                            lutRef: (rawLook as { lut: string }).lut
                        }),
                        intensity: typeof (rawLook as { intensity?: unknown }).intensity === 'number'
                            ? Math.max(0, Math.min(1, (rawLook as { intensity: number }).intensity)) : 1
                    };
                } catch (error) {
                    videoFxFailures.add('LUT');
                    console.warn('[akari-preview] LUT could not be resolved; keeping the honest-preview badge', error);
                }
            }
            const sourceVideoFx: Record<string, VideoFxChromaKey> = {};
            for (const declared of declaredSources) {
                const resolved = await resolveChromaKey(normalizeChromaKeyForSummary(declared.chromaKey), 'source');
                if (resolved) sourceVideoFx[declared.id] = resolved;
            }
            const cuts: EditSummaryCut[] = [];
            for (const item of cutItems) {
                const value = item.declaration as any;
                const trackId = String(trackIdByItem.get(item) ?? '');
                // buildCutSummaryFields は akari-preview-open-handler.ts の外に出した純関数
                // （common/edit-summary-fields.ts）。crop/perspective 欠落バグ（2026-08-06）の
                // 再発防止として、この呼び出し自体を配線検査テストの対象にしている
                // （test/edit-summary-fields.test.mjs）。
                const result = buildCutSummaryFields(
                    value,
                    primaryId,
                    id => sourcesById.has(id),
                    v => this.transform(v),
                    (message, detail) => console.warn(message, detail)
                );
                if (result.ok && result.fields) {
                    const cutChromaKey = await resolveChromaKey(result.fields.chromaKey, 'source');
                    cuts.push({
                        id: item.id,
                        ...result.fields,
                        ...(cutChromaKey ? { chromaKey: cutChromaKey } : { chromaKey: undefined }),
                        trackId,
                        renderTrack: resolveInternalTrackZ(
                            internal.tracks,
                            trackId
                        )
                    } as EditSummaryCut);
                }
            }
            const overlays: EditSummaryOverlay[] = [];
            const overlayUris: URI[] = [];
            const unsupportedGltfWarnings: string[] = [];
            // 宣言レコードは読み込み層が版差を吸収済み。フィールドの検証は従来どおりここで行う。
            for (const item of collectItems(internal, 'overlays')) {
                const value = item.declaration as any;
                if (value?.track !== undefined && (!Number.isInteger(value.track) || value.track < 0)) {
                    console.warn('[akari-preview] overlay track が不正なため track 0 として表示します', value?.id);
                }
                const rawHtml = typeof value?.html === 'string' ? value.html : '';
                let html = rawHtml;
                if (rawHtml && !rawHtml.trimStart().startsWith('<')) {
                    const fragmentUri = editUri.parent.resolve(rawHtml);
                    overlayUris.push(fragmentUri);
                    try {
                        html = await this.readText(fragmentUri);
                    } catch (error) {
                        html = '';
                        console.warn(`[akari-preview] failed to read overlay fragment ${fragmentUri.toString()}`, error);
                    }
                }
                html = await this.resolveThreeSceneAssets(html, editUri, assetStreams, assetUris, unsupportedGltfWarnings);
                overlays.push({
                    id: String(value?.id ?? ''),
                    html,
                    start: this.finiteNumber(value?.start, 0),
                    duration: this.finiteNumber(value?.duration, 0),
                    track: Number.isInteger(value?.track) && value.track >= 0 ? value.track : 0,
                    trackId: String(trackIdByItem.get(item) ?? ''),
                    transform: this.transform(value?.transform),
                    vars: this.stringRecord(value?.vars),
                    params: this.stringRecord(value?.params)
                });
            }
            const layers: EditSummaryLayer[] = [];
            const filters: EditSummaryFilter[] = [];
            const deferredTelops: DeferredTelopPreview[] = [];
            let unsupportedBlendCount = 0;
            const layerItems = collectItems(internal, 'layers');
            const deferTelop = (item: typeof layerItems[number]): void => {
                if (item.source.kind !== 'telop') return;
                const request: RasterizeTelopPreviewRequest = {
                    preset: item.source.preset ?? '',
                    params: item.source.params,
                    duration: item.duration,
                    width,
                    height,
                    fps: internal.output.fps
                };
                deferredTelops.push({
                    layerId: item.id,
                    key: JSON.stringify({ layerId: item.id, request }),
                    request
                });
            };
            for (const item of layerItems) {
                if (item.source.kind === 'filter') {
                    filters.push({
                        id: item.id,
                        t: item.at,
                        duration: item.duration,
                        trackId: String(trackIdByItem.get(item) ?? ''),
                        track: Number.isInteger(item.declaration.track) && Number(item.declaration.track) >= 0
                            ? Number(item.declaration.track) : 0,
                        filter: item.source.filter as EditSummaryFilter['filter']
                    });
                    continue;
                }
                let value = item.declaration as any;
                const label = `layers[${item.legacy.index}]`;
                let deferredTelop = false;
                if (item.source.kind === 'telop' && item.source.baked === undefined) {
                    deferTelop(item);
                    deferredTelop = true;
                    value = { ...value, kind: 'baked', src: `deferred-telop:${item.id}` };
                }
                // buildLayerSummaryBase は akari-preview-open-handler.ts の外に出した純関数
                // （common/edit-summary-fields.ts）。crop/perspective 欠落バグ（2026-08-06
                // shell-summary-field-gap）の再発防止として、この呼び出し自体を配線検査テストの
                // 対象にしている（test/edit-summary-fields.test.mjs）。
                const result = buildLayerSummaryBase(
                    value,
                    label,
                    v => this.transform(v),
                    LAYER_BLEND_TO_CSS,
                    (message, detail) => console.warn(message, detail)
                );
                if (!result.ok || !result.base) {
                    continue;
                }
                if (result.unsupportedBlend) {
                    unsupportedBlendCount += 1;
                }
                const base: Omit<EditSummaryLayer, 'src' | 'proxyMissing' | 'isImage'> = {
                    ...result.base,
                    chromaKey: await resolveChromaKey(result.base.chromaKey, 'layer'),
                    trackId: String(trackIdByItem.get(item) ?? '')
                };
                if (deferredTelop) {
                    layers.push({
                        ...base,
                        proxyMissing: true,
                        deferredTelop: true,
                        isImage: false
                    });
                    continue;
                }
                let sourceUri: URI;
                try {
                    sourceUri = this.resolveEditAssetUri(value.src, editUri);
                } catch (error) {
                    console.warn(`[akari-preview] ${label} を無視しました（src を解決できません）`, error);
                    continue;
                }
                if (value.kind === 'baked') {
                    // 'baked' は常に previewProxyUri() の .preview.webm サイドカーを配信する（元の
                    // value.src の拡張子に関わらず）ため、isImage は常に false — このブランチの
                    // 挙動は本タスクで一切変えない（対象は 'video' kind の画像のみ、司令塔裁定1）。
                    const sidecarUri = this.previewProxyUri(sourceUri);
                    if (!assetUris.some(uri => uri.toString() === sidecarUri.toString())) {
                        assetUris.push(sidecarUri);
                    }
                    let src: string | undefined;
                    try {
                        if (await this.fileService.exists(sidecarUri)) {
                            const key = sidecarUri.toString();
                            let stream = assetStreams.get(key);
                            if (!stream) {
                                stream = await this.previewService.createAssetStream({ assetUri: key });
                                assetStreams.set(key, stream);
                            }
                            src = stream.url;
                        }
                    } catch (error) {
                        console.warn(`[akari-preview] ${label} の preview proxy を配信できません`, error);
                    }
                    // baked はキャッシュ。Chromium sidecar が無い場合は、初期モデルを待たせず
                    // 同じ preset/params の一時 rasterize をバックグラウンドへ回す。
                    if (!src && item.source.kind === 'telop') {
                        deferTelop(item);
                    }
                    layers.push({ ...base, ...(src ? { src } : {}), proxyMissing: !src, isImage: false });
                    continue;
                }

                try {
                    const isImage = isImageLayerSrc(value.src);
                    // v2 visual media items are projected into this same video-layer branch.
                    // Route them through the exact same declared-proxy/fallback selection as cuts;
                    // images remain byte-for-byte asset streams and never trigger video probing.
                    const streamUri = isImage
                        ? sourceUri
                        : await this.resolveStreamVideoUri(sourceUri, { sourcesById });
                    const key = streamUri.toString();
                    let stream = assetStreams.get(key);
                    if (!stream) {
                        stream = await this.previewService.createAssetStream({ assetUri: key });
                        assetStreams.set(key, stream);
                        assetUris.push(streamUri);
                    }
                    layers.push({
                        ...base,
                        src: stream.url,
                        ...(!isImage ? { sourceUri: sourceUri.toString() } : {}),
                        proxyMissing: false,
                        isImage
                    });
                } catch (error) {
                    console.warn(`[akari-preview] ${label} を無視しました（video レイヤーを配信できません）`, error);
                }
            }
            const normalizeTrackStates = (value: unknown): EditSummaryTrackState[] | undefined => {
                if (!Array.isArray(value)) {
                    return undefined;
                }
                return value.map(item => {
                    if (!item || typeof item !== 'object' || Array.isArray(item)) {
                        return {};
                    }
                    const state = item as { muted?: unknown; hidden?: unknown };
                    return {
                        ...(typeof state.muted === 'boolean' ? { muted: state.muted } : {}),
                        ...(typeof state.hidden === 'boolean' ? { hidden: state.hidden } : {})
                    };
                });
            };
            const declaredTrackStates = internal.declaration.trackStates;
            const rawTracks = declaredTrackStates && typeof declaredTrackStates === 'object'
                && !Array.isArray(declaredTrackStates)
                ? declaredTrackStates as { cuts?: unknown; layers?: unknown; audio?: unknown } : undefined;
            const cutTracks = normalizeTrackStates(rawTracks?.cuts);
            const layerTracks = normalizeTrackStates(rawTracks?.layers);
            const audioTracks = normalizeTrackStates(rawTracks?.audio);
            const tracks: EditSummaryTracks | undefined = cutTracks || layerTracks || audioTracks ? {
                ...(cutTracks ? { cuts: cutTracks } : {}),
                ...(layerTracks ? { layers: layerTracks } : {}),
                ...(audioTracks ? { audio: audioTracks } : {})
            } : undefined;
            // 宣言トラック（z の権威 = 配列順）。読み込み層が正規化した並びをそのまま使う。
            const captionTrackOrder = resolvePreviewCaptionTrackOrder(
                internal.tracks,
                captions.length > 0 || hasInlineCaptions(internal)
            );
            const timelineTracks: EditSummaryTimelineTrack[] = captionTrackOrder.tracks;
            const captionTrackId = captionTrackOrder.captionTrackId;
            const audio = await this.resolveAudioAssets(
                projectLegacyAudioView(internal), editUri, assetStreams, assetUris
            );
            const indicators: string[] = [];
            indicators.push(...videoFxFailures);
            const missingProxyCount = layers.filter(layer => layer.kind === 'baked' && layer.proxyMissing).length;
            if (missingProxyCount > 0) {
                indicators.push(`テロップ ${missingProxyCount}枚（プレビュー用プロキシ未生成）`);
            }
            if (unsupportedBlendCount > 0) {
                indicators.push(`素材合成モードが未対応（${unsupportedBlendCount}件、normal で近似）`);
            }
            if (isTruthyObject((internal.declaration.audio as { master?: unknown } | undefined)?.master)) {
                indicators.push('音声マスター処理');
            }
            if (cutItems.some(item =>
                (item.declaration as { transition_out?: { type?: unknown } }).transition_out?.type === 'dissolve')) {
                indicators.push('ディゾルブ切り替え');
            }
            indicators.push(...unsupportedGltfWarnings);
            const outputCaptions = normalizePreviewCaptionClock(
                captions,
                this.previewCaptionTimelineSegments(cuts, internal.output.fps)
            );
            return {
                editUri,
                sourceUri,
                sourcesById,
                overlayUris,
                assetUris,
                assetStreamIds: [...assetStreams.values()].map(stream => stream.id),
                ...(deferredTelops.length > 0 ? { deferredTelops } : {}),
                assetUrlByUri: new Map([...assetStreams].map(([uri, stream]) => [uri, stream.url])),
                captionsUri,
                captions: outputCaptions,
                emphasisWords,
                summary: {
                    output: { width, height, fps: this.positiveNumber(internal.output.fps, 30) },
                    overlays,
                    layers,
                    filters,
                    cuts,
                    indicators,
                    ...(audio ? { audio } : {}),
                    ...(tracks ? { tracks } : {}),
                    timelineTracks,
                    ...(captionTrackId ? { captionTrackId } : {}),
                    ...(captions.length > 0 || hasInlineCaptions(internal) ? { hasCaptions: true } : {}),
                    ...(hasInlineCaptions(internal) ? { hasInlineCaptions: true } : {}),
                    ...((look || Object.keys(sourceVideoFx).length > 0 || layers.some(layer => layer.chromaKey))
                        ? { videoFx: { ...(look ? { look } : {}), sources: sourceVideoFx } } : {})
                }
            };
        } catch (error) {
            await this.disposeAssetStreams([...assetStreams.values()].map(stream => stream.id));
            if (!sourceUri) {
                throw error;
            }
            console.warn(`[akari-preview] failed to load composite data from ${editUri.toString()}; opening source only`, error);
            const loadedCaptions = await captionsPromise;
            return {
                editUri,
                sourceUri,
                sourcesById,
                summary: EMPTY_SUMMARY,
                overlayUris: [],
                assetUris: [],
                assetStreamIds: [],
                captionsUri,
                captions: normalizePreviewCaptionClock(loadedCaptions.captions, []),
                emphasisWords: this.normalizeEmphasisWords(resolvePreviewEmphasisWords(
                    loadedCaptions.emphasisWords,
                    legacyEmphasisWords
                ))
            };
        }
    }

    protected async resolveAudioAssets(
        value: unknown,
        editUri: URI,
        assetStreams: Map<string, { id: string; url: string }>,
        assetUris: URI[]
    ): Promise<EditSummaryAudio | undefined> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            if (value !== undefined) {
                console.warn('[akari-preview] audio セクションを無視しました（object ではありません）');
            }
            return undefined;
        }
        const audio = value as { bgm?: unknown; sfx?: unknown; narration?: unknown };
        const resolveSource = async (pathValue: unknown, label: string): Promise<string | undefined> => {
            if (typeof pathValue !== 'string' || !pathValue.trim()) {
                console.warn(`[akari-preview] ${label} を無視しました（path 不正）`);
                return undefined;
            }
            const assetUri = this.resolveEditAssetUri(pathValue, editUri);
            const key = assetUri.toString();
            try {
                let stream = assetStreams.get(key);
                if (!stream) {
                    stream = await this.previewService.createAssetStream({ assetUri: key });
                    assetStreams.set(key, stream);
                    assetUris.push(assetUri);
                }
                return stream.url;
            } catch (error) {
                console.warn(`[akari-preview] ${label} を無視しました（音声ファイルを配信できません）`, error);
                return undefined;
            }
        };
        const gainDb = (gainValue: unknown, label: string): number | undefined => {
            if (gainValue === undefined) {
                return 0;
            }
            if (typeof gainValue !== 'number' || !Number.isFinite(gainValue)) {
                console.warn(`[akari-preview] ${label} を無視しました（gain_db が非有限または number ではありません）`);
                return undefined;
            }
            const clamped = Math.max(-60, Math.min(12, gainValue));
            if (clamped !== gainValue) {
                console.warn(`[akari-preview] ${label}.gain_db を [-60, 12] にクランプしました`, gainValue);
            }
            return clamped;
        };
        const timed = async (items: unknown, kind: 'sfx' | 'narration'): Promise<EditSummaryTimedAudio[]> => {
            if (items === undefined) {
                return [];
            }
            if (!Array.isArray(items)) {
                console.warn(`[akari-preview] audio.${kind} を無視しました（array ではありません）`);
                return [];
            }
            const resolved: EditSummaryTimedAudio[] = [];
            for (let index = 0; index < items.length; index += 1) {
                const item = items[index] as {
                    id?: unknown;
                    path?: unknown;
                    t?: unknown;
                    gain_db?: unknown;
                    track?: unknown;
                    in?: unknown;
                    out?: unknown;
                    fade_in?: unknown;
                    fade_out?: unknown;
                } | undefined;
                const label = kind === 'narration' && typeof item?.id === 'string' && item.id
                    ? `audio.narration ${item.id}`
                    : `audio.${kind}[${index}]`;
                if (!item || typeof item !== 'object') {
                    console.warn(`[akari-preview] ${label} を無視しました（object ではありません）`);
                    continue;
                }
                if (kind === 'narration' && (typeof item.id !== 'string' || !item.id)) {
                    console.warn(`[akari-preview] ${label} を無視しました（id 不正）`);
                    continue;
                }
                if (typeof item.t !== 'number' || !Number.isFinite(item.t) || item.t < 0) {
                    console.warn(`[akari-preview] ${label} を無視しました（t が非有限・負値・number ではありません）`);
                    continue;
                }
                const normalizedGain = gainDb(item.gain_db, label);
                if (normalizedGain === undefined) {
                    continue;
                }
                const src = await resolveSource(item.path, label);
                if (!src) {
                    continue;
                }
                // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: sfx-only playback window
                // (material's [in, out)). Malformed values are warned-and-ignored (treated as
                // omitted) rather than dropping the whole item, matching gain_db/fadeIn/fadeOut's
                // existing tolerance pattern in this function. Real-duration clamping (実尺越え) can
                // only happen once the buffer is decoded, so it happens later in decodeOne.
                let trimIn: number | undefined;
                let trimOut: number | undefined;
                if (kind === 'sfx') {
                    if (item.in !== undefined) {
                        if (typeof item.in === 'number' && Number.isFinite(item.in) && item.in >= 0) {
                            trimIn = item.in;
                        } else {
                            console.warn(`[akari-preview] ${label}.in を無視しました（0以上の有限 number ではありません）`, item.in);
                        }
                    }
                    if (item.out !== undefined) {
                        if (typeof item.out === 'number' && Number.isFinite(item.out) && item.out > 0) {
                            trimOut = item.out;
                        } else {
                            console.warn(`[akari-preview] ${label}.out を無視しました（0より大きい有限 number ではありません）`, item.out);
                        }
                    }
                }
                // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum
                // (audio-clip-fades, 2026-08-18; sfx only): fade_in/fade_out. Same
                // warned-and-ignored tolerance as bgm's fadeIn/fadeOut parsing above (this
                // function's own `fades` block further down).
                let fadeIn: number | undefined;
                let fadeOut: number | undefined;
                if (kind === 'sfx') {
                    if (item.fade_in !== undefined) {
                        if (typeof item.fade_in === 'number' && Number.isFinite(item.fade_in) && item.fade_in >= 0) {
                            fadeIn = item.fade_in;
                        } else {
                            console.warn(`[akari-preview] ${label}.fade_in を無視しました（0以上の有限 number ではありません）`, item.fade_in);
                        }
                    }
                    if (item.fade_out !== undefined) {
                        if (typeof item.fade_out === 'number' && Number.isFinite(item.fade_out) && item.fade_out >= 0) {
                            fadeOut = item.fade_out;
                        } else {
                            console.warn(`[akari-preview] ${label}.fade_out を無視しました（0以上の有限 number ではありません）`, item.fade_out);
                        }
                    }
                }
                resolved.push({
                    id: kind === 'narration' ? String(item.id) : `sfx-${index + 1}`,
                    src,
                    t: item.t,
                    gainDb: normalizedGain,
                    ...(kind === 'sfx'
                        ? {
                            track: Number.isInteger(item.track) && (item.track as number) >= 0 ? item.track as number : 0,
                            ...(trimIn !== undefined ? { in: trimIn } : {}),
                            ...(trimOut !== undefined ? { out: trimOut } : {}),
                            ...(fadeIn !== undefined ? { fadeIn } : {}),
                            ...(fadeOut !== undefined ? { fadeOut } : {})
                        }
                        : {})
                });
            }
            return resolved;
        };

        let bgm: EditSummaryBgm | undefined;
        if (audio.bgm !== undefined) {
            const rawBgm = audio.bgm as {
                path?: unknown;
                gain_db?: unknown;
                ducking?: unknown;
                fadeIn?: unknown;
                fadeOut?: unknown;
                in?: unknown;
            } | undefined;
            if (!rawBgm || typeof rawBgm !== 'object' || Array.isArray(rawBgm)) {
                console.warn('[akari-preview] audio.bgm を無視しました（object ではありません）');
            } else {
                const normalizedGain = gainDb(rawBgm.gain_db, 'audio.bgm');
                if (normalizedGain !== undefined) {
                    const fades: Pick<EditSummaryBgm, 'fadeIn' | 'fadeOut'> = {};
                    for (const [field, raw] of [['fadeIn', rawBgm.fadeIn], ['fadeOut', rawBgm.fadeOut]] as const) {
                        if (raw === undefined) {
                            continue;
                        }
                        if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
                            fades[field] = raw;
                        } else {
                            console.warn(`[akari-preview] audio.bgm.${field} を無視しました（0以上の有限 number ではありません）`, raw);
                        }
                    }
                    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: file-internal start
                    // offset (素材秒). 実尺越え (in >= real duration) can only be checked once the
                    // buffer is decoded, so that clamp happens later in decodeOne.
                    let bgmIn: number | undefined;
                    if (rawBgm.in !== undefined) {
                        if (typeof rawBgm.in === 'number' && Number.isFinite(rawBgm.in) && rawBgm.in >= 0) {
                            bgmIn = rawBgm.in;
                        } else {
                            console.warn('[akari-preview] audio.bgm.in を無視しました（0以上の有限 number ではありません）', rawBgm.in);
                        }
                    }
                    const src = await resolveSource(rawBgm.path, 'audio.bgm');
                    if (src) {
                        bgm = {
                            src,
                            gainDb: normalizedGain,
                            ducking: rawBgm.ducking === true,
                            ...fades,
                            ...(bgmIn !== undefined ? { in: bgmIn } : {})
                        };
                    }
                }
            }
        }
        const sfx = await timed(audio.sfx, 'sfx');
        const narration = await timed(audio.narration, 'narration');
        if (!bgm && sfx.length === 0 && narration.length === 0) {
            return undefined;
        }
        return { bgm, sfx, narration };
    }

    // task/2026-08-10-preview-bug-sweep (B3): binary glTF (.glb) header/JSON-chunk sniff for
    // extensions the pinned Three.js runtime (packages/overlay-runtime/src/three-runtime.js) has
    // no loader for (no DRACOLoader/KTX2Loader wired — confirmed via
    // skills/overlay-authoring/3d.md "Draco/KTX2 は未対応" and by reproduction: a
    // KHR_draco_mesh_compression model settles into status "error" while an otherwise-identical
    // uncompressed model reaches "ready"). Detection only — this can't make the runtime decode
    // Draco/KTX2 (that needs a vendored decoder in packages/overlay-runtime, out of this task's
    // file boundary); it turns an unexplained stuck-looking fallback into a visible, actionable
    // "プレビュー未対応の項目" indicator (see indicators.push below) instead.
    protected detectUnsupportedGltfExtensions(bytes: Uint8Array): string[] {
        const UNSUPPORTED_GLTF_EXTENSIONS = ['KHR_draco_mesh_compression', 'KHR_texture_basisu'];
        try {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
                return [];
            }
            const jsonChunkLength = view.getUint32(12, true);
            const jsonChunkType = view.getUint32(16, true);
            if (jsonChunkType !== 0x4e4f534a || view.byteLength < 20 + jsonChunkLength) {
                return [];
            }
            const jsonBytes = bytes.subarray(20, 20 + jsonChunkLength);
            const json = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes)) as { extensionsUsed?: unknown };
            const used = new Set(Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []);
            return UNSUPPORTED_GLTF_EXTENSIONS.filter(extension => used.has(extension));
        } catch {
            return [];
        }
    }

    protected async resolveThreeSceneAssets(
        html: string,
        editUri: URI,
        assetStreams: Map<string, { id: string; url: string }>,
        assetUris: URI[],
        unsupportedGltfWarnings: string[]
    ): Promise<string> {
        if (!html.includes('data-akari-3d-scene')) {
            return html;
        }
        const document = new DOMParser().parseFromString(html, 'text/html');
        const declarations = document.body.querySelectorAll(
            'script[type="application/json"][data-akari-3d-scene]'
        );
        if (declarations.length === 0) {
            return html;
        }
        if (declarations.length !== 1) {
            for (const declaration of Array.from(declarations)) {
                declaration.textContent = JSON.stringify({ model: '' });
            }
            console.warn('[akari-preview] 3D overlay には data-akari-3d-scene 宣言が 1 個必要です');
            return document.body.innerHTML;
        }
        for (const declaration of Array.from(declarations)) {
            try {
                const descriptor = JSON.parse(declaration.textContent || '{}');
                if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
                    || typeof descriptor.model !== 'string' || !descriptor.model) {
                    throw new TypeError('data-akari-3d-scene.model は edit.json 相対の .glb パスである必要があります');
                }
                if (Object.keys(descriptor).some(key => !THREE_SCENE_KEYS.has(key))) {
                    throw new TypeError('data-akari-3d-scene に未対応の top-level key があります');
                }
                const resolveAsset = async (relativePath: string, field: string): Promise<string> => {
                    if (relativePath.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(relativePath)) {
                        throw new TypeError(`${field} に絶対パスや URL は指定できません`);
                    }
                    const assetUri = editUri.parent.resolve(relativePath);
                    const key = assetUri.toString();
                    let stream = assetStreams.get(key);
                    if (!stream) {
                        stream = await this.previewService.createAssetStream({ assetUri: key });
                        assetStreams.set(key, stream);
                        assetUris.push(assetUri);
                    }
                    return stream.url;
                };
                const modelPath: string = descriptor.model;
                descriptor.model = await resolveAsset(modelPath, 'data-akari-3d-scene.model');
                try {
                    const modelContent = await this.fileService.readFile(editUri.parent.resolve(modelPath));
                    const unsupported = this.detectUnsupportedGltfExtensions(modelContent.value.buffer);
                    if (unsupported.length > 0) {
                        unsupportedGltfWarnings.push(
                            `3D モデル ${modelPath} が ${unsupported.join('/')} 圧縮のため読み込めません` +
                            `（書き出しも同様に失敗します。非圧縮で書き出し直してください）`
                        );
                    }
                } catch (error) {
                    console.warn('[akari-preview] failed to inspect 3D model for unsupported glTF extensions', modelPath, error);
                }
                if (descriptor.environment?.map !== undefined) {
                    if (typeof descriptor.environment.map !== 'string' || !descriptor.environment.map) {
                        throw new TypeError('environment.map は正距円筒画像の相対パスである必要があります');
                    }
                    descriptor.environment.map = await resolveAsset(
                        descriptor.environment.map,
                        'data-akari-3d-scene.environment.map'
                    );
                }
                if (descriptor.materialOverrides !== undefined) {
                    if (!descriptor.materialOverrides
                        || typeof descriptor.materialOverrides !== 'object'
                        || Array.isArray(descriptor.materialOverrides)) {
                        throw new TypeError('materialOverrides は object である必要があります');
                    }
                    for (const [materialName, override] of Object.entries(descriptor.materialOverrides)) {
                        if (!materialName
                            || !override
                            || typeof override !== 'object'
                            || Array.isArray(override)
                            || Object.keys(override).some(key => key !== 'texture')
                            || typeof (override as { texture?: unknown }).texture !== 'string'
                            || !(override as { texture: string }).texture) {
                            throw new TypeError('materialOverrides は material 名ごとに texture 相対パスを指定してください');
                        }
                        const typedOverride = override as { texture: string };
                        typedOverride.texture = await resolveAsset(
                            typedOverride.texture,
                            `materialOverrides.${materialName}.texture`
                        );
                    }
                }
                declaration.textContent = JSON.stringify(descriptor).replace(/</g, '\\u003c');
            } catch (error) {
                declaration.textContent = JSON.stringify({ model: '' });
                console.warn('[akari-preview] failed to resolve declarative 3D scene asset', error);
            }
        }
        return document.body.innerHTML;
    }

    protected previewCaptionTimelineSegments(
        cuts: readonly EditSummaryCut[],
        fps = 30
    ): TimelineSegment[] {
        return buildTimelineMap(
            cuts.map(cut => ({ ...cut, track: cut.renderTrack })),
            { trackZ: track => track, fps }
        ).segments;
    }

    protected async loadPreviewCaptions(
        captionsUri: URI | undefined,
        editUri?: URI
    ): Promise<LoadedPreviewCaptions> {
        if (!captionsUri) {
            return { captions: [] };
        }
        try {
            if (editUri) {
                const resolved = await this.previewService.resolveCaptionDisplay({
                    captionsUri: captionsUri.toString(),
                    editUri: editUri.toString()
                });
                if (resolved) {
                    return {
                        captions: parseResolvedPreviewCaptions(resolved).map(caption => ({
                            ...caption,
                            clockDomain: 'output'
                        })),
                        emphasisWords: resolved.emphasisWords
                    };
                }
            }
            const source = await this.readText(captionsUri);
            const parsed = parsePreviewCaptions(source);
            const root: unknown = JSON.parse(source);
            const emphasisWords = readCaptionsEmphasisWords(root);
            const rawCaptions = Array.isArray(root)
                ? root
                : root && typeof root === 'object' && Array.isArray((root as { captions?: unknown }).captions)
                    ? (root as { captions: unknown[] }).captions
                    : [];
            const rawById = new Map<string, Record<string, unknown>>();
            for (const value of rawCaptions) {
                if (value && typeof value === 'object' && !Array.isArray(value)
                    && typeof (value as { id?: unknown }).id === 'string') {
                    rawById.set((value as { id: string }).id, value as Record<string, unknown>);
                }
            }
            const captions: PreviewCaptionClockInput[] = parsed.map((caption, index) => {
                const raw = (caption.id ? rawById.get(caption.id) : undefined)
                    ?? (rawCaptions[index] && typeof rawCaptions[index] === 'object'
                        && !Array.isArray(rawCaptions[index])
                        ? rawCaptions[index] as Record<string, unknown> : undefined);
                // 明示 domain は schema 正本どおり直通し、未宣言だけ既存 legacy 推定へ渡す。
                const declaredDomain = raw?.time_domain === 'source' || raw?.time_domain === 'output'
                    ? raw.time_domain
                    : 'legacy';
                return {
                    ...caption,
                    clockDomain: declaredDomain,
                    ...(typeof raw?.src === 'string' && raw.src ? { clockSourceId: raw.src } : {})
                };
            });
            return { captions, emphasisWords };
        } catch (error) {
            if (await this.fileService.exists(captionsUri)) {
                console.warn(`[akari-preview] failed to load ${captionsUri.toString()}; hiding captions`, error);
            }
            return { captions: [] };
        }
    }

    protected async findEditJson(videoUri: URI): Promise<URI | undefined> {
        const adjacent = videoUri.parent.resolve('edit.json');
        if (await this.fileService.exists(adjacent)) {
            return adjacent;
        }

        for (const root of await this.workspaceService.roots) {
            const candidates = await this.findNamedFiles(root.resource, 'edit.json');
            for (const candidate of candidates) {
                try {
                    const parsed = JSON.parse(await this.readText(candidate));
                    if (editReferencesRawMedia(parsed, candidate.toString(), videoUri.toString())) {
                        return candidate;
                    }
                } catch {
                    // Invalid candidates do not prevent later edit.json files from matching.
                }
            }
        }
        return undefined;
    }

    protected async findNamedFiles(directory: URI, name: string): Promise<URI[]> {
        const found: URI[] = [];
        const visit = async (uri: URI): Promise<void> => {
            let stat: FileStat;
            try {
                stat = await this.fileService.resolve(uri);
            } catch {
                return;
            }
            if (stat.isFile) {
                if (stat.resource.path.base === name) {
                    found.push(stat.resource);
                }
                return;
            }
            const children = [...(stat.children ?? [])]
                // ドット始まりは一律飛ばす（isSkippedSearchDirectory = ドット始まり + node_modules）。
                // 実害 2 系統（いずれも 2026-08-04 実機）: (1) .claude のスキル同梱フィクスチャの
                // edit.json を拾って謎タイムラインが開く (2) .backups / .pretest-* 等の
                // バックアップ置き場を拾ってタイムラインとプレビューが別ファイルに割れる
                .filter(child => !isSkippedSearchDirectory(child.resource.path.base))
                .sort((left, right) => left.resource.toString().localeCompare(right.resource.toString()));
            for (const child of children) {
                await visit(child.resource);
            }
        };
        await visit(directory);
        return found;
    }

    protected async handleOverlayWrite(widget: PreviewWidgetMarker, request: OverlayWriteRequest): Promise<void> {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            widget.sendMessage({
                type: 'akari-preview-overlay-write-response',
                requestId: request.requestId,
                ok: false,
                error: '編集中の edit.json がありません'
            });
            return;
        }
        try {
            const resolved = resolvePreviewItemWrite(await this.readText(editUri), {
                kind: 'overlay',
                itemId: request.overlayId,
                patch: request.patch
            });
            // 断片テキスト編集の html patch は overlays[].html が指す断片ファイルへ書く。
            // 旧実装はここで html を黙って捨てて ok を返しており、contenteditable の編集が
            // どのサーフェスでも一度も永続化されていなかった（edit.json へマージすると
            // lint「html does not resolve to a regular file」で弾かれる — 契約上ファイル参照）
            if (typeof request.patch.html === 'string') {
                if (!request.patch.html.trim()) {
                    throw new Error('html が空です');
                }
                const projectRoot = editUri.parent;
                const htmlPath = resolved.htmlPath;
                if (typeof htmlPath !== 'string' || !htmlPath) {
                    throw new Error(`HTML 断片の参照先を特定できません: ${request.overlayId}`);
                }
                // URI.resolve は '..' を正規化しない可能性があるため、セグメント検査で先に弾く
                if (htmlPath.startsWith('/') || htmlPath.split(/[\\/]/).some(segment => segment === '..')) {
                    throw new Error('プロジェクト外への書き込みは拒否しました');
                }
                const target = projectRoot.resolve(htmlPath);
                if (!`${target.toString()}/`.startsWith(`${projectRoot.toString()}/`)) {
                    throw new Error('プロジェクト外への書き込みは拒否しました');
                }
                if (!(await this.fileService.exists(target))) {
                    throw new Error(`断片ファイルがありません: ${htmlPath}`);
                }
                this.recentWrites.set(target.toString(), Date.now());
                await this.fileService.writeFile(target, BinaryBuffer.fromString(request.patch.html));
            }
            if (resolved.candidateText) {
                const candidateText = resolved.candidateText;
                const lintResult = await this.previewService.lintEditCandidate({
                    editUri: editUri.toString(),
                    candidateText
                });
                if (!lintResult.pass) {
                    widget.sendMessage({
                        type: 'akari-preview-overlay-write-response',
                        requestId: request.requestId,
                        ok: false,
                        error: lintResult.errors[0] ?? 'edit-lint が変更を拒否しました'
                    });
                    return;
                }
                this.recentWrites.set(editUri.toString(), Date.now());
                await this.fileService.writeFile(editUri, BinaryBuffer.fromString(candidateText));
            }
            widget.sendMessage({
                type: 'akari-preview-overlay-write-response',
                requestId: request.requestId,
                ok: true
            });
        } catch (error) {
            widget.sendMessage({
                type: 'akari-preview-overlay-write-response',
                requestId: request.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    protected isOverlayWriteRequest(message: any): message is OverlayWriteRequest {
        return message?.type === 'akari-preview-overlay-write'
            && typeof message.requestId === 'string'
            && typeof message.overlayId === 'string'
            && message.patch
            && typeof message.patch === 'object';
    }

    // CF-write: layerTransform の schema 定義（edit.schema.json #layerTransform — x/y/rotate は数値・
    // scale は正の数）と同じ制約をここで先に弾く。edit-lint（呼び出しのみ）は layers[].transform の
    // 数値レンジまでは検証しないため、この事前チェックが実質的な「不正値は書き込まない」の担保になる。
    protected validateLayerTransformPatch(patch: OverlayTransform | undefined): string | undefined {
        if (!patch) {
            return undefined;
        }
        for (const field of ['x', 'y', 'rotate'] as const) {
            if (field in patch && !Number.isFinite(patch[field])) {
                return `transform.${field} は有限数値である必要があります。`;
            }
        }
        if ('scale' in patch && !(Number.isFinite(patch.scale) && (patch.scale as number) > 0)) {
            return 'transform.scale は正の数である必要があります。';
        }
        return undefined;
    }

    // ㉔ layers[].crop の schema 定義（edit.schema.json #layerCrop — 0..1 正規化・x+w<=1・y+h<=1）と
    // 同じ制約をここで先に弾く（validateLayerTransformPatch と同じ「不正値は書き込まない」の担保）。
    protected validateLayerCropPatch(patch: LayerCropPatch | undefined): string | undefined {
        if (!patch) {
            return undefined;
        }
        for (const field of ['x', 'y'] as const) {
            if (!Number.isFinite(patch[field]) || patch[field] < 0 || patch[field] > 1) {
                return `crop.${field} は 0 から 1 の範囲の有限数である必要があります。`;
            }
        }
        for (const field of ['w', 'h'] as const) {
            if (!Number.isFinite(patch[field]) || patch[field] <= 0 || patch[field] > 1) {
                return `crop.${field} は 0 より大きく 1 以下の有限数である必要があります。`;
            }
        }
        if (patch.x + patch.w > 1 + 1e-9) {
            return 'crop.x + crop.w は 1 以下である必要があります。';
        }
        if (patch.y + patch.h > 1 + 1e-9) {
            return 'crop.y + crop.h は 1 以下である必要があります。';
        }
        return undefined;
    }

    // ㉖ layers[].perspective の schema 定義（edit.schema.json #layerPerspective — corners は
    // [TL,TR,BL,BR] の 4 要素・各 [x,y] は 0..1）と同じ制約をここで先に弾く。patch.perspective ===
    // null（明示的な解除）は常に有効。退化四角形（面積がほぼ 0）の拒否も
    // packages/schemas/bin/validate-edit.mjs の validateLayerPerspective と同じシューレース公式で
    // 揃える（意図的なコード重複 — 検収ゲートを edit-lint に一本化する契約どおり、ここでの拒否は
    // 「早期に分かりやすいエラーを返す」ための先弾きであり、真の正本は edit-lint 経由の schema 検証）。
    protected validateLayerPerspectivePatch(patch: LayerPerspectivePatch | null | undefined): string | undefined {
        if (patch === undefined || patch === null) {
            return undefined;
        }
        const corners = patch.corners;
        if (!Array.isArray(corners) || corners.length !== 4) {
            return 'perspective.corners は [TL,TR,BL,BR] の 4 要素配列である必要があります。';
        }
        const names = ['TL', 'TR', 'BL', 'BR'];
        for (let i = 0; i < 4; i += 1) {
            const corner = corners[i];
            if (!Array.isArray(corner) || corner.length !== 2) {
                return `perspective.corners[${i}] (${names[i]}) は [x, y] の 2 要素配列である必要があります。`;
            }
            const [x, y] = corner;
            if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) {
                return `perspective.corners[${i}] (${names[i]}) は 0 から 1 の範囲の有限数である必要があります。`;
            }
        }
        const [tl, tr, bl, br] = corners;
        const ring = [tl, tr, br, bl];
        let area2 = 0;
        for (let i = 0; i < ring.length; i += 1) {
            const [x1, y1] = ring[i];
            const [x2, y2] = ring[(i + 1) % ring.length];
            area2 += x1 * y2 - x2 * y1;
        }
        if (Math.abs(area2) < 1e-4) {
            return 'perspective.corners は退化した四角形（面積がほぼ 0）であってはなりません。';
        }
        return undefined;
    }

    protected async handleLayerWrite(widget: PreviewWidgetMarker, request: LayerWriteRequest): Promise<void> {
        const respond = (ok: boolean, error?: string): void => {
            widget.sendMessage({
                type: 'akari-preview-layer-write-response',
                requestId: request.requestId,
                ok,
                ...(error ? { error } : {})
            });
        };
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            respond(false, '編集中の edit.json がありません');
            return;
        }
        const validationError = this.validateLayerTransformPatch(request.patch.transform)
            ?? this.validateLayerCropPatch(request.patch.crop)
            ?? this.validateLayerPerspectivePatch(request.patch.perspective);
        if (validationError) {
            respond(false, validationError);
            return;
        }
        try {
            const originalText = await this.readText(editUri);
            const resolved = resolvePreviewItemWrite(originalText, {
                kind: 'layer',
                itemId: request.layerId,
                patch: request.patch
            });
            const candidateText = resolved.candidateText;
            if (!candidateText) {
                throw new Error('edit.json へ書き込む変更がありません');
            }
            const lintResult = await this.previewService.lintEditCandidate({
                editUri: editUri.toString(),
                candidateText
            });
            if (!lintResult.pass) {
                respond(false, lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
                return;
            }
            this.recentWrites.set(editUri.toString(), Date.now());
            await this.fileService.writeFile(editUri, BinaryBuffer.fromString(candidateText));
            respond(true);
        } catch (error) {
            respond(false, error instanceof Error ? error.message : String(error));
        }
    }

    // ㉓ layerWrite（上）と同型。cutIndex は segments[].cutIndex（cuts[] の実インデックス）を
    // クリック時点でプレビュー側が dataset に記録したもの（webview 側 applyCutVisual 参照）。
    protected async handleCutWrite(widget: PreviewWidgetMarker, request: CutWriteRequest): Promise<void> {
        const respond = (ok: boolean, error?: string): void => {
            widget.sendMessage({
                type: 'akari-preview-cut-write-response',
                requestId: request.requestId,
                ok,
                ...(error ? { error } : {})
            });
        };
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            respond(false, '編集中の edit.json がありません');
            return;
        }
        const validationError = this.validateLayerTransformPatch(request.patch.transform);
        if (validationError) {
            respond(false, validationError);
            return;
        }
        try {
            const originalText = await this.readText(editUri);
            const resolved = resolvePreviewItemWrite(originalText, {
                kind: 'cut',
                itemId: request.cutId,
                legacyIndex: request.cutIndex,
                patch: request.patch
            });
            const candidateText = resolved.candidateText;
            if (!candidateText) {
                throw new Error('edit.json へ書き込む変更がありません');
            }
            const lintResult = await this.previewService.lintEditCandidate({
                editUri: editUri.toString(),
                candidateText
            });
            if (!lintResult.pass) {
                respond(false, lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
                return;
            }
            this.recentWrites.set(editUri.toString(), Date.now());
            await this.fileService.writeFile(editUri, BinaryBuffer.fromString(candidateText));
            respond(true);
        } catch (error) {
            respond(false, error instanceof Error ? error.message : String(error));
        }
    }

    protected isCutWriteRequest(message: any): message is CutWriteRequest {
        return message?.type === 'akari-preview-cut-write'
            && typeof message.requestId === 'string'
            && Number.isInteger(message.cutIndex)
            && message.cutIndex >= 0
            && (message.cutId === undefined || typeof message.cutId === 'string')
            && message.patch
            && typeof message.patch === 'object';
    }

    // ㉓ layerWrite/cutWrite と同型だが対象ファイルは captions.json（edit.json ではない）。
    // text_style.zone または text をフィールド単位で上書き（他フィールド・他キャプションは無傷）。
    // 空白だけの text は captions.schema が保持できないため、対象 cue の削除として扱う。
    // captions.json は array ルート / {captions:[...], default_text_style} object ルートの
    // どちらも許容（schemas/captions.schema.json oneOf）ため両形を読む。
    protected async handleCaptionWrite(widget: PreviewWidgetMarker, request: CaptionWriteRequest): Promise<void> {
        const respond = (ok: boolean, error?: string): void => {
            widget.sendMessage({
                type: 'akari-preview-caption-write-response',
                requestId: request.requestId,
                ok,
                ...(error ? { error } : {})
            });
        };
        const captionsUri = widget.akariPreviewCaptionsUri;
        if (!captionsUri) {
            respond(false, '字幕ファイル（captions.json）がありません');
            return;
        }
        if (typeof request.patch.zone === 'string'
            && !(CAPTION_ZONES as readonly string[]).includes(request.patch.zone)) {
            respond(false, `不正な zone です: ${request.patch.zone}`);
            return;
        }
        try {
            const originalText = await this.readText(captionsUri);
            const persistOptions = {
                source: originalText,
                captionId: request.captionId,
                lint: (candidateText: string) => this.previewService.lintEditCandidate({
                    editUri: captionsUri.toString(),
                    candidateText
                }),
                write: async (candidateText: string) => {
                    this.markRecentWrite(captionsUri);
                    await this.fileService.writeFile(captionsUri, BinaryBuffer.fromString(candidateText));
                }
            };
            const lintResult = typeof request.patch.text === 'string'
                ? await persistCaptionText({ ...persistOptions, text: request.patch.text })
                : await persistCaptionZone({
                    ...persistOptions,
                    zone: request.patch.zone as Parameters<typeof persistCaptionZone>[0]['zone']
                });
            if (!lintResult.pass) {
                respond(false, lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
                return;
            }
            this.queueCaptionsUpdate(widget);
            respond(true);
        } catch (error) {
            respond(false, error instanceof Error ? error.message : String(error));
        }
    }

    protected isCaptionWriteRequest(message: any): message is CaptionWriteRequest {
        const hasZone = typeof message?.patch?.zone === 'string';
        const hasText = typeof message?.patch?.text === 'string';
        return message?.type === 'akari-preview-caption-write'
            && typeof message.requestId === 'string'
            && typeof message.captionId === 'string'
            && message.patch
            && typeof message.patch === 'object'
            && hasZone !== hasText;
    }

    protected isLayerWriteRequest(message: any): message is LayerWriteRequest {
        return message?.type === 'akari-preview-layer-write'
            && typeof message.requestId === 'string'
            && typeof message.layerId === 'string'
            && message.patch
            && typeof message.patch === 'object';
    }

    protected async handleWaveformFetch(widget: PreviewWidgetMarker, request: WaveformFetchRequest): Promise<void> {
        try {
            const videoUri = widget.akariPreviewVideoUri;
            if (!videoUri) {
                throw new Error('波形を生成する動画がありません');
            }
            const content = await this.fileService.readFile(videoUri);
            widget.sendMessage({
                type: 'akari-preview-waveform-fetch-response',
                requestId: request.requestId,
                ok: true,
                dataBase64: this.toBase64(content.value.buffer)
            });
        } catch (error) {
            widget.sendMessage({
                type: 'akari-preview-waveform-fetch-response',
                requestId: request.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    protected isWaveformFetchRequest(message: any): message is WaveformFetchRequest {
        return message?.type === 'akari-preview-waveform-fetch'
            && typeof message.requestId === 'string';
    }

    protected isHevcFallbackRequest(message: any): message is HevcFallbackRequest {
        return message?.type === 'akari-preview-hevc-fallback-request'
            && typeof message.requestId === 'string'
            && typeof message.errorCode === 'number'
            && (message.videoUri === undefined || typeof message.videoUri === 'string');
    }

    // task/2026-08-09-drop-hevc-proxy: 唯一 previewService.resolveHevcProxy を呼ぶ経路
    // （＝唯一 ffmpeg 変換を新規に起動しうる経路）。open は既に完了しているので、ここで
    // await しても開く処理そのものはブロックしない。成功したら widget を丸ごとリロードする
    // （refreshPreview が sourceUrlById/segments/layers を含む状態を作り直すため、複数ソース
    // （v1 cuts[].src / v2 media item / video layer）を含む構成でも古い URL が混ざらない）。
    // 再生位置は akariPreviewLastKnownTime（forwardPlaybackTick が常時更新）から復元する。
    protected async handleHevcFallbackRequest(
        widget: PreviewWidgetMarker,
        identityUri: URI,
        kind: 'raw' | 'output',
        request: HevcFallbackRequest
    ): Promise<void> {
        const respond = (ok: boolean, error?: string): void => {
            widget.sendMessage({
                type: 'akari-preview-hevc-fallback-response',
                requestId: request.requestId,
                ok,
                ...(error ? { error } : {})
            });
        };
        let videoUri = widget.akariPreviewVideoUri;
        if (request.videoUri) {
            if (!widget.akariPreviewFallbackSourceUris?.has(request.videoUri)) {
                respond(false, '動画ソースがプレビューの宣言と一致しません');
                return;
            }
            videoUri = new URI(request.videoUri);
        }
        if (!videoUri) {
            respond(false, '動画ソースが特定できません');
            return;
        }
        const key = videoUri.toString();
        if (this.hevcFallbackAttempted.has(key)) {
            respond(false, 'このソースは既にフォールバックを試行済みです');
            return;
        }
        this.hevcFallbackAttempted.add(key);
        const [workspaceRoot] = await this.workspaceService.roots;
        if (!workspaceRoot) {
            respond(false, 'ワークスペースが開かれていません');
            return;
        }
        try {
            const result = await this.previewService.resolveHevcProxy({
                videoUri: key,
                projectRootUri: workspaceRoot.resource.toString()
            });
            if (result.status !== 'ready') {
                respond(false, result.status === 'unavailable' ? result.reason : '変換対象ではありませんでした');
                return;
            }
            this.hevcFallbackProxyUris.set(key, result.proxyUri);
        } catch (error) {
            console.warn('[akari-preview] HEVC フォールバック生成に失敗しました', error);
            respond(false, error instanceof Error ? error.message : String(error));
            return;
        }
        if (widget.isDisposed) {
            return;
        }
        respond(true);
        this.queueRefresh(widget, identityUri, kind, widget.akariPreviewLastKnownTime, true);
    }

    protected isOpenOutputRequest(message: any): message is OpenOutputRequest {
        return message?.type === 'akari-preview-open-output-request';
    }

    protected async handleOpenOutputRequest(widget: PreviewWidgetMarker): Promise<void> {
        const editUri = widget.akariPreviewRelatedEditUri;
        if (!editUri) {
            return;
        }
        try {
            const output = await this.getOrOpenPreview(editUri.normalizePath(), { area: 'main' }, 'output');
            this.attachTimelinePassively();
            await this.shell.activateWidget(output.id);
        } catch (error) {
            this.reportOpenFailure(editUri, error);
        }
    }

    protected prepareHtml(
        videoUri: URI,
        videoSource: string,
        model: PreviewModel,
        assets: OverlayRuntimeAssets,
        initialSeekTime?: number,
        sourceUrlById: Record<string, string> = {},
        hasSourceAudio?: boolean,
        imageSourceUrlById: Record<string, string> = {},
        primaryIsStillImage = false
    ): string {
        const { width, height } = model.summary.output;
        // render-cut captions.mjs の既定とパリティ（stage は出力 px 論理空間）:
        // 縦長 = 出力幅 6% / 横長 = 38px。従来の height*0.05 は焼き込みよりも大きく表示される乖離だった。
        const captionFontSize = height > width ? Math.round(width * 0.06) : 38;
        const initialState = this.safeJson({
            summary: model.summary,
            captions: model.captions,
            emphasisWords: model.emphasisWords ?? [],
            editPath: model.editUri?.toString() ?? null,
            relatedEditUri: model.relatedEditUri?.toString() ?? null,
            videoUri: videoUri.toString(),
            // v1 マルチソース: ソース id → ストリーム URL。webview は cuts[].src が
            // 変わる継ぎ目で <video> をこの表から差し替える（v0 は 1 件のみの表）
            videoSources: sourceUrlById,
            // フォールバック要求は配信 URL ではなく原本 URI をキーにする。v2 media item も
            // source.src の id からこの表を引き、失敗した正確なソースだけを変換する。
            videoSourceUris: Object.fromEntries([...(model.sourcesById ?? new Map())]
                .map(([id, source]) => [id, source.uri.toString()])),
            // 静止画 cut ソース表（id → asset ストリーム URL）。この表にあるセグメントは
            // <video> ではなく #preview-still + 壁時計クロックで表示する
            // （docs/contract-2026-08-12-still-image-cut-source-v0.md のシェル対応）
            imageSources: imageSourceUrlById,
            // 代表ソース（先頭カット）が静止画のとき true。<video> に初期 src が無い
            primaryIsStillImage,
            // task/2026-08-10-preview-bug-sweep (B1): ffprobe ground truth, undefined when
            // unknown (ffprobe unavailable or probe failed) — never treated as "silent" client-side.
            hasSourceAudio: hasSourceAudio ?? null,
            initialSeekTime: Number.isFinite(initialSeekTime) ? initialSeekTime : null,
            muted: model.session?.muted ?? false,
            captionsVisible: model.session?.captionsVisible ?? true,
            hiddenTracks: model.session?.hiddenTracks ?? [],
            hiddenTracksByScope: model.session?.hiddenTracksByScope ?? { cuts: [], layers: [], audio: [] },
            mutedTracksByScope: model.session?.mutedTracksByScope ?? { cuts: [], audio: [], layers: [] },
            allTracksHiddenScopes: model.session?.allTracksHiddenScopes ?? [],
            allTracksMutedScopes: model.session?.allTracksMutedScopes ?? []
        });
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${this.escapeHtml(this.streamOrigin(videoSource))}; connect-src ${this.escapeHtml(this.streamOrigin(videoSource))} blob:; img-src ${this.escapeHtml(this.streamOrigin(videoSource))} blob: data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:">
<style>
${this.inlineStyle(assets.interactionCss)}
${captionFontFaceCss(assets.captionFontDataUri)}
:root {
  color-scheme: light dark;
  font-family: "${CAPTION_FONT_FAMILY}", sans-serif;
  --akari-preview-pasteboard: #2b2d30;
}
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #141414; color: #eee; }
body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }
body.vscode-light {
  color-scheme: light;
  --akari-preview-pasteboard: #d5d7da;
}
body { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.workspace { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.preview-pane { position: relative; min-width: 0; min-height: 0; padding: 16px; overflow: hidden; background: var(--akari-preview-pasteboard); }
/* ペインがズーム/パンの唯一のビューポート。wrapper は UI の固定基準、zoom-layer は
   ペイン全面の変換層、preview-stage だけが output 比の黒い 100% フィット箱を担う。 */
#preview-wrapper { position: relative; width: 100%; height: 100%; container-type: size; }
.preview-pane.is-draggable { cursor: grab; touch-action: none; }
.preview-pane.is-dragging { cursor: grabbing; }
#zoom-layer { position: absolute; inset: 0; transform-origin: 50% 50%; will-change: transform; }
#preview-stage { position: absolute; left: 50%; top: 50%; width: min(100cqw, calc(100cqh * ${width} / ${height})); aspect-ratio: ${width} / ${height}; overflow: hidden; background: #000; transform: translate(-50%, -50%); }
#preview-video, #transition-video, #transition-still { position: absolute; top: 0; left: 0; object-fit: contain; }
#transition-video, #transition-still { display: none; pointer-events: none; }
.akari-video-fx-rail { position: absolute; top: 0; left: 0; max-width: none; max-height: none; }
/* 静止画 cut ソース: #preview-video と同じ位置・サイズに重ね、静止画セグメントの間だけ表示する
   （配置・transform は毎フレーム video のインラインスタイルを鏡写し — syncStillImageVisual）。 */
#preview-still { position: absolute; top: 0; left: 0; object-fit: contain; display: none; user-select: none; }
#preview-layers { position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px; transform-origin: 0 0; overflow: hidden; pointer-events: none; }
#preview-layers > video, #preview-layers > img { position: absolute; max-width: none; max-height: none; transform-origin: 50% 50%; pointer-events: auto; cursor: pointer; }
#preview-layers > [data-akari-layer-id] { display: none; }
#preview-layers > [data-akari-deferred-telop-id] { position: absolute; inset: 0; display: none; place-items: center; pointer-events: none; }
.akari-deferred-telop-placeholder__label { display: inline-flex; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid rgba(255,255,255,0.22); border-radius: 999px; background: rgba(20,20,20,0.82); color: #f2f2f2; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; box-shadow: 0 6px 22px rgba(0,0,0,0.35); }
.akari-deferred-telop-placeholder__label::before { content: ''; width: 13px; height: 13px; border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff; border-radius: 50%; animation: akari-deferred-telop-spin 0.8s linear infinite; }
@keyframes akari-deferred-telop-spin { to { transform: rotate(360deg); } }
#preview-layers > [data-akari-filter-id] { position: absolute; inset: 0; display: none; pointer-events: none; }
#layer-select-box { position: absolute; z-index: 1900; box-sizing: border-box; border: 1.5px solid #4da3ff; box-shadow: 0 0 0 1px rgba(0,0,0,0.35); pointer-events: none; display: none; }
#layer-select-box.is-active { display: block; pointer-events: auto; cursor: move; }
#layer-select-box .akari-layer-handle { position: absolute; width: 12px; height: 12px; margin: -6px; border: 1.5px solid #4da3ff; border-radius: 3px; background: #fff; pointer-events: auto; }
#layer-select-box .akari-layer-handle-nw { top: 0; left: 0; cursor: nwse-resize; }
#layer-select-box .akari-layer-handle-ne { top: 0; left: 100%; cursor: nesw-resize; }
#layer-select-box .akari-layer-handle-sw { top: 100%; left: 0; cursor: nesw-resize; }
#layer-select-box .akari-layer-handle-se { top: 100%; left: 100%; cursor: nwse-resize; }
#layer-select-box .akari-layer-handle-rotate { top: 0; left: 50%; margin-top: -34px; border-radius: 50%; cursor: grab; }
#layer-select-box .akari-layer-rotate-stem { position: absolute; top: -28px; left: 50%; width: 1.5px; height: 28px; background: #4da3ff; transform: translateX(-50%); pointer-events: none; }
/* クロップモード: 移動/リサイズ/回転ハンドルと衝突しないよう select box 側の操作系だけ隠す
   （枠自体は #layer-crop-box が別枠として表示する）。 */
#layer-select-box.akari-crop-mode-hide-handles .akari-layer-handle,
#layer-select-box.akari-crop-mode-hide-handles .akari-layer-rotate-stem { display: none; }
/* クロップ編集オーバーレイ: 外枠はレイヤーの「クロップ無しなら見えていたはずの」全面フレーム
   （transform.rotate を outer 自身の中心まわりに適用 — pivot はソースフレーム中心固定。crop の
   現在値による pivot ドリフトを避け、常に自分の中心で回る素直な参照系にする＝編集時だけの近似）。
   overflow:hidden で box-shadow スプレッドを外枠内に閉じ込め、クロップ窓の外側だけを暗くする。 */
#layer-crop-box { position: absolute; z-index: 1950; overflow: hidden; outline: 1px dashed rgba(255,255,255,0.5); pointer-events: none; display: none; }
#layer-crop-box.is-active { display: block; }
#layer-crop-box .akari-layer-crop-rect { position: absolute; box-sizing: border-box; outline: 1.5px solid #4da3ff; box-shadow: 0 0 0 2000px rgba(0,0,0,0.45); pointer-events: none; }
#layer-crop-box .akari-layer-crop-handle { position: absolute; width: 12px; height: 12px; margin: -6px; box-sizing: border-box; border: 1.5px solid #4da3ff; border-radius: 2px; background: #fff; pointer-events: auto; }
#layer-crop-box .akari-layer-crop-handle-n, #layer-crop-box .akari-layer-crop-handle-s { left: 50%; cursor: ns-resize; }
#layer-crop-box .akari-layer-crop-handle-e, #layer-crop-box .akari-layer-crop-handle-w { top: 50%; cursor: ew-resize; }
#layer-crop-box .akari-layer-crop-handle-nw, #layer-crop-box .akari-layer-crop-handle-se { cursor: nwse-resize; }
#layer-crop-box .akari-layer-crop-handle-ne, #layer-crop-box .akari-layer-crop-handle-sw { cursor: nesw-resize; }
#layer-crop-box .akari-layer-crop-handle-nw { top: 0; left: 0; }
#layer-crop-box .akari-layer-crop-handle-n { top: 0; }
#layer-crop-box .akari-layer-crop-handle-ne { top: 0; left: 100%; }
#layer-crop-box .akari-layer-crop-handle-e { left: 100%; }
#layer-crop-box .akari-layer-crop-handle-se { top: 100%; left: 100%; }
#layer-crop-box .akari-layer-crop-handle-s { top: 100%; }
#layer-crop-box .akari-layer-crop-handle-sw { top: 100%; left: 0; }
#layer-crop-box .akari-layer-crop-handle-w { top: 0; }
#layer-crop-toggle { position: absolute; z-index: 1960; display: none; width: 22px; height: 22px; box-sizing: border-box; border-radius: 4px; border: 1px solid #4da3ff; background: rgba(20,20,20,0.85); color: #cfe6ff; font-size: 13px; line-height: 20px; text-align: center; cursor: pointer; pointer-events: auto; user-select: none; }
#layer-crop-toggle.is-target-active { display: flex; align-items: center; justify-content: center; }
#layer-crop-toggle.is-crop-mode { background: #4da3ff; color: #0b1a2a; }
/* ㉖ layers[].perspective（v0）: プリセット(右奥/左奥/上奥/下奥) + 角度ツマミのみ（4隅の直接
   ドラッグハンドルは次段）。トグルはクロップトグルの隣（左）に並べ、常に同じ場所に留まる。 */
#layer-perspective-toggle { position: absolute; z-index: 1960; display: none; width: 22px; height: 22px; box-sizing: border-box; border-radius: 4px; border: 1px solid #4da3ff; background: rgba(20,20,20,0.85); color: #cfe6ff; font-size: 13px; line-height: 20px; text-align: center; cursor: pointer; pointer-events: auto; user-select: none; }
#layer-perspective-toggle.is-target-active { display: flex; align-items: center; justify-content: center; }
#layer-perspective-toggle.is-panel-open { background: #4da3ff; color: #0b1a2a; }
#layer-perspective-toggle.is-declared { border-color: #ffb84d; }
#layer-perspective-panel { position: absolute; z-index: 1970; display: none; flex-direction: column; gap: 6px; padding: 8px; width: 168px; box-sizing: border-box; border-radius: 6px; border: 1px solid #4da3ff; background: rgba(20,20,20,0.92); color: #cfe6ff; font-size: 11px; pointer-events: auto; user-select: none; }
#layer-perspective-panel.is-open { display: flex; }
#layer-perspective-panel .akari-perspective-presets { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
#layer-perspective-panel .akari-perspective-preset { border: 1px solid #4da3ff; border-radius: 4px; background: rgba(255,255,255,0.06); color: #cfe6ff; font-size: 11px; padding: 4px 2px; cursor: pointer; }
#layer-perspective-panel .akari-perspective-preset.is-active { background: #4da3ff; color: #0b1a2a; }
#layer-perspective-panel .akari-perspective-angle-row { display: flex; align-items: center; gap: 6px; }
#layer-perspective-panel .akari-perspective-angle-row input[type=range] { flex: 1; }
#layer-perspective-panel .akari-perspective-clear { align-self: flex-end; border: none; background: none; color: #ff8a8a; font-size: 11px; cursor: pointer; padding: 2px 4px; }
#cut-select-box { position: absolute; z-index: 1900; box-sizing: border-box; border: 1.5px solid #4da3ff; box-shadow: 0 0 0 1px rgba(0,0,0,0.35); pointer-events: none; display: none; }
#cut-select-box.is-active { display: block; }
#cut-select-box .akari-cut-handle { position: absolute; width: 12px; height: 12px; margin: -6px; border: 1.5px solid #4da3ff; border-radius: 3px; background: #fff; pointer-events: auto; }
#cut-select-box .akari-cut-handle-nw { top: 0; left: 0; cursor: nwse-resize; }
#cut-select-box .akari-cut-handle-ne { top: 0; left: 100%; cursor: nesw-resize; }
#cut-select-box .akari-cut-handle-sw { top: 100%; left: 0; cursor: nesw-resize; }
#cut-select-box .akari-cut-handle-se { top: 100%; left: 100%; cursor: nwse-resize; }
#caption-select-box { position: absolute; z-index: 1900; box-sizing: border-box; border: 1.5px dashed #4da3ff; box-shadow: 0 0 0 1px rgba(0,0,0,0.35); pointer-events: none; display: none; }
#caption-select-box.is-active { display: block; }
#overlay-stage { position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px; overflow: hidden; pointer-events: none; }
#pen-layer { position: absolute; top: 0; left: 0; z-index: 2; pointer-events: none; }
#pen-layer.is-active { pointer-events: auto; cursor: crosshair; touch-action: none; }
#transition-plate { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
#transition-fallback-label { position: absolute; left: 50%; bottom: 7%; display: none; transform: translateX(-50%); padding: 6px 10px; border: 1px solid rgba(255,255,255,.45); border-radius: 999px; background: rgba(20,20,20,.82); color: #fff; font-size: 12px; font-weight: 600; white-space: nowrap; pointer-events: none; }
/* プレーン字幕 host の見た目は焼き込み既定（captions.mjs）とパリティ: 透明座布団 + 実ストローク縁取り。
   shrink-to-fit の形状と cursor: move はドラッグ当たり判定のため維持する。 */
#caption-plate { position: absolute; left: 50%; bottom: 7%; max-width: 92%; transform: translateX(-50%); padding: 0.08em 0.42em; border-radius: 10px; background: transparent; color: #fff; font-size: ${captionFontSize}px; font-weight: 700; line-height: 1.42; text-align: center; -webkit-text-stroke: 0.14em rgba(0,0,0,.9); paint-order: stroke fill; text-shadow: 0 2px 8px rgba(0,0,0,.35); white-space: pre-wrap; pointer-events: auto; cursor: move; user-select: none; }
#caption-plate:empty { display: none; }
#caption-plate.akari-caption-host--editing:empty { display: block; min-width: 1em; min-height: 1.42em; }
#caption-plate.akari-caption-host--styled { inset: 0; max-width: none; transform: none; padding: 0; border-radius: 0; background: none; text-shadow: none; white-space: normal; --caption-font-size: ${captionFontSize}px; }
#caption-plate.akari-caption-host--editing, #caption-plate.akari-caption-host--editing * { cursor: text; user-select: text; }
#caption-plate.akari-caption-host--editing .akari-caption { pointer-events: auto; }
#caption-plate [data-akari-caption-editing="true"], #caption-plate[data-akari-caption-editing="true"] { pointer-events: auto; outline: 1px solid rgba(255,255,255,0.9); outline-offset: 3px; caret-color: currentColor; }
.output-preview-link { position: absolute; top: 8px; left: 8px; z-index: 5; border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; padding: 5px 9px; background: rgba(20,20,20,0.78); color: #d8e9ff; font-size: 11px; line-height: 1.35; cursor: pointer; }
.output-preview-link:hover { color: #fff; background: rgba(45,45,45,0.9); }
.output-preview-link[hidden] { display: none; }
#zoom-minimap { position: absolute; right: 8px; bottom: 8px; z-index: 3; overflow: hidden; border: 1px solid rgba(255,255,255,0.25); border-radius: 2px; background: rgba(0,0,0,0.55); pointer-events: none; }
#zoom-minimap[hidden] { display: none; }
#zoom-minimap-viewport { position: absolute; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.85); background: rgba(255,255,255,0.55); }
.message-card { position: absolute; inset: 0; z-index: 10; display: grid; gap: 16px; place-items: center; padding: 32px; background: #111; }
.message-card[hidden] { display: none; }
.message-card p { max-width: 520px; margin: 0; color: #e5e5e5; font-size: 15px; line-height: 1.7; text-align: center; }
.message-card-reload { border: 1px solid #505050; border-radius: 4px; padding: 8px 18px; background: #303030; color: #fff; font-size: 13px; cursor: pointer; }
.message-card-reload[hidden] { display: none; }
.audio-notice { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 4; display: flex; align-items: center; gap: 10px; max-width: 92%; padding: 8px 12px; border-radius: 6px; background: rgba(20, 20, 20, 0.78); color: #f1f1f1; font-size: 12.5px; line-height: 1.5; }
.audio-notice[hidden] { display: none; }
.audio-notice button { flex: none; border: none; background: transparent; color: #ccc; font-size: 14px; line-height: 1; cursor: pointer; padding: 2px 4px; }
.write-error-banner { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 2100; display: flex; align-items: flex-start; gap: 10px; width: min(92%, 680px); box-sizing: border-box; padding: 10px 12px; border: 1px solid #ff8a8a; border-radius: 6px; background: #4a1117; color: #fff4f4; box-shadow: 0 4px 18px rgba(0,0,0,0.45); font-size: 12.5px; line-height: 1.5; }
.write-error-banner[hidden] { display: none; }
.write-error-banner span { flex: 1; overflow-wrap: anywhere; }
.write-error-banner button { flex: none; border: none; background: transparent; color: #fff; font-size: 16px; line-height: 1; cursor: pointer; padding: 2px 4px; }
.transport { display: grid; gap: 8px; padding: 9px 14px 10px; border-top: 1px solid #303030; background: #202020; }
.transport-waveform { position: relative; width: 100%; height: 56px; overflow: hidden; border-top: 1px solid #303030; background: #181818; cursor: pointer; touch-action: none; }
.transport-waveform[hidden] { display: none; }
#waveform-canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.transport-waveform-playhead { position: absolute; top: 0; bottom: 0; left: 0; width: 1px; background: rgba(255, 255, 255, 0.9); pointer-events: none; }
.transport-seek { display: flex; width: 100%; }
.transport-seek input { width: 100%; }
.transport-controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; min-width: 0; }
.transport-left, .transport-center, .transport-right { display: flex; align-items: center; gap: 8px; }
.transport-left { position: relative; min-width: 0; justify-self: start; }
.transport-center { justify-self: center; }
.transport-right { position: relative; justify-self: end; }
.icon-button { display: inline-grid; place-items: center; width: 32px; height: 32px; border: 1px solid #505050; border-radius: 4px; padding: 0; background: #303030; color: #fff; cursor: pointer; }
.icon-button[hidden] { display: none; }
.icon-button[aria-pressed="true"] { border-color: #f2f4fa; background: #555b67; box-shadow: 0 0 8px rgba(236,242,255,0.48); }
.icon-button:disabled, .zoom-preset:disabled { opacity: 0.45; cursor: default; }
.icon-button svg { width: 18px; height: 18px; fill: currentColor; stroke: currentColor; }
#time-label { min-width: 104px; color: #d0d0d0; font-variant-numeric: tabular-nums; text-align: left; }
.zoom-popup { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 20; width: 224px; border: 1px solid #505050; border-radius: 6px; padding: 10px; background: #202020; box-shadow: 0 4px 16px rgba(0,0,0,0.45); }
.zoom-popup[hidden] { display: none; }
.zoom-popup-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; color: #d8d8d8; font-size: 12px; }
#zoom-value { color: #fff; font-variant-numeric: tabular-nums; }
#zoom-slider { width: 100%; }
.zoom-presets { display: grid; grid-template-columns: repeat(4, 32px); justify-content: space-between; gap: 5px; margin-top: 8px; }
.zoom-preset { width: 32px; height: 32px; border: 1px solid #505050; border-radius: 4px; padding: 0; background: #303030; color: #fff; font-size: 10px; cursor: pointer; }
</style>
</head>
<body>
<main class="workspace">
  <section class="preview-pane" aria-label="動画プレビュー">
    <div id="preview-wrapper">
      <div id="zoom-layer">
        <div id="preview-stage">
          <div id="preview-layers">
            <video id="preview-video" data-akari-transition-role="outgoing"${primaryIsStillImage ? '' : ` src="${this.escapeHtml(videoSource)}"`} preload="auto" crossorigin="anonymous"></video>
            <img id="preview-still" alt="" draggable="false">
            <video id="transition-video" data-akari-transition-role="incoming" preload="auto" crossorigin="anonymous"></video>
            <img id="transition-still" data-akari-transition-role="incoming-still" alt="" draggable="false">
            <div id="overlay-stage"><div id="transition-plate"></div><div id="transition-fallback-label"></div><div id="caption-plate"></div></div>
          </div>
          <div id="layer-select-box"><div class="akari-layer-rotate-stem"></div><div class="akari-layer-handle akari-layer-handle-nw" data-akari-handle="nw"></div><div class="akari-layer-handle akari-layer-handle-ne" data-akari-handle="ne"></div><div class="akari-layer-handle akari-layer-handle-sw" data-akari-handle="sw"></div><div class="akari-layer-handle akari-layer-handle-se" data-akari-handle="se"></div><div class="akari-layer-handle akari-layer-handle-rotate" data-akari-handle="rotate"></div></div>
          <div id="layer-crop-box"><div class="akari-layer-crop-rect"><div class="akari-layer-crop-handle akari-layer-crop-handle-nw" data-akari-crop-handle="nw"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-n" data-akari-crop-handle="n"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-ne" data-akari-crop-handle="ne"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-e" data-akari-crop-handle="e"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-se" data-akari-crop-handle="se"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-s" data-akari-crop-handle="s"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-sw" data-akari-crop-handle="sw"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-w" data-akari-crop-handle="w"></div></div></div>
          <div id="layer-crop-toggle" title="クロップモード切替 (Esc で終了)">⛶</div>
          <div id="layer-perspective-toggle" title="パース変形パネル">◈</div>
          <div id="layer-perspective-panel">
            <div class="akari-perspective-presets">
              <button type="button" class="akari-perspective-preset" data-akari-perspective-preset="right">右奥</button>
              <button type="button" class="akari-perspective-preset" data-akari-perspective-preset="left">左奥</button>
              <button type="button" class="akari-perspective-preset" data-akari-perspective-preset="top">上奥</button>
              <button type="button" class="akari-perspective-preset" data-akari-perspective-preset="bottom">下奥</button>
            </div>
            <div class="akari-perspective-angle-row">
              <span>角度</span>
              <input type="range" min="0" max="75" step="1" value="30" data-akari-perspective-angle />
              <span data-akari-perspective-angle-value>30°</span>
            </div>
            <button type="button" class="akari-perspective-clear" data-akari-perspective-clear>パースを解除</button>
          </div>
          <div id="cut-select-box"><div class="akari-cut-handle akari-cut-handle-nw" data-akari-handle="nw"></div><div class="akari-cut-handle akari-cut-handle-ne" data-akari-handle="ne"></div><div class="akari-cut-handle akari-cut-handle-sw" data-akari-handle="sw"></div><div class="akari-cut-handle akari-cut-handle-se" data-akari-handle="se"></div></div>
          <div id="caption-select-box"></div>
          <canvas id="pen-layer" aria-hidden="true"></canvas>
        </div>
      </div>
      <button id="output-preview-link" class="output-preview-link" type="button"${model.relatedEditUri ? '' : ' hidden'}>合成は出力プレビューで確認（開く）</button>
      <div id="audio-notice" class="audio-notice" hidden role="status">
        <span>音声が検出されていません。無音の素材か、音声形式がプレビュー非対応の可能性があります（書き出しには影響しません）。</span>
        <button id="audio-notice-dismiss" type="button" aria-label="閉じる" title="閉じる">×</button>
      </div>
      <div id="write-error-banner" class="write-error-banner" hidden role="alert" aria-live="assertive">
        <span id="write-error-message"></span>
        <button id="write-error-dismiss" type="button" aria-label="閉じる" title="閉じる">×</button>
      </div>
      <div id="preview-message" class="message-card" hidden role="status">
        <p id="preview-message-text">${UNSUPPORTED_FORMAT_MESSAGE}</p>
        <button id="preview-message-reload" class="message-card-reload" type="button" hidden>再読み込み</button>
      </div>
    </div>
    <div id="zoom-minimap" hidden aria-hidden="true"><div id="zoom-minimap-viewport"></div></div>
  </section>
</main>
<div class="transport">
  <div class="transport-waveform" hidden>
    <canvas id="waveform-canvas" aria-label="音声波形"></canvas>
    <div class="transport-waveform-playhead" aria-hidden="true"></div>
  </div>
  <div class="transport-seek">
    <input id="seek" type="range" min="0" max="0" step="0.001" value="0" aria-label="再生位置">
  </div>
  <div class="transport-controls">
    <div class="transport-left">
      <button id="waveform-toggle" class="icon-button" type="button" aria-label="波形" title="波形" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h2m2-4v8m3-12v16m3-13v10m3-7v4m3-2h2" fill="none" stroke-width="2" stroke-linecap="round"/></svg></button>
      <button id="indicator-toggle" class="icon-button" type="button" aria-label="プレビュー未対応の項目" title="プレビュー未対応の項目" aria-expanded="false" hidden>ⓘ</button>
      <div id="indicator-popup" class="zoom-popup" hidden></div>
      <span id="time-label">0:00 / 0:00</span>
    </div>
    <div class="transport-center">
      <button id="skip-back" class="icon-button" type="button" aria-label="10秒戻る" title="10秒戻る"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5V2L6.5 6 11 10V7a6 6 0 1 1-5.65 8H3.26A8 8 0 1 0 11 5Z"/><text x="8" y="17" fill="currentColor" stroke="none" font-size="7" font-family="system-ui,sans-serif" font-weight="700">10</text></svg></button>
      <button id="frame-back" class="icon-button" type="button" aria-label="1コマ戻る" title="1コマ戻る"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM18 5v14l-9-7z"/></svg></button>
      <button id="play-toggle" class="icon-button" type="button" aria-label="再生" title="再生"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
      <button id="frame-forward" class="icon-button" type="button" aria-label="1コマ進む" title="1コマ進む"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM6 5v14l9-7z"/></svg></button>
      <button id="skip-forward" class="icon-button" type="button" aria-label="10秒進む" title="10秒進む"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5V2l4.5 4-4.5 4V7a6 6 0 1 0 5.65 8h2.09A8 8 0 1 1 13 5Z"/><text x="8" y="17" fill="currentColor" stroke="none" font-size="7" font-family="system-ui,sans-serif" font-weight="700">10</text></svg></button>
    </div>
    <div class="transport-right">
      <button id="pen-toggle" class="icon-button" type="button" aria-label="ペン" title="ペン" aria-pressed="false" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19.5 8.5a2.12 2.12 0 0 0-3-3zM14.8 7.2l2 2M4 16l4 4"/></svg></button>
      <button id="zoom-toggle" class="icon-button" type="button" aria-label="ズーム" title="ズーム" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke-width="2"/><path d="m15.5 15.5 5 5" fill="none" stroke-width="2" stroke-linecap="round"/></svg></button>
      <button id="fullscreen-toggle" class="icon-button" type="button" aria-label="全画面" title="全画面" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zm3 11h2v5h-5v-2h3zM9 18v2H4v-5h2v3z"/></svg></button>
      <div id="zoom-popup" class="zoom-popup" hidden>
        <div class="zoom-popup-header"><span>ズーム</span><span id="zoom-value">100%</span></div>
        <input id="zoom-slider" type="range" min="0" max="1" step="0.001" aria-label="ズーム倍率" title="ダブルクリックで100%">
        <div class="zoom-presets">
          <button class="zoom-preset" type="button" data-zoom="0.5" aria-label="50%にズーム" title="50%にズーム">50%</button>
          <button class="zoom-preset" type="button" data-zoom="1" aria-label="100%にズーム" title="100%にズーム">100%</button>
          <button class="zoom-preset" type="button" data-zoom="2" aria-label="200%にズーム" title="200%にズーム">200%</button>
          <button class="zoom-preset" type="button" data-zoom="4" aria-label="400%にズーム" title="400%にズーム">400%</button>
        </div>
      </div>
    </div>
  </div>
</div>
<script>window.__akariPreview = ${initialState};</script>
<script>window.__akariCaptionFontReady = (async () => { await document.fonts.load(${JSON.stringify(CAPTION_FONT_LOAD_DESCRIPTOR)}); await document.fonts.ready; if (!document.fonts.check(${JSON.stringify(CAPTION_FONT_LOAD_DESCRIPTOR)})) throw new Error('AKARI caption font did not load'); return true; })();</script>
<script>${this.hostAdapterScript()}</script>
<script>${this.inlineScript(assets.threeJavaScript)}</script>
<script>${this.inlineScript(assets.threeRuntimeJavaScript)}</script>
<script>${this.inlineScript(assets.videoFxJavaScript)}</script>
<script>${this.inlineScript(assets.runtimeJavaScript)}</script>
<script>${this.inlineScript(assets.interactionJavaScript)}</script>
<script>${this.inlineScript(assets.webviewKernelJavaScript)}</script>
<script>${this.previewBootstrapScript()}</script>
</body>
</html>`;
    }

    protected prepareMessageHtml(message: string): string {
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; background: #111; color: #eee; }
body { display: grid; place-items: center; padding: 32px; }
.message-card { width: min(100%, 560px); border: 1px solid #353535; border-radius: 8px; padding: 28px; background: #1b1b1b; }
.message-card p { margin: 0; font-size: 15px; line-height: 1.7; text-align: center; }
</style>
</head>
<body>
<main class="message-card" role="status"><p>${this.escapeHtml(message)}</p></main>
</body>
</html>`;
    }

    protected hostAdapterScript(): string {
        return `(() => {
            const initial = window.__akariPreview;
            const vscode = acquireVsCodeApi();
            const pending = new Map();
            // ㉖ layers[].perspective（contract-2026-08-02-preview-parity.md §2.4.4）: updateStageScale
            // (below, in this same IIFE) needs this at layout time, which runs before
            // previewBootstrapScript's own copy of this function is ever reached -- so this script
            // block injects its own copy rather than relying on cross-<script>-tag scope.
            const computeLayerPerspectiveVisualFn = (${computeLayerPerspectiveVisual.toString()});
            const resolveLayerHitRegionClipFn = (${resolveLayerHitRegionClip.toString()});
            let perspectiveVisualWarned = false;
            let sequence = 0;
            let displayScale = 1;
            // frameScale: 出力キャンバス(output.width/height)を output 比そのものの preview-stage へ
            // 写像する CSS px / 出力 px 比。base/layers/captions/overlays は同じキャンバス矩形、
            // #pen-layer はその中の実映像矩形へ写像する。
            let frameScale = 1;
            let lastPlaybackTickAt = -Infinity;
            const wrapper = document.getElementById('preview-wrapper');
            const previewStage = document.getElementById('preview-stage');
            const video = document.getElementById('preview-video');
            const transitionVideo = document.getElementById('transition-video');
            const stillImage = document.getElementById('preview-still');
            const transitionStill = document.getElementById('transition-still');
            const outputPreviewLink = document.getElementById('output-preview-link');
            const writeErrorBanner = document.getElementById('write-error-banner');
            const writeErrorMessage = document.getElementById('write-error-message');
            const writeErrorDismiss = document.getElementById('write-error-dismiss');
            const layersStage = document.getElementById('preview-layers');
            const stage = document.getElementById('overlay-stage');
            const penLayer = document.getElementById('pen-layer');
            const output = initial.summary.output;

            window.akari = window.akari || {};
            window.akari.state = { editPath: initial.editPath, summary: initial.summary };
            window.akari.showWriteError = error => {
                const reason = error instanceof Error ? error.message : String(error || '書き込みに失敗しました');
                writeErrorMessage.textContent = reason;
                writeErrorBanner.hidden = false;
            };
            writeErrorDismiss.addEventListener('click', () => {
                writeErrorBanner.hidden = true;
            });
            window.akari.engine = {
                overlayWrite: (_editPath, overlayId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'overlay-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-overlay-write', requestId, overlayId, patch });
                }),
                layerWrite: (layerId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'layer-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-layer-write', requestId, layerId, patch });
                }),
                cutWrite: (cutIndex, cutId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'cut-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-cut-write', requestId, cutIndex, cutId, patch });
                }),
                captionWrite: (captionId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'caption-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-caption-write', requestId, captionId, patch });
                }),
                readWaveformBytes: () => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-waveform-' + (++sequence);
                    pending.set(requestId, { kind: 'waveform-fetch', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-waveform-fetch', requestId });
                }),
                // task/2026-08-09-drop-hevc-proxy: <video> が実際に再生失敗したときだけ呼ぶ
                // フォールバック要求。成功時はホスト側が widget を丸ごとリロードするので、呼び出し側
                // (previewBootstrapScript) は resolve を特に処理しない — 失敗時だけ通常のエラー表示に
                // 戻す。
                resolveHevcFallback: (errorCode, videoUri) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-hevc-fallback-' + (++sequence);
                    pending.set(requestId, { kind: 'hevc-fallback', resolve, reject });
                    vscode.postMessage({
                        type: 'akari-preview-hevc-fallback-request', requestId, errorCode,
                        ...(typeof videoUri === 'string' && videoUri ? { videoUri } : {})
                    });
                })
            };
            const createPreviewAudio = () => {
                let config = initial.summary && initial.summary.audio;
                const hasAudio = config && (config.bgm
                    || (Array.isArray(config.sfx) && config.sfx.length > 0)
                    || (Array.isArray(config.narration) && config.narration.length > 0));
                if (!hasAudio) return null;

                const video = document.getElementById('preview-video');
                let context;
                try {
                    context = new AudioContext();
                } catch (error) {
                    console.warn('[akari-preview] audio graph unavailable; continuing with video only', error);
                    return null;
                }
                const masterGain = context.createGain();
                masterGain.connect(context.destination);
                // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: sfx/bgm trim + schedule
                // math, shared with this same module's node:test unit tests
                // (test/audio-schedule.test.mjs) via src/common/audio-schedule.ts -- see that file's
                // header comment (same pattern as preview-composite-layout.ts's fitCompositeRect
                // below).
                const resolveSfxTrimWindowFn = (${resolveSfxTrimWindow.toString()});
                const resolveBgmSourceOffsetFn = (${resolveBgmSourceOffset.toString()});
                const bgmLoopOffsetSecondsFn = (${bgmLoopOffsetSeconds.toString()});
                const resolveTimedScheduleWindowFn = (${resolveTimedScheduleWindow.toString()});
                const sfxFadeGainScheduleFn = (${sfxFadeGainSchedule.toString()});
                const decoded = { bgm: null, sfx: [], narration: [] };
                let timelineDuration = 0;
                let loadPromise = null;
                let generation = 0;
                let active = [];
                let bgmGain = null;
                let lastDuckGainDb = null;
                let mutedSfxTracks = new Set();
                let allSfxMuted = false;

                const dbToLinear = gainDb => Math.pow(10, gainDb / 20);
                // クリップ全体ミュート（akariGlobalMuted。クリップ帯のスピーカートグルが送る旧 setMuted
                // イベント由来）は video.muted のみに効かせる。BGM/SFX/narration の audibility は
                // audio scope の個別ミュート（allSfxMuted/mutedSfxTracks）で独立制御する
                // （クリップのスピーカーを OFF にしても BGM/SFX は継続する契約要求のため）。
                const syncMasterGain = () => {
                    if (video.dataset.akariTransitionAudioActive === 'true') return;
                    const volume = Number.isFinite(video.volume) ? Math.max(0, Math.min(1, video.volume)) : 1;
                    masterGain.gain.value = volume;
                };
                const warnUnavailable = (kind, id, error) => {
                    console.warn('[akari-preview] ' + kind + ' ' + id
                        + ' unavailable (fetch/decode failed); skipping element', error);
                };
                // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 (consumption side): 実尺
                // (the real decoded duration) is only known post-decode, so in/out clamping happens
                // here, via the shared resolveSfxTrimWindowFn/resolveBgmSourceOffsetFn -- mirrors
                // packages/render-cut/src/plan.mjs's resolveSfxTrim/resolveBgmInSeconds.
                const decodeOne = async (kind, spec) => {
                    try {
                        const response = await fetch(spec.src);
                        if (!response.ok) throw new Error('fetch status=' + response.status);
                        const buffer = await context.decodeAudioData(await response.arrayBuffer());
                        if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) {
                            throw new Error('decoded audio duration is invalid');
                        }
                        if (kind === 'sfx' && (spec.in !== undefined || spec.out !== undefined)) {
                            const trimWindow = resolveSfxTrimWindowFn(spec.in, spec.out, buffer.duration, 'sfx ' + spec.id);
                            if (trimWindow.warning) console.warn('[akari-preview] ' + trimWindow.warning);
                            if (trimWindow.skip) return null;
                            return { ...spec, buffer, durationSec: trimWindow.durationSec, sourceOffset: trimWindow.sourceOffset };
                        }
                        if (kind === 'bgm' && spec.in !== undefined) {
                            const resolved = resolveBgmSourceOffsetFn(spec.in, buffer.duration);
                            if (resolved.warning) console.warn('[akari-preview] ' + resolved.warning);
                            return { ...spec, buffer, durationSec: buffer.duration, sourceOffset: resolved.sourceOffset };
                        }
                        return { ...spec, buffer, durationSec: buffer.duration };
                    } catch (error) {
                        if (context.state !== 'closed') {
                            warnUnavailable(kind, spec.id || kind, error);
                        }
                        return null;
                    }
                };
                const load = duration => {
                    if (Number.isFinite(duration) && duration > 0) timelineDuration = duration;
                    if (loadPromise || timelineDuration <= 0) return loadPromise || Promise.resolve();
                    loadPromise = (async () => {
                        const timed = async (kind, specs) => {
                            const valid = [];
                            for (const spec of Array.isArray(specs) ? specs : []) {
                                if (!Number.isFinite(spec.t) || spec.t < 0 || spec.t >= timelineDuration) {
                                    console.warn('[akari-preview] ' + kind + ' ' + spec.id
                                        + ' skipped: t is outside timeline duration');
                                    continue;
                                }
                                valid.push(spec);
                            }
                            return (await Promise.all(valid.map(spec => decodeOne(kind, spec)))).filter(Boolean);
                        };
                        const [bgm, sfx, narration] = await Promise.all([
                            config.bgm ? decodeOne('bgm', { ...config.bgm, id: 'bgm' }) : Promise.resolve(null),
                            timed('sfx', config.sfx),
                            timed('narration', config.narration)
                        ]);
                        decoded.bgm = bgm;
                        decoded.sfx = sfx;
                        decoded.narration = narration;
                        if (context.state !== 'closed') {
                            console.info('[akari-preview] audio graph ready', {
                                contextState: context.state,
                                timelineDuration,
                                decoded: {
                                    bgm: Boolean(decoded.bgm),
                                    sfx: decoded.sfx.map(item => item.id),
                                    narration: decoded.narration.map(item => item.id)
                                }
                            });
                        }
                    })();
                    return loadPromise;
                };
                const detachActive = item => {
                    active = active.filter(candidate => candidate !== item);
                    try { item.source.disconnect(); } catch (_error) { /* already detached */ }
                    try { item.gain.disconnect(); } catch (_error) { /* already detached */ }
                };
                const stopSources = () => {
                    const sources = active;
                    active = [];
                    bgmGain = null;
                    lastDuckGainDb = null;
                    for (const item of sources) {
                        item.source.onended = null;
                        try { item.source.stop(); } catch (_error) { /* already stopped */ }
                        try { item.source.disconnect(); } catch (_error) { /* already detached */ }
                        try { item.gain.disconnect(); } catch (_error) { /* already detached */ }
                    }
                };
                const registerSource = (source, gain, kind, id, track, baseGainLinear, hasFade = false) => {
                    const item = { source, gain, kind, id, track, baseGainLinear, hasFade };
                    active.push(item);
                    source.onended = () => detachActive(item);
                    return item;
                };
                const duckGainDbAt = timelineTime => {
                    if (!decoded.bgm || decoded.bgm.ducking !== true) return 0;
                    return decoded.narration.some(item => timelineTime >= item.t
                        && timelineTime < item.t + item.durationSec) ? -12 : 0;
                };
                const fadeMultiplierAt = timelineTime => {
                    if (!decoded.bgm) return 1;
                    const total = timelineDuration;
                    const rawIn = decoded.bgm.fadeIn;
                    const rawOut = decoded.bgm.fadeOut;
                    const fadeIn = Number.isFinite(rawIn) && rawIn > 0 ? Math.min(rawIn, total / 2) : 0;
                    const fadeOut = Number.isFinite(rawOut) && rawOut > 0 ? Math.min(rawOut, total / 2) : 0;
                    let multiplier = 1;
                    if (fadeIn > 0 && timelineTime < fadeIn) multiplier = Math.min(multiplier, timelineTime / fadeIn);
                    if (fadeOut > 0 && timelineTime > total - fadeOut) {
                        multiplier = Math.min(multiplier, (total - timelineTime) / fadeOut);
                    }
                    return Math.max(0, Math.min(1, multiplier));
                };
                const applyBgmDuck = timelineTime => {
                    if (!decoded.bgm) return;
                    const duckGainDb = duckGainDbAt(timelineTime);
                    const fadeMultiplier = fadeMultiplierAt(timelineTime);
                    if (bgmGain) {
                        bgmGain.gain.value = allSfxMuted
                            ? 0 : dbToLinear(decoded.bgm.gainDb + duckGainDb) * fadeMultiplier;
                    }
                    if (duckGainDb !== lastDuckGainDb) {
                        lastDuckGainDb = duckGainDb;
                        console.info('[akari-preview] bgm duck gain', {
                            timelineTime,
                            baseGainDb: decoded.bgm ? decoded.bgm.gainDb : null,
                            duckGainDb,
                            appliedGainDb: decoded.bgm ? decoded.bgm.gainDb + duckGainDb : null,
                            fadeMultiplier,
                            appliedLinear: decoded.bgm
                                ? dbToLinear(decoded.bgm.gainDb + duckGainDb) * fadeMultiplier
                                : null
                        });
                    }
                };
                const scheduleFrom = async timelineTime => {
                    const scheduleGeneration = ++generation;
                    stopSources();
                    await load(timelineDuration);
                    if (scheduleGeneration !== generation || timelineDuration <= 0) return;
                    const startAt = Math.max(0, Math.min(timelineDuration, timelineTime));
                    const contextStart = context.currentTime + 0.015;
                    const remaining = timelineDuration - startAt;
                    let scheduledBgm = false;
                    let scheduledSfx = 0;
                    let scheduledNarration = 0;
                    if (decoded.bgm && remaining > 0) {
                        try {
                            const source = context.createBufferSource();
                            const gain = context.createGain();
                            source.buffer = decoded.bgm.buffer;
                            source.loop = true;
                            source.connect(gain);
                            gain.connect(masterGain);
                            bgmGain = gain;
                            applyBgmDuck(startAt);
                            registerSource(source, gain, 'bgm', 'bgm');
                            // audio.bgm.in: file-internal start offset, composed with the existing
                            // timeline-position-to-source-position mapping via bgmLoopOffsetSecondsFn.
                            // loop=true means once playback reaches the buffer's own end it wraps to
                            // source position 0 (not back to in) -- the existing loop semantics are
                            // otherwise untouched; this only computes where playback begins.
                            const bgmOffset = bgmLoopOffsetSecondsFn(decoded.bgm.sourceOffset || 0, startAt, decoded.bgm.durationSec);
                            source.start(contextStart, bgmOffset);
                            source.stop(contextStart + remaining);
                            scheduledBgm = true;
                        } catch (error) {
                            warnUnavailable('bgm', 'bgm', error);
                            bgmGain = null;
                        }
                    }
                    const scheduleTimed = (kind, item) => {
                        // audio.sfx.in: material source offset, composed via resolveTimedScheduleWindowFn
                        // with the existing resume-from-mid-playback offset -- when item.sourceOffset is
                        // absent (narration; sfx without in/out) this reduces to the original schedule math.
                        const scheduleWindow = resolveTimedScheduleWindowFn(item.t, item.durationSec, item.sourceOffset || 0, startAt, timelineDuration, remaining);
                        if (!scheduleWindow.shouldSchedule) return false;
                        const delay = scheduleWindow.delaySec;
                        const offset = scheduleWindow.sourceOffsetSec;
                        const available = scheduleWindow.availableSec;
                        try {
                            const source = context.createBufferSource();
                            const gain = context.createGain();
                            const baseGainLinear = dbToLinear(item.gainDb);
                            source.buffer = item.buffer;
                            gain.gain.value = baseGainLinear;
                            source.connect(gain);
                            gain.connect(masterGain);
                            // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum
                            // (audio-clip-fades, 2026-08-18; sfx only): fade_in/fade_out, applied as
                            // AudioParam automation over the clip's own scheduled window (not a
                            // per-tick poll like bgm's fadeMultiplierAt -- this source is a one-shot
                            // BufferSourceNode, not a continuously re-evaluated loop). hasFade tells
                            // tick()'s mute-sync loop to leave gain.value alone so it doesn't clobber
                            // the in-flight ramp on its next 30Hz pass.
                            let hasFade = false;
                            if (kind === 'sfx' && (item.fadeIn !== undefined || item.fadeOut !== undefined)) {
                                const fadeSchedule = sfxFadeGainScheduleFn(item.fadeIn, item.fadeOut, item.durationSec, scheduleWindow.elapsedIntoItemSec, available);
                                if (fadeSchedule.length > 0) {
                                    hasFade = true;
                                    const startTime = contextStart + delay;
                                    gain.gain.cancelScheduledValues(startTime);
                                    gain.gain.setValueAtTime(baseGainLinear * fadeSchedule[0].gainMultiplier, startTime);
                                    for (let i = 1; i < fadeSchedule.length; i += 1) {
                                        gain.gain.linearRampToValueAtTime(
                                            baseGainLinear * fadeSchedule[i].gainMultiplier,
                                            startTime + fadeSchedule[i].offsetSec
                                        );
                                    }
                                }
                            }
                            registerSource(source, gain, kind, item.id, item.track, baseGainLinear, hasFade);
                            source.start(contextStart + delay, offset, available);
                            return true;
                        } catch (error) {
                            warnUnavailable(kind, item.id, error);
                            return false;
                        }
                    };
                    for (const item of decoded.sfx) {
                        if (scheduleTimed('sfx', item)) scheduledSfx += 1;
                    }
                    for (const item of decoded.narration) {
                        if (scheduleTimed('narration', item)) scheduledNarration += 1;
                    }
                    console.info('[akari-preview] audio scheduled', {
                        timelineTime: startAt,
                        bgm: scheduledBgm,
                        sfx: scheduledSfx,
                        narration: scheduledNarration
                    });
                };
                const controller = {
                    setTimelineDuration: duration => load(duration),
                    setMutedTracks: (trackSet, allMuted) => {
                        mutedSfxTracks = new Set(trackSet);
                        allSfxMuted = allMuted === true;
                    },
                    resume: () => context.resume().catch(error => {
                        console.warn('[akari-preview] AudioContext resume failed; continuing with video only', error);
                    }),
                    playFrom: timelineTime => controller.resume().then(() => scheduleFrom(timelineTime)),
                    pause: () => {
                        generation += 1;
                        stopSources();
                    },
                    updateConfig: async (nextConfig, timelineTime, playing) => {
                        generation += 1;
                        stopSources();
                        config = nextConfig || { sfx: [], narration: [] };
                        decoded.bgm = null;
                        decoded.sfx = [];
                        decoded.narration = [];
                        loadPromise = null;
                        await load(timelineDuration);
                        if (playing) await scheduleFrom(timelineTime);
                    },
                    tick: (timelineTime, playing) => {
                        syncMasterGain();
                        for (const item of active.filter(candidate => candidate.kind === 'sfx')) {
                            const muted = allSfxMuted || mutedSfxTracks.has(item.track);
                            if (muted) {
                                item.gain.gain.value = 0;
                            } else if (!item.hasFade) {
                                item.gain.gain.value = item.baseGainLinear;
                            }
                            // else: fade_in/fade_out already drives gain.gain via the scheduled
                            // AudioParam ramp (audio-clip-fades) -- writing item.gain.gain.value here
                            // (even to its own current value) would insert a new automation event
                            // and cut the ramp short, so this 30Hz poll leaves it alone while unmuted.
                        }
                        if (playing) applyBgmDuck(timelineTime);
                    },
                    debugState: () => ({
                        contextState: context.state,
                        timelineDuration,
                        decoded: {
                            bgm: Boolean(decoded.bgm),
                            bgmSourceOffset: decoded.bgm ? decoded.bgm.sourceOffset || 0 : null,
                            sfx: decoded.sfx.map(item => ({ id: item.id, t: item.t, durationSec: item.durationSec, sourceOffset: item.sourceOffset || 0 })),
                            narration: decoded.narration.map(item => ({ id: item.id, t: item.t, durationSec: item.durationSec }))
                        },
                        active: {
                            bgm: active.filter(item => item.kind === 'bgm').length,
                            sfx: active.filter(item => item.kind === 'sfx').length,
                            narration: active.filter(item => item.kind === 'narration').length
                        },
                        masterGainLinear: masterGain.gain.value,
                        bgmGainLinear: bgmGain ? bgmGain.gain.value : null,
                        duckGainDb: lastDuckGainDb
                    })
                };
                syncMasterGain();
                video.addEventListener('volumechange', syncMasterGain);
                window.addEventListener('pagehide', () => {
                    controller.pause();
                    void context.close().catch(() => undefined);
                }, { once: true });
                return controller;
            };
            window.akari.previewAudio = createPreviewAudio();
            window.akari.previewAudioDebug = () => window.akari.previewAudio
                ? window.akari.previewAudio.debugState()
                : { disabled: true };
            window.akari.stageScale = () => frameScale;
            window.akari.playbackTick = (time, playing, immediate = false) => {
                const now = performance.now();
                if (!immediate && now - lastPlaybackTickAt < 50) return;
                lastPlaybackTickAt = now;
                vscode.postMessage({ type: 'akari-preview-playback-tick', time, playing, rate: video.playbackRate || 1 });
            };
            window.akari.reviewTransport = event => {
                vscode.postMessage({ type: 'akari-preview-review-transport-event', event });
            };
            window.akari.reviewStrokeStart = frame => {
                vscode.postMessage({ type: 'akari-preview-review-stroke-start', frame });
            };
            window.akari.reviewStrokeEnd = points => {
                vscode.postMessage({ type: 'akari-preview-review-stroke-end', points });
            };
            // window.akari 経由で公開する -- previewBootstrapScript は別 IIFE（hostAdapterScript
            // とスコープを共有しない）ため、window.akari.reviewStrokeStart 等と同じく window 越しに
            // 呼ぶ必要がある。
            window.akari.reviewSetToolMode = mode => {
                vscode.postMessage({ type: 'akari-preview-review-tool-mode-request', mode });
            };
            window.akari.reviewRectStart = frame => {
                vscode.postMessage({ type: 'akari-preview-review-rect-start', frame });
            };
            window.akari.reviewRectEnd = box => {
                vscode.postMessage({ type: 'akari-preview-review-rect-end', box });
            };
            window.akari.reportOverlaySelection = overlayId => {
                vscode.postMessage({ type: 'akari-preview-overlay-selected', overlayId });
            };
            window.akari.reportLayerSelection = layerId => {
                vscode.postMessage({ type: 'akari-preview-layer-selected', layerId });
            };
            window.akari.reportCutSelection = cutId => {
                vscode.postMessage({ type: 'akari-preview-cut-selected', cutId });
            };
            window.akari.reportCaptionSelection = captionId => {
                vscode.postMessage({ type: 'akari-preview-caption-selected', captionId });
            };
            if (outputPreviewLink && initial.relatedEditUri) {
                outputPreviewLink.addEventListener('click', () => {
                    vscode.postMessage({ type: 'akari-preview-open-output-request' });
                });
            }
            window.akari.toggleFullscreen = () => {
                if (document.fullscreenElement) {
                    return document.exitFullscreen();
                }
                try {
                    return Promise.resolve(document.documentElement.requestFullscreen()).catch(() => {
                        vscode.postMessage({ type: 'akari-preview-fullscreen-fallback' });
                    });
                } catch (_error) {
                    vscode.postMessage({ type: 'akari-preview-fullscreen-fallback' });
                    return Promise.resolve();
                }
            };

            const PENDING_RESPONSE_TYPES = {
                'overlay-write': 'akari-preview-overlay-write-response',
                'layer-write': 'akari-preview-layer-write-response',
                'cut-write': 'akari-preview-cut-write-response',
                'caption-write': 'akari-preview-caption-write-response',
                'waveform-fetch': 'akari-preview-waveform-fetch-response',
                'hevc-fallback': 'akari-preview-hevc-fallback-response'
            };
            window.addEventListener('message', event => {
                const message = event.data;
                if (!message || !Object.values(PENDING_RESPONSE_TYPES).includes(message.type)) return;
                const request = pending.get(message.requestId);
                if (!request) return;
                const expectedType = PENDING_RESPONSE_TYPES[request.kind];
                if (message.type !== expectedType) return;
                pending.delete(message.requestId);
                if (!message.ok) {
                    const fallback = request.kind === 'waveform-fetch'
                        ? '動画データの読み込みに失敗しました'
                        : request.kind === 'caption-write'
                            ? 'captions.json の書き込みに失敗しました'
                            : request.kind === 'hevc-fallback'
                                ? '動画の互換変換に失敗しました'
                                : 'edit.json の書き込みに失敗しました';
                    const reason = message.error || fallback;
                    window.akari.showWriteError(reason);
                    request.reject(new Error(reason));
                    return;
                }
                if (request.kind !== 'waveform-fetch') {
                    writeErrorBanner.hidden = true;
                    request.resolve(undefined);
                    return;
                }
                try {
                    const binary = atob(String(message.dataBase64 || ''));
                    const bytes = new Uint8Array(binary.length);
                    for (let index = 0; index < binary.length; index += 1) {
                        bytes[index] = binary.charCodeAt(index);
                    }
                    request.resolve(bytes.buffer);
                } catch (error) {
                    request.reject(error);
                }
            });

            const fitCompositeRect = (${fitPreviewCompositeRect.toString()});
            const computeOutputFrameRect = () => {
                // #preview-stage 自身が output 比のキャンバス箱。getBoundingClientRect() の
                // sub-pixel 寸法を使い、内側へ二重の letterbox を作らない。
                const stageRect = previewStage.getBoundingClientRect();
                const zoomLayerRect = document.getElementById('zoom-layer').getBoundingClientRect();
                const zoomScaleX = zoomLayerRect.width > 0 && wrapper.clientWidth > 0
                    ? zoomLayerRect.width / wrapper.clientWidth : 1;
                const zoomScaleY = zoomLayerRect.height > 0 && wrapper.clientHeight > 0
                    ? zoomLayerRect.height / wrapper.clientHeight : 1;
                return {
                    x: 0,
                    y: 0,
                    width: stageRect.width / (zoomScaleX || 1),
                    height: stageRect.height / (zoomScaleY || 1)
                };
            };
            const computeContentRect = () => {
                const frameRect = computeOutputFrameRect();
                const boxWidth = frameRect.width;
                const boxHeight = frameRect.height;
                const videoWidth = video.videoWidth;
                const videoHeight = video.videoHeight;
                if (!(boxWidth > 0) || !(boxHeight > 0) || !(videoWidth > 0) || !(videoHeight > 0)) {
                    return frameRect;
                }
                const contentRect = fitCompositeRect(frameRect.width, frameRect.height, videoWidth, videoHeight);
                return {
                    x: frameRect.x + contentRect.x,
                    y: frameRect.y + contentRect.y,
                    width: contentRect.width,
                    height: contentRect.height
                };
            };
            // crop / perspective / keyframes を持つ media item は render-cut でも layer-style
            // （ソース実寸基準、crop 中心を錨に配置）へ入る。layer DOM と cut DOM が同じ描画式を
            // 必ず通るよう、既存 layer loop の本体をこの 1 関数へ寄せる。perspective と clip は
            // layer 側の既存純関数をそのまま使い、cut 用の計算は持たない。
            const mediaNaturalSize = media => ({
                width: media.tagName === 'IMG' ? media.naturalWidth : media.videoWidth,
                height: media.tagName === 'IMG' ? media.naturalHeight : media.videoHeight
            });
            const applyLayerStyleMediaLayout = (media, outputWidth, outputHeight) => {
                const natural = mediaNaturalSize(media);
                if (!(natural.width > 0) || !(natural.height > 0)) return false;
                const x = Number(media.dataset.akariTransformX) || 0;
                const y = Number(media.dataset.akariTransformY) || 0;
                const scale = Number(media.dataset.akariTransformScale) || 1;
                const rotate = Number(media.dataset.akariTransformRotate) || 0;
                const cropX = Number(media.dataset.akariCropX) || 0;
                const cropY = Number(media.dataset.akariCropY) || 0;
                const cropWRaw = Number(media.dataset.akariCropW);
                const cropHRaw = Number(media.dataset.akariCropH);
                const cropW = Number.isFinite(cropWRaw) && cropWRaw > 0 ? cropWRaw : 1;
                const cropH = Number.isFinite(cropHRaw) && cropHRaw > 0 ? cropHRaw : 1;
                const pivotXPct = (cropX + cropW / 2) * 100;
                const pivotYPct = (cropY + cropH / 2) * 100;
                media.style.objectFit = 'fill';
                media.style.width = (natural.width * scale) + 'px';
                media.style.height = (natural.height * scale) + 'px';
                media.style.left = (outputWidth / 2 + x) + 'px';
                media.style.top = (outputHeight / 2 + y) + 'px';
                media.style.transformOrigin = pivotXPct + '% ' + pivotYPct + '%';
                let perspectiveFn = '';
                const perspectiveRaw = media.dataset.akariPerspectiveCorners;
                if (perspectiveRaw) {
                    let corners = null;
                    try { corners = JSON.parse(perspectiveRaw); } catch (_error) { corners = null; }
                    const boxWidthPx = natural.width * cropW * scale;
                    const boxHeightPx = natural.height * cropH * scale;
                    try {
                        const visual = corners
                            ? computeLayerPerspectiveVisualFn({ corners }, boxWidthPx, boxHeightPx) : null;
                        if (visual) perspectiveFn = ' ' + visual.transformFunction;
                    } catch (error) {
                        if (!perspectiveVisualWarned) {
                            perspectiveVisualWarned = true;
                            console.warn('[akari-preview] layer perspective visual failed; rendering without perspective', error);
                        }
                    }
                }
                media.style.transform = 'translate(-' + pivotXPct + '%, -' + pivotYPct + '%) rotate('
                    + rotate + 'deg)' + perspectiveFn;
                const opaqueX = Number(media.dataset.akariOpaqueX);
                const opaqueY = Number(media.dataset.akariOpaqueY);
                const opaqueW = Number(media.dataset.akariOpaqueW);
                const opaqueH = Number(media.dataset.akariOpaqueH);
                const opaqueBox = [opaqueX, opaqueY, opaqueW, opaqueH].every(Number.isFinite)
                    && opaqueW > 0 && opaqueH > 0
                    ? { x: opaqueX, y: opaqueY, w: opaqueW, h: opaqueH }
                    : undefined;
                media.style.clipPath = resolveLayerHitRegionClipFn(
                    natural.width,
                    natural.height,
                    { x: cropX, y: cropY, w: cropW, h: cropH },
                    opaqueBox
                );
                media.dataset.akariCropClipPath = media.style.clipPath || 'none';
                return true;
            };
            const applyCutLayerStyleLayout = media => {
                if (!media || media.dataset.akariCutLayerStyleActive !== 'true') return false;
                const outputWidth = Number(output.width || 1280);
                const outputHeight = Number(output.height || 720);
                return applyLayerStyleMediaLayout(media, outputWidth, outputHeight);
            };
            window.akari.applyCutLayerStyleLayout = applyCutLayerStyleLayout;
            const updateStageScale = () => {
                const frameRect = computeOutputFrameRect();
                const rect = computeContentRect();
                const next = rect.width / Number(output.width || 1280);
                displayScale = Number.isFinite(next) && next > 0 ? next : 1;
                const outputWidth = Number(output.width || 1280);
                const outputHeight = Number(output.height || 720);
                const nextFrameScale = frameRect.width / outputWidth;
                frameScale = Number.isFinite(nextFrameScale) && nextFrameScale > 0 ? nextFrameScale : 1;
                const stageTransform = 'translate(0px, 0px) scale(' + frameScale + ')';
                video.style.left = '0px';
                video.style.top = '0px';
                video.style.width = outputWidth + 'px';
                video.style.height = outputHeight + 'px';
                video.style.objectFit = 'contain';
                video.style.clipPath = '';
                transitionVideo.style.left = '0px';
                transitionVideo.style.top = '0px';
                transitionVideo.style.width = outputWidth + 'px';
                transitionVideo.style.height = outputHeight + 'px';
                transitionVideo.style.objectFit = 'contain';
                transitionStill.style.left = '0px';
                transitionStill.style.top = '0px';
                transitionStill.style.width = outputWidth + 'px';
                transitionStill.style.height = outputHeight + 'px';
                transitionStill.style.objectFit = 'contain';
                layersStage.style.left = frameRect.x + 'px';
                layersStage.style.top = frameRect.y + 'px';
                layersStage.style.width = outputWidth + 'px';
                layersStage.style.height = outputHeight + 'px';
                layersStage.style.transform = stageTransform;
                for (const layerVideo of layersStage.querySelectorAll('[data-akari-layer-id]')) {
                    applyLayerStyleMediaLayout(layerVideo, outputWidth, outputHeight);
                }
                // ㉕ cuts[].framing（contract-2026-08-02-preview-parity.md §2.4.2）: この cut.transform
                // 部分（PIP 位置決め）は video.style.transform の一部にすぎず、時間で変化する framing
                // ズームは previewBootstrapScript 側（tick() 毎フレーム）が別途書き込む。二つの書き手が
                // 競合しないよう、ここでは「cut.transform だけの文字列」を dataset に置くに留め、実際の
                // video.style.transform への反映は window.akari.applyCutFramingVisual に委譲する
                // （bootstrap 未初期化の最初の呼び出しだけ、フォールバックとして自分で直接書く）。
                const cutLayerStyleApplied = applyCutLayerStyleLayout(video);
                const baseTransform = video.dataset.akariCutTransformActive === 'true'
                    ? (() => {
                        const x = Number(video.dataset.akariTransformX) || 0;
                        const y = Number(video.dataset.akariTransformY) || 0;
                        const scale = Number(video.dataset.akariTransformScale) || 1;
                        const rotate = Number(video.dataset.akariTransformRotate) || 0;
                        return 'translate(' + x + 'px, '
                            + y + 'px) scale(' + scale + ') rotate(' + rotate + 'deg)';
                    })()
                    : '';
                video.dataset.akariBaseTransform = baseTransform;
                if (window.akari.applyCutFramingVisual) {
                    window.akari.applyCutFramingVisual();
                } else if (!cutLayerStyleApplied) {
                    video.style.transform = baseTransform;
                }
                if (transitionVideo.style.display !== 'none') applyCutLayerStyleLayout(transitionVideo);
                if (transitionStill.style.display !== 'none') applyCutLayerStyleLayout(transitionStill);
                if (stillImage.style.display !== 'none') applyCutLayerStyleLayout(stillImage);
                stage.style.left = '0px';
                stage.style.top = '0px';
                penLayer.style.left = rect.x + 'px';
                penLayer.style.top = rect.y + 'px';
                penLayer.style.width = rect.width + 'px';
                penLayer.style.height = rect.height + 'px';
            };
            window.akari.computeOutputFrameRect = computeOutputFrameRect;
            window.akari.computeContentRect = computeContentRect;
            window.akari.updateLayerLayout = updateStageScale;
            new ResizeObserver(updateStageScale).observe(previewStage);
            video.addEventListener('loadedmetadata', updateStageScale);
            updateStageScale();
        })();`;
    }

    protected previewBootstrapScript(): string {
        return `(() => {
            const initial = window.__akariPreview;
            let summary = initial.summary;
            const video = document.getElementById('preview-video');
            const transitionVideo = document.getElementById('transition-video');
            const stillImage = document.getElementById('preview-still');
            const transitionStill = document.getElementById('transition-still');
            const playToggle = document.getElementById('play-toggle');
            const frameBack = document.getElementById('frame-back');
            const frameForward = document.getElementById('frame-forward');
            const skipBack = document.getElementById('skip-back');
            const skipForward = document.getElementById('skip-forward');
            const waveformToggle = document.getElementById('waveform-toggle');
            const waveformRow = document.querySelector('.transport-waveform');
            const waveformCanvas = document.getElementById('waveform-canvas');
            const waveformPlayhead = document.querySelector('.transport-waveform-playhead');
            const indicatorToggle = document.getElementById('indicator-toggle');
            const indicatorPopup = document.getElementById('indicator-popup');
            const videoFxFailedIndicators = new Set();
            const INDICATOR_GLOSSARY = {
                'LUT': '色調フィルタ',
                'クロマキー': '背景透過',
                '音声マスター処理': 'ノイズ除去・音量正規化',
                'ディゾルブ切り替え': 'カットの溶け込み切替'
            };
            const refreshIndicators = () => {
                const declared = Array.isArray(summary.indicators) ? summary.indicators : [];
                const indicators = [...new Set([...declared, ...videoFxFailedIndicators])];
                indicatorToggle.hidden = indicators.length === 0;
                if (indicators.length === 0) {
                    indicatorPopup.hidden = true;
                    indicatorPopup.textContent = '';
                    return;
                }
                const items = indicators.map(item => INDICATOR_GLOSSARY[item]
                    ? item + ' = ' + INDICATOR_GLOSSARY[item]
                    : item).join(' / ');
                indicatorPopup.textContent = 'プレビュー未対応: ' + items;
            };
            const penToggle = document.getElementById('pen-toggle');
            const zoomToggle = document.getElementById('zoom-toggle');
            const fullscreenToggle = document.getElementById('fullscreen-toggle');
            const seek = document.getElementById('seek');
            const timeLabel = document.getElementById('time-label');
            const previewPane = document.querySelector('.preview-pane');
            const wrapper = document.getElementById('preview-wrapper');
            const zoomLayer = document.getElementById('zoom-layer');
            const previewStage = document.getElementById('preview-stage');
            const zoomPopup = document.getElementById('zoom-popup');
            const zoomSlider = document.getElementById('zoom-slider');
            const zoomValue = document.getElementById('zoom-value');
            const zoomMinimap = document.getElementById('zoom-minimap');
            const zoomMinimapViewport = document.getElementById('zoom-minimap-viewport');
            const layersStage = document.getElementById('preview-layers');
            const stage = document.getElementById('overlay-stage');
            const penLayer = document.getElementById('pen-layer');
            const transitionPlate = document.getElementById('transition-plate');
            const transitionFallbackLabel = document.getElementById('transition-fallback-label');
            const captionPlate = document.getElementById('caption-plate');
            const previewMessage = document.getElementById('preview-message');
            const previewMessageText = document.getElementById('preview-message-text');
            const previewMessageReload = document.getElementById('preview-message-reload');
            const audioNotice = document.getElementById('audio-notice');
            const audioNoticeDismiss = document.getElementById('audio-notice-dismiss');
            const fps = Number(summary.output && summary.output.fps) > 0 ? Number(summary.output.fps) : 30;
            const ZOOM_MIN = 0.25;
            const ZOOM_MAX = 8;
            const SNAP_TOLERANCE = 0.025;
            const CLICK_THRESHOLD_PX = 4;
            // ペン描画のチューニング定数（密度・グロー・フェード等）。画像注釈ポップアップ
            // （akari-annotations）の静的プラチナ描画と単一の正本（../common/pen-canvas-visuals.ts
            // の PEN_TUNING）を共有する — webview はサンドボックスのためモジュール import が
            // できず、値を JSON として埋め込む形でのみ共有できる（統合点調査・report.md 参照）。
            // 実際の描画ロジック（グロー/スパークル/フェード）はここに残したまま無変更。
            const PEN_TUNING = ${JSON.stringify(PEN_TUNING)};
            const normalizePersistentStrokeItemsFn = (${normalizePersistentStrokeItems.toString()});
            // task.md 指示4 (rect tool): normalized drag -> [x,y,w,h] box, same shape as
            // review.json's region.box (../common/rect-tool-visual.ts).
            const normalizeRectFromPointsFn = (${normalizeRectFromPoints.toString()});
            const layerResizeCornerPointFn = (${layerResizeCornerPoint.toString()});
            const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
            const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"></path></svg>';
            const fullscreenIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zm3 11h2v5h-5v-2h3zM9 18v2H4v-5h2v3z"></path></svg>';
            const restoreIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4V7h3V4zm6 0h2v3h3v2h-5zM4 15h5v5H7v-3H4zm16 0v2h-3v3h-2v-5z"></path></svg>';
            let captions = Array.isArray(initial.captions) ? initial.captions : [];
            const emphasisWords = Array.isArray(initial.emphasisWords) ? initial.emphasisWords : [];
            let hiddenTracks = new Set(Array.isArray(initial.hiddenTracks) ? initial.hiddenTracks : []);
            const initialHiddenTracksByScope = initial.hiddenTracksByScope || {};
            const initialMutedTracksByScope = initial.mutedTracksByScope || {};
            const initialAllTracksHiddenScopes = Array.isArray(initial.allTracksHiddenScopes)
                ? initial.allTracksHiddenScopes : [];
            const initialAllTracksMutedScopes = Array.isArray(initial.allTracksMutedScopes)
                ? initial.allTracksMutedScopes : [];
            const hiddenTracksByScope = {
                cuts: new Set(Array.isArray(initialHiddenTracksByScope.cuts) ? initialHiddenTracksByScope.cuts : []),
                layers: new Set(Array.isArray(initialHiddenTracksByScope.layers) ? initialHiddenTracksByScope.layers : []),
                audio: new Set(Array.isArray(initialHiddenTracksByScope.audio) ? initialHiddenTracksByScope.audio : [])
            };
            const mutedTracksByScope = {
                cuts: new Set(Array.isArray(initialMutedTracksByScope.cuts) ? initialMutedTracksByScope.cuts : []),
                audio: new Set(Array.isArray(initialMutedTracksByScope.audio) ? initialMutedTracksByScope.audio : []),
                layers: new Set(Array.isArray(initialMutedTracksByScope.layers) ? initialMutedTracksByScope.layers : [])
            };
            const allTracksHiddenByScope = {
                cuts: initialAllTracksHiddenScopes.includes('cuts'),
                layers: initialAllTracksHiddenScopes.includes('layers'),
                audio: initialAllTracksHiddenScopes.includes('audio')
            };
            const allTracksMutedByScope = {
                cuts: initialAllTracksMutedScopes.includes('cuts'),
                audio: initialAllTracksMutedScopes.includes('audio'),
                layers: initialAllTracksMutedScopes.includes('layers')
            };
            let globalMuted = initial.muted === true;
            video.dataset.akariGlobalMuted = String(globalMuted);
            video.muted = globalMuted;
            captionPlate.style.visibility = initial.captionsVisible === false ? 'hidden' : 'visible';
            let animationFrame = 0;
            let animationWatchdogTimer = 0;
            let lastTickAtMs = 0;
            let transitionWindows = [];
            let preloadedTransitionWindowKey = null;
            let preloadUpcomingTransition = () => undefined;
            let totalTimelineDuration = 0;
            let segments = [];
            // ㉕ cuts[].framing / cuts[].freeze（contract-2026-08-02-preview-parity.md §2.4.2/2.4.3）。
            const computeCutFramingVisualFn = (${computeCutFramingVisual.toString()});
            const checkCutFreezeCrossingFn = (${checkCutFreezeCrossing.toString()});
            const computeTransitionVisualFn = (${computeTransitionVisual.toString()});
            const transitionVocabulary = ${JSON.stringify(TRANSITION_VOCABULARY)};
            const transitionById = Object.fromEntries(transitionVocabulary.map(entry => [entry.id, entry]));
            // ㉖ layers[].perspective（contract-2026-08-02-preview-parity.md §2.4.4）。
            const computeLayerPerspectiveVisualFn = (${computeLayerPerspectiveVisual.toString()});
            // ㉗ layers[].crop の錨補正（contract-2026-08-02-preview-parity.md §2.4.1・
            // 2026-08-06 crop-handle-anchor-fix）。
            const cropAnchorCorrectedTransformFn = (${cropAnchorCorrectedTransform.toString()});
            // ㉘ layers[].keyframes（contract-2026-08-09-transform-keyframes-v0.md）。renderLayers
            // が毎フレーム呼び、layer.keyframes があれば dataset.akariTransformX/Y/Scale/Rotate・
            // akariCropX/Y/W/H・akariPerspectiveCorners を上書きしてから updateLayerLayout を叩く
            // （既存の crop pivot / clip-path / matrix3d 描画コードを丸ごと再利用するため）。
            const computeLayerKeyframesVisualFn = (${computeLayerKeyframesVisual.toString()});
            const outputTimeForSourceClockFn = (${outputTimeForSourceClock.toString()});
            const resolveSourceClockPositionFn = (${resolveSourceClockPosition.toString()});
            const resolveDeferredTelopPlaybackFn = (${resolveDeferredTelopPlayback.toString()});
            // RAF スロットリング（2026-08-09 raf-throttle）: ハンドルドラッグ中の pointermove は
            // 毎回来るが、フル layout 再計算（updateStageScale）は1フレームに1回で十分。
            const createRafThrottleFn = (${createRafThrottle.toString()});
            // freeze の一時停止ホールド（近似実装。尺は伸ばさない — 詳細はコメント参照）。
            let freezeHoldUntilMs = 0;
            let freezeHoldConsumedForSegmentIndex = null;
            const probeMediaDurationSeconds = src => new Promise(resolve => {
                const probe = new Audio();
                probe.preload = 'metadata';
                const cleanup = () => {
                    probe.removeEventListener('loadedmetadata', onLoaded);
                    probe.removeEventListener('error', onError);
                };
                const onLoaded = () => {
                    cleanup();
                    resolve(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null);
                };
                const onError = () => { cleanup(); resolve(null); };
                probe.addEventListener('loadedmetadata', onLoaded, { once: true });
                probe.addEventListener('error', onError, { once: true });
                probe.src = src;
            });
            let resolvedSfxTails = [];
            const probeSfxDurations = async () => {
                const items = Array.isArray(summary.audio && summary.audio.sfx) ? summary.audio.sfx : [];
                const results = await Promise.all(items.map(async item => {
                    if (typeof item.t !== 'number' || !Number.isFinite(item.t) || item.t < 0) return null;
                    if (typeof item.src !== 'string' || !item.src) return null;
                    const materialDuration = await probeMediaDurationSeconds(item.src);
                    if (materialDuration === null) return null;
                    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: the audible span is
                    // [in, out), not the whole material -- mirrors createPreviewAudio's decodeOne /
                    // render-cut's content-duration.mjs so a trimmed sfx only extends the predicted
                    // content duration by what actually plays.
                    const inSeconds = typeof item.in === 'number' && item.in >= 0 ? item.in : 0;
                    const rawOut = typeof item.out === 'number' && item.out > 0 ? item.out : materialDuration;
                    const outSeconds = Math.min(rawOut, materialDuration);
                    if (inSeconds >= materialDuration || outSeconds <= inSeconds) return null;
                    return item.t + (outSeconds - inSeconds);
                }));
                resolvedSfxTails = results.filter(value => typeof value === 'number');
            };
            const sfxDurationsReady = probeSfxDurations();
            const computeContentDurationSeconds = cutsEndSeconds => {
                let sfxEnd = 0;
                for (const tail of resolvedSfxTails) sfxEnd = Math.max(sfxEnd, tail);
                let layersEnd = 0;
                for (const layer of Array.isArray(summary.layers) ? summary.layers : []) {
                    const t = Number(layer && layer.t);
                    const duration = Number(layer && layer.duration);
                    if (Number.isFinite(t) && Number.isFinite(duration)) layersEnd = Math.max(layersEnd, t + duration);
                }
                return Math.max(cutsEndSeconds, sfxEnd, layersEnd);
            };
            let activeSegmentIndex = 0;
            let sourceSwapPending = false;
            let gapWallClockOriginMs = 0;
            let gapOutputOrigin = 0;
            let outputTime = 0;
            let isPlaying = false;
            let playToggleRenderedIsPlaying = null;
            let pausedForGapEntry = false;
            let initialPositionApplied = false;
            let zoom = 1;
            let pan = { x: 0, y: 0 };
            let drag = null;
            let suppressClick = false;
            let waveformState = 'idle';
            let waveformAudioBuffer = null;
            let waveformPeaks = null;
            let waveformResizeTimer = 0;
            let waveformDragPointer = null;
            let playbackErrored = false;
            // Decode-failure fallback is tracked per original source. This covers the primary
            // video, source-swapped cuts, and v2 media items rendered as video layers.
            const hevcFallbackRequested = new Set();
            let audioNoticeShown = false;
            let activeCaption = null;
            let styledCaptionActive = false;
            let activeCaptionEdit = null;
            let reviewRecordingActive = false;
            // docs/contract-2026-08-11-review-session-ui-events.md #1 / internal
            // annotation-everywhere §3 (M2): neutral/pen/rect/select, mirrored from
            // ReviewSessionRecorder's toolModeState (host is authoritative -- see
            // window.addEventListener('message', ...)'s akari-preview-set-review-recording case).
            let reviewToolMode = 'neutral';
            let penModeActive = false;
            let rectModeActive = false;
            let currentStroke = null;
            let currentRect = null;
            let fadingStrokes = [];
            let sparkles = [];
            let annotationStrokeItems = [];
            let persistentStrokeItems = [];
            let persistentStrokesVisible = true;
            let activeDrawRect = null;
            let penCanvasWidth = 0;
            let penCanvasHeight = 0;
            let penCanvasDpr = 1;
            let penAnimationHandle = 0;
            let platinumGradient = null;
            let staticBitmap = null;

            const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
            const penCtx = penLayer.getContext('2d');
            const createGlowSprite = size => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
                gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
                gradient.addColorStop(0.4, 'rgba(226,234,255,0.55)');
                gradient.addColorStop(1, 'rgba(226,234,255,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, size, size);
                return canvas;
            };
            const createSparkleSprite = size => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                const center = size / 2;
                const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
                gradient.addColorStop(0, 'rgba(255,255,255,1)');
                gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
                gradient.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, size, size);
                ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                ctx.lineWidth = Math.max(1, size * 0.06);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(center, center - size * 0.42);
                ctx.lineTo(center, center + size * 0.42);
                ctx.moveTo(center - size * 0.42, center);
                ctx.lineTo(center + size * 0.42, center);
                ctx.stroke();
                return canvas;
            };
            const glowSprite = createGlowSprite(Math.max(64, PEN_TUNING.glowSizePx * 3));
            const sparkleSprite = createSparkleSprite(Math.max(48, PEN_TUNING.sparkleSpritePx * 3));
            const allocPenCanvas = () => {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(penCanvasWidth * penCanvasDpr));
                canvas.height = Math.max(1, Math.round(penCanvasHeight * penCanvasDpr));
                const ctx = canvas.getContext('2d');
                ctx.setTransform(penCanvasDpr, 0, 0, penCanvasDpr, 0, 0);
                return { canvas, ctx };
            };
            const rebuildPlatinumGradient = () => {
                if (!(penCanvasWidth > 0) || !(penCanvasHeight > 0)) { platinumGradient = null; return; }
                const gradient = penCtx.createLinearGradient(0, 0, penCanvasWidth, penCanvasHeight);
                gradient.addColorStop(0, '#ffffff');
                gradient.addColorStop(0.48, '#d9deea');
                gradient.addColorStop(0.72, '#ffffff');
                gradient.addColorStop(1, '#c8cfdd');
                platinumGradient = gradient;
            };
            const drawSegment = (ctx, from, to, options) => {
                const width = (options && options.coreWidthPx) || PEN_TUNING.coreWidthPx;
                const fromPx = [from[0] * penCanvasWidth, from[1] * penCanvasHeight];
                const toPx = [to[0] * penCanvasWidth, to[1] * penCanvasHeight];
                const glowSize = PEN_TUNING.glowSizePx;
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = PEN_TUNING.glowAlpha;
                ctx.drawImage(glowSprite, toPx[0] - glowSize / 2, toPx[1] - glowSize / 2, glowSize, glowSize);
                ctx.restore();
                ctx.save();
                ctx.globalAlpha = PEN_TUNING.coreAlpha;
                ctx.strokeStyle = platinumGradient || '#eef2fb';
                ctx.lineWidth = width;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(fromPx[0], fromPx[1]);
                ctx.lineTo(toPx[0], toPx[1]);
                ctx.stroke();
                ctx.restore();
            };
            const paintStaticStroke = points => {
                if (!staticBitmap) return;
                for (let index = 0; index < points.length - 1; index += 1) {
                    drawSegment(staticBitmap.ctx, points[index], points[index + 1], { coreWidthPx: PEN_TUNING.staticCoreWidthPx });
                }
            };
            const redrawStrokeFull = stroke => {
                stroke.canvas.width = Math.max(1, Math.round(penCanvasWidth * penCanvasDpr));
                stroke.canvas.height = Math.max(1, Math.round(penCanvasHeight * penCanvasDpr));
                stroke.ctx.setTransform(penCanvasDpr, 0, 0, penCanvasDpr, 0, 0);
                for (let index = 0; index < stroke.points.length - 1; index += 1) {
                    drawSegment(stroke.ctx, stroke.points[index], stroke.points[index + 1]);
                }
                stroke.drawnIndex = Math.max(0, stroke.points.length - 1);
            };
            // task.md 指示4: rect ツールの描画。pen と同じ platinum グラデーション/グロー質感を
            // 矩形の輪郭に適用する（drawSegment の 4 辺版ではなく単純な strokeRect 2 パス -- pen ほど
            // の視覚精度は不要で、コード量と回帰リスクを抑える判断。report.md に記載）。
            const drawRectShape = (ctx, box) => {
                const x = box[0] * penCanvasWidth;
                const y = box[1] * penCanvasHeight;
                const w = box[2] * penCanvasWidth;
                const h = box[3] * penCanvasHeight;
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = PEN_TUNING.glowAlpha;
                ctx.strokeStyle = platinumGradient || '#eef2fb';
                ctx.lineWidth = PEN_TUNING.coreWidthPx * 2.5;
                ctx.strokeRect(x, y, w, h);
                ctx.restore();
                ctx.save();
                ctx.globalAlpha = PEN_TUNING.coreAlpha;
                ctx.strokeStyle = platinumGradient || '#eef2fb';
                ctx.lineWidth = PEN_TUNING.coreWidthPx;
                ctx.strokeRect(x, y, w, h);
                ctx.restore();
            };
            const paintStaticItem = item => {
                if (!staticBitmap) return;
                if (item.tool === 'rect') drawRectShape(staticBitmap.ctx, item.box);
                else paintStaticStroke(item.points);
            };
            const redrawStaticBitmap = () => {
                if (!staticBitmap) return;
                staticBitmap.ctx.clearRect(0, 0, penCanvasWidth, penCanvasHeight);
                if (!persistentStrokesVisible) return;
                for (const item of persistentStrokeItems) paintStaticItem(item);
                for (const item of annotationStrokeItems) paintStaticItem(item);
            };
            const redrawRectFull = rect => {
                rect.canvas.width = Math.max(1, Math.round(penCanvasWidth * penCanvasDpr));
                rect.canvas.height = Math.max(1, Math.round(penCanvasHeight * penCanvasDpr));
                rect.ctx.setTransform(penCanvasDpr, 0, 0, penCanvasDpr, 0, 0);
                drawRectShape(rect.ctx, rect.box);
            };
            // fadingStrokes は完了済みの pen ストローク・rect の両方を保持する共有プール
            // （フェードアウト演出を共通化するため）。kind タグで再描画方法だけ出し分ける。
            const redrawFadingFull = item => (item.kind === 'rect' ? redrawRectFull(item) : redrawStrokeFull(item));
            const resizePenCanvases = () => {
                const cssWidth = Math.max(1, Math.round(penLayer.clientWidth || 1));
                const cssHeight = Math.max(1, Math.round(penLayer.clientHeight || 1));
                const dpr = Math.min(PEN_TUNING.maxDevicePixelRatio, window.devicePixelRatio || 1);
                if (cssWidth === penCanvasWidth && cssHeight === penCanvasHeight && dpr === penCanvasDpr) return;
                penCanvasWidth = cssWidth;
                penCanvasHeight = cssHeight;
                penCanvasDpr = dpr;
                penLayer.width = Math.round(cssWidth * dpr);
                penLayer.height = Math.round(cssHeight * dpr);
                penCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                rebuildPlatinumGradient();
                staticBitmap = allocPenCanvas();
                redrawStaticBitmap();
                if (currentStroke) redrawStrokeFull(currentStroke);
                if (currentRect) redrawRectFull(currentRect);
                for (const fading of fadingStrokes) redrawFadingFull(fading);
                recomposite();
            };
            const penFadeAlpha = (fading, timestamp) => {
                const now = timestamp || performance.now();
                return clamp(1 - (now - fading.fadeStartedAt) / PEN_TUNING.fadeDurationMs, 0, 1);
            };
            const updateAndDrawSparkles = (ctx, timestamp) => {
                if (sparkles.length === 0) return;
                const alive = [];
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                for (const sparkle of sparkles) {
                    const age = timestamp - sparkle.bornAt;
                    if (age >= sparkle.lifetimeMs) continue;
                    const fade = 1 - age / sparkle.lifetimeMs;
                    const twinkle = 0.6 + 0.4 * Math.sin((timestamp / 1000) * PEN_TUNING.sparkleTwinkleHz * Math.PI * 2 + sparkle.phase);
                    ctx.globalAlpha = clamp(fade * twinkle, 0, 1);
                    const size = sparkle.size * (0.7 + 0.3 * fade);
                    ctx.drawImage(sparkleSprite, sparkle.x - size / 2, sparkle.y - size / 2, size, size);
                    alive.push(sparkle);
                }
                ctx.restore();
                sparkles = alive;
            };
            const maybeSpawnSparkle = point => {
                for (let index = 0; index < PEN_TUNING.sparklesPerSegment; index += 1) {
                    if (sparkles.length >= PEN_TUNING.sparkleMaxPoolSize) sparkles.shift();
                    const angle = Math.random() * Math.PI * 2;
                    const jitter = Math.random() * PEN_TUNING.sparkleJitterPx;
                    sparkles.push({
                        x: point[0] * penCanvasWidth + Math.cos(angle) * jitter,
                        y: point[1] * penCanvasHeight + Math.sin(angle) * jitter,
                        bornAt: performance.now(),
                        lifetimeMs: PEN_TUNING.sparkleLifetimeMs * (0.6 + Math.random() * 0.8),
                        size: PEN_TUNING.sparkleMinSizePx + Math.random() * (PEN_TUNING.sparkleMaxSizePx - PEN_TUNING.sparkleMinSizePx),
                        phase: Math.random() * Math.PI * 2
                    });
                }
            };
            const recomposite = timestamp => {
                if (!(penCanvasWidth > 0) || !(penCanvasHeight > 0)) return;
                penCtx.clearRect(0, 0, penCanvasWidth, penCanvasHeight);
                if (staticBitmap) penCtx.drawImage(staticBitmap.canvas, 0, 0, penCanvasWidth, penCanvasHeight);
                for (const fading of fadingStrokes) {
                    penCtx.globalAlpha = penFadeAlpha(fading, timestamp);
                    penCtx.drawImage(fading.canvas, 0, 0, penCanvasWidth, penCanvasHeight);
                }
                penCtx.globalAlpha = 1;
                if (currentStroke) penCtx.drawImage(currentStroke.canvas, 0, 0, penCanvasWidth, penCanvasHeight);
                if (currentRect) penCtx.drawImage(currentRect.canvas, 0, 0, penCanvasWidth, penCanvasHeight);
                updateAndDrawSparkles(penCtx, timestamp || performance.now());
            };
            const drawPendingSegments = stroke => {
                const points = stroke.points;
                while (stroke.drawnIndex < points.length - 1) {
                    const from = points[stroke.drawnIndex];
                    const to = points[stroke.drawnIndex + 1];
                    drawSegment(stroke.ctx, from, to);
                    maybeSpawnSparkle(to);
                    stroke.drawnIndex += 1;
                }
            };
            const penTick = timestamp => {
                if (currentStroke) drawPendingSegments(currentStroke);
                fadingStrokes = fadingStrokes.filter(fading => penFadeAlpha(fading, timestamp) > 0);
                recomposite(timestamp);
                const stillActive = currentStroke !== null || currentRect !== null
                    || fadingStrokes.length > 0 || sparkles.length > 0;
                penAnimationHandle = stillActive ? requestAnimationFrame(penTick) : 0;
            };
            const ensurePenLoopRunning = () => {
                if (!penAnimationHandle) penAnimationHandle = requestAnimationFrame(penTick);
            };
            new ResizeObserver(resizePenCanvases).observe(penLayer);
            resizePenCanvases();
            const clearStaticAnnotationStrokes = () => {
                annotationStrokeItems = [];
                redrawStaticBitmap();
                recomposite();
            };
            const setPenModeActive = active => {
                penModeActive = active === true && reviewRecordingActive && !isPlaying;
                penToggle.setAttribute('aria-pressed', String(penModeActive));
                penLayer.classList.toggle('is-active', penModeActive || rectModeActive);
            };
            const setRectModeActive = active => {
                rectModeActive = active === true && reviewRecordingActive && !isPlaying;
                penLayer.classList.toggle('is-active', penModeActive || rectModeActive);
            };
            // ReviewSessionRecorder（host）が唯一の正本。ここはブロードキャストの反映と、
            // 既存入口（pen-toggle）からの request の両方が通る単一の適用点。
            const applyReviewToolMode = mode => {
                reviewToolMode = mode;
                setPenModeActive(mode === 'pen');
                setRectModeActive(mode === 'rect');
            };
            const abortCurrentStroke = () => {
                if (!currentStroke) return;
                const pointerId = currentStroke.pointerId;
                currentStroke = null;
                if (penLayer.hasPointerCapture(pointerId)) {
                    penLayer.releasePointerCapture(pointerId);
                }
            };
            const abortCurrentRect = () => {
                if (!currentRect) return;
                const pointerId = currentRect.pointerId;
                currentRect = null;
                if (penLayer.hasPointerCapture(pointerId)) {
                    penLayer.releasePointerCapture(pointerId);
                }
            };
            const captureDrawRect = () => {
                const contentRect = penLayer.getBoundingClientRect();
                activeDrawRect = {
                    left: contentRect.left,
                    top: contentRect.top,
                    width: Math.max(contentRect.width, 1),
                    height: Math.max(contentRect.height, 1)
                };
            };
            const normalizedPenPoint = event => {
                const rect = activeDrawRect || (captureDrawRect(), activeDrawRect);
                return [
                    clamp((event.clientX - rect.left) / rect.width, 0, 1),
                    clamp((event.clientY - rect.top) / rect.height, 0, 1)
                ];
            };
            const createActiveStroke = (pointerId, firstPoint) => {
                const bitmap = allocPenCanvas();
                return { kind: 'pen', pointerId, points: [firstPoint], drawnIndex: 0, canvas: bitmap.canvas, ctx: bitmap.ctx };
            };
            const showStaticAnnotationStrokes = strokes => {
                annotationStrokeItems = normalizePersistentStrokeItemsFn(strokes);
                redrawStaticBitmap();
                recomposite();
            };
            const showPersistentSessionStrokes = message => {
                persistentStrokeItems = normalizePersistentStrokeItemsFn(message.strokes);
                penLayer.dataset.akariStrokeSession = typeof message.sessionId === 'string' ? message.sessionId : '';
                penLayer.dataset.akariStrokeTargetTab = typeof message.target?.tab === 'string' ? message.target.tab : '';
                penLayer.dataset.akariStrokeTargetRecT = Number.isFinite(message.target?.recT)
                    ? String(message.target.recT) : '';
                redrawStaticBitmap();
                recomposite();
            };
            const canDraw = () => penModeActive && reviewRecordingActive && !isPlaying;
            const canDrawRect = () => rectModeActive && reviewRecordingActive && !isPlaying;
            const currentFrame = () => {
                const segment = segments[activeSegmentIndex];
                return {
                    timelineT: outputTime,
                    sourceT: video.currentTime,
                    cutIndex: segment && segment.kind === 'src' && Number.isInteger(segment.cutIndex)
                        ? segment.cutIndex : null
                };
            };
            // task.md 指示3: pen-toggle は既存の入口として残しつつ、実体は共有 toolMode への
            // request に載せ替える（host が唯一の正本 -- 右パネルの選択/ペン/四角ボタンと同じ経路）。
            // 楽観的にローカルへも即時反映し、host からのブロードキャストで再確認される。
            penToggle.addEventListener('click', () => {
                if (!reviewRecordingActive || isPlaying) return;
                const nextMode = reviewToolMode === 'pen' ? 'neutral' : 'pen';
                applyReviewToolMode(nextMode);
                window.akari.reviewSetToolMode(nextMode);
            });
            penLayer.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                if (canDraw() && !currentStroke) {
                    event.preventDefault();
                    clearStaticAnnotationStrokes();
                    penLayer.setPointerCapture(event.pointerId);
                    captureDrawRect();
                    const point = normalizedPenPoint(event);
                    currentStroke = createActiveStroke(event.pointerId, point);
                    window.akari.reviewStrokeStart(currentFrame());
                    ensurePenLoopRunning();
                } else if (canDrawRect() && !currentRect) {
                    event.preventDefault();
                    clearStaticAnnotationStrokes();
                    penLayer.setPointerCapture(event.pointerId);
                    captureDrawRect();
                    const point = normalizedPenPoint(event);
                    const bitmap = allocPenCanvas();
                    currentRect = {
                        kind: 'rect', pointerId: event.pointerId, start: point,
                        box: [point[0], point[1], 0, 0], canvas: bitmap.canvas, ctx: bitmap.ctx
                    };
                    window.akari.reviewRectStart(currentFrame());
                    ensurePenLoopRunning();
                }
            });
            penLayer.addEventListener('pointermove', event => {
                if (currentStroke && currentStroke.pointerId === event.pointerId && canDraw()) {
                    event.preventDefault();
                    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
                    const events = coalesced && coalesced.length > 0 ? coalesced : [event];
                    for (const raw of events) {
                        currentStroke.points.push(normalizedPenPoint(raw));
                    }
                    return;
                }
                if (currentRect && currentRect.pointerId === event.pointerId && canDrawRect()) {
                    event.preventDefault();
                    const point = normalizedPenPoint(event);
                    currentRect.box = normalizeRectFromPointsFn(currentRect.start, point);
                    currentRect.ctx.clearRect(0, 0, currentRect.canvas.width, currentRect.canvas.height);
                    drawRectShape(currentRect.ctx, currentRect.box);
                }
            });
            const finishPenStroke = event => {
                if (!currentStroke || currentStroke.pointerId !== event.pointerId) return;
                event.preventDefault();
                const completed = currentStroke;
                currentStroke = null;
                if (penLayer.hasPointerCapture(event.pointerId)) {
                    penLayer.releasePointerCapture(event.pointerId);
                }
                if (completed.points.length < 2) return;
                window.akari.reviewStrokeEnd(completed.points);
                persistentStrokeItems.push({ tool: 'pen', points: completed.points });
                redrawStaticBitmap();
                completed.fadeStartedAt = performance.now();
                fadingStrokes.push(completed);
                ensurePenLoopRunning();
            };
            const finishRect = event => {
                if (!currentRect || currentRect.pointerId !== event.pointerId) return;
                event.preventDefault();
                const completed = currentRect;
                currentRect = null;
                if (penLayer.hasPointerCapture(event.pointerId)) {
                    penLayer.releasePointerCapture(event.pointerId);
                }
                if (completed.box[2] <= 0 || completed.box[3] <= 0) return;
                window.akari.reviewRectEnd(completed.box);
                persistentStrokeItems.push({ tool: 'rect', box: completed.box });
                redrawStaticBitmap();
                completed.fadeStartedAt = performance.now();
                fadingStrokes.push(completed);
                ensurePenLoopRunning();
            };
            // 既存のペン挙動どおり、pointercancel も pointerup と同じ finish 経路を通す
            // （中断イベントでも 2 点以上あれば確定させる -- 元の finishPenStroke の挙動を維持）。
            penLayer.addEventListener('pointerup', event => {
                finishPenStroke(event);
                finishRect(event);
            });
            penLayer.addEventListener('pointercancel', event => {
                finishPenStroke(event);
                finishRect(event);
            });
            // timeline.tracks → z の純関数は preview / render-cut 共通の edit-store 正本。
            // webview sandbox では package import ができないため、関数本体そのものを注入する。
            const resolveInternalTrackZFn = (${resolveInternalTrackZ.toString()});
            let resolvedTracks = [];
            const rebuildVisualTrackZ = () => {
                resolvedTracks = Array.isArray(summary.timelineTracks) ? summary.timelineTracks : [];
            };
            rebuildVisualTrackZ();
            const zForTrack = trackId => {
                return resolveInternalTrackZFn(resolvedTracks, trackId);
            };
            const applyCutsZIndex = segment => {
                if (segment && segment.kind === 'src') {
                    const z = zForTrack(segment.trackId);
                    // renderTransitionComposite が同じ tick の前段で確定した zSwap を、
                    // applyCutsMuteState の通常 z 同期で巻き戻さない。合成終了時の reset が
                    // video / stillImage を正準 track z へ戻す。
                    if (activeTransitionWindowKey === null) {
                        video.style.zIndex = String(z);
                        stillImage.style.zIndex = String(z);
                    }
                    transitionPlate.style.zIndex = String(z);
                    transitionFallbackLabel.style.zIndex = String(z + 2);
                }
            };
            const cutHasLayerStyleVisual = segment => Boolean(segment && segment.kind === 'src'
                && (segment.crop || segment.perspective
                    || (Array.isArray(segment.keyframes) && segment.keyframes.length >= 2)));
            const writeCutLayerStyleBase = (media, segment) => {
                const active = cutHasLayerStyleVisual(segment);
                media.dataset.akariCutLayerStyleActive = String(active);
                if (!active) {
                    delete media.dataset.akariCropX;
                    delete media.dataset.akariCropY;
                    delete media.dataset.akariCropW;
                    delete media.dataset.akariCropH;
                    delete media.dataset.akariPerspectiveCorners;
                    delete media.dataset.akariCropClipPath;
                    return false;
                }
                const transform = segment.transform || {};
                media.dataset.akariTransformX = String(Number.isFinite(transform.x) ? transform.x : 0);
                media.dataset.akariTransformY = String(Number.isFinite(transform.y) ? transform.y : 0);
                media.dataset.akariTransformScale = String(
                    Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1
                );
                media.dataset.akariTransformRotate = String(Number.isFinite(transform.rotate) ? transform.rotate : 0);
                const crop = segment.crop;
                media.dataset.akariCropX = String(crop && Number.isFinite(crop.x) ? crop.x : 0);
                media.dataset.akariCropY = String(crop && Number.isFinite(crop.y) ? crop.y : 0);
                media.dataset.akariCropW = String(crop && Number.isFinite(crop.w) && crop.w > 0 ? crop.w : 1);
                media.dataset.akariCropH = String(crop && Number.isFinite(crop.h) && crop.h > 0 ? crop.h : 1);
                const corners = segment.perspective && Array.isArray(segment.perspective.corners)
                    ? segment.perspective.corners : null;
                if (corners) media.dataset.akariPerspectiveCorners = JSON.stringify(corners);
                else delete media.dataset.akariPerspectiveCorners;
                return true;
            };
            const applyCutKeyframesToMedia = (media, segment, localTime) => {
                if (!cutHasLayerStyleVisual(segment)) return false;
                if (Array.isArray(segment.keyframes) && segment.keyframes.length >= 2) {
                    try {
                        // layer と同じ純関数を同じ cut-local/output 秒で評価する。outputTime 由来なので
                        // media の seeked 待ちに依存せず、再生とシークの双方で同じ値へ着地する。
                        const resolved = computeLayerKeyframesVisualFn(segment.keyframes, localTime);
                        if (resolved?.transform) {
                            media.dataset.akariTransformX = String(resolved.transform.x);
                            media.dataset.akariTransformY = String(resolved.transform.y);
                            media.dataset.akariTransformScale = String(resolved.transform.scale);
                            media.dataset.akariTransformRotate = String(resolved.transform.rotate);
                        }
                        if (resolved?.crop) {
                            media.dataset.akariCropX = String(resolved.crop.x);
                            media.dataset.akariCropY = String(resolved.crop.y);
                            media.dataset.akariCropW = String(resolved.crop.w);
                            media.dataset.akariCropH = String(resolved.crop.h);
                        }
                        if (resolved?.perspective) {
                            media.dataset.akariPerspectiveCorners = JSON.stringify(resolved.perspective.corners);
                        }
                    } catch (error) {
                        console.warn('[akari-preview] cut keyframes visual failed; rendering static values', segment.id, error);
                    }
                }
                if (window.akari.applyCutLayerStyleLayout) window.akari.applyCutLayerStyleLayout(media);
                return true;
            };
            const applyCutVisual = segment => {
                if (!segment || segment.kind !== 'src') {
                    video.dataset.akariCutTransformActive = 'false';
                    for (const media of [video, stillImage]) writeCutLayerStyleBase(media, null);
                    video.style.transform = '';
                    video.style.opacity = '';
                    video.dataset.akariCutIndex = '';
                    video.dataset.akariCutId = '';
                    // ㉓ ギャップ等クリック選択の対象外へ移った場合は選択を外す
                    // （deselectCut は後段で定義される const だが、実際の呼び出しは
                    // 常にトップレベルスクリプト完了後の非同期経路のため安全）。
                    if (typeof deselectCut === 'function') deselectCut({ report: true });
                    return;
                }
                const transform = segment.transform;
                if (transform) {
                    const x = Number.isFinite(transform.x) ? transform.x : 0;
                    const y = Number.isFinite(transform.y) ? transform.y : 0;
                    const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
                    const rotate = Number.isFinite(transform.rotate) ? transform.rotate : 0;
                    video.dataset.akariCutTransformActive = 'true';
                    video.dataset.akariTransformX = String(x);
                    video.dataset.akariTransformY = String(y);
                    video.dataset.akariTransformScale = String(scale);
                    video.dataset.akariTransformRotate = String(rotate);
                } else {
                    video.dataset.akariCutTransformActive = String(cutHasLayerStyleVisual(segment));
                }
                for (const media of [video, stillImage]) {
                    if (writeCutLayerStyleBase(media, segment)) {
                        applyCutKeyframesToMedia(media, segment, Math.max(0, outputTime - segment.outStart));
                    }
                }
                video.style.opacity = Number.isFinite(segment.opacity) ? String(segment.opacity) : '';
                stillImage.style.opacity = video.style.opacity;
                video.dataset.akariCutIndex = Number.isInteger(segment.cutIndex) ? String(segment.cutIndex) : '';
                video.dataset.akariCutId = typeof segment.id === 'string' ? segment.id : '';
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                if (typeof updateCutSelectBox === 'function') updateCutSelectBox();
            };
            const layerEntries = (Array.isArray(summary.layers) ? summary.layers : []).map((layer, index) => {
                // task 2026-08-10-image-layer-parity: layer.isImage はサーバ側（loadPreviewModel /
                // isImageLayerSrc）が拡張子で確定済み（webview から見える src はストリーム URL で
                // 元の拡張子を持たないことがあるため、ここで拡張子を再判定はしない）。
                const layerIsImage = Boolean(layer.isImage);
                const layerVideo = document.createElement(layerIsImage ? 'img' : 'video');
                const deferredTelop = layer.deferredTelop === true;
                const deferredPlaceholder = deferredTelop ? document.createElement('div') : null;
                const entry = {
                    spec: layer,
                    video: layerVideo,
                    deferredTelop,
                    deferredPlaceholder,
                    deferredSeekPending: false,
                    deferredSeekTarget: null,
                    deferredMediaLoading: deferredTelop,
                    deferredHasPresentedFrame: false
                };
                if (deferredPlaceholder) {
                    deferredPlaceholder.dataset.akariDeferredTelopId = String(layer.id);
                    deferredPlaceholder.setAttribute('role', 'status');
                    deferredPlaceholder.setAttribute('aria-label', 'テロップを準備中');
                    const label = document.createElement('span');
                    label.className = 'akari-deferred-telop-placeholder__label';
                    label.textContent = 'テロップを準備中…';
                    deferredPlaceholder.appendChild(label);
                    deferredPlaceholder.style.zIndex = String(zForTrack(layer.trackId));
                    layersStage.appendChild(deferredPlaceholder);
                }
                if (layerIsImage) {
                    // ㉚ 画像レイヤー（司令塔裁定3）: <video> 固有の
                    // videoWidth/videoHeight/readyState/paused/play/pause を <img> インスタンス自身に
                    // 薄いファサードとして生やし、以降の配置・crop・アルファ実測・click 選択などの
                    // 既存コード（video 用に書かれたレール）を無改修のまま乗せる。videoWidth/
                    // videoHeight/readyState は都度評価する getter にする（ロード完了前後で値が
                    // 変わる、video の同名プロパティと同じ性質）。
                    Object.defineProperty(layerVideo, 'videoWidth', { get: () => layerVideo.naturalWidth });
                    Object.defineProperty(layerVideo, 'videoHeight', { get: () => layerVideo.naturalHeight });
                    Object.defineProperty(layerVideo, 'readyState', {
                        get: () => (layerVideo.complete && layerVideo.naturalWidth > 0) ? 4 : 0
                    });
                    // 静止画に「再生中」は無い: renderLayers() の play()/pause() 呼び出しを無害な
                    // no-op として吸収する（呼び出し側 = video 用の tick ロジックには手を入れない）。
                    layerVideo.paused = true;
                    layerVideo.play = () => Promise.resolve();
                    layerVideo.pause = () => {};
                    // video の 'loadedmetadata'（サイズ確定）と 'loadeddata'
                    // （updateLayerSelectBox の再試行リスナー）を img の 'load' 1本から合成発火する。
                    layerVideo.addEventListener('load', () => {
                        layerVideo.dispatchEvent(new Event('loadedmetadata'));
                        layerVideo.dispatchEvent(new Event('loadeddata'));
                    });
                } else {
                    layerVideo.muted = true;
                    layerVideo.playsInline = true;
                    layerVideo.preload = 'auto';
                    layerVideo.disablePictureInPicture = true;
                }
                layerVideo.tabIndex = -1;
                // アルファ実測（選択枠のコンテンツフィット・透明素通し）で canvas に描くため。
                // ストリームサーバは Access-Control-Allow-Origin: * を返す
                layerVideo.crossOrigin = 'anonymous';
                layerVideo.dataset.akariLayerId = String(layer.id);
                layerVideo.dataset.akariLayerIndex = String(index);
                layerVideo.dataset.akariLayerKind = String(layer.kind);
                if (layer.kind === 'baked') layerVideo.style.pointerEvents = 'none';
                layerVideo.style.opacity = String(layer.opacity);
                layerVideo.style.mixBlendMode = layer.blend || 'normal';
                layerVideo.style.zIndex = String(zForTrack(layer.trackId));
                const transform = layer.transform || {};
                const x = Number.isFinite(transform.x) ? transform.x : 0;
                const y = Number.isFinite(transform.y) ? transform.y : 0;
                const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
                const rotate = Number.isFinite(transform.rotate) ? transform.rotate : 0;
                layerVideo.dataset.akariTransformX = String(x);
                layerVideo.dataset.akariTransformY = String(y);
                layerVideo.dataset.akariTransformScale = String(scale);
                layerVideo.dataset.akariTransformRotate = String(rotate);
                const crop = layer.crop;
                const cropW = crop && Number.isFinite(crop.w) && crop.w > 0 ? crop.w : 1;
                const cropH = crop && Number.isFinite(crop.h) && crop.h > 0 ? crop.h : 1;
                layerVideo.dataset.akariCropX = String(crop && Number.isFinite(crop.x) ? crop.x : 0);
                layerVideo.dataset.akariCropY = String(crop && Number.isFinite(crop.y) ? crop.y : 0);
                layerVideo.dataset.akariCropW = String(cropW);
                layerVideo.dataset.akariCropH = String(cropH);
                // ㉖ layers[].perspective（contract-2026-08-02-preview-parity.md §2.4.4）。absent/invalid
                // (schema-invalid corners, etc.) is represented as an empty dataset value --
                // updateStageScale's computeLayerPerspectiveVisualFn call already treats a falsy/
                // unparseable value as "no perspective", so no separate validity flag is needed here.
                const perspectiveCorners = layer.perspective && Array.isArray(layer.perspective.corners) ? layer.perspective.corners : null;
                if (perspectiveCorners) layerVideo.dataset.akariPerspectiveCorners = JSON.stringify(perspectiveCorners);
                else delete layerVideo.dataset.akariPerspectiveCorners;
                const position = () => {
                    if (!(layerVideo.videoWidth > 0) || !(layerVideo.videoHeight > 0)) return;
                    if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                };
                layerVideo.addEventListener('loadedmetadata', () => {
                    position();
                    tick(true);
                });
                for (const eventName of ['loadeddata', 'canplay']) {
                    layerVideo.addEventListener(eventName, () => {
                        if (entry.deferredTelop) entry.deferredMediaLoading = false;
                        tick(true);
                    });
                }
                layerVideo.addEventListener('seeked', () => {
                    if (entry.deferredTelop) {
                        entry.deferredSeekPending = false;
                        entry.deferredSeekTarget = null;
                    }
                    tick(true);
                });
                layerVideo.addEventListener('error', () => {
                    layerVideo.style.display = 'none';
                    console.warn('[akari-preview] layer media failed to load', layer.id);
                    const errorCode = layerVideo.error ? layerVideo.error.code : 0;
                    if ((errorCode === 3 || errorCode === 4) && typeof layer.sourceUri === 'string') {
                        showPlaybackError();
                        attemptHevcFallback(errorCode, layer.sourceUri);
                    }
                });
                if (typeof layer.src === 'string' && layer.src) {
                    layerVideo.src = layer.src;
                }
                layersStage.appendChild(layerVideo);
                return entry;
            });
            // video FX rail is structurally absent when no LUT/chroma declaration exists. This is
            // the inert guarantee: no canvas, WebGL context, or per-tick work for ordinary projects.
            const videoFxConfig = summary.videoFx || null;
            const videoFxRails = [];
            const railMeta = new Map();
            const noteVideoFxFailure = effects => {
                if (effects && effects.look) videoFxFailedIndicators.add('LUT');
                if (effects && effects.chromaKey) videoFxFailedIndicators.add('クロマキー');
                refreshIndicators();
            };
            const mountVideoFxRail = (media, role, initialEffects) => {
                try {
                    const rail = window.AkariVideoFx.createRail({
                        media,
                        role,
                        onStateChange: event => {
                            if (event.status === 'failed') noteVideoFxFailure(railMeta.get(event.rail)?.effects || initialEffects);
                        }
                    });
                    const meta = { effects: initialEffects || {}, key: null };
                    railMeta.set(rail, meta);
                    videoFxRails.push(rail);
                    return rail;
                } catch (error) {
                    console.warn('[akari-preview] video FX rail unavailable; continuing native playback', role, error);
                    noteVideoFxFailure(initialEffects);
                    return null;
                }
            };
            const configureVideoFxRail = (rail, key, effects) => {
                if (!rail) return;
                const meta = railMeta.get(rail);
                if (meta.key === key) return;
                meta.key = key;
                meta.effects = effects;
                void rail.configure(effects);
            };
            const cutHasChroma = (Array.isArray(summary.cuts) ? summary.cuts : []).some(cut => cut.chromaKey);
            const hasBaseVideoFx = Boolean(videoFxConfig && (videoFxConfig.look
                || Object.keys(videoFxConfig.sources || {}).length > 0 || cutHasChroma));
            const representativeChroma = hasBaseVideoFx && (
                Object.values(videoFxConfig.sources || {})[0]
                || (Array.isArray(summary.cuts) ? summary.cuts.find(cut => cut.chromaKey)?.chromaKey : null)
            );
            const baseInitialEffects = hasBaseVideoFx ? {
                ...(videoFxConfig.look ? { look: videoFxConfig.look } : {}),
                ...(representativeChroma ? { chromaKey: representativeChroma } : {})
            } : null;
            const baseVideoFxRail = hasBaseVideoFx ? mountVideoFxRail(video, 'source', baseInitialEffects) : null;
            const transitionVideoFxRail = hasBaseVideoFx
                ? mountVideoFxRail(transitionVideo, 'transition', baseInitialEffects) : null;
            const stillVideoFxRail = hasBaseVideoFx ? mountVideoFxRail(stillImage, 'still', baseInitialEffects) : null;
            for (const entry of layerEntries) {
                entry.fxRail = entry.spec.chromaKey
                    ? mountVideoFxRail(entry.video, 'layer:' + entry.spec.id, { chromaKey: entry.spec.chromaKey })
                    : null;
                if (entry.fxRail) configureVideoFxRail(
                    entry.fxRail,
                    'layer:' + entry.spec.id,
                    { chromaKey: entry.spec.chromaKey }
                );
            }
            const effectsForSegment = segment => {
                const chromaKey = segment && (segment.chromaKey
                    || (videoFxConfig && videoFxConfig.sources && videoFxConfig.sources[segment.src]));
                return {
                    ...(videoFxConfig && videoFxConfig.look ? { look: videoFxConfig.look } : {}),
                    ...(chromaKey ? { chromaKey } : {})
                };
            };
            const renderVideoFx = timelineTime => {
                if (!hasBaseVideoFx && !layerEntries.some(entry => entry.fxRail)) return;
                const segment = segments[activeSegmentIndex];
                const baseEffects = effectsForSegment(segment);
                const baseKey = 'base:' + String(segment && segment.cutIndex) + ':' + String(segment && segment.src);
                configureVideoFxRail(baseVideoFxRail, baseKey, baseEffects);
                configureVideoFxRail(stillVideoFxRail, baseKey, baseEffects);
                if (baseVideoFxRail) baseVideoFxRail.render(timelineTime);
                if (stillVideoFxRail && stillImage.style.display !== 'none') stillVideoFxRail.render(timelineTime);

                const transitionWindow = transitionWindows.find(candidate =>
                    timelineTime >= candidate.start && timelineTime < candidate.end);
                const transitionEffects = effectsForSegment(transitionWindow && transitionWindow.incoming);
                const transitionKey = 'transition:' + String(transitionWindow && transitionWindow.incoming.cutIndex)
                    + ':' + String(transitionWindow && transitionWindow.incoming.src);
                configureVideoFxRail(transitionVideoFxRail, transitionKey, transitionEffects);
                if (transitionVideoFxRail && transitionVideo.style.display !== 'none') {
                    transitionVideoFxRail.render(timelineTime);
                }
                for (const entry of layerEntries) {
                    if (entry.fxRail && entry.video.style.display !== 'none') entry.fxRail.render(timelineTime);
                }
            };
            window.akari.videoFx = Object.freeze({
                rails: videoFxRails,
                inspect: () => videoFxRails.map(rail => rail.inspect())
            });
            const cssFilterFor = spec => {
                if (spec && spec.type === 'invert') return 'invert(1)';
                if (spec && spec.type === 'saturation' && Number.isFinite(spec.value)) {
                    return 'saturate(' + Math.max(0, Number(spec.value)) + ')';
                }
                return 'none';
            };
            const filterEntries = (Array.isArray(summary.filters) ? summary.filters : []).map(filter => {
                const element = document.createElement('div');
                element.dataset.akariFilterId = String(filter.id);
                element.style.zIndex = String(zForTrack(filter.trackId));
                element.style.backdropFilter = cssFilterFor(filter.filter);
                element.style.webkitBackdropFilter = cssFilterFor(filter.filter);
                layersStage.appendChild(element);
                return { spec: filter, element };
            });
            const applyIncrementalLayerSpec = (entry, layer) => {
                // 非同期 telop の ready 後に通常のファイル更新が来ても、次の bake 待ちを示す
                // proxyMissing モデルで既に表示中の src を巻き戻さない。
                if (layer.proxyMissing && !layer.src && entry.spec.src && !entry.spec.proxyMissing) {
                    layer = { ...layer, src: entry.spec.src, proxyMissing: false };
                }
                entry.spec = layer;
                const layerVideo = entry.video;
                if (entry.fxRail && layer.chromaKey) {
                    configureVideoFxRail(entry.fxRail, 'layer:' + layer.id + ':' + JSON.stringify(layer.chromaKey), {
                        chromaKey: layer.chromaKey
                    });
                }
                if (typeof layer.src === 'string' && layer.src
                    && layerVideo.getAttribute('src') !== layer.src) {
                    if (entry.deferredTelop) {
                        entry.deferredMediaLoading = true;
                        entry.deferredSeekPending = false;
                        entry.deferredSeekTarget = null;
                    }
                    layerVideo.src = layer.src;
                    entry.opaqueBox = undefined;
                }
                layerVideo.style.opacity = String(layer.opacity);
                layerVideo.style.mixBlendMode = layer.blend || 'normal';
                layerVideo.style.zIndex = String(zForTrack(layer.trackId));
                if (entry.deferredPlaceholder) {
                    entry.deferredPlaceholder.style.zIndex = String(zForTrack(layer.trackId));
                }
                const transform = layer.transform || {};
                layerVideo.dataset.akariTransformX = String(Number.isFinite(transform.x) ? transform.x : 0);
                layerVideo.dataset.akariTransformY = String(Number.isFinite(transform.y) ? transform.y : 0);
                layerVideo.dataset.akariTransformScale = String(
                    Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1
                );
                layerVideo.dataset.akariTransformRotate = String(Number.isFinite(transform.rotate) ? transform.rotate : 0);
                const crop = layer.crop;
                layerVideo.dataset.akariCropX = String(crop && Number.isFinite(crop.x) ? crop.x : 0);
                layerVideo.dataset.akariCropY = String(crop && Number.isFinite(crop.y) ? crop.y : 0);
                layerVideo.dataset.akariCropW = String(crop && Number.isFinite(crop.w) && crop.w > 0 ? crop.w : 1);
                layerVideo.dataset.akariCropH = String(crop && Number.isFinite(crop.h) && crop.h > 0 ? crop.h : 1);
                const corners = layer.perspective && Array.isArray(layer.perspective.corners)
                    ? layer.perspective.corners : null;
                if (corners) layerVideo.dataset.akariPerspectiveCorners = JSON.stringify(corners);
                else delete layerVideo.dataset.akariPerspectiveCorners;
            };
            // CF-select + transform ハンドル: レイヤー実体のクリック選択・タイムラインとの双方向同期・
            // プレビュー内ドラッグ移動/リサイズ(=scale)/回転。確定(pointerup)時のみ layerWrite で
            // 書き戻す（既存 overlay ドラッグ編集と同じ確定タイミング）。
            let selectedLayerId = null;
            // ㉔ クロップモード（2026-08-06 オーナー裁定: shell/Web 両面）。移動/リサイズ/回転と
            // 操作が衝突しないための排他モード切替。選択が変わったら自動的に抜ける。
            let cropModeActive = false;
            const layerCropBox = document.getElementById('layer-crop-box');
            const layerCropRect = layerCropBox.querySelector('.akari-layer-crop-rect');
            const layerCropHandleElements = Array.from(layerCropBox.querySelectorAll('[data-akari-crop-handle]'));
            const layerCropToggle = document.getElementById('layer-crop-toggle');
            // ㉖ layers[].perspective（v0）: プリセット(右奥/左奥/上奥/下奥) + 角度ツマミのみ。4隅の
            // 直接ドラッグハンドルは次段のため、クロップのようなハンドル/モードの仕組みは持たない。
            let perspectivePanelOpen = false;
            let activePerspectivePreset = null;
            const layerPerspectiveToggle = document.getElementById('layer-perspective-toggle');
            const layerPerspectivePanel = document.getElementById('layer-perspective-panel');
            const layerPerspectivePresetButtons = Array.from(layerPerspectivePanel.querySelectorAll('[data-akari-perspective-preset]'));
            const layerPerspectiveAngleInput = layerPerspectivePanel.querySelector('[data-akari-perspective-angle]');
            const layerPerspectiveAngleValueEl = layerPerspectivePanel.querySelector('[data-akari-perspective-angle-value]');
            const layerPerspectiveClearButton = layerPerspectivePanel.querySelector('[data-akari-perspective-clear]');
            const layerSelectBox = document.getElementById('layer-select-box');
            const layerHandleElements = Array.from(layerSelectBox.querySelectorAll('[data-akari-handle]'));
            const findLayerEntry = id => layerEntries.find(entry => String(entry.spec.id) === String(id));
            const layerTransformNow = entry => ({
                x: Number(entry.video.dataset.akariTransformX) || 0,
                y: Number(entry.video.dataset.akariTransformY) || 0,
                scale: Number(entry.video.dataset.akariTransformScale) || 1,
                rotate: Number(entry.video.dataset.akariTransformRotate) || 0
            });
            // RAF スロットリング（2026-08-09 raf-throttle・オーナー実機フィードバック「サイズ変更が
            // すごくもたつく」）: dataset への書き込みは常に同期（pointerup の確定読み取りが最新値を
            // 読めるように）。重い方（updateLayerLayout = 全レイヤー + stage 再配置、と選択枠の再描画）
            // だけを 1 フレーム 1 回へ間引く。ドラッグ終了直後は各 finish() 側で flush() して
            // 最終値の反映を RAF 待ちにしない。
            const layerTransformVisualThrottle = createRafThrottleFn(() => {
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                updateLayerSelectBox();
            });
            const applyLayerTransformNow = (entry, transform) => {
                entry.video.dataset.akariTransformX = String(transform.x);
                entry.video.dataset.akariTransformY = String(transform.y);
                entry.video.dataset.akariTransformScale = String(transform.scale);
                entry.video.dataset.akariTransformRotate = String(transform.rotate);
                layerTransformVisualThrottle.call();
            };
            // ㉔ layers[].crop（0..1 正規化・ソースフレーム相対・静的）。CROP_MIN は空クロップ化を防ぐ
            // 下限（ハンドルが操作不能になる縮退を避ける）。clampCrop は render-cut/src/layers.mjs の
            // クランプと同じ意味論をプレビュー側で独立実装したもの（パリティ契約が明記する意図的な
            // コード重複の方針に倣う — 2.2 節の描画既定などと同型）。
            const CROP_MIN = 0.02;
            const clampCrop = (x, y, w, h) => {
                const cw = Math.min(1, Math.max(CROP_MIN, Number.isFinite(w) ? w : 1));
                const ch = Math.min(1, Math.max(CROP_MIN, Number.isFinite(h) ? h : 1));
                const cx = Math.min(1 - cw, Math.max(0, Number.isFinite(x) ? x : 0));
                const cy = Math.min(1 - ch, Math.max(0, Number.isFinite(y) ? y : 0));
                return { x: cx, y: cy, w: cw, h: ch };
            };
            const layerCropNow = entry => clampCrop(
                Number(entry.video.dataset.akariCropX),
                Number(entry.video.dataset.akariCropY),
                Number(entry.video.dataset.akariCropW),
                Number(entry.video.dataset.akariCropH)
            );
            // RAF スロットリング（2026-08-09 raf-throttle）: applyLayerTransformNow と同じ規律
            // （dataset は同期・重い方だけ1フレーム1回）。crop 単独/crop+transform 一括のどちらも
            // 同じ「レイヤーの見た目を測り直す」作業なので throttle インスタンスを共有する
            // （同時に両方から呼ばれることはない = ドラッグは常に単一ジェスチャー）。
            const layerCropVisualThrottle = createRafThrottleFn(() => {
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                if (cropModeActive) updateLayerCropBox();
                else updateLayerSelectBox();
            });
            const applyLayerCropNow = (entry, crop) => {
                const c = clampCrop(crop.x, crop.y, crop.w, crop.h);
                entry.video.dataset.akariCropX = String(c.x);
                entry.video.dataset.akariCropY = String(c.y);
                entry.video.dataset.akariCropW = String(c.w);
                entry.video.dataset.akariCropH = String(c.h);
                layerCropVisualThrottle.call();
            };
            // ㉗ クロップハンドル操作の錨補正（2026-08-06 crop-handle-anchor-fix）: crop と
            // transform.x/y を同一フレームで一括更新する。crop 単独 → transform 単独の2段更新だと
            // 中間フレームで一瞬だけ錨補正前の crop が画面に出てしまう（updateLayerLayout が
            // 前者の呼び出し時点でまだ古い transform を使って描く）ため、必ずこちらを使う。
            const applyLayerCropAndTransformNow = (entry, crop, transform) => {
                const c = clampCrop(crop.x, crop.y, crop.w, crop.h);
                entry.video.dataset.akariCropX = String(c.x);
                entry.video.dataset.akariCropY = String(c.y);
                entry.video.dataset.akariCropW = String(c.w);
                entry.video.dataset.akariCropH = String(c.h);
                entry.video.dataset.akariTransformX = String(transform.x);
                entry.video.dataset.akariTransformY = String(transform.y);
                entry.video.dataset.akariTransformScale = String(transform.scale);
                entry.video.dataset.akariTransformRotate = String(transform.rotate);
                layerCropVisualThrottle.call();
            };
            // ベイクテロップは全面サイズの透明動画なので、要素の箱で選択枠を描くと画面いっぱいに
            // なり分かりにくい。現フレームのアルファを実測し、不透明領域（コンテンツ）へ枠を
            // フィットさせ、透明部分のクリックは下へ素通しする。計測不能（CORS 等）時は従来挙動
            const layerAlphaCanvasEl = document.createElement('canvas');
            // 画面クライアント座標 → ソース動画のネイティブ px 座標への逆写像。pivot（回転・平行移動の
            // 基準点、ソース px 空間）を外から渡せるようにし、通常のヒットテスト（pivot=クロップ中心 =
            // 実際の合成基準点）とクロップモードの編集（pivot=全面中心 = 常に自分の中心で回る素直な
            // 参照系）の両方から共有する。
            const layerVideoPointForPivot = (entry, transform, pivotPx, clientX, clientY) => {
                const p = window.akari.interaction && window.akari.interaction.stageLocalPoint
                    ? window.akari.interaction.stageLocalPoint(clientX, clientY) : null;
                if (!p) return null;
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                const dx = p.x - (outputWidth / 2 + transform.x);
                const dy = p.y - (outputHeight / 2 + transform.y);
                const rad = -transform.rotate * Math.PI / 180;
                const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
                const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
                return { x: rx / (transform.scale || 1) + pivotPx.x, y: ry / (transform.scale || 1) + pivotPx.y };
            };
            const layerVideoPointFor = (entry, clientX, clientY) => {
                const t = layerTransformNow(entry);
                const crop = layerCropNow(entry);
                const pivotPx = {
                    x: (crop.x + crop.w / 2) * entry.video.videoWidth,
                    y: (crop.y + crop.h / 2) * entry.video.videoHeight
                };
                const point = layerVideoPointForPivot(entry, t, pivotPx, clientX, clientY);
                if (!point) return null;
                const { x: vx, y: vy } = point;
                if (!(vx >= 0) || !(vy >= 0) || vx >= entry.video.videoWidth || vy >= entry.video.videoHeight) return null;
                return { x: Math.floor(vx), y: Math.floor(vy) };
            };
            // 画面座標への正写像（layerVideoPointForPivot の逆）。videoRect はソース px 空間の矩形
            // （全面フレーム or クロップ矩形）、pivotPx は回転・平行移動の基準点（同じくソース px）。
            // updateLayerSelectBox（pivot=クロップ中心）とクロップモードの外枠/内枠描画
            // （pivot=全面中心）の両方から共有する。
            const layerScreenRectForVideoRect = (entry, transform, videoRect, pivotPx) => {
                const frameRect = window.akari.computeOutputFrameRect();
                const frameScale = window.akari.stageScale() || 1;
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                const outputW = videoRect.w * transform.scale;
                const outputH = videoRect.h * transform.scale;
                const offX = (videoRect.x + videoRect.w / 2 - pivotPx.x) * transform.scale;
                const offY = (videoRect.y + videoRect.h / 2 - pivotPx.y) * transform.scale;
                const rad = transform.rotate * Math.PI / 180;
                const rotOffX = offX * Math.cos(rad) - offY * Math.sin(rad);
                const rotOffY = offX * Math.sin(rad) + offY * Math.cos(rad);
                const outputCenterX = outputWidth / 2 + transform.x + rotOffX;
                const outputCenterY = outputHeight / 2 + transform.y + rotOffY;
                const screenW = outputW * frameScale;
                const screenH = outputH * frameScale;
                const screenCenterX = frameRect.x + outputCenterX * frameScale;
                const screenCenterY = frameRect.y + outputCenterY * frameScale;
                return { left: screenCenterX - screenW / 2, top: screenCenterY - screenH / 2, width: screenW, height: screenH, rotOffX, rotOffY };
            };
            const layerAlphaAtPoint = (entry, clientX, clientY) => {
                try {
                    if (!(entry.video.videoWidth > 0) || entry.video.readyState < 2) return 255;
                    const vp = layerVideoPointFor(entry, clientX, clientY);
                    if (!vp) return 0;
                    layerAlphaCanvasEl.width = 1;
                    layerAlphaCanvasEl.height = 1;
                    const ctx = layerAlphaCanvasEl.getContext('2d', { willReadFrequently: true });
                    ctx.clearRect(0, 0, 1, 1);
                    ctx.drawImage(entry.video, vp.x, vp.y, 1, 1, 0, 0, 1, 1);
                    return ctx.getImageData(0, 0, 1, 1).data[3];
                } catch (_error) {
                    return 255;
                }
            };
            const measureLayerOpaqueBox = entry => {
                try {
                    const vw = entry.video.videoWidth;
                    const vh = entry.video.videoHeight;
                    if (!(vw > 0) || !(vh > 0) || entry.video.readyState < 2) return null;
                    const shrink = Math.min(1, 320 / Math.max(vw, vh));
                    const w = Math.max(1, Math.round(vw * shrink));
                    const h = Math.max(1, Math.round(vh * shrink));
                    layerAlphaCanvasEl.width = w;
                    layerAlphaCanvasEl.height = h;
                    const ctx = layerAlphaCanvasEl.getContext('2d', { willReadFrequently: true });
                    ctx.clearRect(0, 0, w, h);
                    ctx.drawImage(entry.video, 0, 0, w, h);
                    const data = ctx.getImageData(0, 0, w, h).data;
                    let minX = w, minY = h, maxX = -1, maxY = -1;
                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            if (data[(y * w + x) * 4 + 3] > 16) {
                                if (x < minX) minX = x;
                                if (x > maxX) maxX = x;
                                if (y < minY) minY = y;
                                if (y > maxY) maxY = y;
                            }
                        }
                    }
                    if (maxX < 0) return null;
                    const sx = vw / w;
                    const sy = vh / h;
                    const pad = Math.max(4, sx * 1.5);
                    return {
                        x: Math.max(0, minX * sx - pad),
                        y: Math.max(0, minY * sy - pad),
                        w: Math.min(vw, (maxX - minX + 1) * sx + pad * 2),
                        h: Math.min(vh, (maxY - minY + 1) * sy + pad * 2)
                    };
                } catch (_error) {
                    return null;
                }
            };
            const syncLayerHitRegion = (entry, forceMeasure = false) => {
                if (forceMeasure) entry.opaqueBox = undefined;
                if (entry.opaqueBox === undefined) entry.opaqueBox = measureLayerOpaqueBox(entry);
                const box = entry.opaqueBox;
                if (box) {
                    entry.video.dataset.akariOpaqueX = String(box.x);
                    entry.video.dataset.akariOpaqueY = String(box.y);
                    entry.video.dataset.akariOpaqueW = String(box.w);
                    entry.video.dataset.akariOpaqueH = String(box.h);
                    entry.video.style.pointerEvents = 'auto';
                } else {
                    delete entry.video.dataset.akariOpaqueX;
                    delete entry.video.dataset.akariOpaqueY;
                    delete entry.video.dataset.akariOpaqueW;
                    delete entry.video.dataset.akariOpaqueH;
                    if (entry.spec.kind === 'baked') entry.video.style.pointerEvents = 'none';
                }
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                return box;
            };
            for (const entry of layerEntries) {
                entry.video.addEventListener('loadeddata', () => syncLayerHitRegion(entry, true));
                entry.video.addEventListener('seeked', () => syncLayerHitRegion(entry, true));
            }
            const updateLayerSelectBox = () => {
                const entry = selectedLayerId ? findLayerEntry(selectedLayerId) : undefined;
                if (!entry || entry.video.style.display === 'none' || !(entry.video.videoWidth > 0)) {
                    layerSelectBox.classList.remove('is-active');
                    positionLayerCropToggle(null);
                    positionLayerPerspectiveToggle(null);
                    return;
                }
                const transform = layerTransformNow(entry);
                const crop = layerCropNow(entry);
                // 枠は要素の箱ではなく不透明領域（コンテンツ）にフィットさせる（未計測なら計測）。
                // フレーム未着で測れないうちは全面フォールバック枠を一瞬見せず、届いてから出す
                if (entry.opaqueBox === undefined) {
                    if (entry.video.readyState >= 2) {
                        syncLayerHitRegion(entry);
                    } else {
                        layerSelectBox.classList.remove('is-active');
                        entry.video.addEventListener('loadeddata', () => updateLayerSelectBox(), { once: true });
                        return;
                    }
                }
                const naturalBox = entry.opaqueBox || { x: 0, y: 0, w: entry.video.videoWidth, h: entry.video.videoHeight };
                // ㉔ クロップ窓（ソース px 空間）と不透明領域の交差 = 実際に見えている範囲。交差が無い
                // （クロップが不透明領域を完全に外した）場合はクロップ窓そのものへフォールバックする。
                const cropBoxPx = {
                    x: crop.x * entry.video.videoWidth,
                    y: crop.y * entry.video.videoHeight,
                    w: crop.w * entry.video.videoWidth,
                    h: crop.h * entry.video.videoHeight
                };
                const ix0 = Math.max(naturalBox.x, cropBoxPx.x);
                const iy0 = Math.max(naturalBox.y, cropBoxPx.y);
                const ix1 = Math.min(naturalBox.x + naturalBox.w, cropBoxPx.x + cropBoxPx.w);
                const iy1 = Math.min(naturalBox.y + naturalBox.h, cropBoxPx.y + cropBoxPx.h);
                const cb = (ix1 > ix0 && iy1 > iy0) ? { x: ix0, y: iy0, w: ix1 - ix0, h: iy1 - iy0 } : cropBoxPx;
                // ピボット（拡縮・回転の基準点）は実際の合成と同じくクロップ矩形の中心
                // （render-cut は crop→scale→rotate→overlay の順で合成し、overlay の中心合わせは
                // crop 後の frame 基準になるため — layers.mjs 参照）。
                const pivotPx = {
                    x: (crop.x + crop.w / 2) * entry.video.videoWidth,
                    y: (crop.y + crop.h / 2) * entry.video.videoHeight
                };
                const box = layerScreenRectForVideoRect(entry, transform, cb, pivotPx);
                layerSelectBox.style.left = box.left + 'px';
                layerSelectBox.style.top = box.top + 'px';
                layerSelectBox.style.width = box.width + 'px';
                layerSelectBox.style.height = box.height + 'px';
                layerSelectBox.style.transform = 'rotate(' + transform.rotate + 'deg)';
                // ハンドルの拡縮・回転ピボット（= クロップ矩形の中心）を箱から逆算するためのオフセット
                layerSelectBox.dataset.akariPivotOffX = String(box.rotOffX);
                layerSelectBox.dataset.akariPivotOffY = String(box.rotOffY);
                layerSelectBox.classList.add('is-active');
                if (!cropModeActive) positionLayerCropToggle(box);
                if (!cropModeActive) positionLayerPerspectiveToggle(box);
                layerPerspectiveToggle.classList.toggle('is-declared', !!layerPerspectiveNow(entry));
            };
            // クロップトグルボタンは通常枠/クロップ枠のどちらが出ていても常に同じ場所（右上角の外側）
            // に留まり続ける（モード切替のたびに探し直させない）。box=null でレイヤー未選択として隠す。
            const positionLayerCropToggle = box => {
                if (!box) {
                    layerCropToggle.classList.remove('is-target-active');
                    return;
                }
                // 箱の上端が画面上端に近いと「箱の外側・上」が画面外へはみ出す。0 未満にはせず、
                // 収まらないときは箱の内側上端へフォールバックする。
                layerCropToggle.style.left = (box.left + box.width + 4) + 'px';
                layerCropToggle.style.top = Math.max(4, box.top - 26) + 'px';
                layerCropToggle.classList.add('is-target-active');
            };
            // クロップモードのオーバーレイ: 外枠はソースフレーム全体（クロップ無しなら見えていたはずの
            // 範囲）、内枠が現在のクロップ窓。pivot は実合成と同じ「現在のクロップ矩形の中心」を使う
            // （2026-08-06 crop-handle-anchor-fix 以前は全面中心固定の近似だったが、それだと錨補正
            // 後の transform.x/y と噛み合わず外枠が編集中にドリフトして見えるため、実際の合成 pivot
            // と統一した — layerScreenRectForVideoRect の呼び手（updateLayerSelectBox）と同型）。
            const updateLayerCropBox = () => {
                const entry = selectedLayerId ? findLayerEntry(selectedLayerId) : undefined;
                if (!cropModeActive || !entry || entry.video.style.display === 'none' || !(entry.video.videoWidth > 0)) {
                    layerCropBox.classList.remove('is-active');
                    return;
                }
                const transform = layerTransformNow(entry);
                const crop = layerCropNow(entry);
                const vw = entry.video.videoWidth;
                const vh = entry.video.videoHeight;
                const pivotPx = { x: (crop.x + crop.w / 2) * vw, y: (crop.y + crop.h / 2) * vh };
                const outer = layerScreenRectForVideoRect(entry, transform, { x: 0, y: 0, w: vw, h: vh }, pivotPx);
                const inner = layerScreenRectForVideoRect(entry, transform, { x: crop.x * vw, y: crop.y * vh, w: crop.w * vw, h: crop.h * vh }, pivotPx);
                layerCropBox.style.left = outer.left + 'px';
                layerCropBox.style.top = outer.top + 'px';
                layerCropBox.style.width = outer.width + 'px';
                layerCropBox.style.height = outer.height + 'px';
                layerCropBox.style.transform = 'rotate(' + transform.rotate + 'deg)';
                layerCropRect.style.left = (inner.left - outer.left) + 'px';
                layerCropRect.style.top = (inner.top - outer.top) + 'px';
                layerCropRect.style.width = inner.width + 'px';
                layerCropRect.style.height = inner.height + 'px';
                layerCropBox.classList.add('is-active');
                positionLayerCropToggle(outer);
            };
            const setCropMode = active => {
                cropModeActive = !!(active && selectedLayerId);
                // ㉖ クロップモードとパースパネルは排他（ハンドル/操作の衝突を避ける）。
                if (cropModeActive && perspectivePanelOpen) setPerspectivePanelOpen(false);
                layerCropToggle.classList.toggle('is-crop-mode', cropModeActive);
                layerSelectBox.classList.toggle('akari-crop-mode-hide-handles', cropModeActive);
                if (cropModeActive) {
                    updateLayerCropBox();
                } else {
                    layerCropBox.classList.remove('is-active');
                    updateLayerSelectBox();
                }
            };
            // click ではなく pointerdown+pointerup（setPointerCapture 付き）で拾う — 再生中は毎フレーム
            // positionLayerCropToggle が呼ばれてボタンが数 px 動くため、down/up の間にボタンが動くと
            // click イベントの合成対象がズレて発火しなくなることがある（実マウス操作で再現・
            // 実測確認済み）。ドラッグハンドルと同じ pointer capture 方式にして確実に拾う。
            layerCropToggle.addEventListener('pointerdown', event => {
                event.preventDefault();
                event.stopPropagation();
                try { layerCropToggle.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
            });
            layerCropToggle.addEventListener('pointerup', event => {
                event.stopPropagation();
                setCropMode(!cropModeActive);
            });
            window.addEventListener('keydown', event => {
                if (event.key === 'Escape' && cropModeActive) setCropMode(false);
            });
            // ㉖ layers[].perspective（v0）: 常に同じ場所（クロップトグルの下）に留まるトグル + パネル。
            // box=null でレイヤー未選択として隠す（クロップトグルと同じ規律）。
            const positionLayerPerspectiveToggle = box => {
                if (!box) {
                    layerPerspectiveToggle.classList.remove('is-target-active');
                    if (perspectivePanelOpen) setPerspectivePanelOpen(false);
                    return;
                }
                layerPerspectiveToggle.style.left = (box.left + box.width + 4) + 'px';
                layerPerspectiveToggle.style.top = Math.max(4, box.top - 26) + 26 + 4 + 'px';
                layerPerspectiveToggle.classList.add('is-target-active');
                if (perspectivePanelOpen) {
                    layerPerspectivePanel.style.left = layerPerspectiveToggle.style.left;
                    layerPerspectivePanel.style.top = (parseFloat(layerPerspectiveToggle.style.top) + 26 + 4) + 'px';
                }
            };
            const layerPerspectiveNow = entry => {
                const raw = entry.video.dataset.akariPerspectiveCorners;
                if (!raw) return null;
                try {
                    const parsed = JSON.parse(raw);
                    return Array.isArray(parsed) && parsed.length === 4 ? parsed : null;
                } catch (_error) {
                    return null;
                }
            };
            const applyLayerPerspectiveNow = (entry, corners) => {
                if (corners) entry.video.dataset.akariPerspectiveCorners = JSON.stringify(corners);
                else delete entry.video.dataset.akariPerspectiveCorners;
                layerPerspectiveToggle.classList.toggle('is-declared', !!corners);
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
            };
            // プリセット→4隅の展開（v0）。SSOT は保存される4隅のみ — このツマミはオーサリング側の
            // 便宜であり、schema には「プリセット」「角度」という概念自体は存在しない
            // (contract-2026-08-02-preview-parity.md §2.4.4)。奥行き感は sin(角度) で圧縮量を決め、
            // 該当する辺の中点方向へ両端点を寄せる（角度0=無変形、角度が大きいほど強い台形）。
            const perspectivePresetCorners = (preset, angleDeg) => {
                const compression = Math.max(0, Math.min(0.9, Math.sin((Number(angleDeg) || 0) * Math.PI / 180)));
                const half = compression / 2;
                if (preset === 'right') return [[0, 0], [1, half], [0, 1], [1, 1 - half]];
                if (preset === 'left') return [[0, half], [1, 0], [0, 1 - half], [1, 1]];
                if (preset === 'top') return [[half, 0], [1 - half, 0], [0, 1], [1, 1]];
                if (preset === 'bottom') return [[0, 0], [1, 0], [half, 1], [1 - half, 1]];
                return null;
            };
            const commitLayerPerspective = async (entry, corners) => {
                const original = layerPerspectiveNow(entry);
                applyLayerPerspectiveNow(entry, corners);
                try {
                    await window.akari.engine.layerWrite(entry.spec.id, { perspective: corners ? { corners } : null });
                } catch (error) {
                    window.akari.showWriteError(error);
                    applyLayerPerspectiveNow(entry, original);
                }
            };
            const setPerspectivePanelOpen = open => {
                perspectivePanelOpen = !!(open && selectedLayerId);
                layerPerspectiveToggle.classList.toggle('is-panel-open', perspectivePanelOpen);
                layerPerspectivePanel.classList.toggle('is-open', perspectivePanelOpen);
                if (perspectivePanelOpen) {
                    if (cropModeActive) setCropMode(false);
                    updateLayerSelectBox();
                }
            };
            layerPerspectiveToggle.addEventListener('pointerdown', event => {
                event.preventDefault();
                event.stopPropagation();
                try { layerPerspectiveToggle.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
            });
            layerPerspectiveToggle.addEventListener('pointerup', event => {
                event.stopPropagation();
                setPerspectivePanelOpen(!perspectivePanelOpen);
            });
            for (const button of layerPerspectivePresetButtons) {
                button.addEventListener('pointerdown', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    try { button.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
                });
                button.addEventListener('pointerup', event => {
                    event.stopPropagation();
                    if (!selectedLayerId) return;
                    const entry = findLayerEntry(selectedLayerId);
                    if (!entry) return;
                    const preset = button.getAttribute('data-akari-perspective-preset');
                    activePerspectivePreset = preset;
                    for (const other of layerPerspectivePresetButtons) other.classList.toggle('is-active', other === button);
                    const corners = perspectivePresetCorners(preset, layerPerspectiveAngleInput.value);
                    void commitLayerPerspective(entry, corners);
                });
            }
            layerPerspectiveAngleInput.addEventListener('input', () => {
                layerPerspectiveAngleValueEl.textContent = layerPerspectiveAngleInput.value + '°';
                if (!activePerspectivePreset || !selectedLayerId) return;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return;
                // ライブプレビューのみ（書き戻しはしない） -- ドラッグ中に毎回 lint/書き込みを
                // 往復させないため、既存の crop ハンドルと同じ「確定時のみ書き戻す」規律に倣う。
                applyLayerPerspectiveNow(entry, perspectivePresetCorners(activePerspectivePreset, layerPerspectiveAngleInput.value));
            });
            layerPerspectiveAngleInput.addEventListener('change', () => {
                if (!activePerspectivePreset || !selectedLayerId) return;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return;
                void commitLayerPerspective(entry, perspectivePresetCorners(activePerspectivePreset, layerPerspectiveAngleInput.value));
            });
            layerPerspectiveClearButton.addEventListener('pointerdown', event => {
                event.preventDefault();
                event.stopPropagation();
                try { layerPerspectiveClearButton.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
            });
            layerPerspectiveClearButton.addEventListener('pointerup', event => {
                event.stopPropagation();
                if (!selectedLayerId) return;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return;
                activePerspectivePreset = null;
                for (const button of layerPerspectivePresetButtons) button.classList.remove('is-active');
                void commitLayerPerspective(entry, null);
            });
            window.addEventListener('keydown', event => {
                if (event.key === 'Escape' && perspectivePanelOpen) setPerspectivePanelOpen(false);
            });
            const selectLayer = (layerId, options) => {
                const report = !options || options.report !== false;
                const nextId = layerId && findLayerEntry(layerId) ? layerId : null;
                if (nextId === selectedLayerId) {
                    updateLayerSelectBox();
                    return;
                }
                if (cropModeActive) setCropMode(false);
                if (perspectivePanelOpen) setPerspectivePanelOpen(false);
                activePerspectivePreset = null;
                for (const button of layerPerspectivePresetButtons) button.classList.remove('is-active');
                selectedLayerId = nextId;
                // ㉓ 選択の排他制御: layer を選ぶと cut/caption 選択は外れる（逆方向はそれぞれの select 側）。
                if (nextId && typeof deselectCut === 'function') deselectCut({ report: true });
                if (nextId && typeof deselectCaption === 'function') deselectCaption({ report: true });
                if (nextId) {
                    const measured = findLayerEntry(nextId);
                    // 選択時点のフレームで測り直す（updateLayerSelectBox が遅延計測する）
                    if (measured) measured.opaqueBox = undefined;
                }
                updateLayerSelectBox();
                if (report) window.akari.reportLayerSelection(selectedLayerId);
            };
            // ㉒ スナップ統一: layers[]（この後 cut/caption も同型）の移動・拡縮を、
            // interaction.js（overlay-runtime、overlays[] 用スナップの単一正本）が公開する
            // computeSnapCorrection/stageLocalPoint/showSnapGuides/hideSnapGuides へ委譲する。
            // 出力px（video座標）系の bounds を渡すだけで、キャンバス外周+5%セーフマージン+
            // センター縦横・8px吸着/12px解除（表示px基準=ズーム下でも見た目8px相当）・
            // ガイド線が overlays[] と完全に同一挙動になる（旧実装は resize/layers[] とも
            // スナップ皆無だった）。
            const outputBoundsForCenteredBox = (centerX, centerY, boxWidth, boxHeight) => ({
                left: centerX - boxWidth / 2,
                right: centerX + boxWidth / 2,
                top: centerY - boxHeight / 2,
                bottom: centerY + boxHeight / 2,
                centerX,
                centerY
            });
            const layerOutputBoundsForTransform = (entry, transform) => {
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                // ㉔ crop 適用中は見えている（=スナップ対象になるべき）footprint が cropW/cropH 分
                // 小さいので、フルサイズではなくクロップ後の寸法で bounds を組む。
                const crop = layerCropNow(entry);
                return outputBoundsForCenteredBox(
                    outputWidth / 2 + transform.x,
                    outputHeight / 2 + transform.y,
                    (entry.video.videoWidth || 0) * crop.w * transform.scale,
                    (entry.video.videoHeight || 0) * crop.h * transform.scale
                );
            };
            // CF-write: layerWrite 確定 → 失敗時は元の値へ視覚的に巻き戻す（既存 overlay 編集と同じ規約）。
            const beginLayerTransformDrag = (entry, startEvent, computeTransform) => {
                startEvent.preventDefault();
                startEvent.stopPropagation();
                const pointerId = startEvent.pointerId;
                const original = layerTransformNow(entry);
                const captureTarget = startEvent.currentTarget;
                let moved = false;
                let cancelled = false;
                try { captureTarget.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                const cleanup = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onUp);
                    window.removeEventListener('keydown', onKeyDown, true);
                    if (captureTarget.hasPointerCapture && captureTarget.hasPointerCapture(pointerId)) {
                        captureTarget.releasePointerCapture(pointerId);
                    }
                    window.akari.interaction?.hideSnapGuides?.();
                };
                const onMove = moveEvent => {
                    if (moveEvent.pointerId !== pointerId) return;
                    const dx = moveEvent.clientX - startEvent.clientX;
                    const dy = moveEvent.clientY - startEvent.clientY;
                    if (!moved && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) moved = true;
                    if (!moved) return;
                    applyLayerTransformNow(entry, computeTransform(moveEvent, original));
                };
                const finish = async () => {
                    cleanup();
                    if (cancelled) {
                        applyLayerTransformNow(entry, original);
                        // ドラッグ終了時に最終値が必ず反映されるよう、次の RAF を待たず今すぐ描画する。
                        layerTransformVisualThrottle.flush();
                        return;
                    }
                    if (!moved) return;
                    layerTransformVisualThrottle.flush();
                    const finalTransform = layerTransformNow(entry);
                    try {
                        await window.akari.engine.layerWrite(entry.spec.id, { transform: finalTransform });
                    } catch (error) {
                        window.akari.showWriteError(error);
                        applyLayerTransformNow(entry, original);
                        layerTransformVisualThrottle.flush();
                    }
                };
                const onUp = upEvent => {
                    if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                    void finish();
                };
                const onKeyDown = keyEvent => {
                    if (keyEvent.key !== 'Escape') return;
                    cancelled = true;
                    void finish();
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
                window.addEventListener('keydown', onKeyDown, true);
            };
            const beginLayerMoveDrag = (entry, startEvent) => {
                const startPoint = window.akari.interaction?.stageLocalPoint?.(
                    startEvent.clientX,
                    startEvent.clientY
                );
                let dragSnap = { x: null, y: null };
                beginLayerTransformDrag(entry, startEvent, (moveEvent, original) => {
                    const nowPoint = window.akari.interaction?.stageLocalPoint?.(
                        moveEvent.clientX,
                        moveEvent.clientY
                    );
                    let nextX = original.x;
                    let nextY = original.y;
                    if (startPoint && nowPoint) {
                        nextX = original.x + (nowPoint.x - startPoint.x);
                        nextY = original.y + (nowPoint.y - startPoint.y);
                    } else {
                        const displayScale = (window.akari.stageScale() || 1) * zoom;
                        nextX = original.x + (moveEvent.clientX - startEvent.clientX) / displayScale;
                        nextY = original.y + (moveEvent.clientY - startEvent.clientY) / displayScale;
                    }
                    if (moveEvent.shiftKey || !window.akari.interaction) {
                        dragSnap = { x: null, y: null };
                        window.akari.interaction?.hideSnapGuides?.();
                    } else {
                        const bounds = layerOutputBoundsForTransform(entry, { ...original, x: nextX, y: nextY });
                        const snap = window.akari.interaction.computeSnapCorrection(bounds, dragSnap);
                        dragSnap = snap;
                        if (snap.x) nextX += snap.x.correction;
                        if (snap.y) nextY += snap.y.correction;
                        window.akari.interaction.showSnapGuides(snap.x, snap.y);
                    }
                    return { ...original, x: nextX, y: nextY };
                });
            };
            // 選択済みレイヤーは描画画素ではなく選択枠を操作面にする。枠が非表示の未選択時は
            // 従来どおり media 要素の clip-path / alpha hit test だけが選択を決める。
            layerSelectBox.addEventListener('pointerdown', event => {
                if (event.button !== 0 || event.target !== layerSelectBox || !selectedLayerId
                    || cropModeActive) return;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return;
                beginLayerMoveDrag(entry, event);
            });
            // cuts / layers / overlays / captions は同じ #preview-layers 内で z を競う。
            // 箱は pointer-events:none、実体だけ auto なので、共通祖先から委譲しつつ
            // 全面透明 mov のアルファ実測だけは elementsFromPoint で下へ素通しする。
            layersStage.addEventListener('pointerdown', event => {
                // ㉔ クロップモード中は移動/選択切り替えと操作が衝突しないよう、選択中レイヤーの
                // ボディドラッグを含め本編ステージの通常操作を止める（ハンドルは別要素なので
                // このガードの影響を受けない）。
                const target = event.target;
                const targetIsVisualMedia = target === video || target === stillImage
                    || Boolean(target?.dataset?.akariLayerId);
                // オーバーレイ / 字幕の実体をクリックした場合は各ランタイムの操作を優先する。
                if (event.button !== 0 || cropModeActive
                    || (!targetIsVisualMedia && target !== layersStage && target !== stage)) return;
                const hit = document.elementsFromPoint(event.clientX, event.clientY)
                    .find(candidate => {
                        if (candidate === video) return true;
                        // 静止画セグメント中は #preview-still が本編（cut）の当たり判定を担う
                        if (candidate === stillImage) return true;
                        if (!((candidate.tagName === 'VIDEO' || candidate.tagName === 'IMG') && candidate.dataset
                            && candidate.dataset.akariLayerId && candidate.style.display !== 'none')) return false;
                        // 全面サイズの透明動画（ベイクテロップ）は箱で当てると画面全部が当たりになる。
                        // クリック地点のアルファを実測し、透明部分は下（別レイヤー / 本編）へ素通し
                        const candidateEntry = findLayerEntry(candidate.dataset.akariLayerId);
                        return !candidateEntry || layerAlphaAtPoint(candidateEntry, event.clientX, event.clientY) > 16;
                    });
                if (!hit) return;
                if (hit === video || hit === stillImage) {
                    if (video.dataset.akariCutIndex === '' || video.dataset.akariCutIndex === undefined) return;
                    selectCut();
                    const startPoint = window.akari.interaction?.stageLocalPoint?.(event.clientX, event.clientY);
                    let dragSnap = { x: null, y: null };
                    beginCutTransformDrag(event, (moveEvent, original) => {
                        const nowPoint = window.akari.interaction?.stageLocalPoint?.(moveEvent.clientX, moveEvent.clientY);
                        const displayScale = (window.akari.stageScale() || 1) * zoom;
                        let nextX = original.x;
                        let nextY = original.y;
                        if (startPoint && nowPoint) {
                            nextX = original.x + (nowPoint.x - startPoint.x);
                            nextY = original.y + (nowPoint.y - startPoint.y);
                        } else {
                            nextX = original.x + (moveEvent.clientX - event.clientX) / displayScale;
                            nextY = original.y + (moveEvent.clientY - event.clientY) / displayScale;
                        }
                        if (moveEvent.shiftKey || !window.akari.interaction) {
                            dragSnap = { x: null, y: null };
                            window.akari.interaction?.hideSnapGuides?.();
                        } else {
                            const outputWidth = Number(summary.output && summary.output.width) || 1280;
                            const outputHeight = Number(summary.output && summary.output.height) || 720;
                            const bounds = outputBoundsForCenteredBox(
                                outputWidth / 2 + nextX, outputHeight / 2 + nextY,
                                outputWidth * original.scale, outputHeight * original.scale
                            );
                            const snap = window.akari.interaction.computeSnapCorrection(bounds, dragSnap);
                            dragSnap = snap;
                            if (snap.x) nextX += snap.x.correction;
                            if (snap.y) nextY += snap.y.correction;
                            window.akari.interaction.showSnapGuides(snap.x, snap.y);
                        }
                        return { ...original, x: nextX, y: nextY };
                    });
                    return;
                }
                const entry = findLayerEntry(hit.dataset.akariLayerId);
                if (!entry) return;
                selectLayer(entry.spec.id);
                // stageLocalPoint は親の frameScale と #zoom-layer の scale を実測して変換する。
                beginLayerMoveDrag(entry, event);
            });
            for (const handle of layerHandleElements) {
                handle.addEventListener('pointerdown', event => {
                    if (event.button !== 0 || !selectedLayerId || cropModeActive) return;
                    const entry = findLayerEntry(selectedLayerId);
                    if (!entry) return;
                    const kind = handle.getAttribute('data-akari-handle');
                    const boxRect = layerSelectBox.getBoundingClientRect();
                    const boxCenter = {
                        x: boxRect.left + boxRect.width / 2,
                        y: boxRect.top + boxRect.height / 2
                    };
                    // 枠はコンテンツにフィットしているが、拡縮・回転のピボットは transform モデルの
                    // 中心 = ビデオ中心のまま。箱中心からピボットオフセット（出力 px）を引き戻す
                    const pivotPerOutput = (window.akari.stageScale() || 1) * (typeof zoom === 'number' && zoom > 0 ? zoom : 1);
                    const pivotOffX = (Number(layerSelectBox.dataset.akariPivotOffX) || 0) * pivotPerOutput;
                    const pivotOffY = (Number(layerSelectBox.dataset.akariPivotOffY) || 0) * pivotPerOutput;
                    const center = {
                        x: boxRect.left + boxRect.width / 2 - pivotOffX,
                        y: boxRect.top + boxRect.height / 2 - pivotOffY
                    };
                    if (kind === 'rotate') {
                        const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180 / Math.PI;
                        beginLayerTransformDrag(entry, event, (moveEvent, original) => {
                            const angle = Math.atan2(moveEvent.clientY - center.y, moveEvent.clientX - center.x) * 180 / Math.PI;
                            return { ...original, rotate: original.rotate + (angle - startAngle) };
                        });
                    } else {
                        const oppositeKind = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[kind];
                        const boxZoom = typeof zoom === 'number' && zoom > 0 ? zoom : 1;
                        const boxWidth = (Number.parseFloat(layerSelectBox.style.width) || 0) * boxZoom;
                        const boxHeight = (Number.parseFloat(layerSelectBox.style.height) || 0) * boxZoom;
                        const rotate = layerTransformNow(entry).rotate;
                        const anchorClient = layerResizeCornerPointFn(
                            boxCenter.x, boxCenter.y, boxWidth, boxHeight, rotate, oppositeKind
                        );
                        const draggedClient = layerResizeCornerPointFn(
                            boxCenter.x, boxCenter.y, boxWidth, boxHeight, rotate, kind
                        );
                        const anchor = window.akari.interaction?.stageLocalPoint?.(anchorClient.x, anchorClient.y);
                        const dragged = window.akari.interaction?.stageLocalPoint?.(draggedClient.x, draggedClient.y);
                        if (!anchor || !dragged || !window.akari.interaction?.anchorPreservingTranslate) return;
                        const startDistance = Math.max(1, Math.hypot(dragged.x - anchor.x, dragged.y - anchor.y));
                        let dragSnap = { x: null, y: null };
                        beginLayerTransformDrag(entry, event, (moveEvent, original) => {
                            const point = window.akari.interaction.stageLocalPoint(moveEvent.clientX, moveEvent.clientY);
                            if (!point) return original;
                            const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
                            const factor = distance / startDistance;
                            let nextScale = Math.max(0.01, original.scale * factor);
                            if (moveEvent.shiftKey || !window.akari.interaction.computeAnchorResizeSnap) {
                                dragSnap = { x: null, y: null };
                                window.akari.interaction?.hideSnapGuides?.();
                            } else {
                                const solved = window.akari.interaction.computeAnchorResizeSnap({
                                    anchorStageX: anchor.x,
                                    anchorStageY: anchor.y,
                                    draggedStageX: dragged.x,
                                    draggedStageY: dragged.y,
                                    startScale: original.scale,
                                    scale: nextScale,
                                    snapX: dragSnap.x,
                                    snapY: dragSnap.y
                                });
                                if (!solved) return original;
                                nextScale = solved.scale;
                                dragSnap = { x: solved.snapX, y: solved.snapY };
                            }
                            const translated = window.akari.interaction.anchorPreservingTranslate({
                                startX: original.x,
                                startY: original.y,
                                startScale: original.scale,
                                scale: nextScale,
                                anchorStageX: anchor.x,
                                anchorStageY: anchor.y
                            });
                            return translated ? { ...original, ...translated, scale: nextScale } : original;
                        });
                    }
                });
            }
            // ㉔ クロップモードの 8 方向ハンドル（n/ne/e/se/s/sw/w/nw）。対辺（動かさない側）を
            // アンカーに固定し、ドラッグ中の点（ソースフレーム正規化座標）で動かした側の辺を
            // 更新する — CapCut 等の切り抜きハンドルと同型の挙動。確定(pointerup)時のみ
            // layerWrite({crop, transform}) で書き戻す（既存 transform ハンドルと同じ確定
            // タイミング）。
            // ㉗ 錨補正（2026-08-06 crop-handle-anchor-fix）: crop の中心が実際の配置基準点
            // （layerScreenRectForVideoRect 参照）なので、crop 変更だけを書き戻すと基準点自体が
            // 動いて絵全体がずれる。cropAnchorCorrectedTransformFn が「ドラッグした辺以外は画面上
            // 不動」になる transform.x/y を返し、crop と同一 patch で書く（ドラッグ中のライブ表示も
            // 同じ補正を適用 — 確定時だけだと commit 瞬間にジャンプする）。pointer→ソース座標の
            // マッピング（computeNext 内の layerVideoPointForPivot 呼び出し）はドラッグ開始時点の
            // startTransform を最後まで使い続ける（ライブ補正で変わる transform.x/y を混ぜない）ため、
            // この錨補正の追加はハンドル自体の追従性に影響しない。
            for (const handle of layerCropHandleElements) {
                handle.addEventListener('pointerdown', event => {
                    if (event.button !== 0 || !selectedLayerId || !cropModeActive) return;
                    const entry = findLayerEntry(selectedLayerId);
                    if (!entry || !(entry.video.videoWidth > 0)) return;
                    const dir = handle.getAttribute('data-akari-crop-handle');
                    const startTransform = layerTransformNow(entry);
                    const pivotPx = { x: entry.video.videoWidth / 2, y: entry.video.videoHeight / 2 };
                    const original = layerCropNow(entry);
                    const anchorRight = original.x + original.w;
                    const anchorBottom = original.y + original.h;
                    event.preventDefault();
                    event.stopPropagation();
                    const pointerId = event.pointerId;
                    const captureTarget = event.currentTarget;
                    let moved = false;
                    let cancelled = false;
                    try { captureTarget.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                    const cleanup = () => {
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                        window.removeEventListener('pointercancel', onUp);
                        window.removeEventListener('keydown', onKeyDown, true);
                        if (captureTarget.hasPointerCapture && captureTarget.hasPointerCapture(pointerId)) {
                            captureTarget.releasePointerCapture(pointerId);
                        }
                    };
                    const computeNext = moveEvent => {
                        const point = layerVideoPointForPivot(entry, startTransform, pivotPx, moveEvent.clientX, moveEvent.clientY);
                        if (!point) return original;
                        const fx = point.x / entry.video.videoWidth;
                        const fy = point.y / entry.video.videoHeight;
                        let nextX = original.x;
                        let nextY = original.y;
                        let nextRight = anchorRight;
                        let nextBottom = anchorBottom;
                        if (dir.indexOf('w') >= 0) nextX = Math.min(fx, anchorRight - CROP_MIN);
                        if (dir.indexOf('e') >= 0) nextRight = Math.max(fx, original.x + CROP_MIN);
                        if (dir.indexOf('n') >= 0) nextY = Math.min(fy, anchorBottom - CROP_MIN);
                        if (dir.indexOf('s') >= 0) nextBottom = Math.max(fy, original.y + CROP_MIN);
                        return clampCrop(nextX, nextY, nextRight - nextX, nextBottom - nextY);
                    };
                    // cropAnchorCorrectedTransformFn は x/y のみを返す（scale/rotate は補正で
                    // 動かさない）ため、書き戻し用の完全な transform には startTransform の
                    // scale/rotate を必ずマージする（欠けると dataset に "undefined" が書かれ
                    // NaN → 既定値 1/0 へフォールバックし、スケール/回転が消し飛ぶ）。
                    const correctedTransformFor = nextCrop => ({
                        ...startTransform,
                        ...cropAnchorCorrectedTransformFn(
                            original, nextCrop, startTransform, entry.video.videoWidth, entry.video.videoHeight
                        )
                    });
                    const onMove = moveEvent => {
                        if (moveEvent.pointerId !== pointerId) return;
                        moved = true;
                        const nextCrop = computeNext(moveEvent);
                        applyLayerCropAndTransformNow(entry, nextCrop, correctedTransformFor(nextCrop));
                    };
                    const finish = async () => {
                        cleanup();
                        if (cancelled) {
                            applyLayerCropAndTransformNow(entry, original, startTransform);
                            // ドラッグ終了時に最終値が必ず反映されるよう、次の RAF を待たず今すぐ描画する。
                            layerCropVisualThrottle.flush();
                            return;
                        }
                        if (!moved) return;
                        layerCropVisualThrottle.flush();
                        const finalCrop = layerCropNow(entry);
                        const finalTransform = layerTransformNow(entry);
                        try {
                            await window.akari.engine.layerWrite(entry.spec.id, { crop: finalCrop, transform: finalTransform });
                        } catch (error) {
                            window.akari.showWriteError(error);
                            applyLayerCropAndTransformNow(entry, original, startTransform);
                            layerCropVisualThrottle.flush();
                        }
                    };
                    const onUp = upEvent => {
                        if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                        void finish();
                    };
                    const onKeyDown = keyEvent => {
                        if (keyEvent.key !== 'Escape') return;
                        cancelled = true;
                        void finish();
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                    window.addEventListener('pointercancel', onUp);
                    window.addEventListener('keydown', onKeyDown, true);
                });
            }
            new ResizeObserver(() => updateLayerCropBox()).observe(wrapper);
            wrapper.addEventListener('click', event => {
                if (!selectedLayerId && !cutSelected) return;
                if (event.target.closest
                    && (event.target.closest('#layer-select-box') || event.target.closest('#cut-select-box')
                        || event.target.closest('#layer-crop-box') || event.target.closest('#layer-crop-toggle')
                        || event.target.closest('#layer-perspective-toggle') || event.target.closest('#layer-perspective-panel'))) {
                    return;
                }
                // 全面透明 mov の可視画素判定を含め、実際の z 順を elementsFromPoint で再確認する。
                const hitSelectable = document.elementsFromPoint(event.clientX, event.clientY)
                    .some(candidate => {
                        if (candidate === video) return true;
                        if (candidate === stillImage) return true;
                        if (!((candidate.tagName === 'VIDEO' || candidate.tagName === 'IMG') && candidate.dataset
                            && candidate.dataset.akariLayerId && candidate.style.display !== 'none')) return false;
                        const candidateEntry = findLayerEntry(candidate.dataset.akariLayerId);
                        return !candidateEntry || layerAlphaAtPoint(candidateEntry, event.clientX, event.clientY) > 16;
                    });
                if (hitSelectable) return;
                if (selectedLayerId) selectLayer(null);
                if (cutSelected) deselectCut();
            });
            new ResizeObserver(() => updateLayerSelectBox()).observe(wrapper);

            // ㉓ 本編ビデオ（#preview-video = 現在再生中のカット）のクリック選択 + transform。
            // layers[] と同型（4隅ハンドルで移動/拡縮・center-pivot scale・確定時のみ
            // cutWrite）。box の基準サイズは layers[] の natural media size ではなく
            // 出力フレーム（outputWidth/outputHeight）— #preview-video 自身が
            // updateStageScale() で frameRect サイズに敷かれ、その上へ cut transform の
            // translate/scale/rotate がそのままかかる実装（既存 transform 消費経路）と
            // 一致させるため。
            let cutSelected = false;
            const cutSelectBox = document.getElementById('cut-select-box');
            const cutHandleElements = Array.from(cutSelectBox.querySelectorAll('[data-akari-handle]'));
            const cutTransformNow = () => ({
                x: Number(video.dataset.akariTransformX) || 0,
                y: Number(video.dataset.akariTransformY) || 0,
                scale: Number(video.dataset.akariTransformScale) || 1,
                rotate: Number(video.dataset.akariTransformRotate) || 0
            });
            // RAF スロットリング（2026-08-09 raf-throttle）: layer 側と同じ規律。
            const cutTransformVisualThrottle = createRafThrottleFn(() => {
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                updateCutSelectBox();
            });
            const applyCutTransformNow = transform => {
                video.dataset.akariCutTransformActive = 'true';
                video.dataset.akariTransformX = String(transform.x);
                video.dataset.akariTransformY = String(transform.y);
                video.dataset.akariTransformScale = String(transform.scale);
                video.dataset.akariTransformRotate = String(transform.rotate);
                cutTransformVisualThrottle.call();
            };
            const updateCutSelectBox = () => {
                const hasCut = video.dataset.akariCutIndex !== '' && video.dataset.akariCutIndex !== undefined;
                // 静止画セグメント中は video が hidden のまま #preview-still が本編の見た目を
                // 担っているため、「本編が見えているか」は両方で判定する。
                const cutVisualHidden = video.style.visibility === 'hidden'
                    && stillImage.style.display === 'none';
                if (!cutSelected || !hasCut || cutVisualHidden) {
                    cutSelectBox.classList.remove('is-active');
                    return;
                }
                const frameRect = window.akari.computeOutputFrameRect();
                const frameScale = window.akari.stageScale() || 1;
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                const transform = cutTransformNow();
                const outputW = outputWidth * transform.scale;
                const outputH = outputHeight * transform.scale;
                const outputCenterX = outputWidth / 2 + transform.x;
                const outputCenterY = outputHeight / 2 + transform.y;
                const screenW = outputW * frameScale;
                const screenH = outputH * frameScale;
                const screenCenterX = frameRect.x + outputCenterX * frameScale;
                const screenCenterY = frameRect.y + outputCenterY * frameScale;
                cutSelectBox.style.left = (screenCenterX - screenW / 2) + 'px';
                cutSelectBox.style.top = (screenCenterY - screenH / 2) + 'px';
                cutSelectBox.style.width = screenW + 'px';
                cutSelectBox.style.height = screenH + 'px';
                cutSelectBox.style.transform = 'rotate(' + transform.rotate + 'deg)';
                cutSelectBox.classList.add('is-active');
            };
            const selectCut = options => {
                const report = !options || options.report !== false;
                if (cutSelected) {
                    updateCutSelectBox();
                    if (report) window.akari.reportCutSelection(video.dataset.akariCutId || null);
                    return;
                }
                cutSelected = true;
                selectLayer(null, { report: true });
                if (typeof deselectCaption === 'function') deselectCaption({ report: true });
                updateCutSelectBox();
                if (report) window.akari.reportCutSelection(video.dataset.akariCutId || null);
            };
            const deselectCut = options => {
                const report = !options || options.report !== false;
                if (!cutSelected) {
                    updateCutSelectBox();
                    return;
                }
                cutSelected = false;
                updateCutSelectBox();
                if (report) window.akari.reportCutSelection(null);
            };
            const beginCutTransformDrag = (startEvent, computeTransform) => {
                startEvent.preventDefault();
                startEvent.stopPropagation();
                const pointerId = startEvent.pointerId;
                const original = cutTransformNow();
                const captureTarget = startEvent.currentTarget;
                let moved = false;
                let cancelled = false;
                try { captureTarget.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                const cleanup = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onUp);
                    window.removeEventListener('keydown', onKeyDown, true);
                    if (captureTarget.hasPointerCapture && captureTarget.hasPointerCapture(pointerId)) {
                        captureTarget.releasePointerCapture(pointerId);
                    }
                    window.akari.interaction?.hideSnapGuides?.();
                };
                const onMove = moveEvent => {
                    if (moveEvent.pointerId !== pointerId) return;
                    const dx = moveEvent.clientX - startEvent.clientX;
                    const dy = moveEvent.clientY - startEvent.clientY;
                    if (!moved && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) moved = true;
                    if (!moved) return;
                    applyCutTransformNow(computeTransform(moveEvent, original));
                };
                const finish = async () => {
                    cleanup();
                    if (cancelled) {
                        applyCutTransformNow(original);
                        // ドラッグ終了時に最終値が必ず反映されるよう、次の RAF を待たず今すぐ描画する。
                        cutTransformVisualThrottle.flush();
                        return;
                    }
                    if (!moved) return;
                    cutTransformVisualThrottle.flush();
                    const cutIndex = Number(video.dataset.akariCutIndex);
                    if (!Number.isInteger(cutIndex) || cutIndex < 0) {
                        applyCutTransformNow(original);
                        cutTransformVisualThrottle.flush();
                        return;
                    }
                    const finalTransform = cutTransformNow();
                    try {
                        await window.akari.engine.cutWrite(
                            cutIndex,
                            video.dataset.akariCutId || undefined,
                            { transform: finalTransform }
                        );
                    } catch (error) {
                        window.akari.showWriteError(error);
                        applyCutTransformNow(original);
                        cutTransformVisualThrottle.flush();
                    }
                };
                const onUp = upEvent => {
                    if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                    void finish();
                };
                const onKeyDown = keyEvent => {
                    if (keyEvent.key !== 'Escape') return;
                    cancelled = true;
                    void finish();
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
                window.addEventListener('keydown', onKeyDown, true);
            };
            for (const handle of cutHandleElements) {
                handle.addEventListener('pointerdown', event => {
                    if (event.button !== 0 || !cutSelected) return;
                    const corner = handle.dataset.akariHandle;
                    if (!['nw', 'ne', 'se', 'sw'].includes(corner)) return;
                    const outputWidth = Number(summary.output && summary.output.width) || 1280;
                    const outputHeight = Number(summary.output && summary.output.height) || 720;
                    const startTransform = cutTransformNow();
                    const anchor = {
                        x: outputWidth / 2 + startTransform.x,
                        y: outputHeight / 2 + startTransform.y
                    };
                    // ハンドル装飾の client 矩形ではなく、出力幾何からドラッグ中の
                    // 角を固定する。これが computeAnchorResizeSnap の pointerdown 基準になる。
                    const dragged = {
                        x: anchor.x + (corner.includes('w') ? -1 : 1) * outputWidth * startTransform.scale / 2,
                        y: anchor.y + (corner.includes('n') ? -1 : 1) * outputHeight * startTransform.scale / 2
                    };
                    const boxRect = cutSelectBox.getBoundingClientRect();
                    const center = { x: boxRect.left + boxRect.width / 2, y: boxRect.top + boxRect.height / 2 };
                    const startDistance = Math.max(1, Math.hypot(event.clientX - center.x, event.clientY - center.y));
                    let dragSnap = { x: null, y: null };
                    beginCutTransformDrag(event, (moveEvent, original) => {
                        const distance = Math.hypot(moveEvent.clientX - center.x, moveEvent.clientY - center.y);
                        const factor = distance / startDistance;
                        let nextScale = Math.max(0.01, original.scale * factor);
                        if (moveEvent.shiftKey || !window.akari.interaction?.computeAnchorResizeSnap) {
                            dragSnap = { x: null, y: null };
                            window.akari.interaction?.hideSnapGuides?.();
                        } else {
                            const solved = window.akari.interaction.computeAnchorResizeSnap({
                                anchorStageX: anchor.x,
                                anchorStageY: anchor.y,
                                draggedStageX: dragged.x,
                                draggedStageY: dragged.y,
                                startScale: original.scale,
                                scale: nextScale,
                                snapX: dragSnap.x,
                                snapY: dragSnap.y
                            });
                            if (solved) {
                                nextScale = solved.scale;
                                dragSnap = { x: solved.snapX, y: solved.snapY };
                            }
                        }
                        return { ...original, scale: nextScale };
                    });
                });
            }
            new ResizeObserver(() => updateCutSelectBox()).observe(wrapper);

            // ㉓ 字幕クリック選択+移動（v0: 選択+位置移動の最小）。captions.json の zone は
            // 3x3 固定 enum（schemas/captions.schema.json、自由座標なし・schema 追加禁止）
            // のため、ドラッグ位置は最近傍 zone へ量子化し pointerup 確定時のみ
            // captionWrite で書き戻す（overlay/layer/cut と同じ「確定時のみ書き込み」規約）。
            // captionZoneVars() は akari-preview-captions.ts の zoneVars()（render-cut/src/
            // captions.mjs にも同型の複製が既にある——このファイル間ミラー方式が既存の
            // 設計判断）を webview 内 JS として最小限に複製したもの。
            // 制約: プレーン字幕（text_style 無し）は #caption-plate 自体が bottom-center に
            // ハードコードされ zone を無視する。zone を書き込むと次の captions.json リロード
            // （既存の handleFilesChanged → queueCaptionsUpdate 経路）で「styled」扱いに昇格し
            // 新位置に反映される——ドラッグ中のリアルタイム追従はスキーマの都合上できない
            // （#caption-select-box の概算矩形でドロップ先ゾーンだけ示す）。report に明記する。
            let selectedCaptionId = null;
            let selectedCaptionZone = 'bottom';
            const captionSelectBox = document.getElementById('caption-select-box');
            const ZONE_ROW_RANGES = { top: [0, 1 / 3], middle: [1 / 3, 2 / 3], bottom: [2 / 3, 1] };
            const ZONE_COL_RANGES = { left: [0, 1 / 3], center: [1 / 3, 2 / 3], right: [2 / 3, 1] };
            const zoneParts = zone => {
                if (!zone || zone === 'bottom') return { row: 'bottom', col: 'center' };
                if (zone === 'center') return { row: 'middle', col: 'center' };
                if (zone === 'top') return { row: 'top', col: 'center' };
                if (zone === 'left' || zone === 'right') return { row: 'middle', col: zone };
                const [row, col] = zone.split('-');
                return { row, col };
            };
            const zoneFromFraction = (fx, fy) => {
                const col = fx < 1 / 3 ? 'left' : fx < 2 / 3 ? 'center' : 'right';
                const row = fy < 1 / 3 ? 'top' : fy < 2 / 3 ? 'middle' : 'bottom';
                if (row === 'middle' && col === 'center') return 'center';
                if (row === 'middle') return col;
                if (col === 'center') return row;
                return row + '-' + col;
            };
            const updateCaptionSelectBoxForZone = zone => {
                if (!selectedCaptionId) {
                    captionSelectBox.classList.remove('is-active');
                    return;
                }
                const frameRect = window.akari.computeOutputFrameRect();
                const { row, col } = zoneParts(zone);
                const rowRange = ZONE_ROW_RANGES[row] || ZONE_ROW_RANGES.bottom;
                const colRange = ZONE_COL_RANGES[col] || ZONE_COL_RANGES.center;
                captionSelectBox.style.left = (frameRect.x + frameRect.width * colRange[0]) + 'px';
                captionSelectBox.style.top = (frameRect.y + frameRect.height * rowRange[0]) + 'px';
                captionSelectBox.style.width = (frameRect.width * (colRange[1] - colRange[0])) + 'px';
                captionSelectBox.style.height = (frameRect.height * (rowRange[1] - rowRange[0])) + 'px';
                captionSelectBox.classList.add('is-active');
            };
            const updateCaptionSelectBox = () => {
                if (!selectedCaptionId) {
                    captionSelectBox.classList.remove('is-active');
                    return;
                }
                const caption = captions.find(candidate => (candidate.sourceCueId || candidate.id) === selectedCaptionId);
                if (!caption) {
                    selectedCaptionId = null;
                    captionSelectBox.classList.remove('is-active');
                    return;
                }
                selectedCaptionZone = (caption.textStyle && caption.textStyle.zone) || 'bottom';
                updateCaptionSelectBoxForZone(selectedCaptionZone);
            };
            const selectCaption = (captionId, options) => {
                const report = !options || options.report !== false;
                if (captionId === selectedCaptionId) {
                    updateCaptionSelectBox();
                    if (report) window.akari.reportCaptionSelection(selectedCaptionId);
                    return;
                }
                selectedCaptionId = captionId;
                if (captionId) {
                    selectLayer(null, { report: true });
                    deselectCut({ report: true });
                }
                updateCaptionSelectBox();
                if (report) window.akari.reportCaptionSelection(selectedCaptionId);
            };
            const deselectCaption = options => selectCaption(null, options);
            const restoreCaptionEditAttribute = (element, name, value) => {
                if (value === null) element.removeAttribute(name);
                else element.setAttribute(name, value);
            };
            const restoreCaptionEditElement = edit => {
                restoreCaptionEditAttribute(edit.element, 'contenteditable', edit.contentEditable);
                restoreCaptionEditAttribute(edit.element, 'spellcheck', edit.spellcheck);
                restoreCaptionEditAttribute(edit.element, 'style', edit.style);
                edit.element.removeAttribute('data-akari-caption-editing');
                captionPlate.classList.remove('akari-caption-host--editing');
            };
            const rerenderCaptionAfterEdit = () => {
                activeCaption = null;
                renderCaption();
            };
            const cancelCaptionEdit = () => {
                if (!activeCaptionEdit) return;
                const edit = activeCaptionEdit;
                activeCaptionEdit = null;
                restoreCaptionEditElement(edit);
                rerenderCaptionAfterEdit();
            };
            const commitCaptionEdit = async () => {
                if (!activeCaptionEdit) return;
                const edit = activeCaptionEdit;
                const nextText = (edit.element.textContent || '').normalize('NFC').trim();
                activeCaptionEdit = null;
                restoreCaptionEditElement(edit);
                if (nextText === edit.originalText) {
                    rerenderCaptionAfterEdit();
                    return;
                }
                try {
                    await window.akari.engine.captionWrite(edit.captionId, { text: nextText });
                    if (nextText.trim().length === 0) {
                        captions = captions.filter(caption => (caption.sourceCueId || caption.id) !== edit.captionId);
                        if (selectedCaptionId === edit.captionId) deselectCaption();
                    } else {
                        for (const caption of captions) {
                            if ((caption.sourceCueId || caption.id) === edit.captionId) {
                                caption.text = nextText;
                                delete caption.words;
                            }
                        }
                    }
                } catch (error) {
                    console.warn('[akari-preview] caption text write rejected; reverting', error);
                    window.akari.showWriteError(error);
                }
                rerenderCaptionAfterEdit();
            };
            const placeCaptionCaretAtEnd = element => {
                const selection = window.getSelection();
                if (!selection) return;
                const range = document.createRange();
                range.selectNodeContents(element);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            };
            const beginCaptionEdit = caption => {
                const captionId = caption && (caption.sourceCueId || caption.id);
                if (!captionId) return;
                if (activeCaptionEdit) {
                    activeCaptionEdit.element.focus({ preventScroll: true });
                    return;
                }
                if (isPlaying) togglePlayback();
                selectCaption(captionId);
                const element = captionPlate.querySelector('.akari-caption__plate') || captionPlate;
                activeCaptionEdit = {
                    captionId,
                    originalText: caption.text || '',
                    element,
                    contentEditable: element.getAttribute('contenteditable'),
                    spellcheck: element.getAttribute('spellcheck'),
                    style: element.getAttribute('style')
                };
                element.setAttribute('contenteditable', 'true');
                element.setAttribute('spellcheck', 'false');
                element.setAttribute('data-akari-caption-editing', 'true');
                // styled 字幕の token/行ラッパーは編集開始時だけプレーンな本文へ畳み、
                // CSS やアニメーション断片を textContent に混入させない。
                element.textContent = caption.text || '';
                element.style.pointerEvents = 'auto';
                element.style.userSelect = 'text';
                captionPlate.classList.add('akari-caption-host--editing');
                element.focus({ preventScroll: true });
                placeCaptionCaretAtEnd(element);
            };
            captionPlate.addEventListener('dblclick', event => {
                const caption = window.AkariEditKernel.findActiveCaption(captions, outputTime);
                if (!caption || !(caption.sourceCueId || caption.id)) return;
                event.preventDefault();
                event.stopPropagation();
                beginCaptionEdit(caption);
            });
            captionPlate.addEventListener('blur', event => {
                if (activeCaptionEdit && event.target === activeCaptionEdit.element) {
                    void commitCaptionEdit();
                }
            }, true);
            captionPlate.addEventListener('keydown', event => {
                if (!activeCaptionEdit || event.target !== activeCaptionEdit.element || event.isComposing) return;
                if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    void commitCaptionEdit();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelCaptionEdit();
                }
            });
            captionPlate.addEventListener('pointerdown', event => {
                if (activeCaptionEdit) return;
                if (event.button !== 0) return;
                // 字幕ウィンドウ判定は共有カーネル（webview-kernel.js / caption-window.ts）
                const caption = window.AkariEditKernel.findActiveCaption(captions, outputTime);
                if (!caption || !caption.id) return;
                event.preventDefault();
                event.stopPropagation();
                selectCaption(caption.sourceCueId || caption.id);
                const pointerId = event.pointerId;
                const startClientX = event.clientX;
                const startClientY = event.clientY;
                const originalZone = selectedCaptionZone;
                let candidateZone = originalZone;
                let moved = false;
                try { captionPlate.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                const frameRect = window.akari.computeOutputFrameRect();
                const cleanup = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onCancel);
                    window.removeEventListener('keydown', onKeyDown, true);
                    if (captionPlate.hasPointerCapture && captionPlate.hasPointerCapture(pointerId)) {
                        captionPlate.releasePointerCapture(pointerId);
                    }
                };
                const onMove = moveEvent => {
                    if (moveEvent.pointerId !== pointerId) return;
                    const dx = moveEvent.clientX - startClientX;
                    const dy = moveEvent.clientY - startClientY;
                    if (!moved && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) moved = true;
                    if (!moved || !(frameRect.width > 0) || !(frameRect.height > 0)) return;
                    const fx = (moveEvent.clientX - frameRect.x) / frameRect.width;
                    const fy = (moveEvent.clientY - frameRect.y) / frameRect.height;
                    candidateZone = zoneFromFraction(fx, fy);
                    updateCaptionSelectBoxForZone(candidateZone);
                };
                const finish = async cancelled => {
                    cleanup();
                    if (cancelled || !moved || candidateZone === originalZone) {
                        updateCaptionSelectBox();
                        return;
                    }
                    try {
                        await window.akari.engine.captionWrite(caption.sourceCueId || caption.id, { zone: candidateZone });
                        selectedCaptionZone = candidateZone;
                    } catch (error) {
                        console.warn('[akari-preview] caption zone write rejected; reverting', error);
                    }
                    updateCaptionSelectBoxForZone(selectedCaptionZone);
                };
                const onUp = upEvent => {
                    if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                    void finish(false);
                };
                const onCancel = cancelEvent => {
                    if (cancelEvent.pointerId !== undefined && cancelEvent.pointerId !== pointerId) return;
                    void finish(true);
                };
                const onKeyDown = keyEvent => {
                    if (keyEvent.key !== 'Escape') return;
                    void finish(true);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onCancel);
                window.addEventListener('keydown', onKeyDown, true);
            });
            wrapper.addEventListener('click', event => {
                if (!selectedCaptionId) return;
                if (event.target.closest
                    && (event.target.closest('#caption-plate') || event.target.closest('#caption-select-box'))) {
                    return;
                }
                deselectCaption();
            });
            new ResizeObserver(() => updateCaptionSelectBox()).observe(wrapper);

            const applyTrackVisibility = track => {
                for (const container of stage.querySelectorAll('[data-akari-track]')) {
                    if (Number(container.getAttribute('data-akari-track')) === track) {
                        container.style.display = hiddenTracks.has(track) ? 'none' : '';
                    }
                }
            };
            const applyOverlayTracks = () => {
                for (const container of stage.querySelectorAll('[data-overlay-id]')) {
                    const id = container.getAttribute('data-overlay-id') || '';
                    const overlay = summary.overlays.find(candidate => String(candidate.id) === id);
                    const track = Number.isInteger(overlay?.track) && overlay.track >= 0 ? overlay.track : 0;
                    container.setAttribute('data-akari-track', String(track));
                    container.style.zIndex = String(zForTrack(overlay?.trackId));
                    container.style.display = hiddenTracks.has(track) ? 'none' : '';
                }
                captionPlate.style.zIndex = String(zForTrack(summary.captionTrackId));
            };
            // source↔output 写像の正本は packages/edit-store/src/timeline-map.ts。webview は
            // sandbox 制約で import できないため、共有カーネル webview-kernel.js（IIFE バンドル、
            // global: AkariEditKernel）をインライン注入して共有する（overlay-runtime と同経路）。
            // 旧インライン複製（rebuildKeepRanges / computeVideoRuns 等）は撤去済み。旧複製との
            // 意味論差: gaps/tracks モードの暗黙 at にもトランジション重なりが載る（書き込み側
            // computeCutTrackSegments と同じ = 正本挙動へ収斂）。
            const rebuildSegments = () => {
                preloadedTransitionWindowKey = null;
                delete transitionVideo.dataset.akariPreloadedWindow;
                delete transitionStill.dataset.akariPreloadedWindow;
                const rawCuts = Array.isArray(summary.cuts) ? summary.cuts : [];
                const timelineCuts = rawCuts.map(cut => ({ ...cut, track: cut.renderTrack }));
                // shell summary は item.declaration 由来なので通常は internal-model が合成した
                // 実重なりを既存窓として読む。handleRoom は webview-kernel を生 cuts で使う消費者にも
                // 静止画の無限 head/tail room を伝えるための経路で、両経路の等価性は edit-store の
                // transition-window-path-equivalence.test.mjs が固定する。
                const map = window.AkariEditKernel.buildTimelineMap(timelineCuts, {
                    trackZ: track => track,
                    fps,
                    handleRoom: cutIndex => imageSources[String(timelineCuts[cutIndex]?.src)]
                        ? { tailSeconds: Number.POSITIVE_INFINITY, headSeconds: Number.POSITIVE_INFINITY }
                        : undefined
                });
                if (map.segments.length > 0) {
                    // transform / opacity / crop / perspective / keyframes は再生時の見た目情報で
                    // 写像には関与しないため、共有カーネルの segment には無い。元 cuts から補う。
                    const decorateSegment = segment => {
                        if (segment.kind !== 'src' || !Number.isInteger(segment.cutIndex)) {
                            return segment;
                        }
                        const cut = rawCuts[segment.cutIndex];
                        return {
                            ...segment,
                            id: cut ? cut.id : undefined,
                            trackId: cut ? cut.trackId : undefined,
                            transform: cut ? cut.transform : undefined,
                            opacity: cut ? cut.opacity : undefined,
                            crop: cut ? cut.crop : undefined,
                            perspective: cut ? cut.perspective : undefined,
                            keyframes: cut ? cut.keyframes : undefined,
                            // ㉕ cuts[].framing / cuts[].freeze（contract-2026-08-02-preview-parity.md）:
                            // 同じ理由（写像には関与しない見た目/再生情報）で元 cuts から補う。
                            framing: cut ? cut.framing : undefined,
                            freeze: cut ? cut.freeze : undefined
                        };
                    };
                    segments = map.segments.map(decorateSegment);
                    transitionWindows = (map.transitionWindows || []).map(window => ({
                        ...window,
                        outgoing: decorateSegment(window.outgoing),
                        incoming: decorateSegment(window.incoming)
                    }));
                    totalTimelineDuration = map.totalDuration;
                } else {
                    // cuts 無し（または全て不正）: 全編を 1 セグメントとして扱う（従来挙動）
                    const duration = videoDuration();
                    segments = duration > 0
                        ? [{
                            kind: 'src', outStart: 0, outEnd: duration, cutIndex: null,
                            in: 0, out: duration, speed: 1, track: 0, transitionOut: null
                        }]
                        : [];
                    transitionWindows = [];
                    totalTimelineDuration = duration > 0 ? duration : 0;
                }
                const cutsEndSeconds = totalTimelineDuration;
                const contentDurationSeconds = computeContentDurationSeconds(cutsEndSeconds);
                if (contentDurationSeconds > cutsEndSeconds + 0.001) {
                    segments.push({ outStart: cutsEndSeconds, outEnd: contentDurationSeconds, kind: 'gap' });
                    totalTimelineDuration = contentDurationSeconds;
                }
                if (window.akari.previewAudio && totalTimelineDuration > 0) {
                    void window.akari.previewAudio.setTimelineDuration(totalTimelineDuration);
                }
                if (activeSegmentIndex >= segments.length) {
                    activeSegmentIndex = Math.max(0, segments.length - 1);
                }
                outputTime = clamp(outputTime, 0, totalTimelineDuration);
                syncSegmentPlaybackRate();
                preloadUpcomingTransition(outputTime);
            };
            const syncSegmentPlaybackRate = () => {
                const segment = segments[activeSegmentIndex];
                const speed = segment && segment.kind === 'src'
                    && Number.isFinite(segment.speed) && segment.speed > 0 ? segment.speed : 1;
                if (video.playbackRate !== speed) {
                    video.playbackRate = speed;
                    window.akari.reviewTransport({ type: 'rate', value: speed, timelineT: outputTime });
                }
            };
            // v1 マルチソース（edit.json sources[] + cuts[].src）。id → ストリーム URL の表を
            // ホストから受け取り、カットの継ぎ目でソースが変わるときだけ <video> を差し替える。
            // v0 / 単一ソースの案件は表が 1 件なので一度も差し替えが起きない。
            const videoSources = initial.videoSources || {};
            let currentVideoSourceId = null;
            for (const [id, url] of Object.entries(videoSources)) {
                if (url === video.getAttribute('src')) currentVideoSourceId = id;
            }
            // 差し替えたときだけ true を返す（呼び出し側は false なら即座に続行する）
            const applySegmentSource = (segment, onReady) => {
                const nextId = segment && segment.src;
                if (!nextId || nextId === currentVideoSourceId) return false;
                const nextUrl = videoSources[nextId];
                if (!nextUrl) return false;
                currentVideoSourceId = nextId;
                sourceSwapPending = true;
                video.addEventListener('loadedmetadata', () => {
                    try {
                        onReady();
                    } finally {
                        sourceSwapPending = false;
                        tick(true);
                    }
                }, { once: true });
                video.src = nextUrl;
                video.load();
                return true;
            };
            let currentTransitionVideoSourceId = null;
            const applyTransitionSegmentSource = (segment, onReady) => {
                const nextId = segment && segment.src;
                if (!nextId) return false;
                const nextUrl = videoSources[nextId];
                if (!nextUrl) return false;
                if (nextId === currentTransitionVideoSourceId
                    && transitionVideo.getAttribute('src') === nextUrl) return false;
                currentTransitionVideoSourceId = nextId;
                transitionVideo.addEventListener('loadedmetadata', onReady, { once: true });
                transitionVideo.src = nextUrl;
                transitionVideo.load();
                return true;
            };
            // 静止画 cut ソース（docs/contract-2026-08-12-still-image-cut-source-v0.md のシェル
            // 対応）。id → asset ストリーム URL の表にあるセグメントは <video> ではなく
            // #preview-still で表示し、クロックは gap セグメントと同じ壁時計
            // （gapWallClockOriginMs / gapOutputOrigin をそのまま共用）で進める。
            const imageSources = initial.imageSources || {};
            preloadUpcomingTransition = timelineTime => {
                const upcoming = transitionWindows.find(candidate => timelineTime < candidate.end);
                if (!upcoming) return;
                const key = upcoming.start + ':' + upcoming.end + ':' + upcoming.incoming.cutIndex;
                if (preloadedTransitionWindowKey === key) return;
                preloadedTransitionWindowKey = key;
                const upcomingStillUrl = stillUrlForSegment(upcoming.incoming);
                if (upcomingStillUrl) {
                    transitionStill.dataset.akariPreloadedWindow = key;
                    if (transitionStill.getAttribute('src') !== upcomingStillUrl) {
                        transitionStill.setAttribute('src', upcomingStillUrl);
                    }
                    transitionStill.style.display = 'none';
                    if (typeof transitionStill.decode === 'function') {
                        void transitionStill.decode().catch(() => undefined);
                    }
                    return;
                }
                transitionVideo.dataset.akariPreloadedWindow = key;
                const primeIncomingFrame = () => {
                    if (transitionVideo.readyState < HTMLMediaElement.HAVE_METADATA) return;
                    const speed = Number.isFinite(upcoming.incoming.speed) && upcoming.incoming.speed > 0
                        ? upcoming.incoming.speed : 1;
                    transitionVideo.playbackRate = speed;
                    if (outputTime < upcoming.start) {
                        const target = upcoming.incoming.in;
                        if (Math.abs((transitionVideo.currentTime || 0) - target) > 0.001) {
                            try { transitionVideo.currentTime = target; } catch (_error) { /* metadata pending */ }
                        }
                        transitionVideo.pause();
                    } else if (outputTime < upcoming.end) {
                        tick(true);
                    }
                };
                if (!applyTransitionSegmentSource(upcoming.incoming, primeIncomingFrame)) {
                    primeIncomingFrame();
                }
            };
            const stillUrlForSegment = segment => (segment && segment.kind === 'src'
                && segment.src !== undefined && imageSources[String(segment.src)]) || null;
            const isStillSegment = segment => Boolean(stillUrlForSegment(segment));
            const hideStillImage = () => { stillImage.style.display = 'none'; };
            const syncStillImageVisual = () => {
                if (stillImage.style.display === 'none') return;
                if (stillImage.dataset.akariCutLayerStyleActive === 'true'
                    && window.akari.applyCutLayerStyleLayout) {
                    window.akari.applyCutLayerStyleLayout(stillImage);
                    stillImage.style.opacity = video.style.opacity;
                    stillImage.style.zIndex = video.style.zIndex;
                    return;
                }
                // #preview-video のインラインスタイルを鏡写しにする。updateStageScale /
                // applyCutVisual / applyCutFramingVisual は video が hidden の間も video の
                // style を書き続けるので、静止画はそれを写すだけで配置・cut transform・
                // framing の既存レールに乗る。visibility だけは写さない（video 側は静止画
                // セグメント中つねに hidden のため）。
                stillImage.style.left = video.style.left;
                stillImage.style.top = video.style.top;
                stillImage.style.width = video.style.width;
                stillImage.style.height = video.style.height;
                stillImage.style.transform = video.style.transform;
                stillImage.style.transformOrigin = video.style.transformOrigin;
                stillImage.style.opacity = video.style.opacity;
                stillImage.style.zIndex = video.style.zIndex;
            };
            const showStillImage = url => {
                if (stillImage.getAttribute('src') !== url) stillImage.setAttribute('src', url);
                stillImage.style.display = 'block';
                syncStillImageVisual();
            };
            stillImage.addEventListener('load', () => {
                const segment = segments[activeSegmentIndex];
                if (segment && cutHasLayerStyleVisual(segment)) {
                    applyCutKeyframesToMedia(stillImage, segment, Math.max(0, outputTime - segment.outStart));
                }
                syncStillImageVisual();
            });
            const clampSourceTime = (sourceTime, preferredIndex) =>
                resolveSourceClockPositionFn(segments, sourceTime, preferredIndex);
            // segment.freeze / framing.keyframes[].t の座標系（カット内・速度適用後の再生秒）に
            // 合わせる。gap セグメントには意味がないため 0 を返す（呼び出し側はどのみち framing/freeze
            // が無いことを先にガードするが、defensive に安全な既定値を返しておく）。
            const playedCutLocalSeconds = segment => {
                if (!segment || segment.kind !== 'src') return 0;
                // 静止画セグメントは video.currentTime が動かないため、マスタークロック
                // outputTime から直接算出する（preview-server public/app.js の同名処理と同じ裁定）。
                if (isStillSegment(segment)) return Math.max(0, outputTime - segment.outStart);
                const speed = Number.isFinite(segment.speed) && segment.speed > 0 ? segment.speed : 1;
                return ((video.currentTime || 0) - segment.in) / speed;
            };
            // ㉕ cuts[].framing の毎フレーム反映。hostAdapterScript 側の updateStageScale が書く
            // cut.transform（PIP 位置決め）部分を dataset.akariBaseTransform 経由で受け取り、その
            // 手前（内側）に framing のズーム/クロップを合成する。framing 無しの既存プロジェクトは
            // baseTransform をそのまま書くだけなので見た目・回帰は無い。
            const captureCutTransitionBaseTransform = () => {
                video.dataset.akariTransitionBaseTransform = video.style.transform || '';
                stillImage.dataset.akariTransitionBaseTransform = stillImage.style.transform || '';
            };
            const applyCutFramingVisual = () => {
                const segment = segments[activeSegmentIndex];
                if (segment && cutHasLayerStyleVisual(segment)) {
                    // layer-style の crop pivot / perspective を書く同一レール。framing は従来の
                    // canvas-fit cut 専用レールなので、plain cut の既存分岐には触れない。
                    if (window.akari.applyCutLayerStyleLayout) window.akari.applyCutLayerStyleLayout(video);
                    syncStillImageVisual();
                    captureCutTransitionBaseTransform();
                    return;
                }
                const framing = segment && segment.kind === 'src' ? segment.framing : null;
                const visual = computeCutFramingVisualFn(framing, playedCutLocalSeconds(segment));
                const baseTransform = video.dataset.akariBaseTransform || '';
                if (visual) {
                    video.style.transformOrigin = visual.transformOrigin;
                    video.style.transform = (baseTransform ? baseTransform + ' ' : '') + visual.transform;
                } else {
                    video.style.transformOrigin = '';
                    video.style.transform = baseTransform;
                }
                // 静止画セグメント表示中は、ここで確定した video の最終スタイルを鏡写しにする
                //（updateStageScale 経由のリサイズと tick() の毎フレームの両方がここを通る）。
                syncStillImageVisual();
                captureCutTransitionBaseTransform();
            };
            window.akari.applyCutFramingVisual = applyCutFramingVisual;
            const enterSegment = index => {
                if (index < 0 || index >= segments.length) return;
                // ㉕ フリーズホールドはセグメント（カット）が変わったら破棄する（seek 含む
                // enterSegment 呼び出し全経路がここを通る）。古い holdSeconds タイマーが新しい
                // セグメントの tick() を誤って早期 return させるのを防ぐ。
                freezeHoldUntilMs = 0;
                freezeHoldConsumedForSegmentIndex = null;
                activeSegmentIndex = index;
                const segment = segments[index];
                if (segment.kind === 'gap') {
                    applyCutVisual(segment);
                    // video.pause() は既に一時停止中だと 'pause' イベントを発火しない
                    // （ブラウザ仕様）。その場合に pausedForGapEntry を立てると、次に来る
                    // 本物の 'pause' イベント（例えば別セグメントで実際に再生中だったものを
                    // 止めた時）がこの使い古しの flag を誤って消費してしまう。
                    if (!video.paused) {
                        pausedForGapEntry = true;
                        video.pause();
                    }
                    video.style.visibility = 'hidden';
                    hideStillImage();
                    gapWallClockOriginMs = performance.now();
                    gapOutputOrigin = outputTime;
                    return;
                }
                const stillUrl = stillUrlForSegment(segment);
                if (stillUrl) {
                    // 静止画セグメント: gap と同じ壁時計駆動。video は止めて隠し、
                    // #preview-still を出す（pausedForGapEntry の使い方も gap と同一）。
                    applyCutVisual(segment);
                    if (!video.paused) {
                        pausedForGapEntry = true;
                        video.pause();
                    }
                    video.style.visibility = 'hidden';
                    showStillImage(stillUrl);
                    gapWallClockOriginMs = performance.now();
                    gapOutputOrigin = outputTime;
                    return;
                }
                applyCutVisual(segment);
                hideStillImage();
                video.style.visibility = '';
                syncSegmentPlaybackRate();
                const segmentDuration = segment.outEnd - segment.outStart;
                const withinSegment = clamp(outputTime - segment.outStart, 0, segmentDuration);
                const target = segment.in + withinSegment * segment.speed;
                const seekAndResume = () => {
                    if (Math.abs((video.currentTime || 0) - target) > 0.0005) {
                        video.currentTime = target;
                    }
                    if (isPlaying && video.paused) {
                        void video.play().catch(error => console.error('[akari-preview] playback failed', error));
                    }
                };
                // v1 マルチソース: このカットが別ソースを指しているならストリームを差し替える。
                // 差し替え直後は readyState が 0 に戻り currentTime 代入が無視されるため、
                // loadedmetadata を待ってからシークする（単一ソースでは分岐しない）
                if (!applySegmentSource(segment, seekAndResume)) {
                    seekAndResume();
                }
            };
            const stopAtNaturalEnd = () => {
                if (!isPlaying) return;
                window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                isPlaying = false;
                freezeHoldUntilMs = 0;
                video.pause();
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
            };
            const applyKeepRangeBoundary = () => {
                const segment = segments[activeSegmentIndex];
                if (!segment || segment.kind !== 'src') return;
                const current = video.currentTime || 0;
                if (current >= segment.out - 0.0005) {
                    const nextIndex = activeSegmentIndex + 1;
                    if (nextIndex < segments.length) {
                        outputTime = segments[nextIndex].outStart;
                        enterSegment(nextIndex);
                    } else {
                        stopAtNaturalEnd();
                    }
                    return;
                }
                const result = clampSourceTime(current, activeSegmentIndex);
                activeSegmentIndex = result.index;
                syncSegmentPlaybackRate();
                if (result.ended) {
                    const nextIndex = activeSegmentIndex + 1;
                    if (nextIndex < segments.length) {
                        outputTime = segments[nextIndex].outStart;
                        enterSegment(nextIndex);
                    } else {
                        stopAtNaturalEnd();
                    }
                    return;
                }
                if (Math.abs(current - result.time) > 0.0005) {
                    video.currentTime = result.time;
                }
            };
            const timelineToSource = timelineValue => {
                if (segments.length === 0) return { index: 0, kind: 'src', time: timelineValue };
                let index = segments.length - 1;
                for (let candidate = 0; candidate < segments.length; candidate += 1) {
                    if (timelineValue < segments[candidate].outEnd || candidate === segments.length - 1) {
                        index = candidate;
                        break;
                    }
                }
                const segment = segments[index];
                if (segment.kind === 'gap') return { index, kind: 'gap' };
                const segmentDuration = segment.outEnd - segment.outStart;
                const withinSegment = clamp(timelineValue - segment.outStart, 0, segmentDuration);
                return { index, kind: 'src', time: segment.in + withinSegment * segment.speed };
            };
            const seekTimelineTime = timelineValue => {
                const previousOutputTime = outputTime;
                // 総尺ちょうどへシーク（末尾延長ギャップが最終セグメントの場合を含む）すると、
                // 直後の tick() が「境界に到達済み」と即判定して stopAtNaturalEnd() を出し、
                // 再生ボタンを押しても 1 フレームも進まず固まって見えるバグ⑬⑭の根本原因。
                // 末尾に数フレーム分の再生余地を残すようクランプすることで、再生開始が必ず
                // 観測可能な進行を1回は生む（自然再生が末尾へ到達して止まる経路 = tick() 内の
                // 別クランプは無改造のため、そちらの停止挙動は従来通り）。
                const seekableDuration = totalTimelineDuration || videoDuration();
                const endSafetyMargin = Math.min(2 / fps, seekableDuration);
                const seekableMax = Math.max(0, seekableDuration - endSafetyMargin);
                outputTime = clamp(Math.max(0, timelineValue), 0, seekableMax);
                window.akari.reviewTransport({ type: 'seek', from: previousOutputTime, to: outputTime });
                const mapped = timelineToSource(outputTime);
                enterSegment(mapped.index);
                if (mapped.kind === 'src' && !isStillSegment(segments[mapped.index])) {
                    video.currentTime = mapped.time;
                } else if (isPlaying && window.akari.previewAudio) {
                    // gap と静止画: video のシークは発生しないため音声はここで追従させる
                    void window.akari.previewAudio.playFrom(outputTime);
                }
            };
            const applyInitialPosition = () => {
                // segments is only trustworthy once rebuildSegments() has run against a real
                // video.duration (i.e. after 'loadedmetadata'). The overlay-mount Promise.all
                // below can resolve *before* 'loadedmetadata' (fast for an empty/no-cuts
                // summary), which used to rebuild an empty fallback segment list, let this
                // function mark itself done against that empty list, and skip enterSegment(0)
                // forever -- leaving #preview-video's visibility stuck at 'hidden' (set by the
                // next tick()'s applyCutsMuteState(), which hides whenever there is no active
                // segment) until the user presses play. Bail out without setting the flag so the
                // *next* call (once segments is real) can still do the real work.
                if (initialPositionApplied || segments.length === 0) return;
                initialPositionApplied = true;
                if (Number.isFinite(initial.initialSeekTime)) {
                    seekTimelineTime(initial.initialSeekTime);
                } else {
                    outputTime = segments[0].outStart;
                    enterSegment(0);
                }
            };
            const zoomToSlider = value => {
                const logMin = Math.log2(ZOOM_MIN);
                const logMax = Math.log2(ZOOM_MAX);
                return (Math.log2(clamp(value, ZOOM_MIN, ZOOM_MAX)) - logMin) / (logMax - logMin);
            };
            const sliderToZoom = value => {
                const logMin = Math.log2(ZOOM_MIN);
                const logMax = Math.log2(ZOOM_MAX);
                const sliderValue = clamp(value, 0, 1);
                if (Math.abs(sliderValue - zoomToSlider(1)) <= SNAP_TOLERANCE) return 1;
                return Math.pow(2, logMin + (logMax - logMin) * sliderValue);
            };
            const panLimits = () => ({
                x: Math.max(0, (previewStage.offsetWidth * zoom - previewPane.clientWidth) / 2),
                y: Math.max(0, (previewStage.offsetHeight * zoom - previewPane.clientHeight) / 2)
            });
            const clampPan = value => {
                const limits = panLimits();
                return {
                    x: clamp(value.x, -limits.x, limits.x),
                    y: clamp(value.y, -limits.y, limits.y)
                };
            };
            const renderZoom = () => {
                zoomLayer.style.transform = 'translate(' + pan.x.toFixed(3) + 'px, '
                    + pan.y.toFixed(3) + 'px) scale(' + zoom + ')';
                zoomValue.textContent = Math.round(zoom * 100) + '%';
                zoomSlider.value = String(zoomToSlider(zoom));
                const isZoomed = zoom > 1.05;
                previewPane.classList.toggle('is-draggable', isZoomed);
                if (!isZoomed) previewPane.classList.remove('is-dragging');
                zoomMinimap.hidden = !isZoomed;
                if (!isZoomed) return;
                const width = Number(summary.output && summary.output.width) || 1280;
                const height = Number(summary.output && summary.output.height) || 720;
                const aspectRatio = width / height;
                zoomMinimap.style.width = (aspectRatio >= 1 ? 64 : 64 * aspectRatio) + 'px';
                zoomMinimap.style.height = (aspectRatio >= 1 ? 64 / aspectRatio : 64) + 'px';
                const scaledStageWidth = previewStage.offsetWidth * zoom;
                const scaledStageHeight = previewStage.offsetHeight * zoom;
                if (!(scaledStageWidth > 0) || !(scaledStageHeight > 0)) return;
                const stageLeft = (previewPane.clientWidth - scaledStageWidth) / 2 + pan.x;
                const stageTop = (previewPane.clientHeight - scaledStageHeight) / 2 + pan.y;
                const left = clamp(-stageLeft / scaledStageWidth, 0, 1);
                const top = clamp(-stageTop / scaledStageHeight, 0, 1);
                const right = clamp((previewPane.clientWidth - stageLeft) / scaledStageWidth, 0, 1);
                const bottom = clamp((previewPane.clientHeight - stageTop) / scaledStageHeight, 0, 1);
                zoomMinimapViewport.style.left = (left * 100) + '%';
                zoomMinimapViewport.style.top = (top * 100) + '%';
                zoomMinimapViewport.style.width = ((right - left) * 100) + '%';
                zoomMinimapViewport.style.height = ((bottom - top) * 100) + '%';
            };
            const setZoom = value => {
                zoom = clamp(value, ZOOM_MIN, ZOOM_MAX);
                if (zoom <= 1.05) {
                    pan = { x: 0, y: 0 };
                } else {
                    pan = clampPan(pan);
                }
                renderZoom();
            };
            new ResizeObserver(() => setZoom(zoom)).observe(previewPane);

            const formatTime = value => {
                const seconds = Number.isFinite(value) ? Math.max(0, value) : 0;
                const minutes = Math.floor(seconds / 60);
                return minutes + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
            };
            const updateTransport = () => {
                const timelineDuration = segments.length > 0 ? totalTimelineDuration : videoDuration();
                const timelinePosition = segments.length > 0 ? outputTime : (video.currentTime || 0);
                seek.max = String(timelineDuration);
                seek.value = String(clamp(timelinePosition, 0, timelineDuration));
                timeLabel.textContent = formatTime(timelinePosition) + ' / ' + formatTime(timelineDuration);
                penToggle.disabled = !reviewRecordingActive || isPlaying;
                if (playToggleRenderedIsPlaying !== isPlaying) {
                    playToggleRenderedIsPlaying = isPlaying;
                    const label = isPlaying ? '一時停止' : '再生';
                    playToggle.innerHTML = isPlaying ? pauseIcon : playIcon;
                    playToggle.setAttribute('aria-label', label);
                    playToggle.title = label;
                }
            };
            const waveformBinCount = () => {
                const raw = Math.max(96, Math.min(1024, Math.ceil(waveformRow.clientWidth / 2)));
                return Math.max(96, Math.round(raw / 8) * 8);
            };
            const aggregateWaveform = widthBins => {
                if (!waveformAudioBuffer || widthBins <= 0) return null;
                const total = waveformAudioBuffer.length;
                const samplesPerBin = total / widthBins;
                const peaks = new Float32Array(widthBins);
                const rms = new Float32Array(widthBins);
                const channel = waveformAudioBuffer.getChannelData(0);
                let globalMax = 0;
                let rmsMax = 0;
                for (let bin = 0; bin < widthBins; bin += 1) {
                    const start = Math.floor(bin * samplesPerBin);
                    const end = Math.min(total, Math.floor((bin + 1) * samplesPerBin));
                    let peak = 0;
                    let sumSquares = 0;
                    let count = 0;
                    for (let index = start; index < end; index += 1) {
                        const value = Math.abs(channel[index]);
                        if (value > peak) peak = value;
                        sumSquares += value * value;
                        count += 1;
                    }
                    const rootMeanSquare = count > 0 ? Math.sqrt(sumSquares / count) : 0;
                    peaks[bin] = peak;
                    rms[bin] = rootMeanSquare;
                    if (peak > globalMax) globalMax = peak;
                    if (rootMeanSquare > rmsMax) rmsMax = rootMeanSquare;
                }
                return { peaks, rms, globalMax, rmsMax };
            };
            const prepareWaveformCanvas = () => {
                const dpr = Math.min(2, window.devicePixelRatio || 1);
                const width = Math.max(1, Math.floor(waveformRow.clientWidth));
                const height = Math.max(1, Math.floor(waveformRow.clientHeight));
                waveformCanvas.width = Math.floor(width * dpr);
                waveformCanvas.height = Math.floor(height * dpr);
                waveformCanvas.style.width = width + 'px';
                waveformCanvas.style.height = height + 'px';
                const context = waveformCanvas.getContext('2d');
                if (!context) return null;
                context.setTransform(dpr, 0, 0, dpr, 0, 0);
                context.fillStyle = '#181818';
                context.fillRect(0, 0, width, height);
                context.fillStyle = 'rgba(255,255,255,0.06)';
                context.fillRect(0, height / 2 - 0.5, width, 1);
                return { context, width, height };
            };
            const drawWaveformMessage = message => {
                const drawing = prepareWaveformCanvas();
                if (!drawing) return;
                drawing.context.fillStyle = '#999';
                drawing.context.font = '12px system-ui, sans-serif';
                drawing.context.textAlign = 'center';
                drawing.context.textBaseline = 'middle';
                drawing.context.fillText(message, drawing.width / 2, drawing.height / 2);
            };
            const drawWaveform = () => {
                if (waveformState === 'loading') {
                    drawWaveformMessage('波形を生成中…');
                    return;
                }
                if (waveformState === 'error') {
                    drawWaveformMessage('この動画の波形は生成できません');
                    return;
                }
                const drawing = prepareWaveformCanvas();
                if (!drawing || !waveformPeaks) return;
                const { context, width, height } = drawing;
                const maximum = Math.max(0.012, waveformPeaks.rmsMax * 1.08);
                const barWidth = Math.max(1, width / Math.max(1, waveformPeaks.rms.length));
                for (let index = 0; index < waveformPeaks.rms.length; index += 1) {
                    const normalized = Math.min(1, waveformPeaks.rms[index] / maximum);
                    const compressed = Math.pow(normalized, 0.62);
                    const barHeight = Math.max(1, compressed * (height - 10));
                    const x0 = Math.floor(index * barWidth);
                    const x1 = Math.max(x0 + 1, Math.ceil((index + 1) * barWidth) - 1);
                    context.fillStyle = waveformPeaks.peaks[index] >= 0.92 ? '#f97316' : '#22d3ee';
                    context.fillRect(x0, height / 2 - barHeight / 2, x1 - x0, barHeight);
                }
            };
            const waitForWaveformMetadata = () => {
                // 代表ソースが静止画のときは <video> に src が無く loadedmetadata が永遠に
                // 来ない。即座に進めて decode 失敗 → 通常のエラー描画（波形なし）に落とす。
                if (initial.primaryIsStillImage) return Promise.resolve();
                if (video.readyState >= 1) return Promise.resolve();
                return new Promise((resolve, reject) => {
                    const cleanup = () => {
                        video.removeEventListener('loadedmetadata', onLoaded);
                        video.removeEventListener('error', onError);
                    };
                    const onLoaded = () => {
                        cleanup();
                        resolve();
                    };
                    const onError = () => {
                        cleanup();
                        reject(new Error('video metadata unavailable'));
                    };
                    video.addEventListener('loadedmetadata', onLoaded);
                    video.addEventListener('error', onError);
                });
            };
            const loadWaveform = async () => {
                if (waveformState !== 'idle') return;
                waveformState = 'loading';
                drawWaveform();
                let context = null;
                try {
                    await waitForWaveformMetadata();
                    const bytes = await window.akari.engine.readWaveformBytes();
                    context = new AudioContext();
                    waveformAudioBuffer = await context.decodeAudioData(bytes.slice(0));
                    await context.close().catch(() => undefined);
                    context = null;
                    waveformPeaks = aggregateWaveform(waveformBinCount());
                    if (!waveformPeaks) throw new Error('waveform contains no audio samples');
                    waveformState = 'ready';
                    drawWaveform();
                } catch (error) {
                    if (context) await context.close().catch(() => undefined);
                    waveformAudioBuffer = null;
                    waveformPeaks = null;
                    waveformState = 'error';
                    drawWaveform();
                    console.error('[akari-preview] waveform generation failed', error);
                }
            };
            const updateWaveformPlayhead = () => {
                const duration = segments.length > 0 ? totalTimelineDuration
                    : Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
                const position = duration > 0
                    ? clamp((segments.length > 0 ? outputTime : (video.currentTime || 0)) / duration, 0, 1) : 0;
                waveformPlayhead.style.left = (position * 100) + '%';
            };
            const escapeCaptionHtml = value => String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            const formatCaptionSeconds = value => String(Math.round(value * 1000) / 1000);
            const groupWordsIntoLines = (words, maximum = 13) => {
                const lines = [];
                let current = [];
                let currentLength = 0;
                for (const word of words) {
                    const wordLength = Array.from(word.text).length;
                    if (current.length > 0 && currentLength + wordLength > maximum) {
                        lines.push(current);
                        current = [];
                        currentLength = 0;
                    }
                    current.push(word);
                    currentLength += wordLength;
                }
                if (current.length > 0) lines.push(current);
                return lines;
            };
            // --- render-cut とのパリティ層（正本: packages/render-cut/src/captions.mjs）---
            // 縦長出力の既定: 行 10 字・文字は出力幅 6%・複数行の無指定字幕は行単位の順送り（reveal）。
            // webview はサンドボックスで import できないため、意図的なコード重複（app.js と同じ判断）。
            const captionOutput = (initial.summary && initial.summary.output) || {};
            const captionPortrait = Number(captionOutput.height) > Number(captionOutput.width);
            const captionLineBudget = captionPortrait ? 10 : 20;
            const captionDefaultFontSize = captionPortrait
                ? Math.round(Number(captionOutput.width) * 0.06) : 38;
            const CAPTION_BOUNDARIES = ['から', 'まで', 'ので', 'のに', 'けど', 'て', 'で', 'は', 'が', 'を', 'に', 'へ', 'と', 'も', 'の'];
            const findLastSpaceBoundary = (characters, maximum) => {
                for (let index = maximum - 1; index > 0; index -= 1) {
                    if (characters[index] === ' ' || characters[index] === '\u3000') return index + 1;
                }
                return null;
            };
            const findLastPhraseBoundary = (characters, maximum) => {
                const prefix = characters.slice(0, maximum).join('');
                let best = null;
                for (const boundary of CAPTION_BOUNDARIES) {
                    const index = prefix.lastIndexOf(boundary);
                    if (index >= 0) {
                        const candidate = Array.from(prefix.slice(0, index + boundary.length)).length;
                        if (candidate > 0 && (best === null || candidate > best)) best = candidate;
                    }
                }
                return best;
            };
            const splitAtNaturalBoundaries = (value, maximum) => {
                const lines = [];
                let remaining = Array.from(value);
                while (remaining.length > maximum) {
                    const spaceBoundary = findLastSpaceBoundary(remaining, maximum);
                    const phraseBoundary = spaceBoundary !== null ? spaceBoundary : findLastPhraseBoundary(remaining, maximum);
                    const boundary = phraseBoundary !== null ? phraseBoundary : maximum;
                    lines.push(remaining.slice(0, boundary).join(''));
                    remaining = remaining.slice(boundary);
                }
                if (remaining.length > 0) lines.push(remaining.join(''));
                return lines;
            };
            const splitAfterPunctuation = value => {
                const characters = Array.from(value);
                const segments = [];
                let start = 0;
                for (let index = 0; index < characters.length; index += 1) {
                    if ((characters[index] === '、' || characters[index] === '。') && index + 1 < characters.length) {
                        segments.push(characters.slice(start, index + 1).join(''));
                        start = index + 1;
                    }
                }
                segments.push(characters.slice(start).join(''));
                return segments;
            };
            const splitCaptionLines = (text, maximum) => {
                const limit = Number.isFinite(maximum) && maximum > 0 ? Math.floor(maximum) : 20;
                const lines = [];
                for (const value of String(text).split(/\\r?\\n/u)) {
                    if (value.length === 0) { lines.push(''); continue; }
                    for (const segment of splitAfterPunctuation(value)) {
                        lines.push(...splitAtNaturalBoundaries(segment, limit));
                    }
                }
                return lines;
            };
            // splitCaptionLines の分割点を word 境界へスナップして words を行へ配る
            const groupWordsIntoDisplayLines = (words, maximum) => {
                if (words.length === 0) return [];
                const text = words.map(word => word.text).join('');
                const desiredBoundaries = [];
                let desiredOffset = 0;
                for (const line of splitCaptionLines(text, maximum).slice(0, -1)) {
                    desiredOffset += Array.from(line).length;
                    desiredBoundaries.push(desiredOffset);
                }
                const ranges = [];
                let offset = 0;
                for (const word of words) {
                    const start = offset;
                    offset += Array.from(word.text).length;
                    ranges.push({ word, start, end: offset });
                }
                const boundaries = [];
                let previous = 0;
                for (const desired of desiredBoundaries) {
                    const containing = ranges.find(range => range.start < desired && desired < range.end);
                    let snapped = desired;
                    if (containing) {
                        const candidates = [containing.start, containing.end]
                            .filter(candidate => candidate > previous && candidate < offset);
                        const withinTolerance = candidates.filter(candidate => candidate - previous <= maximum + 2);
                        const eligible = withinTolerance.length > 0 ? withinTolerance : candidates;
                        if (eligible.length === 0) continue;
                        snapped = eligible.reduce((best, candidate) =>
                            Math.abs(candidate - desired) < Math.abs(best - desired) ? candidate : best);
                    }
                    if (snapped > previous && snapped < offset) { boundaries.push(snapped); previous = snapped; }
                }
                const lines = [];
                let start = 0;
                for (const end of [...boundaries, offset]) {
                    const line = ranges.filter(range => range.end > start && range.start < end).map(range => range.word);
                    if (line.length > 0) lines.push(line);
                    start = end;
                }
                return lines;
            };
            const renderRevealGroupsMarkup = (lines, rangeStart, rangeEnd, renderLine) => {
                const groups = [];
                for (const line of lines) {
                    const start = line.length > 0 ? line[0].start : rangeStart;
                    const previous = groups[groups.length - 1];
                    if (previous && previous.start === start) previous.lines.push(line);
                    else groups.push({ start, lines: [line] });
                }
                return groups.map((group, index) => {
                    const nextStart = index + 1 < groups.length ? groups[index + 1].start : rangeEnd;
                    const delay = Math.max(0, group.start - rangeStart);
                    const duration = Math.max(0.01, nextStart - group.start);
                    const lineMarkup = group.lines
                        .map(line => '<p class="akari-caption__line">' + renderLine(line) + '</p>')
                        .join('');
                    return '<div class="akari-caption__reveal-group" style="--akari-reveal-delay: '
                        + formatCaptionSeconds(delay) + 's; --akari-reveal-dur: '
                        + formatCaptionSeconds(duration) + 's">' + lineMarkup + '</div>';
                }).join('');
            };
            const findMatchingEmphasis = word => emphasisWords.find(emphasis =>
                emphasis.t_end > word.start
                && emphasis.t_start < word.end
                && (word.text === emphasis.word || emphasis.word.includes(word.text))
            );
            const resolveEmphasisStyle = emphasis => {
                if (emphasis.style_hint === 'one-char-bang'
                    || emphasis.style_hint === 'size-pulse'
                    || emphasis.style_hint === 'color-accent') return emphasis.style_hint;
                if (emphasis.style_hint !== undefined) return 'color-accent';
                if (emphasis.emotion === 'pain' || emphasis.emotion === 'surprise'
                    || emphasis.emotion === 'anger') return 'one-char-bang';
                if (emphasis.emotion === 'joy' || emphasis.emotion === 'emphasis') return 'size-pulse';
                return 'color-accent';
            };
            const emphasisColorName = emotion =>
                ['joy', 'pain', 'surprise', 'anger', 'sadness', 'emphasis'].includes(emotion)
                    ? emotion : 'emphasis';
            const renderEmphasisCaptionToken = (word, rangeStart, emphasis) => {
                const style = resolveEmphasisStyle(emphasis);
                const overlapStart = Math.max(word.start, emphasis.t_start);
                const overlapEnd = Math.min(word.end, emphasis.t_end);
                const delay = Math.max(0, overlapStart - rangeStart);
                const duration = Math.max(0.01, overlapEnd - overlapStart);
                const baseClass = 'akari-caption__tok akari-caption__tok--emphasis akari-caption__tok--' + style;
                if (style === 'one-char-bang') {
                    const characters = Array.from(word.text);
                    const characterDuration = duration / characters.length;
                    const markup = characters.map((character, index) =>
                        '<span class="akari-caption__emphasis-char" style="--akari-emphasis-delay: '
                        + formatCaptionSeconds(delay + characterDuration * index)
                        + 's; --akari-emphasis-dur: '
                        + formatCaptionSeconds(Math.max(0.01, characterDuration)) + 's">'
                        + escapeCaptionHtml(character) + '</span>'
                    ).join('');
                    return '<span class="' + baseClass + '" data-emphasis-id="' + emphasis.id + '">'
                        + markup + '</span>';
                }
                if (style === 'size-pulse') {
                    return '<span class="' + baseClass + '" data-emphasis-id="' + emphasis.id
                        + '" style="--akari-emphasis-delay: ' + formatCaptionSeconds(delay)
                        + 's; --akari-emphasis-dur: ' + formatCaptionSeconds(duration) + 's">'
                        + escapeCaptionHtml(word.text) + '</span>';
                }
                return '<span class="' + baseClass + '" data-emphasis-id="' + emphasis.id
                    + '" style="color: var(--akari-emphasis-' + emphasisColorName(emphasis.emotion) + ')">'
                    + escapeCaptionHtml(word.text) + '</span>';
            };
            const renderCaptionToken = (word, rangeStart, style) => {
                if (style === 'reveal-word') {
                    const delay = formatCaptionSeconds(Math.max(0, word.start - rangeStart));
                    return '<span class="akari-caption__tok akari-caption__tok--reveal-word"'
                        + ' style="--akari-tok-delay: ' + delay + 's">'
                        + escapeCaptionHtml(word.text) + '</span>';
                }
                const emphasis = findMatchingEmphasis(word);
                // 語レベル演出は caption の karaoke/pop より該当 token だけ優先する。
                if (emphasis) return renderEmphasisCaptionToken(word, rangeStart, emphasis);
                const delay = formatCaptionSeconds(Math.max(0, word.start - rangeStart));
                const className = style === 'karaoke'
                    ? 'akari-caption__tok akari-caption__tok--karaoke'
                    : style === 'pop'
                        ? 'akari-caption__tok akari-caption__tok--pop'
                        : 'akari-caption__tok';
                const vars = style === 'karaoke'
                    ? '--akari-tok-delay: ' + delay + 's; --akari-tok-dur: '
                        + formatCaptionSeconds(Math.max(0.01, word.end - word.start)) + 's'
                    : style === 'pop' ? '--akari-tok-delay: ' + delay + 's' : '';
                return '<span class="' + className + '" style="' + vars + '">'
                    + escapeCaptionHtml(word.text) + '</span>';
            };
            const renderStyledCaptionFragment = caption => {
                const style = caption.style;
                const textStyleActive = Boolean(caption.textStyle
                    && Object.keys(caption.textStyle).length > 0);
                const hasEmphasis = caption.words.some(word => findMatchingEmphasis(word));
                // reveal（行単位の順送り）: 明示指定に加え、縦長では複数行に折り返す無指定字幕を
                // 自動昇格させる（render-cut generateCaptionOverlays と同じ既定）。
                const reveal = style === 'reveal'
                    || (!style && captionPortrait
                        && splitCaptionLines(caption.text || '', captionLineBudget).length > 1);
                const rootStyle = reveal ? 'reveal' : (style || (hasEmphasis ? 'emphasis' : 'karaoke'));
                const renderLine = line =>
                    line.map(word => renderCaptionToken(word, caption.start, reveal ? null : style)).join('');
                const markup = reveal
                    ? renderRevealGroupsMarkup(
                        groupWordsIntoDisplayLines(caption.words, captionLineBudget),
                        caption.start, caption.end, renderLine)
                    : groupWordsIntoLines(caption.words, captionLineBudget).map(line =>
                        '<p class="akari-caption__line">' + renderLine(line) + '</p>'
                    ).join('');
                const revealCss = reveal
                    ? '.akari-caption--reveal .akari-caption__plate{display:grid;}'
                        + '.akari-caption__reveal-group{grid-area:1 / 1;display:flex;flex-direction:column;gap:var(--plate-gap,4px);opacity:0;animation:akari-caption-reveal var(--akari-reveal-dur,0.2s) var(--akari-reveal-delay,0s) linear both paused;}'
                        + '@keyframes akari-caption-reveal{0%{opacity:0;transform:translateY(0.18em);}12%{opacity:1;transform:translateY(0);}99.99%{opacity:1;transform:translateY(0);}100%{opacity:0;transform:translateY(0);}}'
                    : '';
                const revealWordCss = style === 'reveal-word'
                    ? '@keyframes akari-caption-reveal-word{0%{opacity:0;}100%{opacity:1;}}'
                        + '.akari-caption__tok--reveal-word{animation:akari-caption-reveal-word 0.01s var(--akari-tok-delay,0s) linear both paused;}'
                    : '';
                const blockMode = caption.textStyle && caption.textStyle.background
                    && caption.textStyle.background.mode === 'block';
                const plateMarkup = blockMode
                    ? '<div class="akari-caption__block">' + markup + '</div>'
                    : markup;
                const blockCss = blockMode
                    ? '.akari-caption__block{display:flex;flex-direction:column;width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);gap:var(--plate-gap,4px);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-block-radius,10px);background:var(--plate-block-bg,transparent);}'
                        + '.akari-caption__block .akari-caption__line{width:auto;max-width:none;margin:0;padding:0;border-radius:0;background:transparent;}'
                    : '';
                const emphasisCss = hasEmphasis
                    ? '.akari-caption{--akari-emphasis-joy:var(--vscode-akariTheme-accentLighter,#fdba74);--akari-emphasis-pain:var(--vscode-errorForeground,#ff798c);--akari-emphasis-surprise:var(--vscode-akariTheme-accentLight,#fb923c);--akari-emphasis-anger:var(--vscode-errorForeground,#ff798c);--akari-emphasis-sadness:var(--vscode-descriptionForeground,#a3a3a3);--akari-emphasis-emphasis:var(--vscode-akariTheme-accent,#f97316);}'
                        + '@keyframes akari-emphasis-one-char-bang{from{opacity:0;transform:scale(1.6);}to{opacity:1;transform:scale(1);}}'
                        + '@keyframes akari-emphasis-size-pulse{0%{transform:scale(1);}50%{transform:scale(1.25);}100%{transform:scale(1);}}'
                        + '.akari-caption__emphasis-char{display:inline-block;opacity:0;animation:akari-emphasis-one-char-bang var(--akari-emphasis-dur,0.1s) var(--akari-emphasis-delay,0s) ease-out both paused;}'
                        + '.akari-caption__tok--size-pulse{animation:akari-emphasis-size-pulse var(--akari-emphasis-dur,0.2s) var(--akari-emphasis-delay,0s) ease-in-out both paused;}'
                    : '';
                return '<div class="akari-caption akari-caption--' + rootStyle + '">'
                    + '<style>'
                    + '.akari-caption{position:absolute;inset:0;pointer-events:none;color:var(--caption-color,#fff);'
                    + '-webkit-text-stroke:var(--caption-webkit-text-stroke,var(--caption-stroke,0.14em rgba(0,0,0,.9)));'
                    + 'paint-order:var(--caption-paint-order,stroke fill);'
                    + 'text-shadow:var(--caption-text-shadow,0 2px 8px rgba(0,0,0,.35));'
                    + 'font-family:"AKARI Noto Sans JP","Noto Sans JP",sans-serif;font-size:var(--caption-font-size,38px);font-weight:700;line-height:1.42;text-align:center;}'
                    + '.akari-caption__plate{position:absolute;top:var(--caption-top,auto);left:var(--caption-left,0);right:var(--caption-right,0);bottom:var(--caption-bottom,7%);display:flex;flex-direction:column;justify-content:var(--caption-justify-content,flex-start);align-items:var(--caption-align-items,stretch);gap:var(--plate-gap,4px);}'
                    + '.akari-caption__line{width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-radius,10px);background:var(--plate-bg,transparent);text-align:var(--caption-text-align,center);white-space:pre;}'
                    + blockCss
                    + '.akari-caption__tok{display:inline-block;will-change:transform,color;}'
                    + '@keyframes akari-caption-karaoke-lit{from{color:var(--caption-color,#fff);}to{color:var(--caption-highlight-color,#ffd94a);}}'
                    + '@keyframes akari-caption-pop{0%{transform:translateY(0) scale(1);}50%{transform:translateY(-0.08em) scale(1.12);}100%{transform:translateY(0) scale(1);}}'
                    + '.akari-caption__tok--karaoke{animation:akari-caption-karaoke-lit var(--akari-tok-dur,0.2s) var(--akari-tok-delay,0s) linear both paused;}'
                    + '.akari-caption__tok--pop{animation:akari-caption-pop 0.2s var(--akari-tok-delay,0s) ease-out both paused;}'
                    + revealWordCss
                    + revealCss
                    + emphasisCss
                    + '</style><div class="akari-caption__plate">' + plateMarkup + '</div></div>';
            };
            const renderPlainCaptionFragment = caption => {
                if (caption.resolvedTimeline) {
                    return ${JSON.stringify(RESOLVED_SINGLE_LINE_FRAGMENT_OPEN)}
                        + ${JSON.stringify(RESOLVED_SINGLE_LINE_CAPTION_CSS)}
                        + ${JSON.stringify(RESOLVED_SINGLE_LINE_FRAGMENT_MIDDLE)}
                        + escapeCaptionHtml(caption.text)
                        + ${JSON.stringify(RESOLVED_SINGLE_LINE_FRAGMENT_CLOSE)};
                }
                // 焼き込みと同じ自然な区切り（句読点 → 空白 → 文節境界 → 文字上限）で折り返す
                const lines = splitCaptionLines(caption.text || '', captionLineBudget);
                const markup = lines.map(line => '<p class="akari-caption__line">'
                    + escapeCaptionHtml(line) + '</p>').join('');
                const blockMode = caption.textStyle && caption.textStyle.background
                    && caption.textStyle.background.mode === 'block';
                const plateMarkup = blockMode
                    ? '<div class="akari-caption__block">' + markup + '</div>'
                    : markup;
                const blockCss = blockMode
                    ? '.akari-caption__block{display:flex;flex-direction:column;width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);gap:var(--plate-gap,4px);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-block-radius,10px);background:var(--plate-block-bg,transparent);}'
                        + '.akari-caption__block .akari-caption__line{width:auto;max-width:none;margin:0;padding:0;border-radius:0;background:transparent;}'
                    : '';
                return '<div class="akari-caption"><style>'
                    + '.akari-caption{position:absolute;inset:0;pointer-events:none;color:var(--caption-color,#fff);-webkit-text-stroke:var(--caption-webkit-text-stroke,var(--caption-stroke,0.14em rgba(0,0,0,.9)));paint-order:var(--caption-paint-order,stroke fill);text-shadow:var(--caption-text-shadow,0 2px 8px rgba(0,0,0,.35));font-family:"AKARI Noto Sans JP","Noto Sans JP",sans-serif;font-size:var(--caption-font-size,38px);font-weight:700;line-height:1.42;text-align:center;}'
                    + '.akari-caption__plate{position:absolute;top:var(--caption-top,auto);left:var(--caption-left,0);right:var(--caption-right,0);bottom:var(--caption-bottom,7%);display:flex;flex-direction:column;justify-content:var(--caption-justify-content,flex-start);align-items:var(--caption-align-items,stretch);gap:var(--plate-gap,4px);}'
                    + '.akari-caption__line{width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-radius,10px);background:var(--plate-bg,transparent);text-align:var(--caption-text-align,center);white-space:pre;}'
                    + blockCss
                    + '</style><div class="akari-caption__plate">' + plateMarkup + '</div></div>';
            };
            const captionStyleVariableNames = ${JSON.stringify(RESOLVED_CAPTION_STYLE_VARIABLE_NAMES)};
            const applyCaptionStyleVars = caption => {
                for (const name of captionStyleVariableNames) {
                    captionPlate.style.removeProperty(name);
                }
                const textStyleActive = Boolean(caption && ((caption.textStyle
                    && Object.keys(caption.textStyle).length > 0) || caption.resolvedTimeline));
                if (!textStyleActive) return;
                const vars = caption.textStyleVars || {};
                for (const [name, value] of Object.entries(vars)) {
                    captionPlate.style.setProperty(name, String(value));
                }
                if (!Object.prototype.hasOwnProperty.call(vars, '--caption-font-size')) {
                    // 明示 size_px が無いときの既定は render-cut と同じ（縦長 = 幅 6% / 横長 = 38px）
                    captionPlate.style.setProperty('--caption-font-size', captionDefaultFontSize + 'px');
                }
            };
            const renderCaption = () => {
                if (activeCaptionEdit) return;
                // captions は host 読込層で全件 output-domain へ正規化済み。gap も同じ時計で
                // 検索し、保持された video.currentTime や active segment kind は参照しない。
                const caption = window.AkariEditKernel.findActiveCaption(captions, outputTime) || null;
                if (caption !== activeCaption) {
                    activeCaption = caption;
                    applyCaptionStyleVars(caption);
                    const hasEmphasis = Boolean(caption && Array.isArray(caption.words)
                        && caption.words.some(word => findMatchingEmphasis(word)));
                    const hasTextStyle = Boolean(caption && ((caption.textStyle
                        && Object.keys(caption.textStyle).length > 0) || caption.resolvedTimeline));
                    const hasCaptionWords = Boolean(caption && Array.isArray(caption.words)
                        && caption.words.length > 0);
                    // reveal（明示 + 縦長の複数行自動昇格）も word ベースの styled 経路で描く
                    const wantsCaptionReveal = hasCaptionWords
                        && (caption.style === 'reveal'
                            || (!caption.style && captionPortrait
                                && splitCaptionLines(caption.text || '', captionLineBudget).length > 1));
                    styledCaptionActive = Boolean(caption
                        && (hasTextStyle || (hasCaptionWords
                            && ((caption.style === 'karaoke' || caption.style === 'pop')
                                || caption.style === 'reveal-word'
                                || hasEmphasis || wantsCaptionReveal))));
                    captionPlate.classList.toggle('akari-caption-host--styled', styledCaptionActive);
                    if (styledCaptionActive) {
                        const usesWords = hasCaptionWords
                            && ((caption.style === 'karaoke' || caption.style === 'pop')
                                || caption.style === 'reveal-word'
                                || hasEmphasis || wantsCaptionReveal);
                        captionPlate.innerHTML = usesWords
                            ? renderStyledCaptionFragment(caption)
                            : renderPlainCaptionFragment(caption);
                    } else {
                        captionPlate.textContent = caption ? caption.text : '';
                    }
                    // ㉓ 字幕もオーバーレイ同様「inset:0 全画面ラッパー + 内側配置」パターン
                    // （styled 字幕の .akari-caption 断片）を取り得るため、㉑ と同じ
                    // clip-path 実寸当たり判定を流用する。プレーン字幕（shrink-to-fit の
                    // #caption-plate 自体が既に実寸）は fragmentBounds が null を返し
                    // clip-path 'none'（=元々実寸のフルコンテナ）のまま無害。
                    window.akari.interaction?.syncOverlayHitRegion?.(captionPlate);
                    if (typeof updateCaptionSelectBox === 'function') updateCaptionSelectBox();
                }
                if (caption && styledCaptionActive) {
                    const localMs = (clamp(outputTime, caption.start, caption.end) - caption.start) * 1000;
                    for (const animation of captionPlate.getAnimations({ subtree: true })) {
                        animation.pause();
                        animation.currentTime = localMs;
                    }
                }
            };
            const renderTransitionPlate = timelineTime => renderTransitionComposite(timelineTime);
            let activeTransitionWindowKey = null;
            let activeTransitionOutgoingIsStill = false;
            let activeTransitionEngine = 'none';
            let transitionAudioBaseVolume = 1;
            const setTransitionMask = (element, value) => {
                const mask = value && value !== 'none' ? value : '';
                element.style.maskImage = mask;
                element.style.webkitMaskImage = mask;
            };
            // feTurbulence(type=turbulence, baseFrequency=0.9, numOctaves=2, seed=7) を
            // luminanceToAlpha した α の実測 CDF（Chromium 実機・320x320・102400 画素）の逆関数。
            // 添字 i は目標可視比 p = i / 32、値は 256 スロット中の可視スロット数。
            // seed / baseFrequency / numOctaves を変えたらこの表も測り直すこと。
            const DISSOLVE_VISIBLE_SLOTS = [
                0, 20, 26, 30, 33, 36, 39, 41, 44, 46, 48, 51, 53, 55, 58, 60, 62,
                65, 67, 70, 72, 75, 78, 81, 84, 88, 92, 96, 100, 106, 112, 122, 256
            ];
            const writeTransitionTransform = (element, base, transition) => {
                element.style.transform = [base, transition].filter(Boolean).join(' ');
                return element.style.transform;
            };
            const transitionEngineBlockSize = (ratio, width) => {
                return Math.max(1, Math.round(ratio * width));
            };
            const transitionDissolveTableValues = (visibleRatio, slots) => {
                const safeSlots = Math.max(0, Math.floor(Number(slots) || 0));
                const ratio = Math.max(0, Math.min(1, Number(visibleRatio) || 0));
                const tablePosition = ratio * (DISSOLVE_VISIBLE_SLOTS.length - 1);
                const lowerIndex = Math.floor(tablePosition);
                const upperIndex = Math.min(DISSOLVE_VISIBLE_SLOTS.length - 1, lowerIndex + 1);
                const fraction = tablePosition - lowerIndex;
                const calibratedSlots = DISSOLVE_VISIBLE_SLOTS[lowerIndex]
                    + (DISSOLVE_VISIBLE_SLOTS[upperIndex] - DISSOLVE_VISIBLE_SLOTS[lowerIndex])
                        * fraction;
                const visibleSlots = Math.round(calibratedSlots * safeSlots / 256);
                return Array.from({ length: safeSlots }, (_value, index) =>
                    index < visibleSlots ? '1' : '0').join(' ');
            };
            const drawTransitionPixelize = (canvas, outgoingSource, incomingSource, blockSize, alpha) => {
                const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
                if (!ctx) return false;
                const width = Math.max(1, Number(canvas.width) || 1);
                const height = Math.max(1, Number(canvas.height) || 1);
                ctx.clearRect(0, 0, width, height);
                const block = Math.max(1, Math.round(Number(blockSize) || 1));
                const reducedWidth = Math.max(1, Math.ceil(width / block));
                const reducedHeight = Math.max(1, Math.ceil(height / block));
                const reduced = document.createElement('canvas');
                reduced.width = reducedWidth;
                reduced.height = reducedHeight;
                const reducedCtx = reduced.getContext('2d');
                if (!reducedCtx) return false;
                reducedCtx.clearRect(0, 0, reducedWidth, reducedHeight);
                reducedCtx.imageSmoothingEnabled = false;
                reducedCtx.webkitImageSmoothingEnabled = false;
                const sourceDimensions = source => {
                    if (!source) return null;
                    const tagName = String(source.tagName || '').toLowerCase();
                    if (tagName === 'video') {
                        if (Number(source.readyState) < 2) return null;
                        const sourceWidth = Number(source.videoWidth);
                        const sourceHeight = Number(source.videoHeight);
                        return sourceWidth > 0 && sourceHeight > 0
                            ? { width: sourceWidth, height: sourceHeight } : null;
                    }
                    if (tagName === 'img') {
                        const sourceWidth = Number(source.naturalWidth);
                        const sourceHeight = Number(source.naturalHeight);
                        return sourceWidth > 0 && sourceHeight > 0
                            ? { width: sourceWidth, height: sourceHeight } : null;
                    }
                    return null;
                };
                const drawContained = (source, sourceAlpha) => {
                    const dimensions = sourceDimensions(source);
                    if (!dimensions) return false;
                    const scale = Math.min(
                        reducedWidth / dimensions.width,
                        reducedHeight / dimensions.height
                    );
                    const drawWidth = dimensions.width * scale;
                    const drawHeight = dimensions.height * scale;
                    const drawX = (reducedWidth - drawWidth) / 2;
                    const drawY = (reducedHeight - drawHeight) / 2;
                    reducedCtx.globalAlpha = sourceAlpha;
                    reducedCtx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
                    return true;
                };
                const outgoingDrawn = drawContained(outgoingSource, 1);
                const incomingDrawn = drawContained(
                    incomingSource,
                    Math.max(0, Math.min(1, Number(alpha) || 0))
                );
                if (!outgoingDrawn && !incomingDrawn) return false;
                ctx.globalAlpha = 1;
                ctx.imageSmoothingEnabled = false;
                ctx.webkitImageSmoothingEnabled = false;
                const expandedWidth = reducedWidth * block;
                const expandedHeight = reducedHeight * block;
                const offsetX = expandedWidth === width
                    ? 0 : -Math.round((expandedWidth - width) / 2);
                const offsetY = expandedHeight === height
                    ? 0 : -Math.round((expandedHeight - height) / 2);
                ctx.drawImage(
                    reduced,
                    0,
                    0,
                    reducedWidth,
                    reducedHeight,
                    offsetX,
                    offsetY,
                    expandedWidth,
                    expandedHeight
                );
                return true;
            };
            const createTransitionPixelizeReadyHooks = rerender => {
                const listeners = new Map();
                const reset = () => {
                    for (const [element, eventListeners] of listeners) {
                        for (const [eventName, listener] of eventListeners) {
                            element.removeEventListener(eventName, listener);
                        }
                    }
                    listeners.clear();
                };
                const arm = element => {
                    if (!element) return;
                    const tagName = String(element.tagName || '').toLowerCase();
                    const eventNames = tagName === 'video'
                        ? ['loadeddata', 'seeked']
                        : tagName === 'img' ? ['load'] : [];
                    if (eventNames.length === 0) return;
                    let eventListeners = listeners.get(element);
                    if (!eventListeners) {
                        eventListeners = new Map();
                        listeners.set(element, eventListeners);
                    }
                    for (const eventName of eventNames) {
                        if (eventListeners.has(eventName)) continue;
                        const listener = () => {
                            reset();
                            rerender();
                        };
                        eventListeners.set(eventName, listener);
                        element.addEventListener(eventName, listener, { once: true });
                    }
                };
                return { arm, reset };
            };
            const transitionPixelizeReadyHooks = createTransitionPixelizeReadyHooks(() => tick(true));
            const removeTransitionEngineElements = () => {
                transitionPixelizeReadyHooks.reset();
                document.getElementById('transition-engine-filters')?.remove();
                document.getElementById('transition-pixelize-canvas')?.remove();
            };
            const ensureTransitionEngineFilters = zIndex => {
                const existing = document.getElementById('transition-engine-filters');
                if (existing) {
                    existing.style.zIndex = String(zIndex);
                    return {
                        svg: existing,
                        blur: document.getElementById('akari-transition-hblur-node'),
                        dissolveTable: document.getElementById('akari-transition-dissolve-table')
                    };
                }
                const ns = 'http://www.w3.org/2000/svg';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.id = 'transition-engine-filters';
                svg.setAttribute('width', '0');
                svg.setAttribute('height', '0');
                svg.setAttribute('aria-hidden', 'true');
                svg.style.position = 'absolute';
                svg.style.zIndex = String(zIndex);
                const defs = document.createElementNS(ns, 'defs');
                const blurFilter = document.createElementNS(ns, 'filter');
                blurFilter.id = 'akari-transition-hblur';
                blurFilter.setAttribute('x', '-10%');
                blurFilter.setAttribute('y', '-10%');
                blurFilter.setAttribute('width', '120%');
                blurFilter.setAttribute('height', '120%');
                const blur = document.createElementNS(ns, 'feGaussianBlur');
                blur.id = 'akari-transition-hblur-node';
                blur.setAttribute('stdDeviation', '0 0');
                blur.setAttribute('edgeMode', 'duplicate');
                blurFilter.appendChild(blur);
                const dissolveFilter = document.createElementNS(ns, 'filter');
                dissolveFilter.id = 'akari-transition-dissolve';
                dissolveFilter.setAttribute('x', '0%');
                dissolveFilter.setAttribute('y', '0%');
                dissolveFilter.setAttribute('width', '100%');
                dissolveFilter.setAttribute('height', '100%');
                dissolveFilter.setAttribute('color-interpolation-filters', 'sRGB');
                const turbulence = document.createElementNS(ns, 'feTurbulence');
                turbulence.setAttribute('type', 'turbulence');
                turbulence.setAttribute('baseFrequency', '0.9');
                turbulence.setAttribute('numOctaves', '2');
                turbulence.setAttribute('seed', '7');
                turbulence.setAttribute('result', 'noise');
                const luminance = document.createElementNS(ns, 'feColorMatrix');
                luminance.setAttribute('in', 'noise');
                luminance.setAttribute('type', 'luminanceToAlpha');
                luminance.setAttribute('result', 'noiseAlpha');
                const transfer = document.createElementNS(ns, 'feComponentTransfer');
                transfer.setAttribute('in', 'noiseAlpha');
                transfer.setAttribute('result', 'mask');
                const dissolveTable = document.createElementNS(ns, 'feFuncA');
                dissolveTable.id = 'akari-transition-dissolve-table';
                dissolveTable.setAttribute('type', 'discrete');
                dissolveTable.setAttribute('tableValues', transitionDissolveTableValues(0, 256));
                transfer.appendChild(dissolveTable);
                const composite = document.createElementNS(ns, 'feComposite');
                composite.setAttribute('in', 'SourceGraphic');
                composite.setAttribute('in2', 'mask');
                composite.setAttribute('operator', 'in');
                dissolveFilter.append(turbulence, luminance, transfer, composite);
                defs.append(blurFilter, dissolveFilter);
                svg.appendChild(defs);
                layersStage.appendChild(svg);
                return { svg, blur, dissolveTable };
            };
            const ensureTransitionPixelizeCanvas = zIndex => {
                let canvas = document.getElementById('transition-pixelize-canvas');
                if (!canvas) {
                    canvas = document.createElement('canvas');
                    canvas.id = 'transition-pixelize-canvas';
                    canvas.style.position = 'absolute';
                    canvas.style.pointerEvents = 'none';
                    layersStage.appendChild(canvas);
                }
                canvas.style.zIndex = String(zIndex);
                return canvas;
            };
            const resetTransitionComposite = () => {
                if (activeTransitionWindowKey !== null) {
                    const segment = segments[activeSegmentIndex];
                    const restoredOpacity = segment && Number.isFinite(segment.opacity)
                        ? String(segment.opacity) : '';
                    if (isStillSegment(segment)) {
                        // syncStillImageVisual の鏡写し元も同時に戻し、tick 外の layout/load 経路が
                        // 静止画だけを古い transition opacity へ戻さないようにする。
                        video.style.opacity = restoredOpacity;
                        stillImage.style.opacity = restoredOpacity;
                    } else {
                        video.style.opacity = restoredOpacity;
                    }
                    if (segment && segment.kind === 'src') {
                        const restoredZ = String(zForTrack(segment.trackId));
                        video.style.zIndex = restoredZ;
                        stillImage.style.zIndex = restoredZ;
                    }
                    if (!activeTransitionOutgoingIsStill) {
                        video.volume = transitionAudioBaseVolume;
                    }
                }
                activeTransitionWindowKey = null;
                activeTransitionOutgoingIsStill = false;
                activeTransitionEngine = 'none';
                removeTransitionEngineElements();
                video.dataset.akariTransitionAudioActive = 'false';
                video.dataset.akariTransitionType = '';
                video.dataset.akariTransitionProgress = '';
                stillImage.dataset.akariTransitionType = '';
                stillImage.dataset.akariTransitionProgress = '';
                transitionVideo.dataset.akariTransitionType = '';
                transitionVideo.dataset.akariTransitionProgress = '';
                transitionStill.dataset.akariTransitionType = '';
                transitionStill.dataset.akariTransitionProgress = '';
                transitionVideo.style.display = 'none';
                transitionVideo.style.opacity = '0';
                transitionVideo.style.clipPath = 'none';
                transitionVideo.style.transform = '';
                transitionVideo.style.filter = '';
                setTransitionMask(transitionVideo, 'none');
                transitionVideo.muted = true;
                transitionVideo.pause();
                transitionStill.style.display = 'none';
                transitionStill.style.opacity = '0';
                transitionStill.style.clipPath = 'none';
                transitionStill.style.transform = '';
                transitionStill.style.filter = '';
                setTransitionMask(transitionStill, 'none');
                video.style.filter = '';
                stillImage.style.filter = '';
                setTransitionMask(video, 'none');
                setTransitionMask(stillImage, 'none');
                transitionPlate.style.opacity = '0';
                transitionFallbackLabel.style.display = 'none';
                transitionFallbackLabel.textContent = '';
                transitionFallbackLabel.dataset.akariTransitionFallback = '';
            };
            const renderTransitionComposite = timelineTime => {
                const window = transitionWindows.find(candidate =>
                    timelineTime >= candidate.start && timelineTime < candidate.end);
                const incomingHidden = window && (allTracksHiddenByScope.cuts
                    || hiddenTracksByScope.cuts.has(window.incoming.track));
                if (!window || !window.incoming || incomingHidden) {
                    resetTransitionComposite();
                    return;
                }
                const outgoingIsStill = isStillSegment(window.outgoing);
                const incomingStillUrl = stillUrlForSegment(window.incoming);
                const incomingIsStill = Boolean(incomingStillUrl);
                const outgoingElement = outgoingIsStill ? stillImage : video;
                const incomingElement = incomingIsStill ? transitionStill : transitionVideo;
                const key = window.start + ':' + window.end + ':' + window.incoming.cutIndex;
                if (activeTransitionWindowKey !== key) {
                    resetTransitionComposite();
                    activeTransitionWindowKey = key;
                    activeTransitionOutgoingIsStill = outgoingIsStill;
                    transitionAudioBaseVolume = Number.isFinite(video.volume)
                        ? clamp(video.volume, 0, 1) : 1;
                    video.dataset.akariTransitionAudioActive = String(!outgoingIsStill);
                }
                const progress = clamp((timelineTime - window.start) / window.duration, 0, 1);
                const transitionDefinition = transitionById[window.type];
                const visual = computeTransitionVisualFn(
                    transitionDefinition?.previewKind || 'fallback',
                    progress,
                    transitionDefinition?.labelJa || String(window.type)
                );
                if (activeTransitionEngine !== visual.engine) {
                    removeTransitionEngineElements();
                    activeTransitionEngine = visual.engine;
                }
                const outgoingZ = zForTrack(window.outgoing.trackId);
                const incomingZ = zForTrack(window.incoming.trackId);
                const engineZ = Math.max(outgoingZ, incomingZ) + 1;
                const engineFilters = visual.engine === 'directional-blur'
                    || visual.engine === 'noise-dissolve'
                    ? ensureTransitionEngineFilters(engineZ) : null;
                if (visual.engine === 'directional-blur' && engineFilters?.blur) {
                    const stageWidth = Number.parseFloat(layersStage.style.width)
                        || Number.parseFloat(video.style.width)
                        || Number(summary.output && summary.output.width)
                        || 1280;
                    engineFilters.blur.setAttribute(
                        'stdDeviation',
                        String(visual.blurStdDeviationRatio * stageWidth) + ' 0'
                    );
                } else if (visual.engine === 'noise-dissolve' && engineFilters?.dissolveTable) {
                    engineFilters.dissolveTable.setAttribute(
                        'tableValues',
                        transitionDissolveTableValues(visual.dissolveVisibleRatio, 256)
                    );
                }
                const outgoingOpacity = Number.isFinite(window.outgoing.opacity) ? window.outgoing.opacity : 1;
                const incomingOpacity = Number.isFinite(window.incoming.opacity) ? window.incoming.opacity : 1;
                if (outgoingIsStill) {
                    // #preview-still は tick 外の layout/load 経路でも video.style.opacity を
                    // 鏡写しする。hidden の video にも同じ合成値を置けば、どの経路が後から
                    // syncStillImageVisual を呼んでも outgoing の実 DOM 値が巻き戻らない。
                    video.style.opacity = String(outgoingOpacity * visual.outgoingOpacity);
                    stillImage.style.opacity = video.style.opacity;
                } else {
                    video.style.opacity = String(outgoingOpacity * visual.outgoingOpacity);
                }
                outgoingElement.style.filter = visual.engine === 'directional-blur'
                    ? 'url(#akari-transition-hblur)'
                    : (visual.outgoingFilter === 'none' ? '' : visual.outgoingFilter);
                setTransitionMask(outgoingElement, visual.outgoingMask);
                if (outgoingIsStill) {
                    video.style.filter = outgoingElement.style.filter;
                    setTransitionMask(video, visual.outgoingMask);
                }
                if (incomingIsStill && transitionStill.getAttribute('src') !== incomingStillUrl) {
                    transitionStill.setAttribute('src', incomingStillUrl);
                }
                incomingElement.style.display = 'block';
                incomingElement.style.opacity = String(incomingOpacity * visual.incomingOpacity);
                incomingElement.style.clipPath = visual.incomingClipPath;
                incomingElement.style.left = video.style.left;
                incomingElement.style.top = video.style.top;
                incomingElement.style.width = video.style.width;
                incomingElement.style.height = video.style.height;
                const incomingLocalTime = Math.max(0, timelineTime - window.start);
                const incomingLayerStyle = writeCutLayerStyleBase(incomingElement, window.incoming);
                if (incomingLayerStyle) {
                    if (incomingIsStill) {
                        applyCutKeyframesToMedia(transitionStill, window.incoming, incomingLocalTime);
                    } else {
                        // 動画 incoming の既存レールと wiring assert を維持する。
                        applyCutKeyframesToMedia(transitionVideo, window.incoming, incomingLocalTime);
                    }
                    // dissolve/fade の 'none' で crop clip を消さない。reveal は既存 transition
                    // window の clip を優先し、窓モデル自体の挙動を維持する。
                    incomingElement.style.clipPath = visual.incomingClipPath === 'none'
                        ? (incomingElement.dataset.akariCropClipPath || 'none')
                        : visual.incomingClipPath;
                } else {
                    const incomingTransform = window.incoming.transform;
                    const incomingBaseTransform = incomingTransform
                        ? 'translate(' + (Number(incomingTransform.x) || 0) + 'px, '
                            + (Number(incomingTransform.y) || 0) + 'px) scale('
                            + (Number(incomingTransform.scale) || 1) + ') rotate('
                            + (Number(incomingTransform.rotate) || 0) + 'deg)'
                        : '';
                    const incomingFraming = computeCutFramingVisualFn(
                        window.incoming.framing,
                        incomingLocalTime
                    );
                    incomingElement.style.transformOrigin = incomingFraming?.transformOrigin || '';
                    incomingElement.style.transform = incomingBaseTransform
                        + (incomingFraming ? (incomingBaseTransform ? ' ' : '') + incomingFraming.transform : '');
                    if (incomingIsStill) {
                        transitionStill.style.clipPath = visual.incomingClipPath;
                    } else {
                        transitionVideo.style.clipPath = visual.incomingClipPath;
                    }
                }
                // style.transform は同一 tick の再入で既に transition を含み得るため読み戻さない。
                // applyCutFramingVisual が毎 tick 保存する transition 無しの正準値だけを基底にする。
                const outgoingBaseTransform = outgoingElement.dataset.akariTransitionBaseTransform || '';
                writeTransitionTransform(
                    outgoingElement,
                    outgoingBaseTransform,
                    visual.outgoingTransform
                );
                if (outgoingIsStill) video.style.transform = outgoingElement.style.transform;
                writeTransitionTransform(
                    incomingElement,
                    incomingElement.style.transform,
                    visual.incomingTransform
                );
                incomingElement.style.filter = visual.engine === 'directional-blur'
                    ? 'url(#akari-transition-hblur)'
                    : visual.engine === 'noise-dissolve'
                        ? 'url(#akari-transition-dissolve)'
                        : (visual.incomingFilter === 'none' ? '' : visual.incomingFilter);
                setTransitionMask(incomingElement, visual.incomingMask);
                outgoingElement.style.zIndex = String(visual.zSwap ? Math.max(outgoingZ, incomingZ) + 1 : outgoingZ);
                if (outgoingIsStill) video.style.zIndex = outgoingElement.style.zIndex;
                incomingElement.style.zIndex = String(incomingZ);
                if (visual.engine === 'pixelize') {
                    transitionPixelizeReadyHooks.arm(outgoingElement);
                    transitionPixelizeReadyHooks.arm(incomingElement);
                    const canvas = ensureTransitionPixelizeCanvas(engineZ);
                    const canvasWidth = Number(summary.output && summary.output.width) || 1280;
                    const canvasHeight = Number(summary.output && summary.output.height) || 720;
                    canvas.width = Math.max(1, Math.round(canvasWidth));
                    canvas.height = Math.max(1, Math.round(canvasHeight));
                    canvas.style.left = video.style.left;
                    canvas.style.top = video.style.top;
                    canvas.style.width = video.style.width;
                    canvas.style.height = video.style.height;
                    const blockSize = transitionEngineBlockSize(visual.pixelBlockRatio, canvasWidth);
                    canvas.style.display = drawTransitionPixelize(
                        canvas,
                        outgoingElement,
                        incomingElement,
                        blockSize,
                        visual.progress
                    ) ? 'block' : 'none';
                }
                const progressText = visual.progress.toFixed(3);
                outgoingElement.dataset.akariTransitionType = window.type;
                outgoingElement.dataset.akariTransitionProgress = progressText;
                incomingElement.dataset.akariTransitionType = window.type;
                incomingElement.dataset.akariTransitionProgress = progressText;
                transitionPlate.style.background = visual.plateColor;
                transitionPlate.style.opacity = String(visual.plateOpacity);
                transitionFallbackLabel.textContent = visual.fallbackLabel;
                transitionFallbackLabel.style.display = visual.fallbackLabel ? 'block' : 'none';
                transitionFallbackLabel.dataset.akariTransitionFallback = visual.fallbackLabel ? window.type : '';

                if (!incomingIsStill) {
                    const incomingSpeed = Number.isFinite(window.incoming.speed) && window.incoming.speed > 0
                        ? window.incoming.speed : 1;
                    const target = window.incoming.in + (timelineTime - window.start) * incomingSpeed;
                    const seekIncoming = () => {
                        const tolerance = isPlaying ? 0.05 : 0.001;
                        if (Math.abs((transitionVideo.currentTime || 0) - target) > tolerance) {
                            try { transitionVideo.currentTime = target; } catch (_error) { /* metadata pending */ }
                        }
                        if (isPlaying && transitionVideo.paused) {
                            void transitionVideo.play().catch(() => undefined);
                        } else if (!isPlaying && !transitionVideo.paused) {
                            transitionVideo.pause();
                        }
                    };
                    if (!applyTransitionSegmentSource(window.incoming, () => {
                        seekIncoming();
                        tick(true);
                    })) seekIncoming();
                    transitionVideo.playbackRate = incomingSpeed;

                    const cutsTrackMuted = allTracksMutedByScope.cuts
                        || mutedTracksByScope.cuts.has(window.incoming.track);
                    transitionVideo.muted = globalMuted || cutsTrackMuted;
                    // incoming 静止画ではこの分岐へ入らず、無音要素の volume を触らない。
                    transitionVideo.volume = transitionAudioBaseVolume * progress;
                }
                if (!outgoingIsStill) {
                    // outgoing 静止画では本編 video の音量を変えず、動画側だけを線形減衰する。
                    video.volume = transitionAudioBaseVolume * (1 - progress);
                }
            };
            const renderLayers = timelineTime => {
                // ㉘ layers[].keyframes（contract-2026-08-09-transform-keyframes-v0.md）: dataset
                // が変わっても DOM スタイルには自動反映されない（updateStageScale が dataset ->
                // style を書く唯一の場所）ので、このフレームで実際に何か上書きしたときだけ最後に
                // 1 回まとめて呼ぶ -- keyframes の無いプロジェクト（大多数）はここで一切コストが
                // 増えない。
                let anyKeyframeApplied = false;
                for (const entry of layerEntries) {
                    const layer = entry.spec;
                    const layerVideo = entry.video;
                    layerVideo.muted = allTracksMutedByScope.layers || mutedTracksByScope.layers.has(layer.track);
                    const activeWindow = !allTracksHiddenByScope.layers
                        && !hiddenTracksByScope.layers.has(layer.track)
                        && timelineTime >= layer.t && timelineTime < layer.t + layer.duration;
                    const localTime = clamp(timelineTime - layer.t, 0, layer.duration);
                    const mediaEnd = Number.isFinite(layerVideo.duration) && layerVideo.duration > 0
                        ? Math.max(0, layerVideo.duration - 0.001)
                        : layer.duration;
                    const target = Math.min(localTime, mediaEnd);
                    let deferredPlaybackRate = 1;
                    if (entry.deferredTelop) {
                        if (entry.deferredMediaLoading
                            && layerVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                            entry.deferredMediaLoading = false;
                        }
                        if (entry.deferredSeekPending && !layerVideo.seeking
                            && Number.isFinite(entry.deferredSeekTarget)
                            && Math.abs((layerVideo.currentTime || 0) - entry.deferredSeekTarget) <= 0.25) {
                            // seeked is the primary release. This covers engines which settle a
                            // same-frame seek without emitting the event after a source swap.
                            entry.deferredSeekPending = false;
                            entry.deferredSeekTarget = null;
                        }
                        const bakePending = layer.proxyMissing
                            || !(typeof layer.src === 'string' && layer.src);
                        const deferredAction = resolveDeferredTelopPlaybackFn({
                            active: activeWindow,
                            bakePending,
                            mediaReady: !entry.deferredMediaLoading
                                && layerVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
                            seekPending: entry.deferredSeekPending,
                            mediaSeeking: layerVideo.seeking,
                            currentTime: layerVideo.currentTime || 0,
                            targetTime: target,
                            playing: isPlaying
                        });
                        // 「準備中」は host がまだ telop を焼いている間だけ。ready 後の media load や
                        // currentTime 再同期は通常の再生操作なので、表示済みフレームを保ったまま行う。
                        const showPlaceholder = deferredAction.phase === 'baking';
                        entry.deferredPlaceholder.style.display = showPlaceholder ? 'grid' : 'none';
                        entry.deferredPlaceholder.dataset.akariDeferredState = deferredAction.phase;
                        if (deferredAction.phase === 'inactive') {
                            layerVideo.style.display = 'none';
                            if (!layerVideo.paused) layerVideo.pause();
                            layerVideo.playbackRate = 1;
                            continue;
                        }
                        if (deferredAction.phase === 'baking') {
                            layerVideo.style.display = 'none';
                            if (!layerVideo.paused) layerVideo.pause();
                            continue;
                        }
                        if (deferredAction.phase === 'loading') {
                            layerVideo.style.display = entry.deferredHasPresentedFrame ? 'block' : 'none';
                            if (isPlaying && entry.deferredHasPresentedFrame && layerVideo.paused) {
                                void layerVideo.play().catch(() => undefined);
                            }
                            continue;
                        }
                        if (deferredAction.phase === 'syncing') {
                            layerVideo.style.display = 'block';
                            if (isPlaying && layerVideo.paused) {
                                void layerVideo.play().catch(() => undefined);
                            }
                            continue;
                        }
                        if (deferredAction.phase === 'seek') {
                            layerVideo.style.display = 'block';
                            entry.deferredSeekPending = true;
                            entry.deferredSeekTarget = deferredAction.targetTime;
                            try {
                                layerVideo.currentTime = deferredAction.targetTime;
                            } catch (error) {
                                entry.deferredSeekPending = false;
                                entry.deferredSeekTarget = null;
                                console.warn('[akari-preview] deferred telop seek failed', layer.id, error);
                            }
                            if (isPlaying && layerVideo.paused) {
                                void layerVideo.play().catch(() => undefined);
                            }
                            continue;
                        }
                        entry.deferredHasPresentedFrame = true;
                        deferredPlaybackRate = deferredAction.playbackRate;
                    }
                    const active = activeWindow
                        && !layer.proxyMissing
                        && typeof layer.src === 'string' && layer.src;
                    if (!active) {
                        layerVideo.style.display = 'none';
                        if (!layerVideo.paused) layerVideo.pause();
                        continue;
                    }
                    if (layerVideo.readyState < HTMLMediaElement.HAVE_METADATA) {
                        layerVideo.style.display = 'none';
                        continue;
                    }
                    layerVideo.style.display = 'block';
                    if (Array.isArray(layer.keyframes) && layer.keyframes.length >= 2) {
                        // computeLayerKeyframesVisualFn is a webview-injected copy (toString()
                        // serialization) -- guarded the same way computeLayerPerspectiveVisualFn's
                        // call in updateStageScale is, so a future injection regression degrades to
                        // "keyframes not applied" instead of aborting the rest of this loop.
                        try {
                            const resolved = computeLayerKeyframesVisualFn(layer.keyframes, localTime);
                            if (resolved) {
                                if (resolved.transform) {
                                    layerVideo.dataset.akariTransformX = String(resolved.transform.x);
                                    layerVideo.dataset.akariTransformY = String(resolved.transform.y);
                                    layerVideo.dataset.akariTransformScale = String(resolved.transform.scale);
                                    layerVideo.dataset.akariTransformRotate = String(resolved.transform.rotate);
                                }
                                if (resolved.crop) {
                                    layerVideo.dataset.akariCropX = String(resolved.crop.x);
                                    layerVideo.dataset.akariCropY = String(resolved.crop.y);
                                    layerVideo.dataset.akariCropW = String(resolved.crop.w);
                                    layerVideo.dataset.akariCropH = String(resolved.crop.h);
                                }
                                if (resolved.perspective) {
                                    layerVideo.dataset.akariPerspectiveCorners = JSON.stringify(resolved.perspective.corners);
                                }
                                if (resolved.transform || resolved.crop || resolved.perspective) anyKeyframeApplied = true;
                            }
                        } catch (error) {
                            console.warn('[akari-preview] layer keyframes visual failed; rendering without them', layer.id, error);
                        }
                    }
                    if (entry.deferredTelop) {
                        if (Math.abs(layerVideo.playbackRate - deferredPlaybackRate) > 0.001) {
                            layerVideo.playbackRate = deferredPlaybackRate;
                        }
                    } else {
                        const tolerance = isPlaying ? 0.05 : 0.001;
                        if (Math.abs((layerVideo.currentTime || 0) - target) > tolerance) {
                            try {
                                layerVideo.currentTime = target;
                            } catch (error) {
                                console.warn('[akari-preview] layer seek failed', layer.id, error);
                            }
                        }
                    }
                    if (!isPlaying) {
                        if (!layerVideo.paused) layerVideo.pause();
                    } else if (layerVideo.paused) {
                        void layerVideo.play().catch(() => undefined);
                    }
                    if (layer.kind === 'baked') {
                        const hitRegionBucket = Math.floor(target * 4);
                        if (entry.hitRegionBucket !== hitRegionBucket) {
                            entry.hitRegionBucket = hitRegionBucket;
                            syncLayerHitRegion(entry, true);
                        }
                    }
                }
                if (anyKeyframeApplied && window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                for (const entry of filterEntries) {
                    const filter = entry.spec;
                    entry.element.style.display = !allTracksHiddenByScope.layers
                        && !hiddenTracksByScope.layers.has(filter.track)
                        && timelineTime >= filter.t
                        && timelineTime < filter.t + filter.duration ? 'block' : 'none';
                }
            };
            const renderCutLayerStyleVisual = timelineTime => {
                const segment = segments[activeSegmentIndex];
                if (!segment || !cutHasLayerStyleVisual(segment)) return;
                const localTime = Math.max(0, timelineTime - segment.outStart);
                applyCutKeyframesToMedia(video, segment, localTime);
                if (stillImage.style.display !== 'none') {
                    applyCutKeyframesToMedia(stillImage, segment, localTime);
                }
            };
            const applyCutsMuteState = () => {
                const segment = segments[activeSegmentIndex];
                applyCutsZIndex(segment);
                const cutsTrackMuted = Boolean(segment && segment.kind === 'src'
                    && (allTracksMutedByScope.cuts || mutedTracksByScope.cuts.has(segment.track)));
                const cutsTrackHidden = Boolean(segment && segment.kind === 'src'
                    && (allTracksHiddenByScope.cuts || hiddenTracksByScope.cuts.has(segment.track)));
                video.dataset.akariGlobalMuted = String(globalMuted);
                video.muted = globalMuted || cutsTrackMuted;
                const segmentIsStill = isStillSegment(segment);
                video.style.visibility = !segment || segment.kind === 'gap' || segmentIsStill
                    || cutsTrackHidden ? 'hidden' : '';
                // 静止画の表示可否もここで一元管理する（トラック非表示・再生エラー時は隠す）。
                if (segmentIsStill && !cutsTrackHidden && !playbackErrored) {
                    showStillImage(stillUrlForSegment(segment));
                } else {
                    hideStillImage();
                }
            };
            const tick = (immediatePlaybackTick = false) => {
                // ㉕ cuts[].freeze の一時停止ホールド中（contract-2026-08-02-preview-parity.md
                // §2.4.3 の近似実装 — 尺は伸ばさない）: video / previewAudio を実時間で
                // 一時停止したまま outputTime を進めず、rAF の連鎖だけ生かしておく。
                if (freezeHoldUntilMs > 0) {
                    if (performance.now() < freezeHoldUntilMs) {
                        applyCutsMuteState();
                        return;
                    }
                    freezeHoldUntilMs = 0;
                    if (isPlaying) {
                        const resumedSegment = segments[activeSegmentIndex];
                        if (resumedSegment && isStillSegment(resumedSegment)) {
                            // 静止画セグメントは壁時計駆動のため、ホールドで止まっていた分だけ
                            // 原点を引き直す（video.play() は呼ばない — src が無いこともある）。
                            gapWallClockOriginMs = performance.now();
                            gapOutputOrigin = outputTime;
                        } else if (video.paused) {
                            void video.play().catch(error => console.error('[akari-preview] freeze hold の再開に失敗しました', error));
                        }
                        if (window.akari.previewAudio) void window.akari.previewAudio.resume();
                    }
                }
                const segment = segments[activeSegmentIndex];
                const segmentIsStill = isStillSegment(segment);
                if (segment && (segment.kind === 'gap' || segmentIsStill)) {
                    if (isPlaying) {
                        outputTime = clamp(
                            gapOutputOrigin + (performance.now() - gapWallClockOriginMs) / 1000,
                            segment.outStart,
                            segment.outEnd
                        );
                        if (outputTime >= segment.outEnd - 0.0005) {
                            const nextIndex = activeSegmentIndex + 1;
                            if (nextIndex < segments.length) {
                                outputTime = segments[nextIndex].outStart;
                                enterSegment(nextIndex);
                            } else {
                                stopAtNaturalEnd();
                            }
                        } else if (segmentIsStill
                            && freezeHoldConsumedForSegmentIndex !== activeSegmentIndex) {
                            // ㉕ cuts[].freeze: 静止画では視覚的 no-op（契約 §3.2）だが、動画と同じ
                            // 「境界通過で一時停止ホールド」の近似は踏襲する（尺は伸ばさない）。
                            const freezeCheck = checkCutFreezeCrossingFn(segment.freeze, playedCutLocalSeconds(segment));
                            if (freezeCheck.shouldHold) {
                                freezeHoldConsumedForSegmentIndex = activeSegmentIndex;
                                freezeHoldUntilMs = performance.now() + freezeCheck.holdSeconds * 1000;
                                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                            }
                        }
                    }
                } else if (segment) {
                    outputTime = outputTimeForSourceClockFn(
                        segment,
                        video.currentTime,
                        outputTime,
                        !sourceSwapPending
                    );
                    if (!sourceSwapPending) applyKeepRangeBoundary();
                    const activeSegment = segments[activeSegmentIndex];
                    if (isPlaying && activeSegment && activeSegment.kind === 'src'
                        && freezeHoldConsumedForSegmentIndex !== activeSegmentIndex) {
                        const freezeCheck = checkCutFreezeCrossingFn(activeSegment.freeze, playedCutLocalSeconds(activeSegment));
                        if (freezeCheck.shouldHold) {
                            freezeHoldConsumedForSegmentIndex = activeSegmentIndex;
                            freezeHoldUntilMs = performance.now() + freezeCheck.holdSeconds * 1000;
                            video.pause();
                            if (window.akari.previewAudio) window.akari.previewAudio.pause();
                        }
                    }
                } else {
                    outputTime = video.currentTime || 0;
                }
                renderCutLayerStyleVisual(outputTime);
                applyCutFramingVisual();
                preloadUpcomingTransition(outputTime);
                renderLayers(outputTime);
                updateLayerSelectBox();
                renderTransitionPlate(outputTime);
                window.akari.runtime.tick(outputTime, isPlaying);
                if (window.akari.previewAudio) {
                    window.akari.previewAudio.setMutedTracks(
                        mutedTracksByScope.audio, allTracksMutedByScope.audio
                    );
                    window.akari.previewAudio.tick(outputTime, isPlaying);
                }
                // タイムライン横軸と同じ出力秒（cuts ギャップレス連結後の秒）を送る（音声側も timelineTime で駆動済み）。
                window.akari.playbackTick(outputTime, isPlaying, immediatePlaybackTick);
                renderCaption();
                updateTransport();
                updateWaveformPlayhead();
                applyCutsMuteState();
                renderVideoFx(outputTime);
            };
            const runTickGuarded = () => {
                // A thrown exception here would otherwise abort animate()/the
                // watchdog callback before their requestAnimationFrame re-arm runs,
                // permanently killing the rAF self-chain (defense in depth -
                // real-data testing found no such exception, but tick() has many
                // data-dependent branches and this keeps any future one from being
                // fatal to playback).
                try {
                    tick();
                } catch (error) {
                    console.error('[akari-preview] tick failed; continuing animation loop', error);
                }
            };
            const animate = () => {
                lastTickAtMs = performance.now();
                runTickGuarded();
                if (isPlaying) animationFrame = requestAnimationFrame(animate);
            };
            const startAnimation = () => {
                cancelAnimationFrame(animationFrame);
                lastTickAtMs = performance.now();
                animationFrame = requestAnimationFrame(animate);
                window.clearInterval(animationWatchdogTimer);
                // rAF の連鎖が途切れると outputTime/シークバー/video が永久停止する一方、
                // previewAudio は壁時計駆動で鳴り続ける「片肺」状態になる（実機再現済み）。
                // rAF が生きている間は lastTickAtMs が毎フレーム更新されるため素通りする監視。
                animationWatchdogTimer = window.setInterval(() => {
                    if (!isPlaying) {
                        window.clearInterval(animationWatchdogTimer);
                        animationWatchdogTimer = 0;
                        return;
                    }
                    if (performance.now() - lastTickAtMs > 400) {
                        cancelAnimationFrame(animationFrame);
                        lastTickAtMs = performance.now();
                        runTickGuarded();
                        animationFrame = requestAnimationFrame(animate);
                    }
                }, 200);
            };
            const stopAnimation = () => {
                cancelAnimationFrame(animationFrame);
                animationFrame = 0;
                window.clearInterval(animationWatchdogTimer);
                animationWatchdogTimer = 0;
                tick(true);
            };
            const showPlaybackError = () => {
                playbackErrored = true;
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                stopAnimation();
                video.pause();
                video.hidden = true;
                hideStillImage();
                layersStage.hidden = true;
                stage.hidden = true;
                captionPlate.textContent = '';
                previewMessageText.textContent = '動画を再生できませんでした。再読み込みを試してください。';
                previewMessageReload.hidden = false;
                previewMessage.hidden = false;
                playToggle.disabled = true;
                frameBack.disabled = true;
                frameForward.disabled = true;
                skipBack.disabled = true;
                skipForward.disabled = true;
                waveformToggle.disabled = true;
                zoomToggle.disabled = true;
                fullscreenToggle.disabled = true;
                seek.disabled = true;
            };
            const restorePlayback = () => {
                if (!playbackErrored) return;
                playbackErrored = false;
                previewMessage.hidden = true;
                previewMessageReload.hidden = true;
                video.hidden = false;
                layersStage.hidden = false;
                stage.hidden = false;
                playToggle.disabled = false;
                frameBack.disabled = false;
                frameForward.disabled = false;
                skipBack.disabled = false;
                skipForward.disabled = false;
                waveformToggle.disabled = false;
                zoomToggle.disabled = false;
                fullscreenToggle.disabled = false;
                seek.disabled = false;
                updateTransport();
                tick(true);
            };
            // task/2026-08-09-drop-hevc-proxy: showPlaybackError の直後、その動画で初めての
            // MEDIA_ERR_DECODE(3) / MEDIA_ERR_SRC_NOT_SUPPORTED(4) のときだけ呼ぶ。ホスト側で
            // 変換に成功すれば widget が丸ごとリロードされる（このスクリプト自体が入れ替わる）ので
            // ここでは resolve 後の後始末をしない。失敗時だけ通常のエラー文言に戻す。
            const attemptHevcFallback = (errorCode, videoUri) => {
                const requestKey = typeof videoUri === 'string' && videoUri ? videoUri : initial.videoUri;
                if (hevcFallbackRequested.has(requestKey)) return;
                hevcFallbackRequested.add(requestKey);
                previewMessageText.textContent = '動画をそのまま再生できませんでした。互換用に変換しています…';
                previewMessageReload.hidden = true;
                window.akari.engine.resolveHevcFallback(errorCode, requestKey).catch(() => {
                    if (!playbackErrored) return;
                    previewMessageText.textContent = '動画を再生できませんでした。再読み込みを試してください。';
                    previewMessageReload.hidden = false;
                });
            };
            previewMessageReload.addEventListener('click', () => video.load());
            const togglePlayback = () => {
                if (playToggle.disabled) return;
                if (!isPlaying) {
                    abortCurrentStroke();
                    abortCurrentRect();
                    isPlaying = true;
                    // 描画系ツール（pen/rect）は一時停止中のみ有効 -- select はそのまま維持する
                    // （select ツールは再生中もクリックへ intent を乗せる意味を持つため、mode 自体は
                    // pen/rect のときだけ neutral へ戻して host にも伝える。penModeActive/
                    // rectModeActive はどのモードでも isPlaying=true で false になるよう再計算する）。
                    if (reviewToolMode === 'pen' || reviewToolMode === 'rect') {
                        applyReviewToolMode('neutral');
                        window.akari.reviewSetToolMode('neutral');
                    } else {
                        setPenModeActive(false);
                        setRectModeActive(false);
                    }
                    window.akari.reviewTransport({ type: 'play', timelineT: outputTime });
                    if (window.akari.previewAudio) void window.akari.previewAudio.resume();
                    const segment = segments[activeSegmentIndex];
                    if (segment && (segment.kind === 'gap' || isStillSegment(segment))) {
                        // gap / 静止画セグメントからの再生開始は壁時計の原点を引き直すだけ
                        gapWallClockOriginMs = performance.now();
                        gapOutputOrigin = outputTime;
                        if (window.akari.previewAudio) void window.akari.previewAudio.playFrom(outputTime);
                    } else {
                        void video.play().catch(error => console.error('[akari-preview] playback failed', error));
                    }
                    startAnimation();
                } else {
                    isPlaying = false;
                    // ㉕ 手動一時停止はフリーズホールドを打ち切る（保留中タイマーを引きずったまま
                    // 次の再開で誤って再一時停止しない — contract-2026-08-02-preview-parity.md §2.4.3）。
                    freezeHoldUntilMs = 0;
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                    if (window.akari.previewAudio) window.akari.previewAudio.pause();
                    video.pause();
                    stopAnimation();
                }
            };
            const isEditable = (${isEditableEventTarget.toString()});
            const shouldStopEditableDeletionKeydownFn = (${shouldStopEditableDeletionKeydown.toString()});
            document.addEventListener('keydown', event => {
                if (shouldStopEditableDeletionKeydownFn(
                    event.target,
                    document.activeElement,
                    event.key,
                    event.metaKey,
                    event.ctrlKey,
                    isEditable
                )) {
                    event.stopPropagation();
                }
            }, true);
            const videoDuration = () => Number.isFinite(video.duration) ? video.duration : 0;
            const nudgeFrame = direction => {
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                video.pause();
                seekTimelineTime(outputTime + direction / fps);
                stopAnimation();
            };
            const skipSeconds = seconds => {
                seekTimelineTime(outputTime + seconds);
                tick(true);
            };

            playToggle.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                togglePlayback();
            });
            frameBack.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                nudgeFrame(-1);
            });
            frameForward.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                nudgeFrame(1);
            });
            skipBack.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                skipSeconds(-10);
            });
            skipForward.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                skipSeconds(10);
            });
            waveformToggle.addEventListener('click', () => {
                const show = waveformRow.hidden;
                waveformRow.hidden = !show;
                waveformToggle.setAttribute('aria-pressed', String(show));
                if (!show) return;
                drawWaveform();
                updateWaveformPlayhead();
                void loadWaveform();
            });
            new ResizeObserver(() => {
                window.clearTimeout(waveformResizeTimer);
                waveformResizeTimer = window.setTimeout(() => {
                    if (waveformRow.hidden) return;
                    if (waveformState === 'ready') {
                        waveformPeaks = aggregateWaveform(waveformBinCount());
                    }
                    drawWaveform();
                }, 300);
            }).observe(waveformRow);
            const seekFromWaveformPointer = event => {
                const rect = waveformCanvas.getBoundingClientRect();
                const duration = segments.length > 0 ? totalTimelineDuration : videoDuration();
                if (rect.width <= 0 || duration <= 0) return;
                const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
                seekTimelineTime(fraction * duration);
                tick();
            };
            waveformCanvas.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                event.preventDefault();
                clearStaticAnnotationStrokes();
                waveformDragPointer = event.pointerId;
                waveformCanvas.setPointerCapture(event.pointerId);
                seekFromWaveformPointer(event);
            });
            waveformCanvas.addEventListener('pointermove', event => {
                if (waveformDragPointer !== event.pointerId) return;
                event.preventDefault();
                seekFromWaveformPointer(event);
            });
            const finishWaveformSeek = event => {
                if (waveformDragPointer !== event.pointerId) return;
                seekFromWaveformPointer(event);
                waveformDragPointer = null;
                if (waveformCanvas.hasPointerCapture(event.pointerId)) {
                    waveformCanvas.releasePointerCapture(event.pointerId);
                }
            };
            waveformCanvas.addEventListener('pointerup', finishWaveformSeek);
            waveformCanvas.addEventListener('pointercancel', event => {
                if (waveformDragPointer !== event.pointerId) return;
                waveformDragPointer = null;
            });
            zoomToggle.addEventListener('click', () => {
                zoomPopup.hidden = !zoomPopup.hidden;
                zoomToggle.setAttribute('aria-expanded', String(!zoomPopup.hidden));
            });
            indicatorToggle.addEventListener('click', () => {
                indicatorPopup.hidden = !indicatorPopup.hidden;
                indicatorToggle.setAttribute('aria-expanded', String(!indicatorPopup.hidden));
            });
            indicatorToggle.addEventListener('mouseenter', () => {
                indicatorPopup.hidden = false;
                indicatorToggle.setAttribute('aria-expanded', 'true');
            });
            zoomSlider.addEventListener('input', () => setZoom(sliderToZoom(Number(zoomSlider.value))));
            zoomSlider.addEventListener('dblclick', () => setZoom(1));
            for (const preset of document.querySelectorAll('.zoom-preset')) {
                preset.addEventListener('click', () => setZoom(Number(preset.getAttribute('data-zoom'))));
            }
            // capture 段で登録: パン開始の stopPropagation（ズーム中の previewPane pointerdown）に
            // 外側クリック検知が殺されないようにする
            document.addEventListener('pointerdown', event => {
                if (!zoomPopup.hidden && !event.target.closest('.transport-right')) {
                    zoomPopup.hidden = true;
                    zoomToggle.setAttribute('aria-expanded', 'false');
                }
                if (!indicatorPopup.hidden && !event.target.closest('.transport-left')) {
                    indicatorPopup.hidden = true;
                    indicatorToggle.setAttribute('aria-expanded', 'false');
                }
            }, true);
            previewPane.addEventListener('wheel', event => {
                if (!event.ctrlKey) return;
                event.preventDefault();
                const factor = Math.exp(-event.deltaY * 0.01);
                setZoom(clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX));
            }, { passive: false });
            const isDirectManipulationTarget = target => {
                if (!(target instanceof Element)) return false;
                if (target.closest('[data-overlay-id], [data-akari-interaction], #caption-plate, '
                    + '#layer-select-box, #layer-crop-box, #layer-crop-toggle, '
                    + '#layer-perspective-toggle, #layer-perspective-panel, #cut-select-box, #caption-select-box')) {
                    return true;
                }
                const layer = target.closest('[data-akari-layer-id]');
                if (layer && layer.dataset.akariLayerId === selectedLayerId) return true;
                return cutSelected && (target === video || target === stillImage);
            };
            previewPane.addEventListener('pointerdown', event => {
                if (penModeActive || zoom <= 1.05 || event.button !== 0) return;
                // ズーム中のパン開始判定は capture 段で previewPane 配下の pointerdown を扱う。
                // 奪っていたため、audio-notice の × 等インタラクティブ操作系の上で押しても
                // preventDefault() が click 合成を止めてしまい押せなくなっていた（実測: Chromium は
                // pointerdown.preventDefault() を呼ぶと後続の click を合成しない）。ボタンに加え、
                // 選択済みレイヤー/カット・オーバーレイの直接操作面も素通しする。Alt+drag は
                // 操作面の上からでも明示的にパンできる。
                if (event.target.closest && event.target.closest('button, [role="button"], input, textarea, select, a[href]')) return;
                if (!event.altKey && isDirectManipulationTarget(event.target)) return;
                event.preventDefault();
                event.stopPropagation();
                previewPane.setPointerCapture(event.pointerId);
                drag = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    base: { x: pan.x, y: pan.y },
                    didMove: false
                };
            }, true);
            previewPane.addEventListener('pointermove', event => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                event.preventDefault();
                event.stopPropagation();
                const dx = event.clientX - drag.startX;
                const dy = event.clientY - drag.startY;
                if (!drag.didMove && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) {
                    drag.didMove = true;
                    previewPane.classList.add('is-dragging');
                }
                if (!drag.didMove) return;
                pan = clampPan({ x: drag.base.x + dx, y: drag.base.y + dy });
                renderZoom();
            }, true);
            const finishPan = event => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                event.preventDefault();
                event.stopPropagation();
                const didMove = drag.didMove;
                drag = null;
                previewPane.classList.remove('is-dragging');
                if (previewPane.hasPointerCapture(event.pointerId)) previewPane.releasePointerCapture(event.pointerId);
                if (didMove) suppressClick = true;
            };
            previewPane.addEventListener('pointerup', finishPan, true);
            previewPane.addEventListener('pointercancel', finishPan, true);
            previewPane.addEventListener('click', event => {
                if (!suppressClick) return;
                suppressClick = false;
                event.preventDefault();
                event.stopPropagation();
            }, true);
            fullscreenToggle.addEventListener('click', () => {
                void window.akari.toggleFullscreen().catch(error => console.error('[akari-preview] fullscreen failed', error));
            });
            document.addEventListener('fullscreenchange', () => {
                const isFullscreen = Boolean(document.fullscreenElement);
                fullscreenToggle.setAttribute('aria-pressed', String(isFullscreen));
                fullscreenToggle.setAttribute('aria-label', isFullscreen ? '全画面解除' : '全画面');
                fullscreenToggle.title = isFullscreen ? '全画面解除' : '全画面';
                fullscreenToggle.innerHTML = isFullscreen ? restoreIcon : fullscreenIcon;
            });
            window.addEventListener('keydown', event => {
                if ((event.code !== 'Space' && event.key !== ' ')
                    || isEditable(event.target)
                    || isEditable(document.activeElement)
                    || playToggle.disabled) return;
                event.preventDefault();
                clearStaticAnnotationStrokes();
                togglePlayback();
            });
            seek.addEventListener('input', () => {
                clearStaticAnnotationStrokes();
                seekTimelineTime(Number(seek.value));
                tick();
            });
            let requestedOverlayId;
            const applyRequestedOverlaySelection = () => {
                if (requestedOverlayId === undefined) return;
                const selected = stage.querySelector('[data-overlay-id][data-akari-interaction-selected="true"]');
                const selectedId = selected?.getAttribute('data-overlay-id') || null;
                if (selectedId === requestedOverlayId) return;
                if (requestedOverlayId === null) {
                    if (selected) {
                        window.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
                        }));
                    }
                    return;
                }
                const target = Array.from(stage.querySelectorAll('[data-overlay-id]'))
                    .find(candidate => candidate.getAttribute('data-overlay-id') === requestedOverlayId);
                if (!target || getComputedStyle(target).visibility === 'hidden') return;
                const fragment = Array.from(target.children)
                    .find(candidate => !candidate.hasAttribute('data-akari-interaction'));
                const rect = (fragment || target).getBoundingClientRect();
                target.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2
                }));
            };
            video.addEventListener('loadedmetadata', () => {
                void sfxDurationsReady.then(() => {
                    restorePlayback();
                    rebuildSegments();
                    applyInitialPosition();
                    updateTransport();
                });
            });
            video.addEventListener('canplay', restorePlayback);
            video.addEventListener('play', () => {
                if (window.akari.previewAudio) void window.akari.previewAudio.playFrom(outputTime);
                if (isPlaying) startAnimation();
            });
            video.addEventListener('play', () => {
                // 無音素材の検知は 1 ドキュメントにつき 1 回だけ。判定は ffprobe による
                // ソースファイルの実測（initial.hasSourceAudio、node 側 probeAudioPresence）を
                // 正とする — webkitAudioDecodedByteCount はこのアプリが同梱する
                // Electron/Chromium では常に 0 のまま張り付き（実測確認済み）、実際に音声が
                // 再生されているソースでも誤検出する。hasSourceAudio が null（ffprobe 不在・
                // 失敗で未確定）のときは、確証が無いまま出すと偽陽性の原因になるため表示しない。
                window.setTimeout(() => {
                    if (audioNoticeShown || video.paused || video.ended) return;
                    if (initial.hasSourceAudio === false) {
                        audioNoticeShown = true;
                        audioNotice.hidden = false;
                    }
                }, 1500);
            });
            video.addEventListener('pause', () => {
                if (pausedForGapEntry) {
                    pausedForGapEntry = false;
                    return;
                }
                // Every intentional pause call site (togglePlayback's stop branch,
                // nudgeFrame, stopAtNaturalEnd, showPlaybackError) flips isPlaying
                // to false *before* calling video.pause(), so isPlaying still being
                // true here means the browser paused the element on its own -
                // observed reliably as a single spurious native pause ~0.3-0.8s
                // into the first playback of a large (100s+ MB) source.mp4 right
                // after a fresh <video> load (e.g. every full webview reload
                // triggered by an edit.json save while playing). Tearing down the
                // animation/audio loop here would leave the raw <video> decoding
                // ungoverned by tick() while previewAudio keeps its own independent
                // schedule - the "video/seekbar stuck, audio still going" freeze.
                // Resume instead; if that also fails, fall back to a real stop.
                const segment = segments[activeSegmentIndex];
                if (isPlaying && segment && segment.kind === 'src' && !isStillSegment(segment) && !video.ended) {
                    void video.play().catch(error => {
                        console.error('[akari-preview] unexpected pause auto-resume failed', error);
                        window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                        isPlaying = false;
                        if (window.akari.previewAudio) window.akari.previewAudio.pause();
                        stopAnimation();
                    });
                    return;
                }
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                stopAnimation();
            });
            video.addEventListener('ended', () => {
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                stopAnimation();
            });
            video.addEventListener('seeking', () => {
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
            });
            video.addEventListener('seeked', () => {
                tick(true);
                const segment = segments[activeSegmentIndex];
                if (isPlaying && segment && segment.kind === 'src' && !isStillSegment(segment)) {
                    if (window.akari.previewAudio) void window.akari.previewAudio.playFrom(outputTime);
                    if (video.paused) void video.play().catch(error => console.error('[akari-preview] playback failed', error));
                }
                applyRequestedOverlaySelection();
            });
            video.addEventListener('error', () => {
                showPlaybackError();
                const errorCode = video.error ? video.error.code : 0;
                // MediaError.MEDIA_ERR_DECODE = 3, MEDIA_ERR_SRC_NOT_SUPPORTED = 4 — 「宣言は
                // probably/maybe だったが実際には再生できなかった」ケースだけフォールバックを試す。
                if (errorCode === 3 || errorCode === 4) {
                    const segment = segments[activeSegmentIndex];
                    const sourceId = segment && segment.kind === 'src' ? String(segment.src) : '';
                    attemptHevcFallback(errorCode, initial.videoSourceUris[sourceId] || initial.videoUri);
                }
            });
            audioNoticeDismiss.addEventListener('click', () => {
                audioNotice.hidden = true;
            });
            const syncDeclaredTrackStates = () => {
                const tracks = summary.tracks || {};
                const syncScope = (scope, entries) => {
                    hiddenTracksByScope[scope].clear();
                    mutedTracksByScope[scope].clear();
                    for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
                        if (entry && entry.hidden === true) hiddenTracksByScope[scope].add(index);
                        if (entry && entry.muted === true) mutedTracksByScope[scope].add(index);
                    }
                };
                syncScope('cuts', tracks.cuts);
                syncScope('layers', tracks.layers);
                syncScope('audio', tracks.audio);
            };
            const applyIncrementalModel = nextSummary => {
                if (!nextSummary || typeof nextSummary !== 'object') return;
                const previousAudioJson = JSON.stringify(summary.audio || null);
                const previousTracksJson = JSON.stringify(summary.tracks || null);
                const activeCutIndex = segments[activeSegmentIndex]
                    && Number.isInteger(segments[activeSegmentIndex].cutIndex)
                    ? segments[activeSegmentIndex].cutIndex : null;
                summary = nextSummary;
                window.akari.state.summary = summary;
                rebuildVisualTrackZ();
                for (let index = 0; index < layerEntries.length; index += 1) {
                    applyIncrementalLayerSpec(layerEntries[index], summary.layers[index]);
                }
                if (previousTracksJson !== JSON.stringify(summary.tracks || null)) syncDeclaredTrackStates();
                rebuildSegments();
                if (activeCutIndex !== null) {
                    const matchingIndex = segments.findIndex(segment => segment.kind === 'src'
                        && segment.cutIndex === activeCutIndex);
                    if (matchingIndex >= 0) activeSegmentIndex = matchingIndex;
                } else {
                    const containingIndex = segments.findIndex(segment => outputTime >= segment.outStart
                        && outputTime < segment.outEnd);
                    if (containingIndex >= 0) activeSegmentIndex = containingIndex;
                }
                const activeSegment = segments[activeSegmentIndex];
                syncSegmentPlaybackRate();
                applyCutVisual(activeSegment);
                applyCutsZIndex(activeSegment);
                for (const entry of layerEntries) {
                    entry.video.style.zIndex = String(zForTrack(entry.spec.trackId));
                }
                for (const entry of filterEntries) {
                    entry.element.style.zIndex = String(zForTrack(entry.spec.trackId));
                }
                applyOverlayTracks();
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                const nextAudioJson = JSON.stringify(summary.audio || null);
                if (previousAudioJson !== nextAudioJson && window.akari.previewAudio?.updateConfig) {
                    void window.akari.previewAudio.updateConfig(summary.audio, outputTime, isPlaying);
                    void probeSfxDurations().then(() => {
                        rebuildSegments();
                        tick(true);
                    });
                }
                tick(true);
            };
            window.addEventListener('message', event => {
                const message = event.data;
                if (message && message.type === 'akari-preview-set-review-recording'
                    && typeof message.active === 'boolean') {
                    const wasRecordingActive = reviewRecordingActive;
                    reviewRecordingActive = message.active;
                    if (reviewRecordingActive && !wasRecordingActive) {
                        persistentStrokeItems = [];
                        annotationStrokeItems = [];
                        penLayer.dataset.akariStrokeSession = '';
                        redrawStaticBitmap();
                        recomposite();
                    }
                    penToggle.hidden = !reviewRecordingActive;
                    if (!reviewRecordingActive) {
                        abortCurrentStroke();
                        abortCurrentRect();
                        applyReviewToolMode('neutral');
                    } else if (typeof message.mode === 'string') {
                        // ReviewSessionRecorder（host）が唯一の正本 -- 右パネルの選択/ペン/四角
                        // ボタンやキーボードショートカットで切り替わった mode をここで反映する。
                        applyReviewToolMode(message.mode);
                    }
                    updateTransport();
                    return;
                }
                if (message && message.type === 'akari-preview-show-annotation-strokes') {
                    const strokes = Array.isArray(message.strokes)
                        ? message.strokes
                        : (Array.isArray(message.points)
                            ? message.points.map(points => ({ tool: 'pen', points })) : []);
                    showStaticAnnotationStrokes(strokes);
                    return;
                }
                if (message && message.type === 'akari-preview-show-session-strokes') {
                    showPersistentSessionStrokes(message);
                    return;
                }
                if (message && message.type === 'akari-preview-set-stroke-visibility'
                    && typeof message.visible === 'boolean') {
                    persistentStrokesVisible = message.visible;
                    penLayer.dataset.akariPersistentVisible = String(persistentStrokesVisible);
                    redrawStaticBitmap();
                    recomposite();
                    return;
                }
                if (message && message.type === 'akari-preview-captions-update') {
                    captions = Array.isArray(message.captions) ? message.captions : [];
                    renderCaption();
                    return;
                }
                if (message && message.type === 'akari-preview-model-update') {
                    applyIncrementalModel(message.summary);
                    return;
                }
                if (message && message.type === 'akari-preview-set-muted' && typeof message.muted === 'boolean') {
                    globalMuted = message.muted;
                    tick(true);
                    return;
                }
                if (message && message.type === 'akari-preview-set-track-visibility'
                    && Number.isInteger(message.track) && message.track >= 0 && typeof message.visible === 'boolean') {
                    if (message.visible) hiddenTracks.delete(message.track); else hiddenTracks.add(message.track);
                    applyTrackVisibility(message.track);
                    return;
                }
                if (message && message.type === 'akari-preview-set-track-visibility-v2') {
                    const { scope, track, hidden, muted } = message;
                    if ((scope === 'cuts' || scope === 'layers' || scope === 'audio') && typeof hidden === 'boolean') {
                        if (track === null) {
                            allTracksHiddenByScope[scope] = hidden;
                        } else if (Number.isInteger(track) && track >= 0) {
                            if (hidden) hiddenTracksByScope[scope].add(track);
                            else hiddenTracksByScope[scope].delete(track);
                        }
                    }
                    if ((scope === 'cuts' || scope === 'audio' || scope === 'layers') && typeof muted === 'boolean') {
                        if (track === null) {
                            allTracksMutedByScope[scope] = muted;
                        } else if (Number.isInteger(track) && track >= 0) {
                            if (muted) mutedTracksByScope[scope].add(track);
                            else mutedTracksByScope[scope].delete(track);
                        }
                    }
                    if (window.akari.previewAudio) {
                        window.akari.previewAudio.setMutedTracks(
                            mutedTracksByScope.audio, allTracksMutedByScope.audio
                        );
                    }
                    tick(true);
                    return;
                }
                if (message && message.type === 'akari-preview-set-track-visibility-v2-bulk') {
                    hiddenTracksByScope.cuts = new Set(Array.isArray(message.hiddenCuts) ? message.hiddenCuts : []);
                    mutedTracksByScope.cuts = new Set(Array.isArray(message.mutedCuts) ? message.mutedCuts : []);
                    hiddenTracksByScope.layers = new Set(Array.isArray(message.hiddenLayers) ? message.hiddenLayers : []);
                    mutedTracksByScope.layers = new Set(Array.isArray(message.mutedLayers) ? message.mutedLayers : []);
                    if (window.akari.previewAudio) {
                        window.akari.previewAudio.setMutedTracks(mutedTracksByScope.audio, allTracksMutedByScope.audio);
                    }
                    tick(true);
                    return;
                }
                if (message && message.type === 'akari-preview-set-captions-visibility'
                    && typeof message.visible === 'boolean') {
                    captionPlate.style.visibility = message.visible ? 'visible' : 'hidden';
                    return;
                }
                if (message && message.type === 'akari-preview-seek' && Number.isFinite(message.time)) {
                    seekTimelineTime(message.time);
                    tick();
                    return;
                }
                if (message && message.type === 'akari-preview-toggle-playback') {
                    togglePlayback();
                    return;
                }
                if (message && message.type === 'akari-preview-select-overlay'
                    && (typeof message.overlayId === 'string' || message.overlayId === null)) {
                    requestedOverlayId = message.overlayId;
                    applyRequestedOverlaySelection();
                }
                if (message && message.type === 'akari-preview-select-layer'
                    && (typeof message.layerId === 'string' || message.layerId === null)) {
                    selectLayer(message.layerId, { report: false });
                }
                if (message && message.type === 'akari-preview-live-transform' && message.target
                    && (message.target.kind === 'cut' || message.target.kind === 'layer')
                    && typeof message.field === 'string' && Number.isFinite(message.value)) {
                    // ドラッグ中の ephemeral 反映: summary/segments は一切書き換えず、applyCutVisual/
                    // layerEntries が読む dataset を直接上書きして updateLayerLayout() で再計算させるだけ。
                    // 確定書き込み(pointerup)後は edit.json 変更検知 → queueRefresh() の通常経路で
                    // 正規の HTML に置き換わるため、ここで明示的な「クリア」は不要
                    // （Esc 破棄時は元値を持つ同型メッセージが再送されて上書きされる）。
                    const applyLiveField = element => {
                        if (message.field === 'x') element.dataset.akariTransformX = String(message.value);
                        else if (message.field === 'y') element.dataset.akariTransformY = String(message.value);
                        else if (message.field === 'scale') element.dataset.akariTransformScale = String(message.value);
                        else if (message.field === 'rotate') element.dataset.akariTransformRotate = String(message.value);
                        else if (message.field === 'opacity') element.style.opacity = String(message.value);
                    };
                    if (message.target.kind === 'cut') {
                        if (message.field !== 'opacity') video.dataset.akariCutTransformActive = 'true';
                        applyLiveField(video);
                    } else if (typeof message.target.id === 'string') {
                        const layerIdSelector = CSS.escape(message.target.id);
                        const layerVideo = layersStage.querySelector(
                            'video[data-akari-layer-id="' + layerIdSelector + '"], img[data-akari-layer-id="' + layerIdSelector + '"]'
                        );
                        if (layerVideo) applyLiveField(layerVideo);
                    }
                    if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                    updateLayerSelectBox();
                    return;
                }
            });

            let lastReportedOverlayId = null;
            const reportOverlaySelectionChange = () => {
                const selected = stage.querySelector('[data-overlay-id][data-akari-interaction-selected="true"]');
                const selectedOverlayId = selected?.getAttribute('data-overlay-id') || null;
                if (selectedOverlayId !== lastReportedOverlayId) {
                    lastReportedOverlayId = selectedOverlayId;
                    requestedOverlayId = undefined;
                    window.akari.reportOverlaySelection(selectedOverlayId);
                }
            };
            new MutationObserver(reportOverlaySelectionChange).observe(stage, {
                attributes: true,
                attributeFilter: ['data-akari-interaction-selected'],
                subtree: true
            });

            Promise.all([window.__akariCaptionFontReady, window.akari.runtime.mount(summary), sfxDurationsReady]).then(() => {
                applyOverlayTracks();
                stage.append(transitionPlate, transitionFallbackLabel, captionPlate);
                refreshIndicators();
                rebuildSegments();
                applyInitialPosition();
                setZoom(1);
                tick();
                reportOverlaySelectionChange();
                applyRequestedOverlaySelection();
            }).catch(error => console.error('[akari-preview] overlay mount failed', error));
        })();`;
    }

    protected async isInsideWorkspace(uri: URI): Promise<boolean> {
        const value = uri.toString();
        return (await this.workspaceService.roots).some(root => {
            const prefix = root.resource.toString().replace(/\/$/, '') + '/';
            return value === root.resource.toString() || value.startsWith(prefix);
        });
    }

    protected streamOrigin(source: string): string {
        const parsed = new URL(source);
        return parsed.origin;
    }

    protected async disposeVideoStream(widget: PreviewWidgetMarker): Promise<void> {
        const id = widget.akariPreviewStreamId;
        widget.akariPreviewStreamId = undefined;
        if (id) {
            await this.disposeVideoStreamId(id);
        }
    }

    protected async disposeVideoStreamId(id: string): Promise<void> {
        try {
            await this.previewService.disposeVideoStream(id);
        } catch (error) {
            console.warn(`[akari-preview] failed to dispose video stream ${id}`, error);
        }
    }

    protected async disposeAssetStreams(ids: string[]): Promise<void> {
        await Promise.all(ids.map(async id => {
            try {
                await this.previewService.disposeAssetStream(id);
            } catch (error) {
                console.warn(`[akari-preview] failed to dispose asset stream ${id}`, error);
            }
        }));
    }

    protected async disposePreviewStreams(widget: PreviewWidgetMarker): Promise<void> {
        const assetIds = widget.akariPreviewAssetStreamIds ?? [];
        widget.akariPreviewAssetStreamIds = [];
        const extraIds = widget.akariPreviewExtraStreamIds ?? [];
        widget.akariPreviewExtraStreamIds = [];
        await Promise.all([
            this.disposeVideoStream(widget),
            ...extraIds.map(id => this.disposeVideoStreamId(id)),
            this.disposeAssetStreams(assetIds)
        ]);
        widget.akariPreviewDeferredTelopReady = undefined;
    }

    protected readText(uri: URI): Promise<string> {
        return this.fileService.readFile(uri).then(content => content.value.toString());
    }

    protected toBase64(bytes: Uint8Array): string {
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return btoa(binary);
    }

    protected transform(value: any): OverlayTransform {
        return {
            x: this.finiteNumber(value?.x, 0),
            y: this.finiteNumber(value?.y, 0),
            scale: this.finiteNumber(value?.scale, 1),
            rotate: this.finiteNumber(value?.rotate, 0)
        };
    }

    protected objectRecord(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    }

    protected stringRecord(value: unknown): Record<string, string> {
        return Object.fromEntries(Object.entries(this.objectRecord(value)).map(([key, item]) => [key, String(item)]));
    }

    protected normalizeEmphasisWords(value: unknown): EditSummaryEmphasisWord[] {
        if (value === undefined) {
            return [];
        }
        if (!Array.isArray(value)) {
            console.warn('[akari-preview] emphasis_words を無視しました（配列ではありません）');
            return [];
        }
        const seenIds = new Set<string>();
        const normalized: EditSummaryEmphasisWord[] = [];
        for (const [index, item] of value.entries()) {
            const candidate = item && typeof item === 'object' && !Array.isArray(item)
                ? item as Record<string, unknown>
                : undefined;
            const valid = candidate !== undefined
                && typeof candidate.id === 'string'
                && /^e-\d{4}$/u.test(candidate.id)
                && !seenIds.has(candidate.id)
                && typeof candidate.t_start === 'number'
                && Number.isFinite(candidate.t_start)
                && candidate.t_start >= 0
                && typeof candidate.t_end === 'number'
                && Number.isFinite(candidate.t_end)
                && candidate.t_end > candidate.t_start
                && typeof candidate.word === 'string'
                && /\S/u.test(candidate.word)
                && typeof candidate.emotion === 'string'
                && /\S/u.test(candidate.emotion)
                && (candidate.src === undefined || (typeof candidate.src === 'string' && /\S/u.test(candidate.src)))
                && (candidate.style_hint === undefined || typeof candidate.style_hint === 'string');
            if (!valid || !candidate) {
                console.warn(`[akari-preview] emphasis_words[${index}] を無視しました（要素が不正です）`);
                continue;
            }
            seenIds.add(candidate.id as string);
            normalized.push({
                id: candidate.id as string,
                ...(candidate.src !== undefined ? { src: candidate.src as string } : {}),
                t_start: candidate.t_start as number,
                t_end: candidate.t_end as number,
                word: candidate.word as string,
                emotion: candidate.emotion as string,
                ...(candidate.style_hint !== undefined ? { style_hint: candidate.style_hint as string } : {})
            });
        }
        return normalized;
    }

    protected finiteNumber(value: unknown, fallback: number): number {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    protected positiveNumber(value: unknown, fallback: number): number {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    // Single implementation of the edit.json asset path resolution judgment (previously
    // duplicated inline in resolveAudioAssets()). classifyEditAssetPath() is a pure, platform-
    // independent helper covered by node --test (see ../common/edit-asset-path.ts); this method
    // is just the thin Theia URI construction on top of it. Order: file: scheme, then Windows
    // drive-letter absolute, then UNC, then POSIX absolute, then relative (resolved against the
    // edit.json's parent directory). edit.json's own canon is project-relative paths, so darwin
    // never actually receives a "C:\..." value in practice; this only has to be correct in
    // principle for a future Windows port, not exercised end-to-end on this platform.
    protected resolveEditAssetUri(pathValue: string, editUri: URI): URI {
        switch (classifyEditAssetPath(pathValue)) {
            case 'file-uri':
                return new URI(pathValue);
            case 'windows-drive':
                return new URI(windowsDriveToFileUriString(pathValue));
            case 'unc':
                return new URI(uncToFileUriString(pathValue));
            case 'posix-absolute':
                return new URI(pathValue).withScheme('file');
            case 'relative':
            default:
                return editUri.parent.resolve(pathValue);
        }
    }

    protected previewProxyUri(sourceUri: URI): URI {
        const base = sourceUri.path.base;
        const proxyBase = /\.mov$/i.test(base)
            ? base.replace(/\.mov$/i, '.preview.webm')
            : `${base}.preview.webm`;
        return sourceUri.parent.resolve(proxyBase);
    }

    protected hash(value: string): string {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    protected safeJson(value: unknown): string {
        return JSON.stringify(value)
            .replace(/</g, '\\u003c')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029');
    }

    protected escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    protected inlineScript(value: string): string {
        return value.replace(/<\/script/gi, '<\\/script');
    }

    protected inlineStyle(value: string): string {
        return value.replace(/<\/style/gi, '<\\/style');
    }

}

@injectable()
export class AkariOutputPreviewOpenHandler implements OpenHandler {
    readonly id = 'akari-output-preview-open-handler';

    @inject(AkariPreviewOpenHandler)
    protected readonly previewHandler: AkariPreviewOpenHandler;

    canHandle(uri: URI): number {
        return uri.path.base === 'edit.json' ? 1200 : 0;
    }

    open(uri: URI, options?: any): Promise<WebviewWidget> {
        return this.previewHandler.openOutput(uri, options);
    }
}
