import { previewSelectionHandlesStyle } from './preview-selection-handles-style';
import { PREVIEW_CONTEXT_BOX_MESSAGE, PreviewContextBar } from './preview-context-bar';
import { photoToolsAvailableFor } from '../common/context-bar-view';
import { previewContextBarPageScript } from './preview-context-bar-page';
import { previewShapeRoles } from '../common/preview-shape-roles';
import { previewLiveValues } from '../common/preview-live-values';
import { composePreviewTransforms, previewTransformAxes } from '../common/preview-transform';
import { canvasDropTargets } from '../common/canvas-drop-target';
import { runPreviewFrameCaptureAttempts } from '../common/preview-frame-check';
import { PreviewFrameCapturePending } from '../common/preview-frame-controller';
import { PreviewFrameRequestMessage, PreviewFrameReadyMessage, PreviewFrameCommand } from '../common/preview-frame-capture';
import { SwapTrialPlayback, SwapTrialIdentity, logSwapTrial } from '../common/swap-trial-playback';
import { requestReadyPreviewSeek } from '../common/preview-ready-seek';
import { PreviewPlaceholderInput, previewPlaceholderHtml } from '../common/preview-placeholder';
import { isMaterialPreviewWidgetId } from '../common/material-preview-slot';
import { isProjectVideoCandidatePath } from '../common/video-candidate-preview';
import { MaterialPreviewSlot } from './material-preview-slot';
import { PreviewLibraryDrop } from './preview-library-drop';
import URI from '@theia/core/lib/common/uri';
import { AudioMeterFrame, isAudioMeterFrame } from '../common/audio-meter-model';
import { AkariAudioMeterWidget } from './akari-audio-meter-widget';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { selectPreviewAudioItemsAt } from '../common/preview-audio-priority';
import { previewAudioTrimOf } from '../common/preview-audio-trim';
import {
    CommandRegistry,
    CommandService,
    Emitter,
    Event as TheiaEvent,
    MenuModelRegistry,
    MessageService
} from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import {
    ApplicationShell,
    ContextMenuRenderer,
    FrontendApplicationContribution,
    OpenHandler,
    OpenerService,
    WidgetManager,
    open
} from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangesEvent, FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WEBVIEW_CONTEXT_MENU, WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    buildCaptionTimelineSegments,
    captionEditNotices,
    updateCaptionFieldsInSourceWithReport,
    updateCaptionRunsInSource,
    collectExcludedCaptionIds,
    isAudioItemAudible,
    isUnknownKeyEditError,
    newerSavedByVersion,
    newerVersionOpenNotice,
    normalizeCaptionClock,
    projectLegacyAudioView,
    projectAudioFadeShapes,
    projectSpeechDeclarations,
    resolveInternalTrackZ,
    resolvePreviewItemWrite,
    resolvePreviewItemWriteBatch,
    selectGenerationSidecarForSource,
    SAVED_BY_PATH,
    toAnchorCaptions,
    TimelineSegment
} from '@akari-video/edit-store';
import type { EditV2, GenerationMetaV1, InternalEdit } from '@akari-video/edit-store';
import type { PreviewItemWriteCommand } from '@akari-video/edit-store';
import {
    describePreviewWebviewRole,
    guardedKeyHandler,
    isSuspiciousKeyEventShape,
    previewDiagnosticsKindFromWidgetId
} from '../common/preview-init-diagnostics';
import {
    PREVIEW_DIAGNOSTICS_LOG_RELATIVE_PATH,
    PreviewDiagnosticsCenter,
    PreviewDiagnosticsLog,
    createDomPreviewDiagnosticsOverlay,
    isPreviewDiagnosticsReport,
    shouldDeliverPreviewRendererGone
} from './preview-diagnostics';
import {
    AssetStreamRequest,
    AkariPreviewService,
    OverlayRuntimeAssetUrls,
    PreviewAudioSidecarRequest,
    ReadGenerationSidecarsResult,
    VideoStreamReference,
    VideoStreamRequest
} from '../common/akari-preview-protocol';
import { AudioClipFx, audioClipFxOf, hasAudioClipFx, previewAudioSidecarRequestFor } from '../common/audio-clip-fx';
import { classifyEditAssetPath, uncToFileUriString, windowsDriveToFileUriString } from '../common/edit-asset-path';
import { assertNoSessionAssetUrl, materializedFragmentPlan, patchFragmentSourceText, replaceFragmentReference, withoutFragmentRootTiming } from './fragment-source-write';
import { serializeEdit } from '@akari-video/edit-store/lib/canonical';
import {
    THREE_SCENE_KEYS,
    hasThreeDimensionalTextOverlay,
    resolveThreeSceneDescriptorAssets,
    threeSceneDeclarations
} from '../common/three-scene-assets';
import { resolvePreviewCaptionTrackOrder, resolvePreviewItemStackOrder } from '../common/caption-track-order';
import {
    persistCaptionCuePosition,
    persistCaptionCuePositionReset,
    persistCaptionGroupPosition,
    persistCaptionGroupZone,
    persistCaptionText,
    persistCaptionZone,
    updateCaptionToolStyleSource,
    updateCaptionCuePositionsSource,
    resetCaptionCueGeometrySource
} from '../common/caption-zone-write';
import { persistCaptionPlateTransform } from '../common/caption-plate-handles';
import { parseCaptionInspectorPositionAction } from '../common/caption-position-preset';
import { duplicatePreviewCaptionSource, duplicatePreviewItemSource } from '../common/preview-duplicate-fallback';
import { PreviewCaptionWrite, previewCaptionWrite } from '../common/preview-caption-write';
import { collectItems, hasInlineCaptions, projectPreviewCaptionRows, readPreviewInternalEdit } from '../common/preview-items';
import { parseRenderScaleMode, RenderScaleMode } from '../common/frame-engine-render-scale';
import { isAlphaIntakeSource } from '../common/alpha-intake-routing';
import { expandBagOverlays, projectBagChildren, scanHtmlParts } from '../common/preview-parts';
import { buildItemKeyframeSummaryFields, resolvePreviewItemKeyframes } from '../common/item-keyframes-summary';
import {
    CAPTION_FONT_FAMILY,
    CAPTION_FONT_LOAD_DESCRIPTOR,
    captionFontFaceCss
} from '../common/caption-visual-contract';
import { bundledCaptionFontFaceCss } from '../common/bundled-caption-fonts';
import { dispatchPhotoAnalysis } from '../common/photo-analysis-dispatch';
import { isNestedPreviewLayer } from '../common/preview-nested-layer';
import {
    PREVIEW_Z_ORDER_MENU_ITEMS,
    previewGroupMenuVisible,
    previewZOrderMenuVisible
} from '../common/preview-context-menu';
import {
    buildCaptionAnimatorSummaryFields,
    buildCutSummaryFields,
    buildLayerSummaryBase,
    ChromaKeySummary,
    normalizeChromaKeyForSummary
} from '../common/edit-summary-fields';
import { normalizePersistentStrokeItems } from '../common/pen-canvas-visuals';
import { resolveRegularSidecarPlan, resolveSpeechSidecarFormat, sortSidecarRequestsByFirstUse } from '../common/preview-audio-eligibility';
import { planRawPreviewAudioSidecar, rawPreviewProjectRootCandidates, selectRawPreviewProjectRoot } from '../common/raw-preview-audio';
import { clampPreviewPlaybackRate } from '../common/preview-playback-rate';
import {
    classifyPreviewModelUpdate,
    isOwnAssetReferenceChange,
    isPreviewModelResourceChange,
    previewModelUpdateAction
} from '../common/preview-model-diff';
import type { PreviewModelDiffInput } from '../common/preview-model-diff';
import { previewTrackedResourceSets } from '../common/motion-bag-preview-update';
import {
    capturePreviewPlaybackTick,
    shouldCapturePreviewPlaybackTick,
    resolvePreviewRefreshRestore
} from '../common/preview-refresh-state';
import { PreviewGestureGuard, reducePreviewGesture } from '../common/preview-gesture-guard';
import { summarizePreviewError } from '../common/preview-error-summary';
import { resolvePreferredVideoUri } from '../common/video-proxy-resolution';
import { createRafThrottle } from '../common/raf-throttle';
import {
    neutralizeWebviewDefaultStylesForOverlays,
    scopeSelectorOutsideOverlays
} from '../common/webview-default-style-scope';
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
import { transitionRawPreviewFocus } from '../common/review-preview-state';
import {
    loadCaptionDisplayFailOpen,
    locatePreviewCaptions,
    parsePreviewCaptions,
    parseResolvedPreviewCaptions
} from './akari-preview-captions';
import { listen } from './akari-preview-listen';
import { resolveOutputOpenFocusMode } from './open-focus-mode';
import { ReviewSessionRecorder, ReviewSessionUiState, ReviewTransportSnapshot } from './review-session-recorder';
import { ReviewSessionRecordingIndicator } from './review-session-recording-indicator';
import { describeOverlay, resolveGenerationState } from '../common/generation-overlay-model';
import { previewDiagnosticsGuardScript, previewDiagnosticsTailScript } from './preview-script-diagnostics';
import { hostAdapterScript } from './preview-script-host-adapter';
import { frameEngineWatchdogScript } from './preview-script-frame-engine-watchdog';
import { frameEngineBootstrapScript } from './preview-script-frame-engine-bootstrap';
import { previewBootstrapScript } from './preview-script-bootstrap';
import type {
    OverlayTransform,
    EditSummaryOverlay,
    EditSummaryLayer,
    EditSummaryFilter,
    EditSummaryAdjust,
    PreviewCaptionClockInput,
    OutputPreviewCaption,
    LoadedPreviewCaptions,
    EditSummaryCut,
    PreviewAudioSidecarRequestResult,
    PreviewAudioService,
    PreviewAudioPendingRequest,
    PreviewAudioSidecarEntry,
    PreviewAudioSidecarFields,
    VideoFxBackground,
    VideoFxChromaKey,
    EditSummaryVideoFx,
    EditSummaryBgm,
    EditSummaryTimedAudio,
    EditSummaryAudio,
    EditSummaryEmphasisWord,
    EditSummaryTrackState,
    EditSummaryTracks,
    EditSummaryTimelineTrack,
    PreviewSelectionNode,
    EditSummary,
    PreviewModel,
    PreviewSetZoomMessage,
    PreviewSetRateMessage,
    PreviewSetPlaybackMessage,
    PreviewSetCropModeMessage,
    PreviewSetPerspectivePanelMessage,
    PreviewPulseItemMessage,
    PreviewZoneHintMessage,
    OverlayWriteRequest,
    OverlayWriteBatchRequest,
    LayerWriteRequest,
    CutWriteRequest,
    CaptionZoneValue,
    CaptionWriteRequest,
    PreviewCaptionSelectedRequest,
    HevcFallbackRequest,
    PreviewReviewStrokeStartRequest,
    PreviewReviewStrokeEndRequest,
    PreviewReviewRectStartRequest,
    PreviewReviewRectEndRequest,
    PreviewReviewToolModeRequest,
    ReviewAnnotationStrokeRequest,
    PreviewWidgetMarker,
    TranscriptSeekRequest,
    EnsureVisibleRequest,
    SeekOutputRequest,
    TogglePlaybackRequest,
    CompactTracksRequest,
    SetPreviewFullscreenRequest,
    SetPreviewViewZoomRequest,
    SetPreviewPlaybackRateExternalRequest,
    SetPreviewLoopRangeRequest,
    PreviewPlaybackControlRequest,
    PreviewCropModeRequest,
    PreviewPerspectivePanelRequest,
    PulsePreviewItemRequest,
    ShowPreviewZoneHintRequest,
    PreviewPlaybackTickRequest,
    PreviewOverlaySelectedRequest,
    PreviewLayerSelectedRequest,
    PreviewCutSelectedRequest,
    PreviewReviewTransportRequest,
    ReviewSessionControlRequest,
    ReviewSessionViewerSyncDetail,
    ReviewToolModeSetRequest,
    PreviewSessionSettings,
    TrackVisibilityV2Request
} from './preview-host-types';
import {
    isPreviewColorLike,
    CAPTION_ZONES,
    TRANSCRIPT_SEEK_COMMAND_ID,
    PREVIEW_FULLSCREEN_CLASS,
    PREVIEW_FULLSCREEN_ANCESTOR_CLASS,
    PREVIEW_FULLSCREEN_STYLE_ID,
    PREVIEW_PLAYBACK_TICK_EVENT,
    RAW_PREVIEW_ANNOTATION_STATE_EVENT,
    TIMELINE_OVERLAY_SELECTED_EVENT,
    CAPTION_ZONE_HOVER_EVENT,
    CAPTION_ZONE_PRESET_EVENT,
    TIMELINE_LAYER_SELECTED_EVENT,
    EDIT_STORE_DID_WRITE_EVENT,
    RECENT_WRITE_WINDOW_MS,
    TIMELINE_SET_MUTED_EVENT,
    TIMELINE_SET_TRACK_VISIBILITY_EVENT,
    TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT,
    TIMELINE_SET_CLIPS_VISIBILITY_EVENT,
    TIMELINE_SET_OVERLAY_TRACK_MUTED_EVENT,
    TIMELINE_SET_LAYERS_VISIBILITY_EVENT,
    TIMELINE_SET_LAYERS_MUTED_EVENT,
    TIMELINE_SET_AUDIO_VISIBILITY_EVENT,
    TIMELINE_SET_AUDIO_MUTED_EVENT,
    TIMELINE_SET_CAPTIONS_MUTED_EVENT,
    TIMELINE_SET_BEATS_VISIBILITY_EVENT,
    TIMELINE_SET_BEATS_MUTED_EVENT,
    TIMELINE_SYNC_TRACK_TOGGLES_EVENT,
    TIMELINE_LIVE_TRANSFORM_EVENT,
    TIMELINE_ADJUST_BYPASS_EVENT,
    PREVIEW_ADJUST_BYPASS_QUERY_EVENT,
    TIMELINE_LOOP_RANGE_EVENT,
    PREVIEW_OVERLAY_SELECTED_EVENT,
    PREVIEW_LAYER_SELECTED_EVENT,
    PREVIEW_CUT_SELECTED_EVENT,
    PREVIEW_CAPTION_SELECTED_EVENT,
    REVIEW_SESSION_START_EVENT,
    REVIEW_ANNOTATION_SHOW_STROKES_EVENT,
    REVIEW_SESSION_STOP_EVENT,
    REVIEW_SESSION_REFRESH_EVENT,
    REVIEW_SESSION_OPEN_FOLDER_EVENT,
    REVIEW_SESSION_STATE_EVENT,
    REVIEW_SESSION_VIEWER_SYNC_EVENT,
    REVIEW_TOOL_MODE_SET_EVENT,
    REVIEW_UI_SELECTION_CLEAR_EVENT,
    ATTACH_TIMELINE_PASSIVE_COMMAND_ID,
    ENSURE_PREVIEW_VISIBLE_COMMAND,
    SEEK_OUTPUT_PREVIEW_COMMAND,
    CAPTURE_OUTPUT_PREVIEW_FRAME_COMMAND,
    TOGGLE_OUTPUT_PREVIEW_PLAYBACK_COMMAND,
    COMPACT_TRACKS_COMMAND,
    ANNOTATE_PREVIEW_AT_POINT_COMMAND,
    GROUP_PREVIEW_COMMAND,
    UNGROUP_PREVIEW_COMMAND,
    SET_PREVIEW_FULLSCREEN_COMMAND,
    SET_PREVIEW_VIEW_ZOOM_COMMAND,
    SET_PREVIEW_PLAYBACK_RATE_COMMAND,
    SET_PREVIEW_LOOP_RANGE_COMMAND,
    PREVIEW_PLAY_COMMAND,
    PREVIEW_PAUSE_COMMAND,
    PREVIEW_CROP_MODE_COMMAND,
    PREVIEW_PERSPECTIVE_PANEL_COMMAND,
    PULSE_PREVIEW_ITEM_COMMAND,
    SHOW_PREVIEW_ZONE_HINT_COMMAND,
    OPEN_AKARI_REVIEW_PANEL_COMMAND_ID,
    CLIP_ANNOTATION_REQUEST_EVENT,
    COMPACT_TRACKS_ACTION,
    KEEP_TRACKS_ACTION,
    PREVIEW_OPEN_TIMEOUT_MS,
    PREVIEW_OPEN_ATTEMPTS,
    PREVIEW_OPEN_ERROR_MESSAGE,
    EMPTY_SUMMARY,
    isSkippedSearchDirectory,
    PLAYABLE_VIDEO_MIME_TYPES,
    CLAIMED_VIDEO_EXTENSIONS,
    UNSUPPORTED_FORMAT_MESSAGE,
    OUTSIDE_WORKSPACE_MESSAGE,
    EMPTY_PROJECT_MESSAGE,
    LAYER_BLEND_TO_CSS,
    GLTF_HEADER_PROBE_BYTES
} from './preview-host-constants';
import {
    isPlaybackTickRequest,
    isPlaybackRateRequest,
    isReviewTransportRequest,
    isReviewStrokeStartRequest,
    isReviewStrokeEndRequest,
    isReviewRectStartRequest,
    isReviewRectEndRequest,
    isReviewToolModeRequest,
    isOverlaySelectedRequest,
    isLayerSelectedRequest,
    isCutSelectedRequest,
    isCaptionSelectedRequest,
    isOverlayWriteBatchRequest,
    isOverlayWriteRequest,
    validateLayerTransformPatch,
    validateLayerCropPatch,
    validateLayerPerspectivePatch,
    isCutWriteRequest,
    isCaptionWriteRequest,
    isLayerWriteRequest,
    isHevcFallbackRequest,
    isOpenOutputRequest
} from './preview-host-message-guards';
import {
    defaultSessionSettings,
    resolveReviewStrokeCutIndex,
    nearestPreviewRatePreset,
    runStyleChoices,
    detectUnsupportedGltfExtensions,
    captionWriteLabel,
    objectRecord
} from './preview-host-values';
import { normalizeReviewEditUri, reviewEditUriForPreview, previewProxyUri } from './preview-host-uris';

// task 2026-08-10-image-layer-parity 司令塔裁定1: layers[].src の拡張子だけで静止画判定する
// （schema の kind は 'video' のまま不変）。render-cut 側の同じ判定
// （packages/render-cut/src/layers.mjs の isImageLayerSource）と対象拡張子集合を完全に揃える。
// 独立した関数として export しているのは webview 生成 HTML の外（この TS モジュール自身）から
// node --test で直接叩けるようにするため（test/image-layer-source.test.mjs）。
const IMAGE_LAYER_SRC_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/i;
export const isImageLayerSrc = (src: string | undefined): boolean =>
    typeof src === 'string' && IMAGE_LAYER_SRC_PATTERN.test(src);

/** A motion preview changes glyphs inside the positioned caption, never the outer row host. */
export function captionMotionTextTargets(host: Pick<Element, 'querySelectorAll'>): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.akari-caption__line'))
        .filter(line => Boolean(line.textContent?.trim()));
}

/** A saved cue may redraw shortly after a click; replay only while that request is still current. */
export function shouldResumeCaptionMotion(request: { captionId: string; expiresAt: number } | null,
    activeCaptionIds: readonly string[], now: number): boolean {
    return !!request && now < request.expiresAt && activeCaptionIds.includes(request.captionId);
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
): OutputPreviewCaption[] => normalizeCaptionClock(captions, segments);

const Z_ORDER_PREVIEW_MENU = [...WEBVIEW_CONTEXT_MENU, 'akari-preview-z-order'];

@injectable()
export class AkariPreviewOpenHandler implements OpenHandler, FrontendApplicationContribution {
    protected lastCaptionRunNotice: string | undefined;
    readonly id = 'akari-preview-open-handler';
    protected readonly onDidWriteCaptionEmitter = new Emitter<PreviewCaptionWrite>();
    readonly onDidWriteCaption: TheiaEvent<PreviewCaptionWrite> = this.onDidWriteCaptionEmitter.event;
    // 「最近この URI へ書いた」台帳。URI 文字列キーと resourceSuffix キーの両方を入れる
    // （ワークスペース watcher は realpath 済みの URI で通知してくるため、シンボリックリンクを
    // 跨ぐワークスペースでは URI 文字列が食い違う。suffix なら一致する）。
    protected readonly recentWrites = new Map<string, number>();
    protected readonly previewGestureGuards = new WeakMap<PreviewWidgetMarker, PreviewGestureGuard>();
    protected readonly openPreviews = new Map<string, PreviewWidgetMarker>();
    protected readonly openOutputPreviews = new Map<string, PreviewWidgetMarker>();
    protected readonly videoCandidatePreviews = new Map<string, {
        widget: PreviewWidgetMarker; itemId: string; videoStreamId?: string; audioStreamId?: string;
        audioTimer?: ReturnType<typeof setTimeout>;
    }>();
    protected readonly pendingFrameCaptures = new PreviewFrameCapturePending<PreviewWidgetMarker>();
    protected readonly previewSessionSettings = new Map<string, PreviewSessionSettings>();
    protected readonly pendingOutputInitialSeek = new Map<string, number>();
    protected readonly placeholderPreviewStates = new WeakMap<WebviewWidget, {
        input: PreviewPlaceholderInput;
        layer: HTMLElement;
        listener?: Disposable;
        timeout?: ReturnType<typeof setTimeout>;
    }>();
    protected readonly placeholderPreviewWidgets = new Map<string, WebviewWidget>();
    protected readonly reviewTransportByEdit = new Map<string, ReviewTransportSnapshot>();
    protected readonly lastRawEditVersionByUri = new Map<string, 0 | 1 | 2>();
    protected readonly captionDisplayFallbackState: { lastCode?: string } = {};
    protected readonly lastLoadedCaptions = new Map<string, LoadedPreviewCaptions>();
    protected readonly migrationCompactionPrompted = new Set<string>();
    // task/2026-08-09-drop-hevc-proxy: 実際に再生失敗した動画（videoUri.toString() をキー）だけを
    // 憶えておくフォールバック台帳。既定経路（resolveStreamVideoUri）はここに載っている場合だけ
    // プロキシを使う。新規生成のトリガーは handleHevcFallbackRequest のみ（このプロセスの生存中は
    // 一度成功/失敗した判定を使い回す — アプリ再起動でクリアされる程度の弱いキャッシュで十分）。
    protected readonly hevcFallbackProxyUris = new Map<string, string>();
    protected readonly hevcFallbackAttempted = new Set<string>();
    protected readonly layerDimensionCache = new Map<string, { width: number; height: number }>();
    protected readonly layerDimensionProbes = new Map<string, Promise<{ width: number; height: number } | undefined>>();
    protected readonly previewMessageReadyPages = new WeakMap<PreviewWidgetMarker, string>();
    protected previewItemWriteTail = Promise.resolve();
    protected captionWriteTail = Promise.resolve();
    protected readonly lifecycleDisposables = new DisposableCollection();
    /** バックエンドでプロセス寿命中不変の約 13MB ランタイム資産を、frontend でも RPC 1 回に畳む。 */
    protected overlayRuntimeAssetsPromise: Promise<OverlayRuntimeAssetUrls> | undefined;
    /** frame-engine 込みは巨大なので、legacy 用の通常資産とは別の RPC キャッシュにする。 */
    protected frameEngineOverlayRuntimeAssetsPromise: Promise<OverlayRuntimeAssetUrls> | undefined;
    /** 環境変数はセッション中に変わらないため、backend RPC は最初の 1 回だけにする。 */
    protected frameEngineEnvOverridePromise: Promise<string | undefined> | undefined;
    protected frameEngineReadyTimeoutMsPromise: Promise<number | undefined> | undefined;
    protected readonly timelineOverlaySelections = new Map<string, string | null>();
    protected readonly timelineLayerSelections = new Map<string, string | null>();
    protected readonly primaryTimelineSelections = new Map<string, { kind: 'cut' | 'caption'; id: string } | null>();
    protected readonly timelineCaptionSelections = new Map<string, { captionIds: string[]; primaryCaptionId: string | null }>();
    protected readonly timelineGroupSelections = new Map<string, Array<{ kind: 'caption' | 'layer' | 'overlay'; id: string }>>();
    protected reviewSessionRecorder: ReviewSessionRecorder | undefined;
    protected reviewSessionRecordingIndicator: ReviewSessionRecordingIndicator | undefined;
    protected readonly reviewSessionStateByEdit = new Map<string, ReviewSessionUiState>();
    protected pendingSessionViewerTick: ReviewSessionViewerSyncDetail | undefined;
    protected readonly sessionViewerSeekThrottle = createRafThrottle(() => {
        const detail = this.pendingSessionViewerTick;
        this.pendingSessionViewerTick = undefined;
        if (!detail || !Number.isFinite(detail.timelineT)) return;
        const editUri = normalizeReviewEditUri(detail.editUri);
        this.openOutputPreviews.get(editUri ?? '')?.sendMessage({
            type: 'akari-preview-seek', time: detail.timelineT
        });
    });
    protected readonly reviewStrokeVisibilityByEdit = new Map<string, boolean>();
    protected retryWidgetSequence = 0;
    protected activeRawPreviewWidget: PreviewWidgetMarker | undefined;
    protected rawPreviewActivation = 0;
    protected lastClipAnnotationContext: {
        editUri: string; timelineT: number; itemId?: string; kind?: 'cut';
    } | undefined;
    protected previewGroupMenuContext?: {
        source: 'akari-output-preview'; editUri: string; selectedIds: string[];
        selectionKind: 'leaf' | 'group' | 'multi'; selectedNodeKind?: 'leaf' | 'group' | 'bag';
        scopeNodeKind?: 'leaf' | 'group' | 'bag';
        scopeId: string | null;
    };

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(MaterialPreviewSlot)
    protected readonly materialSlot: MaterialPreviewSlot;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(AkariPreviewService)
    protected readonly previewService: AkariPreviewService;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    @inject(MenuModelRegistry)
    protected readonly menuModelRegistry: MenuModelRegistry;

    @inject(ContextMenuRenderer)
    protected readonly contextMenuRenderer: ContextMenuRenderer;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(ApplicationServer)
    protected readonly applicationServer: ApplicationServer;

    protected currentAppVersionPromise?: Promise<string | undefined>;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    @inject(EnvVariablesServer)
    protected readonly envVariables: EnvVariablesServer;

    /**
     * 診断の集約。onStart で組み立てる。stub された host（テスト）では undefined のままなので、
     * 呼び出しは必ず `this.previewDiagnostics?.` で行う。
     */
    protected previewDiagnostics: PreviewDiagnosticsCenter | undefined;
    protected readonly previewDiagnosticsWidgets = new Map<string, PreviewWidgetMarker>();

    protected async reopenStoppedPreview(widget: PreviewWidgetMarker): Promise<void> {
        if (widget.isDisposed) return;
        const { id, viewId } = widget.identifier;
        const kind = previewDiagnosticsKindFromWidgetId(id);
        if (!kind || !viewId) return;
        const uri = new URI(viewId).normalizePath();
        const seekTime = widget.akariPreviewLastKnownTime;
        this.discardPreviewWidget(widget, uri, kind);
        try {
            const reopened = await this.getOrOpenPreview(uri, { area: 'main' }, kind, seekTime);
            await this.shell.activateWidget(reopened.id);
        } catch (error) {
            this.reportOpenFailure(uri, error);
        }
    }

    /** 診断ログの保存先（`~/.akari/logs/akari-preview-diagnostics.log`）を組み立てる。 */
    protected createPreviewDiagnosticsLog(): PreviewDiagnosticsLog {
        return new PreviewDiagnosticsLog({
            resolveLogUri: async () => new URI(await this.envVariables.getHomeDirUri())
                .resolve(PREVIEW_DIAGNOSTICS_LOG_RELATIVE_PATH).normalizePath().toString(),
            readText: async uri => {
                const target = new URI(uri);
                if (!(await this.fileService.exists(target))) return undefined;
                return (await this.fileService.readFile(target)).value.toString();
            },
            writeText: async (uri, text) => {
                await this.fileService.writeFile(new URI(uri), BinaryBuffer.fromString(text));
            },
            ...(window.electronAkariPreview?.appendDiagnosticLog
                ? { appendLines: (lines: string[]) => window.electronAkariPreview.appendDiagnosticLog(lines) }
                : {}),
            warn: (message, error) => console.warn(message, error)
        });
    }

    protected createPreviewDiagnosticsCenter(): PreviewDiagnosticsCenter {
        return new PreviewDiagnosticsCenter({
            now: () => Date.now(),
            nowIso: () => new Date().toISOString(),
            setTimeout: (handler, ms) => window.setTimeout(handler, ms),
            clearTimeout: handle => window.clearTimeout(handle as number),
            warn: (message, error) => console.warn(message, error),
            copyText: text => {
                void navigator.clipboard?.writeText(text)
                    .catch(error => console.warn('[akari-preview] クリップボードへ書けませんでした', error));
            }
        }, this.createPreviewDiagnosticsLog());
    }

    /**
     * 第12項: キー変換失敗の発火条件（key / code / keyCode / IME 合成）を残す観測だけの経路。
     * `Cannot get key code from the keyboard event` を出しているのは @theia/core（app.asar 内）で
     * ここからは止められないため、同じ形のイベントを上限付きで記録して次の採取で絞れるようにする。
     */
    protected installKeyEventDiagnostics(center: PreviewDiagnosticsCenter): void {
        const observe = guardedKeyHandler<KeyboardEvent>(
            event => {
                if (!isSuspiciousKeyEventShape(event)) return;
                center.observeKeyEvent(event);
            },
            (event, reason) => center.recordKeyConversionFailure(event, reason)
        );
        this.lifecycleDisposables.push(listen(window, 'keydown', observe, true));
        this.lifecycleDisposables.push(listen(window, 'keyup', observe, true));
    }

    onStart(): void {
        this.previewDiagnostics = this.createPreviewDiagnosticsCenter();
        const unsubscribeRendererGone = window.electronAkariPreview?.onPreviewRendererGone?.(notice => {
            if (!notice || typeof notice.webviewId !== 'string' || typeof notice.reason !== 'string') return;
            const widget = this.previewDiagnosticsWidgets.get(notice.webviewId);
            const session = widget?.akariPreviewDiagnostics;
            if (!shouldDeliverPreviewRendererGone(widget, notice) || !session) return;
            session.rendererGone({
                reason: notice.reason,
                exitCode: typeof notice.exitCode === 'number' ? notice.exitCode : null,
                at: notice.at
            });
        });
        if (unsubscribeRendererGone) {
            this.lifecycleDisposables.push({ dispose: unsubscribeRendererGone });
        }
        this.installKeyEventDiagnostics(this.previewDiagnostics);
        this.lifecycleDisposables.push(this.commandRegistry.registerCommand(ANNOTATE_PREVIEW_AT_POINT_COMMAND, {
            execute: async () => {
                const detail = this.lastClipAnnotationContext;
                if (!detail) return;
                await this.commandRegistry.executeCommand(OPEN_AKARI_REVIEW_PANEL_COMMAND_ID);
                window.dispatchEvent(new CustomEvent(CLIP_ANNOTATION_REQUEST_EVENT, { detail }));
            }
        }));
        this.lifecycleDisposables.push(this.menuModelRegistry.registerMenuAction(WEBVIEW_CONTEXT_MENU, {
            commandId: ANNOTATE_PREVIEW_AT_POINT_COMMAND.id,
            label: 'この位置に注釈'
        }));
        for (const [command, label, kind] of [
            [GROUP_PREVIEW_COMMAND, 'キャンバスにする', 'group'],
            [UNGROUP_PREVIEW_COMMAND, 'キャンバスをほどく', 'ungroup']
        ] as const) {
            this.lifecycleDisposables.push(this.commandRegistry.registerCommand(command, {
                isVisible: (context?: typeof this.previewGroupMenuContext) =>
                    context === this.previewGroupMenuContext && previewGroupMenuVisible(context, kind),
                execute: (context?: typeof this.previewGroupMenuContext) => {
                    if (!context || context !== this.previewGroupMenuContext) return;
                    window.dispatchEvent(new CustomEvent('akari.preview.groupCommand', {
                        detail: { editUri: context.editUri, kind, selectedIds: context.selectedIds }
                    }));
                }
            }));
            this.lifecycleDisposables.push(this.menuModelRegistry.registerMenuAction(WEBVIEW_CONTEXT_MENU, {
                commandId: command.id, label
            }));
        }
        for (const { id, label, op, order } of PREVIEW_Z_ORDER_MENU_ITEMS) {
            this.lifecycleDisposables.push(this.commandRegistry.registerCommand({ id }, {
                isVisible: (context?: typeof this.previewGroupMenuContext) =>
                    context === this.previewGroupMenuContext && previewZOrderMenuVisible(context),
                execute: (context?: typeof this.previewGroupMenuContext) => {
                    if (!context || context !== this.previewGroupMenuContext || !previewZOrderMenuVisible(context)) return;
                    window.dispatchEvent(new CustomEvent('akari.preview.zOrderCommand', {
                        detail: { editUri: context.editUri, op, selectedIds: context.selectedIds }
                    }));
                }
            }));
            this.lifecycleDisposables.push(this.menuModelRegistry.registerMenuAction(Z_ORDER_PREVIEW_MENU, {
                commandId: id, label, order
            }));
        }
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
            if (isMaterialPreviewWidgetId(id)) {
                this.materialSlot.register(event.widget);
            }
            const kind = previewDiagnosticsKindFromWidgetId(id);
            // 第12項: Console に出た Webview ID の所有者が特定できなかったため、生成された
            // 全 webview の id と用途（akari-preview 以外を含む）を診断ログへ残す。
            this.previewDiagnostics?.note(
                'webview 生成: id=' + id
                + ' 用途=' + describePreviewWebviewRole(id).label
                + (viewId ? ' viewId=' + viewId : '')
            );
            if (kind && viewId) {
                const marker = event.widget as PreviewWidgetMarker;
                if (this.previewDiagnostics && !marker.akariPreviewDiagnostics) {
                    const session = this.previewDiagnostics.register({
                        id,
                        kind,
                        editUri: viewId,
                        isActive: () => event.widget.isVisible && document.visibilityState !== 'hidden',
                        overlay: createDomPreviewDiagnosticsOverlay(event.widget.node, {
                            onCopy: () => marker.akariPreviewDiagnostics?.copyReport(),
                            onReopen: () => { void this.reopenStoppedPreview(marker); }
                        })
                    });
                    marker.akariPreviewDiagnostics = session;
                    this.previewDiagnosticsWidgets.set(id, marker);
                    session.markStage('webview-created', 'ok');
                    event.widget.disposed.connect(() => {
                        session.dispose();
                        if (this.previewDiagnosticsWidgets.get(id) === marker) this.previewDiagnosticsWidgets.delete(id);
                    });
                }
            }
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
        this.lifecycleDisposables.push(this.commandRegistry.registerCommand(CAPTURE_OUTPUT_PREVIEW_FRAME_COMMAND, {
            execute: async (request?: { editUri: string }): Promise<{ path: string }> => {
                if (!request?.editUri) throw new Error('出力プレビューを開いてください');
                const widget = this.openOutputPreviews.get(new URI(request.editUri).normalizePath().toString());
                const pageId = widget?.akariPreviewPlaybackPageId;
                if (!widget || widget.isDisposed || !pageId) throw new Error('出力プレビューを開いてください');
                const token = globalThis.crypto.randomUUID();
                const pending = this.pendingFrameCaptures.begin(token, widget, pageId);
                try {
                    widget.sendMessage({ type: 'akari-preview-capture-start', pageId, token });
                } catch (error) {
                    this.pendingFrameCaptures.reject(token, widget, pageId,
                        error instanceof Error ? error : new Error(String(error)));
                }
                return { path: await pending };
            }
        }));
        this.registerTogglePlaybackCommand();
        this.registerCompactTracksCommand();
        this.registerSetPreviewFullscreenCommand();
        this.registerSetPreviewViewZoomCommand();
        this.registerSetPreviewPlaybackRateCommand();
        this.registerSetPreviewLoopRangeCommand();
        this.registerPreviewPlayCommand();
        this.commandRegistry.registerCommand({ id: 'akari.preview.beginSwapTrial' }, {
            execute: (request: SwapTrialIdentity & { editUri: string }) => this.beginSwapTrial(request)
        });
        this.commandRegistry.registerCommand({ id: 'akari.preview.refreshSwapTrial' }, {
            execute: (request: { editUri: string; editSource: string; token: string }) => this.refreshSwapTrial(request)
        });
        this.commandRegistry.registerCommand({ id: 'akari.preview.endSwapTrial' }, {
            execute: (token: string) => this.endSwapTrial(token)
        });
        this.commandRegistry.registerCommand({ id: 'akari.preview.playSwapTrial' }, {
            execute: (request: SwapTrialIdentity & { editUri: string; time: number }) => this.playSwapTrial(request)
        });
        this.commandRegistry.registerCommand({ id: 'akari.preview.materialTrial' }, {
            execute: (request: { editUri: string; originalTitle?: string; title?: string }) => this.showMaterialTrial(request)
        });
        this.registerPreviewPauseCommand();
        this.registerPreviewCropModeCommand();
        this.registerPreviewPerspectivePanelCommand();
        this.registerPulsePreviewItemCommand();
        this.registerShowPreviewZoneHintCommand();
        this.lifecycleDisposables.push(this.preferences.onPreferenceChanged(event => {
            if (event.preferenceName === 'akari.preview.scrubAudio') {
                // Theia の PreferenceChange は newValue を公開しないため、変更後の実効値を取得する。
                const enabled = this.preferences.get<boolean>('akari.preview.scrubAudio', true) !== false;
                for (const widget of [...this.openOutputPreviews.values(), ...this.openPreviews.values()]) {
                    if (widget.isAttached) {
                        widget.sendMessage({ type: 'akari-preview-set-scrub-audio', enabled });
                    }
                }
            }
            if (event.preferenceName === 'akari.preview.exportLook') {
                const enabled = this.preferences.get<boolean>('akari.preview.exportLook', false) === true;
                for (const widget of this.openOutputPreviews.values()) {
                    if (widget.isAttached) {
                        widget.sendMessage({ type: 'akari-preview-set-export-look', enabled });
                    }
                }
            }
        }));
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
            this.timelineOverlaySelections.set(key, detail.overlayId);
            const widget = this.openOutputPreviews.get(key);
            if (widget?.isAttached) {
                widget.sendMessage({ type: 'akari-preview-select-overlay', overlayId: detail.overlayId });
            }
        };
        this.lifecycleDisposables.push(listen(window, TIMELINE_OVERLAY_SELECTED_EVENT, onTimelineOverlaySelected));
        const outputPreviewForEdit = (editUri: string): PreviewWidgetMarker | undefined => {
            try {
                return this.openOutputPreviews.get(new URI(editUri).normalizePath().toString());
            } catch {
                return undefined;
            }
        };
        const onCaptionZoneHover = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; zone?: string | null }>).detail;
            if (!detail?.editUri || (detail.zone !== null && !(CAPTION_ZONES as readonly string[]).includes(detail.zone ?? ''))) {
                return;
            }
            const widget = outputPreviewForEdit(detail.editUri);
            if (widget?.isAttached) {
                widget.sendMessage({ type: 'akari-preview-caption-zone-hover', zone: detail.zone });
            }
        };
        const onCaptionZonePreset = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; zone?: string }>).detail;
            if (!detail?.editUri || typeof detail.zone !== 'string') return;
            const widget = outputPreviewForEdit(detail.editUri);
            if (!widget?.isAttached) return;
            const action = parseCaptionInspectorPositionAction(detail.zone);
            if (action) {
                this.captionWriteTail = this.captionWriteTail.then(async () => {
                    const captionsUri = widget.akariPreviewCaptionsUri;
                    if (!captionsUri) return;
                    const parsed = JSON.parse(await this.readText(captionsUri)) as {
                        captions?: Array<{ id: string; time_domain?: string }>;
                    } | Array<{ id: string; time_domain?: string }>;
                    const entries = Array.isArray(parsed) ? parsed : parsed.captions;
                    const caption = entries?.find(candidate => candidate.id === action.captionId);
                    if (!caption) return;
                    if (action.kind === 'zone' && caption.time_domain !== 'output') {
                        await this.persistCaptionGroupZoneForWidget(widget, action.zone);
                    } else {
                        widget.sendMessage({ type: 'akari-preview-caption-position-preset', action });
                    }
                }).catch(error => { this.messages.error(error instanceof Error ? error.message : String(error)); });
                return;
            }
            if (!(CAPTION_ZONES as readonly string[]).includes(detail.zone)) return;
            this.captionWriteTail = this.captionWriteTail.then(() =>
                this.persistCaptionGroupZoneForWidget(widget, detail.zone as CaptionZoneValue)
            );
        };
        this.lifecycleDisposables.push(listen(window, CAPTION_ZONE_HOVER_EVENT, onCaptionZoneHover));
        this.lifecycleDisposables.push(listen(window, CAPTION_ZONE_PRESET_EVENT, onCaptionZonePreset));
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
            this.timelineLayerSelections.set(key, detail.layerId);
            const widget = this.openOutputPreviews.get(key);
            if (widget?.isAttached) {
                widget.sendMessage({ type: 'akari-preview-select-layer', layerId: detail.layerId });
            }
        };
        this.lifecycleDisposables.push(listen(window, TIMELINE_LAYER_SELECTED_EVENT, onTimelineLayerSelected));
        const onPrimarySelected = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; selection: { kind: 'cut' | 'caption'; id: string } | null }>).detail;
            if (!detail?.editUri) return;
            const key = new URI(detail.editUri).normalizePath().toString();
            this.timelineGroupSelections.delete(key);
            this.openOutputPreviews.get(key)?.sendMessage({ type: 'akari-preview-set-selected-group', selection: [] });
            this.primaryTimelineSelections.set(key, detail.selection);
            this.openOutputPreviews.get(key)?.sendMessage({ type: 'akari-preview-select-primary', selection: detail.selection });
        };
        this.lifecycleDisposables.push(listen(window, 'akari.timeline.primarySelected', onPrimarySelected));
        const onTimelineCaptionSelectionChanged = (event: Event): void => {
            const detail = (event as CustomEvent<{
                editUri?: unknown; captionIds?: unknown; primaryCaptionId?: unknown
            }>).detail;
            if (typeof detail?.editUri !== 'string' || !Array.isArray(detail.captionIds)) return;
            const key = new URI(detail.editUri).normalizePath().toString();
            const captionIds = detail.captionIds.filter((id): id is string => typeof id === 'string');
            const primaryCaptionId = typeof detail.primaryCaptionId === 'string'
                && captionIds.includes(detail.primaryCaptionId) ? detail.primaryCaptionId : null;
            const selection = { captionIds, primaryCaptionId };
            this.timelineCaptionSelections.set(key, selection);
            this.openOutputPreviews.get(key)?.sendMessage({ type: 'akari-preview-set-selected-captions', ...selection });
        };
        this.lifecycleDisposables.push(listen(window, 'akari.timeline.captionSelectionChanged', onTimelineCaptionSelectionChanged));
        const onTimelineGroupSelectionChanged = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: unknown; selection?: unknown }>).detail;
            if (typeof detail?.editUri !== 'string' || !Array.isArray(detail.selection)) return;
            const selection = detail.selection.filter((item: any) => item
                && ['caption', 'layer', 'overlay'].includes(item.kind) && typeof item.id === 'string'
                && item.id.length > 0);
            const key = new URI(detail.editUri).normalizePath().toString();
            this.timelineGroupSelections.set(key, selection);
            const captionIds = selection.filter(item => item.kind === 'caption').map(item => item.id);
            this.timelineCaptionSelections.set(key, { captionIds, primaryCaptionId: captionIds[0] ?? null });
            this.timelineLayerSelections.set(key, selection.find(item => item.kind === 'layer')?.id ?? null);
            this.timelineOverlaySelections.set(key, selection.find(item => item.kind === 'overlay')?.id ?? null);
            this.primaryTimelineSelections.set(key, null);
            this.openOutputPreviews.get(key)?.sendMessage({ type: 'akari-preview-set-selected-group', selection });
        };
        this.lifecycleDisposables.push(listen(window, 'akari.timeline.groupSelectionChanged', onTimelineGroupSelectionChanged));
        const onCaptionPanelPreview = (event: Event): void => {
            const detail = (event as CustomEvent<{ captionId?: string; textStyle?: unknown;
                committed?: boolean; failed?: boolean }>).detail;
            if (typeof detail?.captionId !== 'string') return;
            for (const [key, preview] of this.openOutputPreviews) {
                const selection = this.timelineCaptionSelections.get(key)?.captionIds ?? [];
                const captionIds = selection.includes(detail.captionId) ? selection : [detail.captionId];
                preview.sendMessage({ type: 'akari-preview-caption-style-preview', ...detail, captionIds });
            }
        };
        this.lifecycleDisposables.push(listen(window, 'akari-caption-panel-preview', onCaptionPanelPreview));
        const onCaptionMotionPlay = (event: Event): void => {
            const detail = (event as CustomEvent<{ captionId?: string; id?: string;
                kind?: string; wordIndex?: number; slot?: string }>).detail;
            if (typeof detail?.captionId !== 'string' || typeof detail.id !== 'string') return;
            for (const preview of this.openOutputPreviews.values()) {
                preview.sendMessage({ type: 'akari-preview-caption-motion-play', ...detail });
            }
        };
        this.lifecycleDisposables.push(listen(window, 'akari-caption-motion-play', onCaptionMotionPlay));
        const onCaptionPanelChanged = (event: Event): void => {
            if ((event as CustomEvent<{ panel?: string | null }>).detail?.panel !== null) return;
            for (const preview of this.openOutputPreviews.values()) {
                preview.sendMessage({ type: 'akari-preview-caption-style-preview', captionId: '', textStyle: null,
                    force: true });
            }
        };
        this.lifecycleDisposables.push(listen(window, 'akari-caption-panel-changed', onCaptionPanelChanged));
        const onSelectCaptionRun = (event: Event): void => {
            const detail = (event as CustomEvent<{ captionId?: string; from?: number; to?: number }>).detail;
            if (!detail || typeof detail.captionId !== 'string' || !Number.isInteger(detail.from)
                || !Number.isInteger(detail.to)) return;
            for (const preview of this.openOutputPreviews.values()) {
                preview.sendMessage({ type: 'akari-preview-select-caption-run', ...detail });
            }
        };
        this.lifecycleDisposables.push(listen(window, 'akari.preview.selectCaptionRun', onSelectCaptionRun));
        const onDaihonSelectionChanged = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: unknown; captionIds?: unknown }>).detail;
            if (typeof detail?.editUri !== 'string' || !Array.isArray(detail.captionIds)) return;
            const captionIds = detail.captionIds.filter((id): id is string => typeof id === 'string');
            const key = new URI(detail.editUri).normalizePath().toString();
            this.openOutputPreviews.get(key)?.sendMessage({
                type: 'akari-preview-set-selected-captions', captionIds
            });
        };
        this.lifecycleDisposables.push(listen(window, 'akari.daihon.selectionChanged', onDaihonSelectionChanged));
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
                const settings = this.previewSessionSettings.get(key) ?? defaultSessionSettings();
                const widget = this.openOutputPreviews.get(key);
                apply(widget?.isAttached ? widget : undefined, detail, settings);
                this.previewSessionSettings.set(key, settings);
            };
            this.lifecycleDisposables.push(listen(window, type, listener));
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
        this.lifecycleDisposables.push(listen(window, TIMELINE_SET_TRACK_VISIBILITY_EVENT, onTrackVisibilityV2));
        const onSyncTrackToggles = (event: Event): void => {
            const detail = (event as CustomEvent<{
                editUri?: string;
                cuts?: { hidden?: number[]; muted?: number[] };
                layers?: { hidden?: number[]; muted?: number[] };
                audio?: { muted?: number[] };
            }>).detail;
            if (!detail?.editUri) return;
            this.applyTimelineTrackSync(detail.editUri, detail.cuts, detail.layers, detail.audio);
        };
        this.lifecycleDisposables.push(listen(window, TIMELINE_SYNC_TRACK_TOGGLES_EVENT, onSyncTrackToggles));
        const registerTimelineSettingV2Adapter = <T extends { editUri?: string }>(
            type: string,
            toRequest: (detail: T) => Omit<TrackVisibilityV2Request, 'videoUri'>
        ): void => {
            const listener = (event: Event): void => {
                const detail = (event as CustomEvent<T>).detail;
                if (!detail?.editUri) return;
                this.applyTrackVisibilityV2({ ...toRequest(detail), videoUri: detail.editUri });
            };
            this.lifecycleDisposables.push(listen(window, type, listener));
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
        this.lifecycleDisposables.push(listen(window, TIMELINE_SET_CAPTIONS_MUTED_EVENT, noopTimelineSetting));
        this.lifecycleDisposables.push(listen(window, TIMELINE_SET_BEATS_VISIBILITY_EVENT, noopTimelineSetting));
        this.lifecycleDisposables.push(listen(window, TIMELINE_SET_BEATS_MUTED_EVENT, noopTimelineSetting));
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
                target?: { kind: 'cut'; index: number }
                    | { kind: 'layer' | 'item' | 'caption'; id: string };
                field?: string;
                value?: number;
                values?: Record<string, number>;
                clear?: boolean;
                shapeHtml?: string;
            }>).detail;
            if (!detail?.editUri || !detail.target
                || (detail.target.kind !== 'cut'
                    && detail.target.kind !== 'layer'
                    && detail.target.kind !== 'item'
                    && detail.target.kind !== 'caption')
                || (detail.values === undefined
                    ? typeof detail.field !== 'string' || !Number.isFinite(detail.value)
                    : !detail.values || typeof detail.values !== 'object'
                        || !Object.keys(detail.values).length
                        || Object.entries(detail.values).some(([field, value]) =>
                            !field || !Number.isFinite(value)))) {
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
                    ...(detail.values === undefined
                        ? { field: detail.field, value: detail.value, values: { [detail.field!]: detail.value! } }
                        : { ...(typeof detail.field === 'string' && Number.isFinite(detail.value)
                            ? { field: detail.field, value: detail.value } : {}), values: detail.values }),
                    ...(detail.clear ? { clear: true } : {}),
                    ...(typeof detail.shapeHtml === 'string' ? { shapeHtml: detail.shapeHtml } : {})
                });
            }
        };
        this.lifecycleDisposables.push(listen(window, TIMELINE_LIVE_TRANSFORM_EVENT, onLiveTransform));
        const onStillCandidate = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; sourceId?: string | null; itemId?: string; imageUrl?: string | null }>).detail;
            if (!detail?.editUri || detail.imageUrl !== null &&
                (typeof detail.imageUrl !== 'string' || !detail.imageUrl.startsWith('data:image/png;base64,'))) return;
            const key = new URI(detail.editUri).normalizePath().toString();
            this.openOutputPreviews.get(key)?.sendMessage({ type: 'akari-preview-still-candidate',
                sourceId: detail.sourceId ?? null, itemId: detail.itemId ?? null, imageUrl: detail.imageUrl ?? null });
        };
        this.lifecycleDisposables.push(listen(window, 'akari.preview.stillCandidate', onStillCandidate));
        const onVideoCandidate = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; itemId?: string; relativePath?: string;
                inSeconds?: number; outSeconds?: number; freeze?: { atSeconds: number; durationSeconds: number };
                clear?: boolean }>).detail;
            if (!detail?.editUri || !detail.itemId) return;
            let key: string;
            try { key = new URI(detail.editUri).normalizePath().toString(); } catch { return; }
            if (detail.clear === true) { this.clearVideoCandidatePreview(key, detail.itemId); return; }
            if (typeof detail.relativePath !== 'string'
                || !isProjectVideoCandidatePath(detail.itemId, detail.relativePath)
                || detail.inSeconds !== 0 || !Number.isFinite(detail.outSeconds) || detail.outSeconds! <= 0
                || (detail.freeze && (!Number.isFinite(detail.freeze.durationSeconds)
                    || detail.freeze.durationSeconds <= 0 || detail.freeze.atSeconds !== detail.outSeconds))) return;
            void this.showVideoCandidatePreview(key, detail as {
                itemId: string; relativePath: string; inSeconds: number; outSeconds: number;
                freeze?: { atSeconds: number; durationSeconds: number };
            });
        };
        this.lifecycleDisposables.push(listen(window, 'akari.preview.videoCandidate', onVideoCandidate));
        const onAdjustBypass = (event: Event): void => {
            const detail = (event as CustomEvent<{
                editUri?: string;
                target?: { kind: 'cut'; index: number }
                    | { kind: 'layer' | 'item'; id: string };
                enabled?: boolean;
            }>).detail;
            if (!detail?.editUri || !detail.target
                || (detail.target.kind !== 'cut'
                    && detail.target.kind !== 'layer'
                    && detail.target.kind !== 'item')
                || typeof detail.enabled !== 'boolean') {
                return;
            }
            let key: string;
            try {
                key = new URI(detail.editUri).normalizePath().toString();
            } catch {
                return;
            }
            const widget = this.openOutputPreviews.get(key);
            if (widget) {
                const target = detail.target;
                const id = target.kind === 'cut' ? widget.akariPreviewSummary?.cuts?.[target.index]?.id : target.id;
                if (id === undefined) return;
                const ids = widget.akariPreviewAdjustBypassIds ?? (widget.akariPreviewAdjustBypassIds = new Set<string>());
                if (detail.enabled) ids.add(String(id));
                else ids.delete(String(id));
            }
            if (widget?.isAttached) {
                widget.sendMessage({
                    type: 'akari-preview-adjust-bypass',
                    target: detail.target,
                    enabled: detail.enabled
                });
            }
        };
        this.lifecycleDisposables.push(listen(window, TIMELINE_ADJUST_BYPASS_EVENT, onAdjustBypass));
        registerTimelineSetting<{ editUri?: string; start?: number; end?: number }>(
            TIMELINE_LOOP_RANGE_EVENT, (widget, detail, _settings) => {
                const range = Number.isFinite(detail.start) && Number.isFinite(detail.end)
                    && detail.end! > detail.start! ? { start: detail.start!, end: detail.end! } : null;
                widget?.sendMessage({ type: 'akari-preview-loop-range', range });
            }
        );
        registerTimelineSetting<{ editUri?: string; scopeId: string | null }>(
            'akari.timeline.selectionFloor', (widget, detail, settings) => {
                if (detail.scopeId !== null && typeof detail.scopeId !== 'string') return;
                settings.selectionFloor = detail.scopeId;
                widget?.sendMessage({ type: 'akari-preview-selection-floor', scopeId: detail.scopeId });
            }
        );
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
        const settings = this.previewSessionSettings.get(key) ?? defaultSessionSettings();
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
        layers?: { hidden?: number[]; muted?: number[] },
        audio?: { muted?: number[] }
    ): void {
        let key: string;
        try {
            key = new URI(videoUri).normalizePath().toString();
        } catch {
            return;
        }
        const widget = this.openOutputPreviews.get(key);
        const settings = this.previewSessionSettings.get(key) ?? defaultSessionSettings();
        settings.hiddenTracksByScope.cuts = new Set(cuts?.hidden ?? []);
        settings.mutedTracksByScope.cuts = new Set(cuts?.muted ?? []);
        settings.hiddenTracksByScope.layers = new Set(layers?.hidden ?? []);
        settings.mutedTracksByScope.layers = new Set(layers?.muted ?? []);
        settings.mutedTracksByScope.audio = new Set(audio?.muted ?? []);
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
                mutedLayers: [...settings.mutedTracksByScope.layers],
                mutedAudio: [...settings.mutedTracksByScope.audio]
            });
        }
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
            this.lifecycleDisposables.push(listen(window, type, listener));
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
        register(REVIEW_SESSION_VIEWER_SYNC_EVENT, event => {
            const detail = (event as CustomEvent<ReviewSessionViewerSyncDetail>).detail;
            if (!detail?.projectRootUri || !detail.editUri || !detail.sessionId) return;
            if (detail.phase === 'tick') {
                if (!Number.isFinite(detail.timelineT)) return;
                this.pendingSessionViewerTick = detail;
                this.sessionViewerSeekThrottle.call();
                return;
            }
            void this.handleSessionViewerSync(detail);
        });
        register(REVIEW_ANNOTATION_SHOW_STROKES_EVENT, event => {
            const detail = (event as CustomEvent<ReviewAnnotationStrokeRequest>).detail;
            if (detail) {
                void this.showReviewAnnotationStrokes(detail);
            }
        });
        register(REVIEW_TOOL_MODE_SET_EVENT, event => {
            const detail = (event as CustomEvent<ReviewToolModeSetRequest>).detail;
            const editUri = detail?.editUri ? normalizeReviewEditUri(detail.editUri) : undefined;
            if (!editUri || !detail?.mode || !this.reviewSessionRecorder) {
                return;
            }
            this.reviewSessionRecorder.setToolMode(editUri, detail.mode);
        });
        register(REVIEW_UI_SELECTION_CLEAR_EVENT, event => {
            const detail = (event as CustomEvent<ReviewSessionControlRequest>).detail;
            const editUri = detail?.editUri ? normalizeReviewEditUri(detail.editUri) : undefined;
            if (!editUri || !this.reviewSessionRecorder) {
                return;
            }
            this.reviewSessionRecorder.clearUiSelection(editUri);
        });
    }

    protected async showReviewAnnotationStrokes(detail: ReviewAnnotationStrokeRequest): Promise<void> {
        const editUri = normalizeReviewEditUri(detail.editUri);
        if (!editUri || !Number.isFinite(detail.sourceT) || !Array.isArray(detail.strokes)) {
            return;
        }
        const visibility = await this.ensureVisible(editUri);
        const widget = this.openOutputPreviews.get(editUri);
        if (visibility === 'unavailable' || !widget?.isAttached) {
            return;
        }
        const cutIndex = resolveReviewStrokeCutIndex(detail.strokes);
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

    protected async startReviewSessionFromPanel(projectRootUri: string, requestedEditUri: string): Promise<void> {
        const recorder = this.reviewSessionRecorder;
        const editUri = normalizeReviewEditUri(requestedEditUri);
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

    protected forwardReviewSessionState(state: ReviewSessionUiState): void {
        this.reviewSessionRecordingIndicator?.setActive(state.active);
        window.dispatchEvent(new CustomEvent(REVIEW_SESSION_STATE_EVENT, { detail: state }));
        const editUri = normalizeReviewEditUri(state.editUri);
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
        const editUri = normalizeReviewEditUri(state.editUri);
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
            if (reviewEditUriForPreview(widget) === editUri && widget.isAttached) {
                widget.sendMessage({ type: 'akari-preview-set-stroke-visibility', visible });
            }
        }
    }

    protected async showReviewSessionStrokes(state: ReviewSessionUiState, sessionId: string): Promise<void> {
        const editUri = normalizeReviewEditUri(state.editUri);
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
        // v2 edit では sourceT が 0 に退避される場合があるため、記録済みの timelineT を優先する。
        // timelineT の無い旧データだけ、従来の sourceT/cutIndex 解決へフォールバックする。
        let compositionSeconds = Number.isFinite(first.frame.timelineT)
            ? first.frame.timelineT
            : first.frame.sourceT;
        if (!Number.isFinite(first.frame.timelineT)) {
            try {
                const model = await this.loadPreviewModel(new URI(editUri));
                compositionSeconds = resolveAnnotationStrokeCompositionSeconds(
                    model.summary.cuts, first.frame.sourceT, first.frame.cutIndex
                );
            } catch {
                // Keep the source-seconds fallback for old snapshots and partially repaired projects.
            }
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

    protected async handleSessionViewerSync(detail: ReviewSessionViewerSyncDetail): Promise<void> {
        const editUri = normalizeReviewEditUri(detail.editUri);
        if (!editUri) return;
        if (detail.phase === 'detach') {
            this.openOutputPreviews.get(editUri)?.sendMessage({
                type: 'akari-preview-show-session-strokes', sessionId: detail.sessionId,
                target: { tab: editUri, recT: 0 }, strokes: []
            });
            return;
        }
        if (detail.phase !== 'attach') return;
        const replay = await this.previewService.readReviewSessionStrokes({
            projectRootUri: detail.projectRootUri, sessionId: detail.sessionId
        });
        const visibility = await this.ensureVisible(editUri);
        const widget = this.openOutputPreviews.get(editUri);
        if (visibility === 'unavailable' || !widget?.isAttached) return;
        this.setReviewStrokeVisibility(editUri, true);
        widget.sendMessage({
            type: 'akari-preview-show-session-strokes', sessionId: detail.sessionId,
            target: { tab: editUri, recT: replay.strokes[0]?.recTStart ?? 0 },
            strokes: replay.strokes
        });
    }

    protected applyReviewSessionStateToPreview(
        widget: PreviewWidgetMarker,
        state: ReviewSessionUiState
    ): void {
        const previewEditUri = reviewEditUriForPreview(widget);
        const stateEditUri = normalizeReviewEditUri(state.editUri);
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
        const editUri = reviewEditUriForPreview(widget);
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
    protected audioMeterDismissedThisSession = false;
    protected readonly observedAudioMeters = new WeakSet<AkariAudioMeterWidget>();

    protected async attachAudioMeterPassively(): Promise<void> {
        if (this.audioMeterDismissedThisSession) return;
        const meter = await this.widgetManager.getOrCreateWidget<AkariAudioMeterWidget>(
            AkariAudioMeterWidget.FACTORY_ID
        );
        if (this.audioMeterDismissedThisSession || meter.isDisposed) return;
        this.observeAudioMeter(meter);
        if (!meter.isAttached) await this.shell.addWidget(meter, { area: 'right', rank: 220 });
    }

    protected async openAudioMeter(): Promise<void> {
        const meter = await this.widgetManager.getOrCreateWidget<AkariAudioMeterWidget>(
            AkariAudioMeterWidget.FACTORY_ID
        );
        if (meter.isDisposed) return;
        this.observeAudioMeter(meter);
        if (!meter.isAttached) await this.shell.addWidget(meter, { area: 'right', rank: 220 });
        await this.shell.activateWidget(meter.id);
        this.audioMeterDismissedThisSession = false;
    }

    private observeAudioMeter(meter: AkariAudioMeterWidget): void {
        if (!this.observedAudioMeters.has(meter)) {
            this.observedAudioMeters.add(meter);
            meter.onDidDispose(() => { this.audioMeterDismissedThisSession = true; });
        }
    }

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
            await this.attachAudioMeterPassively().catch(error =>
                console.warn('[akari-preview] failed to auto-attach audio meter', error));
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
            await this.openPlaceholderPreview?.(uri);
            const widget = await this.getOrOpenPreview(uri, { area: 'main' }, 'output');
            this.shell.revealWidget(widget.id);
            return 'opened';
        } catch (error) {
            this.discardFailedPlaceholder?.(new URI(editUri).normalizePath());
            this.reportOpenFailure(new URI(editUri), error);
            return 'unavailable';
        }
    }

    protected registerOutputSeekCommand(): void {
        this.commandRegistry.registerCommand(SEEK_OUTPUT_PREVIEW_COMMAND, {
            execute: (request?: SeekOutputRequest) => this.seekOutputPreview(request)
        });
        /*
         * 取り寄せ中に先に置いた素材は、実体が届いても edit.json が変わらない
         * （参照台帳の解決結果だけが変わる）ので保存通知では描き直らない。
         * 届いた合図でモデルを作り直し、粗い絵から実体へ入れ替える。
         */
        this.commandRegistry.registerCommand({ id: 'akari.preview.refreshMedia' }, {
            execute: (request?: { editUri?: string }) => {
                if (!request?.editUri) return;
                const uri = new URI(request.editUri).normalizePath();
                const widget = this.openOutputPreviews.get(uri.toString());
                if (!widget || widget.isDisposed || !widget.akariPreviewConfigured) return;
                this.queueRefresh(widget, uri, 'output', widget.akariPreviewLastKnownTime, true);
            }
        });
        this.commandRegistry.registerCommand({ id: 'akari.preview.refreshFontAssets' }, {
            execute: (request?: { editUri?: string }) => this.refreshFontAssets(request)
        });
        this.commandRegistry.registerCommand({ id: 'akari.preview.measureOverlayBox' }, {
            execute: (request: { editUri?: string; fragment?: string;
                relativePath?: string; vars?: Record<string, string | number | boolean> }) => this.measureOverlayBox(request)
        });
    }

    protected readonly overlayMeasureCache = new Map<string, { x: number; y: number; width: number; height: number }>();

    protected async measureOverlayBox(request: { editUri?: string; fragment?: string;
        relativePath?: string;
        vars?: Record<string, string | number | boolean> } | undefined): Promise<{
            x: number; y: number; width: number; height: number
        } | undefined> {
        if (!request?.editUri || !request.fragment) return undefined;
        const started = Date.now();
        const deadline = started + 1000;
        const cacheKey = JSON.stringify([request.editUri, request.relativePath, request.fragment, request.vars ?? {}]);
        const cached = this.overlayMeasureCache.get(cacheKey);
        if (cached) return cached;
        const withinDeadline = async <T>(work: Promise<T>): Promise<{ done: boolean; value?: T }> => {
            const remaining = deadline - Date.now();
            if (remaining <= 0) return { done: false };
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                return await Promise.race([
                    work.then(value => ({ done: true, value })),
                    new Promise<{ done: false }>(resolve => { timer = setTimeout(() => resolve({ done: false }), remaining); })
                ]);
            } finally { if (timer) clearTimeout(timer); }
        };
        const editUri = new URI(request.editUri).normalizePath();
        let widget = this.openOutputPreviews.get(editUri.toString());
        if (!widget || widget.isDisposed || !widget.isAttached) {
            try {
                const opened = await withinDeadline(this.getOrOpenPreview(editUri,
                    { area: 'main' }, 'output') as Promise<PreviewWidgetMarker>);
                if (!opened.done || !opened.value) return undefined;
                widget = opened.value;
                if (!widget.isAttached) this.shell.addWidget(widget, { area: 'main' });
                this.shell.revealWidget(widget.id);
                if (widget.akariPreviewRefresh && !(await withinDeadline(widget.akariPreviewRefresh)).done) return undefined;
            } catch { return undefined; }
        }
        const roots = request.relativePath ? await withinDeadline(this.currentWorkspaceRoots()) : undefined;
        if (request.relativePath && !roots?.done) return undefined;
        const rewritten = request.relativePath
            ? await withinDeadline(this.previewService.rewriteFragmentAssets({ projectRootUri: editUri.parent.toString(),
                html: request.fragment, htmlPath: request.relativePath, overlayId: 'measure-overlay',
                workspaceRoots: roots!.value! }))
            : { done: true, value: { html: request.fragment } };
        if (!rewritten.done || !rewritten.value) return undefined;
        const html = rewritten.value.html;
        const requestId = `overlay-box-${Date.now()}-${Math.random()}`;
        return new Promise(resolve => {
            let finished = false;
            const finish = (box?: { x: number; y: number; width: number; height: number }): void => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                clearInterval(retry);
                listener.dispose();
                if (box) {
                    this.overlayMeasureCache.set(cacheKey, box);
                    if (this.overlayMeasureCache.size > 128) this.overlayMeasureCache.delete(this.overlayMeasureCache.keys().next().value!);
                }
                this.previewDiagnostics?.note(`素材の枠測定 ${Date.now() - started}ms ${box ? '成功' : '打ち切り'} ${request.relativePath ?? ''}`);
                resolve(box);
            };
            const listener = widget.onMessage(message => {
                if (message?.type === 'akari-preview-overlay-box' && message.requestId === requestId) finish(message.box);
            });
            const send = (): void => {
                if (widget.isDisposed) { finish(); return; }
                try {
                    Promise.resolve(widget.sendMessage({ type: 'akari-preview-overlay-box-request', requestId,
                        fragment: html, vars: request.vars ?? {} })).catch(() => finish());
                } catch { finish(); }
            };
            const timer = setTimeout(() => finish(), Math.max(0, deadline - Date.now()));
            const retry = setInterval(send, 200);
            send();
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

    protected registerSetPreviewFullscreenCommand(): void {
        this.commandRegistry.registerCommand(SET_PREVIEW_FULLSCREEN_COMMAND, {
            execute: (request?: SetPreviewFullscreenRequest) => this.setPreviewFullscreen(request)
        });
    }

    protected registerSetPreviewViewZoomCommand(): void {
        this.commandRegistry.registerCommand(SET_PREVIEW_VIEW_ZOOM_COMMAND, {
            execute: (request?: SetPreviewViewZoomRequest) => this.setPreviewViewZoom(request)
        });
    }

    protected registerSetPreviewPlaybackRateCommand(): void {
        this.commandRegistry.registerCommand(SET_PREVIEW_PLAYBACK_RATE_COMMAND, {
            execute: (request?: SetPreviewPlaybackRateExternalRequest) => this.setPreviewPlaybackRateExternal(request)
        });
    }

    protected registerSetPreviewLoopRangeCommand(): void {
        this.commandRegistry.registerCommand(SET_PREVIEW_LOOP_RANGE_COMMAND, {
            execute: (request?: SetPreviewLoopRangeRequest) => this.setPreviewLoopRange(request)
        });
    }

    /** 出力 Webview の上にだけ表示する。素材プレビューには追加しない。 */
    protected async showMaterialTrial(request: { editUri: string; originalTitle?: string; title?: string }): Promise<void> {
        if (!request?.editUri) return;
        const uri = new URI(request.editUri).normalizePath();
        const key = uri.toString();
        let widget = this.openOutputPreviews.get(key);
        if (!widget || widget.isDisposed) {
            if (!request.title) return;
            // メディアの configure を待たず、まず操作できる帯と出力タブを用意する。
            widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, {
                id: `akari-output-preview-${this.hash(key)}`, viewId: key
            });
            this.openOutputPreviews.set(key, widget);
            widget.title.label = '出力プレビュー';
        }
        if (request.title) {
            if (!widget.isAttached) this.shell.addWidget(widget, { area: 'main' });
            this.shell.revealWidget(widget.id);
        }
        widget.node.querySelector('[data-akari-material-trial]')?.remove();
        if (!request.title) return;
        const bar = document.createElement('div');
        bar.dataset.akariMaterialTrial = 'true';
        // Theia の mousedown 用透明面は z-index:999。実マウスの mouseup/click も帯へ届ける。
        bar.style.cssText = 'position:absolute;top:0;left:0;right:0;z-index:1001;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px;background:var(--theia-editorWidget-background);color:var(--theia-foreground);border-bottom:1px solid var(--theia-focusBorder)';
        const text = document.createElement('span');
        text.textContent = `お試し中: ${request.originalTitle ?? ''} → ${request.title}`;
        text.style.flex = '1';
        bar.appendChild(text);
        for (const [label, command, argument] of [
            ['▶ もう一度', 'akari.timeline.replayMaterialSwap', undefined],
            ['差し替える', 'akari.timeline.finishMaterialSwap', true],
            ['やめる', 'akari.timeline.finishMaterialSwap', false]
        ] as const) {
            const button = document.createElement('button');
            button.className = 'theia-button secondary';
            button.textContent = label;
            button.onclick = () => { void this.commandRegistry.executeCommand(command, argument); };
            bar.appendChild(button);
        }
        widget.node.appendChild(bar);
    }

    protected registerPreviewPlayCommand(): void {
        this.commandRegistry.registerCommand(PREVIEW_PLAY_COMMAND, {
            execute: (request?: PreviewPlaybackControlRequest) => this.playOutputPreview(request)
        });
    }

    protected registerPreviewPauseCommand(): void {
        this.commandRegistry.registerCommand(PREVIEW_PAUSE_COMMAND, {
            execute: (request?: PreviewPlaybackControlRequest) => this.pauseOutputPreview(request)
        });
    }

    protected registerPreviewCropModeCommand(): void {
        this.commandRegistry.registerCommand(PREVIEW_CROP_MODE_COMMAND, {
            execute: (request?: PreviewCropModeRequest) => this.enterPreviewCropMode(request)
        });
    }

    protected registerPreviewPerspectivePanelCommand(): void {
        this.commandRegistry.registerCommand(PREVIEW_PERSPECTIVE_PANEL_COMMAND, {
            execute: (request?: PreviewPerspectivePanelRequest) => this.openPreviewPerspectivePanel(request)
        });
    }

    protected registerPulsePreviewItemCommand(): void {
        this.commandRegistry.registerCommand(PULSE_PREVIEW_ITEM_COMMAND, {
            execute: (request?: PulsePreviewItemRequest) => this.pulsePreviewItem(request)
        });
    }

    protected registerShowPreviewZoneHintCommand(): void {
        this.commandRegistry.registerCommand(SHOW_PREVIEW_ZONE_HINT_COMMAND, {
            execute: (request?: ShowPreviewZoneHintRequest) => this.showPreviewZoneHint(request)
        });
    }

    protected getExternalPreviewWidget(editUri: string | undefined): PreviewWidgetMarker | undefined {
        if (typeof editUri !== 'string' || !editUri) {
            return undefined;
        }
        try {
            const widget = this.openOutputPreviews.get(new URI(editUri).normalizePath().toString());
            return widget?.akariPreviewConfigured && widget.isAttached && !widget.isDisposed ? widget : undefined;
        } catch {
            return undefined;
        }
    }

    protected async setPreviewFullscreen(request: SetPreviewFullscreenRequest | undefined): Promise<boolean> {
        const widget = this.getExternalPreviewWidget(request?.editUri);
        if (!widget || !request) return false;
        if (request.on !== undefined && typeof request.on !== 'boolean') return false;
        if (request.on === undefined) {
            this.togglePreviewFullscreen(widget);
        } else if (request.on && this.fullscreenPreviewWidget !== widget) {
            this.exitPreviewFullscreen();
            this.enterPreviewFullscreen(widget);
        } else if (!request.on && this.fullscreenPreviewWidget === widget) {
            this.exitPreviewFullscreen();
        }
        return true;
    }

    protected async setPreviewViewZoom(request: SetPreviewViewZoomRequest | undefined): Promise<boolean> {
        const widget = this.getExternalPreviewWidget(request?.editUri);
        if (!widget || !request) return false;
        let message: PreviewSetZoomMessage;
        if (typeof request.scale === 'number' && Number.isFinite(request.scale) && request.scale > 0) {
            message = { type: 'akari-preview-set-zoom', scale: request.scale };
        } else if (request.fit === true) {
            message = { type: 'akari-preview-set-zoom', fit: true };
        } else {
            return false;
        }
        widget.sendMessage(message);
        return true;
    }

    protected async setPreviewPlaybackRateExternal(request: SetPreviewPlaybackRateExternalRequest | undefined): Promise<boolean> {
        const widget = this.getExternalPreviewWidget(request?.editUri);
        if (!widget || !request) return false;
        if (!Number.isFinite(request.rate) || request.rate <= 0) return false;
        const message: PreviewSetRateMessage = {
            type: 'akari-preview-set-rate', rate: nearestPreviewRatePreset(request.rate)
        };
        widget.sendMessage(message);
        return true;
    }

    protected async setPreviewLoopRange(request: SetPreviewLoopRangeRequest | undefined): Promise<boolean> {
        const widget = this.getExternalPreviewWidget(request?.editUri);
        if (!widget || !request) return false;
        if ('clear' in request && request.clear === true) {
            widget.sendMessage({ type: 'akari-preview-loop-range', range: null });
        } else if ('startSeconds' in request && 'endSeconds' in request
            && Number.isFinite(request.startSeconds) && Number.isFinite(request.endSeconds)
            && request.endSeconds > request.startSeconds) {
            widget.sendMessage({
                type: 'akari-preview-loop-range', range: { start: request.startSeconds, end: request.endSeconds }
            });
        } else {
            return false;
        }
        return true;
    }

    protected readonly swapTrialPlaybacks = new Map<string, SwapTrialPlayback>();

    protected beginSwapTrial(request: SwapTrialIdentity & { editUri: string }): void {
        const key = new URI(request.editUri).normalizePath().toString();
        const previous = this.swapTrialPlaybacks.get(key);
        if (previous) this.endSwapTrial(previous.identity.token);
        const trial = new SwapTrialPlayback(request, Date.now());
        this.swapTrialPlaybacks.set(key, trial);
        const widget = this.openOutputPreviews.get(key);
        if (widget?.akariSwapReloading) trial.event({ type: 'reload-start', now: Date.now() });
        widget?.sendMessage({ type: 'akari-preview-swap-trial-context', token: request.token });
        logSwapTrial(request, 'preview_trial_begin', { pageId: widget?.akariPreviewPlaybackPageId });
    }

    /** 保存した本文をその場でキューへ入れる。後着の保存通知は queueRefresh が同内容を共有する。 */
    protected refreshSwapTrial(request: { editUri: string; editSource: string; token: string }): boolean {
        const uri = new URI(request.editUri).normalizePath();
        const trial = this.swapTrialPlaybacks.get(uri.toString());
        if (!trial || trial.identity.token !== request.token || trial.state.cancelled) return false;
        const widget = this.openOutputPreviews.get(uri.toString());
        if (!widget?.akariPreviewConfigured || widget.isDisposed) return false; // 初回は open が最新の保存内容を読む。
        this.markRecentWrite(uri);
        this.queueRefresh(widget, uri, 'output', undefined, false, request.editSource);
        return true;
    }

    protected endSwapTrial(token: string): void {
        for (const [key, trial] of this.swapTrialPlaybacks) if (trial.identity.token === token) {
            logSwapTrial(trial.identity, 'playback_cancel', { reason: 'trial_end' });
            trial.cancel();
            this.swapTrialPlaybacks.delete(key);
        }
    }

    protected noteSwapReload(widget: PreviewWidgetMarker, event: 'reload_start' | 'reload_complete', pageId?: string): void {
        if (pageId && pageId !== widget.akariPreviewPlaybackPageId) return;
        if (event === 'reload_complete' && !widget.akariSwapReloading) return;
        widget.akariSwapReloading = event === 'reload_start';
        const trial = this.swapTrialPlaybacks?.get(widget.akariPreviewEditUri?.normalizePath().toString() ?? '');
        if (!trial) return;
        trial.event({ type: event === 'reload_start' ? 'reload-start' : 'reload-complete', now: Date.now() });
        logSwapTrial(trial.identity, event, { pageId: widget.akariPreviewPlaybackPageId });
    }

    protected async playSwapTrial(request: SwapTrialIdentity & { editUri: string; time: number }): Promise<'playing' | 'cancelled' | 'failed'> {
        const key = new URI(request.editUri).normalizePath().toString();
        const trial = this.swapTrialPlaybacks.get(key);
        if (!trial || trial.identity.token !== request.token) return 'cancelled';
        const widget = (): PreviewWidgetMarker => {
            const value = this.openOutputPreviews.get(key);
            if (trial.state.cancelled || !value || value.isDisposed) throw new Error('preview unavailable');
            return value;
        };
        return trial.run({
            now: () => Date.now(), wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
            prepare: async seek => {
                await this.seekOutputPreview({ editUri: key, time: request.time, waitForReady: true,
                    swapTrialToken: request.token, seek });
            },
            fallbackSeek: async () => {
                logSwapTrial(trial.identity, 'seek_fallback');
                widget().sendMessage({ type: 'akari-preview-seek', time: request.time });
            },
            play: async () => {
                widget().sendMessage({ type: 'akari-preview-set-playback', playing: true, trialToken: request.token });
            },
            query: () => new Promise(resolve => {
                const current = widget();
                const finish = (playing: boolean, userStopped = false): void => {
                    clearTimeout(timer); listener.dispose(); resolve({ playing, userStopped });
                };
                const listener = current.onMessage(message => {
                    if (message?.type === 'akari-preview-swap-playback-state' && message.token === request.token
                        && message.pageId === current.akariPreviewPlaybackPageId) finish(message.playing === true, message.userStopped === true);
                });
                const timer = setTimeout(() => finish(trial.state.started), 180);
                current.sendMessage({ type: 'akari-preview-swap-playback-query', token: request.token });
            }),
            log: (event, detail) => logSwapTrial(trial.identity, event, detail)
        });
    }

    protected async playOutputPreview(request: PreviewPlaybackControlRequest | undefined): Promise<boolean> {
        const widget = this.getExternalPreviewWidget(request?.editUri);
        if (!widget || !request) return false;
        const message: PreviewSetPlaybackMessage = { type: 'akari-preview-set-playback', playing: true };
        widget.sendMessage(message);
        return true;
    }

    protected async pauseOutputPreview(request: PreviewPlaybackControlRequest | undefined): Promise<boolean> {
        const trial = request?.editUri && this.swapTrialPlaybacks?.get(new URI(request.editUri).normalizePath().toString());
        if (request?.reason === 'window_end') {
            if (!trial || trial.identity.token !== request.trialToken || trial.state.cancelled || !trial.state.started) return false;
            logSwapTrial(trial.identity, 'playback_pause', { reason: 'window_end' });
        } else if (trial) {
            logSwapTrial(trial.identity, 'playback_cancel', { reason: 'pause_command' });
            trial.cancel();
        }
        const widget = this.getExternalPreviewWidget(request?.editUri);
        if (!widget || !request) return false;
        const message: PreviewSetPlaybackMessage = { type: 'akari-preview-set-playback', playing: false };
        widget.sendMessage(message);
        return true;
    }

    protected async enterPreviewCropMode(request: PreviewCropModeRequest | undefined): Promise<boolean> {
        const widget = this.getExternalPreviewWidget(request?.editUri);
        if (!widget || !request) return false;
        if (request.on !== undefined && typeof request.on !== 'boolean') return false;
        if (request.itemId !== undefined
            && !widget.akariPreviewSummary?.layers?.some(layer => layer.id === request.itemId)) return false;
        const message: PreviewSetCropModeMessage = {
            type: 'akari-preview-set-crop-mode', itemId: request.itemId, on: request.on
        };
        widget.sendMessage(message);
        return true;
    }

    protected async openPreviewPerspectivePanel(request: PreviewPerspectivePanelRequest | undefined): Promise<boolean> {
        const widget = this.getExternalPreviewWidget(request?.editUri);
        if (!widget || !request) return false;
        if (request.on !== undefined && typeof request.on !== 'boolean') return false;
        if (request.itemId !== undefined
            && !widget.akariPreviewSummary?.layers?.some(layer => layer.id === request.itemId)) return false;
        const message: PreviewSetPerspectivePanelMessage = {
            type: 'akari-preview-set-perspective-panel', itemId: request.itemId, on: request.on
        };
        widget.sendMessage(message);
        return true;
    }

    protected async pulsePreviewItem(request: PulsePreviewItemRequest | undefined): Promise<boolean> {
        const widget = this.getExternalPreviewWidget(request?.editUri);
        if (!widget || !request) return false;
        if (typeof request.itemId !== 'string'
            || !(widget.akariPreviewSummary?.overlays?.some(overlay => overlay.id === request.itemId)
                || widget.akariPreviewSummary?.layers?.some(layer => layer.id === request.itemId))) return false;
        const message: PreviewPulseItemMessage = { type: 'akari-preview-pulse-item', itemId: request.itemId };
        widget.sendMessage(message);
        return true;
    }

    protected async showPreviewZoneHint(request: ShowPreviewZoneHintRequest | undefined): Promise<boolean> {
        const widget = this.getExternalPreviewWidget(request?.editUri);
        if (!widget || !request) return false;
        if (!Array.isArray(request.zones)) return false;
        const zones = request.zones.filter(zone => (CAPTION_ZONES as readonly string[]).includes(zone));
        if (!zones.length) return false;
        const durationMs = typeof request.durationMs === 'number' && Number.isFinite(request.durationMs)
            ? Math.min(8000, Math.max(300, request.durationMs)) : 2000;
        const message: PreviewZoneHintMessage = { type: 'akari-preview-zone-hint', zones, durationMs };
        widget.sendMessage(message);
        return true;
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
            const trial = this.swapTrialPlaybacks?.get(editUri.toString());
            if (trial) { logSwapTrial(trial.identity, 'playback_cancel', { reason: 'toggle_command' }); trial.cancel(); }
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
        if (request.waitForReady) {
            const trial = request.swapTrialToken ? this.swapTrialPlaybacks.get(key) : undefined;
            if (request.swapTrialToken && (!trial || trial.identity.token !== request.swapTrialToken || trial.state.cancelled)) throw new Error('trial cancelled');
            const alreadyConfigured = existing?.akariPreviewConfigured && !existing.isDisposed;
            const widget = alreadyConfigured ? existing
                : await this.getOrOpenPreview(editUri, { area: 'main' }, 'output') as PreviewWidgetMarker;
            if (!widget.isAttached) this.shell.addWidget(widget, { area: 'main' });
            this.shell.revealWidget(widget.id);
            this.attachTimelinePassively();
            // 保存通知と同じ本文は queueRefresh で共有し、二重の再読込を作らない。
            if (alreadyConfigured) {
                const editSource = (await this.fileService.readFile(editUri)).value.toString();
                this.queueRefresh(widget, editUri, 'output', undefined, false, editSource);
            }
            let refresh: Promise<void> | undefined;
            do {
                refresh = widget.akariPreviewRefresh;
                await refresh;
            } while (refresh !== widget.akariPreviewRefresh);
            await requestReadyPreviewSeek({
                pageId: () => widget.akariPreviewPlaybackPageId,
                disposed: () => widget.isDisposed || trial?.state.cancelled === true,
                send: message => widget.sendMessage(message),
                onMessage: listener => widget.onMessage(listener)
            }, request.time, trial ? 5000 : 30000, request.seek !== false);
            if (trial) {
                logSwapTrial(trial.identity, 'ready_seek_response', { pageId: widget.akariPreviewPlaybackPageId, seek: request.seek !== false });
                this.noteSwapReload(widget, 'reload_complete', widget.akariPreviewPlaybackPageId);
            }
            return 'seeked';
        }
        if (existing?.akariPreviewConfigured && existing.akariPreviewSeekable && !existing.isDisposed) {
            if (existing.isAttached) this.shell.revealWidget(existing.id);
            // お試しの保存通知で進行中の素材更新が終わってから新しい出力をシークする。
            await existing.akariPreviewRefresh;
            if (existing.isDisposed) return 'mismatched-asset';
            if (!existing.isAttached) {
                this.shell.addWidget(existing, { area: 'main' });
            }
            this.shell.revealWidget(existing.id);
            existing.sendMessage({ type: 'akari-preview-seek', time: request.time });
            return 'seeked';
        }
        try {
            this.pendingOutputInitialSeek?.set(key, request.time);
            if (!existing?.akariPreviewConfigured || existing.isDisposed) {
                await this.openPlaceholderPreview?.(editUri, request.time);
            }
            const widget = await this.getOrOpenPreview(editUri, { area: 'main' }, 'output', request.time);
            this.shell.revealWidget(widget.id);
            this.attachTimelinePassively();
            return 'seeked';
        } catch (error) {
            if (this.pendingOutputInitialSeek?.get(key) === request.time) this.pendingOutputInitialSeek.delete(key);
            this.discardFailedPlaceholder?.(editUri);
            this.reportOpenFailure(editUri, error);
            return 'mismatched-asset';
        }
    }

    protected async openPlaceholderPreview(uri: URI, timeSeconds?: number): Promise<WebviewWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, {
            id: `akari-output-preview-${this.hash(uri.toString())}`, viewId: uri.toString()
        });
        if (widget.isDisposed) throw new Error('Preview widget was disposed while opening.');
        widget.title.label = '出力プレビュー';
        widget.title.caption = uri.toString();
        widget.title.iconClass = 'codicon codicon-preview';
        if (!widget.isAttached) this.shell.addWidget(widget, { area: 'main' });
        this.shell.revealWidget(widget.id);
        const marker = widget as PreviewWidgetMarker;
        if (!this.placeholderPreviewStates.has(widget)
            && (marker.akariPreviewConfigured || marker.akariPreviewSeekable === false)) return widget;
        const existingState = this.placeholderPreviewStates.get(widget);
        if (existingState) {
            existingState.input.timeSeconds = timeSeconds;
            existingState.layer.innerHTML = previewPlaceholderHtml(existingState.input);
            return widget;
        }
        const layer = document.createElement('div');
        layer.setAttribute('data-akari-preview-placeholder', '');
        layer.style.cssText = 'position:absolute;inset:0;z-index:1000;pointer-events:none;container-type:size;background:#141414';
        const state = { input: { timeSeconds } as PreviewPlaceholderInput, layer,
            listener: undefined as Disposable | undefined, timeout: undefined as ReturnType<typeof setTimeout> | undefined };
        layer.innerHTML = previewPlaceholderHtml(state.input);
        widget.node.appendChild(layer);
        this.placeholderPreviewStates.set(widget, state);
        this.placeholderPreviewWidgets.set(uri.toString(), widget);
        state.listener = widget.onMessage(message => {
            // The playback tick follows the stage render. Ignore the old page and pre-position ticks.
            if (message?.type !== 'akari-preview-playback-tick' || message.positionReady !== true
                || message.pageId !== marker.akariPreviewPlaybackPageId) return;
            window.requestAnimationFrame(() => {
                if (message.pageId === marker.akariPreviewPlaybackPageId) this.removePlaceholderPreview(widget);
            });
        });
        widget.disposed.connect(() => this.removePlaceholderPreview(widget));
        if (marker.akariPreviewPlaybackPageId) this.armPlaceholderPreviewTimeout(widget);
        const update = (details: Partial<PreviewPlaceholderInput>): void => {
            if (widget.isDisposed || this.placeholderPreviewStates.get(widget) !== state) return;
            Object.assign(state.input, details);
            layer.innerHTML = previewPlaceholderHtml(state.input);
        };
        void this.loadPlaceholderPreviewGeometry(uri).then(update).catch(() => undefined);
        void this.loadPlaceholderPreviewImage(uri.parent).then(imageUrl => {
            if (imageUrl) update({ imageUrl });
        }).catch(() => undefined);
        return widget;
    }

    protected armPlaceholderPreviewTimeout(widget: WebviewWidget): void {
        const state = this.placeholderPreviewStates.get(widget);
        if (!state) return;
        if (state.timeout) clearTimeout(state.timeout);
        state.timeout = setTimeout(() => this.removePlaceholderPreview(widget), 10_000);
    }

    protected removePlaceholderPreview(widget: WebviewWidget): void {
        const state = this.placeholderPreviewStates.get(widget);
        if (!state) return;
        state.listener?.dispose();
        if (state.timeout) clearTimeout(state.timeout);
        state.layer.remove();
        this.placeholderPreviewStates.delete(widget);
        for (const [key, candidate] of this.placeholderPreviewWidgets) {
            if (candidate === widget) this.placeholderPreviewWidgets.delete(key);
        }
    }

    protected async loadPlaceholderPreviewGeometry(uri: URI): Promise<Pick<PreviewPlaceholderInput, 'width' | 'height'>> {
        const output = JSON.parse((await this.fileService.readFile(uri)).value.toString())?.output;
        return { width: output?.width, height: output?.height };
    }

    protected async loadPlaceholderPreviewImage(projectRoot: URI): Promise<string | undefined> {
        const cache = projectRoot.resolve('.akari/cache/project-card');
        try {
            const folders = (await this.fileService.resolve(cache, { resolveMetadata: true })).children ?? [];
            const candidates = folders.filter(folder => folder.isDirectory)
                .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) || b.resource.path.base.localeCompare(a.resource.path.base));
            for (const folder of candidates) {
                const poster = folder.resource.resolve('frame-1.jpg');
                try {
                    const stat = await this.fileService.resolve(poster, { resolveMetadata: true });
                    if (!stat.isFile || stat.size === undefined || stat.size > 512 * 1024) continue;
                    const bytes = (await this.fileService.readFile(poster)).value.buffer;
                    if (bytes.length > 512 * 1024) continue;
                    let binary = '';
                    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
                        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                    }
                    return `data:image/jpeg;base64,${btoa(binary)}`;
                } catch { /* Try the next cached card. */ }
            }
        } catch { /* An uncached project keeps the black stage. */ }
        return undefined;
    }

    protected discardFailedPlaceholder(uri: URI): void {
        const widget = this.placeholderPreviewWidgets.get(uri.toString());
        if (widget && this.placeholderPreviewStates.has(widget)) this.discardPreviewWidget(widget, uri, 'output');
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
            // DI 無しでライフサイクルだけを実行する既存テスト fixture との互換を保つ。
            const slot = this.materialSlot;
            if (kind === 'raw' && slot) {
                await slot.claim(existing, uri);
            } else if (!existing.isAttached) {
                this.shell.addWidget(existing, widgetOptions);
            }
            if (kind === 'output' && Number.isFinite(initialSeekTime)) {
                const latestSeekTime = this.pendingOutputInitialSeek?.get(seekKey) ?? initialSeekTime!;
                this.pendingOutputInitialSeek?.delete(seekKey);
                existing.sendMessage({ type: 'akari-preview-seek', time: latestSeekTime });
            }
            return existing;
        }

        if (kind === 'output' && Number.isFinite(initialSeekTime) && !this.pendingOutputInitialSeek?.has(seekKey)) {
            this.pendingOutputInitialSeek?.set(seekKey, initialSeekTime!);
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
                // DI 無しの既存テスト fixture では従来の shell 追加経路を使う。
                const slot = this.materialSlot;
                if (kind === 'raw' && slot) {
                    await slot.claim(widget, uri);
                } else if (!widget.isAttached) {
                    this.shell.addWidget(widget, widgetOptions);
                }
                // cut の ID 解決に summary、webview への送信に attach が必要なので configure/addWidget 後に問い合わせる。
                if (kind === 'output') {
                    window.dispatchEvent(new CustomEvent(PREVIEW_ADJUST_BYPASS_QUERY_EVENT, { detail: { key: seekKey } }));
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
            this.pendingOutputInitialSeek?.delete(seekKey);
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
        this.removePlaceholderPreview?.(widget);
        if (!widget.isDisposed) {
            widget.dispose();
        }
        void this.disposePreviewStreams(marker);
    }

    protected reportOpenFailure(uri: URI, error: unknown): void {
        console.error('[akari-preview] failed to open preview', uri.toString(), error);
        void this.reportOpenFailureNotice(uri, error);
    }

    protected async reportOpenFailureNotice(uri: URI, error: unknown): Promise<void> {
        if (isUnknownKeyEditError(error)) {
            const [stampText, currentVersion] = await Promise.all([
                this.fileService.readFile(uri.parent.resolve(SAVED_BY_PATH)).then(file => file.value.toString()).catch(() => undefined),
                this.currentAppVersionPromise ??= this.applicationServer.getApplicationInfo()
                    .then(info => info?.version).catch(() => undefined)
            ]);
            const newerVersion = newerSavedByVersion(stampText, currentVersion);
            if (newerVersion && currentVersion) {
                const choice = await this.messages.error(
                    `${uri.path.base}: 動画プレビューを開けませんでした — ${newerVersionOpenNotice(newerVersion, currentVersion)}`,
                    'アップデートを確認'
                );
                if (choice === 'アップデートを確認') {
                    await this.commandService.executeCommand('akari.settings.open', { section: 'about' });
                }
                return;
            }
        }
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
        if (kind === 'output' && !marker.akariLibraryDrop) {
            marker.akariLibraryDrop = new PreviewLibraryDrop(widget, this.commandService, this.messages,
                () => marker.akariPreviewEditUri?.toString(),
                () => marker.akariPreviewSummary?.output,
                () => this.fullscreenPreviewWidget === widget);
        }
        if (marker.akariPreviewConfiguration) {
            return marker.akariPreviewConfiguration;
        }
        marker.akariPreviewConfiguration = this.doConfigurePreview(marker, identityUri, kind, initialSeekTime);
        try {
            await marker.akariPreviewConfiguration;
            if (kind === 'output') {
                const latestSeekTime = this.pendingOutputInitialSeek?.get(identityUri.normalizePath().toString());
                this.pendingOutputInitialSeek?.delete(identityUri.normalizePath().toString());
                if (!marker.isDisposed && Number.isFinite(latestSeekTime) && latestSeekTime !== initialSeekTime) {
                    marker.sendMessage({ type: 'akari-preview-seek', time: latestSeekTime });
                }
            }
        } finally {
            marker.akariPreviewConfiguration = undefined;
        }
    }

    protected async listRunMyStyles(): Promise<Array<{ id: string; name: string;
        parts: Array<{ kind: string; text_style?: unknown }> }>> {
        try {
            const styles: unknown = await this.commandService.executeCommand('akari.library.listMyStyles');
            return Array.isArray(styles) ? styles : [];
        } catch {
            return [];
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
        // Read photo generation status alongside the initial preview load so the
        // context bar can render existing photos completely on its first paint.
        const initialPhotoSidecars = kind === 'output'
            ? this.currentWorkspaceRoots().then(workspaceRoots => this.previewService.readGenerationSidecars({
                editUri: identityUri.toString(), workspaceRoots
            })).catch(() => undefined)
            : Promise.resolve(undefined);
        await this.refreshPreview(widget, identityUri, kind, initialSeekTime);

        if (widget.isDisposed) {
            return;
        }

        if (widget.akariPreviewConfigured) {
            return;
        }
        widget.akariPreviewConfigured = true;
        const disposables = new DisposableCollection();
        let activeBrushItemId: string | null = null;
        const onPhotoBrush = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; itemId?: string; settings?: unknown }>).detail;
            if (kind !== 'output' || detail?.editUri !== widget.akariPreviewEditUri?.toString() || !detail.itemId) return;
            activeBrushItemId = detail.settings ? detail.itemId : null;
            widget.sendMessage({ type: 'akari-preview-photo-brush', itemId: detail.itemId, settings: detail.settings });
        };
        disposables.push(listen(window, 'akari.photo.brush', onPhotoBrush));
        const onPhotoBrushEnd = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string }>).detail;
            if (detail?.editUri === widget.akariPreviewEditUri?.toString()) activeBrushItemId = null;
        };
        disposables.push(listen(window, 'akari.photo.brush-end', onPhotoBrushEnd));
        const onMainEscape = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape' || !activeBrushItemId) return;
            widget.sendMessage({ type: 'akari-preview-photo-brush', itemId: activeBrushItemId, settings: null });
            activeBrushItemId = null;
            window.dispatchEvent(new CustomEvent('akari.photo.brush-end', { detail: {
                editUri: widget.akariPreviewEditUri?.toString()
            } }));
        };
        disposables.push(listen(window, 'keydown', onMainEscape, true));
        const onPhotoSelect = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; itemId?: string }>).detail;
            if (kind !== 'output' || detail?.editUri !== widget.akariPreviewEditUri?.toString() || !detail.itemId) return;
            widget.sendMessage({ type: 'akari-preview-photo-select', itemId: detail.itemId });
        };
        disposables.push(listen(window, 'akari.photo.select', onPhotoSelect));
        const onPhotoSelectStop = (event: Event): void => {
            const detail = (event as CustomEvent<{ itemId?: string }>).detail;
            if (kind !== 'output' || !detail?.itemId) return;
            widget.sendMessage({ type: 'akari-preview-photo-select-stop', itemId: detail.itemId });
        };
        disposables.push(listen(window, 'akari.photo.select-stop', onPhotoSelectStop));
        const onPhotoHighlight = (event: Event): void => {
            const detail = (event as CustomEvent<{ itemId?: string; png?: string }>).detail;
            if (kind !== 'output' || !detail?.itemId) return;
            widget.sendMessage({ type: 'akari-preview-photo-highlight', itemId: detail.itemId, png: detail.png });
        };
        disposables.push(listen(window, 'akari.photo.highlight', onPhotoHighlight));
        // Seed the bar from the edit's existing sources before its first state read.
        // Unknown paths (such as a newly drawn frame) stay conservative until checked.
        const photoToolCache = new Map<string, boolean>();
        const photoToolReads = new Map<string, Promise<boolean>>();
        let latestPhotoSelection = '';
        let photoStateRevision = 0;
        let photoTableRevision = 0;
        let onKnownAvailabilityChanged = (): void => undefined;
        const availabilityForSource = (sourcePath: string, sidecars: ReadGenerationSidecarsResult): boolean => {
            const direct = sidecars.entries.find(entry => entry.sourcePath === sourcePath);
            const generation = selectGenerationSidecarForSource(sourcePath, sidecars.entries.map(entry => ({
                sourcePath: entry.sourcePath,
                meta: entry.meta as GenerationMetaV1 | null,
                binding: entry.binding
            })), Date.now()) ?? direct;
            const state = resolveGenerationState(generation?.meta, Date.now(), generation?.binding);
            return photoToolsAvailableFor({ emptyFrame: state === 'planned', generationState: state });
        };
        const readPhotoSidecars = async (editUri: string): Promise<ReadGenerationSidecarsResult> =>
            this.previewService.readGenerationSidecars({ editUri, workspaceRoots: await this.currentWorkspaceRoots() });
        const prewarmPhotoTools = async (prefetched?: ReadGenerationSidecarsResult): Promise<void> => {
            const editUri = widget.akariPreviewEditUri?.toString();
            if (!editUri || widget.isDisposed) return;
            const revision = ++photoTableRevision;
            try {
                const sidecars = prefetched && editUri === identityUri.toString()
                    ? prefetched : await readPhotoSidecars(editUri);
                if (widget.isDisposed || revision !== photoTableRevision
                    || editUri !== widget.akariPreviewEditUri?.toString()) return;
                let changed = false;
                for (const entry of sidecars.entries) {
                    const available = availabilityForSource(entry.sourcePath, sidecars);
                    if (photoToolCache.get(entry.sourcePath) !== available) changed = true;
                    photoToolCache.set(entry.sourcePath, available);
                }
                if (changed) onKnownAvailabilityChanged();
            } catch {
                // Preserve the last known value when sidecar reading fails.
            }
        };
        const readPhotoToolsAvailable = async (sourcePath: string, editUri: string): Promise<boolean> =>
            availabilityForSource(sourcePath, await readPhotoSidecars(editUri));
        const refreshPhotoToolsAvailable = (sourcePath: string, editUri: string): Promise<boolean> => {
            const pending = photoToolReads.get(sourcePath);
            if (pending) return pending;
            const request = readPhotoToolsAvailable(sourcePath, editUri).finally(() => {
                if (photoToolReads.get(sourcePath) === request) photoToolReads.delete(sourcePath);
            });
            photoToolReads.set(sourcePath, request);
            return request;
        };
        class GenerationAwareContextBar extends PreviewContextBar {
            refreshKnownAvailability(): void {
                const state = this.state;
                if (state?.kind !== 'photo' || !state.sourcePath) return;
                const available = photoToolCache.get(state.sourcePath);
                if (available !== undefined && available !== state.photoToolsAvailable) {
                    super.setState({ ...state, photoToolsAvailable: available });
                }
            }

            protected override setState(value: unknown): void {
                const revision = ++photoStateRevision;
                const state = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
                if (!state || state.kind !== 'photo' || typeof state.sourcePath !== 'string'
                    || state.editUri !== widget.akariPreviewEditUri?.toString()) {
                    latestPhotoSelection = '';
                    super.setState(value);
                    return;
                }
                const sourcePath = state.sourcePath;
                const selection = `${String(state.selectedId ?? '')}:${sourcePath}`;
                latestPhotoSelection = selection;
                const cached = photoToolCache.get(sourcePath);
                super.setState({ ...state, photoToolsAvailable: cached ?? false });
                void refreshPhotoToolsAvailable(sourcePath, String(state.editUri)).then(available => {
                    photoToolCache.set(sourcePath, available);
                    if (revision !== photoStateRevision || selection !== latestPhotoSelection || widget.isDisposed) return;
                    if ((cached ?? false) !== available) super.setState({ ...state, photoToolsAvailable: available });
                }).catch(() => undefined); // Keep the last known value when lookup fails.
            }
        }
        if (kind === 'output') await prewarmPhotoTools(await initialPhotoSidecars);
        // 上のバー・選んだものの上の小さなメニュー（中身は preview-context-bar.ts）
        const contextBar = kind === 'output' ? new GenerationAwareContextBar({
            node: widget.node, sendMessage: message => widget.sendMessage(message),
            editUri: () => widget.akariPreviewEditUri?.toString()
        }, this.commandRegistry) : undefined;
        if (contextBar) {
            onKnownAvailabilityChanged = () => contextBar.refreshKnownAvailability();
            widget.node.dataset.akariOutputPreview = 'true';
            disposables.push(contextBar.start());
            const matchesEdit = (uri: string): boolean => {
                const editUri = widget.akariPreviewEditUri;
                if (!editUri) return false;
                try {
                    const changed = new URI(uri);
                    return changed.toString() === editUri.toString()
                        || this.resourceSuffix(changed) === this.resourceSuffix(editUri);
                } catch { return false; }
            };
            const onEditPhotoSources = (event: Event): void => {
                const uri = (event as CustomEvent<{ uri?: unknown }>).detail?.uri;
                if (typeof uri === 'string' && matchesEdit(uri)) void prewarmPhotoTools();
            };
            disposables.push(listen(window, EDIT_STORE_DID_WRITE_EVENT, onEditPhotoSources));
            disposables.push(this.fileService.onDidFilesChange(event => {
                if (event.changes.some(change => matchesEdit(change.resource.toString())
                    || change.resource.path.base.endsWith('.meta.json'))) void prewarmPhotoTools();
            }));
        }
        const onPhotoCropOpen = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; itemId?: string }>).detail;
            if (kind !== 'output' || detail?.editUri !== widget.akariPreviewEditUri?.toString() || !detail.itemId) return;
            widget.sendMessage({ type: 'akari-preview-set-crop-mode', itemId: detail.itemId, on: true });
        };
        disposables.push(listen(window, 'akari.photo.crop-open', onPhotoCropOpen));
        const onMotionDraw = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; itemId?: string }>).detail;
            if (kind !== 'output' || detail?.editUri !== widget.akariPreviewEditUri?.toString() || !detail.itemId) return;
            widget.sendMessage({ type: 'akari-preview-motion-draw', itemId: detail.itemId });
        };
        disposables.push(listen(window, 'akari.motion.draw', onMotionDraw));
        let lastAudioMeterFrame: AudioMeterFrame | undefined;
        widget.disposed.connect(() => { if (widget.node?.dataset) delete widget.node.dataset.akariCaptionEditingFocus; });
        widget.disposed.connect(() => this.forwardAudioMeterFrame(widget, {
            type: 'akari-preview-audio-meter', peak: [0, 0], rms: [0, 0], clip: false,
            playing: false, channels: lastAudioMeterFrame?.channels ?? 2,
            engine: lastAudioMeterFrame?.engine ?? 'frame-engine', t: lastAudioMeterFrame?.t ?? 0
        }));
        let collapsedBagSummary: EditSummary | undefined;
        let projectedBagSummary: EditSummary | undefined;
        // 先勝ち（条件を満たせば return で抜ける）メッセージの表。true = 処理済み（呼び出し側が return）、false = 条件外（次の if へ落ちる）。
        const firstWinsMessages = new Map<string, (message: any) => boolean>([
            ['akari-preview-caption-edit-focus', message => {
                if (message?.type === 'akari-preview-caption-edit-focus' && kind === 'output') {
                    widget.node.dataset.akariCaptionEditingFocus = message.focused ? 'true' : 'false';
                    return true;
                }
                return false;
            }],
            [PREVIEW_CONTEXT_BOX_MESSAGE, message => {
                if (message?.type === PREVIEW_CONTEXT_BOX_MESSAGE) {
                    contextBar?.receive(message);
                    return true;
                }
                return false;
            }],
            ['akari-preview-photo-analyze', message => {
                if (message?.type === 'akari-preview-photo-analyze' && kind === 'output') {
                    void dispatchPhotoAnalysis({ editUri: widget.akariPreviewEditUri?.toString(),
                        id: message.itemId, kind: message.kind }, detail => {
                        window.dispatchEvent(new CustomEvent('akari.photo.analyze', { detail }));
                    }, (callback, delay) => { window.setTimeout(callback, delay); }).then(result => {
                        widget.sendMessage({ type: 'akari-preview-photo-analyze-response',
                            requestId: message.requestId, ok: true, result });
                    });
                    return true;
                }
                return false;
            }],
            ['akari-preview-photo-brush-end', message => {
                if (message?.type === 'akari-preview-photo-brush-end' && kind === 'output') {
                    window.dispatchEvent(new CustomEvent('akari.photo.brush-end', { detail: {
                        editUri: widget.akariPreviewEditUri?.toString()
                    } }));
                    return true;
                }
                return false;
            }],
            ['akari-preview-photo-stroke', message => {
                if (message?.type === 'akari-preview-photo-stroke' && kind === 'output'
                    && typeof message.itemId === 'string' && message.stroke) {
                    window.dispatchEvent(new CustomEvent('akari.photo.stroke', { detail: {
                        editUri: widget.akariPreviewEditUri?.toString(), id: message.itemId, stroke: message.stroke
                    } }));
                    return true;
                }
                return false;
            }],
            ['akari-preview-photo-click', message => {
                if (message?.type === 'akari-preview-photo-click' && kind === 'output'
                    && typeof message.itemId === 'string' && Array.isArray(message.point)) {
                    window.dispatchEvent(new CustomEvent('akari.photo.click', { detail: {
                        editUri: widget.akariPreviewEditUri?.toString(), id: message.itemId, point: message.point
                    } }));
                    return true;
                }
                return false;
            }],
            ['akari-preview-photo-hover', message => {
                if (message?.type === 'akari-preview-photo-hover' && kind === 'output'
                    && typeof message.itemId === 'string') {
                    window.dispatchEvent(new CustomEvent('akari.photo.hover', { detail: {
                        editUri: widget.akariPreviewEditUri?.toString(), id: message.itemId,
                        point: Array.isArray(message.point) ? message.point : null
                    } }));
                    return true;
                }
                return false;
            }],
            ['akari-preview-photo-select-end', message => {
                if (message?.type === 'akari-preview-photo-select-end' && kind === 'output'
                    && typeof message.itemId === 'string') {
                    window.dispatchEvent(new CustomEvent('akari.photo.select-end', { detail: { id: message.itemId } }));
                    return true;
                }
                return false;
            }],
            ['akari-preview-capture-frame', message => {
                if (message?.type === 'akari-preview-capture-frame') {
                    const token = message.startToken;
                    if (token === undefined) void this.capturePreviewFrame(widget, message);
                    else if (typeof token === 'string' && typeof message.pageId === 'string'
                        && this.pendingFrameCaptures.take(token, widget, message.pageId)) {
                        void this.capturePreviewFrame(widget, message).then(path =>
                            this.pendingFrameCaptures.resolve(token, widget, message.pageId, path), error =>
                            this.pendingFrameCaptures.reject(token, widget, message.pageId,
                                error instanceof Error ? error : new Error(String(error))));
                    }
                    return true;
                }
                return false;
            }],
            ['akari-preview-capture-busy', message => {
                if (message?.type === 'akari-preview-capture-busy' && typeof message.token === 'string'
                    && typeof message.pageId === 'string') {
                    this.pendingFrameCaptures.reject(message.token, widget, message.pageId,
                        new Error('前のコマを保存中です'));
                    return true;
                }
                return false;
            }],
            ['akari-preview-expand-bag', message => {
                if (message?.type === 'akari-preview-expand-bag' && kind === 'output'
                    && (message.bagId === null || typeof message.bagId === 'string')
                    && Number.isSafeInteger(message.requestId)) {
                    const current = widget.akariPreviewSummary;
                    if (!current) return true;
                    if (current !== projectedBagSummary) collapsedBagSummary = current;
                    const base = collapsedBagSummary ?? current;
                    const bagId: string | null = message.bagId;
                    const bagNode = base.tree?.find(node => node.id === bagId && node.kind === 'bag'
                        && 'lazy' in node && node.lazy === true);
                    if (bagId !== null && !bagNode) return true;
                    // Only an untouched, all-scanned bag reaches here. Its renderer
                    // record already contains group composition, clipping and assets.
                    // Keep those fields and use the shared projector for the masks.
                    const overlays = base.overlays.flatMap(overlay => {
                        if (overlay.id !== bagId) return [overlay];
                        const bag = { id: overlay.id, at: overlay.start, duration: overlay.duration,
                            source: { kind: 'html', html: overlay.html }, declaration: overlay };
                        const children = projectBagChildren(bag, scanHtmlParts(overlay.html));
                        return expandBagOverlays({ tracks: [{ items: [{ ...bag, children }] }] })
                            .map(part => ({ ...overlay, id: part.id, html: part.html,
                                parentId: overlay.id, part: part.part }));
                    });
                    projectedBagSummary = { ...base, overlays };
                    widget.akariPreviewSummary = projectedBagSummary;
                    widget.sendMessage({ type: 'akari-preview-expand-bag', bagId,
                        requestId: message.requestId, summary: projectedBagSummary });
                    return true;
                }
                return false;
            }],
            ['akari-preview-diagnostics', message => {
                // 診断（第11・12項）: ページ側の段の報告。届かないこと自体も証跡になる
                // （ホスト側の監視が「報告なし」として記録する）。
                if (isPreviewDiagnosticsReport(message)) {
                    widget.akariPreviewDiagnostics?.ingest(message);
                    return true;
                }
                return false;
            }],
            ['akari-preview-raw-audio-request', message => {
                if (kind === 'raw' && message?.type === 'akari-preview-raw-audio-request') {
                    const rawAudio = widget.akariPreviewRawAudio;
                    if (rawAudio?.pageId === message.pageId && rawAudio.url) {
                        widget.sendMessage({ type: 'akari-preview-raw-audio-ready',
                            pageId: rawAudio.pageId, url: rawAudio.url });
                    }
                    return true;
                }
                return false;
            }],
            ['akari-preview-gesture', message => {
                if (message?.type === 'akari-preview-gesture'
                    && (message.phase === 'begin' || message.phase === 'saved' || message.phase === 'end')) {
                    const result = reducePreviewGesture(
                        this.previewGestureGuards.get(widget) ?? { active: false },
                        { type: message.phase }
                    );
                    this.previewGestureGuards.set(widget, result.state);
                    if (result.refresh) {
                        this.queueRefresh(widget, identityUri, kind,
                            result.refresh.seekTimeOverride, result.refresh.forceRebuild, result.refresh.editSource);
                    }
                    return true;
                }
                return false;
            }],
            ['akari-preview-live-values', message => {
                if (message?.type === 'akari-preview-live-values') {
                    const values = previewLiveValues(message);
                    if (!values) return true;
                    window.dispatchEvent(new CustomEvent('akari.preview.liveValues', {
                        detail: { ...values, editUri: widget.akariPreviewEditUri?.normalizePath().toString() }
                    }));
                    return true;
                }
                return false;
            }]
        ]);
        disposables.push(widget.onMessage(message => {
            if (firstWinsMessages.get(message?.type)?.(message)) return;
            const trial = this.swapTrialPlaybacks?.get(widget.akariPreviewEditUri?.normalizePath().toString() ?? '');
            if (trial && message?.type === 'akari-preview-swap-user-control') {
                logSwapTrial(trial.identity, 'playback_cancel', { reason: 'user_control' }); trial.cancel();
            } else if (trial && message?.pageId === widget.akariPreviewPlaybackPageId) {
                if (message.type === 'akari-preview-swap-playback-state' && message.token === trial.identity.token) {
                    trial.event({ type: 'observed', playing: message.playing === true, userStopped: message.userStopped });
                    logSwapTrial(trial.identity, 'playback_state', { playing: message.playing, userStopped: message.userStopped, source: 'renderer' });
                }
            }
            if (message?.type === 'akari-preview-alt-all' && typeof message.on === 'boolean') {
                window.dispatchEvent(new CustomEvent('akari.selection.altAll', { detail: { on: message.on } }));
            }
            if (message?.type === 'akari-preview-context-menu') {
                console.debug('[akari-preview] context menu', message);
                const editUri = widget.akariPreviewEditUri?.normalizePath().toString();
                if (kind === 'output' && editUri && typeof message.timelineT === 'number'
                    && Number.isFinite(message.timelineT)
                    && typeof message.x === 'number' && Number.isFinite(message.x)
                    && typeof message.y === 'number' && Number.isFinite(message.y)) {
                    const selection = this.primaryTimelineSelections.get(editUri);
                    this.lastClipAnnotationContext = {
                        editUri,
                        timelineT: message.timelineT,
                        ...(selection?.kind === 'cut' ? { itemId: selection.id, kind: 'cut' as const } : {})
                    };
                    const selectedIds = Array.isArray(message.selectedIds)
                        && message.selectedIds.every((id: unknown) => typeof id === 'string')
                        ? [...new Set<string>(message.selectedIds)] : [];
                    this.previewGroupMenuContext = {
                        source: 'akari-output-preview', editUri, selectedIds,
                        selectionKind: ['leaf', 'group', 'multi'].includes(message.selectionKind)
                            ? message.selectionKind : 'leaf',
                        selectedNodeKind: ['leaf', 'group', 'bag'].includes(message.selectedNodeKind)
                            ? message.selectedNodeKind : undefined,
                        scopeNodeKind: ['leaf', 'group', 'bag'].includes(message.scopeNodeKind)
                            ? message.scopeNodeKind : undefined,
                        scopeId: typeof message.scopeId === 'string' ? message.scopeId : null
                    };
                    if (selectedIds.length >= 2 && this.previewGroupMenuContext.selectionKind === 'multi'
                        && (this.previewGroupMenuContext.scopeNodeKind === 'bag'
                            || selectedIds.some(id => id.includes('#')))) {
                        window.dispatchEvent(new CustomEvent('akari.preview.groupUnavailable', { detail: { editUri } }));
                    }
                    const rect = widget.node.getBoundingClientRect();
                    this.contextMenuRenderer.render({
                        menuPath: WEBVIEW_CONTEXT_MENU,
                        args: [this.previewGroupMenuContext],
                        anchor: {
                            x: rect.x + rect.width * message.x,
                            y: rect.y + rect.height * message.y
                        },
                        context: widget.node
                    });
                }
            }
            const selectionKey = widget.akariPreviewEditUri?.normalizePath().toString();
            if (selectionKey && message?.type === 'akari-preview-cut-selected' && message.cutId) {
                this.primaryTimelineSelections.set(selectionKey, { kind: 'cut', id: message.cutId });
            } else if (selectionKey && message?.type === 'akari-preview-caption-selected' && message.captionId) {
                this.primaryTimelineSelections.set(selectionKey, { kind: 'caption', id: message.captionId });
            } else if (selectionKey && ((message?.type === 'akari-preview-overlay-selected' && message.overlayId)
                || (message?.type === 'akari-preview-layer-selected' && message.layerId))) {
                this.primaryTimelineSelections.set(selectionKey, null);
            }
            if (selectionKey && ((message?.type === 'akari-preview-cut-selected' && message.cutId === null
                && this.primaryTimelineSelections.get(selectionKey)?.kind === 'cut')
                || (message?.type === 'akari-preview-caption-selected' && message.captionId === null
                    && this.primaryTimelineSelections.get(selectionKey)?.kind === 'caption'))) {
                this.primaryTimelineSelections.set(selectionKey, null);
            }
            if (selectionKey && message?.type === 'akari-preview-overlay-selected') {
                this.timelineOverlaySelections.set(selectionKey, message.overlayId);
                if (message.overlayId) this.timelineLayerSelections.set(selectionKey, null);
            } else if (selectionKey && message?.type === 'akari-preview-layer-selected') {
                this.timelineLayerSelections.set(selectionKey, message.layerId);
                if (message.layerId) this.timelineOverlaySelections.set(selectionKey, null);
            } else if (selectionKey && ((message?.type === 'akari-preview-cut-selected' && message.cutId)
                || (message?.type === 'akari-preview-caption-selected' && message.captionId))) {
                this.timelineOverlaySelections.set(selectionKey, null);
                this.timelineLayerSelections.set(selectionKey, null);
            }
            if (message?.type === 'akari-preview-primary-selection-ready') {
                if (message.pageId === widget.akariPreviewPlaybackPageId) {
                    this.previewMessageReadyPages.set(widget, message.pageId);
                }
                this.noteSwapReload(widget, 'reload_complete', message.pageId);
                const key = widget.akariPreviewEditUri?.normalizePath().toString();
                if (key && this.timelineOverlaySelections.has(key)) widget.sendMessage({ type: 'akari-preview-select-overlay', overlayId: this.timelineOverlaySelections.get(key) });
                if (key && this.timelineLayerSelections.has(key)) widget.sendMessage({ type: 'akari-preview-select-layer', layerId: this.timelineLayerSelections.get(key) });
                if (key && this.primaryTimelineSelections.has(key)) {
                    widget.sendMessage({ type: 'akari-preview-select-primary', selection: this.primaryTimelineSelections.get(key) });
                }
                if (key && this.timelineCaptionSelections.has(key)) {
                    widget.sendMessage({
                        type: 'akari-preview-set-selected-captions', ...this.timelineCaptionSelections.get(key)
                    });
                }
                if (key && this.timelineGroupSelections.has(key)) widget.sendMessage({
                    type: 'akari-preview-set-selected-group', selection: this.timelineGroupSelections.get(key)
                });
            }
            if (message?.type === 'akari-preview-generation-request' && kind === 'output') {
                this.queueGenerationUpdate(widget);
            }
            if (isAudioMeterFrame(message)) {
                lastAudioMeterFrame = message;
                this.forwardAudioMeterFrame(widget, message);
            }
            if (message && message.type === 'akari-preview-audio-priority') {
                void this.handlePreviewAudioPriority(widget, message.time);
            }
            if (isOverlayWriteRequest(message)) {
                this.previewItemWriteTail = this.previewItemWriteTail.then(() => this.handleOverlayWrite(widget, message));
                this.previewItemWriteTail = this.previewItemWriteTail.catch(error => {
                    console.error('[akari-preview] item write failed', error);
                });
            }
            if (isOverlayWriteBatchRequest(message)) {
                this.previewItemWriteTail = this.previewItemWriteTail.then(() => this.handleOverlayWriteBatch(widget, message));
                this.previewItemWriteTail = this.previewItemWriteTail.catch(error => {
                    console.error('[akari-preview] item write failed', error);
                });
            }
            if (isLayerWriteRequest(message)) {
                this.previewItemWriteTail = this.previewItemWriteTail.then(() => this.handleLayerWrite(widget, message));
                this.previewItemWriteTail = this.previewItemWriteTail.catch(error => {
                    console.error('[akari-preview] item write failed', error);
                });
            }
            if (message?.type === 'akari-preview-open-audio-meter') {
                void this.openAudioMeter();
            }
            if (isHevcFallbackRequest(message)) {
                void this.handleHevcFallbackRequest(widget, identityUri, kind, message);
            }
            if (isOpenOutputRequest(message)) {
                void this.handleOpenOutputRequest(widget);
            }
            if (message?.type === 'akari-preview-fullscreen-toggle') {
                this.togglePreviewFullscreen(widget);
            }
            if (message?.type === 'akari-preview-fullscreen-exit') {
                this.exitPreviewFullscreen();
            }
            if (message?.type === 'akari-preview-fullscreen-sync-request') {
                widget.sendMessage({
                    type: 'akari-preview-fullscreen-state',
                    active: this.fullscreenPreviewWidget === widget
                });
            }
            if (message?.type === 'akari-preview-frame-engine-fallback') {
                widget.akariPreviewFrameEngineOptOut = true;
                this.queueRefresh(widget, identityUri, kind, widget.akariPreviewLastKnownTime, true);
            }
            if (isPlaybackRateRequest(message)) {
                widget.akariPreviewPlaybackRate = message.rate;
            }
            if (isPlaybackTickRequest(message)) {
                this.forwardPlaybackTick(widget, message);
            }
            if (isOverlaySelectedRequest(message)) {
                this.forwardOverlaySelection(widget, message);
            }
            if (isLayerSelectedRequest(message)) {
                this.forwardLayerSelection(widget, message);
            }
            if (isCutSelectedRequest(message)) {
                this.forwardCutSelection(widget, message);
            }
            if (isCutWriteRequest(message)) {
                this.previewItemWriteTail = this.previewItemWriteTail.then(() => this.handleCutWrite(widget, message));
                this.previewItemWriteTail = this.previewItemWriteTail.catch(error => {
                    console.error('[akari-preview] item write failed', error);
                });
            }
            if (isCaptionSelectedRequest(message)) {
                this.forwardCaptionSelection(widget, message);
            }
            if (message?.type === 'akari-preview-mixed-selected' && Array.isArray(message.selection)
                && message.selection.every((item: any) => item && ['caption', 'layer', 'overlay'].includes(item.kind)
                    && typeof item.id === 'string' && item.id.length > 0)) {
                const editUri = widget.akariPreviewEditUri?.normalizePath().toString();
                if (editUri) window.dispatchEvent(new CustomEvent('akari.preview.mixedSelected', {
                    detail: { editUri, selection: message.selection }
                }));
            }
            if (message?.type === 'akari-preview-mixed-move') {
                const itemTail = this.previewItemWriteTail;
                const captionTail = this.captionWriteTail;
                const operation = Promise.all([itemTail, captionTail]).then(() =>
                    this.handleMixedMove(widget, message));
                this.previewItemWriteTail = operation.catch(error => console.error('[akari-preview] mixed move failed', error));
                this.captionWriteTail = this.previewItemWriteTail;
            }
            if (message?.type === 'akari-preview-caption-write') {
                if (!isCaptionWriteRequest(message)) {
                    if (typeof message.requestId === 'string') widget.sendMessage({
                        type: 'akari-preview-caption-write-response', requestId: message.requestId,
                        ok: false, error: '字幕の書き込み要求が不正です'
                    });
                } else {
                    this.captionWriteTail = this.captionWriteTail.catch(error => {
                        console.error('[akari-preview] previous caption write failed', error);
                    }).then(() => this.handleCaptionWrite(widget, message));
                }
            }
            if (message?.type === 'akari-preview-caption-inspector'
                && ['caption-style', 'caption-style-color', 'caption-style-stroke-color', 'caption-style-bg-color'].includes(message.field)) {
                const command = this.commandRegistry.getCommand('akari.inspector.revealField');
                void this.commandRegistry.executeCommand(
                    command ? 'akari.inspector.revealField' : 'akari.inspector.open',
                    ...(command ? [{ field: message.field }] : [])
                );
            }
            if (message?.type === 'akari-preview-my-style-save' && typeof message.captionId === 'string') {
                window.dispatchEvent(new CustomEvent('akari.mystyle.open-save', { detail: { captionId: message.captionId } }));
            }
            if (message?.type === 'akari-preview-run-styles-request' && typeof message.captionId === 'string') {
                void (async () => {
                    const source = widget.akariPreviewCaptionsUri
                        ? JSON.parse(await this.readText(widget.akariPreviewCaptionsUri)) as {
                            captions?: Array<{ id: string; text_style?: { size_px?: number } }>;
                            default_text_style?: { size_px?: number };
                        } : {};
                    const caption = source.captions?.find(item => item.id === message.captionId);
                    const baseSize = caption?.text_style?.size_px ?? source.default_text_style?.size_px ?? 38;
                    const saved = await this.listRunMyStyles();
                    const choices = runStyleChoices(saved, baseSize);
                    widget.sendMessage({ type: 'akari-preview-run-styles', choices });
                })().catch(error => this.messages.warn(error instanceof Error ? error.message : String(error)));
            }
            if (message?.type === 'akari-preview-run-style-omitted' && typeof message.notice === 'string') {
                void this.messages.info(message.notice, { timeout: 4000 });
            }
            if (isReviewTransportRequest(message)) {
                this.forwardReviewTransport(widget, message);
            }
            if (isReviewStrokeStartRequest(message)) {
                this.forwardReviewStrokeStart(widget, message);
            }
            if (isReviewStrokeEndRequest(message)) {
                this.forwardReviewStrokeEnd(widget, message);
            }
            if (isReviewRectStartRequest(message)) {
                this.forwardReviewRectStart(widget, message);
            }
            if (isReviewRectEndRequest(message)) {
                this.forwardReviewRectEnd(widget, message);
            }
            if (isReviewToolModeRequest(message)) {
                this.forwardReviewToolModeRequest(widget, message);
            }
            if (message?.type === 'akari-preview-reload-retry') {
                this.queueRefresh(widget, identityUri, kind, undefined, true);
            }
        }));
        let placement: { key: string; at: number; until?: number; baseline: Promise<string>;
            refreshedContent?: string } | undefined;
        const onPlacement = (event: Event): void => {
            const detail = (event as CustomEvent<{ phase?: string; editUri?: string; key?: string }>).detail;
            const editUri = widget.akariPreviewEditUri;
            if (!editUri || detail?.editUri !== editUri.toString()) return;
            if (detail.phase === 'begin' && typeof detail.key === 'string') {
                const referencesUri = editUri.parent.resolve('.akari/asset-references.json');
                placement = { key: detail.key, at: Date.now(), baseline: this.readText(referencesUri)
                    .catch(() => '{"version":0,"references":[]}') };
            } else if (detail.phase === 'end' && placement?.key === detail.key) {
                placement.until = Date.now() + RECENT_WRITE_WINDOW_MS;
                const completed = placement;
                window.setTimeout(() => { if (placement === completed) placement = undefined; }, RECENT_WRITE_WINDOW_MS);
            }
        };
        window.addEventListener('akari-preview-placement', onPlacement);
        disposables.push({ dispose: () => window.removeEventListener('akari-preview-placement', onPlacement) });
        const onPlacementDiagnostic = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; key?: string; stage?: string; elapsedMs?: number }>).detail;
            if (detail?.editUri !== widget.akariPreviewEditUri?.toString()) return;
            this.previewDiagnostics?.note(`素材配置 ${detail.key ?? ''} ${detail.stage ?? ''} ${detail.elapsedMs ?? 0}ms`);
        };
        window.addEventListener('akari-library-placement-diagnostic', onPlacementDiagnostic);
        disposables.push({ dispose: () => window.removeEventListener('akari-library-placement-diagnostic', onPlacementDiagnostic) });
        const handleFilesChanged = (event: FileChangesEvent): void => {
            const tracked = widget.akariPreviewTrackedResources ?? new Set<string>();
            const trackedSuffixes = widget.akariPreviewTrackedSuffixes ?? new Set<string>();
            const motionBagResources = widget.akariPreviewMotionBagResources ?? new Set<string>();
            const motionBagSuffixes = widget.akariPreviewMotionBagSuffixes ?? new Set<string>();
            const captionsUri = widget.akariPreviewCaptionsUri;
            const captionsKey = captionsUri?.toString();
            const captionsSuffix = captionsUri ? this.resourceSuffix(captionsUri) : undefined;
            let captionsChanged = false;
            let generationChanged = false;
            let previewChanged = false;
            let nonModelResourceChanged = false;
            const editKey = widget.akariPreviewEditUri?.toString();
            const editSuffix = widget.akariPreviewEditUri
                ? this.resourceSuffix(widget.akariPreviewEditUri) : undefined;
            for (const change of event.changes) {
                const key = change.resource.toString();
                const referencesUri = widget.akariPreviewEditUri?.parent.resolve('.akari/asset-references.json');
                if (referencesUri && key === referencesUri.toString()) {
                    if (typeof placement === 'undefined' || !placement
                        || Date.now() > (placement.until ?? placement.at + 10_000)) {
                        this.queueRefresh(widget, identityUri, kind, undefined, false);
                        continue;
                    }
                    // The resolver can write the ledger after edit.json. Reload the model
                    // so a layer skipped while its reference was absent can now be added.
                    void (async () => {
                        const active = placement;
                        const [content, before] = await Promise.all([this.readText(referencesUri), active?.baseline]);
                        const own = active && before !== undefined ? { content: before, at: active.at,
                            key: active.key, until: active.until } : undefined;
                        if (isOwnAssetReferenceChange(own, content, Date.now(), 10_000)) {
                            if (content !== before && active?.refreshedContent !== content) {
                                active!.refreshedContent = content;
                                this.queueRefresh(widget, identityUri, kind, undefined, false);
                            }
                        } else {
                            this.queueRefresh(widget, identityUri, kind, undefined, false);
                        }
                    })().catch(() => this.queueRefresh(widget, identityUri, kind, undefined, false));
                    continue;
                }
                if (kind === 'output' && change.resource.path.base.endsWith('.meta.json')) {
                    generationChanged = true;
                    continue;
                }
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
                    const recent = widget as PreviewWidgetMarker & { akariPreviewJustAddedUris?: Map<string, number>;
                        akariPreviewJustAddedSuffixes?: Map<string, number> };
                    const added = recent.akariPreviewJustAddedUris?.get(key)
                        ?? recent.akariPreviewJustAddedSuffixes?.get(suffix);
                    // A generated frame can arrive just after edit.json. Its stream was
                    // already supplied by the incremental model update.
                    if (added && Date.now() - added < RECENT_WRITE_WINDOW_MS
                        && change.resource.path.toString().includes('/assets/generated/')
                        && change.resource.path.base.endsWith('.png')) continue;
                    const externalChange = Date.now() - writtenAt > RECENT_WRITE_WINDOW_MS;
                    previewChanged ||= externalChange;
                    if (externalChange && !isPreviewModelResourceChange(
                        key, suffix, editKey, editSuffix, motionBagResources, motionBagSuffixes
                    )) {
                        nonModelResourceChanged = true;
                    }
                    continue;
                }
                previewChanged ||= !widget.akariPreviewEditUri && change.resource.path.base === 'edit.json';
            }
            if (captionsChanged) {
                this.queueCaptionsUpdate(widget);
            }
            if (generationChanged) {
                this.queueGenerationUpdate(widget);
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
            const captionsUri = widget.akariPreviewCaptionsUri;
            if (captionsUri && (written.toString() === captionsUri.toString()
                || this.resourceSuffix(written) === this.resourceSuffix(captionsUri))) {
                this.markRecentWrite(written);
                this.markRecentWrite(captionsUri);
                this.queueCaptionsUpdate(widget);
                return;
            }
            // 一致した URI にだけ印を付け、後続 watcher の重複通知を抑える。
            if (written.toString() !== editUri.toString()
                && this.resourceSuffix(written) !== this.resourceSuffix(editUri)) {
                return;
            }
            this.markRecentWrite(written);
            this.markRecentWrite(editUri);
            this.queueRefresh(widget, identityUri, kind, undefined, false, detail.content);
        };
        disposables.push(listen(window, EDIT_STORE_DID_WRITE_EVENT, onEditStoreDidWrite));
        const onOptimisticItemUpdate = (event: Event): void => {
            if (kind !== 'output' || widget.isDisposed || !widget.akariPreviewEditUri) return;
            const detail = (event as CustomEvent<{ editUri?: string; removedIds?: string[];
                order?: string[]; rollback?: boolean }>).detail;
            if (detail?.editUri !== widget.akariPreviewEditUri.toString()) return;
            widget.sendMessage({ type: 'akari-preview-optimistic-item-update',
                removedIds: detail.removedIds ?? [], order: detail.order ?? [], rollback: detail.rollback === true });
        };
        disposables.push(listen(window, 'akari.preview.optimisticItemUpdate', onOptimisticItemUpdate));
        const clearOnboardingSelection = (): void => {
            if (kind === 'output' && !widget.isDisposed) {
                widget.sendMessage({ type: 'akari-preview-onboarding-clear-selection' });
            }
        };
        disposables.push(listen(window, 'akari.onboarding.clearPreviewSelection', clearOnboardingSelection));
        const assistOnboardingCaption = (): void => {
            if (kind === 'output' && !widget.isDisposed) widget.sendMessage({ type: 'akari-preview-onboarding-select-caption' });
        };
        disposables.push(listen(window, 'akari.onboarding.assistCaptionSelection', assistOnboardingCaption));
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
            this.previewGestureGuards?.delete(widget);
            if (previews.get(seekKey) === widget) {
                previews.delete(seekKey);
            }
            void this.disposePreviewStreams(widget);
        });
        const reviewEditUri = reviewEditUriForPreview(widget);
        const reviewState = reviewEditUri ? this.reviewSessionStateByEdit.get(reviewEditUri) : undefined;
        if (reviewState) {
            this.applyReviewSessionStateToPreview(widget, reviewState);
        }
    }

    protected forwardAudioMeterFrame(widget: PreviewWidgetMarker, frame: AudioMeterFrame): void {
        const editUri = widget.akariPreviewEditUri;
        const videoUri = (editUri ?? widget.akariPreviewVideoUri)?.normalizePath().toString();
        window.dispatchEvent(new CustomEvent('akari.preview.audioMeter', {
            detail: {
                videoUri, kind: editUri ? 'output' : 'raw',
                type: frame.type, peak: [...frame.peak], rms: [...frame.rms], clip: frame.clip,
                playing: frame.playing, channels: frame.channels, engine: frame.engine, t: frame.t
            }
        }));
    }

    protected forwardPlaybackTick(widget: PreviewWidgetMarker, message: PreviewPlaybackTickRequest): void {
        if (!shouldCapturePreviewPlaybackTick(message, widget.akariPreviewPlaybackPageId)) return;
        const editUri = widget.akariPreviewEditUri;
        const normalizedEditUri = editUri?.normalizePath().toString();
        const previous = normalizedEditUri ? this.reviewTransportByEdit.get(normalizedEditUri) : undefined;
        const captured = capturePreviewPlaybackTick(message, previous?.rate ?? 1);
        // editUri の有無に関わらず常時更新（HEVC フォールバックの再生位置復元用 — raw kind は
        // 下の reviewTransportByEdit に乗らないため、これが唯一の position 保持経路になる）。
        widget.akariPreviewLastKnownTime = captured.timelineT;
        widget.akariPreviewLastKnownPlaying = captured.playing;
        const trial = normalizedEditUri && this.swapTrialPlaybacks?.get(normalizedEditUri);
        if (trial && captured.playing && !trial.state.started && message.pageId === widget.akariPreviewPlaybackPageId
            && message.trialToken === trial.identity.token) {
            trial.event({ type: 'observed', playing: true });
            if (trial.state.started) logSwapTrial(trial.identity, 'playback_state', { playing: true, source: 'tick' });
        }
        if (!editUri) {
            if (this.activeRawPreviewWidget === widget) {
                this.forwardRawPreviewAnnotationState(widget, 'playback');
            }
            return;
        }
        this.reviewTransportByEdit.set(normalizedEditUri!, captured);
        this.reviewSessionRecorder?.handlePlaybackTick(
            normalizedEditUri!, captured.timelineT, captured.playing
        );
        window.dispatchEvent(new CustomEvent(PREVIEW_PLAYBACK_TICK_EVENT, {
            detail: {
                videoUri: normalizedEditUri,
                time: captured.timelineT,
                playing: captured.playing,
                ...(message.trialToken && message.pageId === widget.akariPreviewPlaybackPageId
                    ? { trialToken: message.trialToken } : {})
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

    protected forwardReviewStrokeStart(
        widget: PreviewWidgetMarker,
        message: PreviewReviewStrokeStartRequest
    ): void {
        const editUri = reviewEditUriForPreview(widget);
        if (editUri) {
            this.reviewSessionRecorder?.handleStrokeStart(editUri, message.frame);
        }
    }

    protected forwardReviewStrokeEnd(
        widget: PreviewWidgetMarker,
        message: PreviewReviewStrokeEndRequest
    ): void {
        const editUri = reviewEditUriForPreview(widget);
        if (editUri) {
            this.reviewSessionRecorder?.handleStrokeEnd(editUri, message.points);
        }
    }

    protected forwardReviewRectStart(
        widget: PreviewWidgetMarker,
        message: PreviewReviewRectStartRequest
    ): void {
        const editUri = reviewEditUriForPreview(widget);
        if (editUri) {
            this.reviewSessionRecorder?.handleRectStart(editUri, message.frame);
        }
    }

    protected forwardReviewRectEnd(
        widget: PreviewWidgetMarker,
        message: PreviewReviewRectEndRequest
    ): void {
        const editUri = reviewEditUriForPreview(widget);
        if (editUri) {
            this.reviewSessionRecorder?.handleRectEnd(editUri, message.box);
        }
    }

    protected forwardReviewToolModeRequest(
        widget: PreviewWidgetMarker,
        message: PreviewReviewToolModeRequest
    ): void {
        const editUri = reviewEditUriForPreview(widget);
        if (editUri) {
            this.reviewSessionRecorder?.setToolMode(editUri, message.mode);
        }
    }

    protected forwardOverlaySelection(widget: PreviewWidgetMarker, message: PreviewOverlaySelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        this.timelineGroupSelections?.delete(editUri.normalizePath().toString());
        window.dispatchEvent(new CustomEvent(PREVIEW_OVERLAY_SELECTED_EVENT, {
            detail: {
                videoUri: editUri.normalizePath().toString(),
                overlayId: message.overlayId,
                ...(message.overlayIds !== undefined ? { overlayIds: message.overlayIds } : {}),
                ...(message.scopeId !== undefined ? { scopeId: message.scopeId } : {})
            }
        }));
    }

    protected forwardLayerSelection(widget: PreviewWidgetMarker, message: PreviewLayerSelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        this.timelineGroupSelections?.delete(editUri.normalizePath().toString());
        window.dispatchEvent(new CustomEvent(PREVIEW_LAYER_SELECTED_EVENT, {
            detail: {
                editUri: editUri.normalizePath().toString(),
                layerId: message.layerId
            }
        }));
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

    protected forwardCaptionSelection(widget: PreviewWidgetMarker, message: PreviewCaptionSelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        const key = editUri.normalizePath().toString();
        this.timelineGroupSelections?.delete(key);
        const previous = this.timelineCaptionSelections.get(key)?.captionIds ?? [];
        const captionIds = message.captionId && previous.includes(message.captionId)
            ? previous : message.captionId ? [message.captionId] : [];
        this.timelineCaptionSelections.set(key, { captionIds, primaryCaptionId: message.captionId });
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
        const deferDuringGesture = (): boolean => {
            const result = reducePreviewGesture(
                this.previewGestureGuards.get(widget) ?? { active: false },
                { type: 'refresh', request: { seekTimeOverride, forceRebuild, editSource } }
            );
            this.previewGestureGuards.set(widget, result.state);
            return !result.refresh;
        };
        if (widget.isDisposed || deferDuringGesture()) return;
        if (!forceRebuild && seekTimeOverride === undefined && editSource !== undefined
            && widget.akariPreviewQueuedEditSource === editSource) return;
        widget.akariPreviewQueuedEditSource = editSource;
        const swapTrial = this.swapTrialPlaybacks?.get(identityUri.normalizePath().toString());
        if (swapTrial) {
            swapTrial.event({ type: 'queued', now: Date.now() });
            logSwapTrial(swapTrial.identity, 'refresh_queued');
        }
        const queuedWriteRevision = this.previewGestureGuards.get(widget)?.writeRevision;
        const previous = widget.akariPreviewRefresh ?? Promise.resolve();
        const refresh = (): Promise<void> => {
            // 順番待ち中に保存が完了した場合だけ古い通知本文を失効させる。
            if (this.previewGestureGuards.get(widget)?.writeRevision !== queuedWriteRevision) editSource = undefined;
            // Promise の順番待ち中に begin が届く場合も保留する。
            if (widget.isDisposed || deferDuringGesture()) return Promise.resolve();
            const editUri = kind === 'output' ? widget.akariPreviewEditUri : undefined;
            const transport = editUri
                ? this.reviewTransportByEdit.get(editUri.normalizePath().toString())
                : undefined;
            const restore = resolvePreviewRefreshRestore({
                seekTimeOverride,
                transport,
                lastKnownTime: widget.akariPreviewLastKnownTime,
                lastKnownPlaying: widget.akariPreviewLastKnownPlaying
            });
            const activeSwap = this.swapTrialPlaybacks?.get(identityUri.normalizePath().toString());
            if (activeSwap) logSwapTrial(activeSwap.identity, 'refresh_started');
            return this.refreshPreview(
                widget,
                identityUri,
                kind,
                restore.seekTime,
                forceRebuild,
                editSource,
                restore.playing
            );
        };
        widget.akariPreviewRefresh = previous.then(
            refresh,
            refresh
        ).catch(error => {
            widget.akariPreviewQueuedEditSource = undefined;
            console.error('[akari-preview] failed to refresh preview', error);
            this.handleRefreshFailure(widget, error);
        });
    }

    protected handleRefreshFailure(widget: PreviewWidgetMarker, error: unknown): void {
        if (widget.isDisposed) {
            return;
        }
        widget.sendMessage({
            type: 'akari-preview-refresh-error',
            message: summarizePreviewError(error)
        });
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
            // 字幕 RPC が先着しても、同時に読込中の edit の宣言・cut 時計を使う。
            // refresh はこのキューを待たないため、依存は字幕差分 → フルモデルの一方向。
            await widget.akariPreviewRefresh;
            if (widget.isDisposed) return;
            // 出力プレビューの identity は edit URI。raw は字幕レーンを持たない。
            // 先行 refresh の完了後に判定することで、連続した字幕通知でも
            // レーン追加の refresh は一度だけになり、以後は差分更新へ戻る。
            if (loaded.captions.length > 0
                && !widget.akariPreviewSummary?.captionTrackId
                && widget.akariPreviewEditUri) {
                this.queueRefresh(widget, widget.akariPreviewEditUri, 'output');
                return;
            }
            const captionRows = widget.akariPreviewCaptionAnimatorInternal
                ? projectPreviewCaptionRows(widget.akariPreviewCaptionAnimatorInternal, loaded.captions,
                    widget.akariPreviewExcludedCaptionIds)
                : loaded.captions;
            const captions = normalizePreviewCaptionClock(
                captionRows,
                this.previewCaptionTimelineSegments(
                    widget.akariPreviewSummary?.cuts ?? [],
                    widget.akariPreviewSummary?.output?.fps,
                    widget.akariPreviewCaptionAnimatorInternal
                )
            );
            const nextCaptions = buildCaptionAnimatorSummaryFields(captions, widget.akariPreviewCaptionAnimatorInternal);
            if (widget.akariPreviewModelSnapshot) widget.akariPreviewModelSnapshot.captions = nextCaptions;
            widget.sendMessage({ type: 'akari-preview-captions-update', captions: nextCaptions });
        }).catch(error => console.error('[akari-preview] failed to update captions', error));
    }

    protected previewModelSnapshot(model: PreviewModel, assets: OverlayRuntimeAssetUrls): PreviewModelDiffInput {
        const assetUrlByUri = model.assetUrlByUri ?? new Map<string, string>();
        const replacements = [...assetUrlByUri.entries()].map(([uri, url]) => [url, `akari-asset:${uri}`] as const);
        return {
            sourceUris: [...(model.sourcesById ?? new Map<string, { uri: URI; proxyUri?: URI }>())].map(([id, value]) =>
                `${id}=${value.uri.toString()}|proxy=${value.proxyUri?.toString() ?? ''}`),
            assetUris: model.assetUris.map(uri => uri.toString()),
            overlayUris: model.overlayUris.map(uri => uri.toString()),
            motionBagUris: (model.motionBagUris ?? []).map(uri => uri.toString()),
            output: { ...model.summary.output },
            // URL は内容ハッシュ付きなので、資産の中身が変わればここも変わる（旧: 本文そのもの）。
            overlayRuntimeAssets: [
                assets.threeJavaScriptUrl,
                assets.threeTextJavaScriptUrl,
                assets.threeRuntimeJavaScriptUrl,
                assets.videoFxJavaScriptUrl,
                assets.runtimeJavaScriptUrl,
                assets.interactionJavaScriptUrl,
                assets.interactionCss,
                assets.motionVocabCss,
                assets.webviewKernelJavaScriptUrl,
                assets.scrubAudioJavaScriptUrl ?? '',
                assets.captionFontUrl
            ],
            captions: model.captions,
            emphasisWords: model.emphasisWords ?? [],
            summary: this.replacePreviewAssetUrls(model.summary, replacements) as PreviewModelDiffInput['summary']
        };
    }

    protected sendPendingLayerDimensions(
        widget: PreviewWidgetMarker, model: PreviewModel, summary: EditSummary
    ): void {
        if (!model.pendingLayerDimensions) return;
        const pageId = widget.akariPreviewPlaybackPageId;
        void model.pendingLayerDimensions.then(dimensions => {
            if (dimensions.size === 0) return;
            const deliver = (): void => {
                if (widget.isDisposed || widget.akariPreviewPlaybackPageId !== pageId
                    || widget.akariPreviewSummary !== summary) return;
                const layers = summary.layers.map(layer => {
                    const size = dimensions.get(`layer:${layer.id}`);
                    return size ? { ...layer, sourceWidth: size.width, sourceHeight: size.height } : layer;
                });
                const cuts = summary.cuts.map(cut => {
                    const size = dimensions.get(`cut:${cut.id}`);
                    return size ? { ...cut, sourceWidth: size.width, sourceHeight: size.height } : cut;
                });
                if (layers.every((layer, index) => layer === summary.layers[index])
                    && cuts.every((cut, index) => cut === summary.cuts[index])) return;
                const updated = { ...summary, layers, cuts };
                const snapshot = widget.akariPreviewModelSnapshot;
                if (snapshot) {
                    const snapshotLayers = (snapshot.summary.layers ?? []) as EditSummaryLayer[];
                    widget.akariPreviewModelSnapshot = { ...snapshot, summary: { ...snapshot.summary,
                        layers: snapshotLayers.map(layer => {
                            const size = dimensions.get(`layer:${layer.id}`);
                            return size ? { ...layer, sourceWidth: size.width, sourceHeight: size.height } : layer;
                        }), cuts: ((snapshot.summary.cuts ?? []) as EditSummaryCut[]).map(cut => {
                            const size = dimensions.get(`cut:${cut.id}`);
                            return size ? { ...cut, sourceWidth: size.width, sourceHeight: size.height } : cut;
                        }) } };
                }
                widget.akariPreviewSummary = updated;
                widget.sendMessage({ type: 'akari-preview-model-update', summary: updated });
            };
            // The page posts this only after installing its model-update message listener.
            if (this.previewMessageReadyPages.get(widget) === pageId) {
                deliver();
            } else {
                const listener = widget.onMessage(message => {
                    if (message?.type !== 'akari-preview-primary-selection-ready') return;
                    listener.dispose();
                    if (message.pageId === pageId) deliver();
                });
                widget.disposed.connect(() => listener.dispose());
            }
        });
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

    // 資産は URL で受ける（OverlayRuntimeAssetUrls）。本文を RPC で運んで HTML に埋めていた頃は
    // 開くたびに約 15 MB の setHTML になっていた（task/2026-09-02-preview-perf）。
    protected refreshFontAssets(request?: { editUri?: string }): void {
        // フォントの取得後だけ静的アセットを読み直す。通常のプレビュー更新は従来のキャッシュを使う。
        this.overlayRuntimeAssetsPromise = undefined;
        this.frameEngineOverlayRuntimeAssetsPromise = undefined;
        if (!request?.editUri) return;
        const uri = new URI(request.editUri).normalizePath();
        const widget = this.openOutputPreviews.get(uri.toString());
        if (widget && !widget.isDisposed && widget.akariPreviewConfigured) {
            this.queueRefresh(widget, uri, 'output', widget.akariPreviewLastKnownTime, true);
        }
    }

    protected getOverlayRuntimeAssets(includeFrameEngine = false): Promise<OverlayRuntimeAssetUrls> {
        if (includeFrameEngine) {
            if (!this.frameEngineOverlayRuntimeAssetsPromise) {
                const cached = this.previewService.getOverlayRuntimeAssetUrls({ includeFrameEngine: true }).catch(error => {
                    if (this.frameEngineOverlayRuntimeAssetsPromise === cached) {
                        this.frameEngineOverlayRuntimeAssetsPromise = undefined;
                    }
                    throw error;
                });
                this.frameEngineOverlayRuntimeAssetsPromise = cached;
            }
            return this.frameEngineOverlayRuntimeAssetsPromise;
        }
        if (!this.overlayRuntimeAssetsPromise) {
            const cached = this.previewService.getOverlayRuntimeAssetUrls().catch(error => {
                if (this.overlayRuntimeAssetsPromise === cached) {
                    this.overlayRuntimeAssetsPromise = undefined;
                }
                throw error;
            });
            this.overlayRuntimeAssetsPromise = cached;
        }
        return this.overlayRuntimeAssetsPromise;
    }

    protected async resolveFrameEngineEnabled(): Promise<boolean> {
        this.frameEngineEnvOverridePromise ??= this.envVariables.getValue('AKARI_FRAME_ENGINE')
            .then(variable => variable?.value?.trim().toLowerCase());
        const override = await this.frameEngineEnvOverridePromise;
        if (override === '1' || override === 'true') return true;
        if (override === '0' || override === 'false') return false;
        return this.preferences.get<boolean>('akari.preview.frameEngine', true);
    }

    protected async resolveFrameEngineReadyTimeoutMs(): Promise<number | undefined> {
        this.frameEngineReadyTimeoutMsPromise ??= this.envVariables
            .getValue('AKARI_FRAME_ENGINE_READY_TIMEOUT_MS')
            .then(variable => {
                const value = Number(variable?.value?.trim());
                return Number.isFinite(value) && value > 0 ? value : undefined;
            });
        return this.frameEngineReadyTimeoutMsPromise;
    }

    protected playbackPageSequence = 0;

    protected async refreshPreview(
        widget: PreviewWidgetMarker,
        identityUri: URI,
        kind: 'raw' | 'output',
        initialSeekTime?: number,
        forceRebuild = false,
        editSource?: string,
        initialPlaying = false
    ): Promise<void> {
        if (widget.isDisposed) {
            return;
        }
        this.stopPreviewAudioPolling(widget);
        // raw は edit タイムラインを持たない素材単体プレビューなので、cuts 評価台の対象にしない。
        const frameEngineEnabled = kind === 'output'
            && widget.akariPreviewFrameEngineOptOut !== true
            && await this.resolveFrameEngineEnabled();
        const diagnostics = widget.akariPreviewDiagnostics;
        diagnostics?.describeFace({ frameEngine: frameEngineEnabled });
        const [model, assets] = await Promise.all([
            kind === 'output'
                ? this.loadPreviewModel(identityUri, editSource, { frameEngineEnabled })
                : this.loadRawPreviewModel(identityUri),
            this.getOverlayRuntimeAssets(frameEngineEnabled)
        ]).catch((error: unknown) => {
            diagnostics?.markStage('model-loaded', 'failed',
                error instanceof Error ? error.message : String(error));
            throw error;
        });
        diagnostics?.describeFace({ assetOrigin: assets?.origin });
        diagnostics?.markStage('model-loaded', 'ok');
        if (this.previewGestureGuards?.get(widget)?.active) {
            this.queueRefresh(widget, identityUri, kind, initialSeekTime, forceRebuild);
            await this.disposeAssetStreams(model.assetStreamIds);
            return;
        }
        const nextSnapshot = this.previewModelSnapshot(model, assets);
        if (widget.isDisposed) {
            await this.disposeAssetStreams(model.assetStreamIds);
            return;
        }
        // 表示 cue がまだ無く差分が none の場合も、次の字幕更新には最新の宣言を使う。
        widget.akariPreviewCaptionAnimatorInternal = model.captionAnimatorInternal;
        if (!forceRebuild && kind === 'output' && widget.akariPreviewModelSnapshot) {
            const previousSnapshot = widget.akariPreviewModelSnapshot;
            let updateKind = classifyPreviewModelUpdate(previousSnapshot, nextSnapshot);
            // Caption geometry can be delivered before the summary. Appended overlays
            // can be mounted inside the existing stage. Neither needs a new iframe.
            if (updateKind === 'rebuild') {
                const oldOverlays = (previousSnapshot.summary.overlays ?? []) as Array<{ id?: unknown }>;
                const newOverlays = (nextSnapshot.summary.overlays ?? []) as Array<{ id?: unknown }>;
                const overlaysAppended = newOverlays.length > oldOverlays.length
                    && oldOverlays.every((overlay, index) => overlay?.id === newOverlays[index]?.id);
                const captionsChanged = JSON.stringify(previousSnapshot.captions)
                    !== JSON.stringify(nextSnapshot.captions);
                if (captionsChanged || overlaysAppended) {
                    const comparable = {
                        ...previousSnapshot,
                        ...(captionsChanged ? { captions: nextSnapshot.captions } : {}),
                        ...(overlaysAppended ? { overlayUris: nextSnapshot.overlayUris,
                            assetUris: nextSnapshot.assetUris } : {}),
                        summary: overlaysAppended
                            ? { ...previousSnapshot.summary, tree: nextSnapshot.summary.tree }
                            : previousSnapshot.summary
                    };
                    if (classifyPreviewModelUpdate(comparable, nextSnapshot) !== 'rebuild') {
                        updateKind = 'incremental';
                    }
                }
            }
            const updateAction = previewModelUpdateAction(updateKind, frameEngineEnabled);
            if (updateAction === 'none') {
                Object.assign(widget, previewTrackedResourceSets(model, uri => this.resourceSuffix(uri)));
                if (frameEngineEnabled) {
                    const summary = this.summaryWithPreviousAssetUrls(widget, model);
                    widget.akariPreviewSummary = summary;
                    widget.akariPreviewModelSnapshot = nextSnapshot;
                    this.sendPendingLayerDimensions(widget, model, summary);
                    this.retainPreviewAudioStreams(widget, model, summary);
                    widget.sendMessage({ type: 'akari-preview-audio-update', audio: summary.audio });
                }
                this.startPreviewAudioTracking(widget, model, frameEngineEnabled);
                widget.sendMessage({
                    type: 'akari-preview-refresh-ok',
                    compositeError: model.compositeError ?? null
                });
                await this.disposeAssetStreams(model.assetStreamIds);
                return;
            }
            if (updateAction === 'legacy-incremental' || updateAction === 'frame-engine-incremental') {
                const previousSnapshot = widget.akariPreviewModelSnapshot;
                const previousSummary = widget.akariPreviewSummary;
                Object.assign(widget, previewTrackedResourceSets(model, uri => this.resourceSuffix(uri)));
                const previousLayerCount = widget.akariPreviewSummary?.layers.length ?? 0;
                const summary = this.summaryWithPreviousAssetUrls(widget, model);
                const previousAssetUrls = widget.akariPreviewAssetUrlByUri ?? new Map<string, string>();
                const acquiredAssets = [...(model.assetUrlByUri ?? new Map<string, string>())];
                const streamIdsByUri = widget.akariPreviewAssetStreamIdByUri ?? new Map<string, string>();
                const nextAssetUris = new Set(acquiredAssets.map(([uri]) => uri));
                const retiredStreamIds: string[] = [];
                for (const [uri, id] of streamIdsByUri) {
                    if (nextAssetUris.has(uri)) continue;
                    streamIdsByUri.delete(uri);
                    previousAssetUrls.delete(uri);
                    retiredStreamIds.push(id);
                }
                if (retiredStreamIds.length) {
                    const retired = new Set(retiredStreamIds);
                    widget.akariPreviewAssetStreamIds = (widget.akariPreviewAssetStreamIds ?? [])
                        .filter(id => !retired.has(id));
                    void this.disposeAssetStreams(retiredStreamIds);
                }
                const previousUris = new Set(widget.akariPreviewModelSnapshot.assetUris);
                const recent = widget as PreviewWidgetMarker & { akariPreviewJustAddedUris?: Map<string, number>;
                    akariPreviewJustAddedSuffixes?: Map<string, number> };
                const newlyAdded = recent.akariPreviewJustAddedUris ?? new Map<string, number>();
                const addedSuffixes = recent.akariPreviewJustAddedSuffixes ?? new Map<string, number>();
                const now = Date.now();
                for (const [key, at] of newlyAdded) if (now - at > RECENT_WRITE_WINDOW_MS) newlyAdded.delete(key);
                for (const [key, at] of addedSuffixes) if (now - at > RECENT_WRITE_WINDOW_MS) addedSuffixes.delete(key);
                for (const uri of model.assetUris) {
                    if (!previousUris.has(uri.toString())) {
                        newlyAdded.set(uri.toString(), now);
                        addedSuffixes.set(this.resourceSuffix(uri), now);
                    }
                }
                recent.akariPreviewJustAddedUris = newlyAdded;
                recent.akariPreviewJustAddedSuffixes = addedSuffixes;
                const addedAssetIds = new Set(acquiredAssets.flatMap(([uri], index) =>
                    !previousAssetUrls.has(uri) && model.assetStreamIds[index] ? [model.assetStreamIds[index]] : []));
                for (const [index, [uri]] of acquiredAssets.entries()) {
                    if (!streamIdsByUri.has(uri) && model.assetStreamIds[index]) {
                        streamIdsByUri.set(uri, model.assetStreamIds[index]);
                    }
                }
                widget.akariPreviewAssetStreamIdByUri = streamIdsByUri;
                for (const [uri, url] of acquiredAssets) {
                    if (!previousAssetUrls.has(uri)) previousAssetUrls.set(uri, url);
                }
                widget.akariPreviewAssetUrlByUri = previousAssetUrls;
                (widget.akariPreviewAssetStreamIds ??= []).push(...addedAssetIds);
                for (const uri of model.assetUris) {
                    (widget.akariPreviewTrackedResources ??= new Set()).add(uri.toString());
                    (widget.akariPreviewTrackedSuffixes ??= new Set()).add(this.resourceSuffix(uri));
                }
                widget.akariPreviewModelSnapshot = nextSnapshot;
                widget.akariPreviewSummary = summary;
                this.retainPreviewAudioStreams(widget, model, summary);
                model.assetStreamIds = model.assetStreamIds.filter(id => !addedAssetIds.has(id));
                this.startPreviewAudioTracking(widget, model, frameEngineEnabled);
                widget.akariPreviewExcludedCaptionIds = new Set(model.excludedCaptionIds ?? []);
                // A generated frame's PNG is a plain dark card. Its visual treatment comes
                // from generation sidecars; deliver that treatment before showing the new layer.
                const generatedAssetUrls = new Set([...(model.assetUrlByUri ?? new Map<string, string>())]
                    .filter(([uri]) => /\/assets\/generated\/[^/]+\.png$/iu.test(uri))
                    .map(([, url]) => url));
                if (summary.layers.slice(previousLayerCount).some(layer => generatedAssetUrls.has(layer.src))) {
                    await this.sendGenerationUpdate(widget);
                }
                // cut map の変更は source-domain 字幕の output 区間も変える。モデル差分と同じ
                // 読込で正規化した cue を先に送り、model-update 内の同期 tick が古い字幕を
                // 1 フレーム描く余地を残さない。
                if (this.previewGestureGuards?.get(widget)?.active) {
                    widget.akariPreviewModelSnapshot = previousSnapshot;
                    widget.akariPreviewSummary = previousSummary;
                    this.queueRefresh(widget, identityUri, kind, initialSeekTime, forceRebuild);
                    await this.disposeAssetStreams(model.assetStreamIds);
                    return;
                }
                widget.sendMessage({ type: 'akari-preview-captions-update', captions: model.captions });
                widget.sendMessage({ type: 'akari-preview-model-update', summary });
                this.sendPendingLayerDimensions(widget, model, summary);
                widget.sendMessage({
                    type: 'akari-preview-refresh-ok',
                    compositeError: model.compositeError ?? null
                });
                await this.disposeAssetStreams(model.assetStreamIds);
                return;
            }
        }
        // A composition can have overlays/layers/audio without a base video. Its identity
        // remains edit.json; only actual cut sources need a primary media stream.
        const compositionOnly = kind === 'output' && !model.sourceUri && !model.emptyProject;
        const videoUri = kind === 'output' ? model.sourceUri ?? (compositionOnly ? identityUri : undefined) : identityUri;
        if (!videoUri) {
            await this.disposeAssetStreams(model.assetStreamIds);
            if (model.emptyProject) {
                diagnostics?.note('空プロジェクトの案内カードを表示（初期化は行わない）');
                this.showMessageCard(widget, identityUri, EMPTY_PROJECT_MESSAGE, identityUri, kind);
                return;
            }
            diagnostics?.markStage('model-loaded', 'failed', 'source.path を解決できませんでした');
            throw new Error(`${identityUri.toString()} の source.path を解決できませんでした。`);
        }
        const extension = videoUri.path.ext.toLowerCase();
        const mimeType = PLAYABLE_VIDEO_MIME_TYPES.get(extension);
        // 静止画 cut ソース（docs/contract-2026-08-12-still-image-cut-source-v0.md のシェル対応）:
        // 代表ソースが画像でもプレビューできる。<video> ではなく webview の
        // #preview-still + 壁時計クロック（gap セグメントと同じ機構）で表示する。
        // 判定は layers[] と同じ拡張子のみ（isImageLayerSrc）。raw プレビューは対象外。
        const primaryIsStillImage = kind === 'output' && isImageLayerSrc(videoUri.path.base);
        if (!compositionOnly && !mimeType && !primaryIsStillImage) {
            await this.disposeAssetStreams(model.assetStreamIds);
            diagnostics?.note('プレビュー非対応の形式カードを表示: ' + videoUri.path.base);
            this.showMessageCard(widget, videoUri, UNSUPPORTED_FORMAT_MESSAGE, identityUri, kind);
            return;
        }
        // Output media may be ledger references outside the workspace. The stream RPC
        // validates each exact file; keep the local-only guard for raw views and edit.json.
        if ((kind === 'raw' || compositionOnly) && !(await this.isInsideWorkspace(videoUri))) {
            await this.disposeAssetStreams(model.assetStreamIds);
            diagnostics?.note('ワークスペース外の素材カードを表示: ' + videoUri.toString());
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
        const streamVideoUri = compositionOnly || primaryIsStillImage ? videoUri : await this.resolveStreamVideoUri(videoUri, model);
        // task/2026-08-10-preview-bug-sweep (B1): ffprobe ground truth for the audio-detected
        // notice, run alongside createVideoStream so it adds no extra latency to open. Never
        // allowed to fail the whole open — an unknown result just suppresses the notice below.
        // 静止画に音声ストリームが無いのは仕様（契約 §2.2）であって異常ではないため、
        // probe せず「未確定」を渡して無音検知の通知を出させない。
        const [videoStream, hasSourceAudio] = await Promise.all([
            (compositionOnly
                ? Promise.resolve(undefined)
                : primaryIsStillImage
                ? this.createAssetStream({ assetUri: streamVideoUri.toString() })
                : this.createVideoStream({ videoUri: streamVideoUri.toString() })
            ).catch(async (error: unknown) => {
                await this.disposeAssetStreams(model.assetStreamIds);
                throw error;
            }),
            compositionOnly || primaryIsStillImage
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
        const originalSourceUrlById: Record<string, string> = {};
        const imageSourceUrlById: Record<string, string> = {};
        if (kind === 'output' && model.sourcesById) {
            for (const [sourceId, entry] of model.sourcesById) {
                if (!model.summary.cuts.some(cut => cut.src === sourceId)) continue;
                if (videoStream && model.sourceUri && entry.uri.toString() === model.sourceUri.toString()) {
                    if (primaryIsStillImage) {
                        imageSourceUrlById[sourceId] = videoStream.url;
                    } else {
                        sourceUrlById[sourceId] = videoStream.url;
                        if (streamVideoUri.toString() !== videoUri.toString()) {
                            // スクラブ音はプロキシの形式や音声 track に依存せず、原本の音声 trak を読む。
                            const originalStream = await this.createVideoStream({ videoUri: videoUri.toString() });
                            extraVideoStreams.set(`original:${sourceId}`, originalStream);
                            originalSourceUrlById[sourceId] = originalStream.url;
                        }
                    }
                    continue;
                }
                const entryIsStillImage = isImageLayerSrc(entry.uri.path.base);
                if (!entryIsStillImage && !PLAYABLE_VIDEO_MIME_TYPES.has(entry.uri.path.ext.toLowerCase())) {
                    console.warn('[akari-preview] sources[] の素材を再生できません（形式）', entry.uri.toString());
                    continue;
                }
                try {
                    if (entryIsStillImage) {
                        // 同じ画像を複数の source id が指すことがあるため URI 単位で使い回す
                        const key = entry.uri.toString();
                        let stream = imageAssetStreams.get(key);
                        if (!stream) {
                            stream = await this.createAssetStream({ assetUri: key });
                            imageAssetStreams.set(key, stream);
                        }
                        imageSourceUrlById[sourceId] = stream.url;
                        continue;
                    }
                    const streamUri = await this.resolveStreamVideoUri(entry.uri, model);
                    const stream = await this.createVideoStream({ videoUri: streamUri.toString() });
                    extraVideoStreams.set(sourceId, stream);
                    sourceUrlById[sourceId] = stream.url;
                    if (streamUri.toString() !== entry.uri.toString()) {
                        // スクラブ音はプロキシの形式や音声 track に依存せず、原本の音声 trak を読む。
                        const originalStream = await this.createVideoStream({ videoUri: entry.uri.toString() });
                        extraVideoStreams.set(`original:${sourceId}`, originalStream);
                        originalSourceUrlById[sourceId] = originalStream.url;
                    }
                } catch (error) {
                    console.warn('[akari-preview] sources[] のストリームを開けませんでした', entry.uri.toString(), error);
                }
            }
        }
        // このリフレッシュで開いた全ストリームの後始末（widget が先に破棄された場合用）。
        // 代表ストリームは静止画なら asset ストリームなので disposer を選び分ける。
        const disposeAcquiredStreams = async () => {
            await Promise.all([
                !videoStream ? Promise.resolve() : primaryIsStillImage
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
        widget.akariPreviewStreamId = primaryIsStillImage ? undefined : videoStream?.id;
        widget.akariPreviewExtraStreamIds = [...extraVideoStreams.values()].map(stream => stream.id);
        widget.akariPreviewAssetStreamIds = [
            ...model.assetStreamIds,
            ...(primaryIsStillImage && videoStream ? [videoStream.id] : []),
            ...[...imageAssetStreams.values()].map(stream => stream.id)
        ];
        widget.akariPreviewAssetStreamIdByUri = new Map(
            [...(model.assetUrlByUri ?? new Map<string, string>()).keys()]
                .map((uri, index) => [uri, model.assetStreamIds[index]] as const)
                .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string'));
        widget.akariPreviewEditUri = model.editUri;
        widget.akariPreviewRelatedEditUri = model.relatedEditUri;
        widget.akariPreviewVideoUri = videoUri;
        widget.akariPreviewFallbackSourceUris = new Set([
            videoUri.toString(),
            ...[...(model.sourcesById?.values() ?? [])].map(source => source.uri.toString()),
            ...model.summary.layers.flatMap(layer => layer.sourceUri ? [layer.sourceUri] : [])
        ]);
        widget.akariPreviewCaptionsUri = model.captionsUri;
        widget.akariPreviewExcludedCaptionIds = new Set(model.excludedCaptionIds ?? []);
        widget.akariPreviewCaptionAnimatorInternal = model.captionAnimatorInternal;
        const trackedUris = [
            ...(model.editUri ? [model.editUri] : []),
            ...(model.relatedEditUri ? [model.relatedEditUri] : []),
            ...(model.captionsUri ? [model.captionsUri] : []),
            ...model.overlayUris,
            ...model.assetUris
        ];
        widget.akariPreviewTrackedResources = new Set(trackedUris.map(uri => uri.toString()));
        widget.akariPreviewTrackedSuffixes = new Set(trackedUris.map(uri => this.resourceSuffix(uri)));
        widget.akariPreviewMotionBagResources = new Set(
            (model.motionBagUris ?? []).map(uri => uri.toString())
        );
        widget.akariPreviewMotionBagSuffixes = new Set(
            (model.motionBagUris ?? []).map(uri => this.resourceSuffix(uri))
        );
        widget.viewType = 'akari.preview';
        widget.title.label = kind === 'output' ? '出力プレビュー' : '素材プレビュー';
        widget.node.setAttribute('data-akari-onboarding-target', kind === 'output' ? 'output' : 'material-preview');
        widget.title.caption = kind === 'output' ? identityUri.toString() : videoUri.toString();
        widget.title.iconClass = kind === 'output' ? 'codicon codicon-preview' : 'codicon codicon-camera-video';
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
            model.summary.tracks?.cuts?.forEach(track => {
                if (track.hidden === true) hiddenCuts.add(track.ref);
                if (track.muted === true) mutedCuts.add(track.ref);
            });
            model.summary.tracks?.layers?.forEach(track => {
                if (track.hidden === true) hiddenLayers.add(track.ref);
            });
            model.summary.tracks?.audio?.forEach(track => {
                if (track.muted === true) mutedAudio.add(track.ref);
            });
            widget.akariPreviewHiddenTracksByScope = { cuts: [...hiddenCuts], layers: [...hiddenLayers] };
            widget.akariPreviewMutedTracksByScope = { cuts: [...mutedCuts], audio: [...mutedAudio] };
            widget.akariPreviewAllTracksHiddenScopes = [];
            widget.akariPreviewAllTracksMutedScopes = [];
        }
        model.session = {
            muted: widget.akariPreviewMuted ?? false,
            captionsVisible: widget.akariPreviewCaptionsVisible ?? true,
            adjustBypassIds: [...(widget.akariPreviewAdjustBypassIds ?? [])],
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
        const reloadNotice = widget.akariPreviewModelSnapshot !== undefined;
        const onboardingReplayWrite = typeof document !== 'undefined'
            && document.body?.classList?.contains('akari-onboarding-chat-active')
            && !!document.querySelector('#akari-onboarding-v1[data-akari-onboarding-step="work"]');
        const frameEngineMetricsEnabled = frameEngineEnabled
            && this.preferences.get<boolean>('akari.developerMode', false);
        const [
            frameEngineSourceOverride,
            frameEngineRenderScaleOverride,
            frameEngineForceSoftwareOverride,
            frameEngineReadyTimeoutMs
        ] = await Promise.all([
            this.envVariables.getValue('AKARI_FRAME_ENGINE_SOURCE')
                .then(variable => variable?.value?.trim().toLowerCase()),
            this.envVariables.getValue('AKARI_FRAME_ENGINE_RENDER_SCALE')
                .then(variable => variable?.value?.trim().toLowerCase()),
            this.envVariables.getValue('AKARI_FRAME_ENGINE_FORCE_SW')
                .then(variable => variable?.value?.trim().toLowerCase()),
            frameEngineEnabled ? this.resolveFrameEngineReadyTimeoutMs() : Promise.resolve(undefined)
        ]);
        const frameEngineSourcePreference = this.preferences
            .get<string>('akari.preview.frameEngineSource', 'auto').trim().toLowerCase();
        const frameEngineSourceMode = frameEngineSourceOverride === 'proxy'
            || frameEngineSourceOverride === 'original'
            ? frameEngineSourceOverride
            : frameEngineSourcePreference === 'proxy' || frameEngineSourcePreference === 'original'
                ? frameEngineSourcePreference
                : 'auto';
        const frameEngineForceSoftware = frameEngineForceSoftwareOverride === '1'
            || frameEngineForceSoftwareOverride === 'true';
        const frameEngineRenderScaleMode = parseRenderScaleMode(frameEngineRenderScaleOverride
            ?? this.preferences.get<string>('akari.preview.renderScale', 'auto'));
        const scrubAudioEnabled = this.preferences.get<boolean>('akari.preview.scrubAudio', true);
        const exportLook = this.preferences.get<boolean>('akari.preview.exportLook', false) === true;
        // setHTML はページを作り直すので、ページ側の段（スクリプト読込以降）はやり直しになる。
        diagnostics?.restartPageStages();
        widget.akariPreviewPlaybackPageId = `${widget.id}:${++this.playbackPageSequence}`;
        if (kind === 'raw' && hasSourceAudio === true) {
            widget.akariPreviewRawAudio = { pageId: widget.akariPreviewPlaybackPageId };
        }
        this.noteSwapReload(widget, 'reload_start');
        if (widget.node?.dataset) delete widget.node.dataset.akariCaptionEditingFocus;
        this.previewGestureGuards?.delete(widget);
        widget.setHTML(this.prepareHtml(
            videoUri,
            videoStream?.url ?? '',
            model,
            assets,
            initialSeekTime,
            initialPlaying,
            sourceUrlById,
            hasSourceAudio,
            imageSourceUrlById,
            primaryIsStillImage,
            kind,
            reloadNotice && !onboardingReplayWrite,
            frameEngineEnabled,
            frameEngineMetricsEnabled,
            originalSourceUrlById,
            frameEngineSourceMode,
            frameEngineForceSoftware,
            frameEngineReadyTimeoutMs,
            widget.akariPreviewPlaybackRate ?? 1,
            frameEngineRenderScaleMode,
            scrubAudioEnabled,
            exportLook,
            {
                // Webview ID は診断セッション（onDidCreateWidget で登録済み）から借りる。
                webviewId: diagnostics?.subject.id,
                webviewRole: diagnostics?.subject.id
                    ? describePreviewWebviewRole(diagnostics.subject.id).label
                    : undefined,
                assetOrigin: assets.origin
            },
            widget.akariPreviewPlaybackPageId
        ));
        this.armPlaceholderPreviewTimeout?.(widget);
        // ここから先はページ側の段（スクリプト読込 → エンジン初期化 → メディア供給 → 初回描画）。
        // 初回描画の報告が来なければ監視が鳴り、widget 上の診断バンドとログに出る。
        diagnostics?.markStage('page-html-set', 'ok');
        widget.akariPreviewModelSnapshot = nextSnapshot;
        widget.akariPreviewAssetUrlByUri = new Map(model.assetUrlByUri ? [...model.assetUrlByUri] : []);
        widget.akariPreviewSummary = model.summary;
        this.sendPendingLayerDimensions(widget, model, model.summary);
        this.startPreviewAudioTracking(widget, model, frameEngineEnabled);
        if (kind === 'raw' && hasSourceAudio === true) {
            void this.startRawPreviewAudio(widget, videoUri, hasSourceAudio, widget.akariPreviewPlaybackPageId)
                .catch(error => console.warn('[akari-preview] raw audio sidecar unavailable; continuing with video', error));
        }
    }

    protected async handlePreviewAudioPriority(widget: PreviewWidgetMarker, time: unknown): Promise<void> {
        const projectRootUri = widget.akariPreviewAudioProjectRootUri;
        if (!projectRootUri || typeof time !== 'number' || !Number.isFinite(time)) return;
        try {
            const items = selectPreviewAudioItemsAt((widget.akariPreviewAudioPendingRequests ?? [])
                .map(item => ({ ...item, state: item.state ?? 'queued' })), time);
            // A single call processes keys before sources; separate calls retain mixed first-use order.
            for (const item of items.reverse()) {
                await this.previewService.promotePreviewAudioSidecars({
                    projectRootUri, keys: item.key ? [item.key] : [],
                    sourcePaths: item.key ? [] : [FileUri.fsPath(item.request.sourceUri)]
                });
            }
        } catch (error) {
            console.warn('[akari-preview] preview audio priority failed', error);
        }
    }

    protected previewAudioSidecarFields(
        item: PreviewAudioPendingRequest,
        result: PreviewAudioSidecarRequestResult
    ): PreviewAudioSidecarFields {
        item.key = result.key ?? item.key;
        item.state = result.state;
        if (result.state === 'not-eligible' || result.state === 'not-needed') return {};
        if (result.state === 'ready' && result.stream) {
            return {
                sidecarState: 'ready',
                sidecar: {
                    path: result.stream.url,
                    durationSec: result.durationSec ?? 0,
                    padBeforeSec: item.request.padBeforeSec ?? 0,
                    padAfterSec: item.request.padAfterSec ?? 0,
                    skipped: true,
                    bytes: result.bytes,
                    ...(result.format !== undefined ? { format: result.format } : {}),
                    ...(result.sampleRate !== undefined ? { sampleRate: result.sampleRate } : {}),
                    ...(result.channels !== undefined ? { channels: result.channels } : {}),
                    ...(result.frames !== undefined ? { frames: result.frames } : {}),
                    ...(result.bytesPerSample !== undefined ? { bytesPerSample: result.bytesPerSample } : {})
                }
            };
        }
        if (result.state === 'queued' || result.state === 'generating') return { sidecarState: result.state };
        if (result.state === 'no-audio') {
            console.warn(`[akari-preview] ${item.label}: no audio stream: ${result.reason ?? 'no-audio'}`);
            return { sidecarState: 'no-audio' };
        }
        console.warn(`[akari-preview] ${item.label} unavailable; using ${
            item.kind === 'speech' ? 'source fallback' : 'source'}: ${result.reason ?? 'generation failed'}`);
        return {
            sidecarState: 'unavailable',
            ...(item.kind === 'speech' ? { sidecarWarningEmitted: true } : {})
        };
    }

    // Incremental refresh discards duplicate asset streams. Newly ready sidecars must survive it.
    protected retainPreviewAudioStreams(widget: PreviewWidgetMarker, model: PreviewModel, summary: EditSummary): void {
        const audio = summary.audio;
        const urls = new Set([...(audio?.bgms ?? (audio?.bgm ? [audio.bgm] : [])), ...(audio?.sfx ?? []), ...(audio?.narration ?? []),
            ...(audio?.speech ?? []), ...(audio?.embeddedSpeech ?? [])]
            .flatMap(item => item?.sidecar?.path ? [item.sidecar.path] : []));
        const kept = new Set<string>();
        for (const [key, stream] of model.previewAudioStreams ?? []) {
            if (!urls.has(stream.url)) continue;
            kept.add(stream.id);
            (widget.akariPreviewAssetUrlByUri ??= new Map()).set(key, stream.url);
        }
        (widget.akariPreviewAssetStreamIds ??= []).push(...kept);
        model.assetStreamIds = model.assetStreamIds.filter(id => !kept.has(id));
    }

    protected stopPreviewAudioPolling(widget: PreviewWidgetMarker): void {
        clearTimeout(widget.akariPreviewAudioPollTimer);
        widget.akariPreviewAudioPollTimer = undefined;
        widget.akariPreviewAudioPollGeneration = undefined;
        widget.akariPreviewAudioPendingRequests = [];
    }

    protected startPreviewAudioTracking(widget: PreviewWidgetMarker, model: PreviewModel, frameEngineEnabled: boolean): void {
        this.stopPreviewAudioPolling(widget);
        if (widget.isDisposed) return;
        widget.akariPreviewAudioKeepKeys = model.previewAudioKeepKeys ?? new Set();
        widget.akariPreviewAudioKeepProbes = model.previewAudioKeepProbes ?? new Set();
        widget.akariPreviewAudioProjectRootUri = model.editUri?.parent.toString();
        const service = this.previewService as AkariPreviewService & PreviewAudioService;
        if (!widget.akariPreviewAudioDisposeConnected) {
            widget.akariPreviewAudioDisposeConnected = true;
            widget.disposed.connect(() => {
                this.stopPreviewAudioPolling(widget);
                clearTimeout(widget.akariPreviewAudioSweepTimer);
                widget.akariPreviewAudioSweepTimer = undefined;
            });
        }
        if (widget.akariPreviewAudioSweepTimer === undefined && model.editUri) {
            const sweep = async (): Promise<void> => {
                if (widget.isDisposed) return;
                try {
                    const projectRootUri = widget.akariPreviewAudioProjectRootUri;
                    if (projectRootUri) await service.sweepPreviewAudioSidecars({
                        projectRootUri,
                        keepKeys: [...(widget.akariPreviewAudioKeepKeys ?? [])],
                        keepProbes: [...(widget.akariPreviewAudioKeepProbes ?? [])],
                        minAgeMs: 60 * 60 * 1000
                    });
                } catch (error) {
                    console.warn('[akari-preview] preview audio cache sweep failed', error);
                } finally {
                    if (!widget.isDisposed) widget.akariPreviewAudioSweepTimer = setTimeout(() => void sweep(), 10 * 60 * 1000);
                }
            };
            widget.akariPreviewAudioSweepTimer = setTimeout(() => void sweep(), 60 * 1000);
        }
        if (!frameEngineEnabled) return;
        const requests = model.previewAudioPendingRequests ?? [];
        // loadPreviewModel は要求を first-use 昇順で積むので、この並べ替えは再確認。first-use を持たない
        // 合成の列（common/ の import を持たない vm ハーネスから呼ぶ既存テストの fixture 等）はそのままの順で回す。
        const pending = requests.length > 0 && requests.every((item): item is PreviewAudioPendingRequest & { at: number } => item.at !== undefined)
            ? sortSidecarRequestsByFirstUse(requests) : [...requests];
        widget.akariPreviewAudioPendingRequests = pending;
        if (pending.length === 0) return;
        const generation = {};
        widget.akariPreviewAudioPollGeneration = generation;
        const current = (): boolean => !widget.isDisposed && widget.akariPreviewAudioPollGeneration === generation;
        const poll = async (): Promise<void> => {
            if (!current()) return;
            await Promise.all([...pending].map(async item => {
                let result: PreviewAudioSidecarRequestResult;
                try {
                    item.request.workspaceRoots = await this.currentWorkspaceRoots();
                    result = await service.requestPreviewAudioSidecar(item.request);
                } catch (error) {
                    result = { state: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
                }
                if (!current()) {
                    if (result.stream) await this.disposeAssetStreams([result.stream.id]);
                    return;
                }
                if (result.key) widget.akariPreviewAudioKeepKeys!.add(result.key);
                item.key = result.key ?? item.key;
                item.state = result.state;
                if (result.probe?.fingerprint) widget.akariPreviewAudioKeepProbes!.add(result.probe.fingerprint);
                if (result.state === 'queued' || result.state === 'generating') return;
                pending.splice(pending.indexOf(item), 1);
                const summary = widget.akariPreviewSummary;
                const audio = summary?.audio;
                const target = item.kind === 'bgm' ? (audio?.bgms?.find(value => value.id === item.id) ?? (audio?.bgms ? undefined : audio?.bgm))
                    : audio?.[item.audioCollection ?? (item.kind === 'speech' ? 'embeddedSpeech' : item.kind)]
                        ?.find(value => value.id === item.id);
                if (!target || !summary) {
                    if (result.stream) await this.disposeAssetStreams([result.stream.id]);
                    return;
                }
                delete target.sidecar;
                delete target.sidecarState;
                Object.assign(target, this.previewAudioSidecarFields(item, result));
                if (result.state === 'ready' && result.stream) {
                    (widget.akariPreviewAssetStreamIds ??= []).push(result.stream.id);
                    const key = item.kind === 'speech' ? 'preview-audio:speech:' + item.id
                        : 'preview-audio:' + item.label.replace(/ sidecar$/u, '');
                    (widget.akariPreviewAssetUrlByUri ??= new Map()).set(key + ':' + result.key, result.stream.url);
                }
                widget.sendMessage({ type: 'akari-preview-audio-update', audio: summary.audio });
            }));
            if (!current()) return;
            if (pending.length > 0) widget.akariPreviewAudioPollTimer = setTimeout(() => void poll(), 1000);
            else this.stopPreviewAudioPolling(widget);
        };
        widget.akariPreviewAudioPollTimer = setTimeout(() => void poll(), 1000);
    }

    protected async startRawPreviewAudio(
        widget: PreviewWidgetMarker, videoUri: URI, hasSourceAudio: boolean | undefined, pageId: string
    ): Promise<void> {
        const state = widget.akariPreviewRawAudio;
        if (!state || state.pageId !== pageId || hasSourceAudio !== true) return;
        const workspaceRoots = await this.currentWorkspaceRoots();
        const candidates = rawPreviewProjectRootCandidates(videoUri.toString(), workspaceRoots);
        const rootsWithAkari = new Set<string>();
        await Promise.all(candidates.map(async candidate => {
            if (await this.fileService.exists(new URI(candidate).resolve('.akari'))) rootsWithAkari.add(candidate);
        }));
        const projectRootUri = selectRawPreviewProjectRoot(candidates, rootsWithAkari);
        const request = planRawPreviewAudioSidecar({
            kind: 'raw', hasSourceAudio, sourceUri: videoUri.toString(), projectRootUri
        });
        if (!request || widget.isDisposed || widget.akariPreviewRawAudio !== state) return;
        const service = this.previewService as AkariPreviewService & PreviewAudioService;
        const current = (): boolean => !widget.isDisposed && widget.akariPreviewRawAudio === state;
        const poll = async (): Promise<void> => {
            if (!current()) return;
            let result: PreviewAudioSidecarRequestResult;
            try {
                result = await service.requestPreviewAudioSidecar({ ...request, workspaceRoots });
            } catch (error) {
                console.warn('[akari-preview] raw audio sidecar unavailable; continuing with video', error);
                return;
            }
            if (!current()) {
                if (result.stream) await this.disposeAssetStreams([result.stream.id]);
                return;
            }
            if (result.state === 'queued' || result.state === 'generating') {
                state.timer = setTimeout(() => void poll(), 1000);
                return;
            }
            if (result.state === 'ready' && result.stream) {
                state.url = result.stream.url;
                (widget.akariPreviewAssetStreamIds ??= []).push(result.stream.id);
                widget.sendMessage({ type: 'akari-preview-raw-audio-ready', pageId, url: state.url });
            }
            // A missing ffmpeg, failed extraction or no-audio result leaves native video playback alone.
        };
        void poll();
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
        widget.akariPreviewSeekable = false;
        void this.disposePreviewStreams(widget);
        widget.akariPreviewEditUri = kind === 'output' ? identityUri : undefined;
        widget.akariPreviewRelatedEditUri = undefined;
        widget.akariPreviewVideoUri = videoUri;
        widget.akariPreviewFallbackSourceUris = new Set([videoUri.toString()]);
        widget.akariPreviewCaptionsUri = undefined;
        widget.akariPreviewCaptionAnimatorInternal = undefined;
        widget.akariPreviewTrackedResources = new Set(kind === 'output' ? [identityUri.toString()] : []);
        widget.akariPreviewTrackedSuffixes = new Set(kind === 'output' ? [this.resourceSuffix(identityUri)] : []);
        widget.viewType = 'akari.preview';
        widget.title.label = kind === 'output' ? '出力プレビュー' : '素材プレビュー';
        widget.node.setAttribute('data-akari-onboarding-target', kind === 'output' ? 'output' : 'material-preview');
        widget.title.caption = kind === 'output' ? identityUri.toString() : videoUri.toString();
        widget.title.iconClass = kind === 'output' ? 'codicon codicon-preview' : 'codicon codicon-camera-video';
        widget.setContentOptions({ allowScripts: false, allowForms: false });
        if (widget.node?.dataset) delete widget.node.dataset.akariCaptionEditingFocus;
        this.removePlaceholderPreview?.(widget);
        this.previewGestureGuards?.delete(widget);
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
    protected async loadPreviewModel(
        editUri: URI,
        editSource?: string,
        options: { frameEngineEnabled?: boolean } = {}
    ): Promise<PreviewModel> {
        const [workspaceRoot] = await this.workspaceService.roots;
        const captionsUri = locatePreviewCaptions(editUri, workspaceRoot?.resource);
        // 字幕の解決（resolveCaptionDisplay = backend RPC）は edit.json の内容にも依存するので
        // 通知に全文が載っていても省けない（captions.json は別ファイルで通知に含まれない）。
        // edit.json 読み出しとは先に並走させる。正規化時には captions 段の導出へ必要なので
        // await する（途中書き込みで読めない間は直前の字幕を保持する）。
        const captionsPromise = this.loadPreviewCaptions(captionsUri, editUri);
        const rawCaptionsPromise = captionsUri
            ? this.readText(captionsUri).catch(() => '') : Promise.resolve('');
        const assetStreams = new Map<string, { id: string; url: string }>();
        // 同じ資産へ同時に来た要求を 1 本の createAssetStream に合流させる（素材解決を並列化しても
        // ストリームが二重生成されない）。assetUris への登録は要求時に行う（task/2026-09-02-preview-perf）。
        const assetStreamTasks = new Map<string, Promise<{ id: string; url: string }>>();
        const previewAudioKeepKeys = new Set<string>();
        const previewAudioKeepProbes = new Set<string>();
        const previewAudioPendingRequests: PreviewAudioPendingRequest[] = [];
        const sidecarRequests: PreviewAudioSidecarEntry[] = [];
        const assetUris: URI[] = [];
        const ensureAssetStream = (key: string, assetUri?: URI): Promise<{ id: string; url: string }> => {
            const known = assetStreams.get(key);
            if (known) return Promise.resolve(known);
            let task = assetStreamTasks.get(key);
            if (!task) {
                if (assetUri && !assetUris.some(uri => uri.toString() === key)) assetUris.push(assetUri);
                task = this.createAssetStream({ assetUri: key }).then(stream => {
                    assetStreams.set(key, stream);
                    return stream;
                });
                task.catch(() => assetStreamTasks.delete(key));
                assetStreamTasks.set(key, task);
            }
            return task;
        };
        let sourceUri: URI | undefined;
        let legacyEmphasisWords: unknown;
        const sourcesById = new Map<string, { uri: URI; proxyUri?: URI; sourceWidth?: number; sourceHeight?: number }>();
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
            // 幾何統一マーカー（別票）は内部表現の InternalOutput にまだ席が無いため、生 JSON から読む。
            // 未宣言（undefined）は従来どおりの「出力キャンバスへ contain fit」を意味する。
            const rawOutputGeometry = (() => {
                const output = rawEdit && typeof rawEdit === 'object' && !Array.isArray(rawEdit)
                    ? (rawEdit as { output?: unknown }).output
                    : undefined;
                const declared = output && typeof output === 'object' && !Array.isArray(output)
                    ? (output as { geometry?: unknown }).geometry
                    : undefined;
                return typeof declared === 'string' && declared ? declared : undefined;
            })();
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
                const prepared = await this.previewService.prepareLegacyEdit({ editUri: editUri.toString(),
                    workspaceRoots: await this.currentWorkspaceRoots() });
                if ('blockers' in prepared) {
                    throw new TypeError(`このプロジェクトは変換できません: ${prepared.blockers.join(' / ')}`);
                }
                editText = prepared.nextText;
                if (!(rawEdit && typeof rawEdit === 'object' && !Array.isArray(rawEdit)
                    && Object.keys(rawEdit).length === 0)) {
                    this.messages.warn(
                        `edit.json version ${prepared.version} を読み取り専用でプレビュしています。`
                        + '元ファイルは変更されていません。タイムラインか `akari migrate` で変換できます。'
                    );
                }
            }
            // timeline.tracks 未宣言時の captions 段は captions.json の実在に依存する。
            // 先に字幕解決を確定し、埋め込み字幕と合わせて正規化読込へ渡す。
            const loadedCaptions = await captionsPromise;
            const rawCaptionsText = await rawCaptionsPromise;
            const anchorCaptions = (() => {
                try { return rawCaptionsText ? toAnchorCaptions(JSON.parse(rawCaptionsText)) : undefined; }
                catch { return undefined; }
            })();
            const internal = readPreviewInternalEdit(editText, loadedCaptions.captions.length > 0, anchorCaptions);
            const excludedCaptionIds = collectExcludedCaptionIds(internal);
            const captions = projectPreviewCaptionRows(internal, loadedCaptions.captions, excludedCaptionIds);
            const emphasisWords = this.normalizeEmphasisWords(resolvePreviewEmphasisWords(
                loadedCaptions.emphasisWords,
                legacyEmphasisWords
            ));
            const trackIdByItem = new Map(internal.tracks.flatMap(track =>
                track.items.map(item => [item, track.id] as const)));
            const trackIdByItemId = new Map<string, string>();
            const registerTrackIds = (item: typeof internal.tracks[number]['items'][number], trackId: string): void => {
                trackIdByItemId.set(item.id, trackId);
                for (const child of item.children) registerTrackIds(child, trackId);
            };
            for (const track of internal.tracks) for (const item of track.items) registerTrackIds(item, track.id);
            const trackIdOfItem = (item: typeof internal.tracks[number]['items'][number]): string =>
                String(trackIdByItem.get(item) ?? trackIdByItemId.get(item.id) ?? '');
            const declaredSources = internal.sources;
            // ソースも描画アイテムも字幕も無い場合だけ、新規プロジェクトの案内を出す。
            // HTML 中心の構成は sources: [] でも有効なので、通常の要約読込へ進める。
            if (internal.emptyProject && !internal.tracks.some(track => track.items.length > 0) && captions.length === 0) {
                return {
                    editUri,
                    summary: EMPTY_SUMMARY,
                    sourcesById,
                    overlayUris: [],
                    assetUris: [],
                    assetStreamIds: [],
                    captionsUri,
                    captions: buildCaptionAnimatorSummaryFields(normalizePreviewCaptionClock(captions, []), internal),
                    captionAnimatorInternal: internal,
                    excludedCaptionIds: [...excludedCaptionIds],
                    emphasisWords,
                    emptyProject: true
                };
            }
            // 宣言ソースの proxy 存在確認は互いに独立なので並列に問い合わせ、結果は宣言順で登録する
            //（task/2026-09-02-preview-perf: 素材解決の直列 await をほどく）。
            const resolvedSources = await Promise.all(declaredSources.map(async declared => {
                const declaredPath = declared.declaredPath;
                if (typeof declaredPath !== 'string' || !declaredPath.trim()) {
                    // 宣言位置（`sources[hero]` / `source`）は読み込み層が付ける。版名は出さない。
                    throw new TypeError(`edit.json の ${declared.declarationPath}.path が不正です。`);
                }
                if (!declared.id) {
                    throw new TypeError('edit.json の sources[].id が不正です。');
                }
                const uri = await this.resolveEditAssetUri(declaredPath, editUri);
                let proxyUri: URI | undefined;
                const declaredProxy = declared.declaredProxy;
                if (typeof declaredProxy === 'string' && declaredProxy.trim()) {
                    const candidate = await this.resolveEditAssetUri(declaredProxy, editUri);
                    proxyUri = await this.fileService.exists(candidate) ? candidate : undefined;
                }
                return { id: declared.id, uri, proxyUri };
            }));
            for (const { id, uri, proxyUri } of resolvedSources) {
                sourcesById.set(id, { uri, ...(proxyUri ? { proxyUri } : {}) });
            }
            // 代表ソース（字幕の探索・ファイル監視・タイトル・単一ソース時の従来経路）は
            // 先頭カットが参照するソース。カットが無ければ土台の動画は不要。
            const itemWarningState = {
                warnedKinds: new Set<string>(),
                warn: (message: string): void => console.warn(message)
            };
            const hydratedMotionBagUris: URI[] = [];
            await resolvePreviewItemKeyframes(internal, {
                readText: async path => {
                    const uri = await this.resolveEditAssetUri(path, editUri);
                    hydratedMotionBagUris.push(uri);
                    return this.readText(uri);
                },
                onWarning: (message, error) => console.warn(message, error)
            });
            const cutItems = collectItems(internal, 'cuts', itemWarningState);
            const firstCutSourceId = cutItems
                .map(item => item.declaration.src)
                .find((id: unknown) => typeof id === 'string' && sourcesById.has(id)) as string | undefined;
            const primaryId = firstCutSourceId ?? '';
            sourceUri = sourcesById.get(primaryId)?.uri;
            const pendingLayerDimensions = new Map<string, Promise<{ width: number; height: number } | undefined>>();
            const dimensionUrisByItem = new Map<string, string>();
            const probeDimensions = (uri: URI, fallback?: URI): { width: number; height: number } | undefined => {
                try {
                    const key = uri.toString();
                    const cached = this.layerDimensionCache.get(key);
                    if (cached) return cached;
                    if (!pendingLayerDimensions.has(key)) {
                        let probe = this.layerDimensionProbes.get(key);
                        if (!probe) {
                            probe = Promise.resolve().then(() => this.previewService.probeVideoDimensions({ videoUri: key }))
                                .then(size => {
                                    if (size) this.layerDimensionCache.set(key, size);
                                    return size;
                                }).catch(error => {
                                    this.previewDiagnostics?.note(`原本の寸法を取得できません: ${key} (${String(error)})`);
                                    return undefined;
                                }).finally(() => this.layerDimensionProbes.delete(key));
                            this.layerDimensionProbes.set(key, probe);
                        }
                        pendingLayerDimensions.set(key, probe.then(async size => {
                            if (size) return size;
                            this.previewDiagnostics?.note(`原本の寸法が未設定です: ${key}`);
                            if (!fallback || fallback.toString() === key) return undefined;
                            const fallbackKey = fallback.toString();
                            const fallbackSize = this.layerDimensionCache.get(fallbackKey)
                                ?? await Promise.resolve()
                                    .then(() => this.previewService.probeVideoDimensions({ videoUri: fallbackKey }))
                                    .catch(() => undefined);
                            if (fallbackSize) this.layerDimensionCache.set(fallbackKey, fallbackSize);
                            this.previewDiagnostics?.note(fallbackSize
                                ? `原本の寸法が取得できずプロキシ寸法を使用: ${key}`
                                : `原本とプロキシの寸法を取得できません: ${key}`);
                            return fallbackSize;
                        }));
                    }
                    return undefined;
                } catch (error) {
                    this.previewDiagnostics?.note(`寸法の取得を開始できません: ${String(error)}`);
                    return undefined;
                }
            };
            const itemDimensions = (uri: URI, itemKey: string, fallback?: URI) => {
                const size = probeDimensions(uri, fallback);
                if (!size) dimensionUrisByItem.set(itemKey, uri.toString());
                return size;
            };
            const isTruthyObject = (value: unknown): boolean => Boolean(value)
                && typeof value === 'object' && !Array.isArray(value);
            const width = this.positiveNumber(internal.output.width, EMPTY_SUMMARY.output.width);
            const height = this.positiveNumber(internal.output.height, EMPTY_SUMMARY.output.height);
            const videoFxFailures = new Set<string>();
            const adjustLutCubeTexts: Record<string, string> = {};
            const resolveItemAdjustLut = async (
                item: typeof internal.tracks[number]['items'][number]
            ): Promise<void> => {
                const adjust = (item.declaration as { adjust?: EditSummaryAdjust }).adjust;
                const lutRef = adjust?.sections?.lut === false ? undefined : adjust?.lut?.lut;
                if (typeof lutRef !== 'string' || !lutRef) return;
                try {
                    adjustLutCubeTexts[item.id] = await this.previewService.readVideoFxLut({
                        projectRootUri: editUri.parent.toString(),
                        lutRef
                    });
                } catch (error) {
                    videoFxFailures.add('LUT');
                    console.warn(`[akari-preview] item adjust LUT could not be resolved for ${item.id}`, error);
                }
            };
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
                            const backgroundUri = await this.resolveEditAssetUri(declaredBackground, editUri);
                            const stream = await ensureAssetStream(backgroundUri.toString(), backgroundUri);
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
            const sourceChromaKeys = await Promise.all(declaredSources.map(declared =>
                resolveChromaKey(normalizeChromaKeyForSummary(declared.chromaKey), 'source')));
            declaredSources.forEach((declared, index) => {
                const resolved = sourceChromaKeys[index];
                if (resolved) sourceVideoFx[declared.id] = resolved;
            });
            const cuts: EditSummaryCut[] = [];
            const cutResults = await Promise.all(cutItems.map(async (item): Promise<EditSummaryCut | undefined> => {
                const value = item.declaration as any;
                await resolveItemAdjustLut(item);
                const trackId = trackIdOfItem(item);
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
                if (!result.ok || !result.fields) {
                    return undefined;
                }
                const cutChromaKey = await resolveChromaKey(result.fields.chromaKey, 'source');
                const cutSource = sourcesById.get(result.fields.src);
                const dimensions = cutSource
                    ? itemDimensions(cutSource.uri, `cut:${item.id}`, cutSource.proxyUri) : undefined;
                if (cutSource && dimensions) {
                    cutSource.sourceWidth = dimensions.width;
                    cutSource.sourceHeight = dimensions.height;
                }
                return {
                    id: item.id,
                    ...(item.source.kind === 'media' && typeof item.source.path === 'string'
                        ? { sourcePath: item.source.path } : {}),
                    ...result.fields,
                    ...(dimensions ? { sourceWidth: dimensions.width, sourceHeight: dimensions.height } : {}),
                    ...(value.motionSource ? { motionSource: value.motionSource,
                        motionParents: value.motionParents } : {}),
                    ...(value.audio === false ? { audio: false } : {}),
                    ...(typeof value.mute === 'boolean' ? { mute: value.mute } : {}),
                    ...(typeof value.gain_db === 'number' && Number.isFinite(value.gain_db)
                        ? { gain_db: value.gain_db } : {}),
                    ...(typeof value.gainDb === 'number' && Number.isFinite(value.gainDb)
                        ? { gainDb: value.gainDb } : {}),
                    ...(typeof value.volume_db === 'number' && Number.isFinite(value.volume_db)
                        ? { volume_db: value.volume_db } : {}),
                    ...(isTruthyObject(value.adjust) ? { adjust: value.adjust as EditSummaryAdjust } : {}),
                    ...(cutChromaKey ? { chromaKey: cutChromaKey } : { chromaKey: undefined }),
                    trackId,
                    renderTrack: resolveInternalTrackZ(
                        internal.tracks,
                        trackId
                    )
                } as EditSummaryCut;
            }));
            for (const cut of cutResults) {
                if (cut) cuts.push(cut);
            }
            const previewAudioService = this.previewService as AkariPreviewService & PreviewAudioService;
            const embeddedSpeech = await Promise.all(projectSpeechDeclarations(cuts, {
                fps: this.positiveNumber(internal.output.fps, 30),
                layers: options.frameEngineEnabled === true
                    ? collectItems(internal, 'layers', itemWarningState).map(item => ({
                        ...item.declaration, id: item.id, t: item.at, duration: item.duration
                    })) : []
            }).map(async declaration => {
                const isLayer = 'scope' in declaration && declaration.scope === 'layers';
                const source = isLayer
                    ? { uri: await this.resolveEditAssetUri(declaration.src, editUri) }
                    : sourcesById.get(declaration.src);
                if (!source) return declaration;
                const request: PreviewAudioSidecarRequest = {
                    sourceUri: source.uri.toString(),
                    projectRootUri: editUri.parent.toString(),
                    inSec: declaration.inSec,
                    outSec: declaration.outSec,
                    speed: declaration.speed,
                    format: resolveSpeechSidecarFormat(declaration),
                    padBeforeSec: declaration.padBeforeSec ?? 0,
                    padAfterSec: declaration.padAfterSec ?? 0
                };
                const item: PreviewAudioPendingRequest = {
                    at: declaration.atSec,
                    durationSec: declaration.durationSec ?? (declaration.outSec - declaration.inSec) / declaration.speed,
                    kind: 'speech', id: declaration.id, label: 'speech sidecar ' + declaration.id, request
                };
                sidecarRequests.push({ at: declaration.atSec, kind: item.kind, item });
                return isLayer ? { ...declaration, url: (await ensureAssetStream(source.uri.toString(), source.uri)).url }
                    : declaration;
            }));
            const overlays: EditSummaryOverlay[] = [];
            const overlayUris: URI[] = [];
            const motionBagUris: URI[] = [];
            const unsupportedGltfWarnings: string[] = [];
            // 宣言レコードは読み込み層が版差を吸収済み。フィールドの検証は従来どおりここで行う。
            const overlayHtml = new Map<string, string>();
            const overlayTrackIds = new Map<string, string>();
            const seenOverlayUris = new Set<string>();
            const registerOverlayUri = (uri: URI): void => {
                const uriKey = uri.toString();
                if (seenOverlayUris.has(uriKey)) return;
                overlayUris.push(uri);
                seenOverlayUris.add(uriKey);
            };
            const registerMotionBagUri = (uri: URI): void => {
                registerOverlayUri(uri);
                if (!motionBagUris.some(value => value.toString() === uri.toString())) {
                    motionBagUris.push(uri);
                }
            };
            for (const uri of hydratedMotionBagUris) registerMotionBagUri(uri);
            // 断片ファイルの読み出しは項目ごとに独立。同じ参照は 1 回だけ読み、木全体を並列に辿る。
            const overlayHtmlTasks = new Map<string, Promise<void>>();
            const loadOverlayTree = async (item: typeof internal.tracks[number]['items'][number], trackId: string): Promise<void> => {
                overlayTrackIds.set(item.id, trackId);
                const pending: Promise<void>[] = [];
                if (item.source.kind === 'html') {
                    const rawHtml = item.source.html;
                    if (rawHtml && !rawHtml.trimStart().startsWith('<')) {
                        if (!overlayHtml.has(rawHtml) && !overlayHtmlTasks.has(rawHtml)) {
                            const fragmentUri = await this.resolveEditAssetUri(rawHtml, editUri);
                            registerOverlayUri(fragmentUri);
                            overlayHtmlTasks.set(rawHtml, this.readText(fragmentUri).then(
                                async text => {
                                    const result = await this.previewService.rewriteFragmentAssets({
                                        projectRootUri: editUri.parent.toString(), html: text,
                                        htmlPath: rawHtml, overlayId: item.id,
                                        workspaceRoots: await this.currentWorkspaceRoots()
                                    });
                                    overlayHtml.set(rawHtml, result.html);
                                    for (const stream of result.streams) {
                                        assetStreams.set(`fragment:${rawHtml}:${stream.uri}`, stream);
                                        const uri = new URI(stream.uri);
                                        if (!assetUris.some(value => value.toString() === uri.toString())) assetUris.push(uri);
                                    }
                                    unsupportedGltfWarnings.push(...result.warnings);
                                    for (const warning of result.warnings) console.warn(`[akari-preview] ${warning}`);
                                }
                            ).catch(error => {
                                overlayHtml.set(rawHtml, '');
                                console.warn(`[akari-preview] failed to read overlay fragment ${fragmentUri.toString()}`, error);
                            }));
                        }
                        const task = overlayHtmlTasks.get(rawHtml);
                        if (task) pending.push(task);
                    } else if (typeof rawHtml === 'string' && rawHtml.trimStart().startsWith('<')) {
                        overlayHtml.set(rawHtml, rawHtml);
                    }
                }
                for (const child of item.children) pending.push(loadOverlayTree(child, trackId));
                await Promise.all(pending);
            };
            await Promise.all(internal.tracks.flatMap(track => track.items.map(item => loadOverlayTree(item, track.id))));
            // BEGIN preview selection tree (overlays only, before flattening loses ancestry)
            type TreeItem = typeof internal.tracks[number]['items'][number];
            // Preserve the shared renderer's single mount for all-scanned bags.
            // Their selectable parts exist in the tree before any DOM clones do.
            const projectedOverlays = expandBagOverlays(internal,
                reference => overlayHtml.get(reference) ?? reference);
            const tree: PreviewSelectionNode[] = [];
            if (rawVersion === 2) {
                const rendered = new Map<string, { transform?: OverlayTransform }>(projectedOverlays.map(overlay => [overlay.id, overlay]));
                const compose = composePreviewTransforms;
                const visit = (item: TreeItem, parentId: string | null, parentTransform: OverlayTransform): PreviewSelectionNode[] => {
                    const world = compose(parentTransform, item.declaration?.transform as OverlayTransform | undefined);
                    const kind = item.source.kind;
                    if (kind === 'group') {
                        const children = item.children.flatMap(child => visit(child, item.id, world));
                        return [{ id: item.id, parentId, kind: 'group',
                            label: typeof item.declaration.name === 'string' && item.declaration.name.trim()
                                ? item.declaration.name : 'キャンバス', transform: world,
                            at: item.at, duration: item.duration,
                            localTransform: item.declaration.transform as OverlayTransform | undefined,
                            motion: item.declaration.motion, keyframes: item.declaration.keyframes as any[],
                            opacity: item.declaration.opacity as number | undefined,
                            ...(item.children.length === 0 ? { emptyCanvas: {
                                at: item.at, duration: item.duration,
                                ...(item.source.canvas?.intent ? { intent: item.source.canvas.intent } : {})
                            } } : {}) }, ...children];
                    }
                    if (kind !== 'html') return [];
                    const reference = String(item.source.html ?? '');
                    const parts = scanHtmlParts(overlayHtml.get(reference) ?? reference);
                    const lazy = !item.source.part && item.children.length === 0
                        && !item.source.exclude?.length && parts.length > 0;
                    if (lazy && rendered.has(item.id)) {
                        const transform = { ...rendered.get(item.id)?.transform };
                        return [{ id: item.id, parentId, kind: 'bag', lazy: true,
                            label: String(item.declaration.name ?? item.id), transform },
                        ...projectBagChildren(item, parts).map(child => ({
                            id: String(child.id), parentId: item.id, kind: 'leaf' as const, lazy: true,
                            label: String(child.source.part), transform
                        }))] as (PreviewSelectionNode & { lazy: boolean })[];
                    }
                    const bagParts = projectedOverlays.filter(overlay => overlay.parentId === item.id);
                    if (!item.source.part && bagParts.length) {
                        const projected = projectBagChildren(item, parts);
                        const children = projected.flatMap(child => visit(child as TreeItem, item.id, parentTransform));
                        return children.length ? [{ id: item.id, parentId, kind: 'bag',
                            label: String(item.declaration.name ?? item.id), transform: world }, ...children] : [];
                    }
                    const overlay = rendered.get(item.id);
                    if (!overlay) return [];
                    // The renderer is the geometry oracle: group composition and
                    // bag per-key overrides must remain identical in all outputs.
                    return [{ id: item.id, parentId, kind: 'leaf',
                        label: String(item.declaration?.name ?? item.id), transform: { ...overlay.transform } }];
                };
                for (const track of internal.tracks) {
                    tree.push(...track.items.flatMap(item => visit(item, null, {})));
                }
                if (!tree.some(node => node.kind !== 'leaf')) tree.length = 0;
            }
            // END preview selection tree
            const shapeRoles = previewShapeRoles(rawEdit);
            // 断片ごとの 3D 資産解決（モデル・環境マップ・フォントのストリーム化 + GLB ヘッダ検査）は
            // 互いに独立なので並列に走らせ、overlays には宣言順で積む。
            const resolvedOverlayHtml = await Promise.all(projectedOverlays.map(value => {
                if (value?.track !== undefined && (!Number.isInteger(value.track) || value.track < 0)) {
                    console.warn('[akari-preview] overlay track が不正なため track 0 として表示します', value?.id);
                }
                const rawHtml = typeof value?.html === 'string' ? value.html : '';
                const html = rawHtml && !rawHtml.trimStart().startsWith('<')
                    ? overlayHtml.get(rawHtml) ?? ''
                    : rawHtml;
                return this.resolveThreeSceneAssets(
                    html, editUri, assetStreams, assetUris, unsupportedGltfWarnings, ensureAssetStream, this.stringRecord(value?.vars)
                );
            }));
            projectedOverlays.forEach((value, index) => {
                const declaredBlend = String(value?.blend ?? 'normal');
                const blend = LAYER_BLEND_TO_CSS.get(declaredBlend) ?? 'normal';
                if (!LAYER_BLEND_TO_CSS.has(declaredBlend)) {
                    unsupportedBlendCount += 1;
                    console.warn(`[akari-preview] HTML overlay ${value?.id} blend ${declaredBlend} is unsupported; using normal composition`);
                }
                overlays.push({
                    id: String(value?.id ?? ''),
                    sourcePath: typeof value?.html === 'string' && !value.html.trimStart().startsWith('<') ? value.html : undefined,
                    html: resolvedOverlayHtml[index],
                    start: this.finiteNumber(value?.start, 0),
                    duration: this.finiteNumber(value?.duration, 0),
                    track: Number.isInteger(value?.track) && value.track >= 0 ? value.track : 0,
                    trackId: overlayTrackIds.get(String(value?.id ?? ''))
                        ?? overlayTrackIds.get(String(value?.parentId ?? ''))
                        ?? '',
                    transform: this.transform(value?.transform),
                    vars: this.stringRecord(value?.vars),
                    params: this.stringRecord(value?.params),
                    blend,
                    ...(shapeRoles.has(String(value?.id ?? '')) ? { role: shapeRoles.get(String(value?.id ?? '')) } : {}),
                    ...buildItemKeyframeSummaryFields(value as Record<string, unknown>),
                    ...(value.motion ? { motion: value.motion } : {}),
                    ...(value.motionSource ? { motionSource: value.motionSource,
                        motionParents: value.motionParents } : {}),
                    ...(value.keyframeUnit ? { keyframeUnit: value.keyframeUnit } : {}),
                    ...(typeof value?.part === 'string' ? { part: value.part } : {}),
                    ...(value?.role === 'background' ? { role: 'background' as const } : {}),
                    ...(typeof value?.parentId === 'string' ? { parentId: value.parentId } : {})
                });
            });
            const layers: EditSummaryLayer[] = [];
            const filters: EditSummaryFilter[] = [];
            let unsupportedBlendCount = 0;
            const layerItems = collectItems(internal, 'layers', itemWarningState);
            // DOM と frame-engine は同じ宣言寸法を使うため、両経路で原本を probe する。
            const layerDimensions = (uri: URI, layerId: string, fallback?: URI) =>
                itemDimensions(uri, `layer:${layerId}`, fallback);
            type LayerResolution =
                | { kind: 'filter'; filter: EditSummaryFilter }
                | { kind: 'layer'; layer: EditSummaryLayer; unsupportedBlend?: boolean }
                | { kind: 'skip'; unsupportedBlend?: boolean };
            const resolveLayerItem = async (item: typeof layerItems[number]): Promise<LayerResolution> => {
                await resolveItemAdjustLut(item);
                if (item.source.kind === 'filter') {
                    return {
                        kind: 'filter',
                        filter: {
                            id: item.id,
                            t: item.at,
                            duration: item.duration,
                            trackId: trackIdOfItem(item),
                            track: Number.isInteger(item.declaration.track) && Number(item.declaration.track) >= 0
                                ? Number(item.declaration.track) : 0,
                            filter: item.source.filter as EditSummaryFilter['filter'],
                            ...(isTruthyObject(item.declaration.adjust)
                                ? { adjust: item.declaration.adjust as EditSummaryAdjust } : {})
                        }
                    };
                }
                let value = item.declaration as any;
                const label = `layers[${item.legacy.index}]`;
                let deferredTelop = false;
                if (item.source.kind === 'telop' && item.source.baked === undefined) {
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
                    return { kind: 'skip' };
                }
                const unsupportedBlend = result.unsupportedBlend === true;
                const base: Omit<EditSummaryLayer, 'src' | 'proxyMissing' | 'isImage'> = {
                    ...result.base,
                    ...(value.motionSource ? { motionSource: value.motionSource,
                        motionParents: value.motionParents } : {}),
                    ...(isTruthyObject(value.adjust) ? { adjust: value.adjust as EditSummaryAdjust } : {}),
                    chromaKey: await resolveChromaKey(result.base.chromaKey, 'layer'),
                    trackId: trackIdOfItem(item),
                    renderTrack: resolveInternalTrackZ(internal.tracks, trackIdOfItem(item))
                };
                const maskSourceId = rawVersion === 2 ? base.mask : undefined;
                // Summary ids must never leak into the layer's URL seat, including early returns.
                delete base.mask;
                if (deferredTelop) {
                    return {
                        kind: 'layer',
                        unsupportedBlend,

                        layer: { ...base, proxyMissing: true, deferredTelop: true, retiredTelop: true, isImage: false }
                    };
                }
                let sourceUri: URI;
                try {
                    sourceUri = await this.resolveEditAssetUri(value.src, editUri);
                } catch (error) {
                    console.warn(`[akari-preview] ${label} を無視しました（src を解決できません）`, error);
                    return { kind: 'skip', unsupportedBlend };
                }
                const resolveLayerMask = async (): Promise<string | undefined> => {
                    if (!maskSourceId) return undefined;
                    const maskSource = sourcesById.get(maskSourceId);
                    try {
                        // The internal projection normally resolves mask ids to project-relative paths.
                        const maskUri = maskSource
                            ? await this.resolveEditAssetUri(maskSource.uri.toString(), editUri)
                            : await this.resolveEditAssetUri(maskSourceId, editUri);
                        return (await ensureAssetStream(maskUri.toString(), maskUri)).url;
                    } catch {
                        console.warn(`[akari-preview] ${label}.mask を無視しました（sources の id / パスとして解決・配信できません）`);
                        return undefined;
                    }
                };
                const resolveLayerRegions = async (): Promise<readonly Record<string, unknown>[] | undefined> => {
                    if (!isImageLayerSrc(value.src) || !Array.isArray(base.regions)) return undefined;
                    const resolved = await Promise.all(base.regions.map(async region => {
                        if (typeof region.maskRef !== 'string') return undefined;
                        try {
                            const source = sourcesById.get(region.maskRef);
                            const uri = await this.resolveEditAssetUri(source ? source.uri.toString() : region.maskRef, editUri);
                            const stream = await ensureAssetStream(uri.toString(), uri);
                            let filter = region.filter;
                            if (filter && typeof filter === 'object' && typeof (filter as { lut?: unknown }).lut === 'string') {
                                const lutRef = (filter as { lut: string }).lut;
                                const cubeText = await this.previewService.readVideoFxLut({
                                    projectRootUri: editUri.parent.toString(), lutRef
                                });
                                filter = { ...filter, cubeText };
                            }
                            return { ...region, maskRef: stream.url, filter };
                        } catch { return undefined; }
                    }));
                    return resolved.filter((region): region is Record<string, unknown> => Boolean(region));
                };
                if (value.kind === 'baked') {
                    // Pre-baked telops need the same MP4 color/mask path as other alpha video.
                    // Passing a WebM sidecar to the MP4 frame-engine demuxer cannot produce frames.
                    if (options.frameEngineEnabled === true) {
                        const intake = await this.previewService.prepareAlphaIntake({
                            videoUri: sourceUri.toString(),
                            projectRootUri: (workspaceRoot?.resource ?? editUri.parent).toString()
                        });
                        if (intake.status === 'alpha') {
                            const colorUri = new URI(intake.colorUri), maskUri = new URI(intake.maskUri);
                            const color = await ensureAssetStream(colorUri.toString(), colorUri);
                            const mask = await ensureAssetStream(maskUri.toString(), maskUri);
                            const dimensions = layerDimensions(sourceUri, item.id, colorUri);
                            return { kind: 'layer', unsupportedBlend, layer: { ...base,
                                src: color.url, mask: mask.url, sourceUri: sourceUri.toString(),
                                ...(dimensions ? { sourceWidth: dimensions.width, sourceHeight: dimensions.height } : {}),
                                proxyMissing: false, isImage: false } };
                        }
                    }
                    // 'baked' は常に previewProxyUri() の .preview.webm サイドカーを配信する（元の
                    // value.src の拡張子に関わらず）ため、isImage は常に false — このブランチの
                    // 挙動は本タスクで一切変えない（対象は 'video' kind の画像のみ、司令塔裁定1）。
                    const sidecarUri = previewProxyUri(sourceUri);
                    if (!assetUris.some(uri => uri.toString() === sidecarUri.toString())) {
                        assetUris.push(sidecarUri);
                    }
                    let src: string | undefined;
                    try {
                        if (await this.fileService.exists(sidecarUri)) {
                            src = (await ensureAssetStream(sidecarUri.toString())).url;
                        }
                    } catch (error) {
                        console.warn(`[akari-preview] ${label} の preview proxy を配信できません`, error);
                    }
                    // baked はキャッシュ。Chromium sidecar が無い場合は、初期モデルを待たせず
                    // 同じ preset/params の一時 rasterize をバックグラウンドへ回す。
                    const mask = await resolveLayerMask();
                    const dimensions = src
                        ? layerDimensions(sourceUri, item.id, sidecarUri) : undefined;
                    return {
                        kind: 'layer',
                        unsupportedBlend,
                        layer: { ...base, ...(src ? { src } : {}), ...(mask ? { mask } : {}),
                            ...(dimensions ? { sourceWidth: dimensions.width, sourceHeight: dimensions.height } : {}),
                            proxyMissing: !src, isImage: false }
                    };
                }

                try {
                    const isImage = isImageLayerSrc(value.src);
                    // task/2026-09-02-shell-frame-engine-alpha-intake: frame-engine 面では .webm / .mov の
                    // アルファ層を Web UI（preview-server の prepareAlphaLayers）と同じ media-bin alpha-intake
                    // へ通し、色 mp4 を src・マスク mp4 を mask として配信する。engine は MP4 しか読めず、
                    // 生の WebM / ProRes を渡すと本編ごと止まるため。不透明（opaque）は従来経路へ戻し、
                    // 取り込み不能（unavailable）はその層だけ engine に渡さない。legacy 面
                    // （frameEngineEnabled=false）は一切呼ばず、従来経路のまま。
                    const intake = options.frameEngineEnabled === true && !isImage && isAlphaIntakeSource(value.src)
                        ? await this.previewService.prepareAlphaIntake({
                            videoUri: sourceUri.toString(),
                            projectRootUri: (workspaceRoot?.resource ?? editUri.parent).toString()
                        })
                        : undefined;
                    if (intake?.status === 'unavailable') {
                        console.warn(
                            `[akari-preview] ${label} のアルファ取り込みに失敗したため frame-engine には渡しません`,
                            intake.reason
                        );
                        return {
                            kind: 'layer',
                            unsupportedBlend,
                            layer: { ...base, sourceUri: sourceUri.toString(), proxyMissing: true, isImage: false }
                        };
                    }
                    if (intake?.status === 'alpha') {
                        if (maskSourceId) {
                            console.warn(`[akari-preview] ${label}.mask を無視しました（alpha intake のマスクを優先します）`);
                        }
                        const colorUri = new URI(intake.colorUri);
                        const maskUri = new URI(intake.maskUri);
                        const color = await ensureAssetStream(colorUri.toString(), colorUri);
                        const mask = await ensureAssetStream(maskUri.toString(), maskUri);
                        const dimensions = layerDimensions(sourceUri, item.id, colorUri);
                        return {
                            kind: 'layer',
                            unsupportedBlend,
                            layer: {
                                ...base,
                                src: color.url,
                                mask: mask.url,
                                sourceUri: sourceUri.toString(),
                                ...(dimensions ? { sourceWidth: dimensions.width, sourceHeight: dimensions.height } : {}),
                                proxyMissing: false,
                                isImage: false
                            }
                        };
                    }
                    // v2 visual media items are projected into this same video-layer branch.
                    // Route them through the exact same declared-proxy/fallback selection as cuts;
                    // images remain byte-for-byte asset streams and never trigger video probing.
                    const streamUri = isImage
                        ? sourceUri
                        : await this.resolveStreamVideoUri(sourceUri, { sourcesById });
                    const dimensions = !isImage
                        ? layerDimensions(sourceUri, item.id, streamUri) : undefined;
                    const stream = await ensureAssetStream(streamUri.toString(), streamUri);
                    const mask = await resolveLayerMask();
                    const regions = await resolveLayerRegions();
                    return {
                        kind: 'layer',
                        unsupportedBlend,
                        layer: {
                            ...base,
                            src: stream.url,
                            ...(mask ? { mask } : {}),
                            ...(regions ? { regions } : {}),
                            ...(!isImage ? { sourceUri: sourceUri.toString() } : {}),
                            ...(dimensions ? { sourceWidth: dimensions.width, sourceHeight: dimensions.height } : {}),
                            proxyMissing: false,
                            isImage
                        }
                    };
                } catch (error) {
                    console.warn(`[akari-preview] ${label} を無視しました（video レイヤーを配信できません）`, error);
                    return { kind: 'skip', unsupportedBlend };
                }
            };
            // 解決は並列、反映は宣言順（filters / layers の並びを従来どおりに保つ）。
            const layerResolutions = await Promise.all(layerItems.map(item => resolveLayerItem(item)));
            layerItems.forEach((item, index) => {
                const resolution = layerResolutions[index];
                if (resolution.kind !== 'filter' && resolution.unsupportedBlend) {
                    unsupportedBlendCount += 1;
                }
                if (resolution.kind === 'filter') {
                    filters.push(resolution.filter);
                    return;
                }
                if (resolution.kind === 'skip') {
                    return;
                }
                layers.push(resolution.layer);
            });
            const normalizeTrackStates = (
                value: unknown,
                refs: number[]
            ): EditSummaryTrackState[] | undefined => {
                if (!Array.isArray(value)) {
                    return undefined;
                }
                return value.map((item, index) => {
                    const ref = refs[index] ?? index;
                    if (!item || typeof item !== 'object' || Array.isArray(item)) {
                        return { ref };
                    }
                    const state = item as { muted?: unknown; hidden?: unknown };
                    return {
                        ref,
                        ...(typeof state.muted === 'boolean' ? { muted: state.muted } : {}),
                        ...(typeof state.hidden === 'boolean' ? { hidden: state.hidden } : {})
                    };
                });
            };
            const internalTrackStates = (kind: 'cuts' | 'layers' | 'audio'): EditSummaryTrackState[] =>
                internal.tracks.filter(track => track.legacy.kind === kind).map(track => ({
                    ref: track.legacy.ref ?? 0,
                    ...(typeof track.muted === 'boolean' ? { muted: track.muted } : {}),
                    ...(typeof track.hidden === 'boolean' ? { hidden: track.hidden } : {})
                }));
            const declaredTrackStates = internal.declaration.trackStates;
            const rawTracks = declaredTrackStates && typeof declaredTrackStates === 'object'
                && !Array.isArray(declaredTrackStates)
                ? declaredTrackStates as { cuts?: unknown; layers?: unknown; audio?: unknown } : undefined;
            const internalCutTracks = internalTrackStates('cuts');
            const internalLayerTracks = internalTrackStates('layers');
            const internalAudioTracks = internalTrackStates('audio');
            const cutTracks = normalizeTrackStates(rawTracks?.cuts, internalCutTracks.map(track => track.ref))
                ?? (internalCutTracks.length > 0 ? internalCutTracks : undefined);
            const layerTracks = normalizeTrackStates(rawTracks?.layers, internalLayerTracks.map(track => track.ref))
                ?? (internalLayerTracks.length > 0 ? internalLayerTracks : undefined);
            const audioTracks = normalizeTrackStates(rawTracks?.audio, internalAudioTracks.map(track => track.ref))
                ?? (internalAudioTracks.length > 0 ? internalAudioTracks : undefined);
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
            const itemStackOrder = resolvePreviewItemStackOrder(internal.tracks);
            const captionItemTrackIds = Object.fromEntries(internal.tracks.flatMap(track => track.items
                .filter(item => item.source.kind === 'caption').map(item => [item.id, track.id])));
            const captionItemBarrierZ = internal.tracks.flatMap(track => track.items
                .filter(item => item.source.kind === 'caption')
                .map(item => itemStackOrder?.itemStackZ?.[item.id]
                    ?? itemStackOrder?.trackStackZ?.[track.id]
                    ?? timelineTracks.findIndex(candidate => candidate.id === track.id))
                .filter(z => z >= 0));
            const audio = await this.resolveAudioAssets(
                projectAudioFadeShapes(projectLegacyAudioView(internal), JSON.parse(editText)?.tracks),
                editUri, assetStreams, assetUris,
                previewAudioKeepProbes, previewAudioPendingRequests, sidecarRequests,
                previewAudioService, previewAudioKeepKeys, ensureAssetStream
            );
            for (const entry of sortSidecarRequestsByFirstUse(sidecarRequests)) {
                const item = entry.item;
                if (!item) continue;
                const target = item.kind === 'speech' ? embeddedSpeech.find(value => value.id === item.id)
                    : item.kind === 'bgm' ? (audio?.bgms?.find(value => value.id === item.id) ?? (audio?.bgms ? undefined : audio?.bgm))
                        : audio?.[item.audioCollection ?? item.kind]?.find(value => value.id === item.id);
                if (!target) continue;
                if (entry.resolve) {
                    const fields = await entry.resolve();
                    if (fields) Object.assign(target, fields);
                    else if (audio && item.kind === 'bgm') {
                        if (audio.bgms) {
                            audio.bgms = audio.bgms.filter(value => value !== target);
                            audio.bgm = audio.bgms[0];
                        } else {
                            delete audio.bgm;
                        }
                    }
                    else if (audio && (item.kind === 'sfx' || item.kind === 'narration')) {
                        const timedCollection = item.audioCollection ?? item.kind;
                        audio[timedCollection] = audio[timedCollection].filter(value => value !== target);
                    }
                    continue;
                }
                item.request.workspaceRoots = await this.currentWorkspaceRoots();
                const result = await previewAudioService.requestPreviewAudioSidecar(item.request);
                Object.assign(target, this.previewAudioSidecarFields(item, result));
                if (result.key) previewAudioKeepKeys.add(result.key);
                if (result.probe?.fingerprint) previewAudioKeepProbes.add(result.probe.fingerprint);
                if (result.state === 'queued' || result.state === 'generating') previewAudioPendingRequests.push(item);
                if (result.state === 'ready' && result.stream) {
                    assetStreams.set('preview-audio:speech:' + item.id + ':' + result.key, result.stream);
                }
            }
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
            const outputCaptions = buildCaptionAnimatorSummaryFields(normalizePreviewCaptionClock(
                captions,
                this.previewCaptionTimelineSegments(cuts, internal.output.fps, internal)
            ), internal);
            const pendingDimensions = pendingLayerDimensions.size > 0
                ? Promise.all([...pendingLayerDimensions].map(async ([uri, probe]) => [uri, await probe] as const))
                    .then(entries => {
                        const byUri = new Map(entries);
                        const resolved = new Map<string, { width: number; height: number }>();
                        for (const source of sourcesById.values()) {
                            const size = byUri.get(source.uri.toString());
                            if (size) {
                                source.sourceWidth = size.width;
                                source.sourceHeight = size.height;
                            }
                        }
                        for (const [itemKey, uri] of dimensionUrisByItem) {
                            const size = uri ? byUri.get(uri) : undefined;
                            if (size) resolved.set(itemKey, size);
                        }
                        return resolved;
                    })
                : undefined;
            return {
                ...(pendingDimensions ? { pendingLayerDimensions: pendingDimensions } : {}),
                editUri,
                sourceUri,
                sourcesById,
                overlayUris,
                motionBagUris,
                assetUris,
                assetStreamIds: [...assetStreams.values()].map(stream => stream.id),
                assetUrlByUri: new Map([...assetStreams].map(([uri, stream]) => [uri, stream.url])),
                previewAudioKeepKeys,
                previewAudioKeepProbes,
                previewAudioPendingRequests,
                previewAudioStreams: new Map([...assetStreams].filter(([key]) => key.startsWith('preview-audio:'))),
                captionAnimatorInternal: internal,
                captionsUri,
                captions: outputCaptions,
                excludedCaptionIds: [...excludedCaptionIds],
                emphasisWords,
                summary: {
                    output: {
                        width,
                        height,
                        fps: this.positiveNumber(internal.output.fps, 30),
                        ...(rawOutputGeometry ? { geometry: rawOutputGeometry } : {})
                    },
                    ...(rawVersion === 2 ? { editVersion: 2 } : {}),
                    overlays,
                    tree,
                    ...(rawVersion === 2 ? { canvasDropTargets: canvasDropTargets(
                        (rawEdit as { tracks?: Record<string, unknown>[] }).tracks ?? []) } : {}),
                    layers,
                    filters,
                    cuts,
                    ...(Object.keys(adjustLutCubeTexts).length > 0 ? { adjustLutCubeTexts } : {}),
                    indicators,
                    ...((audio || embeddedSpeech.length > 0) ? {
                        audio: { ...(audio ?? { sfx: [], narration: [], speech: [] }), embeddedSpeech }
                    } : {}),
                    ...(tracks ? { tracks } : {}),
                    timelineTracks,
                    ...(itemStackOrder ?? {}),
                    ...(captionItemBarrierZ.length ? { barrierZ: captionItemBarrierZ } : {}),
                    ...(captionItemBarrierZ.length ? { captionItemTrackIds } : {}),
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
                compositeError: summarizePreviewError(error),
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
        assetUris: URI[],
        previewAudioKeepProbes: Set<string>,
        previewAudioPendingRequests: PreviewAudioPendingRequest[],
        sidecarRequests: PreviewAudioSidecarEntry[],
        previewAudioService: PreviewAudioService,
        previewAudioKeepKeys: Set<string>,
        ensureAssetStream?: (key: string, assetUri?: URI) => Promise<{ id: string; url: string }>
    ): Promise<EditSummaryAudio | undefined> {
        // 同じ音声ファイルを複数の挿入（SFX 40 件で 3 ファイル等）が並列に要求しても、
        // ストリームは 1 本だけ作る。呼び出し側が合流器を渡さない場合は従来どおり逐次。
        const ensure = ensureAssetStream ?? (async (key: string, assetUri?: URI): Promise<{ id: string; url: string }> => {
            let stream = assetStreams.get(key);
            if (!stream) {
                stream = await this.createAssetStream({ assetUri: key });
                assetStreams.set(key, stream);
                if (assetUri) assetUris.push(assetUri);
            }
            return stream;
        });
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            if (value !== undefined) {
                console.warn('[akari-preview] audio セクションを無視しました（object ではありません）');
            }
            return undefined;
        }
        const audio = value as { bgm?: unknown; bgms?: unknown; sfx?: unknown; narration?: unknown; speech?: unknown };
        const resolveSource = async (
            pathValue: unknown,
            label: string,
            trim: { inSec: number; outSec?: number },
            kind: PreviewAudioPendingRequest['kind'],
            id: string,
            at = 0,
            clipFx: AudioClipFx = {},
            audioCollection?: 'speech'
        ): Promise<({ src: string } & PreviewAudioSidecarFields) | undefined> => {
            if (typeof pathValue !== 'string' || !pathValue.trim()) {
                console.warn(`[akari-preview] ${label} を無視しました（path 不正）`);
                return undefined;
            }
            // Reserve declaration order before either path RPC or stream resolution completes.
            const entry: PreviewAudioSidecarEntry = { at, kind };
            sidecarRequests.push(entry);
            try {
                const assetUri = await this.resolveEditAssetUri(pathValue, editUri);
                const key = assetUri.toString();
                const stream = await ensure(key, assetUri);
                // Independent speech still references the video container. Like embedded
                // speech, it needs extracted audio even for a short trim without clip FX.
                const plan: ReturnType<typeof resolveRegularSidecarPlan> = audioCollection === 'speech'
                    ? {
                        request: true,
                        format: trim.outSec === undefined ? 'pcm-s16le' : resolveSpeechSidecarFormat({
                            inSec: trim.inSec, outSec: trim.outSec
                        })
                    }
                    : resolveRegularSidecarPlan({ ...trim, hasClipFx: hasAudioClipFx(clipFx) });
                const sidecarRequest = previewAudioSidecarRequestFor(clipFx);
                if (!plan.request) return { src: stream.url };
                const request: PreviewAudioSidecarRequest = {
                    sourceUri: assetUri.toString(),
                    projectRootUri: editUri.parent.toString(),
                    inSec: trim.inSec,
                    ...(trim.outSec !== undefined ? { outSec: trim.outSec } : {}),
                    ...sidecarRequest,
                    padBeforeSec: 0,
                    padAfterSec: 0,
                    format: plan.format,
                    ...(plan.decodedBytesThreshold !== undefined ? { decodedBytesThreshold: plan.decodedBytesThreshold } : {})
                };
                const item: PreviewAudioPendingRequest = { kind, id, label: label + ' sidecar', request };
                if (audioCollection) item.audioCollection = audioCollection;
                item.at = at;
                item.durationSec = kind === 'bgm' || trim.outSec === undefined ? undefined : trim.outSec - trim.inSec;
                entry.item = item;
                // The shared first-use loop invokes this only after both kinds are collected.
                entry.resolve = async () => {
                    try {
                        item.request.workspaceRoots = await this.currentWorkspaceRoots();
                        const result = await previewAudioService.requestPreviewAudioSidecar(item.request);
                        if (result.key) previewAudioKeepKeys.add(result.key);
                        if (result.probe?.fingerprint) previewAudioKeepProbes.add(result.probe.fingerprint);
                        if (result.state === 'queued' || result.state === 'generating') previewAudioPendingRequests.push(item);
                        if (result.state === 'ready' && result.stream) {
                            assetStreams.set('preview-audio:' + label + ':' + result.key, result.stream);
                        }
                        return this.previewAudioSidecarFields(item, result);
                    } catch (error) {
                        console.warn(`[akari-preview] ${label} を無視しました（音声ファイルを配信できません）`, error);
                        return undefined;
                    }
                };
                return { src: stream.url };
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
        const keyframes = (
            value: unknown,
            label: string
        ): Array<{ t: number; gainDb: number; easing?: string }> | undefined => {
            if (value === undefined) return undefined;
            if (!Array.isArray(value)) {
                console.warn(`[akari-preview] ${label}.keyframes を無視しました（array ではありません）`);
                return undefined;
            }
            return value.flatMap((point, index) => {
                if (!point || typeof point !== 'object' || Array.isArray(point)) {
                    console.warn(`[akari-preview] ${label}.keyframes[${index}] を無視しました（object ではありません）`);
                    return [];
                }
                const raw = point as { t?: unknown; gain_db?: unknown; easing?: unknown };
                if (typeof raw.t !== 'number' || !Number.isFinite(raw.t) || raw.t < 0) {
                    console.warn(`[akari-preview] ${label}.keyframes[${index}] を無視しました（t 不正）`);
                    return [];
                }
                const normalizedGain = raw.gain_db === undefined ? 0 : gainDb(raw.gain_db, `${label}.keyframes[${index}]`);
                if (normalizedGain === undefined) return [];
                return [{
                    t: raw.t,
                    gainDb: normalizedGain,
                    ...(typeof raw.easing === 'string' ? { easing: raw.easing } : {})
                }];
            }).sort((left, right) => left.t - right.t);
        };
        const duckOptions = (
            value: {
                ducking?: unknown;
                duck_db?: unknown;
                duckDb?: unknown;
                duck_attack?: unknown;
                duckAttack?: unknown;
                duck_release?: unknown;
                duckRelease?: unknown;
            },
            label: string
        ): Pick<EditSummaryTimedAudio, 'ducking' | 'duckDb' | 'duckAttack' | 'duckRelease'> => {
            const ranged = (raw: unknown, minimum: number, maximum: number, field: string): number | undefined => {
                if (raw === undefined) return undefined;
                if (typeof raw === 'number' && Number.isFinite(raw) && raw >= minimum && raw <= maximum) return raw;
                console.warn(`[akari-preview] ${label}.${field} を無視しました（${minimum}..${maximum} の有限 number ではありません）`, raw);
                return undefined;
            };
            const duckDb = ranged(value.duck_db ?? value.duckDb, -40, 0, 'duck_db');
            const duckAttack = ranged(value.duck_attack ?? value.duckAttack, 0, 2, 'duck_attack');
            const duckRelease = ranged(value.duck_release ?? value.duckRelease, 0, 5, 'duck_release');
            return {
                ...(typeof value.ducking === 'boolean' ? { ducking: value.ducking } : {}),
                ...(duckDb !== undefined ? { duckDb } : {}),
                ...(duckAttack !== undefined ? { duckAttack } : {}),
                ...(duckRelease !== undefined ? { duckRelease } : {})
            };
        };
        const timed = async (items: unknown, kind: 'sfx' | 'narration' | 'speech'): Promise<EditSummaryTimedAudio[]> => {
            if (items === undefined) {
                return [];
            }
            if (!Array.isArray(items)) {
                console.warn(`[akari-preview] audio.${kind} を無視しました（array ではありません）`);
                return [];
            }
            // 挿入ごとの解決（ストリーム化 + サイドカー準備 RPC）は独立なので並列に走らせ、
            // 結果は宣言順に積む（task/2026-09-02-preview-perf: SFX 40 件で 40 回の直列 await だった）。
            const resolvedItems = await Promise.all(items.map(async (rawItem, index): Promise<EditSummaryTimedAudio | undefined> => {
                const item = rawItem as {
                    mute?: unknown;
                    id?: unknown;
                    path?: unknown;
                    t?: unknown;
                    gain_db?: unknown;
                    track?: unknown;
                    in?: unknown;
                    out?: unknown;
                    fade_in?: unknown;
                    fade_out?: unknown;
                    fade_in_shape?: unknown;
                    fade_out_shape?: unknown;
                    keyframes?: unknown;
                    ducking?: unknown;
                    duck_db?: unknown;
                    duckDb?: unknown;
                    duck_attack?: unknown;
                    duckAttack?: unknown;
                    duck_release?: unknown;
                    duckRelease?: unknown;
                } | undefined;
                const label = kind !== 'sfx' && typeof item?.id === 'string' && item.id
                    ? `audio.${kind} ${item.id}`
                    : `audio.${kind}[${index}]`;
                if (!item || typeof item !== 'object') {
                    console.warn(`[akari-preview] ${label} を無視しました（object ではありません）`);
                    return undefined;
                }
                if (!isAudioItemAudible(undefined, item)) return undefined;
                if (kind !== 'sfx' && (typeof item.id !== 'string' || !item.id)) {
                    console.warn(`[akari-preview] ${label} を無視しました（id 不正）`);
                    return undefined;
                }
                if (typeof item.t !== 'number' || !Number.isFinite(item.t) || item.t < 0) {
                    console.warn(`[akari-preview] ${label} を無視しました（t が非有限・負値・number ではありません）`);
                    return undefined;
                }
                const normalizedGain = gainDb(item.gain_db, label);
                if (normalizedGain === undefined) {
                    return undefined;
                }
                // SFX, narration and independent speech share a playback window
                // (material's [in, out)). Malformed values are warned-and-ignored (treated as
                // omitted) rather than dropping the whole item, matching gain_db/fadeIn/fadeOut's
                // existing tolerance pattern in this function. Real-duration clamping (実尺越え) can
                // only happen once the buffer is decoded, so it happens later in decodeOne.
                const { inSec: trimIn, outSec: trimOut } = previewAudioTrimOf(item, label, console.warn);
                const source = await resolveSource(item.path, label, {
                    inSec: trimIn ?? 0,
                    ...(trimOut !== undefined ? { outSec: trimOut } : {})
                }, kind === 'speech' ? 'narration' : kind,
                kind !== 'sfx' ? String(item.id) : `sfx-${index + 1}`, item.t,
                audioClipFxOf(item, kind), kind === 'speech' ? 'speech' : undefined);
                if (!source) return undefined;
                const normalizedKeyframes = keyframes(item.keyframes, label);
                // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum
                // fade_in/fade_out use the same clip-window rule for timed audio. Same
                // warned-and-ignored tolerance as bgm's fadeIn/fadeOut parsing above (this
                // function's own `fades` block further down).
                let fadeIn: number | undefined;
                let fadeOut: number | undefined;
                if (kind === 'sfx' || kind === 'narration' || kind === 'speech') {
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
                return {
                    id: kind !== 'sfx' ? String(item.id) : `sfx-${index + 1}`,
                    ...(kind === 'speech' ? { role: 'speech' as const, duckKey: true } : {}),
                    src: source.src,
                    ...(source.sidecar ? { sidecar: source.sidecar } : {}),
                    ...(source.sidecarState ? { sidecarState: source.sidecarState } : {}),
                    t: item.t,
                    gainDb: normalizedGain,
                    ...(normalizedKeyframes !== undefined ? { keyframes: normalizedKeyframes } : {}),
                    track: Number.isInteger(item.track) && (item.track as number) >= 0 ? item.track as number : 0,
                    ...(trimIn !== undefined ? { in: trimIn } : {}),
                    ...(trimOut !== undefined ? { out: trimOut } : {}),
                    ...(kind === 'sfx' ? duckOptions(item, label) : {}),
                    ...(fadeIn !== undefined ? { fadeIn } : {}),
                    ...(fadeOut !== undefined ? { fadeOut } : {}),
                    ...(['linear', 'equal_power', 's_curve', 'slow'].includes(String(item.fade_in_shape))
                        ? { fadeInShape: item.fade_in_shape as EditSummaryTimedAudio['fadeInShape'] } : {}),
                    ...(['linear', 'equal_power', 's_curve', 'slow'].includes(String(item.fade_out_shape))
                        ? { fadeOutShape: item.fade_out_shape as EditSummaryTimedAudio['fadeOutShape'] } : {})
                };
            }));
            const resolved: EditSummaryTimedAudio[] = [];
            for (const entry of resolvedItems) {
                if (entry) resolved.push(entry);
            }
            return resolved;
        };

        const bgms: EditSummaryBgm[] = [];
        for (const [bgmIndex, rawValue] of (Array.isArray(audio.bgms) ? audio.bgms : audio.bgm !== undefined ? [audio.bgm] : []).entries()) {
            const rawBgm = rawValue as {
                mute?: unknown;
                t?: unknown;
                duration?: unknown;
                path?: unknown;
                id?: unknown;
                gain_db?: unknown;
                ducking?: unknown;
                duck_db?: unknown;
                duckDb?: unknown;
                duck_attack?: unknown;
                duckAttack?: unknown;
                duck_release?: unknown;
                duckRelease?: unknown;
                keyframes?: unknown;
                fadeIn?: unknown;
                fadeOut?: unknown;
                fade_in_shape?: unknown;
                fade_out_shape?: unknown;
                in?: unknown;
                track?: unknown;
            } | undefined;
            if (!rawBgm || typeof rawBgm !== 'object' || Array.isArray(rawBgm)) {
                console.warn('[akari-preview] audio.bgm を無視しました（object ではありません）');
            } else if (isAudioItemAudible(undefined, rawBgm)) {
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
                    const source = await resolveSource(rawBgm.path, 'audio.bgm', { inSec: bgmIn ?? 0 }, 'bgm', String(rawBgm.id ?? `bgm-${bgmIndex}`), Number(rawBgm.t ?? 0), audioClipFxOf(rawBgm, 'bgm'));
                    const normalizedKeyframes = keyframes(rawBgm.keyframes, 'audio.bgm');
                    if (source) {
                        bgms.push({
                            src: source.src,
                            id: typeof rawBgm.id === 'string' ? rawBgm.id : `bgm-${bgmIndex}`,
                            ...(typeof rawBgm.t === 'number' ? { t: rawBgm.t } : {}),
                            ...(typeof rawBgm.duration === 'number' && rawBgm.duration > 0 ? { duration: rawBgm.duration } : {}),
                            ...(source.sidecar ? { sidecar: source.sidecar } : {}),
                            ...(source.sidecarState ? { sidecarState: source.sidecarState } : {}),
                            gainDb: normalizedGain,
                            ...(normalizedKeyframes !== undefined ? { keyframes: normalizedKeyframes } : {}),
                            track: Number.isInteger(rawBgm.track) && (rawBgm.track as number) >= 0
                                ? rawBgm.track as number : 0,
                            ducking: rawBgm.ducking === true,
                            ...duckOptions(rawBgm, 'audio.bgm'),
                            ...fades,
                            ...(['linear', 'equal_power', 's_curve', 'slow'].includes(String(rawBgm.fade_in_shape))
                                ? { fadeInShape: rawBgm.fade_in_shape as EditSummaryBgm['fadeInShape'] } : {}),
                            ...(['linear', 'equal_power', 's_curve', 'slow'].includes(String(rawBgm.fade_out_shape))
                                ? { fadeOutShape: rawBgm.fade_out_shape as EditSummaryBgm['fadeOutShape'] } : {}),
                            ...(bgmIn !== undefined ? { in: bgmIn } : {})
                        });
                    }
                }
            }
        }
        const [sfx, narration, speech] = await Promise.all([
            timed(audio.sfx, 'sfx'), timed(audio.narration, 'narration'), timed(audio.speech, 'speech')
        ]);
        if (bgms.length === 0 && sfx.length === 0 && narration.length === 0 && speech.length === 0) {
            return undefined;
        }
        return { bgm: bgms[0], bgms, sfx, narration, speech };
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
    // GLB はヘッダ 12 バイト + チャンクヘッダ 8 バイト + JSON チャンクだけ読めば extensionsUsed が
    // 分かる。モデル本体（数十 MB になりうる）をレンダラへ丸ごと読み込まない
    //（task/2026-09-02-preview-perf）。先頭 64 KiB で足りなければ JSON チャンク末尾まで読み直す。
    protected async readGltfHeaderBytes(uri: URI): Promise<Uint8Array> {
        const probe = await this.fileService.readFile(uri, { position: 0, length: GLTF_HEADER_PROBE_BYTES });
        const bytes = probe.value.buffer;
        if (bytes.byteLength < 20) {
            return bytes;
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (view.getUint32(0, true) !== 0x46546c67) {
            return bytes;
        }
        const needed = 20 + view.getUint32(12, true);
        if (bytes.byteLength >= needed) {
            return bytes;
        }
        return (await this.fileService.readFile(uri, { position: 0, length: needed })).value.buffer;
    }

    protected async resolveThreeSceneAssets(
        html: string,
        editUri: URI,
        assetStreams: Map<string, { id: string; url: string }>,
        assetUris: URI[],
        unsupportedGltfWarnings: string[],
        ensureAssetStream?: (key: string, assetUri?: URI) => Promise<{ id: string; url: string }>,
        overlayVars: Record<string, string> = {}
    ): Promise<string> {
        if (threeSceneDeclarations(html).length === 0) {
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
                const resolveAsset = async (relativePath: string, field: string): Promise<string> => {
                    if (relativePath.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(relativePath)) {
                        throw new TypeError(`${field} に絶対パスや URL は指定できません`);
                    }
                    const assetUri = await this.resolveEditAssetUri(relativePath, editUri);
                    const key = assetUri.toString();
                    if (ensureAssetStream) {
                        return (await ensureAssetStream(key, assetUri)).url;
                    }
                    let stream = assetStreams.get(key);
                    if (!stream) {
                        stream = await this.createAssetStream({ assetUri: key });
                        assetStreams.set(key, stream);
                        assetUris.push(assetUri);
                    }
                    return stream.url;
                };
                const parsedDescriptor: unknown = JSON.parse(declaration.textContent || '{}');
                if (!parsedDescriptor || typeof parsedDescriptor !== 'object' || Array.isArray(parsedDescriptor)) {
                    throw new TypeError('data-akari-3d-scene は JSON object である必要があります');
                }
                if (Object.keys(parsedDescriptor).some(key => !THREE_SCENE_KEYS.has(key))) {
                    throw new TypeError('data-akari-3d-scene に未対応の top-level key があります');
                }
                const resolved = await resolveThreeSceneDescriptorAssets(parsedDescriptor, resolveAsset, overlayVars);
                const descriptor = resolved.descriptor;
                if (resolved.modelPath) {
                    try {
                        const unsupported = detectUnsupportedGltfExtensions(
                            await this.readGltfHeaderBytes(await this.resolveEditAssetUri(resolved.modelPath, editUri))
                        );
                        if (unsupported.length > 0) {
                            unsupportedGltfWarnings.push(
                                `3D モデル ${resolved.modelPath} が ${unsupported.join('/')} 圧縮のため読み込めません` +
                                `（書き出しも同様に失敗します。非圧縮で書き出し直してください）`
                            );
                        }
                    } catch (error) {
                        console.warn(
                            '[akari-preview] failed to inspect 3D model for unsupported glTF extensions',
                            resolved.modelPath,
                            error
                        );
                    }
                }
                declaration.textContent = JSON.stringify(descriptor).replace(/</g, '\\u003c');
            } catch (error) {
                declaration.textContent = JSON.stringify({ model: '' });
                unsupportedGltfWarnings.push(`3D の読み込みに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
                console.warn('[akari-preview] failed to resolve declarative 3D scene asset', error);
            }
        }
        return document.body.innerHTML;
    }

    protected previewCaptionTimelineSegments(
        cuts: readonly EditSummaryCut[],
        fps = 30,
        internal?: InternalEdit
    ): TimelineSegment[] {
        return buildCaptionTimelineSegments(
            cuts.map(cut => ({ ...cut, track: cut.renderTrack })),
            internal,
            { trackZ: track => track, fps }
        );
    }

    protected async loadPreviewCaptions(
        captionsUri: URI | undefined,
        editUri?: URI
    ): Promise<LoadedPreviewCaptions> {
        if (!captionsUri) {
            return { captions: [] };
        }
        const key = captionsUri.toString();
        try {
            let source = await this.readText(captionsUri);
            if (!source.trim()) {
                // A truncate-and-write can expose a zero-byte file briefly. Confirm that
                // it stays empty before clearing captions; partial nonempty JSON stays cached.
                await new Promise<void>(resolve => setTimeout(resolve, 150));
                source = await this.readText(captionsUri);
                if (!source.trim()) {
                    const empty = { captions: [] };
                    this.lastLoadedCaptions.set(key, empty);
                    return empty;
                }
            }
            let loaded: LoadedPreviewCaptions;
            if (editUri) {
                const rawRoot = JSON.parse(source);
                const rawRows = Array.isArray(rawRoot) ? rawRoot
                    : Array.isArray(rawRoot?.captions) ? rawRoot.captions : [];
                const timeDomains = new Map<string, 'source' | 'output'>(rawRows
                    .filter((row: { time_domain?: string } | null) => row?.time_domain === 'source' || row?.time_domain === 'output')
                    .map((row: { id: string; time_domain: 'source' | 'output' }) => [row.id, row.time_domain]));
                loaded = await loadCaptionDisplayFailOpen({
                    resolve: async () => this.previewService.resolveCaptionDisplay({
                        captionsUri: captionsUri.toString(),
                        editUri: editUri.toString(),
                        workspaceRoots: await this.currentWorkspaceRoots()
                    }),
                    resolved: resolved => ({
                        captions: parseResolvedPreviewCaptions(resolved).map(caption => ({
                            ...caption,
                            clockDomain: 'output' as const,
                            timeDomain: timeDomains.get(caption.sourceCueId ?? caption.id ?? '')
                        })),
                        emphasisWords: resolved.emphasisWords
                    }),
                    legacy: () => this.loadLegacyPreviewCaptions(captionsUri, editUri),
                    warn: code => this.messages.warn(
                        `字幕の表示設定を解決できないため、設定を無視して表示しています: ${code}`
                    ),
                    state: this.captionDisplayFallbackState
                });
            } else {
                loaded = await this.loadLegacyPreviewCaptions(captionsUri, editUri);
            }
            this.lastLoadedCaptions.set(key, loaded);
            return loaded;
        } catch (error) {
            if (await this.fileService.exists(captionsUri)) {
                console.warn(`[akari-preview] failed to load ${key}; keeping previous captions`, error);
                return this.lastLoadedCaptions.get(key) ?? { captions: [] };
            }
            this.lastLoadedCaptions.delete(key);
            return { captions: [] };
        }
    }

    protected async loadLegacyPreviewCaptions(captionsUri: URI, editUri?: URI): Promise<LoadedPreviewCaptions> {
        const source = await this.readText(captionsUri);
        let output: { width: number; height: number } | undefined;
        if (editUri) {
            try {
                const edit = JSON.parse(await this.readText(editUri)) as { output?: unknown };
                if (edit.output && typeof edit.output === 'object'
                    && typeof (edit.output as { width?: unknown }).width === 'number'
                    && typeof (edit.output as { height?: unknown }).height === 'number') {
                    output = edit.output as { width: number; height: number };
                }
            } catch {
                // Legacy caption loading remains fail-open when edit output is unavailable.
            }
        }
        const parsed = parsePreviewCaptions(source, output);
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
            const sourceId = caption.sourceCueId ?? caption.id;
            const raw = (sourceId ? rawById.get(sourceId) : undefined)
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
                ...(declaredDomain !== 'legacy' ? { timeDomain: declaredDomain } : {}),
                ...(typeof raw?.src === 'string' && raw.src ? { clockSourceId: raw.src } : {})
            };
        });
        return { captions, emphasisWords };
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
        let materializedDir: URI | undefined;
        let editTextToRestore: string | undefined;
        try {
            if ('text' in request.patch && typeof request.patch.text !== 'string') {
                throw new Error('部品の text は文字列である必要があります');
            }
            if (request.patch.duplicate) {
                if (!request.patch.transform) throw new Error('複製を書き込めません');
                const handled = this.commandRegistry.getCommand('akari.annotations.commitPreviewTransform')
                    ? await this.commandRegistry.executeCommand('akari.annotations.commitPreviewTransform',
                        editUri.toString(), { kind: 'duplicate', itemId: request.overlayId,
                            transform: request.patch.transform }) : false;
                if (handled !== true) {
                    const source = await this.readText(editUri);
                    const candidateText = duplicatePreviewItemSource(source, request.overlayId, request.patch.transform);
                    const lintResult = await this.previewService.lintEditCandidate({
                        editUri: editUri.toString(), candidateText
                    });
                    if (!lintResult.pass) throw new Error(lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
                    this.recentWrites.set(editUri.toString(), Date.now());
                    await this.fileService.writeFile(editUri, BinaryBuffer.fromString(candidateText));
                    this.queueRefresh(widget, editUri, 'output', undefined, false, candidateText);
                }
                widget.sendMessage({ type: 'akari-preview-overlay-write-response', requestId: request.requestId, ok: true });
                return;
            }
            const originalText = await this.readText(editUri);
            const write: PreviewItemWriteCommand = {
                kind: 'overlay',
                itemId: request.overlayId,
                patch: request.patch,
                playheadSeconds: request.playheadSeconds ?? widget.akariPreviewLastKnownTime
            };
            const resolved = resolvePreviewItemWrite(originalText, write);
            let candidateText = resolved.candidateText;
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
                let target = projectRoot.resolve(htmlPath);
                if (!`${target.toString()}/`.startsWith(`${projectRoot.toString()}/`)) {
                    throw new Error('プロジェクト外への書き込みは拒否しました');
                }
                const needsMaterialization = !(await this.fileService.exists(target));
                let sourceUri = target;
                if (needsMaterialization) {
                    sourceUri = await this.resolveEditAssetUri(htmlPath, editUri);
                    if (sourceUri.toString() === target.toString() || !(await this.fileService.exists(sourceUri))) {
                        throw new Error(htmlPath.replace(/\\/g, '/').startsWith('assets/overlay/')
                            ? `ライブラリに断片の実体がありません: ${htmlPath}`
                            : `断片ファイルがありません: ${htmlPath}`);
                    }
                }
                const source = await this.readText(sourceUri);
                const candidate = patchFragmentSourceText(source, request.patch.html);
                assertNoSessionAssetUrl(candidate);
                if (candidate !== source && needsMaterialization) {
                    const plan = materializedFragmentPlan(htmlPath, request.overlayId, crypto.randomUUID().replace(/-/g, ''));
                    const destination = projectRoot.resolve(plan.targetDirectory);
                    if (await this.fileService.exists(destination)) throw new Error('断片の実体化先が既にあります');
                    materializedDir = destination;
                    let sourceDir = sourceUri.parent;
                    for (let depth = 1; depth < htmlPath.split(/[\\/]/).length - 3; depth++) sourceDir = sourceDir.parent;
                    await this.fileService.createFolder(materializedDir.parent);
                    await this.fileService.copy(sourceDir, materializedDir, { overwrite: false });
                    target = projectRoot.resolve(plan.targetPath);
                    candidateText = replaceFragmentReference(candidateText ?? originalText,
                        request.overlayId, htmlPath, plan.targetPath, serializeEdit);
                }
                if (candidate !== source) {
                    this.recentWrites.set(target.toString(), Date.now());
                    await this.fileService.writeFile(target, BinaryBuffer.fromString(
                        needsMaterialization ? withoutFragmentRootTiming(candidate) : candidate));
                }
            }
            if (candidateText) {
                const lintResult = await this.previewService.lintEditCandidate({
                    editUri: editUri.toString(),
                    candidateText
                });
                if (!lintResult.pass) {
                    throw new Error(lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
                }
                this.recentWrites.set(editUri.toString(), Date.now());
                if ((request.patch.transform || request.patch.xyKeyframes) && request.patch.html === undefined) {
                    await this.persistPreviewTransform(editUri, candidateText, write);
                } else {
                    if (materializedDir) editTextToRestore = originalText;
                    await this.fileService.writeFile(editUri, BinaryBuffer.fromString(candidateText));
                }
            }
            widget.sendMessage({
                type: 'akari-preview-overlay-write-response',
                requestId: request.requestId,
                ok: true
            });
        } catch (error) {
            if (editTextToRestore !== undefined) {
                await this.fileService.writeFile(editUri, BinaryBuffer.fromString(editTextToRestore)).catch(() => undefined);
            }
            if (materializedDir) await this.fileService.delete(materializedDir, { recursive: true }).catch(() => undefined);
            widget.sendMessage({
                type: 'akari-preview-overlay-write-response',
                requestId: request.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    protected async persistPreviewTransform(
        editUri: URI, after: string, command?: PreviewItemWriteCommand | PreviewItemWriteCommand[]
    ): Promise<void> {
        if (command && this.commandRegistry.getCommand('akari.annotations.commitPreviewTransform')) {
            const handled = await this.commandRegistry.executeCommand('akari.annotations.commitPreviewTransform', editUri.toString(), command);
            if (handled === true) return;
        }
        await this.fileService.writeFile(editUri, BinaryBuffer.fromString(after));
    }

    protected async handleOverlayWriteBatch(widget: PreviewWidgetMarker, request: OverlayWriteBatchRequest): Promise<void> {
        try {
            const editUri = widget.akariPreviewEditUri;
            if (!editUri) throw new Error('編集中の edit.json がありません');
            const originalText = await this.readText(editUri);
            const writes: PreviewItemWriteCommand[] = request.writes.map(write => ({
                kind: 'overlay' as const, itemId: write.overlayId, patch: write.patch,
                playheadSeconds: request.playheadSeconds ?? widget.akariPreviewLastKnownTime
            }));
            const resolved = resolvePreviewItemWriteBatch(originalText, writes);
            const candidateText = resolved.candidateText;
            if (candidateText === undefined) throw new Error('バッチの結果文書がありません');
            const lintResult = await this.previewService.lintEditCandidate({ editUri: editUri.toString(), candidateText });
            if (!lintResult.pass) throw new Error(lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
            this.recentWrites.set(editUri.toString(), Date.now());
            if (request.writes.some(write => Boolean(write.patch.transform))) {
                await this.persistPreviewTransform(editUri, candidateText, writes);
            } else {
                await this.fileService.writeFile(editUri, BinaryBuffer.fromString(candidateText));
            }
            widget.sendMessage({ type: 'akari-preview-overlay-write-batch-response', requestId: request.requestId, ok: true });
        } catch (error) {
            widget.sendMessage({ type: 'akari-preview-overlay-write-batch-response', requestId: request.requestId,
                ok: false, error: error instanceof Error ? error.message : String(error) });
        }
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
        const validationError = validateLayerTransformPatch(request.patch.transform)
            ?? validateLayerCropPatch(request.patch.crop)
            ?? validateLayerPerspectivePatch(request.patch.perspective);
        if (validationError) {
            respond(false, validationError);
            return;
        }
        try {
            const originalText = await this.readText(editUri);
            const write: PreviewItemWriteCommand = {
                kind: 'layer',
                itemId: request.layerId,
                patch: request.patch,
                playheadSeconds: request.playheadSeconds ?? widget.akariPreviewLastKnownTime
            };
            if (isNestedPreviewLayer(originalText, request.layerId)) {
                const committed = this.commandRegistry.getCommand('akari.annotations.commitPreviewTransform')
                    ? await this.commandRegistry.executeCommand('akari.annotations.commitPreviewTransform',
                        editUri.toString(), write) : false;
                if (committed !== true) throw new Error('キャンバス内の写真を書き戻せませんでした');
                respond(true);
                return;
            }
            const resolved = resolvePreviewItemWrite(originalText, write);
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
            this.markRecentWrite(editUri);
            await this.persistPreviewTransform(editUri, candidateText,
                request.patch.transform || request.patch.crop || request.patch.xyKeyframes
                    || request.patch.perspective !== undefined ? write : undefined);
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
        const validationError = validateLayerTransformPatch(request.patch.transform)
            ?? validateLayerCropPatch(request.patch.crop);
        if (validationError) {
            respond(false, validationError);
            return;
        }
        try {
            const originalText = await this.readText(editUri);
            const write: PreviewItemWriteCommand = {
                kind: 'cut',
                itemId: request.cutId,
                legacyIndex: request.cutIndex,
                patch: request.patch,
                playheadSeconds: request.playheadSeconds ?? widget.akariPreviewLastKnownTime
            };
            const resolved = resolvePreviewItemWrite(originalText, write);
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
            this.markRecentWrite(editUri);
            await this.persistPreviewTransform(editUri, candidateText,
                request.patch.transform || request.patch.crop || (request.patch as { xyKeyframes?: unknown }).xyKeyframes ? write : undefined);
            respond(true);
        } catch (error) {
            respond(false, error instanceof Error ? error.message : String(error));
        }
    }

    protected notifyCaptionWrite(
        widget: PreviewWidgetMarker, captionsUri: URI, before: string, after: string, label: string
    ): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) return;
        const change = previewCaptionWrite(editUri.toString(), captionsUri.toString(), before, after, label);
        if (change) this.onDidWriteCaptionEmitter.fire(change);
    }

    /** History writes can land inside the recent-write watcher suppression window. */
    refreshCaptionsAfterHistoryWrite(captionsUri: string, clearPositions = true): void {
        const written = new URI(captionsUri);
        this.markRecentWrite(written);
        for (const widget of this.openOutputPreviews.values()) {
            const current = widget.akariPreviewCaptionsUri;
            if (!widget.isDisposed && current?.toString() === captionsUri) {
                if (clearPositions) widget.sendMessage({ type: 'akari-preview-clear-caption-positions' });
                this.queueCaptionsUpdate(widget);
            }
        }
    }

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
        if ('duplicate' in request.patch) {
            const editUri = widget.akariPreviewEditUri;
            try {
                if (!editUri) throw new Error('編集中の edit.json がありません');
                const committed = this.commandRegistry.getCommand('akari.annotations.commitPreviewTransform')
                    ? await this.commandRegistry.executeCommand('akari.annotations.commitPreviewTransform',
                        editUri.toString(), { kind: 'caption-duplicate', captionId: request.captionId,
                            position: request.patch.duplicate }) : false;
                if (committed !== true) {
                    const source = await this.readText(captionsUri);
                    const candidateText = duplicatePreviewCaptionSource(source, request.captionId, request.patch.duplicate);
                    const lintResult = await this.previewService.lintEditCandidate({
                        editUri: captionsUri.toString(), candidateText
                    });
                    if (!lintResult.pass) throw new Error(lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
                    this.markRecentWrite(captionsUri);
                    await this.fileService.writeFile(captionsUri, BinaryBuffer.fromString(candidateText));
                    this.notifyCaptionWrite(widget, captionsUri, source, candidateText, '文字を複製');
                }
                this.refreshCaptionsAfterHistoryWrite(captionsUri.toString(), false);
                respond(true);
            } catch (error) {
                respond(false, error instanceof Error ? error.message : String(error));
            }
            return;
        }
        if ('plateTransform' in request.patch && request.patch.plateTransform.wrapWidthPct !== undefined) {
            const patch = request.patch.plateTransform;
            const position = patch.cuePosition?.value;
            const editUri = widget.akariPreviewEditUri;
            if (!editUri || !position || patch.cuePosition?.captionId !== request.captionId
                || !Number.isFinite(patch.wrapWidthPct) || patch.wrapWidthPct <= 0 || patch.wrapWidthPct > 100
                || !Number.isFinite(position.position.x) || !Number.isFinite(position.position.y)) {
                respond(false, '文字の幅または位置が不正です');
                return;
            }
            try {
                const committed = patch.backgroundPaddingPx === 0 ? false
                    : this.commandRegistry.getCommand('akari.annotations.commitPreviewTransform')
                    ? await this.commandRegistry.executeCommand('akari.annotations.commitPreviewTransform',
                        editUri.toString(), { kind: 'caption-wrap', captionId: request.captionId,
                            wrapWidthPct: patch.wrapWidthPct, anchor: position.anchor,
                            position: position.position }) : false;
                if (committed !== true) {
                    const originalText = await this.readText(captionsUri);
                    let writtenText: string | undefined;
                    const lintResult = await persistCaptionPlateTransform({
                        source: originalText, captionIds: [request.captionId],
                        patch: { wrapWidthPct: patch.wrapWidthPct,
                            ...(patch.backgroundPaddingPx === 0 ? { backgroundPaddingPx: 0 as const } : {}) },
                        cuePosition: { captionId: request.captionId, value: position },
                        lint: candidateText => this.previewService.lintEditCandidate({
                            editUri: captionsUri.toString(), candidateText
                        }),
                        write: async candidateText => {
                            this.markRecentWrite(captionsUri);
                            await this.fileService.writeFile(captionsUri, BinaryBuffer.fromString(candidateText));
                            writtenText = candidateText;
                        }
                    });
                    if (!lintResult.pass) throw new Error(lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
                    if (writtenText !== undefined) {
                        this.notifyCaptionWrite(widget, captionsUri, originalText, writtenText, '文字の折り返し幅を変更');
                    }
                }
                this.refreshCaptionsAfterHistoryWrite(captionsUri.toString(), false);
                respond(true);
            } catch (error) {
                respond(false, error instanceof Error ? error.message : String(error));
            }
            return;
        }
        const requestedZone = 'zone' in request.patch ? request.patch.zone
            : 'groupZone' in request.patch ? request.patch.groupZone : undefined;
        if (typeof requestedZone === 'string'
            && !(CAPTION_ZONES as readonly string[]).includes(requestedZone)) {
            respond(false, `不正な zone です: ${requestedZone}`);
            return;
        }
        try {
            const originalText = await this.readText(captionsUri);
            let writtenText: string | undefined;
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
                    writtenText = candidateText;
                }
            };
            const toolStyle = 'toolStyle' in request.patch ? request.patch.toolStyle : undefined;
            const runEdit = 'run' in request.patch ? request.patch.run : undefined;
            const geometryReset = 'cueGeometryReset' in request.patch ? request.patch.cueGeometryReset : undefined;
            const cuePositions = 'cuePositions' in request.patch ? request.patch.cuePositions : undefined;
            const lintResult = geometryReset
                ? await (async () => {
                    const candidate = resetCaptionCueGeometrySource(originalText, geometryReset.captionIds);
                    const result = await persistOptions.lint(candidate);
                    if (result.pass) await persistOptions.write(candidate);
                    return result;
                })()
                : toolStyle
                ? await (async () => {
                    const candidate = updateCaptionToolStyleSource(
                        originalText, toolStyle.captionIds, toolStyle.change
                    );
                    const result = await persistOptions.lint(candidate);
                    if (result.pass) await persistOptions.write(candidate);
                    return result;
                })()
                : runEdit
                ? await (async () => {
                    const candidate = updateCaptionRunsInSource(originalText, request.captionId, runEdit);
                    const result = await persistOptions.lint(candidate);
                    if (result.pass) await persistOptions.write(candidate);
                    return result;
                })()
                : 'text' in request.patch
                ? await persistCaptionText({ ...persistOptions, text: request.patch.text })
                : 'plateTransform' in request.patch
                    ? await persistCaptionPlateTransform({
                        source: originalText,
                        captionIds: request.patch.plateTransform.captionIds,
                        patch: {
                            ...(request.patch.plateTransform.scale === undefined
                                ? {} : { scale: request.patch.plateTransform.scale }),
                            ...(request.patch.plateTransform.rotate === undefined
                                ? {} : { rotate: request.patch.plateTransform.rotate }),
                            ...(request.patch.plateTransform.wrapWidthPct === undefined
                                ? {} : { wrapWidthPct: request.patch.plateTransform.wrapWidthPct })
                        },
                        ...(request.patch.plateTransform.cuePosition
                            ? { cuePosition: request.patch.plateTransform.cuePosition } : {}),
                        lint: persistOptions.lint,
                        write: persistOptions.write
                    })
                : 'cuePosition' in request.patch
                    ? await persistCaptionCuePosition({ ...persistOptions, value: request.patch.cuePosition })
                    : cuePositions
                        ? await (async () => {
                            const candidate = updateCaptionCuePositionsSource(originalText, cuePositions);
                            const result = await persistOptions.lint(candidate);
                            if (result.pass) await persistOptions.write(candidate);
                            return result;
                        })()
                    : 'cuePositionReset' in request.patch
                        ? await persistCaptionCuePositionReset(persistOptions)
                        : 'groupPosition' in request.patch
                            ? await persistCaptionGroupPosition({
                                source: originalText,
                                value: request.patch.groupPosition,
                                lint: persistOptions.lint,
                                write: persistOptions.write
                            })
                            : 'groupZone' in request.patch
                                ? await persistCaptionGroupZone({
                                    source: originalText,
                                    zone: request.patch.groupZone,
                                    lint: persistOptions.lint,
                                    write: persistOptions.write
                                })
                                : await persistCaptionZone({
                                    ...persistOptions,
                                    zone: 'zone' in request.patch ? request.patch.zone : 'bottom'
                                });
            if (!lintResult.pass) {
                respond(false, lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
                return;
            }
            this.queueCaptionsUpdate(widget);
            if (writtenText !== undefined) {
                this.notifyCaptionWrite(widget, captionsUri, originalText, writtenText, captionWriteLabel(request));
                if ('text' in request.patch && request.patch.text.trim()) {
                    const report = updateCaptionFieldsInSourceWithReport(originalText, request.captionId,
                        { text: request.patch.text });
                    const root = JSON.parse(originalText) as Array<{ id: string; text: string; display_text?: string }>
                        | { captions?: Array<{ id: string; text: string; display_text?: string }> };
                    const caption = (Array.isArray(root) ? root : root.captions)
                        ?.find(item => item.id === request.captionId);
                    for (const notice of captionEditNotices(report, caption?.display_text ?? caption?.text ?? '')) {
                        if (this.lastCaptionRunNotice !== notice) void this.messages.info(notice, { timeout: 4000 });
                        this.lastCaptionRunNotice = notice;
                    }
                }
            }
            respond(true);
        } catch (error) {
            respond(false, error instanceof Error ? error.message : String(error));
        }
    }

    protected async handleMixedMove(widget: PreviewWidgetMarker, message: any): Promise<void> {
        const respond = (ok: boolean, error?: string): void => widget.sendMessage({
            type: 'akari-preview-mixed-move-response', requestId: message.requestId, ok, error
        });
        try {
            if (typeof message.requestId !== 'string'
                || !Array.isArray(message.writes) || !Array.isArray(message.cuePositions)
                || message.writes.length + message.cuePositions.length < 2
                || !message.writes.every((write: any) => write
                    && ['layer', 'overlay'].includes(write.kind) && typeof write.itemId === 'string'
                    && write.patch?.transform && Number.isFinite(write.patch.transform.x)
                    && Number.isFinite(write.patch.transform.y))
                || !message.cuePositions.every((entry: any) => typeof entry?.captionId === 'string'
                    && ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].includes(entry.value?.anchor)
                    && Number.isFinite(entry.value?.position?.y)
                    && (entry.value?.position?.x === undefined || Number.isFinite(entry.value.position.x)))) {
                throw new Error('混在移動の書き込み要求が不正です');
            }
            const editUri = widget.akariPreviewEditUri;
            if (!editUri) throw new Error('編集中の edit.json がありません');
            const captionsUri = widget.akariPreviewCaptionsUri;
            if (message.cuePositions.length && !captionsUri) throw new Error('captions.json がありません');
            const writes = message.writes as PreviewItemWriteCommand[];
            const editBefore = await this.readText(editUri);
            const editAfter = writes.length ? resolvePreviewItemWriteBatch(editBefore, writes).candidateText : editBefore;
            if (!editAfter) throw new Error('移動結果の edit.json がありません');
            const editLint = await this.previewService.lintEditCandidate({ editUri: editUri.toString(), candidateText: editAfter });
            if (!editLint.pass) throw new Error(editLint.errors[0] ?? 'edit-lint が変更を拒否しました');
            const captionsBefore = captionsUri ? await this.readText(captionsUri) : undefined;
            const captionsAfter = message.cuePositions.length && captionsBefore
                ? updateCaptionCuePositionsSource(captionsBefore, message.cuePositions) : undefined;
            if (captionsUri && captionsAfter) {
                const captionsLint = await this.previewService.lintEditCandidate({
                    editUri: captionsUri.toString(), candidateText: captionsAfter
                });
                if (!captionsLint.pass) throw new Error(captionsLint.errors[0] ?? 'edit-lint が変更を拒否しました');
            }
            const command = this.commandRegistry.getCommand('akari.annotations.commitPreviewTransform');
            if (!command) throw new Error('まとめて移動する編集コマンドがありません');
            const handled = await this.commandRegistry.executeCommand('akari.annotations.commitPreviewTransform',
                editUri.toString(), { kind: 'mixed-move', writes,
                    ...(captionsBefore && captionsAfter ? { captions: { before: captionsBefore, after: captionsAfter } } : {}) });
            if (handled !== true) throw new Error('まとめて移動を保存できませんでした');
            this.markRecentWrite(editUri);
            this.queueRefresh(widget, editUri, 'output', undefined, false, await this.readText(editUri));
            if (captionsUri && captionsAfter) {
                this.markRecentWrite(captionsUri);
                this.queueCaptionsUpdate(widget);
            }
            respond(true);
        } catch (error) {
            respond(false, error instanceof Error ? error.message : String(error));
        }
    }

    protected async persistCaptionGroupZoneForWidget(
        widget: PreviewWidgetMarker,
        zone: CaptionZoneValue
    ): Promise<void> {
        const captionsUri = widget.akariPreviewCaptionsUri;
        if (!captionsUri) return;
        try {
            const source = await this.readText(captionsUri);
            let writtenText: string | undefined;
            const lintResult = await persistCaptionGroupZone({
                source,
                zone,
                lint: candidateText => this.previewService.lintEditCandidate({
                    editUri: captionsUri.toString(),
                    candidateText
                }),
                write: async candidateText => {
                    this.markRecentWrite(captionsUri);
                    await this.fileService.writeFile(captionsUri, BinaryBuffer.fromString(candidateText));
                    writtenText = candidateText;
                }
            });
            if (!lintResult.pass) throw new Error(lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
            this.queueCaptionsUpdate(widget);
            if (writtenText !== undefined) {
                this.notifyCaptionWrite(widget, captionsUri, source, writtenText, '字幕の配置を変更');
            }
        } catch (error) {
            this.messages.error(error instanceof Error ? error.message : String(error));
        }
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

    // プレビュー全画面（webview の ⛶ ボタン / Escape）。widget.node を position: fixed の
    // オーバーレイとして最前面に広げる自前実装で、Theia の shell.toggleMaximized は使わない。
    // 理由: (1) toggleMaximized はタブバーが残り「本当の全画面」にならない (2) 全画面中に
    // タブの ✕ で widget が閉じられると解除経路が消えて戻れなくなる (3) DockPanel ごと
    // maximizedElement へ再親付けするため webview iframe がリロードされ再生状態が飛ぶ。
    // fixed オーバーレイは DOM 再親付けなし（iframe 継続）+ タブバーごと覆う + 破棄時に
    // 必ず自動解除、で三点とも解消する。
    protected fullscreenPreviewWidget?: PreviewWidgetMarker;
    protected readonly toDisposeOnPreviewFullscreenExit = new DisposableCollection();

    protected togglePreviewFullscreen(widget: PreviewWidgetMarker): void {
        if (this.fullscreenPreviewWidget === widget) {
            this.exitPreviewFullscreen();
            return;
        }
        this.exitPreviewFullscreen();
        this.enterPreviewFullscreen(widget);
    }

    protected enterPreviewFullscreen(widget: PreviewWidgetMarker): void {
        // セカンダリウィンドウへ切り離されたプレビューでも効くよう、widget が実際に
        // 属する document を基準にする（style 注入・Escape とも）。
        const ownerDocument = widget.node.ownerDocument;
        this.ensurePreviewFullscreenStyle(ownerDocument);
        const markedAncestors: HTMLElement[] = [];
        let ancestor = widget.node.parentElement;
        while (ancestor) {
            ancestor.classList.add(PREVIEW_FULLSCREEN_ANCESTOR_CLASS);
            markedAncestors.push(ancestor);
            if (ancestor === ownerDocument.body) {
                break;
            }
            ancestor = ancestor.parentElement;
        }
        this.toDisposeOnPreviewFullscreenExit.push(Disposable.create(() => {
            for (const markedAncestor of markedAncestors) {
                markedAncestor.classList.remove(PREVIEW_FULLSCREEN_ANCESTOR_CLASS);
            }
        }));
        widget.node.classList.add(PREVIEW_FULLSCREEN_CLASS);
        this.fullscreenPreviewWidget = widget;
        // webview 内にフォーカスがあるときの Escape は webview 側のリスナーが
        // akari-preview-fullscreen-exit で届ける。ここはホスト側にフォーカスが
        // あるときの保険。isTrusted は合成イベント（オーバーレイ選択解除の
        // synthetic Escape）での誤解除防止。
        // 第12項: key の読み取りが落ちても例外を伝播させず診断に残す（全画面解除の保険が
        // Console を埋める側に回らないようにする）。
        const onKeyDown = guardedKeyHandler<KeyboardEvent>(
            event => {
                if (event.key !== 'Escape' || !event.isTrusted) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                this.exitPreviewFullscreen();
            },
            (event, reason) => this.previewDiagnostics?.recordKeyConversionFailure(event, reason)
        );
        ownerDocument.addEventListener('keydown', onKeyDown, true);
        this.toDisposeOnPreviewFullscreenExit.push(
            Disposable.create(() => ownerDocument.removeEventListener('keydown', onKeyDown, true))
        );
        const onDisposed = (): void => this.exitPreviewFullscreen();
        widget.disposed.connect(onDisposed);
        this.toDisposeOnPreviewFullscreenExit.push(
            Disposable.create(() => widget.disposed.disconnect(onDisposed))
        );
        widget.sendMessage({ type: 'akari-preview-fullscreen-state', active: true });
    }

    protected exitPreviewFullscreen(): void {
        const widget = this.fullscreenPreviewWidget;
        if (!widget) {
            return;
        }
        this.fullscreenPreviewWidget = undefined;
        this.toDisposeOnPreviewFullscreenExit.dispose();
        widget.node.classList.remove(PREVIEW_FULLSCREEN_CLASS);
        if (!widget.isDisposed) {
            widget.sendMessage({ type: 'akari-preview-fullscreen-state', active: false });
        }
    }

    // akari-theme の AkariButtonStyleContribution と同じ流儀（このリポの拡張ビルドは
    // tsc -b のみで CSS アセットコピーが無いため、TS から <style> を注入する）。
    protected ensurePreviewFullscreenStyle(ownerDocument: Document): void {
        if (ownerDocument.getElementById(PREVIEW_FULLSCREEN_STYLE_ID)) {
            return;
        }
        const style = ownerDocument.createElement('style');
        style.id = PREVIEW_FULLSCREEN_STYLE_ID;
        // !important は Lumino DockLayout が widget.node に書き込むインライン配置
        // （position: absolute / top / left / width / height）へ勝つために必要。
        style.textContent = `
.${PREVIEW_FULLSCREEN_ANCESTOR_CLASS} {
    z-index: auto !important;
}
.${PREVIEW_FULLSCREEN_CLASS} {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    max-width: none !important;
    max-height: none !important;
    z-index: 2000;
    background: #000;
}`;
        ownerDocument.head.appendChild(style);
    }

    protected prepareHtml(
        videoUri: URI,
        videoSource: string,
        model: PreviewModel,
        assets: OverlayRuntimeAssetUrls,
        initialSeekTime?: number,
        initialPlaying = false,
        sourceUrlById: Record<string, string> = {},
        hasSourceAudio?: boolean,
        imageSourceUrlById: Record<string, string> = {},
        primaryIsStillImage = false,
        kind: 'raw' | 'output' = 'output',
        reloadNotice = false,
        frameEngineEnabled = false,
        frameEngineMetricsEnabled = false,
        originalSourceUrlById: Record<string, string> = {},
        frameEngineSourceMode = 'auto',
        frameEngineForceSoftware = false,
        frameEngineReadyTimeoutMs?: number,
        initialPlaybackRate = 1,
        frameEngineRenderScaleMode: RenderScaleMode = 'auto',
        scrubAudioEnabled = true,
        exportLook = false,
        // 診断用の頁文脈（不具合メモ 第11・12項）。Console に出る Webview ID を
        // ページ自身にも持たせ、診断カードとログの id を突き合わせられるようにする。
        pageDiagnostics: { webviewId?: string; webviewRole?: string; assetOrigin?: string } = {},
        playbackPageId?: string
    ): string {
        const { width, height } = model.summary.output;
        const threeTextRuntimeScript = hasThreeDimensionalTextOverlay(model.summary.overlays)
            ? `${this.externalScriptTag(assets.threeTextJavaScriptUrl)}\n`
            : '';
        const frameEngineScripts = frameEngineEnabled && assets.frameEngineJavaScriptUrl
            ? `<script>${frameEngineWatchdogScript()}</script>\n${this.externalScriptTag(assets.frameEngineJavaScriptUrl)}\n<script>${frameEngineBootstrapScript()}</script>\n`
            : '';
        // 資産（three / runtime / kernel / frame-engine / 字幕フォント）は素材配信サーバーと同じ
        // 127.0.0.1 オリジンから URL で読む。script-src / font-src にそのオリジンを足す。
        const streamOrigin = this.escapeHtml(this.streamOrigin(videoSource || assets.origin));
        const assetOrigin = this.escapeHtml(assets.origin);
        // frame-engine の素材デコード（av-cliper / MP4Clip）は OPFS ファイルストアと
        // タイマーを blob / data URL の Worker で動かす。既定 CSP では生成を拒否されるため、
        // 評価台を有効にしたときだけ worker-src を開ける。
        const frameEngineCsp = frameEngineScripts ? '; worker-src blob: data:' : '';
        // render-cut captions.mjs の既定とパリティ（stage は出力 px 論理空間）:
        // 縦長 = 出力幅 6% / 横長 = 38px。従来の height*0.05 は焼き込みよりも大きく表示される乖離だった。
        const captionFontSize = height > width ? Math.round(width * 0.06) : 38;
        const initialState = this.safeJson({
            // raw = 素材単体プレビュー。出力キャンバス（summary.output）ではなく素材自身の
            // 実寸法をステージ寸法にする（hostAdapterScript の raw 同期を参照）。
            kind,
            summary: model.summary,
            captions: model.captions,
            emphasisWords: model.emphasisWords ?? [],
            editPath: model.editUri?.toString() ?? null,
            selectionFloor: model.editUri
                ? this.previewSessionSettings.get(model.editUri.normalizePath().toString())?.selectionFloor ?? null : null,
            relatedEditUri: model.relatedEditUri?.toString() ?? null,
            videoUri: videoUri.toString(),
            // v1 マルチソース: ソース id → ストリーム URL。webview は cuts[].src が
            // 変わる継ぎ目で <video> をこの表から差し替える（v0 は 1 件のみの表）
            videoSources: sourceUrlById,
            videoSourceOriginals: originalSourceUrlById,
            frameEngineSourceMode,
            frameEngineRenderScaleMode,
            frameEngineForceSoftware,
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
            initialPlaying,
            playbackPageId,
            initialPlaybackRate: clampPreviewPlaybackRate(initialPlaybackRate),
            scrubAudioEnabled,
            previewAudioWorkletUrl: assets.previewAudioWorkletUrl ?? null,
            reloadNotice,
            frameEngineEnabled: Boolean(frameEngineScripts),
            frameEngineMetricsEnabled,
            ...(frameEngineReadyTimeoutMs === undefined ? {} : { frameEngineReadyTimeoutMs }),
            compositeError: model.compositeError ?? null,
            muted: model.session?.muted ?? false,
            captionsVisible: model.session?.captionsVisible ?? true,
            adjustBypassIds: model.session?.adjustBypassIds ?? [],
            hiddenTracks: model.session?.hiddenTracks ?? [],
            hiddenTracksByScope: model.session?.hiddenTracksByScope ?? { cuts: [], layers: [], audio: [] },
            mutedTracksByScope: model.session?.mutedTracksByScope ?? { cuts: [], audio: [], layers: [] },
            allTracksHiddenScopes: model.session?.allTracksHiddenScopes ?? [],
            allTracksMutedScopes: model.session?.allTracksMutedScopes ?? [],
            exportLook,
            // 診断（第11・12項）: ページ自身が自分の Webview ID と用途を名乗れるようにする。
            diagnostics: {
                webviewId: pageDiagnostics.webviewId ?? null,
                webviewRole: pageDiagnostics.webviewRole ?? null,
                assetOrigin: pageDiagnostics.assetOrigin ?? assets.origin ?? null,
                kind
            }
        });
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${streamOrigin}; connect-src ${streamOrigin} blob:; img-src ${streamOrigin} blob: data:; script-src 'unsafe-inline' ${assetOrigin}; style-src 'unsafe-inline'; font-src ${assetOrigin} data:${frameEngineCsp}">
<!-- 第13項の compute-pressure ガードと初期化段の診断は、どのバンドルよりも先に走らせる。 -->
<script>${previewDiagnosticsGuardScript()}</script>
<script>(${neutralizeWebviewDefaultStylesForOverlays.toString()})(document, ${scopeSelectorOutsideOverlays.toString()});</script>
<style>
${this.inlineStyle(assets.motionVocabCss)}
${this.inlineStyle(assets.interactionCss)}
${captionFontFaceCss(assets.captionFontUrl)}
${bundledCaptionFontFaceCss(assets.bundledCaptionFontFaces ?? [])}
:root {
  color-scheme: light dark;
  font-family: "${CAPTION_FONT_FAMILY}", sans-serif;
  --akari-preview-pasteboard: #2b2d30;
  --akari-accent: #4da3ff;
  --akari-focus-pulse: #f97316;
  --akari-transport-bg: #121212;
  --akari-transport-fg: #fff;
  --akari-seek-track: rgba(255,255,255,0.22);
  --akari-seek-played: rgba(255,255,255,0.85);
  --akari-control-hover: rgba(255,255,255,0.08);
  --akari-control-active: rgba(255,255,255,0.14);
  --akari-control-pressed: rgba(77,163,255,0.22);
  --akari-time-fg: rgba(255,255,255,0.72);
  --akari-seek-thumb: #fff;
  --akari-badge-bg: rgba(20,20,20,0.78);
  --akari-badge-fg: #f1f1f1;
}
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #141414; color: #eee; }
body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }
body.vscode-light {
  color-scheme: light;
  --akari-preview-pasteboard: #d5d7da;
  --akari-accent: #4da3ff;
  --akari-focus-pulse: #f97316;
  --akari-transport-bg: #f2f2f2;
  --akari-transport-fg: #242424;
  --akari-seek-track: rgba(0,0,0,0.18);
  --akari-seek-played: rgba(0,0,0,0.7);
  --akari-control-hover: rgba(0,0,0,0.08);
  --akari-control-active: rgba(0,0,0,0.14);
  --akari-control-pressed: rgba(77,163,255,0.22);
  --akari-time-fg: rgba(0,0,0,0.72);
  --akari-seek-thumb: #fff;
  --akari-badge-bg: rgba(20,20,20,0.78);
  --akari-badge-fg: #f1f1f1;
}
body { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.workspace { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.preview-pane { position: relative; min-width: 0; min-height: 0; padding: 0; overflow: hidden; background: var(--akari-preview-pasteboard); }
/* ペインがズーム/パンの唯一のビューポート。wrapper は UI の固定基準、zoom-layer は
   ペイン全面の変換層、preview-stage だけが output 比の黒い 100% フィット箱を担う。 */
${kind === 'raw' ? '.akari-material-chip { position: absolute; top: 8px; left: 8px; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,.55); color: #fff; pointer-events: none; z-index: 10 }' : ''}
#preview-wrapper { position: relative; width: 100%; height: 100%; container-type: size; }
[data-akari-ui="preview-scope-breadcrumb"] { position: absolute; left: 10px; top: 10px; z-index: 100;
  display: flex; gap: 5px; align-items: center; padding: 4px 8px; border-radius: 4px;
  background: var(--theia-editor-background); color: var(--theia-editor-foreground); font-size: 11px; }
[data-akari-ui="preview-scope-breadcrumb"][hidden] { display: none; }
[data-akari-ui="preview-scope-breadcrumb"] button { color: inherit; background: transparent; border: 0; cursor: pointer; }
.akari-interaction-selection-frame[data-akari-selection-kind="multi"] .akari-interaction-handle { display: none; }
[data-akari-ui="preview-hover-frame"] { position: fixed; pointer-events: none; box-sizing: border-box;
  border: 1px solid var(--akari-accent); opacity: .45; z-index: 90; }
[data-akari-ui="preview-hover-frame"][hidden] { display: none; }
[data-akari-ui="preview-marquee"] { position: fixed; pointer-events: none; box-sizing: border-box;
  border: 1px solid var(--akari-accent, #4da3ff); background: rgba(77, 163, 255, .14); z-index: 91; }
.preview-pane.is-draggable { cursor: grab; touch-action: none; }
.preview-pane.is-dragging { cursor: grabbing; }
#zoom-layer { position: absolute; inset: 0; transform-origin: 50% 50%; will-change: transform; }
#preview-chrome-layer { position: fixed; z-index: 2147483647; transform-origin: 0 0; overflow: visible; pointer-events: none; }
#preview-chrome-layer > * { pointer-events: none; }
#preview-stage { --akari-preview-gutter: 16px; --akari-preview-gutter-top: 16px; position: absolute; left: 50%; top: 50%; width: max(1px, min(calc(100cqw - var(--akari-preview-gutter) * 2), calc((100cqh - var(--akari-preview-gutter) * 2) * ${width} / ${height}))); aspect-ratio: ${width} / ${height}; overflow: hidden; background: #000; transform: translate(-50%, -50%); }
#preview-stage.akari-clearance-active { top: calc(var(--akari-preview-gutter-top) + (100cqh - var(--akari-preview-gutter-top) - var(--akari-preview-gutter)) / 2); width: max(1px, min(calc(100cqw - var(--akari-preview-gutter) * 2), calc((100cqh - var(--akari-preview-gutter-top) - var(--akari-preview-gutter)) * ${width} / ${height}))); }
${kind === 'output' ? '#preview-stage { --akari-preview-gutter-top: 40px; top: calc(var(--akari-preview-gutter-top) + (100cqh - var(--akari-preview-gutter-top) - var(--akari-preview-gutter)) / 2); width: max(1px, min(calc(100cqw - var(--akari-preview-gutter) * 2), calc((100cqh - var(--akari-preview-gutter-top) - var(--akari-preview-gutter)) * ' + width + ' / ' + height + '))); }' : ''}
html.akari-gen-capture-fit #preview-stage { top: 50% !important; width: max(1px, min(calc(100cqw - var(--akari-preview-gutter) * 2), calc((100cqh - var(--akari-preview-gutter) * 2) * ${width} / ${height}))) !important; transition: none; }
#preview-video, #standby-video, #transition-video, #transition-still { position: absolute; top: 0; left: 0; object-fit: contain; }
#standby-video, #transition-video, #transition-still { display: none; pointer-events: none; }
.akari-video-fx-rail { position: absolute; top: 0; left: 0; max-width: none; max-height: none; }
/* 静止画 cut ソース: #preview-video と同じ位置・サイズに重ね、静止画セグメントの間だけ表示する
   （配置・transform は毎フレーム video のインラインスタイルを鏡写し — syncStillImageVisual）。 */
#preview-still { position: absolute; top: 0; left: 0; object-fit: contain; display: none; user-select: none; }
#preview-layers { position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px; transform-origin: 0 0; overflow: hidden; pointer-events: none; }
#preview-layers > video, #preview-layers > img { position: absolute; max-width: none; max-height: none; transform-origin: 50% 50%; pointer-events: auto; cursor: pointer; }
#preview-layers > .akari-photo-frame-overlay { position: absolute; box-sizing: border-box; pointer-events: none; }
#preview-layers > [data-akari-layer-id] { display: none; }
#preview-layers > [data-akari-deferred-telop-id] { position: absolute; inset: 0; display: none; place-items: center; pointer-events: none; }
#preview-stage[data-frame-engine-active="true"] #preview-video,
#preview-stage[data-frame-engine-active="true"] #standby-video,
#preview-stage[data-frame-engine-active="true"] #transition-video,
#preview-stage[data-frame-engine-active="true"] #transition-still,
#preview-stage[data-frame-engine-active="true"] #preview-still,
#preview-stage[data-frame-engine-active="true"] #preview-layers > [data-akari-layer-id],
#preview-stage[data-frame-engine-active="true"] #preview-layers > [data-akari-filter-id],
#preview-stage[data-frame-engine-active="true"] #preview-layers > [data-akari-deferred-telop-id],
#preview-stage[data-frame-engine-active="true"] .akari-video-fx-rail {
  visibility: hidden !important;
}
#preview-stage[data-frame-engine-active="true"] .akari-photo-frame-overlay { visibility: hidden !important; }
.akari-deferred-telop-placeholder__label { display: inline-flex; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid rgba(255,255,255,0.22); border-radius: 999px; background: rgba(20,20,20,0.82); color: #f2f2f2; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; box-shadow: 0 6px 22px rgba(0,0,0,0.35); }
.akari-deferred-telop-placeholder__label::before { content: ''; width: 13px; height: 13px; border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff; border-radius: 50%; animation: akari-deferred-telop-spin 0.8s linear infinite; }
@keyframes akari-deferred-telop-spin { to { transform: rotate(360deg); } }
#preview-layers > [data-akari-filter-id] { position: absolute; inset: 0; display: none; pointer-events: none; }
.akari-focus-pulse { animation: akari-focus-pulse-anim 1.6s ease-out; }
@keyframes akari-focus-pulse-anim {
    0% { box-shadow: 0 0 0 0 var(--akari-focus-pulse, var(--akari-accent)); }
    60% { box-shadow: 0 0 0 10px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
}
#layer-select-box { position: absolute; z-index: 1900; box-sizing: border-box; border: 1.5px solid #4da3ff; box-shadow: 0 0 0 1px rgba(0,0,0,0.35); pointer-events: none; display: none; }
#layer-select-box.is-active { display: block; pointer-events: auto; cursor: move; }
#layer-select-box .akari-layer-handle { position: absolute; width: 12px; height: 12px; margin: -6px; border: 1.5px solid #4da3ff; border-radius: 3px; background: #fff; pointer-events: auto; }
#layer-select-box .akari-layer-handle-nw { top: 0; left: 0; cursor: nwse-resize; }
#layer-select-box .akari-layer-handle-ne { top: 0; left: 100%; cursor: nesw-resize; }
#layer-select-box .akari-layer-handle-sw { top: 100%; left: 0; cursor: nesw-resize; }
#layer-select-box .akari-layer-handle-se { top: 100%; left: 100%; cursor: nwse-resize; }
#layer-select-box .akari-layer-handle-rotate { top: 0; left: 50%; margin-top: -34px; border-radius: 50%; cursor: grab; }
#layer-select-box .akari-layer-rotate-stem { position: absolute; top: -28px; left: 50%; width: 1.5px; height: 28px; background: #4da3ff; transform: translateX(-50%); pointer-events: none; }
/* 四辺中央の辺バー（クロップ）。cut / layer で同じ見た目・同じ操作にするため両 select box 共通で、
   角点の pointerdown ループ（[data-akari-handle]）へ紛れ込まないよう属性もクラスも別立てにする。
   枠の当該軸が 44px 未満のときは角点と衝突するので JS 側がクラスで隠す。 */
#layer-select-box .akari-crop-edge, #cut-select-box .akari-crop-edge { position: absolute; box-sizing: border-box; border: 1.5px solid #4da3ff; border-radius: 3px; background: #fff; pointer-events: auto; }
#layer-select-box .akari-crop-edge-n, #cut-select-box .akari-crop-edge-n { top: 0; left: 50%; width: 28px; height: 5px; margin: -2.5px 0 0 -14px; cursor: ns-resize; }
#layer-select-box .akari-crop-edge-s, #cut-select-box .akari-crop-edge-s { top: 100%; left: 50%; width: 28px; height: 5px; margin: -2.5px 0 0 -14px; cursor: ns-resize; }
#layer-select-box .akari-crop-edge-e, #cut-select-box .akari-crop-edge-e { top: 50%; left: 100%; width: 5px; height: 28px; margin: -14px 0 0 -2.5px; cursor: ew-resize; }
#layer-select-box .akari-crop-edge-w, #cut-select-box .akari-crop-edge-w { top: 50%; left: 0; width: 5px; height: 28px; margin: -14px 0 0 -2.5px; cursor: ew-resize; }
.akari-crop-edges-off .akari-crop-edge { display: none; }
.akari-crop-edges-hide-x .akari-crop-edge-n, .akari-crop-edges-hide-x .akari-crop-edge-s { display: none; }
.akari-crop-edges-hide-y .akari-crop-edge-e, .akari-crop-edges-hide-y .akari-crop-edge-w { display: none; }
#preview-chrome-layer[data-frame-engine-active="true"] #layer-select-box.is-active { pointer-events: auto; }
#preview-chrome-layer[data-frame-engine-active="true"] #layer-select-box.is-active .akari-crop-edge,
#preview-chrome-layer[data-frame-engine-active="true"] #layer-select-box.is-active .akari-layer-handle,
#preview-chrome-layer[data-frame-engine-active="true"] #layer-select-box.is-active .akari-layer-rotate-stem { pointer-events: auto; }
/* クロップモード: 移動/リサイズ/回転ハンドルと衝突しないよう select box 側の操作系だけ隠す
   （枠自体は #layer-crop-box が別枠として表示する）。 */
#layer-select-box.akari-crop-mode-hide-handles .akari-layer-handle,
#layer-select-box.akari-crop-mode-hide-handles .akari-crop-edge,
#cut-select-box.akari-crop-mode-hide-handles .akari-cut-handle,
#cut-select-box.akari-crop-mode-hide-handles .akari-crop-edge,
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
#photo-crop-controls { position: absolute; z-index: 1970; display: none; gap: 6px; align-items: center; flex-wrap: wrap; max-width: min(680px, 90%); padding: 8px; border: 1px solid #4da3ff; border-radius: 8px; background: rgba(20,20,20,.94); color: #fff; pointer-events: auto; }
#photo-crop-controls.is-active { display: flex; }
#photo-crop-controls button, #photo-crop-controls select, #photo-crop-controls input { color: #fff; background: #292f38; border: 1px solid #57616d; border-radius: 5px; padding: 4px; }
#photo-crop-controls input[type=number] { width: 55px; }
#layer-crop-box.is-photo-crop .akari-layer-crop-rect { pointer-events: auto; cursor: grab; }
#layer-crop-box.is-photo-crop .akari-layer-crop-handle { pointer-events: auto; }
#photo-crop-ghost { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; opacity: .25; display: none; pointer-events: none; }
#layer-crop-box.is-photo-crop #photo-crop-ghost { display: block; }
#layer-crop-box.is-photo-crop { overflow: visible; outline: none; }
#layer-crop-box.is-photo-crop #photo-crop-ghost { outline: 1px dashed rgba(255,255,255,.5); }
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
#cut-select-box .akari-cut-handle-rotate { top: 0; left: 50%; margin-top: -34px; border-radius: 50%; cursor: grab; }
#cut-select-box .akari-cut-rotate-stem { position: absolute; top: -28px; left: 50%; width: 1.5px; height: 28px; background: #4da3ff; transform: translateX(-50%); pointer-events: none; }
:root { --akari-caption-select-color: #4da3ff; }
#caption-select-box { position: absolute; z-index: 1900; box-sizing: border-box; border: 1.5px solid var(--akari-caption-select-color); box-shadow: 0 0 0 1px rgba(0,0,0,0.35); pointer-events: none; display: none; }
#caption-select-box.is-active { display: block; }
#caption-multi-select-boxes { position: absolute; inset: 0; z-index: 1899; pointer-events: none; }
.caption-multi-select-box { position: absolute; box-sizing: border-box; border: 1px dashed var(--akari-caption-select-color); box-shadow: 0 0 0 1px rgba(0,0,0,.35); pointer-events: none; }
#caption-select-box[data-alt-all] { border-style: dashed; }
#caption-select-box .akari-caption-select-tools { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(100% + 6px); display: flex; align-items: center; justify-content: center; flex-wrap: nowrap; width: max-content; gap: 2px; padding: 3px; border: 1px solid #333842; border-radius: 8px; background: rgba(24,26,31,.96); box-shadow: 0 4px 14px #0008; white-space: nowrap; pointer-events: auto; }
#caption-select-box[data-akari-run-from]:not([data-akari-run-from=""]) .akari-caption-select-tools { max-width: min(var(--akari-chrome-tools-max, 88vw), var(--akari-run-toolbar-max, 560px)); flex-wrap: wrap; justify-content: center; }
.akari-caption-tool-separator { width: 1px; height: 18px; margin: 0 3px; background: #333842; }
#caption-select-box [data-caption-optional-separator] { display: none; }
#caption-select-box [data-caption-optional-separator]:has(~ [data-akari-run-tool]:not([hidden]), ~ [data-caption-tool="reset"]:not([hidden])) { display: block; }
#caption-select-box [data-caption-tool] { position: relative; width: 28px; height: 28px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: #aab1bd; cursor: pointer; pointer-events: auto; }
#caption-select-box [data-caption-tool][hidden] { display: none; }
#caption-select-box [data-caption-tool]:hover { background: #2b2f38; color: #fff; }
#caption-select-box [data-caption-tool].on { background: #2d3b52; color: #bcdcff; }
#caption-select-box [data-caption-tool="snap"].on { box-shadow: inset 0 0 0 2px var(--akari-focus-pulse); }
#caption-select-box [data-caption-tool] svg { width: 16px; height: 16px; display: block; }
#caption-select-box [data-caption-tool="bold"] { font: 900 15px Georgia, serif; }
#caption-select-box [data-caption-tool="color"]::after { content: ''; position: absolute; left: 7px; right: 7px; bottom: 3px; height: 3px; border-radius: 2px; background: var(--caption-tool-color, #fff); }
#caption-select-box .akari-caption-tool-tip { display: none; position: absolute; z-index: 10; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%); padding: 5px 8px; border: 1px solid #333842; border-radius: 6px; background: #0b0c0e; color: #e6e6e6; font: 11px/1.45 sans-serif; white-space: nowrap; pointer-events: none; }
#caption-select-box [data-caption-tool]:hover .akari-caption-tool-tip, #caption-select-box [data-caption-tool]:focus-visible .akari-caption-tool-tip { display: block; }
#caption-select-box [data-caption-tool="reset"][hidden] { display: none; }
#caption-select-box [data-akari-run-tool][hidden], #caption-select-box [data-akari-run-menu][hidden] { display: none; }
#caption-select-box [data-akari-run-menu] { position:absolute; left:50%; transform:translateX(-50%); bottom:calc(100% + 43px); min-width:min(180px, var(--akari-chrome-tools-max, 180px)); max-width:var(--akari-chrome-tools-max, 88vw); max-height:240px; overflow:auto; padding:6px; border:1px solid #333842; border-radius:7px; background:#181a1f; color:#e6e6e6; pointer-events:auto; }
#caption-select-box [data-akari-run-menu] button { display:block; width:100%; padding:5px 8px; border:0; border-radius:4px; background:transparent; color:inherit; text-align:left; cursor:pointer; }
#caption-select-box [data-akari-run-menu] button:hover { background:#2b2f38; }
#caption-select-box [data-caption-palette] { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(100% + 43px); width: 214px; max-width: var(--akari-chrome-tools-max, 88vw); box-sizing: border-box; padding: 8px; border: 1px solid #333842; border-radius: 8px; background: rgba(24,26,31,.98); box-shadow: 0 8px 24px #000a; pointer-events: auto; }
#caption-select-box [data-caption-palette][hidden] { display: none; }
#caption-select-box .akari-caption-palette-tabs { display: flex; gap: 4px; margin-bottom: 7px; }
#caption-select-box [data-palette-tab] { flex: 1; border: 1px solid #333842; border-radius: 5px; background: transparent; color: #aab1bd; font: 11px sans-serif; cursor: pointer; }
#caption-select-box [data-palette-tab].on { background: #2b2f38; color: #fff; }
#caption-select-box .akari-caption-palette-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
#caption-select-box [data-color] { aspect-ratio: 1; border: 0; border-radius: 50%; cursor: pointer; box-shadow: inset 0 0 0 1px #ffffff55; }
#caption-select-box .akari-caption-palette-label { color: #8a8f98; font: 10px sans-serif; margin: 7px 0 4px; }
#caption-select-box [data-palette-more] { width: 100%; margin-top: 8px; padding: 5px; border: 1px dashed #4a5160; border-radius: 6px; background: transparent; color: #cfd5de; cursor: pointer; }
#caption-row-box { position: absolute; z-index: 1889; display: none; box-sizing: border-box; border: 1px dashed #f5c45199; pointer-events: none; }
#caption-row-box.is-active { display: block; }
#caption-row-box span { position: absolute; right: 3px; bottom: calc(100% + 2px); padding: 0 5px; border-radius: 3px; background: #000a; color: #f5c451; font-size: 10px; white-space: nowrap; }
#zone-hint-layer { position: absolute; inset: 0; pointer-events: none; z-index: 1870; }
.zone-hint-box { position: absolute; box-sizing: border-box; border: 1px dashed var(--akari-focus-pulse, var(--akari-accent)); background: var(--akari-focus-pulse, var(--akari-accent)); opacity: .18; }
#caption-zone-highlight { position: absolute; z-index: 1880; display: none; box-sizing: border-box; border: 1px dashed #4da3ff; background: rgba(77,163,255,.14); pointer-events: none; }
#caption-zone-highlight.is-active { display: block; }
#overlay-stage { position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px; overflow: hidden; pointer-events: none; }
#akari-gen-overlay { --akari-gen-inv-scale: 1; --akari-gen-band-space: 0px; position: absolute; pointer-events: none; z-index: 2100; overflow: hidden; box-sizing: border-box; }
#akari-gen-overlay *, #akari-gen-overlay *::before, #akari-gen-overlay *::after { pointer-events: none; }
#akari-gen-overlay[data-akari-gen-aurora="planned"] { border: 1.5px dashed rgba(160,170,200,.32); border-radius: 14px; }
#akari-gen-overlay[data-akari-gen-aurora="generating"] { border: 1.5px dashed rgba(160,170,200,.48); border-radius: 14px; }
#akari-gen-overlay[data-akari-gen-media="audio"] { border-radius: 12px; background: rgba(20,25,45,.76); }
#akari-gen-overlay[data-akari-gen-aurora]::before { content: ''; position: absolute; inset: 0; background: linear-gradient(150deg, rgba(111,120,240,.12), rgba(56,189,248,.09), rgba(192,132,252,.07)); }
#akari-gen-overlay[data-akari-gen-aurora="planned"]::before { opacity: 1; background: linear-gradient(150deg, rgba(111,120,240,.22), rgba(56,189,248,.17), rgba(192,132,252,.16)); }
#akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"]) { border: 1.5px dashed rgba(200,210,255,.55); }
#akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"])::before { z-index: 1; background-color: rgba(14,17,36,.96); background-image: linear-gradient(115deg, rgba(111,120,240,.55), rgba(56,189,248,.42) 45%, rgba(192,132,252,.50), rgba(111,120,240,.55)); }
#akari-gen-overlay[data-akari-gen-aurora="generating"]:not([data-akari-gen-media="audio"])::before { background-size: 300% 300%; }
#akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"]) #akari-gen-blur { z-index: 0; }
#akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"]) #akari-gen-pip, #akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"]) #akari-gen-shimmer, #akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"]) #akari-gen-icon, #akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"]) #akari-gen-tag, #akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"]) #akari-gen-band, #akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"]) #akari-gen-mask { z-index: 2; }
#akari-gen-icon { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: calc(36px * var(--akari-gen-inv-scale)); color: rgba(196,205,235,.9); text-shadow: 0 0 18px rgba(111,120,240,.4); }
#akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"]) #akari-gen-icon { font-size: calc(56px * var(--akari-gen-inv-scale)); color: #e9ecff; text-shadow: 0 0 18px rgba(111,120,240,.8); }
@keyframes akari-gen-pulse { 50% { opacity: .45; } }
#akari-gen-blur { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
#akari-gen-blur-image { width: 100%; height: 100%; object-fit: cover; filter: blur(18px) brightness(.65); transform: scale(1.06); pointer-events: none; }
#akari-gen-pip { position: absolute; right: calc(10px * var(--akari-gen-inv-scale)); bottom: calc((10px + var(--akari-gen-band-space)) * var(--akari-gen-inv-scale)); width: 22%; pointer-events: none; }
#akari-gen-pip-image { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: contain; background: rgba(0,0,0,.6); border-radius: 6px; border: 1px solid #A99AF2; box-sizing: border-box; pointer-events: none; }
#akari-gen-pip-label { display: block; margin-bottom: calc(4px * var(--akari-gen-inv-scale)); font: calc(12px * var(--akari-gen-inv-scale))/1.4 ui-monospace, Menlo, monospace; white-space: nowrap; color: #E6DFFF; text-shadow: 0 calc(1px * var(--akari-gen-inv-scale)) calc(3px * var(--akari-gen-inv-scale)) #000; }
#akari-gen-tag[data-akari-gen-severity="planned-video"] { border-color: #A99AF2; color: #E6DFFF; background: rgba(42,28,72,.8); }
#akari-gen-tag { position: absolute; left: calc(10px * var(--akari-gen-inv-scale)); top: calc(10px * var(--akari-gen-inv-scale)); font: calc(12px * var(--akari-gen-inv-scale))/1.4 ui-monospace, Menlo, monospace; padding: calc(2px * var(--akari-gen-inv-scale)) calc(8px * var(--akari-gen-inv-scale)); border-radius: calc(4px * var(--akari-gen-inv-scale)); background: rgba(0,0,0,.6); color: #DCE6EE; border: calc(1px * var(--akari-gen-inv-scale)) dashed #8FA3B4; box-sizing: border-box; min-height: calc(22px * var(--akari-gen-inv-scale)); max-width: calc(100% - 20px * var(--akari-gen-inv-scale)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"]) #akari-gen-tag { background: rgba(10,12,20,.72); }
#akari-gen-tag[data-akari-gen-severity="generating"] { border-color: #9da5f4; color: #d4ebff; }
#akari-gen-tag[data-akari-gen-severity="error"] { border-color: #D6402B; color: #D6402B; border-style: solid; }
#akari-gen-tag[data-akari-gen-severity="frames"] { border-color: #1F6F8B; color: #1F6F8B; }
#akari-gen-band { position: absolute; left: 0; right: 0; bottom: 0; height: calc(26px * var(--akari-gen-inv-scale)); box-sizing: border-box; background: rgba(0,0,0,.55); display: flex; align-items: center; gap: calc(8px * var(--akari-gen-inv-scale)); padding: 0 calc(10px * var(--akari-gen-inv-scale)); font: calc(12px * var(--akari-gen-inv-scale))/1.4 ui-monospace, Menlo, monospace; color: #d4ebff; }
#akari-gen-band-text { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#akari-gen-band-bar { flex: 1; min-width: calc(20px * var(--akari-gen-inv-scale)); height: calc(3px * var(--akari-gen-inv-scale)); background: rgba(255,255,255,.2); border-radius: calc(2px * var(--akari-gen-inv-scale)); overflow: hidden; }
#akari-gen-band-fill { display: block; height: 100%; background: linear-gradient(90deg, #6f78f0, #38bdf8, #c084fc); }
#akari-gen-shimmer { position: absolute; inset: 0; background: linear-gradient(115deg, transparent 38%, rgba(255,255,255,.05) 50%, transparent 62%); background-size: 250% 100%; }
#akari-gen-overlay[data-akari-gen-aurora]:not([data-akari-gen-media="audio"]) #akari-gen-shimmer { background: linear-gradient(115deg, transparent 38%, rgba(255,255,255,.12) 50%, transparent 62%); background-size: 250% 100%; }
@media (prefers-reduced-motion: no-preference) { #akari-gen-overlay[data-akari-gen-aurora="generating"]:not([data-akari-gen-media="audio"])::before { animation: akari-gen-drift 6s linear infinite; } #akari-gen-shimmer { animation: akari-gen-sh 5.5s ease-in-out infinite; } #akari-gen-overlay[data-akari-gen-aurora="generating"] #akari-gen-icon { animation: akari-gen-pulse 3.4s ease-in-out infinite; } }
@media (prefers-reduced-motion: reduce) { #akari-gen-overlay[data-akari-gen-aurora="generating"]:not([data-akari-gen-media="audio"])::before, #akari-gen-shimmer, #akari-gen-icon { animation: none; } }
@keyframes akari-gen-drift { from { background-position: 0% 50%; } to { background-position: 300% 50%; } }
@keyframes akari-gen-sh { from { background-position: 120% 0; } to { background-position: -120% 0; } }
#akari-gen-mask { position: absolute; box-sizing: border-box; border: 2px dashed #D6402B; border-radius: 3px; }
#akari-gen-mask-label { position: absolute; left: 0; top: calc(-18px * var(--akari-gen-inv-scale)); font: calc(12px * var(--akari-gen-inv-scale))/1.4 ui-monospace, Menlo, monospace; white-space: nowrap; color: #D6402B; }
#akari-gen-overlay[hidden], #akari-gen-overlay [hidden] { display: none; }
.akari-gen-extra { --akari-gen-inv-scale: 1; position: absolute; z-index: 2099; overflow: hidden; box-sizing: border-box; pointer-events: none; border: 1.5px dashed rgba(200,210,255,.55); border-radius: 14px; }
.akari-gen-extra:not([data-akari-gen-media="audio"])::before { content: ''; position: absolute; inset: 0; background-color: rgba(14,17,36,.96); background-image: linear-gradient(115deg, rgba(111,120,240,.55), rgba(56,189,248,.42) 45%, rgba(192,132,252,.50), rgba(111,120,240,.55)); }
.akari-gen-extra-icon { position: absolute; z-index: 2; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: calc(36px * var(--akari-gen-inv-scale)); color: #e9ecff; text-shadow: 0 0 18px rgba(111,120,240,.8); }
.akari-gen-extra:not([data-akari-gen-media="audio"]) .akari-gen-extra-icon { font-size: calc(56px * var(--akari-gen-inv-scale)); }
.akari-gen-extra-tag { position: absolute; z-index: 2; left: calc(10px * var(--akari-gen-inv-scale)); top: calc(10px * var(--akari-gen-inv-scale)); padding: calc(2px * var(--akari-gen-inv-scale)) calc(8px * var(--akari-gen-inv-scale)); border: calc(1px * var(--akari-gen-inv-scale)) dashed #8FA3B4; border-radius: calc(4px * var(--akari-gen-inv-scale)); background: rgba(10,12,20,.72); color: #DCE6EE; font: calc(12px * var(--akari-gen-inv-scale))/1.4 ui-monospace, Menlo, monospace; white-space: nowrap; }
.akari-gen-extra[data-akari-gen-media="audio"] { background: rgba(20,25,45,.76); }
.akari-gen-extra[data-akari-gen-media="audio"]::before { display: none; }
.akari-gen-extra .akari-gen-extra-icon, .akari-gen-extra .akari-gen-extra-tag { pointer-events: none; }
.akari-gen-extra[hidden] { display: none; }
#pen-layer { position: absolute; top: 0; left: 0; z-index: 2; pointer-events: none; }
#pen-layer.is-active { pointer-events: auto; cursor: crosshair; touch-action: none; }
#transition-plate { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
#transition-fallback-label { position: absolute; left: 50%; bottom: 7%; display: none; transform: translateX(-50%); padding: 6px 10px; border: 1px solid rgba(255,255,255,.45); border-radius: 999px; background: rgba(20,20,20,.82); color: #fff; font-size: 12px; font-weight: 600; white-space: nowrap; pointer-events: none; }
/* プレーン字幕 host の見た目は焼き込み既定（captions.mjs）とパリティ: 透明座布団 + 実ストローク縁取り。
   shrink-to-fit の形状と cursor: move はドラッグ当たり判定のため維持する。 */
#caption-plate { position:absolute; inset:0; pointer-events:none; }
.caption-row-plate { position: absolute; left: 50%; bottom: 7%; max-width: 92%; transform: translateX(-50%) rotate(var(--caption-rotate, 0deg)) scale(var(--caption-scale, 1)); transform-origin: center; padding: 0.08em 0.42em; border-radius: 10px; background: transparent; color: #fff; font-size: ${captionFontSize}px; font-weight: 700; line-height: 1.42; text-align: center; -webkit-text-stroke: 0.14em rgba(0,0,0,.9); paint-order: stroke fill; text-shadow: 0 2px 8px rgba(0,0,0,.35); white-space: pre-wrap; pointer-events: auto; cursor: move; user-select: none; }
.caption-row-plate:empty { display: none; }
.caption-row-plate.akari-caption-host--editing:empty { display: block; min-width: 1em; min-height: 1.42em; }
.caption-row-plate.akari-caption-host--styled { pointer-events: none; inset: 0; max-width: none; transform: none; padding: 0; border-radius: 0; background: none; text-shadow: none; white-space: normal; --caption-font-size: ${captionFontSize}px; }
.caption-row-plate[data-selected] .akari-caption__plate[data-akari-textanim], .caption-row-plate.akari-caption-host--editing .akari-caption__plate[data-akari-textanim] { animation: none !important; opacity: 1 !important; transform: none !important; clip-path: none !important; }
.caption-row-plate[data-output-caption] .akari-caption__plate { width: var(--caption-width, 92%); right: auto; }
.caption-row-plate[data-caption-sized-run][data-output-caption] .akari-caption__plate { width: var(--caption-width, max-content); right: var(--caption-right, 0); margin-inline: var(--caption-plate-margin, auto); }
.caption-row-plate[data-output-caption] .akari-caption__line, .caption-row-plate[data-output-caption] .akari-caption__block { max-width: none; flex-shrink: 0; }
.caption-row-plate[data-selected], .caption-row-plate.akari-caption-host--styled[data-selected] .akari-caption__plate { outline: none; }
#caption-select-box .akari-caption-handle-box { position:absolute;inset:0;pointer-events:none; }
#caption-select-box .akari-caption-handle { position:absolute;width:11px;height:11px;border-radius:50%;background:#fff;border:1px solid var(--akari-caption-select-color);box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:auto; }
#caption-select-box .akari-caption-handle[data-h="nw"] { left:-5px;top:-5px;cursor:nwse-resize; }
#caption-select-box .akari-caption-handle[data-h="ne"] { right:-5px;top:-5px;cursor:nesw-resize; }
#caption-select-box .akari-caption-handle[data-h="sw"] { left:-5px;bottom:-5px;cursor:nesw-resize; }
#caption-select-box .akari-caption-handle[data-h="se"] { right:-5px;bottom:-5px;cursor:nwse-resize; }
#caption-select-box .akari-caption-handle[data-h="e"], #caption-select-box .akari-caption-handle[data-h="w"] { top:50%;width:11px;height:20px;border:0;border-radius:0;background:transparent;box-shadow:none;transform:translateY(-50%);cursor:ew-resize; }
#caption-select-box .akari-caption-handle[data-h="e"] { right:-5px; }
#caption-select-box .akari-caption-handle[data-h="w"] { left:-5px; }
#caption-select-box .akari-caption-handle[data-h="e"]::after, #caption-select-box .akari-caption-handle[data-h="w"]::after { content:"";position:absolute;left:3px;top:3px;width:5px;height:14px;border-radius:3px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.35); }
#caption-select-box .akari-caption-handle[data-h="rot"], #caption-select-box .akari-caption-handle[data-h="move"] { top:calc(100% + 13px);width:25px;height:25px;display:grid;place-items:center;border-radius:50%;border:1px solid var(--akari-caption-select-color);background:var(--theia-editor-background, #252526);color:var(--theia-editor-foreground, #eee);font-size:0;cursor:grab; }
#caption-select-box .akari-caption-handle[data-h="rot"] { left:calc(50% - 27px); }
#caption-select-box .akari-caption-handle[data-h="move"] { left:calc(50% + 2px);cursor:move; }
#caption-select-box .akari-caption-handle[data-h="rot"]::after, #caption-select-box .akari-caption-handle[data-h="move"]::after { content:"";display:block;width:15px;height:15px;background:currentColor;mask-size:contain;mask-repeat:no-repeat;mask-position:center; }
#caption-select-box .akari-caption-handle[data-h="rot"]::after { mask-image:url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Cpath d="M19 7v5h-5M5 17v-5h5M19 12a7 7 0 0 0-12-5M5 12a7 7 0 0 0 12 5" fill="none" stroke="black" stroke-width="2"/%3E%3C/svg%3E'); }
#caption-select-box .akari-caption-handle[data-h="move"]::after { mask-image:url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Cpath d="M12 2v20M2 12h20M12 2 9 5m3-3 3 3m-3 17-3-3m3 3 3-3M2 12l3-3m-3 3 3 3m17-3-3-3m3 3-3 3" fill="none" stroke="black" stroke-width="2"/%3E%3C/svg%3E'); }
body.akari-caption-transforming .akari-caption-handle[data-h="rot"], body.akari-caption-transforming .akari-caption-handle[data-h="move"] { display:none; }
body.akari-caption-transforming #caption-select-box .akari-caption-select-tools { visibility:hidden; }
.caption-row-plate.akari-caption-host--editing, .caption-row-plate.akari-caption-host--editing * { cursor: text; user-select: text; }
.caption-row-plate.akari-caption-host--styled .akari-caption__line, .caption-row-plate.akari-caption-host--styled .akari-caption__block { pointer-events: auto; }
.caption-row-plate [data-akari-caption-editing="true"], .caption-row-plate[data-akari-caption-editing="true"] { pointer-events: auto; outline: none; caret-color: currentColor; }
.caption-row-plate.akari-caption-host--editing[data-selected], .caption-row-plate.akari-caption-host--editing[data-selected] .akari-caption__plate { outline: none; }
html.akari-gen-capturing [data-akari-caption-edit-hint] { display: none !important; }
.output-preview-link { position: absolute; top: 8px; left: 8px; z-index: 5; border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; padding: 5px 9px; background: rgba(20,20,20,0.78); color: #d8e9ff; font-size: 11px; line-height: 1.35; cursor: pointer; }
.output-preview-link:hover { color: #fff; background: rgba(45,45,45,0.9); }
.output-preview-link[hidden] { display: none; }
#zoom-minimap { position: absolute; right: 8px; bottom: 8px; z-index: 3; overflow: hidden; outline: 1px solid rgba(255,255,255,0.25); border-radius: 2px; background: rgba(0,0,0,0.55); pointer-events: none; }
#zoom-minimap[hidden] { display: none; }
#zoom-minimap-viewport { position: absolute; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.85); background: rgba(255,255,255,0.55); }
.message-card { position: absolute; inset: 0; z-index: 10; display: grid; gap: 16px; place-items: center; padding: 32px; background: #111; }
.message-card[hidden] { display: none; }
.message-card p { max-width: 520px; margin: 0; color: #e5e5e5; font-size: 15px; line-height: 1.7; text-align: center; }
.message-card-reload { border: 1px solid #505050; border-radius: 4px; padding: 8px 18px; background: #303030; color: #fff; font-size: 13px; cursor: pointer; }
.message-card-reload[hidden] { display: none; }
/* 全面の再生エラー／案内カード (z-index: 10) を最優先に保つ。リロード通知群は
   z-index: 8 の縦積み面へまとめ、互いに重ねず既存エラー表示も隠さない。 */
.reload-surface { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 8; display: flex; flex-direction: column; align-items: center; gap: 6px; width: min(92%, 760px); pointer-events: none; }
.reload-surface > * { position: static; transform: none; width: 100%; }
.reload-toast { padding: 8px 12px; border: 1px solid rgba(143, 211, 255, 0.5); border-radius: 6px; background: rgba(20, 45, 62, 0.9); color: #eef9ff; box-shadow: 0 4px 18px rgba(0,0,0,0.3); font-size: 12.5px; line-height: 1.5; }
.reload-toast[hidden] { display: none; }
.composite-error-banner { display: grid; gap: 2px; padding: 9px 12px; border: 1px solid #e5b85c; border-radius: 6px; background: rgba(69, 48, 12, 0.94); color: #fff7df; box-shadow: 0 4px 18px rgba(0,0,0,0.38); font-size: 12.5px; line-height: 1.45; }
.composite-error-banner[hidden] { display: none; }
.composite-error-banner strong { font-size: 12.5px; }
#composite-error-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reload-error-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 12px; align-items: center; padding: 11px 12px; border: 1px solid #ff8a8a; border-radius: 7px; background: rgba(74, 17, 23, 0.96); color: #fff4f4; box-shadow: 0 5px 20px rgba(0,0,0,0.46); font-size: 12.5px; line-height: 1.45; }
.reload-error-card[hidden] { display: none; }
.reload-error-card strong { min-width: 0; }
#reload-error-detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#reload-error-retry { grid-column: 2; grid-row: 1 / span 2; border: 1px solid rgba(255,255,255,0.55); border-radius: 4px; padding: 6px 12px; background: rgba(255,255,255,0.12); color: #fff; cursor: pointer; pointer-events: auto; }
.audio-status { color: var(--theia-descriptionForeground); font-size: 12px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.audio-status[hidden] { display: none; }
.audio-notice { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 4; display: flex; align-items: center; gap: 10px; max-width: 92%; padding: 8px 12px; border-radius: 6px; background: rgba(20, 20, 20, 0.78); color: #f1f1f1; font-size: 12.5px; line-height: 1.5; }
.audio-notice[hidden] { display: none; }
.audio-notice button { flex: none; border: none; background: transparent; color: #ccc; font-size: 14px; line-height: 1; cursor: pointer; padding: 2px 4px; }
.write-error-banner { position: absolute; ${kind === 'output' ? 'bottom: 0;' : 'top: 8px;'} left: 50%; transform: translateX(-50%); z-index: 2100; display: flex; align-items: flex-start; gap: 10px; width: min(92%, 680px); box-sizing: border-box; padding: 10px 12px; border: 1px solid #ff8a8a; border-radius: 6px; background: #4a1117; color: #fff4f4; box-shadow: 0 4px 18px rgba(0,0,0,0.45); font-size: 12.5px; line-height: 1.5; }
.write-error-banner[hidden] { display: none; }
.write-error-banner span { flex: 1; overflow-wrap: anywhere; }
.write-error-banner button { flex: none; border: none; background: transparent; color: #fff; font-size: 16px; line-height: 1; cursor: pointer; padding: 2px 4px; }
.transport { display: grid; gap: 0; padding: 0; background: var(--akari-transport-bg); color: var(--akari-transport-fg); }
.transport-seek { display: flex; width: 100%; margin: 0; order: -1; margin-top: 8px; }
.transport-seek #seek { width: 100%; margin: 0; }
:is(#seek, #zoom-slider, .akari-perspective-angle-row input[type=range]) { appearance: none; -webkit-appearance: none; height: 16px; min-width: 0; margin: 0; padding: 0; border: none; background: transparent; outline: none; box-shadow: none; cursor: pointer; --seek-progress: 0%; }
:is(#seek, #zoom-slider, .akari-perspective-angle-row input[type=range]):focus { outline: none; box-shadow: none; }
#seek:focus-visible { outline: none; box-shadow: none; }
:is(#zoom-slider, .akari-perspective-angle-row input[type=range]):focus-visible { outline: 2px solid var(--akari-accent); outline-offset: 2px; border-radius: 6px; }
:is(#seek, #zoom-slider, .akari-perspective-angle-row input[type=range])::-webkit-slider-runnable-track { height: 4px; border-radius: 999px; background: linear-gradient(to right, var(--akari-seek-played) var(--seek-progress), var(--akari-seek-track) 0); }
:is(#seek, #zoom-slider, .akari-perspective-angle-row input[type=range]):hover::-webkit-slider-runnable-track { height: 6px; }
:is(#seek, #zoom-slider, .akari-perspective-angle-row input[type=range])::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 12px; height: 12px; margin-top: -4px; border: 2px solid var(--akari-seek-played); border-radius: 50%; background: var(--akari-seek-thumb); box-shadow: none; }
:is(#seek, #zoom-slider, .akari-perspective-angle-row input[type=range]):hover::-webkit-slider-thumb { margin-top: -3px; }
:is(#seek, #zoom-slider, .akari-perspective-angle-row input[type=range]):active::-webkit-slider-thumb { transform: scale(1.15); }
.transport-controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; min-width: 0; height: 34px; padding: 0 10px 2px; box-sizing: border-box; gap: 6px; }
.transport-left, .transport-center, .transport-right { display: flex; align-items: center; gap: 6px; }
.transport-left { position: relative; min-width: 0; justify-self: start; }
.transport-center { justify-self: center; }
.transport-right { position: relative; justify-self: end; }
/* Capture-only presentation. Generation overlay implementation and exportLook preference stay untouched. */
html.akari-gen-capture-fit #zoom-layer { transform: none !important; }
html.akari-gen-capturing #preview-stage > :not(#preview-layers):not(#frame-engine-preview),
html.akari-gen-capturing [id^="akari-gen-"],
html.akari-gen-capturing .akari-gen-extra,
html.akari-gen-capturing [data-akari-interaction],
html.akari-gen-capturing #frame-engine-preview > :not(#frame-engine-canvas),
html.akari-gen-capturing #indicator-toggle,
html.akari-gen-capturing #indicator-popup,
html.akari-gen-capturing #zoom-minimap,
html.akari-gen-capturing #reload-surface,
html.akari-gen-capturing #audio-notice,
html.akari-gen-capturing #write-error-banner,
html.akari-gen-capturing .transport { visibility: hidden !important; }
html.akari-gen-capturing .akari-focus-pulse { animation: none !important; box-shadow: none !important; }
/* Selection decorations on content nodes must lose only their editing outline, not the content. */
html.akari-gen-capturing #caption-plate:is([data-selected], [data-alt-all]),
html.akari-gen-capturing #caption-plate:is([data-selected], [data-alt-all]) .akari-caption__plate,
html.akari-gen-capturing [data-akari-interaction-selected],
html.akari-gen-capturing [data-akari-interaction-editing="true"],
html.akari-gen-capturing [data-akari-caption-editing="true"] { outline: none !important; caret-color: transparent !important; }
html.akari-gen-capturing #caption-plate .akari-caption-handle-box,
html.akari-gen-capturing #caption-plate .akari-caption-handle,
html.akari-gen-capturing #preview-chrome-layer,
html.akari-gen-capturing #layer-select-box,
html.akari-gen-capturing #layer-crop-box,
html.akari-gen-capturing #cut-select-box,
html.akari-gen-capturing #caption-select-box,
html.akari-gen-capturing #caption-multi-select-boxes,
html.akari-gen-capturing [data-akari-handle],
html.akari-gen-capturing [data-akari-crop-handle],
html.akari-gen-capturing [data-akari-crop-edge] { visibility: hidden !important; }
html.akari-gen-capturing [data-akari-interaction-editing="true"]::selection,
html.akari-gen-capturing [data-akari-interaction-editing="true"] *::selection,
html.akari-gen-capturing #caption-plate::selection,
html.akari-gen-capturing #caption-plate *::selection { background: transparent !important; }
#akari-gen-capture-frame.akari-gen-capture-flash { box-shadow: 0 0 0 2px var(--akari-accent), 0 0 8px var(--akari-accent); }
.icon-button { display: inline-grid; place-items: center; width: 28px; height: 28px; border: none; border-radius: 6px; padding: 0; background: transparent; color: var(--akari-transport-fg); box-shadow: none; cursor: pointer; }
.icon-button[hidden] { display: none; }
.icon-button:disabled, .zoom-preset:disabled, .rate-preset:disabled { opacity: 0.4; cursor: default; }
.icon-button svg { width: 16px; height: 16px; fill: currentColor; stroke: currentColor; }
#play-toggle { width: 32px; height: 32px; }
.rate-button { width: auto; min-width: 36px; padding: 0 6px; font-variant-numeric: tabular-nums; }
#time-label { min-width: 104px; color: var(--akari-time-fg); font-size: 12px; font-variant-numeric: tabular-nums; text-align: left; }
.zoom-popup { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 20; width: 224px; border: none; border-radius: 6px; padding: 10px; background: var(--akari-transport-bg); color: var(--akari-transport-fg); box-shadow: none; }
.zoom-popup[hidden] { display: none; }
.zoom-popup-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; color: var(--akari-time-fg); font-size: 12px; }
#zoom-value { color: var(--akari-transport-fg); font-variant-numeric: tabular-nums; }
#rate-value { color: var(--akari-transport-fg); font-variant-numeric: tabular-nums; }
#zoom-slider { width: 100%; }
.zoom-presets { display: grid; grid-template-columns: repeat(4, 28px); justify-content: space-between; gap: 5px; margin-top: 8px; }
.zoom-preset { width: 28px; height: 28px; border: none; border-radius: 6px; padding: 0; background: transparent; color: var(--akari-transport-fg); font-size: 10px; box-shadow: none; cursor: pointer; }
.rate-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
.rate-preset { height: 28px; border: none; border-radius: 6px; padding: 0 4px; background: transparent; color: var(--akari-transport-fg); font-size: 11px; box-shadow: none; cursor: pointer; }
:is(.icon-button, .zoom-preset, .rate-preset):hover:not(:disabled) { background: var(--akari-control-hover); }
:is(.icon-button, .zoom-preset, .rate-preset)[aria-pressed="true"]:not(:disabled) { background: var(--akari-control-pressed); color: var(--akari-accent); box-shadow: none; }
:is(.icon-button, .zoom-preset, .rate-preset):active:not(:disabled) { background: var(--akari-control-active); }
:is(.icon-button, .zoom-preset, .rate-preset):focus { outline: none; box-shadow: none; }
:is(.icon-button, .zoom-preset, .rate-preset):focus-visible { outline: 2px solid var(--akari-accent); outline-offset: 2px; }
#indicator-toggle { display: inline-flex; align-items: center; position: absolute; top: 8px; right: 8px; z-index: 20; width: auto; height: 24px; padding: 0 8px; border-radius: 6px; background: var(--akari-badge-bg); color: var(--akari-badge-fg); font-size: 11px; white-space: nowrap; }
#indicator-toggle[hidden] { display: none; }
#indicator-popup { top: 36px; right: 8px; bottom: auto; max-width: calc(100% - 16px); font-size: 11px; line-height: 1.5; }
${previewSelectionHandlesStyle}
</style>
</head>
<body>
<main class="workspace">
  <section class="preview-pane" aria-label="動画プレビュー">
    <nav data-akari-ui="preview-scope-breadcrumb" aria-label="プレビューの階層" hidden></nav>
    <div id="preview-wrapper">${kind === 'raw' ? `<div class="akari-material-chip" id="material-chip"><span id="material-chip-name">${this.escapeHtml(videoUri.path.base)}</span><span id="material-chip-duration" hidden></span></div>` : ''}
      <div id="indicator-popup" class="zoom-popup transport-left" hidden></div>
      <button id="indicator-toggle" class="icon-button transport-left" type="button" aria-label="プレビュー未対応の項目" title="プレビュー未対応の項目" aria-expanded="false" hidden>ⓘ</button>
      <div id="zoom-layer">
        <div id="preview-stage">
          <div id="preview-layers">
            <video id="preview-video" data-akari-transition-role="outgoing"${frameEngineScripts || primaryIsStillImage || !videoSource ? '' : ` src="${this.escapeHtml(videoSource)}"`} preload="${frameEngineScripts ? 'none' : 'auto'}" crossorigin="anonymous"></video>
            <video id="standby-video" data-akari-playback-role="standby" preload="auto" crossorigin="anonymous"></video>
            <img id="preview-still" alt="" draggable="false">
            <video id="transition-video" data-akari-transition-role="incoming" preload="auto" crossorigin="anonymous"></video>
            <img id="transition-still" data-akari-transition-role="incoming-still" alt="" draggable="false">
            <div id="overlay-stage"><div id="transition-plate"></div><div id="transition-fallback-label"></div><div id="caption-plate"></div></div>
            <div id="akari-gen-overlay" aria-hidden="true" hidden>
              <div id="akari-gen-blur" hidden><img id="akari-gen-blur-image" alt=""></div>
              <div id="akari-gen-shimmer" hidden></div>
              <div id="akari-gen-icon" hidden>✦</div>
              <div id="akari-gen-mask" hidden><span id="akari-gen-mask-label">編集領域</span></div>
              <div id="akari-gen-tag" hidden></div>
              <div id="akari-gen-pip" hidden><span id="akari-gen-pip-label">最後の絵</span><img id="akari-gen-pip-image" alt=""></div>
              <div id="akari-gen-band" hidden><span id="akari-gen-band-text"></span><span id="akari-gen-band-bar"><i id="akari-gen-band-fill"></i></span></div>
            </div>
          </div>
          <div id="layer-select-box"><div class="akari-layer-handle akari-layer-handle-nw" data-akari-handle="nw"></div><div class="akari-layer-handle akari-layer-handle-ne" data-akari-handle="ne"></div><div class="akari-layer-handle akari-layer-handle-sw" data-akari-handle="sw"></div><div class="akari-layer-handle akari-layer-handle-se" data-akari-handle="se"></div><button type="button" class="akari-layer-handle akari-layer-handle-rotate" data-akari-handle="rotate" aria-label="回転" title="回転"></button><button type="button" class="akari-layer-handle akari-layer-handle-move" data-akari-handle="move" aria-label="移動" title="移動"></button><div class="akari-crop-edge akari-crop-edge-n akari-layer-handle akari-layer-handle-n" data-akari-crop-edge="n" role="button" aria-label="上を切り取る" title="上を切り取る"></div><div class="akari-crop-edge akari-crop-edge-e akari-layer-handle akari-layer-handle-e" data-akari-crop-edge="e" role="button" aria-label="右を切り取る" title="右を切り取る"></div><div class="akari-crop-edge akari-crop-edge-s akari-layer-handle akari-layer-handle-s" data-akari-crop-edge="s" role="button" aria-label="下を切り取る" title="下を切り取る"></div><div class="akari-crop-edge akari-crop-edge-w akari-layer-handle akari-layer-handle-w" data-akari-crop-edge="w" role="button" aria-label="左を切り取る" title="左を切り取る"></div></div>
          <div id="layer-crop-box"><img id="photo-crop-ghost" alt=""><div class="akari-layer-crop-rect"><div class="akari-layer-crop-handle akari-layer-crop-handle-nw" data-akari-crop-handle="nw"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-n" data-akari-crop-handle="n"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-ne" data-akari-crop-handle="ne"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-e" data-akari-crop-handle="e"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-se" data-akari-crop-handle="se"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-s" data-akari-crop-handle="s"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-sw" data-akari-crop-handle="sw"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-w" data-akari-crop-handle="w"></div></div></div>
          <div id="photo-crop-controls"><label>縦横比 <select data-photo-crop-ratio><option value="free">自由</option><option value="original">元の比</option><option value="1:1">1:1</option><option value="4:5">4:5</option><option value="5:4">5:4</option><option value="3:4">3:4</option><option value="4:3">4:3</option><option value="9:16">9:16</option><option value="16:9">16:9</option></select></label><label>回転 <input data-photo-crop-rotate type="number" min="-45" max="45" step="0.1" value="0">°</label><button type="button" data-photo-crop-auto>自動水平</button><button type="button" data-photo-crop-smart>スマート切り抜き</button><button type="button" disabled title="近日対応">拡張（近日）</button><span data-photo-crop-status aria-live="polite"></span><button type="button" data-photo-crop-done>確定</button><button type="button" data-photo-crop-cancel>取り消し</button></div>
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
          <div id="cut-select-box"><div class="akari-cut-handle akari-cut-handle-nw" data-akari-handle="nw"></div><div class="akari-cut-handle akari-cut-handle-ne" data-akari-handle="ne"></div><div class="akari-cut-handle akari-cut-handle-sw" data-akari-handle="sw"></div><div class="akari-cut-handle akari-cut-handle-se" data-akari-handle="se"></div><button type="button" class="akari-cut-handle akari-cut-handle-rotate" data-akari-handle="rotate" aria-label="回転" title="回転"></button><button type="button" class="akari-cut-handle akari-cut-handle-move" data-akari-handle="move" aria-label="移動" title="移動"></button><div class="akari-crop-edge akari-crop-edge-n" data-akari-crop-edge="n"></div><div class="akari-crop-edge akari-crop-edge-e" data-akari-crop-edge="e"></div><div class="akari-crop-edge akari-crop-edge-s" data-akari-crop-edge="s"></div><div class="akari-crop-edge akari-crop-edge-w" data-akari-crop-edge="w"></div></div>
          <div id="caption-zone-highlight"></div>
          <div id="zone-hint-layer"></div>
          <div id="caption-row-box"><span>折り返しの幅</span></div>
          <div id="caption-select-box"><div class="akari-caption-select-tools">
            <button type="button" data-caption-tool="group" aria-label="全字幕モード"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="3" rx="1"/><rect x="2" y="10" width="12" height="3" rx="1" opacity=".45"/></svg><span class="akari-caption-tool-tip">全字幕モード（Alt ドラッグでも操作）</span></button>
            <span class="akari-caption-tool-separator"></span>
            <button type="button" data-caption-tool="snap" class="on" aria-label="吸着" aria-pressed="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"/><path d="m5 8 4 4M12 15l4 4"/></svg><span class="akari-caption-tool-tip">吸着のオン・オフ</span></button>
            <button type="button" data-caption-tool="clamp" aria-label="はみ出し防止"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9V7h2M17 9V7h-2M7 15v2h2M17 15v2h-2"/></svg><span class="akari-caption-tool-tip">はみ出し防止のオン・オフ</span></button>
            <span class="akari-caption-tool-separator" data-caption-optional-separator></span>
            <button type="button" data-caption-tool="bold" hidden aria-label="太字">B<span class="akari-caption-tool-tip">太字のオン・オフ</span></button>
            <button type="button" data-caption-tool="color" hidden aria-label="色"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.1 2h1.8l4 10.5h-1.9l-1 2.8H6l-1 2.8H3.1L7.1 2zm-.5 6.2h2.8L8 4.4 6.6 8.2z"/></svg><span class="akari-caption-tool-tip">文字・縁取り・座布団の色</span></button>
            <button type="button" data-caption-tool="bigger" data-akari-run-tool="bigger" hidden aria-label="大きく"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19 11 5l7 14M6.5 14h9M20 5v8m-4-4h8"/></svg><span class="akari-caption-tool-tip">選択文字を大きく</span></button>
            <button type="button" data-caption-tool="smaller" data-akari-run-tool="smaller" hidden aria-label="小さく"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19 11 5l7 14M6.5 14h9M17 9h7"/></svg><span class="akari-caption-tool-tip">選択文字を小さく</span></button>
            <button type="button" data-caption-tool="up" data-akari-run-tool="up" hidden aria-label="上へ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20V4m-6 6 6-6 6 6M4 21h16"/></svg><span class="akari-caption-tool-tip">選択文字を上へ</span></button>
            <button type="button" data-caption-tool="down" data-akari-run-tool="down" hidden aria-label="下へ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m-6-6 6 6 6-6M4 3h16"/></svg><span class="akari-caption-tool-tip">選択文字を下へ</span></button>
            <button type="button" data-caption-tool="rotate-run" data-akari-run-tool="rotate" hidden aria-label="回転"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 11a8 8 0 1 1-3-6M20 3v6h-6"/></svg><span class="akari-caption-tool-tip">選択文字を 8° 回転</span></button>
            <button type="button" data-caption-tool="spacing-run" data-akari-run-tool="spacing" hidden aria-label="字間"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5v14m16-14v14M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3"/></svg><span class="akari-caption-tool-tip">選択文字の字間を広げる</span></button>
            <button type="button" data-caption-tool="run-style" data-akari-run-tool="style" hidden aria-label="スタイル"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/></svg><span class="akari-caption-tool-tip">選択文字にスタイルを当てる</span></button>
            <button type="button" data-caption-tool="run-role" data-akari-run-tool="role" hidden aria-label="役割"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h14v16H5zM8 9h8m-8 4h6"/></svg><span class="akari-caption-tool-tip">選択文字の役割</span></button>
            <button type="button" data-caption-tool="cushion" hidden aria-label="座布団"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2.5" y="6" width="19" height="12" rx="3" fill="currentColor" fill-opacity=".25"/><path d="M8 12h8"/></svg><span class="akari-caption-tool-tip">座布団を敷く・外す</span></button>
            <button type="button" data-caption-tool="reset" aria-label="既定に戻す" hidden><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 6.5A5 5 0 1 1 3 9M3 3v3.5h3.5"/></svg><span class="akari-caption-tool-tip">位置と大きさを既定に戻す</span></button>
            <button type="button" data-caption-tool="inspector" hidden aria-label="インスペクターを開く"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg><span class="akari-caption-tool-tip">インスペクターを開く</span></button>
            <button type="button" data-caption-tool="my-style-save" hidden data-akari-my-style-preview-save aria-label="マイスタイルに保存"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 17v3h16v-3"/></svg><span class="akari-caption-tool-tip">マイスタイルに保存</span></button>
          </div><div data-akari-run-menu hidden></div><div data-caption-palette hidden><div class="akari-caption-palette-tabs"><button type="button" data-palette-tab="text" class="on">文字</button><button type="button" data-palette-tab="stroke">縁取り</button><button type="button" data-palette-tab="background">座布団</button></div><div class="akari-caption-palette-grid" data-palette-colors></div><div class="akari-caption-palette-label">最近使った色</div><div class="akari-caption-palette-grid" data-palette-recent></div><button type="button" data-palette-more>他の色…</button></div></div>
          <canvas id="pen-layer" aria-hidden="true"></canvas>
        </div>
      </div>
      <button id="output-preview-link" class="output-preview-link" type="button"${model.relatedEditUri ? '' : ' hidden'}>合成は出力プレビューで確認（開く）</button>
      <div id="reload-surface" class="reload-surface">
        <div id="reload-toast" class="reload-toast" hidden role="status">edit.json を再読込しました（一時停止中）</div>
        <div id="composite-error-banner" class="composite-error-banner" hidden role="status">
          <strong>edit.json の合成情報を読めません — 素材のみ表示中</strong>
          <span id="composite-error-detail"></span>
        </div>
        <div id="reload-error-card" class="reload-error-card" hidden role="alert" aria-live="assertive">
          <strong>edit.json の再読込に失敗しました。プレビューは変更前の内容です。</strong>
          <span id="reload-error-detail"></span>
          <button id="reload-error-retry" type="button">再試行</button>
        </div>
      </div>
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
  <div class="transport-seek">
    <input id="seek" type="range" min="0" max="0" step="0.001" value="0" aria-label="再生位置">
  </div>
  <div class="transport-controls">
    <div class="transport-left">
      <button id="audio-meter-open" class="icon-button" type="button" aria-label="音声メーター" title="音声メーター"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h2m2-4v8m3-12v16m3-13v10m3-7v4m3-2h2" fill="none" stroke-width="2" stroke-linecap="round"/></svg></button>
      <span id="time-label">0:00 / 0:00</span>
      <span id="audio-status" class="audio-status" role="status" aria-live="polite" hidden></span>
    </div>
    <div class="transport-center">
      <button id="skip-back" class="icon-button" type="button" aria-label="10秒戻る" title="10秒戻る"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5V2L6.5 6 11 10V7a6 6 0 1 1-5.65 8H3.26A8 8 0 1 0 11 5Z"/><text x="8" y="17" fill="currentColor" stroke="none" font-size="7" font-family="system-ui,sans-serif" font-weight="700">10</text></svg></button>
      <button id="frame-back" class="icon-button" type="button" aria-label="1コマ戻る" title="1コマ戻る"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM18 5v14l-9-7z"/></svg></button>
      <button id="play-toggle" class="icon-button" type="button" aria-label="再生" title="再生" data-akari-onboarding-target="play-button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
      <button id="frame-forward" class="icon-button" type="button" aria-label="1コマ進む" title="1コマ進む"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM6 5v14l9-7z"/></svg></button>
      <button id="skip-forward" class="icon-button" type="button" aria-label="10秒進む" title="10秒進む"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5V2l4.5 4-4.5 4V7a6 6 0 1 0 5.65 8h2.09A8 8 0 1 1 13 5Z"/><text x="8" y="17" fill="currentColor" stroke="none" font-size="7" font-family="system-ui,sans-serif" font-weight="700">10</text></svg></button>
    </div>
    <div class="transport-right">
      <button id="akari-gen-capture-frame" class="icon-button" type="button" aria-label="今のコマを保存" title="今のコマを保存"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h4l2-3h6l2 3h4v14H3Z" fill="none" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="4" fill="none" stroke-width="2"/></svg></button>
      <button id="pen-toggle" class="icon-button" type="button" aria-label="ペン" title="ペン" aria-pressed="false" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19.5 8.5a2.12 2.12 0 0 0-3-3zM14.8 7.2l2 2M4 16l4 4"/></svg></button>
      <button id="caption-row-box-toggle" class="icon-button" type="button" aria-label="折り返しの幅を表示" title="折り返しの幅を表示" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"><rect x="3" y="5" width="18" height="14" rx="2"/></svg></button>
      <button id="rate-toggle" class="icon-button rate-button" type="button" aria-label="再生速度" title="再生速度" aria-expanded="false" data-akari-ui="preview:rate">1×</button>
      <button id="zoom-toggle" class="icon-button" type="button" aria-label="ズーム" title="ズーム" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke-width="2"/><path d="m15.5 15.5 5 5" fill="none" stroke-width="2" stroke-linecap="round"/></svg></button>
      <button id="fullscreen-toggle" class="icon-button" type="button" aria-label="全画面" title="全画面" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zm3 11h2v5h-5v-2h3zM9 18v2H4v-5h2v3z"/></svg></button>
      <div id="rate-popup" class="zoom-popup" hidden>
        <div class="zoom-popup-header"><span>再生速度</span><span id="rate-value">1×</span></div>
        <div class="rate-presets">
          <button class="rate-preset" type="button" data-rate="0.5" data-akari-ui="preview:rate:0.5" aria-pressed="false">0.5×</button>
          <button class="rate-preset" type="button" data-rate="0.75" data-akari-ui="preview:rate:0.75" aria-pressed="false">0.75×</button>
          <button class="rate-preset" type="button" data-rate="1" data-akari-ui="preview:rate:1" aria-pressed="true">1×</button>
          <button class="rate-preset" type="button" data-rate="1.25" data-akari-ui="preview:rate:1.25" aria-pressed="false">1.25×</button>
          <button class="rate-preset" type="button" data-rate="1.5" data-akari-ui="preview:rate:1.5" aria-pressed="false">1.5×</button>
          <button class="rate-preset" type="button" data-rate="2" data-akari-ui="preview:rate:2" aria-pressed="false">2×</button>
          <button class="rate-preset" type="button" data-rate="3" data-akari-ui="preview:rate:3" aria-pressed="false">3×</button>
        </div>
      </div>
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
<script>${hostAdapterScript()}</script>
${this.externalScriptTag(assets.threeJavaScriptUrl)}
${threeTextRuntimeScript}${this.externalScriptTag(assets.threeRuntimeJavaScriptUrl)}
${this.externalScriptTag(assets.videoFxJavaScriptUrl)}
${this.externalScriptTag(assets.runtimeJavaScriptUrl)}
${this.externalScriptTag(assets.interactionJavaScriptUrl)}
${this.externalScriptTag(assets.webviewKernelJavaScriptUrl)}
${assets.scrubAudioJavaScriptUrl ? `${this.externalScriptTag(assets.scrubAudioJavaScriptUrl)}\n` : ''}<script>${previewBootstrapScript()}</script>
${kind === 'output' ? `<script>${previewContextBarPageScript}</script>\n` : ''}${kind === 'raw' ? `<script>
(() => {
    try {
        let attempts = 0;
        const timer = setInterval(() => {
            try {
                attempts += 1;
                const clockDuration = window.akari?.frameEngineClock?.totalDuration;
                const videoDuration = document.getElementById('preview-video')?.duration;
                const duration = Number.isFinite(clockDuration) && clockDuration > 0 ? clockDuration : videoDuration;
                if (Number.isFinite(duration) && duration > 0) {
                    const totalSeconds = Math.floor(duration);
                    const hours = Math.floor(totalSeconds / 3600);
                    const minutes = Math.floor(totalSeconds / 60) % 60;
                    const seconds = String(totalSeconds % 60).padStart(2, '0');
                    const text = hours > 0 ? hours + ':' + String(minutes).padStart(2, '0') + ':' + seconds
                        : minutes + ':' + seconds;
                    const label = document.getElementById('material-chip-duration');
                    if (label) {
                        label.textContent = ' · ' + text;
                        label.hidden = false;
                    }
                    clearInterval(timer);
                } else if (attempts >= 40) {
                    clearInterval(timer);
                }
            } catch {
                clearInterval(timer);
            }
        }, 250);
    } catch { /* The filename chip remains usable without duration metadata. */ }
})();
</script>` : ''}${frameEngineScripts}<script>${previewDiagnosticsTailScript()}</script>
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

    /** Pair messages by page and request, including restoration before the slower node write. */
    protected async capturePreviewFrame(widget: PreviewWidgetMarker, request: PreviewFrameRequestMessage): Promise<string | undefined> {
        const pageId = widget.akariPreviewPlaybackPageId;
        if (request.pageId !== pageId || typeof request.requestId !== 'string') return;
        const send = (type: PreviewFrameCommand['type'], options: { keepFrozen?: boolean; success?: boolean } = {}): void => {
            widget.sendMessage({ type, requestId: request.requestId, pageId, ...options } satisfies PreviewFrameCommand);
        };
        if (widget.akariPreviewFrameCaptureRequest) {
            send('akari-preview-capture-restore');
            void this.messages.error('コマを保存できませんでした: 前のコマを保存中です');
            return;
        }
        widget.akariPreviewFrameCaptureRequest = request.requestId;
        let subscription: Disposable | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let captureId: number | undefined;
        let success = false;
        let savedPath: string | undefined;
        try {
            const editUri = widget.akariPreviewEditUri;
            if (!editUri || !widget.akariPreviewSummary) throw new Error('出力プレビューでコマを保存してください');
            if (!window.electronAkariPreview?.capturePreviewFrame) throw new Error('Electron の撮影機能が利用できません');
            const output = { ...widget.akariPreviewSummary.output };
            success = await runPreviewFrameCaptureAttempts({
                max: 3,
                attempt: async () => {
                    let acceptingCapture = true;
                    const ready = await new Promise<PreviewFrameReadyMessage>((resolve, reject) => {
                        subscription = widget.onMessage(message => {
                            if (message?.type === 'akari-preview-capture-ready' && message.requestId === request.requestId
                                && message.pageId === pageId) resolve(message);
                        });
                        timer = setTimeout(() => reject(new Error('撮影準備がタイムアウトしました')), 5000);
                        send('akari-preview-capture-prepare');
                    });
                    clearTimeout(timer);
                    subscription.dispose();
                    if (ready.error) throw new Error(ready.error);
                    if (widget.isDisposed || widget.akariPreviewPlaybackPageId !== pageId) throw new Error('プレビューが更新されました');
                    const frame = widget.node.querySelector('iframe.webview') as HTMLIFrameElement;
                    if (!frame || !ready.rect || !ready.viewport || !ready.expectations || !Number.isFinite(ready.time)) throw new Error('撮影矩形を取得できません');
                    const outer = frame.getBoundingClientRect();
                    const sx = outer.width / frame.offsetWidth, sy = outer.height / frame.offsetHeight;
                    if (!(sx > 0 && sy > 0) || Math.abs(frame.clientWidth - ready.viewport.width) > 1
                        || Math.abs(frame.clientHeight - ready.viewport.height) > 1) throw new Error('プレビューのサイズが変わりました。もう一度お試しください');
                    // Inner viewport -> outer iframe content -> main renderer CSS viewport.
                    const rect = { x: outer.x + (frame.clientLeft + ready.rect.x) * sx,
                        y: outer.y + (frame.clientTop + ready.rect.y) * sy,
                        width: ready.rect.width * sx, height: ready.rect.height * sy };
                    const sentinel = ready.sentinel ? { x: outer.x + (frame.clientLeft + ready.sentinel.x) * sx,
                        y: outer.y + (frame.clientTop + ready.sentinel.y) * sy,
                        width: ready.sentinel.width * sx, height: ready.sentinel.height * sy } : undefined;
                    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > window.innerWidth
                        || rect.y + rect.height > window.innerHeight) throw new Error('プレビューがウィンドウから切れています');
                    try {
                        const snapshot = await Promise.race([
                            window.electronAkariPreview.capturePreviewFrame({ rect, sentinel, output, expectations: ready.expectations }).then(value => {
                                if (!acceptingCapture) {
                                    void window.electronAkariPreview.finishPreviewFrame(value.captureId, true).catch(() => undefined);
                                    throw new Error('撮影がタイムアウトしました');
                                }
                                return value;
                            }),
                            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('撮影がタイムアウトしました')), 3000); })
                        ]);
                        captureId = snapshot.captureId;
                    } finally {
                        acceptingCapture = false;
                        clearTimeout(timer);
                        // The phase-1 reply is only a handle. Restore before readback copy, resize and PNG encoding.
                        await new Promise<void>((resolve, reject) => {
                            const restored = widget.onMessage(message => {
                                if (message?.type !== 'akari-preview-capture-restored' || message.requestId !== request.requestId
                                    || message.pageId !== pageId) return;
                                clearTimeout(timer);
                                restored.dispose();
                                resolve();
                            });
                            timer = setTimeout(() => {
                                restored.dispose();
                                reject(new Error('撮影後の表示復元を確認できませんでした'));
                            }, 1000);
                            send('akari-preview-capture-restore', { keepFrozen: true });
                        });
                    }
                    if (widget.isDisposed || widget.akariPreviewPlaybackPageId !== pageId) throw new Error('プレビューが更新されました');
                    const captured = await window.electronAkariPreview.finishPreviewFrame(captureId);
                    captureId = undefined;
                    if (!captured) throw new Error('撮影画像を取得できません');
                    return { captured, time: ready.time! };
                },
                inspect: frame => {
                    const inspection = frame.captured.inspection;
                    if (!inspection.ok) console.warn('[akari-preview] frame capture rejected: ' + inspection.reasons.join(', '));
                    return inspection;
                },
                save: async ({ captured, time }) => {
                    const saved = await this.previewService.savePreviewFrame({ editUri: editUri.toString(), time, image: captured.image,
                        workspaceRoots: await this.currentWorkspaceRoots() });
                    savedPath = saved.path;
                    void this.messages.info('コマを保存しました: ' + saved.path, { timeout: 3000 });
                    if (captured.reduced) void this.messages.info(
                        '表示サイズが出力より小さいため、拡大せず ' + captured.width + '×' + captured.height + ' px で保存しました', { timeout: 3000 });
                },
                notify: message => { void this.messages.error(message); }
            });
        } catch (error) {
            void this.messages.error('コマを保存できませんでした: ' + (error instanceof Error ? error.message : String(error)));
        } finally {
            clearTimeout(timer);
            subscription?.dispose();
            if (captureId !== undefined) void window.electronAkariPreview.finishPreviewFrame(captureId, true).catch(() => undefined);
            widget.akariPreviewFrameCaptureRequest = undefined;
            send('akari-preview-capture-restore', { success });
        }
        return savedPath;
    }







    protected async currentWorkspaceRoots(): Promise<string[]> {
        try {
            return (await this.workspaceService.roots).map(root => root.resource.toString());
        } catch {
            return [];
        }
    }

    protected clearVideoCandidatePreview(key: string, itemId?: string): void {
        const active = this.videoCandidatePreviews.get(key);
        if (!active || itemId && active.itemId !== itemId) return;
        this.videoCandidatePreviews.delete(key);
        if (active.audioTimer) clearTimeout(active.audioTimer);
        if (active.videoStreamId) void this.disposeVideoStreamId(active.videoStreamId);
        if (active.audioStreamId) void this.disposeAssetStreams([active.audioStreamId]);
        if (!active.widget.isDisposed) active.widget.sendMessage({ type: 'akari-preview-video-candidate', itemId: active.itemId, clear: true });
    }

    protected async showVideoCandidatePreview(key: string, detail: { itemId: string; relativePath: string;
        inSeconds: number; outSeconds: number; freeze?: { atSeconds: number; durationSeconds: number } }): Promise<void> {
        this.clearVideoCandidatePreview(key);
        const widget = this.openOutputPreviews.get(key);
        if (!widget || widget.isDisposed || !widget.akariPreviewEditUri) return;
        const active = { widget, itemId: detail.itemId } as {
            widget: PreviewWidgetMarker; itemId: string; videoStreamId?: string; audioStreamId?: string;
            audioTimer?: ReturnType<typeof setTimeout>;
        };
        this.videoCandidatePreviews.set(key, active);
        const current = (): boolean => this.videoCandidatePreviews.get(key) === active && !widget.isDisposed;
        const root = widget.akariPreviewEditUri.parent.normalizePath();
        try {
            // The backend resolves real paths and rejects escaping symlinks. Its library fallback
            // may be outside the project, so the returned real path is checked again here.
            const resolved = await this.previewService.resolveProjectAssetUri({
                projectRootUri: root.toString(), declaredPath: detail.relativePath,
                workspaceRoots: await this.currentWorkspaceRoots()
            });
            if (!current()) return;
            if (!resolved) { this.clearVideoCandidatePreview(key, detail.itemId); return; }
            const videoUri = new URI(resolved).normalizePath();
            const rootPath = root.path.toString().replace(/\/$/u, '');
            if (videoUri.scheme !== root.scheme || videoUri.authority !== root.authority
                || !videoUri.path.toString().startsWith(rootPath + '/')) {
                this.clearVideoCandidatePreview(key, detail.itemId);
                return;
            }
            const stream = await this.createVideoStream({ videoUri: videoUri.toString() });
            if (!current()) { await this.disposeVideoStreamId(stream.id); return; }
            active.videoStreamId = stream.id;
            widget.sendMessage({ type: 'akari-preview-video-candidate', itemId: detail.itemId,
                relativePath: detail.relativePath, url: stream.url,
                inSeconds: detail.inSeconds, outSeconds: detail.outSeconds,
                freeze: detail.freeze ?? null });
            const request: PreviewAudioSidecarRequest = { sourceUri: videoUri.toString(),
                projectRootUri: root.toString(), inSec: 0, outSec: detail.outSeconds,
                speed: 1, padBeforeSec: 0, padAfterSec: 0, format: 'flac' };
            const poll = async (): Promise<void> => {
                if (!current()) return;
                try {
                    const result = await (this.previewService as AkariPreviewService & PreviewAudioService)
                        .requestPreviewAudioSidecar(request);
                    if (!current()) {
                        if (result.stream) await this.disposeAssetStreams([result.stream.id]);
                        return;
                    }
                    if (result.state === 'queued' || result.state === 'generating') {
                        active.audioTimer = setTimeout(() => void poll(), 1000);
                    } else if (result.state === 'ready' && result.stream) {
                        active.audioStreamId = result.stream.id;
                        widget.sendMessage({ type: 'akari-preview-video-candidate-audio', itemId: detail.itemId,
                            relativePath: detail.relativePath, url: result.stream.url });
                    }
                } catch (error) {
                    console.warn('[akari-preview] candidate audio sidecar unavailable', error);
                }
            };
            void poll();
        } catch (error) {
            console.warn('[akari-preview] video candidate unavailable', error);
            if (current()) this.clearVideoCandidatePreview(key, detail.itemId);
        }
    }

    protected async createVideoStream(request: VideoStreamRequest): Promise<VideoStreamReference> {
        return this.previewService.createVideoStream({
            ...request,
            workspaceRoots: await this.currentWorkspaceRoots()
        });
    }

    protected async createAssetStream(request: AssetStreamRequest): Promise<VideoStreamReference> {
        return this.previewService.createAssetStream({
            ...request,
            workspaceRoots: await this.currentWorkspaceRoots()
        });
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
        for (const [key, active] of this.videoCandidatePreviews) {
            if (active.widget === widget) this.clearVideoCandidatePreview(key);
        }
        const rawAudio = widget.akariPreviewRawAudio;
        if (rawAudio?.timer) clearTimeout(rawAudio.timer);
        widget.akariPreviewRawAudio = undefined;
        const assetIds = widget.akariPreviewAssetStreamIds ?? [];
        widget.akariPreviewAssetStreamIds = [];
        const extraIds = widget.akariPreviewExtraStreamIds ?? [];
        widget.akariPreviewExtraStreamIds = [];
        await Promise.all([
            this.disposeVideoStream(widget),
            ...extraIds.map(id => this.disposeVideoStreamId(id)),
            this.disposeAssetStreams(assetIds)
        ]);
    }

    protected readText(uri: URI): Promise<string> {
        return this.fileService.readFile(uri).then(content => content.value.toString());
    }

    protected transform(value: any): OverlayTransform {
        return {
            x: this.finiteNumber(value?.x, 0),
            y: this.finiteNumber(value?.y, 0),
            scale: this.finiteNumber(value?.scale, 1),
            ...previewTransformAxes(value),
            rotate: this.finiteNumber(value?.rotate, 0)
        };
    }

    protected stringRecord(value: unknown): Record<string, string> {
        return Object.fromEntries(Object.entries(objectRecord(value)).map(([key, item]) => [key, String(item)]));
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
    protected async resolveEditAssetUri(pathValue: string, editUri: URI): Promise<URI> {
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
            default: {
                if (!pathValue.replace(/\\/g, '/').startsWith('assets/')) return editUri.parent.resolve(pathValue);
                const resolved = await this.previewService.resolveProjectAssetUri({
                    projectRootUri: editUri.parent.toString(), declaredPath: pathValue,
                    workspaceRoots: await this.currentWorkspaceRoots()
                });
                return resolved ? new URI(resolved) : editUri.parent.resolve(pathValue);
            }
        }
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

    // src 付き <script> は同期実行（async / defer なし）なので、インライン <script> と混在しても
    // 文書順で実行される。three → runtime → kernel → bootstrap の順序はそのまま保たれる。
    protected externalScriptTag(url: string): string {
        return `<script src="${this.escapeHtml(url)}"></script>`;
    }

    protected inlineStyle(value: string): string {
        return value.replace(/<\/style/gi, '<\\/style');
    }

    protected queueGenerationUpdate(widget: PreviewWidgetMarker): void {
        const previous = widget.akariPreviewGenerationUpdate ?? Promise.resolve();
        widget.akariPreviewGenerationUpdate = previous.then(async () => {
            await widget.akariPreviewRefresh;
            if (widget.isDisposed) return;
            await this.sendGenerationUpdate(widget);
        }).catch(error => console.error('[akari-preview] failed to update generation sidecars', error));
    }

    protected async sendGenerationUpdate(widget: PreviewWidgetMarker): Promise<void> {
        const editUri = widget.akariPreviewEditUri;
        const summary = widget.akariPreviewSummary;
        const disposed = (): boolean => {
            if (!widget.isDisposed) return false;
            console.warn('[akari-preview] generation update discarded: widget disposed');
            return true;
        };
        if (disposed()) return;
        if (!editUri || !summary) {
            console.warn('[akari-preview] generation update unavailable: edit URI or summary not ready');
            return;
        }
        try {
            const sidecars = await this.previewService.readGenerationSidecars({
                editUri: editUri.toString(),
                workspaceRoots: await this.currentWorkspaceRoots()
            });
            if (disposed()) return;
            // 音の空の枠と V2 以上の media layer は cuts に無い。素材パスは生 edit から読む。
            const audioFrames: Array<{ id: string; name: string; start: number; end: number;
                sourcePath: string; meta: GenerationMetaV1 | null; binding: unknown;
                transform: null; crop: null; kind: 'audio' }> = [];
            const layerSources = new Map<string, { sourcePath: string; name?: string }>();
            try {
                const raw = JSON.parse((await this.fileService.readFile(editUri)).value.toString()) as {
                    output?: { fps?: number }; sources?: Array<{ id?: string; path?: string }>;
                    tracks?: Array<{ lane?: string; hidden?: boolean; items?: Array<{ id?: string; name?: string;
                        at?: number; duration?: number; source?: { kind?: string; src?: string; path?: string } }> }>;
                };
                const fps = Number(raw.output?.fps) || 30;
                const sourcePaths = new Map((raw.sources ?? []).filter(source => source.id && source.path)
                    .map(source => [source.id!, source.path!]));
                for (const track of raw.tracks ?? []) {
                    if (track.hidden === true) continue;
                    for (const item of track.items ?? []) {
                        if (item.source?.kind !== 'media') continue;
                        const sourcePath = item.source.path ?? sourcePaths.get(item.source.src ?? '');
                        if (track.lane === 'visual' && item.id && sourcePath) {
                            layerSources.set(item.id, { sourcePath, name: item.name });
                        }
                        if (track.lane !== 'audio') continue;
                        if (!Number.isFinite(item.at) || !Number.isFinite(item.duration)) continue;
                        if (!sourcePath) continue;
                        const generation = selectGenerationSidecarForSource(sourcePath,
                            sidecars.entries.map(entry => ({ sourcePath: entry.sourcePath,
                                meta: entry.meta as GenerationMetaV1 | null, binding: entry.binding })), Date.now());
                        if (generation?.meta?.kind !== 'audio') continue;
                        audioFrames.push({ id: item.id ?? sourcePath, name: item.name ?? item.id ?? '音の空の枠',
                            start: item.at! / fps, end: (item.at! + item.duration!) / fps,
                            sourcePath, meta: generation.meta, binding: generation.binding ?? null,
                            transform: null, crop: null, kind: 'audio' });
                    }
                }
            } catch { /* 旧形式や読み込み中でも映像の生成表示を続ける。 */ }
            // summary は音声更新でも置き換わる。参照一致を送信条件にせず、その時点の表示配置を使う。
            const describeClips = () => {
                const latest = widget.akariPreviewSummary ?? summary;
                const nowMs = Date.now();
                const entries = sidecars.entries.map(entry => ({ sourcePath: entry.sourcePath,
                    meta: entry.meta as GenerationMetaV1 | null, binding: entry.binding }));
                const segments = this.previewCaptionTimelineSegments(latest.cuts, latest.output.fps);
                const visualClips = segments.flatMap(segment => {
                    if (segment.kind !== 'src' || segment.cutIndex === null) return [];
                    const cut = latest.cuts[segment.cutIndex];
                    if (!cut) return [];
                    const sourcePath = cut.sourcePath ?? '';
                    const generation = selectGenerationSidecarForSource(sourcePath, entries, nowMs);
                    return [{
                        id: cut.id,
                        name: sidecars.itemNames[cut.id] ?? cut.id,
                        start: segment.outStart,
                        end: segment.outEnd,
                        sourcePath,
                        transform: cut.transform ?? null,
                        crop: cut.crop ?? null,
                        meta: generation?.meta ?? null,
                        binding: generation?.binding ?? null,
                        order: latest.itemStackZ?.[cut.id] ?? latest.trackStackZ?.[cut.trackId] ?? cut.renderTrack
                    }];
                });
                const hiddenLayers = new Set(widget.akariPreviewHiddenTracksByScope?.layers ?? []);
                const hiddenTracks = widget.akariPreviewHiddenTracks ?? new Set<number>();
                const layerClips = (latest.layers ?? []).flatMap(layer => {
                    const source = layerSources.get(layer.id);
                    if (layer.kind !== 'video' || !source || hiddenLayers.has(layer.track)
                        || hiddenTracks.has(layer.track)
                        || latest.tracks?.layers?.some(track => track.ref === layer.track && track.hidden === true)) return [];
                    const generation = selectGenerationSidecarForSource(source.sourcePath, entries, nowMs);
                    if (resolveGenerationState(generation?.meta, nowMs, generation?.binding) === 'none') return [];
                    return [{ id: layer.id, name: sidecars.itemNames[layer.id] ?? source.name ?? layer.id,
                        start: layer.t, end: layer.t + layer.duration, sourcePath: source.sourcePath,
                        transform: layer.transform ?? null, crop: layer.crop ?? null,
                        meta: generation?.meta ?? null, binding: generation?.binding ?? null,
                        kind: 'layer' as const,
                        order: latest.itemStackZ?.[layer.id] ?? latest.trackStackZ?.[layer.trackId]
                            ?? layer.renderTrack ?? layer.track }];
                });
                // find() の先頭が表示対象。映像は実際の積層 z の降順にする。
                const orderedVisualClips = [...visualClips, ...layerClips]
                    .sort((a, b) => b.order - a.order)
                    .map(({ order: _order, ...clip }) => clip);
                return [...audioFrames.filter(frame => resolveGenerationState(frame.meta, Date.now(), frame.binding) === 'generating'),
                    ...orderedVisualClips, ...audioFrames.filter(frame => resolveGenerationState(frame.meta, Date.now(), frame.binding) !== 'generating')];
            };
            const clips = describeClips();
            // 画像の失敗・読み込みとの競合・遅延で既存の小札や帯まで止めない。
            widget.sendMessage({
                type: 'akari-preview-generation-update',
                clips: clips.map(clip => ({ ...clip, pipUri: null, blurBackgroundUri: null })),
                exportLook: this.preferences.get<boolean>('akari.preview.exportLook', false) === true
            });

            // Map の作成と差し替えは読み込み側に任せる。取得した stream は送信直前まで
            // この呼び出しで所有し、読み込み側の所有リストを跨いだ場合は全て破棄する。
            const assetUrls = widget.akariPreviewAssetUrlByUri;
            const assetIds = widget.akariPreviewAssetStreamIds;
            const refresh = widget.akariPreviewRefresh;
            const acquired: Array<{ assetUri: string; id: string; url: string }> = [];
            const images: Array<{ path: string; url: string | null }> = [];
            const imageContextChanged = (): boolean => widget.akariPreviewAssetUrlByUri !== assetUrls
                || widget.akariPreviewAssetStreamIds !== assetIds || widget.akariPreviewRefresh !== refresh;
            const resolveImage = async (path: string | null | undefined): Promise<void> => {
                if (!path || images.some(image => image.path === path)) return;
                if (widget.isDisposed || imageContextChanged()) {
                    console.warn('[akari-preview] generation image unavailable: preview changed or disposed', path);
                    images.push({ path, url: null });
                    return;
                }
                try {
                    const assetUri = (await this.resolveEditAssetUri(path, editUri)).toString();
                    const known = assetUrls?.get(assetUri) ?? acquired.find(stream => stream.assetUri === assetUri)?.url;
                    if (known) {
                        images.push({ path, url: known });
                        return;
                    }
                    const stream = await this.createAssetStream({ assetUri });
                    acquired.push({ assetUri, id: stream.id, url: stream.url });
                    images.push({ path, url: stream.url });
                } catch (error) {
                    console.warn('[akari-preview] generation image could not be resolved', path, error);
                    images.push({ path, url: null });
                }
            };
            try {
                for (const clip of clips) {
                    const state = resolveGenerationState(clip.meta, Date.now(), clip.binding);
                    const description = describeOverlay(state, clip.meta, clip.name, { sourcePath: clip.sourcePath });
                    await resolveImage(description.pip);
                    await resolveImage(description.blurBackground);
                }
                if (widget.isDisposed) {
                    disposed();
                    return;
                }
                const changed = imageContextChanged();
                if (changed) {
                    console.warn('[akari-preview] generation images discarded: preview assets replaced; sending state without images');
                }
                if (images.length === 0) return; // 状態は送信済み。画像が無ければ追加送信しない。
                const resolvedClips = describeClips().map(clip => {
                    const state = resolveGenerationState(clip.meta, Date.now(), clip.binding);
                    const description = describeOverlay(state, clip.meta, clip.name, { sourcePath: clip.sourcePath });
                    const pipUri = changed ? null : images.find(image => image.path === description.pip)?.url ?? null;
                    const blurBackgroundUri = changed ? null : images.find(image => image.path === description.blurBackground)?.url ?? null;
                    return { ...clip, pipUri, blurBackgroundUri };
                });
                widget.sendMessage({
                    type: 'akari-preview-generation-update',
                    clips: resolvedClips,
                    exportLook: this.preferences.get<boolean>('akari.preview.exportLook', false) === true
                });
                if (!changed) {
                    for (const stream of acquired) {
                        assetUrls?.set(stream.assetUri, stream.url);
                        (widget.akariPreviewAssetStreamIds ??= []).push(stream.id);
                    }
                    acquired.length = 0; // 既存 disposePreviewStreams の所有へ移した。
                }
            } finally {
                await this.disposeAssetStreams(acquired.map(stream => stream.id));
            }
        } catch (error) {
            console.warn('[akari-preview] generation update failed', error);
        }
    }

}
