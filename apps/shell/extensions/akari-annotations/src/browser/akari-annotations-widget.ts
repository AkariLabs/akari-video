import URI from '@theia/core/lib/common/uri';
import { maskSourceOptionsForSources } from './inspector/mask-fields';
import { CommandService, Disposable, MessageService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { ApplicationShell, BaseWidget, StorageService } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { isEditableEventTarget, isImeCompositionKeydown } from 'akari-preview/lib/common/review-tool-mode';
import {
    areCutsAdjacent,
    cutOverlapFrames,
    findCrossTrackLayerEvacuations,
    collectExcludedCaptionIds,
    isStillImageSourcePath,
    isTransitionType,
    planTransitionHandleWindow,
    removeV2TransitionOutWithHandleRetractInSource,
    serializeMotion,
    TRANSITION_CATEGORIES,
    TRANSITION_VOCABULARY,
    toAnchorCaptions,
    unsupportedTrackTransitionTarget
} from '@akari-video/edit-store';
import type { InternalTrack, TransitionType } from '@akari-video/edit-store';
import { scanHtmlParts } from 'akari-preview/lib/common/preview-parts';
import {
    AkariAnnotationsService,
    Annotation,
    AudioEnvelopeKeyframePayload,
    CaptionWritePayload,
    EditMigrationProposal,
    ClipFilmstripChunk,
    WriteBackResult
} from '../common/akari-annotations-protocol';
import { parseReview } from '../common/annotation-store';
import { planTimelineHeaderWheel } from '../common/timeline-header-wheel';
import { trackHeaderControls } from '../common/track-header-controls';
import { isTrackLocked, lockedTrackMessage } from '../common/track-lock-guard';
import { classifyEditLoadFailure, ReportedEditLoadFailure } from '../common/edit-load-failure';
import {
    AudioLoudnessEnvelope,
    AudioWaveformDebounceGate,
    AudioWaveformPanScheduleGate,
    AudioWaveformPaintState,
    AudioWaveformT1RetryGate,
    AudioWaveformTier,
    AudioWaveformTierLru,
    AudioWaveformWindow,
    audioClipLocalGeometry,
    audioKeyframeMarkerPositions,
    audioLoudnessBucketColors,
    audioLoopWaveformVisibleWindowPlan,
    audioLoopTilePeaks,
    audioSourceSliceWindow,
    audioWaveformBandLayout,
    AudioWaveformCanvasPlacement,
    audioWaveformCanvasPlacement,
    audioWaveformMasterKey,
    audioWaveformPrefetchWindow,
    audioWaveformRepaintNeeded,
    audioWaveformSourceRect,
    audioWaveformTierBucketCount,
    audioWaveformTierCacheKey,
    audioWaveformViewKey,
    audioWaveformVisibleSourceWindow,
    audioWaveformWindowContains,
    filmstripChunkIndexFor,
    nextAudioWaveformTier,
    waveformBucketForLocalPx,
    waveformHeightForPeak
} from '../common/filmstrip-geometry';
import { isRangeMounted as rangeIsMounted, planKeyedReconciliation } from './timeline-strip-reconciler';
import { createRafThrottle } from './raf-throttle';
import { createRevisionMemo } from './revision-memo';
import {
    layoutPercent as anchoredLayoutPercent,
    panTranslatePx,
    shouldReanchorPan
} from './timeline-pan-transform';
import {
    ChipHitAreaEntry,
    clipEdgeZonePx,
    planChipHitPadding,
    planInitialVisualTrackScroll,
    resolveTimelineEdgeMode,
    TimelineEdgeMode
} from './timeline-chip-hit-area';
import {
    CaptionRecord,
    CaptionTextStyle,
    CaptionTextStylePatch,
    mergeCaptionTextStyles,
    parseCaptions,
    removeCaptionLine
} from '../common/caption-store';
import {
    EditAudioBgm,
    EditAudioNarration,
    EditAudioSfx,
    EditBeat,
    EditCut,
    EditLayer,
    EditOverlay,
    EditTimelineTrack,
    InternalEdit,
    InternalSource,
    TimelineTrackKind,
    computeCutTrackSegments,
    derivedLegacyTracks,
    projectLegacyEdit,
    readInternalEdit
} from '../common/edit-store';
import {
    EditV2Document,
    ItemLocation,
    findAudioItemIdByRole,
    indexEditV2Items,
    insertAudioSfxPreferV2,
    insertItem as insertV2Item,
    insertTrack as insertV2Track,
    convertCaptionToTelopV2,
    detachTreeV2Item,
    groupTreeV2Items,
    moveAudioSfxPreferV2,
    moveItemToNewTrack as moveV2ItemToNewTrack,
    removeItem as removeV2Item,
    removeTreeV2Item,
    removeAudioNarrationPreferV2,
    removeAudioSfxPreferV2,
    removeTrack as removeV2Track,
    renameTrack as renameV2Track,
    setTrackFlag as setV2TrackFlag,
    reorderTracks as reorderV2Tracks,
    splitItem as splitV2Item,
    stringifyEditV2,
    moveTreeV2Item,
    moveV2Keyframe,
    prepareV2KeyframeDistribution,
    removeV2Keyframe,
    setV2Keyframe,
    setV2SegmentEasing,
    ungroupTreeV2Item,
    updateAudioSfxPreferV2,
    updateAudioNarrationGainPreferV2,
    updateAudioNarrationPreferV2,
    updateAudioItemEnvelope,
    updateTreeV2Item,
    updateItemDurationAndShiftFollowing as updateV2ItemDurationAndShiftFollowing,
    updateItem as updateV2Item
} from '../common/edit-v2-mutations';
import {
    computeTrackAutoNames as computeTrackKindAutoNames,
    sortDefaultTimelineTracks,
    withAudioDisplaySupplement,
    withCaptionsDisplaySupplement
} from '../common/derive-timeline-tracks';
import { assignSubRows } from '../common/lane-layout';
import { CaptionSubrowLayout, computeCaptionSubrowLayout } from '../common/caption-subrow-layout';
import { clampCaptionOutputRange, resolveSourceCaptionEdgeDrag } from '../common/caption-output-domain';
import { clampCaptionRangeToNeighbors, CaptionNeighborRange } from '../common/caption-overlap-guard';
import {
    CaptionSourceForMapping,
    computeCaptionSourceMappingWarning,
    readCaptionSourceMap,
    resolveCaptionSourceForMapping,
    shouldNotifyCaptionSourceMappingWarning
} from '../common/caption-source-map';
import { clampSfxFadeToEffectiveDuration, slipAudioWindow } from '../common/audio-clip-trimmer';
import {
    AUDIO_KEYFRAME_MIN_POINTS_NOTICE,
    audioKeyframeWriteGuard
} from '../common/audio-keyframe-editor-geometry';
import { computeAudioOverlapLayout } from '../common/audio-overlap-layout';
import { setSfxGainDbInSource } from '../common/edit-store';
import { setSfxFadeInSource } from '../common/sfx-fade-store';
import {
    hitTestTimelineTrackDrop,
    TimelineTrackDropLayout
} from '../common/timeline-track-drop';
import { hitTestTimelineTreeDrop, TimelineTreeDropHit } from '../common/timeline-tree-drop';
import { computeCutBoundaries } from '../common/cut-boundaries';
import { resolveItemRowLayout } from '../common/item-row-layout';
import { splitLintBlame } from '../common/lint-blame-scope';
import { formatLintFailureForUi, japaneseLintWarningSummary, UiLintFinding } from '../common/lint-message-ja';
import { buildTimelineClipMenuItems } from '../common/timeline-context-menu-items';
import { formatTransitionSeconds, roundTransitionDurationForWrite } from '../common/transition-duration';
import { resolveTimelineExtentSeconds } from '../common/timeline-extent';
import {
    collectEdgeCandidates,
    readStoredSnapEnabled,
    resolveSnapRange,
    resolveSnapTime,
    snapThresholdSecondsFor,
    writeStoredSnapEnabled,
    SnapCandidate,
    SnapEdgeItem,
    SnapExclusion,
    SnapResolution as SnapResult
} from '../common/timeline-snap';
import { PARTNER_WIDGET_ID, resolveRightPaneSyncAction } from '../common/right-pane-sync';
import {
    computeMaterialGhostRange,
    CutDropPlan,
    planCutDrop,
    IMAGE_LAYER_DEFAULT_DURATION_SECONDS,
    materialDropDecision,
    materialGhostVisibility,
    MaterialDragKind,
    MaterialDropZone,
} from '../common/timeline-material-insert';
import { OPEN_AKARI_INSPECTOR_ID, OPEN_AKARI_REVIEW_PANEL_ID } from './akari-annotations-commands';
import { openTimelineContextMenu, withAudioTrimMenuItem } from './akari-timeline-context-menu';
import { AkariAudioKeyframeDialog } from './akari-audio-keyframe-dialog';
import {
    filterSupportedTransitionBoundaries,
    hitTestTransitionBoundary,
    LibraryTransitionDragPayload,
    parseLibraryTransitionDragPayload,
    TransitionBoundaryHitCandidate
} from './library-drop-model';
import { TimelineCollapsedState } from './timeline/timeline-collapsed-state';
import {
    applyTimelineCollapsedRows,
    buildTimelineTreeRows,
    childRow,
    parentRow,
    rowsByTrack,
    TimelineTreeRow,
    visibleTimelineTreeRows,
} from './timeline/timeline-tree-model';
import { calculateTimelineTrackHeight, timelineTreeRowOffset } from './timeline/timeline-track-height';
import {
    assignDetachedCaptionChipSubRows,
    detachedCaptionChipRows
} from './timeline/detached-caption-chip-layout';
import {
    enterFocusScope,
    exitFocusScope,
    focusScopeAtBreadcrumb,
    FocusScopeState,
    initialFocusScope,
    rowsInFocusScope,
    timelineDoubleClickAction
} from './focus/focus-scope';
import {
    aggregateKeyframeDiamonds,
    deriveTimelineKeyframeRows,
    keyframeValueAt,
    KeyframeProperty,
    TimelineKeyframePropertyRow
} from './timeline/timeline-keyframe-rows';
import { createAkariNoticeBanner } from './akari-notice-banner';
import { NudgeCommitSession, planAdjacentVisualTrackMove } from './inspector/keyboard-shortcuts';
import { layerSnapshotChromaKey, legacyTransformOpFor } from './inspector/field-mappings';
import { updateInspectorCrop, type InspectorCropAxis } from './inspector/crop-fields';
import { validateInspectorPerspective } from './inspector/perspective-fields';
import { validateInspectorMotion } from './inspector/motion-fields';
import { readAudioMasterSnapshot, updateAudioMasterDocument } from './inspector/audio-master';
import {
    audioClipFxFieldsForSnapshot,
    updateAudioClipFxDocument,
    type AudioClipFxWriteRequest
} from './inspector/audio-clip-fx';
import {
    readInspectorAdjustSnapshot,
    updateInspectorAdjust,
    type InspectorAdjustPath,
    type InspectorAdjustValue
} from './inspector/adjust-fields';
import {
    isCutFramingWriteRequest,
    readCutFraming,
    updateCutFraming,
    type CutFramingWriteRequest
} from './inspector/framing-fields';
import {
    cutPlaybackDuration,
    isCutFreezeWriteRequest,
    isExplicitV0CutTimeline,
    readCutFreeze,
    resolveCutFreezeDisplayAt,
    updateCutFreeze,
    type CutFreezeWriteRequest
} from './inspector/freeze-fields';
import { ProjectLocation } from './project-location';
import { AkariAnnotationsClientImpl } from './akari-annotations-client';
import { AkariEditHistoryService, HistoryEntry, HistoryExecution } from './akari-edit-history-service';
import { ReviewModel } from './review-model';
import {
    AudioMasterWriteRequest,
    InspectorWriteRequest,
    InspectorWriteResult,
    KeyframeControlRequest,
    AdjustBypassRequest,
    LivePreviewRequest,
    TimelineAudioSelection,
    TimelineCropSnapshot,
    TimelineItemSelectionSnapshot,
    TimelineTreeItemSelection,
    TimelineTreeItemSnapshot,
    TimelineSelectionModel,
    captionIdForTreeSelection,
    resolveTimelineClipName
} from './timeline-selection-model';

const ENSURE_PREVIEW_VISIBLE_COMMAND_ID = 'akari.preview.ensureVisible';
const SEEK_OUTPUT_PREVIEW_COMMAND_ID = 'akari.preview.seekOutput';
const TOGGLE_OUTPUT_PREVIEW_PLAYBACK_COMMAND_ID = 'akari.preview.togglePlayback';
const PLAYHEAD_FOLLOW_THRESHOLD = 0.78;
const MINIMUM_ITEM_DURATION = 0.15;
const MINIMUM_SFX_TRIM_DURATION = 0.1;
/** 素材追加コマンドで実尺（getAudioDuration）が取れない video のフォールバック尺（司令塔裁定4）。 */
const MATERIAL_INSERT_FALLBACK_DURATION_SECONDS = 3;
const DRAG_THRESHOLD_PX = 3;
const EDGE_ZONE_PX = 6;
const TRACK_INSERT_LINE_COLOR = '#22c55e';
const SNAP_THRESHOLD_PX = 6;
const SNAP_GUIDE_COLOR_DEFAULT = '#06b6d4';
const SNAP_GUIDE_COLOR_PLAYHEAD = '#f59e0b';
const MIN_VIEW_DURATION_FRAMES = 4;
const RULER_MIN_TICK_SPACING_PX = 80;
const RULER_STEP_MULTIPLIERS_FRAMES = [1, 2, 5, 10, 20, 50, 100];
const RULER_STEP_SECONDS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const RULER_BAND_HEIGHT_PX = 14;
const RULER_TICK_COLOR = '#3f3f46';
const RULER_BAND_BACKGROUND = '#1e1e21';
const STRIP_BACKGROUND = '#1a1d22';
const STRIP_BORDER_COLOR = '#2a2d33';
const ZOOM_SLIDER_RESOLUTION = 1000;
const ZOOM_WHEEL_SENSITIVITY = 0.01;
const ZOOM_EVENT_FACTOR_MIN = 1 / 1.5;
const ZOOM_EVENT_FACTOR_MAX = 1.5;
const PAN_TRANSFORM_LIMIT_RATIO = 0.25;
const PAN_SETTLE_RATIO = 0.25;
const LAYOUT_PERCENT_MIN = -60;
const LAYOUT_PERCENT_MAX = 160;
const MIN_CLIP_WIDTH_FOR_MEDIA_PX = 40;
const PLAYHEAD_COLOR = '#3b82f6';
const MICRO_CLIP_WIDTH_PX = 28;
/** 細いチップでもポインタで掴める実効当たり幅の目標下限（px）。 */
const MIN_CLIP_HIT_WIDTH_PX = 24;
/** 当たり領域を拡張したチップでの左右トリムハンドル 1 つぶんの下限（px）。 */
const MIN_TRIM_HANDLE_HIT_PX = 8;
const CLIP_HEADER_HEIGHT = 14;
/** クリップ帯の高さ（ヘッダー帯14px + サムネイル/波形本体34px）。cuts トラックの既定高さ。 */
const CLIP_HEIGHT = CLIP_HEADER_HEIGHT + 34;
/**
 * トラック高さドラッグリサイズ（R7-2・T4 の3段階ボタンを退役し連続値へ一般化）。
 * cuts/audio トラックのヘッダー下端をドラッグすると、この範囲内で高さを連続変更できる。
 */
const MIN_TRACK_HEIGHT_PX = 20;
const MAX_TRACK_HEIGHT_PX = 240;
/** audio トラックの既定高さ（コンパクト表示でも波形を視認できる高さ）。 */
const DEFAULT_AUDIO_TRACK_HEIGHT_PX = 28;
/** per-track 高さの永続化キー接頭辞（StorageService＝ワークスペース状態。edit.json には書かない）。 */
// 2026-08-27 既定圧縮に伴いキー世代を上げた。
const TRACK_HEIGHT_STORAGE_PREFIX = 'akari.annotations.trackHeight.v2';
const TRACK_FLAG_STORAGE_PREFIX = 'akari.annotations.trackFlag';
/**
 * cuts トラックの高さがこの値未満ならフィルムストリップ・波形の描画をスキップする。
 * 幅側の MIN_CLIP_WIDTH_FOR_MEDIA_PX ゲートと同列の高さゲート。
 */
const MIN_TRACK_HEIGHT_FOR_MEDIA_PX = CLIP_HEIGHT;
/** audio sfx バーの高さがこの値未満なら波形の描画をスキップする（ラベルのみ表示）。 */
const MIN_TRACK_HEIGHT_FOR_AUDIO_WAVEFORM_PX = 24;
/** 音声キーフレームはズームに影響されない固定 px のひし形で示す。 */
const AUDIO_KEYFRAME_MARKER_SIZE_PX = 6;
/** 波形マスター canvas の上限。素材差し替えを繰り返しても無制限に増やさない。 */
const AUDIO_WAVEFORM_MASTER_CACHE_LIMIT = 64;
/** フィルムストリップの目標セル幅（atlas フレームのアスペクトから実セル幅を導出する基準値）。 */
const FILMSTRIP_TARGET_CELL_WIDTH_PX = 36;
/** クリップ 1 個あたりの最大セル数（暴走防止。実測上はズームしても strip 幅に収まるため頭打ちにはまず届かない）。 */
const FILMSTRIP_MAX_CELLS_PER_CLIP = 160;
/** 動画クリップ波形の描画帯の高さ。音声レーンは残り高さから別計算する。 */
const WAVEFORM_BAND_HEIGHT_PX = 12;
/**
 * ソーストリマー（R6c2r2・外側延長方式）: クリップ左右の「ウィング」（in より前 /
 * out より後の素材）に許す最大表示幅（px）。同一 px/秒スケールで描くため、素材が
 * 長尺でもセル数がズームに関わらずこの幅に収まるようにする（用途は前後数秒の微調整）。
 */
const TRIMMER_WING_MAX_WIDTH_PX = 480;
const LANE_GAP = 2;
const SUBROW_HEIGHT = 22;
const SUBROW_GAP = 2;
const SUBROW_STRIDE = SUBROW_HEIGHT + SUBROW_GAP;
const STRIP_BOTTOM_MARGIN = 2;
const TRACK_HEADER_WIDTH = 136;
/** ㉔ トランジション境界バッジ（隣接カット境界の常時表示 + クリック編集）。 */
const TRANSITION_BADGE_SIZE_PX = 16;
const TRANSITION_BADGE_ACCENT_COLOR = '#a855f7';
const TRANSITION_BADGE_WARNING_COLOR = '#f97316';
const TRANSITION_BADGE_NEUTRAL_BORDER_COLOR = 'rgba(255,255,255,.4)';
const TRANSITION_DEFAULT_DURATION_SECONDS = 0.5;
const TRANSITION_DROP_TARGET_SIZE_PX = 36;
const TRANSITION_DROP_HIT_TOLERANCE_PX = 24;
const NON_ADJACENT_TRANSITION_MESSAGE = 'このトランジションは次のクリップとの間にすき間があるため書き出されません。'
    + 'すき間を詰めるか、トランジションを削除してください。';
const ZERO_OVERLAP_TRANSITION_MESSAGE = 'このトランジションは効きません: 素材に余りがありません。'
    + 'のりしろにできる素材の余りがないため、素材のトリムを調整するか削除してください。';
const TRANSITION_MIN_DURATION_SECONDS = 0.1;
const TRANSITION_MAX_DURATION_SECONDS = 3;
const TRANSITION_TYPE_OPTIONS = TRANSITION_VOCABULARY.map(entry => ({
    type: entry.id,
    label: entry.labelJa,
    category: entry.category,
    glyph: entry.glyph
}));
const BEAT_PROJECTION_EPSILON = 0.000001;
/** タイムライン（出力秒軸）上の1セグメント。cuts[].at / track を解決した結果。 */
interface OutputSegment {
    index: number;
    src?: string;
    in: number;
    out: number;
    speed: number;
    transitionOut?: { type: string; duration: number };
    tlStart: number;
    tlEnd: number;
    track: number;
}

interface ClipMediaGeometry {
    clipWidth: number;
    clipLocalOffsetPx: number;
    fullClipWidthPx: number;
    trackHeightPx: number;
}

interface AudioWaveformDetailSource {
    readonly tier: AudioWaveformTier;
    readonly fullPeaks: readonly number[];
    readonly sliceKey: string;
    readonly peaksFactory: () => readonly number[];
    readonly waveformStartSec: number;
    readonly waveformDisplayDurationSec: number;
}

interface AudioWaveformDetailMapping {
    readonly visibleSourceWindow: AudioWaveformWindow;
    readonly sourceOriginTimelineSeconds: number;
    readonly sourceSecondsPerTimelineSecond: number;
}

interface AudioWaveformT2Coverage {
    readonly key: string;
    readonly window: AudioWaveformWindow;
    readonly bucketCount: number;
}

interface AudioWaveformT2PlacementCoverage extends AudioWaveformT2Coverage {
    readonly sourceOriginTimelineSeconds: number;
    readonly sourceSecondsPerTimelineSecond: number;
}

function sameRenderedPx(left: number, right: number): boolean {
    return Math.abs(left - right) < 1e-6;
}

function sameClipMediaGeometry(left: ClipMediaGeometry, right: ClipMediaGeometry): boolean {
    return sameRenderedPx(left.clipWidth, right.clipWidth)
        && sameRenderedPx(left.clipLocalOffsetPx, right.clipLocalOffsetPx)
        && sameRenderedPx(left.fullClipWidthPx, right.fullClipWidthPx)
        && sameRenderedPx(left.trackHeightPx, right.trackHeightPx);
}

interface ResolvedEditSource {
    path: string;
    videoUri: string;
}

/**
 * EditAudioSfx（正本 packages/edit-store）は audio.sfx[].fade_in/fade_out を運ばない
 * （task 2026-08-18-audio-clip-fades のファイル境界が packages/edit-store を含まないため、
 * parseEdit() 側は拡張しない）。reloadEdit() が rawValue（edit.json の生 JSON）から
 * fade_in/fade_out を直接読み、id の "sfx-N" インデックスで対応する parsed.audioSfx へこの
 * 拡張フィールドとして足し込む。
 */
type AudioEnvelopeFields = {
    ducking?: boolean;
    duckDb?: number;
    duckAttack?: number;
    duckRelease?: number;
    keyframes?: AudioEnvelopeKeyframePayload[];
};

type EditAudioSfxWithFade = EditAudioSfx & AudioEnvelopeFields & {
    fadeIn?: number;
    fadeOut?: number;
};

type EditAudioNarrationWithEnvelope = EditAudioNarration & AudioEnvelopeFields;
type EditAudioBgmWithEnvelope = EditAudioBgm & AudioEnvelopeFields;
type AudioSelectionSnapshot = TimelineAudioSelection & AudioEnvelopeFields & {
    keyframeFrames?: boolean;
    fps?: number;
    playheadSeconds?: number;
};

type ToolMode = 'select' | 'razor';

type TimelineSelection =
    | { kind: 'cut'; index: number }
    | { kind: 'overlay'; id: string }
    | { kind: 'caption'; id: string }
    | { kind: 'layer'; id: string }
    | { kind: 'audio'; id: string }
    | { kind: 'item'; id: string; itemKind: TimelineTreeRow['itemKind']; parentId?: string; trackId: string }
    | undefined;

type TimelineSelectionItem = Exclude<TimelineSelection, undefined>;

// SnapCandidate / SnapResult は common/timeline-snap.ts の型を使う（純関数側でテストする）。

export interface PreviewPlaybackTick {
    videoUri?: string;
    time?: number;
    playing?: boolean;
}

type TimelineClipboard =
    | { kind: 'caption'; payload: Pick<CaptionWritePayload, 'text' | 'start' | 'end'> }
    | { kind: 'item'; trackId: string; item: Record<string, unknown> };

const TIMELINE_OVERLAY_SELECTED_EVENT = 'akari.timeline.overlaySelected';
// akari-preview 側の TIMELINE_LAYER_SELECTED_EVENT とミラー（CF-select）。
const TIMELINE_LAYER_SELECTED_EVENT = 'akari.timeline.layerSelected';
const TIMELINE_SET_TRACK_VISIBILITY_EVENT = 'akari.timeline.setTrackVisibility';
const TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT = 'akari.timeline.setCaptionsVisibility';
const TIMELINE_SET_OVERLAY_TRACK_MUTED_EVENT = 'akari.timeline.setOverlayTrackMuted';
const TIMELINE_SET_AUDIO_VISIBILITY_EVENT = 'akari.timeline.setAudioVisibility';
const TIMELINE_SET_CAPTIONS_MUTED_EVENT = 'akari.timeline.setCaptionsMuted';
const TIMELINE_SET_BEATS_VISIBILITY_EVENT = 'akari.timeline.setBeatsVisibility';
const TIMELINE_SET_BEATS_MUTED_EVENT = 'akari.timeline.setBeatsMuted';
const TIMELINE_SYNC_TRACK_TOGGLES_EVENT = 'akari.timeline.syncTrackToggles';
// akari-preview 側の TIMELINE_LIVE_TRANSFORM_EVENT とミラー（文字列のみ、cross-package import なし）。
// インスペクターのスクラブドラッグ中、書き込みなしで cuts/layers の transform/opacity をプレビューへ
// 即時反映する ephemeral イベント。
const TIMELINE_LIVE_TRANSFORM_EVENT = 'akari.timeline.liveTransform';
// akari-preview 側とミラー（文字列のみ、cross-package import なし）。調整タブの A/B 比較で adjust を一時バイパスする。
const TIMELINE_ADJUST_BYPASS_EVENT = 'akari.timeline.adjustBypass';
const TIMELINE_LOOP_RANGE_EVENT = 'akari.timeline.loopRange';
const SHORTCUTS_HELP_TEXT = [
    'Space: 再生 / 停止', '← →: 1フレーム移動', 'Shift+← →: 1秒移動',
    'Alt+矢印: 位置を1px移動', 'Shift+Alt+矢印: 位置を10px移動',
    ']: 1つ前へ', '[: 1つ後ろへ'
].join('\n');

// 素材カード D&D（task 2026-08-10-material-dnd-timeline 司令塔裁定4）。mime 文字列・イベント名は
// 送信側（akari-role-buckets-widget.tsx）と独立にリテラル宣言する（PREVIEW_PLAYBACK_TICK_EVENT と
// 同じ流儀 — 拡張間の npm 依存を作らない）。
const MATERIAL_DRAG_MIME = 'application/x-akari-material';
const MATERIAL_DRAG_START_EVENT = 'akari.material.dragStart';
const MATERIAL_DRAG_END_EVENT = 'akari.material.dragEnd';
// ライブラリ D&D は送信側 extension と依存を結ばず、素材 D&D と同じ文字列ミラー契約で受ける。
const LIBRARY_DRAG_MIME = 'application/x-akari-library-item';
const LIBRARY_DRAG_START_EVENT = 'akari.library.dragStart';
const LIBRARY_DRAG_END_EVENT = 'akari.library.dragEnd';
/** ゴースト・ドロップ挿入で使う D&D 中の素材ペイロード（送信側 dataTransfer/CustomEvent の共通形）。 */
interface MaterialDragPayload {
    relativePath: string;
    kind: MaterialDragKind;
    durationSeconds?: number;
}

/** 未検証の値（DataTransfer.getData の JSON.parse 結果・CustomEvent.detail）を安全に絞り込む。 */
function parseMaterialDragPayload(value: unknown): MaterialDragPayload | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const candidate = value as { relativePath?: unknown; kind?: unknown; durationSeconds?: unknown };
    if (typeof candidate.relativePath !== 'string' || !candidate.relativePath) {
        return undefined;
    }
    if (candidate.kind !== 'video' && candidate.kind !== 'audio' && candidate.kind !== 'image') {
        return undefined;
    }
    const durationSeconds = typeof candidate.durationSeconds === 'number' && candidate.durationSeconds > 0
        ? candidate.durationSeconds
        : undefined;
    return { relativePath: candidate.relativePath, kind: candidate.kind, durationSeconds };
}

interface OverlayTrackLayout {
    track: number;
    top: number;
    height: number;
    rows: number[];
    id?: string;
}

interface LaneBounds {
    top: number;
    height: number;
}

interface TrackGroupLayout {
    track: number;
    top: number;
    height: number;
    id?: string;
    kind?: TimelineTrackKind;
    hidden?: boolean;
    muted?: boolean;
}

const STATUS_COLORS: Record<Annotation['status'], string> = {
    open: 'var(--theia-charts-blue)',
    addressed: '#d68a00',
    resolved: 'var(--theia-charts-green)'
};

const BEAT_KIND_COLORS: Record<string, string> = {
    hook: 'var(--theia-charts-blue, #3794ff)',
    turn: 'var(--theia-charts-orange, #d19a66)',
    punchline: 'var(--theia-charts-yellow, #cca700)',
    reveal: 'var(--theia-charts-red, #f14c4c)',
    emotion: 'var(--theia-charts-purple, #b180d7)'
};
const DEFAULT_BEAT_COLOR = 'var(--theia-charts-green, #89d185)';

interface DragBase {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    element: HTMLDivElement;
    ghost: HTMLDivElement;
    dragged: boolean;
}

type DragDetail =
    | { kind: 'cut-trim'; index: number; edge: 'left' | 'right'; originalIn: number; originalOut: number }
    | { kind: 'cut-move'; index: number; originalAt: number; originalTrack: number; duration: number }
    | { kind: 'caption'; id: string; mode: 'move' | 'start' | 'end'; originalStart: number; originalEnd: number;
        originalTimeDomain?: 'source' | 'output'; originalEdited: boolean }
    | { kind: 'overlay'; id: string; mode: 'move' | 'resize'; originalStart: number; originalDuration: number; originalTrack: number }
    | { kind: 'layer'; id: string; mode: 'move' | 'start' | 'end'; originalT: number; originalDuration: number; originalTrack: number }
    | { kind: 'audio'; id: string; originalT: number; originalTrack: number; originalDuration: number }
    | { kind: 'audio-trim'; id: string; edge: 'left' | 'right'; originalT: number; originalIn: number; originalOut: number }
    | {
        /** ソーストリマー窓の中央ドラッグ（slip）: out−in と t を固定したまま in/out を同量シフトする。 */
        kind: 'cut-slip'; index: number; originalIn: number; originalOut: number; sourceDuration: number;
    }
    | {
        /** 音声クリップ版 cut-slip（task 2026-08-18-audio-clip-trimmer-dblclick）。同じ意味論。 */
        kind: 'audio-slip'; id: string; originalIn: number; originalOut: number; sourceDuration: number;
    };

type DragState = DragBase & DragDetail;

type DragPreview =
    | {
        kind: 'cut-trim';
        index: number;
        edge: 'left' | 'right';
        input: number;
        output: number;
        rejected: boolean;
        maxOutSeconds?: number;
    }
    | { kind: 'cut-move'; index: number; at: number; track: number; rejected: boolean;
        insertTrack?: number; targetTrackId?: string; insertIndex?: number }
    | { kind: 'caption'; id: string; start: number; end: number; timeDomain: 'source' | 'output';
        storedTimeDomain?: 'source' | 'output';
        originalStart: number; originalEnd: number; originalTimeDomain?: 'source' | 'output'; originalEdited: boolean }
    | { kind: 'overlay-move'; id: string; start: number; track: number; insertTrack?: number;
        targetTrackId?: string; insertIndex?: number }
    | { kind: 'overlay-resize'; id: string; duration: number }
    | { kind: 'layer'; id: string; t: number; duration: number; track: number; rejected: boolean;
        insertTrack?: number; targetTrackId?: string; insertIndex?: number }
    | { kind: 'audio'; id: string; t: number; track: number; rejected: boolean; insertTrack?: number;
        targetTrackId?: string; insertIndex?: number }
    | { kind: 'audio-trim'; id: string; edge: 'left' | 'right'; t: number; in: number; out: number }
    | { kind: 'cut-slip'; index: number; in: number; out: number }
    | { kind: 'audio-slip'; id: string; in: number; out: number };

@injectable()
export class AkariAnnotationsWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-annotations-widget';

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(CommandService)
    protected readonly commands!: CommandService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(AkariAnnotationsService)
    protected readonly annotationsService!: AkariAnnotationsService;

    @inject(StorageService)
    protected readonly storage!: StorageService;

    protected readonly toolbar = document.createElement('div');
    protected readonly selectToolButton = document.createElement('button');
    protected readonly razorToolButton = document.createElement('button');
    protected readonly snapToggleButton = document.createElement('button');
    protected readonly undoButton = document.createElement('button');
    protected readonly redoButton = document.createElement('button');
    protected readonly compactButton = document.createElement('button');
    protected readonly zoomHud = document.createElement('div');
    protected readonly zoomIcon = document.createElement('span');
    protected readonly zoomLabel = document.createElement('button');
    protected readonly zoomSlider = document.createElement('input');
    protected readonly reviewButton = document.createElement('button');
    protected readonly timelineViewport = document.createElement('div');
    protected readonly trackHeaderColumn = document.createElement('div');
    protected readonly trackHeaderRulerSpacer = document.createElement('div');
    protected readonly trackHeadersViewport = document.createElement('div');
    protected readonly trackHeaders = document.createElement('div');
    protected readonly timelineBody = document.createElement('div');
    protected readonly rulerBar = document.createElement('div');
    protected readonly rulerContent = document.createElement('div');
    protected readonly stripScroll = document.createElement('div');
    protected readonly timelineOverlay = document.createElement('div');
    protected readonly hScrollbarTrack = document.createElement('div');
    protected readonly hScrollbarThumb = document.createElement('div');
    protected readonly strip = document.createElement('div');
    protected readonly stripContent = document.createElement('div');
    protected readonly playhead = document.createElement('div');
    protected readonly playheadHandle = document.createElement('div');
    protected readonly snapGuide = document.createElement('div');
    protected readonly dragFeedback = document.createElement('div');
    protected readonly trackInsertIndicator = document.createElement('div');
    protected readonly selectionMarquee = document.createElement('div');
    /** 素材カード D&D の点線ゴースト（task 2026-08-10-material-dnd-timeline 司令塔裁定5）。 */
    protected readonly materialGhost = document.createElement('div');
    protected readonly notice = createAkariNoticeBanner({ dataAttribute: 'data-akari-timeline-notice' });
    protected readonly footer = document.createElement('div');

    @inject(ReviewModel)
    protected readonly review!: ReviewModel;

    @inject(TimelineSelectionModel)
    protected readonly selectionModel!: TimelineSelectionModel;

    @inject(AkariEditHistoryService)
    protected readonly historyService!: AkariEditHistoryService;

    @inject(AkariAnnotationsClientImpl)
    protected readonly annotationsClient!: AkariAnnotationsClientImpl;

    protected location: ProjectLocation | undefined;
    /** backend の atomic rename 前通知。自己書き込み由来 watcher reload を 1 秒だけ抑止する。 */
    protected readonly recentWrites = new Map<string, number>();
    protected captions: CaptionRecord[] = [];
    /** caption-store が正規化しない captions.json の src を、出力射影専用に保持する。 */
    protected captionSources = new Map<string, string>();
    /** 同じ captions/edit 状態の再読込で射影不能警告を積み上げないための直近文言。 */
    protected lastCaptionSourceMappingWarning: string | undefined;
    protected defaultTextStyle: CaptionTextStyle | undefined;
    protected cuts: EditCut[] = [];
    /** edit-lint と同じ snake_case 互換ビュー。宣言可否の共有判定だけに使う。 */
    protected compatibilityCuts: Array<EditCut & { transition_out?: unknown }> = [];
    /** undefined は v0、配列（空を含む）は v1。 */
    /**
     * 読み込み層が正規化した素材表（版を問わず同じ形。単一 source 宣言も鍵 1 個の表になる）。
     * sidecar 非依存の一次情報で、`sourceMap` / `defaultSource` はこれから組み立てる。
     */
    protected editSources: InternalSource[] = [];
    protected sourceMap = new Map<string, ResolvedEditSource>();
    /** 上記を videoUri へ解決した結果。Out クランプの実尺取得専用に使う。 */
    protected defaultSource: ResolvedEditSource | undefined;
    protected overlays: EditOverlay[] = [];
    protected beats: EditBeat[] = [];
    protected layers: EditLayer[] = [];
    /** layers へ退避され transition_out が無効になった v2 item id → 日本語理由。 */
    protected readonly layerTransitionWarnings = new Map<string, string>();
    protected audioSfx: EditAudioSfxWithFade[] = [];
    protected audioNarration: EditAudioNarrationWithEnvelope[] = [];
    protected audioBgm: EditAudioBgmWithEnvelope | undefined;
    protected timelineTracks: EditTimelineTrack[] = [];
    protected timelineTreeRows: TimelineTreeRow[] = [];
    protected expandedTimelineTreeRows: TimelineTreeRow[] = [];
    protected focusScope: FocusScopeState = { rootId: null, breadcrumbs: ['全体'], span: { at: 0, duration: 0 } };
    protected lastTreeClick: { id: string; time: number; x: number; y: number } | undefined;
    protected readonly keyframeRowsByItem = new Map<string, TimelineKeyframePropertyRow[]>();
    protected readonly extraKeyframeProperties = new Map<string, Set<KeyframeProperty>>();
    protected readonly timelineCollapsedIds = new Set<string>();
    protected treeRowsByTrack = new Map<string, TimelineTreeRow[]>();
    /** ヘッダ列へ行を生やさず、帯のチップだけに描くトップレベル caption 葉。 */
    protected detachedCaptionChipRows: TimelineTreeRow[] = [];
    protected timelineCollapsedState: TimelineCollapsedState | undefined;
    /** pinAudioGroupToBottom 前の射影順。edit-lint が検査する timeline.tracks と同じ値。 */
    protected compatibilityTimelineTracks: EditTimelineTrack[] = [];
    /** reloadEdit で読んだ v2 全文。書き込みは item id / track id の索引からだけ行う。 */
    protected editDocument: EditV2Document | undefined;
    protected itemLocations = new Map<string, ItemLocation>();
    /** 旧表示ビューの cuts[index] を v2 item id へ結ぶ読み取り専用の橋。 */
    protected cutItemIds: string[] = [];
    /**
     * 表示専用のトラック一覧（R7-3・読み込み時の重なり自動配置）。this.timelineTracks（実体・
     * 書き込み経路の基準）に、重なりを解消するための「表示上」追加トラック行を足したもの。
     * calculateLaneLayout() の冒頭で毎回再計算する（edit.json へは一切書き戻さない）。
     */
    protected displayTimelineTracks: EditTimelineTrack[] = [];
    /** sfx.id → 表示上の割当トラック ref（重なり自動配置で実際の sfx.track と異なる場合のみ持つ）。 */
    protected readonly audioAutoTrackOverride = new Map<string, number>();
    /** トラック id → そのトラックが実際に必要とするサブ行数（bgm と sfx が同じ ref を共有する既存仕様向け）。 */
    protected readonly audioTrackSubrowCounts = new Map<string, number>();
    /** cuts/audio トラックの per-track 高さ（px、連続値）。キー = EditTimelineTrack.id。StorageService から遅延読み込み。 */
    protected readonly trackHeights = new Map<string, number>();
    protected readonly trackHeightLoadPromises = new Map<string, Promise<void>>();
    protected segments: OutputSegment[] = [];
    /** rebuildSegments の後方 1 パスで作る transition 境界索引。描画ループでは参照だけ行う。 */
    protected readonly nextSameTrackSegmentByCutIndex = new Map<number, OutputSegment>();
    protected readonly unsupportedTrackTransitionByCutIndex = new Map<number, number>();
    protected readonly nonAdjacentTransitionTargetByCutIndex = new Map<number, number>();
    protected readonly zeroOverlapTransitionIndexes = new Set<number>();
    protected readonly declaredTrackTransitionWarnings = new Set<number>();
    protected readonly declaredTransitionAdjacencyWarnings = new Set<number>();
    protected wordBoundaries: number[] = [];
    protected configured = false;
    protected legacyReadOnly = false;
    protected legacyReadOnlyText: string | undefined;
    protected legacyMigrationProposal: EditMigrationProposal | undefined;
    protected dragState: DragState | undefined;
    /** 素材カード D&D 中（受け側）: 直近 dragStart イベントで受け取ったペイロード。dragEnd/drop でクリアする。 */
    protected materialDragPayload: MaterialDragPayload | undefined;
    /** ライブラリの transition D&D 中だけ保持し、適用可能なカット境界の受け皿描画を有効にする。 */
    protected libraryDragPayload: LibraryTransitionDragPayload | undefined;
    protected materialDragLastClientX = 0;
    protected materialDragLastClientY = 0;
    /** relativePath → getAudioDuration で解決済みの実尺（司令塔裁定6）。video/audio のみ使う。 */
    protected readonly materialDurationCache = new Map<string, number>();
    protected readonly materialDurationPromises = new Map<string, Promise<number | undefined>>();
    protected renderStripPending = false;
    protected readonly stripKeyedNodes = new Map<string, HTMLElement>();
    protected readonly stripKeyedSignatures = new Map<string, string>();
    protected stripDesiredKeys: string[] = [];
    protected stripDesiredKeySet = new Set<string>();
    protected readonly rulerKeyedNodes = new Map<string, HTMLElement>();
    protected readonly rulerKeyedSignatures = new Map<string, string>();
    protected rulerDesiredKeys: string[] = [];
    protected rulerDesiredKeySet = new Set<string>();
    protected readonly headerKeyedNodes = new Map<string, HTMLElement>();
    protected readonly headerKeyedSignatures = new Map<string, string>();
    protected headerDesiredKeys: string[] = [];
    protected headerDesiredKeySet = new Set<string>();
    protected readonly keyedNodeKeys = new WeakMap<Element, string>();
    protected initialVerticalScrollProjectKey: string | undefined;
    protected initialVerticalScrollHandled = false;
    protected readonly clipMediaGeometries = new WeakMap<HTMLDivElement, ClipMediaGeometry>();
    protected readonly dragListenerConfigs = new WeakMap<HTMLDivElement, {
        detail: (event: PointerEvent, rect: DOMRect) => DragDetail;
        onRazorClick?: (event: MouseEvent) => void;
    }>();
    protected readonly dragListenerInstalled = new WeakSet<HTMLDivElement>();
    protected readonly trimmerListenerDetails = new WeakMap<HTMLDivElement,
        (event: PointerEvent, rect: DOMRect) => DragDetail>();
    protected readonly trimmerListenerInstalled = new WeakSet<HTMLDivElement>();
    protected readonly audioTrimmerListenerDetails = new WeakMap<HTMLDivElement,
        (event: PointerEvent, rect: DOMRect) => DragDetail>();
    protected readonly audioTrimmerListenerInstalled = new WeakSet<HTMLDivElement>();
    protected readonly treeRowDragConfigs = new WeakMap<HTMLDivElement, {
        source: TimelineTreeRow; rows: readonly TimelineTreeRow[];
    }>();
    protected readonly treeRowDragInstalled = new WeakSet<HTMLDivElement>();
    protected contextPopup: HTMLDivElement | undefined;
    protected deferredLintFooterMessage: HTMLSpanElement | undefined;
    protected viewStart = 0;
    protected viewDuration: number | undefined;
    protected stripLayoutWidthPx = 0;
    protected layoutViewStart = 0;
    protected layoutViewDuration = 0;
    protected panOffsetPx = 0;
    protected panSettleHandle: number | undefined;
    /**
     * ズーム（wheel / スライダー）と RPC 到着（サムネイル・チャンク・波形）の描画を「1 フレーム 1 回」に
     * 折りたたむ（task/2026-09-02-preview-perf）。トラックパッドのピンチは wheel が 60〜120 Hz で届き、
     * 従来は 1 イベント = 1 回のフル renderStrip() だった。
     */
    protected readonly stripRenderThrottle = createRafThrottle(() => this.renderStrip());
    /** cuts / overlays / layers / audio / captions / 実尺が変わるたびに進める。contentEndMemo のキー。 */
    protected contentExtentRevision = 0;
    protected readonly contentEndMemo = createRevisionMemo(() => this.computeContentEndDuration());
    /** 再利用 cut ノードが最後にフィルムストリップを描いた filmstripContentRevision。 */
    protected readonly clipMediaRevisions = new WeakMap<HTMLDivElement, number>();
    protected fps = 30;
    /** 出力秒（アウトプットタイムライン軸）。cuts が無ければ source 秒と一致する。 */
    protected playheadT = 0;
    protected thumbnailCache = new Map<string, string | 'pending' | 'unavailable'>();
    /**
     * キーは `${videoUri}:${chunkIndex}`（素材 + ソース時間チャンク単位。クリップの
     * in/out は含まない — トリムしてもチャンクは再取得しない）。
     */
    protected filmstripChunkCache = new Map<string, ClipFilmstripChunk | 'pending' | 'unavailable'>();
    protected filmstripContentRevision = 0;
    protected waveformCache = new Map<string, number[] | 'pending' | 'unavailable'>();
    protected readonly waveformTierCache = new AudioWaveformTierLru<
        number[] | 'pending' | 'unavailable'
    >(200);
    protected readonly waveformT1Requested = new Set<string>();
    protected readonly waveformT1RetryGate = new AudioWaveformT1RetryGate();
    protected readonly waveformT2DebounceGates = new Map<string, AudioWaveformDebounceGate>();
    protected readonly waveformT2DebounceTimers = new Map<string, { key: string; handle: number }>();
    protected readonly waveformPanScheduleGate = new AudioWaveformPanScheduleGate(100);
    protected readonly waveformT2PanTargets = new Map<string, () => void>();
    protected readonly waveformT2Coverages = new Map<string, AudioWaveformT2Coverage>();
    protected readonly audioWaveformMasterCache = new Map<string, HTMLCanvasElement>();
    protected readonly audioWaveformPeakIds = new WeakMap<readonly number[], number>();
    protected nextAudioWaveformPeakId = 1;
    protected audioDurationCache = new Map<string, number | 'pending' | 'unavailable'>();
    protected audioDurationPromises = new Map<string, Promise<number | 'unavailable'>>();
    protected videoDurationCache = new Map<string, number | 'pending' | 'unavailable'>();
    protected videoDurationPromises = new Map<string, Promise<number | 'unavailable'>>();
    protected ffmpegMissingNoticeShown = false;
    protected videoDurationNoticeShown = false;
    protected lastManualScrollAt = 0;
    protected toolMode: ToolMode = 'select';
    /**
     * マグネット（スナップ）。既定 OFF・ユーザー設定として localStorage に永続化する
     * （task 2026-09-02-timeline-undo-snap-fixes: 起動のたびに ON へ戻っていたのが
     * 「つけてないのに反応する」の真因）。
     */
    protected snapEnabled = readStoredSnapEnabled(typeof localStorage === 'undefined' ? undefined : localStorage);
    protected selection: TimelineSelection;
    protected multiSelection: TimelineSelectionItem[] = [];
    /**
     * ソーストリマー（R6c-2）: dblclick 中のクリップ（cuts のインデックス）。
     * 定義中はそのクリップの帯を素材全体のフィルムストリップへ切り替え、
     * 通常の move/trim ドラッグの代わりにトリマー窓のエッジ/中央ドラッグを提供する。
     */
    protected trimmerItemId: number | undefined;
    /**
     * ソーストリマー（R6c-2）: ダブルクリック検出用の直近クリック記録。
     * cuts 要素は pointerdown で `preventDefault()` するため（既存の select ツール実装）、
     * ブラウザ標準の 'dblclick' は合成されない（Pointer Events 互換マウスイベント抑止の仕様どおり）。
     * そのため pointerup ベースで自前のダブルクリック判定を行う。
     */
    protected lastCutClick: { index: number; time: number; x: number; y: number } | undefined;
    /**
     * 音声クリップ版ソーストリマー（task 2026-08-18-audio-clip-trimmer-dblclick）: dblclick 中の
     * 音声クリップ（audio.sfx[].id）。動画クリップの trimmerItemId/lastCutClick と同型
     * （BGM は audio.sfx を経由しないため対象外・R6 契約どおり）。
     */
    protected trimmerAudioId: string | undefined;
    protected lastAudioClick: { id: string; time: number; x: number; y: number } | undefined;
    protected audioDurationNoticeShown = false;
    protected suppressNextStripClick = false;
    protected rightPaneSyncRevision = 0;
    protected rightPaneSyncTail: Promise<void> = Promise.resolve();
    protected clipboard: TimelineClipboard | undefined;
    protected overlayTrackLayouts: OverlayTrackLayout[] = [];
    protected laneLayout: {
        beats: LaneBounds;
        captions: LaneBounds;
        overlayTracks: TrackGroupLayout[];
        cutTracks: TrackGroupLayout[];
        layerTracks: TrackGroupLayout[];
        audioTracks: TrackGroupLayout[];
        tracks: TrackGroupLayout[];
    } = {
        beats: { top: 0, height: 0 }, captions: { top: 0, height: 0 }, overlayTracks: [],
        cutTracks: [], layerTracks: [], audioTracks: [], tracks: []
    };
    protected readonly overlayRows = new Map<string, number>();
    protected readonly layerRows = new Map<string, number>();
    protected readonly audioSfxRows = new Map<string, number>();
    protected readonly audioNarrationRows = new Map<string, number>();
    /** captions.json を正本のまま保ち、content トラック内の表示用サブ段だけを ID 単位で導出する。 */
    protected captionLayouts = new Map<string, CaptionSubrowLayout>();
    protected timelineTreeTracks: InternalTrack[] = [];
    protected timelineTreePartsByHtml = new Map<string, readonly { id: string; order: number }[]>();
    protected audioBgmTop = 0;
    protected captionsVisible = true;
    protected captionsMuted = false;
    protected beatsVisible = true;
    protected beatsMuted = false;
    protected beatsLocked = false;
    protected readonly localLockedTrackIds = new Set<string>();
    protected audioVisible = true;
    protected readonly hiddenTracks = new Set<number>();
    protected readonly mutedOverlayTracks = new Set<number>();

    /** 注釈の実体は ReviewModel が持つ（注釈パネルと共有）。ここではピン描画のために読むだけ。 */
    protected get annotations(): readonly Annotation[] {
        return this.review.annotations;
    }

    protected get selectedSourceT(): number {
        return this.review.selectedSourceT;
    }

    protected set selectedSourceT(value: number) {
        this.review.selectedSourceT = value;
    }

    @postConstruct()
    protected init(): void {
        this.id = AkariAnnotationsWidget.FACTORY_ID;
        this.title.label = 'タイムライン';
        this.title.caption = 'タイムラインとレビューコメント';
        this.title.iconClass = 'codicon codicon-comment';
        this.title.closable = true;
        this.node.classList.add('akari-annotations-widget');
        // docs/contract-2026-08-11-review-session-ui-events.md #2: panel:<id> opt-in target.
        this.node.setAttribute('data-akari-ui', 'panel:timeline');
        this.node.setAttribute('data-akari-ui-label', 'タイムライン');
        Object.assign(this.node.style, {
            display: 'grid',
            // An implicit auto track can grow to child max-content, so force the column to shrink to the widget width.
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridTemplateRows: 'auto minmax(0, 1fr) auto auto auto',
            height: '100%',
            overflow: 'hidden',
            background: 'var(--theia-editor-background)'
        });
        // 素材カード D&D（task 2026-08-10-material-dnd-timeline 事実2）: タイムライン widget は
        // bottom エリア（#theia-main-content-panel の外）にあるため、akari-project-contribution.ts
        // の isDelegatedDropzone に自分を素通しさせるため data-akari-dropzone を付ける
        // （akari-role-buckets-widget.tsx:287 と同じ流儀）。
        this.node.setAttribute('data-akari-dropzone', 'true');

        Object.assign(this.toolbar.style, {
            alignItems: 'center', display: 'flex', gap: '2px', minHeight: '30px',
            padding: '2px 6px', borderBottom: '1px solid var(--theia-widget-border)', boxSizing: 'border-box'
        });
        this.configureIconButton(this.selectToolButton, 'codicon-cursor', '選択ツール', '選択 (A)');
        this.selectToolButton.addEventListener('click', () => this.setToolMode('select'));
        this.configureIconButton(this.razorToolButton, 'codicon-screen-cut', '分割ツール', '分割 (B)');
        this.razorToolButton.addEventListener('click', () => this.setToolMode('razor'));
        this.configureIconButton(this.snapToggleButton, 'codicon-magnet', 'マグネット', 'マグネット（スナップ）切替 (M / N)');
        this.snapToggleButton.addEventListener('click', () => this.setSnapEnabled(!this.snapEnabled));
        this.configureIconButton(this.undoButton, 'codicon-discard', '元に戻す', '元に戻す (⌘Z)');
        this.undoButton.disabled = true;
        this.undoButton.addEventListener('click', () => void this.performUndo());
        this.configureIconButton(this.redoButton, 'codicon-redo', 'やり直す', 'やり直す (⇧⌘Z)');
        this.redoButton.disabled = true;
        this.redoButton.addEventListener('click', () => void this.performRedo());
        this.configureIconButton(this.compactButton, 'codicon-collapse-all', '詰める', 'クリップ間の空白を詰める');
        this.compactButton.addEventListener('click', () => void this.performCompactCuts());
        this.toolbar.append(
            this.selectToolButton, this.razorToolButton,
            this.createToolbarSeparator(),
            this.snapToggleButton,
            this.createToolbarSeparator(),
            this.undoButton, this.redoButton, this.compactButton
        );
        this.updateToolModeButtons();
        this.updateSnapButton();
        this.toDispose.push(this.historyService.onDidChange(() => this.updateHistoryButtons()));
        this.toDispose.push(this.historyService.onDidExecute(execution => this.applyHistoryExecution(execution)));
        Object.assign(this.zoomHud.style, {
            display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto'
        });
        this.zoomIcon.className = 'codicon codicon-search';
        this.zoomIcon.setAttribute('aria-hidden', 'true');
        this.zoomIcon.setAttribute('data-testid', 'akari-timeline-zoom-icon');
        this.zoomLabel.type = 'button';
        this.zoomLabel.textContent = '100%';
        this.zoomLabel.setAttribute('data-testid', 'akari-timeline-zoom-percent');
        this.zoomLabel.title = '100%（全体表示）に戻す';
        Object.assign(this.zoomLabel.style, {
            fontSize: '11px', fontVariantNumeric: 'tabular-nums', minWidth: '38px', textAlign: 'right',
            color: 'var(--theia-descriptionForeground)', background: 'none', border: '0', padding: '0',
            margin: '0', cursor: 'pointer'
        });
        this.zoomLabel.addEventListener('click', () => this.applyViewDuration(this.totalDuration(), 0, 0));
        this.zoomSlider.type = 'range';
        this.zoomSlider.min = '0';
        this.zoomSlider.max = String(ZOOM_SLIDER_RESOLUTION);
        this.zoomSlider.step = '1';
        this.zoomSlider.value = '0';
        this.zoomSlider.setAttribute('aria-label', 'ズーム率');
        this.zoomSlider.setAttribute('data-testid', 'akari-timeline-zoom-slider');
        Object.assign(this.zoomSlider.style, { width: '80px' });
        this.zoomSlider.addEventListener('input', () => {
            const proposedDuration = this.sliderValueToViewDuration(Number(this.zoomSlider.value));
            const centerTime = this.viewStart + this.visibleDuration() / 2;
            this.applyViewDuration(proposedDuration, centerTime, 0.5);
        });
        this.zoomHud.append(this.zoomIcon, this.zoomLabel, this.zoomSlider);
        this.reviewButton.type = 'button';
        this.reviewButton.className = 'theia-button secondary akari-annotations-text-button';
        this.reviewButton.textContent = '注釈';
        this.reviewButton.title = '注釈パネルを開く';
        this.reviewButton.addEventListener('click', () => void this.commands.executeCommand(OPEN_AKARI_REVIEW_PANEL_ID));
        this.toolbar.append(this.zoomHud, this.reviewButton);

        Object.assign(this.timelineViewport.style, {
            display: 'grid', gridTemplateColumns: `${TRACK_HEADER_WIDTH}px minmax(0, 1fr)`, minHeight: '0',
            paddingLeft: '6px', boxSizing: 'border-box'
        });
        Object.assign(this.trackHeaderColumn.style, {
            display: 'grid', gridTemplateRows: `${RULER_BAND_HEIGHT_PX}px minmax(0, 1fr)`,
            minHeight: '0', margin: '2px 0'
        });
        Object.assign(this.trackHeaderRulerSpacer.style, {
            border: '1px solid var(--theia-widget-border)', borderRight: '0', borderBottom: '0',
            borderRadius: '4px 0 0 0', background: RULER_BAND_BACKGROUND, boxSizing: 'border-box'
        });
        Object.assign(this.trackHeadersViewport.style, {
            minHeight: '0', overflow: 'hidden', border: '1px solid var(--theia-widget-border)',
            borderRight: '0', borderRadius: '0 0 0 4px',
            background: 'var(--theia-editorWidget-background)', boxSizing: 'border-box'
        });
        Object.assign(this.trackHeaders.style, {
            position: 'relative', width: `${TRACK_HEADER_WIDTH}px`, boxSizing: 'border-box'
        });
        Object.assign(this.timelineBody.style, {
            position: 'relative', display: 'grid', gridTemplateRows: `${RULER_BAND_HEIGHT_PX}px minmax(0, 1fr)`,
            minWidth: '0', minHeight: '0', margin: '2px 6px 2px 0'
        });
        Object.assign(this.rulerBar.style, {
            position: 'relative', minWidth: '0', overflow: 'hidden', background: RULER_BAND_BACKGROUND,
            border: `1px solid ${STRIP_BORDER_COLOR}`, borderBottom: '0', borderRadius: '0 4px 0 0',
            boxSizing: 'border-box', cursor: 'pointer'
        });
        Object.assign(this.rulerContent.style, {
            position: 'absolute', top: '0', left: '0', right: '0', bottom: '0'
        });
        this.strip.classList.add('akari-annotations-strip');
        Object.assign(this.strip.style, {
            position: 'relative', width: '100%', minWidth: '100%',
            border: `1px solid ${STRIP_BORDER_COLOR}`, borderRadius: '0 0 4px 0', boxSizing: 'border-box',
            background: STRIP_BACKGROUND, cursor: 'pointer', overflow: 'hidden'
        });
        Object.assign(this.stripContent.style, {
            position: 'absolute', top: '0', left: '0', right: '0', bottom: '0'
        });
        this.rulerBar.appendChild(this.rulerContent);
        this.strip.appendChild(this.stripContent);
        Object.assign(this.timelineOverlay.style, {
            position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '9'
        });
        Object.assign(this.playhead.style, {
            position: 'absolute', top: '0', bottom: '0', width: '2px',
            background: PLAYHEAD_COLOR, left: '0%', pointerEvents: 'none',
            boxShadow: `0 0 4px 1px ${PLAYHEAD_COLOR}`
        });
        Object.assign(this.playheadHandle.style, {
            position: 'absolute', top: '0', left: '50%', width: '14px', height: '16px',
            transform: 'translateX(-50%)', cursor: 'ew-resize', pointerEvents: 'auto'
        });
        this.playheadHandle.setAttribute('aria-hidden', 'true');
        this.playheadHandle.innerHTML =
            `<svg width="14" height="16" viewBox="0 0 14 16" xmlns="http://www.w3.org/2000/svg">` +
            `<path d="M0 0H14V10L7 16L0 10Z" fill="${PLAYHEAD_COLOR}"/></svg>`;
        this.playheadHandle.addEventListener('pointerdown', event => this.onPlayheadHandlePointerDown(event));
        this.playhead.appendChild(this.playheadHandle);
        Object.assign(this.snapGuide.style, {
            position: 'absolute', top: '0', bottom: '0', width: '1px', display: 'none',
            background: SNAP_GUIDE_COLOR_DEFAULT, pointerEvents: 'none'
        });
        Object.assign(this.dragFeedback.style, {
            position: 'absolute', display: 'none', padding: '2px 6px', fontSize: '10px',
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            color: 'var(--theia-editor-foreground, #fff)',
            background: 'var(--theia-editorHoverWidget-background, rgba(30,30,30,.9))',
            border: '1px solid var(--theia-editorHoverWidget-border, rgba(255,255,255,.2))',
            borderRadius: '3px', pointerEvents: 'none'
        });
        Object.assign(this.trackInsertIndicator.style, {
            position: 'absolute', left: '0', right: '0', height: '2px', display: 'none',
            background: TRACK_INSERT_LINE_COLOR, pointerEvents: 'none', zIndex: '10',
            boxShadow: `0 0 4px 1px ${TRACK_INSERT_LINE_COLOR}`
        });
        this.trackInsertIndicator.dataset.testid = 'akari-track-insert-indicator';
        Object.assign(this.selectionMarquee.style, {
            position: 'absolute', display: 'none', border: '1px solid var(--theia-focusBorder)',
            background: 'color-mix(in srgb, var(--theia-focusBorder) 20%, transparent)',
            pointerEvents: 'none', zIndex: '11', boxSizing: 'border-box'
        });
        // 素材カード D&D の点線ゴースト（司令塔裁定5。旧実装 akari-video-on-os の
        // .output-timeline__ghost を意匠のみ参考にし、座標は本リポの percent() 流儀に合わせる）。
        // 帯アイテムの keyed mount/unmount から独立した永続 UI なので timelineOverlay が所有する
        // （trackInsertIndicator と同じ所有関係）。
        Object.assign(this.materialGhost.style, {
            position: 'absolute', display: 'none', border: '1px dashed #4dd0c8',
            background: 'rgba(77, 208, 200, .22)', borderRadius: '3px',
            pointerEvents: 'none', zIndex: '10', boxSizing: 'border-box'
        });
        this.timelineOverlay.append(
            this.playhead, this.snapGuide, this.dragFeedback, this.trackInsertIndicator, this.selectionMarquee,
            this.materialGhost
        );
        // ㉖ 全域クリックシーク: strip 単体ではなく stripScroll（中央寄せの上下ギャップ・
        // トラック本数不足の余白・黒背景を含む可視領域全体）へバインドする。strip 内の
        // アイテム要素は自前の click ハンドラで stopPropagation 済みのため、ここまで
        // バブってくる click は「クリップ・ハンドル・バッジの外側」に限られる。
        this.stripScroll.addEventListener('click', event => this.onStripClick(event));
        this.strip.addEventListener('pointerdown', () => {
            // 押下位置→時刻の換算は確定済みの幾何を読むため、保留中のズーム描画を先に流す。
            this.flushStripRender();
            this.settlePan();
        }, true);
        this.strip.addEventListener('pointerdown', event => this.onStripPointerDown(event));
        this.strip.addEventListener('wheel', event => this.onWheelZoom(event), { passive: false });
        this.strip.addEventListener('contextmenu', event => {
            const target = event.target instanceof Element ? event.target : undefined;
            const itemElement = target?.closest<HTMLElement>('[data-akari-item-kind]');
            if (itemElement) {
                this.openTimelineClipContextMenu(event, itemElement);
                return;
            }
            this.openAnnotationPopup(event);
        });
        this.rulerBar.addEventListener('click', event => this.onStripClick(event));
        this.rulerBar.addEventListener('wheel', event => this.onWheelZoom(event), { passive: false });
        this.rulerBar.addEventListener('contextmenu', event => this.openAnnotationPopup(event));
        this.trackHeaderColumn.addEventListener('contextmenu', event => this.openTrackContextMenu(event));
        this.trackHeaderColumn.addEventListener('wheel', event => this.onTrackHeaderWheel(event), { passive: false });

        Object.assign(this.stripScroll.style, { minHeight: '0', overflow: 'auto' });
        Object.assign(this.hScrollbarTrack.style, {
            position: 'relative', height: '14px', margin: '0 10px 8px 10px', flex: 'none',
            background: 'var(--theia-scrollbarSlider-background, rgba(121,121,121,.35))',
            borderRadius: '7px', cursor: 'pointer', display: 'none'
        });
        this.hScrollbarTrack.setAttribute('data-testid', 'akari-timeline-hscrollbar-track');
        Object.assign(this.hScrollbarThumb.style, {
            position: 'absolute', top: '2px', bottom: '2px', left: '0%', width: '100%',
            background: 'var(--theia-scrollbarSlider-hoverBackground, rgba(100,100,100,.75))',
            borderRadius: '5px', cursor: 'grab'
        });
        this.hScrollbarThumb.setAttribute('data-testid', 'akari-timeline-hscrollbar-thumb');
        this.hScrollbarTrack.appendChild(this.hScrollbarThumb);
        this.hScrollbarTrack.addEventListener('click', event => this.onScrollbarTrackClick(event));
        this.hScrollbarThumb.addEventListener('pointerdown', event => this.onScrollbarThumbPointerDown(event));
        this.stripScroll.appendChild(this.strip);
        this.stripScroll.addEventListener('scroll', () => {
            this.trackHeaders.style.transform = `translateY(${-this.stripScroll.scrollTop}px)`;
        });
        // 素材カード D&D の受け側 3 点セット（task 2026-08-10-material-dnd-timeline 指示3）。
        // 自 mime（application/x-akari-material）以外は preventDefault/stopPropagation せず
        // 素通しする — 既存のファイルドロップ等（グローバルフォールバック）を壊さない。
        this.stripScroll.addEventListener('dragenter', event => this.handleMaterialDragEnter(event));
        this.stripScroll.addEventListener('dragover', event => this.handleMaterialDragOver(event));
        this.stripScroll.addEventListener('dragleave', event => this.handleMaterialDragLeave(event));
        this.stripScroll.addEventListener('drop', event => this.handleMaterialDrop(event));
        this.stripScroll.addEventListener('dragenter', event => this.handleLibraryTransitionDragEnter(event));
        this.stripScroll.addEventListener('dragover', event => this.handleLibraryTransitionDragOver(event));
        this.stripScroll.addEventListener('dragleave', event => this.handleLibraryTransitionDragLeave(event));
        this.stripScroll.addEventListener('drop', event => this.handleLibraryTransitionDrop(event));
        // ㉕/㉗ 中央寄せギャップはビューポート高（stripScroll.clientHeight）に依存するため、
        // パネルのリサイズ（分割線ドラッグ等）でも再計算されるよう監視する。
        const stripScrollResizeObserver = new ResizeObserver(() => this.renderStrip());
        stripScrollResizeObserver.observe(this.stripScroll);
        this.toDispose.push(Disposable.create(() => stripScrollResizeObserver.disconnect()));
        this.trackHeadersViewport.appendChild(this.trackHeaders);
        this.trackHeaderColumn.append(this.trackHeaderRulerSpacer, this.trackHeadersViewport);
        this.timelineBody.append(this.rulerBar, this.stripScroll, this.timelineOverlay);
        this.timelineViewport.append(this.trackHeaderColumn, this.timelineBody);
        Object.assign(this.footer.style, {
            height: '26px', minHeight: '26px', maxHeight: '26px', padding: '5px 10px', boxSizing: 'border-box',
            borderTop: '1px solid var(--theia-widget-border)', color: 'var(--theia-descriptionForeground)',
            fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        });
        this.footer.textContent = 'タイムラインをクリックすると時刻を選べます。プレビューを開いていればその場でシークします。';

        this.node.append(this.toolbar, this.timelineViewport, this.hScrollbarTrack, this.notice.node, this.footer);
        const style = document.createElement('style');
        style.textContent = `
    .akari-annotations-widget .akari-annotations-strip-clip {
        background: #27272a;
        border-top: 1px solid #3f3f46;
        border-bottom: 1px solid #3f3f46;
        border-left: 1px solid rgba(250, 250, 250, .55);
        border-right: 2px solid #09090b;
        border-radius: 0;
        box-shadow: none;
        box-sizing: border-box;
        color: #e5e5e5;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-header {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: ${CLIP_HEADER_HEIGHT}px;
        background: #2c8a9a;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 4px;
        padding: 1px 3px 0;
        box-sizing: border-box;
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 11px;
        line-height: 12px;
        color: #e5e5e5;
        pointer-events: none;
        overflow: hidden;
        white-space: nowrap;
        z-index: 1;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-header-label,
    .akari-annotations-widget .akari-annotations-strip-clip-header-duration {
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-header-duration {
        flex: none;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-source {
        position: absolute;
        left: 3px;
        bottom: 3px;
        max-width: calc(100% - 6px);
        padding: 1px 4px;
        border-radius: 3px;
        background: rgba(0, 0, 0, .72);
        color: #fff;
        font: 10px/14px ui-monospace, SFMono-Regular, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        pointer-events: none;
        z-index: 1;
    }
    .akari-annotations-widget .akari-annotations-strip-caption {
        background: var(--theia-charts-purple, #b180d7);
        opacity: .68;
        border-radius: 2px;
    }
    .akari-annotations-widget .akari-annotations-tree-tick {
        position: absolute;
        width: 2px;
        height: 5px;
        border-radius: 1px;
        background: rgba(255, 255, 255, .78);
        pointer-events: none;
    }
    .akari-annotations-widget .akari-annotations-strip-overlay {
        background: var(--theia-charts-orange, #d19a66);
        opacity: .74;
        border-radius: 2px;
    }
    .akari-annotations-widget .akari-annotations-strip-layer,
    .akari-annotations-widget .akari-annotations-strip-audio {
        border-radius: 2px;
        cursor: pointer;
    }
    .akari-annotations-widget .akari-annotations-strip-layer-baked {
        background: var(--theia-charts-blue, #3794ff);
        opacity: .76;
    }
    .akari-annotations-widget .akari-annotations-strip-layer-video {
        background: var(--theia-charts-purple, #b180d7);
        opacity: .76;
    }
    .akari-annotations-widget .akari-annotations-strip-audio-sfx {
        background: var(--theia-charts-green, #89d185);
        opacity: .72;
    }
    .akari-annotations-widget .akari-annotations-strip-audio-bgm {
        background: color-mix(in srgb, var(--theia-charts-green, #89d185) 50%, var(--theia-charts-blue, #3794ff));
        opacity: .66;
    }
    .akari-annotations-widget .akari-annotations-strip-audio-narration {
        background: var(--theia-charts-orange, #d18616);
        opacity: .72;
    }
    .akari-annotations-widget .akari-track-band {
        position: absolute;
        left: 0;
        right: 0;
        border-top: 1px solid color-mix(in srgb, var(--theia-widget-border) 55%, transparent);
        pointer-events: none;
    }
    .akari-annotations-widget .akari-beats-band-label {
        position: absolute;
        left: 3px;
        top: 0;
        height: ${SUBROW_HEIGHT}px;
        padding: 0 3px;
        border-radius: 2px;
        background: color-mix(in srgb, ${STRIP_BACKGROUND} 82%, transparent);
        color: var(--theia-descriptionForeground);
        font-size: 9px;
        line-height: ${SUBROW_HEIGHT}px;
        pointer-events: none;
        z-index: 2;
    }
    .akari-annotations-widget .akari-beat-marker {
        position: absolute;
        box-sizing: border-box;
        transform: translateX(-50%) rotate(45deg);
        transform-origin: center;
        border: 1px solid color-mix(in srgb, var(--theia-editorWidget-background) 65%, white);
        box-shadow: 0 0 2px var(--theia-editorWidget-background);
        cursor: default;
        pointer-events: auto;
        z-index: 3;
    }
    .akari-annotations-widget .akari-beat-marker:hover {
        filter: brightness(1.2);
    }
    .akari-annotations-widget .akari-track-band-hidden,
    .akari-annotations-widget .akari-track-band-hidden + .akari-annotations-strip-overlay {
        opacity: .28;
    }
    .akari-annotations-widget .akari-track-header-button {
        width: 18px;
        height: 18px;
        display: grid;
        place-items: center;
        padding: 1px;
        border: 0;
        border-radius: 3px;
        background: transparent;
        color: var(--theia-foreground);
        cursor: pointer;
        flex: none;
    }
    .akari-annotations-widget .akari-track-header-row {
        position: absolute;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        padding: 0 3px;
        border-top: 1px solid color-mix(in srgb, var(--theia-widget-border) 55%, transparent);
        box-sizing: border-box;
        cursor: grab;
        user-select: none;
    }
    .akari-annotations-widget .akari-track-header-trackline {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: ${SUBROW_HEIGHT}px;
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        box-sizing: border-box;
    }
    .akari-annotations-widget .akari-track-header-resize-handle {
        position: absolute;
        left: 0;
        right: 0;
        bottom: -3px;
        height: 6px;
        cursor: ns-resize;
        z-index: 6;
        touch-action: none;
    }
    .akari-annotations-widget .akari-track-header-resize-handle:hover,
    .akari-annotations-widget .akari-track-header-resize-handle:active {
        background: var(--theia-focusBorder);
        opacity: .5;
    }
    .akari-annotations-widget .akari-track-header-icon {
        width: 15px;
        height: 15px;
        display: grid;
        place-items: center;
        color: var(--theia-descriptionForeground);
        flex: none;
    }
    .akari-annotations-widget .akari-track-header-icon svg {
        width: 15px;
        height: 15px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
    }
    .akari-annotations-widget .akari-track-header-name {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        color: var(--theia-foreground);
    }
    .akari-annotations-widget .akari-track-header-name-input {
        min-width: 0;
        width: 100%;
        flex: 1;
        box-sizing: border-box;
        font-size: 11px;
    }
    .akari-annotations-widget [data-akari-locked="true"] {
        cursor: not-allowed !important;
    }
    .akari-annotations-widget [data-akari-locked="true"]::after {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 9;
        background: repeating-linear-gradient(135deg, transparent 0 6px, rgba(255,255,255,.08) 6px 8px);
    }
    .akari-annotations-widget .akari-track-header-drop-target {
        outline: 2px solid var(--theia-focusBorder);
        outline-offset: -2px;
    }
    .akari-annotations-widget .akari-track-header-button[aria-pressed="false"] { opacity: .4; }
    .akari-annotations-widget .akari-track-header-button:hover { background: var(--theia-toolbar-hoverBackground); }
    .akari-annotations-widget .akari-track-header-button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; }
    .akari-annotations-widget .akari-annotations-selected {
        border: 2px solid var(--theia-focusBorder);
        box-sizing: border-box;
        opacity: 1;
        z-index: 5;
    }
    .akari-annotations-widget .akari-timeline-keyframe-property-selected {
        outline: 1px solid var(--theia-focusBorder);
        outline-offset: -1px;
        background: color-mix(in srgb, var(--theia-focusBorder) 22%, transparent);
        color: var(--theia-foreground);
    }
    .akari-annotations-widget .akari-annotations-strip-caption-text {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        line-height: 1;
        color: var(--theia-foreground);
        pointer-events: none;
        padding-left: 3px;
        text-shadow: 0 0 2px var(--theia-editorWidget-background), 0 0 3px var(--theia-editorWidget-background);
    }
    .akari-annotations-widget .akari-annotations-pin {
        position: absolute;
        top: 3px;
        width: 9px;
        height: 9px;
        border-radius: 50% 50% 50% 0;
        transform: translateX(-50%) rotate(-45deg);
        transform-origin: center;
        box-shadow: 0 0 0 1px var(--theia-editorWidget-background);
        cursor: pointer;
        pointer-events: auto;
        z-index: 4;
    }
    .akari-annotations-widget .akari-annotations-pin:hover {
        filter: brightness(1.25);
    }
    .akari-annotations-widget .akari-annotations-pin[data-annotation-status="resolved"] {
        opacity: .55;
    }
    .akari-annotations-widget .akari-annotations-segment-label {
        display: block;
        padding: 1px 3px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--theia-editor-foreground, #fff);
        font-size: 11px;
        line-height: 12px;
        pointer-events: none;
        text-shadow: 0 1px 2px #000;
    }
    .akari-annotations-widget .akari-annotations-selected {
        outline: 2px solid var(--theia-focusBorder, #fff);
        outline-offset: 1px;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, .65);
        z-index: 2;
    }
    .akari-annotations-widget .akari-annotations-strip-clip.akari-annotations-selected {
        outline: 2px solid #f97316;
        outline-offset: -2px;
        border-left: 2px solid #ffffff;
        border-right: 2px solid #ffffff;
        box-shadow: none;
    }
    .akari-annotations-widget .akari-annotations-strip-hit-target::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: calc(-1 * var(--akari-hit-pad-left, 0px));
        right: calc(-1 * var(--akari-hit-pad-right, 0px));
        background: transparent;
        pointer-events: auto;
    }
    .akari-annotations-widget:not(.akari-annotations-tool-razor) .akari-annotations-strip-clip:not([data-akari-locked="true"]):hover::after {
        content: '';
        position: absolute;
        top: 3px;
        bottom: 3px;
        left: 0;
        right: 0;
        border-left: 10px solid rgba(255, 255, 255, .18);
        border-right: 10px solid rgba(255, 255, 255, .18);
        box-sizing: border-box;
        pointer-events: none;
    }
    .akari-annotations-widget:not(.akari-annotations-tool-razor) .akari-annotations-strip-clip-micro:not([data-akari-locked="true"]):hover::after {
        content: none;
        display: none;
    }
    .akari-annotations-widget .akari-annotations-icon-button {
        width: 24px;
        height: 24px;
        min-width: 0;
        padding: 0;
        margin: 0;
        border-radius: 3px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
    }
    .akari-annotations-widget .akari-annotations-text-button {
        min-width: 0;
        height: 24px;
        padding: 0 8px;
        margin: 0;
    }
    .akari-annotations-widget .akari-annotations-icon-button[aria-pressed="true"] {
        background: var(--theia-button-background);
        color: var(--theia-button-foreground);
    }
    .akari-annotations-widget .akari-timeline-focus-breadcrumbs {
        display: flex;
        align-items: center;
        gap: 3px;
        margin: 0 6px;
        color: var(--theia-descriptionForeground);
        font-size: 11px;
    }
    .akari-annotations-widget .akari-timeline-focus-breadcrumb {
        appearance: none;
        min-width: 0;
        height: 24px;
        margin: 0;
        padding: 0 8px;
        border: none;
        border-radius: 3px;
        background: transparent;
        color: var(--theia-descriptionForeground);
        font: inherit;
        cursor: pointer;
    }
    .akari-annotations-widget .akari-timeline-focus-breadcrumb:hover {
        background: var(--theia-toolbar-hoverBackground);
        color: var(--theia-foreground);
    }
    .akari-annotations-widget .akari-timeline-focus-breadcrumb:focus-visible {
        outline: 1px solid var(--theia-focusBorder);
        outline-offset: -1px;
    }
    .akari-annotations-widget .akari-timeline-focus-breadcrumb:last-child {
        color: var(--theia-foreground);
        font-weight: 600;
        pointer-events: none;
        cursor: default;
    }
    .akari-annotations-widget [data-akari-keyframe-t] {
        appearance: none;
        outline: none;
        cursor: pointer;
    }
    .akari-annotations-widget [data-akari-keyframe-t]:hover {
        filter: brightness(1.2);
        box-shadow: 0 0 2px var(--theia-editorWidget-background);
    }
    .akari-annotations-widget [data-akari-keyframe-t]:focus {
        box-shadow: 0 0 0 2px var(--theia-focusBorder);
    }
    .akari-annotations-widget [data-akari-keyframe-t]:active {
        border-color: var(--theia-button-background) !important;
        background: var(--theia-button-background) !important;
    }
    .akari-annotations-widget .akari-annotations-ghost-rejected {
        border-color: #f14c4c !important;
        background: rgba(241, 76, 76, .25) !important;
    }
    .akari-annotations-widget .akari-annotations-ghost-snapped {
        border-color: ${SNAP_GUIDE_COLOR_DEFAULT} !important;
    }
    .akari-annotations-widget .akari-annotations-ghost-duration-warning {
        border-color: #f14c4c !important;
        border-width: 2px !important;
    }
    .akari-annotations-widget .akari-annotations-ghost-output-domain {
        border-color: #a855f7 !important;
        background: rgba(168, 85, 247, .3) !important;
    }
    .akari-annotations-widget .akari-annotations-transition-drop-target {
        position: absolute;
        width: ${TRANSITION_DROP_TARGET_SIZE_PX}px;
        height: ${TRANSITION_DROP_TARGET_SIZE_PX}px;
        transform: translate(-50%, -50%);
        border: 2px dashed ${TRANSITION_BADGE_WARNING_COLOR};
        border-radius: 50%;
        background: rgba(249, 115, 22, .18);
        box-shadow: 0 0 0 4px rgba(249, 115, 22, .10);
        box-sizing: border-box;
        cursor: copy;
        pointer-events: auto;
        z-index: 7;
        transition: transform 80ms ease, background 80ms ease, box-shadow 80ms ease;
    }
    .akari-annotations-widget .akari-annotations-transition-drop-target[data-akari-transition-drop-hover="true"] {
        transform: translate(-50%, -50%) scale(1.16);
        border-style: solid;
        background: rgba(249, 115, 22, .42);
        box-shadow: 0 0 0 6px rgba(249, 115, 22, .22), 0 0 16px rgba(249, 115, 22, .65);
    }
    .akari-annotations-widget .akari-annotations-strip-clip-trimmer-active {
        outline: 2px solid #f97316;
        outline-offset: -2px;
        cursor: grab;
        z-index: 6;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-trimmer-content {
        position: absolute;
        inset: 0;
        overflow: visible;
        pointer-events: none;
    }
    .akari-annotations-widget .akari-annotations-strip-clip-wing {
        position: absolute;
        top: 0;
        height: 100%;
        overflow: hidden;
        opacity: .35;
        pointer-events: none;
    }
`;
        this.node.appendChild(style);

        this.toolbar.title = SHORTCUTS_HELP_TEXT;
        const nudgeSession = new NudgeCommitSession();
        let nudgeValue: { id: string; path: 'transform.x' | 'transform.y'; value: number } | undefined;
        const selectedVisualItemId = (): string | undefined => {
            if (!this.selection || (this.selection.kind !== 'cut' && this.selection.kind !== 'layer'
                && this.selection.kind !== 'overlay' && this.selection.kind !== 'item')) return undefined;
            return this.selection.kind === 'cut' ? this.cutItemId(this.selection.index) : this.selection.id;
        };
        const keyup = (event: KeyboardEvent): void => {
            if (!event.key.startsWith('Arrow')) return;
            nudgeSession.release(value => {
                void this.handleInspectorWrite({ kind: 'item-field', ...value });
            });
            nudgeValue = undefined;
        };
        const keydown = (event: KeyboardEvent): void => {
            // IME 変換中は素のキーを一切ショートカットに使わせない（issue #51）。Escape も変換の取り消しは
            // IME の仕事なので、下の Escape 分岐より前で降りる。ここは window の capture であり、Theia が
            // webview から転送してきた合成 keydown も通る。転送では target が iframe になって
            // isEditableTarget を素通りするため、変換判定が最後の砦になる。
            if (isImeCompositionKeydown(event)) return;
            // キー操作は確定済みの幾何（選択・再生ヘッド位置）を前提にするため、保留中のズーム描画を先に流す。
            this.flushStripRender();
            if (event.key === 'Escape' && this.dragState) {
                event.preventDefault();
                this.cancelDrag(this.dragState);
                return;
            }
            if (event.key === 'Escape' && (this.trimmerItemId !== undefined || this.trimmerAudioId !== undefined)
                && !this.isEditableTarget(event.target) && !this.isEditableTarget(document.activeElement)) {
                event.preventDefault();
                this.exitTrimmerMode();
                this.exitAudioTrimmerMode();
                return;
            }
            if (event.key === 'Escape' && this.focusScope.rootId !== null
                && !this.isEditableTarget(event.target) && !this.isEditableTarget(document.activeElement)) {
                event.preventDefault();
                event.stopPropagation();
                this.applyFocusScope(exitFocusScope(this.expandedTimelineTreeRows, this.focusScope));
                return;
            }
            if (event.key === 'Escape' && this.isAttached && (this.selection || this.multiSelection.length > 0)
                && !this.isEditableTarget(event.target) && !this.isEditableTarget(document.activeElement)
                && !(document.activeElement instanceof HTMLElement
                    && document.activeElement.closest('.akari-inspector-widget'))) {
                event.preventDefault();
                event.stopPropagation();
                this.applySelection(undefined);
                return;
            }
            if (!this.isAttached || this.isEditableTarget(event.target) || this.isEditableTarget(document.activeElement)) {
                return;
            }
            if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectionModel.keyframeSelection) {
                event.preventDefault();
                event.stopPropagation();
                void this.removeSelectedKeyframes();
                return;
            }
            const lowerKey = event.key.toLowerCase();
            if (event.altKey && !event.metaKey && !event.ctrlKey
                && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(lowerKey)) {
                const id = selectedVisualItemId();
                const raw = id ? this.rawV2Item(id) : undefined;
                if (!id || !raw) {
                    if (this.selection) this.showNotice('この操作は v2 のみです。');
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                const path: 'transform.x' | 'transform.y' = lowerKey === 'arrowleft' || lowerKey === 'arrowright'
                    ? 'transform.x' : 'transform.y';
                const field = path.endsWith('.x') ? 'x' : 'y';
                const initial = raw.transform && typeof raw.transform === 'object'
                    && typeof raw.transform[field] === 'number' ? raw.transform[field] as number : 0;
                const current = nudgeValue?.id === id && nudgeValue.path === path ? nudgeValue.value : initial;
                const direction = lowerKey === 'arrowright' || lowerKey === 'arrowdown' ? 1 : -1;
                const value = current + direction * (event.shiftKey ? 10 : 1);
                nudgeValue = { id, path, value };
                nudgeSession.apply(id, path, value);
                if (this.selection?.kind === 'cut') {
                    this.selectionModel.requestLivePreview?.({
                        target: { kind: 'cut', index: this.selection.index }, field, value
                    });
                } else if (this.selection?.kind === 'layer') {
                    this.selectionModel.requestLivePreview?.({
                        target: { kind: 'layer', id: this.selection.id }, field, value
                    });
                }
                return;
            }
            if (!event.altKey && !event.metaKey && !event.ctrlKey && (event.key === ']' || event.key === '[')) {
                event.preventDefault();
                event.stopPropagation();
                const id = selectedVisualItemId();
                if (!id || !Array.isArray(this.editDocument?.tracks)) {
                    if (this.selection) this.showNotice('この操作は v2 のみです。');
                    return;
                }
                const tracks = (this.editDocument.tracks as Array<Record<string, unknown>>).flatMap(track =>
                    typeof track.id === 'string' ? [{
                        id: track.id, lane: track.lane, name: track.name, items: track.items
                    }] : []);
                const plan = planAdjacentVisualTrackMove(tracks, id, event.key === ']' ? 1 : -1);
                if (!plan.targetTrackId || plan.atFrames === undefined) return;
                let createdTrackId: string | undefined;
                void this.commitEditMutation('クリップを前後へ移動', doc => {
                    const result = moveTreeV2Item(
                        doc, id, { track: plan.targetTrackId! }, { at: plan.atFrames! }
                    );
                    createdTrackId = result.createdTrackId;
                    return result.document;
                }).then(() => {
                    if (createdTrackId) {
                        const name = this.computeTrackAutoNames().get(createdTrackId) ?? createdTrackId;
                        this.showNotice(`${name} を追加しました`);
                    } else {
                        this.hideNotice();
                    }
                    this.footer.textContent = 'クリップを前後へ移動しました。';
                }).catch(error => this.showNotice(`移動できません: ${this.errorMessage(error)}`));
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
                event.preventDefault();
                event.stopPropagation();
                if (event.shiftKey) {
                    const id = selectedVisualItemId();
                    if (!id) return;
                    void this.commitEditMutation('ばらす', doc => ungroupTreeV2Item(doc, id).document)
                        .then(() => { this.footer.textContent = 'グループをばらしました。'; })
                        .catch(error => {
                            const detail = this.errorMessage(error);
                            this.showNotice(detail.includes('袋グループ')
                                ? '袋はばらせません。部品を出してください' : `ばらせません: ${detail}`);
                        });
                    return;
                }
                const ids = this.multiSelection.flatMap(item => {
                    if (item.kind === 'cut') return [this.cutItemId(item.index)];
                    return item.kind === 'caption' || item.kind === 'audio' ? [] : [item.id];
                });
                if (ids.length < 2) return;
                let changedOrderIds: string[] = [];
                void this.commitEditMutation('まとめる', doc => {
                    const result = groupTreeV2Items(doc, ids);
                    changedOrderIds = result.value.changedOrderIds;
                    return result.document;
                }).then(() => {
                    if (changedOrderIds.length > 0) {
                        this.showNotice(`${changedOrderIds.join('、')} の前後が変わりました`);
                    } else {
                        this.footer.textContent = 'アイテムをまとめました。';
                    }
                }).catch(error => {
                    const detail = this.errorMessage(error);
                    this.showNotice(detail.includes('同じ場所') ? '先に出してください' : `まとめられません: ${detail}`);
                });
                return;
            }
            if (!event.altKey && !event.metaKey && !event.ctrlKey && (event.key === '\\' || event.key === 'Enter')
                && this.selection?.kind === 'item') {
                const row = event.key === '\\'
                    ? parentRow(this.timelineTreeRows, this.selection.id)
                    : childRow(this.timelineTreeRows, this.selection.id);
                if (!row) return;
                event.preventDefault();
                event.stopPropagation();
                this.applySelection({
                    kind: 'item', id: row.id, itemKind: row.itemKind,
                    parentId: row.parentId, trackId: row.trackId
                });
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
                event.preventDefault();
                event.stopPropagation();
                this.copySelectedItem();
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
                event.preventDefault();
                event.stopPropagation();
                void this.pasteClipboard();
                return;
            }
            if (!event.metaKey && !event.ctrlKey && !event.altKey) {
                const key = event.key.toLowerCase();
                if (key === ' ' || event.code === 'Space') {
                    event.preventDefault();
                    this.togglePreviewPlayback();
                    return;
                }
                if (key === 'a') {
                    event.preventDefault();
                    this.setToolMode('select');
                    return;
                }
                if (key === 'b') {
                    event.preventDefault();
                    this.setToolMode('razor');
                    return;
                }
                if (key === 'n' || key === 'm') {
                    event.preventDefault();
                    this.setSnapEnabled(!this.snapEnabled);
                    return;
                }
                if (key === 'arrowleft' || key === 'arrowright') {
                    event.preventDefault();
                    const direction = key === 'arrowright' ? 1 : -1;
                    const deltaSeconds = event.shiftKey ? 1 : 1 / this.fps;
                    const nextOutputT = Math.min(
                        this.contentEndDuration(),
                        Math.max(0, this.playheadT + direction * deltaSeconds)
                    );
                    this.playheadT = nextOutputT;
                    this.playhead.style.left = `${this.percent(nextOutputT)}%`;
                    this.selectedSourceT = this.outputToSource(nextOutputT);
                    void this.requestSeek(nextOutputT, { domain: 'output' });
                    return;
                }
            }
            if ((event.key === 'Delete' || event.key === 'Backspace')
                && (this.selection || this.multiSelection.length > 0)) {
                event.preventDefault();
                if (this.multiSelection.length > 0) {
                    void this.performDeleteMultiSelected();
                } else {
                    void this.performDeleteSelected();
                }
            }
        };
        // 注釈が増減したらピンを描き直す。パネルの時刻リンクからのジャンプもここで受ける。
        this.toDispose.push(this.review.onChanged(() => this.renderStrip()));
        this.toDispose.push(this.review.onSeekRequested(time => {
            this.selectedSourceT = time;
            this.playheadT = time;
            this.renderStrip();
            void this.requestSeek(time);
        }));
        const requestWrite = (request: InspectorWriteRequest): Promise<InspectorWriteResult> =>
            this.handleInspectorWrite(request);
        this.selectionModel.requestWrite = requestWrite;
        const requestLivePreview = (request: LivePreviewRequest): void => {
            this.dispatchPreviewEvent(TIMELINE_LIVE_TRANSFORM_EVENT, {
                target: request.target,
                field: request.field,
                value: request.value,
                ...(request.easing === undefined ? {} : { easing: request.easing })
            });
        };
        this.selectionModel.requestLivePreview = requestLivePreview;
        let bypass: AdjustBypassRequest | undefined;
        const requestAdjustBypass = (request: AdjustBypassRequest): void => {
            bypass = request.enabled ? request : undefined;
            this.dispatchPreviewEvent(TIMELINE_ADJUST_BYPASS_EVENT, { target: request.target, enabled: request.enabled });
        };
        const requestAdjustLutList = async (): Promise<string[]> => this.location
            ? (await this.annotationsService.listAdjustLuts({ projectRootUri: this.location.root.toString() })).refs : [];
        const requestAdjustLutImport = async (sourcePath: string): Promise<string> => {
            if (!this.location) throw new Error('プロジェクトが開かれていません。');
            return (await this.annotationsService.importAdjustLut({ projectRootUri: this.location.root.toString(), sourcePath })).ref;
        };
        this.selectionModel.requestAdjustBypass = requestAdjustBypass;
        this.selectionModel.requestAdjustLutList = requestAdjustLutList;
        this.selectionModel.requestAdjustLutImport = requestAdjustLutImport;
        this.toDispose.push(Disposable.create(() => {
            if (this.selectionModel.requestAdjustBypass === requestAdjustBypass) {
                if (bypass) requestAdjustBypass({ target: bypass.target, enabled: false });
                this.selectionModel.requestAdjustBypass = undefined;
            }
            if (this.selectionModel.requestAdjustLutList === requestAdjustLutList) this.selectionModel.requestAdjustLutList = undefined;
            if (this.selectionModel.requestAdjustLutImport === requestAdjustLutImport) this.selectionModel.requestAdjustLutImport = undefined;
        }));
        const requestKeyframe = (request: KeyframeControlRequest): Promise<InspectorWriteResult> =>
            this.handleKeyframeControl(request);
        this.selectionModel.requestKeyframe = requestKeyframe;
        this.toDispose.push(this.selectionModel.onChanged(() => this.syncRightPane()));
        this.toDispose.push(Disposable.create(() => {
            if (this.selectionModel.requestWrite === requestWrite as (request: InspectorWriteRequest) => Promise<InspectorWriteResult>) {
                this.selectionModel.requestWrite = undefined;
                this.selectionModel.snapshot = undefined;
            }
            if (this.selectionModel.requestLivePreview === requestLivePreview) {
                this.selectionModel.requestLivePreview = undefined;
            }
            if (this.selectionModel.requestKeyframe === requestKeyframe) {
                this.selectionModel.requestKeyframe = undefined;
            }
        }));

        window.addEventListener('keydown', keydown, true);
        window.addEventListener('keyup', keyup, true);
        this.toDispose.push(Disposable.create(() => {
            window.removeEventListener('keydown', keydown, true);
            window.removeEventListener('keyup', keyup, true);
            this.stripRenderThrottle.cancel();
            this.closeAnnotationPopup();
            if (this.dragState) {
                this.cancelDrag(this.dragState);
            }
        }));

        // 素材カード D&D の window CustomEvent ミラー受信（司令塔裁定4・指示5）。dragover 中は
        // DataTransfer.getData が読めないため、dragstart で受け取ったペイロードをここに保持し、
        // ゴースト計算・実尺プローブに使う。drop 自体は DataTransfer を正として別途 getData する。
        const onMaterialDragStart = (event: Event): void => {
            const payload = parseMaterialDragPayload((event as CustomEvent<unknown>).detail);
            if (!payload) {
                return;
            }
            this.materialDragPayload = payload;
            if (payload.kind === 'video' || payload.kind === 'audio') {
                this.probeMaterialDuration(payload.relativePath);
            }
        };
        window.addEventListener(MATERIAL_DRAG_START_EVENT, onMaterialDragStart);
        this.toDispose.push(Disposable.create(
            () => window.removeEventListener(MATERIAL_DRAG_START_EVENT, onMaterialDragStart)
        ));
        const onMaterialDragEnd = (): void => {
            this.materialDragPayload = undefined;
            this.hideMaterialGhost();
        };
        window.addEventListener(MATERIAL_DRAG_END_EVENT, onMaterialDragEnd);
        this.toDispose.push(Disposable.create(
            () => window.removeEventListener(MATERIAL_DRAG_END_EVENT, onMaterialDragEnd)
        ));

        // ライブラリ D&D のミラー受信。未知 kind / 未知 transition id は純ロジック側で fail-soft に拒否し、
        // 以前の有効ドラッグ状態も残さない。受理時だけ境界受け皿を keyed 描画へ加える。
        const onLibraryDragStart = (event: Event): void => {
            const payload = parseLibraryTransitionDragPayload((event as CustomEvent<unknown>).detail);
            this.setHoveredTransitionDropTarget(undefined);
            if (!payload) {
                this.clearLibraryTransitionDragState();
                return;
            }
            this.libraryDragPayload = payload;
            this.renderStrip();
        };
        const onLibraryDragEnd = (): void => this.clearLibraryTransitionDragState();
        const onWindowLibraryDrop = (): void => {
            if (this.libraryDragPayload) queueMicrotask(() => this.clearLibraryTransitionDragState());
        };
        const onWindowLibraryDragLeave = (event: DragEvent): void => {
            if (!this.libraryDragPayload || event.relatedTarget !== null) return;
            const outsideViewport = event.clientX <= 0 || event.clientY <= 0
                || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
            if (outsideViewport) this.clearLibraryTransitionDragState();
        };
        const onWindowBlur = (): void => this.clearLibraryTransitionDragState();
        window.addEventListener(LIBRARY_DRAG_START_EVENT, onLibraryDragStart);
        window.addEventListener(LIBRARY_DRAG_END_EVENT, onLibraryDragEnd);
        window.addEventListener('drop', onWindowLibraryDrop, true);
        window.addEventListener('dragleave', onWindowLibraryDragLeave, true);
        window.addEventListener('blur', onWindowBlur);
        this.toDispose.push(Disposable.create(() => {
            window.removeEventListener(LIBRARY_DRAG_START_EVENT, onLibraryDragStart);
            window.removeEventListener(LIBRARY_DRAG_END_EVENT, onLibraryDragEnd);
            window.removeEventListener('drop', onWindowLibraryDrop, true);
            window.removeEventListener('dragleave', onWindowLibraryDragLeave, true);
            window.removeEventListener('blur', onWindowBlur);
            this.libraryDragPayload = undefined;
        }));
    }

    protected configureIconButton(button: HTMLButtonElement, icon: string, ariaLabel: string, title: string): void {
        button.type = 'button';
        button.className = 'theia-button secondary akari-annotations-icon-button';
        button.setAttribute('aria-label', ariaLabel);
        button.title = title;
        button.replaceChildren();
        const iconSpan = document.createElement('span');
        iconSpan.className = `codicon ${icon}`;
        iconSpan.setAttribute('aria-hidden', 'true');
        button.appendChild(iconSpan);
    }

    protected createToolbarSeparator(): HTMLDivElement {
        const separator = document.createElement('div');
        Object.assign(separator.style, {
            width: '1px', height: '16px', margin: '0 3px', flex: 'none',
            background: 'var(--theia-widget-border)'
        });
        return separator;
    }

    protected setToolMode(mode: ToolMode): void {
        if (this.toolMode === mode) {
            return;
        }
        this.toolMode = mode;
        this.updateToolModeButtons();
        this.node.classList.toggle('akari-annotations-tool-razor', mode === 'razor');
        this.strip.style.cursor = mode === 'razor' ? 'crosshair' : 'pointer';
        this.renderStrip();
    }

    protected updateToolModeButtons(): void {
        this.selectToolButton.setAttribute('aria-pressed', String(this.toolMode === 'select'));
        this.razorToolButton.setAttribute('aria-pressed', String(this.toolMode === 'razor'));
    }

    protected setSnapEnabled(value: boolean): void {
        this.snapEnabled = value;
        writeStoredSnapEnabled(typeof localStorage === 'undefined' ? undefined : localStorage, value);
        this.updateSnapButton();
        if (!value) {
            this.hideSnapGuide();
        }
        this.footer.textContent = value ? 'マグネット ON（見えている端にだけ吸着します）' : 'マグネット OFF';
    }

    protected updateSnapButton(): void {
        this.snapToggleButton.setAttribute('aria-pressed', String(this.snapEnabled));
    }

    protected isEditableTarget(target: EventTarget | null): boolean {
        const element = target instanceof HTMLElement ? target : null;
        if (element?.closest('.akari-inspector-widget')) return true;
        return isEditableEventTarget(target as HTMLElement | null);
    }

    protected selectionFromDragState(state: DragDetail): TimelineSelection {
        if (state.kind === 'cut-trim' || state.kind === 'cut-move' || state.kind === 'cut-slip') {
            return { kind: 'cut', index: state.index };
        }
        if (state.kind === 'caption') {
            return { kind: 'caption', id: state.id };
        }
        if (state.kind === 'layer') {
            return { kind: 'layer', id: state.id };
        }
        if (state.kind === 'audio' || state.kind === 'audio-trim' || state.kind === 'audio-slip') {
            return { kind: 'audio', id: state.id };
        }
        return { kind: 'overlay', id: state.id };
    }

    protected applySelection(selection: TimelineSelection, notifyPreview = true): void {
        this.exitTrimmerModeUnlessSelected(selection);
        const previous = this.selection;
        const hadMultiSelection = this.multiSelection.length > 0;
        this.multiSelection = [];
        if (this.selectionKey(previous) === this.selectionKey(selection)) {
            if (selection || hadMultiSelection) {
                this.pushSelectionSnapshot();
                this.applySelectionClass();
                this.syncRightPane();
            }
            return;
        }
        this.selection = selection;
        this.pushSelectionSnapshot();
        this.applySelectionClass();
        // オーバーレイ選択はタイムライン⇔プレビューwebviewで双方向同期する（クリップ/字幕には対応先がないため対象外）。
        if (notifyPreview && (previous?.kind === 'overlay' || previous?.kind === 'item'
            || selection?.kind === 'overlay' || selection?.kind === 'item')) {
            window.dispatchEvent(new CustomEvent(TIMELINE_OVERLAY_SELECTED_EVENT, {
                detail: {
                    editUri: this.location?.editUri?.toString() ?? '',
                    overlayId: selection?.kind === 'overlay' || selection?.kind === 'item'
                        ? selection.id : null
                }
            }));
        }
        // CF-select: レイヤー選択も同様に双方向同期する（overlay と同型）。
        if (notifyPreview && (previous?.kind === 'layer' || selection?.kind === 'layer')) {
            window.dispatchEvent(new CustomEvent(TIMELINE_LAYER_SELECTED_EVENT, {
                detail: {
                    editUri: this.location?.editUri?.toString() ?? '',
                    layerId: selection?.kind === 'layer' ? selection.id : null
                }
            }));
        }
        // クリップは同じクリック内の requestSeek が open+seek を直列化する。
        // レイヤー/オーディオはシークを伴わないため reveal コマンドで出力プレビューを開く。
        if (selection?.kind === 'layer' || selection?.kind === 'audio') {
            this.revealOutputPreview();
        }
    }

    protected toggleMultiSelection(item: TimelineSelectionItem): void {
        const candidates = this.multiSelection.length > 0
            ? [...this.multiSelection]
            : this.selection ? [this.selection] : [];
        const key = this.selectionKey(item);
        const index = candidates.findIndex(candidate => this.selectionKey(candidate) === key);
        if (index >= 0) candidates.splice(index, 1);
        else candidates.push(item);
        this.selection = candidates.length === 1 ? candidates[0] : undefined;
        this.multiSelection = candidates.length > 1 ? candidates : [];
        this.pushSelectionSnapshot();
        this.applySelectionClass();
    }

    /**
     * ソーストリマー（R6c-2）: 選択が「トリマー中のクリップ自身」以外に変わったら解除する
     * （「他クリップ選択」「空クリック」の解除経路を選択の一箇所に集約する）。
     * 音声クリップ版トリマー（trimmerAudioId）も同じ集約点で解除する
     * （task 2026-08-18-audio-clip-trimmer-dblclick）。
     */
    protected exitTrimmerModeUnlessSelected(nextSelection: TimelineSelection): void {
        let changed = false;
        if (this.trimmerItemId !== undefined
            && !(nextSelection?.kind === 'cut' && nextSelection.index === this.trimmerItemId)) {
            this.trimmerItemId = undefined;
            changed = true;
        }
        if (this.trimmerAudioId !== undefined
            && !(nextSelection?.kind === 'audio' && nextSelection.id === this.trimmerAudioId)) {
            this.trimmerAudioId = undefined;
            changed = true;
        }
        if (changed) {
            this.renderStrip();
        }
    }

    /**
     * ダブルクリック相当の判定（時間閾値 400ms・位置閾値 6px）。同一クリップに対する
     * 直近クリックの記録は判定のたびに更新する（毎回セットし直すことで 3 回目以降の
     * 連続クリックでも「直前の 1 回」との比較になる）。
     */
    protected detectCutDoubleClick(index: number, clientX: number, clientY: number): boolean {
        const now = Date.now();
        const previous = this.lastCutClick;
        const isDouble = previous !== undefined && previous.index === index
            && now - previous.time < 400
            && Math.abs(clientX - previous.x) <= 6 && Math.abs(clientY - previous.y) <= 6;
        this.lastCutClick = { index, time: now, x: clientX, y: clientY };
        if (isDouble) {
            this.lastCutClick = undefined;
        }
        return isDouble;
    }

    protected detectTreeDoubleClick(id: string, clientX: number, clientY: number): boolean {
        const now = Date.now();
        const previous = this.lastTreeClick;
        const isDouble = previous !== undefined && previous.id === id
            && now - previous.time < 400
            && Math.abs(clientX - previous.x) <= 6 && Math.abs(clientY - previous.y) <= 6;
        this.lastTreeClick = isDouble ? undefined : { id, time: now, x: clientX, y: clientY };
        return isDouble;
    }

    protected enterTreeItem(row: TimelineTreeRow): void {
        if (timelineDoubleClickAction(row.itemKind, row.sourceKind) === 'trimmer') {
            const index = this.cutItemIds.indexOf(row.id);
            if (index >= 0) this.toggleTrimmerMode(index);
            return;
        }
        this.applyFocusScope(enterFocusScope(this.expandedTimelineTreeRows, row.id));
    }

    protected applyFocusScope(scope: FocusScopeState): void {
        this.focusScope = scope;
        if (scope.rootId === null) {
            this.viewStart = 0;
            this.viewDuration = undefined;
            this.dispatchPreviewEvent(TIMELINE_LOOP_RANGE_EVENT, {});
        } else {
            this.viewStart = scope.span.at;
            this.viewDuration = Math.max(1 / this.fps, scope.span.duration);
            this.dispatchPreviewEvent(TIMELINE_LOOP_RANGE_EVENT, {
                start: scope.span.at, end: scope.span.at + scope.span.duration
            });
        }
        this.renderFocusBreadcrumbs();
        this.renderStrip();
    }

    protected renderFocusBreadcrumbs(): void {
        this.toolbar.querySelector('[data-akari-ui="timeline-focus-breadcrumbs"]')?.remove();
        if (this.focusScope.rootId === null) return;
        const breadcrumbs = document.createElement('nav');
        breadcrumbs.className = 'akari-timeline-focus-breadcrumbs';
        breadcrumbs.setAttribute('data-akari-ui', 'timeline-focus-breadcrumbs');
        this.focusScope.breadcrumbs.forEach((label, index) => {
            if (index > 0) breadcrumbs.append('›');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'akari-timeline-focus-breadcrumb';
            button.textContent = label;
            button.dataset.akariFocusCrumb = String(index);
            button.addEventListener('click', () => this.applyFocusScope(focusScopeAtBreadcrumb(
                this.expandedTimelineTreeRows, this.focusScope, index
            )));
            breadcrumbs.appendChild(button);
        });
        this.toolbar.insertBefore(breadcrumbs, this.zoomHud);
    }

    /** クリップ dblclick によるソーストリマーモードの開始/終了トグル（R6 契約 §1 裁定 3）。 */
    protected toggleTrimmerMode(index: number): void {
        if (this.dragState) {
            // ドラッグ中の dblclick は無視（installDragListeners 側の pointerdown 早期 return と対称）。
            return;
        }
        if (this.trimmerItemId === index) {
            this.exitTrimmerMode();
            return;
        }
        const cut = this.cuts[index];
        if (!cut) {
            return;
        }
        const videoUri = this.cutVideoUri(cut);
        if (!videoUri) {
            this.showNotice('素材の場所を特定できないため、ソーストリマーを開けません。');
            return;
        }
        this.trimmerItemId = index;
        this.applySelection({ kind: 'cut', index });
        void this.ensureVideoDurationFetch(videoUri);
        this.renderStrip();
    }

    protected exitTrimmerMode(): void {
        if (this.trimmerItemId === undefined) {
            return;
        }
        this.trimmerItemId = undefined;
        this.renderStrip();
    }

    /**
     * ダブルクリック相当の判定（音声クリップ版・detectCutDoubleClick と同型）。id ベースの
     * 音声クリップ（audio.sfx[].id）向けに直近クリックを記録する。
     */
    protected detectAudioDoubleClick(id: string, clientX: number, clientY: number): boolean {
        const now = Date.now();
        const previous = this.lastAudioClick;
        const isDouble = previous !== undefined && previous.id === id
            && now - previous.time < 400
            && Math.abs(clientX - previous.x) <= 6 && Math.abs(clientY - previous.y) <= 6;
        this.lastAudioClick = { id, time: now, x: clientX, y: clientY };
        if (isDouble) {
            this.lastAudioClick = undefined;
        }
        return isDouble;
    }

    /**
     * 音声クリップ dblclick によるソーストリマーモードの開始/終了トグル（動画クリップの
     * toggleTrimmerMode と同型。R6 契約 §1 裁定 3 を audio.sfx[] へ適用・BGM は対象外）。
     */
    protected toggleAudioTrimmerMode(id: string): void {
        if (this.dragState) {
            // ドラッグ中の dblclick は無視（installDragListeners 側の pointerdown 早期 return と対称）。
            return;
        }
        if (this.trimmerAudioId === id) {
            this.exitAudioTrimmerMode();
            return;
        }
        const sfx = this.audioSfx.find(candidate => candidate.id === id);
        if (!sfx || !this.location?.editUri) {
            return;
        }
        const audioUri = this.resolveEditMediaUri(sfx.path, this.location.editUri).toString();
        this.trimmerAudioId = id;
        this.applySelection({ kind: 'audio', id });
        void this.ensureAudioDurationFetch(sfx.path, audioUri);
        this.renderStrip();
    }

    /** 音声クリップのダブルクリックから、波形上の音量キーフレーム専用画面を開く。 */
    protected async openAudioKeyframeEditor(id: string): Promise<void> {
        if (this.dragState || !this.location?.editUri) return;
        const sfx = this.audioSfx.find(candidate => candidate.id === id);
        const narration = this.audioNarration.find(candidate => candidate.id === id);
        const bgm = id === this.audioBgm?.id ? this.audioBgm : undefined;
        const audioKind = bgm ? 'bgm' as const : narration ? 'narration' as const : sfx ? 'sfx' as const : undefined;
        const audio = bgm ?? narration ?? sfx;
        if (!audioKind || !audio) {
            this.showNotice('音声クリップが見つからないため、音量キーフレームを編集できません。');
            return;
        }
        this.applySelection({ kind: 'audio', id });
        try {
            const audioUri = this.resolveEditMediaUri(audio.path, this.location.editUri).toString();
            const durationResult = await this.ensureAudioDurationFetch(audio.path, audioUri);
            const fallbackDisplayDuration = bgm ? this.contentEndDuration()
                : narration ? this.narrationDisplayDuration(narration) : sfx!.duration;
            const sourceInSeconds = 'in' in audio ? audio.in ?? 0 : 0;
            const fallbackSourceDuration = Math.max(
                'out' in audio ? audio.out ?? 0 : 0,
                sourceInSeconds + fallbackDisplayDuration * (audio.speed ?? 1)
            );
            const sourceDurationSeconds = typeof durationResult === 'number'
                ? durationResult : fallbackSourceDuration;
            const durationSeconds = bgm ? this.contentEndDuration()
                : narration ? this.narrationDisplayDuration(narration)
                    : this.resolveSfxDisplayDuration(sfx!, sourceInSeconds, sourceDurationSeconds);
            const waveformKey = `sfxwave:${audio.path}`;
            let fullPeaks = this.waveformCache.get(waveformKey);
            if (!Array.isArray(fullPeaks) && sourceDurationSeconds > 0) {
                const result = await this.annotationsService.getClipWaveform({
                    projectRootUri: this.location.root.toString(),
                    videoUri: audioUri,
                    startSeconds: 0,
                    endSeconds: sourceDurationSeconds
                });
                if (result.status === 'ready' && result.peaks) {
                    fullPeaks = result.peaks;
                    this.waveformCache.set(waveformKey, result.peaks);
                } else {
                    fullPeaks = 'unavailable';
                    this.waveformCache.set(waveformKey, 'unavailable');
                    this.showFfmpegMissingNotice(result.reason);
                }
            }
            const keyframeFrames = audioKind === 'bgm'
                ? this.editDocument !== undefined
                    && findAudioItemIdByRole(this.editDocument, 'bgm') !== undefined
                : this.rawV2Item(id) !== undefined;
            const dialog = new AkariAudioKeyframeDialog({
                title: `音量キーフレーム — ${this.pathBaseName(audio.path)}`,
                maxWidth: 840,
                audioUri,
                audioKind,
                durationSeconds,
                sourceDurationSeconds,
                sourceInSeconds,
                speed: audio.speed,
                fps: this.fps,
                keyframeFrames,
                keyframes: audio.keyframes,
                gainDb: audio.gainDb,
                fadeIn: 'fadeIn' in audio ? audio.fadeIn : undefined,
                fadeOut: 'fadeOut' in audio ? audio.fadeOut : undefined,
                fullPeaks: Array.isArray(fullPeaks) ? fullPeaks : [],
                fetchWaveform: async request => {
                    const result = await this.annotationsService.getClipWaveform({
                        projectRootUri: this.location!.root.toString(),
                        videoUri: audioUri,
                        startSeconds: request.startSeconds,
                        endSeconds: request.endSeconds,
                        bucketCount: request.bucketCount
                    });
                    return result.status === 'ready' && result.peaks ? result.peaks : undefined;
                }
            });
            const dialogValue = await dialog.open();
            if (dialogValue === undefined) return;
            let keyframeResult: InspectorWriteResult;
            try {
                keyframeResult = await this.handleInspectorWrite({
                    kind: 'audio-keyframes', id, audioKind,
                    value: dialogValue.keyframes.length > 0 ? dialogValue.keyframes : null
                });
            } catch (error) {
                this.showNotice(`音量キーフレームの書き込みに失敗しました: ${this.errorMessage(error)}`);
                return;
            }
            if (!keyframeResult.ok) {
                this.showNotice(`音量キーフレームの書き込みに失敗しました: ${keyframeResult.message ?? '不明なエラー'}`);
                return;
            }
            if (dialogValue.gainDb === (audio.gainDb ?? 0)) return;
            let gainResult: InspectorWriteResult;
            try {
                gainResult = audioKind === 'bgm'
                    ? await this.handleInspectorWrite({ kind: 'bgm-gain', value: dialogValue.gainDb })
                    : audioKind === 'narration'
                        ? await this.handleInspectorWrite({
                            kind: 'narration-gain', id, value: dialogValue.gainDb
                        })
                        : await this.handleInspectorWrite({ kind: 'sfx-gain', id, value: dialogValue.gainDb });
            } catch (error) {
                this.showNotice(`全体ゲインの書き込みに失敗しました: ${this.errorMessage(error)}`);
                return;
            }
            if (!gainResult.ok) {
                this.showNotice(`全体ゲインの書き込みに失敗しました: ${gainResult.message ?? '不明なエラー'}`);
            }
        } catch (error) {
            this.showNotice(`音量キーフレームを開けません: ${this.errorMessage(error)}`);
        }
    }

    protected exitAudioTrimmerMode(): void {
        if (this.trimmerAudioId === undefined) {
            return;
        }
        this.trimmerAudioId = undefined;
        this.renderStrip();
    }

    protected showAudioDurationUnavailableNotice(): void {
        if (!this.audioDurationNoticeShown && !this.notice.hasMessage()) {
            this.showNotice('音声素材の実尺が取得できないため、ソーストリマーを開けません。');
            this.audioDurationNoticeShown = true;
        }
    }

    protected syncRightPane(): void {
        const revision = ++this.rightPaneSyncRevision;
        const showInspector = this.selectionModel.snapshot !== undefined;
        this.rightPaneSyncTail = this.rightPaneSyncTail.then(async () => {
            if (revision !== this.rightPaneSyncRevision) {
                return;
            }
            // キュー待ち中の手動タブ切替を尊重するため、作用させる直前の current を使う。
            const action = resolveRightPaneSyncAction(
                this.shell.rightPanelHandler.tabBar.currentTitle?.owner.id,
                showInspector
            );
            if (action === 'open-inspector') {
                await this.commands.executeCommand(OPEN_AKARI_INSPECTOR_ID);
            } else if (action === 'attach-inspector') {
                // 焦点は奪わずタブとして常駐だけさせる（reveal しない）
                await this.commands.executeCommand(OPEN_AKARI_INSPECTOR_ID, { attachOnly: true });
            } else if (action === 'show-partner') {
                await this.shell.activateWidget(PARTNER_WIDGET_ID);
            }
        }).catch(error => {
            console.warn('[akari-annotations] failed to synchronize the right pane', error);
        });
    }

    protected async handleInspectorWrite(request: InspectorWriteRequest): Promise<InspectorWriteResult> {
        if (request.kind === 'audio-keyframes'
            && audioKeyframeWriteGuard(request.value) === 'too-few') {
            return { ok: false, message: AUDIO_KEYFRAME_MIN_POINTS_NOTICE };
        }
        const location = this.location;
        if (!location) {
            return { ok: false, message: 'プロジェクトの場所を特定できません。' };
        }
        if (request.kind === 'audio-auto-level') {
            return this.handleAudioAutoLevelWrite(request);
        }
        if (request.kind === 'cut-transition-out') {
            if (this.legacyReadOnly || !Array.isArray(this.editDocument?.tracks)) {
                return { ok: false, message: 'この項目の編集は edit.json v2 のみ対応です。' };
            }
            try {
                return await this.applyTransitionOut(request.index, request.value);
            } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        }
        if (request.kind === 'audio-master-enabled' || request.kind === 'audio-master-denoise'
            || request.kind === 'audio-master-loudnorm' || request.kind === 'audio-master-true-peak') {
            return this.handleAudioMasterWrite(request);
        }
        if ((isCutFramingWriteRequest(request) || isCutFreezeWriteRequest(request)) && this.legacyReadOnly) {
            return { ok: false, message: '古い edit.json を読み取り専用で開いているため変更できません。' };
        }
        if (isCutFramingWriteRequest(request) && !Array.isArray(this.editDocument?.tracks)) {
            return this.handleLegacyCutFramingWrite(request);
        }
        if (isCutFreezeWriteRequest(request) && !Array.isArray(this.editDocument?.tracks)) {
            return this.handleLegacyCutFreezeWrite(request);
        }
        const v2Result = await this.handleInspectorWriteV2(request);
        if (v2Result) return v2Result;
        if (request.kind === 'audio-clip-fx') return this.handleAudioClipFxWrite(request);
        try {
            switch (request.kind) {
                case 'caption-text':
                case 'caption-speaker': {
                    const captionsUri = location.captionsUri.toString();
                    const projectRootUri = location.root.toString();
                    const caption = this.captions.find(candidate => candidate.id === request.id);
                    if (!caption) {
                        throw new Error(`字幕 ${request.id} が見つかりません。`);
                    }
                    const originalText = caption.text;
                    const originalSpeaker = caption.speaker;
                    const nextText = request.kind === 'caption-text' ? request.value : undefined;
                    const nextSpeaker = request.kind === 'caption-speaker' ? request.value : undefined;
                    await this.annotationsService.setCaptionFields({
                        captionsUri,
                        projectRootUri,
                        captionId: request.id,
                        text: nextText,
                        speaker: nextSpeaker
                    });
                    this.pushHistory({
                        label: request.kind === 'caption-text' ? '字幕のテキストを変更' : '字幕の話者を変更',
                        undo: async () => {
                            await this.annotationsService.setCaptionFields({
                                captionsUri,
                                projectRootUri,
                                captionId: request.id,
                                text: request.kind === 'caption-text' ? originalText : undefined,
                                speaker: request.kind === 'caption-speaker' ? originalSpeaker : undefined
                            });
                            await this.reloadCaptions();
                        },
                        redo: async () => {
                            await this.annotationsService.setCaptionFields({
                                captionsUri,
                                projectRootUri,
                                captionId: request.id,
                                text: nextText,
                                speaker: nextSpeaker
                            });
                            await this.reloadCaptions();
                        }
                    });
                    await this.reloadCaptions();
                    this.hideNotice();
                    this.footer.textContent = '字幕を更新しました。';
                    return { ok: true };
                }
                case 'caption-style-color':
                case 'caption-style-size':
                case 'caption-style-stroke-color':
                case 'caption-style-stroke-width':
                case 'caption-style-bg-color':
                case 'caption-style-bg-opacity':
                case 'caption-style-bg-radius':
                case 'caption-style-bg-mode':
                case 'caption-style-zone': {
                    const captionsUri = location.captionsUri.toString();
                    const projectRootUri = location.root.toString();
                    let nextStyle: CaptionTextStylePatch;
                    switch (request.kind) {
                        case 'caption-style-color':
                            nextStyle = { color: request.value };
                            break;
                        case 'caption-style-size':
                            nextStyle = { sizePx: request.value };
                            break;
                        case 'caption-style-stroke-color':
                            nextStyle = { stroke: { color: request.value } };
                            break;
                        case 'caption-style-stroke-width':
                            nextStyle = { stroke: { widthPx: request.value } };
                            break;
                        case 'caption-style-bg-color':
                            nextStyle = { background: { color: request.value } };
                            break;
                        case 'caption-style-bg-opacity':
                            nextStyle = { background: { opacity: request.value } };
                            break;
                        case 'caption-style-bg-radius':
                            nextStyle = { background: { radiusPx: request.value } };
                            break;
                        case 'caption-style-bg-mode':
                            nextStyle = { background: { mode: request.value } };
                            break;
                        case 'caption-style-zone':
                            nextStyle = { zone: request.value };
                            break;
                    }
                    const targetIds = request.targets
                        ? request.targets.flatMap(target => target.kind === 'caption' ? [target.id] : [])
                        : [request.id];
                    if (request.targets && targetIds.length !== request.targets.length) {
                        throw new Error('字幕スタイルの一括編集対象に字幕以外が含まれています。');
                    }
                    const uniqueTargetIds = [...new Set(targetIds)];
                    const captions = uniqueTargetIds.map(id => {
                        const caption = this.captions.find(candidate => candidate.id === id);
                        if (!caption) {
                            throw new Error(`字幕 ${id} が見つかりません。`);
                        }
                        return caption;
                    });
                    const originalStyles = captions.map(caption => {
                        let originalStyle: CaptionTextStylePatch;
                        switch (request.kind) {
                            case 'caption-style-color':
                                originalStyle = { color: caption.textStyle?.color ?? null };
                                break;
                            case 'caption-style-size':
                                originalStyle = { sizePx: caption.textStyle?.sizePx ?? null };
                                break;
                            case 'caption-style-stroke-color':
                                originalStyle = { stroke: { color: caption.textStyle?.stroke?.color ?? null } };
                                break;
                            case 'caption-style-stroke-width':
                                originalStyle = { stroke: { widthPx: caption.textStyle?.stroke?.widthPx ?? null } };
                                break;
                            case 'caption-style-bg-color':
                                originalStyle = {
                                    background: { color: caption.textStyle?.background?.color ?? null }
                                };
                                break;
                            case 'caption-style-bg-opacity':
                                originalStyle = {
                                    background: { opacity: caption.textStyle?.background?.opacity ?? null }
                                };
                                break;
                            case 'caption-style-bg-radius':
                                originalStyle = {
                                    background: { radiusPx: caption.textStyle?.background?.radiusPx ?? null }
                                };
                                break;
                            case 'caption-style-bg-mode':
                                originalStyle = {
                                    background: { mode: caption.textStyle?.background?.mode ?? null }
                                };
                                break;
                            case 'caption-style-zone':
                                originalStyle = { zone: caption.textStyle?.zone ?? null };
                                break;
                        }
                        return { id: caption.id, style: originalStyle };
                    });
                    const applyStyles = async (
                        styles: ReadonlyArray<{ id: string; style: CaptionTextStylePatch }>
                    ): Promise<void> => {
                        for (const entry of styles) {
                            await this.annotationsService.setCaptionTextStyle({
                                captionsUri,
                                projectRootUri,
                                captionId: entry.id,
                                textStyle: entry.style
                            });
                        }
                    };
                    const nextStyles = captions.map(caption => ({ id: caption.id, style: nextStyle }));
                    await applyStyles(nextStyles);
                    this.pushHistory({
                        label: '字幕のスタイルを変更',
                        undo: async () => {
                            await applyStyles(originalStyles);
                            await this.reloadCaptions();
                        },
                        redo: async () => {
                            await applyStyles(nextStyles);
                            await this.reloadCaptions();
                        }
                    });
                    await this.reloadCaptions();
                    this.hideNotice();
                    this.footer.textContent = '字幕のスタイルを更新しました。';
                    return { ok: true };
                }
                case 'bgm-duck-db':
                case 'bgm-duck-attack':
                case 'bgm-duck-release':
                case 'sfx-ducking':
                case 'sfx-duck-db':
                case 'sfx-duck-attack':
                case 'sfx-duck-release':
                case 'audio-keyframes': {
                    if (!location.editUri) throw new Error('edit.json がありません。');
                    const editUri = location.editUri.toString();
                    const projectRootUri = location.root.toString();
                    const audioKind = request.kind === 'audio-keyframes'
                        ? request.audioKind : request.kind.startsWith('bgm-') ? 'bgm' : 'sfx';
                    const index = audioKind === 'sfx'
                        ? this.audioSfx.findIndex(item => item.id === ('id' in request ? request.id : ''))
                        : audioKind === 'narration'
                            ? this.audioNarration.findIndex(item => item.id === ('id' in request ? request.id : ''))
                            : -1;
                    if (audioKind !== 'bgm' && index < 0) throw new Error('音声クリップが見つかりません。');
                    const target = audioKind === 'bgm'
                        ? { kind: 'bgm' as const }
                        : { kind: audioKind, index } as { kind: 'sfx' | 'narration'; index: number };
                    const current = audioKind === 'bgm' ? this.audioBgm
                        : audioKind === 'sfx' ? this.audioSfx[index] : this.audioNarration[index];
                    if (!current) throw new Error('音声クリップが見つかりません。');
                    if (request.kind === 'audio-keyframes') {
                        const before = current.keyframes ?? null;
                        const apply = async (keyframes: AudioEnvelopeKeyframePayload[] | null): Promise<void> => {
                            await this.annotationsService.setAudioKeyframes({
                                editUri, projectRootUri, target,
                                keyframes: keyframes?.map(point => ({
                                    t: point.t,
                                    gain_db: point.gain_db ?? 0,
                                    ...(typeof point.easing === 'string' ? { easing: point.easing } : {})
                                })) ?? null
                            });
                        };
                        await apply(request.value);
                        this.pushHistory({
                            label: '音量キーフレームを変更',
                            undo: async () => { await apply(before); await this.reloadEdit(); },
                            redo: async () => { await apply(request.value); await this.reloadEdit(); }
                        });
                    } else {
                        const field = request.kind.endsWith('duck-db') ? 'duckDb'
                            : request.kind.endsWith('duck-attack') ? 'duckAttack'
                                : request.kind.endsWith('duck-release') ? 'duckRelease' : 'ducking';
                        const beforeValue = current[field as 'ducking' | 'duckDb' | 'duckAttack' | 'duckRelease'] ?? null;
                        const updates = { [field]: request.value };
                        const beforeUpdates = { [field]: beforeValue };
                        const duckTarget = target as { kind: 'bgm' } | { kind: 'sfx'; index: number };
                        const apply = async (value: typeof updates): Promise<void> => {
                            await this.annotationsService.setAudioDuck({
                                editUri, projectRootUri, target: duckTarget, updates: value
                            });
                        };
                        await apply(updates);
                        this.pushHistory({
                            label: '音声のダッキングを変更',
                            undo: async () => { await apply(beforeUpdates); await this.reloadEdit(); },
                            redo: async () => { await apply(updates); await this.reloadEdit(); }
                        });
                    }
                    await this.reloadEdit();
                    this.hideNotice();
                    this.footer.textContent = request.kind === 'audio-keyframes'
                        ? '音量キーフレームを変更しました。' : 'ダッキングを変更しました。';
                    return { ok: true };
                }
                case 'bgm-gain':
                case 'bgm-fade-in':
                case 'bgm-fade-out':
                case 'bgm-ducking': {
                    if (!location.editUri) {
                        throw new Error('edit.json がありません。');
                    }
                    const editUri = location.editUri.toString();
                    const projectRootUri = location.root.toString();
                    const bgm = this.audioBgm;
                    if (!bgm) {
                        throw new Error('BGM が見つかりません。');
                    }
                    const originalGainDb = bgm.gainDb ?? null;
                    const originalFadeIn = bgm.fadeIn ?? null;
                    const originalFadeOut = bgm.fadeOut ?? null;
                    const originalDucking = bgm.ducking ?? null;
                    const nextFields = {
                        gainDb: request.kind === 'bgm-gain' ? request.value : undefined,
                        fadeIn: request.kind === 'bgm-fade-in' ? request.value : undefined,
                        fadeOut: request.kind === 'bgm-fade-out' ? request.value : undefined,
                        ducking: request.kind === 'bgm-ducking' ? request.value : undefined
                    };
                    const originalFields = {
                        gainDb: request.kind === 'bgm-gain' ? originalGainDb : undefined,
                        fadeIn: request.kind === 'bgm-fade-in' ? originalFadeIn : undefined,
                        fadeOut: request.kind === 'bgm-fade-out' ? originalFadeOut : undefined,
                        ducking: request.kind === 'bgm-ducking' ? originalDucking : undefined
                    };
                    const rawBgmItemId = this.editDocument
                        ? findAudioItemIdByRole(this.editDocument, 'bgm') : undefined;
                    if (rawBgmItemId !== undefined) {
                        const itemPatch = request.kind === 'bgm-gain'
                            ? { gain_db: request.value }
                            : request.kind === 'bgm-fade-in'
                                ? { fade_in: request.value }
                                : request.kind === 'bgm-fade-out'
                                    ? { fade_out: request.value }
                                    : { ducking: request.value };
                        await this.commitEditMutation('BGM の設定を変更', doc => {
                            const itemId = findAudioItemIdByRole(doc, 'bgm');
                            if (!itemId) throw new Error('BGM の item が見つかりません。');
                            return updateV2Item(doc, { itemId, patch: itemPatch });
                        });
                        this.hideNotice();
                        this.footer.textContent = 'BGM の設定を変更しました。';
                        return { ok: true };
                    }
                    await this.annotationsService.setBgmFields({ editUri, projectRootUri, ...nextFields });
                    this.pushHistory({
                        label: 'BGM の設定を変更',
                        undo: async () => {
                            await this.annotationsService.setBgmFields({
                                editUri,
                                projectRootUri,
                                ...originalFields
                            });
                            await this.reloadEdit();
                        },
                        redo: async () => {
                            await this.annotationsService.setBgmFields({
                                editUri,
                                projectRootUri,
                                ...nextFields
                            });
                            await this.reloadEdit();
                        }
                    });
                    await this.reloadEdit();
                    this.hideNotice();
                    this.footer.textContent = 'BGM の設定を変更しました。';
                    return { ok: true };
                }
                default:
                    return { ok: false, message: '未対応の編集要求です。' };
            }
        } catch (error) {
            return { ok: false, message: this.errorMessage(error) };
        }
    }

    protected async handleAudioAutoLevelWrite(
        request: Extract<InspectorWriteRequest, { kind: 'audio-auto-level' }>
    ): Promise<InspectorWriteResult> {
        const location = this.location;
        if (!location?.editUri) return { ok: false, message: 'edit.json がありません。' };
        try {
            const current = request.audioKind === 'bgm' ? this.audioBgm
                : request.audioKind === 'narration'
                    ? this.audioNarration.find(item => item.id === request.id)
                    : this.audioSfx.find(item => item.id === request.id);
            if (!current) throw new Error('音声クリップが見つかりません。');
            const rawItemId = request.audioKind === 'bgm' && this.editDocument
                ? findAudioItemIdByRole(this.editDocument, 'bgm') : request.id;
            const raw = rawItemId ? this.rawV2Item(rawItemId) : undefined;
            const measured = await this.annotationsService.measureAudioForLevel({
                projectRoot: location.root.path.fsPath(),
                audioPath: this.resolveEditMediaUri(current.path, location.editUri).path.fsPath(),
                ...(typeof raw?.role === 'string' ? { role: raw.role } : {}),
                collection: request.audioKind,
                durationSec: request.audioKind === 'bgm'
                    ? this.contentEndDuration()
                    : request.audioKind === 'narration'
                        ? this.narrationDisplayDuration(current as EditAudioNarrationWithEnvelope)
                        : (current as EditAudioSfxWithFade).duration
            });
            if ('reason' in measured) {
                const message = `自動レベルを適用できませんでした（${measured.reason}）。gain は手動で調整してください`;
                this.footer.textContent = message;
                return { ok: false, message };
            }
            await this.commitEditMutation('自動レベル', doc => {
                if (request.audioKind === 'bgm') {
                    const itemId = findAudioItemIdByRole(doc, 'bgm');
                    if (itemId) return updateV2Item(doc, { itemId, patch: { gain_db: measured.gain_db } });
                    const value = { ...doc } as Record<string, any>;
                    const audio = value.audio && typeof value.audio === 'object' ? { ...value.audio } : {};
                    audio.bgm = { ...(audio.bgm ?? {}), gain_db: measured.gain_db };
                    return { ...value, audio };
                }
                return request.audioKind === 'narration'
                    ? updateAudioNarrationGainPreferV2(doc, {
                        narrationId: request.id, gainDb: measured.gain_db
                    })
                    : updateAudioSfxPreferV2(doc, {
                        sfxId: request.id,
                        itemPatch: { gain_db: measured.gain_db },
                        legacyPatch: { gain_db: measured.gain_db }
                    });
            });
            this.hideNotice();
            this.footer.textContent = `自動レベル: ${measured.gain_db.toFixed(1)} dB（${measured.basis}・${measured.role}）`;
            return { ok: true };
        } catch (error) {
            const message = this.errorMessage(error);
            return { ok: false, message };
        }
    }

    protected rawV2Item(itemId: string): Record<string, any> | undefined {
        if (!Array.isArray(this.editDocument?.tracks)) return undefined;
        for (const track of this.editDocument!.tracks as Array<Record<string, any>>) {
            const item = Array.isArray(track.items)
                ? track.items.find((candidate: Record<string, unknown>) => candidate?.id === itemId)
                : undefined;
            if (item) return item;
        }
        return undefined;
    }

    protected async handleLegacyCutFramingWrite(
        request: CutFramingWriteRequest
    ): Promise<InspectorWriteResult> {
        const editUri = this.location?.editUri;
        if (!editUri) return { ok: false, message: 'edit.json がありません。' };
        try {
            const before = (await this.fileService.readFile(editUri)).value.toString();
            const document = JSON.parse(before) as Record<string, any>;
            const cut = Array.isArray(document.cuts) ? document.cuts[request.index] : undefined;
            if (!cut || typeof cut !== 'object' || Array.isArray(cut)) {
                throw new Error(`クリップ ${request.index + 1} が見つかりません。`);
            }
            const framing = updateCutFraming(cut.framing, request);
            if (JSON.stringify(cut.framing ?? null) === JSON.stringify(framing)) {
                return { ok: true };
            }
            if (framing) cut.framing = framing;
            else delete cut.framing;
            const after = `${JSON.stringify(document, null, 2)}\n`;
            await this.writeEditSnapshotGuarded(after);
            const label = request.kind === 'cut-framing-keyframes'
                ? 'ズーム KF を変更' : 'フレーミング窓を変更';
            this.pushHistory({
                label,
                undo: async () => {
                    await this.writeEditSnapshotGuarded(before);
                    await this.reloadEdit();
                },
                redo: async () => {
                    await this.writeEditSnapshotGuarded(after);
                    await this.reloadEdit();
                }
            });
            await this.reloadEdit();
            this.hideNotice();
            this.footer.textContent = `${label}しました。`;
            return { ok: true };
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`変更できません: ${detail}`);
            return { ok: false, message: detail };
        }
    }

    protected async handleLegacyCutFreezeWrite(
        request: CutFreezeWriteRequest
    ): Promise<InspectorWriteResult> {
        const editUri = this.location?.editUri;
        if (!editUri) return { ok: false, message: 'edit.json がありません。' };
        try {
            const before = (await this.fileService.readFile(editUri)).value.toString();
            const document = JSON.parse(before) as Record<string, any>;
            const cut = Array.isArray(document.cuts) ? document.cuts[request.index] : undefined;
            if (!cut || typeof cut !== 'object' || Array.isArray(cut)) {
                throw new Error(`クリップ ${request.index + 1} が見つかりません。`);
            }
            const playbackDuration = cutPlaybackDuration(cut);
            const displayedAt = resolveCutFreezeDisplayAt(
                cut.freeze,
                this.playheadT,
                this.segments[request.index]?.tlStart ?? 0,
                playbackDuration
            );
            const freeze = updateCutFreeze(cut.freeze, request, displayedAt, playbackDuration);
            if (freeze && isExplicitV0CutTimeline(cut, document.version)) {
                throw new Error('明示 at/track を使う edit.json v0 ではフリーズを設定できません。');
            }
            if (JSON.stringify(cut.freeze ?? null) === JSON.stringify(freeze)) {
                return { ok: true };
            }
            if (freeze) cut.freeze = freeze;
            else delete cut.freeze;
            const after = `${JSON.stringify(document, null, 2)}\n`;
            await this.writeEditSnapshotGuarded(after);
            const label = 'フリーズを変更';
            this.pushHistory({
                label,
                undo: async () => {
                    await this.writeEditSnapshotGuarded(before);
                    await this.reloadEdit();
                },
                redo: async () => {
                    await this.writeEditSnapshotGuarded(after);
                    await this.reloadEdit();
                }
            });
            await this.reloadEdit();
            this.hideNotice();
            this.footer.textContent = `${label}しました。`;
            return { ok: true };
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`変更できません: ${detail}`);
            return { ok: false, message: detail };
        }
    }

    protected async handleAudioClipFxWrite(request: AudioClipFxWriteRequest): Promise<InspectorWriteResult> {
        if (this.legacyReadOnly) {
            return { ok: false, message: '古い edit.json を読み取り専用で開いているため変更できません。' };
        }
        const editUri = this.location?.editUri;
        if (!editUri) return { ok: false, message: 'edit.json がありません。' };
        const label = '音声クリップのエフェクトを変更';
        try {
            if (this.editDocument?.version === 2) {
                await this.commitEditMutation(label, doc => updateAudioClipFxDocument(doc, request));
            } else {
                const before = (await this.fileService.readFile(editUri)).value.toString();
                const updated = updateAudioClipFxDocument(JSON.parse(before), request);
                const after = `${JSON.stringify(updated, null, 2)}\n`;
                if (after !== before) {
                    await this.writeEditSnapshotGuarded(after);
                    this.pushHistory({
                        label,
                        undo: async () => {
                            await this.writeEditSnapshotGuarded(before);
                            await this.reloadEdit();
                        },
                        redo: async () => {
                            await this.writeEditSnapshotGuarded(after);
                            await this.reloadEdit();
                        }
                    });
                    await this.reloadEdit();
                }
            }
            this.hideNotice();
            this.footer.textContent = `${label}しました。`;
            return { ok: true };
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`変更できません: ${detail}`);
            return { ok: false, message: detail };
        }
    }

    protected async handleAudioMasterWrite(request: AudioMasterWriteRequest): Promise<InspectorWriteResult> {
        const editUri = this.location?.editUri;
        if (!editUri) return { ok: false, message: 'edit.json がありません。' };
        try {
            const before = (await this.fileService.readFile(editUri)).value.toString();
            const document = JSON.parse(before) as Record<string, unknown>;
            const updated = updateAudioMasterDocument(document, request);
            const after = `${JSON.stringify(updated, null, 2)}\n`;
            if (after !== before) {
                await this.writeEditSnapshotGuarded(after);
                this.pushHistory({
                    label: '音声マスターを変更',
                    undo: async () => {
                        await this.writeEditSnapshotGuarded(before);
                        await this.reloadEdit();
                    },
                    redo: async () => {
                        await this.writeEditSnapshotGuarded(after);
                        await this.reloadEdit();
                    }
                });
                await this.reloadEdit();
            }
            this.hideNotice();
            this.footer.textContent = '音声マスターを変更しました。';
            return { ok: true };
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`変更できません: ${detail}`);
            return { ok: false, message: detail };
        }
    }

    protected async handleInspectorWriteV2(
        request: InspectorWriteRequest
    ): Promise<InspectorWriteResult | undefined> {
        if (request.kind === 'audio-clip-fx') {
            return this.editDocument?.version === 2 ? this.handleAudioClipFxWrite(request) : undefined;
        }
        if (request.kind === 'audio-auto-level') return undefined;
        const cutKinds = new Set([
            'cut-speed', 'cut-audio-gain', 'cut-audio-mute', 'cut-transform-x', 'cut-transform-y', 'cut-scale', 'cut-rotate',
            'cut-opacity', 'cut-source-in', 'cut-source-out',
            'cut-framing-crop-x', 'cut-framing-crop-y',
            'cut-framing-crop-w', 'cut-framing-crop-h', 'cut-framing-keyframes',
            'cut-freeze-at', 'cut-freeze-duration'
        ]);
        const layerKinds = new Set([
            'layer-transform-x', 'layer-transform-y', 'layer-scale', 'layer-rotate',
            'layer-crop-x', 'layer-crop-y', 'layer-crop-w', 'layer-crop-h',
            'layer-opacity', 'layer-blend'
        ]);
        const envelopeKinds = new Set([
            'bgm-duck-db', 'bgm-duck-attack', 'bgm-duck-release',
            'sfx-ducking', 'sfx-duck-db', 'sfx-duck-attack', 'sfx-duck-release',
            'audio-keyframes'
        ]);
        if (!cutKinds.has(request.kind) && !layerKinds.has(request.kind)
            && request.kind !== 'sfx-gain' && request.kind !== 'sfx-fade-in'
            && request.kind !== 'sfx-fade-out' && request.kind !== 'narration-gain'
            && request.kind !== 'overlay-var' && request.kind !== 'item-field'
            && !envelopeKinds.has(request.kind)) {
            return undefined;
        }
        const legacyDocument = this.legacyReadOnly || !Array.isArray(this.editDocument?.tracks);
        if (legacyDocument && (isCutFramingWriteRequest(request) || isCutFreezeWriteRequest(request))) return undefined;
        if (envelopeKinds.has(request.kind)) {
            if (legacyDocument || this.editDocument?.version !== 2) return undefined;
            const bgmRequest = request.kind.startsWith('bgm-')
                || (request.kind === 'audio-keyframes' && request.audioKind === 'bgm');
            if (bgmRequest && !findAudioItemIdByRole(this.editDocument, 'bgm')) return undefined;
        }
        if (request.kind === 'item-field' && legacyDocument) {
            const cutIndex = this.cutItemIds.indexOf(request.id);
            const mappedKind = legacyTransformOpFor(request.path, cutIndex >= 0 ? 'cut' : 'layer');
            if (!mappedKind) {
                return { ok: false, message: 'この項目の編集は edit.json v2 のみ対応です。' };
            }
            return cutIndex >= 0
                ? this.handleInspectorWriteV2({
                    kind: mappedKind as 'cut-scale' | 'cut-rotate',
                    index: cutIndex,
                    value: request.value as number | null
                })
                : this.handleInspectorWriteV2({
                    kind: mappedKind as 'layer-scale' | 'layer-rotate',
                    id: request.id,
                    value: request.value as number | null
                });
        }
        try {
            let label = 'クリップを変更';
            let itemId: string;
            let patch: Record<string, unknown>;
            let audioPatch = false;
            let audioEnvelopeRole: 'bgm' | 'sfx' | 'narration' | undefined;
            let needsTelopRebake = false;
            if (request.kind === 'audio-keyframes') {
                audioEnvelopeRole = request.audioKind;
                itemId = request.audioKind === 'bgm'
                    ? findAudioItemIdByRole(this.editDocument!, 'bgm')! : request.id;
                patch = { keyframes: request.value };
                label = '音量キーフレームを変更';
            } else if (request.kind === 'bgm-duck-db' || request.kind === 'bgm-duck-attack'
                || request.kind === 'bgm-duck-release') {
                audioEnvelopeRole = 'bgm';
                itemId = findAudioItemIdByRole(this.editDocument!, 'bgm')!;
                const field = request.kind === 'bgm-duck-db' ? 'duck_db'
                    : request.kind === 'bgm-duck-attack' ? 'duck_attack' : 'duck_release';
                patch = { [field]: request.value };
                label = 'BGM のダッキングを変更';
            } else if (request.kind === 'sfx-ducking' || request.kind === 'sfx-duck-db'
                || request.kind === 'sfx-duck-attack' || request.kind === 'sfx-duck-release') {
                audioEnvelopeRole = 'sfx';
                itemId = request.id;
                const field = request.kind === 'sfx-ducking' ? 'ducking'
                    : request.kind === 'sfx-duck-db' ? 'duck_db'
                        : request.kind === 'sfx-duck-attack' ? 'duck_attack' : 'duck_release';
                patch = { [field]: request.value };
                label = '音声クリップのダッキングを変更';
            } else if (request.kind === 'item-field') {
                itemId = request.id;
                const raw = this.rawKeyframeItem(itemId);
                if (!raw) throw new Error(`クリップが見つかりません: ${itemId}`);
                if (request.path.startsWith('transform.')) {
                    const field = request.path.slice('transform.'.length);
                    const transform = { ...(raw.transform ?? {}), [field]: request.value };
                    if (request.value === null) delete transform[field];
                    patch = { transform };
                    label = 'クリップの変形を変更';
                } else if (request.path.startsWith('crop.')) {
                    const field = request.path.slice('crop.'.length) as InspectorCropAxis;
                    patch = { crop: updateInspectorCrop(raw.crop, field, request.value as number | null) };
                    label = 'クリップのクロップを変更';
                } else if (request.path === 'mask') {
                    const value = request.value;
                    if (raw.source?.kind !== 'media') throw new Error('media item だけが指定できます');
                    if (value !== null && typeof value !== 'string') throw new Error('mask は sources の id で指定してください');
                    if (typeof value === 'string' && !this.sourceMap.has(value)) {
                        return { ok: false, message: 'sources に無い id です' };
                    }
                    patch = { mask: value };
                    label = 'クリップのマスクを変更';
                } else if (request.path === 'motion') {
                    const value = request.value;
                    if (raw.source?.kind === 'html') throw new Error('HTML 部品の動きはパラメータから変更してください。');
                    validateInspectorMotion(value, raw.duration);
                    patch = { motion: value };
                    label = 'クリップの動きを変更';
                } else if (request.path === 'perspective') {
                    const value = request.value;
                    if (value !== null) {
                        validateInspectorPerspective(
                            typeof value === 'object' && 'corners' in value ? value.corners : undefined
                        );
                    }
                    patch = { perspective: value };
                    label = 'クリップのパースを変更';
                } else if (request.path === 'adjust' || request.path.startsWith('adjust.')) {
                    patch = {
                        adjust: updateInspectorAdjust(
                            raw.adjust,
                            request.path as InspectorAdjustPath,
                            request.value as InspectorAdjustValue
                        )
                    };
                    label = 'クリップの調整を変更';
                } else if (request.path.startsWith('source.vars.')) {
                    const name = request.path.slice('source.vars.'.length);
                    patch = {
                        source: { vars: { ...(raw.source?.vars ?? {}), [name]: request.value } }
                    };
                    label = 'クリップのパラメータを変更';
                } else if (request.path.startsWith('source.params.')) {
                    const name = request.path.slice('source.params.'.length);
                    patch = {
                        source: { params: { ...(raw.source?.params ?? {}), [name]: request.value } }
                    };
                    label = 'クリップのテキストを変更';
                    needsTelopRebake = raw.source?.baked !== undefined;
                } else if (request.path.startsWith('source.chroma_key.')) {
                    const field = request.path.slice('source.chroma_key.'.length);
                    const chromaKey = {
                        ...(raw.source?.chroma_key ?? {}), [field]: request.value
                    };
                    if (request.value === null) delete chromaKey[field];
                    patch = { source: { chroma_key: chromaKey } };
                    label = 'クリップのクロマキーを変更';
                } else {
                    patch = { [request.path]: request.value };
                    label = request.path === 'opacity'
                        ? 'クリップの不透明度を変更' : 'クリップの合成を変更';
                }
            } else if (cutKinds.has(request.kind)) {
                const indexed = request as Extract<InspectorWriteRequest, { index: number }>;
                itemId = this.cutItemId(indexed.index);
                const cut = this.cuts[indexed.index];
                if (!cut) throw new Error('クリップが見つかりません。');
                if (request.kind === 'cut-speed') {
                    const speed = request.value ?? 1;
                    patch = {
                        duration: Math.max(1, this.frameAt((cut.out - cut.in) / speed)),
                        source: { speed: request.value }
                    };
                    label = 'クリップの速度を変更';
                } else if (request.kind === 'cut-audio-gain') {
                    if (request.value !== null && (!Number.isFinite(request.value) || request.value < -60 || request.value > 12)) {
                        return { ok: false, message: '埋め込み音声の音量は -60〜12 dB の範囲で入力してください。' };
                    }
                    patch = { source: { gain_db: request.value } };
                    label = '埋め込み音声の音量を変更';
                } else if (request.kind === 'cut-audio-mute') {
                    patch = { source: { mute: request.value ? true : null } };
                    label = request.value ? '埋め込み音声をミュート' : '埋め込み音声のミュートを解除';
                } else if (request.kind === 'cut-opacity') {
                    patch = { opacity: request.value };
                    label = 'クリップの不透明度を変更';
                } else if (isCutFramingWriteRequest(request)) {
                    const raw = this.rawV2Item(itemId);
                    const framing = updateCutFraming(raw?.source?.framing, request);
                    patch = { source: { framing } };
                    label = request.kind === 'cut-framing-keyframes'
                        ? 'ズーム KF を変更' : 'フレーミング窓を変更';
                } else if (isCutFreezeWriteRequest(request)) {
                    const raw = this.rawV2Item(itemId);
                    const playbackDuration = cutPlaybackDuration(cut);
                    const displayedAt = resolveCutFreezeDisplayAt(
                        raw?.source?.freeze,
                        this.playheadT,
                        this.segments[indexed.index]?.tlStart ?? 0,
                        playbackDuration
                    );
                    const freeze = updateCutFreeze(
                        raw?.source?.freeze,
                        request,
                        displayedAt,
                        playbackDuration
                    );
                    patch = {
                        ...(request.kind === 'cut-freeze-duration' ? {
                            duration: Math.max(1, this.frameAt(
                                playbackDuration + (freeze?.duration_sec ?? 0)
                            ))
                        } : {}),
                        source: { freeze }
                    };
                    label = 'フリーズを変更';
                } else if (request.kind === 'cut-source-in' || request.kind === 'cut-source-out') {
                    const input = request.kind === 'cut-source-in' ? request.value : cut.in;
                    const output = request.kind === 'cut-source-out' ? request.value : cut.out;
                    patch = {
                        duration: Math.max(1, this.frameAt((output - input) / (cut.speed ?? 1))),
                        source: { in: input, out: output }
                    };
                    label = '素材の範囲を変更';
                } else {
                    const field = request.kind === 'cut-transform-x' ? 'x'
                        : request.kind === 'cut-transform-y' ? 'y'
                            : request.kind === 'cut-scale' ? 'scale' : 'rotate';
                    patch = { transform: { ...(cut.transform ?? {}), [field]: request.value } };
                    if (request.value === null) delete (patch.transform as Record<string, unknown>)[field];
                    label = 'クリップの変形を変更';
                }
            } else if (layerKinds.has(request.kind)) {
                const identified = request as Extract<InspectorWriteRequest, { id: string }>;
                itemId = identified.id;
                const layer = this.layers.find(candidate => candidate.id === itemId);
                if (!layer) throw new Error('クリップが見つかりません。');
                if (request.kind === 'layer-opacity') {
                    patch = { opacity: request.value };
                    label = 'クリップの不透明度を変更';
                } else if (request.kind === 'layer-blend') {
                    patch = { blend: request.value };
                    label = 'クリップの合成を変更';
                } else if (request.kind === 'layer-crop-x' || request.kind === 'layer-crop-y'
                    || request.kind === 'layer-crop-w' || request.kind === 'layer-crop-h') {
                    const field = request.kind.slice('layer-crop-'.length) as InspectorCropAxis;
                    const raw = this.rawKeyframeItem(itemId);
                    patch = { crop: updateInspectorCrop(raw?.crop, field, request.value) };
                    label = 'クリップのクロップを変更';
                } else {
                    const field = request.kind === 'layer-transform-x' ? 'x'
                        : request.kind === 'layer-transform-y' ? 'y'
                            : request.kind === 'layer-scale' ? 'scale' : 'rotate';
                    patch = { transform: { ...(layer.transform ?? {}), [field]: request.value } };
                    if (request.value === null) delete (patch.transform as Record<string, unknown>)[field];
                    label = 'クリップの変形を変更';
                }
            } else if (request.kind === 'overlay-var') {
                itemId = (request as Extract<InspectorWriteRequest, { id: string }>).id;
                const raw = this.rawV2Item(itemId);
                patch = {
                    source: { vars: { ...(raw?.source?.vars ?? {}), [request.name]: request.value } }
                };
                label = 'クリップのパラメータを変更';
            } else if (request.kind === 'narration-gain') {
                itemId = request.id;
                patch = { gain_db: request.value };
                label = 'ナレーションの音量を変更';
            } else {
                itemId = (request as Extract<InspectorWriteRequest, { id: string }>).id;
                patch = request.kind === 'sfx-gain'
                    ? { gain_db: request.value }
                    : { [request.kind === 'sfx-fade-in' ? 'fade_in' : 'fade_out']: request.value };
                audioPatch = true;
                label = '音声クリップの設定を変更';
            }
            await this.commitEditMutation(label, doc => audioEnvelopeRole === 'narration'
                ? updateAudioNarrationPreferV2(doc, {
                    narrationId: itemId, itemPatch: patch, legacyPatch: patch
                })
                : audioEnvelopeRole === 'sfx'
                    ? updateAudioSfxPreferV2(doc, { sfxId: itemId, itemPatch: patch, legacyPatch: patch })
                    : audioEnvelopeRole === 'bgm'
                        ? updateAudioItemEnvelope(doc, { itemId, patch })
                        : request.kind === 'narration-gain'
                ? updateAudioNarrationGainPreferV2(doc, {
                    narrationId: itemId, gainDb: request.value
                })
                : audioPatch ? updateAudioSfxPreferV2(doc, {
                    sfxId: itemId, itemPatch: patch, legacyPatch: patch
                })
                : request.kind === 'item-field' ? updateTreeV2Item(doc, itemId, patch)
                    : request.kind === 'cut-freeze-duration'
                        ? updateV2ItemDurationAndShiftFollowing(doc, { itemId, patch })
                    : updateV2Item(doc, { itemId, patch }));
            this.hideNotice();
            if (needsTelopRebake) {
                this.showNotice('テキストを変更しました。プレビューは焼成済み素材のままなので再ベイクが必要です。');
            }
            this.footer.textContent = `${label}しました。`;
            return { ok: true };
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`変更できません: ${detail}`);
            return { ok: false, message: detail };
        }
    }

    protected selectionKey(selection: TimelineSelection): string {
        if (!selection) {
            return '';
        }
        return selection.kind === 'cut' ? `cut:${selection.index}` : `${selection.kind}:${selection.id}`;
    }

    protected applySelectionClass(): void {
        const selection = this.selection;
        const selectedKeys = new Set(this.multiSelection.map(item => this.selectionKey(item)));
        for (const element of Array.from(this.strip.querySelectorAll<HTMLElement>('[data-akari-item-kind]'))) {
            const kind = element.dataset.akariItemKind;
            const id = element.dataset.akariItemId;
            const itemKey = kind && id !== undefined ? `${kind}:${id}` : '';
            const selected = selectedKeys.has(itemKey) || (selection !== undefined && selection.kind === kind
                && (selection.kind === 'cut' ? String(selection.index) === id : selection.id === id));
            element.classList.toggle('akari-annotations-selected', selected);
        }
        const currentKey = this.selectionKey(selection);
        for (const element of Array.from(
            this.trackHeaders.querySelectorAll<HTMLElement>('[data-akari-tree-row-id]')
        )) {
            const row = this.timelineTreeRows.find(candidate => candidate.id === element.dataset.akariTreeRowId);
            if (!row) {
                element.classList.remove('akari-annotations-selected');
                continue;
            }
            const rowKey = this.selectionKey(this.selectionForTreeRow(row));
            element.classList.toggle(
                'akari-annotations-selected', selectedKeys.has(rowKey) || rowKey === currentKey
            );
        }
    }

    handleOverlaySelection(editUri: string, overlayId: string | null): void {
        if (!this.canHandlePlaybackTick(editUri)) {
            return;
        }
        if (overlayId === null) {
            if (this.selection?.kind === 'overlay') {
                this.applySelection(undefined, false);
            }
            return;
        }
        const treeRow = this.timelineTreeRows.find(row => row.id === overlayId);
        if (treeRow) {
            this.applySelection({
                kind: 'item', id: treeRow.id, itemKind: treeRow.itemKind,
                parentId: treeRow.parentId, trackId: treeRow.trackId
            }, false);
        } else if (this.overlays.some(overlay => overlay.id === overlayId)) {
            this.applySelection({ kind: 'overlay', id: overlayId }, false);
        }
    }

    /** CF-select: プレビュー内でのレイヤークリック選択をタイムライン側へ反映する（overlay と同型）。 */
    handleLayerSelection(editUri: string, layerId: string | null): void {
        if (!this.canHandlePlaybackTick(editUri)) {
            return;
        }
        if (layerId === null) {
            if (this.selection?.kind === 'layer') {
                this.applySelection(undefined, false);
            }
            return;
        }
        if (this.layers.some(layer => layer.id === layerId)) {
            this.applySelection({ kind: 'layer', id: layerId }, false);
        }
    }

    /** プレビューで現在表示中の本編を選択したとき、同じ項目をタイムラインと inspector へ渡す。 */
    handleCutSelection(editUri: string, cutId: string | null): void {
        if (!this.canHandlePlaybackTick(editUri)) {
            return;
        }
        if (cutId === null) {
            if (this.selection?.kind === 'cut') {
                this.applySelection(undefined, false);
            }
            return;
        }
        const index = this.cutItemIds.indexOf(cutId);
        if (index >= 0) {
            this.applySelection({ kind: 'cut', index }, false);
        }
    }

    /** プレビューで選んだ字幕を、タイムラインの同じ cue と inspector へ同期する。 */
    handleCaptionSelection(editUri: string, captionId: string | null): void {
        if (!this.canHandlePlaybackTick(editUri)) {
            return;
        }
        if (captionId === null) {
            if (this.selection?.kind === 'caption') {
                this.applySelection(undefined, false);
            }
            return;
        }
        if (this.captions.some(caption => caption.id === captionId)) {
            this.applySelection({ kind: 'caption', id: captionId }, false);
        }
    }

    /** 選択の実体を TimelineSelectionModel へ反映する。対象が消えていれば選択解除する。 */
    protected pushSelectionSnapshot(): void {
        if (this.multiSelection.length > 0) {
            const treeItems = this.multiSelection.filter(selection => selection.kind === 'item');
            if (treeItems.length > 0) {
                const last = treeItems[treeItems.length - 1] as Extract<TimelineSelectionItem, { kind: 'item' }>;
                this.selectionModel.treeSelection = {
                    kind: 'item', id: last.id, itemKind: last.itemKind,
                    ...(last.parentId === undefined ? {} : { parentId: last.parentId }), trackId: last.trackId
                };
                this.selectionModel.snapshot = undefined;
                return;
            }
            const items = this.multiSelection.flatMap(selection => {
                const snapshot = this.snapshotForSelection(selection);
                return snapshot ? [snapshot] : [];
            });
            this.multiSelection = items.map(item => item.kind === 'cut'
                ? { kind: 'cut', index: item.index }
                : { kind: item.kind, id: item.id } as TimelineSelectionItem);
            this.selectionModel.snapshot = items.length > 0
                ? { kind: 'multi', count: items.length, items }
                : undefined;
            this.selectionModel.fps = this.fps;
            return;
        }
        const selection = this.selection;
        if (!selection) {
            this.selectionModel.treeSelection = undefined;
            this.selectionModel.snapshot = undefined;
            return;
        }
        if (selection.kind === 'item') {
            const treeSelection = {
                kind: 'item', id: selection.id, itemKind: selection.itemKind,
                ...(selection.parentId === undefined ? {} : { parentId: selection.parentId }),
                trackId: selection.trackId
            } as const;
            this.selectionModel.treeSelection = treeSelection;
            const raw = this.rawKeyframeItem(selection.id);
            const captionId = captionIdForTreeSelection(
                treeSelection,
                raw?.source?.kind === 'caption' ? raw.source.id : undefined
            );
            this.selectionModel.snapshot = captionId
                ? this.snapshotForSelection({ kind: 'caption', id: captionId })
                : this.treeItemSnapshot(treeSelection, raw);
            this.selectionModel.fps = this.fps;
            return;
        }
        this.selectionModel.treeSelection = undefined;
        const snapshot = this.snapshotForSelection(selection);
        if (!snapshot) {
            this.selection = undefined;
            this.selectionModel.snapshot = undefined;
            return;
        }
        this.selectionModel.snapshot = snapshot;
        this.selectionModel.fps = this.fps;
    }

    protected treeItemSnapshot(
        selection: TimelineTreeItemSelection,
        raw: Record<string, any> | undefined
    ): TimelineTreeItemSnapshot | undefined {
        if (!raw) return undefined;
        const row = this.expandedTimelineTreeRows.find(candidate => candidate.id === selection.id);
        const transform = raw.transform && typeof raw.transform === 'object' && !Array.isArray(raw.transform)
            ? raw.transform as TimelineTreeItemSnapshot['transform'] : undefined;
        return {
            ...selection,
            ...(raw.source?.kind === 'media' ? {
                ...(typeof raw.mask === 'string' ? { mask: raw.mask } : {}),
                maskSourceOptions: maskSourceOptionsForSources(this.sourceMap)
            } : {}),
            outputStart: row?.at ?? (Number(raw.at) || 0) / this.fps,
            duration: row?.duration ?? (Number(raw.duration) || 0) / this.fps,
            durationFrames: Number.isInteger(raw.duration) ? raw.duration : Math.max(1, this.frameAt(row?.duration ?? 0)),
            ...(raw.source?.kind !== 'html' && raw.motion && typeof raw.motion === 'object' && !Array.isArray(raw.motion)
                ? { motion: raw.motion } : {}),
            ...(transform ? { transform } : {}),
            ...(typeof raw.opacity === 'number' ? { opacity: raw.opacity } : {}),
            ...(raw.crop && typeof raw.crop === 'object' && !Array.isArray(raw.crop) ? { crop: raw.crop } : {}),
            adjust: readInspectorAdjustSnapshot(raw.adjust),
            ...(raw.perspective && typeof raw.perspective === 'object' && !Array.isArray(raw.perspective)
                ? { perspective: raw.perspective } : {}),
            ...(Array.isArray(raw.keyframes) ? { keyframes: raw.keyframes } : {}),
            ...(typeof raw.source?.src === 'string' && raw.source.src.length > 0 ? { src: raw.source.src } : {}),
            sourceKind: typeof raw.source?.kind === 'string' ? raw.source.kind : selection.itemKind,
            trackName: this.trackDisplayNameForItem(selection.id),
            clipName: typeof raw.name === 'string' && raw.name.trim() ? raw.name : selection.id
        };
    }

    /**
     * kind ごとの現在値を同じ snapshot 器へ解決する。multi はこの配列をそのまま運び、
     * inspector 側が今回対応する caption だけを一括編集へ配線する。
     */
    protected snapshotForSelection(selection: TimelineSelectionItem): TimelineItemSelectionSnapshot | undefined {
        if (selection.kind === 'cut') {
            const segment = this.segments[selection.index];
            const cut = this.cuts[selection.index];
            if (!segment || !cut) {
                return undefined;
            }
            const freeze = readCutFreeze((cut as EditCut & { freeze?: unknown }).freeze);
            const itemId = this.cutItemId(selection.index);
            const rawItem = this.rawKeyframeItem(itemId);
            const rawKeyframes = rawItem?.keyframes;
            const mediaSource = this.rawV2Item(itemId)?.source;
            return {
                kind: 'cut', index: selection.index, itemId, label: `C${selection.index + 1}`,
                trackName: this.trackDisplayNameForItem(itemId),
                clipName: this.cutSourceName(cut) || itemId,
                sourceName: this.cutSourceName(cut), sourceIn: cut.in, sourceOut: cut.out,
                outputStart: segment.tlStart, outputEnd: segment.tlEnd,
                playheadSeconds: this.playheadT,
                ...(cut.src !== undefined ? {
                    src: cut.src,
                    sourcePath: this.sourceMap.get(cut.src)?.path
                } : {}),
                ...(cut.transform !== undefined ? { transform: cut.transform } : {}),
                ...((cut as EditCut & { framing?: unknown }).framing !== undefined
                    ? { framing: readCutFraming((cut as EditCut & { framing?: unknown }).framing) } : {}),
                ...(freeze ? { freeze } : {}),
                ...(cut.opacity !== undefined ? { opacity: cut.opacity } : {}),
                adjust: readInspectorAdjustSnapshot(rawItem?.adjust),
                ...(Array.isArray(rawKeyframes) ? { keyframes: rawKeyframes } : {}),
                ...(cut.speed !== undefined ? { speed: cut.speed } : {}),
                ...(typeof mediaSource?.gain_db === 'number' ? { audioGainDb: mediaSource.gain_db } : {}),
                ...(typeof mediaSource?.mute === 'boolean' ? { audioMute: mediaSource.mute } : {}),
                ...(cut.transitionOut !== undefined ? { transitionOut: cut.transitionOut } : {}),
                ...(this.unsupportedTransitionTrack(selection.index) !== undefined
                    || this.nonAdjacentTransitionTarget(selection.index) !== undefined
                    ? { transitionOutBlocked: this.unsupportedTransitionMessage(selection.index) } : {}),
                ...(cut.track !== undefined ? { track: cut.track } : {})
            };
        }
        if (selection.kind === 'overlay') {
            const overlay = this.overlays.find(candidate => candidate.id === selection.id);
            if (!overlay) {
                return undefined;
            }
            const track = Object.prototype.hasOwnProperty.call(overlay.payload, 'track') ? overlay.track : undefined;
            const crop = overlay.payload.crop && typeof overlay.payload.crop === 'object'
                && !Array.isArray(overlay.payload.crop)
                ? overlay.payload.crop as unknown as TimelineCropSnapshot : undefined;
            const rawItem = this.rawKeyframeItem(overlay.id);
            const rawKeyframes = rawItem?.keyframes;
            return {
                kind: 'overlay', id: overlay.id, outputStart: overlay.start, duration: overlay.duration,
                trackName: this.trackDisplayNameForItem(overlay.id), clipName: resolveTimelineClipName(overlay),
                ...(track !== undefined ? { track } : {}),
                ...(crop !== undefined ? { crop } : {}),
                adjust: readInspectorAdjustSnapshot(rawItem?.adjust),
                ...(Array.isArray(rawKeyframes) ? { keyframes: rawKeyframes } : {}),
                payload: overlay.payload
            };
        }
        if (selection.kind === 'caption') {
            const caption = this.captions.find(candidate => candidate.id === selection.id);
            if (!caption) {
                return undefined;
            }
            const ranges = this.captionRangeToOutputRanges(caption.id, caption.start, caption.end);
            const effectiveTextStyle = mergeCaptionTextStyles(this.defaultTextStyle, caption.textStyle);
            return {
                kind: 'caption', id: caption.id, text: caption.text,
                sourceStart: caption.start, sourceEnd: caption.end,
                outputStart: ranges.length > 0 ? ranges[0][0] : undefined,
                outputEnd: ranges.length > 0 ? ranges[ranges.length - 1][1] : undefined,
                speaker: caption.speaker, sourceRef: caption.sourceRef, edited: caption.edited,
                ...(caption.textStyle !== undefined ? { textStyle: caption.textStyle } : {}),
                ...(effectiveTextStyle !== undefined ? { effectiveTextStyle } : {})
            };
        }
        if (selection.kind === 'layer') {
            const layer = this.layers.find(candidate => candidate.id === selection.id);
            if (!layer) {
                return undefined;
            }
            const raw = this.rawV2Item(layer.id);
            const rawItem = this.rawKeyframeItem(layer.id);
            const rawKeyframes = rawItem?.keyframes;
            const params = raw?.source?.kind === 'telop' && raw.source.params
                && typeof raw.source.params === 'object' && !Array.isArray(raw.source.params)
                ? raw.source.params as Record<string, unknown> : undefined;
            const chromaKey = layerSnapshotChromaKey(layer.chromaKey, raw?.source?.chroma_key);
            const crop = raw?.crop && typeof raw.crop === 'object' && !Array.isArray(raw.crop)
                ? raw.crop as TimelineCropSnapshot : undefined;
            return {
                kind: 'layer', id: layer.id, layerKind: layer.kind,
                sourceKind: rawItem?.source?.kind,
                durationFrames: Number.isInteger(rawItem?.duration) ? rawItem!.duration : Math.max(1, Math.round(layer.duration * this.fps)),
                ...(rawItem?.source?.kind !== 'html' && rawItem?.motion && typeof rawItem.motion === 'object' && !Array.isArray(rawItem.motion)
                    ? { motion: rawItem.motion } : {}),
                ...(raw?.source?.kind === 'media' ? {
                    ...(typeof raw.mask === 'string' ? { mask: raw.mask } : {}),
                    maskSourceOptions: maskSourceOptionsForSources(this.sourceMap)
                } : {}),
                trackName: this.trackDisplayNameForItem(layer.id),
                clipName: resolveTimelineClipName(layer),
                outputStart: layer.t, duration: layer.duration,
                ...(typeof layer.src === 'string' && layer.src.length > 0 ? { src: layer.src } : {}),
                ...(typeof layer.preset === 'string' && layer.preset.length > 0 ? { preset: layer.preset } : {}),
                ...(params !== undefined ? { params } : {}),
                ...(layer.transform !== undefined ? { transform: layer.transform } : {}),
                ...(crop !== undefined ? { crop } : {}),
                adjust: readInspectorAdjustSnapshot(raw?.adjust),
                ...(rawItem?.perspective && typeof rawItem.perspective === 'object' && !Array.isArray(rawItem.perspective)
                    ? { perspective: rawItem.perspective } : {}),
                ...(layer.opacity !== undefined ? { opacity: layer.opacity } : {}),
                ...(Array.isArray(rawKeyframes) ? { keyframes: rawKeyframes } : {}),
                ...(layer.blend !== undefined ? { blend: layer.blend } : {}),
                ...(chromaKey !== undefined ? { chromaKey } : {}),
                ...(layer.track !== undefined ? { track: layer.track } : {})
            };
        }
        const sfx = this.audioSfx.find(candidate => candidate.id === selection.id);
        if (sfx) {
            const snapshot: AudioSelectionSnapshot = {
                kind: 'audio', id: sfx.id, audioKind: 'sfx', label: this.pathBaseName(sfx.path),
                trackName: this.trackDisplayNameForItem(sfx.id), clipName: this.pathBaseName(sfx.path) || sfx.id,
                outputStart: sfx.t, duration: sfx.duration,
                ...(sfx.gainDb !== undefined ? { gainDb: sfx.gainDb } : {}),
                ...(sfx.fadeIn !== undefined ? { fadeIn: sfx.fadeIn } : {}),
                ...(sfx.fadeOut !== undefined ? { fadeOut: sfx.fadeOut } : {}),
                ...this.audioEnvelopeFieldsForSnapshot(sfx),
                ...audioClipFxFieldsForSnapshot(sfx),
                keyframeFrames: this.rawV2Item(sfx.id) !== undefined,
                fps: this.fps,
                playheadSeconds: this.playheadT
            };
            return snapshot;
        }
        const narration = this.audioNarration.find(candidate => candidate.id === selection.id);
        if (narration) {
            const snapshot: AudioSelectionSnapshot = {
                kind: 'audio', id: narration.id, audioKind: 'narration',
                label: this.pathBaseName(narration.path),
                trackName: this.trackDisplayNameForAudioRef(this.narrationDisplayTrack(narration)),
                clipName: this.pathBaseName(narration.path) || narration.id,
                outputStart: narration.t,
                duration: this.narrationDisplayDuration(narration),
                ...(narration.gainDb !== undefined ? { gainDb: narration.gainDb } : {}),
                ...(narration.script !== undefined ? { script: narration.script } : {}),
                ...this.audioEnvelopeFieldsForSnapshot(narration),
                ...audioClipFxFieldsForSnapshot(narration),
                keyframeFrames: this.rawV2Item(narration.id) !== undefined,
                fps: this.fps,
                playheadSeconds: this.playheadT
            };
            return snapshot;
        }
        if (selection.id === 'bgm' && this.audioBgm) {
            const bgmItemId = this.editDocument ? findAudioItemIdByRole(this.editDocument, 'bgm') : undefined;
            const snapshot: AudioSelectionSnapshot = {
                kind: 'audio', id: this.audioBgm.id, audioKind: 'bgm', label: this.pathBaseName(this.audioBgm.path),
                trackName: this.trackDisplayNameForAudioRef(this.bgmDisplayTrack(this.audioBgm)),
                clipName: this.pathBaseName(this.audioBgm.path) || this.audioBgm.id,
                outputStart: 0, duration: this.contentEndDuration(),
                ...(this.audioBgm.gainDb !== undefined ? { gainDb: this.audioBgm.gainDb } : {}),
                ...(this.audioBgm.fadeIn !== undefined ? { fadeIn: this.audioBgm.fadeIn } : {}),
                ...(this.audioBgm.fadeOut !== undefined ? { fadeOut: this.audioBgm.fadeOut } : {}),
                ...this.audioEnvelopeFieldsForSnapshot(this.audioBgm),
                ...audioClipFxFieldsForSnapshot(this.audioBgm),
                keyframeFrames: bgmItemId !== undefined,
                fps: this.fps,
                playheadSeconds: this.playheadT
            };
            return snapshot;
        }
        return undefined;
    }

    protected audioEnvelopeFieldsForSnapshot(value: AudioEnvelopeFields): AudioEnvelopeFields {
        return {
            ...(value.ducking !== undefined ? { ducking: value.ducking } : {}),
            ...(value.duckDb !== undefined ? { duckDb: value.duckDb } : {}),
            ...(value.duckAttack !== undefined ? { duckAttack: value.duckAttack } : {}),
            ...(value.duckRelease !== undefined ? { duckRelease: value.duckRelease } : {}),
            ...(value.keyframes !== undefined ? { keyframes: value.keyframes } : {})
        };
    }

    protected trackDisplayNameForItem(itemId: string): string {
        const trackId = this.itemLocations.get(itemId)?.trackId;
        if (!trackId) return '—';
        const track = this.timelineTracks.find(candidate => candidate.id === trackId);
        return track?.label || this.computeTrackAutoNames().get(trackId) || trackId;
    }

    protected trackDisplayNameForAudioRef(ref: number): string {
        const track = this.displayTimelineTracks.find(candidate =>
            candidate.kind === 'audio' && (candidate.ref ?? 0) === ref);
        if (!track) return '—';
        return track.label || this.computeTrackAutoNames().get(track.id) || track.id;
    }

    protected sourceBaseName(): string {
        if (!this.location?.videoUri) {
            return '';
        }
        try {
            return new URI(this.location.videoUri).path.base;
        } catch {
            return this.location.videoUri;
        }
    }

    protected cutSourceName(cut: EditCut): string {
        if (cut.src !== undefined) {
            const source = this.sourceMap.get(cut.src);
            return source ? this.pathBaseName(source.path) : '';
        }
        return this.sourceBaseName();
    }

    protected pathBaseName(path: string): string {
        return path.split('/').pop() || path;
    }

    /** レザーモードでクリップをクリックした位置（出力秒→source 秒）で cuts を2分割する。 */
    protected async performRazorSplitAt(segment: OutputSegment, clientX: number): Promise<void> {
        const location = this.location;
        if (!location?.editUri) {
            return;
        }
        const outputT = this.timeAtClientX(clientX);
        const sourceT = this.outputToSource(outputT);
        if (sourceT - segment.in < MINIMUM_ITEM_DURATION || segment.out - sourceT < MINIMUM_ITEM_DURATION) {
            this.footer.textContent = 'クリップの端に近すぎるため分割できません（両側 0.15 秒以上必要です）';
            return;
        }
        const index = segment.index;
        try {
            await this.commitEditMutation('クリップの分割', doc => splitV2Item(doc, {
                itemId: this.cutItemId(index), atFrames: this.frameAt(outputT)
            }));
            this.hideNotice();
            this.footer.textContent = 'クリップを分割しました。';
            this.revealOutputPreview();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`クリップを分割できません: ${detail}`);
            this.messages.error(`クリップを分割できません: ${detail}`);
        }
    }

    /** 選択中のクリップを削除する（Delete/Backspace）。 */
    protected async performDeleteSelectedCut(): Promise<void> {
        if (this.selection?.kind !== 'cut') {
            return;
        }
        const lockedTrackId = this.trackIdOfSelection(this.selection);
        if (this.isTrackLocked(lockedTrackId)) {
            this.showLockedTrack(lockedTrackId);
            return;
        }
        const index = this.selection.index;
        const location = this.location;
        if (!location?.editUri) {
            return;
        }
        try {
            await this.commitEditMutation('クリップの削除', doc => removeV2Item(doc, this.cutItemId(index)));
            this.applySelection(undefined);
            this.hideNotice();
            this.footer.textContent = 'クリップを削除しました。';
            this.revealOutputPreview();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`クリップを削除できません: ${detail}`);
            this.messages.error(`クリップを削除できません: ${detail}`);
        }
    }

    protected async performDeleteSelected(): Promise<void> {
        const selection = this.selection;
        const location = this.location;
        if (!selection || !location) return;
        const lockedTrackId = this.trackIdOfSelection(selection);
        if (this.isTrackLocked(lockedTrackId)) {
            this.showLockedTrack(lockedTrackId);
            return;
        }
        if (selection.kind === "cut") {
            await this.performDeleteSelectedCut();
            return;
        }
        try {
            // 右クリックメニューは字幕チップを captions 袋の写し（tree item・id "…#<captionId>"）として
            // 選択するため、そのまま removeTreeV2Item へ渡すと「item が見つかりません」になる
            // （実機 2026-09-02 再現）。写しは captions.json の行として削除する。
            const projectedCaptionId = selection.kind === 'item' && selection.itemKind === 'caption'
                ? captionIdForTreeSelection(selection, (() => {
                    const raw = this.rawV2Item(selection.id);
                    return raw?.source?.kind === 'caption' ? raw.source.id : undefined;
                })())
                : undefined;
            const captionId = selection.kind === "caption" ? selection.id : projectedCaptionId;
            if (captionId !== undefined && (selection.kind === 'caption' || this.rawV2Item(selection.id) === undefined)) {
                const caption = this.captions.find(candidate => candidate.id === captionId);
                if (!caption) throw new Error("字幕が見つかりません。");
                // undo は captions.json の行を丸ごと戻す（time_domain / text_style を落とさない。
                // 2026-09-02 実機: output 時間軸の字幕が source 扱いで戻り、スタイルも消えていた）。
                const payload: CaptionWritePayload = {
                    id: caption.id, start: caption.start, end: caption.end, text: caption.text,
                    speaker: caption.speaker, sourceRef: caption.sourceRef, edited: caption.edited,
                    ...(caption.timeDomain === undefined ? {} : { timeDomain: caption.timeDomain }),
                    ...(caption.textStyle === undefined ? {} : { textStyle: caption.textStyle })
                };
                const result = await this.annotationsService.removeCaption({
                    captionsUri: location.captionsUri.toString(),
                    projectRootUri: location.root.toString(), captionId: caption.id
                });
                this.pushHistory({
                    label: "字幕の削除",
                    undo: async () => {
                        await this.annotationsService.insertCaption({
                            captionsUri: location.captionsUri.toString(),
                            projectRootUri: location.root.toString(), caption: payload
                        });
                        await this.reloadCaptions();
                    },
                    redo: async () => {
                        await this.annotationsService.removeCaption({
                            captionsUri: location.captionsUri.toString(),
                            projectRootUri: location.root.toString(), captionId: caption.id
                        });
                        await this.reloadCaptions();
                    }
                });
                await this.reloadCaptions();
                this.footer.textContent = this.writeResultMessage("字幕を削除しました。", result);
            } else {
                if (selection.id === "bgm") {
                    this.footer.textContent = "BGM は削除できません。";
                    return;
                }
                const narrationSelected = selection.kind === 'audio'
                    && this.audioNarration.some(item => item.id === selection.id);
                await this.commitEditMutation("クリップの削除", doc =>
                    narrationSelected
                        ? removeAudioNarrationPreferV2(doc, selection.id)
                        : selection.kind === "audio"
                            ? removeAudioSfxPreferV2(doc, selection.id)
                            : selection.kind === 'item'
                                ? removeTreeV2Item(doc, selection.id).document
                                : removeV2Item(doc, selection.id));
                this.footer.textContent = "クリップを削除しました。";
            }
            this.applySelection(undefined);
            this.hideNotice();
            this.revealOutputPreview();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice("選択項目を削除できません: " + detail);
            this.messages.error("選択項目を削除できません: " + detail);
        }
    }

    protected async performDeleteMultiSelected(): Promise<void> {
        const location = this.location;
        if (!location?.editUri || this.multiSelection.length === 0) {
            return;
        }
        const retained = this.multiSelection.filter(item => this.isTrackLocked(this.trackIdOfSelection(item)));
        const selected = this.multiSelection.filter(item => !this.isTrackLocked(this.trackIdOfSelection(item)));
        if (selected.length === 0) {
            this.footer.textContent = `${retained.length} 件はロック中のため残しました`;
            return;
        }
        try {
            const editBefore = (await this.fileService.readFile(location.editUri)).value.toString();
            const hasCaptions = selected.some(item => item.kind === 'caption');
            const captionsBefore = hasCaptions
                ? (await this.fileService.readFile(location.captionsUri)).value.toString()
                : undefined;
            const value = JSON.parse(editBefore) as Record<string, any>;
            const cutIndexes = new Set(selected
                .filter((item): item is Extract<TimelineSelectionItem, { kind: 'cut' }> => item.kind === 'cut')
                .map(item => item.index));
            const idsByKind = new Map<TimelineSelectionItem['kind'], Set<string>>();
            for (const item of selected) {
                if (item.kind === 'cut') {
                    continue;
                }
                const ids = idsByKind.get(item.kind) ?? new Set<string>();
                ids.add(item.id);
                idsByKind.set(item.kind, ids);
            }
            if (value.version === 2 && Array.isArray(value.tracks)) {
                const itemIds = new Set<string>([
                    ...[...cutIndexes].map(index => this.cutItemId(index)),
                    ...[...idsByKind.entries()]
                        .filter(([kind]) => kind !== 'caption')
                        .flatMap(([, ids]) => [...ids].filter(id => id !== 'bgm'))
                ]);
                value.tracks = value.tracks.map((track: any) => Array.isArray(track?.items)
                    ? { ...track, items: track.items.filter((item: any) => !itemIds.has(item?.id)) }
                    : track);
            }
            if (Array.isArray(value.cuts) && cutIndexes.size > 0) {
                value.cuts = value.cuts.filter((_item: unknown, index: number) => !cutIndexes.has(index));
            }
            if (Array.isArray(value.overlays)) {
                value.overlays = value.overlays.filter((item: any) => !idsByKind.get('overlay')?.has(item?.id));
            }
            if (Array.isArray(value.layers)) {
                value.layers = value.layers.filter((item: any) => !idsByKind.get('layer')?.has(item?.id));
            }
            if (value.audio && typeof value.audio === 'object') {
                const audioIds = idsByKind.get('audio');
                if (Array.isArray(value.audio.sfx) && audioIds) {
                    value.audio.sfx = value.audio.sfx.filter((item: any, index: number) =>
                        !audioIds.has(typeof item?.id === 'string' ? item.id : `sfx-${index}`));
                }
                if (Array.isArray(value.audio.narration) && audioIds) {
                    value.audio.narration = value.audio.narration.filter((item: any, index: number) =>
                        !audioIds.has(typeof item?.id === 'string' ? item.id : `narration-${index}`));
                }
                if (audioIds?.has('bgm')) {
                    delete value.audio.bgm;
                }
            }
            let editAfter = `${JSON.stringify(value, undefined, 2)}\n`;
            let captionsAfter = captionsBefore;
            if (captionsAfter !== undefined) {
                for (const id of idsByKind.get('caption') ?? []) {
                    captionsAfter = removeCaptionLine(captionsAfter, id);
                }
            }
            await this.writeTimelineSnapshots(editAfter, captionsAfter);
            await this.reloadAll();
            editAfter = (await this.fileService.readFile(location.editUri)).value.toString();
            this.pushHistory({
                label: '複数アイテムを削除',
                undo: async () => {
                    await this.writeTimelineSnapshots(editBefore, captionsBefore);
                    await this.reloadAll();
                },
                redo: async () => {
                    await this.writeTimelineSnapshots(editAfter, captionsAfter);
                    await this.reloadAll();
                }
            });
            this.multiSelection = [];
            this.selection = undefined;
            this.pushSelectionSnapshot();
            this.footer.textContent = retained.length > 0
                ? `${retained.length} 件はロック中のため残しました` : '選択したアイテムを削除しました。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`選択項目を削除できません: ${detail}`);
            this.messages.error(`選択項目を削除できません: ${detail}`);
        }
    }

    /**
     * 素材追加コマンド（akari.timeline.addMaterialAtPlayhead）の受け側（task
     * 2026-08-10-timeline-clip-menu 指示4）。再生ヘッド位置・トラック 0 固定で addMaterialAt
     * へ委譲する（task 2026-08-10-material-dnd-timeline 指示6）。
     */
    async addMaterialAtPlayhead(relativePath: string, kind: string): Promise<void> {
        const t = Number.isFinite(this.playheadT) ? this.playheadT : 0;
        await this.addMaterialAt(relativePath, kind, t, 0);
    }

    /**
     * 素材追加の共通実装（task 2026-08-10-material-dnd-timeline 指示6、
     * task 2026-08-18-timeline-dnd-p0p1 で本編カット・音源行生成・尺の非クランプへ拡張）。
     * 再生ヘッド追加（addMaterialAtPlayhead）と D&D ドロップ（handleMaterialDrop）の両方が
     * ここへ委譲する。書き込みは全文スナップショット方式（performDeleteMultiSelected と同型）。
     * 引数検証はここで完結し、例外は投げない。
     *
     * options.zone が行き先を決める:
     * - `layers`（既定。video / image）: `layers[]` へ挿入。行間ドロップ（insertTrack）なら
     *   既存 track の繰り上げ + 宣言トラックの新規挿入を 1 スナップショットに畳む。
     * - `cuts`（video / image）: `cuts[]` へ挿入（P1-a）。v0 で別ソースを落とした場合は
     *   v1（マルチソース）へ移行する — insertCutIntoEdit の責務。
     * - `audio`: `audio.sfx[]` へ挿入。options.createAudioTrack のとき、明示 timeline.tracks に
     *   audio 行が無ければ 1 本足す（P0-a。宣言していないプロジェクトは派生で自動的に生える）。
     *
     * options.durationSeconds が渡されていれば実尺プローブ済みとして扱い、video の実尺 RPC を
     * 再度叩かない。image は常に IMAGE_LAYER_DEFAULT_DURATION_SECONDS。
     */
    async addMaterialAt(
        relativePath: string,
        kind: string,
        t: number,
        track: number,
        options?: {
            durationSeconds?: number; insertTrack?: number; insertIndex?: number;
            zone?: MaterialDropZone; createAudioTrack?: boolean; targetTrackId?: string;
        }
    ): Promise<void> {
        if (kind !== 'video' && kind !== 'audio' && kind !== 'image') {
            this.messages.warn('素材を追加できません（種別が不正です）。');
            return;
        }
        if (!relativePath) {
            this.messages.warn('素材を追加できません（パスが空です）。');
            return;
        }
        const location = this.location;
        if (!location?.editUri) {
            this.messages.warn('edit.json が見つからないため素材を追加できません。');
            return;
        }
        let durationSeconds = 0;
        let fallbackNote = '';
        if (kind === 'image') {
            durationSeconds = options?.durationSeconds ?? IMAGE_LAYER_DEFAULT_DURATION_SECONDS;
        } else if (kind === 'video' || kind === 'audio') {
            if (typeof options?.durationSeconds === 'number' && options.durationSeconds > 0) {
                durationSeconds = options.durationSeconds;
            } else {
                const audioUri = this.resolveEditMediaUri(relativePath, location.editUri).toString();
                let resolved: number | undefined;
                try {
                    const result = await this.annotationsService.getAudioDuration({
                        projectRootUri: location.root.toString(), audioUri
                    });
                    resolved = result.status === 'ready' ? result.durationSeconds : undefined;
                } catch {
                    resolved = undefined;
                }
                if (resolved === undefined) {
                    durationSeconds = MATERIAL_INSERT_FALLBACK_DURATION_SECONDS;
                    fallbackNote = `実尺を取得できなかったため ${MATERIAL_INSERT_FALLBACK_DURATION_SECONDS} 秒として追加しました。`;
                } else {
                    durationSeconds = resolved;
                }
            }
        }
        try {
            const editBefore = (await this.fileService.readFile(location.editUri)).value.toString();
            let value = JSON.parse(editBefore) as EditV2Document;
            const successNote = 'タイムラインに素材を追加しました。';
            let beyondNote = '';
            if (kind === 'audio') {
                const audio = value.audio && typeof value.audio === 'object' && !Array.isArray(value.audio)
                    ? value.audio as Record<string, unknown> : {};
                const sfx = Array.isArray(audio.sfx) ? audio.sfx as Array<Record<string, unknown>> : [];
                const ids = new Set([
                    ...indexEditV2Items(value).keys(),
                    ...sfx.map((entry, index) =>
                        typeof entry.id === 'string' ? entry.id : `sfx-${index}`)
                ]);
                let serial = 1;
                while (ids.has(`audio-${serial}`)) serial++;
                const itemId = `audio-${serial}`;
                let targetTrackId = options?.targetTrackId;
                if (options?.createAudioTrack) {
                    value = insertV2Track(value, { index: 0, lane: 'audio' });
                    targetTrackId = String((value.tracks as Array<Record<string, unknown>>)[0].id);
                }
                const targetTrack = targetTrackId === undefined ? undefined
                    : (value.tracks as Array<Record<string, unknown>>)
                        .find(candidate => candidate.id === targetTrackId && candidate.lane === 'audio');
                let sourceId: string | undefined;
                if (targetTrack) {
                    const sources = Array.isArray(value.sources)
                        ? [...value.sources] as Array<Record<string, unknown>> : [];
                    const existing = sources.find(candidate => candidate.path === relativePath);
                    if (existing && typeof existing.id === 'string') {
                        sourceId = existing.id;
                    } else {
                        const sourceIds = new Set(sources.map(candidate => String(candidate.id ?? '')));
                        let sourceSerial = 1;
                        while (sourceIds.has(`src-${sourceSerial}`)) sourceSerial++;
                        sourceId = `src-${sourceSerial}`;
                        sources.push({ id: sourceId, path: relativePath });
                        value = { ...value, sources };
                    }
                }
                value = insertAudioSfxPreferV2(value, {
                    ...(targetTrack ? { trackId: targetTrackId } : {}),
                    item: {
                        id: itemId,
                        at: this.frameAt(Math.max(0, t)),
                        duration: Math.max(1, this.frameAt(durationSeconds)),
                        source: { kind: 'media', src: sourceId, in: 0, out: durationSeconds }
                    },
                    legacyItem: { id: itemId, path: relativePath, t: Math.max(0, t), track }
                });
                const insertedLocation = indexEditV2Items(value).get(itemId);
                const insertedV2Item = insertedLocation
                    ? ((value.tracks as Array<Record<string, any>>)[insertedLocation.trackIndex]
                        ?.items as Array<Record<string, unknown>> | undefined)?.[insertedLocation.itemIndex]
                    : undefined;
                const insertedLegacyItems = Array.isArray((value.audio as Record<string, unknown> | undefined)?.sfx)
                    ? (value.audio as { sfx: Array<Record<string, unknown>> }).sfx : [];
                const insertedLegacyIndex = insertedLegacyItems.findIndex((entry, index) =>
                    (typeof entry.id === 'string' ? entry.id : `sfx-${index}`) === itemId);
                const insertedItem = insertedV2Item ?? insertedLegacyItems[insertedLegacyIndex];
                let autoLevelNotice = '';
                let editAfter: string | undefined;
                if (insertedItem && !Object.prototype.hasOwnProperty.call(insertedItem, 'gain_db')) {
                    const measured = await this.annotationsService.measureAudioForLevel({
                        projectRoot: location.root.path.fsPath(),
                        audioPath: this.resolveEditMediaUri(relativePath, location.editUri).path.fsPath(),
                        role: 'sfx',
                        collection: 'sfx',
                        durationSec: durationSeconds
                    });
                    if (measured.ok) {
                        if (insertedV2Item) {
                            value = updateV2Item(value, {
                                itemId,
                                patch: {
                                    gain_db: measured.gain_db,
                                    ...(!Object.prototype.hasOwnProperty.call(insertedV2Item, 'fade_in')
                                        ? { fade_in: measured.fade_in } : {}),
                                    ...(!Object.prototype.hasOwnProperty.call(insertedV2Item, 'fade_out')
                                        ? { fade_out: measured.fade_out } : {})
                                }
                            });
                        } else if (insertedLegacyIndex >= 0) {
                            editAfter = setSfxGainDbInSource(
                                stringifyEditV2(value), insertedLegacyIndex, measured.gain_db
                            );
                            const fadeUpdates = {
                                ...(!Object.prototype.hasOwnProperty.call(insertedItem, 'fade_in')
                                    ? { fadeIn: measured.fade_in } : {}),
                                ...(!Object.prototype.hasOwnProperty.call(insertedItem, 'fade_out')
                                    ? { fadeOut: measured.fade_out } : {})
                            };
                            if (Object.keys(fadeUpdates).length > 0) {
                                editAfter = setSfxFadeInSource(editAfter, insertedLegacyIndex, fadeUpdates);
                            }
                        }
                        autoLevelNotice = `自動レベル: ${measured.gain_db.toFixed(1)} dB（${measured.basis}・${measured.role}）`;
                    } else if ('reason' in measured) {
                        autoLevelNotice = `自動レベルを適用できませんでした（${measured.reason}）。gain は手動で調整してください`;
                    }
                }
                editAfter ??= stringifyEditV2(value);
                await this.writeTimelineSnapshots(editAfter);
                await this.reloadEdit();
                this.pushHistory({
                    label: '音声素材を追加',
                    undo: async () => {
                        await this.writeTimelineSnapshots(editBefore);
                        await this.reloadEdit();
                    },
                    redo: async () => {
                        await this.writeTimelineSnapshots(editAfter);
                        await this.reloadEdit();
                    }
                });
                this.hideNotice();
                this.footer.textContent = autoLevelNotice || `${successNote}${fallbackNote}`;
                this.revealOutputPreview();
                return;
            }
            const sources = Array.isArray(value.sources) ? [...value.sources] as Array<Record<string, unknown>> : [];
            let source = sources.find(candidate => candidate.path === relativePath);
            if (!source) {
                const ids = new Set(sources.map(candidate => String(candidate.id ?? '')));
                let serial = 1;
                while (ids.has(`src-${serial}`)) serial++;
                source = { id: `src-${serial}`, path: relativePath };
                sources.push(source);
            }
            value = { ...value, sources };
            const itemIds = new Set(indexEditV2Items(value).keys());
            const baseId = kind === 'image' ? 'image' : 'clip';
            let serial = 1;
            while (itemIds.has(`${baseId}-${serial}`)) serial++;
            const duration = Math.max(1, this.frameAt(durationSeconds));
            const item: Record<string, unknown> = {
                id: `${baseId}-${serial}`,
                at: this.frameAt(t),
                duration,
                source: { kind: 'media', src: source.id, in: 0, out: Math.max(1 / this.fps, durationSeconds) }
            };
            const lane = 'visual';
            if (options?.insertIndex !== undefined) {
                value = insertV2Track(value, { index: options.insertIndex, lane });
                const created = (value.tracks as Array<Record<string, unknown>>)[options.insertIndex];
                value = insertV2Item(value, String(created.id), item);
            } else {
                let targetTrackId = options?.targetTrackId;
                if (!targetTrackId) {
                    const tracks = value.tracks as Array<Record<string, unknown>>;
                    const target = tracks.find(candidate => candidate.lane === lane && Array.isArray(candidate.items));
                    if (!target) {
                        const insertIndex = tracks.length;
                        value = insertV2Track(value, { index: insertIndex, lane });
                        targetTrackId = String((value.tracks as Array<Record<string, unknown>>)[insertIndex].id);
                    } else {
                        targetTrackId = String(target.id);
                    }
                }
                value = insertV2Item(value, targetTrackId, item);
            }
            beyondNote = this.beyondCutsEndNote(t);
            let editAfter = stringifyEditV2(value);
            await this.writeTimelineSnapshots(editAfter);
            await this.reloadEdit();
            editAfter = (await this.fileService.readFile(location.editUri)).value.toString();
            this.pushHistory({
                label: '素材を追加',
                undo: async () => {
                    await this.writeTimelineSnapshots(editBefore);
                    await this.reloadEdit();
                },
                redo: async () => {
                    await this.writeTimelineSnapshots(editAfter);
                    await this.reloadEdit();
                }
            });
            this.hideNotice();
            this.footer.textContent = `${successNote}${beyondNote}${fallbackNote}`;
            this.revealOutputPreview();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`素材を追加できません: ${detail}`);
            this.messages.error(`素材を追加できません: ${detail}`);
        }
    }

    /**
     * 行間ドロップで宣言トラックを組み替えるときの基準列。明示 timeline.tracks があればそれ、
     * 無ければ派生ベースラインを、いずれも pinAudioGroupToBottom（audio 先頭 = 画面最下段）で
     * 正規化して返す（2026-08-10-dnd-ghost-and-insert-fix の呼び出しをそのまま関数化）。
     */
    protected snapshotTimelineTracks(editBefore: string): EditTimelineTrack[] {
        return this.baseTimelineTracks(this.readEdit(editBefore));
    }

    /**
     * 素材カード D&D の実尺プローブ（task 2026-08-10-material-dnd-timeline 指示5・司令塔裁定6）。
     * dragStart イベント受信時に video/audio のみ非同期で 1 回発火する。解決したら
     * materialDurationCache に積み、現在ドラッグ中の素材と一致すればゴーストを再計算する。
     */
    protected probeMaterialDuration(relativePath: string): void {
        if (this.materialDurationCache.has(relativePath) || this.materialDurationPromises.has(relativePath)) {
            return;
        }
        const location = this.location;
        if (!location?.editUri) {
            return;
        }
        const audioUri = this.resolveEditMediaUri(relativePath, location.editUri).toString();
        const promise = this.annotationsService.getAudioDuration({
            projectRootUri: location.root.toString(), audioUri
        }).then(result => (result.status === 'ready' ? result.durationSeconds : undefined))
            .catch(() => undefined);
        this.materialDurationPromises.set(relativePath, promise);
        void promise.then(resolved => {
            this.materialDurationPromises.delete(relativePath);
            if (typeof resolved !== 'number' || resolved <= 0) {
                return;
            }
            this.materialDurationCache.set(relativePath, resolved);
            if (this.materialDragPayload?.relativePath === relativePath) {
                this.updateMaterialGhost(this.materialDragLastClientX, this.materialDragLastClientY);
            }
        });
    }

    protected isMaterialDragTransfer(transfer: DataTransfer | null): boolean {
        return !!transfer && transfer.types.includes(MATERIAL_DRAG_MIME);
    }

    protected handleMaterialDragEnter(event: DragEvent): void {
        if (!this.isMaterialDragTransfer(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }

    /**
     * dragover のたびにゴースト位置を更新する（司令塔裁定5・6、指示4）。Theia 本体が document
     * バブル段階で dropEffect='none' を強制するため（akari-project-contribution.ts と同じ実測済み
     * 事情）、preventDefault + stopPropagation + dropEffect='copy' の 3 点セットを毎回行う。
     */
    protected handleMaterialDragOver(event: DragEvent): void {
        if (!this.isMaterialDragTransfer(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const payload = this.materialDragPayload;
        const target = payload ? this.resolveMaterialDropTarget(payload.kind, event.clientY) : undefined;
        const locked = this.isTrackLocked(target?.targetTrackId);
        const rejected = !!target?.rejected || locked;
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = rejected ? 'none' : 'copy';
        }
        // P0-b: 拒否は無言にしない。なぜ置けないのかをドラッグ中からフッターに出す。
        if (rejected && target?.reason) {
            this.footer.textContent = target.reason;
        }
        if (locked) this.showLockedTrack(target?.targetTrackId, event);
        this.updateMaterialGhost(event.clientX, event.clientY);
    }

    protected handleMaterialDragLeave(event: DragEvent): void {
        if (!this.isMaterialDragTransfer(event.dataTransfer)) {
            return;
        }
        const next = event.relatedTarget;
        if (next instanceof Node && this.stripScroll.contains(next)) {
            return;
        }
        this.hideMaterialGhost();
    }

    /**
     * drop 時は DataTransfer.getData を正とする（司令塔裁定4）。取れなければ dragStart
     * ミラーイベントで保持していたペイロードへフォールバックする。
     */
    protected handleMaterialDrop(event: DragEvent): void {
        if (!this.isMaterialDragTransfer(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const clientX = event.clientX;
        const clientY = event.clientY;
        const payload = this.readMaterialDropPayload(event.dataTransfer) ?? this.materialDragPayload;
        this.hideMaterialGhost();
        this.materialDragPayload = undefined;
        if (!payload) {
            return;
        }
        const target = this.resolveMaterialDropTarget(payload.kind, clientY);
        const lockedTrackId = target.targetTrackId;
        if (this.isTrackLocked(lockedTrackId)) {
            this.showLockedTrack(lockedTrackId, event);
            return;
        }
        if (target.rejected) {
            this.footer.textContent = target.reason || '素材をここには置けません。';
            return;
        }
        const durationSeconds = payload.kind === 'image'
            ? IMAGE_LAYER_DEFAULT_DURATION_SECONDS
            : this.materialDurationCache.get(payload.relativePath) ?? payload.durationSeconds;
        const resolvedDuration = durationSeconds ?? this.materialGhostDurationSeconds(payload);
        const t = this.materialDropTime(clientX, target.zone, target.track, resolvedDuration);
        void this.addMaterialAt(
            payload.relativePath, payload.kind, t, target.track,
            {
                zone: target.zone,
                ...(typeof durationSeconds === 'number' ? { durationSeconds } : {}),
                ...(target.insertTrack !== undefined ? { insertTrack: target.insertTrack } : {}),
                ...(target.insertIndex !== undefined ? { insertIndex: target.insertIndex } : {}),
                ...(target.targetTrackId !== undefined ? { targetTrackId: target.targetTrackId } : {}),
                ...(target.createAudioTrack ? { createAudioTrack: true } : {})
            }
        );
    }

    protected readMaterialDropPayload(transfer: DataTransfer | null): MaterialDragPayload | undefined {
        if (!transfer) {
            return undefined;
        }
        const raw = transfer.getData(MATERIAL_DRAG_MIME);
        if (!raw) {
            return undefined;
        }
        try {
            return parseMaterialDragPayload(JSON.parse(raw));
        } catch {
            return undefined;
        }
    }

    protected isLibraryTransitionDragTransfer(transfer: DataTransfer | null): boolean {
        return !!transfer && transfer.types.includes(LIBRARY_DRAG_MIME);
    }

    protected handleLibraryTransitionDragEnter(event: DragEvent): void {
        if (!this.isLibraryTransitionDragTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
    }

    protected handleLibraryTransitionDragOver(event: DragEvent): void {
        if (!this.isLibraryTransitionDragTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        let hit = this.libraryDragPayload
            ? this.hitLibraryTransitionDropTarget(event.clientX, event.clientY)
            : undefined;
        if (hit) {
            for (const index of [hit.earlierIndex, hit.laterIndex]) {
                const trackId = this.trackIdOfItem(this.cutItemId(index));
                if (this.isTrackLocked(trackId)) {
                    this.showLockedTrack(trackId, event);
                    hit = undefined;
                    break;
                }
            }
        }
        this.setHoveredTransitionDropTarget(hit);
        if (event.dataTransfer) event.dataTransfer.dropEffect = hit ? 'copy' : 'none';
    }

    protected handleLibraryTransitionDragLeave(event: DragEvent): void {
        if (!this.isLibraryTransitionDragTransfer(event.dataTransfer)) return;
        const next = event.relatedTarget;
        if (next instanceof Node && this.stripScroll.contains(next)) return;
        this.setHoveredTransitionDropTarget(undefined);
    }

    protected handleLibraryTransitionDrop(event: DragEvent): void {
        if (!this.isLibraryTransitionDragTransfer(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        const payload = this.readLibraryTransitionDropPayload(event.dataTransfer);
        const hit = payload ? this.hitLibraryTransitionDropTarget(event.clientX, event.clientY) : undefined;
        this.clearLibraryTransitionDragState();
        if (!payload || !hit) return;
        for (const index of [hit.earlierIndex, hit.laterIndex]) {
            const lockedTrackId = this.trackIdOfItem(this.cutItemId(index));
            if (this.isTrackLocked(lockedTrackId)) {
                this.showLockedTrack(lockedTrackId, event);
                return;
            }
        }
        void this.applyLibraryTransitionDrop(payload, hit.earlierIndex);
    }

    protected readLibraryTransitionDropPayload(
        transfer: DataTransfer | null
    ): LibraryTransitionDragPayload | undefined {
        const raw = transfer?.getData(LIBRARY_DRAG_MIME);
        // drop 時に MIME の本文が存在する場合はそれを正とし、不正値をミラー状態で救済しない。
        // 本文が空の環境だけ dragStart の CustomEvent ミラーへフォールバックする。
        return raw ? parseLibraryTransitionDragPayload(raw) : this.libraryDragPayload;
    }

    protected transitionDropHitCandidates(): TransitionBoundaryHitCandidate[] {
        const candidates: TransitionBoundaryHitCandidate[] = [];
        for (const element of Array.from(this.stripContent.querySelectorAll<HTMLElement>(
            '[data-akari-transition-drop-target]'
        ))) {
            const earlierIndex = Number(element.dataset.akariTransitionEarlierIndex);
            const laterIndex = Number(element.dataset.akariTransitionLaterIndex);
            if (!Number.isInteger(earlierIndex) || !Number.isInteger(laterIndex)) continue;
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            candidates.push({
                earlierIndex, laterIndex,
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            });
        }
        return candidates;
    }

    protected hitLibraryTransitionDropTarget(
        clientX: number,
        clientY: number
    ): TransitionBoundaryHitCandidate | undefined {
        return hitTestTransitionBoundary(
            { x: clientX, y: clientY },
            this.transitionDropHitCandidates(),
            TRANSITION_DROP_HIT_TOLERANCE_PX
        );
    }

    protected setHoveredTransitionDropTarget(hit: TransitionBoundaryHitCandidate | undefined): void {
        const key = hit ? `${hit.earlierIndex}-${hit.laterIndex}` : undefined;
        for (const element of Array.from(this.stripContent.querySelectorAll<HTMLElement>(
            '[data-akari-transition-drop-target]'
        ))) {
            element.dataset.akariTransitionDropHover = String(
                key !== undefined && element.dataset.akariTransitionDropTarget === key
            );
        }
    }

    protected clearLibraryTransitionDragState(): void {
        const hadPayload = this.libraryDragPayload !== undefined;
        this.libraryDragPayload = undefined;
        this.setHoveredTransitionDropTarget(undefined);
        if (hadPayload) this.renderStrip();
    }

    protected async applyLibraryTransitionDrop(
        payload: LibraryTransitionDragPayload,
        earlierIndex: number
    ): Promise<void> {
        if (!this.location?.editUri || this.unsupportedTransitionTrack(earlierIndex) !== undefined) return;
        const currentDuration = this.cuts[earlierIndex]?.transitionOut?.duration;
        await this.applyTransitionOut(earlierIndex, {
            type: payload.id,
            duration: typeof currentDuration === 'number' && currentDuration > 0
                ? currentDuration : TRANSITION_DEFAULT_DURATION_SECONDS
        });
        this.footer.textContent = `トランジション「${payload.name}」を適用しました`;
    }

    /**
     * ドロップ先トラック行の解決（task 2026-08-10-material-dnd-timeline 司令塔裁定2 を
     * task 2026-08-18-timeline-dnd-p0p1 で拡張）。
     *
     * - audio: 音源帯を狙う。**音源トラック行が 1 本も無いときも受理する**（P0-a）。この場合は
     *   ref 0 の音源トラックを新規に作る（`createAudioTrack`）。従来はここが reject だったため、
     *   BGM しか持たない通常のプロジェクトでは音源をどこにも落とせなかった。
     * - video / image: レイヤー帯 → 本編帯の順に当てる。どちらの行にも当たらなければ拒否し、
     *   **理由**を返す（P0-b。無言 no-op は「壊れている」と区別が付かない）。
     *   layers / cuts が両方 0 本のプロジェクトは、従来どおり新レイヤー行として受理する。
     */
    protected resolveMaterialDropTarget(
        kind: MaterialDragKind, clientY: number
    ): {
        zone: MaterialDropZone; track: number; top: number; height: number; rejected: boolean;
        insertTrack?: number; insertIndex?: number; targetTrackId?: string;
        createAudioTrack?: boolean; reason?: string;
    } {
        const localY = clientY - this.strip.getBoundingClientRect().top;
        const lockedLayout = this.laneLayout.tracks.find(layout =>
            localY >= layout.top && localY < layout.top + layout.height && this.isTrackLocked(layout.id));
        if (lockedLayout) {
            const track = this.displayTimelineTracks.find(candidate => candidate.id === lockedLayout.id);
            return {
                zone: kind === 'audio' ? 'audio' : 'layers', track: lockedLayout.track,
                top: lockedLayout.top, height: lockedLayout.height, rejected: true,
                targetTrackId: lockedLayout.id,
                reason: lockedTrackMessage(track?.label || this.computeTrackAutoNames().get(lockedLayout.id!) || lockedLayout.id!)
            };
        }
        if (kind === 'audio') {
            const layouts = this.laneLayout.audioTracks;
            if (layouts.length === 0) {
                return {
                    zone: 'audio', track: 0, top: Math.max(0, localY - SUBROW_STRIDE / 2),
                    height: SUBROW_STRIDE, rejected: false, createAudioTrack: true
                };
            }
            const hit = layouts.find(layout =>
                localY >= layout.top && localY < layout.top + layout.height + LANE_GAP);
            if (hit) {
                return {
                    zone: 'audio', track: hit.track, top: hit.top, height: hit.height,
                    rejected: false, targetTrackId: hit.id
                };
            }
            return {
                zone: 'audio', track: 0, top: 0, height: SUBROW_STRIDE, rejected: true,
                reason: '映像のレーンには音を置けません。'
            };
        }
        const zone: MaterialDropZone = 'layers';
        const rawTracks = Array.isArray(this.editDocument?.tracks)
            ? this.editDocument!.tracks as Array<Record<string, unknown>> : [];
        const dropLayouts = this.timelineTrackDropLayouts(rawTracks);
        const eligible = dropLayouts.filter(layout => layout.lane === 'visual' && layout.acceptsItems);
        if (eligible.length === 0) {
            return {
                zone, track: 0, top: Math.max(0, localY - SUBROW_STRIDE / 2), height: SUBROW_STRIDE,
                rejected: false, insertIndex: rawTracks.length
            };
        }
        const hit = hitTestTimelineTrackDrop(localY, dropLayouts, eligible[0].track);
        if (!hit.rejected) return {
            zone,
            track: hit.track,
            top: hit.top,
            height: hit.height,
            rejected: false,
            targetTrackId: hit.targetTrackId,
            ...(hit.insertIndex === undefined ? {} : {
                insertTrack: hit.insertIndex,
                insertIndex: hit.insertIndex
            })
        };
        return {
            zone, track: 0, top: Math.max(0, localY - SUBROW_STRIDE / 2), height: SUBROW_STRIDE,
            rejected: true,
            reason: '音のレーンには映像を置けません。'
        };
    }

    /** 拒否理由の文言（純関数 materialDropDecision の reason をそのまま使う）。 */
    protected materialDropRejectReason(kind: MaterialDragKind, trackKind: 'cuts' | 'overlays'): string {
        const decision = materialDropDecision(kind, trackKind);
        return decision.accept === true ? '' : decision.reason;
    }

    protected materialGhostDurationSeconds(payload: MaterialDragPayload): number {
        if (payload.kind === 'image') {
            return IMAGE_LAYER_DEFAULT_DURATION_SECONDS;
        }
        const probed = this.materialDurationCache.get(payload.relativePath);
        if (typeof probed === 'number' && probed > 0) {
            return probed;
        }
        if (typeof payload.durationSeconds === 'number' && payload.durationSeconds > 0) {
            return payload.durationSeconds;
        }
        return MATERIAL_INSERT_FALLBACK_DURATION_SECONDS;
    }

    protected updateMaterialGhost(clientX: number, clientY: number): void {
        const payload = this.materialDragPayload;
        if (!payload) {
            this.hideMaterialGhost();
            return;
        }
        this.materialDragLastClientX = clientX;
        this.materialDragLastClientY = clientY;
        const target = this.resolveMaterialDropTarget(payload.kind, clientY);
        if (this.isTrackLocked(target.targetTrackId)) {
            this.hideMaterialGhost();
            return;
        }
        const visibility = materialGhostVisibility(payload.kind, target);
        if (!visibility.showGhost) {
            // rejected（対象外の帯）: 本体ゴーストを表示しない（司令塔裁定1）。trackAtClientY の
            // fallthrough は rejected でも top に最上段レイヤー行を返すため、ここで描くと
            // 「関係ない行に点線」に見えてしまう。
            this.hideMaterialGhost();
            return;
        }
        const durationSeconds = this.materialGhostDurationSeconds(payload);
        // task 2026-08-18-timeline-dnd-p0p1 / P1-b: 総尺でのクランプをやめる。総尺より後ろに
        // 置けるし、素材が黙って短く切られることもない（置けば総尺のほうが伸びる）。
        // 本編帯だけは重なりが許されない（cuts.track-overlap は error）ので、着地位置を
        // 空きへ寄せた結果をそのままゴーストに出す（見えている場所 = 入る場所）。
        const range = computeMaterialGhostRange(
            this.materialDropTime(clientX, target.zone, target.track, durationSeconds),
            durationSeconds
        );
        this.setGhostRange(this.materialGhost, range.start, range.end);
        this.setGhostRejected(this.materialGhost, false);
        const viewportTop = RULER_BAND_HEIGHT_PX + target.top - this.stripScroll.scrollTop;
        this.materialGhost.style.top = `${viewportTop}px`;
        this.materialGhost.style.height = `${target.height}px`;
        this.materialGhost.style.display = 'block';
        if (visibility.showInsertIndicator) {
            this.showTrackInsertIndicatorAt(target.top);
        } else {
            this.hideTrackInsertIndicator();
        }
    }

    protected hideMaterialGhost(): void {
        this.materialGhost.style.display = 'none';
        this.hideTrackInsertIndicator();
    }

    protected async performCompactCuts(): Promise<void> {
        if (!this.location?.editUri) return;
        try {
            const selectedId = this.selection?.kind === "cut" ? this.cutItemId(this.selection.index) : undefined;
            await this.commitEditMutation("クリップ間の空白詰め", doc => {
                const cutIds = new Set(this.cutItemIds);
                let next = doc;
                for (const track of doc.tracks as Array<Record<string, any>>) {
                    if (!Array.isArray(track.items)) continue;
                    let cursor = 0;
                    let selectedReached = selectedId === undefined;
                    for (const item of track.items as Array<Record<string, any>>) {
                        if (!cutIds.has(item.id)) continue;
                        if (item.id === selectedId) {
                            selectedReached = true;
                            cursor = item.at + item.duration;
                            continue;
                        }
                        if (!selectedReached) {
                            cursor = Math.max(cursor, item.at + item.duration);
                            continue;
                        }
                        next = updateV2Item(next, { itemId: item.id, patch: { at: cursor } });
                        cursor += item.duration;
                    }
                }
                return next;
            });
            this.hideNotice();
            this.footer.textContent = "クリップ間の空白を詰めました。";
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice("クリップ間の空白を詰められません: " + detail);
            this.messages.error("クリップ間の空白を詰められません: " + detail);
        }
    }

    protected validTimelinePosition(time: number, track: number): boolean {
        return Number.isFinite(time) && time >= 0 && Number.isInteger(track) && track >= 0;
    }

    protected cutSegmentsOverlap(segments: ReturnType<typeof computeCutTrackSegments>): boolean {
        return segments.some((left, index) => segments.slice(index + 1).some(right =>
            left.track === right.track && left.at < right.end && right.at < left.end));
    }

    protected findFrozenNextIndex(cuts: readonly EditCut[], cutIndex: number): number | undefined {
        const segments = computeCutTrackSegments(cuts);
        const target = segments[cutIndex];
        if (!target) {
            return undefined;
        }
        for (let index = cutIndex + 1; index < cuts.length; index++) {
            if (segments[index].track !== target.track) {
                continue;
            }
            return cuts[index].at === undefined ? index : undefined;
        }
        return undefined;
    }

    async configure(location: ProjectLocation): Promise<void> {
        if (this.configured) {
            return;
        }
        this.configured = true;
        this.location = location;
        this.title.caption = `タイムライン — ${location.reviewUri.toString()}`;
        await this.reloadAll();
        requestAnimationFrame(() => this.renderStrip());
        this.toDispose.push(this.annotationsClient.onWillWriteEvent(uri => {
            this.recentWrites.set(uri, Date.now());
        }));
        this.toDispose.push(this.annotationsClient.onLintResultEvent(notification => {
            if (notification.projectRootUri === this.location?.root.toString()) {
                this.showDeferredLintResult(
                    notification.pass,
                    notification.errors,
                    notification.findings,
                    notification.writtenFiles
                );
            }
        }));
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (!this.location) {
                return;
            }
            if (event.contains(this.location.reviewUri)) {
                void this.reloadReview();
            }
            if (this.location.editUri && event.contains(this.location.editUri)
                && !this.isRecentWrite(this.location.editUri)) {
                void this.reloadEdit();
            }
            if (event.contains(this.location.captionsUri) && !this.isRecentWrite(this.location.captionsUri)) {
                void this.reloadCaptions();
            }
            if (this.location.analysisUri && event.contains(this.location.analysisUri)) {
                void this.reloadAnalysis();
            }
        }));
        try {
            this.toDispose.push(await this.fileService.watch(location.root, { recursive: true, excludes: [] }));
        } catch (error) {
            console.warn('[akari-annotations] file watching is unavailable', error);
        }
    }

    protected isRecentWrite(uri: URI): boolean {
        const key = uri.toString();
        const writtenAt = this.recentWrites.get(key) ?? 0;
        if (Date.now() - writtenAt <= 1000) {
            return true;
        }
        this.recentWrites.delete(key);
        return false;
    }

    protected showDeferredLintResult(
        pass: boolean,
        errors: readonly string[],
        findings: readonly UiLintFinding[] = [],
        writtenFiles?: readonly string[]
    ): void {
        if (pass) {
            if (this.deferredLintFooterMessage?.parentElement === this.footer) {
                this.footer.replaceChildren();
            }
            this.deferredLintFooterMessage = undefined;
            const warningSummary = japaneseLintWarningSummary(findings);
            if (warningSummary) {
                this.footer.textContent = warningSummary;
                this.messages.warn(warningSummary);
                return;
            }
            return;
        }
        this.footer.replaceChildren();
        const message = document.createElement('span');
        if (writtenFiles === undefined) {
            message.textContent = formatLintFailureForUi('保存後の検証で問題が見つかりました', errors, findings);
            const undo = document.createElement('button');
            undo.type = 'button';
            undo.textContent = '直前の編集を元に戻す';
            undo.disabled = this.historyService.canUndo === false;
            undo.addEventListener('click', () => void this.performUndo());
            this.footer.append(message, document.createTextNode(' '), undo);
            this.deferredLintFooterMessage = message;
            this.messages.warn(message.textContent);
            return;
        }
        const { own, foreign } = splitLintBlame(findings, writtenFiles);
        const ownErrors = own.filter(finding => finding.severity === 'error');
        const foreignErrors = foreign.filter(finding => finding.severity === 'error');
        const formatFinding = (finding: UiLintFinding): string =>
            `[${finding.check ?? 'edit-lint'}] ${finding.message ?? '不明なエラー'}`;
        if (ownErrors.length > 0) {
            message.textContent = formatLintFailureForUi(
                '保存後の検証で問題が見つかりました',
                ownErrors.map(formatFinding),
                ownErrors
            );
            const undo = document.createElement('button');
            undo.type = 'button';
            undo.textContent = '直前の編集を元に戻す';
            undo.disabled = this.historyService.canUndo === false;
            undo.addEventListener('click', () => void this.performUndo());
            this.footer.append(message, document.createTextNode(' '), undo);
            this.messages.warn(message.textContent);
        } else if (foreignErrors.length > 0) {
            const example = formatFinding(foreignErrors[0]);
            const ellipsis = foreignErrors.length > 1 ? ' …' : '';
            message.textContent = `このプロジェクトには保存前からの課題が ${foreignErrors.length} 件あります（例: ${example}${ellipsis}）。Lint レポートで確認してください`;
            this.footer.append(message);
        } else {
            this.deferredLintFooterMessage = undefined;
            return;
        }
        this.deferredLintFooterMessage = message;
    }

    protected async reloadAll(): Promise<void> {
        await Promise.all([this.reloadReview(), this.reloadEdit(), this.reloadCaptions(), this.reloadAnalysis()]);
        // 並列 reload の別系統が notice を clear しても、初期表示では射影不能の案内を最後に確定する。
        this.notifyCaptionSourceMappingWarning(true);
    }

    protected async reloadReview(): Promise<void> {
        if (!this.location) {
            return;
        }
        try {
            const exists = await this.fileService.exists(this.location.reviewUri);
            if (!exists) {
                this.review.annotations = [];
                this.hideNotice();
            } else {
                const source = (await this.fileService.readFile(this.location.reviewUri)).value.toString();
                const parsed = parseReview(source);
                this.review.annotations = parsed.annotations;
                this.showWarnings(parsed.warnings);
            }
        } catch (error) {
            this.review.annotations = [];
            this.showNotice(`レビューデータを読み取れません: ${this.errorMessage(error)}`);
        }
        this.renderStrip();
    }

    /**
     * 種別別ビュー（正本 packages/edit-store の EditAudioSfx）は fade_in/fade_out を運ばない
     * （EditAudioSfxWithFade の header comment 参照）。内部表現のアイテムが持つ宣言レコード
     * （`item.declaration` — 読み込み層が版差を吸収済み）から直接読んで足し込む。
     * 生 JSON も id の索引計算も要らない（アイテムが宣言と 1 対 1 で結び付いているため）。
     */
    protected withSfxFade(internal: InternalEdit): EditAudioSfxWithFade[] {
        const items: EditAudioSfxWithFade[] = [];
        for (const track of internal.tracks) {
            for (const item of track.items) {
                if (item.legacy.collection !== 'sfx' || item.legacy.value === undefined) {
                    continue;
                }
                const declaration = item.declaration as { fade_in?: unknown; fade_out?: unknown };
                const rawFadeIn = declaration.fade_in;
                const rawFadeOut = declaration.fade_out;
                const fadeIn = typeof rawFadeIn === 'number' && Number.isFinite(rawFadeIn)
                    && rawFadeIn >= 0 ? rawFadeIn : undefined;
                const fadeOut = typeof rawFadeOut === 'number' && Number.isFinite(rawFadeOut)
                    && rawFadeOut >= 0 ? rawFadeOut : undefined;
                items.push({
                    ...(item.legacy.value as EditAudioSfx),
                    ...(fadeIn !== undefined ? { fadeIn } : {}),
                    ...(fadeOut !== undefined ? { fadeOut } : {}),
                    ...this.audioEnvelopeFields(item.declaration)
                });
            }
        }
        return items.sort((left, right) => Number(left.id.slice(4)) - Number(right.id.slice(4)));
    }

    protected audioEnvelopeFields(declaration: Record<string, unknown>): AudioEnvelopeFields {
        const number = (key: string, min: number, max: number): number | undefined => {
            const value = declaration[key];
            return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
                ? value : undefined;
        };
        const keyframes = Array.isArray(declaration.keyframes)
            ? declaration.keyframes.flatMap(point => {
                if (!point || typeof point !== 'object' || Array.isArray(point)) return [];
                const raw = point as Record<string, unknown>;
                if (typeof raw.t !== 'number' || !Number.isFinite(raw.t)) return [];
                const normalized: AudioEnvelopeKeyframePayload = { t: raw.t };
                if (typeof raw.gain_db === 'number' && Number.isFinite(raw.gain_db)) {
                    normalized.gain_db = raw.gain_db;
                }
                if (typeof raw.easing === 'string') normalized.easing = raw.easing;
                return [normalized];
            }).sort((left, right) => left.t - right.t)
            : undefined;
        return {
            ...(typeof declaration.ducking === 'boolean' ? { ducking: declaration.ducking } : {}),
            ...(number('duck_db', -40, 0) !== undefined ? { duckDb: number('duck_db', -40, 0) } : {}),
            ...(number('duck_attack', 0, 2) !== undefined ? { duckAttack: number('duck_attack', 0, 2) } : {}),
            ...(number('duck_release', 0, 5) !== undefined ? { duckRelease: number('duck_release', 0, 5) } : {}),
            ...(keyframes !== undefined ? { keyframes } : {})
        };
    }

    protected withNarrationEnvelope(
        narration: EditAudioNarration[], internal: InternalEdit
    ): EditAudioNarrationWithEnvelope[] {
        const declarations = new Map<number, Record<string, unknown>>();
        for (const track of internal.tracks) for (const item of track.items) {
            if (item.legacy.collection === 'narration') declarations.set(item.legacy.index, item.declaration);
        }
        return narration.map((item, index) => ({
            ...item, ...this.audioEnvelopeFields(declarations.get(index) ?? {})
        }));
    }

    protected withBgmEnvelope(
        bgm: EditAudioBgm | undefined, internal: InternalEdit
    ): EditAudioBgmWithEnvelope | undefined {
        if (!bgm) return undefined;
        for (const track of internal.tracks) for (const item of track.items) {
            if (item.legacy.collection === 'bgm') {
                return { ...bgm, ...this.audioEnvelopeFields(item.declaration) };
            }
        }
        return bgm;
    }

    /** edit.json（版を問わない）を内部表現へ読む。版を知る呼び出しはこの 1 メソッドに閉じる。 */
    protected readEdit(source: string): InternalEdit {
        return readInternalEdit(source, { hasCaptions: this.captions.length > 0, captions: toAnchorCaptions(this.captions) });
    }

    /**
     * 表示・編集の基準になるトラック列。宣言があればそれを、無ければ読み込み層が導出した
     * 行を既定のグループ順へ並べ替えて使う。いずれも pinAudioGroupToBottom で正規化する。
     */
    protected baseTimelineTracks(internal: InternalEdit): EditTimelineTrack[] {
        return this.pinAudioGroupToBottom(
            projectLegacyEdit(internal).timeline?.tracks
                ?? sortDefaultTimelineTracks(derivedLegacyTracks(internal))
        );
    }

    protected async reloadEdit(): Promise<void> {
        this.invalidateContentExtent();
        this.editDocument = undefined;
        this.itemLocations.clear();
        this.cutItemIds = [];
        this.cuts = [];
        this.compatibilityCuts = [];
        this.editSources = [];
        this.sourceMap.clear();
        this.overlays = [];
        this.beats = [];
        this.layers = [];
        this.layerTransitionWarnings.clear();
        this.audioSfx = [];
        this.audioNarration = [];
        this.audioBgm = undefined;
        this.timelineTracks = [];
        this.compatibilityTimelineTracks = [];
        this.timelineTreeRows = [];
        this.expandedTimelineTreeRows = [];
        this.timelineTreeTracks = [];
        this.timelineTreePartsByHtml.clear();
        this.timelineCollapsedIds.clear();
        this.treeRowsByTrack.clear();
        this.fps = 30;
        if (this.location?.editUri) {
            try {
                const diskSource = (await this.fileService.readFile(this.location.editUri)).value.toString();
                const source = await this.resolveLegacyEditForOpen(diskSource);
                if (!source) {
                    throw new ReportedEditLoadFailure('古い edit.json を読み取り専用で開けません。');
                }
                // 版を知るのはここ（読み込み層）だけ。以降は内部表現（tracks[].items[]）と
                // その射影しか見ない。
                const internal = this.readEdit(source);
                const partsByHtml = new Map<string, Array<{ id: string; order: number }>>();
                const loadTreeParts = async (item: typeof internal.tracks[number]['items'][number]): Promise<void> => {
                    if (item.source.kind === 'html' && !partsByHtml.has(item.source.html)) {
                        const reference = item.source.html;
                        try {
                            const html = reference.trimStart().startsWith('<')
                                ? reference
                                : (await this.fileService.readFile(this.location!.editUri.parent.resolve(reference)))
                                    .value.toString();
                            partsByHtml.set(reference, scanHtmlParts(html));
                        } catch {
                            partsByHtml.set(reference, []);
                        }
                    }
                    for (const child of item.children) await loadTreeParts(child);
                };
                for (const track of internal.tracks) {
                    for (const item of track.items) await loadTreeParts(item);
                }
                this.timelineCollapsedState = new TimelineCollapsedState(this.location.root.toString());
                this.timelineTreeTracks = internal.tracks;
                this.timelineTreePartsByHtml = partsByHtml;
                const document = JSON.parse(source) as EditV2Document;
                await this.hydrateDocumentMotionReferences(document);
                this.editDocument = document;
                this.itemLocations = indexEditV2Items(document);
                const layerCauses = new Map((document.version === 2
                    ? findCrossTrackLayerEvacuations(document) : [])
                    .map(cause => [cause.itemId, cause] as const));
                for (const track of internal.tracks) {
                    for (const item of track.items) {
                        if (item.legacy.collection === 'cuts') {
                            this.cutItemIds[item.legacy.index] = item.id;
                        }
                        const transition = item.declaration.transition_out;
                        if (item.legacy.collection === 'layers' && transition
                            && typeof transition === 'object' && !Array.isArray(transition)) {
                            const cause = layerCauses.get(item.id);
                            this.layerTransitionWarnings.set(
                                item.id,
                                cause
                                    ? `このクリップは他トラックのアイテム（${cause.causeItemId}）と重なっているため PiP 経路へ退避され、宣言したトランジションは書き出されません。重なりを解消するか、トランジションを削除してください。`
                                    : 'このクリップは合成機能または同一トラック内の重なりにより PiP 経路へ退避され、宣言したトランジションは書き出されません。重なりを解消するか、トランジションを削除してください。'
                            );
                        }
                    }
                }
                const view = projectLegacyEdit(internal);
                this.compatibilityCuts = view.cuts as Array<EditCut & { transition_out?: unknown }>;
                // projectLegacyEdit の lint 互換ビューは transition_out を snake_case で運ぶ。
                // タイムライン表示モデルだけ既存 EditCut.transitionOut へ正規化する。
                this.cuts = this.compatibilityCuts.map(cut => ({
                    ...cut,
                    ...(cut.transitionOut === undefined && cut.transition_out && typeof cut.transition_out === 'object'
                        ? { transitionOut: cut.transition_out as EditCut['transitionOut'] } : {})
                }));
                this.editSources = internal.sources;
                this.rebuildSourceMap();
                this.overlays = view.overlays;
                this.beats = view.beats ?? [];
                this.layers = view.layers;
                this.audioSfx = this.withSfxFade(internal);
                this.audioNarration = this.withNarrationEnvelope(view.audioNarration, internal);
                this.audioBgm = this.withBgmEnvelope(view.audioBgm, internal);
                this.compatibilityTimelineTracks = view.timeline?.tracks
                    ?? sortDefaultTimelineTracks(derivedLegacyTracks(internal));
                this.timelineTracks = this.pinAudioGroupToBottom(this.compatibilityTimelineTracks);
                this.fps = view.fps;
                if (view.warnings.length > 0) {
                    this.showWarnings(view.warnings);
                }
            } catch (error) {
                const failure = classifyEditLoadFailure(error);
                if (failure.kind === 'invalid') {
                    this.showNotice(failure.notice);
                    console.error('[akari-annotations] edit.json を読み込めませんでした', error);
                }
            }
        }
        this.rebuildSegments();
        this.notifyCaptionSourceMappingWarning();
        this.selectionModel.audioMaster = readAudioMasterSnapshot(this.editDocument);
        this.selectionModel.fps = this.fps;
        this.pushSelectionSnapshot();
        await this.applyStoredTrackFlags();
        this.syncTimelineTrackTogglesToPreview();
        await this.loadTrackHeights();
        this.renderStrip();
    }

    protected async resolveLegacyEditForOpen(source: string): Promise<string | undefined> {
        let raw: { version?: unknown };
        try {
            raw = JSON.parse(source) as { version?: unknown };
        } catch {
            return source;
        }
        if (raw.version === 2) {
            this.setLegacyReadOnly(false);
            this.legacyReadOnlyText = undefined;
            this.legacyMigrationProposal = undefined;
            return source;
        }
        if (this.legacyReadOnlyText) {
            this.setLegacyReadOnly(true);
            return this.legacyReadOnlyText;
        }
        const location = this.location;
        if (!location?.editUri) return undefined;
        const planned = await this.annotationsService.planEditMigration({
            editUri: location.editUri.toString(),
            projectRootUri: location.root.toString()
        });
        if ('ok' in planned && planned.ok === false) {
            this.setLegacyReadOnly(true);
            this.showNotice(`このプロジェクトは変換できません: ${planned.blockers.join(' / ')}`);
            return undefined;
        }
        const proposal = planned as EditMigrationProposal;
        const summary = proposal.changes.map(change => `${change.path}: ${change.note}`).join('\n');
        const choice = await this.messages.info(
            `${proposal.filePath} は edit.json version ${proposal.version} です。\n${summary}`,
            '変換する', '読み取り専用で開く'
        );
        if (choice === '変換する') {
            await this.annotationsService.applyEditMigration(proposal);
            this.setLegacyReadOnly(false);
            void this.messages.info(
                `version 2 へ変換しました。変換前: ${proposal.backupPath}`,
                '元に戻す'
            ).then(async action => {
                if (action !== '元に戻す') return;
                await this.annotationsService.revertEditMigration(proposal);
                this.legacyReadOnlyText = proposal.nextText;
                this.legacyMigrationProposal = proposal;
                this.setLegacyReadOnly(true);
                await this.reloadEdit();
            });
            return proposal.nextText;
        }
        this.legacyReadOnlyText = proposal.nextText;
        this.legacyMigrationProposal = proposal;
        this.setLegacyReadOnly(true);
        this.showNotice('古い edit.json を読み取り専用で開いています。元ファイルは変更されていません。');
        return proposal.nextText;
    }

    protected setLegacyReadOnly(readOnly: boolean): void {
        this.legacyReadOnly = readOnly;
        this.node.classList.toggle('akari-legacy-readonly', readOnly);
        for (const element of Array.from(this.toolbar.querySelectorAll('button, input'))) {
            (element as HTMLButtonElement | HTMLInputElement).disabled = readOnly;
        }
        // stripScroll に draggable を立ててはいけない。HTML5 の draggable=true は「ドロップを
        // 受ける」ではなく要素自体をネイティブドラッグ元にする属性で、空き地からのマーキー
        // 選択が dragstart に乗っ取られてパネルのゴーストが付いてくる（2026-08-26 実機報告）。
        // 素材 D&D の受け側は dragover/drop リスナーだけで成立する。
    }

    protected defaultTrackHeight(kind: TimelineTrackKind): number {
        return kind === 'audio' ? DEFAULT_AUDIO_TRACK_HEIGHT_PX : CLIP_HEIGHT;
    }

    protected clampTrackHeight(value: number): number {
        return Math.min(MAX_TRACK_HEIGHT_PX, Math.max(MIN_TRACK_HEIGHT_PX, Math.round(value)));
    }

    /** cuts/audio トラックの高さを StorageService（ワークスペース状態）から読み込む。edit.json は経由しない。 */
    protected async loadTrackHeights(): Promise<void> {
        this.trackHeights.clear();
        this.trackHeightLoadPromises.clear();
        const editUri = this.location?.editUri;
        if (!editUri) {
            return;
        }
        const resizableTracks = this.timelineTracks.filter(track => track.kind === 'cuts' || track.kind === 'audio');
        const entries = await Promise.all(resizableTracks.map(async track => {
            const fallback = this.defaultTrackHeight(track.kind);
            const stored = await this.storage.getData<number>(this.trackHeightStorageKey(editUri, track.id), fallback);
            const height = typeof stored === 'number' && Number.isFinite(stored) ? this.clampTrackHeight(stored) : fallback;
            return [track.id, height] as const;
        }));
        for (const [id, height] of entries) {
            this.trackHeights.set(id, height);
        }
    }

    protected trackHeightStorageKey(editUri: URI, trackId: string): string {
        return `${TRACK_HEIGHT_STORAGE_PREFIX}:${editUri.toString()}:${trackId}`;
    }

    protected trackFlagStorageKey(editUri: URI, trackId: string, field: 'hidden' | 'muted' | 'locked'): string {
        return `${TRACK_FLAG_STORAGE_PREFIX}:${editUri.toString()}:${trackId}:${field}`;
    }

    protected async applyStoredTrackFlags(): Promise<void> {
        const editUri = this.location?.editUri;
        this.beatsLocked = false;
        this.localLockedTrackIds.clear();
        if (!editUri) return;
        this.beatsLocked = await this.storage.getData<boolean>(this.trackFlagStorageKey(editUri, 'beats', 'locked'), false);
        const migrateMutedIds = new Set<string>();
        this.timelineTracks = await Promise.all(this.timelineTracks.map(async track => {
            const [hidden, muted, locked] = await Promise.all([
                this.storage.getData<boolean>(this.trackFlagStorageKey(editUri, track.id, 'hidden'), false),
                this.storage.getData<boolean>(this.trackFlagStorageKey(editUri, track.id, 'muted'), false),
                this.storage.getData<boolean>(this.trackFlagStorageKey(editUri, track.id, 'locked'), false)
            ]);
            if (track.muted !== true && muted === true) migrateMutedIds.add(track.id);
            if (locked) this.localLockedTrackIds.add(track.id);
            return { ...track, locked, ...(hidden ? { hidden: true } : {}) };
        }));
        this.computeAudioDisplayTracks();
        this.computeBgmDisplayTrack();
        this.computeCaptionsDisplayTrack();
        // captions.json reloads in parallel; preload its supplemental row even before captions arrive.
        await Promise.all(withCaptionsDisplaySupplement(this.displayTimelineTracks, true).filter(track =>
            !this.timelineTracks.some(candidate => candidate.id === track.id)
        ).map(async track => {
            if (await this.storage.getData<boolean>(this.trackFlagStorageKey(editUri, track.id, 'locked'), false)) {
                this.localLockedTrackIds.add(track.id);
            }
        }));
        if (migrateMutedIds.size === 0) return;
        try {
            // 保存成功後だけ表示へ反映する。reload しないので移行中に再入しない。
            await this.commitEditMutation('トラックのミュートを保存', doc =>
                [...migrateMutedIds].reduce((value, trackId) => setV2TrackFlag(value, {
                    trackId, field: 'muted', value: true
                }), doc), { reload: false, history: false });
            this.timelineTracks = this.timelineTracks.map(track =>
                migrateMutedIds.has(track.id) ? { ...track, muted: true } : track);
            await Promise.all([...migrateMutedIds].map(trackId =>
                this.storage.setData(this.trackFlagStorageKey(editUri, trackId, 'muted'), undefined)));
        } catch (error) {
            console.warn('[akari-annotations] track mute migration failed', error);
            this.footer.textContent = `トラックのミュートを保存できません: ${this.errorMessage(error)}`;
        }
    }

    /**
     * トラックの現在の高さ。未ロード（R7-3 の表示専用トラック等、起動時バッチに含まれなかった行）
     * なら遅延で StorageService から取得しつつ、その間は既定値を返す（ensureVideoDurationFetch と同型）。
     */
    protected trackHeightFor(track: EditTimelineTrack): number {
        const cached = this.trackHeights.get(track.id);
        if (cached !== undefined) {
            return cached;
        }
        this.ensureTrackHeightLoaded(track);
        return this.defaultTrackHeight(track.kind);
    }

    protected ensureTrackHeightLoaded(track: EditTimelineTrack): void {
        const editUri = this.location?.editUri;
        if (!editUri || this.trackHeightLoadPromises.has(track.id)) {
            return;
        }
        const fallback = this.defaultTrackHeight(track.kind);
        const promise = this.storage.getData<number>(this.trackHeightStorageKey(editUri, track.id), fallback)
            .then(stored => {
                const height = typeof stored === 'number' && Number.isFinite(stored) ? this.clampTrackHeight(stored) : fallback;
                this.trackHeights.set(track.id, height);
                this.renderStrip();
            });
        this.trackHeightLoadPromises.set(track.id, promise);
    }

    /**
     * トラック境界の上下ドラッグで高さを連続変更する（R7-2・T4 の3段階ボタンを退役）。
     * dragState は使わない（renderStrip はドラッグ中の再描画を延期する仕組みのため、
     * ここではライブ再描画のため直接 renderStrip を呼ぶ）。
     */
    protected beginTrackHeightResize(event: PointerEvent, track: EditTimelineTrack): void {
        event.preventDefault();
        event.stopPropagation();
        const pointerId = event.pointerId;
        const startY = event.clientY;
        const startHeight = this.trackHeightFor(track);
        let currentHeight = startHeight;
        const onMove = (moveEvent: PointerEvent): void => {
            if (moveEvent.pointerId !== pointerId) {
                return;
            }
            currentHeight = this.clampTrackHeight(startHeight + (moveEvent.clientY - startY));
            this.trackHeights.set(track.id, currentHeight);
            this.renderStrip();
        };
        const onUp = (upEvent: PointerEvent): void => {
            if (upEvent.pointerId !== pointerId) {
                return;
            }
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            const editUri = this.location?.editUri;
            if (editUri) {
                void this.storage.setData(this.trackHeightStorageKey(editUri, track.id), currentHeight);
            }
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }

    protected trackHeightResizeHandle(track: EditTimelineTrack): HTMLDivElement {
        const handle = document.createElement('div');
        handle.className = 'akari-track-header-resize-handle';
        handle.dataset.akariResize = 'height';
        handle.setAttribute('aria-hidden', 'true');
        handle.addEventListener('pointerdown', event => this.beginTrackHeightResize(event, track));
        return handle;
    }

    protected rebuildSourceMap(): void {
        this.sourceMap.clear();
        this.defaultSource = undefined;
        const editUri = this.location?.editUri;
        if (!editUri) {
            return;
        }
        for (const source of this.editSources) {
            if (source.path === undefined) {
                continue;
            }
            const mediaPath = source.proxy ?? source.path;
            const resolved: ResolvedEditSource = {
                path: source.path,
                videoUri: this.resolveEditMediaUri(mediaPath, editUri).toString()
            };
            this.sourceMap.set(source.id, resolved);
            if (source.isDefault) {
                this.defaultSource = resolved;
            }
        }
    }

    protected resolveEditMediaUri(path: string, editUri: URI): URI {
        if (/^[a-z][a-z\d+.-]*:/iu.test(path) && !/^[a-z]:[\\/]/iu.test(path)) {
            return new URI(path);
        }
        if (/^[a-z]:[\\/]/iu.test(path)) {
            return new URI(`file:///${path.replace(/\\/gu, '/')}`);
        }
        if (path.startsWith('\\\\')) {
            return new URI(`file:${path.replace(/\\/gu, '/')}`);
        }
        if (path.startsWith('/')) {
            return new URI(path).withScheme('file');
        }
        return editUri.parent.resolve(path).normalizePath();
    }

    protected async reloadCaptions(): Promise<void> {
        this.invalidateContentExtent();
        this.captions = [];
        this.captionSources.clear();
        this.defaultTextStyle = undefined;
        if (this.location) {
            try {
                const source = (await this.fileService.readFile(this.location.captionsUri)).value.toString();
                const parsed = parseCaptions(source);
                this.captions = parsed.captions;
                this.captionSources = readCaptionSourceMap(source);
                this.defaultTextStyle = parsed.defaultTextStyle;
                if (parsed.warnings.length > 0) {
                    this.showWarnings(parsed.warnings);
                }
            } catch {
                // A missing or unreadable captions.json means no caption segments are drawn.
            }
        }
        this.notifyCaptionSourceMappingWarning();
        this.pushSelectionSnapshot();
        this.renderStrip();
    }

    /** cuts[].at / track と後方互換の連結規則から出力秒セグメントを再構築する。 */
    protected rebuildSegments(): void {
        this.invalidateContentExtent();
        this.segments = computeCutTrackSegments(this.cuts).map(segment => {
            const cut = this.cuts[segment.index];
            const speed = typeof cut.speed === 'number' && cut.speed > 0 ? cut.speed : 1;
            return {
                index: segment.index, src: cut.src, in: cut.in, out: cut.out, speed,
                transitionOut: cut.transitionOut, tlStart: segment.at, tlEnd: segment.end, track: segment.track
            };
        });
        this.nextSameTrackSegmentByCutIndex.clear();
        this.unsupportedTrackTransitionByCutIndex.clear();
        this.nonAdjacentTransitionTargetByCutIndex.clear();
        this.zeroOverlapTransitionIndexes.clear();
        this.declaredTrackTransitionWarnings.clear();
        this.declaredTransitionAdjacencyWarnings.clear();
        for (let cutIndex = 0; cutIndex < this.compatibilityCuts.length; cutIndex++) {
            const trackRef = unsupportedTrackTransitionTarget(
                this.compatibilityCuts,
                this.compatibilityTimelineTracks,
                cutIndex
            );
            if (trackRef !== undefined) {
                this.unsupportedTrackTransitionByCutIndex.set(cutIndex, trackRef);
                if (this.compatibilityCuts[cutIndex]?.transition_out) {
                    this.declaredTrackTransitionWarnings.add(cutIndex);
                }
            }
        }
        const nextByTrack = new Map<number, OutputSegment>();
        for (let position = this.segments.length - 1; position >= 0; position--) {
            const earlier = this.segments[position];
            const later = nextByTrack.get(earlier.track);
            if (later) {
                this.nextSameTrackSegmentByCutIndex.set(earlier.index, later);
                const overlapFrames = cutOverlapFrames(earlier, later, this.fps);
                if (overlapFrames === 0) {
                    if (earlier.transitionOut && this.transitionHandlePlanSync(earlier, later).effectiveSeconds <= 0) {
                        this.zeroOverlapTransitionIndexes.add(earlier.index);
                        this.declaredTransitionAdjacencyWarnings.add(earlier.index);
                    }
                } else if (!areCutsAdjacent(earlier, later, this.fps)) {
                    this.nonAdjacentTransitionTargetByCutIndex.set(earlier.index, later.index);
                    if (earlier.transitionOut) {
                        this.declaredTransitionAdjacencyWarnings.add(earlier.index);
                    }
                }
            }
            nextByTrack.set(earlier.track, earlier);
        }
    }

    protected async reloadAnalysis(): Promise<void> {
        this.wordBoundaries = [];
        if (this.location?.analysisUri) {
            try {
                const analysis = JSON.parse((await this.fileService.readFile(this.location.analysisUri)).value.toString());
                if (Array.isArray(analysis?.transcript)) {
                    const boundaries: number[] = [];
                    for (const segment of analysis.transcript) {
                        if (!Array.isArray(segment?.words)) {
                            continue;
                        }
                        for (const word of segment.words) {
                            if (typeof word?.start === 'number' && Number.isFinite(word.start)) {
                                boundaries.push(word.start);
                            }
                            if (typeof word?.end === 'number' && Number.isFinite(word.end)) {
                                boundaries.push(word.end);
                            }
                        }
                    }
                    this.wordBoundaries = boundaries;
                }
            } catch {
                // Snapping degrades to clip and playhead boundaries when analysis is unavailable.
            }
        }
    }

    /**
     * 尺の集計は O(items) で、ズーム 1 イベントあたり totalDuration() 経由で 8 回前後呼ばれていた。
     * モデル（cuts / overlays / layers / audio / captions / 実尺）が変わるまではメモした値を返す。
     * renderStrip() の先頭で必ず進めるので、描画ごとに 1 回は再集計される。
     */
    protected contentEndDuration(): number {
        return this.contentEndMemo.read(this.contentExtentRevision);
    }

    protected invalidateContentExtent(): void {
        this.contentExtentRevision++;
    }

    protected computeContentEndDuration(): number {
        if (this.cuts.length > 0) {
            // アウトプット軸: cuts 尺合計とオーバーレイ終端の大きい方（10 秒フロアは cuts があるときは外す）。
            const cutsDuration = this.segments.reduce((max, segment) => Math.max(max, segment.tlEnd), 0);
            const overlaysEnd = this.overlays.reduce((max, overlay) => Math.max(max, overlay.start + overlay.duration), 0);
            const layersEnd = this.layers.reduce((max, layer) => Math.max(max, layer.t + layer.duration), 0);
            const sfxEnd = this.audioSfx.reduce((max, sfx) => Math.max(max, sfx.t + sfx.duration), 0);
            const narrationEnd = this.audioNarration.reduce(
                (max, narration) => Math.max(max, narration.t + this.narrationDisplayDuration(narration)), 0);
            return Math.max(cutsDuration, overlaysEnd, layersEnd, sfxEnd, narrationEnd);
        }
        const candidates = [
            10,
            ...this.captions.map(caption => caption.end),
            ...this.overlays.map(overlay => overlay.start + overlay.duration),
            ...this.layers.map(layer => layer.t + layer.duration),
            ...this.audioSfx.map(sfx => sfx.t + sfx.duration),
            ...this.audioNarration.map(narration => narration.t + this.narrationDisplayDuration(narration)),
            ...this.beats.map(beat => beat.t + 1),
            ...this.annotations.map(annotation => annotation.sourceT + 1)
        ];
        return Math.max(...candidates);
    }

    protected totalDuration(): number {
        return resolveTimelineExtentSeconds(this.contentEndDuration(), this.viewDuration);
    }

    /** source 秒 → 出力秒。cuts が無ければ恒等写像（後方互換）。範囲外は最も近いセグメントへクランプする。 */
    protected sourceToOutput(t: number): number {
        if (this.segments.length === 0) {
            return t;
        }
        let best: { segment: OutputSegment; distance: number } | undefined;
        for (const segment of this.segments) {
            if (t >= segment.in && t <= segment.out) {
                return segment.tlStart + (t - segment.in) / segment.speed;
            }
            const distance = t < segment.in ? segment.in - t : t - segment.out;
            if (!best || distance < best.distance) {
                best = { segment, distance };
            }
        }
        const segment = best!.segment;
        const clamped = Math.min(segment.out, Math.max(segment.in, t));
        return segment.tlStart + (clamped - segment.in) / segment.speed;
    }

    /** 出力秒 → source 秒。cuts が無ければ恒等写像（後方互換）。 */
    protected outputToSource(t: number): number {
        if (this.segments.length === 0) {
            return t;
        }
        for (const segment of this.segments) {
            if (t >= segment.tlStart && t <= segment.tlEnd) {
                return segment.in + (t - segment.tlStart) * segment.speed;
            }
        }
        const last = this.segments[this.segments.length - 1];
        if (t > last.tlEnd) {
            return last.out;
        }
        return this.segments[0].in;
    }

    /**
     * source 秒区間 → 出力秒区間の配列。削除区間で分断される字幕を複数区間として返す。
     * src 指定時は同じ src のセグメントだけを対象にする。cuts が無く src も無ければ
     * 入力をそのまま1区間として返す（単一ソース後方互換）。
     */
    protected sourceRangeToOutputRanges(start: number, end: number, src?: string): Array<[number, number]> {
        if (this.segments.length === 0) {
            return src === undefined ? [[start, end]] : [];
        }
        const ranges: Array<[number, number]> = [];
        for (const segment of this.segments) {
            if (src !== undefined && segment.src !== src) {
                continue;
            }
            const overlapStart = Math.max(start, segment.in);
            const overlapEnd = Math.min(end, segment.out);
            if (overlapEnd > overlapStart) {
                ranges.push([
                    segment.tlStart + (overlapStart - segment.in) / segment.speed,
                    segment.tlStart + (overlapEnd - segment.in) / segment.speed
                ]);
            }
        }
        return ranges;
    }

    protected captionSourceForMapping(captionId: string): CaptionSourceForMapping {
        return resolveCaptionSourceForMapping(
            captionId,
            this.captionSources,
            this.segments.map(segment => segment.src)
        );
    }

    protected notifyCaptionSourceMappingWarning(ensureVisible = false): void {
        const warning = computeCaptionSourceMappingWarning(
            this.captions,
            this.captionSources,
            this.segments.map(segment => segment.src)
        );
        const shouldNotify = shouldNotifyCaptionSourceMappingWarning(
            this.lastCaptionSourceMappingWarning,
            warning
        );
        this.lastCaptionSourceMappingWarning = warning;
        if ((ensureVisible || shouldNotify) && warning !== undefined) {
            this.showNotice(warning);
        }
    }

    /**
     * lint（captions.overlap）と同じ時間群の字幕を返す: output 時間軸は output 同士、
     * source 時間軸は同じ src（captionSourceForMapping）同士。自分は含めない。
     */
    protected captionOverlapNeighbors(captionId: string, timeDomain: 'source' | 'output'): CaptionNeighborRange[] {
        if (timeDomain === 'output') {
            return this.captions
                .filter(candidate => candidate.id !== captionId && candidate.timeDomain === 'output')
                .map(candidate => ({ id: candidate.id, start: candidate.start, end: candidate.end }));
        }
        const source = this.captionSourceForMapping(captionId);
        return this.captions
            .filter(candidate => candidate.id !== captionId && candidate.timeDomain !== 'output'
                && this.captionSourceForMapping(candidate.id) === source)
            .map(candidate => ({ id: candidate.id, start: candidate.start, end: candidate.end }));
    }

    protected captionRangeToOutputRanges(
        captionId: string, start: number, end: number
    ): Array<[number, number]> {
        const caption = this.captions.find(candidate => candidate.id === captionId);
        if (caption?.timeDomain === 'output') {
            return [[start, end]];
        }
        const src = this.captionSourceForMapping(captionId);
        return this.captionSourceRangeToOutputRanges(start, end, src);
    }

    protected captionTreeRow(captionId: string): TimelineTreeRow | undefined {
        return this.expandedTimelineTreeRows.find(row => {
            if (row.itemKind !== 'caption') return false;
            if (row.id.endsWith(`#${captionId}`)) return true;
            const raw = this.rawV2Item(row.id);
            return raw?.source?.kind === 'caption' && raw.source.id === captionId;
        });
    }

    protected captionSourceRangeToOutputRanges(
        start: number, end: number, src: CaptionSourceForMapping
    ): Array<[number, number]> {
        if (this.segments.length === 0) {
            return [[start, end]];
        }
        return src === null ? [] : this.sourceRangeToOutputRanges(start, end, src);
    }

    protected visibleDuration(): number {
        return this.viewDuration ?? this.totalDuration();
    }

    /**
     * ㉕ トラック群の縦中央寄せ: topOffset を全レーンの起点に一様に加算するだけで、
     * 個々の top 計算式（beats/captions/overlay/layer/cut/audio 各分岐）には一切手を
     * 入れずに「先頭からの積み上げ全体を下へずらす」を実現する。呼び出し側
     * （renderStrip）は topOffset=0 で自然高さを測ってからギャップ量を決め、
     * 中央寄せが要る場合だけ topOffset を与えて再計算する。
     */
    protected calculateLaneLayout(topOffset = 0): number {
        this.computeAudioDisplayTracks();
        this.computeBgmDisplayTrack();
        this.computeCaptionsDisplayTrack();
        this.captionLayouts = computeCaptionSubrowLayout(
            this.captions.map(caption => ({
                ...caption,
                src: this.captionSourceForMapping(caption.id)
            })),
            MINIMUM_ITEM_DURATION,
            (start, end, src) => this.captionSourceRangeToOutputRanges(start, end, src)
        );
        const captionsByPath = new Map([['captions.json', this.captions.flatMap(caption => {
            const layout = this.captionLayouts.get(caption.id);
            return layout ? [{ id: caption.id, at: layout.start, duration: layout.end - layout.start }] : [];
        })]]);
        this.expandedTimelineTreeRows = buildTimelineTreeRows(this.timelineTreeTracks, {
            includeAllItems: true,
            partsByHtml: this.timelineTreePartsByHtml,
            captionsByPath
        });
        if (this.focusScope.rootId !== null
            && this.expandedTimelineTreeRows.some(row => row.id === this.focusScope.rootId)) {
            this.focusScope = enterFocusScope(this.expandedTimelineTreeRows, this.focusScope.rootId);
        } else {
            this.focusScope = initialFocusScope(this.expandedTimelineTreeRows);
        }
        const pureGroupIds = this.expandedTimelineTreeRows
            .filter(row => row.sourceKind === 'group' && row.hasChildren).map(row => row.id);
        const expanded = this.timelineCollapsedState?.snapshot(pureGroupIds) ?? new Set<string>();
        const collapsed = new Set(pureGroupIds.filter(id => !expanded.has(id)));
        this.timelineCollapsedIds.clear();
        for (const id of collapsed) this.timelineCollapsedIds.add(id);
        this.timelineTreeRows = this.focusScope.rootId === null
            ? applyTimelineCollapsedRows(this.expandedTimelineTreeRows, this.timelineCollapsedIds)
            : rowsInFocusScope(this.expandedTimelineTreeRows, this.focusScope);
        const headerRows = this.focusScope.rootId === null
            ? visibleTimelineTreeRows(this.timelineTreeRows)
            : this.timelineTreeRows;
        this.treeRowsByTrack = rowsByTrack(headerRows);
        this.detachedCaptionChipRows = detachedCaptionChipRows(this.timelineTreeRows, headerRows);
        this.keyframeRowsByItem.clear();
        if (this.focusScope.rootId !== null) {
            for (const row of headerRows) {
                const raw = this.rawKeyframeItem(row.id);
                if (!raw) continue;
                const requested = new Set<KeyframeProperty>([
                    'transform.x', 'transform.y', 'transform.scale', 'transform.rotate', 'opacity',
                    ...(this.extraKeyframeProperties.get(row.id) ?? [])
                ]);
                this.keyframeRowsByItem.set(row.id, deriveTimelineKeyframeRows({
                    id: row.id,
                    duration: typeof raw.duration === 'number' ? raw.duration : Math.round(row.duration * this.fps),
                    keyframes: raw.keyframes,
                    crop: raw.crop,
                    perspective: raw.perspective
                }, [...requested]));
            }
        }
        this.renderFocusBreadcrumbs();
        let nextTop = topOffset;
        const beats = { top: nextTop, height: this.beats.length > 0 ? SUBROW_STRIDE : 0 };
        if (beats.height > 0) {
            nextTop += beats.height + LANE_GAP;
        }
        let captions: LaneBounds = { top: nextTop, height: 0 };
        this.overlayRows.clear();
        this.overlayTrackLayouts = [];
        this.layerRows.clear();
        const layerTracks: TrackGroupLayout[] = [];
        this.audioSfxRows.clear();
        this.audioNarrationRows.clear();
        this.audioTrackSubrowCounts.clear();
        const audioTracks: TrackGroupLayout[] = [];
        const cutTracks: TrackGroupLayout[] = [];
        const tracks: TrackGroupLayout[] = [];
        const isTopLevelItem = (id: string): boolean => {
            const treeRow = this.expandedTimelineTreeRows.find(row => row.id === id);
            return treeRow ? treeRow.parentId === undefined : this.itemLocations.get(id)?.parentId === undefined;
        };
        for (const timelineTrack of [...this.displayTimelineTracks].reverse()) {
            if (this.focusScope.rootId !== null && !(this.treeRowsByTrack.get(timelineTrack.id)?.length)) continue;
            const ref = timelineTrack.ref ?? 0;
            const captionRows = this.detachedCaptionChipRows.filter(row => row.trackId === timelineTrack.id);
            let captionRowsMixedWithItems = false;
            let height = SUBROW_STRIDE;
            if (timelineTrack.kind === 'cuts') {
                height = this.trackHeightFor(timelineTrack);
            } else if (timelineTrack.kind === 'layers') {
                const items = this.layers.filter(layer => (layer.track ?? 0) === ref && isTopLevelItem(layer.id));
                const chipLayout = assignDetachedCaptionChipSubRows(
                    items.map(layer => ({ id: layer.id, start: layer.t, end: layer.t + layer.duration })),
                    captionRows,
                    { placement: 'mix', baseHeight: SUBROW_STRIDE, subrowStride: SUBROW_STRIDE }
                );
                items.forEach(layer => this.layerRows.set(layer.id, chipLayout.rowById.get(layer.id) ?? 0));
                captionRows.forEach(row => this.overlayRows.set(row.id, chipLayout.rowById.get(row.id) ?? 0));
                height = chipLayout.height;
                captionRowsMixedWithItems = true;
            } else if (timelineTrack.kind === 'overlays') {
                const items = this.overlays.filter(overlay => overlay.track === ref && isTopLevelItem(overlay.id));
                const chipLayout = assignDetachedCaptionChipSubRows(
                    items.map(overlay => ({
                        id: overlay.id, start: overlay.start, end: overlay.start + overlay.duration
                    })),
                    captionRows,
                    { placement: 'mix', baseHeight: SUBROW_STRIDE, subrowStride: SUBROW_STRIDE }
                );
                items.forEach(overlay => this.overlayRows.set(overlay.id, chipLayout.rowById.get(overlay.id) ?? 0));
                captionRows.forEach(row => this.overlayRows.set(row.id, chipLayout.rowById.get(row.id) ?? 0));
                height = chipLayout.height;
                captionRowsMixedWithItems = true;
            } else if (timelineTrack.kind === 'captions') {
                height = SUBROW_STRIDE;
            } else {
                // audio は track（ref）ごとに独立した帯として積む。narration / BGM も v2 item を
                // 読んだ投影形では実 track ref を持つため、その ref の帯だけへ乗せる。
                // sfx 同士の重なりは computeAudioDisplayTracks（R7-3）が表示上の別トラックへ
                // 振り分け済み。
                const intervals = [
                    ...(this.audioBgm && this.bgmDisplayTrack(this.audioBgm) === ref
                        // BGM バーの終端はコンテンツ終端（実際に音が使われる範囲）。totalDuration() は
                        // スクロール余白込みの表示全長（全体表示では contentEnd に10%余白）なので使わない
                        // （実機報告 2026-08-18: mp3 実尺相当までバーが伸びて見えていた）。
                        ? [{ start: 0, end: this.contentEndDuration(), id: this.audioBgm.id, kind: 'bgm' as const }] : []),
                    ...this.audioNarration.filter(narration => this.narrationDisplayTrack(narration) === ref
                        && isTopLevelItem(narration.id))
                        .map(narration => ({
                        start: narration.t,
                        end: narration.t + this.narrationDisplayDuration(narration),
                        id: narration.id,
                        kind: 'narration' as const
                    })),
                    ...this.audioSfx.filter(sfx => this.sfxDisplayTrack(sfx) === ref
                        && isTopLevelItem(sfx.id))
                        .map(sfx => ({ start: sfx.t, end: this.sfxIntervalEnd(sfx), id: sfx.id, kind: 'sfx' as const }))
                ];
                const rows = assignSubRows(intervals);
                intervals.forEach((item, index) => {
                    if (item.kind === 'bgm') {
                        this.audioBgmTop = nextTop + (rows[index] ?? 0) * SUBROW_STRIDE;
                    } else if (item.kind === 'narration') {
                        this.audioNarrationRows.set(item.id, rows[index] ?? 0);
                    } else {
                        this.audioSfxRows.set(item.id, rows[index] ?? 0);
                    }
                });
                const subrowCount = Math.max(1, rows.length ? Math.max(...rows) + 1 : 0);
                this.audioTrackSubrowCounts.set(timelineTrack.id, subrowCount);
                height = Math.max(subrowCount * SUBROW_STRIDE, this.trackHeightFor(timelineTrack));
            }
            const treeRows = this.treeRowsByTrack.get(timelineTrack.id) ?? [];
            const treeRowOffset = timelineTreeRowOffset(treeRows.length);
            let propertyRowCount = 0;
            treeRows.forEach((row, visualRow) => {
                this.overlayRows.set(row.id, treeRowOffset + visualRow + propertyRowCount);
                this.layerRows.set(row.id, treeRowOffset + visualRow + propertyRowCount);
                this.audioSfxRows.set(row.id, treeRowOffset + visualRow + propertyRowCount);
                this.audioNarrationRows.set(row.id, treeRowOffset + visualRow + propertyRowCount);
                propertyRowCount += this.keyframeRowsByItem.get(row.id)?.length ?? 0;
            });
            height = calculateTimelineTrackHeight({
                baseHeight: height,
                treeRowCount: treeRows.length,
                propertyRowCount,
                subrowStride: SUBROW_STRIDE
            });
            if (!captionRowsMixedWithItems && captionRows.length > 0) {
                const chipLayout = assignDetachedCaptionChipSubRows([], captionRows, {
                    placement: 'append', baseHeight: height, subrowStride: SUBROW_STRIDE
                });
                captionRows.forEach(row => this.overlayRows.set(row.id, chipLayout.rowById.get(row.id) ?? 0));
                height = chipLayout.height;
            }
            const layout = {
                id: timelineTrack.id, kind: timelineTrack.kind, track: ref, top: nextTop, height,
                hidden: !!timelineTrack.hidden, muted: !!timelineTrack.muted
            };
            tracks.push(layout);
            if (timelineTrack.kind === 'cuts') {
                cutTracks.push(layout);
            } else if (timelineTrack.kind === 'layers') {
                layerTracks.push(layout);
            } else if (timelineTrack.kind === 'overlays') {
                this.overlayTrackLayouts.push({ ...layout, rows: [] });
            } else if (timelineTrack.kind === 'captions') {
                captions = layout;
            } else {
                audioTracks.push(layout);
            }
            nextTop += height + LANE_GAP;
        }
        this.laneLayout = {
            beats,
            captions,
            overlayTracks: this.overlayTrackLayouts,
            cutTracks,
            layerTracks,
            audioTracks,
            tracks
        };
        return Math.max(0, nextTop - LANE_GAP) + STRIP_BOTTOM_MARGIN;
    }

    /**
     * R7-3・読み込み時の重なり自動配置: 同一 audio ref 内で時間が重なる sfx を検知し、
     * 表示上の追加トラック行（this.displayTimelineTracks）へ決定的に振り分ける
     * （中核アルゴリズムは computeAudioOverlapLayout、common/ の純粋関数として単体テスト済み）。
     * edit.json への書き戻しは一切行わない（sfx.track は不変）。ユーザーがその sfx を
     * 実際に動かした時点で、既存の moveSfx 書き込み経路が this.sfxDisplayTrack() の
     * 値をそのまま採用して確定させる（commitDrag の 'audio' 分岐・originalTrack 参照）。
     */
    protected computeAudioDisplayTracks(): void {
        const declaredRefs: number[] = [];
        for (const track of this.timelineTracks) {
            if (track.kind === 'audio') {
                declaredRefs.push(track.ref ?? 0);
            }
        }
        const items = this.audioSfx.filter(sfx => this.itemLocations.get(sfx.id)?.parentId === undefined).map(sfx => ({
            id: sfx.id, track: sfx.track ?? 0, start: sfx.t, end: this.sfxIntervalEnd(sfx)
        }));
        const { overrides, syntheticTracks } = computeAudioOverlapLayout(items, declaredRefs);
        this.audioAutoTrackOverride.clear();
        for (const [id, ref] of overrides) {
            this.audioAutoTrackOverride.set(id, ref);
        }
        if (syntheticTracks.length === 0) {
            this.displayTimelineTracks = this.timelineTracks;
            return;
        }
        const lastAudioIndex = this.timelineTracks.reduce(
            (found, track, index) => track.kind === 'audio' ? index : found, -1
        );
        const insertAt = lastAudioIndex >= 0 ? lastAudioIndex + 1 : 0;
        const next = [...this.timelineTracks];
        next.splice(insertAt, 0, ...syntheticTracks.map(track => (
            { id: track.id, kind: 'audio' as const, ref: track.ref }
        )));
        this.displayTimelineTracks = next;
    }

    /**
     * 表示専用の字幕レーン補完（司令塔裁定 2026-08-12・裁定 2）: this.timelineTracks
     * （明示 timeline.tracks、または派生ベースライン）に captions 種別が 1 つも無くても、
     * captions.json（this.captions）に字幕があれば表示上のみ補う（中核アルゴリズムは
     * withCaptionsDisplaySupplement、common/ の純粋関数として単体テスト済み）。edit.json への
     * 書き戻しは一切行わない。reloadEdit / reloadCaptions は別々に走るため（読み込み順に依存
     * させない要件）、本メソッドは renderStrip の度に calculateLaneLayout 冒頭から必ず呼ばれ、
     * その時点の this.captions / this.timelineTracks の最新値から毎回作り直す。
     */
    protected computeCaptionsDisplayTrack(): void {
        this.displayTimelineTracks = withCaptionsDisplaySupplement(
            this.displayTimelineTracks, this.captions.length > 0
        );
    }

    /**
     * 表示専用の音声レーン補完（2026-08-18 実機報告「BGM が鳴るのにタイムラインに出ない」）:
     * 明示 timeline.tracks に audio 種別が 1 つも無くても、audio.bgm が宣言されていれば
     * 表示上のみ最下段へ補う（中核は withAudioDisplaySupplement、字幕補完〔裁定 2026-08-12・
     * 裁定 2〕と同型の純関数として単体テスト済み）。BGM バー自体の描画は calculateLaneLayout の
     * 既存 bgm 区間処理が実 track ref の帯で拾う。edit.json への書き戻しは一切行わない。
     */
    protected computeBgmDisplayTrack(): void {
        this.displayTimelineTracks = withAudioDisplaySupplement(
            this.displayTimelineTracks,
            Boolean(this.audioBgm),
            this.audioBgm ? this.bgmDisplayTrack(this.audioBgm) : 0
        );
    }

    protected narrationDisplayTrack(narration: EditAudioNarration): number {
        return narration.track ?? 0;
    }

    protected bgmDisplayTrack(bgm: EditAudioBgm): number {
        return bgm.track ?? 0;
    }

    /** sfx の表示上の割当トラック ref（R7-3 の自動配置で上書きされていればそれを、なければ実際の sfx.track を返す）。 */
    /** narration は source の in/out と speed を表示秒へ戻す。実尺未解決の間は 1 秒のプレースホルダ。 */
    protected narrationDisplayDuration(narration: EditAudioNarration): number {
        const cached = this.audioDurationCache.get(narration.path);
        const inSeconds = narration.in ?? 0;
        const speed = narration.speed !== undefined && narration.speed > 0 ? narration.speed : 1;
        if (narration.out !== undefined) {
            return Math.max(0, narration.out - inSeconds) / speed;
        }
        return typeof cached === 'number' && cached > 0
            ? Math.max(0, cached - inSeconds) / speed
            : 1;
    }

    protected sfxDisplayTrack(sfx: EditAudioSfx): number {
        return this.audioAutoTrackOverride.get(sfx.id) ?? (sfx.track ?? 0);
    }

    /** sfx の区間終端（出力秒）。実尺が既に解決していればそれを、なければ parseEdit 時点の暫定尺を使う。 */
    protected sfxIntervalEnd(sfx: EditAudioSfx): number {
        const inSeconds = sfx.in ?? 0;
        const cachedDuration = this.audioDurationCache.get(sfx.path);
        const actualDuration = typeof cachedDuration === 'number' ? cachedDuration : undefined;
        return sfx.t + this.resolveSfxDisplayDuration(sfx, inSeconds, actualDuration);
    }

    /** audio グループ全体（複数トラック分）の縦方向の外接。cuts/layers 等との衝突判定に使う。 */
    protected audioBandBounds(): LaneBounds {
        const tracks = this.laneLayout.audioTracks;
        if (tracks.length === 0) {
            return { top: 0, height: 0 };
        }
        const top = tracks[0].top;
        const last = tracks[tracks.length - 1];
        return { top, height: (last.top + last.height) - top };
    }

    protected beginKeyedRender(scope: 'strip' | 'ruler' | 'header'): void {
        if (scope === 'strip') {
            this.stripDesiredKeys = [];
            this.stripDesiredKeySet = new Set();
        } else if (scope === 'ruler') {
            this.rulerDesiredKeys = [];
            this.rulerDesiredKeySet = new Set();
        } else {
            this.headerDesiredKeys = [];
            this.headerDesiredKeySet = new Set();
        }
    }

    protected keyedNode<T extends HTMLElement>(
        scope: 'strip' | 'ruler' | 'header', key: string, signature: string, create: () => T
    ): { element: T; created: boolean } {
        const nodes = scope === 'strip' ? this.stripKeyedNodes
            : scope === 'ruler' ? this.rulerKeyedNodes : this.headerKeyedNodes;
        const signatures = scope === 'strip' ? this.stripKeyedSignatures
            : scope === 'ruler' ? this.rulerKeyedSignatures : this.headerKeyedSignatures;
        const desired = scope === 'strip' ? this.stripDesiredKeys
            : scope === 'ruler' ? this.rulerDesiredKeys : this.headerDesiredKeys;
        const desiredSet = scope === 'strip' ? this.stripDesiredKeySet
            : scope === 'ruler' ? this.rulerDesiredKeySet : this.headerDesiredKeySet;
        if (desiredSet.has(key)) throw new Error(`duplicate timeline key: ${key}`);
        desiredSet.add(key);
        desired.push(key);
        const previous = nodes.get(key);
        if (previous && signatures.get(key) === signature) {
            return { element: previous as T, created: false };
        }
        if (previous) previous.remove();
        const element = create();
        nodes.set(key, element);
        signatures.set(key, signature);
        this.keyedNodeKeys.set(element, key);
        return { element, created: true };
    }

    protected finishKeyedRender(scope: 'strip' | 'ruler' | 'header'): void {
        const parent = scope === 'strip' ? this.stripContent
            : scope === 'ruler' ? this.rulerContent : this.trackHeaders;
        const nodes = scope === 'strip' ? this.stripKeyedNodes
            : scope === 'ruler' ? this.rulerKeyedNodes : this.headerKeyedNodes;
        const signatures = scope === 'strip' ? this.stripKeyedSignatures
            : scope === 'ruler' ? this.rulerKeyedSignatures : this.headerKeyedSignatures;
        const desired = scope === 'strip' ? this.stripDesiredKeys
            : scope === 'ruler' ? this.rulerDesiredKeys : this.headerDesiredKeys;
        const current = Array.from(parent.children)
            .map(child => this.keyedNodeKeys.get(child)).filter((key): key is string => key !== undefined);
        const plan = planKeyedReconciliation(current, desired);
        for (const key of plan.removals) {
            nodes.get(key)?.remove();
            nodes.delete(key);
            signatures.delete(key);
        }
        for (const { key, beforeKey } of plan.moves) {
            const element = nodes.get(key);
            if (!element) continue;
            parent.insertBefore(element, beforeKey === undefined ? null : nodes.get(beforeKey) ?? null);
        }
    }

    protected keyedStripSegment(
        key: string, signature: string, start: number, end: number, top: number, height: number,
        className: string, title?: string
    ): { element: HTMLDivElement; created: boolean } {
        const result = this.keyedNode('strip', key, signature, () => document.createElement('div'));
        const element = result.element;
        element.className = className;
        element.title = title ?? '';
        Object.assign(element.style, {
            position: 'absolute', top: `${top}px`, height: `${height}px`,
            left: `${this.layoutPercent(start)}%`,
            width: `${Math.max(this.layoutPercent(end) - this.layoutPercent(start), 0.3)}%`,
            pointerEvents: 'none'
        });
        return result;
    }

    protected renderStrip(): void {
        // 同期描画が別経路で走ったら、次フレームに予約済みの重複描画は 1 回ぶん省く。
        this.stripRenderThrottle.cancel();
        // 尺の集計（O(items)）は 1 描画につき 1 回だけ。ズーム 1 イベントで 8 回前後呼ばれていた。
        this.invalidateContentExtent();
        // keyed 差分でも drag target の mount 状態を固定し、pointer capture を守るため終了まで延期する。
        if (this.dragState) {
            this.renderStripPending = true;
            return;
        }
        this.waveformT2PanTargets.clear();

        const maxDuration = this.totalDuration();
        if (this.viewDuration !== undefined) {
            if (this.viewDuration >= maxDuration) {
                this.viewDuration = undefined;
                this.viewStart = 0;
            } else {
                this.viewStart = Math.min(Math.max(0, this.viewStart), Math.max(0, maxDuration - this.viewDuration));
            }
        }
        // DOM 書き込みと交互に読むとアイテム数ぶん同期レイアウトが走るため、描画寸法は冒頭で 1 回だけ読む。
        const stripLayoutWidthPx = this.strip.clientWidth;
        const viewportHeight = this.stripScroll.clientHeight;
        const stripScrollOffsetWidth = this.stripScroll.offsetWidth;
        const stripScrollClientWidth = this.stripScroll.clientWidth;
        this.stripLayoutWidthPx = stripLayoutWidthPx;
        this.layoutViewStart = this.viewStart;
        this.layoutViewDuration = this.visibleDuration();
        this.panOffsetPx = 0;
        if (this.panSettleHandle !== undefined) {
            cancelAnimationFrame(this.panSettleHandle);
            this.panSettleHandle = undefined;
        }
        this.stripContent.style.transform = 'none';
        this.rulerContent.style.transform = 'none';
        this.beginKeyedRender('strip');
        this.beginKeyedRender('ruler');
        this.renderRuler();

        // レーン構造は Premiere 型配置原則（R6 契約 §1 裁定 1・2026-07-25）: 見せ場 → 字幕帯
        // → オーバーレイのトラック行（track 降順）→ レイヤー → クリップ帯 → オーディオ（複数
        // トラック可・最下段固定）。audio グループの並べ替えは UI から除外している
        // （onTrackHeaderPointerDown 参照）。
        // 横軸の位置決めは出力軸（Wave 22）: クリップは this.segments（cuts の at/track 解決結果）、
        // 字幕は sourceRangeToOutputRanges で source 秒→出力秒へ変換する。オーバーレイ・レイヤー・音声は元々出力秒基準。
        // ㉕ トラック群の縦中央寄せ: まず topOffset=0 の自然高さを測り、ビューポートより
        // 短ければ上下均等ギャップぶん topOffset を与えて全レーンを一様に下へずらす
        // （溢れる場合＝自然高さ ≥ ビューポート高のときは gap=0 のまま従来どおり上詰め + スクロール）。
        let stripHeight = this.calculateLaneLayout();
        // calculateLaneLayout の戻り値は末尾に固定 STRIP_BOTTOM_MARGIN（最下段トラックの下の
        // 化粧パディング、中央寄せとは無関係の既存デザイン）を含む。中央寄せの上下ギャップを
        // 対称にするには、この固定パディングを除いた「純粋な積み上げ高さ」を基準に測る必要が
        // ある（そのまま使うと下側だけ +STRIP_BOTTOM_MARGIN 分ずれて上下差が 1px を超える）。
        const stackHeight = Math.max(0, stripHeight - STRIP_BOTTOM_MARGIN);
        const centerGapPx = viewportHeight > 0 ? Math.max(0, Math.floor((viewportHeight - stackHeight) / 2)) : 0;
        if (centerGapPx > 0) {
            this.calculateLaneLayout(centerGapPx);
            stripHeight = stackHeight + centerGapPx * 2;
        }
        const beatsBandTop = this.laneLayout.beats.top;
        const beatsBandHeight = this.laneLayout.beats.height;

        // 注釈ピンはルーラー帯（renderRuler）へ描くため、専用レーンは持たない。
        this.strip.style.height = `${stripHeight}px`;
        this.trackHeaders.style.height = `${stripHeight}px`;
        this.applyInitialVerticalScroll(stripHeight, viewportHeight, centerGapPx);
        this.trackHeaders.style.transform = `translateY(${-this.stripScroll.scrollTop}px)`;
        this.renderTrackHeaders(beatsBandTop, beatsBandHeight);

        if (beatsBandHeight > 0) {
            const { element: beatsBand, created } = this.keyedNode(
                'strip', 'band:beats', 'beats', () => this.laneBand('beats', beatsBandTop, beatsBandHeight)
            );
            beatsBand.style.top = `${beatsBandTop}px`;
            beatsBand.style.height = `${beatsBandHeight}px`;
            if (created) {
                const label = document.createElement('span');
                label.className = 'akari-beats-band-label';
                label.textContent = '見せ場';
                beatsBand.appendChild(label);
            }
            beatsBand.style.opacity = this.beatsVisible ? '1' : '.28';
        }
        for (const layout of this.laneLayout.tracks) {
            const laneId = layout.id ?? '';
            const { element: band } = this.keyedNode(
                'strip', `band:${laneId}`, `${layout.kind ?? ''}:${layout.track}`,
                () => this.laneBand(laneId, layout.top, layout.height)
            );
            band.className = 'akari-track-band';
            band.style.top = `${layout.top}px`;
            band.style.height = `${layout.height}px`;
            band.dataset.akariTrack = String(layout.track);
            band.dataset.akariKind = layout.kind ?? '';
            if (layout.kind === 'overlays') {
                band.classList.toggle('akari-track-band-hidden', this.hiddenTracks.has(layout.track));
            } else if (layout.kind === 'layers') {
                band.style.opacity = layout.hidden ? '.28' : '1';
            } else if (layout.kind === 'captions') {
                band.style.opacity = this.captionsVisible ? '1' : '.28';
            } else if (layout.kind === 'audio') {
                band.style.opacity = this.audioVisible ? '1' : '.28';
            } else if (layout.kind === 'cuts') {
                band.style.opacity = layout.hidden ? '.28' : '1';
            }
        }
        if (beatsBandHeight > 0) this.renderBeatMarkers(beatsBandTop, beatsBandHeight);

        const renderedItemIds = new Set([
            ...this.cutItemIds,
            ...this.overlays.map(item => item.id),
            ...this.layers.map(item => item.id),
            ...this.audioSfx.map(item => item.id),
            ...this.audioNarration.map(item => item.id),
        ]);
        // captions 袋（sourceKind 'captions'）の帯チップと目盛りは描かない: 字幕チップ自体が常に描かれるため
        // 二重表示になり、オーナー実機 2026-09-02「謎のグループの茶色い帯、いらない」。html 袋は従来どおり
        // トラック帯へ目盛りを載せる。
        for (const bag of this.timelineTreeRows.filter(row => row.hasChildren && row.sourceKind === 'html')) {
            const layout = this.laneLayout.tracks.find(candidate => candidate.id === bag.trackId);
            if (!layout || !this.isRangeMounted(bag.at, bag.at + bag.duration)) continue;
            let element = this.strip.querySelector<HTMLElement>(
                `[data-akari-item-id="${CSS.escape(bag.id)}"]`
            );
            const usesTrackBand = !element;
            if (!element) {
                element = this.strip.querySelector<HTMLElement>(
                    `.akari-track-band[data-akari-lane="${CSS.escape(bag.trackId)}"]`
                );
            }
            if (!element) continue;
            for (const marker of Array.from(element.querySelectorAll(
                `[data-akari-tree-bag-tick="${CSS.escape(bag.id)}"]`
            ))) marker.remove();
            for (const tick of bag.ticks) {
                const marker = document.createElement('span');
                marker.className = 'akari-annotations-tree-tick';
                marker.dataset.akariTreeTick = tick.id;
                marker.dataset.akariTreeBagTick = bag.id;
                Object.assign(marker.style, {
                    left: usesTrackBand
                        ? `${this.percent(bag.at + tick.position * bag.duration)}%`
                        : `${tick.position * 100}%`,
                    top: `${2 + tick.row * 5}px`
                });
                element.appendChild(marker);
            }
            queueMicrotask(() => {
                if (usesTrackBand) {
                    const bagChip = this.strip.querySelector<HTMLElement>(
                        `[data-akari-item-id="${CSS.escape(bag.id)}"]`
                    );
                    if (bagChip) {
                        const markers = Array.from(element.querySelectorAll<HTMLElement>(
                            `[data-akari-tree-bag-tick="${CSS.escape(bag.id)}"]`
                        ));
                        markers.forEach((marker, index) => {
                            marker.style.left = `${(bag.ticks[index]?.position ?? 0) * 100}%`;
                            bagChip.appendChild(marker);
                        });
                    }
                }
                for (const tick of bag.ticks) {
                    const child = this.strip.querySelector<HTMLElement>(
                        `[data-akari-item-id="${CSS.escape(tick.id)}"]`
                    );
                    if (child) child.dataset.akariTreeRowId = tick.id;
                }
            });
        }
        for (const row of [
            ...this.treeRowsByTrack.values(),
            this.detachedCaptionChipRows
        ].flat()) {
            const layout = this.laneLayout.tracks.find(candidate => candidate.id === row.trackId);
            const rowIndex = this.overlayRows.get(row.id) ?? -1;
            if (layout && rowIndex >= 0) this.renderKeyframePropertyRows(row, layout.top, rowIndex);
            if (renderedItemIds.has(row.id)) continue;
            if (!layout || rowIndex < 0 || !this.isRangeMounted(row.at, row.at + row.duration)) continue;
            const raw = row.sourceKind === 'caption' ? this.rawKeyframeItem(row.id) : undefined;
            const captionId = raw?.source?.kind === 'caption' ? raw.source.id : undefined;
            const label = typeof captionId === 'string'
                ? this.captions.find(caption => caption.id === captionId)?.text ?? row.label
                : row.label;
            const { element, created } = this.keyedStripSegment(
                `tree:${row.id}`, JSON.stringify({ row, label }), row.at, row.at + row.duration,
                layout.top + rowIndex * SUBROW_STRIDE, SUBROW_HEIGHT,
                'akari-annotations-strip-overlay akari-timeline-tree-item', label
            );
            element.dataset.akariItemKind = 'item';
            element.dataset.akariItemId = row.id;
            element.dataset.akariTreeItemKind = row.itemKind;
            element.dataset.akariTreeParentId = row.parentId ?? '';
            element.dataset.akariTreeTrackId = row.trackId;
            element.style.pointerEvents = 'auto';
            if (created) {
                element.appendChild(this.segmentLabel(label));
                this.appendMotionMarks(element, this.rawKeyframeItem(row.id)?.motion);
                this.appendAggregateDiamonds(element, row);
                for (const tick of row.ticks) {
                    const marker = document.createElement('span');
                    marker.className = 'akari-annotations-tree-tick';
                    marker.dataset.akariTreeTick = tick.id;
                    Object.assign(marker.style, {
                        left: `${tick.position * 100}%`, top: `${2 + tick.row * 5}px`
                    });
                    element.appendChild(marker);
                }
                element.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (this.detectTreeDoubleClick(row.id, event.clientX, event.clientY)) {
                        this.enterTreeItem(row);
                        return;
                    }
                    const selected = this.selectionForTreeRow(row);
                    if (event.shiftKey) this.toggleMultiSelection(selected);
                    else this.applySelection(selected);
                });
            }
        }

        const excludedCaptionIds = collectExcludedCaptionIds({ tracks: this.timelineTreeTracks });
        this.captions.forEach(caption => {
            if (excludedCaptionIds.has(caption.id)) return;
            const captionTrackLayout = this.trackLayout('captions', 0);
            const captionLayout = this.captionLayouts.get(caption.id);
            if (!captionTrackLayout || !captionLayout) {
                // output 区間を持たない（削除区間へ完全に落ちた）字幕はレイアウト計算時に除外済み。
                return;
            }
            const { start: outputStart, end: outputEnd } = captionLayout;
            if (!this.isRangeMounted(outputStart, outputEnd)) {
                return;
            }
            const top = captionTrackLayout.top;
            const { element, created } = this.keyedStripSegment(
                `caption:${caption.id}`, JSON.stringify(caption), outputStart, outputEnd, top, SUBROW_HEIGHT,
                'akari-annotations-strip-caption', caption.text
            );
            element.dataset.akariItemKind = 'caption';
            element.dataset.akariItemId = caption.id;
            element.dataset.akariLane = captionTrackLayout.id ?? 'captions';
            const treeRow = this.captionTreeRow(caption.id);
            if (treeRow) element.dataset.akariTreeRowId = treeRow.id;
            element.style.opacity = this.captionsVisible ? '' : '.28';
            this.installDragListeners(element, (event, rect) => {
                const mode = this.resolveClipEdgeMode(event, rect, element);
                return {
                    kind: 'caption', id: caption.id, mode,
                    originalStart: caption.start, originalEnd: caption.end,
                    originalTimeDomain: caption.timeDomain,
                    originalEdited: caption.edited
                };
            });
            if (created) {
                const label = this.captionLabel(caption.text);
                label.style.opacity = this.captionsVisible ? '' : '.28';
                element.appendChild(label);
            }
        });
        this.overlays.forEach(overlay => {
            if (!this.itemVisibleInFocus(overlay.id)) return;
            const layout = resolveItemRowLayout(
                this.laneLayout.tracks,
                this.itemLocations.get(overlay.id)?.trackId,
                'overlays',
                overlay.track
            );
            const end = overlay.start + overlay.duration;
            if (!layout || !this.isRangeMounted(overlay.start, end)) {
                return;
            }
            const top = layout.top + (this.overlayRows.get(overlay.id) ?? 0) * SUBROW_STRIDE;
            const { element, created } = this.keyedStripSegment(
                `overlay:${overlay.id}`, JSON.stringify(overlay), overlay.start, end, top, SUBROW_HEIGHT,
                'akari-annotations-strip-overlay', overlay.id
            );
            element.dataset.akariItemKind = 'overlay';
            element.dataset.akariItemId = overlay.id;
            // docs/contract-2026-08-11-review-session-ui-events.md #2: timeline:overlay:<id>.
            element.setAttribute('data-akari-ui', `timeline:overlay:${overlay.id}`);
            element.setAttribute('data-akari-ui-label', overlay.id);
            element.dataset.akariTrack = String(overlay.track);
            element.dataset.akariLane = layout?.id ?? `track-${overlay.track}`;
            element.style.opacity = this.hiddenTracks.has(overlay.track) ? '.28' : '';
            if (created) {
                element.appendChild(this.segmentLabel(overlay.id));
                this.appendMotionMarks(element, this.rawKeyframeItem(overlay.id)?.motion);
                const overlayTreeRow = this.timelineTreeRows.find(row => row.id === overlay.id);
                if (overlayTreeRow) this.appendAggregateDiamonds(element, overlayTreeRow);
            }
            this.installDragListeners(element, (event, rect) => ({
                kind: 'overlay', id: overlay.id,
                mode: this.resolveClipEdgeMode(event, rect, element) === 'end' ? 'resize' : 'move',
                originalStart: overlay.start, originalDuration: overlay.duration, originalTrack: overlay.track
            }));
        });
        this.layers.forEach(layer => {
            if (!this.itemVisibleInFocus(layer.id)) return;
            const layout = resolveItemRowLayout(
                this.laneLayout.tracks,
                this.itemLocations.get(layer.id)?.trackId,
                'layers',
                layer.track ?? 0
            );
            const end = layer.t + layer.duration;
            if (!layout || !this.isRangeMounted(layer.t, end)) {
                return;
            }
            const top = layout.top + (this.layerRows.get(layer.id) ?? 0) * SUBROW_STRIDE;
            const transitionWarning = this.layerTransitionWarnings.get(layer.id);
            const { element, created } = this.keyedStripSegment(
                `layer:${layer.id}`, JSON.stringify([layer, transitionWarning]), layer.t, end, top, SUBROW_HEIGHT,
                `akari-annotations-strip-layer akari-annotations-strip-layer-${layer.kind}`, layer.id
            );
            element.dataset.akariItemKind = 'layer';
            element.dataset.akariItemId = layer.id;
            element.dataset.akariLane = layout?.id ?? 'layers';
            element.style.pointerEvents = 'auto';
            element.style.opacity = layout.hidden ? '.28' : '';
            if (created) {
                element.appendChild(this.segmentLabel(layer.id));
                this.appendMotionMarks(element, this.rawKeyframeItem(layer.id)?.motion);
                const layerTreeRow = this.timelineTreeRows.find(row => row.id === layer.id);
                if (layerTreeRow) this.appendAggregateDiamonds(element, layerTreeRow);
            }
            if (created && transitionWarning) {
                const warning = document.createElement('button');
                warning.type = 'button';
                warning.dataset.akariLayerTransitionWarning = layer.id;
                warning.setAttribute('aria-label', '書き出せないトランジションを削除');
                warning.title = transitionWarning;
                warning.textContent = '⚠ 削除';
                Object.assign(warning.style, {
                    position: 'absolute', top: '3px', right: '3px', zIndex: '8',
                    padding: '1px 5px', borderRadius: '4px', border: `1px solid ${TRANSITION_BADGE_WARNING_COLOR}`,
                    color: '#fff', background: '#9a3412', fontSize: '10px', cursor: 'pointer', pointerEvents: 'auto'
                });
                warning.addEventListener('pointerdown', event => {
                    event.preventDefault();
                    event.stopPropagation();
                });
                warning.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    void this.removeLayerEvacuatedTransition(layer.id);
                });
                element.appendChild(warning);
            }
            this.installDragListeners(element, (event, rect) => {
                const mode = this.resolveClipEdgeMode(event, rect, element);
                return {
                    kind: 'layer', id: layer.id, mode,
                    originalT: layer.t, originalDuration: layer.duration, originalTrack: layer.track ?? 0
                };
            });
        });
        const bgmLayout = this.audioBgm
            ? this.trackLayout('audio', this.bgmDisplayTrack(this.audioBgm)) : undefined;
        if (this.audioBgm && bgmLayout && this.isRangeMounted(0, this.contentEndDuration())) {
            const bgm = this.audioBgm;
            const label = this.pathBaseName(bgm.path);
            // バーはコンテンツ終端でトリムして描く（BGM は全編ベッドだが、書き出しで使われるのは
            // 動画尺ぶんだけ。ソース mp3 の実尺やスクロール余白までバーを伸ばさない）
            const end = this.contentEndDuration();
            const bgmSubrowCount = this.audioTrackSubrowCounts.get(bgmLayout.id) ?? 1;
            const bgmItemHeight = bgmSubrowCount <= 1 ? bgmLayout.height : SUBROW_HEIGHT;
            let actualDuration: number | undefined;
            if (this.location?.editUri) {
                const audioUri = this.resolveEditMediaUri(bgm.path, this.location.editUri).toString();
                const cachedDuration = this.audioDurationCache.get(bgm.path);
                if (typeof cachedDuration === 'number') {
                    actualDuration = cachedDuration;
                } else if (cachedDuration === undefined) {
                    this.fetchAudioDuration(bgm.path, audioUri);
                }
            }
            const bgmWaveform = this.waveformCache.get(`sfxwave:${bgm.path}`);
            const bgmSignature = JSON.stringify([
                bgm, actualDuration, bgmItemHeight,
                Array.isArray(bgmWaveform) ? `ready:${bgmWaveform.length}` : bgmWaveform
            ]);
            const { element, created } = this.keyedStripSegment(
                `audio:${bgm.id}`, bgmSignature, 0, end, bgmLayout.top, bgmItemHeight,
                'akari-annotations-strip-audio akari-annotations-strip-audio-bgm', label
            );
            element.dataset.akariItemKind = 'audio';
            element.dataset.akariItemId = bgm.id;
            element.dataset.akariLane = bgmLayout.id ?? 'audio';
            element.style.pointerEvents = 'auto';
            element.style.opacity = this.audioVisible ? '' : '.28';
            if (created) {
                element.appendChild(this.segmentLabel(label));
                this.appendAudioKeyframeMarkers(
                    element, bgm, end,
                    this.editDocument !== undefined
                        && findAudioItemIdByRole(this.editDocument, 'bgm') !== undefined
                );
                element.addEventListener('click', event => {
                    event.stopPropagation();
                    this.applySelection({ kind: 'audio', id: bgm.id });
                });
                element.addEventListener('dblclick', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    void this.openAudioKeyframeEditor(bgm.id);
                });
            }
            this.updateBgmWaveform(element, bgm, end, bgmItemHeight, actualDuration);
        }
        // narration を実 track ref の帯に表示する。選択後の gain 更新は v2 item を優先し、
        // legacy audio.narration[] にしか無い場合も互換 mutation が同じ id へ書き戻す。
        this.audioNarration.forEach(narration => {
            const layout = this.trackLayout('audio', this.narrationDisplayTrack(narration));
            if (!layout) {
                return;
            }
            if (this.location?.editUri && this.audioDurationCache.get(narration.path) === undefined) {
                const audioUri = this.resolveEditMediaUri(narration.path, this.location.editUri).toString();
                this.fetchAudioDuration(narration.path, audioUri);
            }
            const durationSeconds = this.narrationDisplayDuration(narration);
            const end = narration.t + durationSeconds;
            if (!this.isRangeMounted(narration.t, end)) {
                return;
            }
            const top = layout.top + (this.audioNarrationRows.get(narration.id) ?? 0) * SUBROW_STRIDE;
            const label = `${narration.id} ${this.pathBaseName(narration.path)}`;
            const subrowCount = this.audioTrackSubrowCounts.get(layout.id) ?? 1;
            const itemHeight = subrowCount <= 1 ? layout.height : SUBROW_HEIGHT;
            const cachedDuration = this.audioDurationCache.get(narration.path);
            const actualDuration = typeof cachedDuration === 'number' ? cachedDuration : undefined;
            const narrationWaveform = this.waveformCache.get(`sfxwave:${narration.path}`);
            const narrationSignature = JSON.stringify([
                narration, actualDuration, itemHeight,
                Array.isArray(narrationWaveform) ? `ready:${narrationWaveform.length}` : narrationWaveform
            ]);
            const { element, created } = this.keyedStripSegment(
                `audio:${narration.id}`, narrationSignature, narration.t, end, top, itemHeight,
                'akari-annotations-strip-audio akari-annotations-strip-audio-narration', label
            );
            element.dataset.akariItemKind = 'audio';
            element.dataset.akariItemId = narration.id;
            element.dataset.akariLane = layout.id ?? 'audio';
            element.style.pointerEvents = 'auto';
            element.style.opacity = this.audioVisible ? '' : '.28';
            if (created) {
                element.appendChild(this.segmentLabel(label));
                this.appendAudioKeyframeMarkers(
                    element, narration, durationSeconds,
                    this.rawV2Item(narration.id) !== undefined
                );
            }
            this.updateNarrationWaveform(
                element, narration, durationSeconds, itemHeight, actualDuration
            );
            if (narration.script) {
                element.title = narration.script;
            }
            if (created) element.addEventListener('click', event => {
                event.stopPropagation();
                this.applySelection({ kind: 'audio', id: narration.id });
            });
            if (created) element.addEventListener('dblclick', event => {
                event.preventDefault();
                event.stopPropagation();
                void this.openAudioKeyframeEditor(narration.id);
            });
        });
        // 音声クリップ版ソーストリマー（task 2026-08-18-audio-clip-trimmer-dblclick）: cuts の
        // trimmerActiveIndex と同じ「レンダーパス開始時点で固定して使い回す」流儀（下記コメント参照）。
        const trimmerActiveAudioId = this.trimmerAudioId;
        this.audioSfx.forEach(sfx => {
            const displayTrack = this.sfxDisplayTrack(sfx);
            const layout = this.trackLayout('audio', displayTrack);
            if (!layout) {
                return;
            }
            const top = layout.top + (this.audioSfxRows.get(sfx.id) ?? 0) * SUBROW_STRIDE;
            const label = this.pathBaseName(sfx.path);
            const inSeconds = sfx.in ?? 0;
            let actualDuration: number | undefined;
            if (this.location?.editUri) {
                const audioUri = this.resolveEditMediaUri(sfx.path, this.location.editUri).toString();
                const cachedDuration = this.audioDurationCache.get(sfx.path);
                if (typeof cachedDuration === 'number') {
                    actualDuration = cachedDuration;
                } else if (cachedDuration === undefined) {
                    this.fetchAudioDuration(sfx.path, audioUri);
                }
            }
            const durationSeconds = this.resolveSfxDisplayDuration(sfx, inSeconds, actualDuration);
            const sourceWindow = audioSourceSliceWindow({
                inSec: inSeconds, displayDurationSec: durationSeconds, speed: sfx.speed
            });
            const outSeconds = sourceWindow.endSec;
            const end = sfx.t + durationSeconds;
            if (!this.isRangeMounted(sfx.t, end)) {
                return;
            }
            const subrowCount = this.audioTrackSubrowCounts.get(layout.id) ?? 1;
            const itemHeight = subrowCount <= 1 ? layout.height : SUBROW_HEIGHT;
            const barWidthPercent = Math.max(this.layoutPercent(end) - this.layoutPercent(sfx.t), 0.3);
            const barWidthPx = stripLayoutWidthPx * barWidthPercent / 100;
            const sfxWaveform = this.waveformCache.get(`sfxwave:${sfx.path}`);
            const sfxTrimmerActive = this.trimmerAudioId === sfx.id;
            const sfxMediaGate = barWidthPx >= MIN_CLIP_WIDTH_FOR_MEDIA_PX && itemHeight >= MIN_TRACK_HEIGHT_FOR_MEDIA_PX;
            // cut と同じ規律: ズーム幾何は署名に入れず、再利用ノードは updateAudioClipWaveform（repaint ゲート）が
            // 既存 canvas へ描き直す。トリマー中の 1 本だけは幾何込みで作り直す。
            const audioSignature = JSON.stringify([
                sfx, actualDuration, sfxTrimmerActive, itemHeight,
                sfxTrimmerActive ? [this.layoutViewDuration, stripLayoutWidthPx] : 0,
                Array.isArray(sfxWaveform) ? `ready:${sfxWaveform.length}` : sfxWaveform,
                sfxMediaGate
            ]);
            const { element, created } = this.keyedStripSegment(
                `audio:${sfx.id}`, audioSignature, sfx.t, end, top, itemHeight,
                'akari-annotations-strip-audio akari-annotations-strip-audio-sfx', label
            );
            element.dataset.akariItemKind = 'audio';
            element.dataset.akariItemId = sfx.id;
            element.dataset.akariLane = layout.id ?? 'audio';
            element.dataset.akariTrack = String(displayTrack);
            element.style.pointerEvents = 'auto';
            const dimForAudioTrimmer = trimmerActiveAudioId !== undefined && trimmerActiveAudioId !== sfx.id;
            element.style.opacity = !this.audioVisible ? '.28' : dimForAudioTrimmer ? '.6' : '';
            if (created) element.appendChild(this.segmentLabel(label));
            // ソーストリマー（R6 契約 §3・動画クリップと同型・R6c2r2 外側延長方式）: dblclick で
            // この音声クリップが選ばれている間だけ、本体（通常表示と同一スケール）の左右に
            // in より前 / out より後の素材波形をウィングとして延長表示する。実尺
            // （audioDurationCache）が解決できない間はここで即座にトリマーモードを取り消す
            // （'unavailable' のときのみ。'pending' の間はウィング無しでトリマー枠を維持する）。
            let showAudioTrimmer = trimmerActiveAudioId === sfx.id;
            if (showAudioTrimmer && (actualDuration === undefined || !(actualDuration > 0))
                && this.audioDurationCache.get(sfx.path) === 'unavailable') {
                showAudioTrimmer = false;
                this.trimmerAudioId = undefined;
                this.showAudioDurationUnavailableNotice();
            }
            if (showAudioTrimmer) {
                element.querySelector(':scope > .akari-annotations-strip-clip-trimmer-content')?.remove();
                this.renderAudioTrimmerClip(
                    element, sfx, barWidthPx, itemHeight, inSeconds, outSeconds, actualDuration
                );
                this.installAudioTrimmerDrag(element, (event, rect) => {
                    const edgeMode = this.resolveClipEdgeMode(event, rect, element);
                    if (edgeMode === 'start') {
                        return {
                            kind: 'audio-trim', id: sfx.id, edge: 'left',
                            originalT: sfx.t, originalIn: inSeconds, originalOut: outSeconds
                        };
                    }
                    if (edgeMode === 'end') {
                        return {
                            kind: 'audio-trim', id: sfx.id, edge: 'right',
                            originalT: sfx.t, originalIn: inSeconds, originalOut: outSeconds
                        };
                    }
                    return {
                        kind: 'audio-slip', id: sfx.id, originalIn: inSeconds, originalOut: outSeconds,
                        sourceDuration: actualDuration ?? outSeconds
                    };
                });
            } else {
                this.updateSfxWaveform(
                    element, sfx, barWidthPx, itemHeight, sourceWindow, actualDuration, durationSeconds
                );
                this.installDragListeners(element, (event, rect) => {
                    const edgeMode = this.resolveClipEdgeMode(event, rect, element);
                    if (edgeMode === 'start') {
                        return {
                            kind: 'audio-trim', id: sfx.id, edge: 'left',
                            originalT: sfx.t, originalIn: inSeconds, originalOut: outSeconds
                        };
                    }
                    if (edgeMode === 'end') {
                        return {
                            kind: 'audio-trim', id: sfx.id, edge: 'right',
                            originalT: sfx.t, originalIn: inSeconds, originalOut: outSeconds
                        };
                    }
                    return {
                        kind: 'audio', id: sfx.id, originalT: sfx.t, originalTrack: displayTrack,
                        originalDuration: durationSeconds
                    };
                });
            }
            if (created) {
                this.appendAudioKeyframeMarkers(
                    element, sfx, durationSeconds,
                    this.rawV2Item(sfx.id) !== undefined
                );
            }
        });
        // ソーストリマー（R6c2r2）: レンダーパス開始時点の trimmerItemId を固定で使い回す
        // （ループ内で対象クリップ自身の実尺未解決等により this.trimmerItemId が undefined へ
        // 巻き戻ることがあるため、既に描画済みの前段クリップの減光判定がその巻き戻りで
        // 揺れないようにする）。
        const trimmerActiveIndex = this.trimmerItemId;
        const unsupportedDeclaredTransitions = this.unsupportedDeclaredTransitionIndexes();
        this.segments.forEach(segment => {
            const cutItemId = this.cutItemIds[segment.index] ?? '';
            if (!this.itemVisibleInFocus(cutItemId)) return;
            const itemTrackId = this.itemLocations.get(cutItemId)?.trackId;
            const cutLayout = resolveItemRowLayout(
                this.laneLayout.tracks, itemTrackId, 'cuts', segment.track
            );
            if (!cutLayout || !this.isRangeMounted(segment.tlStart, segment.tlEnd)) {
                return;
            }
            const cut = this.cuts[segment.index];
            const widthPercent = Math.max(
                this.layoutPercent(segment.tlEnd) - this.layoutPercent(segment.tlStart), 0.3
            );
            const clipWidth = stripLayoutWidthPx * widthPercent / 100;
            const cutWaveform = this.waveformCache.get(`${cut.src ?? ''}:${cut.in}:${cut.out}`);
            const cutTrimmerActive = this.trimmerItemId === segment.index;
            const cutMediaGate = clipWidth >= MIN_CLIP_WIDTH_FOR_MEDIA_PX
                && cutLayout.height >= MIN_TRACK_HEIGHT_FOR_MEDIA_PX;
            // ズーム幾何（layoutViewDuration / stripLayoutWidthPx）とチャンク到着リビジョンは署名に入れない:
            // 再利用ノードは updateClipMediaGeometry が CSS / canvas だけを更新する（パンと同じ経路）。
            // 以前はズーム 1 イベントごとに全 cut チップ（フィルムストリップ最大 160 セル・波形 canvas・
            // ドラッグリスナー）を破棄・再生成していた。トリマー中の 1 本だけはウィング描画が幅依存なので
            // 従来どおり幾何込みで作り直す。メディア表示のゲート境界（幅 / 高さ）を跨ぐときは作り直す。
            const cutSignature = JSON.stringify([
                cut, segment, cutLayout.height, cutTrimmerActive,
                cutTrimmerActive ? [this.layoutViewDuration, stripLayoutWidthPx, this.filmstripContentRevision] : 0,
                Array.isArray(cutWaveform) ? `ready:${cutWaveform.length}` : cutWaveform,
                unsupportedDeclaredTransitions.has(segment.index),
                cutMediaGate
            ]);
            const { element, created } = this.keyedStripSegment(
                `cut:${segment.index}`, cutSignature, segment.tlStart, segment.tlEnd,
                cutLayout.top, cutLayout.height, 'akari-annotations-strip-clip', `C${segment.index + 1}`
            );
            element.dataset.akariItemKind = 'cut';
            element.dataset.akariItemId = String(segment.index);
            // docs/contract-2026-08-11-review-session-ui-events.md #2: timeline:cut:<n>.
            element.setAttribute('data-akari-ui', `timeline:cut:${segment.index}`);
            element.setAttribute('data-akari-ui-label', `C${segment.index + 1}`);
            element.dataset.akariLane = cutLayout.id ?? 'clips';
            const dimForTrimmer = trimmerActiveIndex !== undefined && trimmerActiveIndex !== segment.index;
            element.style.opacity = cutLayout.hidden ? '.28' : dimForTrimmer ? '.6' : '';
            // 再利用ノードでもズームで幅が変わるため、付け外しの両方向を毎回反映する。
            element.classList.toggle('akari-annotations-strip-clip-micro', clipWidth < MICRO_CLIP_WIDTH_PX);
            // ソーストリマー（R6c2r2・外側延長方式）: dblclick でこのクリップが選ばれている間だけ、
            // クリップ本体（通常表示と同一スケール）の左右に in より前 / out より後の素材を
            // ウィングとして延長表示する。実尺（sourceDuration）が解決できない間は素材の場所を
            // 特定できないと判断し、このレンダーパス内で即座にトリマーモードを取り消す
            // （無限ループにはならない）。
            let showTrimmer = this.trimmerItemId === segment.index;
            let trimmerVideoUri = '';
            let trimmerSourceDuration: number | undefined;
            if (showTrimmer) {
                trimmerVideoUri = this.cutVideoUri(cut);
                if (!trimmerVideoUri) {
                    showTrimmer = false;
                    this.trimmerItemId = undefined;
                } else {
                    const cached = this.videoDurationCache.get(trimmerVideoUri);
                    if (typeof cached === 'number') {
                        trimmerSourceDuration = cached;
                    } else if (cached === 'unavailable') {
                        showTrimmer = false;
                        this.trimmerItemId = undefined;
                        this.showVideoDurationUnavailableNotice();
                    } else {
                        void this.ensureVideoDurationFetch(trimmerVideoUri);
                    }
                }
            }
            element.style.pointerEvents = 'auto';
            if (created) this.appendMotionMarks(element, this.rawKeyframeItem(cutItemId)?.motion);
            if (showTrimmer) {
                if (created) {
                    this.renderTrimmerClip(
                        element, cut, clipWidth, segment, cutLayout.height, trimmerVideoUri, trimmerSourceDuration
                    );
                    element.appendChild(this.clipHeader(`C${segment.index + 1}`, segment.tlEnd - segment.tlStart));
                }
                this.installTrimmerDrag(element, (event, rect) => {
                    const edgeMode = this.resolveClipEdgeMode(event, rect, element);
                    if (edgeMode === 'start') {
                        return { kind: 'cut-trim', index: segment.index, edge: 'left', originalIn: cut.in, originalOut: cut.out };
                    }
                    if (edgeMode === 'end') {
                        return { kind: 'cut-trim', index: segment.index, edge: 'right', originalIn: cut.in, originalOut: cut.out };
                    }
                    // 実尺が未解決（読み込み中）の間は右方向のスリップを 0 クランプする
                    // フォールバック（cut.out 自身を仮の実尺とみなす）。slipCut RPC は
                    // 実尺クランプを一切行わないため、ここで安全側に倒しておく必要がある。
                    return {
                        kind: 'cut-slip', index: segment.index, originalIn: cut.in, originalOut: cut.out,
                        sourceDuration: trimmerSourceDuration ?? cut.out
                    };
                });
            } else {
                if (created) {
                    this.renderClipMedia(element, cut, clipWidth, segment, cutLayout.height);
                    element.appendChild(this.clipHeader(`C${segment.index + 1}`, segment.tlEnd - segment.tlStart));
                } else {
                    this.updateClipMediaGeometry(element, cut, clipWidth, segment, cutLayout.height);
                }
                if (created && cut.src !== undefined) {
                    const source = this.sourceMap.get(cut.src);
                    if (source) {
                        const badge = document.createElement('span');
                        badge.className = 'akari-annotations-strip-clip-source';
                        badge.dataset.akariSourceId = cut.src;
                        badge.textContent = cut.src;
                        badge.title = source.path;
                        element.appendChild(badge);
                    }
                }
                this.installDragListeners(element, (event, rect) => {
                    const edgeMode = this.resolveClipEdgeMode(event, rect, element);
                    if (edgeMode === 'start') {
                        return { kind: 'cut-trim', index: segment.index, edge: 'left', originalIn: cut.in, originalOut: cut.out };
                    }
                    if (edgeMode === 'end') {
                        return { kind: 'cut-trim', index: segment.index, edge: 'right', originalIn: cut.in, originalOut: cut.out };
                    }
                    return {
                        kind: 'cut-move', index: segment.index, originalAt: segment.tlStart,
                        originalTrack: segment.track, duration: segment.tlEnd - segment.tlStart
                    };
                }, event => void this.performRazorSplitAt(segment, event.clientX));
                if (this.toolMode === 'razor') {
                    element.style.cursor = 'crosshair';
                }
            }
            if (created && unsupportedDeclaredTransitions.has(segment.index)) {
                const warning = document.createElement('button');
                warning.type = 'button';
                warning.dataset.akariUnsupportedTransition = String(segment.index);
                warning.setAttribute('aria-label', '書き出せないトランジションを削除');
                warning.title = this.unsupportedTransitionMessage(segment.index);
                warning.textContent = '⚠ 削除';
                Object.assign(warning.style, {
                    position: 'absolute', top: '3px', right: '3px', zIndex: '8',
                    padding: '1px 5px', borderRadius: '4px', border: `1px solid ${TRANSITION_BADGE_WARNING_COLOR}`,
                    color: '#fff', background: '#9a3412', fontSize: '10px', cursor: 'pointer', pointerEvents: 'auto'
                });
                warning.addEventListener('pointerdown', event => {
                    event.preventDefault();
                    event.stopPropagation();
                });
                warning.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    void this.applyTransitionOut(segment.index, null);
                });
                element.appendChild(warning);
            }
        });
        this.renderTransitionBoundaries(unsupportedDeclaredTransitions);
        this.finishKeyedRender('strip');
        this.applyTrackLockAppearance();
        this.updateChipHitAreas();
        this.finishKeyedRender('ruler');
        this.playhead.style.left = `${this.percent(this.playheadT)}%`;
        const scrollbarWidth = Math.max(0, stripScrollOffsetWidth - stripScrollClientWidth);
        this.rulerBar.style.marginRight = `${scrollbarWidth}px`;
        this.timelineOverlay.style.right = `${scrollbarWidth}px`;
        this.applySelectionClass();
        this.applyKeyframePropertySelectionClass();
        this.updateZoomHud();
        this.updateScrollbar();
    }

    protected updateChipHitAreas(): void {
        const elements = Array.from(this.stripContent.children).filter((child): child is HTMLDivElement => {
            if (!(child instanceof HTMLDivElement) || child.dataset.akariItemKind === undefined) {
                return false;
            }
            const key = this.keyedNodeKeys.get(child);
            return key !== undefined && this.stripDesiredKeySet.has(key);
        });
        const entries: ChipHitAreaEntry[] = elements.map(element => ({
            group: `${element.dataset.akariLane ?? ''}\u0000${element.style.top}`,
            leftPercent: Number.parseFloat(element.style.left) || 0,
            widthPercent: Number.parseFloat(element.style.width) || 0
        }));
        const plans = planChipHitPadding(entries, {
            containerWidthPx: this.stripLayoutWidthPx,
            minHitWidthPx: MIN_CLIP_HIT_WIDTH_PX
        });
        elements.forEach((element, index) => {
            if (!element.classList.contains('akari-annotations-strip-hit-target')) {
                element.classList.add('akari-annotations-strip-hit-target');
            }
            const plan = plans[index];
            const syncPadding = (property: '--akari-hit-pad-left' | '--akari-hit-pad-right', value: number): void => {
                const nextValue = value > 0 ? `${value}px` : '';
                if (element.style.getPropertyValue(property) === nextValue) return;
                if (nextValue) element.style.setProperty(property, nextValue);
                else element.style.removeProperty(property);
            };
            syncPadding('--akari-hit-pad-left', plan.padLeftPx);
            syncPadding('--akari-hit-pad-right', plan.padRightPx);
        });
    }

    protected chipHitPadding(element: HTMLElement): { left: number; right: number } {
        const read = (name: string): number => Math.max(0, Number.parseFloat(element.style.getPropertyValue(name)) || 0);
        return { left: read('--akari-hit-pad-left'), right: read('--akari-hit-pad-right') };
    }

    protected expandedChipHitRect(element: HTMLElement): DOMRect {
        const rect = element.getBoundingClientRect();
        const padding = this.chipHitPadding(element);
        return new DOMRect(
            rect.left - padding.left,
            rect.top,
            rect.width + padding.left + padding.right,
            rect.height
        );
    }

    protected resolveClipEdgeMode(event: PointerEvent, rect: DOMRect, element: HTMLElement): TimelineEdgeMode {
        const padding = this.chipHitPadding(element);
        const baseWidth = Math.max(0, rect.width - padding.left - padding.right);
        const edgeZone = clipEdgeZonePx(
            rect.width,
            baseWidth < MIN_CLIP_HIT_WIDTH_PX,
            EDGE_ZONE_PX,
            MIN_TRIM_HANDLE_HIT_PX
        );
        return resolveTimelineEdgeMode(event.clientX - rect.left, rect.width, edgeZone);
    }

    protected createDragGhost(element: HTMLDivElement): HTMLDivElement {
        const ghost = element.cloneNode(true) as HTMLDivElement;
        ghost.removeAttribute('title');
        ghost.classList.remove('akari-annotations-strip-hit-target');
        ghost.style.removeProperty('--akari-hit-pad-left');
        ghost.style.removeProperty('--akari-hit-pad-right');
        Object.assign(ghost.style, {
            pointerEvents: 'none', opacity: '.5', borderStyle: 'dashed', zIndex: '8', cursor: 'grabbing'
        });
        return ghost;
    }

    protected applyInitialVerticalScroll(stripHeightPx: number, viewportHeightPx: number, centerGapPx: number): void {
        const projectKey = this.location?.editUri?.toString() ?? this.location?.root.toString() ?? '';
        if (projectKey !== this.initialVerticalScrollProjectKey) {
            this.initialVerticalScrollProjectKey = projectKey;
            this.initialVerticalScrollHandled = false;
        }
        if (this.initialVerticalScrollHandled || !(viewportHeightPx > 0)) {
            return;
        }
        if (centerGapPx === 0 && stripHeightPx > viewportHeightPx) {
            const cuts = this.laneLayout.tracks.filter(track => track.kind === 'cuts');
            const fallbacks = this.laneLayout.tracks.filter(track => track.kind === 'overlays' || track.kind === 'layers');
            const targetLane = (cuts.length > 0 ? cuts : fallbacks)
                .reduce<TrackGroupLayout | undefined>((first, lane) =>
                    first === undefined || lane.top < first.top ? lane : first, undefined);
            if (targetLane) {
                const scrollTop = planInitialVisualTrackScroll({
                    stripHeightPx,
                    viewportHeightPx,
                    laneTopPx: targetLane.top,
                    laneHeightPx: targetLane.height
                });
                if (scrollTop !== undefined) {
                    this.stripScroll.scrollTop = scrollTop;
                }
            }
        }
        this.initialVerticalScrollHandled = true;
    }

    protected laneBand(lane: string, top: number, height: number): HTMLDivElement {
        const band = document.createElement('div');
        band.className = 'akari-track-band';
        band.dataset.akariLane = lane;
        band.style.top = `${top}px`;
        band.style.height = `${height}px`;
        return band;
    }

    protected renderBeatMarkers(top: number, height: number): void {
        for (const beat of this.beats) {
            const outputRanges = this.sourceRangeToOutputRanges(
                beat.t, beat.t + BEAT_PROJECTION_EPSILON, beat.src
            );
            for (let occurrence = 0; occurrence < outputRanges.length; occurrence++) {
                if (!this.isRangeMounted(outputRanges[occurrence][0], outputRanges[occurrence][1])) continue;
                const { element: marker } = this.keyedNode(
                    'strip', `beat:${beat.id}:${occurrence}`, JSON.stringify(beat), () => document.createElement('div')
                );
                marker.className = 'akari-beat-marker';
                marker.dataset.akariBeatId = beat.id;
                marker.dataset.akariBeatKind = beat.kind;
                marker.dataset.akariBeatStrength = String(beat.strength);
                marker.dataset.akariBeatOccurrence = String(occurrence);
                marker.title = [
                    `kind: ${beat.kind}`,
                    `strength: ${beat.strength}`,
                    ...(beat.basis !== undefined ? [`basis: ${beat.basis}`] : [])
                ].join('\n');
                const size = 7 + beat.strength * 6;
                marker.style.left = `${this.layoutPercent(outputRanges[occurrence][0])}%`;
                marker.style.top = `${top + (height - size) / 2}px`;
                marker.style.width = `${size}px`;
                marker.style.height = `${size}px`;
                marker.style.opacity = this.beatsVisible ? String(0.35 + beat.strength * 0.65) : '.28';
                marker.style.background = BEAT_KIND_COLORS[beat.kind] ?? DEFAULT_BEAT_COLOR;
            }
        }
    }

    /**
     * ㉔ トランジション境界バッジ: cuts の隣接クリップ境界（allowedTransitionOverlap と
     * 同じ判定基準 = computeCutBoundaries）に常時バッジを描く。transition_out 未設定は
     * 控えめなニュートラル丸、設定済みはアクセント色 + 種別頭文字。クリックでポップオーバー編集。
     */
    protected renderTransitionBoundaries(unsupported: ReadonlySet<number>): void {
        const boundaries = computeCutBoundaries(this.segments, this.fps);
        const unsupportedDropEarlierIndexes = new Set(unsupported);
        for (const cutIndex of this.unsupportedTrackTransitionByCutIndex.keys()) {
            unsupportedDropEarlierIndexes.add(cutIndex);
        }
        const supportedDropEarlierIndexes = new Set((this.libraryDragPayload
            ? filterSupportedTransitionBoundaries(
                boundaries,
                unsupportedDropEarlierIndexes
            )
            : []).map(boundary => boundary.earlierIndex));
        for (const boundary of boundaries) {
            const itemTrackId = this.itemLocations.get(this.cutItemIds[boundary.earlierIndex] ?? '')?.trackId;
            const cutLayout = resolveItemRowLayout(
                this.laneLayout.tracks, itemTrackId, 'cuts', boundary.track
            );
            if (!cutLayout || !this.isRangeMounted(boundary.boundaryT, boundary.boundaryT)) {
                continue;
            }
            const option = boundary.transitionOut
                ? TRANSITION_TYPE_OPTIONS.find(candidate => candidate.type === boundary.transitionOut!.type)
                : undefined;
            const { element: badge, created } = this.keyedNode(
                'strip', `boundary:${boundary.earlierIndex}-${boundary.laterIndex}`,
                JSON.stringify([boundary, unsupported.has(boundary.earlierIndex), cutLayout.hidden]),
                () => document.createElement('button')
            );
            badge.type = 'button';
            Object.assign(badge.style, {
                position: 'absolute',
                left: `${this.layoutPercent(boundary.boundaryT)}%`,
                top: `${cutLayout.top + cutLayout.height / 2}px`,
                transform: 'translate(-50%, -50%)',
                width: `${TRANSITION_BADGE_SIZE_PX}px`,
                height: `${TRANSITION_BADGE_SIZE_PX}px`,
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '8px', fontWeight: '700', lineHeight: '1', padding: '0',
                cursor: 'pointer', pointerEvents: 'auto', zIndex: '5', boxSizing: 'border-box',
                opacity: cutLayout.hidden ? '.28' : '1'
            });
            if (unsupported.has(boundary.earlierIndex)) {
                Object.assign(badge.style, {
                    background: '#9a3412',
                    border: `1px solid ${TRANSITION_BADGE_WARNING_COLOR}`,
                    color: '#fff'
                });
                badge.textContent = '!';
                badge.dataset.akariUnsupportedTransition = String(boundary.earlierIndex);
                badge.title = this.unsupportedTransitionMessage(boundary.earlierIndex);
            } else if (boundary.transitionOut) {
                Object.assign(badge.style, {
                    background: TRANSITION_BADGE_ACCENT_COLOR,
                    border: `1px solid ${TRANSITION_BADGE_ACCENT_COLOR}`,
                    color: '#fff'
                });
                badge.textContent = option?.glyph ?? '✨';
                badge.title = `${option?.label ?? boundary.transitionOut.type} `
                    + `(${boundary.transitionOut.duration.toFixed(2)}s) — クリックで編集`;
            } else {
                Object.assign(badge.style, {
                    background: 'transparent',
                    border: `1px solid ${TRANSITION_BADGE_NEUTRAL_BORDER_COLOR}`,
                    color: TRANSITION_BADGE_NEUTRAL_BORDER_COLOR
                });
                badge.textContent = '';
                badge.title = 'トランジションを追加';
            }
            badge.dataset.akariTransitionBoundary = `${boundary.earlierIndex}-${boundary.laterIndex}`;
            badge.setAttribute('aria-label', badge.title);
            if (created) {
                badge.addEventListener('pointerdown', event => event.stopPropagation());
                badge.addEventListener('contextmenu', event => event.stopPropagation());
                badge.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.openTransitionPopup(event.clientX, event.clientY, boundary.earlierIndex, boundary.laterIndex);
                });
            }
            if (supportedDropEarlierIndexes.has(boundary.earlierIndex)) {
                const { element: dropTarget } = this.keyedNode(
                    'strip', `transition-drop:${boundary.earlierIndex}-${boundary.laterIndex}`,
                    JSON.stringify([boundary, cutLayout.hidden]),
                    () => document.createElement('div')
                );
                dropTarget.className = 'akari-annotations-transition-drop-target';
                const locked = this.isTrackLocked(this.trackIdOfItem(this.cutItemId(boundary.earlierIndex)))
                    || this.isTrackLocked(this.trackIdOfItem(this.cutItemId(boundary.laterIndex)));
                // Keep geometry available for a drop refusal while hiding the target affordance.
                dropTarget.style.visibility = locked ? 'hidden' : '';
                dropTarget.setAttribute('aria-hidden', String(locked));
                dropTarget.dataset.akariTransitionDropTarget = `${boundary.earlierIndex}-${boundary.laterIndex}`;
                dropTarget.dataset.akariTransitionEarlierIndex = String(boundary.earlierIndex);
                dropTarget.dataset.akariTransitionLaterIndex = String(boundary.laterIndex);
                dropTarget.dataset.akariTransitionDropHover = 'false';
                dropTarget.setAttribute('role', 'button');
                dropTarget.setAttribute('aria-label', `C${boundary.earlierIndex + 1} と C${boundary.laterIndex + 1} の境界へ適用`);
                dropTarget.title = 'ここにトランジションを適用';
                Object.assign(dropTarget.style, {
                    left: `${this.layoutPercent(boundary.boundaryT)}%`,
                    top: `${cutLayout.top + cutLayout.height / 2}px`,
                    opacity: cutLayout.hidden ? '.45' : '1'
                });
            }
        }
    }

    /** ㉔ 境界バッジのクリックで開くポップオーバー: type（カテゴリ別）・duration・削除。 */
    protected openTransitionPopup(anchorX: number, anchorY: number, earlierIndex: number, laterIndex: number): void {
        this.closeAnnotationPopup();
        const popup = document.createElement('div');
        popup.className = 'akari-annotations-transition-popover';
        const popoverWidth = 440;
        const margin = 8;
        const left = Math.max(margin, Math.min(anchorX - popoverWidth / 2, window.innerWidth - popoverWidth - margin));
        const top = anchorY + 12;
        Object.assign(popup.style, {
            position: 'fixed', left: `${left}px`, top: `${top}px`, zIndex: '10000',
            display: 'flex', flexDirection: 'column', gap: '6px', width: `${popoverWidth}px`,
            padding: '8px', borderRadius: '6px', border: '1px solid var(--theia-widget-border)',
            background: 'var(--theia-menu-background)', boxShadow: '0 3px 12px rgba(0,0,0,.35)',
            fontSize: '11px', maxHeight: `calc(100vh - ${top + margin}px)`, overflowY: 'auto'
        });
        const render = (): void => {
            popup.replaceChildren();
            const current = this.cuts[earlierIndex]?.transitionOut;
            const unsupportedTrack = this.unsupportedTransitionTrack(earlierIndex);
            const unsupportedAdjacency = this.nonAdjacentTransitionTarget(earlierIndex);
            const zeroOverlap = this.zeroOverlapTransitionIndexes.has(earlierIndex);
            const heading = document.createElement('div');
            heading.textContent = `C${earlierIndex + 1} → C${laterIndex + 1}`;
            heading.style.opacity = '.7';
            popup.appendChild(heading);
            if (unsupportedTrack !== undefined || unsupportedAdjacency !== undefined || zeroOverlap) {
                const warning = document.createElement('div');
                warning.dataset.akariTransitionGuard = String(earlierIndex);
                warning.textContent = this.unsupportedTransitionMessage(earlierIndex);
                Object.assign(warning.style, {
                    padding: '6px', borderRadius: '4px', border: `1px solid ${TRANSITION_BADGE_WARNING_COLOR}`,
                    color: 'var(--theia-list-warningForeground, #cca700)', lineHeight: '1.4'
                });
                popup.appendChild(warning);
            }
            for (const category of TRANSITION_CATEGORIES) {
                const categorySection = document.createElement('section');
                categorySection.dataset.akariTransitionCategory = category;
                const categoryHeading = document.createElement('div');
                categoryHeading.textContent = category;
                categoryHeading.style.opacity = '.72';
                categoryHeading.style.marginTop = '2px';
                categorySection.appendChild(categoryHeading);
                const typeGrid = document.createElement('div');
                Object.assign(typeGrid.style, {
                    display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '4px'
                });
                for (const option of TRANSITION_TYPE_OPTIONS.filter(candidate => candidate.category === category)) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = `theia-button ${current?.type === option.type ? 'main' : 'secondary'}`;
                    button.textContent = option.label;
                    button.style.padding = '3px 4px';
                    button.disabled = unsupportedTrack !== undefined || unsupportedAdjacency !== undefined;
                    button.dataset.akariTransitionType = option.type;
                    button.setAttribute('aria-pressed', String(current?.type === option.type));
                    button.addEventListener('click', () => {
                        void this.applyTransitionOut(earlierIndex, {
                            type: option.type,
                            duration: current?.duration ?? TRANSITION_DEFAULT_DURATION_SECONDS
                        }).then(render);
                    });
                    typeGrid.appendChild(button);
                }
                categorySection.appendChild(typeGrid);
                popup.appendChild(categorySection);
            }
            if (current) {
                const sliderRow = document.createElement('div');
                Object.assign(sliderRow.style, { display: 'flex', alignItems: 'center', gap: '6px' });
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = String(TRANSITION_MIN_DURATION_SECONDS);
                slider.max = String(TRANSITION_MAX_DURATION_SECONDS);
                slider.step = '0.05';
                slider.value = String(current.duration);
                const currentType = isTransitionType(current.type) ? current.type : undefined;
                slider.disabled = currentType === undefined;
                slider.setAttribute('aria-label', 'トランジションの尺');
                slider.style.flex = '1';
                const durationLabel = document.createElement('span');
                durationLabel.textContent = `${current.duration.toFixed(2)}s`;
                Object.assign(durationLabel.style, { fontVariantNumeric: 'tabular-nums', minWidth: '34px' });
                slider.addEventListener('input', () => {
                    durationLabel.textContent = `${Number(slider.value).toFixed(2)}s`;
                });
                slider.addEventListener('change', () => {
                    if (!currentType) return;
                    void this.applyTransitionOut(earlierIndex, {
                        type: currentType, duration: Number(slider.value)
                    }).then(render);
                });
                sliderRow.append(slider, durationLabel);
                popup.appendChild(sliderRow);
                const removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.className = 'theia-button secondary';
                removeButton.textContent = 'トランジションを削除';
                removeButton.addEventListener('click', () => {
                    void this.applyTransitionOut(earlierIndex, null).then(() => this.closeAnnotationPopup());
                });
                popup.appendChild(removeButton);
            }
        };
        render();
        popup.addEventListener('contextmenu', popupEvent => popupEvent.preventDefault());
        popup.addEventListener('pointerdown', popupEvent => popupEvent.stopPropagation());
        document.body.appendChild(popup);
        this.contextPopup = popup;
        const close = (outsideEvent: PointerEvent): void => {
            if (!popup.contains(outsideEvent.target as Node)) {
                document.removeEventListener('pointerdown', close, true);
                this.closeAnnotationPopup();
            }
        };
        setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
    }

    /** ㉔ トランジション書き戻し: annotations 既存の edit RPC 流儀（setCutOpacity 等と同系）。 */
    protected async applyTransitionOut(
        cutIndex: number,
        next: { type: TransitionType; duration: number } | null
    ): Promise<{ ok: boolean; message?: string }> {
        const location = this.location;
        if (!location?.editUri) {
            return { ok: false, message: 'プロジェクトの場所を特定できません。' };
        }
        if (next && (this.unsupportedTransitionTrack(cutIndex) !== undefined
            || this.nonAdjacentTransitionTarget(cutIndex) !== undefined)) {
            const message = this.unsupportedTransitionMessage(cutIndex);
            this.showNotice(message);
            this.footer.textContent = message;
            this.messages.warn(message);
            return { ok: false, message };
        }
        const earlier = this.segments.find(segment => segment.index === cutIndex);
        const later = earlier ? this.nextSameTrackSegment(cutIndex) : undefined;
        if (!next && earlier?.transitionOut && later) {
            const overlapFrames = cutOverlapFrames(earlier, later, this.fps);
            if (overlapFrames > 0 && areCutsAdjacent(earlier, later, this.fps)) {
                await this.commitEditTextMutation('トランジションを削除', text =>
                    removeV2TransitionOutWithHandleRetractInSource(text, {
                        itemId: this.cutItemId(cutIndex), retractFrames: overlapFrames, fps: this.fps
                    })
                );
                this.hideNotice();
                this.footer.textContent = 'トランジションを削除しました（のりしろも戻しました）。';
                return { ok: true };
            }
        }
        let handle: ReturnType<typeof planTransitionHandleWindow> | undefined;
        let writtenNext = next;
        if (next && earlier && later && cutOverlapFrames(earlier, later, this.fps) === 0) {
            handle = await this.transitionHandlePlan(earlier, later, next.duration);
            if (handle.outcome === 'clamped') {
                const roundedSeconds = roundTransitionDurationForWrite(handle.effectiveSeconds);
                handle = roundedSeconds > 0
                    ? { ...handle, effectiveSeconds: roundedSeconds, halfSeconds: roundedSeconds / 2 }
                    : { ...handle, effectiveSeconds: 0, halfSeconds: 0, outcome: 'none' };
                if (handle.outcome === 'clamped') {
                    writtenNext = { ...next, duration: handle.effectiveSeconds };
                }
            }
        }
        await this.commitEditMutation('トランジションを変更', doc => updateV2Item(doc, {
            itemId: this.cutItemId(cutIndex), patch: { source: { transition_out: writtenNext } }
        }));
        if (handle?.outcome === 'clamped') {
            const seconds = formatTransitionSeconds(handle.effectiveSeconds);
            const message = `トランジションが ${seconds} 秒に短くなります（素材の余りが足りません）`;
            this.showNotice(message);
            this.footer.textContent = message;
            this.messages.warn(message);
            return { ok: true, message };
        }
        if (handle?.outcome === 'none') {
            this.showNotice(ZERO_OVERLAP_TRANSITION_MESSAGE);
            this.footer.textContent = ZERO_OVERLAP_TRANSITION_MESSAGE;
            this.messages.warn(ZERO_OVERLAP_TRANSITION_MESSAGE);
            return { ok: true, message: ZERO_OVERLAP_TRANSITION_MESSAGE };
        }
        if (!next && earlier && later && cutOverlapFrames(earlier, later, this.fps) > 0) {
            const message = 'トランジションを削除しました。クリップの重なりが残っています。';
            this.showNotice(message);
            this.footer.textContent = message;
            return { ok: true, message };
        }
        this.hideNotice();
        this.footer.textContent = next ? 'トランジションを変更しました。' : 'トランジションを削除しました。';
        return { ok: true };
    }

    protected nextSameTrackSegment(cutIndex: number): OutputSegment | undefined {
        return this.nextSameTrackSegmentByCutIndex.get(cutIndex);
    }

    protected isStillImageCut(cut: EditCut | undefined): boolean {
        if (!cut) return false;
        const declaredPath = cut.src !== undefined
            ? this.sourceMap.get(cut.src)?.path
            : this.defaultSource?.path;
        return isStillImageSourcePath(declaredPath);
    }

    protected transitionHandlePlanSync(
        earlier: OutputSegment,
        later: OutputSegment,
        declaredSeconds = earlier.transitionOut?.duration ?? 0
    ): ReturnType<typeof planTransitionHandleWindow> {
        const outgoing = this.cuts[earlier.index];
        const incoming = this.cuts[later.index];
        const outgoingSpeed = typeof outgoing?.speed === 'number' && outgoing.speed > 0 ? outgoing.speed : 1;
        const incomingSpeed = typeof incoming?.speed === 'number' && incoming.speed > 0 ? incoming.speed : 1;
        let tailSeconds = Number.POSITIVE_INFINITY;
        if (!this.isStillImageCut(outgoing)) {
            const videoUri = outgoing ? this.cutVideoUri(outgoing) : undefined;
            const cached = videoUri ? this.videoDurationCache.get(videoUri) : undefined;
            tailSeconds = typeof cached === 'number'
                ? Math.max(0, cached - (outgoing?.out ?? 0)) / outgoingSpeed
                : cached === 'unavailable' ? 0 : Number.POSITIVE_INFINITY;
        }
        return planTransitionHandleWindow({
            declaredSeconds,
            outgoingTailRoomSeconds: tailSeconds,
            incomingHeadRoomSeconds: this.isStillImageCut(incoming)
                ? Number.POSITIVE_INFINITY : Math.max(0, incoming?.in ?? 0) / incomingSpeed,
            outgoingDurationSeconds: Math.max(0, earlier.tlEnd - earlier.tlStart),
            incomingDurationSeconds: Math.max(0, later.tlEnd - later.tlStart)
        });
    }

    protected async transitionHandlePlan(
        earlier: OutputSegment,
        later: OutputSegment,
        declaredSeconds: number
    ): Promise<ReturnType<typeof planTransitionHandleWindow>> {
        const outgoing = this.cuts[earlier.index];
        if (!outgoing || this.isStillImageCut(outgoing)) {
            return this.transitionHandlePlanSync(earlier, later, declaredSeconds);
        }
        const videoUri = this.cutVideoUri(outgoing);
        if (!videoUri) {
            const incoming = this.cuts[later.index];
            const incomingSpeed = typeof incoming?.speed === 'number' && incoming.speed > 0 ? incoming.speed : 1;
            return planTransitionHandleWindow({
                declaredSeconds,
                outgoingTailRoomSeconds: 0,
                incomingHeadRoomSeconds: this.isStillImageCut(incoming)
                    ? Number.POSITIVE_INFINITY : Math.max(0, incoming?.in ?? 0) / incomingSpeed,
                outgoingDurationSeconds: Math.max(0, earlier.tlEnd - earlier.tlStart),
                incomingDurationSeconds: Math.max(0, later.tlEnd - later.tlStart)
            });
        }
        const duration = await this.ensureVideoDurationFetch(videoUri);
        const incoming = this.cuts[later.index];
        const outgoingSpeed = typeof outgoing.speed === 'number' && outgoing.speed > 0 ? outgoing.speed : 1;
        const incomingSpeed = typeof incoming?.speed === 'number' && incoming.speed > 0 ? incoming.speed : 1;
        return planTransitionHandleWindow({
            declaredSeconds,
            outgoingTailRoomSeconds: typeof duration === 'number'
                ? Math.max(0, duration - outgoing.out) / outgoingSpeed : 0,
            incomingHeadRoomSeconds: this.isStillImageCut(incoming)
                ? Number.POSITIVE_INFINITY : Math.max(0, incoming?.in ?? 0) / incomingSpeed,
            outgoingDurationSeconds: Math.max(0, earlier.tlEnd - earlier.tlStart),
            incomingDurationSeconds: Math.max(0, later.tlEnd - later.tlStart)
        });
    }

    protected async removeLayerEvacuatedTransition(itemId: string): Promise<void> {
        await this.commitEditMutation('トランジションを削除', doc => updateV2Item(doc, {
            itemId,
            patch: { source: { transition_out: null } }
        }));
        this.hideNotice();
        this.footer.textContent = 'トランジションを削除しました。';
    }

    protected unsupportedTransitionTrack(cutIndex: number): number | undefined {
        return this.unsupportedTrackTransitionByCutIndex.get(cutIndex);
    }

    protected unsupportedDeclaredTransitionIndexes(): Set<number> {
        const indexes = new Set(this.declaredTrackTransitionWarnings);
        for (const cutIndex of this.declaredTransitionAdjacencyWarnings) {
            indexes.add(cutIndex);
        }
        return indexes;
    }

    protected nonAdjacentTransitionTarget(cutIndex: number): number | undefined {
        return this.nonAdjacentTransitionTargetByCutIndex.get(cutIndex);
    }

    protected unsupportedTransitionMessage(cutIndex: number): string {
        if (this.nonAdjacentTransitionTarget(cutIndex) !== undefined) {
            return NON_ADJACENT_TRANSITION_MESSAGE;
        }
        if (this.zeroOverlapTransitionIndexes.has(cutIndex)) {
            return ZERO_OVERLAP_TRANSITION_MESSAGE;
        }
        const track = this.unsupportedTransitionTrack(cutIndex);
        const suffix = track === undefined ? '' : `（映像トラック ${track + 1}）`;
        return `このトランジション${suffix}は、PiP または複数トラックを合成する方式では書き出せません。`
            + '削除するか、映像を単一のトラックへ戻してください。';
    }

    protected rawKeyframeItem(itemId: string): Record<string, any> | undefined {
        if (!Array.isArray(this.editDocument?.tracks)) return undefined;
        const visit = (items: unknown): Record<string, any> | undefined => {
            if (!Array.isArray(items)) return undefined;
            for (const candidate of items) {
                if (!candidate || typeof candidate !== 'object') continue;
                const item = candidate as Record<string, any>;
                if (item.id === itemId) return item;
                const nested = visit(item.items);
                if (nested) return nested;
            }
            return undefined;
        };
        for (const track of this.editDocument.tracks as Array<Record<string, unknown>>) {
            const item = visit(track.items);
            if (item) return item;
        }
        return undefined;
    }

    protected selectionForTreeRow(row: TimelineTreeRow): TimelineSelectionItem {
        if (this.overlays.some(item => item.id === row.id)) return { kind: 'overlay', id: row.id };
        if (this.layers.some(item => item.id === row.id)) return { kind: 'layer', id: row.id };
        const cutIndex = this.cutItemIds.indexOf(row.id);
        if (cutIndex >= 0) return { kind: 'cut', index: cutIndex };
        return {
            kind: 'item', id: row.id, itemKind: row.itemKind,
            ...(row.parentId === undefined ? {} : { parentId: row.parentId }), trackId: row.trackId
        };
    }

    protected async hydrateDocumentMotionReferences(document: EditV2Document): Promise<void> {
        if (!this.location?.editUri || !Array.isArray(document.tracks)) return;
        const visit = async (items: unknown): Promise<void> => {
            if (!Array.isArray(items)) return;
            for (const value of items) {
                if (!value || typeof value !== 'object') continue;
                const item = value as Record<string, any>;
                const reference = item.keyframes;
                if (reference && !Array.isArray(reference) && typeof reference.path === 'string'
                    && typeof item.id === 'string') {
                    try {
                        const text = (await this.fileService.readFile(
                            this.location!.editUri.parent.resolve(reference.path)
                        )).value.toString();
                        const motion = JSON.parse(text) as { items?: Record<string, unknown> };
                        const points = motion.items?.[item.id];
                        if (Array.isArray(points)) item.keyframes = points;
                    } catch {
                        // 参照を解決できない場合は席だけを残し、書き込み時に明示エラーを返す。
                    }
                }
                await visit(item.items);
            }
        };
        for (const track of document.tracks as Array<Record<string, unknown>>) await visit(track.items);
    }

    protected itemVisibleInFocus(itemId: string): boolean {
        return this.focusScope.rootId === null || this.timelineTreeRows.some(row => row.id === itemId);
    }

    protected renderKeyframePropertyRows(row: TimelineTreeRow, trackTop: number, itemRowIndex: number): void {
        const raw = this.rawKeyframeItem(row.id);
        const rows = this.keyframeRowsByItem.get(row.id) ?? [];
        const durationFrames = typeof raw?.duration === 'number' ? raw.duration : Math.max(1, this.frameAt(row.duration));
        rows.forEach((propertyRow, index) => {
            if (!this.isRangeMounted(row.at, row.at + row.duration)) return;
            const { element, created } = this.keyedStripSegment(
                `kf:${row.id}:${propertyRow.property}`, JSON.stringify([propertyRow, durationFrames]),
                row.at, row.at + row.duration, trackTop + (itemRowIndex + index + 1) * SUBROW_STRIDE,
                SUBROW_HEIGHT, 'akari-timeline-keyframe-property-row', propertyRow.label
            );
            element.style.pointerEvents = 'auto';
            element.dataset.akariKeyframePropertyRow = `${row.id}:${propertyRow.property}`;
            element.dataset.akariItemId = row.id;
            element.dataset.akariKeyframeProperty = propertyRow.property;
            if (created && propertyRow.editable) {
                element.addEventListener('pointerdown', event => event.stopPropagation());
                element.addEventListener('click', event => {
                    if (event.target instanceof Element && event.target.closest('[data-akari-keyframe-t]')) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (!this.detectTreeDoubleClick(
                        `${row.id}:${propertyRow.property}`, event.clientX, event.clientY
                    )) return;
                    const rect = element.getBoundingClientRect();
                    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
                    const t = Math.max(0, Math.min(durationFrames, Math.round(ratio * durationFrames)));
                    void this.setTimelineKeyframe(row.id, propertyRow.property, t,
                        this.staticKeyframeValue(raw, propertyRow.property));
                });
            }
            if (created) for (const diamond of propertyRow.diamonds) {
                const marker = document.createElement('button');
                marker.type = 'button';
                marker.textContent = '◆';
                marker.dataset.akariKeyframeT = String(diamond.t);
                marker.dataset.akariKeyframeItem = row.id;
                marker.dataset.akariKeyframeProperty = propertyRow.property;
                marker.dataset.akariKeyframeEndpoint = String(diamond.endpoint);
                marker.dataset.akariKeyframeFilled = String(diamond.filled);
                Object.assign(marker.style, {
                    position: 'absolute', left: `${durationFrames > 0 ? diamond.t / durationFrames * 100 : 0}%`,
                    top: '50%', transform: 'translate(-50%, -50%) rotate(45deg)', width: '9px', height: '9px',
                    appearance: 'none', padding: '0', fontSize: '0', outline: 'none',
                    border: '1px solid var(--theia-foreground)',
                    background: diamond.endpoint ? 'transparent' : 'var(--theia-foreground)',
                    cursor: 'pointer', pointerEvents: 'auto'
                });
                marker.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.applySelection(this.selectionForTreeRow(row));
                    const current = this.selectionModel.keyframeSelection;
                    const times = event.shiftKey && current?.itemId === row.id
                        && current.property === propertyRow.property
                        ? [...new Set([...current.times, diamond.t])].sort((left, right) => left - right)
                        : [diamond.t];
                    this.selectionModel.keyframeSelection = {
                        kind: 'keyframe', itemId: row.id,
                        property: propertyRow.property as KeyframeControlRequest['property'], times,
                        easing: this.segmentEasingAt(row.id, propertyRow.property, diamond.t)
                    };
                    this.applyKeyframePropertySelectionClass();
                });
                marker.addEventListener('pointerdown', event => {
                    if (event.button !== 0) return;
                    event.stopPropagation();
                    const startX = event.clientX;
                    marker.setPointerCapture(event.pointerId);
                    const finish = (up: PointerEvent): void => {
                        marker.removeEventListener('pointerup', finish);
                        marker.removeEventListener('pointercancel', finish);
                        if (Math.abs(up.clientX - startX) < 2) return;
                        const delta = Math.round((up.clientX - startX) / Math.max(1, this.strip.clientWidth)
                            * this.visibleDuration() * this.fps);
                        const toT = Math.max(0, Math.min(durationFrames, diamond.t + delta));
                        void this.moveTimelineKeyframe(row.id, propertyRow.property, diamond.t, toT);
                    };
                    marker.addEventListener('pointerup', finish);
                    marker.addEventListener('pointercancel', finish);
                });
                element.appendChild(marker);
            }
        });
    }

    protected appendMotionMarks(element: HTMLElement, value: unknown): void {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        const motion = value as Record<string, unknown>;
        for (const [slot, left] of [['in', '2px'], ['loop', '50%'], ['out', 'calc(100% - 5px)']] as const) {
            if (motion[slot] === undefined) continue;
            const mark = document.createElement('span');
            mark.dataset.akariMotionMark = slot;
            mark.title = slot === 'in' ? '入り' : slot === 'out' ? '抜き' : 'ループ';
            Object.assign(mark.style, {
                position: 'absolute', left, bottom: '2px', width: '4px', height: '4px',
                borderRadius: slot === 'loop' ? '50%' : '0', background: '#fff', pointerEvents: 'none'
            });
            element.appendChild(mark);
        }
    }

    protected appendAggregateDiamonds(element: HTMLElement, parent: TimelineTreeRow): void {
        if (!parent.hasChildren) return;
        const descendants: TimelineTreeRow[] = [];
        for (const row of this.timelineTreeRows) {
            if (row.id !== parent.id && this.isDescendantRow(row, parent.id)) descendants.push(row);
        }
        const items = descendants.flatMap(row => {
            const raw = this.rawKeyframeItem(row.id);
            return raw ? [{ id: row.id, duration: raw.duration ?? 0, keyframes: raw.keyframes }] : [];
        });
        const durationFrames = this.rawKeyframeItem(parent.id)?.duration ?? Math.max(1, this.frameAt(parent.duration));
        for (const diamond of aggregateKeyframeDiamonds(items)) {
            const marker = document.createElement('span');
            marker.dataset.akariAggregateKeyframeT = String(diamond.t);
            marker.dataset.akariAggregateKeyframeFilled = String(diamond.filled);
            Object.assign(marker.style, {
                position: 'absolute', left: `${durationFrames > 0 ? diamond.t / durationFrames * 100 : 0}%`,
                bottom: '-1px', width: '7px', height: '7px', transform: 'translateX(-50%) rotate(45deg)',
                border: '1px solid #fff', background: diamond.filled ? '#fff' : 'transparent', pointerEvents: 'auto'
            });
            marker.addEventListener('pointerdown', event => {
                const startX = event.clientX;
                marker.setPointerCapture(event.pointerId);
                const finish = (up: PointerEvent): void => {
                    marker.removeEventListener('pointerup', finish);
                    marker.removeEventListener('pointercancel', finish);
                    const delta = Math.round((up.clientX - startX) / Math.max(1, this.strip.clientWidth)
                        * this.visibleDuration() * this.fps);
                    if (delta !== 0) void this.moveAggregateKeyframes(diamond.itemIds, diamond.t, diamond.t + delta);
                };
                marker.addEventListener('pointerup', finish);
                marker.addEventListener('pointercancel', finish);
            });
            element.appendChild(marker);
        }
    }

    protected isDescendantRow(row: TimelineTreeRow, ancestorId: string): boolean {
        let parentId = row.parentId;
        while (parentId) {
            if (parentId === ancestorId) return true;
            let nextParentId: string | undefined;
            for (const candidate of this.expandedTimelineTreeRows) {
                if (candidate.id === parentId) { nextParentId = candidate.parentId; break; }
            }
            parentId = nextParentId;
        }
        return false;
    }

    protected staticKeyframeValue(raw: Record<string, any> | undefined, property: KeyframeProperty): unknown {
        if (property.startsWith('transform.')) {
            const key = property.substring('transform.'.length);
            return raw?.transform?.[key] ?? (key === 'scale' ? 1 : 0);
        }
        return raw?.[property] ?? (property === 'opacity' ? 1 : {});
    }

    protected hydratedKeyframes(itemId: string): readonly Record<string, unknown>[] | undefined {
        const points = this.rawKeyframeItem(itemId)?.keyframes;
        return Array.isArray(points) ? points : undefined;
    }

    protected segmentEasingAt(itemId: string, property: KeyframeProperty, t: number): string {
        const points = this.hydratedKeyframes(itemId) ?? [];
        const declaredTimes: number[] = [];
        let target: Record<string, unknown> | undefined;
        for (const point of points) {
            if (keyframeValueAt(point, property) === undefined) continue;
            declaredTimes.push(Number(point.t));
            if (point.t === t) target = point;
        }
        if (!target || t === Math.min(...declaredTimes)) return 'linear';
        if (typeof target.easing === 'string') return target.easing;
        if (target.easing && typeof target.easing === 'object' && !Array.isArray(target.easing)) {
            const easing = target.easing as Record<string, unknown>;
            const value = easing[property] ?? (property.startsWith('transform.') ? easing.transform : undefined);
            if (typeof value === 'string') return value;
        }
        return 'linear';
    }

    protected async setTimelineKeyframe(
        itemId: string, property: KeyframeProperty, t: number, value: unknown
    ): Promise<void> {
        const hydratedPoints = this.hydratedKeyframes(itemId);
        await this.commitEditMutation('キーフレームを打つ', doc => setV2Keyframe(doc, {
            itemId, property, t, value, ...(hydratedPoints ? { hydratedPoints } : {})
        }));
        this.selectionModel.keyframeSelection = {
            kind: 'keyframe', itemId, property: property as KeyframeControlRequest['property'], times: [t],
            easing: this.segmentEasingAt(itemId, property, t)
        };
    }

    protected async moveTimelineKeyframe(
        itemId: string, property: KeyframeProperty, fromT: number, toT: number
    ): Promise<void> {
        const lockedTrackId = this.trackIdOfItem(itemId);
        if (this.isTrackLocked(lockedTrackId)) {
            this.showLockedTrack(lockedTrackId);
            return;
        }
        const hydratedPoints = this.hydratedKeyframes(itemId);
        await this.commitEditMutation('キーフレームを移動', doc => moveV2Keyframe(doc, {
            itemId, property, fromT, toT, ...(hydratedPoints ? { hydratedPoints } : {})
        }));
        this.selectionModel.keyframeSelection = {
            kind: 'keyframe', itemId, property: property as KeyframeControlRequest['property'], times: [toT],
            easing: this.segmentEasingAt(itemId, property, toT)
        };
    }

    protected async removeSelectedKeyframes(): Promise<void> {
        const selected = this.selectionModel.keyframeSelection;
        if (!selected) return;
        const lockedTrackId = this.trackIdOfItem(selected.itemId);
        if (this.isTrackLocked(lockedTrackId)) {
            this.showLockedTrack(lockedTrackId);
            return;
        }
        const hydratedPoints = this.hydratedKeyframes(selected.itemId);
        await this.commitEditMutation('キーフレームを削除', doc => selected.times.reduce(
            (current, t) => removeV2Keyframe(current, {
                itemId: selected.itemId, property: selected.property, t,
                ...(hydratedPoints ? { hydratedPoints } : {})
            }), doc
        ));
        this.selectionModel.keyframeSelection = undefined;
    }

    protected async moveAggregateKeyframes(itemIds: readonly string[], fromT: number, proposedToT: number): Promise<void> {
        for (const itemId of itemIds) {
            const lockedTrackId = this.trackIdOfItem(itemId);
            if (this.isTrackLocked(lockedTrackId)) {
                this.showLockedTrack(lockedTrackId);
                return;
            }
        }
        const hydrated = new Map(itemIds.map(id => [id, this.hydratedKeyframes(id)]));
        await this.commitEditMutation('集約キーフレームを移動', doc => {
            let current = doc;
            for (const itemId of itemIds) {
                const raw = this.rawKeyframeItem(itemId);
                let point: Record<string, unknown> | undefined;
                if (Array.isArray(raw?.keyframes)) {
                    for (const candidate of raw.keyframes as Record<string, unknown>[]) {
                        if (candidate.t === fromT) { point = candidate; break; }
                    }
                }
                if (!point) continue;
                const duration = typeof raw.duration === 'number' ? raw.duration : proposedToT;
                const toT = Math.max(0, Math.min(duration, proposedToT));
                for (const property of this.keyframePropertiesAt(point)) {
                    current = moveV2Keyframe(current, {
                        itemId, property, fromT, toT,
                        ...(hydrated.get(itemId) ? { hydratedPoints: hydrated.get(itemId)! } : {})
                    });
                }
            }
            return current;
        });
    }

    protected keyframePropertiesAt(point: Record<string, unknown>): KeyframeProperty[] {
        const result: KeyframeProperty[] = [];
        const transform = point.transform && typeof point.transform === 'object' && !Array.isArray(point.transform)
            ? point.transform as Record<string, unknown> : {};
        for (const key of ['x', 'y', 'scale', 'rotate']) if (key in transform) result.push(`transform.${key}` as KeyframeProperty);
        for (const key of ['opacity', 'crop', 'perspective'] as const) if (key in point) result.push(key);
        return result;
    }

    protected applyKeyframePropertySelectionClass(): void {
        const selected = this.selectionModel.keyframeSelection;
        const matches = (element: HTMLElement): boolean => selected !== undefined
            && element.dataset.akariItemId === selected.itemId
            && element.dataset.akariKeyframeProperty === selected.property;
        for (const element of Array.from(
            this.strip.querySelectorAll<HTMLElement>('[data-akari-keyframe-property-row]')
        )) {
            element.classList.toggle('akari-timeline-keyframe-property-selected', matches(element));
        }
        for (const element of Array.from(
            this.trackHeaders.querySelectorAll<HTMLElement>('[data-akari-keyframe-property-header]')
        )) {
            const selectedKey = selected ? `${selected.itemId}:${selected.property}` : '';
            element.classList.toggle(
                'akari-timeline-keyframe-property-selected',
                element.dataset.akariKeyframePropertyHeader === selectedKey
            );
        }
    }

    protected scrollTimelineKeyframeRowIntoView(
        itemId: string,
        property: KeyframeControlRequest['property']
    ): boolean {
        let row: HTMLElement | undefined;
        for (const candidate of Array.from(
            this.strip.querySelectorAll<HTMLElement>('[data-akari-keyframe-property-row]')
        )) {
            if (candidate.dataset.akariItemId === itemId
                && candidate.dataset.akariKeyframeProperty === property) {
                row = candidate;
                break;
            }
        }
        if (!row) return false;
        const viewportHeight = this.stripScroll.clientHeight;
        const top = row.offsetTop;
        const bottom = top + row.offsetHeight;
        const visibleTop = this.stripScroll.scrollTop;
        const visibleBottom = visibleTop + viewportHeight;
        if (top < visibleTop) {
            this.stripScroll.scrollTop = top;
        } else if (viewportHeight > 0 && bottom > visibleBottom) {
            this.stripScroll.scrollTop = Math.max(0, bottom - viewportHeight);
        }
        this.trackHeaders.style.transform = `translateY(${-this.stripScroll.scrollTop}px)`;
        return true;
    }

    protected async handleKeyframeControl(request: KeyframeControlRequest): Promise<InspectorWriteResult> {
        try {
            const itemId = request.itemId.startsWith('cut:')
                ? this.cutItemIds[Number(request.itemId.substring('cut:'.length))] : request.itemId;
            if (!itemId) throw new Error('キーフレーム対象が見つかりません。');
            let row: TimelineTreeRow | undefined;
            for (const candidate of this.expandedTimelineTreeRows) {
                if (candidate.id === itemId) { row = candidate; break; }
            }
            const raw = this.rawKeyframeItem(itemId);
            if (!row || !raw) throw new Error('キーフレーム対象が見つかりません。');
            const t = Math.max(0, Math.min(raw.duration,
                Math.round((this.playheadT - row.at) * this.fps)));
            const points = this.hydratedKeyframes(itemId) ?? [];
            const times: number[] = [];
            for (const point of points) {
                if (keyframeValueAt(point, request.property) !== undefined) times.push(Number(point.t));
            }
            times.sort((left, right) => left - right);
            if (request.action === 'reveal') {
                if (times.length === 0) throw new Error('キーフレームがありません。');
                const nearest = times.reduce((best, candidate) =>
                    Math.abs(candidate - t) < Math.abs(best - t) ? candidate : best);
                this.selectionModel.keyframeSelection = {
                    kind: 'keyframe', itemId, property: request.property, times: [nearest],
                    easing: this.segmentEasingAt(itemId, request.property, nearest)
                };
                this.applyFocusScope(enterFocusScope(this.expandedTimelineTreeRows, itemId));
                this.applyKeyframePropertySelectionClass();
                if (!this.scrollTimelineKeyframeRowIntoView(itemId, request.property)) {
                    throw new Error('キーフレーム行を表示できませんでした。');
                }
                return { ok: true };
            }
            if (request.action === 'previous' || request.action === 'next') {
                let target: number | undefined;
                if (request.action === 'previous') {
                    for (let index = times.length - 1; index >= 0; index--) {
                        if (times[index] < t) { target = times[index]; break; }
                    }
                } else {
                    for (const time of times) if (time > t) { target = time; break; }
                }
                if (target !== undefined) {
                    this.playheadT = row.at + target / this.fps;
                    this.selectedSourceT = this.outputToSource(this.playheadT);
                    await this.requestSeek(this.playheadT, { domain: 'output' });
                    this.selectionModel.keyframeSelection = {
                        kind: 'keyframe', itemId, property: request.property, times: [target],
                        easing: this.segmentEasingAt(itemId, request.property, target)
                    };
                    this.applyKeyframePropertySelectionClass();
                }
                return { ok: true };
            }
            if (request.action === 'easing') {
                const selected = this.selectionModel.keyframeSelection;
                let toT = selected?.itemId === itemId && selected.times.length > 0
                    ? Math.max(...selected.times) : undefined;
                if (toT === undefined) for (const time of times) if (time > t) { toT = time; break; }
                if (toT === undefined || !request.easing) throw new Error('イージングを設定する区間を選択してください。');
                const hydratedPoints = this.hydratedKeyframes(itemId);
                await this.commitEditMutation('区間イージングを変更', doc => setV2SegmentEasing(doc, {
                    itemId, property: request.property, toT, easing: request.easing!,
                    ...(hydratedPoints ? { hydratedPoints } : {})
                }));
                this.selectionModel.keyframeSelection = {
                    kind: 'keyframe', itemId, property: request.property, times: [toT], easing: request.easing
                };
                return { ok: true };
            }
            if (times.includes(t)) {
                this.selectionModel.keyframeSelection = {
                    kind: 'keyframe', itemId, property: request.property, times: [t],
                    easing: this.segmentEasingAt(itemId, request.property, t)
                };
                await this.removeSelectedKeyframes();
            } else {
                await this.setTimelineKeyframe(itemId, request.property, t,
                    request.value ?? this.staticKeyframeValue(raw, request.property));
            }
            return { ok: true };
        } catch (error) {
            return { ok: false, message: this.errorMessage(error) };
        }
    }

    protected renderTrackHeaders(beatsTop: number, beatsHeight: number): void {
        this.beginKeyedRender('header');
        if (beatsHeight > 0) {
            this.keyedNode('header', 'header:beats', `${this.beatsVisible}:${this.beatsMuted}:${this.beatsLocked}`, () =>
                this.trackHeaderRow(
                    '見せ場', 'beat', 'beats', beatsTop, beatsHeight,
                    this.beatsVisible, () => {
                        this.beatsVisible = !this.beatsVisible;
                        this.dispatchPreviewEvent(TIMELINE_SET_BEATS_VISIBILITY_EVENT, { visible: this.beatsVisible });
                        this.renderStrip();
                    }, !this.beatsMuted, () => {
                        this.beatsMuted = !this.beatsMuted;
                        this.dispatchPreviewEvent(TIMELINE_SET_BEATS_MUTED_EVENT, { muted: this.beatsMuted });
                        this.renderStrip();
                    }
                )
            );
        }
        const autoNames = this.computeTrackAutoNames();
        const displayedTracks = [...this.displayTimelineTracks].reverse();
        displayedTracks.forEach(track => {
            if (this.focusScope.rootId !== null && !(this.treeRowsByTrack.get(track.id)?.length)) return;
            const layout = this.laneLayout.tracks.find(candidate => candidate.id === track.id);
            if (!layout) {
                return;
            }
            const name = track.label || autoNames.get(track.id) || '';
            const iconKind = this.trackIconKind(track.kind);
            let visible = true;
            let audible = true;
            let toggleVisibility = (): void => undefined;
            let toggleMute = (): void => undefined;
            if (track.kind === 'cuts') {
                visible = !layout.hidden;
                audible = !layout.muted;
                toggleVisibility = () => {
                    void this.toggleTimelineTrackFlag(track, 'hidden');
                };
                toggleMute = () => {
                    void this.toggleTimelineTrackFlag(track, 'muted');
                };
            } else if (track.kind === 'layers') {
                visible = !layout.hidden;
                audible = !layout.muted;
                toggleVisibility = () => {
                    void this.toggleTimelineTrackFlag(track, 'hidden');
                };
                toggleMute = () => {
                    void this.toggleTimelineTrackFlag(track, 'muted');
                };
            } else if (track.kind === 'overlays') {
                visible = !this.hiddenTracks.has(layout.track);
                audible = !this.mutedOverlayTracks.has(layout.track);
                toggleVisibility = () => {
                    if (this.hiddenTracks.has(layout.track)) {
                        this.hiddenTracks.delete(layout.track);
                    } else {
                        this.hiddenTracks.add(layout.track);
                    }
                    this.dispatchPreviewEvent(TIMELINE_SET_TRACK_VISIBILITY_EVENT, {
                        track: layout.track, visible: !this.hiddenTracks.has(layout.track)
                    });
                    this.renderStrip();
                };
                toggleMute = () => {
                    if (this.mutedOverlayTracks.has(layout.track)) {
                        this.mutedOverlayTracks.delete(layout.track);
                    } else {
                        this.mutedOverlayTracks.add(layout.track);
                    }
                    this.dispatchPreviewEvent(TIMELINE_SET_OVERLAY_TRACK_MUTED_EVENT, {
                        track: layout.track, muted: this.mutedOverlayTracks.has(layout.track)
                    });
                    this.renderStrip();
                };
            } else if (track.kind === 'captions') {
                visible = this.captionsVisible;
                audible = !this.captionsMuted;
                toggleVisibility = () => {
                    this.captionsVisible = !this.captionsVisible;
                    this.dispatchPreviewEvent(TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT, { visible: this.captionsVisible });
                    this.renderStrip();
                };
                toggleMute = () => {
                    this.captionsMuted = !this.captionsMuted;
                    this.dispatchPreviewEvent(TIMELINE_SET_CAPTIONS_MUTED_EVENT, { muted: this.captionsMuted });
                    this.renderStrip();
                };
            } else {
                visible = this.audioVisible;
                audible = !layout.muted;
                toggleVisibility = () => {
                    this.audioVisible = !this.audioVisible;
                    this.dispatchPreviewEvent(TIMELINE_SET_AUDIO_VISIBILITY_EVENT, { visible: this.audioVisible });
                    this.renderStrip();
                };
                toggleMute = () => {
                    void this.toggleTimelineTrackFlag(track, 'muted');
                };
            }
            const locked = this.isTrackLocked(track.id);
            const treeRows = this.treeRowsByTrack.get(track.id) ?? [];
            const { element: header, created } = this.keyedNode(
                'header', `header:${layout.id ?? track.id}`, JSON.stringify([track, name, visible, audible, locked, treeRows]),
                () => this.trackHeaderRow(
                    name, iconKind, track.id, layout.top, layout.height,
                    visible, toggleVisibility, audible, toggleMute, layout.track, track
                )
            );
            header.style.top = `${layout.top}px`;
            header.style.height = `${layout.height}px`;
            if (created && treeRows.length > 0) {
                this.decorateTreeTrackHeader(header, treeRows);
            }
        });
        this.finishKeyedRender('header');
    }

    protected decorateTreeTrackHeader(header: HTMLDivElement, rows: readonly TimelineTreeRow[]): void {
        const trackLine = document.createElement('div');
        trackLine.className = 'akari-track-header-trackline';
        for (const child of Array.from(header.childNodes)) {
            if (child instanceof HTMLElement
                && child.classList.contains('akari-track-header-resize-handle')) continue;
            trackLine.appendChild(child);
        }
        header.insertBefore(trackLine, header.firstChild);
        header.dataset.akariTreeTrack = 'true';
        let visualIndex = timelineTreeRowOffset(rows.length);
        rows.forEach(treeRow => {
            const row = document.createElement('div');
            row.dataset.akariTreeRowId = treeRow.id;
            row.dataset.akariItemId = treeRow.id;
            row.dataset.akariItemKind = 'item';
            row.dataset.akariLocked = String(this.isTrackLocked(treeRow.trackId));
            Object.assign(row.style, {
                position: 'absolute', left: '0', right: '0', top: `${visualIndex * SUBROW_STRIDE}px`,
                height: `${SUBROW_HEIGHT}px`, display: 'flex', alignItems: 'center', gap: '3px',
                paddingLeft: `${4 + treeRow.depth * 16}px`, boxSizing: 'border-box', overflow: 'hidden'
            });
            const canToggle = treeRow.sourceKind === 'group' && treeRow.hasChildren;
            const label = document.createElement('span');
            label.textContent = treeRow.label;
            label.title = treeRow.label;
            Object.assign(label.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
            if (canToggle) {
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.dataset.akariTreeToggle = treeRow.id;
                toggle.textContent = treeRow.collapsed ? '▸' : '▾';
                Object.assign(toggle.style, {
                    width: '16px', minWidth: '16px', padding: '0', border: '0', background: 'transparent',
                    color: 'inherit', cursor: 'pointer'
                });
                toggle.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const expanding = this.timelineCollapsedIds.has(treeRow.id);
                    this.timelineCollapsedState?.set(treeRow.id, expanding);
                    if (expanding) this.timelineCollapsedIds.delete(treeRow.id);
                    else this.timelineCollapsedIds.add(treeRow.id);
                    this.refreshTimelineTreeRows();
                });
                row.append(toggle);
            }
            row.append(label);
            if (this.focusScope.rootId !== null) {
                const add = document.createElement('button');
                add.type = 'button';
                add.textContent = '+';
                add.title = 'プロパティ行を追加';
                add.dataset.akariKeyframePropertyAdd = treeRow.id;
                add.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const visible = new Set(this.keyframeRowsByItem.get(treeRow.id)?.map(entry => entry.property));
                    const property = (['crop', 'perspective'] as KeyframeProperty[])
                        .find(candidate => !visible.has(candidate));
                    if (!property) return;
                    const requested = this.extraKeyframeProperties.get(treeRow.id) ?? new Set<KeyframeProperty>();
                    requested.add(property);
                    this.extraKeyframeProperties.set(treeRow.id, requested);
                    this.renderStrip();
                });
                row.appendChild(add);
            }
            row.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (this.detectTreeDoubleClick(treeRow.id, event.clientX, event.clientY)) {
                    this.enterTreeItem(treeRow);
                    return;
                }
                const selected = this.selectionForTreeRow(treeRow);
                if (event.shiftKey) this.toggleMultiSelection(selected);
                else this.applySelection(selected);
            });
            row.addEventListener('pointerdown', event => event.stopPropagation());
            this.installTreeRowDrag(row, treeRow, rows);
            header.appendChild(row);
            visualIndex++;
            for (const propertyRow of this.keyframeRowsByItem.get(treeRow.id) ?? []) {
                const property = document.createElement('div');
                property.dataset.akariKeyframePropertyHeader = `${treeRow.id}:${propertyRow.property}`;
                property.textContent = propertyRow.label;
                Object.assign(property.style, {
                    position: 'absolute', left: '0', right: '0', top: `${visualIndex * SUBROW_STRIDE}px`,
                    height: `${SUBROW_HEIGHT}px`, paddingLeft: `${24 + treeRow.depth * 16}px`,
                    boxSizing: 'border-box', fontSize: '10px', lineHeight: `${SUBROW_HEIGHT}px`,
                    opacity: propertyRow.editable ? '.9' : '.55', overflow: 'hidden', textOverflow: 'ellipsis'
                });
                header.appendChild(property);
                visualIndex++;
            }
        });
    }

    protected refreshTimelineTreeRows(): void {
        this.timelineTreeRows = this.focusScope.rootId === null
            ? applyTimelineCollapsedRows(this.expandedTimelineTreeRows, this.timelineCollapsedIds)
            : rowsInFocusScope(this.expandedTimelineTreeRows, this.focusScope);
        this.treeRowsByTrack = rowsByTrack(this.focusScope.rootId === null
            ? visibleTimelineTreeRows(this.timelineTreeRows)
            : this.timelineTreeRows);
        this.renderStrip();
    }

    protected installTreeRowDrag(
        element: HTMLDivElement,
        source: TimelineTreeRow,
        rows: readonly TimelineTreeRow[]
    ): void {
        this.treeRowDragConfigs.set(element, { source, rows });
        if (this.treeRowDragInstalled.has(element)) return;
        this.treeRowDragInstalled.add(element);
        element.style.touchAction = 'none';
        element.addEventListener('pointerdown', event => {
            const { source, rows } = this.treeRowDragConfigs.get(element)!;
            if (event.button !== 0 || event.target instanceof Element && event.target.closest('button')) return;
            const lockedTrackId = source.trackId;
            if (this.isTrackLocked(lockedTrackId)) {
                this.showLockedTrack(lockedTrackId, event);
                return;
            }
            const startY = event.clientY;
            let dragged = false;
            let hit: TimelineTreeDropHit | undefined;
            element.setPointerCapture(event.pointerId);
            const clear = (): void => {
                for (const row of Array.from(this.trackHeaders.querySelectorAll<HTMLElement>('[data-akari-tree-drop]'))) {
                    delete row.dataset.akariTreeDrop;
                }
            };
            const onMove = (moveEvent: PointerEvent): void => {
                if (!dragged && Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) return;
                dragged = true;
                clear();
                hit = undefined;
                const targetElement = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)
                    ?.closest<HTMLElement>('[data-akari-tree-row-id]');
                const target = targetElement
                    ? this.timelineTreeRows.find(row => row.id === targetElement.dataset.akariTreeRowId) : undefined;
                if (!target || target.id === source.id) return;
                const lockedTrackId = target.trackId;
                if (this.isTrackLocked(lockedTrackId)) {
                    this.showLockedTrack(lockedTrackId, moveEvent);
                    return;
                }
                const rect = targetElement!.getBoundingClientRect();
                const siblings = rows.filter(row => row.parentId === target.parentId);
                const targetIndex = Math.max(0, siblings.findIndex(row => row.id === target.id));
                hit = hitTestTimelineTreeDrop({
                    localY: moveEvent.clientY, rowTop: rect.top, rowHeight: rect.height,
                    targetId: target.id, targetIndex,
                    canContain: target.sourceKind === 'group'
                });
                targetElement!.dataset.akariTreeDrop = hit.mode === 'inside' ? 'inside' : hit.edge ?? 'before';
            };
            const onUp = (_upEvent: PointerEvent): void => {
                element.removeEventListener('pointermove', onMove);
                element.removeEventListener('pointerup', onUp);
                element.removeEventListener('pointercancel', onUp);
                clear();
                if (!dragged || !hit) return;
                const target = this.timelineTreeRows.find(row => row.id === hit!.targetId);
                if (!target) return;
                for (const trackId of [source.trackId, target.trackId]) {
                    if (this.isTrackLocked(trackId)) {
                        this.showLockedTrack(trackId, _upEvent);
                        return;
                    }
                }
                if (source.parentId && source.parentId !== target.parentId && hit!.mode === 'line') {
                    void this.commitEditMutation('出す', doc => detachTreeV2Item(doc, source.id, {
                        at: Math.round(source.at * this.fps), duration: Math.round(source.duration * this.fps)
                    }).document)
                        .catch(error => this.showNotice(`出せません: ${this.errorMessage(error)}`));
                    return;
                }
                const moveTarget = hit!.mode === 'inside'
                    ? { parent: target.id, index: undefined }
                    : target.parentId
                        ? { parent: target.parentId, index: hit!.index }
                        : { track: target.trackId, index: hit!.index };
                void this.commitEditMutation('木の行を移動', doc =>
                    moveTreeV2Item(doc, source.id, moveTarget).document
                ).catch(error => this.showNotice(`移動できません: ${this.errorMessage(error)}`));
            };
            element.addEventListener('pointermove', onMove);
            element.addEventListener('pointerup', onUp);
            element.addEventListener('pointercancel', onUp);
        });
    }

    /**
     * R7-4・A/V/T 命名（2026-08-12、字幕レーンの自動命名を V 系から T 系へ分離）: トラック表示名を
     * グループ内連番 + 種別プレフィックスへ（音声 = A1, A2, …・字幕 = T1, T2, …・映像系
     * （cuts/layers/overlays）= V1, V2, …。いずれも最下段から連番）。this.displayTimelineTracks は
     * 配列先頭 = 画面最下段（widget の `[...tracks].reverse()` 規約）なので、配列を先頭から辿る
     * だけで各グループとも「最下段から連番」になる（中核アルゴリズムは computeTrackAutoNames、
     * common/ の純粋関数として単体テスト済み）。
     */
    protected computeTrackAutoNames(): Map<string, string> {
        return computeTrackKindAutoNames(this.displayTimelineTracks);
    }

    protected trackHeaderRow(
        name: string,
        kind: 'video' | 'overlay' | 'layer' | 'audio' | 'caption' | 'beat',
        lane: string,
        top: number,
        height: number,
        visible: boolean,
        toggleVisibility: () => void,
        audible: boolean,
        toggleMute: () => void,
        track?: number,
        timelineTrack?: EditTimelineTrack
    ): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'akari-track-header-row';
        row.dataset.akariLane = lane;
        if (timelineTrack) {
            row.dataset.akariTimelineTrackId = timelineTrack.id;
            row.dataset.akariKind = timelineTrack.kind;
        }
        row.style.top = `${top}px`;
        row.style.height = `${height}px`;
        if (track !== undefined) {
            row.dataset.akariTrack = String(track);
        }
        const icon = document.createElement('span');
        icon.className = 'akari-track-header-icon';
        icon.dataset.akariKind = kind;
        icon.innerHTML = this.trackKindSvg(kind);
        const nameElement = document.createElement('span');
        nameElement.className = 'akari-track-header-name';
        nameElement.textContent = timelineTrack && this.timelineTrackItemCount(timelineTrack) === 0
            ? `${name} (空)` : name;
        row.append(icon, nameElement);
        const controls = trackHeaderControls(kind);
        const locked = kind === 'beat' ? this.beatsLocked : this.isTrackLocked(timelineTrack?.id ?? lane);
        const toggleLock = (): void => {
            void this.toggleTimelineTrackFlag(timelineTrack ?? { id: 'beats', kind: 'audio', ref: 0 }, 'locked');
        };
        if (controls.visibility) {
            row.append(this.trackHeaderButton(`${name}を表示`, 'visibility', visible, this.eyeSvg(), toggleVisibility));
        }
        if (controls.mute) {
            const muteButton = this.trackHeaderButton(
                `${name}の音声`, 'mute', audible, this.speakerSvg(), toggleMute
            );
            if (timelineTrack?.kind === 'audio'
                && !this.timelineTracks.some(track => track.id === timelineTrack.id)) {
                muteButton.disabled = true;
                muteButton.title = '自動追加された行はミュートできません（トラックを追加で確定してから）';
            }
            row.append(muteButton);
        }
        if (controls.lock) {
            row.append(this.trackHeaderButton(`${name}をロック`, 'lock', locked, this.lockSvg(), toggleLock));
        }
        if (timelineTrack) {
            nameElement.addEventListener('dblclick', event => {
                event.preventDefault();
                event.stopPropagation();
                this.beginTrackRename(nameElement, timelineTrack);
            });
            row.addEventListener('pointerdown', event => this.onTrackHeaderPointerDown(event, timelineTrack));
            if (timelineTrack.kind === 'cuts' || timelineTrack.kind === 'audio') {
                row.appendChild(this.trackHeightResizeHandle(timelineTrack));
            }
        }
        return row;
    }

    protected trackIconKind(
        kind: TimelineTrackKind
    ): 'video' | 'overlay' | 'layer' | 'audio' | 'caption' {
        return {
            cuts: 'video',
            layers: 'video',
            overlays: 'video',
            captions: 'caption',
            audio: 'audio'
        }[kind] as 'video' | 'overlay' | 'layer' | 'audio' | 'caption';
    }

    protected trackLayout(kind: TimelineTrackKind, ref: number): TrackGroupLayout | undefined {
        return this.laneLayout.tracks.find(layout => layout.kind === kind && layout.track === ref);
    }

    protected beginTrackRename(nameElement: HTMLSpanElement, track: EditTimelineTrack): void {
        const input = document.createElement('input');
        input.className = 'akari-track-header-name-input';
        input.value = track.label ?? '';
        input.placeholder = nameElement.textContent ?? '';
        nameElement.replaceWith(input);
        let committed = false;
        const commit = (): void => {
            if (committed) {
                return;
            }
            committed = true;
            const label = input.value.trim();
            void this.commitEditMutation('トラック名を変更', doc =>
                renameV2Track(doc, { trackId: track.id, name: label })
            ).then(() => { this.footer.textContent = 'トラック名を変更しました。'; }).catch(error => {
                this.showNotice(`トラック名を変更できません: ${this.errorMessage(error)}`);
            });
        };
        input.addEventListener('pointerdown', event => event.stopPropagation());
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                input.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                committed = true;
                this.renderStrip();
            }
        });
        input.focus();
        input.select();
    }

    protected onTrackHeaderPointerDown(event: PointerEvent, track: EditTimelineTrack): void {
        // audio グループは並べ替え UI から除外（R6 契約 §1 裁定 1: 最下段固定）。
        // ヘッダー自体を掴めなくすることで、並べ替え結果が audio を跨ぐことはない。
        if (event.button !== 0 || track.locked || track.kind === 'audio'
            || event.target instanceof Element && event.target.closest('button, input')) {
            return;
        }
        const row = event.currentTarget as HTMLDivElement;
        const startY = event.clientY;
        let targetId = track.id;
        let dragged = false;
        row.setPointerCapture(event.pointerId);
        const onMove = (moveEvent: PointerEvent): void => {
            if (!dragged && Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
                return;
            }
            dragged = true;
            row.style.opacity = '.45';
            for (const candidate of Array.from(
                this.trackHeaders.querySelectorAll<HTMLElement>('[data-akari-timeline-track-id]')
            )) {
                candidate.classList.remove('akari-track-header-drop-target');
                // audio 行は移動先候補にしない（並べ替え結果が audio を跨がないための対）。
                if (candidate.dataset.akariKind === 'audio') {
                    continue;
                }
                const rect = candidate.getBoundingClientRect();
                if (moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom) {
                    targetId = candidate.dataset.akariTimelineTrackId ?? targetId;
                    candidate.classList.add('akari-track-header-drop-target');
                }
            }
        };
        const onUp = (): void => {
            row.removeEventListener('pointermove', onMove);
            row.removeEventListener('pointerup', onUp);
            row.removeEventListener('pointercancel', onUp);
            row.style.opacity = '';
            for (const candidate of Array.from(
                this.trackHeaders.querySelectorAll<HTMLElement>('[data-akari-timeline-track-id]')
            )) {
                candidate.classList.remove('akari-track-header-drop-target');
            }
            if (!dragged || targetId === track.id) {
                return;
            }
            void this.commitEditMutation('トラックを並べ替え', doc => {
                const tracks = Array.isArray(doc.tracks) ? doc.tracks as Array<Record<string, unknown>> : [];
                const sourceIndex = tracks.findIndex(candidate => candidate.id === track.id);
                const targetIndex = tracks.findIndex(candidate => candidate.id === targetId);
                if (sourceIndex < 0 || targetIndex < 0) throw new Error('トラックを特定できません。');
                return reorderV2Tracks(doc, { fromIndex: sourceIndex, toIndex: targetIndex });
            }).then(() => { this.footer.textContent = 'トラックを並べ替えました。'; }).catch(error => {
                this.showNotice(`トラックを並べ替えできません: ${this.errorMessage(error)}`);
            });
        };
        row.addEventListener('pointermove', onMove);
        row.addEventListener('pointerup', onUp);
        row.addEventListener('pointercancel', onUp);
    }

    /**
     * audio グループを常に配列先頭（= widget の [...tracks].reverse() 規約で画面最下段）へ寄せる
     * 安定パーティション。cuts/layers/overlays/captions 相互の相対順は変えない。
     * R6 契約 §1 裁定 1「音源グループは最下段固定」の強制 — 旧裁定順で保存済みの
     * timeline.tracks（例: dogfood 既存データ）を読んでも表示・並べ替え双方でこの順に正規化する。
     */
    protected pinAudioGroupToBottom(tracks: readonly EditTimelineTrack[]): EditTimelineTrack[] {
        const audio = tracks.filter(track => track.kind === 'audio');
        const rest = tracks.filter(track => track.kind !== 'audio');
        return [...audio, ...rest];
    }

    protected async toggleTimelineTrackFlag(
        track: EditTimelineTrack, field: 'hidden' | 'muted' | 'locked'
    ): Promise<void> {
        const next = field === 'locked' ? !this.isTrackLocked(track.id) : !track[field];
        const label = field === 'locked'
            ? (next ? 'トラックをロック' : 'トラックをロック解除')
            : field === 'hidden'
            ? (next ? 'トラックを非表示に' : 'トラックを表示に')
            : (next ? 'トラックの音声をオフに' : 'トラックの音声をオンに');
        if (field === 'muted') {
            try {
                await this.commitEditMutation(label, doc => setV2TrackFlag(doc, {
                    trackId: track.id, field: 'muted', value: next
                }));
                this.footer.textContent = `${label}しました。`;
            } catch (error) {
                console.warn('[akari-annotations] track mute update failed', error);
                this.footer.textContent = `トラックの音声を編集できません: ${this.errorMessage(error)}`;
            }
            return;
        }
        const editUri = this.location?.editUri;
        if (!editUri) return;
        await this.storage.setData(this.trackFlagStorageKey(editUri, track.id, field), next);
        if (field === 'locked') {
            if (track.id === 'beats') this.beatsLocked = next;
            if (next) this.localLockedTrackIds.add(track.id);
            else this.localLockedTrackIds.delete(track.id);
        }
        this.timelineTracks = this.timelineTracks.map(candidate =>
            candidate.id === track.id ? { ...candidate, [field]: next } : candidate);
        if (field !== 'locked') this.syncTimelineTrackTogglesToPreview();
        this.renderStrip();
        this.footer.textContent = `${label}しました。`;
    }

    protected openTrackContextMenu(event: MouseEvent): void {
        const treeTarget = event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-akari-tree-row-id]') : null;
        if (treeTarget) {
            this.openTimelineClipContextMenu(event, treeTarget);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.closeAnnotationPopup();
        const target = event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-akari-timeline-track-id]') : null;
        const targetId = target?.dataset.akariTimelineTrackId;
        const popup = document.createElement('div');
        Object.assign(popup.style, {
            position: 'fixed', left: `${event.clientX}px`, top: `${event.clientY}px`, zIndex: '10000',
            display: 'flex', flexDirection: 'column', minWidth: '156px', padding: '4px',
            borderRadius: '4px', border: '1px solid var(--theia-widget-border)',
            background: 'var(--theia-menu-background)', boxShadow: '0 3px 12px rgba(0,0,0,.35)'
        });
        const menuButton = (label: string, action: () => void): HTMLButtonElement => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theia-button secondary';
            button.textContent = label;
            button.style.justifyContent = 'flex-start';
            button.addEventListener('click', action);
            return button;
        };
        popup.appendChild(menuButton('トラックを追加', () => {
            popup.replaceChildren();
            const kinds: Array<{ kind: TimelineTrackKind; label: string }> = [
                { kind: 'cuts', label: '映像' },
                { kind: 'captions', label: '字幕' },
                { kind: 'audio', label: 'オーディオ' }
            ];
            for (const option of kinds) {
                // captions は単一トラック維持。audio は R6 契約 §1 裁定 2 により複数トラック可。
                if (option.kind === 'captions' && this.timelineTracks.some(track => track.kind === option.kind)) {
                    continue;
                }
                popup.appendChild(menuButton(option.label, () => {
                    this.closeAnnotationPopup();
                    void this.addTimelineTrack(option.kind);
                }));
            }
        }));
        if (targetId) {
            popup.appendChild(menuButton('トラックを削除', () => {
                this.closeAnnotationPopup();
                void this.deleteTimelineTrack(targetId);
            }));
        }
        popup.addEventListener('contextmenu', popupEvent => popupEvent.preventDefault());
        document.body.appendChild(popup);
        this.contextPopup = popup;
        const close = (outsideEvent: PointerEvent): void => {
            if (!popup.contains(outsideEvent.target as Node)) {
                document.removeEventListener('pointerdown', close, true);
                this.closeAnnotationPopup();
            }
        };
        setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
    }

    protected async addTimelineTrack(kind: TimelineTrackKind): Promise<void> {
        try {
            await this.commitEditMutation('トラックを追加', doc => {
                const tracks = Array.isArray(doc.tracks) ? doc.tracks as Array<Record<string, unknown>> : [];
                if (kind === 'captions') {
                    if (tracks.some(track => 'content' in track)) return doc;
                    const ids = new Set(tracks.map(track => String(track.id ?? '')));
                    let serial = 1;
                    while (ids.has(`captions-${serial}`)) serial++;
                    return { ...doc, tracks: [...tracks, {
                        id: `captions-${serial}`, lane: 'visual', content: { from: 'captions.json' }
                    }] };
                }
                const lane = kind === 'audio' ? 'audio' : 'visual';
                const audioCount = tracks.filter(track => track.lane === 'audio').length;
                return insertV2Track(doc, {
                    index: lane === 'audio' ? audioCount : tracks.length,
                    lane
                });
            });
            this.footer.textContent = 'トラックを追加しました。';
        } catch (error) {
            this.showNotice(`トラックを追加できません: ${this.errorMessage(error)}`);
        }
    }

    protected isTrackLocked(trackId: string | undefined): boolean {
        if (trackId === 'beats') return this.beatsLocked;
        return isTrackLocked(this.timelineTracks, trackId)
            || (trackId !== undefined && this.localLockedTrackIds.has(trackId));
    }

    protected trackIdOfItem(itemId: string): string | undefined {
        const audio = this.audioSfx.find(item => item.id === itemId);
        const narration = this.audioNarration.find(item => item.id === itemId);
        const audioRef = audio ? this.sfxDisplayTrack(audio)
            : narration ? this.narrationDisplayTrack(narration)
                : this.audioBgm?.id === itemId ? this.bgmDisplayTrack(this.audioBgm) : undefined;
        if (audioRef !== undefined) {
            const displayed = this.displayTimelineTracks.find(track => track.kind === 'audio' && track.ref === audioRef);
            if (displayed) return displayed.id;
        }
        const indexed = this.itemLocations.get(itemId)?.trackId;
        if (indexed) return indexed;
        const row = this.expandedTimelineTreeRows.find(candidate => candidate.id === itemId);
        if (row) return row.trackId;
        if (this.captions.some(caption => caption.id === itemId)) {
            return this.captionTreeRow(itemId)?.trackId
                ?? this.displayTimelineTracks.find(track => track.kind === 'captions')?.id;
        }
        return undefined;
    }

    protected trackIdOfSelection(selection: TimelineSelectionItem): string | undefined {
        return this.trackIdOfItem(selection.kind === 'cut' ? this.cutItemId(selection.index) : selection.id);
    }

    protected trackIdOfDrag(detail: DragDetail | DragPreview): string | undefined {
        return this.trackIdOfItem('index' in detail ? this.cutItemId(detail.index) : detail.id);
    }

    protected showLockedTrack(trackId: string | undefined, event?: Event): void {
        const track = this.timelineTracks.find(candidate => candidate.id === trackId)
            ?? this.displayTimelineTracks.find(candidate => candidate.id === trackId);
        const name = trackId === 'beats' ? '見せ場'
            : track?.label || this.computeTrackAutoNames().get(trackId ?? '') || trackId || '';
        this.footer.textContent = lockedTrackMessage(name);
        event?.preventDefault();
    }

    protected applyTrackLockAppearance(): void {
        for (const element of Array.from(this.stripContent.querySelectorAll<HTMLElement>(
            '[data-akari-lane], [data-akari-item-id], [data-akari-beat-id]'
        ))) {
            const selection = this.timelineSelectionFromElement(element);
            const trackId = selection ? this.trackIdOfSelection(selection)
                : element.dataset.akariBeatId !== undefined ? 'beats'
                    : element.dataset.akariItemId ? this.trackIdOfItem(element.dataset.akariItemId) : element.dataset.akariLane;
            element.dataset.akariLocked = String(this.isTrackLocked(trackId));
        }
    }

    protected timelineTrackItemCount(track: EditTimelineTrack): number {
        const raw = Array.isArray(this.editDocument?.tracks)
            ? (this.editDocument!.tracks as Array<Record<string, unknown>>).find(candidate => candidate.id === track.id)
            : undefined;
        return Array.isArray(raw?.items) ? raw.items.length : track.kind === 'captions' ? this.captions.length : 0;
    }

    protected async deleteTimelineTrack(trackId: string): Promise<void> {
        const lockedTrackId = trackId;
        if (this.isTrackLocked(lockedTrackId)) {
            this.showLockedTrack(lockedTrackId);
            return;
        }
        const track = this.timelineTracks.find(candidate => candidate.id === trackId);
        const editUri = this.location?.editUri;
        if (!track || !editUri) {
            return;
        }
        const count = this.timelineTrackItemCount(track);
        if (count === 0) {
            await this.commitEditMutation('トラックを削除', doc => removeV2Track(doc, trackId));
            return;
        }
        if (!window.confirm(`このトラックには ${count} 件のアイテムがあります。削除しますか？`)) {
            return;
        }
        try {
            const editBefore = (await this.fileService.readFile(editUri)).value.toString();
            const captionsBefore = track.kind === 'captions'
                ? (await this.fileService.readFile(this.location!.captionsUri)).value.toString()
                : undefined;
            const editAfter = stringifyEditV2(removeV2Track(JSON.parse(editBefore) as EditV2Document, trackId));
            const captionsAfter = track.kind === 'captions' ? '[]\n' : undefined;
            await this.writeTimelineSnapshots(editAfter, captionsAfter);
            this.pushHistory({
                label: 'トラックを削除',
                undo: async () => {
                    await this.writeTimelineSnapshots(editBefore, captionsBefore);
                    await this.reloadAll();
                },
                redo: async () => {
                    await this.writeTimelineSnapshots(editAfter, captionsAfter);
                    await this.reloadAll();
                }
            });
            await this.reloadAll();
            this.footer.textContent = 'トラックを削除しました。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`トラックを削除できません: ${detail}`);
            this.messages.error(`トラックを削除できません: ${detail}`);
        }
    }

    protected async writeTimelineSnapshots(editSource: string, captionsSource?: string): Promise<void> {
        if (!this.location?.editUri) {
            return;
        }
        // edit.json と captions.json の同時変更は保存後 debounce で最新の組だけ検証される。
        await this.writeEditSnapshotGuarded(editSource, captionsSource);
    }

    protected cutItemId(index: number): string {
        const itemId = this.cutItemIds[index];
        if (!itemId) throw new Error(`クリップ ${index + 1} の id を特定できません。`);
        return itemId;
    }

    protected frameAt(seconds: number): number {
        return Math.max(0, Math.round(seconds * this.fps));
    }

    /** v2 全文を 1 回だけ parse/mutate/stringify し、undo/redo も全文で積む。 */
    protected async commitEditMutation(
        label: string,
        mutate: (doc: EditV2Document) => EditV2Document,
        options?: { reload?: boolean; history?: boolean }
    ): Promise<{ before: string; after: string; result: WriteBackResult }> {
        const editUri = this.location?.editUri;
        if (!editUri) throw new Error('edit.json がありません。');
        const before = (await this.fileService.readFile(editUri)).value.toString();
        const raw = JSON.parse(before) as EditV2Document;
        if (raw.version !== 2) throw new Error('v2 へ変換してから編集してください。');
        const distribution = prepareV2KeyframeDistribution(mutate(raw));
        const after = stringifyEditV2(distribution.document);
        if (after === before) return { before, after, result: { committed: false } };
        const motionChanges = await this.prepareMotionChanges(distribution.writes);
        await this.writeMotionChanges(motionChanges, 'after');
        await this.writeEditSnapshotGuarded(after);
        if (options?.history !== false) {
            this.pushHistory({
                label,
                undo: async () => {
                    await this.writeMotionChanges(motionChanges, 'before');
                    await this.writeEditSnapshotGuarded(before);
                    await this.reloadEdit();
                },
                redo: async () => {
                    await this.writeMotionChanges(motionChanges, 'after');
                    await this.writeEditSnapshotGuarded(after);
                    await this.reloadEdit();
                }
            });
        }
        if (options?.reload !== false) await this.reloadEdit();
        return { before, after, result: { committed: false } };
    }

    protected async prepareMotionChanges(writes: readonly {
        path: string; group: string; itemId: string; points: readonly Record<string, unknown>[];
    }[]): Promise<Array<{ uri: URI; before?: string; after: string }>> {
        if (!this.location?.editUri || writes.length === 0) return [];
        const byPath = new Map<string, typeof writes>();
        for (const write of writes) byPath.set(write.path, [...(byPath.get(write.path) ?? []), write]);
        const changes: Array<{ uri: URI; before?: string; after: string }> = [];
        for (const [path, entries] of byPath) {
            const uri = this.location.editUri.parent.resolve(path);
            let before: string | undefined;
            try {
                before = (await this.fileService.readFile(uri)).value.toString();
            } catch {
                before = undefined;
            }
            const parsed = before ? JSON.parse(before) as Record<string, any> : {
                version: 0, group: entries[0].group, items: {}
            };
            parsed.version = 0;
            parsed.group = entries[0].group;
            if (!parsed.items || typeof parsed.items !== 'object' || Array.isArray(parsed.items)) parsed.items = {};
            for (const entry of entries) parsed.items[entry.itemId] = entry.points;
            changes.push({ uri, ...(before === undefined ? {} : { before }), after: serializeMotion(parsed) });
        }
        return changes;
    }

    protected async writeMotionChanges(
        changes: readonly { uri: URI; before?: string; after: string }[],
        side: 'before' | 'after'
    ): Promise<void> {
        for (const change of changes) {
            const source = side === 'after' ? change.after : change.before;
            if (source === undefined) {
                try {
                    await this.fileService.delete(change.uri);
                } catch {
                    // undo 対象の袋が既に無い場合は完了済みとして扱う。
                }
                continue;
            }
            await this.fileService.createFolder(change.uri.parent);
            await this.fileService.writeFile(change.uri, BinaryBuffer.fromString(source));
        }
    }

    /** v2 の整形を保つテキスト手術を 1 履歴として保存する。 */
    protected async commitEditTextMutation(
        label: string,
        mutate: (text: string) => string,
        options?: { reload?: boolean; history?: boolean }
    ): Promise<{ before: string; after: string; result: WriteBackResult }> {
        const editUri = this.location?.editUri;
        if (!editUri) throw new Error('edit.json がありません。');
        const before = (await this.fileService.readFile(editUri)).value.toString();
        const raw = JSON.parse(before) as EditV2Document;
        if (raw.version !== 2) throw new Error('v2 へ変換してから編集してください。');
        const after = mutate(before);
        if (after === before) return { before, after, result: { committed: false } };
        await this.writeEditSnapshotGuarded(after);
        if (options?.history !== false) {
            this.pushHistory({
                label,
                undo: async () => {
                    await this.writeEditSnapshotGuarded(before);
                    await this.reloadEdit();
                },
                redo: async () => {
                    await this.writeEditSnapshotGuarded(after);
                    await this.reloadEdit();
                }
            });
        }
        if (options?.reload !== false) await this.reloadEdit();
        return { before, after, result: { committed: false } };
    }

    /**
     * FileService 直書きの置き換え: 全文スナップショットも RPC 経由で atomic 保存し、
     * lint は保存後 debounce で実行する。失敗時は client 通知が undo 導線を表示する。
     */
    protected async writeEditSnapshotGuarded(editSource?: string, captionsSource?: string): Promise<void> {
        const location = this.location;
        if (!location?.editUri) {
            throw new Error('edit.json がありません。');
        }
        await this.annotationsService.writeEditSnapshot({
            editUri: location.editUri.toString(),
            projectRootUri: location.root.toString(),
            ...(editSource !== undefined ? { editSource } : {}),
            ...(captionsSource !== undefined
                ? { captionsUri: location.captionsUri.toString(), captionsSource } : {})
        });
    }

    protected trackHeaderButton(
        label: string,
        toggle: 'visibility' | 'mute' | 'lock',
        enabled: boolean,
        svg: string,
        action: () => void
    ): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'akari-track-header-button';
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(enabled));
        button.dataset.akariToggle = toggle;
        if (toggle === 'lock') button.dataset.akariFlag = 'lock';
        button.innerHTML = svg;
        button.addEventListener('click', event => {
            event.stopPropagation();
            action();
        });
        return button;
    }

    protected eyeSvg(): string {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
    }

    protected lockSvg(): string {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3"/></svg>';
    }

    protected speakerSvg(): string {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
    }

    protected trackKindSvg(kind: 'video' | 'overlay' | 'layer' | 'audio' | 'caption' | 'beat'): string {
        switch (kind) {
            case 'video':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3Z"/></svg>';
            case 'overlay':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h7"/></svg>';
            case 'layer':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>';
            case 'audio':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>';
            case 'caption':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M7 14h3M13 10h4M12 14h5"/></svg>';
            case 'beat':
                return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/></svg>';
        }
    }

    protected dispatchPreviewEvent(type: string, detail: Record<string, unknown>): void {
        window.dispatchEvent(new CustomEvent(type, {
            detail: { editUri: this.location?.editUri?.toString() ?? '', ...detail }
        }));
    }

    protected syncTimelineTrackTogglesToPreview(): void {
        const refsWhere = (kind: 'cuts' | 'layers' | 'audio', field: 'hidden' | 'muted'): number[] =>
            this.timelineTracks.filter(t => t.kind === kind && t[field]).map(t => t.ref ?? 0);
        this.dispatchPreviewEvent(TIMELINE_SYNC_TRACK_TOGGLES_EVENT, {
            cuts: { hidden: refsWhere('cuts', 'hidden'), muted: refsWhere('cuts', 'muted') },
            layers: { hidden: refsWhere('layers', 'hidden'), muted: refsWhere('layers', 'muted') },
            audio: { muted: refsWhere('audio', 'muted') }
        });
    }

    protected renderRuler(): void {
        const ticks = this.computeRulerTicks(this.viewStart, this.visibleDuration(), this.fps);
        for (const tick of ticks) {
            const percent = this.layoutPercent(tick.time);
            const tickKey = Number(tick.time.toFixed(9));
            const { element: tickLine } = this.keyedNode(
                'ruler', `tick:${tickKey}:line`, tick.label, () => document.createElement('div')
            );
            Object.assign(tickLine.style, {
                position: 'absolute', top: '0', height: `${RULER_BAND_HEIGHT_PX}px`, width: '1px',
                left: `${percent}%`, background: RULER_TICK_COLOR, pointerEvents: 'none', zIndex: '1'
            });
            const { element: label } = this.keyedNode(
                'ruler', `tick:${tickKey}:label`, tick.label, () => document.createElement('div')
            );
            label.textContent = tick.label;
            Object.assign(label.style, {
                position: 'absolute', top: '0', height: `${RULER_BAND_HEIGHT_PX}px`, left: `${percent}%`,
                color: 'var(--theia-descriptionForeground)', fontSize: '9px', lineHeight: `${RULER_BAND_HEIGHT_PX - 1}px`,
                fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: '2',
                paddingLeft: '2px',
                transform: percent <= 2 ? 'none' : percent >= 98 ? 'translateX(-100%)' : 'translateX(-50%)'
            });
        }
        this.renderAnnotationPins();
    }

    /**
     * 秒モード刻み候補（[0.5,1,2,5,10,15,30,60,120,300,600]）から「刻み×px/秒 >= 80px」を満たす
     * 最小の刻みを採用する。1 フレームが 4px 以上に見える高ズームではフレームモード（MM:SS:FF）に切り替える。
     */
    protected computeRulerTicks(viewStart: number, duration: number, fps: number): Array<{ time: number; label: string }> {
        const pxPerSecond = duration > 0 && this.stripLayoutWidthPx > 0
            ? this.stripLayoutWidthPx / duration : 0;
        if (duration <= 0 || pxPerSecond <= 0) {
            return [{ time: viewStart, label: this.formatRulerTimestamp(Math.max(0, viewStart)) }];
        }
        const frameDuration = 1 / fps;
        const frameMode = pxPerSecond * frameDuration >= 4;
        const step = frameMode
            ? this.niceStepFromCandidates(RULER_STEP_MULTIPLIERS_FRAMES.map(frames => frames * frameDuration), pxPerSecond)
            : this.niceStepFromCandidates(RULER_STEP_SECONDS, pxPerSecond);
        const tickRangeStart = viewStart - duration * 0.6;
        const tickRangeEnd = viewStart + duration * 1.6;
        const startIndex = Math.ceil((tickRangeStart - step * 1e-6) / step);
        const endIndex = Math.floor((tickRangeEnd + step * 1e-6) / step);
        const ticks: Array<{ time: number; label: string }> = [];
        for (let index = startIndex; index <= endIndex; index++) {
            const time = index * step;
            ticks.push({ time, label: this.formatTickLabel(time, fps, frameMode) });
        }
        if (ticks.length === 0) {
            ticks.push({ time: viewStart, label: this.formatTickLabel(viewStart, fps, frameMode) });
        }
        return ticks;
    }

    protected niceStepFromCandidates(candidates: readonly number[], pxPerSecond: number): number {
        const sorted = [...candidates].filter(candidate => candidate > 0).sort((a, b) => a - b);
        for (const step of sorted) {
            if (step * pxPerSecond >= RULER_MIN_TICK_SPACING_PX) {
                return step;
            }
        }
        return sorted[sorted.length - 1];
    }

    protected formatTickLabel(time: number, fps: number, frameMode: boolean): string {
        const clamped = Math.max(0, time);
        return frameMode ? this.formatFrameTimestamp(clamped, fps) : this.formatRulerTimestamp(clamped);
    }

    protected formatFrameTimestamp(value: number, fps: number): string {
        const totalFrames = Math.round(value * fps);
        const wholeSeconds = Math.floor(totalFrames / fps);
        const frame = totalFrames % fps;
        const minutes = Math.floor(wholeSeconds / 60);
        const seconds = wholeSeconds % 60;
        const frameDigits = String(Math.max(1, fps - 1)).length;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frame).padStart(frameDigits, '0')}`;
    }

    /**
     * 注釈ピンをルーラー帯の下端へ描く。専用レーンを 1 行使わず、時刻の目盛りと同じ帯に収める。
     * クリックでその時刻へシークし、注釈パネル側の該当行を目立たせる。
     */
    protected renderAnnotationPins(): void {
        for (const annotation of this.annotations) {
            const { element: pin, created } = this.keyedNode(
                'ruler', `pin:${annotation.id}`, JSON.stringify(annotation), () => document.createElement('div')
            );
            pin.className = 'akari-annotations-pin';
            pin.title = `${this.formatTimestamp(annotation.sourceT)} ${annotation.text}`;
            pin.setAttribute('data-annotation-id', annotation.id);
            pin.setAttribute('data-annotation-status', annotation.status);
            pin.style.left = `${this.layoutPercent(this.sourceToOutput(annotation.sourceT))}%`;
            pin.style.background = STATUS_COLORS[annotation.status];
            if (created) pin.addEventListener('click', event => {
                event.stopPropagation();
                this.selectedSourceT = annotation.sourceT;
                this.renderStrip();
                void this.requestSeek(annotation.sourceT);
                this.review.reveal(annotation.id);
                void this.commands.executeCommand(OPEN_AKARI_REVIEW_PANEL_ID);
            });
        }
    }

    protected isRangeVisible(start: number, end: number): boolean {
        const viewEnd = this.viewStart + this.visibleDuration();
        return end > this.viewStart && start < viewEnd;
    }

    protected isRangeMounted(start: number, end: number): boolean {
        // 描画ループでアイテム数ぶん totalDuration を再計算しないため、確定済みのアンカー窓を使う。
        const duration = this.layoutViewDuration > 0 ? this.layoutViewDuration : this.visibleDuration();
        const viewStart = this.layoutViewDuration > 0 ? this.layoutViewStart : this.viewStart;
        return rangeIsMounted(start, end, viewStart, duration);
    }

    protected captionLabel(text: string): HTMLDivElement {
        const label = document.createElement('div');
        label.className = 'akari-annotations-strip-caption-text';
        label.textContent = text;
        label.title = text;
        return label;
    }

    protected renderClipMedia(
        element: HTMLDivElement, cut: EditCut, clipWidth: number, segment: OutputSegment, trackHeightPx: number
    ): void {
        const videoUri = this.cutVideoUri(cut);
        // コンパクトティア（trackHeightPx < MIN_TRACK_HEIGHT_FOR_MEDIA_PX）はフィルムストリップ・波形を
        // 描かない薄い帯にする（幅の MIN_CLIP_WIDTH_FOR_MEDIA_PX ゲートと同列の高さゲート）。
        if (clipWidth < MIN_CLIP_WIDTH_FOR_MEDIA_PX || trackHeightPx < MIN_TRACK_HEIGHT_FOR_MEDIA_PX || !videoUri) {
            return;
        }
        // フィルムストリップと波形を同じ写像（clipLocalOffsetPx / fullClipWidthPx）で
        // 位置合わせするため、ジオメトリはここで 1 回だけ計算して両方へ渡す。
        const geometry = this.clipLocalGeometry(segment);
        if (geometry) {
            this.clipMediaGeometries.set(element, { clipWidth, ...geometry, trackHeightPx });
            this.clipMediaRevisions.set(element, this.filmstripContentRevision);
            const filmstripStatus = this.renderFilmstripCells(element, clipWidth, segment, videoUri, geometry, trackHeightPx);
            if (filmstripStatus === 'all-unavailable') {
                // 可視範囲に必要な全チャンクが失敗した（ffmpeg 不在等）場合のみ、
                // 旧来の単一フレーム背景へ劣化する。
                this.renderSingleFrameFallback(element, cut, videoUri);
            }
        }

        const key = `${cut.src ?? ''}:${cut.in}:${cut.out}`;
        const waveform = this.waveformCache.get(key);
        if (Array.isArray(waveform)) {
            if (geometry) {
                element.appendChild(this.waveformCanvas(waveform, clipWidth, geometry, trackHeightPx));
            }
        } else if (waveform === undefined) {
            this.fetchWaveform(key, cut, videoUri);
        }
    }

    /**
     * keyed 差分で保持した通常表示 clip のメディア幾何だけを更新する。
     * ビュー内に収まった clip はパンしてもこの 4 値が変わらないため何もしない。
     */
    protected updateClipMediaGeometry(
        element: HTMLDivElement, cut: EditCut, clipWidth: number, segment: OutputSegment, trackHeightPx: number
    ): void {
        if (clipWidth < MIN_CLIP_WIDTH_FOR_MEDIA_PX || trackHeightPx < MIN_TRACK_HEIGHT_FOR_MEDIA_PX) {
            return;
        }
        // ゲート境界や chunk 到着時は cutSignature が変わり、created 側の renderClipMedia が走る。
        // 既存メディアノードが無い clip はレイアウト幾何を読む必要がない。
        const filmstrip = element.querySelector<HTMLDivElement>(
            ':scope > .akari-annotations-strip-clip-filmstrip'
        );
        const canvas = element.querySelector<HTMLCanvasElement>(':scope > canvas');
        if (!filmstrip && !canvas) {
            return;
        }
        const videoUri = this.cutVideoUri(cut);
        if (!videoUri) {
            return;
        }
        const geometry = this.clipLocalGeometry(segment);
        if (!geometry) {
            return;
        }
        const next = { clipWidth, ...geometry, trackHeightPx };
        const previous = this.clipMediaGeometries.get(element);
        // チャンク / サムネイル到着（filmstripContentRevision）は署名に入れないので、再利用ノードは
        // ここで「最後に描いたリビジョン」との差でセルだけ描き直す。
        const contentStale = this.clipMediaRevisions.get(element) !== this.filmstripContentRevision;
        if (previous && sameClipMediaGeometry(previous, next) && !contentStale) {
            return;
        }
        this.clipMediaGeometries.set(element, next);
        this.clipMediaRevisions.set(element, this.filmstripContentRevision);

        const filmstripStatus = this.renderFilmstripCells(
            element, clipWidth, segment, videoUri, geometry, trackHeightPx
        );
        if (filmstripStatus === 'all-unavailable') {
            this.renderSingleFrameFallback(element, cut, videoUri);
        }

        const waveform = this.waveformCache.get(`${cut.src ?? ''}:${cut.in}:${cut.out}`);
        if (Array.isArray(waveform) && canvas) {
            this.updateWaveformCanvas(canvas, waveform, clipWidth, geometry, trackHeightPx);
        }
    }

    protected renderSingleFrameFallback(element: HTMLDivElement, cut: EditCut, videoUri: string): void {
        const key = `${cut.src ?? ''}:${cut.in}:${cut.out}`;
        const thumbnail = this.thumbnailCache.get(key);
        if (typeof thumbnail === 'string' && thumbnail !== 'pending' && thumbnail !== 'unavailable') {
            element.style.backgroundImage = `url(${thumbnail})`;
            element.style.backgroundSize = 'cover';
            element.style.backgroundPosition = 'center';
        } else if (thumbnail === undefined) {
            this.fetchThumbnail(key, cut, videoUri);
        }
    }

    /**
     * strip 自体が viewStart/viewDuration の「窓」でズームを表現する構成のため
     * （絶対キャンバス + ネイティブ横スクロールではない）clip の「画面上の見かけの全幅」
     * （fullClipWidthPx）はビューの外まで含めた理論値になりうる。可視部分だけが
     * clipWidth（呼び出し側で layoutPercent() によって [-60,160]% にクランプ済み）として渡って
     * くるため、画面外に切れている「まだ見えていない先頭部分」の量が clipLocalOffsetPx。
     * フィルムストリップのセル・波形の両方がこれを使って同じ位置合わせをする。
     */
    protected clipLocalGeometry(
        segment: OutputSegment
    ): { fullClipWidthPx: number; clipLocalOffsetPx: number } | undefined {
        const outputDuration = segment.tlEnd - segment.tlStart;
        const stripWidth = this.stripLayoutWidthPx > 0 ? this.stripLayoutWidthPx : this.strip.clientWidth;
        const viewDuration = this.layoutViewDuration > 0 ? this.layoutViewDuration : this.visibleDuration();
        const layoutStart = this.layoutViewDuration > 0 ? this.layoutViewStart : this.viewStart;
        if (!(outputDuration > 0) || !(stripWidth > 0) || !(viewDuration > 0)) {
            return undefined;
        }
        const pxPerSecond = stripWidth / viewDuration;
        return {
            fullClipWidthPx: outputDuration * pxPerSecond,
            clipLocalOffsetPx: Math.max(
                0,
                (layoutStart - 0.6 * viewDuration) - segment.tlStart
            ) * pxPerSecond
        };
    }

    /**
     * atlas はソース時間の固定グリッド（FILMSTRIP_CHUNK_SECONDS 単位）でチャンク分割
     * されている。この clip の表示区間 [segment.in, segment.out] を均等割りして代表
     * フレームの sourceT を求め、可視幅ぶんだけセルを生成する。各セルが属するチャンクは
     * 未取得なら遅延フェッチする（可視セルに重なるチャンクだけ・全長の事前生成はしない）。
     * ズーム/スクロールで再計算されるのは CSS の位置だけで、既に取得済みのチャンクは
     * 再取得しない（filmstripChunkCache のキーが videoUri+chunkIndex のため）。
     *
     * strip 自体が viewStart/viewDuration の「窓」でズームを表現する構成のため
     * （絶対キャンバス + ネイティブ横スクロールではない）、この widget では 1 clip の
     * DOM 要素幅は最大でも strip 表示幅を超えない。旧版 ClipFilmstrip の
     * visibleMinPx/visibleMaxPx culling に相当する処理は、クリップの「まだ画面外の
     * 先頭部分」を clipLocalOffsetPx で除外することで実現する。
     *
     * 戻り値: 可視範囲に重なる全チャンクが 'unavailable'（ffmpeg 不在等）だった場合のみ
     * 'all-unavailable'（呼び出し側が単一フレームへ降格する合図）。1 つでも ready/pending
     * があれば 'ok'（一部のセルが空白のまま、というのは許容する）。
     */
    protected renderFilmstripCells(
        element: HTMLDivElement, clipWidth: number, segment: OutputSegment, videoUri: string,
        geometry: { fullClipWidthPx: number; clipLocalOffsetPx: number }, clipHeightPx: number
    ): 'ok' | 'all-unavailable' {
        const sourceSpan = segment.out - segment.in;
        const { fullClipWidthPx, clipLocalOffsetPx } = geometry;
        if (!(sourceSpan > 0) || !(fullClipWidthPx > 0)) {
            return 'ok';
        }

        // セル幅はターゲット幅（36px 目安）固定。clip 全長（画面外を含む）を等分した
        // ときの理論上のセル数は totalCellCount になるが、実際に DOM へ作るのは
        // 可視範囲（i0..i1、後述の culling）ぶんだけなので、高倍率ズームで
        // totalCellCount 自体が巨大になっても cellWidthPx は目標値のまま保たれ、
        // 密度がズームに追随する（キャップで丸めて粗くならない）。
        const cellWidthPx = FILMSTRIP_TARGET_CELL_WIDTH_PX;
        const totalCellCount = Math.max(1, Math.round(fullClipWidthPx / cellWidthPx));

        const visibleStartLocalPx = clipLocalOffsetPx;
        const visibleEndLocalPx = clipLocalOffsetPx + clipWidth;
        const i0 = Math.max(0, Math.floor(visibleStartLocalPx / cellWidthPx));
        let i1 = Math.min(totalCellCount - 1, Math.ceil(visibleEndLocalPx / cellWidthPx) - 1);
        if (i1 < i0) {
            return 'ok';
        }
        // 暴走防止の安全弁（通常は clipWidth <= strip 幅なのでここには届かない）。
        if (i1 - i0 + 1 > FILMSTRIP_MAX_CELLS_PER_CLIP) {
            i1 = i0 + FILMSTRIP_MAX_CELLS_PER_CLIP - 1;
        }

        let wrapper = element.querySelector<HTMLDivElement>(':scope > .akari-annotations-strip-clip-filmstrip');
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'akari-annotations-strip-clip-filmstrip';
            element.appendChild(wrapper);
        }
        Object.assign(wrapper.style, {
            position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none'
        });

        const cells = Array.from(wrapper.children) as HTMLDivElement[];
        let renderedCellCount = 0;
        let sawReadyOrPending = false;
        let sawUnavailable = false;
        for (let i = i0; i <= i1; i++) {
            const sourceT = segment.in + ((i + 0.5) / totalCellCount) * sourceSpan;
            const chunkIndex = filmstripChunkIndexFor(sourceT);
            const chunk = this.ensureFilmstripChunk(videoUri, chunkIndex);
            if (chunk === 'unavailable') {
                sawUnavailable = true;
                continue;
            }
            if (chunk === 'pending') {
                sawReadyOrPending = true;
                continue;
            }
            sawReadyOrPending = true;
            if (chunk.frameWidth <= 0 || chunk.frameHeight <= 0 || chunk.frameCount <= 0) {
                continue;
            }
            const localSourceT = sourceT - chunk.chunkStartSeconds;
            const frameIdx = Math.min(chunk.frameCount - 1, Math.max(0, Math.round(localSourceT * chunk.fps)));
            const col = frameIdx % chunk.cols;
            const row = Math.floor(frameIdx / chunk.cols);

            // cover スケール: frame 全体が cellWidthPx x clipHeightPx（この track の高さティア）
            // を覆う最小倍率（大きい方の軸に合わせ、はみ出す方をセル中央基準でクロップする）。
            // frameWidth/frameHeight は素材単位で不変のためチャンクをまたいでも一致するが、
            // cols/rows/atlasUri はチャンクごとに異なるため、この計算はセル単位で行う。
            const scale = Math.max(cellWidthPx / chunk.frameWidth, clipHeightPx / chunk.frameHeight);
            const frameScaledW = chunk.frameWidth * scale;
            const frameScaledH = chunk.frameHeight * scale;
            const cropOffsetX = (frameScaledW - cellWidthPx) / 2;
            const cropOffsetY = (frameScaledH - clipHeightPx) / 2;
            const backgroundSize = `${chunk.cols * frameScaledW}px ${chunk.rows * frameScaledH}px`;

            let cell = cells[renderedCellCount];
            if (!cell) {
                cell = document.createElement('div');
                cell.className = 'akari-annotations-strip-clip-filmstrip-cell';
                wrapper.appendChild(cell);
                cells.push(cell);
            }
            Object.assign(cell.style, {
                position: 'absolute',
                left: `${i * cellWidthPx - clipLocalOffsetPx}px`,
                top: '0',
                width: `${cellWidthPx}px`,
                height: '100%',
                backgroundImage: `url(${chunk.atlasUri})`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: `${-(col * frameScaledW) - cropOffsetX}px ${-(row * frameScaledH) - cropOffsetY}px`,
                backgroundSize
            });
            renderedCellCount++;
        }
        while (cells.length > renderedCellCount) {
            cells.pop()?.remove();
        }
        return sawUnavailable && !sawReadyOrPending ? 'all-unavailable' : 'ok';
    }

    /**
     * ソーストリマー（R6c2r2・外側延長方式）: クリップ本体は通常表示と完全に同一
     * （renderClipMedia をそのまま呼ぶ・位置/幅/スケールとも通常表示と不変）。
     * その左右に「in より前」「out より後」の素材区間を、本体と同一の px/秒スケールで
     * ウィングとして延長描画する（減光 opacity .35・隣接クリップの上へ重ねる z 上位）。
     * atlas は ensureFilmstripChunk（T2/T3 と同じ videoUri+chunkIndex キャッシュ）を
     * そのまま再利用するため、トリマーを開いただけでは再焼成は発生しない。
     */
    protected renderTrimmerClip(
        element: HTMLDivElement, cut: EditCut, clipWidth: number, segment: OutputSegment,
        trackHeightPx: number, videoUri: string, sourceDuration: number | undefined
    ): void {
        element.classList.add('akari-annotations-strip-clip-trimmer-active');
        const content = document.createElement('div');
        content.className = 'akari-annotations-strip-clip-trimmer-content';
        element.appendChild(content);
        this.renderClipMedia(content, cut, clipWidth, segment, trackHeightPx);
        if (sourceDuration === undefined || !(sourceDuration > 0)) {
            return;
        }
        const geometry = this.clipLocalGeometry(segment);
        const sourceSpan = cut.out - cut.in;
        if (!geometry || !(geometry.fullClipWidthPx > 0) || !(sourceSpan > 0)) {
            return;
        }
        const { fullClipWidthPx, clipLocalOffsetPx } = geometry;
        const cellWidthPx = FILMSTRIP_TARGET_CELL_WIDTH_PX;
        const totalCellCount = Math.max(1, Math.round(fullClipWidthPx / cellWidthPx));
        const perCellSourceSeconds = sourceSpan / totalCellCount;
        // slip ドラッグ中のライブプレビュー（updateTrimmerSlipVisual）が使う px/秒スケール。
        content.dataset.pxPerSourceSecond = String(cellWidthPx / perCellSourceSeconds);
        const maxWingCells = Math.max(1, Math.floor(TRIMMER_WING_MAX_WIDTH_PX / cellWidthPx));

        // 左ウィング（in より前）: クリップの真の左端がスクロールで画面外に隠れていない
        // ときだけ描く（隠れている場合、その左に更に伸ばしても見えないため無駄がない）。
        if (clipLocalOffsetPx <= 0.5 && cut.in > 0) {
            const cellCount = Math.min(maxWingCells, Math.floor(cut.in / perCellSourceSeconds));
            if (cellCount > 0) {
                const wingWidthPx = cellCount * cellWidthPx;
                const wing = this.createTrimmerWingElement(wingWidthPx, 'left');
                wing.style.left = `${-wingWidthPx}px`;
                for (let k = 0; k < cellCount; k++) {
                    // k=0 がクリップ本体に最も近いセル（in の直前のフレーム）。
                    const sourceT = cut.in - (k + 0.5) * perCellSourceSeconds;
                    const cellLeftPx = wingWidthPx - (k + 1) * cellWidthPx;
                    this.appendTrimmerWingCell(wing, videoUri, trackHeightPx, cellWidthPx, cellLeftPx, sourceT);
                }
                content.appendChild(wing);
            }
        }
        // 右ウィング（out より後）: 真の右端が可視のときだけ描く。
        const rightEdgeVisible = clipLocalOffsetPx + clipWidth >= fullClipWidthPx - 0.5;
        if (rightEdgeVisible && sourceDuration - cut.out > 0) {
            const cellCount = Math.min(maxWingCells, Math.floor((sourceDuration - cut.out) / perCellSourceSeconds));
            if (cellCount > 0) {
                const wingWidthPx = cellCount * cellWidthPx;
                const wing = this.createTrimmerWingElement(wingWidthPx, 'right');
                wing.style.left = `${fullClipWidthPx - clipLocalOffsetPx}px`;
                for (let k = 0; k < cellCount; k++) {
                    // k=0 がクリップ本体に最も近いセル（out の直後のフレーム）。
                    const sourceT = cut.out + (k + 0.5) * perCellSourceSeconds;
                    const cellLeftPx = k * cellWidthPx;
                    this.appendTrimmerWingCell(wing, videoUri, trackHeightPx, cellWidthPx, cellLeftPx, sourceT);
                }
                content.appendChild(wing);
            }
        }
    }

    /**
     * 音声クリップ版 renderTrimmerClip（task 2026-08-18-audio-clip-trimmer-dblclick）。動画クリップの
     * フィルムストリップ atlas の代わりに、通常の SFX 波形と同じ全域キャッシュ
     * （`sfxwave:${path}`、[0, 実尺) を 1 回だけ取得済み）を in より前 / out より後の区間にも
     * 適用し、「まだ使っていない部分」を波形の減光表示として描く。ウィングのコンテナ
     * （createTrimmerWingElement）とスリップ視覚更新（updateTrimmerSlipVisual と同型の
     * updateAudioTrimmerSlipVisual）は動画クリップ側とそのまま共有する。
     *
     * px/秒スケールは動画クリップと異なりクリップ自身の barWidthPx / 尺からではなく、
     * strip 全体の px/秒（updateDragPreview の delta 計算と同じ基準）を使う — 音声バーは
     * 横スクロールでクリップ本体の左端が隠れていても percent() が [0,100] にクランプされる
     * ため、barWidthPx 自身が「見えている分だけ」に縮んでしまう（動画クリップの
     * clipLocalGeometry のような「隠れている先頭量」の補正が無い）。真の左端/右端が可視の
     * ときだけウィングを描くガード（下記）と組み合わせることで、ウィングの位置合わせが
     * ズレない。
     */
    protected renderAudioTrimmerClip(
        element: HTMLDivElement, sfx: EditAudioSfxWithFade, barWidthPx: number, itemHeightPx: number,
        inSeconds: number, outSeconds: number, sourceDuration: number | undefined
    ): void {
        element.classList.add('akari-annotations-strip-clip-trimmer-active');
        const content = document.createElement('div');
        content.className = 'akari-annotations-strip-clip-trimmer-content';
        element.appendChild(content);
        const speed = sfx.speed !== undefined && sfx.speed > 0 ? sfx.speed : 1;
        const displayDurationSec = Math.max(0, outSeconds - inSeconds) / speed;
        this.updateSfxWaveform(
            content, sfx, barWidthPx, itemHeightPx,
            { startSec: inSeconds, endSec: outSeconds }, sourceDuration, displayDurationSec
        );
        if (sourceDuration === undefined || !(sourceDuration > 0)) {
            return;
        }
        const sourceWindowDuration = outSeconds - inSeconds;
        const stripWidth = this.stripLayoutWidthPx > 0 ? this.stripLayoutWidthPx : this.strip.clientWidth;
        const viewDuration = this.layoutViewDuration > 0 ? this.layoutViewDuration : this.visibleDuration();
        const pxPerSourceSecond = viewDuration > 0 ? stripWidth / viewDuration / speed : 0;
        if (!(pxPerSourceSecond > 0) || !(sourceWindowDuration > 0)) {
            return;
        }
        // slip ドラッグ中のライブプレビュー（updateAudioTrimmerSlipVisual）が使う px/秒スケール。
        content.dataset.pxPerSourceSecond = String(pxPerSourceSecond);
        const fullPeaks = this.waveformCache.get(`sfxwave:${sfx.path}`);
        const viewEnd = this.viewStart + this.visibleDuration();
        const trueEnd = sfx.t + displayDurationSec;
        // 左ウィング（in より前）: バー本体の真の左端（sfx.t）がスクロールで画面外に隠れていない
        // ときだけ描く（動画クリップの clipLocalOffsetPx ガードと同じ意図・上記コメント参照）。
        if (sfx.t >= this.viewStart - 1e-6 && inSeconds > 0) {
            const wingSeconds = Math.min(inSeconds, TRIMMER_WING_MAX_WIDTH_PX / pxPerSourceSecond);
            const wingWidthPx = wingSeconds * pxPerSourceSecond;
            if (wingWidthPx > 0.5) {
                const wing = this.createTrimmerWingElement(wingWidthPx, 'left');
                wing.style.left = `${-wingWidthPx}px`;
                if (Array.isArray(fullPeaks)) {
                    const startSec = inSeconds - wingSeconds;
                    this.updateAudioWaveformCanvas(
                        wing, fullPeaks, `wing:${sfx.path}:${startSec}:${inSeconds}:${sourceDuration}`,
                        () => this.sfxWaveformSlice(fullPeaks, startSec, inSeconds, sourceDuration),
                        itemHeightPx, {
                            canvasLeftPx: 0, canvasWidthPx: wingWidthPx,
                            waveformFullWidthPx: wingWidthPx, waveformOffsetPx: 0
                        }
                    );
                }
                content.appendChild(wing);
            }
        }
        // 右ウィング（out より後）: 真の右端が可視のときだけ描く。
        if (trueEnd <= viewEnd + 1e-6 && sourceDuration - outSeconds > 0) {
            const wingSeconds = Math.min(sourceDuration - outSeconds, TRIMMER_WING_MAX_WIDTH_PX / pxPerSourceSecond);
            const wingWidthPx = wingSeconds * pxPerSourceSecond;
            if (wingWidthPx > 0.5) {
                const wing = this.createTrimmerWingElement(wingWidthPx, 'right');
                wing.style.left = `${barWidthPx}px`;
                if (Array.isArray(fullPeaks)) {
                    const endSec = outSeconds + wingSeconds;
                    this.updateAudioWaveformCanvas(
                        wing, fullPeaks, `wing:${sfx.path}:${outSeconds}:${endSec}:${sourceDuration}`,
                        () => this.sfxWaveformSlice(fullPeaks, outSeconds, endSec, sourceDuration),
                        itemHeightPx, {
                            canvasLeftPx: 0, canvasWidthPx: wingWidthPx,
                            waveformFullWidthPx: wingWidthPx, waveformOffsetPx: 0
                        }
                    );
                }
                content.appendChild(wing);
            }
        }
    }

    /** ウィング（延長表示）のコンテナ要素。外側の端をフェードアウトさせるマスクを掛ける。 */
    protected createTrimmerWingElement(widthPx: number, side: 'left' | 'right'): HTMLDivElement {
        const wing = document.createElement('div');
        wing.className = 'akari-annotations-strip-clip-wing';
        const fade = side === 'left'
            ? 'linear-gradient(to right, transparent 0%, black 32px)'
            : 'linear-gradient(to left, transparent 0%, black 32px)';
        Object.assign(wing.style, { width: `${widthPx}px`, maskImage: fade, WebkitMaskImage: fade });
        return wing;
    }

    /** ウィング 1 セル分の atlas フレームを敷く（renderFilmstripCells のセル描画と同一の計算）。 */
    protected appendTrimmerWingCell(
        wing: HTMLDivElement, videoUri: string, trackHeightPx: number, cellWidthPx: number,
        cellLeftPx: number, sourceT: number
    ): void {
        const chunkIndex = filmstripChunkIndexFor(sourceT);
        const chunk = this.ensureFilmstripChunk(videoUri, chunkIndex);
        if (chunk === 'unavailable' || chunk === 'pending') {
            return;
        }
        if (chunk.frameWidth <= 0 || chunk.frameHeight <= 0 || chunk.frameCount <= 0) {
            return;
        }
        const localSourceT = sourceT - chunk.chunkStartSeconds;
        const frameIdx = Math.min(chunk.frameCount - 1, Math.max(0, Math.round(localSourceT * chunk.fps)));
        const col = frameIdx % chunk.cols;
        const row = Math.floor(frameIdx / chunk.cols);
        const scale = Math.max(cellWidthPx / chunk.frameWidth, trackHeightPx / chunk.frameHeight);
        const frameScaledW = chunk.frameWidth * scale;
        const frameScaledH = chunk.frameHeight * scale;
        const cropOffsetX = (frameScaledW - cellWidthPx) / 2;
        const cropOffsetY = (frameScaledH - trackHeightPx) / 2;
        const backgroundSize = `${chunk.cols * frameScaledW}px ${chunk.rows * frameScaledH}px`;
        const cell = document.createElement('div');
        Object.assign(cell.style, {
            position: 'absolute',
            left: `${cellLeftPx}px`,
            top: '0',
            width: `${cellWidthPx}px`,
            height: '100%',
            backgroundImage: `url(${chunk.atlasUri})`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: `${-(col * frameScaledW) - cropOffsetX}px ${-(row * frameScaledH) - cropOffsetY}px`,
            backgroundSize
        });
        wing.appendChild(cell);
    }

    /**
     * トリマーモード中のクリップ本体へのドラッグ配線。既存 installDragListeners と
     * ほぼ同型だが、中央ドラッグが 'cut-move'（移動）ではなく 'cut-slip'（スリップ）に
     * なる点と、ドラッグなしのダブルクリックが「トリマーモードの解除」になる点
     * （通常クリップは逆に「入場」）が異なる。窓は素材全体ではなくクリップ本体そのもの
     * （通常表示と同一の位置・幅）なので、専用の縮尺（旧 trimmerPxPerSec）は不要 —
     * updateDragPreview の通常経路（strip 全体の px/秒）がそのまま使える。
     */
    protected installTrimmerDrag(
        element: HTMLDivElement,
        detail: (event: PointerEvent, rect: DOMRect) => DragDetail
    ): void {
        this.trimmerListenerDetails.set(element, detail);
        if (this.trimmerListenerInstalled.has(element)) return;
        this.trimmerListenerInstalled.add(element);
        element.style.pointerEvents = 'auto';
        element.style.touchAction = 'none';
        element.addEventListener('click', event => event.stopPropagation());
        element.addEventListener('pointermove', event => {
            const state = this.dragState;
            if (state && state.pointerId === event.pointerId && state.element === element) {
                event.preventDefault();
                if (Math.abs(event.clientX - state.startClientX) > DRAG_THRESHOLD_PX) {
                    state.dragged = true;
                }
                this.updateDragPreview(state, event.clientX, event.clientY, state.dragged);
                return;
            }
            if (this.dragState) {
                return;
            }
            const rect = this.expandedChipHitRect(element);
            const hoverDetail = this.trimmerListenerDetails.get(element)!(event, rect);
            element.style.cursor = hoverDetail.kind === 'cut-trim' ? 'ew-resize' : 'grab';
        });
        element.addEventListener('pointerdown', event => {
            const dragDetail = this.trimmerListenerDetails.get(element)!(event, this.expandedChipHitRect(element));
            const lockedTrackId = this.trackIdOfDrag(dragDetail);
            if (this.isTrackLocked(lockedTrackId)) {
                this.showLockedTrack(lockedTrackId, event);
                event.stopPropagation();
                if (event.button === 0) {
                    const selected = this.selectionFromDragState(dragDetail);
                    if (event.shiftKey) this.toggleMultiSelection(selected);
                    else this.applySelection(selected);
                }
                return;
            }
            if (event.button !== 0) {
                return;
            }
            if (this.dragState) {
                this.cancelDrag(this.dragState);
            }
            event.preventDefault();
            event.stopPropagation();
            const ghost = this.createDragGhost(element);
            this.strip.appendChild(ghost);
            const state = {
                ...this.trimmerListenerDetails.get(element)!(event, this.expandedChipHitRect(element)),
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                element,
                ghost,
                dragged: false
            } as DragState;
            this.dragState = state;
            element.style.cursor = state.kind === 'cut-slip' ? 'grabbing' : 'ew-resize';
            element.style.opacity = '.5';
            if (state.kind === 'cut-trim' && state.edge === 'right') {
                const cut = this.cuts[state.index];
                const videoUri = cut ? this.cutVideoUri(cut) : '';
                if (videoUri) {
                    void this.ensureVideoDurationFetch(videoUri);
                }
            }
            try {
                element.setPointerCapture(event.pointerId);
            } catch {
                // Pointer capture can fail if the element is detached during a file refresh.
            }
        });
        element.addEventListener('pointerup', event => {
            const state = this.dragState;
            if (!state || state.pointerId !== event.pointerId || state.element !== element) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (!state.dragged) {
                this.cancelDrag(state);
                // 再ダブルクリック（エッジ／中央どちらでも）で解除。同じ pointerup ベースの
                // 自前判定（detectCutDoubleClick）を、通常クリップの入場判定と共有する。
                if ((state.kind === 'cut-trim' || state.kind === 'cut-slip')
                    && this.detectCutDoubleClick(state.index, event.clientX, event.clientY)) {
                    this.exitTrimmerMode();
                }
                return;
            }
            const preview = this.updateDragPreview(state, event.clientX, event.clientY, true);
            this.cancelDrag(state);
            void this.commitDrag(preview);
        });
        element.addEventListener('pointercancel', event => {
            const state = this.dragState;
            if (state && state.pointerId === event.pointerId && state.element === element) {
                this.cancelDrag(state);
            }
        });
    }

    /**
     * 音声クリップ版 installTrimmerDrag（task 2026-08-18-audio-clip-trimmer-dblclick）。動画クリップと
     * 同型 — 中央ドラッグが 'audio'（移動）ではなく 'audio-slip'（スリップ）になり、ドラッグなしの
     * ダブルクリックが「トリマーモードの解除」になる点が installDragListeners との違い。
     */
    protected installAudioTrimmerDrag(
        element: HTMLDivElement,
        detail: (event: PointerEvent, rect: DOMRect) => DragDetail
    ): void {
        this.audioTrimmerListenerDetails.set(element, detail);
        if (this.audioTrimmerListenerInstalled.has(element)) return;
        this.audioTrimmerListenerInstalled.add(element);
        element.style.pointerEvents = 'auto';
        element.style.touchAction = 'none';
        element.addEventListener('click', event => event.stopPropagation());
        element.addEventListener('pointermove', event => {
            const state = this.dragState;
            if (state && state.pointerId === event.pointerId && state.element === element) {
                event.preventDefault();
                if (Math.abs(event.clientX - state.startClientX) > DRAG_THRESHOLD_PX) {
                    state.dragged = true;
                }
                this.updateDragPreview(state, event.clientX, event.clientY, state.dragged);
                return;
            }
            if (this.dragState) {
                return;
            }
            const rect = this.expandedChipHitRect(element);
            const hoverDetail = this.audioTrimmerListenerDetails.get(element)!(event, rect);
            element.style.cursor = hoverDetail.kind === 'audio-trim' ? 'ew-resize' : 'grab';
        });
        element.addEventListener('pointerdown', event => {
            const dragDetail = this.audioTrimmerListenerDetails.get(element)!(event, this.expandedChipHitRect(element));
            const lockedTrackId = this.trackIdOfDrag(dragDetail);
            if (this.isTrackLocked(lockedTrackId)) {
                this.showLockedTrack(lockedTrackId, event);
                event.stopPropagation();
                if (event.button === 0) {
                    const selected = this.selectionFromDragState(dragDetail);
                    if (event.shiftKey) this.toggleMultiSelection(selected);
                    else this.applySelection(selected);
                }
                return;
            }
            if (event.button !== 0) {
                return;
            }
            if (this.dragState) {
                this.cancelDrag(this.dragState);
            }
            event.preventDefault();
            event.stopPropagation();
            const ghost = this.createDragGhost(element);
            this.strip.appendChild(ghost);
            const state = {
                ...this.audioTrimmerListenerDetails.get(element)!(event, this.expandedChipHitRect(element)),
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                element,
                ghost,
                dragged: false
            } as DragState;
            this.dragState = state;
            element.style.cursor = state.kind === 'audio-slip' ? 'grabbing' : 'ew-resize';
            element.style.opacity = '.5';
            if (state.kind === 'audio-trim' && state.edge === 'right') {
                const sfx = this.audioSfx.find(candidate => candidate.id === state.id);
                if (sfx && this.location?.editUri) {
                    const audioUri = this.resolveEditMediaUri(sfx.path, this.location.editUri).toString();
                    void this.ensureAudioDurationFetch(sfx.path, audioUri);
                }
            }
            try {
                element.setPointerCapture(event.pointerId);
            } catch {
                // Pointer capture can fail if the element is detached during a file refresh.
            }
        });
        element.addEventListener('pointerup', event => {
            const state = this.dragState;
            if (!state || state.pointerId !== event.pointerId || state.element !== element) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (!state.dragged) {
                this.cancelDrag(state);
                // トリマーモード中でも音声クリップのダブルクリックは専用エディタを開く。
                if ((state.kind === 'audio-trim' || state.kind === 'audio-slip')
                    && this.detectAudioDoubleClick(state.id, event.clientX, event.clientY)) {
                    this.exitAudioTrimmerMode();
                    void this.openAudioKeyframeEditor(state.id);
                }
                return;
            }
            const preview = this.updateDragPreview(state, event.clientX, event.clientY, true);
            this.cancelDrag(state);
            void this.commitDrag(preview);
        });
        element.addEventListener('pointercancel', event => {
            const state = this.dragState;
            if (state && state.pointerId === event.pointerId && state.element === element) {
                this.cancelDrag(state);
            }
        });
    }

    /**
     * スリップドラッグ中のライブ視覚更新。クリップ本体・ウィングのセルは再生成せず、
     * まとめて transform: translateX() でずらすことで「フィルムストリップが流れる」ように
     * 見せる（renderStrip はドラッグ中 early return するため、確定までの間だけ直接 DOM を
     * 書き換える。確定 or Esc キャンセルのどちらでも次の再描画/cancelDrag でリセットされる）。
     */
    protected updateTrimmerSlipVisual(clipElement: HTMLDivElement, deltaSeconds: number): void {
        const content = clipElement.querySelector<HTMLDivElement>('.akari-annotations-strip-clip-trimmer-content');
        if (!content) {
            return;
        }
        const pxPerSourceSecond = Number(content.dataset.pxPerSourceSecond ?? '0');
        if (!(pxPerSourceSecond > 0)) {
            return;
        }
        content.style.transform = `translateX(${-deltaSeconds * pxPerSourceSecond}px)`;
    }

    /**
     * チャンクをキャッシュから引く。未取得（undefined）なら 'pending' を即座に書き込んで
     * から非同期フェッチを開始する（Map への同期書き込みが同一 renderStrip パス内・
     * 以降のパスの両方で inflight 重複フェッチを防ぐ）。
     */
    protected ensureFilmstripChunk(videoUri: string, chunkIndex: number): ClipFilmstripChunk | 'pending' | 'unavailable' {
        const key = this.filmstripChunkKey(videoUri, chunkIndex);
        const cached = this.filmstripChunkCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        this.filmstripChunkCache.set(key, 'pending');
        this.fetchFilmstripChunk(videoUri, chunkIndex, key);
        return 'pending';
    }

    protected filmstripChunkKey(videoUri: string, chunkIndex: number): string {
        return `${videoUri}:${chunkIndex}`;
    }

    /**
     * クリップの動画 URI を解決する。edit.json 自身が持つ source(s)（v1 は sources[]、
     * v0 は直下の source）を優先し、analysis sidecar 由来の `this.location.videoUri` は
     * 両方とも解決できなかったときの最終フォールバックにのみ使う。sidecar が存在しない
     * 実プロジェクト（`.akari/sidecars/` が空等）でもサムネ/波形/フィルムストリップと
     * out クランプの実尺取得が edit.json だけで解決されるようにするため
     * （旧 `cutDurationProbeUri` と同一の解決順に統一・一本化）。
     */
    protected cutVideoUri(cut: EditCut): string {
        if (cut.src !== undefined) {
            return this.sourceMap.get(cut.src)?.videoUri ?? '';
        }
        if (this.defaultSource) {
            return this.defaultSource.videoUri;
        }
        return this.location?.videoUri ?? '';
    }

    protected fetchThumbnail(key: string, cut: EditCut, videoUri: string): void {
        if (!this.location) {
            return;
        }
        this.thumbnailCache.set(key, 'pending');
        const atSeconds = cut.in + Math.min(0.1, (cut.out - cut.in) / 2);
        void this.annotationsService.getClipThumbnail({
            projectRootUri: this.location.root.toString(),
            videoUri,
            atSeconds
        }).then(result => {
            if (result.status === 'ready' && result.dataUri) {
                this.thumbnailCache.set(key, result.dataUri);
            } else {
                this.thumbnailCache.set(key, 'unavailable');
                this.showFfmpegMissingNotice(result.reason);
            }
            this.filmstripContentRevision++;
            this.scheduleStripRender();
        }).catch(() => {
            this.thumbnailCache.set(key, 'unavailable');
            this.filmstripContentRevision++;
            this.scheduleStripRender();
        });
    }

    /**
     * チャンクは素材（videoUri）+ chunkIndex 単位で取得する。呼び出し元
     * （ensureFilmstripChunk）が同期的に 'pending' を書き込んでから呼ぶため、
     * ここでは 'pending' の再書き込みはしない（inflight 重複防止はキャッシュの
     * 同期書き込みタイミングで担保する）。クリップの trim/move では呼ばれない
     * （キーが videoUri+chunkIndex のみで in/out を含まないため）。
     */
    protected fetchFilmstripChunk(videoUri: string, chunkIndex: number, key: string): void {
        if (!this.location) {
            this.filmstripChunkCache.set(key, 'unavailable');
            return;
        }
        void this.annotationsService.getClipFilmstripChunk({
            projectRootUri: this.location.root.toString(),
            videoUri, chunkIndex
        }).then(result => {
            if (result.status === 'ready' && result.chunk) {
                this.filmstripChunkCache.set(key, result.chunk);
            } else {
                this.filmstripChunkCache.set(key, 'unavailable');
                this.showFfmpegMissingNotice(result.reason);
            }
            this.filmstripContentRevision++;
            this.scheduleStripRender();
        }).catch(() => {
            this.filmstripChunkCache.set(key, 'unavailable');
            this.filmstripContentRevision++;
            this.scheduleStripRender();
        });
    }

    protected fetchWaveform(key: string, cut: EditCut, videoUri: string): void {
        if (!this.location) {
            return;
        }
        this.waveformCache.set(key, 'pending');
        void this.annotationsService.getClipWaveform({
            projectRootUri: this.location.root.toString(),
            videoUri,
            startSeconds: cut.in,
            endSeconds: cut.out
        }).then(result => {
            if (result.status === 'ready' && result.peaks) {
                this.waveformCache.set(key, result.peaks);
            } else {
                this.waveformCache.set(key, 'unavailable');
                this.showFfmpegMissingNotice(result.reason);
            }
            this.scheduleStripRender();
        }).catch(() => {
            this.waveformCache.set(key, 'unavailable');
            this.scheduleStripRender();
        });
    }

    protected fetchAudioDuration(key: string, audioUri: string): void {
        void this.ensureAudioDurationFetch(key, audioUri);
    }

    /**
     * R7-1・sfx バーの波形表示: 既存の getClipWaveform（動画クリップで実績のある経路）を
     * 音声ファイルにそのまま再利用する。cuts の波形と違い、キーは素材パス単体
     * （`sfxwave:${path}`）で in/out を含めない — 常に [0, 実尺) 全域を1回だけ取得して
     * キャッシュし、トリム（in/out）変更時は取得済みの全域 peaks をクライアント側で
     * 再スライスするだけで窓を追随させる（バックエンドの再生成は発生しない）。
     */
    protected appendAudioKeyframeMarkers(
        element: HTMLElement,
        audio: AudioEnvelopeFields,
        durationSeconds: number,
        frameTimebase: boolean
    ): void {
        if (!audio.keyframes?.length) return;
        const positions = audioKeyframeMarkerPositions(audio.keyframes.map(point => ({
            t: frameTimebase ? point.t / this.fps : point.t,
            gainDb: point.gain_db ?? 0
        })), durationSeconds);
        for (const position of positions) {
            const marker = document.createElement('span');
            marker.dataset.akariAudioKeyframeMarker = String(position);
            Object.assign(marker.style, {
                position: 'absolute',
                left: `${position * 100}%`,
                bottom: '-3px',
                width: `${AUDIO_KEYFRAME_MARKER_SIZE_PX}px`,
                height: `${AUDIO_KEYFRAME_MARKER_SIZE_PX}px`,
                transform: 'translateX(-50%) rotate(45deg)',
                background: '#eafcff',
                border: '1px solid #0891b2',
                pointerEvents: 'none',
                zIndex: '5'
            });
            element.appendChild(marker);
        }
    }

    protected audioWaveformDetailSource(
        path: string,
        audioUri: string,
        fullDurationSeconds: number,
        clipStartSec: number,
        displayDurationSec: number,
        sourceWindow: AudioWaveformWindow,
        visibleWidthPx: number,
        t0Peaks: readonly number[],
        baseSliceKey: string,
        displayPeaks: (peaks: readonly number[]) => readonly number[],
        detailMappingFactory?: () => AudioWaveformDetailMapping | undefined
    ): AudioWaveformDetailSource {
        const t0DisplayPeaks = displayPeaks(t0Peaks);
        let selected: AudioWaveformDetailSource = {
            tier: 'T0', fullPeaks: t0Peaks, sliceKey: baseSliceKey,
            peaksFactory: () => t0DisplayPeaks,
            waveformStartSec: clipStartSec, waveformDisplayDurationSec: displayDurationSec
        };
        if (nextAudioWaveformTier('T0', visibleWidthPx, t0DisplayPeaks.length) !== 'T1') {
            return selected;
        }

        const fullWindow = { startSeconds: 0, endSeconds: fullDurationSeconds };
        const t1BucketCount = audioWaveformTierBucketCount('T1', fullDurationSeconds);
        const t1Key = audioWaveformTierCacheKey(path, 'T1', fullWindow, t1BucketCount);
        let t1 = this.waveformTierCache.get(t1Key);
        const t1ViewKey = audioWaveformViewKey(this.viewStart, this.visibleDuration());
        const retryT1 = t1 === 'unavailable' && this.waveformT1RetryGate.shouldRetry(path, t1ViewKey);
        if ((t1 === undefined || retryT1) && !this.waveformT1Requested.has(path)) {
            if (retryT1) this.waveformTierCache.delete(t1Key);
            this.waveformT1Requested.add(path);
            this.fetchAudioWaveformTier(t1Key, 'T1', audioUri, fullWindow, t1BucketCount, path);
            t1 = 'pending';
        }
        if (!Array.isArray(t1)) return selected;

        const t1DisplayPeaks = displayPeaks(t1);
        if (t1DisplayPeaks.length > t0DisplayPeaks.length) {
            selected = {
                tier: 'T1', fullPeaks: t1, sliceKey: `${baseSliceKey}:${t1Key}`,
                peaksFactory: () => t1DisplayPeaks,
                waveformStartSec: clipStartSec, waveformDisplayDurationSec: displayDurationSec
            };
        }
        const selectedBucketCount = Math.max(t0DisplayPeaks.length, t1DisplayPeaks.length);
        if (nextAudioWaveformTier('T1', visibleWidthPx, selectedBucketCount) !== 'T2') {
            return selected;
        }
        const sourceSpan = sourceWindow.endSeconds - sourceWindow.startSeconds;
        const sourceSecondsPerTimelineSecond = sourceSpan / displayDurationSec;
        if (!(sourceSecondsPerTimelineSecond > 0)) return selected;
        const resolveDetailMapping = detailMappingFactory ?? (() => {
            const visibleSourceWindow = audioWaveformVisibleSourceWindow({
                clipStartSeconds: clipStartSec,
                displayDurationSeconds: displayDurationSec,
                sourceStartSeconds: sourceWindow.startSeconds,
                sourceEndSeconds: sourceWindow.endSeconds,
                viewStartSeconds: this.viewStart,
                viewEndSeconds: this.viewStart + this.visibleDuration()
            });
            if (!visibleSourceWindow) return undefined;
            return {
                visibleSourceWindow,
                sourceOriginTimelineSeconds: clipStartSec
                    - sourceWindow.startSeconds / sourceSecondsPerTimelineSecond,
                sourceSecondsPerTimelineSecond
            };
        });
        const targetKey = `${baseSliceKey}:${clipStartSec.toFixed(6)}:${displayDurationSec.toFixed(6)}`;
        const requestCoverage = (): AudioWaveformT2PlacementCoverage | undefined => {
            const mapping = resolveDetailMapping();
            if (!mapping) return undefined;
            return this.audioWaveformT2Coverage(
                targetKey, path, audioUri, fullDurationSeconds, sourceWindow, mapping
            );
        };
        this.waveformT2PanTargets.set(targetKey, () => { requestCoverage(); });
        const coverage = requestCoverage();
        if (!coverage) return selected;
        const t2Key = coverage.key;
        const t2 = this.waveformTierCache.get(t2Key);
        if (!Array.isArray(t2)) {
            return selected;
        }

        const coverageDuration = coverage.window.endSeconds - coverage.window.startSeconds;
        const coverageClipStart = coverage.sourceOriginTimelineSeconds
            + coverage.window.startSeconds / coverage.sourceSecondsPerTimelineSecond;
        const coverageDisplayDuration = coverageDuration / coverage.sourceSecondsPerTimelineSecond;
        return {
            tier: 'T2', fullPeaks: t2, sliceKey: `${baseSliceKey}:${t2Key}`,
            peaksFactory: () => t2,
            waveformStartSec: coverageClipStart,
            waveformDisplayDurationSec: coverageDisplayDuration
        };
    }

    /** 可視窓が既存 coverage 内なら再利用し、越えた時だけ新しい先読み窓を T2 へ流す。 */
    protected audioWaveformT2Coverage(
        targetKey: string,
        path: string,
        audioUri: string,
        fullDurationSeconds: number,
        sourceWindow: AudioWaveformWindow,
        mapping: AudioWaveformDetailMapping
    ): AudioWaveformT2PlacementCoverage | undefined {
        let coverage = this.waveformT2Coverages.get(targetKey);
        const scheduledKey = this.waveformT2DebounceTimers.get(path)?.key;
        if (coverage && (!audioWaveformWindowContains(coverage.window, mapping.visibleSourceWindow)
            || (!this.waveformTierCache.has(coverage.key) && scheduledKey !== coverage.key))) {
            this.waveformT2Coverages.delete(targetKey);
            coverage = undefined;
        }
        if (!coverage) {
            const window = audioWaveformPrefetchWindow({
                visibleWindow: mapping.visibleSourceWindow,
                sourceWindow,
                fullDurationSeconds
            });
            if (!window) return undefined;
            const windowDuration = window.endSeconds - window.startSeconds;
            const bucketCount = audioWaveformTierBucketCount(
                'T2', fullDurationSeconds, windowDuration
            );
            const key = audioWaveformTierCacheKey(path, 'T2', window, bucketCount);
            coverage = { key, window, bucketCount };
            if (!this.waveformT2Coverages.has(targetKey)
                && this.waveformT2Coverages.size >= 200) {
                const oldestTarget = this.waveformT2Coverages.keys().next().value;
                if (oldestTarget !== undefined) this.waveformT2Coverages.delete(oldestTarget);
            }
            this.waveformT2Coverages.set(targetKey, coverage);
            if (!this.waveformTierCache.has(key)) {
                this.scheduleAudioWaveformT2(path, key, audioUri, window, bucketCount);
            }
        }
        return {
            ...coverage,
            sourceOriginTimelineSeconds: mapping.sourceOriginTimelineSeconds,
            sourceSecondsPerTimelineSecond: mapping.sourceSecondsPerTimelineSecond
        };
    }

    protected fetchAudioWaveformTier(
        key: string,
        tier: Exclude<AudioWaveformTier, 'T0'>,
        audioUri: string,
        sourceWindow: AudioWaveformWindow,
        bucketCount: number,
        requestPath?: string
    ): void {
        if (!this.location) return;
        this.waveformTierCache.set(key, tier, 'pending');
        void this.annotationsService.getClipWaveform({
            projectRootUri: this.location.root.toString(),
            videoUri: audioUri,
            startSeconds: sourceWindow.startSeconds,
            endSeconds: sourceWindow.endSeconds,
            bucketCount
        }).then(result => {
            if (result.status === 'ready' && result.peaks) {
                this.waveformTierCache.set(key, tier, result.peaks);
                if (tier === 'T1' && requestPath) this.waveformT1RetryGate.recordSuccess(requestPath);
            } else {
                this.waveformTierCache.set(key, tier, 'unavailable');
                if (tier === 'T1' && requestPath) {
                    this.waveformT1RetryGate.recordFailure(
                        requestPath, audioWaveformViewKey(this.viewStart, this.visibleDuration())
                    );
                }
                this.showFfmpegMissingNotice(result.reason);
            }
        }).catch(() => {
            this.waveformTierCache.set(key, tier, 'unavailable');
            if (tier === 'T1' && requestPath) {
                this.waveformT1RetryGate.recordFailure(
                    requestPath, audioWaveformViewKey(this.viewStart, this.visibleDuration())
                );
            }
        }).finally(() => {
            if (tier === 'T1' && requestPath) this.waveformT1Requested.delete(requestPath);
            if (tier === 'T2' && requestPath) this.waveformT2DebounceGates.get(requestPath)?.release(key);
            this.renderStrip();
        });
    }

    protected scheduleAudioWaveformT2(
        path: string,
        key: string,
        audioUri: string,
        sourceWindow: AudioWaveformWindow,
        bucketCount: number
    ): void {
        let gate = this.waveformT2DebounceGates.get(path);
        if (!gate) {
            gate = new AudioWaveformDebounceGate(200);
            this.waveformT2DebounceGates.set(path, gate);
        }
        const decision = gate.consider(key, Date.now());
        if (decision.shouldFetch) {
            this.fetchAudioWaveformTier(key, 'T2', audioUri, sourceWindow, bucketCount, path);
            return;
        }
        if (decision.waitMs === undefined) return;
        const existing = this.waveformT2DebounceTimers.get(path);
        if (existing?.key === key && !decision.pendingChanged) return;
        if (existing) window.clearTimeout(existing.handle);
        const handle = window.setTimeout(() => {
            this.waveformT2DebounceTimers.delete(path);
            if (!this.waveformTierCache.has(key)) {
                this.scheduleAudioWaveformT2(path, key, audioUri, sourceWindow, bucketCount);
            }
        }, Math.max(0, Math.ceil(decision.waitMs)));
        this.waveformT2DebounceTimers.set(path, { key, handle });
    }

    protected updateBgmWaveform(
        element: HTMLDivElement, bgm: EditAudioBgmWithEnvelope, timelineDurationSec: number,
        itemHeightPx: number, actualDuration: number | undefined
    ): void {
        const barWidthPx = this.audioBarWidthPx(0, timelineDurationSec);
        if (!this.location || actualDuration === undefined || !(actualDuration > 0)) {
            this.removeAudioWaveformCanvas(element);
            return;
        }
        const key = `sfxwave:${bgm.path}`;
        const audioUri = this.resolveEditMediaUri(bgm.path, this.location.editUri).toString();
        const waveform = this.waveformCache.get(key);
        if (Array.isArray(waveform)) {
            const sliceKey = `loop:${bgm.path}:${actualDuration}:${timelineDurationSec}:0:${bgm.speed ?? 1}`;
            const detail = this.audioWaveformDetailSource(
                bgm.path, audioUri, actualDuration, 0, timelineDurationSec,
                { startSeconds: 0, endSeconds: actualDuration }, barWidthPx, waveform, sliceKey,
                peaks => audioLoopTilePeaks(peaks, {
                    trackDurationSec: actualDuration,
                    timelineDurationSec,
                    inSec: 0,
                    speed: bgm.speed
                }),
                () => audioLoopWaveformVisibleWindowPlan(
                    timelineDurationSec, actualDuration,
                    this.viewStart, this.viewStart + this.visibleDuration(), bgm.speed
                )
            );
            this.updateAudioClipWaveform(
                element, detail.fullPeaks, detail.sliceKey, detail.peaksFactory,
                0, timelineDurationSec,
                detail.waveformStartSec, detail.waveformDisplayDurationSec,
                barWidthPx, itemHeightPx, {
                    gainDb: bgm.gainDb,
                    keyframes: bgm.keyframes,
                    fadeInSeconds: bgm.fadeIn,
                    fadeOutSeconds: bgm.fadeOut,
                    durationSeconds: timelineDurationSec,
                    bucketStartSeconds: detail.waveformStartSec,
                    bucketDurationSeconds: detail.waveformDisplayDurationSec,
                    keyframeFrames: this.editDocument !== undefined
                        && findAudioItemIdByRole(this.editDocument, 'bgm') !== undefined,
                    fps: this.fps
                }
            );
        } else if (waveform === undefined) {
            this.fetchSfxWaveform(key, audioUri, actualDuration);
        } else {
            this.removeAudioWaveformCanvas(element);
        }
    }

    protected updateNarrationWaveform(
        element: HTMLDivElement, narration: EditAudioNarrationWithEnvelope, displayDurationSec: number,
        itemHeightPx: number, actualDuration: number | undefined
    ): void {
        const barWidthPx = this.audioBarWidthPx(narration.t, narration.t + displayDurationSec);
        if (!this.location || actualDuration === undefined || !(actualDuration > 0)) {
            this.removeAudioWaveformCanvas(element);
            return;
        }
        const sourceWindow = audioSourceSliceWindow({
            inSec: narration.in ?? 0,
            displayDurationSec,
            speed: narration.speed
        });
        const key = `sfxwave:${narration.path}`;
        const audioUri = this.resolveEditMediaUri(narration.path, this.location.editUri).toString();
        const waveform = this.waveformCache.get(key);
        if (Array.isArray(waveform)) {
            const sliceKey = `source:${narration.path}:${sourceWindow.startSec}:${sourceWindow.endSec}:${actualDuration}`;
            const detail = this.audioWaveformDetailSource(
                narration.path, audioUri, actualDuration, narration.t, displayDurationSec,
                { startSeconds: sourceWindow.startSec, endSeconds: sourceWindow.endSec },
                barWidthPx, waveform, sliceKey,
                peaks => this.sfxWaveformSlice(
                    peaks, sourceWindow.startSec, sourceWindow.endSec, actualDuration
                )
            );
            this.updateAudioClipWaveform(
                element, detail.fullPeaks, detail.sliceKey, detail.peaksFactory,
                narration.t, displayDurationSec,
                detail.waveformStartSec, detail.waveformDisplayDurationSec,
                barWidthPx, itemHeightPx, {
                    gainDb: narration.gainDb,
                    keyframes: narration.keyframes,
                    durationSeconds: displayDurationSec,
                    bucketStartSeconds: detail.waveformStartSec - narration.t,
                    bucketDurationSeconds: detail.waveformDisplayDurationSec,
                    keyframeFrames: this.rawV2Item(narration.id) !== undefined,
                    fps: this.fps
                }
            );
        } else if (waveform === undefined) {
            this.fetchSfxWaveform(key, audioUri, actualDuration);
        } else {
            this.removeAudioWaveformCanvas(element);
        }
    }

    protected updateSfxWaveform(
        element: HTMLDivElement, sfx: EditAudioSfxWithFade, barWidthPx: number, itemHeightPx: number,
        sourceWindow: { startSec: number; endSec: number }, actualDuration: number | undefined,
        displayDurationSec: number
    ): void {
        if (!this.location || actualDuration === undefined || !(actualDuration > 0)) {
            this.removeAudioWaveformCanvas(element);
            return;
        }
        const key = `sfxwave:${sfx.path}`;
        const audioUri = this.resolveEditMediaUri(sfx.path, this.location.editUri).toString();
        const waveform = this.waveformCache.get(key);
        if (Array.isArray(waveform)) {
            const sliceKey = `source:${sfx.path}:${sourceWindow.startSec}:${sourceWindow.endSec}:${actualDuration}`;
            const detail = this.audioWaveformDetailSource(
                sfx.path, audioUri, actualDuration, sfx.t, displayDurationSec,
                { startSeconds: sourceWindow.startSec, endSeconds: sourceWindow.endSec },
                barWidthPx, waveform, sliceKey,
                peaks => this.sfxWaveformSlice(
                    peaks, sourceWindow.startSec, sourceWindow.endSec, actualDuration
                )
            );
            this.updateAudioClipWaveform(
                element, detail.fullPeaks, detail.sliceKey, detail.peaksFactory,
                sfx.t, displayDurationSec,
                detail.waveformStartSec, detail.waveformDisplayDurationSec,
                barWidthPx, itemHeightPx, {
                    gainDb: sfx.gainDb,
                    keyframes: sfx.keyframes,
                    fadeInSeconds: sfx.fadeIn,
                    fadeOutSeconds: sfx.fadeOut,
                    durationSeconds: displayDurationSec,
                    bucketStartSeconds: detail.waveformStartSec - sfx.t,
                    bucketDurationSeconds: detail.waveformDisplayDurationSec,
                    keyframeFrames: this.rawV2Item(sfx.id) !== undefined,
                    fps: this.fps
                }
            );
        } else if (waveform === undefined) {
            this.fetchSfxWaveform(key, audioUri, actualDuration);
        } else {
            this.removeAudioWaveformCanvas(element);
        }
    }

    protected fetchSfxWaveform(key: string, audioUri: string, fullDurationSeconds: number): void {
        if (!this.location) {
            return;
        }
        this.waveformCache.set(key, 'pending');
        void this.annotationsService.getClipWaveform({
            projectRootUri: this.location.root.toString(),
            videoUri: audioUri,
            startSeconds: 0,
            endSeconds: fullDurationSeconds
        }).then(result => {
            if (result.status === 'ready' && result.peaks) {
                this.waveformCache.set(key, result.peaks);
            } else {
                this.waveformCache.set(key, 'unavailable');
                this.showFfmpegMissingNotice(result.reason);
            }
            this.scheduleStripRender();
        }).catch(() => {
            this.waveformCache.set(key, 'unavailable');
            this.scheduleStripRender();
        });
    }

    /** 全域 [0, fullDuration) の peaks から [inSeconds, outSeconds) に対応するバケツだけを切り出す。 */
    protected sfxWaveformSlice(
        peaks: readonly number[], inSeconds: number, outSeconds: number, fullDuration: number
    ): number[] {
        const bucketCount = peaks.length;
        if (bucketCount === 0 || fullDuration <= 0) {
            return [];
        }
        const startFrac = Math.min(1, Math.max(0, inSeconds / fullDuration));
        const endFrac = Math.min(1, Math.max(startFrac, outSeconds / fullDuration));
        const startIndex = Math.min(bucketCount - 1, Math.floor(startFrac * bucketCount));
        const endIndex = Math.max(startIndex + 1, Math.min(bucketCount, Math.ceil(endFrac * bucketCount)));
        return peaks.slice(startIndex, endIndex);
    }

    protected audioBarWidthPx(startSeconds: number, endSeconds: number): number {
        const stripWidth = this.stripLayoutWidthPx > 0 ? this.stripLayoutWidthPx : this.strip.clientWidth;
        const widthPercent = Math.max(this.layoutPercent(endSeconds) - this.layoutPercent(startSeconds), 0.3);
        return stripWidth * widthPercent / 100;
    }

    protected updateAudioClipWaveform(
        element: HTMLDivElement,
        fullPeaks: readonly number[],
        sliceKey: string,
        peaksFactory: () => readonly number[],
        clipStartSec: number,
        clipDisplayDurationSec: number,
        waveformStartSec: number,
        waveformDisplayDurationSec: number,
        visibleWidthPx: number,
        itemHeightPx: number,
        envelope: AudioLoudnessEnvelope
    ): void {
        if (visibleWidthPx < MIN_CLIP_WIDTH_FOR_MEDIA_PX
            || itemHeightPx < MIN_TRACK_HEIGHT_FOR_AUDIO_WAVEFORM_PX) {
            this.removeAudioWaveformCanvas(element);
            return;
        }
        const stripWidthPx = this.stripLayoutWidthPx > 0 ? this.stripLayoutWidthPx : this.strip.clientWidth;
        const viewDurationSec = this.layoutViewDuration > 0 ? this.layoutViewDuration : this.visibleDuration();
        const layoutViewStartSec = this.layoutViewDuration > 0 ? this.layoutViewStart : this.viewStart;
        const geometry = audioClipLocalGeometry({
            clipStartSec,
            displayDurationSec: clipDisplayDurationSec,
            layoutViewStartSec,
            viewDurationSec,
            stripWidthPx
        });
        if (!geometry) {
            this.removeAudioWaveformCanvas(element);
            return;
        }
        const placement = audioWaveformCanvasPlacement({
            clipStartSec,
            clipDisplayDurationSec,
            waveformStartSec,
            waveformDisplayDurationSec,
            visibleWidthPx,
            ...geometry
        });
        if (!placement) {
            this.removeAudioWaveformCanvas(element);
            return;
        }
        this.updateAudioWaveformCanvas(
            element, fullPeaks, sliceKey, peaksFactory, itemHeightPx, placement, envelope
        );
    }

    protected updateAudioWaveformCanvas(
        element: HTMLDivElement,
        fullPeaks: readonly number[],
        sliceKey: string,
        peaksFactory: () => readonly number[],
        itemHeightPx: number,
        placement: AudioWaveformCanvasPlacement,
        envelope: AudioLoudnessEnvelope = { durationSeconds: 0 }
    ): void {
        const band = audioWaveformBandLayout(itemHeightPx, CLIP_HEADER_HEIGHT);
        const masterKey = audioWaveformMasterKey(
            this.audioWaveformPeakIdentity(fullPeaks), sliceKey, band.heightPx, envelope
        );
        const master = this.audioWaveformMaster(masterKey, peaksFactory, band.heightPx, envelope);
        if (!master) {
            this.removeAudioWaveformCanvas(element);
            return;
        }
        let canvas = element.querySelector<HTMLCanvasElement>(
            ':scope > canvas.akari-annotations-strip-audio-waveform'
        );
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.className = 'akari-annotations-strip-audio-waveform';
            element.appendChild(canvas);
        }
        const visibleWidthPx = Math.max(1, Math.round(placement.canvasWidthPx));
        const canvasLeftPx = Math.round(placement.canvasLeftPx * 1000) / 1000;
        const next: AudioWaveformPaintState = {
            sliceKey: masterKey,
            visibleWidth: visibleWidthPx,
            offset: Math.round(placement.waveformOffsetPx * 1000) / 1000,
            left: canvasLeftPx,
            bandTop: band.topPx,
            bandHeight: band.heightPx
        };
        const previous = this.audioWaveformPaintState(canvas);
        if (!audioWaveformRepaintNeeded(previous, next)) return;
        canvas.width = visibleWidthPx;
        canvas.height = band.heightPx;
        Object.assign(canvas.style, {
            position: 'absolute',
            left: `${canvasLeftPx}px`,
            top: `${band.topPx}px`,
            width: `${visibleWidthPx}px`,
            height: `${band.heightPx}px`,
            opacity: '.55',
            pointerEvents: 'none'
        });
        const context = canvas.getContext('2d');
        const sourceRect = audioWaveformSourceRect({
            masterWidthPx: master.width,
            fullClipWidthPx: placement.waveformFullWidthPx,
            clipLocalOffsetPx: placement.waveformOffsetPx,
            visibleWidthPx: placement.canvasWidthPx
        });
        if (context && sourceRect) {
            context.drawImage(
                master,
                sourceRect.sourceXPx, 0, sourceRect.sourceWidthPx, band.heightPx,
                0, 0, visibleWidthPx, band.heightPx
            );
        }
        canvas.dataset.akariWaveformPaintState = JSON.stringify(next);
    }

    protected audioWaveformMaster(
        key: string, peaksFactory: () => readonly number[], heightPx: number,
        envelope: AudioLoudnessEnvelope
    ): HTMLCanvasElement | undefined {
        const cached = this.audioWaveformMasterCache.get(key);
        if (cached) return cached;
        const peaks = peaksFactory();
        if (peaks.length === 0) return undefined;
        const master = document.createElement('canvas');
        master.width = peaks.length;
        master.height = heightPx;
        const context = master.getContext('2d');
        if (!context) return undefined;
        const colors = audioLoudnessBucketColors(peaks, envelope);
        for (let bucket = 0; bucket < peaks.length; bucket++) {
            context.fillStyle = colors[bucket];
            const barHeight = waveformHeightForPeak(peaks[bucket]) * heightPx;
            context.fillRect(bucket, (heightPx - barHeight) / 2, 1, barHeight);
        }
        if (this.audioWaveformMasterCache.size >= AUDIO_WAVEFORM_MASTER_CACHE_LIMIT) {
            const oldestKey = this.audioWaveformMasterCache.keys().next().value;
            if (oldestKey !== undefined) this.audioWaveformMasterCache.delete(oldestKey);
        }
        this.audioWaveformMasterCache.set(key, master);
        return master;
    }

    protected audioWaveformPeakIdentity(peaks: readonly number[]): number {
        const cached = this.audioWaveformPeakIds.get(peaks);
        if (cached !== undefined) return cached;
        const identity = this.nextAudioWaveformPeakId++;
        this.audioWaveformPeakIds.set(peaks, identity);
        return identity;
    }

    protected audioWaveformPaintState(canvas: HTMLCanvasElement): AudioWaveformPaintState | undefined {
        const value = canvas.dataset.akariWaveformPaintState;
        if (!value) return undefined;
        try {
            return JSON.parse(value) as AudioWaveformPaintState;
        } catch {
            return undefined;
        }
    }

    protected removeAudioWaveformCanvas(element: HTMLElement): void {
        element.querySelector(':scope > canvas.akari-annotations-strip-audio-waveform')?.remove();
    }

    /**
     * SE 実尺の取得を（未取得なら）開始し、進行中または完了済みの Promise を返す
     * （ensureVideoDurationFetch と同型。トリムの Out クランプ確定時の「未取得なら保留」に使う）。
     */
    protected ensureAudioDurationFetch(key: string, audioUri: string): Promise<number | 'unavailable'> {
        // 実尺が解決すると SE / ナレーションの終端（尺の集計）が変わる。取得の開始時点で進めておき、
        // 解決後の描画で再集計させる。
        this.invalidateContentExtent();
        if (!audioUri || !this.location) {
            return Promise.resolve('unavailable');
        }
        const cached = this.audioDurationCache.get(key);
        if (typeof cached === 'number' || cached === 'unavailable') {
            return Promise.resolve(cached);
        }
        const pending = this.audioDurationPromises.get(key);
        if (pending) {
            return pending;
        }
        this.audioDurationCache.set(key, 'pending');
        const promise = this.annotationsService.getAudioDuration({
            projectRootUri: this.location.root.toString(),
            audioUri
        }).then((result): number | 'unavailable' => {
            const value: number | 'unavailable' = result.status === 'ready' && result.durationSeconds !== undefined
                ? result.durationSeconds : 'unavailable';
            this.audioDurationCache.set(key, value);
            if (value === 'unavailable') {
                this.showFfmpegMissingNotice(result.reason);
            }
            this.renderStrip();
            return value;
        }).catch((): number | 'unavailable' => {
            this.audioDurationCache.set(key, 'unavailable');
            this.renderStrip();
            return 'unavailable';
        });
        this.audioDurationPromises.set(key, promise);
        return promise;
    }

    /** SE バーの表示尺は source 窓を speed でタイムライン秒へ戻す。v2 duration は既に表示秒。 */
    protected resolveSfxDisplayDuration(sfx: EditAudioSfx, inSeconds: number, actualDuration: number | undefined): number {
        const speed = sfx.speed !== undefined && sfx.speed > 0 ? sfx.speed : 1;
        if (sfx.out !== undefined) {
            return Math.max(0, sfx.out - inSeconds) / speed;
        }
        if (actualDuration !== undefined) {
            return Math.max(0, actualDuration - inSeconds) / speed;
        }
        return sfx.duration;
    }

    /**
     * 実尺取得を（未取得なら）開始し、進行中または完了済みの Promise を返す。
     * pointerdown 時の先行キック（初回ドラッグの素通し防止）と、pointerup 時の
     * 「未取得なら確定を保留」の両方がこの共通経路を通る — 同じ videoUri への
     * 二重フェッチは Promise の使い回しで防ぐ。
     */
    protected ensureVideoDurationFetch(videoUri: string): Promise<number | 'unavailable'> {
        if (!videoUri || !this.location) {
            return Promise.resolve('unavailable');
        }
        const cached = this.videoDurationCache.get(videoUri);
        if (typeof cached === 'number' || cached === 'unavailable') {
            return Promise.resolve(cached);
        }
        const pending = this.videoDurationPromises.get(videoUri);
        if (pending) {
            return pending;
        }
        this.videoDurationCache.set(videoUri, 'pending');
        const promise = this.annotationsService.getAudioDuration({
            projectRootUri: this.location.root.toString(),
            audioUri: videoUri
        }).then((result): number | 'unavailable' => {
            const value: number | 'unavailable' = result.status === 'ready' && result.durationSeconds !== undefined
                ? result.durationSeconds : 'unavailable';
            this.videoDurationCache.set(videoUri, value);
            if (value === 'unavailable') {
                this.showVideoDurationUnavailableNotice();
            }
            this.renderStrip();
            return value;
        }).catch((): number | 'unavailable' => {
            this.videoDurationCache.set(videoUri, 'unavailable');
            this.showVideoDurationUnavailableNotice();
            this.renderStrip();
            return 'unavailable';
        });
        this.videoDurationPromises.set(videoUri, promise);
        return promise;
    }

    protected showVideoDurationUnavailableNotice(): void {
        if (!this.videoDurationNoticeShown && !this.notice.hasMessage()) {
            this.showNotice('素材の実尺が取得できないため、Out のクランプは無効です。');
            this.videoDurationNoticeShown = true;
        }
    }

    protected showFfmpegMissingNotice(reason: string | undefined): void {
        if (reason === 'ffmpeg-not-found' && !this.ffmpegMissingNoticeShown && !this.notice.hasMessage()) {
            this.showNotice('ffmpeg が見つからないため、サムネイルと波形は表示されません（他の操作は通常どおり使えます）');
            this.ffmpegMissingNoticeShown = true;
        }
    }

    /**
     * peaks（WAVEFORM_BUCKET_COUNT バケツ、常にクリップ全区間 [in,out) を表す）から、
     * この clip の可視サブ区間に対応する部分だけを描く。フィルムストリップと同じ
     * clipLocalOffsetPx / fullClipWidthPx 写像を使うため、ズーム 100%（クリップ全体が
     * 可視 = offset 0・可視幅 = fullClipWidthPx）では旧実装（peaks を等間隔にそのまま
     * 敷き詰める）と同じ見た目になる。ズームでクリップがビュー窓からはみ出すと、
     * この部分範囲だけが可視幅いっぱいに描かれるため、フィルムストリップのコマと
     * 同じ写像でスライドし、全区間の圧縮波形が出ない。
     *
     * 帯はクリップ帯の下寄せ（WAVEFORM_BAND_HEIGHT_PX・下 1/3 目安）に固定し、
     * clipHeader（上 CLIP_HEADER_HEIGHT px）と非重複にする（③）。clipHeightPx は
     * この track の高さティア（standard/large、compact はここまで到達しない）。
     */
    protected waveformCanvas(
        peaks: readonly number[], clipWidthPx: number,
        geometry: { fullClipWidthPx: number; clipLocalOffsetPx: number }, clipHeightPx: number
    ): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        this.updateWaveformCanvas(canvas, peaks, clipWidthPx, geometry, clipHeightPx);
        return canvas;
    }

    protected updateWaveformCanvas(
        canvas: HTMLCanvasElement, peaks: readonly number[], clipWidthPx: number,
        geometry: { fullClipWidthPx: number; clipLocalOffsetPx: number }, clipHeightPx: number
    ): void {
        const visibleWidthPx = Math.max(1, Math.round(clipWidthPx));
        canvas.width = visibleWidthPx;
        canvas.height = WAVEFORM_BAND_HEIGHT_PX;
        Object.assign(canvas.style, {
            position: 'absolute',
            left: '0',
            top: `${clipHeightPx - WAVEFORM_BAND_HEIGHT_PX}px`,
            width: `${visibleWidthPx}px`,
            height: `${WAVEFORM_BAND_HEIGHT_PX}px`,
            opacity: '.55',
            pointerEvents: 'none'
        });
        const context = canvas.getContext('2d');
        const bucketCount = peaks.length;
        if (context && bucketCount > 0 && geometry.fullClipWidthPx > 0) {
            context.fillStyle = '#fff';
            for (let x = 0; x < visibleWidthPx; x++) {
                const localPx = geometry.clipLocalOffsetPx + x;
                const bucket = waveformBucketForLocalPx(localPx, geometry.fullClipWidthPx, bucketCount);
                const barHeight = waveformHeightForPeak(peaks[bucket]) * WAVEFORM_BAND_HEIGHT_PX;
                context.fillRect(x, (WAVEFORM_BAND_HEIGHT_PX - barHeight) / 2, 1, barHeight);
            }
        }
    }

    protected segmentLabel(text: string): HTMLSpanElement {
        const label = document.createElement('span');
        label.className = 'akari-annotations-segment-label';
        label.textContent = text;
        return label;
    }

    /** クリップ上端のヘッダー帯（レガシー準拠）。ラベルと尺（MM:SS:FF）を表示する。 */
    protected clipHeader(label: string, durationSeconds: number): HTMLDivElement {
        const header = document.createElement('div');
        header.className = 'akari-annotations-strip-clip-header';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'akari-annotations-strip-clip-header-label';
        labelSpan.textContent = label;
        const durationSpan = document.createElement('span');
        durationSpan.className = 'akari-annotations-strip-clip-header-duration';
        durationSpan.textContent = this.formatFrameTimestamp(durationSeconds, this.fps);
        header.append(labelSpan, durationSpan);
        return header;
    }

    protected installDragListeners(
        element: HTMLDivElement,
        detail: (event: PointerEvent, rect: DOMRect) => DragDetail,
        onRazorClick?: (event: MouseEvent) => void
    ): void {
        this.dragListenerConfigs.set(element, { detail, onRazorClick });
        if (this.dragListenerInstalled.has(element)) return;
        this.dragListenerInstalled.add(element);
        element.style.pointerEvents = 'auto';
        element.style.touchAction = 'none';
        element.style.cursor = 'default';
        element.addEventListener('click', event => {
            event.stopPropagation();
            const selection = this.timelineSelectionFromElement(element);
            if (selection && this.isTrackLocked(this.trackIdOfSelection(selection))) {
                this.showLockedTrack(this.trackIdOfSelection(selection), event);
                return;
            }
            if (this.toolMode === 'razor') {
                this.dragListenerConfigs.get(element)?.onRazorClick?.(event);
            }
        });
        element.addEventListener('pointermove', event => {
            if (this.toolMode !== 'select' || this.dragState) {
                return;
            }
            const rect = this.expandedChipHitRect(element);
            const hoverDetail = this.dragListenerConfigs.get(element)!.detail(event, rect);
            const resizing = hoverDetail.kind === 'cut-trim' || hoverDetail.kind === 'audio-trim'
                || (hoverDetail.kind === 'caption' && hoverDetail.mode !== 'move')
                || (hoverDetail.kind === 'layer' && hoverDetail.mode !== 'move')
                || (hoverDetail.kind === 'overlay' && hoverDetail.mode === 'resize');
            element.style.cursor = resizing ? 'ew-resize' : 'default';
        });
        element.addEventListener('pointerdown', event => {
            const dragDetail = this.dragListenerConfigs.get(element)!.detail(event, this.expandedChipHitRect(element));
            const lockedTrackId = this.trackIdOfDrag(dragDetail);
            if (this.isTrackLocked(lockedTrackId)) {
                this.showLockedTrack(lockedTrackId, event);
                event.stopPropagation();
                if (event.button === 0) {
                    const selected = this.selectionFromDragState(dragDetail);
                    if (event.shiftKey) this.toggleMultiSelection(selected);
                    else this.applySelection(selected);
                }
                return;
            }
            if (event.button !== 0) {
                return;
            }
            if (this.toolMode === 'razor') {
                // レザー中はドラッグを開始しない。クリックは上の 'click' リスナーが処理する。
                return;
            }
            if (this.dragState) {
                // 前回の pointerup を取りこぼした残留状態を破棄して自己回復する。
                this.cancelDrag(this.dragState);
            }
            event.preventDefault();
            event.stopPropagation();
            const ghost = this.createDragGhost(element);
            this.strip.appendChild(ghost);
            const state = {
                ...this.dragListenerConfigs.get(element)!.detail(event, this.expandedChipHitRect(element)),
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                element,
                ghost,
                dragged: false
            } as DragState;
            this.dragState = state;
            element.style.cursor = 'grabbing';
            element.style.opacity = '.5';
            if (state.kind === 'cut-trim' && state.edge === 'right') {
                // Out 側トリムの開始と同時に実尺フェッチを先行キックする。初回ドラッグが
                // pointerup まで到達する前にキャッシュが温まっているようにするための保険
                // （「初回だけ素通し」対策。本体のクランプは commitDrag 側の保留処理が担保する）。
                const cut = this.cuts[state.index];
                const videoUri = cut ? this.cutVideoUri(cut) : '';
                if (videoUri) {
                    void this.ensureVideoDurationFetch(videoUri);
                }
            }
            if (state.kind === 'audio-trim' && state.edge === 'right') {
                // cut-trim と同じ「初回だけ素通し」対策（上記コメント参照）。
                const sfx = this.audioSfx.find(candidate => candidate.id === state.id);
                if (sfx && this.location?.editUri) {
                    const audioUri = this.resolveEditMediaUri(sfx.path, this.location.editUri).toString();
                    void this.ensureAudioDurationFetch(sfx.path, audioUri);
                }
            }
            try {
                element.setPointerCapture(event.pointerId);
            } catch {
                // Pointer capture can fail if the element is detached during a file refresh.
            }
        });
        element.addEventListener('pointermove', event => {
            const state = this.dragState;
            if (!state || state.element !== element || state.pointerId !== event.pointerId) {
                return;
            }
            event.preventDefault();
            const verticalMove = ((state.kind === 'overlay' && state.mode === 'move')
                || state.kind === 'cut-move' || (state.kind === 'layer' && state.mode === 'move') || state.kind === 'audio')
                && Math.abs(event.clientY - state.startClientY) > DRAG_THRESHOLD_PX;
            if (Math.abs(event.clientX - state.startClientX) > DRAG_THRESHOLD_PX || verticalMove) {
                state.dragged = true;
            }
            this.updateDragPreview(state, event.clientX, event.clientY, state.dragged);
        });
        element.addEventListener('pointerup', event => {
            const state = this.dragState;
            if (!state || state.element !== element || state.pointerId !== event.pointerId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (!state.dragged) {
                this.cancelDrag(state);
                // ソーストリマー（R6c-2）: クリップ本体（cut-move 判定＝エッジ以外）へのダブルクリックで
                // トリマーモードへ入る。ブラウザ標準 'dblclick' は上記 preventDefault により
                // 合成されないため、pointerup ベースの自前判定（detectCutDoubleClick）で代替する。
                if (state.kind === 'cut-move'
                    && this.detectCutDoubleClick(state.index, event.clientX, event.clientY)) {
                    this.toggleTrimmerMode(state.index);
                    return;
                }
                // 音声クリップは pointerup ベースの自前ダブルクリック判定から専用エディタを開く。
                // ソーストリマーの入口はコンテキストメニュー「トリム（in/out）」へ移した。
                if (state.kind === 'audio'
                    && this.detectAudioDoubleClick(state.id, event.clientX, event.clientY)) {
                    void this.openAudioKeyframeEditor(state.id);
                    return;
                }
                const selected = this.selectionFromDragState(state);
                if (selected.kind !== 'cut' && selected.kind !== 'audio') {
                    const treeRow = this.timelineTreeRows.find(row => row.id === selected.id);
                    if (treeRow && this.detectTreeDoubleClick(treeRow.id, event.clientX, event.clientY)) {
                        this.enterTreeItem(treeRow);
                        return;
                    }
                }
                if (event.shiftKey) this.toggleMultiSelection(selected);
                else this.applySelection(selected);
                this.selectTimeAtClientX(event.clientX);
                return;
            }
            const preview = this.updateDragPreview(state, event.clientX, event.clientY, true);
            this.cancelDrag(state);
            void this.commitDrag(preview);
        });
        element.addEventListener('pointercancel', event => {
            const state = this.dragState;
            if (state && state.element === element && state.pointerId === event.pointerId) {
                this.cancelDrag(state);
            }
        });
    }

    protected updateDragPreview(state: DragState, clientX: number, clientY: number, allowGuide: boolean): DragPreview {
        const rect = this.strip.getBoundingClientRect();
        const duration = this.visibleDuration();
        // strip 全体で秒/px の縮尺は一定なので、この delta は source 秒・出力秒のどちらにもそのまま使える。
        // トリマーモード中のクリップ本体も通常表示と同一スケールのため、専用の写像は不要
        // （R6c2r2 で撤去。cut-slip もこの delta をそのまま使う）。
        const delta = rect.width > 0 ? (clientX - state.startClientX) / rect.width * duration : 0;
        const showGuide = allowGuide && this.snapEnabled;
        if (state.kind === 'cut-trim') {
            const cut = this.cuts[state.index];
            const segment = this.segments[state.index];
            const videoUri = cut ? this.cutVideoUri(cut) : '';
            let maxOutSeconds: number | undefined;
            let durationUnavailable = false;
            let durationPending = false;
            if (state.edge === 'right') {
                if (videoUri) {
                    const cachedDuration = this.videoDurationCache.get(videoUri);
                    if (typeof cachedDuration === 'number') {
                        maxOutSeconds = cachedDuration;
                    } else if (cachedDuration === 'unavailable') {
                        durationUnavailable = true;
                        this.showVideoDurationUnavailableNotice();
                    } else {
                        durationPending = true;
                        void this.ensureVideoDurationFetch(videoUri);
                    }
                } else {
                    // 動画パスそのものが解決できない（source 情報が edit.json に無い等）。
                    // 実尺不明と同じ扱いにし、警告を欠かさず出す（無言でクランプ無効化しない）。
                    durationUnavailable = true;
                    this.showVideoDurationUnavailableNotice();
                }
            }
            const durationWarningSuffix = state.edge !== 'right'
                ? '' : durationUnavailable
                    ? ' ⚠ 実尺不明のため無制限'
                    : durationPending ? ' (実尺確認中…)' : '';
            const rawProposed = state.edge === 'left'
                ? state.originalIn + delta : state.originalOut + delta;
            const durationClamped = maxOutSeconds !== undefined && rawProposed > maxOutSeconds;
            const proposed = Math.max(0, state.edge === 'right' && maxOutSeconds !== undefined
                ? Math.min(rawProposed, maxOutSeconds) : rawProposed);
            let input = state.edge === 'left' ? proposed : state.originalIn;
            let output = state.edge === 'right' ? proposed : state.originalOut;
            let snapped = false;
            let spanStart: number;
            let spanEnd: number;
            if (segment && cut) {
                const rawDuration = Math.max(0, output - input);
                const rawSpanStart = state.edge === 'left'
                    ? segment.tlEnd - rawDuration / segment.speed : segment.tlStart;
                const rawSpanEnd = state.edge === 'right'
                    ? segment.tlStart + rawDuration / segment.speed : segment.tlEnd;
                const movingEdge = state.edge === 'left' ? rawSpanStart : rawSpanEnd;
                // 候補は見えている端だけ（自クリップの元の両端 + 他アイテムの端 + 再生ヘッド）。
                // 単語境界は画面に無いので吸着先にしない（2026-09-02 実機報告「変なところで効く」）。
                const snap = durationClamped
                    ? { time: movingEdge, snapped: false }
                    : this.snapTimeInOutputSpaceWithResult(
                        movingEdge,
                        showGuide,
                        [{ time: segment.tlStart }, { time: segment.tlEnd }],
                        { kind: 'cut', id: String(state.index) }
                    );
                snapped = snap.snapped;
                if (durationClamped) {
                    this.hideSnapGuide();
                }
                if (state.edge === 'left') {
                    spanStart = snap.time;
                    spanEnd = segment.tlEnd;
                    input = Math.max(0, output - (spanEnd - spanStart) * segment.speed);
                } else {
                    spanStart = segment.tlStart;
                    spanEnd = snap.time;
                    output = input + (spanEnd - spanStart) * segment.speed;
                    if (maxOutSeconds !== undefined && output > maxOutSeconds) {
                        output = maxOutSeconds;
                        spanEnd = spanStart + (output - input) / segment.speed;
                        snapped = false;
                        this.hideSnapGuide();
                    }
                }
                const newDuration = Math.max(0, output - input);
                const rejected = this.cutWouldOverlap(
                    state.index, spanStart, spanEnd - spanStart, segment.track
                );
                this.setGhostRange(state.ghost, spanStart, spanEnd);
                this.setGhostRejected(state.ghost, rejected);
                this.setGhostSnapped(state.ghost, snapped && !rejected);
                this.setGhostDurationWarning(state.ghost, durationUnavailable);
                this.updateDragFeedback(state, rejected
                    ? '⚠ 重なるためトリムできません'
                    : `${state.edge === 'left' ? 'In' : 'Out'} ${this.formatTimestamp(state.edge === 'left' ? input : output)} / 尺 ${newDuration.toFixed(2)} 秒${durationWarningSuffix}`);
                this.updateGhostHeaderDuration(state.ghost, newDuration);
                return {
                    kind: 'cut-trim', index: state.index, edge: state.edge, input, output, rejected, maxOutSeconds
                };
            } else {
                const snap = this.snapTimeInSourceSpaceWithResult(
                    proposed, showGuide,
                    [{ time: state.originalIn }, { time: state.originalOut }]
                );
                snapped = snap.snapped;
                input = state.edge === 'left' ? snap.time : state.originalIn;
                output = state.edge === 'right' ? snap.time : state.originalOut;
                this.setGhostRange(state.ghost, input, output);
            }
            this.setGhostRejected(state.ghost, false);
            this.setGhostSnapped(state.ghost, snapped);
            this.setGhostDurationWarning(state.ghost, durationUnavailable);
            const newDuration = Math.max(0, output - input);
            this.updateDragFeedback(state, `${state.edge === 'left' ? 'In' : 'Out'} ${this.formatTimestamp(state.edge === 'left' ? input : output)} / 尺 ${newDuration.toFixed(2)} 秒${durationWarningSuffix}`);
            this.updateGhostHeaderDuration(state.ghost, newDuration);
            return {
                kind: 'cut-trim', index: state.index, edge: state.edge, input, output, rejected: false, maxOutSeconds
            };
        }
        if (state.kind === 'cut-move') {
            const snap = this.snapMovingRangeInOutputSpace(
                state.originalAt + delta, state.duration, showGuide,
                [{ time: state.originalAt }, { time: state.originalAt + state.duration }]
            );
            const at = Math.max(0, snap.time);
            const hit = this.trackAtClientY('cut', this.laneLayout.cutTracks, clientY, state.originalTrack);
            if (hit.insertIndex !== undefined && !hit.rejected) {
                this.showTrackInsertIndicatorAt(hit.top);
            } else {
                this.hideTrackInsertIndicator();
            }
            const rejected = hit.rejected;
            this.setGhostRange(state.ghost, at, at + state.duration);
            state.ghost.style.top = `${hit.top}px`;
            this.setGhostRejected(state.ghost, rejected);
            this.setGhostSnapped(state.ghost, snap.snapped && !rejected);
            this.updateDragFeedback(state, rejected
                ? '⚠ レーンが異なります'
                : `${this.formatTimestamp(at)} / 行 ${hit.track + 1}`);
            return {
                kind: 'cut-move', index: state.index, at, track: hit.track, rejected,
                insertTrack: hit.insertTrack, targetTrackId: hit.targetTrackId, insertIndex: hit.insertIndex
            };
        }
        if (state.kind === 'caption') {
            let start = state.originalStart;
            let end = state.originalEnd;
            let snapped = false;
            let timeDomain: 'source' | 'output' = state.originalTimeDomain ?? 'source';
            let outputStart: number | undefined;
            let outputEnd: number | undefined;
            const originalEdges = [{ time: state.originalStart }, { time: state.originalEnd }];
            const originalRanges = this.captionRangeToOutputRanges(
                state.id, state.originalStart, state.originalEnd
            );
            const originalOutputStart = originalRanges[0]?.[0];
            const originalOutputEnd = originalRanges[originalRanges.length - 1]?.[1];
            if (timeDomain === 'output') {
                if (state.mode === 'move') {
                    const snap = this.snapMovingRangeInOutputSpace(
                        state.originalStart + delta,
                        state.originalEnd - state.originalStart,
                        showGuide,
                        originalEdges
                    );
                    start = Math.max(0, snap.time);
                    end = state.originalEnd + (start - state.originalStart);
                    snapped = snap.snapped;
                } else {
                    const originalEdge = state.mode === 'start' ? state.originalStart : state.originalEnd;
                    const snap = this.snapTimeInOutputSpaceWithResult(
                        Math.max(0, originalEdge + delta), showGuide, originalEdges
                    );
                    snapped = snap.snapped;
                    if (state.mode === 'start') start = snap.time;
                    else end = snap.time;
                }
                outputStart = start;
                outputEnd = end;
            } else if (state.mode === 'move') {
                const snap = this.snapTimeInSourceSpaceWithResult(
                    state.originalStart + delta, showGuide, originalEdges
                );
                // 0 秒より前へは置けない（2026-09-02 実機: 0:00 へ寄せると -0:00 になっていた）
                start = Math.max(0, snap.time);
                snapped = snap.snapped;
                end = state.originalEnd + (start - state.originalStart);
            } else {
                const edge = state.mode;
                const originalOutputEdge = edge === 'start' ? originalOutputStart : originalOutputEnd;
                const snap = this.snapTimeInOutputSpaceWithResult(
                    Math.max(0, (originalOutputEdge ?? (edge === 'start'
                        ? state.originalStart : state.originalEnd)) + delta),
                    showGuide,
                    originalOutputStart !== undefined && originalOutputEnd !== undefined
                        ? [{ time: originalOutputStart }, { time: originalOutputEnd }]
                        : originalEdges
                );
                snapped = snap.snapped;
                if (originalOutputStart !== undefined && originalOutputEnd !== undefined) {
                    const source = this.captionSourceForMapping(state.id);
                    const resolved = resolveSourceCaptionEdgeDrag({
                        edge,
                        originalStart: state.originalStart,
                        originalEnd: state.originalEnd,
                        originalOutputStart,
                        originalOutputEnd,
                        proposedOutputEdge: snap.time,
                        ...(typeof source === 'string' ? { src: source } : {}),
                        segments: this.segments
                    });
                    start = resolved.start;
                    end = resolved.end;
                    outputStart = resolved.outputStart;
                    outputEnd = resolved.outputEnd;
                    if (resolved.convertsToOutput) timeDomain = 'output';
                } else if (edge === 'start') {
                    start = Math.max(0, snap.time);
                } else {
                    end = snap.time;
                }
            }
            start = Math.max(0, start);
            if (timeDomain === 'output') {
                const clamped = clampCaptionOutputRange(start, end, this.totalDuration());
                start = clamped.start;
                end = clamped.end;
                outputStart = start;
                outputEnd = end;
            }
            // 同じ時間群の隣の字幕へ食い込まない位置で止める（拒否はしない）。lint captions.overlap が
            // error にする重なりを、書き込む前に作らない（task 2026-09-02-timeline-caption-overlap-guard）。
            const guard = clampCaptionRangeToNeighbors({
                id: state.id, start, end, mode: state.mode,
                neighbors: this.captionOverlapNeighbors(state.id, timeDomain),
                minDuration: MINIMUM_ITEM_DURATION,
                // 正当な位置が作れないときはドラッグ前の区間へ戻す（0 秒側へ押し出さない）
                fallback: timeDomain === 'output' && state.originalTimeDomain !== 'output'
                    ? { start: originalOutputStart ?? state.originalStart, end: originalOutputEnd ?? state.originalEnd }
                    : { start: state.originalStart, end: state.originalEnd }
            });
            const blockedByNeighbor = guard.clamped;
            if (guard.clamped) {
                start = guard.start;
                end = guard.end;
                if (timeDomain === 'output') {
                    outputStart = start;
                    outputEnd = end;
                } else {
                    // source 時間軸はクランプ後の区間を出力秒へ写し直す
                    outputStart = undefined;
                    outputEnd = undefined;
                }
            }
            if (outputStart === undefined || outputEnd === undefined) {
                const ranges = timeDomain === 'output'
                    ? [[start, end] as [number, number]]
                    : this.captionRangeToOutputRanges(state.id, start, end);
                outputStart = ranges[0]?.[0];
                outputEnd = ranges[ranges.length - 1]?.[1];
            }
            if (outputStart !== undefined && outputEnd !== undefined) {
                this.setGhostRange(state.ghost, outputStart, outputEnd);
            }
            this.setGhostSnapped(state.ghost, snapped && !blockedByNeighbor);
            this.setGhostOutputDomain(state.ghost, timeDomain === 'output');
            const rangeText = timeDomain === 'output' && state.originalTimeDomain !== 'output'
                ? `出力時間の字幕に変換 ${this.formatTimestamp(start)} – ${this.formatTimestamp(end)}`
                : `${this.formatTimestamp(start)} – ${this.formatTimestamp(end)}`;
            this.updateDragFeedback(state, blockedByNeighbor ? `${rangeText}（隣の字幕で止まりました）` : rangeText);
            return {
                kind: 'caption', id: state.id,
                start, end, timeDomain,
                ...(timeDomain === 'output' ? { storedTimeDomain: 'output' as const }
                    : state.originalTimeDomain !== undefined
                        ? { storedTimeDomain: state.originalTimeDomain } : {}),
                originalStart: state.originalStart,
                originalEnd: state.originalEnd,
                originalTimeDomain: state.originalTimeDomain,
                originalEdited: state.originalEdited
            };
        }
        if (state.kind === 'layer') {
            let t = state.originalT;
            let itemDuration = state.originalDuration;
            let track = state.originalTrack;
            let rejected = false;
            let insertTrack: number | undefined;
            let targetTrackId: string | undefined;
            let insertIndex: number | undefined;
            let snapped = false;
            const originalEdges = [
                { time: state.originalT },
                { time: state.originalT + state.originalDuration }
            ];
            if (state.mode === 'start') {
                const snap = this.snapTimeInOutputSpaceWithResult(
                    Math.max(0, state.originalT + delta), showGuide, originalEdges
                );
                t = snap.time;
                snapped = snap.snapped;
                itemDuration = state.originalDuration + (state.originalT - t);
            } else if (state.mode === 'end') {
                const snap = this.snapTimeInOutputSpaceWithResult(
                    state.originalT + state.originalDuration + delta, showGuide, originalEdges
                );
                itemDuration = snap.time - state.originalT;
                snapped = snap.snapped;
            } else {
                const snap = this.snapMovingRangeInOutputSpace(
                    state.originalT + delta, state.originalDuration, showGuide, originalEdges
                );
                t = Math.max(0, snap.time);
                snapped = snap.snapped;
                const hit = this.trackAtClientY(
                    'layer', this.laneLayout.layerTracks, clientY, state.originalTrack
                );
                if (hit.insertTrack !== undefined && !hit.rejected) {
                    this.showTrackInsertIndicatorAt(hit.top);
                } else {
                    this.hideTrackInsertIndicator();
                }
                track = hit.track;
                rejected = hit.rejected;
                insertTrack = hit.insertTrack;
                targetTrackId = hit.targetTrackId;
                insertIndex = hit.insertIndex;
                state.ghost.style.top = `${hit.top}px`;
            }
            this.setGhostRange(state.ghost, t, t + Math.max(0, itemDuration));
            this.setGhostRejected(state.ghost, rejected);
            this.setGhostSnapped(state.ghost, snapped && !rejected);
            this.updateDragFeedback(state, rejected
                ? '⚠ レーンが異なるため移動できません'
                : `${this.formatTimestamp(t)} / 尺 ${itemDuration.toFixed(2)} 秒 / 行 ${track + 1}`);
            return {
                kind: 'layer', id: state.id, t, duration: itemDuration, track, rejected, insertTrack,
                targetTrackId, insertIndex
            };
        }
        if (state.kind === 'audio') {
            const snap = this.snapMovingRangeInOutputSpace(
                state.originalT + delta, state.originalDuration, showGuide,
                [
                    { time: state.originalT },
                    { time: state.originalT + state.originalDuration }
                ]
            );
            const t = Math.max(0, snap.time);
            const hit = this.trackAtClientY(
                'audio', this.laneLayout.audioTracks, clientY, state.originalTrack
            );
            this.hideTrackInsertIndicator();
            this.setGhostRange(state.ghost, t, t + state.originalDuration);
            state.ghost.style.top = `${hit.top}px`;
            this.setGhostRejected(state.ghost, hit.rejected);
            this.setGhostSnapped(state.ghost, snap.snapped && !hit.rejected);
            this.updateDragFeedback(state, hit.rejected
                ? '⚠ 映像のレーンには音を置けません'
                : `${this.formatTimestamp(t)} / 行 ${hit.track + 1}`);
            return {
                kind: 'audio', id: state.id, t, track: hit.track, rejected: hit.rejected,
                targetTrackId: hit.targetTrackId, insertIndex: hit.insertIndex
            };
        }
        if (state.kind === 'audio-trim') {
            const sfx = this.audioSfx.find(candidate => candidate.id === state.id);
            let maxOutSeconds: number | undefined;
            let durationUnavailable = false;
            let durationPending = false;
            if (state.edge === 'right' && sfx) {
                const cachedDuration = this.audioDurationCache.get(sfx.path);
                if (typeof cachedDuration === 'number') {
                    maxOutSeconds = cachedDuration;
                } else if (cachedDuration === 'unavailable') {
                    durationUnavailable = true;
                } else {
                    durationPending = true;
                    if (this.location?.editUri) {
                        const audioUri = this.resolveEditMediaUri(sfx.path, this.location.editUri).toString();
                        void this.ensureAudioDurationFetch(sfx.path, audioUri);
                    }
                }
            }
            const durationWarningSuffix = state.edge !== 'right' ? '' : durationUnavailable
                ? ' ⚠ 実尺不明のため無制限' : durationPending ? ' (実尺確認中…)' : '';
            let input = state.originalIn;
            let output = state.originalOut;
            let snapped = false;
            // 動かしている端を出力秒に写してマグネットへ通す（2026-09-02 実機報告「下の素材の IN/OUT で
            // マグネットが効かない」= 音声クリップの端トリムだけ吸着が無かった）。吸着後に素材の
            // 実尺・最小尺・0 秒の制約を掛け直す。
            const originalEdges = [
                { time: state.originalT },
                { time: state.originalT + (state.originalOut - state.originalIn) }
            ];
            if (state.edge === 'left') {
                const snap = this.snapTimeInOutputSpaceWithResult(
                    state.originalT + delta, showGuide, originalEdges, { kind: 'audio', id: state.id }
                );
                snapped = snap.snapped;
                const rawInput = state.originalIn + (snap.time - state.originalT);
                const minInputForT = Math.max(0, state.originalIn - state.originalT);
                input = Math.min(
                    Math.max(rawInput, minInputForT),
                    output - MINIMUM_SFX_TRIM_DURATION
                );
                input = Math.max(0, input);
            } else {
                const snap = this.snapTimeInOutputSpaceWithResult(
                    state.originalT + (state.originalOut - state.originalIn) + delta, showGuide, originalEdges,
                    { kind: 'audio', id: state.id }
                );
                snapped = snap.snapped;
                const rawOutput = state.originalIn + (snap.time - state.originalT);
                const cappedOutput = maxOutSeconds !== undefined ? Math.min(rawOutput, maxOutSeconds) : rawOutput;
                output = Math.max(cappedOutput, input + MINIMUM_SFX_TRIM_DURATION);
            }
            const t = state.edge === 'left'
                ? Math.max(0, state.originalT + (input - state.originalIn))
                : state.originalT;
            this.setGhostRange(state.ghost, t, t + Math.max(0, output - input));
            this.setGhostRejected(state.ghost, false);
            this.setGhostSnapped(state.ghost, snapped);
            this.updateDragFeedback(state,
                `${state.edge === 'left' ? 'In' : 'Out'} ${this.formatTimestamp(state.edge === 'left' ? input : output)} `
                + `/ 尺 ${(output - input).toFixed(2)} 秒${durationWarningSuffix}`
                + this.sfxFadeFeedbackSuffix(sfx, output - input));
            return { kind: 'audio-trim', id: state.id, edge: state.edge, t, in: input, out: output };
        }
        if (state.kind === 'audio-slip') {
            // 音声クリップ版 cut-slip（task 2026-08-18-audio-clip-trimmer-dblclick）。純関数部分は
            // common/audio-clip-trimmer.ts の slipAudioWindow に切り出してテストする
            // （cut-slip はインライン実装のまま・音声側は新規追加のため最初からテスト可能にする）。
            const { in: nextIn, out: nextOut } = slipAudioWindow(
                state.originalIn, state.originalOut, delta, state.sourceDuration
            );
            this.updateTrimmerSlipVisual(state.element, nextIn - state.originalIn);
            const sfx = this.audioSfx.find(candidate => candidate.id === state.id);
            this.updateDragFeedback(
                state, `slip In ${this.formatTimestamp(nextIn)} / Out ${this.formatTimestamp(nextOut)}`
                + this.sfxFadeFeedbackSuffix(sfx, nextOut - nextIn)
            );
            return { kind: 'audio-slip', id: state.id, in: nextIn, out: nextOut };
        }
        if (state.kind === 'cut-slip') {
            // slip: out−in（尺）と t（タイムライン位置）を固定したまま in/out を同量シフトする。
            // タイムライン上の位置・尺が変化しないため、cutWouldOverlap 等の重なり判定は不要。
            const winDuration = state.originalOut - state.originalIn;
            let nextIn = state.originalIn + delta;
            let nextOut = state.originalOut + delta;
            if (nextIn < 0) {
                nextIn = 0;
                nextOut = winDuration;
            }
            if (nextOut > state.sourceDuration) {
                nextOut = state.sourceDuration;
                nextIn = Math.max(0, state.sourceDuration - winDuration);
            }
            this.updateTrimmerSlipVisual(state.element, nextIn - state.originalIn);
            this.updateDragFeedback(
                state, `slip In ${this.formatTimestamp(nextIn)} / Out ${this.formatTimestamp(nextOut)}`
            );
            return { kind: 'cut-slip', index: state.index, in: nextIn, out: nextOut };
        }
        if (state.mode === 'move') {
            const snap = this.snapMovingRangeInOutputSpace(
                state.originalStart + delta, state.originalDuration, showGuide,
                [
                    { time: state.originalStart },
                    { time: state.originalStart + state.originalDuration }
                ]
            );
            const start = Math.max(0, snap.time);
            this.setGhostRange(state.ghost, start, start + state.originalDuration);
            this.setGhostSnapped(state.ghost, snap.snapped);
            const hit = this.trackAtClientY(
                'overlay', this.overlayTrackLayouts, clientY, state.originalTrack
            );
            if (hit.insertTrack !== undefined && !hit.rejected) {
                this.showTrackInsertIndicatorAt(hit.top);
            } else {
                this.hideTrackInsertIndicator();
            }
            state.ghost.style.top = `${hit.top}px`;
            state.ghost.dataset.akariTrack = String(hit.track);
            this.updateDragFeedback(state, `${this.formatTimestamp(start)} / 尺 ${state.originalDuration.toFixed(2)} 秒`);
            return {
                kind: 'overlay-move', id: state.id, start, track: hit.track,
                insertTrack: hit.insertTrack, targetTrackId: hit.targetTrackId, insertIndex: hit.insertIndex
            };
        }
        const snap = this.snapTimeInOutputSpaceWithResult(
            state.originalStart + state.originalDuration + delta, showGuide,
            [
                { time: state.originalStart },
                { time: state.originalStart + state.originalDuration }
            ]
        );
        const end = snap.time;
        this.setGhostRange(state.ghost, state.originalStart, end);
        this.setGhostSnapped(state.ghost, snap.snapped);
        this.updateDragFeedback(state, `尺 ${(end - state.originalStart).toFixed(2)} 秒`);
        return { kind: 'overlay-resize', id: state.id, duration: end - state.originalStart };
    }

    /**
     * トリム/スリップ中のドラッグフィードバックに付ける fade 情報の接尾辞（task
     * 2026-08-18-audio-clip-trimmer-dblclick、受け入れ条件 §5「トリムで尺が縮んだらフェード表示も
     * 追随」）。R6 契約 §5 と同じ「fade_in/fade_out をそれぞれ独立に実効尺の半分までクランプ」
     * 規則（clampSfxFadeToEffectiveDuration）を、ドラッグ中の実効尺（effectiveDurationSeconds =
     * out−in の途中経過値）へその都度適用する。fade_in/fade_out が未設定・クランプ後 0 の
     * クリップでは空文字を返す（表示を増やさない）。
     */
    protected sfxFadeFeedbackSuffix(sfx: EditAudioSfxWithFade | undefined, effectiveDurationSeconds: number): string {
        if (!sfx || (sfx.fadeIn === undefined && sfx.fadeOut === undefined)) {
            return '';
        }
        const { fadeIn, fadeOut } = clampSfxFadeToEffectiveDuration(sfx.fadeIn, sfx.fadeOut, effectiveDurationSeconds);
        if (fadeIn <= 0 && fadeOut <= 0) {
            return '';
        }
        return ` / fade ${fadeIn.toFixed(2)}〜${fadeOut.toFixed(2)}秒`;
    }

    protected updateDragFeedback(state: DragState, text: string): void {
        if (!state.dragged) {
            this.dragFeedback.style.display = 'none';
            return;
        }
        this.dragFeedback.textContent = text;
        this.dragFeedback.style.left = state.ghost.style.left;
        const ghostTop = parseFloat(state.ghost.style.top || '0');
        const viewportTop = RULER_BAND_HEIGHT_PX + ghostTop - this.stripScroll.scrollTop;
        this.dragFeedback.style.top = `${Math.max(0, viewportTop - 18)}px`;
        this.dragFeedback.style.display = 'block';
    }

    protected showTrackInsertIndicatorAt(stripLocalTop: number): void {
        const viewportTop = RULER_BAND_HEIGHT_PX + stripLocalTop - this.stripScroll.scrollTop;
        this.trackInsertIndicator.style.top = `${viewportTop}px`;
        this.trackInsertIndicator.style.display = 'block';
    }

    protected hideTrackInsertIndicator(): void {
        this.trackInsertIndicator.style.display = 'none';
    }

    /** トリム中、ゴースト（クリップの複製）のヘッダー尺表示をリアルタイム更新する（レガシー準拠の数値フィードバック）。 */
    protected updateGhostHeaderDuration(ghost: HTMLDivElement, durationSeconds: number): void {
        const durationSpan = ghost.querySelector<HTMLElement>('.akari-annotations-strip-clip-header-duration');
        if (durationSpan) {
            durationSpan.textContent = this.formatFrameTimestamp(Math.max(0, durationSeconds), this.fps);
        }
    }

    protected trackAtClientY(
        kind: 'cut' | 'layer' | 'overlay' | 'audio',
        _layouts: readonly TrackGroupLayout[],
        clientY: number,
        originalTrack: number
    ): { track: number; top: number; rejected: boolean; insertTrack?: number;
        targetTrackId?: string; insertIndex?: number } {
        const localY = clientY - this.strip.getBoundingClientRect().top;
        if (kind === 'audio') {
            const layouts = this.laneLayout.audioTracks;
            if (layouts.length === 0) return { track: originalTrack, top: 0, rejected: true };
            const hit = layouts.find(layout =>
                localY >= layout.top && localY < layout.top + layout.height + LANE_GAP);
            const target = hit ?? layouts.find(layout => layout.track === originalTrack) ?? layouts[0];
            return {
                track: target.track, top: target.top, rejected: false, targetTrackId: target.id
            };
        }
        const rawTracks = Array.isArray(this.editDocument?.tracks)
            ? this.editDocument!.tracks as Array<Record<string, unknown>> : [];
        const hit = hitTestTimelineTrackDrop(
            localY, this.timelineTrackDropLayouts(rawTracks), originalTrack
        );
        return {
            track: hit.track,
            top: hit.top,
            rejected: hit.rejected,
            targetTrackId: hit.targetTrackId,
            ...(hit.insertIndex === undefined ? {} : {
                insertTrack: hit.insertIndex,
                insertIndex: hit.insertIndex
            })
        };
    }

    protected timelineTrackDropLayouts(
        rawTracks: readonly Record<string, unknown>[]
    ): TimelineTrackDropLayout[] {
        return this.laneLayout.tracks.flatMap(layout => {
            const rawIndex = rawTracks.findIndex(track => track.id === layout.id);
            if (rawIndex < 0 || !layout.id) return [];
            const raw = rawTracks[rawIndex];
            if (raw.lane !== 'visual' && raw.lane !== 'audio') return [];
            return [{
                id: layout.id,
                lane: raw.lane,
                acceptsItems: Array.isArray(raw.items),
                rawIndex,
                track: layout.track,
                top: layout.top,
                height: layout.height
            }];
        });
    }

    protected laneKindAtLocalY(localY: number): 'cut' | 'layer' | 'overlay' | 'audio' | 'foreign' | 'none' {
        if (this.inBounds(localY, this.audioBandBounds())) {
            return 'audio';
        }
        if (this.laneLayout.layerTracks.some(layout => this.inBounds(localY, layout))) {
            return 'layer';
        }
        if (this.laneLayout.cutTracks.some(layout => this.inBounds(localY, layout))) {
            return 'cut';
        }
        if (this.laneLayout.overlayTracks.some(layout => this.inBounds(localY, layout))) {
            return 'overlay';
        }
        if (this.inBounds(localY, this.laneLayout.beats) || this.inBounds(localY, this.laneLayout.captions)
        ) {
            return 'foreign';
        }
        return 'none';
    }

    protected inBounds(value: number, bounds: LaneBounds): boolean {
        return bounds.height > 0 && value >= bounds.top && value < bounds.top + bounds.height + LANE_GAP;
    }

    protected cutWouldOverlap(index: number, at: number, duration: number, track: number): boolean {
        const end = at + duration;
        return this.segments.some(segment => {
            if (segment.index === index || segment.track !== track) {
                return false;
            }
            const overlap = Math.min(end, segment.tlEnd) - Math.max(at, segment.tlStart);
            if (overlap <= 0) {
                return false;
            }
            return overlap > this.allowedTransitionOverlap(index, segment.index, track) + 1e-4;
        });
    }

    /** 直接隣接する同一トラックのカット間で許容されるトランジション重複秒数。 */
    protected allowedTransitionOverlap(indexA: number, indexB: number, track: number): number {
        const earlier = Math.min(indexA, indexB);
        const later = Math.max(indexA, indexB);
        for (let index = earlier + 1; index < later; index++) {
            const between = this.cuts[index];
            const betweenTrack = typeof between?.track === 'number'
                && Number.isInteger(between.track) && between.track >= 0 ? between.track : 0;
            if (betweenTrack === track) {
                return 0;
            }
        }
        return this.cuts[earlier]?.transitionOut?.duration ?? 0;
    }

    protected setGhostRejected(ghost: HTMLDivElement, rejected: boolean): void {
        ghost.classList.toggle('akari-annotations-ghost-rejected', rejected);
    }

    protected setGhostSnapped(ghost: HTMLDivElement, snapped: boolean): void {
        ghost.classList.toggle('akari-annotations-ghost-snapped', snapped);
    }

    /** 実尺が確認できない Out トリム中であることを、ドラッグのたびに視認できる形で示す。 */
    protected setGhostDurationWarning(ghost: HTMLDivElement, warning: boolean): void {
        ghost.classList.toggle('akari-annotations-ghost-duration-warning', warning);
    }

    protected setGhostOutputDomain(ghost: HTMLDivElement, outputDomain: boolean): void {
        ghost.classList.toggle('akari-annotations-ghost-output-domain', outputDomain);
    }

    protected setGhostRange(ghost: HTMLDivElement, start: number, end: number): void {
        ghost.style.left = `${this.percent(start)}%`;
        ghost.style.width = `${Math.max(this.percent(end) - this.percent(start), 0.3)}%`;
    }

    /**
     * 字幕（source 時間軸）ドラッグ用。候補は source 秒に写した「見えている端」だけ:
     * cuts の in/out・source 時間軸の他の字幕の両端・再生ヘッド・0 秒。
     * 閾値内に候補が無ければ **そのままの値** を返す（旧: 0.25 秒グリッドへ落としていた）。
     */
    protected snapTimeInSourceSpace(
        value: number, showGuide: boolean, extraCandidates: readonly SnapCandidate[] = [],
        exclude?: SnapExclusion
    ): number {
        return this.snapTimeInSourceSpaceWithResult(value, showGuide, extraCandidates, exclude).time;
    }

    protected snapTimeInSourceSpaceWithResult(
        value: number, showGuide: boolean, extraCandidates: readonly SnapCandidate[] = [],
        exclude?: SnapExclusion
    ): SnapResult {
        if (!this.snapEnabled) {
            this.hideSnapGuide();
            return { time: value, snapped: false };
        }
        const threshold = this.snapThresholdSeconds();
        if (threshold === undefined) {
            return { time: value, snapped: false };
        }
        const result = resolveSnapTime(value, this.sourceSnapCandidates(extraCandidates, exclude), threshold);
        this.reflectSnapGuide(result, showGuide, time => this.sourceToOutput(time));
        return result;
    }

    /**
     * 位置移動・トリム・重ね物ドラッグ用（出力時間軸）。候補は「見えている端」だけ。
     * 閾値内に候補が無ければ **そのままの値** を返す。
     */
    protected snapTimeInOutputSpace(
        value: number, showGuide: boolean, extraCandidates: readonly SnapCandidate[] = [],
        exclude?: SnapExclusion
    ): number {
        return this.snapTimeInOutputSpaceWithResult(value, showGuide, extraCandidates, exclude).time;
    }

    protected snapTimeInOutputSpaceWithResult(
        value: number, showGuide: boolean, extraCandidates: readonly SnapCandidate[] = [],
        exclude?: SnapExclusion
    ): SnapResult {
        if (!this.snapEnabled) {
            this.hideSnapGuide();
            return { time: value, snapped: false };
        }
        const threshold = this.snapThresholdSeconds();
        if (threshold === undefined) {
            return { time: value, snapped: false };
        }
        const result = resolveSnapTime(value, this.outputSnapCandidates(extraCandidates, exclude), threshold);
        this.reflectSnapGuide(result, showGuide, time => time);
        return result;
    }

    protected snapMovingRangeInOutputSpace(
        start: number,
        duration: number,
        showGuide: boolean,
        extraCandidates: readonly SnapCandidate[] = [],
        exclude?: SnapExclusion
    ): SnapResult {
        if (!this.snapEnabled) {
            this.hideSnapGuide();
            return { time: start, snapped: false };
        }
        const threshold = this.snapThresholdSeconds();
        if (threshold === undefined) {
            return { time: start, snapped: false };
        }
        const result = resolveSnapRange(start, duration, this.outputSnapCandidates(extraCandidates, exclude), threshold);
        this.reflectSnapGuide(result, showGuide, time => time);
        return result;
    }

    /** 吸着したときだけガイド線を出す（候補が無いときは何も描かない）。 */
    protected reflectSnapGuide(result: SnapResult, showGuide: boolean, toOutput: (time: number) => number): void {
        if (result.snapped && result.candidate && showGuide) {
            this.showSnapGuideAt(toOutput(result.candidate.time), result.candidate.isPlayhead === true);
        } else {
            this.hideSnapGuide();
        }
    }

    /**
     * 出力時間軸で「見えている端」を集める: cuts のセグメント・v2 ツリーの行（重ね物・テロップ等）・
     * 字幕の出力区間・効果音・ナレーション、再生ヘッド、0 秒。ドラッグ中の本人（exclude）は除く。
     * 直前のクリック位置（selectedSourceT）や単語境界のような画面に無い点は入れない。
     */
    protected outputSnapCandidates(
        extraCandidates: readonly SnapCandidate[] = [],
        exclude?: SnapExclusion
    ): SnapCandidate[] {
        const items: SnapEdgeItem[] = [];
        for (const segment of this.segments) {
            items.push({ kind: 'cut', id: String(segment.index), start: segment.tlStart, end: segment.tlEnd });
        }
        for (const row of this.timelineTreeRows) {
            items.push({ kind: 'item', id: row.id, start: row.at, end: row.at + row.duration });
        }
        for (const caption of this.captions) {
            for (const [start, end] of this.captionRangeToOutputRanges(caption.id, caption.start, caption.end)) {
                items.push({ kind: 'caption', id: caption.id, start, end });
            }
        }
        for (const sfx of this.audioSfx) {
            items.push({ kind: 'audio', id: sfx.id, start: sfx.t, end: sfx.t + sfx.duration });
        }
        for (const narration of this.audioNarration) {
            items.push({
                kind: 'audio', id: narration.id, start: narration.t,
                end: narration.t + this.narrationDisplayDuration(narration)
            });
        }
        const excluded = exclude ? this.snapExclusionsFor(exclude) : [];
        const candidates = collectEdgeCandidates(items.filter(item =>
            !excluded.some(entry => entry.kind === item.kind && entry.id === item.id)));
        return [
            ...candidates,
            { time: this.playheadT, isPlayhead: true },
            { time: 0 },
            ...extraCandidates
        ].filter(candidate => Number.isFinite(candidate.time));
    }

    /** source 時間軸で「見えている端」を集める（source 時間軸の字幕ドラッグ用）。 */
    protected sourceSnapCandidates(
        extraCandidates: readonly SnapCandidate[] = [],
        exclude?: SnapExclusion
    ): SnapCandidate[] {
        const items: SnapEdgeItem[] = [];
        this.cuts.forEach((cut, index) => {
            items.push({ kind: 'cut', id: String(index), start: cut.in, end: cut.out });
        });
        for (const caption of this.captions) {
            if (caption.timeDomain === 'output') continue;
            items.push({ kind: 'caption', id: caption.id, start: caption.start, end: caption.end });
        }
        const excluded = exclude ? this.snapExclusionsFor(exclude) : [];
        const candidates = collectEdgeCandidates(items.filter(item =>
            !excluded.some(entry => entry.kind === item.kind && entry.id === item.id)));
        // 出力時間軸に置かれた物（重ね物・テロップ・効果音・ナレーション・output 字幕）の端も、
        // どこかのセグメント内にある限り source 秒へ写して候補にする（2026-09-02 実機報告
        // 「下の素材の IN/OUT でマグネットが効かない」= source 時間軸の字幕がこれらへ吸着しなかった）。
        const projected: SnapCandidate[] = this.outputSnapCandidates([], exclude)
            .filter(candidate => !candidate.isPlayhead
                && this.segments.some(segment => candidate.time >= segment.tlStart - 1e-9
                    && candidate.time <= segment.tlEnd + 1e-9))
            .map(candidate => ({ time: this.outputToSource(candidate.time) }));
        return [
            ...candidates,
            ...projected,
            { time: this.outputToSource(this.playheadT), isPlayhead: true },
            { time: 0 },
            ...extraCandidates
        ].filter(candidate => Number.isFinite(candidate.time));
    }

    /** ドラッグ中の本人を候補から外す。字幕は tree 行の写し（"…#<id>"）も同じ本人として扱う。 */
    protected snapExclusionsFor(exclude: SnapExclusion): SnapExclusion[] {
        const exclusions: SnapExclusion[] = [exclude];
        if (exclude.kind === 'caption') {
            const treeRow = this.captionTreeRow(exclude.id);
            if (treeRow) exclusions.push({ kind: 'item', id: treeRow.id });
        } else if (exclude.kind === 'item') {
            const separator = exclude.id.lastIndexOf('#');
            if (separator >= 0) exclusions.push({ kind: 'caption', id: exclude.id.slice(separator + 1) });
        } else if (exclude.kind === 'cut') {
            const itemId = this.cutItemIds[Number(exclude.id)];
            if (itemId) exclusions.push({ kind: 'item', id: itemId });
        } else if (exclude.kind === 'layer' || exclude.kind === 'overlay') {
            exclusions.push({ kind: 'item', id: exclude.id });
        }
        return exclusions;
    }

    protected snapThresholdSeconds(): number | undefined {
        const rect = this.strip.getBoundingClientRect();
        const threshold = snapThresholdSecondsFor(SNAP_THRESHOLD_PX, rect.width, this.visibleDuration());
        if (threshold === undefined) {
            this.hideSnapGuide();
        }
        return threshold;
    }

    /** ガイド線は常に出力軸座標へ射影して表示する。playhead へ吸着したときだけアンバーにする。 */
    protected showSnapGuideAt(outputTime: number, isPlayhead: boolean): void {
        this.snapGuide.style.left = `${this.percent(outputTime)}%`;
        this.snapGuide.style.background = isPlayhead ? SNAP_GUIDE_COLOR_PLAYHEAD : SNAP_GUIDE_COLOR_DEFAULT;
        this.snapGuide.style.display = 'block';
    }

    protected hideSnapGuide(): void {
        this.snapGuide.style.display = 'none';
    }

    protected cancelDrag(state: DragState): void {
        if (this.dragState !== state) {
            return;
        }
        try {
            if (state.element.hasPointerCapture(state.pointerId)) {
                state.element.releasePointerCapture(state.pointerId);
            }
        } catch {
            // The element may already have lost capture after pointercancel.
        }
        state.element.style.cursor = 'default';
        state.element.style.opacity = '';
        // スリップのライブプレビュー（updateTrimmerSlipVisual）が残した transform を戻す
        // （Esc 等の未確定キャンセルでは renderStrip が走らないことがあるため明示的にリセットする）。
        const trimmerContent = state.element.querySelector<HTMLDivElement>('.akari-annotations-strip-clip-trimmer-content');
        if (trimmerContent) {
            trimmerContent.style.transform = '';
        }
        state.ghost.remove();
        this.hideSnapGuide();
        this.hideTrackInsertIndicator();
        this.dragFeedback.style.display = 'none';
        this.dragState = undefined;
        if (this.renderStripPending) {
            this.renderStripPending = false;
            this.renderStrip();
        }
    }

    protected async commitDrag(preview: DragPreview): Promise<void> {
        const lockedTrackId = this.trackIdOfDrag(preview);
        if (this.isTrackLocked(lockedTrackId)) {
            this.showLockedTrack(lockedTrackId);
            return;
        }
        if ('targetTrackId' in preview && this.isTrackLocked(preview.targetTrackId)) {
            this.showLockedTrack(preview.targetTrackId);
            return;
        }
        const location = this.location;
        if (!location) return;
        if ("rejected" in preview && preview.rejected) {
            this.footer.textContent = "移動できません（レーンが異なるか、同じ段の中で区間が重なります）。";
            return;
        }
        if (preview.kind !== "caption") {
            await this.commitEditV2Drag(preview);
            return;
        }
        if (preview.start < 0 || preview.end - preview.start < MINIMUM_ITEM_DURATION) {
            this.showNotice("字幕が短すぎます（0.15 秒未満にはできません）");
            return;
        }
        try {
            const request = {
                captionsUri: location.captionsUri.toString(), projectRootUri: location.root.toString(),
                captionId: preview.id, start: preview.start, end: preview.end,
                timeDomain: preview.storedTimeDomain ?? null, edited: true
            } as const;
            const result = await this.annotationsService.setCaptionTiming(request);
            this.pushHistory({
                label: "字幕タイミングの調整",
                undo: async () => {
                    await this.annotationsService.setCaptionTiming({
                        captionsUri: location.captionsUri.toString(), projectRootUri: location.root.toString(),
                        captionId: preview.id, start: preview.originalStart, end: preview.originalEnd,
                        timeDomain: preview.originalTimeDomain ?? null, edited: preview.originalEdited
                    });
                    await this.reloadCaptions();
                },
                redo: async () => {
                    await this.annotationsService.setCaptionTiming(request);
                    await this.reloadCaptions();
                }
            });
            await this.reloadCaptions();
            this.footer.textContent = this.writeResultMessage("字幕のタイミングを調整しました。", result);
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice("字幕のタイミングを更新できません: " + detail);
            this.messages.error("字幕のタイミングを更新できません: " + detail);
        }
    }

    protected currentTrackId(itemId: string): string {
        const location = this.itemLocations.get(itemId);
        if (!location) throw new Error(`クリップ ${itemId} のトラックを特定できません。`);
        return location.trackId;
    }

    protected moveV2PreviewItem(
        doc: EditV2Document,
        itemId: string,
        atFrames: number,
        targetTrackId?: string,
        insertIndex?: number
    ): { document: EditV2Document; createdTrackId?: string } {
        if (insertIndex !== undefined) {
            const beforeIds = new Set((Array.isArray(doc.tracks) ? doc.tracks : [])
                .flatMap(track => track && typeof track === 'object' && !Array.isArray(track)
                    && typeof (track as Record<string, unknown>).id === 'string'
                    ? [(track as Record<string, unknown>).id as string] : []));
            const document = moveV2ItemToNewTrack(doc, { itemId, insertIndex, atFrames });
            const createdTrackId = (Array.isArray(document.tracks) ? document.tracks : [])
                .flatMap(track => track && typeof track === 'object' && !Array.isArray(track)
                    && typeof (track as Record<string, unknown>).id === 'string'
                    ? [(track as Record<string, unknown>).id as string] : [])
                .find(id => !beforeIds.has(id));
            return { document, ...(createdTrackId ? { createdTrackId } : {}) };
        }
        return moveTreeV2Item(
            doc, itemId, { track: targetTrackId ?? this.currentTrackId(itemId) }, { at: atFrames }
        );
    }

    protected async commitEditV2Drag(preview: DragPreview): Promise<void> {
        const lockedTrackId = this.trackIdOfDrag(preview);
        if (this.isTrackLocked(lockedTrackId)) {
            this.showLockedTrack(lockedTrackId);
            return;
        }
        if ('targetTrackId' in preview && this.isTrackLocked(preview.targetTrackId)) {
            this.showLockedTrack(preview.targetTrackId);
            return;
        }
        try {
            let label = 'タイムラインを更新';
            let message = 'タイムラインを更新しました。';
            let createdTrackId: string | undefined;
            let mutate: (doc: EditV2Document) => EditV2Document;
            switch (preview.kind) {
                case 'cut-trim': {
                    const original = this.cuts[preview.index];
                    const segment = this.segments[preview.index];
                    if (!original || !segment) throw new Error('クリップが見つかりません。');
                    const speed = typeof original.speed === 'number' && original.speed > 0 ? original.speed : 1;
                    const out = preview.maxOutSeconds === undefined
                        ? preview.output : Math.min(preview.output, preview.maxOutSeconds);
                    if (out - preview.input < MINIMUM_ITEM_DURATION) {
                        throw new Error('クリップが短すぎます（0.15 秒未満にはできません）。');
                    }
                    const itemId = this.cutItemId(preview.index);
                    const at = segment.tlStart + (preview.input - original.in) / speed;
                    mutate = doc => updateV2Item(doc, {
                        itemId,
                        patch: {
                            at: this.frameAt(at),
                            duration: Math.max(1, this.frameAt((out - preview.input) / speed)),
                            source: { in: preview.input, out }
                        }
                    });
                    label = 'クリップのトリム';
                    message = 'クリップをトリムしました。';
                    break;
                }
                case 'cut-move': {
                    const itemId = this.cutItemId(preview.index);
                    mutate = doc => {
                        const result = this.moveV2PreviewItem(
                            doc, itemId, this.frameAt(preview.at), preview.targetTrackId, preview.insertIndex
                        );
                        createdTrackId = result.createdTrackId;
                        return result.document;
                    };
                    label = 'クリップの移動';
                    message = 'クリップを移動しました。';
                    break;
                }
                case 'layer': {
                    mutate = doc => {
                        const moveResult = preview.targetTrackId !== undefined || preview.insertIndex !== undefined
                            ? this.moveV2PreviewItem(
                                doc, preview.id, this.frameAt(preview.t), preview.targetTrackId, preview.insertIndex
                            )
                            : { document: doc };
                        createdTrackId = moveResult.createdTrackId;
                        return updateV2Item(moveResult.document, {
                            itemId: preview.id,
                            patch: { at: this.frameAt(preview.t), duration: Math.max(1, this.frameAt(preview.duration)) }
                        });
                    };
                    label = 'クリップの調整';
                    message = 'クリップを調整しました。';
                    break;
                }
                case 'audio':
                    mutate = doc => moveAudioSfxPreferV2(doc, {
                        sfxId: preview.id,
                        t: preview.t,
                        track: preview.track,
                        toTrackId: preview.targetTrackId,
                        atFrames: this.frameAt(preview.t)
                    });
                    label = '音声クリップの移動';
                    message = '音声クリップを移動しました。';
                    break;
                case 'audio-trim':
                    mutate = doc => updateAudioSfxPreferV2(doc, {
                        sfxId: preview.id,
                        itemPatch: {
                            at: this.frameAt(preview.t),
                            duration: Math.max(1, this.frameAt(preview.out - preview.in)),
                            source: { in: preview.in, out: preview.out }
                        },
                        legacyPatch: { t: preview.t, in: preview.in, out: preview.out }
                    });
                    label = '音声クリップのトリム';
                    message = '音声クリップをトリムしました。';
                    break;
                case 'audio-slip':
                    mutate = doc => updateAudioSfxPreferV2(doc, {
                        sfxId: preview.id,
                        itemPatch: { source: { in: preview.in, out: preview.out } },
                        legacyPatch: { in: preview.in, out: preview.out }
                    });
                    label = '音声クリップのスリップ';
                    message = '音声クリップをスリップしました。';
                    break;
                case 'overlay-move':
                    mutate = doc => {
                        const result = this.moveV2PreviewItem(
                            doc, preview.id, this.frameAt(preview.start), preview.targetTrackId, preview.insertIndex
                        );
                        createdTrackId = result.createdTrackId;
                        return result.document;
                    };
                    label = 'クリップの移動';
                    message = 'クリップを移動しました。';
                    break;
                case 'cut-slip':
                    mutate = doc => updateV2Item(doc, {
                        itemId: this.cutItemId(preview.index),
                        patch: { source: { in: preview.in, out: preview.out } }
                    });
                    label = 'クリップのスリップ';
                    message = 'クリップをスリップしました。';
                    break;
                case 'overlay-resize':
                    if (preview.duration <= 0) throw new Error('クリップの尺は正の値にしてください。');
                    mutate = doc => updateV2Item(doc, {
                        itemId: preview.id, patch: { duration: Math.max(1, this.frameAt(preview.duration)) }
                    });
                    label = 'クリップの尺変更';
                    message = 'クリップの尺を変更しました。';
                    break;
                default:
                    return;
            }
            await this.commitEditMutation(label, mutate);
            if (createdTrackId) {
                const name = this.computeTrackAutoNames().get(createdTrackId) ?? createdTrackId;
                this.showNotice(`${name} を追加しました`);
            } else {
                this.hideNotice();
            }
            this.footer.textContent = message;
            this.revealOutputPreview();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`タイムラインを更新できません: ${detail}`);
            this.messages.error(`タイムラインを更新できません: ${detail}`);
        }
    }

    protected pushHistory(entry: HistoryEntry): void {
        this.historyService.push(entry);
    }

    protected overlayTrackState(): Record<string, number | null> {
        const state: Record<string, number | null> = {};
        for (const overlay of this.overlays) {
            state[overlay.id] = Object.prototype.hasOwnProperty.call(overlay.payload, 'track') ? overlay.track : null;
        }
        return state;
    }

    protected async readEditValue(): Promise<Record<string, any>> {
        const editUri = this.location?.editUri;
        if (!editUri) {
            throw new Error('edit.json が見つかりません。');
        }
        return JSON.parse((await this.fileService.readFile(editUri)).value.toString()) as Record<string, any>;
    }

    protected async readIndexedTrackState(key: 'cuts' | 'sfx'): Promise<Record<string, number | null>> {
        const value = await this.readEditValue();
        const items = key === 'cuts' ? value.cuts : value.audio?.sfx;
        if (!Array.isArray(items)) {
            return {};
        }
        const state: Record<string, number | null> = {};
        items.forEach((item, index) => {
            state[String(index)] = item && Object.prototype.hasOwnProperty.call(item, 'track') ? item.track : null;
        });
        return state;
    }

    /**
     * トラック間へ挿入するアイテムを新しいトラックへ移し、それ以上の既存トラックを1つ上へずらす。
     */
    protected shiftTrackStateForInsert(
        base: Record<string, number | null>,
        movedKey: string,
        newTrackNumber: number
    ): Record<string, number | null> {
        const result: Record<string, number | null> = {};
        for (const [key, value] of Object.entries(base)) {
            if (key === movedKey) {
                result[key] = newTrackNumber;
                continue;
            }
            const current = value ?? 0;
            result[key] = current >= newTrackNumber ? current + 1 : value;
        }
        return result;
    }

    protected async readIdTrackState(key: 'layers'): Promise<Record<string, number | null>> {
        const value = await this.readEditValue();
        const items = value[key];
        if (!Array.isArray(items)) {
            return {};
        }
        const state: Record<string, number | null> = {};
        for (const item of items) {
            if (item && typeof item.id === 'string') {
                state[item.id] = Object.prototype.hasOwnProperty.call(item, 'track') ? item.track : null;
            }
        }
        return state;
    }

    protected updateHistoryButtons(): void {
        this.undoButton.disabled = this.historyService.canUndo === false;
        this.redoButton.disabled = this.historyService.canRedo === false;
    }

    protected async performUndo(): Promise<void> {
        if (!this.historyService.canUndo) {
            return;
        }
        this.undoButton.disabled = true;
        this.redoButton.disabled = true;
        try {
            await this.historyService.undo();
        } catch (error) {
            console.warn('[akari-annotations] undo entry is no longer applicable', error);
        } finally {
            this.updateHistoryButtons();
        }
    }

    protected async performRedo(): Promise<void> {
        if (!this.historyService.canRedo) {
            return;
        }
        this.undoButton.disabled = true;
        this.redoButton.disabled = true;
        try {
            await this.historyService.redo();
        } catch (error) {
            console.warn('[akari-annotations] redo entry is no longer applicable', error);
        } finally {
            this.updateHistoryButtons();
        }
    }

    protected applyHistoryExecution(execution: HistoryExecution): void {
        if ('error' in execution) {
            // 失敗理由を添える（「対象が変更されています」だけでは原因が追えなかった。2026-09-02）。
            const reason = this.errorMessage(execution.error);
            const message = execution.kind === 'undo'
                ? `「${execution.entry.label}」を元に戻せませんでした: ${reason}`
                : `「${execution.entry.label}」をやり直せませんでした: ${reason}`;
            this.footer.textContent = message;
            this.showNotice(message);
            return;
        }
        this.hideNotice();
        this.revealOutputPreview();
        this.footer.textContent = execution.kind === 'undo'
            ? `${execution.entry.label}を元に戻しました。`
            : `${execution.entry.label}をやり直しました。`;
    }

    protected copySelectedItem(): boolean {
        const selection = this.selection;
        if (!selection || selection.kind === 'audio') {
            this.footer.textContent = 'コピーできるクリップまたは字幕が選択されていません。';
            return false;
        }
        if (selection.kind === 'caption') {
            const caption = this.captions.find(candidate => candidate.id === selection.id);
            if (!caption) {
                this.applySelection(undefined);
                this.footer.textContent = 'コピー対象の字幕が見つかりません。';
                return false;
            }
            this.clipboard = {
                kind: 'caption',
                payload: { text: caption.text, start: caption.start, end: caption.end }
            };
            this.footer.textContent = '字幕をコピーしました。';
            return true;
        }
        const itemId = selection.kind === 'cut' ? this.cutItemId(selection.index) : selection.id;
        const item = this.rawV2Item(itemId);
        const trackId = this.itemLocations.get(itemId)?.trackId;
        if (!item || !trackId) {
            this.applySelection(undefined);
            this.footer.textContent = 'コピー対象のクリップが見つかりません。';
            return false;
        }
        this.clipboard = {
            kind: 'item',
            trackId,
            item: this.deepCopy(item)
        };
        this.footer.textContent = 'クリップをコピーしました。';
        return true;
    }

    protected async pasteClipboard(): Promise<void> {
        const clipboard = this.clipboard;
        const location = this.location;
        if (!clipboard || !location) {
            this.footer.textContent = 'ペーストするクリップまたは字幕がありません。';
            return;
        }
        const start = Number.isFinite(this.playheadT) ? this.playheadT : this.selectedSourceT;
        const duration = clipboard.kind === 'caption'
            ? clipboard.payload.end - clipboard.payload.start
            : Number(clipboard.item.duration) / this.fps;
        const contentDuration = this.contentEndDuration();
        if (!Number.isFinite(start) || start < 0 || start + duration > contentDuration + Number.EPSILON) {
            this.footer.textContent = '総尺を超える位置にはペーストできません。';
            return;
        }
        try {
            if (clipboard.kind === 'caption') {
                const caption: CaptionWritePayload = {
                    id: this.nextCopyId('caption-copy', this.captions.map(candidate => candidate.id)),
                    start,
                    end: start + duration,
                    text: clipboard.payload.text,
                    speaker: null,
                    sourceRef: null,
                    edited: true
                };
                const result = await this.annotationsService.insertCaption({
                    captionsUri: location.captionsUri.toString(),
                    projectRootUri: location.root.toString(),
                    caption
                });
                this.pushHistory({
                    label: '字幕のペースト',
                    undo: async () => {
                        await this.annotationsService.removeCaption({
                            captionsUri: location.captionsUri.toString(), projectRootUri: location.root.toString(),
                            captionId: caption.id
                        });
                        await this.reloadCaptions();
                    },
                    redo: async () => {
                        await this.annotationsService.insertCaption({
                            captionsUri: location.captionsUri.toString(), projectRootUri: location.root.toString(), caption
                        });
                        await this.reloadCaptions();
                        this.applySelection({ kind: 'caption', id: caption.id });
                    }
                });
                await this.reloadCaptions();
                this.applySelection({ kind: 'caption', id: caption.id });
                this.footer.textContent = this.writeResultMessage('字幕をペーストしました。', result);
            } else {
                if (!location.editUri) {
                    this.footer.textContent = 'edit.json がないためクリップをペーストできません。';
                    return;
                }
                const originalId = String(clipboard.item.id);
                const item = this.deepCopy(clipboard.item);
                item.id = this.nextCopyId(`${originalId}-copy`, [...this.itemLocations.keys()]);
                item.at = this.frameAt(start);
                await this.commitEditMutation('クリップのペースト', doc =>
                    insertV2Item(doc, clipboard.trackId, item));
                const cutIndex = this.cutItemIds.indexOf(String(item.id));
                if (cutIndex >= 0) {
                    this.applySelection({ kind: 'cut', index: cutIndex });
                } else if (this.layers.some(layer => layer.id === item.id)) {
                    this.applySelection({ kind: 'layer', id: String(item.id) });
                } else if (this.overlays.some(overlay => overlay.id === item.id)) {
                    this.applySelection({ kind: 'overlay', id: String(item.id) });
                }
                this.footer.textContent = 'クリップをペーストしました。';
            }
            this.hideNotice();
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`ペーストできません: ${detail}`);
            this.messages.error(`ペーストできません: ${detail}`);
        }
    }

    protected nextCopyId(base: string, ids: string[]): string {
        const used = new Set(ids);
        if (!used.has(base)) {
            return base;
        }
        let sequence = 2;
        while (used.has(`${base}-${sequence}`)) {
            sequence++;
        }
        return `${base}-${sequence}`;
    }

    protected deepCopy<T>(value: T): T {
        return JSON.parse(JSON.stringify(value)) as T;
    }

    protected writeResultMessage(message: string, result: WriteBackResult): string {
        return result.committed ? `${message} 変更を記録しました。` : message;
    }

    protected percent(value: number): number {
        const duration = this.visibleDuration();
        return duration > 0 ? Math.min(100, Math.max(0, (value - this.viewStart) / duration * 100)) : 0;
    }

    protected layoutPercent(value: number): number {
        const duration = this.layoutViewDuration > 0 ? this.layoutViewDuration : this.visibleDuration();
        const start = this.layoutViewDuration > 0 ? this.layoutViewStart : this.viewStart;
        return anchoredLayoutPercent(value, start, duration, LAYOUT_PERCENT_MIN, LAYOUT_PERCENT_MAX);
    }

    protected zoomPercent(): number {
        const duration = this.visibleDuration();
        return duration > 0 ? this.totalDuration() / duration * 100 : 100;
    }

    protected minViewDurationSeconds(): number {
        return Math.min(this.totalDuration(), MIN_VIEW_DURATION_FRAMES / this.fps);
    }

    protected sliderValueToViewDuration(sliderValue: number): number {
        const maxDuration = this.totalDuration();
        const minDuration = this.minViewDurationSeconds();
        if (maxDuration <= minDuration) {
            return maxDuration;
        }
        const ratio = minDuration / maxDuration;
        const t = Math.min(1, Math.max(0, sliderValue / ZOOM_SLIDER_RESOLUTION));
        return maxDuration * Math.pow(ratio, t);
    }

    protected viewDurationToSliderValue(duration: number): number {
        const maxDuration = this.totalDuration();
        const minDuration = this.minViewDurationSeconds();
        if (maxDuration <= minDuration) {
            return 0;
        }
        const ratio = minDuration / maxDuration;
        const clamped = Math.min(maxDuration, Math.max(minDuration, duration));
        const t = Math.log(clamped / maxDuration) / Math.log(ratio);
        return Math.round(t * ZOOM_SLIDER_RESOLUTION);
    }

    protected updateZoomHud(): void {
        this.zoomLabel.textContent = `${Math.round(this.zoomPercent())}%`;
        const sliderValue = this.viewDurationToSliderValue(this.visibleDuration());
        if (Number(this.zoomSlider.value) !== sliderValue) {
            this.zoomSlider.value = String(sliderValue);
        }
    }

    protected applyViewDuration(proposedDuration: number, anchorTime: number, anchorRatio: number): void {
        const maxDuration = this.totalDuration();
        const minDuration = this.minViewDurationSeconds();
        const clamped = Math.min(maxDuration, Math.max(minDuration, proposedDuration));
        if (clamped >= maxDuration - 1e-6) {
            this.viewDuration = undefined;
            this.viewStart = 0;
        } else {
            const proposedStart = anchorTime - anchorRatio * clamped;
            this.viewDuration = clamped;
            this.viewStart = Math.min(Math.max(0, proposedStart), Math.max(0, maxDuration - clamped));
        }
        // 倍率表示は即時、帯の描画は次フレームへ折りたたむ（ピンチ中の wheel は 60〜120 Hz で届く）。
        this.updateZoomHud();
        this.scheduleStripRender();
    }

    /** renderStrip() を次の animation frame まで最大 1 回に折りたたむ（最新の状態で描く）。 */
    protected scheduleStripRender(): void {
        this.stripRenderThrottle.call();
    }

    /** 保留中の描画があれば今すぐ同期実行する（直後にレイアウト幾何を読む経路の入口で呼ぶ）。 */
    protected flushStripRender(): void {
        this.stripRenderThrottle.flush();
    }

    protected setViewStart(candidate: number): void {
        const maxStart = Math.max(0, this.totalDuration() - this.visibleDuration());
        const next = Math.min(Math.max(0, candidate), maxStart);
        if (next === this.viewStart && this.panOffsetPx === 0) {
            return;
        }
        this.viewStart = next;
        const visibleDuration = this.visibleDuration();
        // ズーム描画が予約済みなら、その描画が最新の viewStart で組み直す（transform を重ねない）。
        if (this.stripRenderThrottle.pending()) {
            return;
        }
        if (!this.dragState
            && this.layoutViewDuration > 0
            && Math.abs(visibleDuration - this.layoutViewDuration) < 1e-9
            && Math.abs(next - this.layoutViewStart) <= PAN_TRANSFORM_LIMIT_RATIO * this.layoutViewDuration) {
            // 細いチップも掴める個別ノードのまま保ち、パン中は全チップの幾何更新から外す。
            this.applyPanTransform();
            this.schedulePanSettle();
            return;
        }
        this.renderStrip();
    }

    protected applyPanTransform(): void {
        this.panOffsetPx = panTranslatePx(
            this.viewStart, this.layoutViewStart, this.layoutViewDuration, this.stripLayoutWidthPx
        );
        const value = `translateX(${this.panOffsetPx}px)`;
        this.stripContent.style.transform = value;
        this.rulerContent.style.transform = value;
        this.playhead.style.left = `${this.percent(this.playheadT)}%`;
        this.updateScrollbar();
        this.scheduleAudioWaveformT2DuringPan();
    }

    /** DOM は描き直さず、パン先の T2 coverage 判定だけを 100ms 以上の間隔で行う。 */
    protected scheduleAudioWaveformT2DuringPan(): void {
        if (!this.waveformPanScheduleGate.shouldEvaluate(Date.now())) return;
        for (const schedule of this.waveformT2PanTargets.values()) schedule();
    }

    protected schedulePanSettle(): void {
        if (this.panSettleHandle !== undefined) {
            return;
        }
        this.panSettleHandle = requestAnimationFrame(() => {
            this.panSettleHandle = undefined;
            this.settlePanWindow();
        });
    }

    protected settlePanWindow(): void {
        if (this.panOffsetPx === 0) {
            return;
        }
        if (shouldReanchorPan(
            this.viewStart - this.layoutViewStart, this.layoutViewDuration, PAN_SETTLE_RATIO
        )) {
            this.renderStrip();
        }
    }

    protected settlePan(): void {
        if (this.panOffsetPx === 0) {
            return;
        }
        if (this.panSettleHandle !== undefined) {
            cancelAnimationFrame(this.panSettleHandle);
            this.panSettleHandle = undefined;
        }
        this.renderStrip();
    }

    protected updateScrollbar(): void {
        const zoomed = this.viewDuration !== undefined;
        this.hScrollbarTrack.style.display = zoomed ? 'block' : 'none';
        if (!zoomed) {
            return;
        }
        const total = this.totalDuration();
        const visible = this.visibleDuration();
        const widthPercent = total > 0 ? Math.min(100, Math.max(2, visible / total * 100)) : 100;
        const leftPercent = total > 0 ? Math.min(100 - widthPercent, Math.max(0, this.viewStart / total * 100)) : 0;
        this.hScrollbarThumb.style.width = `${widthPercent}%`;
        this.hScrollbarThumb.style.left = `${leftPercent}%`;
    }

    protected onScrollbarTrackClick(event: MouseEvent): void {
        this.lastManualScrollAt = Date.now();
        if (event.target === this.hScrollbarThumb) {
            return;
        }
        const rect = this.hScrollbarTrack.getBoundingClientRect();
        if (rect.width <= 0) {
            return;
        }
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        const total = this.totalDuration();
        this.setViewStart(ratio * total - this.visibleDuration() / 2);
    }

    protected onScrollbarThumbPointerDown(event: PointerEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.hScrollbarThumb.setPointerCapture(event.pointerId);
        const trackRect = this.hScrollbarTrack.getBoundingClientRect();
        const startClientX = event.clientX;
        const startViewStart = this.viewStart;
        const total = this.totalDuration();
        const onMove = (moveEvent: PointerEvent): void => {
            this.lastManualScrollAt = Date.now();
            if (trackRect.width <= 0) {
                return;
            }
            const deltaRatio = (moveEvent.clientX - startClientX) / trackRect.width;
            this.setViewStart(startViewStart + deltaRatio * total);
        };
        const onUp = (upEvent: PointerEvent): void => {
            this.hScrollbarThumb.releasePointerCapture(upEvent.pointerId);
            this.hScrollbarThumb.removeEventListener('pointermove', onMove);
            this.hScrollbarThumb.removeEventListener('pointerup', onUp);
            this.hScrollbarThumb.removeEventListener('pointercancel', onUp);
        };
        this.hScrollbarThumb.addEventListener('pointermove', onMove);
        this.hScrollbarThumb.addEventListener('pointerup', onUp);
        this.hScrollbarThumb.addEventListener('pointercancel', onUp);
    }

    /** playhead 上端のピン型ハンドルをドラッグしている間、継続的にプレビューへシークする（スクラブ）。 */
    protected onPlayheadHandlePointerDown(event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.playheadHandle.setPointerCapture(event.pointerId);
        const onMove = (moveEvent: PointerEvent): void => {
            const outputT = this.timeAtClientX(moveEvent.clientX);
            this.playheadT = outputT;
            this.playhead.style.left = `${this.percent(outputT)}%`;
            void this.requestSeek(outputT, { domain: 'output' });
        };
        const onUp = (upEvent: PointerEvent): void => {
            this.playheadHandle.releasePointerCapture(upEvent.pointerId);
            this.playheadHandle.removeEventListener('pointermove', onMove);
            this.playheadHandle.removeEventListener('pointerup', onUp);
            this.playheadHandle.removeEventListener('pointercancel', onUp);
            this.selectedSourceT = this.outputToSource(this.playheadT);
        };
        this.playheadHandle.addEventListener('pointermove', onMove);
        this.playheadHandle.addEventListener('pointerup', onUp);
        this.playheadHandle.addEventListener('pointercancel', onUp);
    }

    protected panViewBy(deltaSeconds: number): void {
        this.lastManualScrollAt = Date.now();
        this.setViewStart(this.viewStart + deltaSeconds);
    }

    protected timeAtClientX(clientX: number): number {
        const rect = this.strip.getBoundingClientRect();
        const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
        return this.viewStart + ratio * this.visibleDuration();
    }

    /**
     * 素材 D&D のドロップ時刻（task 2026-08-18-timeline-dnd-p0p1 / P1-b）。0 で下限を切るだけで
     * **総尺で上限を切らない** — タイムラインは総尺の先にも余白を描いており、そこに落として
     * 尺を伸ばせることが「自由に配置」の要件だから。フレームグリッドへの丸めもしない（v0 と同じ）。
     */
    protected materialDropTimeAtClientX(clientX: number): number {
        return Math.max(0, this.timeAtClientX(clientX));
    }

    /**
     * 書き出しの尺を決めるのは `cuts[]` なので、その終端より後ろへ置いたレイヤー / 音源は
     * タイムライン上には見えても書き出しには入らない（edit-lint の `audio.sfx.timeline` /
     * `overlays.timeline` と同じ事情。layers には対応する lint がまだ無い）。
     * P1-b で「総尺より後ろに置ける」ようにした以上、この一言は必ず添える。
     * cuts が 0 本のプロジェクトは「ソース全体が本編」なので何も言わない。
     */
    protected beyondCutsEndNote(t: number): string {
        if (this.cuts.length === 0) {
            return '';
        }
        const cutsEnd = this.segments.reduce((max, segment) => Math.max(max, segment.tlEnd), 0);
        if (!(t >= cutsEnd)) {
            return '';
        }
        return '（いちばん下の映像段の終わりより後ろです。段の尺を伸ばさないと書き出しには入りません）';
    }

    /**
     * 本編（cuts）へのドロップ計画。`planCutDrop` の入力を widget 状態から組み立てるだけの薄い層。
     * ゴースト（dragover 毎）と実挿入（drop）が同じ計画を見るので、見えている位置に必ず入る。
     */
    protected materialCutDropPlan(clientX: number, track: number, durationSeconds: number): CutDropPlan {
        return planCutDrop(this.cuts, track, this.materialDropTimeAtClientX(clientX), durationSeconds);
    }

    /**
     * 行き先を織り込んだドロップ時刻。レイヤー・音源は重ねてよいので落とした位置のまま
     * （P1-b: 総尺より後ろも可）。本編だけは planCutDrop が決めた着地時刻を使う。
     */
    protected materialDropTime(
        clientX: number, zone: MaterialDropZone, track: number, durationSeconds: number
    ): number {
        if (zone !== 'cuts') {
            return this.materialDropTimeAtClientX(clientX);
        }
        return this.materialCutDropPlan(clientX, track, durationSeconds).at;
    }

    protected selectTimeAtClientX(clientX: number): void {
        const outputT = this.timeAtClientX(clientX);
        const sourceT = this.outputToSource(outputT);
        this.selectedSourceT = sourceT;
        this.playheadT = outputT;
        this.playhead.style.left = `${this.percent(outputT)}%`;
        void this.requestSeek(outputT, { domain: 'output' });
    }

    protected onStripPointerDown(event: PointerEvent): void {
        if (event.button !== 0 || this.toolMode !== 'select') {
            return;
        }
        const target = event.target instanceof Element ? event.target : undefined;
        if (target?.closest(
            '[data-akari-item-kind], .akari-beat-marker, .akari-track-header-row, .akari-annotations-pin'
        )) {
            return;
        }
        const startX = event.clientX;
        const startY = event.clientY;
        let dragged = false;
        this.strip.setPointerCapture(event.pointerId);
        const overlayRect = (): DOMRect => this.timelineOverlay.getBoundingClientRect();
        const updateMarquee = (clientX: number, clientY: number): void => {
            const rect = overlayRect();
            const left = Math.min(startX, clientX) - rect.left;
            const top = Math.min(startY, clientY) - rect.top;
            this.selectionMarquee.style.left = `${left}px`;
            this.selectionMarquee.style.top = `${top}px`;
            this.selectionMarquee.style.width = `${Math.abs(clientX - startX)}px`;
            this.selectionMarquee.style.height = `${Math.abs(clientY - startY)}px`;
            this.selectionMarquee.style.display = 'block';
        };
        const onMove = (moveEvent: PointerEvent): void => {
            if (!dragged && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
                return;
            }
            dragged = true;
            updateMarquee(moveEvent.clientX, moveEvent.clientY);
        };
        const onUp = (upEvent: PointerEvent): void => {
            this.strip.removeEventListener('pointermove', onMove);
            this.strip.removeEventListener('pointerup', onUp);
            this.strip.removeEventListener('pointercancel', onUp);
            this.selectionMarquee.style.display = 'none';
            if (!dragged) {
                return;
            }
            this.suppressNextStripClick = true;
            const selectionRect = {
                left: Math.min(startX, upEvent.clientX),
                right: Math.max(startX, upEvent.clientX),
                top: Math.min(startY, upEvent.clientY),
                bottom: Math.max(startY, upEvent.clientY)
            };
            const hits = new Map<string, TimelineSelectionItem>();
            for (const element of Array.from(
                this.strip.querySelectorAll<HTMLElement>('[data-akari-item-kind]')
            )) {
                const rect = element.getBoundingClientRect();
                if (rect.right < selectionRect.left || rect.left > selectionRect.right
                    || rect.bottom < selectionRect.top || rect.top > selectionRect.bottom) {
                    continue;
                }
                const item = this.timelineSelectionFromElement(element);
                if (item) {
                    hits.set(this.selectionKey(item), item);
                }
            }
            const selected = [...hits.values()];
            if (selected.length === 1) {
                this.applySelection(selected[0]);
            } else if (selected.length > 1) {
                this.exitTrimmerModeUnlessSelected(undefined);
                this.selection = undefined;
                this.multiSelection = selected;
                this.pushSelectionSnapshot();
                this.applySelectionClass();
            } else {
                this.applySelection(undefined);
            }
        };
        this.strip.addEventListener('pointermove', onMove);
        this.strip.addEventListener('pointerup', onUp);
        this.strip.addEventListener('pointercancel', onUp);
    }

    protected timelineSelectionFromElement(element: HTMLElement): TimelineSelectionItem | undefined {
        const kind = element.dataset.akariItemKind;
        const id = element.dataset.akariItemId;
        if (!id) {
            return undefined;
        }
        if (kind === 'cut') {
            const index = Number(id);
            return Number.isInteger(index) ? { kind: 'cut', index } : undefined;
        }
        if (kind === 'overlay' || kind === 'caption' || kind === 'layer' || kind === 'audio') {
            return { kind, id } as TimelineSelectionItem;
        }
        if (kind === 'item') {
            const row = this.timelineTreeRows.find(candidate => candidate.id === id);
            return row ? {
                kind: 'item', id: row.id, itemKind: row.itemKind,
                ...(row.parentId === undefined ? {} : { parentId: row.parentId }), trackId: row.trackId
            } : undefined;
        }
        return undefined;
    }

    protected onStripClick(event: MouseEvent): void {
        if (this.suppressNextStripClick) {
            this.suppressNextStripClick = false;
            return;
        }
        if (event.target instanceof Element && event.target.closest('.akari-beat-marker')) {
            return;
        }
        this.applySelection(undefined);
        this.selectTimeAtClientX(event.clientX);
    }

    private wheelZoomDuration(currentDuration: number, deltaY: number): number {
        const rawFactor = Math.exp(-deltaY * ZOOM_WHEEL_SENSITIVITY);
        const factor = Math.min(ZOOM_EVENT_FACTOR_MAX, Math.max(ZOOM_EVENT_FACTOR_MIN, rawFactor));
        return currentDuration / factor;
    }

    protected onTrackHeaderWheel(event: WheelEvent): void {
        const plan = planTimelineHeaderWheel(event);
        if (plan.kind === 'none') {
            return;
        }
        event.preventDefault();
        if (plan.kind === 'scroll') {
            this.stripScroll.scrollTop += plan.deltaY;
        } else if (plan.kind === 'pan') {
            const rect = this.strip.getBoundingClientRect();
            if (rect.width > 0) {
                this.panViewBy(plan.delta / rect.width * this.visibleDuration());
            }
        } else {
            const currentDuration = this.visibleDuration();
            const proposedDuration = this.wheelZoomDuration(currentDuration, plan.deltaY);
            this.applyViewDuration(proposedDuration, this.viewStart + 0.5 * currentDuration, 0.5);
        }
    }

    protected onWheelZoom(event: WheelEvent): void {
        if (event.ctrlKey) {
            event.preventDefault();
            const rect = this.strip.getBoundingClientRect();
            if (rect.width <= 0) {
                return;
            }
            const currentDuration = this.visibleDuration();
            const proposedDuration = this.wheelZoomDuration(currentDuration, event.deltaY);
            const cursorRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            const cursorTime = this.viewStart + cursorRatio * currentDuration;
            this.applyViewDuration(proposedDuration, cursorTime, cursorRatio);
            return;
        }
        const horizontalDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
            ? event.deltaX
            : (event.shiftKey ? event.deltaY : 0);
        if (horizontalDelta === 0) {
            return;
        }
        event.preventDefault();
        const rect = this.strip.getBoundingClientRect();
        if (rect.width <= 0) {
            return;
        }
        this.panViewBy(horizontalDelta / rect.width * this.visibleDuration());
    }

    canHandlePlaybackTick(editUri: string | undefined): boolean {
        if (!this.isAttached || !this.location?.editUri || !editUri) {
            return false;
        }
        return this.normalizeUri(this.location.editUri.toString()) === this.normalizeUri(editUri);
    }

    handlePlaybackTick(request: PreviewPlaybackTick): void {
        if (!this.canHandlePlaybackTick(request.videoUri)
            || !Number.isFinite(request.time)
            || typeof request.playing !== 'boolean') {
            return;
        }
        this.playheadT = Math.max(0, request.time!);
        const inspectorSnapshot = this.selectionModel.snapshot;
        if (inspectorSnapshot?.kind === 'audio') {
            (inspectorSnapshot as AudioSelectionSnapshot).playheadSeconds = this.playheadT;
        }
        const visibleDuration = this.visibleDuration();
        const followEdge = this.viewStart + visibleDuration * PLAYHEAD_FOLLOW_THRESHOLD;
        if (this.viewDuration !== undefined && Date.now() - this.lastManualScrollAt >= 3000) {
            if (this.playheadT > followEdge) {
                const nextViewStart = this.playheadT - visibleDuration * PLAYHEAD_FOLLOW_THRESHOLD;
                if (nextViewStart > this.viewStart + 1e-6) {
                    this.setViewStart(nextViewStart);
                }
            } else if (this.playheadT < this.viewStart) {
                const nextViewStart = Math.max(
                    0, this.playheadT - visibleDuration * (1 - PLAYHEAD_FOLLOW_THRESHOLD)
                );
                if (nextViewStart < this.viewStart - 1e-6) {
                    this.setViewStart(nextViewStart);
                }
            }
        }
        this.playhead.style.left = `${this.percent(this.playheadT)}%`;
    }

    protected normalizeUri(value: string): string {
        return new URI(value).normalizePath().toString();
    }

    /**
     * プレビューのタブをフォーカスを奪わずに前面へ出す。契約: akari.preview.ensureVisible。
     * 未登録（プレビュー未実装・別画面）でも壊れないよう黙って無視する。
     */
    protected revealOutputPreview(): void {
        if (!this.location?.editUri) {
            return;
        }
        void this.commands.executeCommand(ENSURE_PREVIEW_VISIBLE_COMMAND_ID, { editUri: this.location.editUri.toString() })
            .catch(() => undefined);
    }

    protected togglePreviewPlayback(): void {
        if (!this.location?.editUri) {
            return;
        }
        void this.commands.executeCommand(TOGGLE_OUTPUT_PREVIEW_PLAYBACK_COMMAND_ID, {
            editUri: this.location.editUri.toString()
        }).catch(() => undefined);
    }

    // domain 'source' (既定): time は素材(source)秒 — アノテーションの sourceT 等、cuts 経由で
    // 出力秒に変換してからプレビューへ送る。domain 'output': time は既にタイムライン(出力)秒
    // ――ギャップ（cuts 間の空白・末尾延長）はどの cut にも属さず source 秒に写像できないため、
    // sourceToOutput(outputToSource(time)) の往復変換は best-effort で最寄りの segment 境界へ
    // 丸められ 0 秒などへ誤着地しうる（バグ⑳）。タイムライン widget 自身が出力秒を握っている
    // クリック/ドラッグ/矢印キー操作は往復変換を経由せずここで直接その出力秒を渡す
    protected async requestSeek(time: number, options?: { domain?: 'source' | 'output' }): Promise<void> {
        if (!this.location?.editUri) {
            this.footer.textContent = `${this.formatTimestamp(time)} を選択しました。edit.json が見つかりません。`;
            return;
        }
        const outputTime = options?.domain === 'output' ? time : this.sourceToOutput(time);
        const result = await this.commands.executeCommand<'seeked' | 'mismatched-asset'>(
            SEEK_OUTPUT_PREVIEW_COMMAND_ID,
            { editUri: this.location.editUri.toString(), time: outputTime }
        );
        const timestamp = this.formatTimestamp(time);
        this.footer.textContent = result === 'seeked'
            ? `${timestamp} にプレビューをシークしました。`
            : `${timestamp} を選択しました。出力プレビューを開けませんでした。`;
    }

    protected openAnnotationPopup(event: MouseEvent): void {
        event.preventDefault();
        this.closeAnnotationPopup();
        const sourceT = this.outputToSource(this.timeAtClientX(event.clientX));
        const popup = document.createElement('div');
        Object.assign(popup.style, {
            position: 'fixed', left: `${event.clientX}px`, top: `${event.clientY}px`, zIndex: '10000',
            display: 'flex', gap: '5px', padding: '6px', borderRadius: '4px',
            border: '1px solid var(--theia-widget-border)', background: 'var(--theia-menu-background)',
            boxShadow: '0 3px 12px rgba(0,0,0,.35)'
        });
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = `${this.formatTimestamp(sourceT)} に注釈`;
        input.setAttribute('aria-label', 'タイムラインに注釈を追加');
        const submit = document.createElement('button');
        submit.type = 'button';
        submit.className = 'theia-button main';
        submit.textContent = '追加';
        const accept = (): void => {
            const text = input.value.trim();
            if (!text) {
                return;
            }
            this.closeAnnotationPopup();
            void this.submitAnnotation(text, sourceT);
        };
        input.addEventListener('keydown', keyEvent => {
            if (keyEvent.key === 'Enter') {
                keyEvent.preventDefault();
                accept();
            } else if (keyEvent.key === 'Escape') {
                keyEvent.preventDefault();
                this.closeAnnotationPopup();
            }
        });
        input.addEventListener('blur', () => setTimeout(() => {
            if (this.contextPopup === popup && !popup.contains(document.activeElement)) {
                this.closeAnnotationPopup();
            }
        }, 0));
        submit.addEventListener('mousedown', downEvent => downEvent.preventDefault());
        submit.addEventListener('click', accept);
        popup.addEventListener('contextmenu', popupEvent => popupEvent.preventDefault());
        popup.append(input, submit);
        document.body.appendChild(popup);
        this.contextPopup = popup;
        input.focus();
    }

    protected closeAnnotationPopup(): void {
        this.contextPopup?.remove();
        this.contextPopup = undefined;
    }

    /**
     * タイムラインのクリップ右クリックメニュー（task 2026-08-10-timeline-clip-menu 指示3）。
     * 右クリックしたアイテムを先に単一選択に切り替えてから（司令塔裁定2）メニューを出す。
     * 項目構成は既存ハンドラの対応範囲に従う純関数 buildTimelineClipMenuItems に委ねる。
     */
    protected openTimelineClipContextMenu(event: MouseEvent, element: HTMLElement): void {
        event.preventDefault();
        const captionTreeRow = element.dataset.akariTreeRowId
            ? this.expandedTimelineTreeRows.find(row => row.id === element.dataset.akariTreeRowId) : undefined;
        const item: TimelineSelectionItem | undefined = captionTreeRow ? {
            kind: 'item', id: captionTreeRow.id, itemKind: captionTreeRow.itemKind,
            parentId: captionTreeRow.parentId, trackId: captionTreeRow.trackId
        } : this.timelineSelectionFromElement(element);
        if (!item) {
            return;
        }
        this.closeAnnotationPopup();
        const alreadyMultiSelected = this.multiSelection.some(candidate =>
            this.selectionKey(candidate) === this.selectionKey(item));
        if (!alreadyMultiSelected) this.applySelection(item);
        const row = item.kind === 'item'
            ? this.timelineTreeRows.find(candidate => candidate.id === item.id) : undefined;
        const baseItems = buildTimelineClipMenuItems(
            item.kind === 'item' ? 'overlay' : item.kind,
            this.clipboard !== undefined,
            row ? {
                canDetach: row.parentId !== undefined,
                canConvertToTelop: row.itemKind === 'caption',
                canGroup: this.multiSelection.length >= 2,
                canUngroup: row.sourceKind === 'group',
                canToggleCollapse: row.sourceKind === 'group' && row.hasChildren,
                collapsed: row.collapsed,
                hasParent: row.parentId !== undefined
            } : {}
        );
        const items = withAudioTrimMenuItem(
            baseItems,
            item.kind === 'audio' && this.audioSfx.some(candidate => candidate.id === item.id)
        );
        const clientX = event.clientX;
        openTimelineContextMenu({
            x: event.clientX,
            y: event.clientY,
            items,
            onSelect: id => this.dispatchTimelineClipMenuAction(id, item, clientX)
        });
    }

    /**
     * メニュー id → 既存ハンドラへのディスパッチ（司令塔裁定1）。分割の分割位置は
     * 右クリックした X 位置（`clientX`）を使う（司令塔裁定1・事実2）。
     */
    protected dispatchTimelineClipMenuAction(id: string, item: TimelineSelectionItem, clientX: number): void {
        if (id === 'audio-trim') {
            if (item.kind === 'audio' && this.audioSfx.some(candidate => candidate.id === item.id)) {
                this.toggleAudioTrimmerMode(item.id);
            }
            return;
        }
        if (id === 'copy') {
            this.copySelectedItem();
            return;
        }
        if (id === 'paste') {
            void this.pasteClipboard();
            return;
        }
        if (id === 'split') {
            if (item.kind !== 'cut') {
                return;
            }
            const segment = this.segments.find(candidate => candidate.index === item.index);
            if (!segment) {
                return;
            }
            void this.performRazorSplitAt(segment, clientX);
            return;
        }
        if (id === 'detach' && item.kind === 'item') {
            let createdTrackId: string | undefined;
            void this.commitEditMutation('出す', doc => {
                const row = this.expandedTimelineTreeRows.find(candidate => candidate.id === item.id);
                const result = detachTreeV2Item(doc, item.id, row ? {
                    at: Math.round(row.at * this.fps), duration: Math.round(row.duration * this.fps)
                } : undefined);
                createdTrackId = result.createdTrackId;
                return result.document;
            }).then(() => {
                const name = createdTrackId
                    ? this.computeTrackAutoNames().get(createdTrackId) ?? createdTrackId : '新しい段';
                this.showNotice(`${name} を追加しました`);
            }).catch(error => this.showNotice(`出せません: ${this.errorMessage(error)}`));
            return;
        }
        if (id === 'convert-to-telop' && item.kind === 'item' && item.itemKind === 'caption') {
            const row = this.expandedTimelineTreeRows.find(candidate => candidate.id === item.id);
            const raw = this.rawV2Item(item.id);
            const captionId = captionIdForTreeSelection(
                { kind: 'item', id: item.id, itemKind: item.itemKind,
                    ...(item.parentId === undefined ? {} : { parentId: item.parentId }), trackId: item.trackId },
                raw?.source?.kind === 'caption' ? raw.source.id : undefined
            );
            const caption = this.captions.find(candidate => candidate.id === captionId);
            if (!caption || !row) return;
            void this.commitEditMutation('テロップに変換', doc => convertCaptionToTelopV2(doc, item.id, {
                text: caption.text,
                at: Math.round(row.at * this.fps),
                duration: Math.round(row.duration * this.fps)
            }).document).catch(error => this.showNotice(`テロップに変換できません: ${this.errorMessage(error)}`));
            return;
        }
        if (id === 'group') {
            const ids = this.multiSelection.flatMap(selection => selection.kind === 'cut'
                ? [this.cutItemId(selection.index)]
                : selection.kind === 'caption' || selection.kind === 'audio' ? [] : [selection.id]);
            let changed: string[] = [];
            void this.commitEditMutation('まとめる', doc => {
                const result = groupTreeV2Items(doc, ids);
                changed = result.value.changedOrderIds;
                return result.document;
            }).then(() => {
                if (changed.length > 0) this.showNotice(`${changed.join('、')} の前後が変わりました`);
            }).catch(error => this.showNotice(`まとめられません: ${this.errorMessage(error)}`));
            return;
        }
        if (id === 'ungroup' && item.kind === 'item') {
            void this.commitEditMutation('ばらす', doc => ungroupTreeV2Item(doc, item.id).document)
                .catch(error => this.showNotice(this.errorMessage(error).includes('袋グループ')
                    ? '袋はばらせません。部品を出してください' : `ばらせません: ${this.errorMessage(error)}`));
            return;
        }
        if (id === 'toggle-collapse' && item.kind === 'item') {
            const expanding = this.timelineCollapsedIds.has(item.id);
            this.timelineCollapsedState?.set(item.id, expanding);
            if (expanding) this.timelineCollapsedIds.delete(item.id);
            else this.timelineCollapsedIds.add(item.id);
            this.refreshTimelineTreeRows();
            return;
        }
        if (id === 'select-parent' && item.kind === 'item') {
            const row = parentRow(this.timelineTreeRows, item.id);
            if (row) this.applySelection({
                kind: 'item', id: row.id, itemKind: row.itemKind,
                parentId: row.parentId, trackId: row.trackId
            });
            return;
        }
        if (id === 'delete') {
            void this.performDeleteSelected();
        }
    }

    /** タイムライン上の右クリックから直接追加する経路。一覧・入力欄は注釈パネルが持つ。 */
    protected async submitAnnotation(text: string, sourceT: number): Promise<void> {
        if (!text || !this.location) {
            return;
        }
        try {
            const result = await this.review.addAnnotation(text, sourceT);
            this.hideNotice();
            this.renderStrip();
            this.footer.textContent = result.committed
                ? '注釈を追加しました。変更を記録しました。'
                : '注釈を追加しました。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`注釈を追加できません: ${detail}`);
            this.messages.error(`注釈を追加できません: ${detail}`);
        }
    }

    protected showWarnings(warnings: readonly string[]): void {
        if (warnings.length > 0) {
            this.showNotice(warnings.join(' '));
        } else {
            this.hideNotice();
        }
    }

    protected showNotice(message: string): void {
        this.notice.setMessage(message);
    }

    protected hideNotice(): void {
        this.notice.clear();
    }

    protected formatRulerTimestamp(value: number): string {
        const seconds = Math.max(0, Math.floor(value));
        const minutes = Math.floor(seconds / 60);
        return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }

    protected formatTimestamp(value: number): string {
        const milliseconds = Math.max(0, Math.round(value * 1000));
        const hours = Math.floor(milliseconds / 3_600_000);
        const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
        const seconds = Math.floor((milliseconds % 60_000) / 1000);
        const fraction = milliseconds % 1000;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
            `${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
