import URI from '@theia/core/lib/common/uri';
import { currentTimelineEditUri, currentTimelineCaptionsUri } from './active-timeline';
import { CommandRegistry, MessageService } from '@theia/core/lib/common';
import { AkariPreviewService, type OverlayRuntimeAssetUrls } from 'akari-preview/lib/common/akari-preview-protocol';
import { createCaptionPanel, CAPTION_PANEL_CSS, type CaptionPanelMyStyle, type CaptionPanelViewState } from './inspector/caption-panels';
import { INSPECTOR_WIDGET_CSS } from './style/inspector-widget-style';
import { CAPTION_PANEL_FONTS } from '../common/caption-panel-catalog';
import { captionRevealDestination } from '../common/caption-reveal-destination';
import { captionRevealScrollTop } from '../common/caption-reveal-scroll';
import { captionPanelChangedDetail, captionPanelFontWrite, captionPanelLookWrite, nextCaptionPanel, renderableCaptionFonts, retainCaptionPanel, type CaptionPanel } from '../common/caption-panel-state';
import { advanceCaptionPanelPreview, shouldCaptureCaptionPanelPreviewEscape,
    type CaptionPanelPreviewAction, type CaptionPanelPreviewState } from '../common/caption-panel-preview-state';
import { CAPTION_FONT_FAMILY, CAPTION_FONT_LOAD_DESCRIPTOR, captionFontFaceCss } from 'akari-preview/lib/common/caption-visual-contract';
import { GENERATION_PICK_INTO_COMMAND_ID, GENERATION_CANCEL_PICK_COMMAND_ID, type GenerationPickRequest, type GenerationPickResult } from '../common/generation-pick-mirror';
import { AkariAnnotationsService } from '../common/akari-annotations-protocol';
import { AkariEditHistoryService } from './akari-edit-history-service';
import type { GenerationValidationResult, TranscriptSummary, NarrationEngine, ImageRouteState } from '../common/akari-annotations-protocol';
import type { VideoCandidate, VideoCandidateBatch } from '../common/akari-annotations-protocol';
import { resolveGenerationState, selectGenerationSidecarForSource, TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import { captionRunRows } from './inspector/caption-run-rows';
import { ApplicationShell, BaseWidget } from '@theia/core/lib/browser';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable, optional, postConstruct, type Container } from '@theia/core/shared/inversify';
import {
    InspectorWriteRequest,
    InspectorWriteResult,
    KeyframeControlRequest,
    LivePreviewRequest,
    LivePreviewTarget,
    TimelineAudioSelection,
    TimelineCaptionSelection,
    TimelineCutSelection,
    TimelineLayerSelection,
    TimelineItemSelectionSnapshot,
    TimelineKeyframeSelection,
    TimelineOverlaySelection,
    TimelineAudioMasterSnapshot,
    TimelineSelectionModel,
    TimelineSelectionTarget,
    TimelineTreeItemSnapshot,
    TimelineWorldSelection,
    TimelineGapSelection,
    captionIdForTreeSelection
} from './timeline-selection-model';
import { createSelectionHeader } from './inspector/selection-header';
import { viewForInspectorSelection, shouldDeferInspectorEmpty, rememberedInspectorScroll, withoutInspectorFocus, focusForInspectorRender, shouldRememberInspectorScroll, inspectorHeldHeight, inspectorScrollPin, mergeLiveValues, type InspectorViewState, type LiveValues } from './inspector/live-state';
import { aiActionCatalog, describeAiTiles } from '../common/ai-action-catalog';
import { aiGenerationKindFor, aiTabAvailabilityFor, aiTabViewFor, aiTargetKindFor, appendAiBack, appendAiTiles, photoToolAvailabilityFor, type AiTabView } from './inspector/ai-tiles';
import { editCorrectionVisible } from './inspector/edit-correction-visibility';
import { viewAfterHomeTabClick } from './inspector/home-tab';
import { appendHomeTuneTiles, homeTuneTiles } from './inspector/home-tune';
import { appendAiStillNotice, appendAiStillPanel, firstSuccessfulStillCandidate, maxStillReferences, nearestStillAspect, placeStillInEdit, replaceStillInEdit, savedStillCrop, savedStillInput, savedStillRoute, stillMismatchNotice, stillRouteAvailability, stillRouteIds, stillRouteLabel, type AiStillState, type StillAspect, type StillFalEstimate } from './inspector/ai-still-panel';
import { appendAiStillResultPanel } from './inspector/ai-still-result-panel';
import { appendAiVideoCandidatesPanel, clearVideoPlayer, replaceVideoInEdit, videoApprovalMessage, videoCandidatePreviewDetail,
    shouldClearVideoCandidatePreview, videoModelGroups, videoModelName,
    videoMakerId, videoProgress, videoProgressCandidate, videoProgressLayoutKey, type AiVideoState } from './inspector/ai-video-candidates-panel';
import { generationDraftFromDone, generationProvenance } from './inspector/generation-provenance';
import { stillMakerBadge } from './inspector/maker-badge';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const generationModelShelf = require('../../../../../../packages/schemas/ai-models.json') as {
    models: Array<{ id: string; name?: string; family?: string; maker?: string }>;
};
import { FrameAspectLive, frameSizeFromPng, frameSizeFromResolution, type FrameSize } from './inspector/frame-aspect-live';
import { appendAiTranscribePanel, resolveAiTranscribeTarget, type AiTranscribeEngine, type AiTranscribeTarget } from './inspector/ai-transcribe-panel';
import { appendAiMaterialView } from './inspector/ai-material-view';
import { appendImageAiPanel, type ImageAiPanelState } from './inspector/image-ai-panel';
import { AKARI_MATERIAL_SELECTED_EVENT, materialSelectionFromDetail, type AkariMaterialSelection } from '../common/material-selected-event';
import { appendAiNarrationPanel, chooseAiNarrationVoice, initialAiNarrationState, narrationBatchConfirm, type AiNarrationState } from './inspector/ai-narration-panel';
import { aiNarrationSourcePath, placeAiNarration, planAiNarrationPlacement, type NarrationTrack } from '../common/ai-narration-placement';
import { createInspectorIcon } from './inspector/icons';
import { enableShapeStroke, shapeControlGroups, shapeNumber, shapeOptionValue, swapShapeEnds } from './inspector/shape-fields';
import { shapeLiveMarkup } from './inspector/shape-live';
import { itemMotionMarks } from './inspector/motion-marks';
import { isInspectorStillImage } from './inspector/edit-target';
import {
    CAPTION_BACKGROUND_ON_OPACITY, captionEffectFromStyle, captionEffectPatch, captionEffectTransitionPatch,
    captionEffectPreviewStyle,
    captionEffectColorPatch, captionEffectStrength, captionEffectStrengthPatch,
    CAPTION_EFFECT_GROUPS, captionEffectCard, captionEffectAdjustmentKeys,
    captionEffectAdjustmentValue, captionEffectAdjustmentPatch
} from './inspector/caption-style-effects';
import { captionEffectImage, scheduleCaptionEffectImages } from './inspector/caption-effect-images';
import { createCaptionMotionPanel, type CaptionMotionServices } from './inspector/caption-motion-panel';
import { readCaptionMotionCue, readOwnerMotion, upsertCaptionEmphasis, upsertCaptionKaraoke } from './inspector/caption-motion-document';
import { worldInstructionCopy } from '../common/world-instruction-copy';
import { keyframeRowPropertyOf, keyframeValueAt, type KeyframeSeatProperty } from './timeline/timeline-keyframe-rows';
import { CAPTION_ZONES, type CaptionBackgroundMode, type CaptionTextStyle } from '../common/caption-store';
import {
    createNumberField,
    INSPECTOR_LIVE_PREVIEW_THROTTLE_MS,
    type KeyframeSeatOptions
} from './inspector/number-field';
import {
    createInspectorCropWriteRequest,
    INSPECTOR_CROP_DISPLAY_SCALE,
    INSPECTOR_CROP_SCRUB_STEP,
    inspectorCropAxisMaximum,
    normalizeInspectorCrop,
    type InspectorCropAxis
} from './inspector/crop-fields';
import {
    normalizeInspectorPerspective,
    updateInspectorPerspective,
    validateInspectorPerspective,
    type InspectorPerspectiveCorner,
    type InspectorPerspectiveAxis
} from './inspector/perspective-fields';
import { createCutTransitionWriteRequest, transitionOptionLabel } from './inspector/transition-fields';
import { createMaskWriteRequest, maskOptionLabel, maskOptionLabels } from './inspector/mask-fields';
import { openPhotoEditPanel } from './inspector/photo-edit-panel';
import {
    createMotionWriteRequest, normalizeInspectorMotion, MOTION_IN_OUT_PRESETS, MOTION_LOOP_PRESETS,
    MOTION_EASES, MOTION_PRESET_LABELS, MOTION_DURATION_DEFAULTS, MOTION_AMOUNT_DEFAULTS,
    type InspectorMotionSnapshot, type InspectorMotionSlot, type InspectorMotionField
} from './inspector/motion-fields';
import {
    addCutFramingKeyframe,
    createCutFramingCropWriteRequest,
    readCutFraming,
    removeCutFramingKeyframe,
    replaceCutFramingKeyframe,
    type CutFramingKeyframe
} from './inspector/framing-fields';
import {
    createCutFreezeWriteRequest,
    cutPlaybackDuration,
    resolveCutFreezeDisplayAt
} from './inspector/freeze-fields';
import {
    generationFields,
    type GenerationCatalogRow,
    type GenerationDraft,
    type GenerationFieldDef,
    type GenerationValidation
} from './inspector/generation-fields';
import { buildGenerationBatch, executeGenerationBatch, type GenerationBatchItem, type GenerationBatchProgress } from './inspector/generation-batch';
import { buildRgbCurveEditor, buildHueCurveEditor, buildColorWheelEditor, type AdjustEditorWrite } from './inspector/adjust-editors';
import { INSPECTOR_LOOK_PRESETS, matchLookPreset } from './inspector/look-presets';
import { buildLutOptions } from './inspector/lut-options';
import { nextPhotoBrushItem } from './inspector/photo-brush-state';
import { nextAdjustCompareState, type AdjustCompareState } from './inspector/adjust-compare';
import { ADJUST_PREVIEW_SECTIONS, type AdjustPreviewSection } from './inspector/adjust-preview';
import {
    AUDIO_ITEM_PREVIEW_SECTIONS,
    AUDIO_PREVIEW_SECTIONS,
    type AudioPreviewSection
} from './inspector/audio-preview';
import {
    AUDIO_MASTER_DEFAULT_LOUDNORM,
    AUDIO_MASTER_DEFAULT_TRUE_PEAK_DBTP
} from './inspector/audio-master';
import { createAudioClipFxWriteRequest, type AudioClipFxRow } from './inspector/audio-clip-fx';
import {
    createInspectorAdjustWriteRequest,
    formatInspectorAdjustValue,
    INSPECTOR_ADJUST_BASIC_FIELDS,
    readInspectorAdjustSnapshot
} from './inspector/adjust-fields';
import {
    INSPECTOR_ADJUST_FX, InspectorAdjustFx, addInspectorAdjustFx, removeInspectorAdjustFx,
    moveInspectorAdjustFx, updateInspectorAdjustFxParam
} from './inspector/adjust-fx-fields';
import {
    INSPECTOR_ANIMATOR_BASES, INSPECTOR_ANIMATOR_SHAPES, INSPECTOR_ANIMATOR_NUMBER_FIELDS,
    normalizeInspectorAnimators, addInspectorAnimator, addInspectorAnimatorTemplate,
    INSPECTOR_ANIMATOR_TEMPLATES, inspectorAnimatorTemplateFor, expandedAnimatorFields,
    removeInspectorAnimator, moveInspectorAnimator,
    updateInspectorAnimator, type InspectorAnimator, type InspectorAnimatorAmountKey
} from './inspector/animator-fields';
import {
    composeInspectorSections,
    InspectorSectionDef,
    InspectorSectionState
} from './inspector/section-model';
import {
    ACTIVE_ADJUST_SECTIONS,
    assignSectionToTab,
    type InspectorTabDef,
    initialTabFor,
    InspectorTabState,
    tabsForKind
} from './inspector/tab-model';
import {
    filterInspectorSoloSections,
    type InspectorSoloState
} from './inspector/solo-model';
import {
    findKnobForVar,
    isFontFamilyKnob,
    InspectorKnob,
    knobControlKind,
    overlayMetaPath,
    parseInspectorKnobs
} from './inspector/knob-resolver';
import { chromaControlValue, telopParamControlKind } from './inspector/field-mappings';
import { ColorPanelHost, ColorPanelResolved } from './inspector/color-panel-host';
import { createColorRowSwatch, swatchBackground } from './inspector/color-panel';
import { itemPathPatch, Paint, parseColorPanelOpenRequest, parsePaint, TRANSPARENT_PAINT } from './inspector/color-model';
import type {
    AudioEnvelopeKeyframePayload
} from '../common/akari-annotations-protocol';

type InspectorSnapshot = TimelineItemSelectionSnapshot;
/** RPC request payloads retain the selected edit URI while common protocols stay on their own lane. */
function activeEditRequest(root: URI): { editUri: string } {
    return { editUri: currentTimelineEditUri(root).toString() };
}
const GENERATION_SECTION_ID = 'generation';

type AudioInspectorSnapshot = TimelineAudioSelection & {
    duckDb?: number;
    duckAttack?: number;
    duckRelease?: number;
    keyframes?: AudioEnvelopeKeyframePayload[];
    keyframeFrames?: boolean;
    fps?: number;
    playheadSeconds?: number;
};

interface InspectorFieldDef<TSnapshot = InspectorSnapshot> {
    name?: string;
    revealName?: string;
    label: string;
    markers?: readonly string[];
    getValue: (snapshot: TSnapshot) => string;
    /** 編集用入力欄の初期値。省略時は getValue の戻り値を使う。 */
    getEditValue?: (snapshot: TSnapshot) => string;
    /** フィールドの値型に対応した入力 UI。 */
    inputKind?: 'boolean-select' | 'select' | 'zone-grid' | 'scrub-number' | 'slider-number'
        | 'caption-toggle' | 'caption-mode' | 'caption-effect' | 'caption-weight' | 'caption-text' | 'number' | 'color' | 'text' | 'media';
    options?: readonly string[];
    optionTitles?: Readonly<Record<string, string>>;
    scrubStep?: number;
    min?: number;
    max?: number;
    sliderMax?: number;
    unit?: string;
    displayScale?: number;
    displayOffset?: number;
    displayPrecision?: number;
    keyframeDisabled?: boolean;
    removable?: boolean;
    disabled?: boolean;
    title?: string;
    className?: string;
    actionLabel?: string;
    busyLabel?: string;
    action?: (snapshot: TSnapshot) => Promise<InspectorWriteResult>;
    pressed?: () => boolean;
    actions?: readonly {
        name: string;
        label: string;
        title: string;
        disabled?: boolean;
        action: (snapshot: TSnapshot) => Promise<InspectorWriteResult>;
    }[];
    menuAction?: {
        label: string;
        action: (snapshot: TSnapshot) => Promise<InspectorWriteResult>;
    };
    reset?: (snapshot: TSnapshot) => Promise<InspectorWriteResult>;
    /** 文字列の型変換と検証を行い、妥当な値だけを書き込みブリッジへ渡す。 */
    write?: (snapshot: TSnapshot, nextValue: string) => Promise<InspectorWriteResult>;
    /**
     * scrub-number ドラッグ中に書き込みなしでプレビューへ即時反映する対象フィールド。
     * cuts/layers の transform/opacity/crop に設定する。
     */
    liveField?: LivePreviewRequest['field'];
    liveShape?: (value: number | undefined) => void;
    liveColor?: (value: string) => void;
    previewOption?: (value: string) => void;
    zoneHover?: (value: string | null) => void;
    zonePreset?: (value: string) => void;
}

const CAPTION_ZONE_HOVER_EVENT = 'akari.caption.zoneHover';
const CAPTION_ZONE_PRESET_EVENT = 'akari.caption.zonePreset';

const KEYFRAME_EASING_OPTIONS = [
    'linear', 'ease-in-out',
    'in-quad', 'out-quad', 'in-out-quad',
    'in-cubic', 'out-cubic', 'in-out-cubic',
    'in-quart', 'out-quart', 'in-out-quart',
    'in-expo', 'out-expo', 'in-out-expo',
    'in-back', 'out-back', 'in-out-back', 'out-bounce', 'out-elastic',
    'cubic-bezier(0.42,0,0.58,1)', 'hold'
] as const;

interface InspectorSectionEnable {
    name: string;
    label: string;
    checked: boolean;
    write: (enabled: boolean) => Promise<InspectorWriteResult>;
}

type InspectorSection<TSnapshot = InspectorSnapshot> = InspectorSectionDef<InspectorFieldDef<TSnapshot>> & {
    enable?: InspectorSectionEnable;
    body?: (snapshot: TSnapshot) => HTMLElement;
};

function formatTimestamp(value: number): string {
    const milliseconds = Math.max(0, Math.round(value * 1000));
    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
    const seconds = Math.floor((milliseconds % 60_000) / 1000);
    const fraction = milliseconds % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
        `${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
}

function formatDurationSeconds(value: number): string {
    return `${value.toFixed(2)} 秒`;
}

function formatDecimal1(value: number): string {
    return value.toFixed(1);
}

function formatDecimal2(value: number): string {
    return value.toFixed(2);
}

function withDefaultNumber(
    raw: number | undefined,
    defaultValue: number,
    formatFn: (value: number) => string
): string {
    return raw === undefined ? `${formatFn(defaultValue)}（既定）` : formatFn(raw);
}

function withDefaultBoolean(raw: boolean | undefined, defaultValue: boolean): string {
    const format = (value: boolean): string => value ? 'ON' : 'OFF';
    return raw === undefined ? `${format(defaultValue)}（既定）` : format(raw);
}

function orDash<T>(raw: T | null | undefined, formatFn: (value: T) => string): string {
    return raw === null || raw === undefined ? '—' : formatFn(raw);
}

/** インスペクター「種別」フィールドの表示ラベル（sfx は音声クリップ語彙へ、2026-08-18）。 */
function formatAudioKindLabel(audioKind: TimelineAudioSelection['audioKind']): string {
    return audioKind === 'sfx' ? '音声クリップ' : audioKind;
}

const CAPTION_STYLE_DEFAULTS = {
    color: '#FFFFFF',
    sizePx: 38,
    fontWeight: 700,
    lineHeight: 1.42,
    letterSpacingEm: 0,
    strokeColor: '#000000',
    strokeWidthPx: 1.5,
    backgroundColor: '#000000',
    backgroundOpacity: 0,
    backgroundRadiusPx: 10,
    backgroundPaddingPx: 0,
    backgroundMode: 'per-line',
    zone: 'bottom'
} as const;

// 字幕描画の line-height 1.42 + 上下 padding 0.08em ずつの半分。
const CAPTION_PLATE_CAPSULE_HALF_HEIGHT_EM = (1.42 + 0.08 * 2) / 2;

type CaptionStyleFieldKey =
    | 'color'
    | 'size'
    | 'wrap-width'
    | 'font-weight'
    | 'line-height'
    | 'letter-spacing'
    | 'stroke-color'
    | 'stroke-width'
    | 'background-color'
    | 'background-opacity'
    | 'background-radius'
    | 'background-padding'
    | 'background-mode'
    | 'effect'
    | 'zone';

function captionFontFamilyField(snapshot: TimelineCaptionSelection,
    openFontPanel: () => Promise<boolean>): InspectorFieldDef<TimelineCaptionSelection> {
    const rawFamily = snapshot.effectiveTextStyle?.fontFamily ?? snapshot.textStyle?.fontFamily;
    const family = rawFamily === CAPTION_FONT_FAMILY ? 'Noto Sans JP' : rawFamily ?? 'Noto Sans JP';
    return {
        name: 'caption-font-family', label: 'フォント',
        getValue: () => family,
        actionLabel: `${family}  \u203a`,
        action: async () => await openFontPanel() ? { ok: true }
            : { ok: false, message: 'フォントパネルを開けませんでした。' }
    };
}

function captionRowFontFace(family: string, loadedFaces: ReadonlyMap<string, string>): string {
    if (family === 'Noto Sans JP' || family === CAPTION_FONT_FAMILY) return CAPTION_FONT_FAMILY;
    const font = CAPTION_PANEL_FONTS.find(entry => entry.family === family);
    return font ? loadedFaces.get(font.id) ?? family : family;
}

function captionStyleDisplayValue<T>(
    raw: T | undefined,
    effective: T | undefined,
    fallback: T,
    format: (value: T) => string = String
): string {
    const value = effective ?? fallback;
    return raw === undefined ? `${format(value)}（既定）` : format(value);
}

function isCaptionHexColor(value: string): boolean {
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value);
}

function effectiveCaptionBackgroundOpacity(style: CaptionTextStyle | undefined): number {
    if (style?.background?.opacity !== undefined) {
        return style.background.opacity;
    }
    const color = style?.background?.color;
    if (!color) {
        return CAPTION_STYLE_DEFAULTS.backgroundOpacity;
    }
    const hex = color.slice(1);
    if (hex.length !== 8) {
        return 1;
    }
    return Number((parseInt(hex.slice(6, 8), 16) / 255).toFixed(4));
}

function formatPayloadValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '—';
    }
    if (typeof value === 'object') {
        const json = JSON.stringify(value);
        return json.length > 120 ? `${json.slice(0, 117)}...` : json;
    }
    return String(value);
}

function deriveOverlayType(payload: Record<string, unknown>): string {
    const html = payload.html;
    if (typeof html !== 'string' || html.length === 0) {
        return '—';
    }
    const segments = html.split('/').filter(Boolean);
    if (segments.length >= 3) {
        return segments[segments.length - 2];
    }
    const fileName = segments[segments.length - 1] ?? html;
    return fileName.replace(/\.[^./]+$/, '');
}

function CROP_FIELDS<TSnapshot extends { id: string; crop?: unknown }>(
    snapshot: TSnapshot,
    targetKind: 'layer' | 'item',
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<TSnapshot>[] {
    const crop = normalizeInspectorCrop(snapshot.crop);
    const rows: ReadonlyArray<{ axis: InspectorCropAxis; label: string }> = [
        { axis: 'x', label: '左' },
        { axis: 'y', label: '上' },
        { axis: 'w', label: '幅' },
        { axis: 'h', label: '高さ' }
    ];
    return rows.map(({ axis, label }) => ({
        name: `crop-${axis}`,
        label,
        unit: '%',
        displayScale: INSPECTOR_CROP_DISPLAY_SCALE,
        getValue: () => String(crop[axis]),
        getEditValue: () => String(crop[axis]),
        inputKind: 'scrub-number',
        scrubStep: INSPECTOR_CROP_SCRUB_STEP,
        liveField: `crop.${axis}`,
        min: 0,
        max: inspectorCropAxisMaximum(crop, axis),
        removable: true,
        write: async (_snapshot, value) => requestWrite(createInspectorCropWriteRequest(
            { kind: targetKind, id: snapshot.id }, axis, Number(value)
        )),
        reset: () => requestWrite(createInspectorCropWriteRequest(
            { kind: targetKind, id: snapshot.id }, axis, null
        ))
    }));
}

function PERSPECTIVE_FIELDS<TSnapshot extends {
    id: string; perspective?: Record<string, unknown>; keyframes?: readonly Record<string, unknown>[];
}>(
    snapshot: TSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<TSnapshot>[] {
    const corners = normalizeInspectorPerspective(snapshot.perspective);
    const rows: ReadonlyArray<{ corner: InspectorPerspectiveCorner; label: string }> = [
        { corner: 'tl', label: '左上' }, { corner: 'tr', label: '右上' },
        { corner: 'bl', label: '左下' }, { corner: 'br', label: '右下' }
    ];
    const write = async (
        current: TSnapshot, corner: InspectorPerspectiveCorner, axis: InspectorPerspectiveAxis, input: number | null
    ): Promise<InspectorWriteResult> => {
        try {
            const value = updateInspectorPerspective(current.perspective, corner, axis, input);
            if (value) validateInspectorPerspective(value.corners);
            return await requestWrite({ kind: 'item-field', id: current.id, path: 'perspective', value });
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    };
    const fields = rows.flatMap(({ corner, label }, index) => (['x', 'y'] as const)
        .map((axis, coordinate): InspectorFieldDef<TSnapshot> => ({
            name: `perspective-${corner}-${axis}`, label: `${label} ${axis.toUpperCase()}`,
            unit: '%', displayScale: 100, inputKind: 'scrub-number',
            scrubStep: 0.005, min: 0, max: 1,
            getValue: () => String(corners[index][coordinate]),
            getEditValue: () => String(corners[index][coordinate]),
            liveField: `perspective.${corner}.${axis}`,
            write: (current, input) => write(current, corner, axis, Number(input)),
            reset: current => write(current, corner, axis, null)
        })));
    fields.push({
        name: 'perspective-clear', label: '解除', actionLabel: '解除', getValue: () => '',
        disabled: snapshot.perspective === undefined,
        action: current => requestWrite({ kind: 'item-field', id: current.id, path: 'perspective', value: null })
    });
    return fields;
}

function cutTransitionFields(
    snapshot: TimelineCutSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<TimelineCutSelection>[] {
    const options: string[] = ['なし', ...TRANSITION_VOCABULARY.map(entry => entry.labelJa)];
    const selected = transitionOptionLabel(snapshot.transitionOut?.type);
    if (!options.includes(selected)) options.push(selected);
    const blocked = snapshot.transitionOutBlocked !== undefined;
    const write = async (
        current: TimelineCutSelection, row: 'transition-type' | 'transition-duration', input: string | null
    ): Promise<InspectorWriteResult> => {
        try {
            return await requestWrite(createCutTransitionWriteRequest(current, row, input));
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    };
    return [{
        name: 'transition-type', label: 'トランジション', inputKind: 'select', options,
        getValue: () => selected, getEditValue: () => selected,
        disabled: blocked, title: snapshot.transitionOutBlocked,
        write: (current, input) => write(current, 'transition-type', input)
    }, {
        name: 'transition-duration', label: 'トランジション尺', inputKind: 'scrub-number',
        unit: 's', min: 0.1, max: 3, scrubStep: 0.05, displayPrecision: 2,
        getValue: () => String(snapshot.transitionOut?.duration ?? 0.5),
        getEditValue: () => String(snapshot.transitionOut?.duration ?? 0.5),
        disabled: blocked || !snapshot.transitionOut,
        title: snapshot.transitionOutBlocked ?? (!snapshot.transitionOut ? 'トランジションを選ぶと変更できます' : undefined),
        write: (current, input) => write(current, 'transition-duration', input),
        reset: current => write(current, 'transition-duration', null)
    }];
}

const CUT_FRAMING_CROP_DISABLED_TITLE = 'ズーム KF があるときは窓は無視されます';

function cutFramingFields(
    snapshot: TimelineCutSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<TimelineCutSelection>[] {
    const framing = readCutFraming(snapshot.framing);
    const crop = normalizeInspectorCrop(framing.crop);
    const keyframes = framing.keyframes ?? [];
    const cropDisabled = keyframes.length > 0;
    const duration = Math.max(0, snapshot.outputEnd - snapshot.outputStart);
    const cropRows: ReadonlyArray<{ axis: InspectorCropAxis; label: string }> = [
        { axis: 'x', label: '左' },
        { axis: 'y', label: '上' },
        { axis: 'w', label: '幅' },
        { axis: 'h', label: '高さ' }
    ];
    const fields: InspectorFieldDef<TimelineCutSelection>[] = cropRows.map(({ axis, label }) => ({
        name: `framing-crop-${axis}`,
        label,
        unit: '%',
        displayScale: INSPECTOR_CROP_DISPLAY_SCALE,
        getValue: () => String(crop[axis]),
        getEditValue: () => String(crop[axis]),
        inputKind: 'scrub-number',
        scrubStep: INSPECTOR_CROP_SCRUB_STEP,
        min: 0,
        max: inspectorCropAxisMaximum(crop, axis),
        disabled: cropDisabled,
        title: cropDisabled ? CUT_FRAMING_CROP_DISABLED_TITLE : undefined,
        write: async (_snapshot, value) => requestWrite(
            createCutFramingCropWriteRequest(snapshot.index, axis, Number(value))
        ),
        reset: () => requestWrite(createCutFramingCropWriteRequest(snapshot.index, axis, null))
    }));

    const replace = async (
        index: number,
        patch: Partial<CutFramingKeyframe>
    ): Promise<InspectorWriteResult> => {
        try {
            return requestWrite({
                kind: 'cut-framing-keyframes',
                index: snapshot.index,
                value: replaceCutFramingKeyframe(keyframes, index, patch)
            });
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    };
    keyframes.forEach((point, index) => {
        const prefix = `framing-keyframe-${index}`;
        const remove = {
            label: 'この KF を削除',
            action: async (): Promise<InspectorWriteResult> => requestWrite({
                kind: 'cut-framing-keyframes',
                index: snapshot.index,
                value: removeCutFramingKeyframe(keyframes, index)
            })
        };
        fields.push({
            name: `${prefix}-t`, label: `KF ${index + 1} 時刻`, unit: '秒',
            getValue: () => String(point.t), getEditValue: () => String(point.t),
            inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: duration,
            menuAction: remove,
            write: async (_snapshot, value) => {
                const t = Number(value);
                return !Number.isFinite(t) || t < 0 || t > duration
                    ? { ok: false, message: `KF 時刻は 0〜${duration} 秒の範囲で入力してください。` }
                    : replace(index, { t });
            }
        }, {
            name: `${prefix}-scale`, label: `KF ${index + 1} 倍率`, unit: '×',
            getValue: () => String(point.scale), getEditValue: () => String(point.scale),
            inputKind: 'scrub-number', scrubStep: 0.01, min: 1, max: 10,
            menuAction: remove,
            write: async (_snapshot, value) => {
                const scale = Number(value);
                return !Number.isFinite(scale) || scale < 1 || scale > 10
                    ? { ok: false, message: 'KF 倍率は 1〜10 の範囲で入力してください。' }
                    : replace(index, { scale });
            }
        }, ...(['cx', 'cy'] as const).map((axis): InspectorFieldDef<TimelineCutSelection> => ({
            name: `${prefix}-${axis}`,
            label: `KF ${index + 1} 中心 ${axis === 'cx' ? 'X' : 'Y'}`,
            unit: '%', displayScale: 100,
            getValue: () => String(point[axis] ?? 0.5),
            getEditValue: () => String(point[axis] ?? 0.5),
            inputKind: 'scrub-number', scrubStep: 0.005, min: 0, max: 1,
            menuAction: remove,
            write: async (_snapshot, value) => {
                const coordinate = Number(value);
                return !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1
                    ? { ok: false, message: `KF 中心 ${axis === 'cx' ? 'X' : 'Y'} は 0〜100% の範囲で入力してください。` }
                    : replace(index, { [axis]: coordinate });
            },
            reset: () => replace(index, { [axis]: undefined })
        })));
    });
    fields.push({
        name: 'framing-keyframe-add', label: '追加', actionLabel: '＋ ズーム KF を追加',
        getValue: () => '',
        action: async () => {
            const playhead = Math.max(0, Math.min(
                duration,
                (snapshot.playheadSeconds ?? snapshot.outputStart) - snapshot.outputStart
            ));
            try {
                return requestWrite({
                    kind: 'cut-framing-keyframes',
                    index: snapshot.index,
                    value: addCutFramingKeyframe(keyframes, playhead, duration)
                });
            } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        }
    });
    return fields;
}

function cutFreezeFields(
    snapshot: TimelineCutSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<TimelineCutSelection>[] {
    const duration = cutPlaybackDuration({
        in: snapshot.sourceIn,
        out: snapshot.sourceOut,
        ...(snapshot.speed !== undefined ? { speed: snapshot.speed } : {})
    });
    const at = resolveCutFreezeDisplayAt(
        snapshot.freeze,
        snapshot.playheadSeconds,
        snapshot.outputStart,
        duration
    );
    return [{
        name: 'freeze-at', label: '静止時刻', unit: '秒',
        getValue: () => String(at), getEditValue: () => String(at),
        inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: duration,
        write: async (_snapshot, value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return { ok: false, message: '静止時刻は有限数で入力してください。' };
            return requestWrite(createCutFreezeWriteRequest(snapshot.index, 'at', parsed));
        }
    }, {
        name: 'freeze-duration', label: '静止尺', unit: '秒', removable: true,
        getValue: () => String(snapshot.freeze?.duration_sec ?? 0),
        getEditValue: () => String(snapshot.freeze?.duration_sec ?? 0),
        inputKind: 'scrub-number', scrubStep: 0.01, min: 0,
        write: async (_snapshot, value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, message: '静止尺は 0 以上の有限数で入力してください。' };
            return requestWrite(createCutFreezeWriteRequest(snapshot.index, 'duration', parsed));
        },
        reset: () => requestWrite(createCutFreezeWriteRequest(snapshot.index, 'duration', null))
    }];
}

function CUT_SECTIONS(
    snapshot: TimelineCutSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    generation?: InspectorFieldDef<TimelineCutSelection>[],
    openMotion?: () => void
): InspectorSection[] {
    const photoItemId = /\.(png|jpe?g|webp|bmp|gif)$/iu.test(snapshot.sourcePath ?? '') ? snapshot.itemId : undefined;
    const photoFrameFields: InspectorFieldDef<TimelineCutSelection>[] = photoItemId ? [{
        name: 'photo-frame-width', label: '枠線の太さ', inputKind: 'scrub-number', unit: 'px', min: 0, max: 100,
        getValue: () => String(snapshot.frame?.stroke?.width ?? 0),
        write: (_current, value) => requestWrite({ kind: 'item-field', id: photoItemId,
            path: 'frame.stroke.width', value: Number(value) })
    }, {
        name: 'photo-frame-color', label: '枠線の色', inputKind: 'color',
        getValue: () => snapshot.frame?.stroke?.color ?? '#ffffff',
        write: (_current, value) => requestWrite({ kind: 'item-field', id: photoItemId,
            path: 'frame.stroke.color', value })
    }, {
        name: 'photo-frame-radius', label: '角の丸み', inputKind: 'scrub-number', unit: '%', min: 0, max: 100,
        getValue: () => String(snapshot.frame?.cornerRadius ?? 0),
        write: (_current, value) => requestWrite({ kind: 'item-field', id: photoItemId,
            path: 'frame.cornerRadius', value: Number(value) })
    }] : [];
    const transformFields: InspectorFieldDef<TimelineCutSelection>[] = [
        {
            name: 'transform-x', label: 'X', unit: 'px',
            getValue: () => String(snapshot.transform?.x ?? 0),
            getEditValue: () => String(snapshot.transform?.x ?? 0),
            inputKind: 'scrub-number', scrubStep: 1, liveField: 'x',
            write: async (_snapshot, nextValue) => {
                const parsed = Number(nextValue);
                if (!Number.isFinite(parsed)) return { ok: false, message: 'X は有限数値で入力してください。' };
                return requestWrite({ kind: 'cut-transform-x', index: snapshot.index, value: parsed });
            },
            reset: () => requestWrite({ kind: 'cut-transform-x', index: snapshot.index, value: null })
        },
        {
            name: 'transform-y', label: 'Y', unit: 'px',
            getValue: () => String(snapshot.transform?.y ?? 0),
            getEditValue: () => String(snapshot.transform?.y ?? 0),
            inputKind: 'scrub-number', scrubStep: 1, liveField: 'y',
            write: async (_snapshot, nextValue) => {
                const parsed = Number(nextValue);
                if (!Number.isFinite(parsed)) return { ok: false, message: 'Y は有限数値で入力してください。' };
                return requestWrite({ kind: 'cut-transform-y', index: snapshot.index, value: parsed });
            },
            reset: () => requestWrite({ kind: 'cut-transform-y', index: snapshot.index, value: null })
        },
        {
            name: 'transform-scale', label: '拡縮', unit: '%', removable: true,
            getValue: () => String((snapshot.transform?.scale ?? 1) * 100),
            getEditValue: () => String((snapshot.transform?.scale ?? 1) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: 'scale',
            write: async (_snapshot, nextValue) => {
                const parsed = Number(nextValue) / 100;
                if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, message: '拡縮は正の数で入力してください。' };
                return requestWrite({ kind: 'cut-scale', index: snapshot.index, value: parsed });
            },
            reset: () => requestWrite({ kind: 'cut-scale', index: snapshot.index, value: null })
        },
        {
            name: 'transform-rotate', label: '回転', unit: '°', removable: true,
            getValue: () => String(snapshot.transform?.rotate ?? 0),
            getEditValue: () => String(snapshot.transform?.rotate ?? 0),
            inputKind: 'scrub-number', scrubStep: 0.1, liveField: 'rotate',
            write: async (_snapshot, nextValue) => {
                const parsed = Number(nextValue);
                if (!Number.isFinite(parsed)) return { ok: false, message: '回転は有限数値で入力してください。' };
                return requestWrite({ kind: 'cut-rotate', index: snapshot.index, value: parsed });
            },
            reset: () => requestWrite({ kind: 'cut-rotate', index: snapshot.index, value: null })
        }
    ];
    return composeInspectorSections([
        {
            id: 'time', label: '時間', fields: [
                { name: 'output-start', label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
                // Same source extensions as isStillImageCut; empty/planned frames are PNG cards.
                /\.(png|jpe?g|webp|bmp|gif)$/iu.test(snapshot.sourcePath ?? '') ? {
                    name: 'duration', label: '長さ', unit: '秒',
                    getValue: () => String(snapshot.outputEnd - snapshot.outputStart),
                    getEditValue: () => String(snapshot.outputEnd - snapshot.outputStart),
                    inputKind: 'scrub-number', scrubStep: 0.5, displayPrecision: 1, min: 0.5,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed)) return { ok: false, message: '長さは有限数で入力してください。' };
                        return requestWrite({ kind: 'cut-source-out', index: snapshot.index,
                            value: Math.round(parsed * 10) / 10 });
                    }
                } : { name: 'duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.outputEnd - snapshot.outputStart) },
                ...cutTransitionFields(snapshot, requestWrite)
            ]
        },
        { id: 'transform', label: '変形', fields: transformFields },
        MOTION_SUMMARY_SECTION(snapshot.motion, openMotion),
        ...(snapshot.itemId && snapshot.durationFrames ? (() => {
            const fields = MOTION_FIELDS({ id: snapshot.itemId, durationFrames: snapshot.durationFrames,
                motion: snapshot.motion }, requestWrite);
            return ([['draw', '動きを描く'], ['in', '登場'], ['loop', '強調'], ['out', '退場']] as const)
                .map(([slot, label]) => ({ id: `motion:${slot}`, label,
                    fields: fields.filter(field => slot === 'draw' ? field.name === 'motion-draw'
                        : field.name?.startsWith(`motion-${slot}-`)) }))
                .filter(section => section.fields.length > 0);
        })() : [MOTION_EMPTY_SECTION()]),
        { id: 'framing', label: 'フレーミング', fields: cutFramingFields(snapshot, requestWrite) },
        { id: 'freeze', label: 'フリーズ', fields: cutFreezeFields(snapshot, requestWrite) },
        ...(generation ? [{ id: GENERATION_SECTION_ID, label: '生成', fields: generation }] : []),
        {
            id: 'appearance', label: '外観', fields: [
                {
                    name: 'opacity', label: '不透明度', unit: '%', displayScale: 100,
                    getValue: () => String(snapshot.opacity ?? 1), getEditValue: () => String(snapshot.opacity ?? 1),
                    inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1, liveField: 'opacity',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return { ok: false, message: '不透明度は 0〜100% の範囲で入力してください。' };
                        return requestWrite({ kind: 'cut-opacity', index: snapshot.index, value: parsed });
                    },
                    reset: () => requestWrite({ kind: 'cut-opacity', index: snapshot.index, value: null })
                },
                ...(photoItemId ? [{
                    name: 'photo-crop-open', label: '切り抜き', getValue: () => '', actionLabel: '切り抜き',
                    action: () => requestWrite({ kind: 'item-field', id: photoItemId,
                        path: 'photo-crop-open', value: null })
                }, ...photoFrameFields] : [])
            ]
        },
        {
            id: 'timing', label: '再生', fields: [
                {
                    name: 'speed', label: 'speed',
                    getValue: () => withDefaultNumber(snapshot.speed, 1, formatDecimal1),
                    getEditValue: () => String(snapshot.speed ?? 1),
                    inputKind: 'scrub-number', scrubStep: 0.01, min: 0.01,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, message: 'speed は正の数で入力してください。' };
                        return requestWrite({ kind: 'cut-speed', index: snapshot.index, value: parsed });
                    }
                }
            ]
        },
        {
            id: 'audio', label: '埋め込み音声', fields: [
                {
                    name: 'gain-db', label: '音量', unit: 'dB', removable: true,
                    getValue: () => String(snapshot.audioGainDb ?? 0) + (snapshot.audioMute === true ? '（ミュート中）' : ''),
                    getEditValue: () => String(snapshot.audioGainDb ?? 0),
                    inputKind: 'scrub-number', scrubStep: 0.5, min: -60, max: 12,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < -60 || parsed > 12) {
                            return { ok: false, message: '埋め込み音声の音量は -60〜12 dB の範囲で入力してください。' };
                        }
                        return requestWrite({ kind: 'cut-audio-gain', index: snapshot.index, value: parsed });
                    },
                    reset: () => requestWrite({ kind: 'cut-audio-gain', index: snapshot.index, value: null })
                },
                {
                    name: 'mute', label: 'ミュート',
                    getValue: () => String(snapshot.audioMute === true),
                    getEditValue: () => String(snapshot.audioMute === true),
                    inputKind: 'boolean-select',
                    write: async (_snapshot, nextValue) => requestWrite({
                        kind: 'cut-audio-mute', index: snapshot.index, value: nextValue === 'true'
                    })
                }
            ]
        },
        {
            id: 'info', label: '情報', collapsedByDefault: true,
            fields: [
                { name: 'track', label: 'トラック', getValue: () => snapshot.trackName },
                { name: 'clip', label: 'クリップ', getValue: () => snapshot.clipName },
                { name: 'src', label: 'src', getValue: () => snapshot.src ?? snapshot.sourceName }
            ]
        }
    ]);
}

const LAYER_BLEND_OPTIONS = [
    'normal', 'screen', 'multiply', 'add', 'difference',
    'darken', 'lighten', 'overlay', 'hardlight', 'softlight'
] as const;

const photoBrushSettings: { mode: 'erase' | 'restore'; size: number; hardness: number } = {
    mode: 'erase', size: 0.05, hardness: 0.8
};
let activePhotoBrushItemId: string | null = null;

function PHOTO_PANEL_FIELDS<T extends TimelineLayerSelection | TimelineTreeItemSnapshot | TimelineCutSelection>(
    snapshot: T, requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    const sourcePath = snapshot.kind === 'cut' ? snapshot.sourcePath : snapshot.sourcePath ?? snapshot.src;
    if (!snapshot.photo && !isInspectorStillImage(sourcePath)) return [];
    return [{
        name: 'photo-cutout-panel', label: '背景透過', getValue: () => '', actionLabel: '背景透過を開く',
        action: async (current: T) => { openPhotoEditPanel({ id: current.kind === 'cut' ? current.itemId ?? '' : current.id, write: requestWrite,
            mode: 'cutout', maskFeather: current.maskFeather, regions: current.regions,
            adjust: current.adjust as Record<string, any> }); return { ok: true }; }
    }, {
        name: 'photo-region-panel', label: '選択エリア', getValue: () => '', actionLabel: 'エリアを選択',
        action: async (current: T) => { openPhotoEditPanel({ id: current.kind === 'cut' ? current.itemId ?? '' : current.id, write: requestWrite,
            mode: 'regions', maskFeather: current.maskFeather, regions: current.regions,
            adjust: current.adjust as Record<string, any> }); return { ok: true }; }
    }];
}

function MASK_FIELDS<T extends TimelineLayerSelection | TimelineTreeItemSnapshot>(
    snapshot: T,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    if (snapshot.maskSourceOptions === undefined) return [];
    const options = maskOptionLabels(snapshot.maskSourceOptions);
    const selected = maskOptionLabel(snapshot.maskSourceOptions, snapshot.mask);
    if (!options.includes(selected)) options.push(selected);
    const disabled = snapshot.maskSourceOptions.length === 0;
    const title = snapshot.photo ? 'PNG（白 = 表示・黒 = 透過）' : 'グレースケール動画（白 = 表示・黒 = 透過）';
    return [{
        name: 'mask', label: 'マスク', inputKind: 'select', options,
        getValue: () => selected, getEditValue: () => selected,
        disabled, title: disabled ? `プロジェクトにマスクがありません。${title}` : title,
        write: async (current, value) => {
            try {
                if (disabled) return { ok: false, message: 'プロジェクトにマスクがありません' };
                return await requestWrite(createMaskWriteRequest(current, value));
            } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        },
        reset: current => requestWrite(createMaskWriteRequest(current, 'なし'))
    }, ...(snapshot.photo ? [{
        name: 'photo-mask-generate', label: '背景', getValue: () => '',
        actionLabel: '背景を消す（この Mac で）',
        busyLabel: '背景を消しています…',
        action: (current: T) => requestWrite({ kind: 'item-field', id: current.id, path: 'photo-mask', value: null })
    }, {
        name: 'photo-mask-remove', label: 'マスク', getValue: () => '',
        actionLabel: 'マスクを外す',
        action: (current: T) => requestWrite({ kind: 'item-field', id: current.id, path: 'mask', value: null })
    }, {
        name: 'photo-brush-mode', label: '消しゴム', inputKind: 'select' as const,
        options: ['消す', '戻す'], getValue: () => photoBrushSettings.mode === 'erase' ? '消す' : '戻す',
        write: async (_current: T, value: string) => {
            photoBrushSettings.mode = value === '戻す' ? 'restore' : 'erase';
            return { ok: true };
        }
    }, {
        name: 'photo-brush-size', label: '大きさ', inputKind: 'scrub-number' as const,
        getValue: () => String(photoBrushSettings.size * 100), getEditValue: () => String(photoBrushSettings.size * 100),
        min: 0.1, max: 100, unit: '%', write: async (_current: T, value: string) => {
            const size = Number(value) / 100;
            if (!Number.isFinite(size) || size <= 0 || size > 1) return { ok: false, message: '大きさは 0〜100% で指定してください' };
            photoBrushSettings.size = size;
            return { ok: true };
        }
    }, {
        name: 'photo-brush-hardness', label: '硬さ', inputKind: 'scrub-number' as const,
        getValue: () => String(photoBrushSettings.hardness * 100), getEditValue: () => String(photoBrushSettings.hardness * 100),
        min: 0, max: 100, unit: '%', write: async (_current: T, value: string) => {
            const hardness = Number(value) / 100;
            if (!Number.isFinite(hardness) || hardness < 0 || hardness > 1) return { ok: false, message: '硬さは 0〜100% で指定してください' };
            photoBrushSettings.hardness = hardness;
            return { ok: true };
        }
    }, {
        name: 'photo-brush-start', label: '消しゴム', getValue: () => '', actionLabel: '消しゴム',
        pressed: () => activePhotoBrushItemId === snapshot.id,
        action: async (current: T) => {
            const previous = activePhotoBrushItemId;
            const next = nextPhotoBrushItem(activePhotoBrushItemId, current.id);
            activePhotoBrushItemId = next;
            try {
                const result = await requestWrite({ kind: 'item-field', id: current.id,
                    path: 'photo-brush-toggle', value: next ? { ...photoBrushSettings } : null });
                if (!result.ok) activePhotoBrushItemId = previous;
                return result;
            } catch (error) {
                activePhotoBrushItemId = previous;
                throw error;
            }
        }
    }] : [])];
}

function PHOTO_FLIP_FIELDS<T extends TimelineLayerSelection | TimelineTreeItemSnapshot>(
    snapshot: T, requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    if (!snapshot.photo) return [];
    return (['h', 'v'] as const).map(axis => ({
        name: `photo-flip-${axis}`, label: axis === 'h' ? '左右反転' : '上下反転',
        inputKind: 'select' as const, options: ['する', 'しない'],
        getValue: () => snapshot.flip?.[axis] ? 'する' : 'しない',
        getEditValue: () => snapshot.flip?.[axis] ? 'する' : 'しない',
        write: (_current: T, value: string) => requestWrite({
            kind: 'item-field', id: snapshot.id, path: `flip.${axis}`, value: value === 'する'
        })
    }));
}

function PHOTO_FRAME_FIELDS<T extends TimelineLayerSelection | TimelineTreeItemSnapshot>(
    snapshot: T, requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    if (!snapshot.photo) return [];
    return [{
        name: 'photo-frame-width', label: '枠線の太さ', inputKind: 'scrub-number', unit: 'px',
        min: 0, max: 100, scrubStep: 1,
        getValue: () => String(snapshot.frame?.stroke?.width ?? 0),
        write: (_current, value) => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'frame.stroke.width', value: Number(value) })
    }, {
        name: 'photo-frame-color', label: '枠線の色', inputKind: 'color',
        getValue: () => snapshot.frame?.stroke?.color ?? '#ffffff',
        write: (_current, value) => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'frame.stroke.color', value })
    }, {
        name: 'photo-frame-radius', label: '角の丸み', inputKind: 'scrub-number', unit: '%',
        min: 0, max: 100, scrubStep: 1,
        getValue: () => String(snapshot.frame?.cornerRadius ?? 0),
        write: (_current, value) => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'frame.cornerRadius', value: Number(value) })
    }];
}

function PHOTO_CROP_OPEN_FIELD<T extends TimelineLayerSelection | TimelineTreeItemSnapshot>(
    snapshot: T, requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    return snapshot.photo ? [{ name: 'photo-crop-open', label: '切り抜き', getValue: () => '',
        actionLabel: '切り抜き', action: () => requestWrite({ kind: 'item-field', id: snapshot.id,
            path: 'photo-crop-open', value: null }) }] : [];
}

function MOTION_FIELDS<T extends InspectorMotionSnapshot>(
    snapshot: T,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef[] {
    const motion = normalizeInspectorMotion(snapshot.motion);
    return [...(snapshot.sourceKind !== 'caption' && snapshot.sourceKind !== 'captions' ? [{
        name: 'motion-draw', label: '動きを描く', getValue: () => '', actionLabel: 'プレビューで描く',
        action: () => requestWrite({ kind: 'item-field' as const, id: snapshot.id, path: 'motion-draw' as const, value: true })
    }] : []),
    ...(['in', 'loop', 'out'] as const).flatMap((slot: InspectorMotionSlot) => {
        const label = slot === 'in' ? '登場' : slot === 'out' ? '退場' : '強調';
        const seat = motion[slot];
        const amount = seat ? MOTION_AMOUNT_DEFAULTS[seat.preset] : undefined;
        const missingTitle = 'プリセットを選ぶと変更できます。';
        const write = async (_current: InspectorSnapshot, field: InspectorMotionField, input: string | null): Promise<InspectorWriteResult> => {
            try {
                return await requestWrite(createMotionWriteRequest(snapshot, slot, field, input));
            } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        };
        const selected = seat ? MOTION_PRESET_LABELS[seat.preset] : 'なし';
        const ease = seat?.ease ?? 'linear';
        const easeOptions: string[] = [...MOTION_EASES];
        if (!easeOptions.includes(ease)) easeOptions.push(ease);
        const frames = slot === 'loop' ? motion.loop?.period : motion[slot]?.duration;
        return ([
            {
                name: `motion-${slot}-preset`, label, inputKind: 'select',
                options: ['なし', ...(slot === 'loop' ? MOTION_LOOP_PRESETS : MOTION_IN_OUT_PRESETS).map(id => MOTION_PRESET_LABELS[id])],
                getValue: () => selected, getEditValue: () => selected, disabled: false,
                write: (current, input) => write(current, 'preset', input), reset: current => write(current, 'preset', null)
            },
            {
                name: `motion-${slot}-duration`, label: slot === 'loop' ? '周期' : `${label}の尺`,
                inputKind: 'scrub-number', unit: 'f', scrubStep: 1, displayPrecision: 0, min: 1,
                ...(slot === 'loop' ? {} : { max: snapshot.durationFrames }),
                getValue: () => String(frames ?? MOTION_DURATION_DEFAULTS[slot]),
                getEditValue: () => String(frames ?? MOTION_DURATION_DEFAULTS[slot]),
                disabled: !seat, title: seat ? undefined : missingTitle,
                write: (current, input) => write(current, 'duration', input), reset: current => write(current, 'duration', null)
            },
            {
                name: `motion-${slot}-ease`, label: `${label}のイージング`, inputKind: 'select', options: easeOptions,
                getValue: () => ease, getEditValue: () => ease,
                disabled: !seat, title: seat ? undefined : missingTitle,
                write: (current, input) => write(current, 'ease', input), reset: current => write(current, 'ease', null)
            },
            {
                name: `motion-${slot}-amount`, label: `${label}の量`, inputKind: 'scrub-number',
                unit: amount?.unit, scrubStep: amount?.unit === '倍' || amount?.unit === '量' ? 0.01 : 1,
                getValue: () => String(seat?.amount ?? amount?.value ?? 0),
                getEditValue: () => String(seat?.amount ?? amount?.value ?? 0),
                disabled: !seat || !amount, title: !seat ? missingTitle : !amount ? 'このプリセットに量はありません' : undefined,
                write: (current, input) => write(current, 'amount', input), reset: current => write(current, 'amount', null)
            }
        ] satisfies InspectorFieldDef[]).map(field => ({ ...field, keyframeDisabled: true }));
    })];
}

function MOTION_SECTIONS(snapshot: InspectorMotionSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>): InspectorSection[] {
    const fields = MOTION_FIELDS(snapshot, requestWrite);
    return [
        { id: 'motion:draw', label: '動きを描く', fields: fields.filter(field => field.name === 'motion-draw') },
        ...([['in', '登場'], ['loop', '強調'], ['out', '退場']] as const).map(([slot, label]) => ({
            id: `motion:${slot}`, label,
            fields: fields.filter(field => field.name?.startsWith(`motion-${slot}-`))
        }))
    ].filter(section => section.fields.length > 0);
}

function MOTION_SUMMARY_SECTION(motion: Record<string, unknown> | undefined, open?: () => void): InspectorSection {
    return { id: 'motion-summary', label: '動き', fields: [{
        name: 'motion-summary', label: '現在の動き',
        getValue: () => ['in', 'loop', 'out'].map(slot => {
            const seat = motion?.[slot] as { preset?: string } | undefined;
            return seat?.preset ? `${slot === 'in' ? '登場' : slot === 'out' ? '退場' : '強調'}: ${MOTION_PRESET_LABELS[seat.preset as keyof typeof MOTION_PRESET_LABELS] ?? seat.preset}` : '';
        }).filter(Boolean).join(' / ') || 'なし'
    }, {
        name: 'motion-open', label: '詳しい設定', getValue: () => '', actionLabel: '動きタブで開く',
        action: async () => { open?.(); return { ok: true }; }
    }] };
}

function MOTION_EMPTY_SECTION(message = 'この要素で使える動きはまだありません'): InspectorSection {
    return { id: 'motion-empty', label: '動き', fields: [{
        name: 'motion-unavailable', label: '設定', getValue: () => message
    }] };
}

interface LayerAudioControls {
    audio: boolean;
    gain_db: number;
    detached: boolean;
    write: (field: 'audio' | 'gain_db', value: boolean | number) => Promise<InspectorWriteResult>;
}
const layerAudioControls = new WeakMap<TimelineLayerSelection, LayerAudioControls | null>();

function LAYER_SECTIONS(
    snapshot: TimelineLayerSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    layerAudio?: LayerAudioControls | null,
    generation?: InspectorFieldDef<TimelineLayerSelection>[],
    openMotion?: () => void
): InspectorSection[] {
    const chromaSimilarity = chromaControlValue(snapshot.chromaKey, 'similarity', 0.1);
    const chromaBlend = chromaControlValue(snapshot.chromaKey, 'blend', 0);
    const cropFields = CROP_FIELDS(snapshot, 'layer', requestWrite);
    const maskFields = MASK_FIELDS(snapshot, requestWrite);
    const perspectiveSection = {
        id: 'perspective', label: 'パース（4 隅）', collapsedByDefault: true,
        fields: PERSPECTIVE_FIELDS(snapshot, requestWrite)
    };
    const transformFields: InspectorFieldDef<TimelineLayerSelection>[] = [
        {
            name: 'transform-x', label: 'X', unit: 'px', getValue: () => String(snapshot.transform?.x ?? 0),
            getEditValue: () => String(snapshot.transform?.x ?? 0), inputKind: 'scrub-number', scrubStep: 1,
            liveField: 'x', write: async (_snapshot, value) => requestWrite({ kind: 'layer-transform-x', id: snapshot.id, value: Number(value) }),
            reset: () => requestWrite({ kind: 'layer-transform-x', id: snapshot.id, value: null })
        },
        {
            name: 'transform-y', label: 'Y', unit: 'px', getValue: () => String(snapshot.transform?.y ?? 0),
            getEditValue: () => String(snapshot.transform?.y ?? 0), inputKind: 'scrub-number', scrubStep: 1,
            liveField: 'y', write: async (_snapshot, value) => requestWrite({ kind: 'layer-transform-y', id: snapshot.id, value: Number(value) }),
            reset: () => requestWrite({ kind: 'layer-transform-y', id: snapshot.id, value: null })
        },
        {
            name: 'transform-scale', label: '拡縮', unit: '%', removable: true,
            getValue: () => String((snapshot.transform?.scale ?? 1) * 100), getEditValue: () => String((snapshot.transform?.scale ?? 1) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: 'scale',
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: Number(value) / 100 }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: null })
        },
        {
            name: 'transform-rotate', label: '回転', unit: '°', removable: true,
            getValue: () => String(snapshot.transform?.rotate ?? 0), getEditValue: () => String(snapshot.transform?.rotate ?? 0),
            inputKind: 'scrub-number', scrubStep: 0.1, liveField: 'rotate',
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: Number(value) }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: null })
        }
    ];
    const telopFields: InspectorFieldDef<TimelineLayerSelection>[] = Object.entries(snapshot.params ?? {})
        .flatMap(([name, value]) => {
            const inputKind = telopParamControlKind(value);
            if (!inputKind) return [];
            return [{
                name: `telop-param-${name}`,
                label: name,
                getValue: () => String(value),
                getEditValue: () => String(value),
                inputKind,
                ...(inputKind === 'scrub-number' ? { scrubStep: 1 } : {}),
                write: async (_snapshot: TimelineLayerSelection, nextValue: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: `source.params.${name}`,
                    value: inputKind === 'scrub-number'
                        ? Number(nextValue) : inputKind === 'boolean-select'
                            ? nextValue === 'true' : nextValue
                })
            }];
        });
    return composeInspectorSections([
        {
            id: 'time', label: '時間', fields: [
                { name: 'output-start', label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
                { name: 'duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.duration) }
            ]
        },
        { id: 'transform', label: '変形', fields: transformFields },
        { id: 'crop', label: 'クロップ', fields: cropFields },
        perspectiveSection,
        MOTION_SUMMARY_SECTION(snapshot.motion, openMotion),
        ...MOTION_SECTIONS(snapshot, requestWrite),
        ...(generation ? [{ id: GENERATION_SECTION_ID, label: '生成', fields: generation }] : []),
        {
            id: 'appearance', label: '外観', fields: [
                {
                    name: 'opacity', label: '不透明度', unit: '%', displayScale: 100,
                    getValue: () => String(snapshot.opacity ?? 1),
                    getEditValue: () => String(snapshot.opacity ?? 1),
                    inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1,
                    liveField: 'opacity',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return { ok: false, message: '不透明度は 0〜100% の範囲で入力してください。' };
                        return requestWrite({ kind: 'layer-opacity', id: snapshot.id, value: parsed });
                    },
                    reset: () => requestWrite({ kind: 'layer-opacity', id: snapshot.id, value: null })
                },
                {
                    name: 'blend', label: 'ブレンドモード',
                    getValue: () => snapshot.blend ?? 'normal',
                    getEditValue: () => snapshot.blend ?? 'normal',
                    inputKind: 'select', options: LAYER_BLEND_OPTIONS,
                    write: async (_snapshot, nextValue) =>
                        requestWrite({ kind: 'layer-blend', id: snapshot.id, value: nextValue })
                },
                { name: 'chroma-color', label: 'クロマキー色', getValue: () => orDash(snapshot.chromaKey?.color, value => value) },
                {
                    name: 'chroma-similarity', label: '類似度', unit: '%', displayScale: 100,
                    getValue: () => chromaSimilarity === undefined ? '—' : String(chromaSimilarity),
                    ...(chromaSimilarity === undefined ? {} : {
                        getEditValue: () => String(chromaSimilarity),
                        inputKind: 'scrub-number' as const, scrubStep: 0.01, min: 0, max: 1,
                        write: async (_snapshot: TimelineLayerSelection, nextValue: string) => requestWrite({
                            kind: 'item-field', id: snapshot.id,
                            path: 'source.chroma_key.similarity', value: Number(nextValue)
                        }),
                        reset: () => requestWrite({
                            kind: 'item-field', id: snapshot.id,
                            path: 'source.chroma_key.similarity', value: null
                        })
                    })
                },
                {
                    name: 'chroma-blend', label: '境界ぼかし', unit: '%', displayScale: 100,
                    getValue: () => chromaBlend === undefined ? '—' : String(chromaBlend),
                    ...(chromaBlend === undefined ? {} : {
                        getEditValue: () => String(chromaBlend),
                        inputKind: 'scrub-number' as const, scrubStep: 0.01, min: 0, max: 1,
                        write: async (_snapshot: TimelineLayerSelection, nextValue: string) => requestWrite({
                            kind: 'item-field', id: snapshot.id,
                            path: 'source.chroma_key.blend', value: Number(nextValue)
                        }),
                        reset: () => requestWrite({
                            kind: 'item-field', id: snapshot.id,
                            path: 'source.chroma_key.blend', value: null
                        })
                    })
                },
                ...(!snapshot.photo ? maskFields : []),
                ...(snapshot.photo ? [...PHOTO_FLIP_FIELDS(snapshot, requestWrite),
                    ...PHOTO_CROP_OPEN_FIELD(snapshot, requestWrite), ...PHOTO_FRAME_FIELDS(snapshot, requestWrite)] : [])
            ]
        },
        ...(snapshot.layerKind === 'video' ? [{ id: 'audio', label: '音声', fields: [
            {
                name: 'layer-audio', label: '音声', inputKind: 'select' as const,
                options: ['鳴らす', 'ミュート'], disabled: !layerAudio || layerAudio.detached, keyframeDisabled: true,
                getValue: () => layerAudio?.audio === false ? 'ミュート' : '鳴らす',
                getEditValue: () => layerAudio?.audio === false ? 'ミュート' : '鳴らす',
                write: async (_snapshot: TimelineLayerSelection, value: string) => layerAudio
                    ? layerAudio.write('audio', value === '鳴らす') : { ok: false, message: '音声設定を読み込み中です。' }
            },
            {
                name: 'layer-gain-db', label: '音量', unit: 'dB', inputKind: 'scrub-number' as const,
                scrubStep: 0.5, min: -60, max: 12, disabled: !layerAudio, keyframeDisabled: true,
                getValue: () => String(layerAudio?.gain_db ?? 0),
                getEditValue: () => String(layerAudio?.gain_db ?? 0),
                write: async (_snapshot: TimelineLayerSelection, value: string) => {
                    const gain = Number(value);
                    if (!Number.isFinite(gain) || gain < -60 || gain > 12) {
                        return { ok: false, message: '音量は -60〜12 dB の範囲で入力してください。' };
                    }
                    return layerAudio ? layerAudio.write('gain_db', gain)
                        : { ok: false, message: '音声設定を読み込み中です。' };
                }
            }
        ] }] : []),
        ...(telopFields.length > 0 ? [{ id: 'telop', label: 'テキスト', fields: telopFields }] : []),
        {
            id: 'info', label: '情報', collapsedByDefault: true,
            fields: [
                { name: 'src', label: 'src', getValue: () => snapshot.src ?? '—' },
                { name: 'kind', label: 'kind', getValue: () => snapshot.layerKind },
                { name: 'preset', label: 'preset', getValue: () => snapshot.preset ?? '—' },
                { name: 'track', label: 'トラック', getValue: () => snapshot.trackName },
                { name: 'clip', label: 'クリップ', getValue: () => snapshot.clipName }
            ]
        }
    ]);
}

function CAPTION_SECTIONS(
    snapshot: TimelineCaptionSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    options: {
        mixedFields?: ReadonlySet<CaptionStyleFieldKey>;
        targets?: readonly TimelineSelectionTarget[];
        zoneHover?: (zone: string | null) => void;
        zonePreset?: (zone: string) => void;
        motionServices?: CaptionMotionServices;
    } = {}
): InspectorSection[] {
    const raw = snapshot.textStyle;
    const effective = snapshot.effectiveTextStyle;
    const currentEffect = captionEffectFromStyle(effective);
    const requestOptions = options.targets ? { targets: options.targets } : {};
    const colorField = (
        label: string,
        fieldKey: CaptionStyleFieldKey,
        rawValue: string | undefined,
        effectiveValue: string | undefined,
        fallback: string,
        kind: 'caption-style-color' | 'caption-style-stroke-color' | 'caption-style-bg-color'
    ): InspectorFieldDef<TimelineCaptionSelection> => ({
        name: `caption-${fieldKey}`, revealName: kind, label,
        getValue: () => options.mixedFields?.has(fieldKey)
            ? '—' : captionStyleDisplayValue(rawValue, effectiveValue, fallback),
        getEditValue: () => options.mixedFields?.has(fieldKey) ? '—' : effectiveValue ?? fallback,
        inputKind: 'color',
        write: async (_snapshot, nextValue) => {
            if (!isCaptionHexColor(nextValue)) {
                return { ok: false, message: '色は #RGB / #RRGGBB / #RRGGBBAA で入力してください。' };
            }
            return requestWrite({ kind, id: snapshot.id, value: nextValue, ...requestOptions });
        }
    });
    const numberField = (
        label: string,
        fieldKey: CaptionStyleFieldKey,
        rawValue: number | undefined,
        effectiveValue: number | undefined,
        fallback: number,
        kind: 'caption-style-size' | 'caption-style-stroke-width'
            | 'caption-style-bg-opacity' | 'caption-style-bg-radius'
            | 'caption-style-line-height' | 'caption-style-letter-spacing'
            | 'caption-style-bg-padding',
        min: number,
        max: number | undefined,
        step: number,
        unit: 'px' | '%' | 'em' | '',
        invalidMessage: string
    ): InspectorFieldDef<TimelineCaptionSelection> => ({
        name: `caption-${fieldKey}`, label,
        getValue: () => options.mixedFields?.has(fieldKey)
            ? '—' : captionStyleDisplayValue(rawValue, effectiveValue, fallback,
                value => fieldKey === 'background-opacity' ? `${Math.round(value * 100)}%` : String(value)),
        getEditValue: () => options.mixedFields?.has(fieldKey) ? '—' : String(effectiveValue ?? fallback),
        inputKind: 'slider-number',
        scrubStep: step,
        sliderMax: fieldKey === 'size' ? 160 : fieldKey === 'stroke-width' ? 20
            : fieldKey === 'line-height' ? 2.2 : fieldKey === 'letter-spacing' ? 0.4
                : fieldKey === 'background-padding' ? 40
                    : fieldKey === 'background-opacity' ? 1
                        : Math.round(((effective?.sizePx ?? CAPTION_STYLE_DEFAULTS.sizePx)
                            * CAPTION_PLATE_CAPSULE_HALF_HEIGHT_EM
                            + (effective?.background?.paddingPx ?? CAPTION_STYLE_DEFAULTS.backgroundPaddingPx)) * 2) / 2,
        unit,
        ...(fieldKey === 'background-opacity' ? { displayScale: 100 } : {}),
        min,
        ...(max !== undefined ? { max } : {}),
        write: async (_snapshot, nextValue) => {
            const parsed = Number(nextValue);
            if (!Number.isFinite(parsed) || parsed < min || (max !== undefined && parsed > max)
                || (kind === 'caption-style-size' && parsed === 0)) {
                return { ok: false, message: invalidMessage };
            }
            return requestWrite({ kind, id: snapshot.id, value: parsed, ...requestOptions });
        }
    });
    const sections = composeInspectorSections<InspectorSection>([
        {
            id: 'time', label: '時間', fields: [
                {
                    name: 'caption-output-start', label: '出力位置',
                    getValue: () => snapshot.outputStart === undefined ? '—' : formatTimestamp(snapshot.outputStart)
                },
                {
                    name: 'caption-output-duration', label: '尺', getValue: () =>
                        snapshot.outputStart === undefined || snapshot.outputEnd === undefined
                            ? '—' : formatDurationSeconds(snapshot.outputEnd - snapshot.outputStart)
                }
            ]
        },
        {
            id: 'content', label: '内容',
            fields: [
                {
                    name: 'caption-text', label: 'テキスト', inputKind: 'caption-text',
                    getValue: () => snapshot.text,
                    write: async (_snapshot, nextValue) => {
                        if (!nextValue.trim()) {
                            return { ok: false, message: '字幕のテキストは空にできません。' };
                        }
                        return requestWrite({ kind: 'caption-text', id: snapshot.id, value: nextValue });
                    }
                },
                {
                    name: 'caption-speaker', label: '話者',
                    getValue: () => orDash(snapshot.speaker, value => value),
                    getEditValue: () => snapshot.speaker ?? '',
                    write: async (_snapshot, nextValue) => requestWrite({
                        kind: 'caption-speaker',
                        id: snapshot.id,
                        value: nextValue.trim().length > 0 ? nextValue : null
                    })
                },
                { name: 'caption-edited', label: '編集済み', getValue: () => snapshot.edited ? 'はい' : 'いいえ' }
            ]
        },
        {
            id: 'style', label: '文字',
            fields: [
                colorField(
                    '色',
                    'color',
                    raw?.color,
                    effective?.color,
                    CAPTION_STYLE_DEFAULTS.color,
                    'caption-style-color'
                ),
                numberField(
                    '大きさ',
                    'size',
                    raw?.sizePx,
                    effective?.sizePx,
                    CAPTION_STYLE_DEFAULTS.sizePx,
                    'caption-style-size',
                    0,
                    undefined,
                    1,
                    'px',
                    'サイズは正の数で入力してください。'
                ),
                {
                    name: 'caption-wrap-width', label: '折り返し幅', inputKind: 'scrub-number',
                    unit: '%', min: 0.1, max: 100, scrubStep: 0.5,
                    getValue: () => options.mixedFields?.has('wrap-width') ? '—'
                        : raw?.wrapWidthPct === undefined ? '自動' : String(effective?.wrapWidthPct ?? raw.wrapWidthPct),
                    getEditValue: () => options.mixedFields?.has('wrap-width') ? '—'
                        : String(effective?.wrapWidthPct ?? 100),
                    write: async (_snapshot, nextValue) => {
                        const width = Number(nextValue);
                        if (!Number.isFinite(width) || width <= 0 || width > 100) {
                            return { ok: false, message: '折り返し幅は 0 より大きく 100% 以下で入力してください。' };
                        }
                        return requestWrite({ kind: 'caption-style-wrap-width', id: snapshot.id,
                            value: width, ...requestOptions });
                    }
                },
                {
                    name: 'caption-font-weight', label: '太さ', inputKind: 'caption-weight',
                    getValue: () => options.mixedFields?.has('font-weight') ? '—'
                        : captionStyleDisplayValue(raw?.weight ?? raw?.fontWeight,
                            effective?.weight ?? effective?.fontWeight, CAPTION_STYLE_DEFAULTS.fontWeight),
                    getEditValue: () => options.mixedFields?.has('font-weight') ? '—'
                        : String(effective?.weight ?? effective?.fontWeight ?? CAPTION_STYLE_DEFAULTS.fontWeight),
                    write: async (_snapshot, value) => {
                        const weight = Number(value);
                        if (![400, 700, 900].includes(weight)) return { ok: false, message: '太さを選んでください。' };
                        return requestWrite({ kind: 'caption-style-font-weight', id: snapshot.id,
                            value: weight, ...requestOptions });
                    }
                },
                numberField('行間', 'line-height', raw?.lineHeight, effective?.lineHeight,
                    CAPTION_STYLE_DEFAULTS.lineHeight, 'caption-style-line-height',
                    0.9, 2.2, 0.05, '', '行間は 0.9〜2.2 で入力してください。'),
                numberField('字間', 'letter-spacing', raw?.letterSpacingEm, effective?.letterSpacingEm,
                    CAPTION_STYLE_DEFAULTS.letterSpacingEm, 'caption-style-letter-spacing',
                    -0.1, 0.4, 0.01, 'em', '字間は -0.1〜0.4 で入力してください。'),
                colorField(
                    '色',
                    'stroke-color',
                    raw?.stroke?.color,
                    effective?.stroke?.color,
                    CAPTION_STYLE_DEFAULTS.strokeColor,
                    'caption-style-stroke-color'
                ),
                numberField(
                    '太さ',
                    'stroke-width',
                    raw?.stroke?.widthPx,
                    effective?.stroke?.widthPx,
                    CAPTION_STYLE_DEFAULTS.strokeWidthPx,
                    'caption-style-stroke-width',
                    0,
                    undefined,
                    0.5,
                    'px',
                    '縁取り太さは 0 以上で入力してください。'
                ),
                {
                    name: 'caption-style-bg-enabled', label: '表示', inputKind: 'caption-toggle',
                    getValue: () => options.mixedFields?.has('background-opacity') ? '—'
                        : effectiveCaptionBackgroundOpacity(effective) > 0 ? 'true' : 'false',
                    getEditValue: () => options.mixedFields?.has('background-opacity') ? '—'
                        : effectiveCaptionBackgroundOpacity(effective) > 0 ? 'true' : 'false',
                    write: async (_snapshot, nextValue) => requestWrite({
                        kind: 'caption-style-bg-opacity', id: snapshot.id,
                        value: nextValue === 'true' ? CAPTION_BACKGROUND_ON_OPACITY : 0,
                        ...requestOptions
                    })
                },
                {
                    name: 'caption-background-mode', label: '形',
                    getValue: () => options.mixedFields?.has('background-mode') ? '—'
                        : captionStyleDisplayValue(raw?.background?.mode, effective?.background?.mode,
                            CAPTION_STYLE_DEFAULTS.backgroundMode),
                    getEditValue: () => options.mixedFields?.has('background-mode') ? '—'
                        : effective?.background?.mode ?? CAPTION_STYLE_DEFAULTS.backgroundMode,
                    inputKind: 'caption-mode', options: ['per-line', 'block'],
                    write: async (_snapshot, nextValue) => {
                        if (nextValue !== 'per-line' && nextValue !== 'block') {
                            return { ok: false, message: '座布団の形を2つの候補から選んでください。' };
                        }
                        return requestWrite({ kind: 'caption-style-bg-mode', id: snapshot.id,
                            value: nextValue as CaptionBackgroundMode, ...requestOptions });
                    }
                },
                colorField(
                    '色',
                    'background-color',
                    raw?.background?.color,
                    effective?.background?.color,
                    CAPTION_STYLE_DEFAULTS.backgroundColor,
                    'caption-style-bg-color'
                ),
                numberField(
                    '不透明度',
                    'background-opacity',
                    raw?.background?.opacity,
                    effectiveCaptionBackgroundOpacity(effective),
                    CAPTION_STYLE_DEFAULTS.backgroundOpacity,
                    'caption-style-bg-opacity',
                    0,
                    1,
                    0.01,
                    '%',
                    '座布団不透明度は 0〜1 の範囲で入力してください。'
                ),
                numberField('余白', 'background-padding', raw?.background?.paddingPx,
                    effective?.background?.paddingPx, CAPTION_STYLE_DEFAULTS.backgroundPaddingPx,
                    'caption-style-bg-padding', 0, undefined, 1, 'px', '余白は 0 以上で入力してください。'),
                numberField(
                    '角丸',
                    'background-radius',
                    raw?.background?.radiusPx,
                    effective?.background?.radiusPx,
                    CAPTION_STYLE_DEFAULTS.backgroundRadiusPx,
                    'caption-style-bg-radius',
                    0,
                    undefined,
                    1,
                    'px',
                    '座布団角丸は 0 以上で入力してください。'
                ),
                {
                    name: 'caption-style-effect', label: '種類', inputKind: 'caption-effect',
                    getValue: () => options.mixedFields?.has('effect') ? '—' : currentEffect,
                    write: async (_snapshot, nextValue) => {
                        if (!['none', 'shadow', 'raised', 'neon', 'outline'].includes(nextValue)
                            && !captionEffectCard(nextValue)) {
                            return { ok: false, message: '効果を選んでください。' };
                        }
                        return requestWrite({ kind: 'caption-style-effect', id: snapshot.id,
                            value: { ...captionEffectTransitionPatch(nextValue as Parameters<typeof captionEffectPatch>[0],
                                effective?.color ?? CAPTION_STYLE_DEFAULTS.color, effective),
                                ...(nextValue === 'none' && (currentEffect.startsWith('bg-')
                                    || currentEffect === 'combo-band-outline') ? { background: { opacity: 0 } } : {}) },
                            ...requestOptions });
                    }
                },
                {
                    name: 'caption-style-effect-color', label: '効果の色', inputKind: 'color',
                    getValue: () => options.mixedFields?.has('effect') ? '—'
                        : currentEffect === 'neon' ? effective?.glow?.color ?? '#39D5FF'
                            : currentEffect === 'outline' ? effective?.stroke?.color ?? '#000000'
                                : effective?.shadow?.color ?? '#000000',
                    getEditValue: () => currentEffect === 'neon' ? effective?.glow?.color ?? '#39D5FF'
                        : currentEffect === 'outline' ? effective?.stroke?.color ?? '#000000'
                            : effective?.shadow?.color ?? '#000000',
                    write: async (_snapshot, value) => {
                        if (!isCaptionHexColor(value)) return { ok: false, message: '色は hex で入力してください。' };
                        return requestWrite({ kind: 'caption-style-effect', id: snapshot.id,
                            value: captionEffectColorPatch(effective ?? {}, value), ...requestOptions });
                    }
                },
                {
                    name: 'caption-style-effect-strength', label: '強さ', inputKind: 'slider-number',
                    getValue: () => options.mixedFields?.has('effect') ? '—'
                        : captionStyleDisplayValue(
                            currentEffect === 'neon' ? raw?.glow?.spread
                                : currentEffect === 'outline' ? raw?.stroke?.widthPx
                                    : raw?.shadow?.distancePx,
                            captionEffectStrength(effective ?? {}),
                            currentEffect === 'outline' ? 6 : 1),
                    getEditValue: () => String(captionEffectStrength(effective ?? {})),
                    min: 0, sliderMax: currentEffect === 'outline' ? 20 : 8,
                    scrubStep: currentEffect === 'outline' ? 0.5 : 0.1,
                    unit: currentEffect === 'outline' ? 'px' : '',
                    write: async (_snapshot, value) => {
                        const strength = Number(value);
                        if (!Number.isFinite(strength) || strength < 0) {
                            return { ok: false, message: '強さは 0 以上で入力してください。' };
                        }
                        return requestWrite({ kind: 'caption-style-effect', id: snapshot.id,
                            value: captionEffectStrengthPatch(effective ?? {}, strength), ...requestOptions });
                    }
                },
                {
                    name: 'caption-zone', label: '位置',
                    getValue: () => options.mixedFields?.has('zone')
                        ? '—'
                        : captionStyleDisplayValue(
                            raw?.zone,
                            effective?.zone,
                            CAPTION_STYLE_DEFAULTS.zone
                        ),
                    getEditValue: () => options.mixedFields?.has('zone')
                        ? '—' : effective?.zone ?? '',
                    inputKind: 'zone-grid',
                    options: CAPTION_ZONES,
                    write: async () => ({ ok: true }),
                    zoneHover: options.zoneHover,
                    zonePreset: options.zonePreset
                }
            ]
        },
        {
            id: 'timing', label: 'タイミング',
            fields: [
                { name: 'caption-start', label: 'start', getValue: () => formatTimestamp(snapshot.sourceStart) },
                { name: 'caption-end', label: 'end', getValue: () => formatTimestamp(snapshot.sourceEnd) },
                {
                    name: 'caption-duration', label: '尺',
                    getValue: () => formatDurationSeconds(snapshot.sourceEnd - snapshot.sourceStart)
                },
                {
                    name: 'caption-source-segment', label: 'sourceRef.segment',
                    getValue: () => orDash(snapshot.sourceRef?.segment, value => String(value))
                }
            ]
        },
        { id: 'motion:caption', label: '動き', fields: [], body: () => createCaptionMotionPanel(snapshot,
            requestWrite, options.motionServices) },
        ...(snapshot.animatorOwner ? [ANIMATOR_SECTION(
            snapshot.animatorOwner.id,
            `袋 ${snapshot.animatorOwner.id} のアニメーター（全 cue に効く）`,
            snapshot.animatorOwner.animator,
            requestWrite
        )] : []),
        {
            id: 'info', label: '情報', collapsedByDefault: true, fields: [
                { name: 'caption-id', label: 'clip', getValue: () => snapshot.id },
                {
                    name: 'caption-source-ref', label: 'sourceRef.segment',
                    getValue: () => orDash(snapshot.sourceRef?.segment, value => String(value))
                }
            ]
        }
    ]);
    return sections.flatMap(section => {
        if (section.id !== 'style') return [section];
        const fields = section.fields;
        return [
            { id: 'style', label: '文字', fields: [
                ...fields.slice(0, 6),
                ...(snapshot.runs?.length ? captionRunRows(snapshot.displayText ?? snapshot.text, snapshot.runs)
                    .map((run, index): InspectorFieldDef<TimelineCaptionSelection> => ({
                    name: `caption-run-${index}`, label: index === 0 ? '文字範囲' : ' ',
                    getValue: () => '',
                    actions: [{ name: 'select', label: `${run.from + 1}〜${run.to}文字目 「${run.text}」 ${run.chip}`,
                        title: 'プレビューで文字範囲を選ぶ', action: async () => {
                            window.dispatchEvent(new CustomEvent('akari.preview.selectCaptionRun', { detail: {
                                captionId: snapshot.id, from: run.from, to: run.to } }));
                            return { ok: true };
                        } },
                    { name: 'remove', label: '外す', title: '文字範囲を外す', action: () =>
                        requestWrite({ kind: 'caption-run-remove', id: snapshot.id, index }) }]
                })) : [])
            ] },
            { id: 'style:stroke', label: '縁取り', fields: fields.slice(6, 8) },
            { id: 'style:background', label: '座布団', fields: fields.slice(8, 14), body: () => {
                const note = document.createElement('p');
                note.className = 'akari-caption-radius-note';
                note.textContent = '角丸を最大にすると文字に沿った丸い座布団（カプセル）になる';
                return note;
            } },
            { id: 'style:effect', label: '効果', fields: [fields[14],
                ...(options.mixedFields?.has('effect') ? [] : captionEffectAdjustmentKeys(currentEffect).map(path => {
                    const labels: Record<string, string> = {
                        'shadow.color': '影の色', 'shadow.opacity': '影の濃さ',
                        'shadow.distancePx': '距離', 'shadow.angleDeg': '角度', 'shadow.blurPx': 'ぼかし',
                        'glow.color': '光の色', 'glow.density': '光の強さ', 'glow.spread': '広がり',
                        'stroke.color': '縁の色', 'stroke.widthPx': '縁の太さ',
                        'strokeInner.color': '内縁の色', 'strokeInner.widthPx': '内縁の太さ',
                        'fillGradient.color0': '色 1', 'fillGradient.color1': '色 2',
                        'fillGradient.color2': '色 3', 'fillGradient.angleDeg': '角度',
                        'extrude.depthPx': '奥行き', 'extrude.color': '奥行きの色',
                        'extrude.colorEnd': '奥の色', 'extrude.angleDeg': '向き',
                        'background.color': '帯の色', 'background.opacity': '帯の濃さ',
                        'background.radiusPx': '角丸', 'background.paddingPx': '余白'
                    };
                    return {
                        name: `caption-effect-adjust-${path.replace('.', '-')}`,
                        label: labels[path] ?? path,
                        inputKind: /\.color(?:End|[0-2])?$/u.test(path) ? 'color' as const : 'scrub-number' as const,
                        getValue: () => captionEffectAdjustmentValue(effective ?? {}, path),
                        getEditValue: () => captionEffectAdjustmentValue(effective ?? {}, path),
                        min: 0, max: path.endsWith('.opacity') ? 1 : undefined,
                        scrubStep: path.endsWith('.opacity') ? .05 : 1,
                        unit: path.endsWith('Px') ? 'px' : path.endsWith('Deg') ? '°' : '',
                        write: async (_snapshot: TimelineCaptionSelection, value: string) => {
                            try {
                                return requestWrite({ kind: 'caption-style-effect', id: snapshot.id,
                                    value: captionEffectAdjustmentPatch(effective ?? {}, path, value), ...requestOptions });
                            } catch (error) {
                                return { ok: false, message: error instanceof Error ? error.message : '値を確認してください。' };
                            }
                        }
                    };
                }))] },
            { id: 'style:position', label: '位置', fields: fields.slice(17) }
        ];
    });
}

function commonCaptionValue<T>(
    snapshots: readonly TimelineCaptionSelection[],
    getValue: (snapshot: TimelineCaptionSelection) => T
): { mixed: boolean; value: T } {
    const value = getValue(snapshots[0]);
    return {
        value,
        mixed: snapshots.slice(1).some(snapshot => !Object.is(getValue(snapshot), value))
    };
}

function MULTI_CAPTION_SECTIONS(
    snapshots: readonly TimelineCaptionSelection[],
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    zoneActions: {
        zoneHover: (zone: string | null) => void;
        zonePreset: (zone: string) => void;
    }
): InspectorSection[] {
    const mixedFields = new Set<CaptionStyleFieldKey>();
    const common = <T>(
        field: CaptionStyleFieldKey,
        getValue: (snapshot: TimelineCaptionSelection) => T
    ): T => {
        const result = commonCaptionValue(snapshots, getValue);
        if (result.mixed) {
            mixedFields.add(field);
        }
        return result.value;
    };
    const effectiveStyle: CaptionTextStyle = {
        color: common('color', snapshot =>
            snapshot.effectiveTextStyle?.color ?? CAPTION_STYLE_DEFAULTS.color),
        sizePx: common('size', snapshot =>
            snapshot.effectiveTextStyle?.sizePx ?? CAPTION_STYLE_DEFAULTS.sizePx),
        wrapWidthPct: common('wrap-width', snapshot => snapshot.effectiveTextStyle?.wrapWidthPct),
        fontWeight: common('font-weight', snapshot =>
            snapshot.effectiveTextStyle?.weight ?? snapshot.effectiveTextStyle?.fontWeight
                ?? CAPTION_STYLE_DEFAULTS.fontWeight),
        lineHeight: common('line-height', snapshot =>
            snapshot.effectiveTextStyle?.lineHeight ?? CAPTION_STYLE_DEFAULTS.lineHeight),
        letterSpacingEm: common('letter-spacing', snapshot =>
            snapshot.effectiveTextStyle?.letterSpacingEm ?? CAPTION_STYLE_DEFAULTS.letterSpacingEm),
        stroke: {
            color: common('stroke-color', snapshot =>
                snapshot.effectiveTextStyle?.stroke?.color ?? CAPTION_STYLE_DEFAULTS.strokeColor),
            widthPx: common('stroke-width', snapshot =>
                snapshot.effectiveTextStyle?.stroke?.widthPx ?? CAPTION_STYLE_DEFAULTS.strokeWidthPx)
        },
        background: {
            color: common('background-color', snapshot =>
                snapshot.effectiveTextStyle?.background?.color ?? CAPTION_STYLE_DEFAULTS.backgroundColor),
            opacity: common('background-opacity', snapshot =>
                effectiveCaptionBackgroundOpacity(snapshot.effectiveTextStyle)),
            radiusPx: common('background-radius', snapshot =>
                snapshot.effectiveTextStyle?.background?.radiusPx ?? CAPTION_STYLE_DEFAULTS.backgroundRadiusPx),
            paddingPx: common('background-padding', snapshot =>
                snapshot.effectiveTextStyle?.background?.paddingPx ?? CAPTION_STYLE_DEFAULTS.backgroundPaddingPx),
            mode: common('background-mode', snapshot =>
                snapshot.effectiveTextStyle?.background?.mode ?? CAPTION_STYLE_DEFAULTS.backgroundMode)
        },
        zone: common('zone', snapshot =>
            snapshot.effectiveTextStyle?.zone ?? CAPTION_STYLE_DEFAULTS.zone)
    };
    const effect = common('effect', snapshot => captionEffectFromStyle(snapshot.effectiveTextStyle));
    if (!mixedFields.has('effect')) {
        if (effect === 'shadow' || effect === 'raised' || effect.startsWith('sh-')
            || effect === 'combo-neon-shadow' || effect === 'combo-outline-shadow') {
            effectiveStyle.shadow = snapshots[0].effectiveTextStyle?.shadow;
        }
        if (effect === 'neon' || effect.startsWith('neon-') || effect.startsWith('gl-')
            || effect === 'combo-neon-shadow') {
            effectiveStyle.glow = snapshots[0].effectiveTextStyle?.glow;
        }
    }
    const aggregate: TimelineCaptionSelection = {
        ...snapshots[0],
        textStyle: effectiveStyle,
        effectiveTextStyle: effectiveStyle
    };
    const targets: TimelineSelectionTarget[] = snapshots.map(snapshot => ({
        kind: 'caption',
        id: snapshot.id
    }));
    const styleCards = CAPTION_SECTIONS(aggregate, requestWrite, { mixedFields, targets, ...zoneActions })
        .filter(section => section.id === 'style' || section.id.startsWith('style:'));
    return [
        {
            id: 'content', label: '内容（複数）',
            fields: [
                {
                    name: 'caption-multi-count', label: '選択', getValue: () => `${snapshots.length} 件`
                }
            ]
        },
        ...styleCards
    ];
}

const AUDIO_DUCK_DEFAULTS = { duckDb: -12, duckAttack: 0.3, duckRelease: 0.8 } as const;
const AUDIO_KEYFRAME_EASING_OPTIONS = ['linear', 'hold', 'ease-in-out'] as const;

function duckingFields(
    snapshot: AudioInspectorSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef[] {
    const duckWriteRequest = (
        field: 'duck-db' | 'duck-attack' | 'duck-release',
        value: number
    ): InspectorWriteRequest => {
        if (snapshot.audioKind === 'bgm') {
            if (field === 'duck-db') return { kind: 'bgm-duck-db', value };
            if (field === 'duck-attack') return { kind: 'bgm-duck-attack', value };
            return { kind: 'bgm-duck-release', value };
        }
        if (field === 'duck-db') return { kind: 'sfx-duck-db', id: snapshot.id, value };
        if (field === 'duck-attack') return { kind: 'sfx-duck-attack', id: snapshot.id, value };
        return { kind: 'sfx-duck-release', id: snapshot.id, value };
    };
    const numberField = (
        name: string, label: string, field: 'duck-db' | 'duck-attack' | 'duck-release',
        raw: number | undefined, fallback: number, min: number, max: number, step: number, unit: string
    ): InspectorFieldDef => ({
        name, label, unit,
        getValue: () => withDefaultNumber(raw, fallback, value => String(value)),
        getEditValue: () => String(raw ?? fallback),
        inputKind: 'scrub-number', scrubStep: step, min, max,
        write: async (_snapshot, nextValue) => {
            const parsed = Number(nextValue);
            if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
                return { ok: false, message: `${label} は ${min}〜${max} の範囲で入力してください。` };
            }
            return requestWrite(duckWriteRequest(field, parsed));
        }
    });
    const duckDb = numberField(
        'audio-duck-db', 'duck_db', 'duck-db', snapshot.duckDb,
        AUDIO_DUCK_DEFAULTS.duckDb, -40, 0, 0.5, 'dB'
    );
    return [
        {
            name: 'audio-ducking', label: 'ducking',
            getValue: () => withDefaultBoolean(snapshot.ducking, false),
            getEditValue: () => String(snapshot.ducking ?? false),
            inputKind: 'boolean-select',
            write: async (_snapshot, nextValue) => requestWrite(snapshot.audioKind === 'bgm'
                ? { kind: 'bgm-ducking', value: nextValue === 'true' }
                : { kind: 'sfx-ducking', id: snapshot.id, value: nextValue === 'true' })
        },
        duckDb,
        {
            name: 'audio-duck-preset', label: 'プリセット',
            getValue: () => String(snapshot.duckDb ?? AUDIO_DUCK_DEFAULTS.duckDb),
            getEditValue: () => String(snapshot.duckDb ?? AUDIO_DUCK_DEFAULTS.duckDb),
            inputKind: 'select', options: ['-3', '-6', '-12'],
            write: duckDb.write
        },
        numberField(
            'audio-duck-attack', 'duck_attack（詳細）', 'duck-attack', snapshot.duckAttack,
            AUDIO_DUCK_DEFAULTS.duckAttack, 0, 2, 0.01, 's'
        ),
        numberField(
            'audio-duck-release', 'duck_release（詳細）', 'duck-release', snapshot.duckRelease,
            AUDIO_DUCK_DEFAULTS.duckRelease, 0, 5, 0.05, 's'
        )
    ];
}

function audioKeyframeRequest(
    snapshot: AudioInspectorSnapshot,
    points: readonly AudioEnvelopeKeyframePayload[]
): InspectorWriteRequest {
    return {
        kind: 'audio-keyframes', id: snapshot.id, audioKind: snapshot.audioKind,
        value: points.length === 0 ? null : points
            .map(point => ({ ...point, gain_db: point.gain_db ?? 0 }))
            .sort((left, right) => left.t - right.t)
    };
}

function keyframeSeconds(snapshot: AudioInspectorSnapshot, point: AudioEnvelopeKeyframePayload): number {
    return snapshot.keyframeFrames ? point.t / Math.max(1, snapshot.fps ?? 30) : point.t;
}

function keyframeRawTime(snapshot: AudioInspectorSnapshot, seconds: number): number {
    return snapshot.keyframeFrames
        ? Math.round(seconds * Math.max(1, snapshot.fps ?? 30))
        : Math.round(seconds * 1000) / 1000;
}

function audioKeyframeFields(
    snapshot: AudioInspectorSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef[] {
    const points = [...(snapshot.keyframes ?? [])].sort((left, right) => left.t - right.t);
    const replace = (index: number, point: AudioEnvelopeKeyframePayload): Promise<InspectorWriteResult> => {
        const next = points.map((candidate, candidateIndex) => candidateIndex === index ? point : candidate);
        return requestWrite(audioKeyframeRequest(snapshot, next));
    };
    const fields: InspectorFieldDef[] = [{
        name: 'audio-keyframe-add', label: '追加', actionLabel: '再生ヘッド位置に追加',
        getValue: () => '',
        action: async () => {
            const relative = Math.max(0, Math.min(
                snapshot.duration,
                (snapshot.playheadSeconds ?? snapshot.outputStart) - snapshot.outputStart
            ));
            const t = keyframeRawTime(snapshot, relative);
            const duplicate = points.some(point => snapshot.keyframeFrames
                ? point.t === t : Math.abs(point.t - t) < 1e-3);
            if (duplicate) return { ok: false, message: 'この位置には既に音量キーフレームがあります。' };
            return requestWrite(audioKeyframeRequest(snapshot, [...points, { t, gain_db: 0 }]));
        }
    }];
    points.forEach((point, index) => {
        const prefix = `audio-keyframe-${index}`;
        const easing = typeof point.easing === 'string' ? point.easing : 'linear';
        const easingOptions = AUDIO_KEYFRAME_EASING_OPTIONS.includes(
            easing as typeof AUDIO_KEYFRAME_EASING_OPTIONS[number]
        ) ? AUDIO_KEYFRAME_EASING_OPTIONS : [...AUDIO_KEYFRAME_EASING_OPTIONS, easing];
        fields.push({
            name: `${prefix}-t`, label: `#${index + 1} t`, unit: 's',
            getValue: () => String(keyframeSeconds(snapshot, point)),
            getEditValue: () => String(keyframeSeconds(snapshot, point)),
            inputKind: 'scrub-number', scrubStep: snapshot.keyframeFrames ? 1 / Math.max(1, snapshot.fps ?? 30) : 0.001,
            min: 0, max: snapshot.duration,
            write: async (_snapshot, nextValue) => {
                const seconds = Number(nextValue);
                if (!Number.isFinite(seconds) || seconds < 0 || seconds > snapshot.duration) {
                    return { ok: false, message: `t は 0〜${snapshot.duration} 秒の範囲で入力してください。` };
                }
                const t = keyframeRawTime(snapshot, seconds);
                const duplicate = points.some((candidate, candidateIndex) => candidateIndex !== index
                    && (snapshot.keyframeFrames ? candidate.t === t : Math.abs(candidate.t - t) < 1e-3));
                if (duplicate) return { ok: false, message: 'この位置には既に音量キーフレームがあります。' };
                return replace(index, { ...point, t });
            }
        }, {
            name: `${prefix}-gain-db`, label: `#${index + 1} gain_db`, unit: 'dB',
            getValue: () => String(point.gain_db ?? 0), getEditValue: () => String(point.gain_db ?? 0),
            inputKind: 'scrub-number', scrubStep: 0.5, min: -60, max: 12,
            write: async (_snapshot, nextValue) => {
                const gainDb = Number(nextValue);
                return !Number.isFinite(gainDb) || gainDb < -60 || gainDb > 12
                    ? { ok: false, message: 'gain_db は -60〜12 の範囲で入力してください。' }
                    : replace(index, { ...point, gain_db: gainDb });
            }
        }, {
            name: `${prefix}-easing`, label: `#${index + 1} easing`,
            getValue: () => easing, getEditValue: () => easing,
            inputKind: 'select', options: easingOptions,
            write: async (_snapshot, nextValue) => replace(index, { ...point, easing: nextValue })
        }, {
            name: `${prefix}-delete`, label: `#${index + 1}`, actionLabel: '削除', getValue: () => '',
            action: async () => requestWrite(audioKeyframeRequest(
                snapshot, points.filter((_candidate, candidateIndex) => candidateIndex !== index)
            ))
        });
    });
    return fields;
}

function AUDIO_SECTIONS(
    snapshot: AudioInspectorSnapshot,
    requestWrite: (
        request: InspectorWriteRequest
    ) => Promise<InspectorWriteResult>
): InspectorSection[] {
    const autoLevelField: InspectorFieldDef = {
        name: 'audio-auto-level', label: 'レベル', actionLabel: '自動レベル', getValue: () => '',
        action: async () => requestWrite({
            kind: 'audio-auto-level', id: snapshot.id, audioKind: snapshot.audioKind
        })
    };
    const basicFields: InspectorFieldDef[] = [
        {
            name: 'gain-db', label: 'gain_db', unit: 'dB',
            getValue: () => withDefaultNumber(snapshot.gainDb, 0, formatDecimal1),
            getEditValue: () => String(snapshot.gainDb ?? 0),
            inputKind: 'scrub-number',
            scrubStep: 0.1,
            min: -60,
            max: 12,
            write: async (_snapshot, nextValue) => {
                const parsed = Number(nextValue);
                if (!Number.isFinite(parsed) || parsed < -60 || parsed > 12) {
                    return { ok: false, message: 'gain_db は -60〜12 の範囲で入力してください。' };
                }
                return snapshot.audioKind === 'bgm'
                    ? requestWrite({ kind: 'bgm-gain', value: parsed })
                    : snapshot.audioKind === 'narration'
                        ? requestWrite({ kind: 'narration-gain', id: snapshot.id, value: parsed })
                        : requestWrite({ kind: 'sfx-gain', id: snapshot.id, value: parsed });
            }
        },
        ...(snapshot.audioKind === 'narration' ? [autoLevelField] : [])
    ];
    const tabs: InspectorSection[] = [
        {
            id: 'time', label: '時間', fields: [
                { name: 'audio-start', label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
                { name: 'audio-duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.duration) }
            ]
        },
        { id: 'audio', label: '音声', fields: basicFields }
    ];
    if (snapshot.audioKind === 'bgm') {
        tabs.push({
            id: 'audio:fades', label: 'フェード・ダッキング',
            fields: [
                autoLevelField,
                {
                    name: 'audio-fade-in', label: 'fadeIn', unit: 's',
                    getValue: () => withDefaultNumber(snapshot.fadeIn, 0, formatDurationSeconds),
                    getEditValue: () => String(snapshot.fadeIn ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.05,
                    min: 0,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            return { ok: false, message: 'fadeIn は 0 以上の数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'bgm-fade-in', value: parsed });
                    }
                },
                {
                    name: 'audio-fade-out', label: 'fadeOut', unit: 's',
                    getValue: () => withDefaultNumber(snapshot.fadeOut, 0, formatDurationSeconds),
                    getEditValue: () => String(snapshot.fadeOut ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.05,
                    min: 0,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            return { ok: false, message: 'fadeOut は 0 以上の数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'bgm-fade-out', value: parsed });
                    }
                },
                ...duckingFields(snapshot, requestWrite)
            ]
        });
    } else if (snapshot.audioKind === 'sfx') {
        tabs.push({
            id: 'audio:fades', label: 'フェード・ダッキング',
            fields: [
                autoLevelField,
                {
                    name: 'audio-fade-in', label: 'fadeIn', unit: 's',
                    getValue: () => withDefaultNumber(snapshot.fadeIn, 0, formatDurationSeconds),
                    getEditValue: () => String(snapshot.fadeIn ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.05,
                    min: 0,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            return { ok: false, message: 'fadeIn は 0 以上の数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'sfx-fade-in', id: snapshot.id, value: parsed });
                    }
                },
                {
                    name: 'audio-fade-out', label: 'fadeOut', unit: 's',
                    getValue: () => withDefaultNumber(snapshot.fadeOut, 0, formatDurationSeconds),
                    getEditValue: () => String(snapshot.fadeOut ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.05,
                    min: 0,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                            return { ok: false, message: 'fadeOut は 0 以上の数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'sfx-fade-out', id: snapshot.id, value: parsed });
                    }
                },
                ...duckingFields(snapshot, requestWrite)
            ]
        });
    }
    tabs.push({
        id: 'audio:keyframes', label: '音量キーフレーム',
        fields: audioKeyframeFields(snapshot, requestWrite)
    });
    tabs.push({
        id: 'info', label: '情報', collapsedByDefault: true,
        fields: [
            { name: 'audio-kind', label: '種別', getValue: () => formatAudioKindLabel(snapshot.audioKind) },
            { name: 'audio-path', label: 'path', getValue: () => snapshot.label },
            { name: 'audio-track', label: 'トラック', getValue: () => snapshot.trackName },
            { name: 'audio-clip', label: 'クリップ', getValue: () => snapshot.clipName },
            ...(snapshot.audioKind === 'narration'
                ? [{ name: 'audio-script', label: 'script', getValue: () => orDash(snapshot.script, value => value) }]
                : [])
        ]
    });
    tabs.push(...AUDIO_CLIP_FX_SECTIONS(snapshot, requestWrite));
    return [
        tabs.find(section => section.id === 'audio')!,
        ...composeInspectorSections(tabs.filter(section => section.id !== 'audio'))
    ];
}

function AUDIO_CLIP_FX_SECTIONS(
    snapshot: TimelineAudioSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorSection[] {
    const write = async (row: AudioClipFxRow, value: string | null): Promise<InspectorWriteResult> => {
        try {
            return await requestWrite(createAudioClipFxWriteRequest(snapshot, row, value));
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    };
    const sections: InspectorSection[] = [];
    if (snapshot.audioKind !== 'narration') {
        const formantLabel = snapshot.formant === 'shift' ? '移動' : '保持';
        sections.push({
            id: 'audio:pitch-time', label: 'ピッチ・タイム',
            caption: '速度はピッチを保ったまま変わります（タイムライン上の開始位置は不変・実効尺 = 素材尺 ÷ 速度）',
            fields: [{
                name: 'audio-speed', label: '速度', unit: '×',
                getValue: () => formatDecimal2(snapshot.speed ?? 1),
                getEditValue: () => String(snapshot.speed ?? 1),
                inputKind: 'scrub-number', min: 0.25, max: 4, scrubStep: 0.05, displayPrecision: 2,
                reset: () => write('speed', null),
                write: async (_rowSnapshot, value) => write('speed', value)
            }, {
                name: 'audio-pitch', label: 'ピッチ', unit: 'st',
                getValue: () => String(snapshot.pitchSemitones ?? 0),
                getEditValue: () => String(snapshot.pitchSemitones ?? 0),
                inputKind: 'scrub-number', min: -24, max: 24, scrubStep: 1,
                reset: () => write('pitch_semitones', null),
                write: async (_rowSnapshot, value) => write('pitch_semitones', value)
            }, {
                name: 'audio-formant', label: 'フォルマント',
                getValue: () => formantLabel, getEditValue: () => formantLabel,
                inputKind: 'select', options: ['保持', '移動'],
                reset: () => write('formant', null),
                write: async (_rowSnapshot, value) => write('formant', value)
            }]
        });
    }
    const denoiseLabel = snapshot.denoise?.method === 'fft' ? 'FFT'
        : snapshot.denoise?.method === 'nlm' ? 'NLM' : 'オフ';
    sections.push({
        id: 'audio:enhancement', label: '音声強調',
        fields: [{
            name: 'audio-denoise-method', label: 'ノイズ除去',
            getValue: () => denoiseLabel, getEditValue: () => denoiseLabel,
            inputKind: 'select', options: ['オフ', 'FFT', 'NLM'],
            reset: () => write('denoise-method', null),
            write: async (_rowSnapshot, value) => write('denoise-method', value)
        }, {
            name: 'audio-denoise-strength', label: '強さ', unit: '%',
            getValue: () => String(Math.round((snapshot.denoise?.strength ?? 0.5) * 100)),
            getEditValue: () => String(snapshot.denoise?.strength ?? 0.5),
            inputKind: 'scrub-number', min: 0, max: 1, scrubStep: 0.05,
            displayScale: 100, displayPrecision: 0,
            disabled: snapshot.denoise === undefined,
            title: snapshot.denoise === undefined ? 'ノイズ除去をオンにすると変更できます。' : undefined,
            reset: () => write('denoise-strength', null),
            write: async (_rowSnapshot, value) => write('denoise-strength', value)
        }, {
            name: 'audio-lowcut', label: 'ローカット', unit: 'Hz',
            getValue: () => String(snapshot.lowcutHz ?? 0),
            getEditValue: () => String(snapshot.lowcutHz ?? 0),
            inputKind: 'scrub-number', min: 0, max: 400, scrubStep: 5,
            reset: () => write('lowcut_hz', null),
            write: async (_rowSnapshot, value) => write('lowcut_hz', value)
        }]
    });
    return sections;
}

function AUDIO_MASTER_SECTION(
    snapshot: TimelineAudioMasterSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorSection {
    const denoiseLabel = snapshot.denoise === 'strong' ? '強'
        : snapshot.denoise === 'std' ? '標準' : 'オフ';
    const disabledTitle = snapshot.enabled ? undefined : 'マスタリングをオンにすると変更できます。';
    return {
        id: 'audio:master',
        label: 'マスター（書き出し全体）',
        caption: 'プロジェクト全体に適用・プレビューは未対応（書き出し時のみ）',
        fields: [{
            name: 'audio-master-enabled', label: 'マスタリング',
            getValue: () => snapshot.enabled ? 'オン' : 'オフ',
            getEditValue: () => snapshot.enabled ? 'オン' : 'オフ',
            inputKind: 'select', options: ['オフ', 'オン'],
            write: async (_rowSnapshot, value) => requestWrite({
                kind: 'audio-master-enabled', value: value === 'オン'
            })
        }, {
            name: 'audio-master-denoise', label: 'ノイズ除去',
            getValue: () => denoiseLabel, getEditValue: () => denoiseLabel,
            inputKind: 'select', options: ['オフ', '標準', '強'],
            disabled: !snapshot.enabled, title: disabledTitle,
            reset: () => requestWrite({ kind: 'audio-master-denoise', value: null }),
            write: async (_rowSnapshot, value) => requestWrite({
                kind: 'audio-master-denoise',
                value: value === '強' ? 'strong' : value === '標準' ? 'std' : 'off'
            })
        }, {
            name: 'audio-master-loudnorm', label: 'ラウドネス目標', unit: 'LUFS',
            getValue: () => String(snapshot.loudnorm ?? AUDIO_MASTER_DEFAULT_LOUDNORM),
            getEditValue: () => String(snapshot.loudnorm ?? AUDIO_MASTER_DEFAULT_LOUDNORM),
            inputKind: 'scrub-number', scrubStep: 0.5, min: -70, max: 0,
            disabled: !snapshot.enabled, title: disabledTitle,
            reset: () => requestWrite({ kind: 'audio-master-loudnorm', value: null }),
            write: async (_rowSnapshot, value) => {
                const parsed = Number(value);
                return !Number.isFinite(parsed) || parsed < -70 || parsed > 0
                    ? { ok: false, message: 'ラウドネス目標は -70〜0 の範囲で入力してください。' }
                    : requestWrite({ kind: 'audio-master-loudnorm', value: parsed });
            }
        }, {
            name: 'audio-master-true-peak', label: 'True Peak 上限', unit: 'dBTP',
            getValue: () => String(snapshot.truePeakDbtp ?? AUDIO_MASTER_DEFAULT_TRUE_PEAK_DBTP),
            getEditValue: () => String(snapshot.truePeakDbtp ?? AUDIO_MASTER_DEFAULT_TRUE_PEAK_DBTP),
            inputKind: 'scrub-number', scrubStep: 0.1, min: -9, max: 0,
            disabled: !snapshot.enabled, title: disabledTitle,
            reset: () => requestWrite({ kind: 'audio-master-true-peak', value: null }),
            write: async (_rowSnapshot, value) => {
                const parsed = Number(value);
                return !Number.isFinite(parsed) || parsed < -9 || parsed > 0
                    ? { ok: false, message: 'True Peak 上限は -9〜0 の範囲で入力してください。' }
                    : requestWrite({ kind: 'audio-master-true-peak', value: parsed });
            }
        }]
    };
}

function OVERLAY_SECTIONS(
    snapshot: TimelineOverlaySelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    knobs: readonly InspectorKnob[] = [],
    openMotion?: () => void,
    fontFaces: ReadonlyMap<string, string> = new Map()
): InspectorSection[] {
    const transform = snapshot.payload.transform && typeof snapshot.payload.transform === 'object'
        && !Array.isArray(snapshot.payload.transform)
        ? snapshot.payload.transform as Record<string, unknown> : {};
    const number = (key: string, fallback: number): number =>
        typeof transform[key] === 'number' ? transform[key] as number : fallback;
    const overallScale = (): number => Math.sqrt(number('scaleX', number('scale', 1))
        * number('scaleY', number('scale', 1)));
    const source = snapshot.payload.source && typeof snapshot.payload.source === 'object'
        ? snapshot.payload.source as Record<string, unknown> : {};
    const sourcePath = typeof source.html === 'string' ? source.html
        : typeof source.path === 'string' ? source.path : '';
    const isTelop = /^telop-/u.test(snapshot.id)
        || /(?:^|[\\/])overlay[\\/]telop-[^\\/]+(?:[\\/]|$)/iu.test(sourcePath);
    const cropFields = CROP_FIELDS(snapshot, 'item', requestWrite);
    const transformFields: InspectorFieldDef<TimelineOverlaySelection>[] = [
        {
            name: 'transform-x', label: 'X', unit: 'px', getValue: () => String(number('x', 0)),
            getEditValue: () => String(number('x', 0)), inputKind: 'scrub-number', scrubStep: 1,
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.x', value: Number(value) }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.x', value: null })
        },
        {
            name: 'transform-y', label: 'Y', unit: 'px', getValue: () => String(number('y', 0)),
            getEditValue: () => String(number('y', 0)), inputKind: 'scrub-number', scrubStep: 1,
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.y', value: Number(value) }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.y', value: null })
        },
        {
            name: 'transform-scale', label: isTelop ? '倍率' : '拡縮', unit: '%', removable: true,
            getValue: () => String(overallScale() * 100), getEditValue: () => String(overallScale() * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: 'scale',
            write: async (_snapshot, value) => {
                const scale = Number(value) / 100;
                if (isTelop && (transform.scaleX !== undefined || transform.scaleY !== undefined)) {
                    await requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scaleX', value: scale });
                    return requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scaleY', value: scale });
                }
                return requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: scale });
            },
            reset: async () => {
                if (isTelop) {
                    await requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scaleX', value: null });
                    await requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scaleY', value: null });
                }
                return requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: null });
            }
        },
        ...(!isTelop ? (['scaleX', 'scaleY'] as const).map((axis, index): InspectorFieldDef<TimelineOverlaySelection> => ({
            name: `transform-${axis}`, label: index === 0 ? '幅' : '高さ', unit: '%', removable: true,
            getValue: () => String(number(axis, number('scale', 1)) * 100),
            getEditValue: () => String(number(axis, number('scale', 1)) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: axis,
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: Number(value) / 100
            }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: null })
        })) : []),
        {
            name: 'transform-rotate', label: '回転', unit: '°', removable: true,
            getValue: () => String(number('rotate', 0)), getEditValue: () => String(number('rotate', 0)),
            inputKind: 'scrub-number', scrubStep: 0.1,
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: Number(value) }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: null })
        }
    ];
    const groups = new Map<string, InspectorFieldDef<TimelineOverlaySelection>[]>();
    const rawVars = snapshot.payload.vars;
    const variableEntries = rawVars && typeof rawVars === 'object' && !Array.isArray(rawVars)
        ? Object.entries(rawVars as Record<string, unknown>) : [];
    for (const knob of knobs) {
        if (variableEntries.some(([name]) => findKnobForVar([knob], name))) continue;
        // The preview fragment lives in a separate webview; its computed CSS is unavailable here.
        const fallback = knob.default ?? (knob.type === 'slider' ? knob.min ?? 0
            : knob.type === 'checkbox' ? false : knob.type === 'color' ? '#000000'
                : knob.type === 'dropdown' ? knob.options?.[0] ?? '' : '');
        variableEntries.push([knob.name, fallback]);
    }
    for (const [name, value] of variableEntries) {
            const isPrimitive = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
            const knob = findKnobForVar(knobs, name);
            const group = knob?.group ?? 'ツマミ';
            const fields = groups.get(group) ?? [];
            const kind = knob ? knobControlKind(knob.type) : 'text';
            const fontKnob = knob ? isFontFamilyKnob(knob) : false;
            const fontOptions = fontKnob ? renderableCaptionFonts(CAPTION_PANEL_FONTS, fontFaces)
                .map(font => fontFaces.get(font.id) ?? font.family) : [];
            if (fontKnob && typeof value === 'string' && value && !fontOptions.includes(value)) fontOptions.unshift(value);
            fields.push({
                name: `var-${name.replace(/[^a-z0-9_-]+/giu, '-')}`,
                label: knob?.label ?? `vars.${name}`,
                getValue: () => formatPayloadValue(value),
                getEditValue: () => knob?.type === 'slider' && typeof value === 'string'
                    ? String(Number.parseFloat(value)) : String(value ?? ''),
                inputKind: fontKnob ? 'select' : kind === 'readonly' ? 'media'
                    : kind === 'slider' ? 'scrub-number' : kind as InspectorFieldDef['inputKind'],
                ...(fontKnob ? { options: fontOptions } : knob?.options ? { options: knob.options } : {}),
                ...(knob?.min !== undefined ? { min: knob.min } : {}),
                ...(knob?.max !== undefined ? { max: knob.max } : {}),
                ...(knob?.unit ? { unit: knob.unit } : {}),
                ...(knob?.type === 'slider' ? { scrubStep: Math.max(0.001, ((knob.max ?? 1) - (knob.min ?? 0)) / 100) } : {}),
                ...(isPrimitive && knob?.type !== 'media' ? {
                    write: async (_snapshot: TimelineOverlaySelection, nextValue: string) => {
                        if (!knob) return requestWrite({ kind: 'overlay-var', id: snapshot.id, name, value: nextValue });
                        const typedValue: number | string | boolean = knob.type === 'slider'
                            ? knob.unit ? `${Number(nextValue)}${knob.unit}` : Number(nextValue)
                            : knob.type === 'checkbox' ? String(nextValue === 'true') : nextValue;
                        return requestWrite({
                            kind: 'item-field', id: snapshot.id,
                            path: `source.vars.${name}`, value: typedValue
                        });
                    }
                } : {})
            });
            groups.set(group, fields);
    }
    const knobSections: InspectorSection<TimelineOverlaySelection>[] = [...groups].map(([group, fields], index) => ({
        id: `knobs:${index}-${group.replace(/[^a-z0-9_-]+/giu, '-') || 'default'}`,
        label: group || 'ツマミ', fields
    }));
    const opacity = typeof snapshot.payload.opacity === 'number' ? snapshot.payload.opacity : 1;
    const blend = typeof snapshot.payload.blend === 'string' ? snapshot.payload.blend : 'normal';
    return composeInspectorSections([
        {
            id: 'time', label: '時間',
            fields: [
                { name: 'overlay-start', label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
                { name: 'overlay-duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.duration) }
            ]
        },
        { id: 'transform', label: '変形', fields: transformFields },
        { id: 'crop', label: 'クロップ', fields: cropFields },
        MOTION_SUMMARY_SECTION(snapshot.motion, openMotion),
        ...(snapshot.durationFrames ? MOTION_SECTIONS({
            id: snapshot.id, durationFrames: snapshot.durationFrames, motion: snapshot.motion
        }, requestWrite) : [MOTION_EMPTY_SECTION()]),
        {
            id: 'appearance', label: '外観', fields: [
                {
                    name: 'opacity', label: '不透明度', unit: '%', displayScale: 100,
                    getValue: () => String(opacity), getEditValue: () => String(opacity),
                    inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1,
                    write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'opacity', value: Number(value) }),
                    reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'opacity', value: null })
                },
                {
                    name: 'blend', label: 'ブレンドモード', getValue: () => blend, getEditValue: () => blend,
                    inputKind: 'select', options: LAYER_BLEND_OPTIONS,
                    write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'blend', value })
                }
            ]
        },
        ...knobSections,
        {
            id: 'info', label: '情報', collapsedByDefault: true, fields: [
                { name: 'overlay-kind', label: 'kind', getValue: () => deriveOverlayType(snapshot.payload) },
                { name: 'overlay-html', label: 'html', getValue: () => formatPayloadValue(snapshot.payload.html) },
                { name: 'overlay-track', label: 'トラック', getValue: () => snapshot.trackName },
                { name: 'overlay-clip', label: 'クリップ', getValue: () => snapshot.clipName }
            ]
        }
    ]);
}

function ANIMATOR_SECTION(
    id: string,
    headingLabel: string,
    rawAnimators: readonly Record<string, unknown>[] | undefined,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorSection {
    const animators = normalizeInspectorAnimators(rawAnimators);
    const syncAdvancedRows = (): void => {
        const section = document.querySelector('[data-akari-ui="section:inspector-animator"]');
        if (!section) return;
        for (const animator of animators) {
            const template = inspectorAnimatorTemplateFor(animator);
            if (!template) continue;
            const name = `animator-${animator.id.replace(/[^a-z0-9]/gi, character => `_${character.charCodeAt(0)}_`)}`;
            const expanded = expandedAnimatorFields.has(`${id}:${animator.id}`);
            section.querySelectorAll<HTMLElement>('[data-akari-field]').forEach(row => {
                const fieldName = row.dataset.akariField ?? '';
                if (!fieldName.startsWith(`${name}-`)) return;
                const key = fieldName.slice(name.length + 1).replace(/^amount-/, 'amount.').replace(/^randomize-/, 'randomize.');
                row.hidden = !expanded && !['heading', 'all', ...template.fields].includes(key);
                row.style.display = row.hidden ? 'none' : '';
            });
            const button = section.querySelector<HTMLButtonElement>(`[data-akari-ui="action:inspector-${name}-all"]`);
            if (button) button.textContent = expanded ? '必要な項目だけ' : 'すべての項目';
        }
    };
    const writeAnimator = async (update: () => InspectorAnimator[]): Promise<InspectorWriteResult> => {
        try {
            const value = normalizeInspectorAnimators(update());
            return await requestWrite({ kind: 'item-field', id, path: 'animator', value: value.length ? value : null });
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : 'アニメーターを変更できませんでした。' };
        }
    };
    const animatorFields: InspectorFieldDef[] = [{
        name: 'animator-explain', className: 'akari-inspector-animator-explain',
        label: '文字を 1 文字 / 1 語ずつずらして動かす仕組みです',
        getValue: () => ''
    }, {
        name: 'animator-template', label: 'ひな形から始める', inputKind: 'select',
        options: ['選択…', ...INSPECTOR_ANIMATOR_TEMPLATES.map(item => item.label)],
        getValue: () => '選択…', getEditValue: () => '選択…', keyframeDisabled: true,
        write: async (_snapshot, value) => {
            const template = INSPECTOR_ANIMATOR_TEMPLATES.find(item => item.label === value);
            if (!template) return { ok: false, message: 'ひな形を選んでください。' };
            return writeAnimator(() => addInspectorAnimatorTemplate(animators, template.id));
        }
    }, {
        name: 'animator-add', label: 'アニメーターを追加', inputKind: 'select',
        options: ['選択…', 'アニメーター'], getValue: () => '選択…', getEditValue: () => '選択…',
        keyframeDisabled: true,
        write: async (_snapshot, value) => {
            if (value === '選択…') return { ok: true };
            if (value !== 'アニメーター') return { ok: false, message: '一覧からアニメーターを選択してください。' };
            return writeAnimator(() => addInspectorAnimator(animators));
        }
    }];
    animators.forEach((animator, index) => {
        // 外部で付けた id に区切り文字があってもフィールド名が衝突しない。
        const name = `animator-${animator.id.replace(/[^a-z0-9]/gi, character => `_${character.charCodeAt(0)}_`)}`;
        const template = inspectorAnimatorTemplateFor(animator);
        const expandedKey = `${id}:${animator.id}`;
        const showAll = expandedAnimatorFields.has(expandedKey) || !template;
        animatorFields.push({
            name: `${name}-heading`, label: animator.id, getValue: () => '', keyframeDisabled: true,
            actions: [{
                name: 'up', label: '↑', title: `${animator.id}を上へ`, disabled: index === 0,
                action: () => writeAnimator(() => moveInspectorAnimator(animators, index, -1))
            }, {
                name: 'down', label: '↓', title: `${animator.id}を下へ`, disabled: index === animators.length - 1,
                action: () => writeAnimator(() => moveInspectorAnimator(animators, index, 1))
            }, {
                name: 'remove', label: '削除', title: `${animator.id}を削除`,
                action: () => writeAnimator(() => removeInspectorAnimator(animators, index))
            }]
        });
        if (template) animatorFields.push({
            name: `${name}-all`, label: '', getValue: () => '',
            actionLabel: showAll ? '必要な項目だけ' : 'すべての項目',
            action: async () => {
                if (expandedAnimatorFields.has(expandedKey)) expandedAnimatorFields.delete(expandedKey);
                else expandedAnimatorFields.add(expandedKey);
                syncAdvancedRows();
                window.setTimeout(syncAdvancedRows, 0);
                return { ok: true };
            }
        });
        if (showAll) {
        for (const [key, label, options] of [
            ['basis', '単位', INSPECTOR_ANIMATOR_BASES], ['shape', '形', INSPECTOR_ANIMATOR_SHAPES]
        ] as const) {
            const selected = options.find(option => option.id === animator[key])!;
            animatorFields.push({
                name: `${name}-${key}`, label, inputKind: 'select', options: options.map(option => option.label),
                optionTitles: Object.fromEntries(options.map(option => [option.label, 'title' in option ? option.title : ''])),
                getValue: () => selected.label, getEditValue: () => selected.label, keyframeDisabled: true,
                write: (_snapshot, value) => writeAnimator(() => updateInspectorAnimator(
                    animators, index, key, options.find(option => option.label === value)?.id ?? value
                )),
                reset: () => writeAnimator(() => updateInspectorAnimator(animators, index, key, null))
            });
        }
        }
        for (const field of INSPECTOR_ANIMATOR_NUMBER_FIELDS) {
            if (field.key === 'randomize.seed') {
                animatorFields.push({
                    name: `${name}-ease`, label: 'イージング', inputKind: 'select', options: MOTION_EASES,
                    getValue: () => animator.ease ?? 'linear', getEditValue: () => animator.ease ?? 'linear',
                    keyframeDisabled: true,
                    write: (_snapshot, value) => writeAnimator(() => updateInspectorAnimator(animators, index, 'ease', value)),
                    reset: () => writeAnimator(() => updateInspectorAnimator(animators, index, 'ease', null))
                });
            }
            const key = field.key;
            const value = key === 'randomize.seed' ? animator.randomize?.seed ?? null
                : key === 'start' || key === 'end' || key === 'offset' ? animator[key]
                    : animator.amount[key.slice(7) as InspectorAnimatorAmountKey] ?? field.default;
            animatorFields.push({
                name: `${name}-${key.replace('.', '-')}`,
                label: !showAll && template ? ({ end: 'かかる時間', offset: '文字ごとのずれ',
                    'amount.y': '波の高さ', 'amount.rotate': '揺れの角度',
                    'randomize.seed': 'ランダム seed' } as Record<string, string>)[key] ?? field.label : field.label,
                inputKind: key === 'randomize.seed' ? 'number' : 'scrub-number',
                getValue: () => value === null ? '' : `${Number((value * field.displayScale).toFixed(1))} ${field.unit}`,
                getEditValue: () => value === null ? '' : String(value),
                min: field.min, max: field.max, scrubStep: field.step, unit: field.unit, displayScale: field.displayScale,
                displayPrecision: field.step * field.displayScale < 1 ? 1 : 0,
                keyframeDisabled: true, title: field.title,
                write: (_snapshot, input) => writeAnimator(() => updateInspectorAnimator(
                    animators, index, key, input.trim() ? Number(input) : key === 'randomize.seed' ? null : NaN
                )),
                reset: () => writeAnimator(() => updateInspectorAnimator(animators, index, key, null))
            });
        }
    });
    return { id: 'animator', label: `詳細設定（上級）: ${headingLabel}`, collapsedByDefault: true,
        fields: animatorFields, body: () => {
            const marker = document.createElement('span');
            queueMicrotask(syncAdvancedRows);
            return marker;
        } };
}

function TREE_ITEM_SECTIONS(
    snapshot: TimelineTreeItemSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    openMotion?: () => void,
    requestLivePreview?: (request: LivePreviewRequest) => void
): InspectorSection[] {
    const number = (key: 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate', fallback: number): number =>
        typeof snapshot.transform?.[key] === 'number' ? snapshot.transform[key]! : fallback;
    const axisScale = (axis: 'scaleX' | 'scaleY'): number => number(axis, number('scale', 1));
    const overallScale = (): number => Math.sqrt(axisScale('scaleX') * axisScale('scaleY'));
    const cropFields = CROP_FIELDS(snapshot, 'item', requestWrite);
    const maskFields = MASK_FIELDS(snapshot, requestWrite);
    const perspectiveSection = {
        id: 'perspective', label: 'パース（4 隅）', collapsedByDefault: true,
        fields: PERSPECTIVE_FIELDS(snapshot, requestWrite)
    };
    const transformFields: InspectorFieldDef<TimelineTreeItemSnapshot>[] = [
        {
            name: 'transform-x', label: 'X', unit: 'px', getValue: () => String(number('x', 0)),
            getEditValue: () => String(number('x', 0)), inputKind: 'scrub-number', scrubStep: 1,
            liveField: 'x', write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'transform.x', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.x', value: null })
        },
        {
            name: 'transform-y', label: 'Y', unit: 'px', getValue: () => String(number('y', 0)),
            getEditValue: () => String(number('y', 0)), inputKind: 'scrub-number', scrubStep: 1,
            liveField: 'y', write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'transform.y', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.y', value: null })
        },
        {
            name: 'transform-scale', label: '拡縮', unit: '%', removable: true,
            getValue: () => String(overallScale() * 100), getEditValue: () => String(overallScale() * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: 'scale',
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: Number(value) / 100
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: null })
        },
        ...(['scaleX', 'scaleY'] as const).map((axis, index): InspectorFieldDef<TimelineTreeItemSnapshot> => ({
            name: `transform-${axis}`, label: index === 0 ? '幅' : '高さ', unit: '%', removable: true,
            getValue: () => String(axisScale(axis) * 100), getEditValue: () => String(axisScale(axis) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: axis,
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: Number(value) / 100
            }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: `transform.${axis}`, value: null })
        })),
        {
            name: 'transform-rotate', label: '回転', unit: '°', removable: true,
            getValue: () => String(number('rotate', 0)), getEditValue: () => String(number('rotate', 0)),
            inputKind: 'scrub-number', scrubStep: 0.1, liveField: 'rotate',
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.rotate', value: null })
        }
    ];
    const opacity = snapshot.opacity ?? 1;
    const shapeGroups = shapeControlGroups(snapshot.shape, snapshot.shapeParams);
    const liveShape = (key: string, value: string | number | undefined): void => {
        if (!requestLivePreview) return;
        const target: LivePreviewTarget = { kind: 'item', id: snapshot.id };
        if (value === undefined) {
            requestLivePreview({ target, field: 'shape', value: 0, clear: true });
            return;
        }
        const shapeHtml = shapeLiveMarkup({
            itemId: snapshot.id,
            shape: snapshot.shape,
            params: snapshot.shapeParams,
            outputWidth: snapshot.outputWidth,
            transform: snapshot.transform
        }, key, value);
        if (shapeHtml !== undefined) requestLivePreview({ target, field: 'shape', value: 0, shapeHtml });
    };
    const shapeFields = (id: 'appearance' | 'bubble'): InspectorFieldDef<TimelineTreeItemSnapshot>[] =>
        (shapeGroups.find(group => group.id === id)?.fields ?? []).map(field => ({
            name: `shape-${field.key}`, label: field.label, inputKind: field.kind === 'number' ? 'scrub-number' : field.kind,
            ...(field.options ? { options: field.options } : {}),
            ...(field.min === undefined ? {} : { min: field.min }),
            ...(field.max === undefined ? {} : { max: field.max }),
            ...(field.kind === 'number' ? { scrubStep: 1 } : {}),
            ...(field.kind === 'number' ? { liveShape: (value: number | undefined) => liveShape(field.key, value) } : {}),
            ...(field.kind === 'color' ? { liveColor: (value: string) => liveShape(field.key, value) } : {}),
            getValue: () => field.value, getEditValue: () => field.value,
            write: async (_snapshot, value) => {
                const key = field.key.endsWith('Mode') ? field.key.slice(0, -4) : field.key;
                const next = field.key.endsWith('Mode') ? value === 'なし' ? 'none'
                    : key === 'fill' ? snapshot.shape === 'bubble' ? '#ffffff' : '#a6a6a6' : '#000000'
                    : field.kind === 'number' ? snapshot.shape === 'line' && key === 'strokeWidth'
                        ? Math.max(1, shapeNumber(key, value) ?? 1) : shapeNumber(key, value)
                        : field.kind === 'select' ? shapeOptionValue(key, value) : value;
                if (next === undefined) return { ok: false, message: '値を選び直してください。' };
                if (field.key === 'strokeMode' && value === '色'
                    && !(Number(snapshot.shapeParams?.strokeWidth ?? 0) > 0)) {
                    return requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.params',
                        value: enableShapeStroke(snapshot.shapeParams ?? {}) });
                }
                return requestWrite({ kind: 'item-field', id: snapshot.id, path: `source.params.${key}`, value: next });
            }
        }));
    const shapeAppearance = shapeFields('appearance');
    if (snapshot.shape === 'line' || snapshot.shape === 'arrow') shapeAppearance.push({
        name: 'shape-swap-ends', label: '始点と終点', getValue: () => '', actionLabel: '入れ替え',
        action: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.params',
            value: swapShapeEnds(snapshot.shapeParams ?? {}) })
    });
    const shapeBubble = shapeFields('bubble');
    if (snapshot.shape === 'bubble') shapeBubble.push({
        name: 'shape-next-seed', label: '形の変化', getValue: () => '', actionLabel: '別の形にする',
        action: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.params.seed',
            value: Number(snapshot.shapeParams?.seed ?? 0) + 1 })
    });
    return composeInspectorSections([
        ...(snapshot.itemKind === 'group' ? [{ id: 'canvas', label: 'キャンバス', fields: [
            { name: 'canvas-name', label: '名前', inputKind: 'text' as const,
                getValue: () => snapshot.clipName, getEditValue: () => snapshot.clipName,
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'name', value
                }) },
            { name: 'canvas-intent', label: '意図', inputKind: 'text' as const,
                getValue: () => snapshot.canvas?.intent ?? '', getEditValue: () => snapshot.canvas?.intent ?? '',
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'source.canvas.intent', value
                }) },
            { name: 'canvas-duration', label: '尺', inputKind: 'number' as const, min: 0.01, unit: '秒',
                getValue: () => String(snapshot.duration), getEditValue: () => String(snapshot.duration),
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'duration', value: Number(value)
                }) },
            { name: 'canvas-background-mode', label: '背景', inputKind: 'select' as const,
                options: ['なし', '色'],
                getValue: () => snapshot.canvas?.background?.type === 'color' ? '色' : 'なし',
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => requestWrite({
                    kind: 'item-field', id: snapshot.id, path: 'source.canvas.background',
                    value: value === '色' ? { type: 'color', color: snapshot.canvas?.background?.color ?? '#142644' } : { type: 'none' }
                }) },
            ...(snapshot.canvas?.background?.type === 'color' ? [{ name: 'canvas-background-color',
                label: '背景色', inputKind: 'color' as const,
                getValue: () => snapshot.canvas?.background?.color ?? '#142644',
                getEditValue: () => snapshot.canvas?.background?.color ?? '#142644',
                write: async (_snapshot: TimelineTreeItemSnapshot, value: string) => /^#[0-9a-fA-F]{6}$/u.test(value)
                    ? requestWrite({ kind: 'item-field', id: snapshot.id, path: 'source.canvas.background',
                        value: { type: 'color', color: value } })
                    : { ok: false, message: '色は #RRGGBB で入力してください。' } }] : [])
        ] }] : []),
        { id: 'time', label: '時間', fields: [
            { name: 'item-start', label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
            { name: 'item-duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.duration) }
        ] },
        { id: 'transform', label: '変形', fields: (['group', 'bag'].includes(snapshot.itemKind)
            ? transformFields.filter(field => field.name !== 'transform-scaleX' && field.name !== 'transform-scaleY')
            : transformFields).map(field => ({ ...field,
                markers: itemMotionMarks(snapshot, `transform.${field.name?.slice('transform-'.length)}`) })) },
        { id: 'crop', label: 'クロップ', fields: cropFields.map(field => ({ ...field,
            markers: itemMotionMarks(snapshot, 'crop') })) },
        perspectiveSection,
        MOTION_SUMMARY_SECTION(snapshot.motion, openMotion),
        ...(snapshot.itemKind === 'captions' || snapshot.itemKind === 'caption'
            ? [{ id: 'motion', label: '動き', fields: MOTION_FIELDS({ ...snapshot,
                sourceKind: 'caption' }, requestWrite) }] : MOTION_SECTIONS(snapshot, requestWrite)),
        ...(snapshot.itemKind === 'captions' || snapshot.itemKind === 'caption' ? [
            ANIMATOR_SECTION(snapshot.id, 'アニメーター', snapshot.animator, requestWrite)
        ] : []),
        { id: 'appearance', label: '外観', fields: [{
            name: 'opacity', label: '不透明度', unit: '%', displayScale: 100,
            markers: itemMotionMarks(snapshot, 'opacity'),
            getValue: () => String(opacity), getEditValue: () => String(opacity),
            inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1, liveField: 'opacity',
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'opacity', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'opacity', value: null })
        }, ...shapeAppearance, ...(!snapshot.photo ? maskFields : []),
        ...(snapshot.photo ? [...PHOTO_FLIP_FIELDS(snapshot, requestWrite),
            ...PHOTO_CROP_OPEN_FIELD(snapshot, requestWrite), ...PHOTO_FRAME_FIELDS(snapshot, requestWrite)] : [])] },
        ...(shapeBubble.length ? [{ id: 'bubble', label: '吹き出し', fields: shapeBubble }] : []),
        { id: 'info', label: '情報', collapsedByDefault: true, fields: [
            { name: 'item-kind', label: '種類', getValue: () => snapshot.sourceKind === 'group' ? 'キャンバス' : snapshot.sourceKind },
            { name: 'item-track', label: 'トラック', getValue: () => snapshot.trackName },
            { name: 'item-clip', label: 'クリップ', getValue: () => snapshot.clipName }
        ] }
    ]);
}

function ADJUST_SECTIONS(
    snapshot: InspectorSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    adjustLutOptions: { projectLutRefs: readonly string[]; importLut?: () => Promise<InspectorWriteResult> }
): InspectorSection[] {
    if (snapshot.kind === 'caption' || snapshot.kind === 'audio') return [];
    const itemId = snapshot.kind === 'cut' ? snapshot.itemId ?? `cut:${snapshot.index}` : snapshot.id;
    const adjust = readInspectorAdjustSnapshot(snapshot.adjust);
    const basicEnabled = adjust.sections.basic;
    const lutEnabled = adjust.sections.lut;
    const fxEnabled = adjust.sections.fx;
    const disabledTitle = 'セクションがオフのため変更できません。';
    const editorWrite = (section: 'curves' | 'wheels' | 'hue'): AdjustEditorWrite => async (path, value) =>
        adjust.sections[section]
            ? requestWrite(createInspectorAdjustWriteRequest(itemId, path, value))
            : { ok: false, message: disabledTitle };
    const basicFields: InspectorFieldDef[] = INSPECTOR_ADJUST_BASIC_FIELDS.map(field => ({
        name: `adjust-basic-${field.key}`,
        label: field.label,
        getValue: () => formatInspectorAdjustValue(field.key, adjust.basic[field.key]),
        getEditValue: () => String(adjust.basic[field.key]),
        inputKind: 'scrub-number',
        scrubStep: field.scrubStep,
        min: field.minimum,
        max: field.maximum,
        unit: field.unit,
        displayScale: field.displayScale,
        displayOffset: field.displayOffset,
        displayPrecision: field.displayPrecision,
        liveField: `adjust.basic.${field.key}` as const,
        keyframeDisabled: true,
        disabled: !basicEnabled,
        title: basicEnabled ? undefined : disabledTitle,
        write: async (_snapshot, value) => basicEnabled
            ? requestWrite(createInspectorAdjustWriteRequest(
                itemId,
                `adjust.basic.${field.key}`,
                Number(value)
            ))
            : { ok: false, message: disabledTitle },
        reset: () => requestWrite(createInspectorAdjustWriteRequest(
            itemId,
            `adjust.basic.${field.key}`,
            null
        ))
    }));
    const lookName = (): string => INSPECTOR_LOOK_PRESETS.find(preset => preset.id === matchLookPreset(adjust))?.name ?? 'カスタム';
    basicFields.unshift({
        name: 'adjust-look', label: 'ルック', inputKind: 'select',
        options: ['カスタム', ...INSPECTOR_LOOK_PRESETS.map(preset => preset.name)],
        keyframeDisabled: true, disabled: !basicEnabled, title: basicEnabled ? undefined : disabledTitle,
        getValue: lookName, getEditValue: lookName,
        write: async (_snapshot, value) => {
            if (!basicEnabled) return { ok: false, message: disabledTitle };
            if (value === 'カスタム') return { ok: true };
            const preset = INSPECTOR_LOOK_PRESETS.find(candidate => candidate.name === value);
            if (!preset) return { ok: false, message: '一覧からルックを選択してください。' };
            return requestWrite(createInspectorAdjustWriteRequest(itemId, 'adjust', {
                basic: preset.adjust.basic, wheels: preset.adjust.wheels
            }));
        }
    });
    const lutOptions = buildLutOptions(adjustLutOptions.projectLutRefs);
    const lutId = lutOptions.find(option => option.value === (adjust.lut?.lut ?? null))?.label ?? adjust.lut!.lut;
    const lutFields: InspectorFieldDef[] = [{
        name: 'adjust-lut-preset',
        label: 'プリセット',
        getValue: () => lutId,
        getEditValue: () => lutId,
        inputKind: 'select',
        options: lutOptions.map(option => option.label),
        disabled: !lutEnabled,
        title: lutEnabled ? undefined : disabledTitle,
        write: async (_snapshot, value) => {
            if (!lutEnabled) return { ok: false, message: disabledTitle };
            const option = lutOptions.find(candidate => candidate.label === value);
            if (!option) {
                return { ok: false, message: '一覧から LUT プリセットを選択してください。' };
            }
            return requestWrite(createInspectorAdjustWriteRequest(
                itemId,
                'adjust.lut.lut',
                option.value
            ));
        },
        reset: () => requestWrite(createInspectorAdjustWriteRequest(
            itemId,
            'adjust.lut.lut',
            null
        ))
    }, {
        name: 'adjust-lut-intensity',
        label: '強度',
        getValue: () => `${Math.round((adjust.lut?.intensity ?? 1) * 100)}%`,
        getEditValue: () => String(adjust.lut?.intensity ?? 1),
        inputKind: 'scrub-number',
        scrubStep: 0.01,
        min: 0,
        max: 1,
        unit: '%',
        displayScale: 100,
        keyframeDisabled: true,
        disabled: !lutEnabled || !adjust.lut,
        title: !lutEnabled ? disabledTitle
            : !adjust.lut ? 'LUT を選択すると変更できます。' : undefined,
        write: async (_snapshot, value) => lutEnabled && adjust.lut
            ? requestWrite(createInspectorAdjustWriteRequest(
                itemId,
                'adjust.lut.intensity',
                Number(value)
            ))
            : { ok: false, message: !lutEnabled ? disabledTitle : 'LUT を選択してください。' },
        reset: () => requestWrite(createInspectorAdjustWriteRequest(
            itemId,
            'adjust.lut.intensity',
            null
        ))
    }];
    lutFields.push({
        name: 'adjust-lut-import', label: '読み込み', getValue: () => '',
        actionLabel: 'LUT を読み込む…', keyframeDisabled: true, disabled: !lutEnabled,
        title: lutEnabled ? undefined : disabledTitle,
        action: async () => lutEnabled && adjustLutOptions.importLut
            ? adjustLutOptions.importLut() : { ok: false, message: disabledTitle }
    });
    const writeFx = async (update: () => InspectorAdjustFx[]): Promise<InspectorWriteResult> => {
        if (!fxEnabled) return { ok: false, message: disabledTitle };
        try {
            return await requestWrite(createInspectorAdjustWriteRequest(itemId, 'adjust.fx', update()));
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : '効果を変更できませんでした。' };
        }
    };
    const fxFields: InspectorFieldDef[] = [{
        name: 'adjust-fx-add', label: '効果を追加', inputKind: 'select',
        options: ['選択…', ...INSPECTOR_ADJUST_FX.map(effect => effect.label)],
        getValue: () => '選択…', getEditValue: () => '選択…',
        keyframeDisabled: true, disabled: !fxEnabled, title: fxEnabled ? undefined : disabledTitle,
        write: async (_snapshot, value) => {
            if (!fxEnabled) return { ok: false, message: disabledTitle };
            if (value === '選択…') return { ok: true };
            const effect = INSPECTOR_ADJUST_FX.find(candidate => candidate.label === value);
            if (!effect) return { ok: false, message: '一覧から効果を選択してください。' };
            return writeFx(() => addInspectorAdjustFx(adjust.fx, effect.id));
        }
    }];
    adjust.fx.forEach((effect, index) => {
        const definition = INSPECTOR_ADJUST_FX.find(candidate => candidate.id === effect.id)!;
        fxFields.push({
            name: `adjust-fx-${effect.id}`, label: definition.label, getValue: () => '',
            keyframeDisabled: true, disabled: !fxEnabled, title: fxEnabled ? undefined : disabledTitle,
            actions: [{
                name: 'up', label: '↑', title: `${definition.label}を上へ`, disabled: index === 0,
                action: () => writeFx(() => moveInspectorAdjustFx(adjust.fx, index, -1))
            }, {
                name: 'down', label: '↓', title: `${definition.label}を下へ`, disabled: index === adjust.fx.length - 1,
                action: () => writeFx(() => moveInspectorAdjustFx(adjust.fx, index, 1))
            }, {
                name: 'remove', label: '削除', title: `${definition.label}を削除`,
                action: () => writeFx(() => removeInspectorAdjustFx(adjust.fx, index))
            }]
        });
        for (const param of definition.params) {
            const value = (effect as Record<string, unknown>)[param.key] as number | undefined ?? param.default;
            fxFields.push({
                name: `adjust-fx-${effect.id}-${param.key}`, label: param.label,
                getValue: () => `${Number((value * param.displayScale).toFixed(1))} ${param.unit}`,
                getEditValue: () => String(value), inputKind: 'scrub-number',
                min: param.min, max: param.max, scrubStep: param.step,
                unit: param.unit, displayScale: param.displayScale,
                displayPrecision: param.step * param.displayScale < 1 ? 1 : 0,
                keyframeDisabled: true, disabled: !fxEnabled, title: fxEnabled ? undefined : disabledTitle,
                write: (_snapshot, input) => writeFx(() => updateInspectorAdjustFxParam(
                    adjust.fx, index, param.key, input.trim() ? Number(input) : NaN
                )),
                reset: () => writeFx(() => updateInspectorAdjustFxParam(adjust.fx, index, param.key, null))
            });
        }
    });
    return [{
        id: 'adjust:basic',
        label: ACTIVE_ADJUST_SECTIONS[0],
        fields: basicFields,
        enable: {
            name: 'adjust-basic-enabled',
            label: '基本補正を有効化',
            checked: basicEnabled,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId,
                'adjust.sections.basic',
                enabled ? null : false
            ))
        }
    }, {
        id: 'adjust:curves',
        label: ACTIVE_ADJUST_SECTIONS[1],
        fields: [],
        body: () => buildRgbCurveEditor(adjust, editorWrite('curves')),
        enable: {
            name: 'adjust-curves-enabled',
            label: 'RGB カーブを有効化',
            checked: adjust.sections.curves,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId, 'adjust.sections.curves', enabled ? null : false
            ))
        }
    }, {
        id: 'adjust:wheels',
        label: ACTIVE_ADJUST_SECTIONS[2],
        fields: [],
        body: () => buildColorWheelEditor(adjust, editorWrite('wheels')),
        enable: {
            name: 'adjust-wheels-enabled',
            label: 'カラーホイールを有効化',
            checked: adjust.sections.wheels,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId, 'adjust.sections.wheels', enabled ? null : false
            ))
        }
    }, {
        id: 'adjust:hue',
        label: ACTIVE_ADJUST_SECTIONS[3],
        fields: [],
        body: () => buildHueCurveEditor(adjust, editorWrite('hue')),
        enable: {
            name: 'adjust-hue-enabled',
            label: 'Hue カーブを有効化',
            checked: adjust.sections.hue,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId, 'adjust.sections.hue', enabled ? null : false
            ))
        }
    }, {
        id: 'adjust:lut',
        label: ACTIVE_ADJUST_SECTIONS[4],
        fields: lutFields,
        enable: {
            name: 'adjust-lut-enabled',
            label: 'LUT を有効化',
            checked: lutEnabled,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId,
                'adjust.sections.lut',
                enabled ? null : false
            ))
        }
    }, {
        id: 'adjust:fx',
        label: ACTIVE_ADJUST_SECTIONS[5],
        fields: fxFields,
        enable: {
            name: 'adjust-fx-enabled', label: 'エフェクトを有効化', checked: fxEnabled,
            write: enabled => requestWrite(createInspectorAdjustWriteRequest(
                itemId, 'adjust.sections.fx', enabled ? null : false
            ))
        }
    }];
}

/**
 * タイムラインの選択内容を表示し、安全なフィールドを編集できるパネル。
 * 一度開けば常駐し、TimelineSelectionModel の変化に追従して内容を更新する。
 */
@injectable()
export class AkariInspectorWidget extends BaseWidget {
    @inject(AkariPreviewService)
    @optional()
    protected readonly captionPreviewService?: import('akari-preview/lib/common/akari-preview-protocol').AkariPreviewService;

    @inject(AkariAnnotationsService)
    protected readonly layerAudioService!: AkariAnnotationsService;

    @inject(AkariEditHistoryService)
    protected readonly history!: AkariEditHistoryService;

    static readonly FACTORY_ID = 'akari-inspector-widget';

    @inject(TimelineSelectionModel)
    protected readonly model!: TimelineSelectionModel;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(FileDialogService)
    protected readonly fileDialogService!: FileDialogService;

    @inject(CommandRegistry)
    protected readonly commandRegistry!: CommandRegistry;

    @inject(WidgetManager)
    protected readonly stillWidgetManager!: WidgetManager;

    @inject(PreferenceService)
    protected readonly narrationPreferences!: PreferenceService;

    protected narrationIrodoriUrl(): string {
        return this.narrationPreferences?.get<string>('akari.narration.irodoriUrl', 'http://127.0.0.1:8088')
            ?? 'http://127.0.0.1:8088';
    }

    protected generationFramePick?: { key: string; slot: string };
    protected generationFramePickMessage?: { key: string; text: string };

    protected projectLutRefs: readonly string[] = [];
    protected lutGeneration = 0;
    protected lutRequestedGeneration = -1;
    protected adjustCompare?: AdjustCompareState;
    protected solo?: InspectorSoloState;
    protected soloSelectionKey?: string;

    protected readonly body = document.createElement('div');
    protected captionPanel: CaptionPanel | null = null;
    protected readonly captionPanelState: CaptionPanelViewState = {
        query: '', filtersOpen: false, filters: new Set(), recentFonts: [], recentStyles: []
    };
    protected captionPanelMyStyles: CaptionPanelMyStyle[] = [];
    protected captionPanelFontFaces = new Map<string, string>();
    protected captionPanelFontsLoaded = false;
    protected captionRowFontsLoading = false;
    protected captionPanelPreview: CaptionPanelPreviewState = { active: null };

    protected runCaptionPanelPreview(action: CaptionPanelPreviewAction): { close: boolean; commit: boolean } {
        const transition = advanceCaptionPanelPreview(this.captionPanelPreview, action);
        this.captionPanelPreview = transition.state;
        if (transition.detail) window.dispatchEvent(new CustomEvent('akari-caption-panel-preview', {
            detail: { ...transition.detail, ...(action.type === 'confirm' ? { committed: true } : {}) }
        }));
        return { close: transition.close, commit: transition.commit };
    }

    public toggleCaptionPanel(panel: CaptionPanel): boolean {
        const snapshot = this.model.snapshot;
        const hasText = snapshot?.kind === 'caption'
            || snapshot?.kind === 'item' && snapshot.itemKind === 'caption'
                && !!(this.model.selectedCaptionIds[0] ?? captionIdForTreeSelection(snapshot));
        if (!hasText) return false;
        if (snapshot.kind === 'caption') {
            const currentFamily = snapshot.effectiveTextStyle?.fontFamily ?? snapshot.textStyle?.fontFamily;
            const current = CAPTION_PANEL_FONTS.find(font => this.captionPanelFontFaces.get(font.id) === currentFamily
                || font.id === 'noto-sans-jp' && currentFamily === CAPTION_FONT_FAMILY);
            if (current && !this.captionPanelState.recentFonts.includes(current.id)) {
                this.captionPanelState.recentFonts.unshift(current.id);
            }
        }
        this.captionPanel = nextCaptionPanel(this.captionPanel, panel, true);
        this.runCaptionPanelPreview({ type: 'leave' });
        this.notifyCaptionPanel();
        if (this.captionPanel) void this.loadCaptionPanelData();
        this.render();
        return true;
    }

    public closeCaptionPanel(): void {
        if (!this.captionPanel) return;
        this.runCaptionPanelPreview({ type: 'leave' });
        this.captionPanel = null;
        this.notifyCaptionPanel();
        this.render();
    }

    protected notifyCaptionPanel(): void {
        window.dispatchEvent(new CustomEvent('akari-caption-panel-changed', {
            detail: captionPanelChangedDetail(this.captionPanel)
        }));
    }

    protected async loadCaptionPanelData(): Promise<void> {
        try {
            const results = await Promise.all([
                this.captionPreviewService?.getOverlayRuntimeAssetUrls(),
                this.commandRegistry.executeCommand<CaptionPanelMyStyle[]>('akari.library.listMyStyles').catch(() => [])
            ]);
            this.captionPanelMyStyles = Array.isArray(results[1]) ? results[1] : [];
            if (results[0]) this.registerCaptionPanelFonts(results[0]);
            if (this.captionPanel) this.render();
        } catch (error) {
            this.showFieldNotice(String(error));
        }
    }

    protected registerCaptionPanelFonts(assets: OverlayRuntimeAssetUrls): void {
        if (this.captionPanelFontsLoaded) return;
        this.captionPanelFontsLoaded = true;
        const faces = [...assets.bundledCaptionFontFaces,
            { id: 'noto-sans-jp', family: CAPTION_FONT_FAMILY, weight: '100 900', file: '', url: assets.captionFontUrl }];
        const css = document.createElement('style');
        css.setAttribute('data-akari-caption-panel-fonts', '');
        css.textContent = faces.filter(face => face.id !== 'noto-sans-jp').map(face => {
            const weight = face.id === 'noto-serif-jp' ? '200 900' : face.weight;
            return `@font-face{font-family:${JSON.stringify(face.family)};src:url(${JSON.stringify(face.url)}) format('truetype');font-weight:${weight};font-style:normal;font-display:swap}`;
        }).join('\n') + '\n' + captionFontFaceCss(assets.captionFontUrl);
        document.head.append(css);
        this.toDispose.push({ dispose: () => css.remove() });
        void Promise.all(faces.map(async face => {
            const weight = face.id === 'noto-serif-jp' ? '200' : face.weight.split(' ')[0];
            const descriptor = face.id === 'noto-sans-jp' ? CAPTION_FONT_LOAD_DESCRIPTOR
                : `${weight} 19px ${JSON.stringify(face.family)}`;
            try {
                if ((await document.fonts.load(descriptor, 'Aa あいう')).length > 0) {
                    this.captionPanelFontFaces.set(face.id, face.family);
                }
            } catch { /* A failed font is not offered as an applicable row. */ }
        })).then(() => {
            if (this.captionPanel === 'font' || this.model.snapshot?.kind === 'caption'
                || this.model.snapshot?.kind === 'overlay'
                || this.model.snapshot?.kind === 'multi') this.render();
        });
    }

    protected ensureCaptionRowFontFace(): void {
        if (this.captionPanelFontsLoaded || this.captionRowFontsLoading || !this.captionPreviewService) return;
        this.captionRowFontsLoading = true;
        void this.captionPreviewService.getOverlayRuntimeAssetUrls()
            .then(assets => this.registerCaptionPanelFonts(assets))
            .catch(() => { this.captionRowFontsLoading = false; });
    }
    protected readonly fieldNotice = document.createElement('div');
    protected fieldNoticeTimer: number | undefined;
    protected lastWriteError?: { message: string; at: number };
    protected readonly sectionState = new InspectorSectionState(window.localStorage);
    protected readonly tabState = new InspectorTabState(window.localStorage);
    protected editAdjustScope: '画像全体' | '選択エリア' = '画像全体';
    protected tabSelectionKey?: string;
    protected renderedSelectionKey?: string;
    protected lastRealSelectionKey?: string;
    protected pendingEmptyRender?: ReturnType<typeof setTimeout>;
    protected forceEmptyRender = false;
    protected rememberedView: InspectorViewState = { scrollTop: 0 };
    protected restoringView = false;
    protected viewRestoreRevision = 0;
    protected pendingTabFocus = false;
    protected suppressFocusRestore = false;
    protected ignoreScrollUntil = 0;
    protected lastScrollIntentAt = 0;
    protected latestRenderAt = 0;
    protected bodyMinHeightBeforeRestore?: string;
    protected bodyHeldHeight = 0;
    protected liveValues?: LiveValues;
    protected liveFrame?: number;
    protected liveSelectionId(): string | undefined {
        const snapshot = this.model.snapshot;
        return snapshot?.kind === 'cut' ? `cut:${snapshot.index}`
            : snapshot?.kind === 'item' || snapshot?.kind === 'overlay' || snapshot?.kind === 'layer'
                ? snapshot.id : undefined;
    }
    protected currentTab?: string;
    protected explicitTabId?: string;
    protected readonly generationTabMeta = new Map<string, { next?: { status?: unknown }; stillCandidateCount?: number }>();
    protected readonly generationProvenanceMeta = new Map<string, unknown>();
    protected readonly generationProvenanceLoads = new Set<string>();
    protected readonly generationProvenanceVoiceLoads = new Set<string>();
    protected readonly frameAspectLive = new Map<string, FrameAspectLive>();
    protected readonly frameAspectWrites = new Map<string, Promise<void>>();
    protected readonly frameAspectTargets = new Map<string, LivePreviewTarget>();
    protected readonly frameAspectTried = new Map<string, string>();
    protected readonly frameAspectPlanned = new Map<string, Set<string>>();
    protected readonly generationTabLoads = new Set<string>();
    protected readonly generationTabDrafts = new Map<string, GenerationDraft>();
    protected readonly knobCache = new Map<string, readonly InspectorKnob[] | null>();
    protected lastEasingPreviewAt = -Infinity;
    protected generationCatalog: GenerationCatalogRow[] = [];
    protected aiCatalogLoaded = false;
    protected aiCatalogFailed = false;
    protected aiCatalogFailureWorkspace?: string;
    protected aiCatalogLoading?: Promise<void>;
    protected narrationEngines: NarrationEngine[] = [];
    protected narrationStates = new Map<string, AiNarrationState>();
    protected narrationAudio?: HTMLAudioElement;
    protected narrationPlacementNotice?: { clipKey: string; sourcePath: string; label: string };
    protected narrationSourcePath?: string;
    protected narrationSourceCheckVersion = 0;
    protected narrationEditVersion = 0;
    protected narrationVerified?: { itemId: string; editVersion: number };
    protected narrationPlacementContext?: { itemId: string; editVersion: number; tracks: NarrationTrack[]; fps: number };
    protected narrationEditSnapshot?: { itemId: string; editVersion: number; edit: any };
    protected narrationLoadRevision = 0;
    protected narrationTick?: number;
    protected aiView?: AiTabView;
    protected readonly imageAiPanels = new Map<string, ImageAiPanelState>();
    protected imageAiPanelOpen?: { open: () => void; itemId: string };
    protected aiViewClipKey?: string;
    protected gapAiOpening?: { gap: TimelineGapSelection; view: 'still' | 'video' };
    protected photoAiOpening?: 'tiles' | 'cutout' | 'eraser';
    protected aiStillSelectionClipKey?: string;
    protected readonly aiStillStates = new Map<string, AiStillState>();
    protected readonly aiVideoStates = new Map<string, AiVideoState>();
    protected aiVideoWorkspaceKey?: string;
    protected aiVideoPlayerItemKey?: string;
    protected stillFalEstimate?: StillFalEstimate;
    protected stillFalEstimateError?: string;
    protected stillFalEstimateLoading?: Promise<void>;
    protected previewedVideoCandidate?: { editUri: string; itemId: string; key: string };
    protected aiStillTick?: number;
    protected pendingAiViewDecision?: string;
    protected transcribeKey?: string;
    protected transcribeTarget?: AiTranscribeTarget;
    protected transcribeSummary: TranscriptSummary = { state: 'none', segments: [], total: 0 };
    protected transcribeRunning = false;
    protected transcribePolling = false;
    protected transcribeTimer?: ReturnType<typeof setInterval>;
    protected transcribeLoading?: Promise<void>;
    protected transcribeEngines?: AiTranscribeEngine[];
    protected transcribeEngineError?: string;
    protected transcribeSelectedBackend?: string;
    protected transcribeRedo = false;
    protected transcribeEngineLoading = false;
    protected transcribeMediaDuration?: number;
    protected transcribeDurationLookupKey?: string;
    protected materialSelection?: AkariMaterialSelection;
    protected materialTab: 'generation' | 'info' = 'generation';
    protected readonly materialCreated = new Map<string, string>();
    protected readonly materialGenerationStatus = new Map<string, { state: 'loading' | 'error'; reason?: string }>();
    protected audioPlanned = false;
    protected generationDefaultModel = 'fal:h3-i2v';
    protected readonly generationDrafts = new Map<string, GenerationDraft>();
    protected readonly generationQuality = new Map<string, { modelId: string; enabled: boolean; previousResolution: string | null }>();
    protected readonly generationDone = new Map<string, { sourcePath: string; meta: unknown; originalMeta?: unknown }>();
    protected readonly generationFinal = new Set<string>();
    protected readonly generationVideoPaths = new Map<string, string>();
    protected generationRetryPending = false;
    protected readonly generationValidations = new Map<string, GenerationValidation>();
    protected readonly generationStates = new Map<string, string>();
    protected readonly generationLoads = new Set<string>();
    protected readonly generationThumbnails = new Map<string, Promise<string | undefined>>();
    protected readonly generationNeighbors = new Map<string, { previousImage?: string; nextImage?: string; previousId?: string; previousPath?: string }>();
    protected readonly generationWrites = new Map<string, Promise<void>>();
    protected generationDetailsOpen = false;
    protected readonly generationDraftTimers = new Map<string, number>();
    protected generationActionError?: { key: string; draft: string; text: string; clear: () => void };

    protected batchSelectionKey?: string;
    protected batchItems: GenerationBatchItem[] = [];
    protected batchLoading = false;
    protected batchLoadRevision = 0;
    protected batchWatching = false;
    protected batchRun?: { projectRootUri: string; stopped: boolean; active: boolean;
        progress: Map<string, { state: GenerationBatchProgress; reason?: string }> };
    protected batchConfirming = false;

    @postConstruct()
    protected init(): void {
        this.id = AkariInspectorWidget.FACTORY_ID;
        this.title.label = '編集パネル';
        this.title.caption = 'タイムラインで選択した項目の詳細（安全なフィールドは編集可能）';
        this.title.iconClass = 'akari-rail-icon akari-rail-icon-inspector';
        this.title.closable = true;
        this.node.classList.add('akari-inspector-widget');
        const openImageAi = (event: Event): void => {
            const itemId = (event as CustomEvent<{ itemId?: string }>).detail?.itemId;
            const selectedId = () => this.model.snapshot?.kind === 'item' ? this.model.snapshot.id
                : this.model.snapshot?.kind === 'cut' ? this.model.snapshot.itemId : undefined;
            if (!itemId || selectedId() !== itemId) return;
            void this.loadAiCatalog().finally(() => {
                if (selectedId() !== itemId) return;
                this.explicitTabId = 'edit'; this.aiView = 'tiles'; this.render();
                this.imageAiPanelOpen?.itemId === itemId && this.imageAiPanelOpen.open();
            });
        };
        window.addEventListener('akari.imageAi.open', openImageAi);
        this.toDispose.push({ dispose: () => window.removeEventListener('akari.imageAi.open', openImageAi) });
        const onPhotoBrushEnd = (): void => {
            activePhotoBrushItemId = null;
            this.node.querySelector('[data-akari-ui="action:inspector-photo-brush-start"]')
                ?.setAttribute('aria-pressed', 'false');
        };
        window.addEventListener('akari.photo.brush-end', onPhotoBrushEnd);
        this.toDispose.push({ dispose: () => window.removeEventListener('akari.photo.brush-end', onPhotoBrushEnd) });
        // docs/contract-2026-08-11-review-session-ui-events.md #2: panel:<id> opt-in target.
        this.node.setAttribute('data-akari-ui', 'panel:inspector');
        this.node.setAttribute('data-akari-ui-label', '編集パネル');
        Object.assign(this.node.style, {
            height: '100%',
            overflowX: 'hidden',
            overflowY: 'auto',
            minWidth: '0',
            containerType: 'inline-size',
            overflowAnchor: 'none',
            background: 'var(--akari-bg)'
        });
        Object.assign(this.body.style, {
            padding: '8px',
            minWidth: '0',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: '6px',
            alignContent: 'start'
        });
        this.node.appendChild(this.body);
        const markScrollIntent = (): void => { this.lastScrollIntentAt = Date.now(); };
        this.node.addEventListener('wheel', markScrollIntent, { passive: true });
        this.node.addEventListener('pointerdown', event => {
            if (event.target === this.node) markScrollIntent();
        }, true);
        this.node.addEventListener('scroll', () => {
            if (this.renderedSelectionKey !== this.viewSelectionKey()
                || !shouldRememberInspectorScroll(this.restoringView, Date.now(), this.ignoreScrollUntil,
                    this.lastScrollIntentAt, this.latestRenderAt)) return;
            this.rememberedView = { ...this.rememberedView, scrollTop: this.node.scrollTop };
        });
        this.node.addEventListener('focusin', event => {
            if (!(event.target instanceof Element)) return;
            this.suppressFocusRestore = false;
            if (event.target.closest('[data-akari-ui^="field:inspector-"], [data-akari-field]')) {
                this.rememberFocus(event.target);
            } else this.rememberedView = { ...this.rememberedView, focusField: undefined, focusPart: undefined };
        });
        this.node.addEventListener('focusout', event => {
            if (!this.restoringView && !(event.relatedTarget instanceof Node && this.node.contains(event.relatedTarget))) {
                this.rememberedView = withoutInspectorFocus(this.rememberedView);
            }
        });
        this.node.addEventListener('input', event => {
            if ((typeof HTMLInputElement !== 'undefined' && event.target instanceof HTMLInputElement)
                || (typeof HTMLTextAreaElement !== 'undefined' && event.target instanceof HTMLTextAreaElement)) {
                event.target.dataset.akariInspectorDirty = 'true';
            }
        });
        this.node.addEventListener('keydown', event => {
            if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
                && !(event.target instanceof Element && event.target.closest('input, textarea'))) markScrollIntent();
            if ((event.key === 'Enter' || event.key === 'Escape')
                && event.target instanceof Element
                && event.target.closest('input, textarea, [contenteditable="true"]')) {
                this.suppressFocusRestore = true;
                this.pendingTabFocus = false;
                this.rememberedView = withoutInspectorFocus(this.rememberedView);
                return;
            }
            if (event.key !== 'Tab' || !(event.target instanceof Element)) return;
            this.suppressFocusRestore = false;
            if (typeof HTMLInputElement !== 'undefined' && event.target instanceof HTMLInputElement
                && event.target.classList.contains('akari-inspector-number-input')) {
                const inputs = Array.from(this.body.querySelectorAll<HTMLInputElement>(
                    '.akari-inspector-number-input:not(:disabled)'
                )).filter(element => element.getClientRects().length > 0);
                const index = inputs.indexOf(event.target);
                const nextInput = inputs[index + (event.shiftKey ? -1 : 1)];
                if (nextInput) {
                    event.preventDefault();
                    this.rememberFocus(nextInput);
                    this.pendingTabFocus = true;
                    event.target.blur();
                    nextInput.focus({ preventScroll: true });
                    return;
                }
            }
            const controls = Array.from(this.node.querySelectorAll<HTMLElement>(
                'input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)'
            )).filter(element => element.getClientRects().length > 0);
            const index = controls.indexOf(event.target as HTMLElement);
            const next = controls[index + (event.shiftKey ? -1 : 1)];
            if (next) { this.rememberFocus(next); this.pendingTabFocus = true; }
            else {
                this.pendingTabFocus = false;
                this.rememberedView = { ...this.rememberedView, focusField: undefined, focusPart: undefined };
            }
        }, true);
        this.toDispose.push({ dispose: () => {
            if (this.pendingEmptyRender !== undefined) clearTimeout(this.pendingEmptyRender);
        } });
        Object.assign(this.fieldNotice.style, {
            display: 'none',
            padding: '6px 10px',
            fontSize: '11px',
            color: 'var(--theia-errorForeground, #f14c4c)',
            borderBottom: '1px solid var(--akari-line)'
        });
        this.node.insertBefore(this.fieldNotice, this.body);

        const style = document.createElement('style');
        style.textContent = INSPECTOR_WIDGET_CSS;
        this.node.appendChild(style);
        const captionPanelStyle = document.createElement('style');
        captionPanelStyle.textContent = CAPTION_PANEL_CSS;
        this.node.appendChild(captionPanelStyle);

        const clearSoloShortcut = (): void => {
            if (!this.node.contains(document.activeElement) || !this.clearSolo()) return;
            this.render();
        };
        window.addEventListener('akari.inspector.clearSoloShortcut', clearSoloShortcut);
        this.toDispose.push({ dispose: () => window.removeEventListener('akari.inspector.clearSoloShortcut', clearSoloShortcut) });
        const onCaptionPanelPreviewEscape = (event: KeyboardEvent): void => {
            if (!shouldCaptureCaptionPanelPreviewEscape(this.captionPanelPreview, event.key)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this.runCaptionPanelPreview({ type: 'escape' });
        };
        window.addEventListener('keydown', onCaptionPanelPreviewEscape, true);
        this.toDispose.push({ dispose: () => window.removeEventListener('keydown', onCaptionPanelPreviewEscape, true) });
        // Input-local Escape still reaches this widget after the input restores its own value.
        this.node.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || !(event.target instanceof HTMLElement)
                || !event.target.closest('input, textarea, [contenteditable="true"]') || !this.clearSolo()) return;
            event.preventDefault();
            event.stopPropagation();
            this.render();
        });
        this.toDispose.push(this.model.onChanged(() => {
            this.clearSoloForSelectionChange();
            if (this.materialSelection) {
                this.materialSelection = undefined;
                this.aiView = undefined;
            }
            if (this.captionPanel) {
                const selection = this.model.snapshot;
                const retained = retainCaptionPanel(this.captionPanel, selection?.kind === 'caption'
                    || selection?.kind === 'item' && selection.itemKind === 'caption'
                        && !!(this.model.selectedCaptionIds[0] ?? captionIdForTreeSelection(selection)));
                if (retained !== this.captionPanel) {
                    this.runCaptionPanelPreview({ type: 'leave' });
                    this.captionPanel = retained; this.notifyCaptionPanel();
                }
            }
            if (this.previewedVideoCandidate && shouldClearVideoCandidatePreview(this.previewedVideoCandidate.itemId,
                this.generationIdentity?.(this.model.snapshot)?.itemId)) {
                this.clearVideoCandidatePreview();
            }
            this.liveValues = undefined;
            this.lutGeneration++;
            this.projectLutRefs = [];
            this.render();
        }));
        const onLiveValues = (event: Event): void => {
            const detail = (event as CustomEvent<{ id?: string; editUri?: string;
                values?: Record<string, number>; clear?: boolean }>).detail;
            const editUri = this.workspaceService.tryGetRoots()[0]?.resource && currentTimelineEditUri(this.workspaceService.tryGetRoots()[0].resource).normalizePath().toString();
            if (!editUri || detail?.editUri !== editUri) return;
            if (!detail?.id || this.liveSelectionId() !== detail.id) return;
            if (detail.clear) {
                this.liveValues = undefined;
                this.render();
                return;
            }
            else if (detail.values) this.liveValues = mergeLiveValues(this.liveValues, { id: detail.id, values: detail.values });
            if (this.liveFrame === undefined) this.liveFrame = requestAnimationFrame(() => {
                this.liveFrame = undefined;
                this.paintLiveValues();
            });
        };
        window.addEventListener('akari.preview.liveValues', onLiveValues);
        this.toDispose.push({ dispose: () => {
            window.removeEventListener('akari.preview.liveValues', onLiveValues);
            if (this.liveFrame !== undefined) cancelAnimationFrame(this.liveFrame);
        } });
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            const root = this.workspaceService.tryGetRoots()[0]?.resource;
            if (!root || !event.changes.some(change => change.resource.toString() === currentTimelineEditUri(root).toString())) return;
            this.narrationEditVersion = (this.narrationEditVersion ?? 0) + 1;
            if (!this.materialSelection && this.model.snapshot?.kind === 'audio') this.render();
        }));
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (!event.changes.some(change => /(?:\.inputs\.json|\.meta\.json)$/u.test(change.resource.path.toString()))) return;
            const current = this.generationIdentity(this.model.snapshot);
            if (!current) return;
            this.generationLoads.delete(current.key);
            void this.loadGeneration(current);
        }));
        this.render();
    }

    focusField(options: { tabId?: string; sectionId?: string; fieldName?: string; solo?: boolean;
        pulse?: boolean }): boolean {
        if ((options.tabId === 'generation' || options.tabId === 'edit') && options.fieldName === 'akari-generation-retry') {
            void this.retryGenerationFromTimeline();
            return true;
        }
        if (options.tabId === 'generation') options = { ...options, tabId: 'edit' };
        const clearedSolo = this.solo !== undefined;
        if (clearedSolo) {
            this.solo = undefined;
            this.soloSelectionKey = undefined;
        }
        if (!options.tabId && !options.sectionId && !options.fieldName) {
            if (clearedSolo) this.render();
            return false;
        }
        const snapshot = this.model.snapshot;
        if (!snapshot || snapshot.kind === 'world' || snapshot.kind === 'gap') {
            if (clearedSolo) this.render();
            return false;
        }
        const kind = snapshot.kind === 'multi' ? 'caption' : snapshot.kind;
        if (options.tabId) {
            this.explicitTabId = options.tabId;
            this.tabState.setActiveTab(kind, options.tabId);
        }
        if (options.tabId === 'edit' && options.sectionId
            && ['home', 'photo-cutout', 'photo-eraser'].includes(options.sectionId)) {
            this.photoAiOpening = options.sectionId === 'home' ? 'tiles'
                : options.sectionId === 'photo-cutout' ? 'cutout' : 'eraser';
        }
        this.render();
        if (options.tabId === 'edit' && options.sectionId === 'home') {
            return !!this.body.querySelector('[data-akari-ui="tab:inspector-edit"].is-active');
        }
        const requestedSectionId = options.sectionId;
        const matchingSections = (): Element[] => {
            if (!requestedSectionId) return [];
            if (typeof this.body.querySelectorAll !== 'function') {
                const section = this.body.querySelector(`[data-akari-ui="section:inspector-${requestedSectionId}"]`);
                return section ? [section] : [];
            }
            return Array.from(this.body.querySelectorAll('[data-akari-ui^="section:inspector-"]'))
                .filter(section => {
                    const id = section.getAttribute('data-akari-ui')!.slice('section:inspector-'.length);
                    return id === requestedSectionId || id.startsWith(`${requestedSectionId}:`);
                });
        };
        if (options.sectionId) {
            const matches = matchingSections();
            const needsRender = typeof this.body.querySelectorAll === 'function' && matches.some(section =>
                section.querySelector?.('.akari-inspector-section-body')?.hasAttribute('hidden'));
            for (const section of matches) {
                const ui = section.getAttribute?.('data-akari-ui');
                const id = ui?.startsWith('section:inspector-')
                    ? ui.slice('section:inspector-'.length) : requestedSectionId;
                this.sectionState.setCollapsed(id === 'motion' || id === 'animator' ? `${kind}:motion` : kind,
                    id, false);
            }
            if (needsRender) this.render();
        }
        let ok = true;
        if (options.tabId) {
            ok = ok && !!this.body.querySelector(`[data-akari-ui="tab:inspector-${options.tabId}"].is-active`);
        }
        let fieldElement: Element | null = null;
        if (options.fieldName) {
            fieldElement = this.body.querySelector(`[data-akari-field="${options.fieldName}"]`);
            ok = ok && !!fieldElement;
        }
        let sectionElement: Element | null = options.sectionId
            ? matchingSections().find(section => fieldElement && section.contains?.(fieldElement))
                ?? matchingSections()[0] ?? null
            : null;
        if (options.sectionId) ok = ok && !!sectionElement;
        if (options.solo && sectionElement && fieldElement) {
            ok = ok && sectionElement.contains(fieldElement);
        }
        if (!ok) return false;
        if (options.solo && (options.sectionId || options.fieldName)) {
            const tabId = options.tabId ?? this.activeTabId();
            if (tabId) {
                this.solo = {
                    kind,
                    tabId,
                    ...(options.sectionId ? { sectionId: options.sectionId } : {}),
                    ...(options.fieldName ? { fieldName: options.fieldName } : {})
                };
                this.soloSelectionKey = this.currentSelectionKey();
                this.render();
                fieldElement = options.fieldName
                    ? this.body.querySelector(`[data-akari-field="${options.fieldName}"]`)
                    : null;
                sectionElement = options.sectionId
                    ? matchingSections().find(section => fieldElement && section.contains?.(fieldElement))
                        ?? matchingSections()[0] ?? null
                    : null;
            }
        }
        const target = fieldElement ?? sectionElement;
        if (target && options.pulse !== false) this.pulse(target as HTMLElement);
        return true;
    }

    revealCaptionField(argument: unknown): boolean {
        const snapshot = this.model.snapshot;
        if (snapshot?.kind !== 'caption' && !(snapshot?.kind === 'multi'
            && snapshot.items.length > 0 && snapshot.items.every(item => item.kind === 'caption'))) {
            return false;
        }
        if (this.captionPanel) this.closeCaptionPanel();
        const destination = captionRevealDestination(argument,
            snapshot.kind === 'caption' && !!snapshot.animatorOwner);
        if (!this.focusField({ tabId: destination.tabId, sectionId: destination.sectionId, pulse: false })) return false;
        const target = destination.field
            ? this.body.querySelector(`[data-inspector-field="${destination.field}"]`)
            : this.body.querySelector(`[data-akari-ui="section:inspector-${destination.sectionId}"]`);
        if (!(target instanceof HTMLElement)) return false;
        const panelRect = this.node.getBoundingClientRect();
        const scrollTop = captionRevealScrollTop(this.node.scrollTop, panelRect.top,
            this.node.clientHeight, this.node.scrollHeight, target.getBoundingClientRect().top);
        // render() pins rememberedView.scrollTop for several frames. Update both so its
        // restore and pin callbacks keep the requested section visible.
        this.rememberedView = { ...this.rememberedView, scrollTop };
        this.node.scrollTop = scrollTop;
        target.classList.add('akari-inspector-reveal-flash');
        window.setTimeout(() => target.classList.remove('akari-inspector-reveal-flash'), 650);
        if (destination.field && destination.field !== 'caption-style') {
            const input = target.querySelector<HTMLInputElement>('input[type="text"], input[type="color"]');
            input?.focus({ preventScroll: true });
        }
        return true;
    }

    protected async retryGenerationFromTimeline(): Promise<void> {
        if (this.generationRetryPending || this.isDisposed) return;
        this.generationRetryPending = true;
        try {
            // Selection can arrive after openInspectorPanel, or a generated video's
            // identity may still be resolving from its sidecar. Keep this request pending.
            const deadline = Date.now() + 2000;
            let identity = this.generationIdentity(this.model.snapshot);
            while (!identity && !this.isDisposed && Date.now() < deadline) {
                this.focusField({ tabId: 'edit', sectionId: 'generation' });
                await new Promise<void>(resolve => window.setTimeout(resolve, 20));
                identity = this.generationIdentity(this.model.snapshot);
            }
            if (this.isDisposed) return;
            if (!identity) { this.showFieldNotice('再試行するクリップの生成情報を読み込めませんでした。'); return; }
            this.focusField({ tabId: 'edit', sectionId: 'generation' });
            await this.loadGeneration(identity);
            if (this.isDisposed) return;
            if (this.generationIdentity(this.model.snapshot)?.key !== identity.key) {
                this.showFieldNotice('選択が変わったため再試行を取り消しました。');
                return;
            }
            this.focusField({ tabId: 'edit', sectionId: 'generation' });
            if (this.generationStates.get(identity.key) !== 'failed') {
                this.showFieldNotice('このクリップは再試行できる失敗状態ではありません。');
                return;
            }
            const result = await this.confirmAndStartGeneration(identity);
            if (!result.ok) this.showFieldNotice(result.message ?? '再試行できませんでした。');
        } catch (error) {
            this.showFieldNotice(`再試行を開けませんでした: ${String(error)}`);
        } finally { this.generationRetryPending = false; }
    }


    protected activeTabId(): string | undefined {
        const active = this.body.querySelector<HTMLElement>('.akari-inspector-tab.is-active');
        const marker = active?.getAttribute('data-akari-ui');
        const prefix = 'tab:inspector-';
        return marker?.startsWith(prefix) ? marker.slice(prefix.length) : undefined;
    }

    protected clearSolo(): boolean {
        if (!this.solo) return false;
        this.solo = undefined;
        this.soloSelectionKey = undefined;
        return true;
    }

    protected clearSoloForSelectionChange(): void {
        if (this.solo && this.soloSelectionKey !== this.currentSelectionKey()) this.clearSolo();
    }

    protected currentSelectionKey(): string | undefined {
        const snapshot = this.model.snapshot;
        if (!snapshot) return undefined;
        if (snapshot.kind === 'gap') return `gap:${snapshot.trackId}:${snapshot.startSeconds}:${snapshot.endSeconds}`;
        const itemKey = (item: InspectorSnapshot): string => item.kind === 'cut'
            ? `cut:${item.itemId ?? item.index}` : `${item.kind}:${item.id}`;
        const selectionKey = snapshot.kind === 'multi'
            ? `multi:${snapshot.items.map(itemKey).join('|')}`
            : snapshot.kind === 'world'
                ? snapshot.stop ? `world-stop:${snapshot.stop.id}` : snapshot.edge ? `world-edge:${snapshot.edge.id}` : 'world'
                : itemKey(snapshot);
        const keyframe = this.model.keyframeSelection;
        return keyframe
            ? `${selectionKey}:keyframe:${keyframe.itemId}:${keyframe.property}:${keyframe.times.join(',')}`
            : selectionKey;
    }

    pulseField(fieldName: string): boolean {
        const fieldElement = this.body.querySelector(`[data-akari-field="${fieldName}"]`);
        if (!fieldElement) return false;
        this.pulse(fieldElement as HTMLElement);
        return true;
    }

    protected pulse(element: HTMLElement): void {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
        element.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        const className = reduced ? 'akari-inspector-focus-pulse-reduced' : 'akari-inspector-focus-pulse';
        element.classList.add(className);
        window.setTimeout(() => element.classList.remove(className), 1600);
    }

    protected renderGapSelection(snapshot: TimelineGapSelection): void {
        const panel = document.createElement('section');
        panel.className = 'akari-inspector-generation-gap';
        const title = document.createElement('h3');
        title.textContent = `すき間 · ${(snapshot.endSeconds - snapshot.startSeconds).toFixed(1)} 秒`;
        const range = document.createElement('p');
        range.textContent = `${snapshot.startSeconds.toFixed(2)} → ${snapshot.endSeconds.toFixed(2)} 秒`;
        const ends = document.createElement('div');
        ends.className = 'akari-inspector-generation-gap-ends';
        for (const [label, endpoint] of [['最初', snapshot.previous], ['最後', snapshot.next]] as const) {
            const end = document.createElement('div');
            end.className = 'akari-inspector-generation-gap-end';
            const name = document.createElement('span');
            name.textContent = `${label} = ${endpoint?.label ?? '絵なし'}`;
            end.appendChild(name);
            if (endpoint) {
                const img = document.createElement('img');
                img.alt = `${label}の絵`;
                end.appendChild(img);
                const root = this.workspaceService.tryGetRoots()[0]?.resource;
                if (root) void this.layerAudioService.getClipThumbnail({ projectRootUri: root.toString(),
                    videoUri: root.resolve(endpoint.sourcePath).toString(), atSeconds: endpoint.atSeconds
                }).then(result => {
                    if (this.model.snapshot !== snapshot) return;
                    if (result.dataUri) img.src = result.dataUri;
                    else img.alt = 'コマを表示できません';
                }).catch(() => { img.alt = 'コマを表示できません'; });
            } else {
                const note = document.createElement('span');
                note.textContent = 'この端には画像・動画がないため、枠を空にします。';
                end.appendChild(note);
            }
            ends.appendChild(end);
        }
        panel.append(title, range, ends);
        if (!this.aiCatalogLoaded) void this.loadAiCatalog();
        appendAiTiles(panel, describeAiTiles(aiActionCatalog(this.generationCatalog), 'gap'), id => {
            if ((id !== 'still' && id !== 'video') || this.gapAiOpening || this.model.snapshot !== snapshot) return;
            const opening: { gap: TimelineGapSelection; view: 'still' | 'video' } = { gap: snapshot, view: id };
            this.gapAiOpening = opening;
            void snapshot.createFrame().catch(() => undefined).finally(() => {
                if (this.gapAiOpening !== opening || this.matchesGapAiFrame(this.model.snapshot, snapshot)) return;
                if (this.model.snapshot && this.model.snapshot.kind !== 'gap') {
                    this.gapAiOpening = undefined;
                    return;
                }
                // Selection can follow the resolved command; allow it to arrive before treating this as a failed insert.
                setTimeout(() => {
                    if (this.gapAiOpening === opening && !this.matchesGapAiFrame(this.model.snapshot, snapshot)) {
                        this.gapAiOpening = undefined;
                    }
                }, 5000);
            });
        });
        this.body.appendChild(panel);
    }

    protected matchesGapAiFrame(selection: TimelineSelectionModel['snapshot'], gap: TimelineGapSelection): boolean {
        if (!selection || (selection.kind !== 'cut' && selection.kind !== 'layer' && selection.kind !== 'item')) return false;
        const id = selection.kind === 'cut' ? selection.itemId : selection.id;
        if (!id?.startsWith('gap-')) return false;
        const source = selection.kind === 'cut' ? selection.sourcePath : selection.src;
        // Tree items carry a source ID rather than a path. commitGapFrame pairs gap-N with gap-src-N.
        const generated = source?.startsWith('assets/generated/')
            || (selection.kind === 'item' && selection.sourceKind === 'media'
                && source === `gap-src-${id.slice('gap-'.length)}`);
        if (!generated || (selection.kind === 'item' && selection.trackId !== gap.trackId)) return false;
        const end = selection.kind === 'cut' ? selection.outputEnd : selection.outputStart + selection.duration;
        return Math.abs(selection.outputStart - gap.startSeconds) < 0.001
            && Math.abs(end - gap.endSeconds) < 0.001;
    }

    selectMaterial(selection: AkariMaterialSelection): void {
        this.materialSelection = selection;
        this.materialTab = 'generation';
        this.aiView = 'tiles';
        this.transcribeKey = JSON.stringify([selection.projectRoot, selection.relativePath]);
        this.transcribeSummary = { state: 'none', segments: [], total: 0 };
        this.transcribeRunning = false;
        this.transcribePolling = false;
        this.transcribeEngines = undefined;
        this.transcribeEngineError = undefined;
        this.transcribeSelectedBackend = undefined;
        this.transcribeRedo = false;
        this.transcribeEngineLoading = false;
        this.transcribeMediaDuration = undefined;
        this.transcribeDurationLookupKey = undefined;
        if (selection.mediaKind === 'image' && !this.generationDrafts?.has(`material:${selection.relativePath}`)) {
            this.materialGenerationStatus?.set(`material:${selection.relativePath}`, { state: 'loading' });
        }
        this.render();
        if (selection.mediaKind === 'image') {
            const identity = { key: `material:${selection.relativePath}`, itemId: `material:${selection.relativePath}`,
                sourcePath: selection.relativePath, duration: 5 };
            if (!this.generationLoads?.has(identity.key)) void this.loadGeneration?.(identity);
        }
        if (selection.mediaKind !== 'audio' && selection.mediaKind !== 'video') return;
        void this.layerAudioService.readTranscriptSummary({
            projectRootUri: selection.projectRoot, relativePath: selection.relativePath
        }).then(summary => {
            if (this.materialSelection !== selection || this.isDisposed) return;
            this.transcribeSummary = summary;
            this.render();
        }).catch(() => undefined);
    }

    protected viewSelectionKey(): string | undefined {
        const workspace = this.workspaceService.tryGetRoots()[0]?.resource.toString() ?? '';
        const id = this.liveSelectionId();
        return id ? `${workspace}:${id}` : this.currentSelectionKey()?.replace(/:keyframe:.*$/u, '');
    }

    protected rememberFocus(active: Element): void {
        const field = active.closest('[data-akari-ui^="field:inspector-"], [data-akari-field]');
        const fieldName = field?.getAttribute('data-akari-ui') ?? field?.getAttribute('data-akari-field');
        if (!fieldName) return;
        const controls = Array.from(field.querySelectorAll('input, textarea, select, button'));
        const focusPart = controls.indexOf(active);
        if (focusPart < 0) return;
        const input = (typeof HTMLInputElement !== 'undefined' && active instanceof HTMLInputElement)
            || (typeof HTMLTextAreaElement !== 'undefined' && active instanceof HTMLTextAreaElement) ? active : undefined;
        this.rememberedView = { ...this.rememberedView, focusField: fieldName, focusPart,
            selectionStart: undefined, selectionEnd: undefined, inputValue: undefined,
            ...(input && input.selectionStart !== null ? { selectionStart: input.selectionStart,
                selectionEnd: input.selectionEnd ?? input.selectionStart } : {}),
            ...(input?.dataset.akariInspectorDirty === 'true' ? { inputValue: input.value } : {}) };
    }

    protected render(): void {
        if (this.previewedVideoCandidate && (this.aiView !== 'video'
            || shouldClearVideoCandidatePreview(this.previewedVideoCandidate.itemId,
                this.generationIdentity?.(this.model.snapshot)?.itemId))) {
            this.clearVideoCandidatePreview();
        }
        const forceEmpty = this.forceEmptyRender;
        this.forceEmptyRender = false;
        const selectionKey = this.viewSelectionKey();
        if (shouldDeferInspectorEmpty(selectionKey, this.renderedSelectionKey, !!this.materialSelection, forceEmpty)) {
            if (this.pendingEmptyRender === undefined) this.pendingEmptyRender = setTimeout(() => {
                this.pendingEmptyRender = undefined;
                if (!this.viewSelectionKey()) { this.forceEmptyRender = true; this.render(); }
            }, 80);
            return;
        }
        if (selectionKey && this.pendingEmptyRender !== undefined) {
            clearTimeout(this.pendingEmptyRender);
            this.pendingEmptyRender = undefined;
        }
        const isTextInput = (element: Element | null | undefined): element is HTMLInputElement | HTMLTextAreaElement =>
            typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement
            || typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement;
        const active = this.node.contains?.(document.activeElement) ? document.activeElement : null;
        this.rememberedView = focusForInspectorRender(this.rememberedView, !!active,
            this.pendingTabFocus, this.restoringView);
        if (active && !this.pendingTabFocus && !this.suppressFocusRestore) this.rememberFocus(active);
        const sameSelection = selectionKey !== undefined && this.lastRealSelectionKey === selectionKey;
        const view = selectionKey
            ? viewForInspectorSelection(this.rememberedView, selectionKey, this.lastRealSelectionKey)
            : this.rememberedView;
        const stillRunning = this.aiView === 'still' && [...this.aiStillStates.values()].some(state => state.running);
        view.scrollTop = stillRunning && sameSelection ? this.node.scrollTop
            : rememberedInspectorScroll(view.scrollTop, this.node.scrollTop,
                sameSelection, this.restoringView, this.lastScrollIntentAt > this.latestRenderAt);
        if (sameSelection) view.tabId = this.activeTabId() ?? view.tabId;
        this.rememberedView = view;
        this.renderedSelectionKey = selectionKey;
        if (selectionKey) this.lastRealSelectionKey = selectionKey;
        if (view.tabId && !this.explicitTabId) this.currentTab = view.tabId;
        if (this.bodyHeldHeight === 0) this.bodyMinHeightBeforeRestore = this.body.style.minHeight;
        this.bodyHeldHeight = inspectorHeldHeight(this.bodyHeldHeight, this.node.scrollHeight || 0,
            this.body.getBoundingClientRect?.().height ?? 0, this.node.clientHeight || 0, view.scrollTop);
        this.body.style.minHeight = `${this.bodyHeldHeight}px`;
        this.restoringView = true;
        this.latestRenderAt = Date.now();
        this.ignoreScrollUntil = this.latestRenderAt + 300;
        this.renderContent();
        const revision = ++this.viewRestoreRevision;
        const restore = (focus = true): void => {
            if (revision !== this.viewRestoreRevision || this.viewSelectionKey() !== selectionKey) return;
            this.node.scrollTop = this.rememberedView.scrollTop;
            const focusView = this.rememberedView;
            if (focus && !this.suppressFocusRestore && focusView.focusField && focusView.focusPart !== undefined) {
                const restored = Array.from(this.body.querySelectorAll('[data-akari-ui^="field:inspector-"], [data-akari-field]'))
                    .find(element => (element.getAttribute('data-akari-ui') ?? element.getAttribute('data-akari-field')) === focusView.focusField);
                const control = restored?.querySelectorAll<HTMLElement>('input, textarea, select, button')[focusView.focusPart];
                if (isTextInput(control) && focusView.inputValue !== undefined) {
                    control.value = focusView.inputValue;
                    control.dataset.akariInspectorDirty = 'true';
                }
                control?.focus({ preventScroll: true });
                if (isTextInput(control) && focusView.selectionStart !== undefined) {
                    control.setSelectionRange(focusView.selectionStart, focusView.selectionEnd ?? focusView.selectionStart);
                }
                if (control instanceof Element) this.rememberFocus(control);
            }
        };
        restore(!this.pendingTabFocus);
        const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback: FrameRequestCallback) =>
            setTimeout(() => callback(0), 0);
        const pinUntil = this.ignoreScrollUntil + 150;
        const pin = (): void => {
            if (revision !== this.viewRestoreRevision || Date.now() > pinUntil) return;
            const pinned = inspectorScrollPin(this.rememberedView.scrollTop, this.node.scrollTop,
                this.lastScrollIntentAt, this.latestRenderAt);
            if (pinned !== undefined) this.node.scrollTop = pinned;
            schedule(pin);
        };
        if (typeof requestAnimationFrame === 'function') schedule(pin);
        schedule(() => schedule(() => {
            restore();
            if (revision === this.viewRestoreRevision) {
                this.restoringView = false;
                this.pendingTabFocus = false;
                setTimeout(() => {
                    if (revision !== this.viewRestoreRevision) return;
                    this.body.style.minHeight = this.bodyMinHeightBeforeRestore ?? '';
                    this.bodyHeldHeight = 0;
                    this.ignoreScrollUntil = Date.now() + 100;
                    restore(false);
                }, 250);
            }
        }));
        this.paintLiveValues();
    }

    protected paintLiveValues(): void {
        if (!this.liveValues || this.liveSelectionId() !== this.liveValues.id) return;
        const values = { ...this.liveValues.values };
        if (this.model.snapshot?.kind === 'item' && Number.isFinite(values.scaleX) && Number.isFinite(values.scaleY)) {
            values.scale = Math.sqrt(values.scaleX * values.scaleY);
        }
        for (const [name, raw] of Object.entries(values)) {
            const field = this.body.querySelector(`[data-akari-field="transform-${name}"]`);
            const input = field?.querySelector<HTMLInputElement>('.akari-inspector-number-input');
            if (!input || document.activeElement === input) continue;
            input.value = String(name.startsWith('scale') ? Math.round(raw * 1000) / 10 : Math.round(raw * 100) / 100);
        }
    }

    protected renderContent(): void {
        if (this.transcribeTimer) clearInterval(this.transcribeTimer);
        this.transcribeTimer = undefined;
        this.dispatchCaptionZoneEvent(CAPTION_ZONE_HOVER_EVENT, null);
        this.body.replaceChildren();
        this.hideFieldNotice();
        if (this.materialSelection) {
            const materialSelection = this.materialSelection;
            this.syncAdjustCompare(undefined, '');
            appendAiMaterialView(this.body, {
                selection: materialSelection, tab: this.materialTab, view: this.aiView ?? 'tiles',
                summary: this.transcribeSummary, running: this.transcribeRunning, commands: this.commandRegistry,
                onTab: tab => { this.materialTab = tab; this.render(); },
                onView: view => { this.aiView = view; this.transcribePolling = false; this.render(); },
                createdPath: this.materialCreated?.get(materialSelection.relativePath),
                onVideoForm: () => {
                    const key = `material:${materialSelection.relativePath}`;
                    const snapshot = { kind: 'cut', itemId: key, sourcePath: materialSelection.relativePath,
                        outputStart: 0, outputEnd: this.generationDrafts.get(key)?.output.duration_s ?? 5 } as unknown as TimelineCutSelection;
                    const fields = this.generationSectionFields(snapshot);
                    const currentImageAction = fields?.flatMap(field => (field as GenerationFieldDef<TimelineCutSelection>).generationChildren ?? [field])
                        .find(field => field.name === 'first-frame')?.actions?.find(action => action.name === 'current');
                    if (currentImageAction) {
                        currentImageAction.label = 'この素材の絵';
                        currentImageAction.title = 'この素材の絵';
                    }
                    if (fields) this.appendSection({ id: 'generation', label: '動画にする', fields }, snapshot, 'cut');
                    else {
                        const status = document.createElement('p');
                        status.className = 'akari-inspector-ai-material-status';
                        const state = this.materialGenerationStatus?.get(key);
                        status.textContent = state?.state === 'error' ? state.reason ?? 'フォームを読み込めませんでした。' : '読み込み中';
                        this.body.appendChild(status);
                    }
                },
                onDialogResult: result => {
                    if (this.materialSelection !== materialSelection) return;
                    this.transcribeRunning = result === 'running';
                    this.transcribePolling = result === 'opened' || result === 'running';
                    this.render();
                }
            });
            this.renderMaterialTranscribeEngines?.(materialSelection);
            if (this.transcribePolling && this.materialTab === 'generation' && this.aiView === 'transcribe') {
                const selection = materialSelection;
                this.transcribeTimer = setInterval(() => {
                    if (this.isDisposed || this.materialSelection !== selection || this.aiView !== 'transcribe') {
                        if (this.transcribeTimer) clearInterval(this.transcribeTimer);
                        this.transcribeTimer = undefined;
                        return;
                    }
                    void this.layerAudioService.readTranscriptSummary({
                        projectRootUri: selection.projectRoot, relativePath: selection.relativePath
                    }).then(summary => {
                        if (this.materialSelection !== selection || summary.state !== 'done') return;
                        this.transcribeSummary = summary;
                        this.transcribeRunning = false;
                        this.transcribePolling = false;
                        this.render();
                    }).catch(() => undefined);
                }, 5000);
            }
            return;
        }
        const snapshot = this.model.snapshot;
        if (this.generationFramePick || this.generationFramePickMessage) this.syncGenerationFramePick();
        if (!snapshot || snapshot.kind === 'multi') this.syncAdjustCompare(undefined, '');
        if (!snapshot) {
            this.colorPanelHostInstance?.keepFor(undefined);
            this.tabSelectionKey = undefined;
            this.currentTab = undefined;
            this.explicitTabId = undefined;
            const empty = document.createElement('div');
            empty.className = 'akari-inspector-empty';
            empty.textContent = 'タイムラインで項目を選択してください。';
            this.body.appendChild(empty);
            return;
        }
        this.body.appendChild(createSelectionHeader(snapshot, path => this.generationThumbnail(path),
            () => window.dispatchEvent(new CustomEvent('akari.mystyle.open-save'))));
        const panelCaptionId = snapshot.kind === 'caption' ? snapshot.id
            : snapshot.kind === 'item' && snapshot.itemKind === 'caption'
                ? this.model.selectedCaptionIds[0] ?? captionIdForTreeSelection(snapshot) : undefined;
        if (this.captionPanel && panelCaptionId) {
            this.body.append(createCaptionPanel(document, this.captionPanel, this.captionPanelState,
                this.captionPanelMyStyles, this.captionPanelFontFaces, {
                    close: () => this.closeCaptionPanel(),
                    switchTo: panel => {
                        if (this.captionPanel === panel) return;
                        this.runCaptionPanelPreview({ type: 'leave' });
                        this.captionPanel = panel; this.notifyCaptionPanel(); this.render();
                    },
                    font: (family, weight, id) => {
                        const request = captionPanelFontWrite(panelCaptionId, family, weight);
                        void this.commitWrite(request).then(result => {
                                if (result.ok && id) this.captionPanelState.recentFonts = [id,
                                    ...this.captionPanelState.recentFonts.filter(other => other !== id)].slice(0, 8);
                            });
                    },
                    style: (style, id) => {
                        const request = { ...captionPanelLookWrite(panelCaptionId, style),
                            libraryApplyKind: id.startsWith('mystyle/') ? 'mystyle' as const : 'textstyle' as const };
                        void this.commitWrite(request).then(result => {
                                if (result.ok) this.captionPanelState.recentStyles = [id,
                                    ...this.captionPanelState.recentStyles.filter(other => other !== id)].slice(0, 8);
                            });
                    },
                    save: () => window.dispatchEvent(new CustomEvent('akari.mystyle.open-save',
                        { detail: { captionId: panelCaptionId } })),
                    openLibrary: () => { void this.commandRegistry.executeCommand('akari.catalog.open',
                        { tab: 'library', category: 'font' }); },
                    rerender: () => { this.runCaptionPanelPreview({ type: 'leave' }); this.render(); },
                    preview: textStyle => this.runCaptionPanelPreview(textStyle
                        ? { type: 'enter', captionId: panelCaptionId, textStyle } : { type: 'leave' }),
                    confirm: () => { this.runCaptionPanelPreview({ type: 'confirm', captionId: panelCaptionId }); },
                    escape: () => {
                        if (this.runCaptionPanelPreview({ type: 'escape' }).close) this.closeCaptionPanel();
                    }
                }));
            return;
        }
        if (snapshot.kind === 'gap') {
            if (this.gapAiOpening && (this.gapAiOpening.gap.trackId !== snapshot.trackId
                || this.gapAiOpening.gap.startSeconds !== snapshot.startSeconds
                || this.gapAiOpening.gap.endSeconds !== snapshot.endSeconds)) this.gapAiOpening = undefined;
            this.tabSelectionKey = undefined;
            this.currentTab = undefined;
            this.explicitTabId = undefined;
            this.syncAdjustCompare(undefined, '');
            this.renderGapSelection(snapshot);
            return;
        }
        if (snapshot.kind === 'world') {
            this.tabSelectionKey = undefined;
            this.currentTab = undefined;
            this.renderWorldSelection(snapshot);
            this.explicitTabId = undefined;
            return;
        }

        if (this.generationVideoPaths) this.observeGenerationVideo(snapshot);
        const generationIdentity = this.generationIdentity(snapshot);
        if (generationIdentity && this.frameAspectLive && this.frameAspectTried) {
            let live = this.frameAspectLive.get(generationIdentity.key);
            const changed = live?.observeSource(generationIdentity.sourcePath) ?? false;
            if (!live) this.frameAspectLive.set(generationIdentity.key, live = new FrameAspectLive(generationIdentity.sourcePath));
            if (changed) {
                this.generationTabMeta.delete(generationIdentity.key);
                this.generationLoads.delete(generationIdentity.key);
                this.generationStates.delete(generationIdentity.key);
            }
            if (!live.sourceSize && /^assets\/generated\/[^/]+\.png$/u.test(generationIdentity.sourcePath)
                && this.frameAspectTried.get(generationIdentity.key) !== generationIdentity.sourcePath) {
                this.frameAspectTried.set(generationIdentity.key, generationIdentity.sourcePath);
                void this.ensureFrameSourceSize?.(generationIdentity.key, generationIdentity.sourcePath);
            }
        }
        if (!generationIdentity && (snapshot.kind === 'cut' || snapshot.kind === 'layer' || snapshot.kind === 'item' || snapshot.kind === 'audio')) {
            // The existing test harness transpiles render without this new loader method.
            void this.loadAiCatalog?.();
        }
        if (generationIdentity && !this.generationLoads.has(generationIdentity.key)) {
            void this.loadGeneration(generationIdentity);
        }
        const generationDraft = generationIdentity ? this.generationDrafts.get(generationIdentity.key) : undefined;
        if (generationIdentity && generationDraft && this.generationTabDrafts.get(generationIdentity.key) !== generationDraft) {
            // The existing loader replaces the draft on sidecar changes. Read next
            // alongside that revision without changing the generation field methods.
            this.generationTabDrafts.set(generationIdentity.key, generationDraft);
            this.generationTabLoads.add(generationIdentity.key);
            void (async () => {
                try {
                    await this.workspaceService.ready;
                    const root = this.workspaceService.tryGetRoots()[0]?.resource;
                    if (!root) return;
                    const sidecars = await this.layerAudioService.readGenerationSidecars({
                        projectRootUri: root.toString(), ...activeEditRequest(root), sourcePaths: [generationIdentity.sourcePath]
                    });
                    // next belongs to the source's own sidecar, including kind: still.
                    // The generation selector may only return a related video job.
                    const meta = sidecars.entries.find(entry => entry.sourcePath === generationIdentity.sourcePath)?.meta
                        ?? selectGenerationSidecarForSource(generationIdentity.sourcePath, sidecars.entries, Date.now())?.meta;
                    if (this.generationTabDrafts.get(generationIdentity.key) === generationDraft
                        && this.generationIdentity(this.model.snapshot)?.sourcePath === generationIdentity.sourcePath) {
                        this.generationTabMeta.set(generationIdentity.key, (meta as { next?: { status?: unknown } } | undefined) ?? {});
                    }
                } catch (error) {
                    this.showFieldNotice(String(error));
                } finally {
                    if (this.generationTabDrafts.get(generationIdentity.key) === generationDraft) {
                        this.generationTabLoads.delete(generationIdentity.key);
                        if (this.generationIdentity(this.model.snapshot)?.key === generationIdentity.key) this.render();
                    }
                }
            })();
        }

        const requestWrite = (request: InspectorWriteRequest): Promise<InspectorWriteResult> =>
            this.commitWrite(request);

        let sections: InspectorSection[];
        let rowSnapshot: InspectorSnapshot;
        let sectionKind: 'cut' | 'layer' | 'caption' | 'audio' | 'overlay' | 'item';
        const openMotion = (): void => {
            this.explicitTabId = 'motion';
            this.tabState.setActiveTab(sectionKind, 'motion');
            this.render();
        };
        if (snapshot.kind === 'multi') {
            const captions = snapshot.items.filter(
                (item): item is TimelineCaptionSelection => item.kind === 'caption'
            );
            if (captions.length !== snapshot.items.length || captions.length === 0) {
                this.tabSelectionKey = undefined;
                this.currentTab = undefined;
                this.explicitTabId = undefined;
                this.renderGenerationBatch?.(snapshot.items);
                return;
            }
            sections = MULTI_CAPTION_SECTIONS(captions, requestWrite, {
                zoneHover: zone => this.dispatchCaptionZoneEvent(CAPTION_ZONE_HOVER_EVENT, zone),
                zonePreset: zone => this.dispatchCaptionZoneEvent(CAPTION_ZONE_PRESET_EVENT, zone)
            });
            rowSnapshot = captions[0];
            sectionKind = 'caption';
        } else {
            rowSnapshot = snapshot;
            sectionKind = snapshot.kind;
            switch (snapshot.kind) {
                case 'cut':
                    sections = CUT_SECTIONS(snapshot, requestWrite, this.generationSectionFields(snapshot), openMotion);
                    break;
                case 'layer':
                    if (snapshot.layerKind === 'video' && !layerAudioControls.has(snapshot)) {
                        layerAudioControls.set(snapshot, null);
                        void (async () => {
                            await this.workspaceService.ready;
                            const root = this.workspaceService.tryGetRoots()[0]?.resource;
                            if (!root) return;
                            const uri = currentTimelineEditUri(root);
                            const store = await import('@akari-video/edit-store');
                            const read = async () => {
                                const text = (await this.fileService.readFile(uri)).value.toString();
                                const doc = JSON.parse(text) as import('@akari-video/edit-store').EditableEditV2;
                                store.readEditV2(doc);
                                store.attachEditHelpers(doc);
                                const item = doc.find(snapshot.id);
                                if (!item || item.source?.kind !== 'media') throw new Error('動画クリップが見つかりません。');
                                return { doc, item };
                            };
                            const { item } = await read();
                            const source = item.source as { mute?: boolean; gain_db?: number };
                            const controls: LayerAudioControls = {
                                audio: !('audio' in item && item.audio === false) && source.mute !== true,
                                detached: 'audio' in item && item.audio === false,
                                gain_db: source.gain_db ?? 0,
                                write: async (field, value) => {
                                    try {
                                        // Use the existing edit-store item mutator and atomic/lint service.
                                        const { doc } = await read();
                                        store.updateItem(doc, snapshot.id, field === 'audio'
                                            ? { source: { mute: value !== true } }
                                            : { source: { gain_db: value } });
                                        await this.layerAudioService.writeEditSnapshot({
                                            editUri: uri.toString(), projectRootUri: root.toString(),
                                            editSource: store.serializeEdit(doc)
                                        });
                                        if (field === 'audio') controls.audio = value === true;
                                        else controls.gain_db = Number(value);
                                        this.render();
                                        return { ok: true };
                                    } catch (error) {
                                        return { ok: false, message: String(error) };
                                    }
                                }
                            };
                            layerAudioControls.set(snapshot, controls);
                            if (this.model.snapshot === snapshot) this.render();
                        })().catch(error => this.showFieldNotice(String(error)));
                    }
                    sections = LAYER_SECTIONS(
                        snapshot, requestWrite, layerAudioControls.get(snapshot), this.generationSectionFields(snapshot), openMotion
                    );
                    break;
                case 'caption':
                    sections = CAPTION_SECTIONS(snapshot, requestWrite, {
                        zoneHover: zone => this.dispatchCaptionZoneEvent(CAPTION_ZONE_HOVER_EVENT, zone),
                        zonePreset: zone => this.dispatchCaptionZoneEvent(CAPTION_ZONE_PRESET_EVENT, zone),
                        motionServices: this.captionMotionServices(snapshot)
                    });
                    break;
                case 'audio':
                    sections = AUDIO_SECTIONS(snapshot as AudioInspectorSnapshot, request => this.commitWrite(request));
                    break;
                case 'overlay':
                    this.ensureCaptionRowFontFace();
                    sections = OVERLAY_SECTIONS(snapshot, requestWrite, this.overlayKnobs(snapshot), openMotion,
                        this.captionPanelFontFaces);
                    break;
                case 'item':
                    sections = TREE_ITEM_SECTIONS(snapshot, requestWrite, openMotion,
                        request => this.model.requestLivePreview?.(request));
                    break;
            }
            if (snapshot.kind === 'item' && snapshot.sourceKind === 'media'
                && this.generationDone?.get(snapshot.id)?.meta) {
                const fields = this.generationSectionFields(snapshot);
                if (fields) sections = [...sections, { id: GENERATION_SECTION_ID, label: '生成', fields }];
            }
        }
        if (sectionKind === 'caption') {
            const fontField = captionFontFamilyField(rowSnapshot as TimelineCaptionSelection,
                () => this.commandRegistry.executeCommand<boolean>('akari.captionPanel.toggle', { panel: 'font' }));
            sections = sections.map(section => section.id === 'style'
                ? { ...section, fields: [fontField, ...section.fields] } : section);
        }
        // 色パネル（色の行・akari.inspector.openColorPanel）: 開いている間は同じ列の中身を色パネルにする。
        if (this.colorPanelHostInstance?.isOpen && this.renderColorPanelMode(sections, rowSnapshot)) return;
        const generationState = generationIdentity ? this.generationStates.get(generationIdentity.key) : undefined;
        const generationDone = !!generationIdentity && this.generationDone?.has(generationIdentity.key) === true;
        const transcribeKey = JSON.stringify([
            this.workspaceService.tryGetRoots()[0]?.resource.toString() ?? '', sectionKind,
            rowSnapshot.kind === 'cut' ? rowSnapshot.itemId ?? rowSnapshot.index : rowSnapshot.id,
            rowSnapshot.kind === 'audio' ? rowSnapshot.label : undefined
        ]);
        if (this.transcribeKey !== transcribeKey) {
            this.narrationSourceCheckVersion = (this.narrationSourceCheckVersion ?? 0) + 1;
            this.narrationLoadRevision = (this.narrationLoadRevision ?? 0) + 1;
            if (this.transcribeKey !== undefined && rowSnapshot.kind === 'audio') {
                this.narrationPlacementNotice = undefined;
                const state = this.narrationStates?.get(this.aiViewClipKey ?? '');
                if (state) state.placement = undefined;
            }
            this.transcribeKey = transcribeKey;
            this.transcribeTarget = undefined;
            this.transcribeSummary = { state: 'none', segments: [], total: 0 };
            this.transcribeRunning = false;
            this.transcribePolling = false;
            this.transcribeEngines = undefined;
            this.transcribeEngineError = undefined;
            this.transcribeSelectedBackend = undefined;
            this.transcribeRedo = false;
            this.transcribeEngineLoading = false;
            this.transcribeMediaDuration = undefined;
            this.transcribeDurationLookupKey = undefined;
            this.audioPlanned = false;
            this.narrationSourcePath = undefined;
            this.narrationVerified = undefined;
            this.narrationPlacementContext = undefined;
            this.transcribeLoading = undefined;
        }
        if (['cut', 'layer', 'item', 'audio'].includes(sectionKind) && !this.transcribeLoading) {
            void this.loadAiTranscribeTarget?.(rowSnapshot, transcribeKey);
        }
        if (rowSnapshot.kind === 'audio' && this.narrationSourcePath) {
            void this.verifyAiNarrationSource?.(rowSnapshot, transcribeKey);
        }
        // Older render harnesses instantiate only extracted methods and have no AI catalog state.
        const photoSelection = (rowSnapshot.kind === 'layer' || rowSnapshot.kind === 'item' || rowSnapshot.kind === 'cut')
            && (rowSnapshot.photo === true || isInspectorStillImage(rowSnapshot.sourcePath ?? rowSnapshot.src));
        const photoTools = photoToolAvailabilityFor({ photo: photoSelection,
            emptyFrame: !!generationIdentity && !generationDone && generationState === 'planned', generationState });
        if (!photoTools.enabled) {
            const photoAppearanceNames = new Set(['photo-flip-h', 'photo-flip-v', 'photo-crop-open',
                'photo-frame-width', 'photo-frame-color', 'photo-frame-radius']);
            sections = sections.map(section => section.id === 'appearance'
                ? { ...section, fields: section.fields.filter(field => !photoAppearanceNames.has(field.name)) }
                : section);
        }
        const aiGroups = this.aiCatalogLoaded === undefined || rowSnapshot.kind === 'overlay'
            || rowSnapshot.kind === 'item' && rowSnapshot.sourceKind !== 'media'
            || rowSnapshot.kind === 'layer' && rowSnapshot.sourceKind === 'html' ? [] : describeAiTiles(
            aiActionCatalog(this.generationCatalog, this.narrationEngines),
            aiTargetKindFor({ hasIdentity: !!generationIdentity, generationDone, generationState,
                audio: sectionKind === 'audio', audioPlanned: this.audioPlanned })
        ).map(group => ({ ...group, tiles: group.tiles.map(tile =>
            tile.id === 'cutout' || tile.id === 'eraser'
                ? { ...tile, ...photoTools, ...(!photoTools.enabled ? { reason: photoTools.reason } : { reason: undefined }) }
                : tile) }));
        const aiAvailability = this.aiCatalogLoaded === undefined
            ? { enabled: !!generationIdentity, forcePanel: false }
            : aiTabAvailabilityFor({ kind: sectionKind, hasIdentity: !!generationIdentity, groups: aiGroups });
        const tabs = tabsForKind(sectionKind, {
            src: this.tabSourceHint(rowSnapshot), generationAvailable: aiAvailability.enabled || photoSelection
        });
        const meta = generationIdentity ? this.generationTabMeta.get(generationIdentity.key) as {
            kind?: string; job?: { provider?: string; routes?: string[]; candidates?: number;
                results?: Array<{ ok?: boolean; path?: string }> };
            inputs?: { extra?: { still_batch?: unknown } }; stillCandidateCount?: number;
            next?: { status?: unknown }
        } | undefined : undefined;
        const generationKind = typeof aiGenerationKindFor === 'function'
            ? aiGenerationKindFor(meta) : meta?.kind === 'still' ? 'still' : 'video';
        const stillCandidateCount = Math.max(meta?.stillCandidateCount ?? 0,
            meta?.job?.candidates ?? 0,
            meta?.job?.results?.filter(result => result.ok && result.path).length ?? 0,
            generationIdentity ? this.aiStillStates?.get(generationIdentity.key)?.batch?.candidates.filter(row => row.ok).length ?? 0 : 0);
        const generationTodo = !!generationIdentity && (
            ['planned', 'generating', 'stale', 'failed'].includes(generationState ?? '') || meta?.next?.status === 'planned'
        );
        // Item identity survives source replacement and edits to time/transform.
        // Include workspace and kind to avoid collisions across projects or selections.
        const clipKey = JSON.stringify([
            this.workspaceService.tryGetRoots()[0]?.resource.toString() ?? '', sectionKind,
            snapshot.kind === 'multi' ? snapshot.items.map(item => item.kind === 'cut' ? item.itemId ?? item.index : item.id)
                : rowSnapshot.kind === 'cut' ? rowSnapshot.itemId ?? rowSnapshot.index : rowSnapshot.id
        ]);
        const gapAiOpening = this.gapAiOpening;
        const opensGapFrame = !!gapAiOpening && this.matchesGapAiFrame(rowSnapshot, gapAiOpening.gap);
        if (gapAiOpening && !opensGapFrame) this.gapAiOpening = undefined;
        const stillNotice = this.aiStillStates?.size
            ? stillMismatchNotice(this.aiStillStates, generationIdentity?.key, this.aiStillSelectionClipKey, clipKey)
            : undefined;
        this.aiStillSelectionClipKey = clipKey;
        const activeTab = initialTabFor({
            kind: sectionKind, tabs, persisted: this.tabState.activeTab(sectionKind, tabs), generationTodo,
            explicitTabId: opensGapFrame ? 'edit' : this.explicitTabId,
            clipKey, previousClipKey: this.tabSelectionKey, currentTab: this.currentTab
        });
        if (this.explicitTabId || !generationIdentity || (this.generationStates.has(generationIdentity.key)
            && !this.generationTabLoads.has(generationIdentity.key))) {
            this.tabSelectionKey = clipKey;
            this.currentTab = activeTab;
        }
        this.explicitTabId = undefined;
        if (this.generationFramePick) this.syncGenerationFramePick(activeTab);
        const compareTarget: LivePreviewTarget | undefined = rowSnapshot.kind === 'caption' || rowSnapshot.kind === 'audio'
            ? undefined : rowSnapshot.kind === 'cut' ? { kind: 'cut', index: rowSnapshot.index }
                : { kind: 'item', id: rowSnapshot.id };
        this.syncAdjustCompare(compareTarget, activeTab);
        this.appendTabStrip(sectionKind, tabs, activeTab, generationTodo, aiGroups.flatMap(group => group.tiles)
            .filter(tile => tile.enabled).map(tile => tile.id as AiTabView));

        if (activeTab === 'edit') {
            if (this.aiCatalogLoaded) {
                if (this.aiViewClipKey !== clipKey) this.narrationPlacementNotice = undefined;
                const previousNarrationClipKey = this.aiViewClipKey;
                const previousAiView = this.aiView;
                const sidecarPending = !!generationIdentity && !this.generationTabMeta.has(generationIdentity.key);
                if (sidecarPending && this.aiViewClipKey !== clipKey) this.pendingAiViewDecision = clipKey;
                const decideAfterLoad = !sidecarPending && this.pendingAiViewDecision === clipKey
                    && this.aiView === 'tiles';
                this.aiView = aiTabViewFor({
                    clipKey, previousClipKey: this.aiViewClipKey, previousView: this.aiView,
                    reconsiderAfterSidecar: decideAfterLoad,
                    generationState, generationDone, forcePanel: aiAvailability.forcePanel,
                    generationKind, stillCandidateCount
                });
                if (!sidecarPending && this.pendingAiViewDecision === clipKey) this.pendingAiViewDecision = undefined;
                if (this.aiView === 'still-result' && (previousAiView !== 'still-result' || this.aiViewClipKey !== clipKey)) {
                    this.rememberedView.scrollTop = 0;
                    this.node.scrollTop = 0;
                }
                if (opensGapFrame && gapAiOpening) {
                    this.aiView = gapAiOpening.view;
                    this.gapAiOpening = undefined;
                }
                if (this.photoAiOpening) {
                    const opening = this.photoAiOpening;
                    this.aiView = opening === 'tiles' || aiGroups.some(group =>
                        group.tiles.some(tile => tile.id === opening && tile.enabled)) ? opening : 'tiles';
                    this.photoAiOpening = undefined;
                }
                if ((this.aiView === 'cutout' || this.aiView === 'eraser') && !photoTools.enabled) this.aiView = 'tiles';
                if (rowSnapshot.kind === 'audio' && this.narrationStates) {
                    const narrationState = this.narrationStates.get(clipKey) ?? initialAiNarrationState(this.narrationEngines);
                    this.narrationStates.set(clipKey, narrationState);
                    if (previousNarrationClipKey !== clipKey && narrationState.candidates?.length) this.aiView = 'narration';
                    if (narrationState.candidates === undefined && this.loadAiNarrationCandidates) {
                        narrationState.candidates = [];
                        void this.loadAiNarrationCandidates(clipKey, rowSnapshot.id);
                    }
                }
                this.aiViewClipKey = clipKey;
            }
            // Older render harnesses extract this method without its imported visibility helper.
            const showEditCorrection = typeof editCorrectionVisible !== 'function' || editCorrectionVisible({
                aiView: this.aiCatalogLoaded ? this.aiView! : 'tiles',
                targetKind: aiTargetKindFor({ hasIdentity: !!generationIdentity, generationDone, generationState,
                    audio: sectionKind === 'audio', audioPlanned: this.audioPlanned }),
                generationState
            });
            const imageSource = rowSnapshot.kind === 'cut' ? rowSnapshot.sourcePath
                : rowSnapshot.kind === 'layer' || rowSnapshot.kind === 'item'
                    ? rowSnapshot.sourcePath ?? rowSnapshot.src : undefined;
            const imageSelected = isInspectorStillImage(imageSource);
            if (!this.aiCatalogLoaded) {
                appendAiTiles(this.body, [], () => undefined, false, '別案を読み込んでいます…');
                this.appendSoloBanner();
                return;
            }
            if (this.aiView === 'tiles') {
                if (stillNotice) appendAiStillNotice(this.body, stillNotice);
                if (this.narrationPlacementNotice?.clipKey === clipKey
                    && this.narrationPlacementNotice.sourcePath === this.narrationSourcePath && sectionKind === 'audio') {
                    const notice = document.createElement('p');
                    notice.className = 'akari-inspector-ai-narration-placement';
                    notice.textContent = this.narrationPlacementNotice.label; this.body.append(notice);
                }
                const imageItemId = imageSelected && (rowSnapshot.kind === 'item'
                    || rowSnapshot.kind === 'layer') && rowSnapshot.sourceKind === 'media' ? rowSnapshot.id
                    : imageSelected && rowSnapshot.kind === 'cut' ? rowSnapshot.itemId : undefined;
                const alternativesGrid = appendAiTiles(this.body, aiGroups, id => {
                    if (id !== 'video' && id !== 'still' && id !== 'transcribe' && id !== 'narration'
                        && id !== 'cutout' && id !== 'eraser') return;
                    this.aiView = id === 'still' && stillCandidateCount > 0 ? 'still-result' : id;
                    if (this.aiView === 'still-result') {
                        this.rememberedView.scrollTop = 0;
                        this.node.scrollTop = 0;
                    }
                    if (id === 'narration' && rowSnapshot.kind === 'audio') {
                        void this.loadAiNarrationVoices(clipKey);
                        void this.loadAiNarrationCandidates(clipKey, rowSnapshot.id);
                    }
                    this.render();
                }, this.transcribeSummary.state === 'done', imageItemId ? '' : undefined);
                if (imageItemId && this.imageAiPanels && showEditCorrection) {
                    const root = this.workspaceService.tryGetRoots()[0]?.resource;
                    if (root) {
                        const key = `${root.toString()}:${imageItemId}`;
                        let state = this.imageAiPanels.get(key);
                        if (!state) {
                            state = { itemId: imageItemId, phase: 'closed' };
                            this.imageAiPanels.set(key, state);
                        }
                        const imageAiService: AkariAnnotationsService = new Proxy(this.layerAudioService, {
                            get: (target, property, receiver) => {
                                if (property === 'imageAiInspect') return (projectRootUri: string, itemId: string) =>
                                    (target.imageAiInspect as (rootUri: string, id: string, editUri: string) =>
                                        ReturnType<AkariAnnotationsService['imageAiInspect']>)(projectRootUri, itemId,
                                        currentTimelineEditUri(root).toString());
                                if (property === 'imageAiUpscale') return (request: Parameters<AkariAnnotationsService['imageAiUpscale']>[0]) => {
                                    const targeted = { ...request, editUri: currentTimelineEditUri(root).toString() };
                                    return target.imageAiUpscale(targeted);
                                };
                                const value = Reflect.get(target, property, receiver);
                                return typeof value === 'function' ? value.bind(target) : value;
                            }
                        });
                        const panel = appendImageAiPanel(alternativesGrid, {
                            projectRootUri: root.toString(), itemId: imageItemId,
                            state, service: imageAiService,
                            adopt: result => this.commitWrite({ kind: 'image-ai-apply', binding: result.binding,
                                relativePath: result.relativePath }),
                            openSettings: () => void this.commandRegistry.executeCommand('akari.settings.open',
                                { section: 'connections' })
                        });
                        this.imageAiPanelOpen = { ...panel, itemId: imageItemId };
                    }
                }
                // Older extracted render harnesses do not inject the home tile helpers.
                if (typeof homeTuneTiles === 'function' && typeof appendHomeTuneTiles === 'function') {
                    appendHomeTuneTiles(this.body, homeTuneTiles(sectionKind, tabs), target => {
                        void this.commandRegistry.executeCommand('akari.inspector.open', target);
                    });
                }
                this.appendSoloBanner();
                return;
            }
            if ((this.aiView === 'cutout' || this.aiView === 'eraser') && photoTools.enabled
                && (rowSnapshot.kind === 'cut' || rowSnapshot.kind === 'layer' || rowSnapshot.kind === 'item')) {
                const view = this.aiView;
                appendAiBack(this.body, view === 'cutout' ? '背景を消す' : '消しゴム', () => {
                    this.aiView = 'tiles';
                    this.render();
                });
                const photoFields = PHOTO_PANEL_FIELDS(rowSnapshot, requestWrite);
                const brushSnapshot = rowSnapshot.kind === 'cut'
                    ? { ...rowSnapshot, kind: 'item' as const, id: rowSnapshot.itemId ?? '', photo: true, maskSourceOptions: [] }
                    : rowSnapshot;
                const maskFields = MASK_FIELDS(brushSnapshot as TimelineTreeItemSnapshot, requestWrite);
                const brushFields = rowSnapshot.kind === 'cut' ? maskFields.map(field =>
                    field.name === 'photo-brush-start' && field.action
                        ? { ...field, action: () => field.action!(brushSnapshot as TimelineTreeItemSnapshot) } : field)
                    : maskFields;
                const names = view === 'cutout'
                    ? ['mask', 'photo-mask-generate', 'photo-mask-remove']
                    : ['photo-brush-mode', 'photo-brush-size', 'photo-brush-hardness', 'photo-brush-start'];
                const fields = view === 'cutout'
                    ? [...photoFields.filter(field => field.name === 'photo-cutout-panel'),
                        ...(rowSnapshot.kind === 'cut' ? [] : maskFields.filter(field => names.includes(field.name)))]
                    : brushFields.filter(field => names.includes(field.name));
                this.appendSection({ id: view === 'cutout' ? 'photo-cutout' : 'photo-eraser',
                    label: view === 'cutout' ? '背景を消す' : '消しゴム', fields }, rowSnapshot, sectionKind);
                return;
            }
            if (this.aiView === 'still-result' && generationIdentity) {
                this.appendStillResultPanel(generationIdentity);
                return;
            }
            if (this.aiView === 'still' && generationIdentity) {
                appendAiBack(this.body, '静止画', () => {
                    this.aiView = 'tiles';
                    this.transcribePolling = false;
                    this.render();
                });
                this.appendStillPanel(generationIdentity);
                return;
            }
            appendAiBack(this.body, this.aiView === 'transcribe' ? '文字起こし'
                : this.aiView === 'narration' ? 'ナレーション' : '動画にする', () => {
                this.aiView = 'tiles';
                this.transcribePolling = false;
                this.render();
            });
            if (this.aiView === 'transcribe') {
                const root = this.workspaceService.tryGetRoots()[0]?.resource;
                void this.loadTranscribeEngines?.(root?.toString() ?? '', transcribeKey);
                if (this.transcribeTarget) void this.loadTranscribeMediaDuration?.(root?.toString() ?? '', this.transcribeTarget.relativePath, transcribeKey);
                appendAiTranscribePanel(this.body, {
                    projectRoot: root?.toString() ?? '', target: this.transcribeTarget,
                    summary: this.transcribeSummary, running: this.transcribeRunning,
                    engines: this.transcribeEngines, engineError: this.transcribeEngineError,
                    mediaDuration: this.transcribeMediaDuration,
                    selectedBackend: this.transcribeSelectedBackend, redo: this.transcribeRedo,
                    onSelectBackend: backend => { this.transcribeSelectedBackend = backend; this.render(); },
                    onRedo: () => { this.transcribeRedo = true; this.render(); },
                    confirm: message => new ConfirmDialog({ title: '音声の送信', msg: message,
                        ok: '送って起こす', cancel: 'キャンセル' }).open(),
                    commands: this.commandRegistry,
                    onDialogResult: result => {
                        if (this.transcribeKey !== transcribeKey || this.aiView !== 'transcribe') return;
                        if (result === 'opened' || result === 'running') this.transcribeRedo = false;
                        this.transcribeRunning = result === 'running';
                        this.transcribePolling = result === 'opened' || result === 'running';
                        this.render();
                    }
                });
                if (this.transcribePolling) this.transcribeTimer = setInterval(() => {
                    if (this.isDisposed || this.currentTab !== 'edit' || this.aiView !== 'transcribe'
                        || this.transcribeKey !== transcribeKey
                        || !this.body.querySelector('.akari-inspector-ai-transcribe-panel')?.getBoundingClientRect().width) {
                        if (this.transcribeTimer) clearInterval(this.transcribeTimer);
                        this.transcribeTimer = undefined;
                        return;
                    }
                    void this.refreshAiTranscript(transcribeKey);
                }, 5000);
                return;
            }
            if (this.aiView === 'narration' && rowSnapshot.kind === 'audio') {
                const state = this.narrationStates.get(clipKey) ?? initialAiNarrationState(this.narrationEngines);
                this.narrationStates.set(clipKey, state);
                appendAiNarrationPanel(this.body, state, this.narrationEngines, {
                    change: () => {
                        const button = this.body.querySelector<HTMLButtonElement>('.akari-inspector-ai-narration-button');
                        if (button) button.disabled = !state.script.trim() || !state.selectedEngineIds?.length || state.running
                            || state.selectedEngineIds.some(id => !state.voiceByEngine?.[id])
                            || state.selectedEngineIds.includes('irodori') && state.voiceByEngine?.irodori === 'custom' && !state.style?.trim();
                    },
                    chooseEngine: id => {
                        const selected = new Set(state.selectedEngineIds ?? []);
                        if (selected.has(id)) selected.delete(id); else selected.add(id);
                        state.selectedEngineIds = [...selected];
                        state.engineId = state.selectedEngineIds[0] ?? '';
                        void this.loadAiNarrationVoices(clipKey); this.render();
                    },
                    chooseVoice: (id, voice) => {
                        state.voiceByEngine ??= {}; state.voiceByEngine[id] = voice;
                        if (id === state.engineId) state.voiceId = voice;
                        this.render();
                    },
                    generate: () => void this.startAiNarration(clipKey, rowSnapshot.id, rowSnapshot.outputStart),
                    cancel: () => void this.cancelAiNarration(clipKey, rowSnapshot.id),
                    play: candidate => void this.playAiNarrationCandidate(clipKey, candidate.relativePath!),
                    adopt: candidate => void this.adoptAiNarrationCandidate(clipKey, rowSnapshot.id, candidate.relativePath!),
                    retry: candidate => void this.startAiNarration(clipKey, rowSnapshot.id, rowSnapshot.outputStart, candidate.route)
                }, this.narrationPlacementContext?.itemId === rowSnapshot.id
                    ? this.narrationPlacementContext : undefined);
                return;
            }
        }

        let keyframeSection: InspectorSection | undefined;
        const selectedKeyframe = this.model.keyframeSelection;
        if (selectedKeyframe) {
            const easing = selectedKeyframe.easing ?? 'linear';
            const easingOptions = KEYFRAME_EASING_OPTIONS.includes(easing as typeof KEYFRAME_EASING_OPTIONS[number])
                ? KEYFRAME_EASING_OPTIONS : [...KEYFRAME_EASING_OPTIONS, easing];
            keyframeSection = {
                id: 'easing', label: 'イージング', fields: [{
                    name: 'segment-easing', label: 'プリセット', getValue: () => easing,
                    getEditValue: () => easing, inputKind: 'select', options: easingOptions,
                    previewOption: value => this.previewEasing(rowSnapshot, selectedKeyframe, value),
                    write: async (_snapshot, easing) => this.model.requestKeyframe?.({
                        action: 'easing', itemId: selectedKeyframe.itemId,
                        property: selectedKeyframe.property, easing
                    }) ?? { ok: false, message: 'キーフレーム編集を利用できません。' }
                }, {
                    name: 'segment-cubic-bezier', label: 'ベジェ',
                    getValue: () => easing.startsWith('cubic-bezier(') ? easing : 'cubic-bezier(0.42,0,0.58,1)',
                    getEditValue: () => easing.startsWith('cubic-bezier(') ? easing : 'cubic-bezier(0.42,0,0.58,1)',
                    inputKind: 'text',
                    write: async (_snapshot, easing) => /^cubic-bezier\(\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*\)$/u.test(easing)
                        ? this.model.requestKeyframe?.({
                            action: 'easing', itemId: selectedKeyframe.itemId,
                            property: selectedKeyframe.property, easing
                        }) ?? { ok: false, message: 'キーフレーム編集を利用できません。' }
                        : { ok: false, message: 'cubic-bezier(x1,y1,x2,y2) の形で入力してください。' }
                }]
            };
        }
        if (activeTab === 'adjust' && photoTools.enabled) {
            const photoFields = rowSnapshot.kind === 'cut' || rowSnapshot.kind === 'layer' || rowSnapshot.kind === 'item'
                ? PHOTO_PANEL_FIELDS(rowSnapshot, requestWrite) : [];
            this.appendSection({ id: 'adjust-scope', label: '範囲', fields: [{
                name: 'edit-adjust-scope', label: '対象', inputKind: 'select',
                options: ['画像全体', '選択エリア'], getValue: () => this.editAdjustScope ?? '画像全体',
                write: async (_snapshot, value) => {
                    this.editAdjustScope = value === '選択エリア' ? '選択エリア' : '画像全体';
                    this.render();
                    return { ok: true };
                }
            }, ...(this.editAdjustScope === '選択エリア'
                ? photoFields.filter(field => field.name === 'photo-region-panel') : [])] }, rowSnapshot, sectionKind);
        }
        if (activeTab === 'adjust' && compareTarget) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'akari-inspector-adjust-compare';
            button.hidden = this.solo !== undefined;
            button.setAttribute('data-akari-ui', 'toggle:inspector-adjust-compare');
            button.setAttribute('aria-pressed', String(this.adjustCompare?.enabled === true));
            button.textContent = 'A/B 比較';
            button.addEventListener('click', () => {
                this.adjustCompare = { target: compareTarget, enabled: !this.adjustCompare?.enabled };
                this.model.requestAdjustBypass?.(this.adjustCompare);
                this.render();
            });
            this.body.appendChild(button);
        }
        if (keyframeSection) {
            this.appendSection(keyframeSection, rowSnapshot, sectionKind);
        }
        if (activeTab === 'adjust') {
            this.refreshAdjustLuts();
            (photoTools.enabled && this.editAdjustScope === '選択エリア' ? [] : ADJUST_SECTIONS(rowSnapshot, requestWrite, {
                projectLutRefs: this.projectLutRefs,
                importLut: () => this.importAdjustLut(rowSnapshot)
            }))
                .filter(section => assignSectionToTab(sectionKind, section.id) === activeTab)
                .forEach(section => this.appendSection(section, rowSnapshot, sectionKind));
            if (!this.solo) ADJUST_PREVIEW_SECTIONS.forEach(section => this.appendAdjustPreviewSection(section, sectionKind));
            this.appendSoloBanner();
            return;
        }
        if (activeTab === 'audio' && sectionKind !== 'audio') {
            if (!this.solo) AUDIO_PREVIEW_SECTIONS.forEach(section =>
                this.appendAdjustPreviewSection(section, sectionKind, 'audio'));
            this.appendSection(AUDIO_MASTER_SECTION(this.model.audioMaster, requestWrite), rowSnapshot, sectionKind);
            this.appendSoloBanner();
            return;
        }
        sections
            .filter(section => assignSectionToTab(sectionKind, section.id) === activeTab)
            .forEach(section => {
                if (section.id === 'info' && this.model.materialSwapTarget) {
                    const row = document.createElement('div');
                    row.dataset.akariMaterialSwap = 'entry';
                    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px';
                    const label = document.createElement('span');
                    label.textContent = '入れ替え';
                    const button = document.createElement('button');
                    button.className = 'theia-button secondary';
                    button.textContent = '候補を見る';
                    button.onclick = () => this.model.requestMaterialSwap?.();
                    row.append(label, button);
                    this.body.appendChild(row);
                }
                this.appendSection(section, rowSnapshot, sectionKind);
            });
        if (activeTab === 'info' && typeof this.appendGenerationProvenance === 'function') {
            this.appendGenerationProvenance(rowSnapshot, generationIdentity, clipKey);
        }
        if (this.previewedVideoCandidate && activeTab !== 'edit') this.clearVideoCandidatePreview();
        if (activeTab === 'edit' && this.aiView === 'video' && generationIdentity
            && !generationIdentity.key.startsWith('material:')
            && typeof this.appendVideoCandidatesPanel === 'function') this.appendVideoCandidatesPanel(generationIdentity);
        if (activeTab === 'audio' && sectionKind === 'audio') {
            if (!this.solo) AUDIO_ITEM_PREVIEW_SECTIONS.forEach(section =>
                this.appendAdjustPreviewSection(section, sectionKind, 'audio-item'));
            this.appendSection(AUDIO_MASTER_SECTION(this.model.audioMaster, requestWrite), rowSnapshot, sectionKind);
        }
        this.appendSoloBanner();
    }

    protected appendSoloBanner(): void {
        if (!this.solo) return;
        const field = this.solo.fieldName
            ? this.body.querySelector(`[data-akari-field="${this.solo.fieldName}"]`)
            : null;
        const section = this.solo.sectionId
            ? this.body.querySelector(`[data-akari-ui="section:inspector-${this.solo.sectionId}"]`)
            : null;
        const fieldLabel = field?.querySelector('.akari-inspector-row-label')?.textContent?.trim();
        const sectionLabel = section?.querySelector('.akari-inspector-section-toggle')?.textContent
            ?.trim();
        const label = fieldLabel || sectionLabel || this.solo.fieldName || this.solo.sectionId || 'この項目';
        const banner = document.createElement('div');
        banner.className = 'akari-inspector-solo-banner';
        banner.setAttribute('data-akari-ui', 'notice:inspector-solo');
        banner.appendChild(document.createTextNode(`${label} だけを表示中 — `));
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'akari-inspector-solo-reset';
        reset.textContent = 'すべて表示';
        reset.addEventListener('click', () => {
            this.clearSolo();
            this.render();
        });
        banner.appendChild(reset);
        this.body.insertBefore(banner, this.body.firstChild);
    }

    protected renderWorldSelection(snapshot: TimelineWorldSelection): void {
        const tabs = tabsForKind('world');
        const active = this.tabState.activeTab('world', tabs);
        this.appendTabStrip('world', tabs, active);
        const values: Array<[string, unknown]> = snapshot.stop ? [
            ['world', `${snapshot.world.label} (${snapshot.world.id})`], ['停留所', snapshot.stop.id],
            ['c (x, y, scale)', snapshot.stop.c.join(', ')], ['at', `${snapshot.stop.at} s`], ['leave', `${snapshot.stop.leave} s`]
        ] : snapshot.edge ? [
            ['world', `${snapshot.world.label} (${snapshot.world.id})`], ['辺', snapshot.edge.id],
            ['接続', `${snapshot.edge.from} → ${snapshot.edge.to}`], ['type', snapshot.edge.type],
            ['transition', snapshot.edge.transition?.kind ?? '-'], ['cover', `${snapshot.edge.transition?.cover ?? '-'} s`],
            ['via', snapshot.edge.via ?? '-'], ['carry', snapshot.edge.carry?.join(', ') || '-']
        ] : [];
        const list = document.createElement('dl');
        Object.assign(list.style, { display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', gap: '7px', margin: '4px 0 10px' });
        for (const [label, value] of values) {
            const dt = document.createElement('dt'); dt.textContent = label;
            const dd = document.createElement('dd'); dd.textContent = String(value); dd.style.margin = '0';
            list.append(dt, dd);
        }
        this.body.appendChild(list);
        if (active === 'world') {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'theia-button'; button.textContent = '編集の指示をコピー';
            button.addEventListener('click', () => void navigator.clipboard.writeText(worldInstructionCopy(snapshot as any)));
            this.body.appendChild(button);
        }
    }

    protected syncAdjustCompare(target: LivePreviewTarget | undefined, activeTab: string): void {
        const next = nextAdjustCompareState(this.adjustCompare, { target, activeTab });
        this.adjustCompare = next.state;
        if (next.release) this.model.requestAdjustBypass?.({ target: next.release, enabled: false });
    }

    override dispose(): void {
        this.clearVideoCandidatePreview?.();
        if (this.transcribeTimer) clearInterval(this.transcribeTimer);
        if (this.narrationTick) window.clearInterval(this.narrationTick);
        for (const state of this.aiVideoStates?.values() ?? []) clearVideoPlayer(state);
        this.cancelGenerationFramePick();
        this.syncAdjustCompare(undefined, '');
        this.lutGeneration++;
        super.dispose();
    }

    protected refreshAdjustLuts(): void {
        if (this.lutRequestedGeneration === this.lutGeneration) return;
        const generation = this.lutGeneration;
        this.lutRequestedGeneration = generation;
        void (this.model.requestAdjustLutList?.() ?? Promise.resolve([])).catch(error => {
            console.warn('LUT 一覧を取得できませんでした。', error);
            return [];
        }).then(refs => {
            if (this.isDisposed || generation !== this.lutGeneration) return;
            this.projectLutRefs = refs;
            this.render();
        });
    }

    protected async importAdjustLut(snapshot: InspectorSnapshot): Promise<InspectorWriteResult> {
        if (snapshot.kind === 'caption' || snapshot.kind === 'audio') return { ok: false, message: '映像を選択してください。' };
        try {
            const uri = await this.fileDialogService.showOpenDialog({ title: 'LUT を読み込む',
                canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
                filters: { 'LUT (*.cube)': ['cube'] } });
            if (!uri) return { ok: true };
            if (!this.model.requestAdjustLutImport) throw new Error('LUT の取り込みを利用できません。');
            const ref = await this.model.requestAdjustLutImport(uri.path.fsPath());
            const itemId = snapshot.kind === 'cut' ? snapshot.itemId ?? `cut:${snapshot.index}` : snapshot.id;
            const result = await this.commitWrite(createInspectorAdjustWriteRequest(itemId, 'adjust.lut.lut', ref));
            this.lutGeneration++;
            this.refreshAdjustLuts();
            return result;
        } catch (error) {
            return { ok: false, message: 'LUT を取り込めませんでした: ' + (error instanceof Error ? error.message : String(error)) };
        }
    }

    protected tabSourceHint(snapshot: InspectorSnapshot): unknown {
        return snapshot.kind === 'overlay' ? snapshot.payload.src
            : snapshot.kind === 'cut' || snapshot.kind === 'layer' || snapshot.kind === 'item'
                ? snapshot.src : undefined;
    }

    protected appendTabStrip(
        kind: 'cut' | 'layer' | 'caption' | 'audio' | 'overlay' | 'item' | 'world',
        tabs: readonly InspectorTabDef[],
        activeTab: string,
        generationTodo = false,
        enabledTileViews: readonly AiTabView[] = []
    ): void {
        const strip = document.createElement('div');
        strip.className = 'akari-inspector-tab-strip';
        strip.setAttribute('role', 'tablist');
        strip.setAttribute('aria-label', '編集パネル');
        strip.setAttribute('data-akari-ui', 'tabs:inspector');
        for (const tab of tabs) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'akari-inspector-tab';
            button.textContent = tab.label;
            button.disabled = !tab.enabled;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(tab.id === activeTab));
            button.setAttribute('aria-disabled', String(!tab.enabled));
            button.setAttribute('data-akari-ui', `tab:inspector-${tab.id}`);
            if (tab.id === activeTab) button.classList.add('is-active');
            if (!tab.enabled) button.title = tab.disabledTitle ?? 'この要素では使えません';
            if (tab.id === 'edit' && generationTodo) {
                const todo = document.createElement('span');
                todo.setAttribute('data-akari-generation-todo', 'true');
                todo.setAttribute('aria-label', '生成でやることがあります');
                button.appendChild(todo);
            }
            button.addEventListener('click', () => {
                if (!tab.enabled) return;
                if (tab.id === 'edit') {
                    // Extracted widget test harnesses may not inject this pure helper.
                    this.aiView = this.aiView === 'cutout' || this.aiView === 'eraser' ? 'tiles'
                        : typeof viewAfterHomeTabClick === 'function'
                        ? viewAfterHomeTabClick({ currentView: this.aiView ?? 'tiles', enabledTileCount: enabledTileViews.length,
                            soleTileView: enabledTileViews[0] }) : 'tiles';
                } else if (tab.id === activeTab) return;
                this.explicitTabId = tab.id;
                this.tabState.setActiveTab(kind, tab.id);
                this.render();
            });
            strip.appendChild(button);
        }
        this.body.appendChild(strip);
    }

    protected appendAdjustPreviewSection(
        section: AdjustPreviewSection | AudioPreviewSection,
        kind: 'cut' | 'layer' | 'caption' | 'audio' | 'overlay' | 'item',
        previewKind: 'adjust' | 'audio' | 'audio-item' = 'adjust'
    ): void {
        // Placeholder-only sections have no working controls. Keep this method as the
        // extension point for older render harnesses, but draw nothing in the panel.
        void section; void kind; void previewKind;
    }

    protected overlayKnobs(snapshot: TimelineOverlaySelection): readonly InspectorKnob[] {
        const html = typeof snapshot.payload.html === 'string' ? snapshot.payload.html : undefined;
        const metaPath = html ? overlayMetaPath(html) : undefined;
        if (!metaPath) return [];
        const cached = this.knobCache.get(metaPath);
        if (cached !== undefined) return cached ?? [];
        this.knobCache.set(metaPath, null);
        void this.loadOverlayKnobs(metaPath, snapshot.id);
        return [];
    }

    protected async loadOverlayKnobs(metaPath: string, overlayId: string): Promise<void> {
        try {
            await this.workspaceService.ready;
            const root = this.workspaceService.tryGetRoots()[0];
            if (!root) return;
            const uri = /^[a-z][a-z0-9+.-]*:/iu.test(metaPath)
                ? new URI(metaPath) : root.resource.resolve(metaPath);
            const source = (await this.fileService.readFile(uri)).value.toString();
            this.knobCache.set(metaPath, parseInspectorKnobs(JSON.parse(source)));
        } catch {
            const match = /^assets\/(overlay\/[^/]+)\/meta\.json$/u.exec(metaPath);
            const meta = match ? await this.commandRegistry.executeCommand<unknown>(
                'akari.catalog.readOverlayMeta', match[1]).catch(() => undefined) : undefined;
            this.knobCache.set(metaPath, parseInspectorKnobs(meta));
        }
        const current = this.model.snapshot;
        if (current?.kind === 'overlay' && current.id === overlayId) this.render();
    }

    protected appendSection(
        section: InspectorSection,
        snapshot: InspectorSnapshot,
        kind: 'cut' | 'layer' | 'caption' | 'audio' | 'overlay' | 'item',
        parent: HTMLElement = this.body,
        nested = false
    ): HTMLElement | undefined {
        if (this.solo) {
            const [filteredSection] = filterInspectorSoloSections(kind, [section], this.solo);
            if (!filteredSection) return;
            section = filteredSection;
        }
        const container = document.createElement('section');
        container.className = nested ? 'akari-inspector-adjust-subsection' : 'akari-inspector-section';
        container.setAttribute('data-akari-ui', `section:inspector-${section.id}`);
        if (section.id === 'style') container.setAttribute('data-inspector-field', 'caption-style');
        const header = document.createElement('div');
        header.className = nested ? 'akari-inspector-adjust-subtitle' : 'akari-inspector-section-header';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = nested ? 'akari-inspector-adjust-subtitle-label' : 'akari-inspector-section-toggle';
        const sectionStorageKind = section.id === 'motion' || section.id === 'animator'
            ? `${kind}:motion` : kind;
        const collapsed = nested ? false : this.sectionState.isCollapsed(sectionStorageKind, section);
        toggle.textContent = section.label;
        if (!nested) toggle.appendChild(createInspectorIcon('down'));
        toggle.setAttribute('aria-expanded', String(!collapsed));
        if (nested) toggle.disabled = true;
        const body = document.createElement('div');
        body.className = 'akari-inspector-section-body';
        body.hidden = collapsed;
        if (!nested) toggle.addEventListener('click', () => {
            const next = !body.hidden;
            body.hidden = next;
            toggle.setAttribute('aria-expanded', String(!next));
            this.sectionState.setCollapsed(sectionStorageKind, section.id, next);
        });
        header.appendChild(toggle);
        if (section.enable) {
            const enable = section.enable;
            const enableLabel = document.createElement('label');
            enableLabel.className = 'akari-inspector-section-enable';
            enableLabel.title = enable.label;
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = enable.checked;
            checkbox.setAttribute('aria-label', enable.label);
            checkbox.setAttribute('data-akari-ui', `field:inspector-${enable.name}`);
            checkbox.setAttribute('data-akari-field', enable.name);
            const caption = document.createElement('span');
            caption.textContent = '有効';
            checkbox.addEventListener('change', () => {
                const next = checkbox.checked;
                checkbox.disabled = true;
                void enable.write(next).then(result => {
                    checkbox.disabled = false;
                    if (!result.ok) {
                        checkbox.checked = !next;
                        this.showFieldNotice(result.message ?? '有効状態を変更できませんでした。');
                    }
                });
            });
            enableLabel.append(checkbox, caption);
            header.appendChild(enableLabel);
        }
        if (section.caption) {
            const caption = document.createElement('p');
            caption.className = 'akari-inspector-section-caption';
            caption.textContent = section.caption;
            body.appendChild(caption);
        }
        const fields = [...section.fields];
        if (section.optionalFields) {
            const visible = section.optionalFields.filter(field => this.isOptionalFieldVisible(kind, field, snapshot));
            fields.push(...visible);
            if (!this.solo) {
                const add = document.createElement('button');
                add.type = 'button';
                add.className = 'akari-inspector-section-add';
                add.appendChild(createInspectorIcon('plus'));
                add.setAttribute('aria-label', '項目を追加');
                add.title = '変形の行を追加';
                add.setAttribute('data-akari-ui', 'menu:inspector-transform-add');
                add.addEventListener('click', event => {
                    const hidden = section.optionalFields!.filter(field => !this.isOptionalFieldVisible(kind, field, snapshot));
                    if (hidden.length === 0) return;
                    const menu = document.createElement('div');
                    menu.className = 'akari-inspector-popover-menu';
                    Object.assign(menu.style, {
                        position: 'fixed', left: `${event.clientX}px`, top: `${event.clientY}px`, zIndex: '10000',
                        display: 'grid', padding: '4px', background: 'var(--akari-elevated)',
                        border: '1px solid var(--akari-line)'
                    });
                    hidden.forEach(field => {
                        const choice = document.createElement('button');
                        choice.type = 'button';
                        choice.textContent = field.label;
                        choice.addEventListener('click', () => {
                            menu.remove();
                            this.setOptionalFieldVisible(kind, field.name, true);
                            this.render();
                        });
                        menu.appendChild(choice);
                    });
                    const dismiss = (pointerEvent: PointerEvent): void => {
                        if (pointerEvent.target instanceof Node && menu.contains(pointerEvent.target)) return;
                        menu.remove();
                        window.removeEventListener('pointerdown', dismiss, true);
                    };
                    window.setTimeout(() => window.addEventListener('pointerdown', dismiss, true), 0);
                    document.body.appendChild(menu);
                });
                header.appendChild(add);
            }
        }
        fields.forEach(field => this.appendRow(body, field, snapshot, kind));
        if (section.body) {
            const customBody = section.body(snapshot);
            if (section.enable?.checked === false) {
                customBody.setAttribute('aria-disabled', 'true');
                customBody.style.pointerEvents = 'none';
                customBody.style.opacity = '0.5';
            }
            body.appendChild(customBody);
        }
        container.append(header, body);
        parent.appendChild(container);
        return body;
    }

    protected isOptionalFieldVisible(
        kind: string,
        field: InspectorFieldDef & { name: string },
        snapshot: InspectorSnapshot
    ): boolean {
        const key = `akari.inspector.optional.v1:${kind}:${field.name}`;
        const saved = window.localStorage.getItem(key);
        if (saved !== null) return saved === 'true';
        if (field.name === 'transform-scaleX' || field.name === 'transform-scaleY') return true;
        const transform = snapshot.kind === 'cut' || snapshot.kind === 'layer' || snapshot.kind === 'item'
            ? snapshot.transform : snapshot.kind === 'overlay' && snapshot.payload.transform
                && typeof snapshot.payload.transform === 'object' && !Array.isArray(snapshot.payload.transform)
                ? snapshot.payload.transform as Record<string, unknown> : undefined;
        const property = field.name.endsWith('scale') ? 'scale' : 'rotate';
        return !!transform && Object.prototype.hasOwnProperty.call(transform, property);
    }

    protected setOptionalFieldVisible(kind: string, fieldName: string, visible: boolean): void {
        window.localStorage.setItem(`akari.inspector.optional.v1:${kind}:${fieldName}`, String(visible));
    }

    protected batchBaseItem(item: InspectorSnapshot): GenerationBatchItem {
        const identity = this.generationIdentity(item);
        const sourcePath = item.kind === 'cut' ? item.sourcePath
            : item.kind === 'layer' ? item.src : undefined;
        return {
            itemId: item.kind === 'cut' ? item.itemId ?? `cut:${item.index}` : item.id,
            name: item.kind === 'caption' ? item.text : item.clipName,
            duration: item.kind === 'cut' || item.kind === 'caption'
                ? Math.max(0, (item.outputEnd ?? 0) - (item.outputStart ?? 0)) : item.duration,
            start: item.outputStart ?? 0,
            track: 'track' in item ? item.track : undefined,
            visual: !!identity || (item.kind === 'cut' || item.kind === 'layer') && !!sourcePath,
            sourcePath
        };
    }

    protected watchGenerationBatch(): void {
        if (this.batchWatching) return;
        this.batchWatching = true;
        let timer: number | undefined;
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (!event.changes.some(change => /(?:edit\.json|\.inputs\.json|\.meta\.json)$/u.test(change.resource.path.toString()))) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                this.batchSelectionKey = undefined;
                if (!this.isDisposed && this.model.snapshot?.kind === 'multi') this.render();
            }, 150);
        }));
        this.toDispose.push({ dispose: () => window.clearTimeout(timer) });
    }

    protected async loadGenerationBatch(items: readonly InspectorSnapshot[], revision: number): Promise<void> {
        const loaded: GenerationBatchItem[] = [];
        try {
            await this.workspaceService.ready;
            const root = this.workspaceService.tryGetRoots()[0]?.resource;
            if (!root) throw new Error('プロジェクトが開かれていません。');
            for (const item of items) {
                if (revision !== this.batchLoadRevision || this.isDisposed) return;
                const row = this.batchBaseItem(item);
                const identity = this.generationIdentity(item);
                if (identity) {
                    // The single-selection loader owns duration and RPC validation/rounding.
                    this.generationValidations.delete(identity.key);
                    await this.loadGeneration(identity);
                    row.draft = this.generationDrafts.get(identity.key);
                    row.validation = this.generationValidations.get(identity.key) ?? {
                        ok: false, messages: [{ level: 'error', text: '入力・見積を読み込めませんでした' }]
                    };
                }
                if (row.sourcePath && row.visual) {
                    const sidecars = await this.layerAudioService.readGenerationSidecars({
                        projectRootUri: root.toString(), ...activeEditRequest(root), sourcePaths: [row.sourcePath]
                    });
                    const normalize = (value: string): string => value.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
                    const direct = sidecars.entries.find(entry => normalize(entry.sourcePath) === normalize(row.sourcePath!));
                    const selected = selectGenerationSidecarForSource(row.sourcePath, sidecars.entries, Date.now());
                    row.meta = direct?.meta ?? selected?.meta;
                    row.state = selected?.binding?.matches === false ? 'orphan'
                        : selected?.meta?.kind === 'video' ? resolveGenerationState(selected.meta, Date.now()) : 'none';
                }
                loaded.push(row);
            }
        } catch (error) {
            // Unread rows remain excluded; successfully validated rows retain their estimates.
            for (const item of items.slice(loaded.length)) loaded.push({ ...this.batchBaseItem(item), state: 'orphan' });
            if (revision === this.batchLoadRevision) this.showFieldNotice(String(error));
        }
        if (revision !== this.batchLoadRevision || this.isDisposed) return;
        this.batchItems = loaded;
        this.batchLoading = false;
        if (this.model.snapshot?.kind === 'multi') this.render();
    }

    protected renderGenerationBatch(items: readonly InspectorSnapshot[]): void {
        this.watchGenerationBatch();
        const projectRootUri = this.workspaceService.tryGetRoots()[0]?.resource.toString() ?? '';
        const key = `${projectRootUri}:${JSON.stringify(items.map(item => this.batchBaseItem(item)))}`;
        if (this.batchSelectionKey !== key) {
            this.batchSelectionKey = key;
            this.batchItems = items.map(item => this.batchBaseItem(item));
            this.batchLoading = true;
            void this.loadGenerationBatch(items, ++this.batchLoadRevision);
        }
        const run = this.batchRun?.projectRootUri === projectRootUri ? this.batchRun : undefined;
        const batch = buildGenerationBatch(this.batchItems.map(item => {
            const progress = run?.progress.get(item.itemId)?.state;
            return progress === '完了' ? { ...item, state: 'done' }
                : progress === '生成中' ? { ...item, state: 'generating' } : item;
        }));
        const panel = document.createElement('section');
        panel.className = 'akari-generation-batch';
        panel.setAttribute('aria-label', '複数選択');
        const heading = document.createElement('h3');
        heading.textContent = `${items.length} 個を選択中`;
        panel.appendChild(heading);
        const list = document.createElement('div');
        list.className = 'akari-generation-batch-list';
        for (const row of batch.rows) {
            const element = document.createElement('div');
            element.className = 'akari-generation-batch-row';
            element.setAttribute('data-akari-generation-item', row.itemId);
            const thumbnail = document.createElement('img');
            thumbnail.className = 'akari-generation-batch-thumbnail';
            thumbnail.alt = '';
            if (row.sourcePath) void this.generationThumbnail(row.sourcePath).then(src => {
                if (src && element.isConnected) thumbnail.src = src;
            });
            const name = document.createElement('div');
            name.className = 'akari-generation-batch-name';
            name.textContent = row.name || row.itemId;
            name.title = `${row.name || row.itemId} (${row.itemId})`;
            const duration = document.createElement('span');
            duration.className = 'akari-generation-batch-duration';
            duration.textContent = `${row.duration.toFixed(2)} 秒`;
            const badge = document.createElement('div');
            badge.className = 'akari-generation-batch-badge';
            const progress = run?.progress.get(row.itemId);
            badge.textContent = progress?.state ?? (this.batchLoading && row.visual ? '見積を確認中' : row.badge);
            badge.title = progress?.reason ?? badge.textContent;
            element.append(thumbnail, name, duration, badge);
            list.appendChild(element);
        }
        panel.appendChild(list);
        const summary = document.createElement('p');
        summary.className = 'akari-generation-batch-summary';
        summary.textContent = this.batchLoading ? '見積を確認中…' : batch.summary;
        panel.appendChild(summary);
        const note = (text: string): void => {
            const p = document.createElement('p');
            p.className = 'akari-generation-batch-note';
            p.textContent = text;
            panel.appendChild(p);
        };
        note('1 本ずつの見積の合計 · 承認は 1 回');
        note(`as_of ${batch.asOf}`);
        const submit = document.createElement('button');
        submit.className = 'akari-generation-batch-submit';
        submit.textContent = 'まとめて動画にする…';
        submit.disabled = this.batchLoading || batch.count === 0 || this.batchConfirming || !!this.batchRun?.active;
        submit.onclick = () => { void this.confirmGenerationBatch(batch, projectRootUri); };
        panel.appendChild(submit);
        if (this.batchRun?.active) {
            const stop = document.createElement('button');
            stop.className = 'akari-generation-batch-stop';
            stop.textContent = this.batchRun.stopped ? '残りを中止しました' : '残りをやめる';
            stop.disabled = this.batchRun.stopped;
            stop.onclick = () => {
                if (this.batchRun) this.batchRun.stopped = true;
                this.render();
            };
            panel.appendChild(stop);
        }
        note('画像のまま・空の枠・生成済みは対象外。全部を自動で動画にするボタンはありません');
        this.body.appendChild(panel);
    }

    protected async confirmGenerationBatch(batch: ReturnType<typeof buildGenerationBatch>, projectRootUri: string): Promise<void> {
        if (this.batchConfirming || this.batchRun?.active || !batch.count || !projectRootUri) return;
        const drafts = new Map(batch.rows.filter(row => row.eligible && row.draft)
            .map(row => [row.itemId, structuredClone(row.draft!)]));
        this.batchConfirming = true;
        this.render();
        try {
            const amount = batch.unknown ? `一部見積不可（見積可能分 $${batch.total.toFixed(2)}）` : `合計 $${batch.total.toFixed(2)}`;
            const approved = await new ConfirmDialog({ title: '費用承認',
                msg: `${batch.count} 本を${amount}（as_of ${batch.asOf}）で送ります。費用承認しますか`,
                ok: '費用承認する', cancel: 'キャンセル' }).open();
            if (!approved) return;
            const run = { projectRootUri, stopped: false, active: true,
                progress: new Map<string, { state: GenerationBatchProgress; reason?: string }>() };
            this.batchRun = run;
            try {
                await executeGenerationBatch({ rows: batch.rows, projectRootUri, approved: true,
                    start: async request => {
                        // The CLI reads next.output.duration_s. Persist the approved cuts-based
                        // draft so the submitted input and the displayed estimate agree.
                        const draft = drafts.get(request.itemId)!;
                        await this.layerAudioService.writeGenerationDraft({ projectRootUri,
                            ...activeEditRequest(new URI(projectRootUri)), itemId: request.itemId, ...draft });
                        if (run.stopped) throw new Error('送信前に中止しました');
                        // This RPC resolves on CLI process close, not on submission.
                        return { completion: this.layerAudioService.startGenerateVideo({ ...request,
                            ...activeEditRequest(new URI(projectRootUri)) }) };
                    },
                    wait: handle => handle.completion,
                    stopped: () => run.stopped,
                    progress: (itemId, state, reason) => {
                        run.progress.set(itemId, { state, reason });
                        if (state === '生成中' || state === '完了' || state === '失敗') {
                            this.generationStates.set(itemId, state === '生成中' ? 'generating' : state === '完了' ? 'done' : 'failed');
                            this.generationLoads.delete(itemId);
                        }
                        if (!this.isDisposed) this.render();
                    }
                });
            } finally {
                run.active = false;
                this.batchSelectionKey = undefined;
            }
        } catch (error) {
            this.showFieldNotice(String(error));
        } finally {
            this.batchConfirming = false;
            if (!this.isDisposed) this.render();
        }
    }

    protected observeGenerationVideo(snapshot: TimelineSelectionModel['snapshot']): void {
        if (!snapshot || (snapshot.kind !== 'cut' && snapshot.kind !== 'layer')) return;
        const itemId = snapshot.kind === 'cut' ? snapshot.itemId : snapshot.id;
        const sourcePath = snapshot.kind === 'cut' ? snapshot.sourcePath : snapshot.sourceKind === 'media' ? snapshot.src : undefined;
        if (!itemId || !sourcePath || !/\.(?:mp4|mov|webm|m4v)$/iu.test(sourcePath)) return;
        if (this.generationVideoPaths.get(itemId) === sourcePath) return;
        this.generationVideoPaths.set(itemId, sourcePath);
        this.generationFinal.delete(itemId);
        this.generationDone.delete(itemId);
        this.generationDrafts.delete(itemId);
        void this.loadGeneration({ key: itemId, itemId, sourcePath,
            duration: snapshot.kind === 'cut' ? snapshot.outputEnd - snapshot.outputStart : snapshot.duration });
    }

    protected renderMaterialTranscribeEngines(materialSelection: AkariMaterialSelection): void {
        if (this.materialTab !== 'generation' || this.aiView !== 'transcribe'
            || (materialSelection.mediaKind !== 'audio' && materialSelection.mediaKind !== 'video')) return;
        void this.loadTranscribeEngines(materialSelection.projectRoot, this.transcribeKey);
        void this.loadTranscribeMediaDuration(materialSelection.projectRoot, materialSelection.relativePath, this.transcribeKey);
        const oldPanel = this.body.querySelector('.akari-inspector-ai-transcribe-panel');
        oldPanel?.remove();
        appendAiTranscribePanel(this.body, {
            projectRoot: materialSelection.projectRoot,
            target: { relativePath: materialSelection.relativePath, name: materialSelection.name, duration: 0, atSeconds: 0 },
            summary: this.transcribeSummary, running: this.transcribeRunning, commands: this.commandRegistry,
            engines: this.transcribeEngines, engineError: this.transcribeEngineError,
            mediaDuration: this.transcribeMediaDuration,
            selectedBackend: this.transcribeSelectedBackend, redo: this.transcribeRedo,
            onSelectBackend: backend => { this.transcribeSelectedBackend = backend; this.render(); },
            onRedo: () => { this.transcribeRedo = true; this.render(); },
            confirm: message => new ConfirmDialog({ title: '音声の送信', msg: message,
                ok: '送って起こす', cancel: 'キャンセル' }).open(),
            onDialogResult: result => {
                if (this.materialSelection !== materialSelection) return;
                if (result === 'opened' || result === 'running') this.transcribeRedo = false;
                this.transcribeRunning = result === 'running';
                this.transcribePolling = result === 'opened' || result === 'running';
                this.render();
            }
        });
    }

    protected async loadTranscribeMediaDuration(projectRoot: string, relativePath: string, key?: string): Promise<void> {
        const lookupKey = JSON.stringify([projectRoot, relativePath]);
        if (!projectRoot || this.transcribeDurationLookupKey === lookupKey) return;
        this.transcribeDurationLookupKey = lookupKey;
        try {
            const root = new URI(projectRoot);
            const sidecar = root.resolve(`.akari/sidecars/${relativePath}.analysis/analysis.json`);
            const analysis = JSON.parse((await this.fileService.readFile(sidecar)).value.toString());
            const duration = analysis?.probe?.duration_s ?? analysis?.probe?.duration ?? analysis?.duration_s;
            if (this.transcribeKey !== key || this.isDisposed) return;
            if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
                this.transcribeMediaDuration = duration;
                this.render();
            }
        } catch { /* The clip duration remains the estimate fallback. */ }
    }

    protected async loadTranscribeEngines(projectRoot: string, key?: string): Promise<void> {
        if (!projectRoot || this.transcribeEngineLoading || this.transcribeEngines !== undefined) return;
        this.transcribeEngineLoading = true;
        try {
            const engines = await this.commandRegistry.executeCommand<AiTranscribeEngine[]>('akari.transcribe.engines', { projectRoot });
            if (this.transcribeKey !== key || this.isDisposed) return;
            this.transcribeEngines = engines;
            this.transcribeEngineError = undefined;
            const selectable = engines.filter(engine => engine.availability.state !== 'unavailable');
            this.transcribeSelectedBackend = (selectable.find(engine => engine.default) ?? selectable[0])?.id;
        } catch (error) {
            if (this.transcribeKey !== key || this.isDisposed) return;
            this.transcribeEngines = [];
            this.transcribeEngineError = `エンジンを確認できませんでした: ${String(error)}`;
        } finally {
            if (this.transcribeKey === key) {
                this.transcribeEngineLoading = false;
                if (!this.isDisposed) this.render();
            }
        }
    }

    protected loadAiTranscribeTarget(snapshot: InspectorSnapshot, key: string): Promise<void> {
        const revision = this.narrationLoadRevision;
        this.transcribeLoading = (async () => {
            try {
                await this.workspaceService.ready;
                const root = this.workspaceService.tryGetRoots()[0]?.resource;
                if (!root) return;
                const editVersion = this.narrationEditVersion ?? 0;
                const cached = snapshot.kind === 'audio' && this.narrationEditSnapshot?.itemId === snapshot.id
                    && this.narrationEditSnapshot.editVersion === editVersion ? this.narrationEditSnapshot.edit : undefined;
                const edit = cached ?? JSON.parse((await this.fileService.readFile(currentTimelineEditUri(root))).value.toString());
                const sourcePath = snapshot.kind === 'audio' ? aiNarrationSourcePath(edit, snapshot.id) : undefined;
                const resolved = resolveAiTranscribeTarget(snapshot, edit);
                const target = resolved && sourcePath
                    ? { ...resolved, relativePath: sourcePath, name: sourcePath.split('/').pop() || sourcePath } : resolved;
                if (this.transcribeKey !== key || this.narrationLoadRevision !== revision) return;
                if (snapshot.kind === 'audio' && editVersion !== (this.narrationEditVersion ?? 0)) {
                    this.transcribeLoading = undefined;
                    if (!this.isDisposed) this.render();
                    return;
                }
                if (snapshot.kind === 'audio') {
                    this.narrationEditSnapshot = { itemId: snapshot.id, editVersion, edit };
                    this.narrationVerified = { itemId: snapshot.id, editVersion };
                    this.narrationPlacementContext = { itemId: snapshot.id, editVersion,
                        tracks: edit.tracks, fps: Number(edit.output?.fps ?? 30) };
                }
                if (snapshot.kind === 'audio') this.narrationSourcePath = sourcePath ?? target?.relativePath;
                const present = target && await this.fileService.exists(root.resolve(target.relativePath));
                this.transcribeTarget = present ? target : undefined;
                if (this.transcribeTarget) {
                    const [summary, sidecars] = await Promise.all([
                        this.layerAudioService.readTranscriptSummary({
                            projectRootUri: root.toString(), relativePath: target.relativePath
                        }),
                        snapshot.kind === 'audio' ? this.layerAudioService.readGenerationSidecars({
                            projectRootUri: root.toString(), ...activeEditRequest(root), sourcePaths: [target.relativePath]
                        }) : Promise.resolve({ entries: [] })
                    ]);
                    if (this.transcribeKey !== key || this.narrationLoadRevision !== revision) return;
                    this.transcribeSummary = summary;
                    this.audioPlanned = sidecars.entries.some(entry => entry.sourcePath === target.relativePath
                        && entry.meta.kind === 'audio' && entry.meta.status === 'planned');
                    if (this.audioPlanned) {
                        this.narrationPlacementNotice = undefined;
                        const state = this.narrationStates?.get(this.aiViewClipKey ?? '');
                        if (state) state.placement = undefined;
                    }
                } else if (snapshot.kind === 'audio') {
                    this.audioPlanned = false;
                }
            } catch { /* Missing media is explained by the panel. */ }
            if (this.transcribeKey === key && this.narrationLoadRevision === revision && !this.isDisposed) this.render();
        })();
        return this.transcribeLoading;
    }

    protected async verifyAiNarrationSource(snapshot: InspectorSnapshot, key: string): Promise<void> {
        if (snapshot.kind !== 'audio') return;
        const editVersion = this.narrationEditVersion ?? 0;
        if (this.narrationVerified?.itemId === snapshot.id && this.narrationVerified.editVersion === editVersion) return;
        this.narrationVerified = { itemId: snapshot.id, editVersion };
        const version = ++this.narrationSourceCheckVersion;
        try {
            const root = this.workspaceService.tryGetRoots()[0]?.resource;
            if (!root) return;
            const edit = JSON.parse((await this.fileService.readFile(currentTimelineEditUri(root))).value.toString());
            const sourcePath = aiNarrationSourcePath(edit, snapshot.id);
            if (version !== this.narrationSourceCheckVersion || this.transcribeKey !== key
                || editVersion !== (this.narrationEditVersion ?? 0)) return;
            this.narrationPlacementContext = { itemId: snapshot.id, editVersion,
                tracks: edit.tracks, fps: Number(edit.output?.fps ?? 30) };
            this.narrationEditSnapshot = { itemId: snapshot.id, editVersion, edit };
            if (!sourcePath || sourcePath === this.narrationSourcePath) {
                if (this.aiView === 'narration' && !this.isDisposed) this.render();
                return;
            }
            this.narrationSourcePath = undefined;
            this.narrationPlacementNotice = undefined;
            const state = this.narrationStates?.get(this.aiViewClipKey ?? '');
            if (state) state.placement = undefined;
            this.transcribeKey = undefined;
            this.transcribeLoading = undefined;
            this.audioPlanned = false;
            if (!this.isDisposed) this.render();
        } catch { this.narrationVerified = undefined; /* A later timeline render can retry after a transient edit read. */ }
    }

    protected async refreshAiTranscript(key: string): Promise<void> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const target = this.transcribeTarget;
        if (!root || !target) return;
        const summary = await this.layerAudioService.readTranscriptSummary({
            projectRootUri: root.toString(), relativePath: target.relativePath
        }).catch((): TranscriptSummary => ({ state: 'none', segments: [], total: 0 }));
        if (this.transcribeKey !== key || this.aiView !== 'transcribe' || this.isDisposed) return;
        if (summary.state === 'done') {
            this.transcribeSummary = summary;
            this.transcribeRunning = false;
            this.transcribePolling = false;
            this.render();
        }
    }

    protected async loadAiNarrationVoices(key: string): Promise<void> {
        const state = this.narrationStates.get(key) ?? initialAiNarrationState(this.narrationEngines);
        this.narrationStates.set(key, state);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) return;
        try {
            if (!state.favorites) {
                const preferred = await this.layerAudioService.readPreferredNarrationRoutes(root.toString());
                if (this.aiViewClipKey !== key) return;
                state.favorites = preferred.favorites;
                state.preferredEngineId = preferred.defaultEngineId;
                const eligible = this.narrationEngines.find(engine => engine.id === preferred.defaultEngineId
                    && (engine.availability.state === 'available' || engine.id === 'voicevox' && engine.availability.state === 'needs'));
                if (eligible && (state.selectedEngineIds?.length ?? 0) <= 1) {
                    state.selectedEngineIds = [eligible.id]; state.engineId = eligible.id;
                }
            }
            await Promise.all((state.selectedEngineIds ?? []).map(async engineId => {
                if (state.voicesByEngine?.[engineId]?.length) return;
                const result = await this.layerAudioService.listNarrationVoices(root.toString(), engineId,
                    engineId === 'irodori' ? this.narrationIrodoriUrl() : undefined);
                if (this.aiViewClipKey === key) chooseAiNarrationVoice(state, result.voices, engineId);
            }));
            if (this.aiViewClipKey === key) this.render();
        } catch (error) { state.error = String(error); if (this.aiViewClipKey === key) this.render(); }
    }

    protected async loadAiNarrationCandidates(key: string, itemId: string): Promise<void> {
        const state = this.narrationStates.get(key) ?? initialAiNarrationState(this.narrationEngines);
        this.narrationStates.set(key, state);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) return;
        try {
            const batch = await this.layerAudioService.readNarrationCandidates({ projectRootUri: root.toString(), itemId });
            if (this.aiViewClipKey !== key) return;
            state.candidates = batch.candidates; state.completed = batch.completed;
            state.running = batch.running;
            if (batch.candidates.length && this.aiView === 'tiles') this.aiView = 'narration';
            this.render();
        } catch { state.candidates = []; }
    }

    protected async startAiNarration(key: string, itemId: string, atSeconds: number, retryEngineId?: string): Promise<void> {
        const state = this.narrationStates.get(key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!state || !root || state.running) return;
        const ids = retryEngineId ? [retryEngineId] : state.selectedEngineIds ?? [];
        const engines = ids.map(id => this.narrationEngines.find(row => row.id === id));
        if (!ids.length || engines.some(engine => !engine || !state.voiceByEngine?.[engine.id])) return;
        const script = state.script, reading = state.reading.trim() || script;
        const approval = narrationBatchConfirm(engines as NarrationEngine[], reading);
        if (approval && !(await new ConfirmDialog(approval).open())) return;
        state.error = undefined; state.cancelled = false; state.running = true; state.completed = 0;
        state.startedAt = Date.now(); state.lastRoutes = [...ids]; state.runningRoutes = [...ids]; this.render();
        if (this.narrationTick) window.clearInterval(this.narrationTick);
        this.narrationTick = window.setInterval(() => {
            if (state.running && this.aiView === 'narration') {
                void this.layerAudioService.readNarrationCandidates({ projectRootUri: root.toString(), itemId }).then(batch => {
                    if (!state.running || this.aiViewClipKey !== key) return;
                    state.completed = batch.completed;
                    state.candidates = batch.candidates;
                    this.render();
                }).catch(() => undefined);
            }
        }, 750);
        try {
            const batch = await this.layerAudioService.startNarrationBatch({ projectRootUri: root.toString(),
                ...activeEditRequest(root), itemId,
                script, reading, t: atSeconds, approved: !!approval,
                routes: ids.map(id => ({ engine: id, voice: state.voiceByEngine![id],
                    profile: id === 'fal-qwen3' ? state.voiceByEngine![id] : undefined,
                    style: id === 'gemini-tts' || id === 'irodori' && state.voiceByEngine![id] === 'custom' ? state.style : undefined,
                    irodoriUrl: id === 'irodori' ? this.narrationIrodoriUrl() : undefined })) });
            if (state.cancelled) return;
            state.completed = batch.completed;
            await this.loadAiNarrationCandidates(key, itemId);
            if (!retryEngineId && ids.length === 1 && batch.candidates[0]?.ok && batch.candidates[0].relativePath) {
                await this.adoptAiNarrationCandidate(key, itemId, batch.candidates[0].relativePath);
            }
        } catch (error) {
            if (!state.cancelled) state.error = error instanceof Error ? error.message : String(error);
        } finally {
            state.running = false;
            state.runningRoutes = undefined;
            if (this.narrationTick) window.clearInterval(this.narrationTick);
            this.narrationTick = undefined;
            if (!this.isDisposed) this.render();
        }
    }

    protected async playAiNarrationCandidate(key: string, relativePath: string): Promise<void> {
        const state = this.narrationStates.get(key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!state || !root) return;
        if (this.narrationAudio) { this.narrationAudio.pause(); this.narrationAudio = undefined; }
        if (state.playingPath === relativePath) { state.playingPath = undefined; this.render(); return; }
        const audio = new Audio(root.resolve(relativePath).toString());
        this.narrationAudio = audio; state.playingPath = relativePath;
        audio.onended = () => { if (this.narrationAudio === audio) { this.narrationAudio = undefined; state.playingPath = undefined; this.render(); } };
        try { await audio.play(); } catch (error) { state.error = String(error); state.playingPath = undefined; }
        this.render();
    }

    protected async adoptAiNarrationCandidate(key: string, itemId: string, relativePath: string): Promise<void> {
        const state = this.narrationStates.get(key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!state || !root) return;
        try {
            const adopted = await this.layerAudioService.adoptNarrationCandidate({ projectRootUri: root.toString(),
                ...activeEditRequest(root), itemId, relativePath });
            const edit = JSON.parse((await this.fileService.readFile(currentTimelineEditUri(root))).value.toString());
            const fps = Number(edit.output?.fps ?? 30);
            const timeline = this.stillWidgetManager.getWidgets('akari-annotations-widget').find(widget => {
                const location = (widget as unknown as { location?: { root?: URI } }).location;
                return !widget.isDisposed && location?.root?.toString() === root.toString();
            }) as unknown as { commitEditMutation?: (label: string, mutate: (doc: any) => any) => Promise<unknown> } | undefined;
            if (!timeline?.commitEditMutation) throw new Error('タイムラインの編集履歴が見つかりません。');
            let label = '';
            await timeline.commitEditMutation('ナレーションを置く', doc => {
                const choice = state.placementChoice ?? 'lower';
                label = planAiNarrationPlacement(doc.tracks, itemId, adopted.durationSeconds, fps, choice).label;
                return placeAiNarration(doc, itemId, adopted.path, adopted.durationSeconds, fps, choice);
            });
            this.narrationEditVersion = (this.narrationEditVersion ?? 0) + 1;
            this.narrationEditSnapshot = undefined; this.narrationVerified = undefined;
            this.narrationPlacementContext = undefined;
            const placedEdit = JSON.parse((await this.fileService.readFile(currentTimelineEditUri(root))).value.toString());
            const sourcePath = aiNarrationSourcePath(placedEdit, itemId);
            this.narrationSourcePath = sourcePath; state.placement = label;
            this.narrationPlacementNotice = sourcePath ? { clipKey: key, sourcePath, label } : undefined;
            this.audioPlanned = false;
            this.narrationSourceCheckVersion = (this.narrationSourceCheckVersion ?? 0) + 1;
            this.narrationLoadRevision = (this.narrationLoadRevision ?? 0) + 1;
            this.transcribeKey = undefined; this.transcribeLoading = undefined;
            this.render();
        } catch (error) { state.error = error instanceof Error ? error.message : String(error); this.render(); }
    }

    protected async cancelAiNarration(key: string, itemId: string): Promise<void> {
        const state = this.narrationStates.get(key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!state || !root) return;
        state.cancelled = true; state.running = false;
        try { await this.layerAudioService.cancelNarrationBatch({ projectRootUri: root.toString(), itemId }); }
        catch (error) { state.error = String(error); }
        this.render();
    }

    protected loadAiCatalog(): Promise<void> {
        if (this.aiCatalogLoaded) return Promise.resolve();
        const workspace = this.workspaceService.tryGetRoots()[0]?.resource.toString();
        if (this.aiCatalogFailed && this.aiCatalogFailureWorkspace === workspace) return Promise.resolve();
        if (this.aiCatalogLoading) return this.aiCatalogLoading;
        this.aiCatalogLoading = (async () => {
            let attemptedWorkspace = workspace;
            try {
                await this.workspaceService.ready;
                const root = this.workspaceService.tryGetRoots()[0]?.resource;
                if (!root) return;
                attemptedWorkspace = root.toString();
                this.aiCatalogFailed = false;
                if (this.generationCatalog.length === 0) {
                    const catalog = await this.layerAudioService.readGenerationCatalog();
                    this.generationCatalog = catalog.models.filter(row => row.kind === 'video') as unknown as GenerationCatalogRow[];
                }
                try {
                    const narration = await this.layerAudioService.listNarrationEngines(root.toString(), this.narrationIrodoriUrl());
                    this.narrationEngines = narration.engines.filter(engine =>
                        ['voicevox', 'gemini-tts', 'irodori'].includes(engine.id)
                        || engine.id === 'fal-qwen3' && engine.availability.state === 'available');
                } catch { this.narrationEngines = []; }
                this.aiCatalogLoaded = true;
                this.render();
            } catch (error) {
                this.aiCatalogFailed = true;
                this.aiCatalogFailureWorkspace = attemptedWorkspace;
                this.showFieldNotice(String(error));
            } finally {
                this.aiCatalogLoading = undefined;
            }
        })();
        return this.aiCatalogLoading;
    }

    protected ensureStillFalEstimate(): void {
        if (this.stillFalEstimate || this.stillFalEstimateLoading) return;
        this.stillFalEstimateError = undefined;
        for (const state of this.aiStillStates.values()) {
            state.falEstimateError = undefined;
        }
        this.stillFalEstimateLoading = this.layerAudioService.readGenerationCatalog().then(catalog => {
            this.stillFalEstimate = catalog.stillEstimate;
            this.stillFalEstimateError = catalog.stillEstimate ? undefined
                : catalog.stillEstimateError ?? '料金表を読めないため見積を出せません';
            const current = this.aiView === 'still' ? this.generationIdentity(this.model.snapshot) : undefined;
            const visibleState = current && this.aiStillStates.get(current.key);
            const shouldRender = !!visibleState && (!visibleState.falEstimate || !!visibleState.falEstimateError);
            for (const state of this.aiStillStates.values()) {
                state.falEstimate = catalog.stillEstimate;
                state.falEstimateError = this.stillFalEstimateError;
            }
            if (shouldRender) this.render();
        }).catch(error => {
            console.warn('[akari-annotations] still estimate read failed:', error);
            this.stillFalEstimateError = '料金表を読めないため見積を出せません';
            for (const state of this.aiStillStates.values()) {
                state.falEstimate = undefined;
                state.falEstimateError = this.stillFalEstimateError;
            }
            if (this.aiView === 'still') this.render();
        }).finally(() => { this.stillFalEstimateLoading = undefined; });
    }

    protected ensureStillState(identity: { key: string; itemId: string; sourcePath: string; duration: number }): AiStillState {
        let state = this.aiStillStates.get(identity.key);
        if (!state) {
            const meta = this.generationTabMeta.get(identity.key) as { inputs?: { prompt?: string;
                reference_images?: Array<{ path: string }>; extra?: { still_batch?: {
                    prompt?: string; aspect?: StillAspect; routes?: ImageRouteState['id'][]; references?: string[];
                    cropToAspect?: boolean; quality?: AiStillState['quality']
                } } }; output?: { aspect?: StillAspect; resolution?: string } } | undefined;
            const saved = savedStillInput(meta);
            const [cardWidth, cardHeight] = String(meta?.output?.resolution ?? '').split('x').map(Number);
            const initialAspect = saved.aspect;
            state = { prompt: saved.prompt, aspect: initialAspect, routeId: savedStillRoute(), probing: true,
                selectedRoutes: new Set(saved.routes), selectionTouched: saved.savedRoutes,
                running: false, references: saved.references.filter(Boolean).map(path => ({ path })),
                cropToAspect: saved.cropToAspect ?? savedStillCrop(),
                quality: saved.quality, falEstimate: this.stillFalEstimate,
                falEstimateError: this.stillFalEstimateError };
            this.aiStillStates.set(identity.key, state);
            const root = this.workspaceService.tryGetRoots()[0]?.resource;
            if (root) {
                this.ensureStillFalEstimate();
                void this.fileService.read(currentTimelineEditUri(root)).then(file => {
                    const output = JSON.parse(file.value.toString()).output;
                    if (this.aiStillStates.get(identity.key) === state && output?.width > 0 && output?.height > 0) {
                        state!.canvas = { width: output.width, height: output.height };
                    }
                    if (this.aiStillStates.get(identity.key) === state && state!.aspect === initialAspect
                        && !meta?.output?.aspect && !(cardWidth > 0 && cardHeight > 0) && output?.width && output?.height) {
                        state!.aspect = nearestStillAspect(output.width, output.height);
                        if (this.aiView === 'still') this.render();
                    }
                }).catch(() => undefined);
            }
            void Promise.resolve().then(() => this.probeStillRoute(identity.key));
            if (root) {
                void this.layerAudioService.readStillPreferredRoutes(root.toString()).then(routes => {
                    if (this.aiStillStates.get(identity.key) !== state) return;
                    if (!state!.selectionTouched) state!.selectedRoutes = new Set(routes);
                    state!.preferencesLoaded = true;
                    if (this.aiView === 'still') this.render();
                }).catch(() => { state!.preferencesLoaded = true; });
                void this.layerAudioService.readStillCandidates({ projectRootUri: root.toString(), ...activeEditRequest(root), itemId: identity.itemId })
                    .then(batch => { if (this.aiStillStates.get(identity.key) === state
                        && (batch.candidates.length || batch.results?.length || batch.running)) {
                        state!.batch = batch; if (this.aiView === 'still' || this.aiView === 'still-result') this.render();
                    } }).catch(() => undefined);
            }
        }
        return state;
    }

    protected appendStillPanel(identity: { key: string; itemId: string; sourcePath: string; duration: number }): void {
        const state = typeof this.ensureStillState === 'function'
            ? this.ensureStillState(identity) : this.aiStillStates.get(identity.key);
        if (!state) return;
        appendAiStillPanel(this.body, state, {
            change: aspect => {
                const current = this.generationIdentity ? this.generationIdentity(this.model.snapshot) : identity;
                const status = this.generationStates.get(identity.key);
                const metaStatus = (this.generationTabMeta.get(identity.key) as { status?: string } | undefined)?.status;
                const known = this.frameAspectPlanned?.get(identity.key)?.has(current?.sourcePath ?? '') ?? false;
                if (aspect && current?.key === identity.key
                    && (metaStatus === 'planned' || metaStatus === undefined
                        && (status === 'planned' || status === undefined && known))) {
                    const planned = this.frameAspectPlanned?.get(identity.key) ?? new Set<string>();
                    planned.add(current.sourcePath);
                    this.frameAspectPlanned?.set(identity.key, planned);
                    void this.setEmptyFrameAspect(current, aspect);
                }
                this.render();
            },
            probe: () => { void this.probeStillRoute(identity.key); },
            generate: () => { void this.startStillGeneration(identity); },
            showResult: () => { this.showStillResult(); },
            addReference: path => { void this.addStillReference(identity.key, path); },
            chooseReference: () => { void this.chooseStillReference(identity.key); },
            captureReference: () => { void this.captureStillReference(identity.key); },
            openConnections: () => { void this.commandRegistry.executeCommand('akari.settings.open', 'connections'); }
        });
    }

    protected showStillResult(): void {
        this.aiView = 'still-result';
        this.rememberedView.scrollTop = 0;
        this.node.scrollTop = 0;
        this.render();
    }

    protected appendStillResultPanel(identity: { key: string; itemId: string; sourcePath: string; duration: number }): void {
        const state = this.ensureStillState(identity);
        const input = state.batchInput ?? { prompt: state.prompt, aspect: state.aspect };
        const candidates = state.batch?.candidates ?? [];
        const inFramePath = candidates.some(row => row.ok && row.relativePath === identity.sourcePath)
            ? identity.sourcePath : undefined;
        appendAiStillResultPanel(this.body, {
            prompt: input.prompt, aspect: input.aspect, batch: state.batch, running: state.running,
            inFramePath, error: state.error,
            actions: {
                home: () => { this.aiView = 'tiles'; this.render(); },
                redo: () => { this.aiView = 'still'; this.render(); },
                toVideo: () => { this.aiView = 'video'; this.render(); },
                cancel: () => { void this.cancelStillGeneration(identity); },
                select: candidate => { if (candidate.relativePath) void this.putStillCandidate(identity, candidate.relativePath); }
            }
        });
    }

    protected async addStillReference(key: string, path: string): Promise<void> {
        const state = this.aiStillStates.get(key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!state || !root) return;
        if (!/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(path) || path.startsWith('/')
            || path.split('/').includes('..')) { state.error = 'プロジェクト内の画像を選んでください。'; this.render(); return; }
        if (state.references?.some(row => row.path === path)) return;
        if ((state.references?.length ?? 0) >= maxStillReferences) { state.error = `参照画像は ${maxStillReferences} 枚までです。`; this.render(); return; }
        try {
            const file = await this.fileService.readFile(root.resolve(path));
            const bytes = file.value.buffer;
            const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
            const extension = path.split('.').pop()?.toLowerCase();
            const mime = extension === 'jpg' ? 'jpeg' : extension === 'svg' ? 'svg+xml' : extension;
            state.references ??= [];
            state.references.push({ path, thumbnail: `data:image/${mime};base64,${btoa(binary)}` });
            state.choosingReference = false;
            state.error = undefined;
            if (stillRouteAvailability(state.routeId ?? 'codex', state.references.length).disabled) state.routeId = 'codex';
        } catch { state.error = '参照画像を読み込めませんでした。'; }
        this.render();
    }

    protected async chooseStillReference(key: string): Promise<void> {
        const state = this.aiStillStates.get(key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!state || !root) return;
        try {
            const paths: string[] = [];
            const walk = async (uri: URI): Promise<void> => {
                const node = await this.fileService.resolve(uri);
                for (const child of node.children ?? []) {
                    if (child.isDirectory) await walk(child.resource);
                    else if (/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(child.resource.path.base)) {
                        const relative = root.relative(child.resource)?.toString();
                        if (relative) paths.push(relative);
                    }
                }
            };
            await walk(root.resolve('assets'));
            state.availableReferences = paths.sort();
            state.choosingReference = !state.choosingReference;
            state.error = paths.length ? undefined : 'プロジェクトに画像素材がありません。';
        } catch { state.error = '素材の一覧を読み込めませんでした。'; }
        this.render();
    }

    protected async captureStillReference(key: string): Promise<void> {
        const state = this.aiStillStates.get(key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!state || !root) return;
        try {
            const editUri = currentTimelineEditUri(root);
            await this.commandRegistry.executeCommand('akari.preview.ensureVisible', { editUri: editUri.toString() });
            const playhead = Number(await this.commandRegistry.executeCommand<string | number>('akari.timeline.playhead'));
            if (Number.isFinite(playhead) && playhead >= 0) await this.commandRegistry.executeCommand('akari.preview.seekOutput',
                { editUri: editUri.toString(), time: playhead, waitForReady: true });
            const saved = await this.commandRegistry.executeCommand<{ path: string }>(
                'akari.preview.captureFrame', { editUri: editUri.toString() });
            if (!saved?.path) throw new Error('コマを保存できませんでした。');
            await this.addStillReference(key, saved.path);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            state.error = reason.startsWith('コマを保存できませんでした') ? reason : `コマを保存できませんでした: ${reason}`;
            this.render();
        }
    }

    protected async setEmptyFrameAspect(identity: { key: string; itemId: string; sourcePath: string }, aspect: StillAspect): Promise<void> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const state = this.aiStillStates.get(identity.key);
        if (!root || !state) return;
        let live = this.frameAspectLive.get(identity.key);
        if (!live) this.frameAspectLive.set(identity.key, live = new FrameAspectLive(identity.sourcePath));
        if (live.observeSource(identity.sourcePath)) {
            this.generationTabMeta.delete(identity.key);
            this.generationLoads.delete(identity.key);
        }
        const sourceEpoch = live.sourceEpoch;
        const revision = live.press(aspect, state.canvas, this.model.snapshot?.kind === 'cut'
            || this.model.snapshot?.kind === 'layer' || this.model.snapshot?.kind === 'item'
            ? this.model.snapshot.transform : undefined);
        const snapshot = this.model.snapshot;
        const target = snapshot?.kind === 'cut' && snapshot.itemId === identity.itemId
            ? { kind: 'cut' as const, index: snapshot.index }
            : (snapshot?.kind === 'layer' || snapshot?.kind === 'item') && snapshot.id === identity.itemId
                ? { kind: 'item' as const, id: identity.itemId } : undefined;
        if (target) this.frameAspectTargets.set(identity.key, target);
        const sendLive = (): void => {
            if (live!.revision === revision) this.sendFrameAspectLive(identity.key, live!);
        };
        sendLive();
        if (!state.canvas && this.fileService?.readFile) {
            void this.fileService.readFile(currentTimelineEditUri(root)).then(file => {
                const output = JSON.parse(file.value.toString()).output;
                if (live!.sourceEpoch !== sourceEpoch || this.aiStillStates.get(identity.key) !== state
                    || !Number.isSafeInteger(output?.width) || !Number.isSafeInteger(output?.height)
                    || output.width < 1 || output.height < 1) return;
                state.canvas = { width: output.width, height: output.height };
                live!.setCanvas(state.canvas);
                this.sendFrameAspectLive(identity.key, live!);
            }).catch(() => undefined);
        }
        if (!live.sourceSize) void this.ensureFrameSourceSize(identity.key, identity.sourcePath);
        const clearLive = (): void => {
            if (live!.revision !== revision) return;
            const hadLive = !!live!.live();
            const current = this.model.snapshot;
            const transform = current?.kind === 'cut' || current?.kind === 'layer' || current?.kind === 'item'
                ? current.transform : undefined;
            live!.resetDesired(transform);
            if (!target || !hadLive || this.generationIdentity(current)?.key !== identity.key) return;
            this.model.requestLivePreview?.({ target, values: {
                scaleX: transform?.scaleX ?? transform?.scale ?? 1,
                scaleY: transform?.scaleY ?? transform?.scale ?? 1
            }, clear: true });
        };
        const previousWrite = this.frameAspectWrites.get(identity.key);
        let releaseWrite!: () => void;
        const writeDone = new Promise<void>(resolve => { releaseWrite = resolve; });
        this.frameAspectWrites.set(identity.key, writeDone);
        let committed = false;
        try {
            if (previousWrite) await previousWrite;
            const selectedBefore = this.generationIdentity(this.model.snapshot);
            if (live.sourceEpoch !== sourceEpoch || selectedBefore?.key !== identity.key
                || selectedBefore.sourcePath !== live.sourcePath) return;
            const playhead = Number(await this.commandRegistry.executeCommand<string | number>('akari.timeline.playhead'));
            const result = await this.layerAudioService.setEmptyFrameAspect({ projectRootUri: root.toString(),
                ...activeEditRequest(root),
                itemId: identity.itemId, aspect });
            const selectedAfter = this.generationIdentity(this.model.snapshot);
            if (live.sourceEpoch !== sourceEpoch || selectedAfter?.key !== identity.key
                || selectedAfter.sourcePath !== live.sourcePath) return;
            const planned = this.frameAspectPlanned?.get(identity.key) ?? new Set<string>();
            planned.add(result.relativePath);
            this.frameAspectPlanned?.set(identity.key, planned);
            const timeline = this.stillWidgetManager.getWidgets('akari-annotations-widget').find(widget => {
                const location = (widget as unknown as { location?: { root?: URI } }).location;
                return !widget.isDisposed && location?.root?.toString() === root.toString();
            }) as unknown as { commitEditMutation?: (label: string, mutate: (doc: any) => any) => Promise<unknown> } | undefined;
            if (!timeline?.commitEditMutation) throw new Error('タイムラインの編集履歴が見つかりません。');
            live.expectSource(result.relativePath, { width: result.width, height: result.height }, result.transform);
            await timeline.commitEditMutation('空の枠の画角を変更', doc => {
                replaceStillInEdit(doc, identity.itemId, result.relativePath);
                const item = doc.tracks.flatMap((track: any) => track.items ?? []).find((row: any) => row.id === identity.itemId);
                if (result.transform) item.transform = result.transform;
                return doc;
            });
            committed = true;
            this.generationTabMeta.delete(identity.key);
            this.generationStates.delete(identity.key);
            try {
                if (Number.isFinite(playhead) && playhead >= 0) {
                    const editUri = currentTimelineEditUri(root).normalizePath().toString();
                    await this.commandRegistry.executeCommand('akari.preview.seekOutput', {
                        editUri, time: playhead, waitForReady: true
                    });
                    const restored = Number(await this.commandRegistry.executeCommand<string | number>('akari.timeline.playhead'));
                    if (!Number.isFinite(restored) || Math.abs(restored - playhead) > 1e-3) {
                        await this.commandRegistry.executeCommand('akari.timeline.seek', { seconds: playhead });
                    }
                }
            } finally {
                const current = this.generationIdentity(this.model.snapshot);
                if (live.sourceEpoch === sourceEpoch && current?.key === identity.key
                    && current.sourcePath === result.relativePath) {
                    live.adoptSource(result.relativePath, { width: result.width, height: result.height }, result.transform);
                    this.sendFrameAspectLive(identity.key, live);
                }
            }
            const current = this.generationIdentity(this.model.snapshot);
            if (current) void this.loadGeneration(current);
        } catch (error) {
            live.cancelExpectedSource();
            if (live.revision === revision) {
                state.error = error instanceof Error ? error.message : String(error);
                this.render();
            }
        } finally {
            if (!committed) clearLive();
            releaseWrite();
            if (this.frameAspectWrites.get(identity.key) === writeDone) this.frameAspectWrites.delete(identity.key);
        }
    }

    protected sendFrameAspectLive(key: string, live: FrameAspectLive): void {
        const current = this.generationIdentity(this.model.snapshot);
        if (current?.key !== key || current.sourcePath !== live.sourcePath) return;
        const target = this.frameAspectTargets.get(key);
        const values = live.live();
        if (!target || !values) return;
        this.model.requestLivePreview?.({ target, values: { scaleX: values.scaleX, scaleY: values.scaleY } });
    }

    protected async ensureFrameSourceSize(key: string, sourcePath: string): Promise<void> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) return;
        const size = await this.readFrameSourceSize(root, sourcePath);
        const live = this.frameAspectLive.get(key);
        if (size && live?.resolveSource(sourcePath, size)) this.sendFrameAspectLive(key, live);
    }

    protected async readFrameSourceSize(root: URI, sourcePath: string): Promise<FrameSize | undefined> {
        try {
            const meta = JSON.parse((await this.fileService.readFile(root.resolve(`${sourcePath}.meta.json`))).value.toString());
            const size = frameSizeFromResolution(meta?.output?.resolution);
            if (size) return size;
        } catch { /* A missing sidecar falls through to the PNG header. */ }
        try {
            return frameSizeFromPng((await this.fileService.readFile(root.resolve(sourcePath))).value.buffer);
        } catch { return undefined; }
    }

    protected async probeStillRoute(key: string): Promise<void> {
        const state = this.aiStillStates.get(key);
        if (!state || state.probingRoutes?.size) return;
        if (!this.stillFalEstimate) this.ensureStillFalEstimate();
        state.probing = true;
        const probingRoutes = new Set(stillRouteIds);
        state.probingRoutes = probingRoutes;
        if (this.aiView === 'still') this.render();
        await Promise.all(stillRouteIds.map(async id => {
            try {
                const [route] = await this.layerAudioService.probeImageRoutes([id]);
                if (!route || route.id !== id) throw new Error('状態を取得できませんでした');
                state.routes = [...(state.routes ?? []).filter(row => row.id !== id), route];
            } catch {
                state.routes = [...(state.routes ?? []).filter(row => row.id !== id),
                    { id, state: 'missing', detail: '確かめられませんでした' }];
            } finally {
                probingRoutes.delete(id);
                if (!probingRoutes.size) state.probing = false;
                if (this.aiView === 'still') this.render();
            }
        }));
    }

    protected async startStillGeneration(identity: { key: string; itemId: string; sourcePath: string },
        onlyRoutes?: ImageRouteState['id'][], sameInput?: NonNullable<AiStillState['batchInput']>): Promise<void> {
        const state = this.aiStillStates.get(identity.key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const routes = onlyRoutes ?? [...(state?.selectedRoutes ?? [])];
        if (!state || !root) return;
        const input = sameInput ?? { prompt: state.prompt, aspect: state.aspect,
            references: state.references?.map(row => row.path) ?? [], cropToAspect: state.cropToAspect !== false,
            quality: state.quality ?? 'high' };
        if (state.running || routes.some(route => state.probingRoutes?.has(route))
            || !routes.length || !input.prompt.trim()
            || routes.some(route => stillRouteAvailability(route, input.references.length).disabled
                || !['ready', 'unknown'].includes(state.routes?.find(row => row.id === route)?.state ?? ''))) return;
        if (routes.includes('fal') && !state.falEstimate) {
            state.falEstimateError ??= '料金表を読めないため見積を出せません';
            this.render();
            return;
        }
        const estimate = routes.includes('fal') ? state.falEstimate!.prices[input.quality] : 0;
        if (estimate > 0) {
            const approved = await new ConfirmDialog({ title: '費用承認',
                msg: `${routes.length} 案を同時に作ります。合計見積もり $${estimate.toFixed(3)}（as_of ${state.falEstimate!.asOf}・1024² 基準）。費用承認しますか`,
                ok: '費用承認する', cancel: 'キャンセル' }).open();
            if (!approved) return;
        }
        state.running = true;
        state.startedAt = Date.now();
        state.error = undefined;
        state.mismatch = undefined;
        state.croppedNotice = undefined;
        state.batchInput = input;
        state.timelineProgressKey = undefined;
        state.polling = false;
        state.lastPolledAt = undefined;
        state.batch = { routes, completed: 0, candidates: state.batch?.candidates.filter(row => row.ok) ?? [],
            results: [], running: true };
        if (this.generationIdentity?.(this.model.snapshot)?.itemId === identity.itemId) this.showStillResult();
        this.renderStillProgress();
        if (this.aiStillTick) window.clearInterval(this.aiStillTick);
        this.aiStillTick = window.setInterval(() => {
            if (!state.running) return;
            const elapsed = Math.max(0, Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000));
            for (const row of Array.from(this.node.querySelectorAll<HTMLElement>('[data-akari-inspector-ai-progress-state="running"]'))) {
                const route = row.getAttribute('data-akari-inspector-ai-progress-route') as ImageRouteState['id'] | null;
                if (!route) continue;
                if (row.getAttribute('data-akari-inspector-ai-progress-elapsed') === String(elapsed)) continue;
                row.setAttribute('data-akari-inspector-ai-progress-elapsed', String(elapsed));
                row.textContent = `◌ ${stillRouteLabel(route)} · ${elapsed} 秒`;
            }
            if (state.polling || Date.now() - (state.lastPolledAt ?? 0) < 1000) return;
            state.lastPolledAt = Date.now();
            state.polling = true;
            state.pollingPromise = this.layerAudioService.readStillCandidates({ projectRootUri: root.toString(), ...activeEditRequest(root), itemId: identity.itemId,
                includeThumbnails: false })
                .then(async batch => { if (state.running) {
                    const previous = state.batch;
                    const summary = (value: typeof batch | undefined): string => JSON.stringify([
                        value?.running, value?.routes, value?.completed,
                        value?.candidates.map(row => [row.relativePath, row.route, row.ok]),
                        value?.results?.map(row => [row.route, row.ok, row.relativePath, row.reason])
                    ]);
                    const changed = summary(previous) !== summary(batch);
                    if (!changed) return;
                    const newSuccess = batch.results?.some(row => row.ok && row.relativePath
                        && !previous?.results?.some(old => old.relativePath === row.relativePath));
                    state.batch = batch;
                    this.renderStillProgress();
                    this.refreshStillTimelineProgress?.(root, state, batch);
                    if (newSuccess) {
                        const full = await this.layerAudioService.readStillCandidates({ projectRootUri: root.toString(), ...activeEditRequest(root), itemId: identity.itemId });
                        if (!state.running) return;
                        state.batch = full;
                        this.renderStillProgress();
                    }
                } }).catch(error => console.warn('[akari-still] 候補の進捗を読めませんでした', error))
                .finally(() => { state.polling = false; state.pollingPromise = undefined; });
        }, 100);
        try {
            const completed = await this.layerAudioService.startGenerateStillBatch({ projectRootUri: root.toString(),
                ...activeEditRequest(root),
                itemId: identity.itemId, prompt: input.prompt, aspect: input.aspect, routes,
                references: input.references, cropToAspect: input.cropToAspect,
                quality: input.quality, approved: estimate > 0 });
            if (this.aiStillTick) window.clearInterval(this.aiStillTick);
            this.aiStillTick = undefined;
            if (state.pollingPromise) await state.pollingPromise;
            if (!state.running) return;
            const first = firstSuccessfulStillCandidate(completed);
            if (first?.relativePath) await this.putStillCandidate(identity, first.relativePath, root);
            const saved = await this.layerAudioService.readStillCandidates({ projectRootUri: root.toString(), ...activeEditRequest(root), itemId: identity.itemId });
            state.batch = { ...saved, routes, completed: routes.length, running: false };
            this.refreshStillTimelineProgress?.(root, state, state.batch);
            this.generationTabMeta.delete(identity.key);
            this.generationStates.delete(identity.key);
            const current = this.generationIdentity(this.model.snapshot);
            if (current?.itemId === identity.itemId) void this.loadGeneration(current);
        } catch (error) {
            state.error = error instanceof Error ? error.message : String(error);
        } finally {
            state.running = false;
            if (this.aiStillTick) window.clearInterval(this.aiStillTick);
            this.aiStillTick = undefined;
            this.renderStillProgress();
        }
    }

    protected renderStillProgress(): void {
        if (this.aiView !== 'still' && this.aiView !== 'still-result') return;
        this.render();
    }

    protected refreshStillTimelineProgress(root: URI, state: AiStillState,
        batch: import('../common/akari-annotations-protocol').StillCandidateBatch): void {
        const key = `${batch.running}:${batch.routes.join(',')}:${batch.completed}:${batch.candidates.filter(row => row.ok).length}`;
        if (state.timelineProgressKey === key) return;
        state.timelineProgressKey = key;
        const timeline = this.stillWidgetManager.getWidgets('akari-annotations-widget').find(widget => {
            const location = (widget as unknown as { location?: { root?: URI } }).location;
            return !widget.isDisposed && location?.root?.toString() === root.toString();
        }) as unknown as { reloadGenerationSidecars?: () => Promise<void> } | undefined;
        void timeline?.reloadGenerationSidecars?.();
    }

    protected async putStillCandidate(identity: { key: string; itemId: string }, relativePath: string,
        root = this.workspaceService.tryGetRoots()[0]?.resource): Promise<void> {
        const state = this.aiStillStates.get(identity.key);
        if (!root || !relativePath) return;
        const timeline = this.stillWidgetManager.getWidgets('akari-annotations-widget').find(widget => {
            const location = (widget as unknown as { location?: { root?: URI } }).location;
            return !widget.isDisposed && location?.root?.toString() === root.toString();
        }) as unknown as { commitEditMutation?: (label: string, mutate: (doc: any) => any) => Promise<unknown> } | undefined;
        if (!timeline?.commitEditMutation) {
            if (state) state.error = 'タイムラインの編集履歴が見つかりません。';
            this.render();
            return;
        }
        try {
            let result: { result?: { committed?: boolean } } | undefined;
            for (let attempt = 0; attempt < 4; attempt++) {
                try {
                    result = (await timeline.commitEditMutation('静止画を入れる',
                        doc => placeStillInEdit(doc, identity.itemId, relativePath))) as typeof result;
                    break;
                } catch (error) {
                    const code = (error as { code?: string })?.code;
                    if (attempt === 3 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')
                        && !/\b(?:EPERM|EBUSY|EACCES)\b/u.test(String(error))) throw error;
                    await new Promise(resolve => setTimeout(resolve, 120 * (attempt + 1)));
                }
            }
            if (result?.result?.committed === false) return;
            this.generationTabMeta.delete(identity.key);
            this.generationStates.delete(identity.key);
            const current = this.generationIdentity(this.model.snapshot);
            if (current?.itemId === identity.itemId) void this.loadGeneration(current);
            this.render();
        } catch (error) {
            if (state) state.error = error instanceof Error ? error.message : String(error);
            this.render();
        }
    }

    protected async cancelStillGeneration(identity: { key: string; itemId: string }): Promise<void> {
        const state = this.aiStillStates.get(identity.key);
        if (!state?.running) return;
        state.running = false;
        if (this.aiStillTick) window.clearInterval(this.aiStillTick);
        this.aiStillTick = undefined;
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (root) await this.layerAudioService.cancelGenerateStill({ projectRootUri: root.toString(), itemId: identity.itemId });
        this.render();
    }

    protected generationIdentity(snapshot: TimelineSelectionModel['snapshot']): {
        key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string;
    } | undefined {
        if (!snapshot || snapshot.kind === 'multi') return undefined;
        if (snapshot.kind === 'cut') {
            if (!snapshot.itemId || !snapshot.sourcePath || (this.generationDone?.get(snapshot.itemId)?.sourcePath !== snapshot.sourcePath
                && !/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(snapshot.sourcePath)
                && !/^assets\/generated\/[^/]+\.mp4$/u.test(snapshot.sourcePath)
                && !/^assets\/generated\/candidates\/[^/]+\/[^/]+\.mp4$/u.test(snapshot.sourcePath))) return undefined;
            return {
                key: snapshot.itemId, itemId: snapshot.itemId, sourcePath: snapshot.sourcePath,
                duration: Math.max(0, snapshot.outputEnd - snapshot.outputStart), sourceId: snapshot.src
            };
        }
        if (snapshot.kind === 'layer' && snapshot.sourceKind === 'media' && snapshot.src
            && (this.generationDone?.get(snapshot.id)?.sourcePath === snapshot.src || /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(snapshot.src)
                || /^assets\/generated\/[^/]+\.mp4$/u.test(snapshot.src)
                || /^assets\/generated\/candidates\/[^/]+\/[^/]+\.mp4$/u.test(snapshot.src))) {
            return { key: snapshot.id, itemId: snapshot.id, sourcePath: snapshot.src, duration: snapshot.duration };
        }
        if (snapshot.kind === 'item' && snapshot.sourceKind === 'media') {
            const path = snapshot.sourcePath ?? snapshot.src;
            if (path && (/^assets\/generated\/.+\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(path)
                || /^assets\/generated\/(?:candidates\/[^/]+\/)?[^/]+\.mp4$/u.test(path))) {
                return { key: snapshot.id, itemId: snapshot.id, sourcePath: path, duration: snapshot.duration };
            }
        }
        return undefined;
    }

    protected appendGenerationProvenance(snapshot: InspectorSnapshot,
        identity: { key: string; itemId: string; sourcePath: string; duration: number } | undefined, clipKey: string): void {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const sourcePath = identity?.sourcePath ?? (snapshot.kind === 'audio' ? this.narrationSourcePath : undefined);
        if (!root || !sourcePath || sourcePath.startsWith('/') || sourcePath.split('/').includes('..')) return;
        const key = `${root.toString()}#${sourcePath}`;
        if (!this.generationProvenanceMeta.has(key) && !this.generationProvenanceLoads.has(key)) {
            this.generationProvenanceLoads.add(key);
            void this.layerAudioService.readGenerationProvenance({
                projectRootUri: root.toString(), sourcePath
            }).then(result => {
                this.generationProvenanceMeta.set(key, result.meta);
            }).catch(() => this.generationProvenanceMeta.set(key, undefined)).finally(() => {
                this.generationProvenanceLoads.delete(key);
                if (!this.isDisposed && this.currentTab === 'info') this.render();
            });
        }
        const meta = this.generationProvenanceMeta.get(key);
        const details = generationProvenance(meta, modelId => {
            const row = this.generationCatalog.find(candidate => candidate.id === modelId);
            const shelf = generationModelShelf.models.find(candidate => candidate.id === modelId.replace(/:tts$/u, ''));
            return row ? videoModelName(row) : shelf?.name ?? shelf?.family ?? modelId;
        }, (voiceId, engineId) => {
            if (!engineId) return undefined;
            const state = this.narrationStates.get(clipKey) ?? initialAiNarrationState(this.narrationEngines);
            this.narrationStates.set(clipKey, state);
            const voices = state.voicesByEngine?.[engineId];
            const voiceKey = `${root.toString()}#${clipKey}#${engineId}`;
            if (!voices && !this.generationProvenanceVoiceLoads.has(voiceKey)) {
                this.generationProvenanceVoiceLoads.add(voiceKey);
                void this.layerAudioService.listNarrationVoices(root.toString(), engineId,
                    engineId === 'irodori' ? this.narrationIrodoriUrl() : undefined).then(result => {
                    state.voicesByEngine ??= {};
                    state.voicesByEngine[engineId] = result.voices;
                    if (!this.isDisposed && this.currentTab === 'info') this.render();
                }).catch(() => undefined).finally(() => this.generationProvenanceVoiceLoads.delete(voiceKey));
            }
            return voices?.find(voice => voice.id === voiceId)?.label;
        });
        if (!details) return;
        const section = document.createElement('section');
        section.className = 'akari-inspector-section';
        section.setAttribute('data-akari-generation-provenance', details.kind);
        const title = document.createElement('div');
        title.className = 'akari-inspector-section-header';
        title.style.fontWeight = '600';
        title.textContent = '作り方';
        section.appendChild(title);
        for (const row of details.rows) {
            const line = document.createElement('div');
            line.className = 'akari-inspector-field';
            line.style.cssText = 'display:grid;grid-template-columns:100px minmax(0,1fr);gap:8px;padding:5px 0';
            line.setAttribute('data-akari-generation-provenance-row', row.key);
            const label = document.createElement('span');
            label.textContent = row.label;
            label.style.color = 'var(--akari-muted)';
            const value = document.createElement('span');
            value.textContent = row.value;
            value.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;user-select:text';
            if (row.key === 'model' && details.modelId) {
                const shelf = generationModelShelf.models.find(candidate => candidate.id === details.modelId!.replace(/:tts$/u, ''));
                value.prepend(stillMakerBadge(shelf?.maker ?? (details.kind === 'video'
                    ? videoMakerId(details.modelId) : details.modelId.split(':')[0]), true));
            }
            if (row.referencePath && /\.(?:png|jpe?g|webp|gif)$/iu.test(row.referencePath)) {
                const thumbnail = document.createElement('img');
                thumbnail.alt = row.value;
                thumbnail.style.cssText = 'display:block;max-width:96px;max-height:54px;object-fit:contain;margin-top:4px';
                value.appendChild(thumbnail);
                void this.generationThumbnail(row.referencePath).then(src => {
                    if (src && thumbnail.isConnected) thumbnail.src = src;
                }).catch(() => undefined);
            }
            line.append(label, value);
            section.appendChild(line);
        }
        const redo = document.createElement('button');
        redo.type = 'button';
        redo.className = 'theia-button secondary';
        redo.textContent = 'この作り方で作り直す';
        redo.setAttribute('data-akari-generation-provenance-regenerate', details.kind);
        redo.addEventListener('click', () => {
            this.aiViewClipKey = clipKey;
            if (details.kind === 'video' && identity) {
                const draft = generationDraftFromDone(meta);
                if (!draft) return;
                this.generationDrafts.set(identity.key, draft);
                this.generationTabDrafts.set(identity.key, draft);
                this.generationFinal.delete(identity.key);
                void this.validateGenerationDraft(identity.key).then(() => {
                    this.explicitTabId = 'edit'; this.aiView = 'video'; this.render();
                });
            } else if (details.kind === 'image' && identity) {
                const source = meta as { inputs?: { prompt?: string; reference_images?: Array<{ path: string }> };
                    output?: { aspect?: StillAspect; resolution?: string } };
                const state = this.aiStillStates.get(identity.key);
                if (state) {
                    state.prompt = source.inputs?.prompt ?? '';
                    const [width, height] = String(source.output?.resolution ?? '').split('x').map(Number);
                    state.aspect = source.output?.aspect ?? (width > 0 && height > 0
                        ? nearestStillAspect(width, height) : state.aspect);
                    state.references = (source.inputs?.reference_images ?? []).filter(ref => !!ref?.path).map(ref => ({ path: ref.path }));
                } else {
                    this.generationTabMeta.set(identity.key, source as unknown as { next?: { status?: unknown } });
                }
                this.explicitTabId = 'edit'; this.aiView = 'still'; this.render();
            } else if (details.kind === 'audio' && snapshot.kind === 'audio') {
                const source = meta as { inputs?: { script?: string; text?: string; prompt?: string; voice_id?: string; voice?: string };
                    model?: { id?: string }; route?: string; voice?: string };
                const state = this.narrationStates.get(clipKey) ?? initialAiNarrationState(this.narrationEngines);
                state.script = source.inputs?.script ?? source.inputs?.text ?? source.inputs?.prompt ?? '';
                state.engineId = source.route ?? source.model?.id?.replace(/:tts$/u, '') ?? state.engineId;
                state.voiceId = source.voice ?? source.inputs?.voice_id ?? source.inputs?.voice ?? state.voiceId;
                state.selectedEngineIds = [state.engineId];
                state.voiceByEngine = { ...state.voiceByEngine, [state.engineId]: state.voiceId };
                state.favorites ??= [];
                this.narrationStates.set(clipKey, state);
                this.explicitTabId = 'edit'; this.aiView = 'narration'; this.render();
                void this.loadAiNarrationVoices(clipKey);
            }
        });
        section.appendChild(redo);
        this.body.appendChild(section);
    }

    protected async loadGeneration(identity: { key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string }): Promise<void> {
        this.generationLoads.add(identity.key);
        try {
            await this.workspaceService.ready;
            const root = this.workspaceService.tryGetRoots()[0]?.resource;
            if (!root) {
                if (identity.key.startsWith('material:')) throw new Error('プロジェクトが開かれていません。');
                return;
            }
            if (this.generationCatalog.length === 0) {
                const [catalog, defaults] = await Promise.all([
                    this.layerAudioService.readGenerationCatalog(),
                    this.layerAudioService.readGenerationDefaults({ projectRootUri: root.toString() })
                ]);
                this.generationCatalog = catalog.models.filter(row => row.kind === 'video') as unknown as GenerationCatalogRow[];
                this.generationDefaultModel = defaults.video || 'fal:h3-i2v';
            }
            this.aiCatalogLoaded = true;
            const sidecars = await this.layerAudioService.readGenerationSidecars({
                projectRootUri: root.toString(), ...activeEditRequest(root), sourcePaths: [identity.sourcePath]
            });
            const snapshot = this.model.snapshot;
            const selectedId = snapshot?.kind === 'cut' ? snapshot.itemId : snapshot?.kind === 'layer' ? snapshot.id : undefined;
            const selectedPath = snapshot?.kind === 'cut' ? snapshot.sourcePath : snapshot?.kind === 'layer' ? snapshot.src : undefined;
            if (!identity.key.startsWith('material:') && selectedId === identity.itemId && selectedPath !== identity.sourcePath) return;
            const normalize = (path: string): string => path.trim().replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
            const sourceMeta = sidecars.entries.find(entry => normalize(entry.sourcePath) === normalize(identity.sourcePath))?.meta;
            if (sourceMeta?.status === 'planned') {
                const planned = this.frameAspectPlanned?.get(identity.key) ?? new Set<string>();
                planned.add(identity.sourcePath);
                this.frameAspectPlanned?.set(identity.key, planned);
            } else if (sourceMeta?.status) this.frameAspectPlanned?.get(identity.key)?.delete(identity.sourcePath);
            let stillCandidateCount = 0;
            const compareJob = sourceMeta?.job as { provider?: string; candidates?: number;
                results?: Array<{ ok?: boolean; path?: string }> } | undefined;
            if ((typeof aiGenerationKindFor === 'function'
                ? aiGenerationKindFor(sourceMeta as Parameters<typeof aiGenerationKindFor>[0])
                : sourceMeta?.kind === 'still' ? 'still' : 'video') === 'still') {
                stillCandidateCount = Math.max(compareJob?.candidates ?? 0,
                    compareJob?.results?.filter(result => result.ok && result.path).length ?? 0);
                if (!stillCandidateCount) {
                    try {
                        const batch = await this.layerAudioService.readStillCandidates({ projectRootUri: root.toString(),
                            ...activeEditRequest(root), itemId: identity.itemId, includeThumbnails: false });
                        stillCandidateCount = batch.candidates.filter(candidate => candidate.ok).length;
                    } catch { /* The sidecar status still determines the initial view. */ }
                }
            }
            this.generationTabMeta.set(identity.key, { ...sourceMeta, stillCandidateCount });
            let draft = sourceMeta?.kind === 'video' && sourceMeta.candidate_of === identity.itemId
                ? undefined : generationFields.fromMeta(sourceMeta);
            if (/\.(?:mp4|mov|webm|m4v)$/iu.test(identity.sourcePath)) {
                const originalMeta = await this.readGenerationOriginalNext(sourceMeta, identity.itemId);
                if (sourceMeta?.kind === 'video') this.generationDone.set(identity.key, { sourcePath: identity.sourcePath, meta: sourceMeta, originalMeta });
                else this.generationDone.delete(identity.key);
                const original = generationFields.fromMeta(originalMeta);
                if (sourceMeta?.kind === 'video') {
                    try {
                        const uri = root.resolve(`.akari/generation/${identity.itemId}.inputs.json`);
                        const saved = JSON.parse((await this.fileService.read(uri)).value.toString());
                        draft ??= saved?.kind === 'video' && saved.status === 'planned' && saved.model?.id
                            ? { modelId: saved.model.id, inputs: { ...saved.inputs }, output: { ...saved.output } }
                            : undefined;
                    } catch { /* First regeneration uses the selected candidate's own inputs. */ }
                    draft ??= generationFields.fromMeta(sourceMeta);
                    draft ??= generationDraftFromDone(sourceMeta);
                }
                draft ??= original;
                if (!draft || sourceMeta?.kind !== 'video') {
                    this.generationDrafts.delete(identity.key);
                    this.generationStates.set(identity.key, 'done');
                    if (this.generationIdentity(this.model.snapshot)?.key === identity.key) this.render();
                    return;
                }
            } else {
                this.generationDone?.delete(identity.key);
                this.generationFinal?.delete(identity.key);
            }
            if (!draft) {
                try {
                    const uri = root.resolve(`.akari/generation/${identity.itemId}.inputs.json`);
                    const parsed = JSON.parse((await this.fileService.read(uri)).value.toString()) as GenerationDraft;
                    if (parsed && typeof parsed === 'object' && typeof parsed.modelId === 'string') draft = parsed;
                } catch { /* A missing legacy draft is the normal first-open state. */ }
            }
            if (!identity.key.startsWith('material:')) await this.loadGenerationNeighbors(identity);
            const model = this.generationCatalog.find(row => row.id === draft?.modelId)
                ?? this.generationCatalog.find(row => row.id === this.generationDefaultModel)
                ?? this.generationCatalog[0];
            if (!model) throw new Error('動画生成モデルがカタログにありません。');
            if (identity.key.startsWith('material:') && Number(draft?.output.duration_s) > 0) {
                identity.duration = Number(draft!.output.duration_s);
            }
            if (!draft) draft = {
                modelId: model.id,
                inputs: {
                    prompt: null, negative_prompt: null,
                    first_frame: sourceMeta?.status === 'planned' || model.inputs.first_frame === 'none'
                        ? null : { path: identity.sourcePath, source_id: identity.sourceId ?? null },
                    last_frame: null, reference_images: [], reference_videos: [], reference_audios: [], source_video: null, camera: null, seed: null, extra: {}
                },
                output: {
                    duration_s: identity.duration,
                    resolution: model.resolutions?.[0] ?? null,
                    audio_out: model.audio_out === false ? false : true
                }
            };
            generationFields.rememberReferences(draft.inputs, this.generationDrafts.get(identity.key)?.inputs, `${root.toString()}#${identity.itemId}`);
            const side = generationFields.modelSide(model);
            if (side) draft.inputs.frames_or_refs = side;
            else delete draft.inputs.frames_or_refs;
            draft.output.duration_s = identity.duration;
            this.generationDrafts.set(identity.key, draft);
            // render()'s legacy observer sees the same revision, so it never starts a second read.
            this.generationTabDrafts.set(identity.key, draft);
            this.generationTabLoads.delete(identity.key);
            await this.validateGenerationDraft(identity.key);
            const meta = selectGenerationSidecarForSource(identity.sourcePath, sidecars.entries, Date.now())?.meta;
            let state = typeof meta?.status === 'string' ? meta.status : 'none';
            const job = meta?.job as { started_at?: string; stale_after_s?: number } | undefined;
            if (state === 'generating' && job?.started_at && Number.isFinite(job.stale_after_s)
                && Date.now() > Date.parse(job.started_at) + Number(job.stale_after_s) * 1000) state = 'stale';
            this.generationStates.set(identity.key, state);
            if (identity.key.startsWith('material:')) this.materialGenerationStatus.delete(identity.key);
        } catch (error) {
            if (identity.key.startsWith('material:')) {
                this.materialGenerationStatus.set(identity.key, { state: 'error', reason: error instanceof Error ? error.message : String(error) });
                this.generationLoads.delete(identity.key);
            } else this.showFieldNotice(error instanceof Error ? error.message : String(error));
        }
        if (this.generationIdentity(this.model.snapshot)?.key === identity.key
            || (this.materialSelection?.mediaKind === 'image' && `material:${this.materialSelection.relativePath}` === identity.key)) this.render();
    }

    /** Follow placeholder provenance, never first_frame (which may be an unrelated reference). */
    protected async readGenerationOriginalNext(meta: unknown, itemId: string): Promise<unknown> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) return undefined;
        const visited = new Set<string>();
        let current = meta as { placeholder?: { path?: string; item_id?: string } } | undefined;
        for (let depth = 0; depth < 32; depth++) {
            const placeholder = current?.placeholder;
            const path = placeholder?.path?.replace(/\\/gu, '/');
            if (!path || placeholder?.item_id !== itemId || visited.has(path)
                || path.startsWith('/') || path.includes(':') || path.split('/').includes('..')) return undefined;
            visited.add(path);
            if (!await this.fileService.exists(root.resolve(path))) return undefined;
            const result = await this.layerAudioService.readGenerationSidecars({ projectRootUri: root.toString(), ...activeEditRequest(root), sourcePaths: [path] });
            const original = result.entries.find(entry => entry.sourcePath === path)?.meta;
            if (/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(path)) return generationFields.fromMeta(original) ? original : undefined;
            current = original;
        }
        return undefined;
    }

    protected async prepareGenerationFinal(identity: { key: string; itemId: string; sourcePath: string; duration: number }): Promise<InspectorWriteResult> {
        const done = this.generationDone.get(identity.key);
        const original = generationFields.fromMeta(done?.originalMeta);
        const row = this.generationCatalog.find(candidate => candidate.id === original?.modelId);
        if (!row || !original || !generationFields.canFinalize(done?.meta, done?.originalMeta, row)) {
            return { ok: false, message: '元の静止画の入力が見つかりません。' };
        }
        const previous = this.generationQuality.get(identity.key);
        const originalResolution = typeof original.output.resolution === 'string' && row.resolutions?.includes(original.output.resolution)
            ? original.output.resolution : generationFields.defaultResolution(row);
        const resolution = previous?.modelId === row.id && previous.previousResolution
            && row.resolutions?.includes(previous.previousResolution) ? previous.previousResolution : originalResolution;
        const seed = (done?.meta as { inputs?: { seed?: unknown } })?.inputs?.seed;
        const draft = { modelId: original.modelId, inputs: { ...original.inputs },
            output: { ...original.output, duration_s: identity.duration, resolution } };
        if (row.seed && Number.isInteger(seed)) draft.inputs.seed = seed;
        this.generationFinal.add(identity.key);
        this.generationQuality.set(identity.key, { modelId: row.id, enabled: false, previousResolution: resolution });
        this.generationDrafts.set(identity.key, draft);
        this.generationTabDrafts.set(identity.key, draft);
        await this.validateGenerationDraft(identity.key);
        this.render();
        return { ok: true };
    }

    protected async loadGenerationNeighbors(identity: { key: string; itemId: string }): Promise<void> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) return;
        const edit = JSON.parse((await this.fileService.read(currentTimelineEditUri(root))).value.toString()) as {
            sources?: Array<{ id: string; path: string }>;
            tracks?: Array<{ items?: Array<{ id: string; at?: number; source?: { kind?: string; src?: string } }> }>;
        };
        const track = edit.tracks?.find(candidate => candidate.items?.some(item => item.id === identity.itemId));
        const items = [...(track?.items ?? [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
        const index = items.findIndex(item => item.id === identity.itemId);
        const sourcePath = (item: typeof items[number] | undefined): string | undefined => item?.source?.kind === 'media'
            ? edit.sources?.find(source => source.id === item.source!.src)?.path : undefined;
        const still = (path: string | undefined): string | undefined => path && /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(path) ? path : undefined;
        this.generationNeighbors.set(identity.key, {
            previousImage: still(sourcePath(items[index - 1])), nextImage: still(sourcePath(items[index + 1])),
            previousId: items[index - 1]?.id, previousPath: sourcePath(items[index - 1])
        });
    }

    protected generationFramePickDisabled(key: string): boolean {
        return ['generating', 'stale'].includes(this.generationStates.get(key) ?? '');
    }

    protected paintGenerationFramePick(): void {
        for (const frame of Array.from(this.body.querySelectorAll<HTMLElement>('[data-akari-generation-pick-slot]'))) {
            frame.setAttribute('aria-pressed', String(!!this.generationFramePick
                && frame.getAttribute('data-akari-generation-pick-slot') === this.generationFramePick.slot));
        }
    }

    protected cancelGenerationFramePick(notifyReceiver = true): void {
        const pending = this.generationFramePick;
        // Invalidate first so a cancelled or late picked result cannot change the draft.
        this.generationFramePick = undefined;
        this.paintGenerationFramePick();
        if (pending && notifyReceiver && this.commandRegistry.getCommand(GENERATION_CANCEL_PICK_COMMAND_ID)) {
            void this.commandRegistry.executeCommand(GENERATION_CANCEL_PICK_COMMAND_ID).catch(error => {
                console.warn('素材選択を取り消せませんでした。', error);
            });
        }
    }

    protected syncGenerationFramePick(tab = this.currentTab): void {
        const key = this.generationIdentity(this.model.snapshot)?.key;
        if (this.generationFramePick && (this.generationFramePick.key !== key || tab !== 'generation'
            || this.generationFramePickDisabled(key!))) this.cancelGenerationFramePick(this.generationFramePick.key === key);
        if (this.generationFramePickMessage?.key !== key) this.generationFramePickMessage = undefined;
    }

    protected async pickGenerationFrame(
        identity: { key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string },
        slot: 'first_frame' | 'last_frame', selected: string
    ): Promise<void> {
        if (this.isDisposed || this.currentTab !== 'generation' || this.generationFramePickDisabled(identity.key)
            || this.generationIdentity(this.model.snapshot)?.key !== identity.key) return;
        if (this.generationFramePick?.key === identity.key && this.generationFramePick.slot === slot) {
            this.cancelGenerationFramePick();
            return;
        }
        const pending = { key: identity.key, slot };
        this.generationFramePick = pending;
        this.generationFramePickMessage = undefined;
        this.paintGenerationFramePick();
        const request: GenerationPickRequest = {
            slot, label: slot === 'first_frame' ? '最初の絵' : '最後の絵', accepts: ['image'], multi: false,
            ...(selected ? { selected: [selected] } : {})
        };
        const isCurrent = (): boolean => this.generationFramePick === pending && !this.isDisposed
            && this.currentTab === 'generation' && this.generationIdentity(this.model.snapshot)?.key === identity.key
            && !this.generationFramePickDisabled(identity.key);
        try {
            const result = this.commandRegistry.getCommand(GENERATION_PICK_INTO_COMMAND_ID)
                ? await this.commandRegistry.executeCommand<GenerationPickResult>(GENERATION_PICK_INTO_COMMAND_ID, request)
                : await this.pickGenerationFrameFile(request);
            if (!isCurrent()) return;
            if (result.status === 'picked' && result.paths[0]) {
                const updated = await this.updateGenerationDraft(identity, `inputs.${slot}`, { path: result.paths[0] });
                if (!updated.ok) throw new Error(updated.message ?? '変更できませんでした。');
            }
        } catch (error) {
            if (isCurrent()) {
                this.generationFramePickMessage = { key: identity.key, text: error instanceof Error ? error.message : String(error) };
                this.render();
            }
        } finally {
            if (this.generationFramePick === pending) this.cancelGenerationFramePick(false);
        }
    }

    protected async pickGenerationFrameFile(request: GenerationPickRequest): Promise<GenerationPickResult> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) throw new Error('プロジェクトが開かれていません。');
        const uri = await this.fileDialogService.showOpenDialog({
            title: `${request.label} に入れる画像を選ぶ`, canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
            filters: { '画像': ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'] }
        }, await this.fileService.resolve(root));
        if (!uri) return { status: 'cancelled' };
        const relative = root.relative(uri)?.toString();
        if (!relative || relative.split('/').includes('..')) throw new Error('プロジェクト内の画像を選んでください。プロジェクト外のファイルは入れられません。');
        if (!/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(relative)) throw new Error('画像ファイルを選んでください。');
        return { status: 'picked', paths: [relative] };
    }

    protected async generationThumbnail(path: string): Promise<string | undefined> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) return undefined;
        const uri = root.resolve(path.replace(/\\/gu, '/')).toString();
        if (!this.generationThumbnails.has(uri)) {
            this.generationThumbnails.set(uri, this.layerAudioService.getClipThumbnail({
                projectRootUri: root.toString(), videoUri: uri, atSeconds: 0
            }).then(result => result.status === 'ready' ? result.dataUri : undefined).catch(() => undefined));
        }
        return this.generationThumbnails.get(uri);
    }

    protected appendVideoCandidatesPanel(identity: { key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string }): void {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const workspaceKey = root?.toString();
        if (workspaceKey && this.aiVideoWorkspaceKey && workspaceKey !== this.aiVideoWorkspaceKey) {
            this.clearVideoCandidatePreview();
            for (const previous of this.aiVideoStates.values()) clearVideoPlayer(previous);
            this.aiVideoStates.clear();
        }
        this.aiVideoWorkspaceKey = workspaceKey;
        if (this.aiVideoPlayerItemKey && this.aiVideoPlayerItemKey !== identity.key) {
            this.clearVideoCandidatePreview();
            const previous = this.aiVideoStates.get(this.aiVideoPlayerItemKey);
            if (previous) clearVideoPlayer(previous);
        }
        this.aiVideoPlayerItemKey = identity.key;
        let state = this.aiVideoStates.get(identity.key);
        if (!state) {
            state = { selected: new Set(), thumbnails: new Map(), running: false };
            this.aiVideoStates.set(identity.key, state);
        }
        const current = state;
        if (root && !current.loading && !current.loaded) {
            current.loading = true;
            void (async () => {
                try {
                    const preferred = await this.layerAudioService.readPreferredRoutes('video', root.toString());
                    if (this.aiVideoStates.get(identity.key) !== current) return;
                    current.preferred = preferred;
                    const groups = videoModelGroups(this.generationCatalog, preferred);
                    const usual = groups.usual[0] ?? groups.favorites[0] ?? groups.others[0];
                    const editable = this.generationStates.get(identity.key) !== 'generating';
                    if (usual) {
                        const previousModel = this.generationDone?.has(identity.key)
                            ? this.generationDrafts.get(identity.key)?.modelId : undefined;
                        current.selected.add(previousModel ?? usual.id);
                        if (editable && !previousModel && this.generationDrafts.get(identity.key)?.modelId !== usual.id) {
                            await this.updateGenerationDraft(identity, 'modelId', usual.id);
                        }
                    }
                    if (editable && this.generationDrafts.get(identity.key)) {
                        await this.persistGenerationDraft(identity);
                        await this.refreshVideoEstimate(identity);
                    }
                    current.batch = await this.layerAudioService.readVideoCandidates({
                        projectRootUri: root.toString(), ...activeEditRequest(root), itemId: identity.itemId });
                    current.running = current.batch.running;
                    current.externalRunning = current.running;
                    if (current.running) current.startedAt = Date.now();
                    this.refreshVideoTimelineProgress(root, current);
                    if (current.running) void this.pollVideoCandidates(identity, current);
                } catch (error) { current.error = error instanceof Error ? error.message : String(error); }
                finally { current.loading = false; current.loaded = true; this.renderVideoCandidates(); }
            })();
        }
        appendAiVideoCandidatesPanel(this.body, current, this.generationCatalog, {
            select: (modelId, checked) => {
                if (checked) current.selected.add(modelId); else current.selected.delete(modelId);
                const preferred = current.preferred;
                const groups = videoModelGroups(this.generationCatalog, preferred);
                const detail = groups.usual.find(row => current.selected.has(row.id))
                    ?? [...groups.favorites, ...groups.others].find(row => current.selected.has(row.id));
                if (detail && this.generationDrafts.get(identity.key)?.modelId !== detail.id)
                    void this.updateGenerationDraft(identity, 'modelId', detail.id);
                else this.renderVideoCandidates();
            },
            generate: models => void this.startVideoCandidates(identity, models),
            cancel: () => void this.cancelVideoCandidates(identity),
            pick: candidate => void this.pickVideoCandidate(identity, candidate),
            adopt: () => void this.adoptVideoCandidate(identity),
            thumbnail: (candidate, image) => {
                const path = candidate.relativePath;
                if (!path) return;
                const cached = current.thumbnails.get(path);
                if (cached) { image.src = cached; return; }
                current.thumbnailLoads ??= new Map();
                if (current.thumbnailLoads.has(path)) return;
                const pending = (async () => {
                    for (let attempt = 0; attempt < 6 && !this.isDisposed; attempt++) {
                        const src = await this.generationThumbnail(path);
                        if (src) {
                            current.thumbnails.set(path, src);
                            for (const visible of Array.from(this.body.querySelectorAll<HTMLImageElement>(
                                '[data-akari-inspector-video-candidate-thumbnail]'))) {
                                if (visible.getAttribute('data-akari-inspector-video-candidate-thumbnail') === path) visible.src = src;
                            }
                            return;
                        }
                        if (root) this.generationThumbnails.delete(root.resolve(path.replace(/\\/gu, '/')).toString());
                        await new Promise<void>(resolve => window.setTimeout(resolve, 300 * (attempt + 1)));
                    }
                })().finally(() => current.thumbnailLoads?.delete(path));
                current.thumbnailLoads.set(path, pending);
            }
        });
        if (this.generationDone?.has(identity.key)) {
            const panel = this.body.querySelector<HTMLElement>('[data-akari-inspector-video-panel]');
            const create = panel?.querySelector<HTMLButtonElement>('[data-akari-inspector-video-create]');
            if (create) create.textContent = create.textContent?.replace('案を作る', '案を作り直す') ?? '';
            const used = Array.from(panel?.querySelectorAll<HTMLElement>('[data-akari-inspector-video-candidate]') ?? [])
                .find(button => button.getAttribute('data-akari-inspector-video-candidate') === identity.sourcePath);
            if (used) {
                const badge = document.createElement('span');
                badge.textContent = '使用中';
                badge.setAttribute('data-akari-inspector-video-in-use', identity.sourcePath);
                used.appendChild(badge);
            }
        }
    }

    protected renderVideoCandidates(): void {
        if (this.aiView !== 'video') return;
        this.rememberedView = { ...this.rememberedView, scrollTop: this.node.scrollTop };
        this.render();
    }

    protected refreshVideoTimelineProgress(root: URI, state: AiVideoState, force = false): Promise<void> {
        const batch = state.batch;
        if (!batch) return Promise.resolve();
        const key = `${batch.running}:${batch.routes.join(',')}:${batch.completed}:${batch.candidates.filter(row => row.ok).length}`;
        if (state.timelineProgressKey === key && !force) return state.timelineReload ?? Promise.resolve();
        state.timelineProgressKey = key;
        state.timelineReload = (state.timelineReload ?? Promise.resolve()).catch(() => undefined).then(async () => {
            const timeline = this.stillWidgetManager.getWidgets('akari-annotations-widget').find(widget => {
                const location = (widget as unknown as { location?: { root?: URI } }).location;
                return !widget.isDisposed && location?.root?.toString() === root.toString();
            }) as unknown as { reloadGenerationSidecars?: () => Promise<void> } | undefined;
            await timeline?.reloadGenerationSidecars?.();
        });
        return state.timelineReload;
    }

    protected syncVideoProgressRows(state: AiVideoState): void {
        if (this.aiView !== 'video' || !state.batch) return;
        const panel = this.body.querySelector('[data-akari-inspector-video-panel]');
        const progress = panel?.querySelector<HTMLElement>('[data-akari-inspector-video-progress]');
        if (!progress) return;
        progress.setAttribute('data-akari-inspector-video-progress', `${state.batch.completed}/${state.batch.routes.length}`);
        for (const row of Array.from(progress.querySelectorAll<HTMLElement>('[data-akari-inspector-video-progress-model]'))) {
            const route = row.getAttribute('data-akari-inspector-video-progress-model');
            if (!route) continue;
            const candidate = videoProgressCandidate(state, route);
            const elapsed = candidate?.elapsedSeconds ?? Math.max(0, (Date.now() - (state.startedAt ?? Date.now())) / 1000);
            const status = videoProgress(candidate, elapsed);
            const model = this.generationCatalog.find(entry => entry.id === route);
            const text = `${status.state === 'done' ? '✓' : status.state === 'failed' ? '×' : '◌'} ${model ? videoModelName(model) : route} · ${status.label}`;
            row.setAttribute('data-akari-inspector-video-progress-state', status.state);
            row.setAttribute('data-akari-inspector-video-progress-elapsed', String(Math.round(elapsed)));
            row.setAttribute('data-akari-inspector-video-progress-queue', candidate?.queueStatus ?? '');
            if (row.textContent !== text) row.textContent = text;
        }
    }

    protected async refreshVideoEstimate(identity: { key: string; itemId: string }): Promise<void> {
        const state = this.aiVideoStates.get(identity.key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!state || !root || state.running) return;
        const models = this.generationCatalog.filter(row => row.kind === 'video' && row.callable !== false).map(row => row.id);
        const key = JSON.stringify([root.toString(), identity.itemId, this.generationDrafts.get(identity.key), models]);
        if (state.estimateKey === key) return state.estimateLoading;
        state.estimateKey = key;
        state.estimate = undefined;
        const loading = (async () => {
            try {
                const estimate = await this.layerAudioService.estimateVideoBatch({ projectRootUri: root.toString(),
                    itemId: identity.itemId, models });
                if (state.estimateKey === key) { state.estimate = estimate; this.renderVideoCandidates(); }
            } catch (error) {
                if (state.estimateKey === key) { state.error = error instanceof Error ? error.message : String(error); this.renderVideoCandidates(); }
            }
        })();
        state.estimateLoading = loading;
        await loading;
        if (state.estimateLoading === loading) state.estimateLoading = undefined;
    }

    protected async startVideoCandidates(identity: { key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string },
        onlyModels?: string[]): Promise<void> {
        const state = this.aiVideoStates.get(identity.key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!state || !root || state.running) return;
        const models = onlyModels ?? [...state.selected];
        if (!models.length) return;
        const regenerating = this.generationDone?.has(identity.key) === true;
        const visibleDraft = this.generationDrafts.get(identity.key);
        const retryDraft = onlyModels && state.batchDraft;
        try {
            if (retryDraft) this.generationDrafts.set(identity.key, structuredClone(retryDraft));
            await this.persistGenerationDraft(identity);
            await this.refreshVideoEstimate(identity);
            const estimate = state.estimate;
            if (!estimate || models.some(id => !estimate.models.some(row => row.modelId === id && !row.error))) {
                throw new Error('この枠で使えないモデルがあります。');
            }
            const approved = await new ConfirmDialog({ title: '費用承認',
                msg: videoApprovalMessage(estimate, new Set(models), this.generationCatalog),
                ok: '費用承認する', cancel: 'キャンセル' }).open();
            if (!approved) return;
            if (!onlyModels) state.batchDraft = structuredClone(this.generationDrafts.get(identity.key)!);
            state.error = undefined; state.running = true; state.externalRunning = false; state.startedAt = Date.now();
            state.batchBaseline = new Set(state.batch?.candidates.flatMap(row => row.relativePath ? [row.relativePath] : []) ?? []);
            state.batch = { routes: models, completed: 0, candidates: [], results: [], running: true };
            this.generationStates.set(identity.key, 'generating');
            this.renderVideoCandidates();
            const work = this.layerAudioService.startGenerateVideoBatch({ projectRootUri: root.toString(),
                ...activeEditRequest(root),
                itemId: identity.itemId, models, approved: true });
            void this.pollVideoCandidates(identity, state);
            const result = await work;
            if (!state.running) return;
            state.batch = await this.layerAudioService.readVideoCandidates({ projectRootUri: root.toString(), ...activeEditRequest(root), itemId: identity.itemId });
            state.running = false;
            this.syncVideoProgressRows(state);
            await this.refreshVideoTimelineProgress(root, state, true);
            this.generationLoads.delete(identity.key);
            await this.loadGeneration(identity);
            if (models.length === 1 && !regenerating) {
                const candidate = result.candidates.find(row => row.ok && row.relativePath);
                if (candidate) {
                    const finished = state.batch.candidates.find(row => row.relativePath === candidate.relativePath);
                    if (finished) { state.picked = finished.relativePath; await this.adoptVideoCandidate(identity); }
                }
            }
        } catch (error) { state.error = error instanceof Error ? error.message : String(error); }
        finally {
            state.running = false;
            if (retryDraft && visibleDraft) {
                this.generationDrafts.set(identity.key, visibleDraft);
                await this.persistGenerationDraft(identity).catch(error => {
                    state.error = error instanceof Error ? error.message : String(error);
                });
            }
            this.renderVideoCandidates();
        }
    }

    protected async pollVideoCandidates(identity: { key: string; itemId: string; sourcePath?: string }, state: AiVideoState): Promise<void> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root || state.polling) return;
        state.polling = true;
        while (state.running && !this.isDisposed) {
            try {
                const batch = await this.readVideoCandidatesFromFiles(identity, state, root);
                const before = state.batch ? videoProgressLayoutKey(state.batch) : '';
                state.batch = batch;
                void this.refreshVideoTimelineProgress(root, state);
                if (videoProgressLayoutKey(batch) !== before) this.renderVideoCandidates();
                this.syncVideoProgressRows(state);
                if (state.externalRunning && !batch.running && batch.routes.length) {
                    state.running = false;
                    state.externalRunning = false;
                    await this.refreshVideoTimelineProgress(root, state, true);
                    this.generationLoads.delete(identity.key);
                    const current = this.generationIdentity(this.model.snapshot);
                    if (current?.key === identity.key) void this.loadGeneration(current);
                    this.renderVideoCandidates();
                }
            } catch (error) { console.warn('[akari-video] 候補の進捗を読めませんでした', error); }
            await new Promise<void>(resolve => window.setTimeout(resolve, 300));
        }
        state.polling = false;
    }

    /** Read sidecars through FileService while the long generation RPC occupies the annotations connection. */
    protected async readVideoCandidatesFromFiles(identity: { itemId: string; sourcePath?: string },
        state: AiVideoState, root: URI): Promise<VideoCandidateBatch> {
        let frame: any = {};
        if (identity.sourcePath) {
            try { frame = JSON.parse((await this.fileService.readFile(root.resolve(`${identity.sourcePath}.meta.json`))).value.toString()); }
            catch { /* The batch can start before the first sidecar write. */ }
        }
        if (frame.kind === 'video' && frame.status === 'done') {
            try {
                frame = JSON.parse((await this.fileService.readFile(root.resolve(
                    `.akari/generation/${identity.itemId}.compare.meta.json`))).value.toString());
            } catch { /* The first regeneration has no progress file yet. */ }
        }
        const job = frame.job?.provider === 'compare' ? frame.job : undefined;
        const fresh = state.externalRunning || Number.isFinite(Date.parse(job?.started_at))
            && Date.parse(job.started_at) >= (state.startedAt ?? 0) - 2000;
        const directory = root.resolve(`assets/generated/candidates/${identity.itemId}`);
        const children = await this.fileService.resolve(directory, { resolveMetadata: true })
            .then(result => result.children ?? []).catch(() => []);
        const loaded = await Promise.all(children.filter(child => child.isFile && child.resource.path.base.endsWith('.mp4.meta.json'))
            .map(async child => {
                try {
                    const meta = JSON.parse((await this.fileService.readFile(child.resource)).value.toString());
                    if (meta.candidate_of !== identity.itemId || typeof meta.route !== 'string') return undefined;
                    const relativePath = `assets/generated/candidates/${identity.itemId}/${child.resource.path.base.slice(0, -'.meta.json'.length)}`;
                    return { startedAt: String(meta.job?.started_at ?? ''), candidate: {
                        route: meta.route, ok: meta.status === 'done', status: meta.status,
                        relativePath, queueStatus: meta.job?.queue_status,
                        elapsedSeconds: meta.result?.elapsed_s, costUsd: meta.cost?.estimate_usd ?? null,
                        durationSeconds: meta.result?.duration_s_actual,
                        width: meta.result?.width, height: meta.result?.height,
                        ...(meta.status === 'failed' ? { reason: meta.history?.at(-1)?.reason } : {})
                    } as VideoCandidate };
                } catch { return undefined; }
            }));
        const candidates = loaded.filter((row): row is NonNullable<typeof row> => !!row)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt)
                || a.candidate.route.localeCompare(b.candidate.route)
                || String(a.candidate.relativePath).localeCompare(String(b.candidate.relativePath)))
            .map(row => row.candidate);
        if (fresh && Array.isArray(job?.failed)) for (const failed of job.failed) {
            if (typeof failed?.route === 'string' && !candidates.some(row => row.route === failed.route && row.status === 'failed')) {
                candidates.push({ route: failed.route, ok: false, status: 'failed', reason: failed.reason });
            }
        }
        const routes = fresh && Array.isArray(job?.routes) ? job.routes : state.batch?.routes ?? [];
        const completed = fresh && Number.isFinite(job?.completed) ? job.completed : state.batch?.completed ?? 0;
        const running = state.externalRunning && frame.status ? frame.status === 'generating' : state.running;
        return { routes, completed, candidates, results: [], running };
    }

    protected async cancelVideoCandidates(identity: { key: string; itemId: string }): Promise<void> {
        const state = this.aiVideoStates.get(identity.key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!state?.running || !root) return;
        state.running = false;
        await this.layerAudioService.cancelGenerateVideoBatch({ projectRootUri: root.toString(), itemId: identity.itemId });
        state.batch = await this.layerAudioService.readVideoCandidates({ projectRootUri: root.toString(), ...activeEditRequest(root), itemId: identity.itemId });
        await this.refreshVideoTimelineProgress(root, state, true);
        const current = this.generationIdentity(this.model.snapshot);
        if (current?.key === identity.key) { this.generationLoads.delete(identity.key); void this.loadGeneration(current); }
        this.renderVideoCandidates();
    }

    protected clearVideoCandidatePreview(): void {
        const preview = this.previewedVideoCandidate;
        if (!preview) return;
        this.previewedVideoCandidate = undefined;
        const state = this.aiVideoStates.get(preview.key);
        if (state) clearVideoPlayer(state);
        window.dispatchEvent(new CustomEvent('akari.preview.videoCandidate', { detail: {
            editUri: preview.editUri, itemId: preview.itemId, clear: true
        } }));
    }

    protected async pickVideoCandidate(identity: { key: string; itemId: string }, candidate: VideoCandidate): Promise<void> {
        const state = this.aiVideoStates.get(identity.key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!state || !root || !candidate.relativePath) return;
        if (state.picked === candidate.relativePath) {
            this.clearVideoCandidatePreview();
            this.renderVideoCandidates();
            return;
        }
        this.clearVideoCandidatePreview();
        clearVideoPlayer(state);
        state.picked = candidate.relativePath; state.playerUrl = undefined;
        const editUri = currentTimelineEditUri(root).toString();
        const frameSeconds = this.generationIdentity(this.model.snapshot)?.duration;
        try {
            const detail = videoCandidatePreviewDetail(editUri, identity.itemId, frameSeconds ?? 0, candidate);
            this.previewedVideoCandidate = { editUri, itemId: identity.itemId, key: identity.key };
            window.dispatchEvent(new CustomEvent('akari.preview.videoCandidate', { detail }));
        } catch (error) { state.error = error instanceof Error ? error.message : String(error); }
        this.renderVideoCandidates();
        try {
            const data = await this.fileService.readFile(root.resolve(candidate.relativePath));
            if (state.picked !== candidate.relativePath) return;
            state.playerUrl = URL.createObjectURL(new Blob([data.value.buffer as ArrayBuffer], { type: 'video/mp4' }));
            this.renderVideoCandidates();
        } catch (error) { state.error = error instanceof Error ? error.message : String(error); this.renderVideoCandidates(); }
    }

    protected async adoptVideoCandidate(identity: { key: string; itemId: string }): Promise<void> {
        const state = this.aiVideoStates.get(identity.key);
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const candidate = state?.batch?.candidates.find(row => row.relativePath === state.picked && row.ok);
        if (!state || !root || !candidate || state.running || state.adopting) return;
        this.clearVideoCandidatePreview();
        state.adopting = true;
        const timeline = this.stillWidgetManager.getWidgets('akari-annotations-widget').find(widget => {
            const location = (widget as unknown as { location?: { root?: URI } }).location;
            return !widget.isDisposed && location?.root?.toString() === root.toString();
        }) as unknown as { commitEditMutation?: (label: string, mutate: (doc: any) => any) => Promise<unknown> } | undefined;
        if (!timeline?.commitEditMutation) { state.error = 'タイムラインの編集履歴が見つかりません。'; state.adopting = false; this.renderVideoCandidates(); return; }
        try {
            await timeline.commitEditMutation('この案を使う', doc => replaceVideoInEdit(doc, identity.itemId, candidate));
            this.generationDone.set(identity.key, { sourcePath: candidate.relativePath!, meta: { kind: 'video', status: 'done' }, originalMeta: undefined });
            this.generationStates.set(identity.key, 'done');
            clearVideoPlayer(state);
            this.renderVideoCandidates();
        } catch (error) { state.error = error instanceof Error ? error.message : String(error); this.renderVideoCandidates(); }
        finally { state.adopting = false; }
    }

    protected async validateGenerationDraft(key: string): Promise<void> {
        const draft = this.generationDrafts.get(key);
        if (!draft) return;
        const validation = await this.layerAudioService.validateGenerationInputs({
            modelId: draft.modelId, inputs: draft.inputs, output: draft.output
        });
        this.generationValidations.set(key, validation as GenerationValidationResult as GenerationValidation);
    }

    protected generationSectionFields<T extends TimelineCutSelection | TimelineLayerSelection | TimelineTreeItemSnapshot>(snapshot: T): InspectorFieldDef<T>[] | undefined {
        const identity = this.generationIdentity(snapshot);
        if (!identity || this.generationCatalog.length === 0) return undefined;
        const draft = this.generationDrafts.get(identity.key);
        if (!draft) return undefined;
        if (draft.output.duration_s !== identity.duration) {
            draft.output.duration_s = identity.duration;
            void this.validateGenerationDraft?.(identity.key).then(() => {
                if (this.generationIdentity(this.model.snapshot)?.key === identity.key) this.render();
            }).catch(error => this.showFieldNotice(String(error.message ?? error)));
        }
        const row = this.generationCatalog.find(candidate => candidate.id === draft.modelId);
        if (!row) return undefined;
        const fields = generationFields({
            snapshot, catalogRow: row, draft, validation: this.generationValidations.get(identity.key),
            defaults: {
                catalog: this.generationCatalog, currentImage: identity.sourcePath,
                compareMode: !identity.key.startsWith('material:'),
                ...this.generationNeighbors?.get(identity.key), thumbnail: path => this.generationThumbnail(path),
                state: this.generationStates.get(identity.key),
                cheapDraft: this.generationQuality?.get(identity.key)?.modelId === row.id && this.generationQuality.get(identity.key)?.enabled,
                finalQuality: this.generationFinal?.has(identity.key),
                doneMeta: this.generationDone?.get(identity.key)?.meta, originalNext: this.generationDone?.get(identity.key)?.originalMeta
            },
            actions: {
                update: (path, value) => this.updateGenerationDraft(identity, path, value),
                copyAdjacent: () => this.copyAdjacentGenerationDraft(identity),
                generate: () => this.confirmAndStartGeneration(identity),
                resume: () => this.resumeGeneration(identity),
                retry: () => this.confirmAndStartGeneration(identity),
                finalQuality: () => this.prepareGenerationFinal(identity)
            }
        });
        if (this.generationFinal?.has(identity.key)) {
            for (const field of fields) {
                if (field.name !== 'generation-resolution' && field.name !== 'generation-actions') {
                    field.disabled = true;
                    delete field.write;
                    field.actions = undefined;
                }
                if (field.name === 'generation-actions') field.actions = field.actions?.filter(action => action.name === 'generate');
            }
        }
        if (this.generationFramePickMessage?.key === identity.key) {
            const message = { name: 'generation-message', label: 'エラー',
                className: 'akari-inspector-generation-error', getValue: () => this.generationFramePickMessage!.text };
            const index = fields.findIndex(field => field.name === 'generation-message');
            if (index >= 0) fields[index] = message;
            else fields.push(message);
        }
        // Keep each paired visual unit together in the section model.
        const pairs = [['first-frame', 'last_frame'], ['generation-variety', 'generation-material-note'],
            ['generation-estimate', 'generation-actions'], ['generation-resolution', 'generation-cheap-draft']];
        for (const [first, second] of pairs) {
            const index = fields.findIndex(field => field.name === first);
            const other = fields.findIndex(field => field.name === second);
            if (index < 0 || other < 0) continue;
            const children = [fields[index], fields[other]];
            fields[index] = { name: `generation-group-${first}`, label: '', getValue: () => '', generationChildren: children };
            fields.splice(other, 1);
        }
        return fields as GenerationFieldDef<T>[] as InspectorFieldDef<T>[];
    }

    protected async updateGenerationDraft(
        identity: { key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string },
        path: string, value: unknown
    ): Promise<InspectorWriteResult> {
        const current = this.generationDrafts.get(identity.key);
        if (!current) return { ok: false, message: '生成下書きを読み込み中です。' };
        if (this.generationFinal?.has(identity.key) && path !== 'output.resolution') {
            return { ok: false, message: '本番の画質では解像度だけを変更できます。' };
        }
        const next: GenerationDraft = {
            modelId: current.modelId, inputs: { ...current.inputs }, output: { ...current.output }
        };
        if (path === 'cheapDraft') {
            const row = this.generationCatalog.find(candidate => candidate.id === current.modelId);
            if (!row || !generationFields.draftQuality(row)) return { ok: false, message: 'このモデルは下書きに対応していません。' };
            const previous = this.generationQuality.get(identity.key);
            const enabled = value === true;
            if (previous?.modelId === row.id && previous.enabled === enabled) return { ok: true };
            const toggled = generationFields.toggleDraft(row, current.output, enabled,
                previous?.modelId === row.id ? previous.previousResolution : undefined);
            next.output = toggled.output;
            this.generationQuality.set(identity.key, { modelId: row.id, enabled, previousResolution: toggled.previousResolution });
        }
        if (path === 'inputs.frames_or_refs') {
            const row = this.generationCatalog.find(candidate => candidate.id === current.modelId);
            const pair = row && generationFields.pairedModels(row, this.generationCatalog);
            if (!pair || (value !== 'frames' && value !== 'references')) return { ok: false, message: '切り替え先がありません。' };
            path = 'modelId';
            value = pair[value].id;
        }
        if (path === 'modelId') {
            this.cancelGenerationFramePick?.();
            next.modelId = String(value);
            this.generationQuality?.delete(identity.key);
            const model = this.generationCatalog.find(row => row.id === next.modelId);
            if (model) {
                const side = generationFields.modelSide(model);
                if (side) next.inputs.frames_or_refs = side;
                else delete next.inputs.frames_or_refs;
                if (!model.inputs.negative_prompt) next.inputs.negative_prompt = null;
                const camera = current.inputs.camera as { value?: string } | undefined;
                const move = generationFields.cameraMoves.find(entry => entry.bracket === camera?.value || entry.prose === camera?.value);
                next.inputs.camera = model.inputs.camera && move ? generationFields.cameraValue(move.label, model.inputs.camera) : null;
            }
            if (model && (!model.resolutions?.includes(String(next.output.resolution)))) {
                next.output.resolution = model.resolutions?.[0] ?? null;
            }
        } else {
            const [group, field] = path.split('.');
            if ((group === 'inputs' || group === 'output') && field) next[group][field] = value;
        }
        generationFields.rememberReferences(next.inputs, current.inputs);
        next.output.duration_s = identity.duration;
        this.generationDrafts.set(identity.key, next);
        this.generationTabDrafts.set(identity.key, next);
        try {
            await this.validateGenerationDraft(identity.key);
            this.scheduleGenerationDraftWrite(identity);
            this.render();
            return { ok: true };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    protected scheduleGenerationDraftWrite(identity: { key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string }): void {
        const previous = this.generationDraftTimers.get(identity.key);
        if (previous !== undefined) window.clearTimeout(previous);
        this.generationDraftTimers.set(identity.key, window.setTimeout(() => {
            this.generationDraftTimers.delete(identity.key);
            void this.persistGenerationDraft(identity).catch(error => this.showFieldNotice(String(error.message ?? error)));
        }, 300));
    }

    protected async persistGenerationDraft(identity: { key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string }): Promise<void> {
        await this.workspaceService.ready;
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        const draft = this.generationDrafts.get(identity.key);
        if (!root || !draft) return;
        const previous = this.generationWrites.get(identity.key) ?? Promise.resolve();
        const write = previous.catch(() => undefined).then(async () => {
            await this.layerAudioService.writeGenerationDraft({
                projectRootUri: root.toString(), ...activeEditRequest(root), itemId: identity.itemId,
                ...(identity.key.startsWith('material:') ? { fromImage: identity.sourcePath } : {}),
                modelId: draft.modelId, inputs: draft.inputs, output: { ...draft.output, duration_s: identity.duration }
            });
            this.generationTabMeta.set(identity.key, { next: { status: 'planned' } });
        });
        this.generationWrites.set(identity.key, write);
        await write;
        if (this.aiVideoStates?.has(identity.key) && typeof this.refreshVideoEstimate === 'function') void this.refreshVideoEstimate(identity);
        if (this.generationIdentity(this.model.snapshot)?.key === identity.key
            || (this.materialSelection?.mediaKind === 'image' && `material:${this.materialSelection.relativePath}` === identity.key)) this.render();
    }

    protected async copyAdjacentGenerationDraft(identity: { key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string }): Promise<InspectorWriteResult> {
        try {
            await this.workspaceService.ready;
            const root = this.workspaceService.tryGetRoots()[0]?.resource;
            if (!root) throw new Error('プロジェクトが開かれていません。');
            await this.loadGenerationNeighbors(identity);
            const neighbor = this.generationNeighbors.get(identity.key);
            if (!neighbor?.previousId || !neighbor.previousPath) return { ok: false, message: '直前の映像 item がありません。' };
            let parsed: GenerationDraft | undefined;
            try {
                parsed = generationFields.fromMeta(JSON.parse((await this.fileService.read(
                    root.resolve(`${neighbor.previousPath}.meta.json`)
                )).value.toString()));
            } catch { /* Fall back to the legacy draft only when next is absent. */ }
            if (!parsed) parsed = JSON.parse((await this.fileService.read(
                root.resolve(`.akari/generation/${neighbor.previousId}.inputs.json`)
            )).value.toString()) as GenerationDraft;
            const current = this.generationDrafts.get(identity.key);
            const copied = {
                modelId: parsed.modelId, inputs: {
                    ...parsed.inputs, first_frame: current?.inputs.first_frame ?? null
                }, output: { ...parsed.output, duration_s: identity.duration }
            };
            this.generationDrafts.set(identity.key, copied);
            this.generationTabDrafts.set(identity.key, copied);
            await this.validateGenerationDraft(identity.key);
            await this.persistGenerationDraft(identity);
            this.render();
            return { ok: true };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    protected async confirmAndStartGeneration(identity: { key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string }): Promise<InspectorWriteResult> {
        try {
            const selected = this.generationDrafts.get(identity.key);
            if (!selected) return { ok: false, message: '生成下書きを読み込み中です。' };
            if (this.generationFinal?.has(identity.key)) {
                const row = this.generationCatalog.find(candidate => candidate.id === selected.modelId);
                const quality = row && generationFields.draftQuality(row);
                const price = row?.price?.by_resolution?.[String(selected.output.resolution)];
                if (!quality || typeof price !== 'number' || price <= quality.unitPrice) {
                    return { ok: false, message: '下書きより高い画質の解像度を選んでください。' };
                }
            }
            await this.persistGenerationDraft(identity);
            const draft = this.generationDrafts.get(identity.key)!;
            const validation = this.generationValidations.get(identity.key);
            if (validation?.ok === false) return { ok: false, message: '入力エラーを直してから実行してください。' };
            const estimate = validation?.cost?.estimate_usd;
            const asOf = validation?.cost?.as_of
                ?? this.generationCatalog.find(row => row.id === draft.modelId)?.as_of ?? '不明';
            const amount = typeof estimate === 'number' ? `$${estimate.toFixed(2)}（as_of ${asOf}）` : '見積不可';
            const approved = await new ConfirmDialog({
                title: '費用承認',
                msg: `${amount}で ${draft.modelId} に送ります。費用承認しますか`,
                ok: '費用承認する', cancel: 'キャンセル'
            }).open();
            if (!approved) return { ok: true };
            await this.workspaceService.ready;
            const root = this.workspaceService.tryGetRoots()[0]?.resource;
            if (!root) throw new Error('プロジェクトが開かれていません。');
            this.generationStates.set(identity.key, 'generating');
            this.render();
            void this.layerAudioService.startGenerateVideo({
                projectRootUri: root.toString(), ...activeEditRequest(root), itemId: identity.itemId, approved: true,
                ...(identity.key.startsWith('material:') ? { fromImage: identity.sourcePath } : {})
            }).then(result => {
                if (!result.ok && identity.key.startsWith('material:')) {
                    this.generationStates.set(identity.key, 'failed');
                    this.render();
                    this.showFieldNotice(result.reason ?? '生成に失敗しました。');
                    return;
                }
                if (!result.ok) this.showFieldNotice(result.reason ?? '生成に失敗しました。');
                if (result.ok && identity.key.startsWith('material:')) {
                    try { this.materialCreated.set(identity.sourcePath, JSON.parse(result.stdout.trim().split('\n').slice(-1)[0]).mp4); }
                    catch { this.showFieldNotice('生成結果のパスを読み取れませんでした。'); }
                    this.generationStates.set(identity.key, 'done');
                    this.render();
                    return;
                }
                this.generationLoads.delete(identity.key);
                void this.loadGeneration(identity);
            });
            return { ok: true };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    protected async resumeGeneration(identity: { key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string }): Promise<InspectorWriteResult> {
        try {
            await this.workspaceService.ready;
            const root = this.workspaceService.tryGetRoots()[0]?.resource;
            if (!root) throw new Error('プロジェクトが開かれていません。');
            this.generationStates.set(identity.key, 'generating');
            this.render();
            void this.layerAudioService.resumeGenerateVideo({
                projectRootUri: root.toString(), itemId: identity.itemId
            }).then(result => {
                if (!result.ok) this.showFieldNotice(result.reason ?? '再取得に失敗しました。');
                this.generationLoads.delete(identity.key);
                void this.loadGeneration(identity);
            });
            return { ok: true };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    /** Caption-only motion fields that are not yet represented by InspectorWriteRequest. */
    protected captionMotionServices(snapshot: TimelineCaptionSelection): CaptionMotionServices {
        const paths = (): { root: URI; captions: URI; edit: URI } => {
            const root = this.workspaceService.tryGetRoots()[0]?.resource;
            if (!root) throw new Error('プロジェクトを開いてください。');
            return { root, captions: currentTimelineCaptionsUri(root), edit: currentTimelineEditUri(root) };
        };
        const readCaptions = async (): Promise<string> =>
            (await this.fileService.readFile(paths().captions)).value.toString();
        return {
            loadCue: async () => readCaptionMotionCue(await readCaptions(), snapshot.id),
            setKaraoke: async (settings, selectStyle = false) => {
                try {
                    const { root, captions, edit } = paths();
                    const before = await readCaptions();
                    const after = upsertCaptionKaraoke(before, snapshot.id, settings, selectStyle);
                    if (after === before) return { ok: true };
                    await this.layerAudioService.writeEditSnapshot({
                        editUri: edit.toString(), projectRootUri: root.toString(),
                        captionsUri: captions.toString(), captionsSource: after
                    });
                    this.history.pushPreviewCaptionWrite({
                        editUri: edit.toString(), captionsUri: captions.toString(), before, after,
                        label: selectStyle ? 'カラオケの選択' : 'カラオケの設定の変更'
                    }, {
                        read: async () => (await this.fileService.readFile(captions)).value.toString(),
                        write: async (change, content) => {
                            await this.layerAudioService.writeEditSnapshot({
                                editUri: change.editUri, projectRootUri: root.toString(),
                                captionsUri: change.captionsUri, captionsSource: content
                            });
                            if (!this.isDisposed && this.model.snapshot?.kind === 'caption'
                                && this.model.snapshot.id === snapshot.id) this.render();
                        }
                    });
                    return { ok: true };
                } catch (error) {
                    return { ok: false, message: error instanceof Error ? error.message : String(error) };
                }
            },
            setWordStyle: async style => {
                try {
                    const { root, captions } = paths();
                    await this.layerAudioService.setCaptionFields({
                        captionsUri: captions.toString(), projectRootUri: root.toString(),
                        captionId: snapshot.id, style
                    });
                    return { ok: true };
                } catch (error) {
                    return { ok: false, message: error instanceof Error ? error.message : String(error) };
                }
            },
            setEmphasis: async (wordIndex, style) => {
                try {
                    const { root, captions, edit } = paths();
                    const source = await readCaptions();
                    const captionsSource = upsertCaptionEmphasis(source, snapshot.id, wordIndex, style);
                    await this.layerAudioService.writeEditSnapshot({
                        editUri: edit.toString(), projectRootUri: root.toString(),
                        captionsUri: captions.toString(), captionsSource
                    });
                    return { ok: true };
                } catch (error) {
                    return { ok: false, message: error instanceof Error ? error.message : String(error) };
                }
            },
            ...(snapshot.animatorOwner ? { readOwner: async () => {
                const source = (await this.fileService.readFile(paths().edit)).value.toString();
                return readOwnerMotion(source, snapshot.animatorOwner!.id,
                    snapshot.sourceEnd - snapshot.sourceStart);
            } } : {})
        };
    }

    protected async commitWrite(
        request: InspectorWriteRequest
    ): Promise<InspectorWriteResult> {
        if (!this.model.requestWrite) {
            return this.reportWriteFailure('書き込み機能が利用できません。');
        }
        try {
            const result = await this.model.requestWrite(request);
            return result.ok ? result : this.reportWriteFailure(result.message ?? '書き込みに失敗しました。');
        } catch (error) {
            return this.reportWriteFailure(error instanceof Error ? error.message : String(error));
        }
    }

    protected reportWriteFailure(message: string): InspectorWriteResult {
        this.showFieldNotice(message);
        const now = Date.now();
        if (this.lastWriteError?.message !== message || now - this.lastWriteError.at >= 4000) {
            this.messageService.error(message);
            this.lastWriteError = { message, at: now };
        }
        return { ok: false, message };
    }

    protected dispatchCaptionZoneEvent(type: string, zone: string | null): void {
        const root = this.workspaceService.tryGetRoots()[0];
        if (!root) return;
        window.dispatchEvent(new CustomEvent(type, {
            detail: { editUri: currentTimelineEditUri(root.resource).toString(), zone }
        }));
    }

    protected previewEasing(
        snapshot: InspectorSnapshot,
        selection: TimelineKeyframeSelection,
        easing: string
    ): void {
        const now = Date.now();
        if (now - this.lastEasingPreviewAt < INSPECTOR_LIVE_PREVIEW_THROTTLE_MS) return;
        this.lastEasingPreviewAt = now;
        if (snapshot.kind !== 'cut' && snapshot.kind !== 'layer'
            && snapshot.kind !== 'overlay' && snapshot.kind !== 'item') return;
        const leaf = selection.property.startsWith('transform.')
            ? selection.property.substring('transform.'.length) as 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate'
            : 'opacity';
        const transform = snapshot.kind === 'overlay'
            && snapshot.payload.transform && typeof snapshot.payload.transform === 'object'
            && !Array.isArray(snapshot.payload.transform)
            ? snapshot.payload.transform as Record<string, unknown>
            : snapshot.kind === 'cut' || snapshot.kind === 'layer' || snapshot.kind === 'item'
                ? snapshot.transform : undefined;
        const raw = leaf === 'opacity'
            ? (snapshot.kind === 'overlay' ? snapshot.payload.opacity : snapshot.opacity)
            : transform?.[leaf];
        const value = typeof raw === 'number' ? raw
            : leaf === 'scaleX' || leaf === 'scaleY' ? Number(transform?.scale ?? 1)
                : leaf === 'scale' || leaf === 'opacity' ? 1 : 0;
        const target: LivePreviewTarget = snapshot.kind === 'cut'
            ? { kind: 'cut', index: snapshot.index }
            : snapshot.kind === 'layer' ? { kind: 'layer', id: snapshot.id }
                : { kind: 'item', id: snapshot.id };
        this.model.requestLivePreview?.({ target, field: leaf, value, easing });
    }

    protected keyframeSeatOptions(
        snapshot: InspectorSnapshot,
        fieldName: string,
        value: number
    ): KeyframeSeatOptions | undefined {
        if (snapshot.kind !== 'cut' && snapshot.kind !== 'layer'
            && snapshot.kind !== 'overlay' && snapshot.kind !== 'item') return undefined;
        const property: KeyframeSeatProperty | undefined = /^(crop-[xywh]|perspective-(tl|tr|bl|br)-[xy])$/u.test(fieldName)
            ? fieldName.replace(/-/gu, '.') as KeyframeSeatProperty
            : fieldName === 'transform-x' ? 'transform.x'
                : fieldName === 'transform-y' ? 'transform.y'
                    : fieldName === 'transform-scale' ? 'transform.scale'
                        : fieldName === 'transform-scaleX' ? 'transform.scaleX' as KeyframeSeatProperty
                            : fieldName === 'transform-scaleY' ? 'transform.scaleY' as KeyframeSeatProperty
                        : fieldName === 'transform-rotate' ? 'transform.rotate'
                            : fieldName === 'opacity' ? 'opacity' : undefined;
        if (!property) return undefined;
        const rowProperty = keyframeRowPropertyOf(property);
        const itemId = snapshot.kind === 'cut' ? `cut:${snapshot.index}` : snapshot.id;
        const keyframeValue = /^transform-scale(?:X|Y)?$/u.test(fieldName) ? value / 100 : value;
        const localFrame = Math.max(0, Math.round(
            ((snapshot.playheadSeconds ?? snapshot.outputStart) - snapshot.outputStart) * this.model.fps
        ));
        const active = snapshot.keyframes?.some(point => point.t === localFrame
            && keyframeValueAt(point, rowProperty) !== undefined) ?? false;
        const hasKeyframes = snapshot.keyframes?.some(point =>
            keyframeValueAt(point, rowProperty) !== undefined
            || (rowProperty === 'transform.scale' && (
                keyframeValueAt(point, 'transform.scaleX') !== undefined
                || keyframeValueAt(point, 'transform.scaleY') !== undefined))
            || ((rowProperty === 'transform.scaleX' || rowProperty === 'transform.scaleY')
                && keyframeValueAt(point, 'transform.scale') !== undefined)) ?? false;
        const request = (action: Exclude<KeyframeControlRequest['action'], 'easing'>): void => {
            void this.model.requestKeyframe?.({ action, itemId, property, value: keyframeValue });
        };
        return {
            active,
            hasKeyframes,
            onToggle: () => request('toggle'),
            onPrevious: () => request('previous'),
            onNext: () => request('next'),
            onReveal: () => request('reveal')
        };
    }

    protected appendRow(
        parent: HTMLElement,
        field: InspectorFieldDef,
        snapshot: InspectorSnapshot,
        kind: 'cut' | 'layer' | 'caption' | 'audio' | 'overlay' | 'item'
    ): void {
        const generationField = field as unknown as GenerationFieldDef<InspectorSnapshot>;
        if (generationField.generationChildren) {
            for (const child of generationField.generationChildren) this.appendRow(parent, child as InspectorFieldDef, snapshot, kind);
            return;
        }
        if (generationField.generationDetail) {
            let details = parent.querySelector<HTMLDetailsElement>(':scope > .akari-inspector-generation-details');
            if (!details) {
                details = document.createElement('details');
                details.className = 'akari-inspector-generation-details';
                details.open = this.generationDetailsOpen;
                const summary = document.createElement('summary');
                summary.textContent = '詳細';
                details.appendChild(summary);
                details.addEventListener('toggle', () => { this.generationDetailsOpen = details!.open; });
                parent.appendChild(details);
            }
            this.appendRow(details, { ...field, generationDetail: false } as InspectorFieldDef, snapshot, kind);
            return;
        }
        if (generationField.generationReferences) {
            const references = generationField.generationReferences;
            const identity = this.generationIdentity(snapshot);
            const disabled = !!field.disabled || !identity || this.generationFramePickDisabled(identity.key);
            const section = document.createElement('div');
            section.className = 'akari-inspector-generation-references';
            const heading = document.createElement('div');
            heading.className = 'akari-inspector-generation-reference-heading';
            const label = document.createElement('strong');
            label.textContent = field.label;
            const counter = document.createElement('span');
            counter.className = 'akari-inspector-generation-reference-counter';
            counter.textContent = references.counter;
            heading.appendChild(label);
            heading.appendChild(counter);
            section.appendChild(heading);
            const grid = document.createElement('div');
            grid.className = 'akari-inspector-generation-reference-grid';
            section.appendChild(grid);
            for (const entry of references.entries) {
                const card = document.createElement('div');
                card.className = 'akari-inspector-generation-reference-card';
                card.setAttribute('data-akari-generation-reference-path', entry.reference.path);
                const top = document.createElement('div');
                top.className = 'akari-inspector-generation-reference-top';
                const badge = document.createElement('span');
                badge.className = 'akari-inspector-generation-reference-badge';
                badge.textContent = entry.badge;
                if (entry.unsupported) card.className += ' akari-inspector-generation-reference-unsupported';
                top.appendChild(badge);
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'akari-inspector-generation-small';
                remove.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
                remove.setAttribute('aria-label', `${entry.badge} を外す`);
                remove.setAttribute('data-akari-generation-reference-remove', entry.badge);
                remove.disabled = disabled;
                remove.addEventListener('click', () => {
                    if (disabled || !identity || this.generationFramePickDisabled(identity.key)) return;
                    this.cancelGenerationFramePick();
                    void generationField.write!(snapshot, JSON.stringify({ slot: entry.slot, index: entry.index }))
                        .then(result => { if (!result.ok) this.showFieldNotice(result.message ?? '変更できませんでした。'); });
                });
                top.appendChild(remove);
                card.appendChild(top);
                const preview = document.createElement('div');
                preview.className = 'akari-inspector-generation-reference-thumbnail';
                preview.textContent = entry.slot === 'reference_audios' ? '音声' : '読み込み中…';
                if (entry.slot !== 'reference_audios') void this.generationThumbnail(entry.reference.path).then(uri => {
                    if (!preview.isConnected) return;
                    if (uri) {
                        const image = document.createElement('img');
                        image.src = uri; image.alt = entry.badge;
                        preview.textContent = ''; preview.appendChild(image);
                    } else preview.textContent = 'プレビューなし';
                });
                card.appendChild(preview);
                const filename = document.createElement('div');
                filename.className = 'akari-inspector-generation-reference-filename';
                filename.textContent = entry.reference.path.split('/').pop()!;
                filename.title = entry.reference.path;
                card.appendChild(filename);
                grid.appendChild(card);
            }
            if (references.kinds.length) {
                const tail = document.createElement('div');
                tail.className = 'akari-inspector-generation-reference-add';
                const select = document.createElement('select');
                select.setAttribute('aria-label', '追加する参照の種類');
                select.disabled = disabled;
                for (const kind of references.kinds) {
                    const option = document.createElement('option');
                    option.value = kind.slot; option.textContent = kind.label;
                    select.appendChild(option);
                }
                if (references.kinds.length > 1) tail.appendChild(select);
                const add = document.createElement('button');
                add.type = 'button'; add.textContent = '追加';
                add.className = 'akari-inspector-generation-secondary';
                add.setAttribute('data-akari-generation-reference-add', 'true');
                add.disabled = disabled;
                const pick = async (): Promise<void> => {
                    if (disabled || !identity || this.isDisposed || this.currentTab !== 'generation'
                        || this.generationIdentity(this.model.snapshot)?.key !== identity.key
                        || this.generationFramePickDisabled(identity.key)) return;
                    const kind = references.kinds.find(kind => kind.slot === select.value) ?? references.kinds[0];
                    if (this.generationFramePick?.key === identity.key && this.generationFramePick.slot === kind.slot) {
                        this.cancelGenerationFramePick();
                        return;
                    }
                    const current = this.generationDrafts.get(identity.key)!;
                    const selectedRevision = JSON.stringify(current.inputs[kind.slot] ?? []);
                    const pending = { key: identity.key, slot: kind.slot };
                    this.generationFramePick = pending;
                    this.generationFramePickMessage = undefined;
                    const isCurrent = (): boolean => this.generationFramePick === pending && !this.isDisposed
                        && this.currentTab === 'generation' && this.generationIdentity(this.model.snapshot)?.key === identity.key
                        && this.generationDrafts.get(identity.key)?.modelId === current.modelId
                        && JSON.stringify(this.generationDrafts.get(identity.key)?.inputs[kind.slot] ?? []) === selectedRevision
                        && !this.generationFramePickDisabled(identity.key);
                    const selected = references.entries.filter(entry => entry.slot === kind.slot).map(entry => entry.reference.path);
                    const request: GenerationPickRequest = {
                        slot: kind.slot, label: `参照${kind.label}`, accepts: [kind.kind], multi: true, selected, max: kind.max
                    };
                    try {
                        if (!this.commandRegistry.getCommand(GENERATION_PICK_INTO_COMMAND_ID)) throw new Error('素材パネルを開けません。');
                        const result = await this.commandRegistry.executeCommand<GenerationPickResult>(GENERATION_PICK_INTO_COMMAND_ID, request);
                        if (!isCurrent() || result.status !== 'picked') return;
                        if (result.paths.some(path => generationFields.referenceSlot(path) !== kind.slot)) throw new Error('この種類には選べない素材です。');
                        const values = await Promise.all(result.paths.map(async path => {
                            const existing = references.entries.find(entry => entry.slot === kind.slot && entry.reference.path === path)?.reference;
                            if (existing) return existing;
                            const reference: { path: string; range_s?: [number, number] } = { path };
                            const root = this.workspaceService.tryGetRoots()[0]?.resource;
                            if (root && kind.kind !== 'image') {
                                try {
                                    const duration = await this.layerAudioService.getAudioDuration({
                                        projectRootUri: root.toString(), audioUri: root.resolve(path).toString()
                                    });
                                    if (duration.status === 'ready' && Number.isFinite(duration.durationSeconds) && duration.durationSeconds! > 0)
                                        reference.range_s = [0, duration.durationSeconds!];
                                } catch { /* Missing duration is allowed; range editing is a later task. */ }
                            }
                            return reference;
                        }));
                        if (!isCurrent()) return;
                        generationFields.rememberReferences(current.inputs);
                        generationFields.rememberReferences({ [kind.slot]: values });
                        const updated = await this.updateGenerationDraft(identity, `inputs.${kind.slot}`, values);
                        if (!updated.ok) throw new Error(updated.message ?? '変更できませんでした。');
                    } catch (error) {
                        if (this.generationFramePick === pending) {
                            this.generationFramePickMessage = { key: identity.key, text: error instanceof Error ? error.message : String(error) };
                            this.render();
                        }
                    } finally {
                        if (this.generationFramePick === pending) this.cancelGenerationFramePick(false);
                    }
                };
                add.addEventListener('click', () => { void pick(); });
                tail.appendChild(add);
                grid.appendChild(tail);
            }
            for (const text of [...references.notes, ...(references.entries.length ? ['指示文の中で @画像1 のように名指しできます'] : [])]) {
                const note = document.createElement('div');
                note.className = 'akari-inspector-generation-note';
                note.textContent = text;
                section.appendChild(note);
            }
            parent.appendChild(section);
            return;
        }
        if (generationField.generationCheckbox) {
            const label = document.createElement('label');
            label.className = 'akari-inspector-generation-draft';
            label.setAttribute('data-akari-generation-field', field.name!);
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = field.getValue(snapshot) === 'true';
            checkbox.disabled = !!field.disabled;
            checkbox.addEventListener('change', () => {
                checkbox.disabled = true;
                void field.write!(snapshot, String(checkbox.checked)).then(result => {
                    if (!result.ok) { checkbox.checked = !checkbox.checked; this.showFieldNotice(result.message ?? '変更できませんでした。'); }
                }).finally(() => { checkbox.disabled = !!field.disabled; });
            });
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(field.label));
            parent.appendChild(label);
            return;
        }
        if (generationField.generationFrame || generationField.generationButtons) {
            const groupClass = generationField.generationFrame ? 'akari-inspector-generation-frames' : 'akari-inspector-generation-camera';
            let group = generationField.generationFrame ? parent.querySelector<HTMLElement>(`:scope > .${groupClass}`) : undefined;
            if (!group) {
                group = document.createElement('div');
                group.className = groupClass;
                parent.appendChild(group);
            }
            const cell = document.createElement('div');
            cell.className = 'akari-inspector-generation-cell';
            cell.setAttribute('data-akari-generation-field', field.name!);
            group.appendChild(cell);
            const label = document.createElement('div');
            label.textContent = field.label;
            cell.appendChild(label);
            const invoke = (operation: Promise<InspectorWriteResult>): void => {
                void operation.then(result => { if (!result.ok) this.showFieldNotice(result.message ?? '変更できませんでした。'); });
            };
            if (generationField.generationFrame) {
                const preview = document.createElement('div');
                preview.className = 'akari-inspector-generation-frame';
                const path = field.getValue(snapshot);
                const identity = this.generationIdentity(snapshot);
                const slot = field.name === 'first-frame' ? 'first_frame' : 'last_frame';
                const disabled = !!field.disabled || !identity || this.generationFramePickDisabled(identity.key);
                preview.setAttribute('role', 'button');
                preview.tabIndex = 0;
                preview.setAttribute('aria-label', `${field.label}: ${path ? '差し替える' : '画像を選ぶ'}`);
                preview.setAttribute('aria-disabled', String(disabled));
                preview.setAttribute('aria-pressed', String(this.generationFramePick?.key === identity?.key
                    && this.generationFramePick?.slot === slot));
                preview.setAttribute('data-akari-generation-pick-slot', slot);
                preview.title = path ? '差し替える' : '画像を選ぶ';
                const content = document.createElement('span');
                content.textContent = path ? '読み込み中…' : '画像を選ぶ';
                preview.appendChild(content);
                const badge = document.createElement('span');
                badge.className = path ? 'akari-inspector-generation-frame-replace' : 'akari-inspector-generation-frame-hint';
                badge.textContent = path ? '差し替え' : '空なら入れなくてよい';
                preview.appendChild(badge);
                const pick = (): void => {
                    if (!disabled && identity) void this.pickGenerationFrame(identity, slot, path);
                };
                preview.addEventListener('click', pick);
                preview.addEventListener('keydown', event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (!event.repeat) pick();
                });
                cell.appendChild(preview);
                if (generationField.generationThumbnail) void generationField.generationThumbnail().then(uri => {
                    if (!preview.isConnected) return;
                    if (uri) {
                        const image = document.createElement('img');
                        image.src = uri;
                        image.alt = field.label;
                        content.replaceWith(image);
                    } else content.textContent = '画像を表示できません';
                });
                for (const action of generationField.actions ?? []) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = action.name === 'remove'
                        ? 'akari-inspector-generation-small' : 'akari-inspector-generation-secondary';
                    button.textContent = action.label;
                    button.setAttribute('data-akari-generation-action', `${field.name}-${action.name}`);
                    button.addEventListener('click', () => invoke(action.action(snapshot)));
                    cell.appendChild(button);
                }
            } else {
                for (const value of generationField.options ?? []) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'akari-inspector-generation-camera-button';
                    button.textContent = value;
                    button.setAttribute('aria-pressed', String(value === field.getValue(snapshot)));
                    button.disabled = !!generationField.disabled;
                    button.setAttribute(generationField.generationMode ? 'data-akari-generation-mode' : 'data-akari-generation-camera', value);
                    button.addEventListener('click', () => invoke(field.write!(snapshot, value)));
                    cell.appendChild(button);
                }
            }
            return;
        }
        if (field.name === 'generation-actions') {
            const identity = this.generationIdentity(snapshot);
            const draftRevision = (): string => JSON.stringify(identity ? this.generationDrafts.get(identity.key) : null);
            if (this.generationActionError && (this.generationActionError.key !== identity?.key
                || this.generationActionError.draft !== draftRevision())) this.generationActionError.clear();
            const footer = document.createElement('div');
            footer.className = 'akari-inspector-generation-footer';
            const paintError = (): void => {
                footer.querySelector('.akari-inspector-generation-action-error')?.remove();
                if (!this.generationActionError || this.generationActionError.key !== identity?.key) return;
                const error = document.createElement('div');
                error.className = 'akari-inspector-generation-action-error akari-inspector-generation-error';
                error.setAttribute('role', 'alert');
                error.textContent = this.generationActionError.text;
                footer.prepend(error);
            };
            paintError();
            const submitGroup = document.createElement('div');
            submitGroup.className = 'akari-inspector-generation-submit-group';
            const estimate = parent.querySelector('.akari-inspector-generation-estimate');
            if (estimate) submitGroup.appendChild(estimate);
            const actions = field.actions ?? [];
            for (const action of [...actions.filter(action => action.name !== 'generate'), ...actions.filter(action => action.name === 'generate')]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = action.name === 'generate'
                    ? 'akari-inspector-generation-primary' : 'akari-inspector-generation-secondary';
                button.textContent = action.label;
                button.disabled = !!action.disabled;
                button.setAttribute('data-akari-generation-action', action.name);
                button.addEventListener('click', () => {
                    this.generationActionError?.clear();
                    const revision = draftRevision();
                    void action.action(snapshot).then(result => {
                        if (result.ok) return;
                        const message = result.message ?? '操作に失敗しました。';
                        this.showFieldNotice(message);
                        if (!identity || this.generationIdentity(this.model.snapshot)?.key !== identity.key
                            || draftRevision() !== revision) return;
                        this.generationActionError?.clear();
                        const clear = (): void => {
                            this.generationActionError = undefined;
                            for (const event of ['click', 'input', 'change']) this.body.removeEventListener(event, clear, true);
                            this.body.querySelectorAll('.akari-inspector-generation-action-error').forEach(row => row.remove());
                        };
                        this.generationActionError = { key: identity.key, draft: revision, text: message, clear };
                        // Capture the next interaction before its handler; unrelated re-renders keep the error.
                        for (const event of ['click', 'input', 'change']) this.body.addEventListener(event, clear, true);
                        if (footer.isConnected) paintError();
                        else this.render();
                    });
                });
                (action.name === 'copy-adjacent' ? footer : submitGroup).appendChild(button);
            }
            footer.appendChild(submitGroup);
            parent.appendChild(footer);
            return;
        }
        const row = document.createElement('div');
        row.className = 'akari-inspector-row';
        if (field.className) row.classList.add(field.className);
        if (field.title) row.title = field.title;
        const fieldName = field.name ?? field.label.toLowerCase().replace(/[^a-z0-9_-]+/giu, '-');
        row.setAttribute('data-akari-field', fieldName);
        if (fieldName.startsWith('caption-run-')) row.setAttribute('data-akari-caption-run-index',
            fieldName.slice('caption-run-'.length));
        if (field.revealName) row.setAttribute('data-inspector-field', field.revealName);
        const labelElement = document.createElement('div');
        labelElement.className = 'akari-inspector-row-label';
        labelElement.textContent = field.label;
        row.appendChild(labelElement);
        for (const mark of field.markers ?? []) {
            const badge = document.createElement('small');
            badge.className = 'akari-inspector-motion-mark';
            badge.textContent = mark;
            badge.title = mark;
            labelElement.appendChild(badge);
        }

        if (field.actions) {
            const actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.gap = '4px';
            labelElement.style.fontWeight = '600';
            for (const definition of field.actions) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'akari-inspector-row-input';
                button.textContent = definition.label;
                button.title = definition.title;
                button.setAttribute('aria-label', definition.title);
                button.setAttribute('data-akari-ui', `action:inspector-${fieldName}-${definition.name}`);
                button.disabled = field.disabled === true || definition.disabled === true;
                button.addEventListener('click', () => void definition.action(snapshot).then(result => {
                    if (!result.ok) this.showFieldNotice(result.message ?? '操作に失敗しました。');
                }));
                actions.appendChild(button);
            }
            row.appendChild(actions);
            parent.appendChild(row);
            return;
        }

        if (field.action) {
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'akari-inspector-row-input';
            action.textContent = field.actionLabel ?? field.label;
            if (fieldName === 'caption-font-family') {
                this.ensureCaptionRowFontFace();
                action.style.fontFamily = `${JSON.stringify(captionRowFontFace(field.getValue(snapshot), this.captionPanelFontFaces))}, sans-serif`;
            }
            action.disabled = field.disabled === true;
            if (field.pressed) action.setAttribute('aria-pressed', String(field.pressed()));
            if (field.title) action.title = field.title;
            action.setAttribute('data-akari-ui', `action:inspector-${fieldName}`);
            action.addEventListener('click', () => {
                action.disabled = true;
                if (field.busyLabel) action.textContent = field.busyLabel;
                void field.action!(snapshot).then(result => {
                    if (!result.ok) this.showFieldNotice(result.message ?? '操作に失敗しました。');
                }).catch(error => this.showFieldNotice(error instanceof Error ? error.message : String(error)))
                    .finally(() => { action.disabled = field.disabled === true; action.textContent = field.actionLabel ?? field.label;
                        if (field.pressed) action.setAttribute('aria-pressed', String(field.pressed())); });
            });
            row.appendChild(action);
            parent.appendChild(row);
            return;
        }

        if (!field.write) {
            const valueElement = document.createElement('div');
            valueElement.className = 'akari-inspector-row-value';
            valueElement.textContent = field.getValue(snapshot);
            if (field.disabled) {
                row.setAttribute('aria-disabled', 'true');
                row.style.color = 'var(--akari-faint)';
            }
            row.appendChild(valueElement);
            parent.appendChild(row);
            return;
        }

        const write = field.write;
        const editValue = field.getEditValue ? field.getEditValue(snapshot) : field.getValue(snapshot);
        const commitValue = async (nextValue: string, revert: () => void): Promise<boolean> => {
            if (nextValue === editValue) {
                return true;
            }
            const result = await write(snapshot, nextValue);
            if (!result.ok) {
                revert();
                this.showFieldNotice(result.message ?? '書き込みに失敗しました。変更は保存されていません。');
                return false;
            }
            return true;
        };

        if (field.inputKind === 'slider-number') {
            const control = document.createElement('div');
            control.className = 'akari-caption-slider-number';
            const range = document.createElement('input');
            range.type = 'range';
            range.min = String(field.min ?? 0);
            range.max = String(field.sliderMax ?? field.max ?? 100);
            range.step = String(field.scrubStep ?? 1);
            range.value = editValue === '—' ? range.min
                : String(Math.min(Number(range.max), Math.max(Number(range.min), Number(editValue))));
            range.setAttribute('aria-label', `${field.label} スライダー`);
            const number = document.createElement('input');
            number.type = 'number';
            number.className = 'akari-inspector-row-input';
            const scale = field.displayScale ?? 1;
            number.min = String(Number(range.min) * scale);
            number.step = String(Number(range.step) * scale);
            number.value = editValue === '—' ? '' : String(Number(editValue) * scale);
            number.placeholder = editValue === '—' ? '—' : '';
            number.setAttribute('aria-label', `${field.label} 数値`);
            const unit = document.createElement('span');
            unit.className = 'akari-caption-slider-unit';
            unit.textContent = field.unit ?? '';
            const defaultNote = document.createElement('span');
            defaultNote.className = 'akari-caption-default-note';
            defaultNote.textContent = field.getValue(snapshot).includes('（既定）') ? '（既定）' : '';
            const valueGroup = document.createElement('span');
            valueGroup.className = 'akari-caption-slider-value';
            valueGroup.append(number, unit, defaultNote);
            const commit = (raw: number): void => {
                if (!Number.isFinite(raw)) return;
                void commitValue(String(raw), () => {
                    number.value = editValue === '—' ? '' : String(Number(editValue) * scale);
                    range.value = editValue === '—' ? range.min : editValue;
                });
            };
            let captionLive: ((raw: number, clear?: boolean) => void) | undefined;
            if (snapshot.kind === 'caption') {
                const captionLiveField = fieldName === 'caption-size' ? 'caption.size' as const
                    : fieldName === 'caption-line-height' ? 'caption.lineHeight' as const
                        : fieldName === 'caption-letter-spacing' ? 'caption.letterSpacing' as const
                            : fieldName === 'caption-stroke-width' ? 'caption.strokeWidth' as const
                                : undefined;
                if (captionLiveField) {
                    const captionId = snapshot.id;
                    captionLive = (raw, clear = false) => this.model.requestLivePreview?.({
                        target: { kind: 'caption', id: captionId }, field: captionLiveField, value: raw, clear
                    });
                }
            }
            range.addEventListener('input', () => {
                number.value = String(Number(range.value) * scale);
                defaultNote.textContent = '';
                captionLive?.(Number(range.value));
            });
            range.addEventListener('change', () => commit(Number(range.value)));
            number.addEventListener('change', () => {
                const raw = Number(number.value) / scale;
                if (number.value.trim() === '' || !Number.isFinite(raw)) return;
                range.value = String(Math.min(Number(range.max), Math.max(Number(range.min), raw)));
                defaultNote.textContent = '';
                commit(raw);
            });
            number.addEventListener('input', () => {
                const raw = Number(number.value) / scale;
                if (number.value.trim() && Number.isFinite(raw)) captionLive?.(raw);
            });
            for (const control of [range, number]) control.addEventListener('keydown', event => {
                if (event.key !== 'Escape' || !captionLive) return;
                event.preventDefault();
                range.value = editValue === '—' ? range.min : editValue;
                number.value = editValue === '—' ? '' : String(Number(editValue) * scale);
                captionLive(Number(editValue), true);
            });
            control.append(range, valueGroup);
            row.appendChild(control);
            parent.appendChild(row);
            return;
        }

        if (field.inputKind === 'caption-toggle') {
            const label = document.createElement('label');
            label.className = 'akari-caption-toggle';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = editValue === 'true';
            checkbox.indeterminate = editValue === '—';
            checkbox.setAttribute('aria-label', '座布団を敷く');
            label.append(checkbox, document.createTextNode('座布団を敷く'));
            checkbox.addEventListener('change', () => void commitValue(String(checkbox.checked), () => {
                checkbox.checked = editValue === 'true';
            }));
            row.appendChild(label);
            parent.appendChild(row);
            return;
        }

        if (field.inputKind === 'caption-effect') {
            const choices = document.createElement('div');
            choices.className = 'akari-caption-effect-gallery';
            const caption = snapshot.kind === 'caption' ? snapshot : undefined;
            const preview = (id: string): void => {
                if (!caption) return;
                const patch = captionEffectTransitionPatch(id as Parameters<typeof captionEffectPatch>[0],
                    caption.effectiveTextStyle?.color ?? '#ffffff', caption.effectiveTextStyle);
                this.runCaptionPanelPreview({ type: 'enter', captionId: caption.id,
                    textStyle: captionEffectPreviewStyle(caption.effectiveTextStyle, patch) });
            };
            const imageGroups: Array<Array<{ id: Parameters<typeof captionEffectImage>[0]; image: HTMLImageElement }>> = [];
            for (const group of CAPTION_EFFECT_GROUPS) {
                const title = document.createElement('div');
                title.className = 'akari-effect-group-title';
                title.textContent = group.label;
                choices.appendChild(title);
                const grid = document.createElement('div');
                grid.className = 'akari-effect-grid';
                const groupImages: Array<{ id: Parameters<typeof captionEffectImage>[0]; image: HTMLImageElement }> = [];
                for (const item of group.items) {
                    const card = document.createElement('button');
                    card.type = 'button';
                    card.className = 'akari-effect-card';
                    card.dataset.value = item.id;
                    card.setAttribute('aria-pressed', String(editValue === item.id));
                    const image = document.createElement('img');
                    image.alt = '';
                    groupImages.push({ id: item.id, image });
                    const name = document.createElement('span');
                    name.textContent = item.label;
                    card.append(image, name);
                    card.addEventListener('pointerenter', () => preview(item.id));
                    card.addEventListener('focus', () => preview(item.id));
                    card.addEventListener('pointerleave', () => this.runCaptionPanelPreview({ type: 'leave' }));
                    card.addEventListener('blur', () => this.runCaptionPanelPreview({ type: 'leave' }));
                    card.addEventListener('keydown', event => {
                        if (event.key !== 'Escape') return;
                        event.preventDefault();
                        event.stopPropagation();
                        this.runCaptionPanelPreview({ type: 'escape' });
                        card.blur();
                    });
                    card.addEventListener('click', () => {
                        if (caption) this.runCaptionPanelPreview({ type: 'confirm', captionId: caption.id });
                        void write(snapshot, item.id).then(result => {
                            if (!result.ok) this.showFieldNotice(result.message ?? '効果を書き込めませんでした。');
                        });
                    });
                    grid.appendChild(card);
                }
                imageGroups.push(groupImages);
                choices.appendChild(grid);
            }
            scheduleCaptionEffectImages(imageGroups,
                item => { if (item.image.isConnected || item.image.parentElement) item.image.src = captionEffectImage(item.id); },
                callback => { window.requestAnimationFrame(callback); });
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'akari-inspector-row-input';
            clear.textContent = '効果を外す';
            clear.addEventListener('click', () => void write(snapshot, 'none').then(result => {
                if (!result.ok) this.showFieldNotice(result.message ?? '効果を外せませんでした。');
            }));
            choices.appendChild(clear);
            row.appendChild(choices);
            parent.appendChild(row);
            return;
        }
        if (field.inputKind === 'caption-mode'
            || field.inputKind === 'caption-weight') {
            const choices = document.createElement('div');
            choices.className = field.inputKind === 'caption-mode'
                ? 'akari-caption-mode-choices' : field.inputKind === 'caption-weight'
                    ? 'akari-caption-weight-choices' : 'akari-caption-effect-choices';
            const values = field.inputKind === 'caption-mode'
                ? [['per-line', '行ごと'], ['block', 'まとめて']]
                : [['400', '普通'], ['700', '太字'], ['900', '極太']];
            for (const [value, label] of values) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'akari-caption-choice';
                button.setAttribute('aria-pressed', String(editValue === value));
                button.dataset.value = value;
                if (field.inputKind === 'caption-mode') {
                    button.appendChild(createInspectorIcon(value === 'per-line' ? 'plateLine' : 'plateBlock'));
                }
                button.appendChild(document.createTextNode(label));
                button.addEventListener('click', () => {
                    if (field.inputKind === 'caption-weight') {
                        void write(snapshot, value).then(result => {
                            if (!result.ok) this.showFieldNotice(result.message ?? '効果を書き込めませんでした。');
                        });
                    } else {
                        void commitValue(value, () => undefined);
                    }
                });
                choices.appendChild(button);
            }
            row.appendChild(choices);
            parent.appendChild(row);
            return;
        }

        if (field.inputKind === 'scrub-number') {
            let sendLive: ((value: number) => void) | undefined;
            let clearLive: (() => void) | undefined;
            const liveShape = field.liveShape;
            if (field.liveField || liveShape) {
                const liveField = field.liveField;
                const target: LivePreviewTarget | undefined = snapshot.kind === 'cut'
                    ? { kind: 'cut', index: snapshot.index }
                    : snapshot.kind === 'layer'
                        ? { kind: 'layer', id: snapshot.id }
                        : snapshot.kind === 'item' || snapshot.kind === 'overlay'
                            ? { kind: 'item', id: snapshot.id } : undefined;
                if (liveShape) {
                    sendLive = value => liveShape(value);
                    clearLive = () => liveShape(undefined);
                } else if (target && liveField) {
                    sendLive = value => this.model.requestLivePreview?.({
                        target, field: liveField,
                        value: /^transform-scale(?:X|Y)?$/u.test(fieldName) && field.unit === '%'
                            ? value / 100 : value
                    });
                    clearLive = () => this.model.requestLivePreview?.({
                        target, field: liveField,
                        value: /^transform-scale(?:X|Y)?$/u.test(fieldName) && field.unit === '%'
                            ? Number(editValue) / 100 : Number(editValue), clear: true
                    });
                }
            }
            const numericValue = Number(editValue);
            if (Number.isFinite(numericValue)) {
                const keyframe = this.keyframeSeatOptions(snapshot, fieldName, numericValue);
                const numberField = createNumberField({
                    name: fieldName, label: field.label, value: numericValue,
                    step: field.scrubStep ?? 0.1, min: field.min, max: field.max, unit: field.unit,
                    displayScale: field.displayScale,
                    displayOffset: field.displayOffset,
                    displayPrecision: field.displayPrecision,
                    focusRoot: this.node,
                    onPreview: sendLive,
                    onCancel: clearLive,
                    onCommit: async value => {
                        if (value === numericValue) return true;
                        if (keyframe?.hasKeyframes && /^(crop-|perspective-|transform-)/u.test(fieldName)
                            && this.model.requestKeyframe) {
                            const itemId = snapshot.kind === 'cut' ? `cut:${snapshot.index}` : snapshot.id;
                            const property = fieldName.startsWith('transform-')
                                ? fieldName.replace('transform-', 'transform.') as KeyframeSeatProperty
                                : fieldName.replace(/-/gu, '.') as KeyframeSeatProperty;
                            const result = await this.model.requestKeyframe({
                                action: 'write', itemId,
                                property,
                                value: fieldName.startsWith('transform-scale') ? value / 100 : value
                            });
                            if (!result.ok) this.showFieldNotice(result.message ?? '書き込みに失敗しました。');
                            return result.ok;
                        }
                        return commitValue(String(value), () => undefined);
                    },
                    keyframe
                });
                if (field.disabled) {
                    for (const control of Array.from(numberField.querySelectorAll('button, input'))) {
                        (control as HTMLButtonElement | HTMLInputElement).disabled = true;
                    }
                    if (field.title) numberField.title = field.title;
                }
                if (field.keyframeDisabled) {
                    for (const control of Array.from(
                        numberField.querySelectorAll('.akari-inspector-kf-controls button')
                    )) {
                        (control as HTMLButtonElement).disabled = true;
                    }
                }
                row.appendChild(numberField);
                if (keyframe?.hasKeyframes) {
                    row.addEventListener('dblclick', event => {
                        const target = event.target instanceof Element ? event.target : undefined;
                        if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
                        event.preventDefault();
                        event.stopPropagation();
                        keyframe.onReveal();
                    });
                }
            }
            this.attachRowMenu(row, field, snapshot, kind);
            parent.appendChild(row);
            return;
        }

        if (field.inputKind === 'color') {
            this.appendColorInput(row, fieldName, editValue, commitValue, field.label, field.liveColor);
            parent.appendChild(row);
            return;
        }

        if (field.inputKind === 'zone-grid') {
            const grid = document.createElement('div');
            grid.className = 'akari-caption-zone-grid';
            grid.setAttribute('data-akari-ui', `field:inspector-${fieldName}`);
            const angles = [-45, 0, 45, -90, undefined, 90, -135, 180, 135];
            (field.options ?? []).forEach((zone, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'akari-caption-zone-cell';
                button.dataset.akariCaptionZone = zone;
                button.innerHTML = index === 4
                    ? '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.75"/></svg>'
                    : `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 20V4M6 10l6-6 6 6" transform="rotate(${angles[index] ?? 0} 12 12)" fill="none" stroke="currentColor" stroke-width="1.75"/></svg>`;
                button.title = zone;
                button.setAttribute('aria-label', `字幕位置: ${zone}`);
                if (zone === editValue) {
                    button.classList.add('is-saved');
                    button.setAttribute('aria-pressed', 'true');
                    const saved = document.createElement('span');
                    saved.className = 'akari-caption-zone-saved';
                    saved.textContent = '保存中';
                    button.appendChild(saved);
                } else {
                    button.setAttribute('aria-pressed', 'false');
                }
                button.addEventListener('mouseenter', () => field.zoneHover?.(zone));
                button.addEventListener('mouseleave', () => field.zoneHover?.(null));
                button.addEventListener('focus', () => field.zoneHover?.(zone));
                button.addEventListener('blur', () => field.zoneHover?.(null));
                button.addEventListener('click', () => field.zonePreset?.(zone));
                grid.appendChild(button);
            });
            row.appendChild(grid);
            parent.appendChild(row);
            return;
        }

        let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        if (field.inputKind === 'boolean-select' || field.inputKind === 'select') {
            const select = document.createElement('select');
            select.className = 'akari-inspector-row-input';
            const options = field.inputKind === 'boolean-select' ? ['true', 'false'] : field.options ?? [];
            if (editValue === '—' && !options.includes(editValue)) {
                const mixedOption = document.createElement('option');
                mixedOption.value = '—';
                mixedOption.textContent = '—';
                mixedOption.disabled = true;
                select.appendChild(mixedOption);
            }
            for (const optionValue of options) {
                const option = document.createElement('option');
                option.value = optionValue;
                if (field.optionTitles?.[optionValue]) option.title = field.optionTitles[optionValue];
                option.textContent = field.inputKind === 'boolean-select'
                    ? (optionValue === 'true' ? 'ON' : 'OFF')
                    : optionValue;
                if (field.previewOption) {
                    option.addEventListener('mouseenter', () => field.previewOption?.(optionValue));
                    option.addEventListener('focus', () => field.previewOption?.(optionValue));
                }
                select.appendChild(option);
            }
            select.value = field.inputKind === 'boolean-select'
                ? (editValue === 'true' ? 'true' : 'false')
                : editValue;
            input = select;
        } else if (field.inputKind === 'caption-text') {
            const textarea = document.createElement('textarea');
            textarea.className = 'akari-inspector-row-input';
            textarea.rows = 2;
            textarea.value = editValue;
            const fit = (): void => {
                textarea.style.height = 'auto';
                textarea.style.height = `${textarea.scrollHeight}px`;
            };
            textarea.addEventListener('input', fit);
            requestAnimationFrame(fit);
            input = textarea;
        } else {
            const textInput = document.createElement('input');
            // seed は空欄 = 未設定を保つため、空を 0 に変換する scrub-number を通さない。
            textInput.type = field.inputKind === 'number' ? 'number' : 'text';
            if (field.inputKind === 'number') {
                textInput.step = String(field.scrubStep ?? 1);
                if (field.min !== undefined) textInput.min = String(field.min);
                if (field.max !== undefined) textInput.max = String(field.max);
            }
            textInput.className = 'akari-inspector-row-input';
            textInput.value = editValue;
            input = textInput;
        }

        const commit = async (): Promise<void> => {
            await commitValue(input.value, () => {
                input.value = editValue;
            });
        };

        if (field.inputKind === 'boolean-select' || field.inputKind === 'select') {
            input.addEventListener('change', () => {
                void commit();
            });
        } else {
            input.addEventListener('blur', () => {
                void commit();
            });
            input.addEventListener('keydown', event => {
                const keyboard = event as KeyboardEvent;
                if (keyboard.isComposing || keyboard.keyCode === 229) return;
                const key = keyboard.key;
                if (field.inputKind === 'caption-text') {
                    if (key === 'Enter' && (navigator.platform.includes('Mac') ? keyboard.metaKey : keyboard.ctrlKey)) {
                        event.preventDefault();
                        input.blur();
                    } else if (key === 'Escape') {
                        event.preventDefault();
                        input.value = editValue;
                        input.blur();
                    }
                    return;
                }
                if (key === 'Enter') {
                    event.preventDefault();
                    (input as HTMLInputElement).blur();
                } else if (key === 'Escape') {
                    event.preventDefault();
                    input.value = editValue;
                    (input as HTMLInputElement).blur();
                }
            });
        }

        row.appendChild(input);
        this.attachRowMenu(row, field, snapshot, kind);
        input.disabled = field.disabled === true;
        if (field.title) input.title = field.title;
        input.setAttribute('data-akari-ui', `field:inspector-${fieldName}`);
        if (field.previewOption && field.options?.length) {
            const previews = document.createElement('div');
            previews.setAttribute('data-akari-ui', `easing-preview:inspector-${fieldName}`);
            Object.assign(previews.style, {
                gridColumn: '2', display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px'
            });
            for (const optionValue of field.options) {
                const preview = document.createElement('button');
                preview.type = 'button';
                preview.textContent = optionValue;
                preview.dataset.akariEasingPreview = optionValue;
                preview.addEventListener('mouseenter', () => field.previewOption?.(optionValue));
                preview.addEventListener('focus', () => field.previewOption?.(optionValue));
                preview.addEventListener('click', () => {
                    input.value = optionValue;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                });
                previews.appendChild(preview);
            }
            row.appendChild(previews);
        }
        parent.appendChild(row);
    }

    protected attachRowMenu(
        row: HTMLElement,
        field: InspectorFieldDef,
        snapshot: InspectorSnapshot,
        kind: string
    ): void {
        if (field.disabled || (!field.reset && !field.removable && !field.menuAction)) return;
        row.addEventListener('contextmenu', event => {
            event.preventDefault();
            const menu = document.createElement('div');
            menu.className = 'akari-inspector-row-menu';
            Object.assign(menu.style, {
                position: 'fixed', left: `${event.clientX}px`, top: `${event.clientY}px`, zIndex: '10000',
                display: 'grid', padding: '4px', background: 'var(--akari-elevated)',
                border: '1px solid var(--akari-line)'
            });
            if (field.reset) {
                const reset = document.createElement('button');
                reset.type = 'button';
                reset.textContent = '既定値に戻す';
                reset.addEventListener('click', () => {
                    menu.remove();
                    void field.reset!(snapshot).then(result => {
                        if (!result.ok) this.showFieldNotice(result.message ?? '既定値へ戻せませんでした。');
                    });
                });
                menu.appendChild(reset);
            }
            if (field.removable && field.name) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.textContent = '行を消す';
                remove.addEventListener('click', () => {
                    menu.remove();
                    this.setOptionalFieldVisible(kind, field.name!, false);
                    this.render();
                });
                menu.appendChild(remove);
            }
            if (field.menuAction) {
                const action = document.createElement('button');
                action.type = 'button';
                action.textContent = field.menuAction.label;
                action.addEventListener('click', () => {
                    menu.remove();
                    void field.menuAction!.action(snapshot).then(result => {
                        if (!result.ok) this.showFieldNotice(result.message ?? '操作に失敗しました。');
                    });
                });
                menu.appendChild(action);
            }
            const dismiss = (pointerEvent: PointerEvent): void => {
                if (pointerEvent.target instanceof Node && menu.contains(pointerEvent.target)) return;
                menu.remove();
                window.removeEventListener('pointerdown', dismiss, true);
            };
            window.setTimeout(() => window.addEventListener('pointerdown', dismiss, true), 0);
            document.body.appendChild(menu);
        });
    }

    protected appendColorInput(
        row: HTMLDivElement,
        fieldName: string,
        editValue: string,
        commitValue: (nextValue: string, revert: () => void) => Promise<boolean>,
        label = '色',
        onInput?: (value: string) => void
    ): void {
        const container = document.createElement('div');
        container.className = 'akari-inspector-color-field';
        container.setAttribute('data-akari-ui', `field:inspector-${fieldName}`);
        // 丸を押すと、同じ列の中が色パネルに切り替わる（戻るボタンで元の列へ）。色番号はこの欄にも直接打てる。
        const swatch = createColorRowSwatch(editValue, label,
            () => this.openColorPanel({ target: { kind: 'field', field: fieldName } }));
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.className = 'akari-inspector-row-input';
        textInput.value = editValue;
        const paintSwatch = (value: string): void => {
            const paint = parsePaint(value);
            if (paint !== undefined) swatch.style.background = swatchBackground(paint);
        };
        const revert = (): void => {
            textInput.value = editValue;
            paintSwatch(editValue);
        };
        textInput.addEventListener('input', () => {
            paintSwatch(textInput.value);
            onInput?.(textInput.value);
        });
        textInput.addEventListener('blur', () => {
            void commitValue(textInput.value, revert);
        });
        textInput.addEventListener('keydown', event => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                textInput.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                revert();
                onInput?.(editValue);
                textInput.blur();
            }
        });
        container.append(swatch, textInput);
        row.appendChild(container);
    }

    // ---- 色パネル（inspector/color-panel*.ts。ここは選択と書き込みへの橋渡しだけ）----

    protected colorPanelHostInstance: ColorPanelHost | undefined;

    protected get colorPanelHost(): ColorPanelHost {
        if (!this.colorPanelHostInstance) {
            this.colorPanelHostInstance = new ColorPanelHost({
                executeCommand: (id, ...args) => this.commandRegistry.executeCommand(id, ...args),
                readProjectText: async path => {
                    const root = this.workspaceService.tryGetRoots()[0]?.resource;
                    if (!root) return undefined;
                    const uri = path === 'edit.json' ? currentTimelineEditUri(root) : root.resolve(path);
                    try { return (await this.fileService.readFile(uri)).value.toString(); } catch { return undefined; }
                },
                readProjectBytes: async path => {
                    const root = this.workspaceService.tryGetRoots()[0]?.resource;
                    if (!root) return undefined;
                    try { return (await this.fileService.readFile(root.resolve(path))).value.buffer; } catch { return undefined; }
                },
                videoFrame: path => this.generationThumbnail(path),
                notice: message => this.showFieldNotice(message),
                storage: typeof localStorage === 'undefined' ? undefined : localStorage
            });
            this.toDispose.push({ dispose: () => this.colorPanelHostInstance?.close() });
        }
        return this.colorPanelHostInstance;
    }

    /** 今の選択を表す鍵（選択が変わったら色パネルを閉じるため）。 */
    protected colorPanelSelectionKey(): string | undefined {
        const snapshot = this.model.snapshot;
        if (!snapshot) return undefined;
        if (snapshot.kind === 'multi') {
            return `multi:${snapshot.items.map(item => item.kind === 'cut' ? `cut:${item.itemId ?? item.index}` : `${item.kind}:${item.id}`).join(',')}`;
        }
        if (snapshot.kind === 'cut') return `cut:${snapshot.itemId ?? snapshot.index}`;
        return 'id' in snapshot ? `${snapshot.kind}:${String((snapshot as { id?: unknown }).id)}` : snapshot.kind;
    }

    /**
     * `akari.inspector.openColorPanel` の実体。
     * 引数 `{ target, allowGradient?, allowTransparent?, title?, toggle? }`（inspector/color-model.ts の ColorPanelOpenRequest）。
     */
    openColorPanel(raw: unknown): boolean {
        const request = parseColorPanelOpenRequest(raw);
        const key = this.colorPanelSelectionKey();
        if (!request || !key) {
            if (!key) this.showFieldNotice('色を変えるものをタイムラインで選んでください。');
            return false;
        }
        const opened = this.colorPanelHost.open(request, key);
        this.render();
        return opened;
    }

    closeColorPanel(): void {
        if (!this.colorPanelHostInstance?.isOpen) return;
        this.colorPanelHostInstance.close();
        this.render();
    }

    protected renderColorPanelMode(sections: InspectorSection[], rowSnapshot: InspectorSnapshot): boolean {
        const host = this.colorPanelHost;
        if (!host.keepFor(this.colorPanelSelectionKey())) return false;
        const request = host.request!;
        let resolved: ColorPanelResolved | undefined;
        if (request.target.kind === 'field') {
            const name = request.target.field;
            for (const section of sections) {
                for (const field of section.fields) {
                    const fieldName = field.name ?? field.label.toLowerCase().replace(/[^a-z0-9_-]+/giu, '-');
                    if (fieldName !== name || field.inputKind !== 'color' || !field.write || field.disabled) continue;
                    const write = field.write;
                    const value = (field.getEditValue ?? field.getValue)(rowSnapshot);
                    const liveColor = field.liveColor;
                    resolved = {
                        title: field.label === '色' ? `${section.label}の色` : field.label,
                        current: parsePaint(value),
                        write: async (paint: Paint) => typeof paint === 'string' && paint !== TRANSPARENT_PAINT
                            ? write(rowSnapshot, paint)
                            : { ok: false, message: 'この欄は単色だけです。' },
                        ...(liveColor ? { preview: (paint: Paint) => {
                            if (typeof paint === 'string' && paint !== TRANSPARENT_PAINT) liveColor(paint);
                        } } : {})
                    };
                }
            }
        } else {
            const { itemId, path } = request.target;
            resolved = {
                title: '色',
                current: host.itemValue(itemId, path),
                write: paint => this.writeItemColor(itemId, path, paint)
            };
        }
        if (!resolved) {
            host.close();
            return false;
        }
        this.syncAdjustCompare(undefined, '');
        host.mount(this.body, resolved, () => this.closeColorPanel());
        return true;
    }

    /** item の中の色（例 `source.params.fill`）を edit-store 経由で書く（図形の塗り・枠・線の接続口）。 */
    protected async writeItemColor(itemId: string, path: string, paint: Paint): Promise<InspectorWriteResult> {
        try {
            await this.workspaceService.ready;
            const root = this.workspaceService.tryGetRoots()[0]?.resource;
            if (!root) return { ok: false, message: 'プロジェクトが開かれていません。' };
            const uri = currentTimelineEditUri(root);
            const store = await import('@akari-video/edit-store');
            const doc = JSON.parse((await this.fileService.readFile(uri)).value.toString()) as import('@akari-video/edit-store').EditableEditV2;
            store.readEditV2(doc);
            store.attachEditHelpers(doc);
            const item = doc.find(itemId);
            if (!item) return { ok: false, message: '色を変えるものが見つかりません。' };
            store.updateItem(doc, itemId, itemPathPatch(item, path, paint));
            const editSource = store.serializeEdit(doc);
            // 書く前に読み直して検査する（その項目の契約が受け付けない値で edit.json を壊さない）。
            try {
                store.readEditV2(JSON.parse(editSource));
            } catch {
                return { ok: false, message: typeof paint === 'string'
                    ? 'この色はこの項目に保存できません。' : 'この項目には、まだグラデーションを保存できません。' };
            }
            // タイムラインが開いていれば、ほかの欄と同じ書き込み口へ（取り消しの 1 手になり、選択とインスペクターの値も保つ）
            if (this.model.requestWrite && path.startsWith('source.params.')) {
                return await this.model.requestWrite({ kind: 'item-field', id: itemId, path: path as `source.params.${string}`,
                    value: paint as string | Record<string, unknown> });
            }
            // 書き込みは成功すれば戻る（lint は後から届く。committed は常に false なので見ない）。
            await this.layerAudioService.writeEditSnapshot({
                editUri: uri.toString(), projectRootUri: root.toString(), editSource
            });
            return { ok: true };
        } catch (error) {
            return { ok: false, message: String(error) };
        }
    }

    protected showFieldNotice(message: string): void {
        this.fieldNotice.textContent = message;
        this.fieldNotice.style.display = 'block';
        window.clearTimeout(this.fieldNoticeTimer);
        this.fieldNoticeTimer = window.setTimeout(() => this.hideFieldNotice(), 4000);
    }

    protected hideFieldNotice(): void {
        window.clearTimeout(this.fieldNoticeTimer);
        this.fieldNotice.textContent = '';
        this.fieldNotice.style.display = 'none';
    }

}

// The inspector command normally attaches a timeline first. A material can exist in a
// project without edit.json, so the event also opens the same widget directly if attach fails.
let latestMaterialEvent = 0;
if (typeof window !== 'undefined') window.addEventListener(AKARI_MATERIAL_SELECTED_EVENT, event => {
    if (typeof document !== 'undefined' && document.body?.classList.contains('akari-onboarding-active')) return;
    const selection = materialSelectionFromDetail((event as CustomEvent).detail);
    if (!selection) return;
    const sequence = ++latestMaterialEvent;
    void (async () => {
        const container = (window as Window & { theia?: { container?: Container } }).theia?.container;
        if (!container) return;
        let widget: AkariInspectorWidget | undefined;
        try {
            widget = await container.get(CommandRegistry).executeCommand<AkariInspectorWidget | undefined>(
                'akari.inspector.open', { tabId: 'generation' }
            );
        } catch { /* A project without a timeline uses the material-only path below. */ }
        if (sequence !== latestMaterialEvent) return;
        if (!widget) {
            widget = await container.get(WidgetManager).getOrCreateWidget<AkariInspectorWidget>(AkariInspectorWidget.FACTORY_ID);
            const shell = container.get(ApplicationShell);
            if (!widget.isAttached) shell.addWidget(widget, { area: 'right' });
            await shell.revealWidget(widget.id);
        }
        if (sequence === latestMaterialEvent) widget.selectMaterial(selection);
    })().catch(error => console.error('素材の編集パネルを開けませんでした。', error));
});
