import URI from '@theia/core/lib/common/uri';
import { CommandRegistry } from '@theia/core/lib/common';
import { GENERATION_PICK_INTO_COMMAND_ID, GENERATION_CANCEL_PICK_COMMAND_ID, type GenerationPickRequest, type GenerationPickResult } from '../common/generation-pick-mirror';
import { AkariAnnotationsService } from '../common/akari-annotations-protocol';
import type { GenerationValidationResult } from '../common/akari-annotations-protocol';
import { resolveGenerationState, selectGenerationSidecarForSource, TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import { BaseWidget } from '@theia/core/lib/browser';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
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
    TimelineWorldSelection
} from './timeline-selection-model';
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
    normalizeInspectorAnimators, addInspectorAnimator, removeInspectorAnimator, moveInspectorAnimator,
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
    InspectorKnob,
    knobControlKind,
    overlayMetaPath,
    parseInspectorKnobs
} from './inspector/knob-resolver';
import { chromaControlValue, telopParamControlKind } from './inspector/field-mappings';
import type {
    AudioEnvelopeKeyframePayload
} from '../common/akari-annotations-protocol';

type InspectorSnapshot = TimelineItemSelectionSnapshot;
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
    label: string;
    getValue: (snapshot: TSnapshot) => string;
    /** 編集用入力欄の初期値。省略時は getValue の戻り値を使う。 */
    getEditValue?: (snapshot: TSnapshot) => string;
    /** フィールドの値型に対応した入力 UI。 */
    inputKind?: 'boolean-select' | 'select' | 'zone-grid' | 'scrub-number' | 'number' | 'color' | 'text' | 'media';
    options?: readonly string[];
    optionTitles?: Readonly<Record<string, string>>;
    scrubStep?: number;
    min?: number;
    max?: number;
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
    action?: (snapshot: TSnapshot) => Promise<InspectorWriteResult>;
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
    strokeColor: '#000000',
    strokeWidthPx: 1.5,
    backgroundColor: '#000000',
    backgroundOpacity: 0,
    backgroundRadiusPx: 10,
    backgroundMode: 'per-line',
    zone: 'bottom'
} as const;

type CaptionStyleFieldKey =
    | 'color'
    | 'size'
    | 'stroke-color'
    | 'stroke-width'
    | 'background-color'
    | 'background-opacity'
    | 'background-radius'
    | 'background-mode'
    | 'zone';

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
    generation?: InspectorFieldDef<TimelineCutSelection>[]
): InspectorSection[] {
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
                }
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

function MASK_FIELDS<T extends TimelineLayerSelection | TimelineTreeItemSnapshot>(
    snapshot: T,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    if (snapshot.maskSourceOptions === undefined) return [];
    const options = maskOptionLabels(snapshot.maskSourceOptions);
    const selected = maskOptionLabel(snapshot.maskSourceOptions, snapshot.mask);
    if (!options.includes(selected)) options.push(selected);
    const disabled = snapshot.maskSourceOptions.length === 0;
    const title = 'グレースケール動画（白 = 表示・黒 = 透過）';
    return [{
        name: 'mask', label: 'マスク', inputKind: 'select', options,
        getValue: () => selected, getEditValue: () => selected,
        disabled, title: disabled ? `プロジェクトにマスクに使える動画ソースがありません。${title}` : title,
        write: async (current, value) => {
            try {
                if (disabled) return { ok: false, message: 'プロジェクトにマスクに使える動画ソースがありません' };
                return await requestWrite(createMaskWriteRequest(current, value));
            } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        },
        reset: current => requestWrite(createMaskWriteRequest(current, 'なし'))
    }];
}

function MOTION_FIELDS<T extends InspectorMotionSnapshot>(
    snapshot: T,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorFieldDef<T>[] {
    const motion = normalizeInspectorMotion(snapshot.motion);
    return (['in', 'out', 'loop'] as const).flatMap((slot: InspectorMotionSlot) => {
        const label = slot === 'in' ? '入り' : slot === 'out' ? '抜き' : 'ループ';
        const seat = motion[slot];
        const amount = seat ? MOTION_AMOUNT_DEFAULTS[seat.preset] : undefined;
        const missingTitle = 'プリセットを選ぶと変更できます。';
        const write = async (current: T, field: InspectorMotionField, input: string | null): Promise<InspectorWriteResult> => {
            try {
                return await requestWrite(createMotionWriteRequest(current, slot, field, input));
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
                unit: amount?.unit, scrubStep: amount?.unit === '倍' ? 0.01 : 1,
                getValue: () => String(seat?.amount ?? amount?.value ?? 0),
                getEditValue: () => String(seat?.amount ?? amount?.value ?? 0),
                disabled: !seat || !amount, title: !seat ? missingTitle : !amount ? 'このプリセットに量はありません' : undefined,
                write: (current, input) => write(current, 'amount', input), reset: current => write(current, 'amount', null)
            }
        ] satisfies InspectorFieldDef<T>[]).map(field => ({ ...field, keyframeDisabled: true }));
    });
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
    generation?: InspectorFieldDef<TimelineLayerSelection>[]
): InspectorSection[] {
    const chromaSimilarity = chromaControlValue(snapshot.chromaKey, 'similarity', 0.1);
    const chromaBlend = chromaControlValue(snapshot.chromaKey, 'blend', 0);
    const cropFields = CROP_FIELDS(snapshot, 'layer', requestWrite);
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
        ...(snapshot.sourceKind === 'html' ? [] : [{
            id: 'motion', label: '動き', collapsedByDefault: true, fields: MOTION_FIELDS(snapshot, requestWrite)
        }]),
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
                ...MASK_FIELDS(snapshot, requestWrite)
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
    } = {}
): InspectorSection[] {
    const raw = snapshot.textStyle;
    const effective = snapshot.effectiveTextStyle;
    const requestOptions = options.targets ? { targets: options.targets } : {};
    const colorField = (
        label: string,
        fieldKey: CaptionStyleFieldKey,
        rawValue: string | undefined,
        effectiveValue: string | undefined,
        fallback: string,
        kind: 'caption-style-color' | 'caption-style-stroke-color' | 'caption-style-bg-color'
    ): InspectorFieldDef<TimelineCaptionSelection> => ({
        name: `caption-${fieldKey}`, label,
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
            | 'caption-style-bg-opacity' | 'caption-style-bg-radius',
        min: number,
        max: number | undefined,
        step: number,
        invalidMessage: string
    ): InspectorFieldDef<TimelineCaptionSelection> => ({
        name: `caption-${fieldKey}`, label,
        getValue: () => options.mixedFields?.has(fieldKey)
            ? '—' : captionStyleDisplayValue(rawValue, effectiveValue, fallback),
        getEditValue: () => options.mixedFields?.has(fieldKey) ? '—' : String(effectiveValue ?? fallback),
        inputKind: 'scrub-number',
        scrubStep: step,
        unit: label.includes('(px)') ? 'px' : fieldKey === 'background-opacity' ? '%' : undefined,
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
    return composeInspectorSections([
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
                    name: 'caption-text', label: 'テキスト',
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
            id: 'style', label: 'スタイル',
            fields: [
                colorField(
                    '文字色',
                    'color',
                    raw?.color,
                    effective?.color,
                    CAPTION_STYLE_DEFAULTS.color,
                    'caption-style-color'
                ),
                numberField(
                    'サイズ (px)',
                    'size',
                    raw?.sizePx,
                    effective?.sizePx,
                    CAPTION_STYLE_DEFAULTS.sizePx,
                    'caption-style-size',
                    0,
                    undefined,
                    1,
                    'サイズは正の数で入力してください。'
                ),
                colorField(
                    '縁取り色',
                    'stroke-color',
                    raw?.stroke?.color,
                    effective?.stroke?.color,
                    CAPTION_STYLE_DEFAULTS.strokeColor,
                    'caption-style-stroke-color'
                ),
                numberField(
                    '縁取り (px)',
                    'stroke-width',
                    raw?.stroke?.widthPx,
                    effective?.stroke?.widthPx,
                    CAPTION_STYLE_DEFAULTS.strokeWidthPx,
                    'caption-style-stroke-width',
                    0,
                    undefined,
                    0.1,
                    '縁取り太さは 0 以上で入力してください。'
                ),
                colorField(
                    '座布団色',
                    'background-color',
                    raw?.background?.color,
                    effective?.background?.color,
                    CAPTION_STYLE_DEFAULTS.backgroundColor,
                    'caption-style-bg-color'
                ),
                numberField(
                    '座布団不透明度',
                    'background-opacity',
                    raw?.background?.opacity,
                    effectiveCaptionBackgroundOpacity(effective),
                    CAPTION_STYLE_DEFAULTS.backgroundOpacity,
                    'caption-style-bg-opacity',
                    0,
                    1,
                    0.01,
                    '座布団不透明度は 0〜1 の範囲で入力してください。'
                ),
                numberField(
                    '座布団角丸 (px)',
                    'background-radius',
                    raw?.background?.radiusPx,
                    effective?.background?.radiusPx,
                    CAPTION_STYLE_DEFAULTS.backgroundRadiusPx,
                    'caption-style-bg-radius',
                    0,
                    undefined,
                    1,
                    '座布団角丸は 0 以上で入力してください。'
                ),
                {
                    name: 'caption-background-mode', label: '座布団の形',
                    getValue: () => options.mixedFields?.has('background-mode')
                        ? '—'
                        : captionStyleDisplayValue(
                            raw?.background?.mode,
                            effective?.background?.mode,
                            CAPTION_STYLE_DEFAULTS.backgroundMode
                        ),
                    getEditValue: () => options.mixedFields?.has('background-mode')
                        ? '—'
                        : effective?.background?.mode ?? CAPTION_STYLE_DEFAULTS.backgroundMode,
                    inputKind: 'select',
                    options: ['per-line', 'block'],
                    write: async (_snapshot, nextValue) => {
                        if (nextValue !== 'per-line' && nextValue !== 'block') {
                            return { ok: false, message: '座布団の形を2つの候補から選んでください。' };
                        }
                        return requestWrite({
                            kind: 'caption-style-bg-mode',
                            id: snapshot.id,
                            value: nextValue as CaptionBackgroundMode,
                            ...requestOptions
                        });
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
            mode: common('background-mode', snapshot =>
                snapshot.effectiveTextStyle?.background?.mode ?? CAPTION_STYLE_DEFAULTS.backgroundMode)
        },
        zone: common('zone', snapshot =>
            snapshot.effectiveTextStyle?.zone ?? CAPTION_STYLE_DEFAULTS.zone)
    };
    const aggregate: TimelineCaptionSelection = {
        ...snapshots[0],
        textStyle: effectiveStyle,
        effectiveTextStyle: effectiveStyle
    };
    const targets: TimelineSelectionTarget[] = snapshots.map(snapshot => ({
        kind: 'caption',
        id: snapshot.id
    }));
    const styleTab = CAPTION_SECTIONS(aggregate, requestWrite, { mixedFields, targets, ...zoneActions })
        .find(tab => tab.label === 'スタイル')!;
    return [
        {
            id: 'content', label: '内容（複数）',
            fields: [
                {
                    name: 'caption-multi-count', label: '選択', getValue: () => `${snapshots.length} 件`
                }
            ]
        },
        styleTab
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
        }, {
            name: 'audio-voice-isolation', label: 'ボイス分離',
            getValue: () => '近日', disabled: true
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
    knobs: readonly InspectorKnob[] = []
): InspectorSection[] {
    const transform = snapshot.payload.transform && typeof snapshot.payload.transform === 'object'
        && !Array.isArray(snapshot.payload.transform)
        ? snapshot.payload.transform as Record<string, unknown> : {};
    const number = (key: string, fallback: number): number =>
        typeof transform[key] === 'number' ? transform[key] as number : fallback;
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
            name: 'transform-scale', label: '拡縮', unit: '%', removable: true,
            getValue: () => String(number('scale', 1) * 100), getEditValue: () => String(number('scale', 1) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1,
            write: async (_snapshot, value) => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: Number(value) / 100 }),
            reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: null })
        },
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
        const fallback = knob.type === 'slider' ? knob.min ?? 0
            : knob.type === 'checkbox' ? false : knob.type === 'color' ? '#000000'
                : knob.type === 'dropdown' ? knob.options?.[0] ?? '' : '';
        variableEntries.push([knob.name, fallback]);
    }
    for (const [name, value] of variableEntries) {
            const isPrimitive = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
            const knob = findKnobForVar(knobs, name);
            const group = knob?.group ?? 'ツマミ';
            const fields = groups.get(group) ?? [];
            const kind = knob ? knobControlKind(knob.type) : 'text';
            fields.push({
                name: `var-${name.replace(/[^a-z0-9_-]+/giu, '-')}`,
                label: knob?.label ?? `vars.${name}`,
                getValue: () => formatPayloadValue(value),
                getEditValue: () => String(value ?? ''),
                inputKind: kind === 'readonly' ? 'media'
                    : kind === 'slider' ? 'scrub-number' : kind as InspectorFieldDef['inputKind'],
                ...(knob?.options ? { options: knob.options } : {}),
                ...(knob?.min !== undefined ? { min: knob.min } : {}),
                ...(knob?.max !== undefined ? { max: knob.max } : {}),
                ...(knob?.unit ? { unit: knob.unit } : {}),
                ...(knob?.type === 'slider' ? { scrubStep: Math.max(0.001, ((knob.max ?? 1) - (knob.min ?? 0)) / 100) } : {}),
                ...(isPrimitive && knob?.type !== 'media' ? {
                    write: async (_snapshot: TimelineOverlaySelection, nextValue: string) => {
                        if (!knob) return requestWrite({ kind: 'overlay-var', id: snapshot.id, name, value: nextValue });
                        const typedValue: number | string | boolean = knob.type === 'slider'
                            ? Number(nextValue) : knob.type === 'checkbox' ? String(nextValue === 'true') : nextValue;
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
    const writeAnimator = async (update: () => InspectorAnimator[]): Promise<InspectorWriteResult> => {
        try {
            const value = normalizeInspectorAnimators(update());
            return await requestWrite({ kind: 'item-field', id, path: 'animator', value: value.length ? value : null });
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : 'アニメーターを変更できませんでした。' };
        }
    };
    const animatorFields: InspectorFieldDef[] = [{
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
                name: `${name}-${key.replace('.', '-')}`, label: field.label,
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
    return { id: 'animator', label: headingLabel, collapsedByDefault: true, fields: animatorFields };
}

function TREE_ITEM_SECTIONS(
    snapshot: TimelineTreeItemSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorSection[] {
    const number = (key: 'x' | 'y' | 'scale' | 'rotate', fallback: number): number =>
        typeof snapshot.transform?.[key] === 'number' ? snapshot.transform[key]! : fallback;
    const cropFields = CROP_FIELDS(snapshot, 'item', requestWrite);
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
            getValue: () => String(number('scale', 1) * 100), getEditValue: () => String(number('scale', 1) * 100),
            inputKind: 'scrub-number', scrubStep: 1, min: 1, liveField: 'scale',
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: Number(value) / 100
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'transform.scale', value: null })
        },
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
    return composeInspectorSections([
        { id: 'time', label: '時間', fields: [
            { name: 'item-start', label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
            { name: 'item-duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.duration) }
        ] },
        { id: 'transform', label: '変形', fields: transformFields },
        { id: 'crop', label: 'クロップ', fields: cropFields },
        perspectiveSection,
        ...(snapshot.sourceKind === 'html' ? [] : [{
            id: 'motion', label: '動き', collapsedByDefault: true, fields: MOTION_FIELDS(snapshot, requestWrite)
        }]),
        ...(snapshot.itemKind === 'captions' || snapshot.itemKind === 'caption' ? [
            ANIMATOR_SECTION(snapshot.id, 'アニメーター', snapshot.animator, requestWrite)
        ] : []),
        { id: 'appearance', label: '外観', fields: [{
            name: 'opacity', label: '不透明度', unit: '%', displayScale: 100,
            getValue: () => String(opacity), getEditValue: () => String(opacity),
            inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1, liveField: 'opacity',
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'opacity', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'opacity', value: null })
        }, ...MASK_FIELDS(snapshot, requestWrite)] },
        { id: 'info', label: '情報', collapsedByDefault: true, fields: [
            { name: 'item-kind', label: 'kind', getValue: () => snapshot.sourceKind },
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
    @inject(AkariAnnotationsService)
    protected readonly layerAudioService!: AkariAnnotationsService;

    static readonly FACTORY_ID = 'akari-inspector-widget';

    @inject(TimelineSelectionModel)
    protected readonly model!: TimelineSelectionModel;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(FileDialogService)
    protected readonly fileDialogService!: FileDialogService;

    @inject(CommandRegistry)
    protected readonly commandRegistry!: CommandRegistry;

    protected generationFramePick?: { key: string; slot: string };
    protected generationFramePickMessage?: { key: string; text: string };

    protected projectLutRefs: readonly string[] = [];
    protected lutGeneration = 0;
    protected lutRequestedGeneration = -1;
    protected adjustCompare?: AdjustCompareState;
    protected solo?: InspectorSoloState;
    protected soloSelectionKey?: string;

    protected readonly body = document.createElement('div');
    protected readonly fieldNotice = document.createElement('div');
    protected fieldNoticeTimer: number | undefined;
    protected readonly sectionState = new InspectorSectionState(window.localStorage);
    protected readonly tabState = new InspectorTabState(window.localStorage);
    protected tabSelectionKey?: string;
    protected currentTab?: string;
    protected explicitTabId?: string;
    protected readonly generationTabMeta = new Map<string, { next?: { status?: unknown } }>();
    protected readonly generationTabLoads = new Set<string>();
    protected readonly generationTabDrafts = new Map<string, GenerationDraft>();
    protected readonly knobCache = new Map<string, readonly InspectorKnob[] | null>();
    protected lastEasingPreviewAt = -Infinity;
    protected generationCatalog: GenerationCatalogRow[] = [];
    protected generationDefaultModel = 'fal:h3-i2v';
    protected readonly generationDrafts = new Map<string, GenerationDraft>();
    protected readonly generationValidations = new Map<string, GenerationValidation>();
    protected readonly generationStates = new Map<string, string>();
    protected readonly generationLoads = new Set<string>();
    protected readonly generationThumbnails = new Map<string, Promise<string | undefined>>();
    protected readonly generationNeighbors = new Map<string, { previousImage?: string; nextImage?: string; previousId?: string; previousPath?: string }>();
    protected readonly generationWrites = new Map<string, Promise<void>>();
    protected generationDetailsOpen = false;
    protected readonly generationDraftTimers = new Map<string, number>();

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
        this.title.label = 'インスペクター';
        this.title.caption = 'タイムラインで選択した項目の詳細（安全なフィールドは編集可能）';
        this.title.iconClass = 'codicon codicon-inspect';
        this.title.closable = true;
        this.node.classList.add('akari-inspector-widget');
        // docs/contract-2026-08-11-review-session-ui-events.md #2: panel:<id> opt-in target.
        this.node.setAttribute('data-akari-ui', 'panel:inspector');
        this.node.setAttribute('data-akari-ui-label', 'インスペクター');
        Object.assign(this.node.style, {
            height: '100%',
            overflow: 'auto',
            background: 'var(--theia-editor-background)'
        });
        Object.assign(this.body.style, {
            padding: '10px',
            display: 'grid',
            gap: '6px',
            alignContent: 'start'
        });
        this.node.appendChild(this.body);
        Object.assign(this.fieldNotice.style, {
            display: 'none',
            padding: '6px 10px',
            fontSize: '11px',
            color: 'var(--theia-errorForeground, #f14c4c)',
            borderBottom: '1px solid var(--theia-panel-border)'
        });
        this.node.insertBefore(this.fieldNotice, this.body);

        const style = document.createElement('style');
        style.textContent = `
    .akari-generation-batch { padding: 12px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .akari-generation-batch h3, .akari-generation-batch p { margin: 0; }
    .akari-generation-batch-list { display: flex; flex-direction: column; gap: 8px; }
    .akari-generation-batch-row { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 6px 10px;
        padding: 8px; border: 1px solid var(--theia-panel-border, #555); border-radius: 4px; }
    .akari-generation-batch-thumbnail { width: 48px; height: 32px; object-fit: cover;
        background: var(--theia-editor-inactiveSelectionBackground, #333); grid-row: 1 / 3; }
    .akari-generation-batch-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .akari-generation-batch-duration { font-size: 11px; opacity: .8; }
    .akari-generation-batch-badge { grid-column: 1 / -1; min-width: 0; overflow: hidden;
        white-space: nowrap; text-overflow: ellipsis; border-radius: 3px; padding: 4px 6px;
        background: var(--theia-editor-inactiveSelectionBackground, #333); }
    .akari-generation-batch-note { font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
    .akari-generation-batch button.akari-generation-batch-submit,
    .akari-generation-batch button.akari-generation-batch-stop {
        border: 1px solid var(--theia-button-background, #777); padding: 8px 10px;
        background: var(--theia-button-background, #365e92); color: var(--theia-button-foreground, #fff); }
    .akari-generation-batch button.akari-generation-batch-stop { background: var(--theia-editor-background, #222);
        color: var(--theia-foreground, #eee); }
    .akari-generation-batch button:disabled { opacity: .5; cursor: default; }

    .akari-inspector-widget .akari-inspector-adjust-compare { padding: 6px; border: 1px solid var(--theia-panel-border); }
    .akari-inspector-widget .akari-inspector-adjust-compare[aria-pressed="true"] {
        background: var(--theia-button-background); color: var(--theia-button-foreground);
    }
    .akari-inspector-widget button,
    .akari-inspector-popover-menu button,
    .akari-inspector-row-menu button {
        appearance: none;
        border: none;
        border-radius: 3px;
        background: transparent;
        color: var(--theia-foreground);
        font: inherit;
        cursor: pointer;
    }
    .akari-inspector-widget button:hover,
    .akari-inspector-popover-menu button:hover,
    .akari-inspector-row-menu button:hover {
        background: var(--theia-toolbar-hoverBackground);
    }
    .akari-inspector-widget button:active,
    .akari-inspector-popover-menu button:active,
    .akari-inspector-row-menu button:active {
        background: var(--theia-button-background);
        color: var(--theia-button-foreground);
    }
    .akari-inspector-widget button:focus-visible,
    .akari-inspector-popover-menu button:focus-visible,
    .akari-inspector-row-menu button:focus-visible {
        outline: 1px solid var(--theia-focusBorder);
        outline-offset: -1px;
    }
    .akari-inspector-widget button:disabled {
        color: var(--theia-disabledForeground);
        cursor: default;
    }
    .akari-inspector-widget button:disabled:hover {
        background: transparent;
    }
    .akari-inspector-widget .akari-inspector-tab-strip {
        /* The grid body spans all sections; its parent is the overflow:auto scrollport. */
        position: sticky;
        top: 0;
        z-index: 10;
        align-self: start;
        background: var(--theia-editor-background);
        display: flex;
        min-width: 0;
        border-bottom: 1px solid var(--theia-panel-border);
    }
    .akari-inspector-widget .akari-inspector-tab {
        flex: 1 1 0;
        min-width: 0;
        padding: 6px 4px 5px;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        color: var(--theia-descriptionForeground);
        text-align: center;
    }
    .akari-inspector-widget .akari-inspector-tab.is-active {
        border-bottom-color: var(--theia-focusBorder);
        color: var(--theia-foreground);
    }
    .akari-inspector-widget .akari-inspector-tab [data-akari-generation-todo] {
        display: inline-block;
        width: 5px;
        height: 5px;
        margin-left: 3px;
        border-radius: 50%;
        vertical-align: super;
        background: var(--theia-focusBorder);
    }
    .akari-inspector-widget .akari-inspector-tab:disabled {
        color: var(--theia-disabledForeground);
    }
    .akari-inspector-widget .akari-inspector-solo-banner {
        display: flex;
        align-items: center;
        min-width: 0;
        padding: 5px 6px;
        border: 1px solid var(--akari-focus-pulse, var(--akari-accent));
        border-radius: 3px;
        color: var(--akari-focus-pulse, var(--akari-accent));
        font-size: 12px;
        white-space: nowrap;
    }
    .akari-inspector-widget .akari-inspector-solo-reset {
        padding: 0 2px;
        color: inherit;
        text-decoration: underline;
    }
    .akari-inspector-widget .akari-inspector-row {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 8px;
        font-size: 12px;
        line-height: 1.5;
    }
    .akari-inspector-widget .akari-inspector-row-label {
        color: var(--theia-descriptionForeground);
    }
    .akari-inspector-widget .akari-inspector-row-value {
        font-variant-numeric: tabular-nums;
        word-break: break-all;
    }
    .akari-inspector-widget .akari-inspector-row-input {
        font: inherit;
        font-variant-numeric: tabular-nums;
        padding: 2px 4px;
        border: 1px solid var(--theia-input-border, #454545);
        background: var(--theia-input-background);
        color: var(--theia-input-foreground);
        border-radius: 2px;
        width: 100%;
        box-sizing: border-box;
    }
    .akari-inspector-widget .akari-caption-zone-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(30px, 1fr));
        gap: 4px;
        min-width: 0;
    }
    .akari-inspector-widget .akari-caption-zone-cell {
        position: relative;
        min-width: 0;
        height: 34px;
        padding: 0;
        border: 1px solid var(--theia-input-border, #454545);
        border-radius: 4px;
        background: var(--theia-input-background);
        color: var(--theia-descriptionForeground);
        font-size: 15px;
        text-align: center;
    }
    .akari-inspector-widget .akari-caption-zone-cell:hover,
    .akari-inspector-widget .akari-caption-zone-cell:focus-visible {
        border-color: var(--theia-focusBorder);
        background: var(--theia-list-hoverBackground, var(--theia-toolbar-hoverBackground));
        color: var(--theia-foreground);
    }
    .akari-inspector-widget .akari-caption-zone-cell.is-saved {
        border-color: var(--theia-focusBorder);
        color: var(--theia-textLink-foreground);
        box-shadow: inset 0 0 0 1px var(--theia-focusBorder);
    }
    .akari-inspector-widget .akari-caption-zone-saved {
        position: absolute;
        right: 2px;
        bottom: 1px;
        padding: 0 3px;
        border-radius: 999px;
        background: var(--theia-button-background);
        color: var(--theia-button-foreground);
        font-size: 8px;
        line-height: 1.35;
        pointer-events: none;
    }
    .akari-inspector-widget .akari-inspector-color-field {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        gap: 6px;
        align-items: center;
    }
    .akari-inspector-widget .akari-inspector-color-picker {
        width: 30px;
        height: 24px;
        padding: 1px;
        border: 1px solid var(--theia-input-border, #454545);
        border-radius: 2px;
        background: var(--theia-input-background);
        cursor: pointer;
    }
    .akari-inspector-widget .akari-inspector-section {
        border-bottom: 1px solid var(--theia-panel-border);
        padding-bottom: 6px;
    }
    .akari-inspector-widget .akari-inspector-section-header {
        display: flex;
        align-items: center;
        min-height: 28px;
        gap: 4px;
    }
    .akari-inspector-widget .akari-inspector-section-toggle {
        flex: 1;
        border: 0;
        padding: 4px 0;
        color: var(--theia-foreground);
        background: transparent;
        text-align: left;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
    }
    .akari-inspector-widget .akari-inspector-section-enable {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        color: var(--theia-descriptionForeground);
        font-size: 10px;
        white-space: nowrap;
    }
    .akari-inspector-widget .akari-inspector-section-body {
        display: grid;
        gap: 5px;
    }
    .akari-inspector-widget .akari-inspector-section-body[hidden] {
        display: none;
    }
    .akari-inspector-widget .akari-inspector-section-caption {
        margin: 0;
        color: var(--theia-descriptionForeground);
        font-size: 11px;
        line-height: 1.4;
    }
    .akari-inspector-widget .akari-inspector-section-soon,
    .akari-inspector-widget .akari-inspector-section-soon .akari-inspector-section-header {
        color: var(--theia-disabledForeground);
    }
    .akari-inspector-widget .akari-inspector-section-soon-title {
        flex: 1;
        padding: 4px 0;
        color: var(--theia-disabledForeground);
        font-weight: 600;
    }
    .akari-inspector-widget .akari-inspector-section-soon-chip {
        padding: 1px 6px;
        border: 1px solid var(--theia-panel-border);
        border-radius: 999px;
        color: var(--theia-disabledForeground);
        font-size: 10px;
        line-height: 1.4;
    }
    .akari-inspector-widget .akari-adjust-preview {
        display: grid;
        gap: 5px;
        padding: 0 0 4px 18px;
        color: var(--theia-disabledForeground);
        pointer-events: none;
        user-select: none;
    }
    .akari-inspector-widget .akari-adjust-preview-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 72px;
        align-items: center;
        gap: 8px;
        min-height: 24px;
        opacity: 0.68;
    }
    .akari-inspector-widget .akari-adjust-preview-value {
        box-sizing: border-box;
        min-width: 0;
        padding: 2px 6px;
        border: 1px solid var(--theia-input-border, #454545);
        border-radius: 2px;
        background: var(--theia-input-background);
        color: var(--theia-disabledForeground);
        text-align: right;
        font-variant-numeric: tabular-nums;
    }
    .akari-inspector-widget .akari-adjust-preview-channels {
        display: flex;
        gap: 5px;
    }
    .akari-inspector-widget .akari-adjust-preview-channel {
        min-width: 24px;
        padding: 1px 5px;
        border: 1px solid var(--theia-panel-border);
        border-radius: 999px;
        text-align: center;
        opacity: 0.65;
    }
    .akari-inspector-widget .akari-adjust-preview-channel.is-active {
        border-color: var(--theia-focusBorder);
        color: var(--theia-foreground);
    }
    .akari-inspector-widget .akari-adjust-preview-channel-r { color: #e78585; }
    .akari-inspector-widget .akari-adjust-preview-channel-g { color: #7fcb8b; }
    .akari-inspector-widget .akari-adjust-preview-channel-b { color: #80a9e8; }
    .akari-inspector-widget .akari-adjust-editor { display: grid; gap: 8px; padding: 8px; }
    .akari-inspector-widget .akari-adjust-editor .akari-adjust-editor-curve { touch-action: none; overflow: visible; opacity: 1; }
    .akari-inspector-widget .akari-adjust-editor-line { fill: none; stroke: var(--theia-foreground); stroke-width: 1.5; }
    .akari-inspector-widget .akari-adjust-editor-point { fill: var(--theia-focusBorder, #68aaff); stroke: #202020; cursor: grab; }
    .akari-inspector-widget .akari-adjust-editor .akari-adjust-preview-channel { cursor: pointer; }
    .akari-inspector-widget .akari-adjust-editor .akari-adjust-preview-wheel {
        touch-action: none; cursor: crosshair; opacity: 1;
        background: conic-gradient(from 90deg, #ef6d6d, #c87bd5, #739be7, #6fd3d5, #72cf81, #e8d86b, #ef6d6d);
    }
    .akari-inspector-widget .akari-adjust-editor .akari-adjust-preview-wheel-center { pointer-events: none; }
    .akari-inspector-widget .akari-adjust-editor-luminance { display: flex; min-width: 0; width: 100%; }
    .akari-inspector-widget .akari-adjust-editor-luminance .akari-inspector-number-field {
        min-width: 0; flex: 1; grid-template-columns: 18px minmax(28px, 1fr) auto 14px;
    }
    .akari-inspector-widget .akari-adjust-editor-notice { color: var(--theia-errorForeground); font-size: 11px; }
    .akari-inspector-widget .akari-adjust-preview-curve.akari-adjust-editor-hue {
        background: linear-gradient(to right, hsl(0,80%,50%), hsl(60,80%,45%), hsl(120,80%,45%), hsl(180,80%,45%), hsl(240,80%,55%), hsl(300,80%,50%), hsl(360,80%,50%)) bottom / 100% 10px no-repeat;
    }
    .akari-inspector-widget .akari-adjust-preview-curve {
        width: min(100%, 180px);
        height: 140px;
        justify-self: center;
        border: 1px solid var(--theia-panel-border);
        border-radius: 3px;
        background: var(--theia-input-background);
        opacity: 0.68;
    }
    .akari-inspector-widget .akari-adjust-preview-curve-grid {
        fill: none;
        stroke: var(--theia-panel-border);
        stroke-width: 1;
    }
    .akari-inspector-widget .akari-adjust-preview-curve-identity {
        fill: none;
        stroke: var(--theia-descriptionForeground);
        stroke-width: 1.5;
        stroke-dasharray: 5 4;
    }
    .akari-inspector-widget .akari-adjust-preview-wheel-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px 10px;
    }
    .akari-inspector-widget .akari-adjust-preview-wheel-item {
        display: grid;
        justify-items: center;
        gap: 4px;
    }
    .akari-inspector-widget .akari-adjust-preview-wheel-label {
        font-size: 10px;
        opacity: 0.7;
    }
    .akari-inspector-widget .akari-adjust-preview-wheel {
        position: relative;
        width: 70px;
        height: 70px;
        border-radius: 50%;
        background: conic-gradient(#ef6d6d, #e8d86b, #72cf81, #6fd3d5, #739be7, #c87bd5, #ef6d6d);
        opacity: 0.65;
    }
    .akari-inspector-widget .akari-adjust-preview-wheel::after {
        position: absolute;
        inset: 8px;
        border: 1px solid color-mix(in srgb, var(--theia-panel-border) 70%, transparent);
        border-radius: 50%;
        background: color-mix(in srgb, var(--theia-input-background) 88%, #808080);
        content: '';
    }
    .akari-inspector-widget .akari-adjust-preview-wheel-center {
        position: absolute;
        z-index: 1;
        left: 50%;
        top: 50%;
        width: 6px;
        height: 6px;
        border: 1px solid var(--theia-foreground);
        border-radius: 50%;
        background: var(--theia-input-background);
        transform: translate(-50%, -50%);
    }
    .akari-inspector-widget .akari-adjust-preview-luminance {
        width: 70px;
        height: 5px;
        border: 1px solid var(--theia-panel-border);
        border-radius: 999px;
        background: linear-gradient(90deg, #181818, #d0d0d0);
        opacity: 0.65;
    }
    .akari-inspector-widget .akari-adjust-preview-hue-curve {
        position: relative;
        height: 74px;
        overflow: hidden;
        border: 1px solid var(--theia-panel-border);
        border-radius: 3px;
        background: var(--theia-input-background);
        opacity: 0.65;
    }
    .akari-inspector-widget .akari-adjust-preview-hue-band {
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, #ed6666, #e8dc67, #6dcc7a, #68ccd2, #718fdd, #c475d3, #ed6666);
        opacity: 0.68;
    }
    .akari-inspector-widget .akari-adjust-preview-hue-line {
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        border-top: 1px solid var(--theia-foreground);
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--theia-input-background) 65%, transparent);
    }
    .akari-inspector-widget .akari-adjust-preview-lut-row {
        display: grid;
        grid-template-columns: 1fr;
    }
    .akari-inspector-widget .akari-adjust-preview-ghost-button {
        padding: 4px 7px;
        border: 1px dashed var(--theia-input-border, #454545);
        border-radius: 3px;
        color: var(--theia-disabledForeground);
        text-align: center;
        opacity: 0.68;
    }
    .akari-inspector-widget .akari-inspector-section-add {
        border: 0;
        border-radius: 3px;
        background: transparent;
        color: var(--theia-foreground);
        cursor: pointer;
    }
    .akari-inspector-widget .akari-inspector-number-field {
        display: grid;
        grid-template-columns: 24px minmax(42px, 1fr) auto 18px 54px;
        align-items: center;
        gap: 3px;
    }
    .akari-inspector-widget .akari-inspector-number-field-seatless {
        grid-template-columns: 24px minmax(42px, 1fr) auto 18px;
    }
    .akari-inspector-widget .akari-inspector-number-handle {
        cursor: ew-resize;
        border: 0;
        color: var(--theia-textLink-foreground);
        background: transparent;
    }
    .akari-inspector-widget .akari-inspector-number-input {
        min-width: 0;
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--theia-input-border, #454545);
        border-radius: 2px;
        background: var(--theia-input-background);
        color: var(--theia-input-foreground);
        text-align: right;
        font: inherit;
        font-variant-numeric: tabular-nums;
    }
    .akari-inspector-widget .akari-inspector-number-steps {
        display: grid;
    }
    .akari-inspector-widget .akari-inspector-number-steps button {
        border: 0;
        padding: 0;
        font-size: 7px;
        color: var(--theia-descriptionForeground);
        background: transparent;
    }
    .akari-inspector-widget .akari-inspector-kf-controls {
        display: grid;
        grid-template-columns: repeat(4, 18px);
        align-items: center;
    }
    .akari-inspector-widget .akari-inspector-kf-controls button {
        appearance: none;
        min-width: 0;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--theia-descriptionForeground);
    }
    .akari-inspector-widget .akari-inspector-kf-controls button:hover {
        background: var(--theia-toolbar-hoverBackground);
        color: var(--theia-foreground);
    }
    .akari-inspector-widget .akari-inspector-kf-controls button:active {
        background: var(--theia-button-background);
        color: var(--theia-button-foreground);
    }
    .akari-inspector-widget .akari-inspector-kf-controls button:disabled {
        opacity: .35;
        background: transparent;
        color: var(--theia-disabledForeground);
    }
    .akari-inspector-widget .akari-inspector-kf-seat {
        color: var(--theia-textLink-foreground);
    }
    .akari-inspector-widget [data-akari-easing-preview] button,
    .akari-inspector-popover-menu button,
    .akari-inspector-row-menu button {
        padding: 2px 4px;
        text-align: left;
    }
    .akari-inspector-widget .akari-inspector-row-input:focus-visible,
    .akari-inspector-widget .akari-inspector-number-input:focus-visible,
    .akari-inspector-widget .akari-inspector-color-picker:focus-visible {
        outline: 1px solid var(--theia-focusBorder);
        outline-offset: -1px;
    }
    .akari-inspector-widget .akari-inspector-empty {
        color: var(--theia-descriptionForeground);
        padding: 4px 0;
    }
    .akari-inspector-widget .akari-inspector-generation-references { margin: 10px 0; }
    .akari-inspector-widget .akari-inspector-generation-reference-heading { display: flex; gap: 8px; justify-content: space-between; flex-wrap: wrap; margin-bottom: 6px; }
    .akari-inspector-widget .akari-inspector-generation-reference-counter { font-size: 11px; }
    .akari-inspector-widget .akari-inspector-generation-reference-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; }
    .akari-inspector-widget .akari-inspector-generation-reference-card { min-width: 0; border: 1px solid var(--theia-panel-border); border-radius: 4px; padding: 5px; }
    .akari-inspector-widget .akari-inspector-generation-reference-top { display: flex; align-items: center; justify-content: space-between; gap: 5px; margin-bottom: 5px; }
    .akari-inspector-widget .akari-inspector-generation-reference-badge { font-size: 11px; white-space: nowrap; }
    .akari-inspector-widget .akari-inspector-generation-reference-unsupported .akari-inspector-generation-reference-badge { opacity: 0.45; }
    .akari-inspector-widget .akari-inspector-generation-reference-thumbnail { height: 58px; display: flex; align-items: center; justify-content: center; background: var(--theia-editor-background); overflow: hidden; font-size: 11px; }
    .akari-inspector-widget .akari-inspector-generation-reference-thumbnail img { width: 100%; height: 100%; object-fit: cover; }
    .akari-inspector-widget .akari-inspector-generation-reference-filename { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; margin-top: 4px; }
    .akari-inspector-widget .akari-inspector-generation-reference-add { display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 5px; min-height: 94px; }
    .akari-inspector-widget .akari-inspector-generation-reference-add select { min-width: 0; color: var(--theia-foreground); background: var(--theia-dropdown-background); border: 1px solid var(--theia-panel-border); }
    .akari-inspector-widget .akari-inspector-generation-references button:disabled { opacity: 0.5; cursor: default; }
    .akari-inspector-widget .akari-inspector-generation-frames { display: flex; gap: 10px; margin: 10px 0; }
    .akari-inspector-widget .akari-inspector-generation-cell { flex: 1; min-width: 0; }
    .akari-inspector-widget .akari-inspector-generation-frame { position: relative; box-sizing: border-box; width: 100%; aspect-ratio: 16 / 9; max-height: 96px; border: 1px solid #a78bfa; background: rgba(167, 139, 250, 0.08); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; margin: 4px 0 8px; overflow: hidden; font-size: 11px; color: var(--theia-foreground); cursor: pointer; }
    .akari-inspector-widget .akari-inspector-generation-frame:hover,
    .akari-inspector-widget .akari-inspector-generation-frame:focus-visible { background: rgba(167, 139, 250, 0.18); outline: 1px solid #a78bfa; outline-offset: 2px; }
    .akari-inspector-widget .akari-inspector-generation-frame[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--theia-editor-background), 0 0 0 4px #a78bfa; }
    .akari-inspector-widget .akari-inspector-generation-frame[aria-disabled="true"] { cursor: default; opacity: 0.6; }
    .akari-inspector-widget .akari-inspector-generation-frame-hint { font-size: 10px; color: var(--theia-descriptionForeground); }
    .akari-inspector-widget .akari-inspector-generation-frame-replace { position: absolute; bottom: 4px; right: 4px; padding: 2px 5px; background: #312547; color: #fff; border-radius: 3px; opacity: 0; pointer-events: none; }
    .akari-inspector-widget .akari-inspector-generation-frame:hover .akari-inspector-generation-frame-replace,
    .akari-inspector-widget .akari-inspector-generation-frame:focus-visible .akari-inspector-generation-frame-replace { opacity: 1; }
    .akari-inspector-widget .akari-inspector-generation-frame img { width: 100%; height: 100%; object-fit: cover; }
    .akari-inspector-widget .akari-inspector-generation-cell button { margin: 3px 3px 0 0; white-space: normal; }
    .akari-inspector-widget button.akari-inspector-generation-primary,
    .akari-inspector-widget button.akari-inspector-generation-secondary,
    .akari-inspector-widget button.akari-inspector-generation-small,
    .akari-inspector-widget button.akari-inspector-generation-camera-button {
        border: 1px solid var(--theia-input-border, var(--theia-panel-border));
        border-radius: 4px;
        padding: 5px 10px;
        background: var(--theia-button-secondaryBackground, var(--theia-editor-background));
        color: var(--theia-button-secondaryForeground, var(--theia-foreground));
    }
    .akari-inspector-widget button.akari-inspector-generation-secondary:hover,
    .akari-inspector-widget button.akari-inspector-generation-small:hover,
    .akari-inspector-widget button.akari-inspector-generation-camera-button:hover {
        background: var(--theia-button-secondaryHoverBackground, var(--theia-toolbar-hoverBackground));
    }
    .akari-inspector-widget button.akari-inspector-generation-primary {
        border-color: var(--theia-button-background);
        background: var(--theia-button-background);
        color: var(--theia-button-foreground);
    }
    .akari-inspector-widget button.akari-inspector-generation-primary:hover {
        background: var(--theia-button-hoverBackground);
    }
    .akari-inspector-widget button.akari-inspector-generation-primary:disabled,
    .akari-inspector-widget button.akari-inspector-generation-primary:disabled:hover {
        background: var(--theia-button-secondaryBackground, var(--theia-editor-background));
        border-color: var(--theia-panel-border);
        color: var(--theia-disabledForeground);
        opacity: 0.65;
        cursor: default;
    }
    .akari-inspector-widget button.akari-inspector-generation-small {
        padding: 2px 6px;
        font-size: 11px;
        background: var(--theia-editor-background);
        color: var(--theia-descriptionForeground);
    }
    .akari-inspector-widget button.akari-inspector-generation-camera-button { padding: 3px 8px; }
    .akari-inspector-widget button.akari-inspector-generation-camera-button[aria-pressed="true"] {
        border-color: var(--theia-focusBorder);
        background: var(--theia-button-background);
        color: var(--theia-button-foreground);
    }
    .akari-inspector-widget button.akari-inspector-generation-primary:focus-visible,
    .akari-inspector-widget button.akari-inspector-generation-secondary:focus-visible,
    .akari-inspector-widget button.akari-inspector-generation-small:focus-visible,
    .akari-inspector-widget button.akari-inspector-generation-camera-button:focus-visible {
        outline: 2px solid var(--theia-focusBorder);
        outline-offset: 2px;
    }
    .akari-inspector-widget .akari-inspector-generation-camera { margin: 10px 0; }
    .akari-inspector-widget .akari-inspector-generation-details { margin: 10px 0; padding: 6px; border: 1px solid var(--theia-panel-border); }
    .akari-inspector-widget .akari-inspector-generation-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .akari-inspector-widget .akari-inspector-generation-submit-group { display: flex; flex: 1 1 auto; align-items: center; justify-content: flex-end; flex-wrap: nowrap; gap: 6px; margin-left: auto; min-width: 0; }
    .akari-inspector-widget .akari-inspector-generation-submit-group > button { flex-shrink: 0; white-space: nowrap; }
    .akari-inspector-widget .akari-inspector-generation-submit-group > .akari-inspector-generation-estimate { flex: 0 1 auto; min-width: calc(2em + 6px + 6ch); white-space: normal; text-align: right; justify-content: flex-end; }
    .akari-inspector-widget .akari-inspector-generation-submit-group > .akari-inspector-generation-estimate > .akari-inspector-row-label { white-space: nowrap; flex-shrink: 0; }
    .akari-inspector-widget .akari-inspector-generation-submit-group > .akari-inspector-generation-estimate > .akari-inspector-row-value { min-width: 0; white-space: normal; word-break: normal; overflow-wrap: normal; }
    .akari-inspector-widget .akari-inspector-generation-facts {
        padding: 5px 0;
        border-top: 1px solid var(--theia-panel-border);
        border-bottom: 1px solid var(--theia-panel-border);
        font-variant-numeric: tabular-nums;
    }
    .akari-inspector-widget .akari-inspector-generation-estimate {
        display: flex;
        align-items: baseline;
        gap: 6px;
        white-space: nowrap;
        color: var(--theia-textLink-foreground);
        font-variant-numeric: tabular-nums;
    }
    .akari-inspector-widget .akari-inspector-generation-error {
        color: var(--theia-errorForeground);
    }
    .akari-inspector-widget .akari-inspector-generation-warning {
        color: var(--theia-editorWarning-foreground, var(--theia-descriptionForeground));
    }
    .akari-inspector-widget .akari-inspector-generation-note {
        color: var(--theia-descriptionForeground);
        font-size: 11px;
    }
    @keyframes akari-inspector-focus-pulse {
        0%, 100% { box-shadow: 0 0 0 0 var(--akari-focus-pulse, var(--akari-accent)); }
        50% { box-shadow: 0 0 0 4px var(--akari-focus-pulse, var(--akari-accent)); }
    }
    .akari-inspector-widget .akari-inspector-focus-pulse {
        animation: akari-inspector-focus-pulse 0.4s ease-in-out 4;
        border-radius: 3px;
    }
    .akari-inspector-widget .akari-inspector-focus-pulse-reduced {
        outline: 2px solid var(--akari-focus-pulse, var(--akari-accent));
        outline-offset: 1px;
    }
`;
        this.node.appendChild(style);

        this.node.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || !this.clearSolo()) return;
            event.preventDefault();
            event.stopPropagation();
            this.render();
        });
        this.toDispose.push(this.model.onChanged(() => {
            this.clearSoloForSelectionChange();
            this.lutGeneration++;
            this.projectLutRefs = [];
            this.render();
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

    focusField(options: { tabId?: string; sectionId?: string; fieldName?: string; solo?: boolean }): boolean {
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
        if (!snapshot || snapshot.kind === 'world') {
            if (clearedSolo) this.render();
            return false;
        }
        const kind = snapshot.kind === 'multi' ? 'caption' : snapshot.kind;
        if (options.tabId) {
            this.explicitTabId = options.tabId;
            this.tabState.setActiveTab(kind, options.tabId);
        }
        if (options.sectionId) this.sectionState.setCollapsed(kind, options.sectionId, false);
        this.render();
        let ok = true;
        if (options.tabId) {
            ok = ok && !!this.body.querySelector(`[data-akari-ui="tab:inspector-${options.tabId}"].is-active`);
        }
        let sectionElement: Element | null = null;
        if (options.sectionId) {
            sectionElement = this.body.querySelector(`[data-akari-ui="section:inspector-${options.sectionId}"]`);
            ok = ok && !!sectionElement;
        }
        let fieldElement: Element | null = null;
        if (options.fieldName) {
            fieldElement = this.body.querySelector(`[data-akari-field="${options.fieldName}"]`);
            ok = ok && !!fieldElement;
        }
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
                sectionElement = options.sectionId
                    ? this.body.querySelector(`[data-akari-ui="section:inspector-${options.sectionId}"]`)
                    : null;
                fieldElement = options.fieldName
                    ? this.body.querySelector(`[data-akari-field="${options.fieldName}"]`)
                    : null;
            }
        }
        const target = fieldElement ?? sectionElement;
        if (target) this.pulse(target as HTMLElement);
        return true;
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

    protected render(): void {
        this.dispatchCaptionZoneEvent(CAPTION_ZONE_HOVER_EVENT, null);
        this.body.replaceChildren();
        this.hideFieldNotice();
        const snapshot = this.model.snapshot;
        if (this.generationFramePick || this.generationFramePickMessage) this.syncGenerationFramePick();
        if (!snapshot || snapshot.kind === 'multi') this.syncAdjustCompare(undefined, '');
        if (!snapshot) {
            this.tabSelectionKey = undefined;
            this.currentTab = undefined;
            this.explicitTabId = undefined;
            const empty = document.createElement('div');
            empty.className = 'akari-inspector-empty';
            empty.textContent = 'タイムラインで項目を選択してください。';
            this.body.appendChild(empty);
            return;
        }
        if (snapshot.kind === 'world') {
            this.tabSelectionKey = undefined;
            this.currentTab = undefined;
            this.renderWorldSelection(snapshot);
            this.explicitTabId = undefined;
            return;
        }

        const generationIdentity = this.generationIdentity(snapshot);
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
                        projectRootUri: root.toString(), sourcePaths: [generationIdentity.sourcePath]
                    });
                    // next belongs to the source's own sidecar, including kind: still.
                    // The generation selector may only return a related video job.
                    const meta = sidecars.entries.find(entry => entry.sourcePath === generationIdentity.sourcePath)?.meta
                        ?? selectGenerationSidecarForSource(generationIdentity.sourcePath, sidecars.entries, Date.now())?.meta;
                    if (this.generationTabDrafts.get(generationIdentity.key) === generationDraft) {
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
                    sections = CUT_SECTIONS(snapshot, requestWrite, this.generationSectionFields(snapshot));
                    break;
                case 'layer':
                    if (snapshot.layerKind === 'video' && !layerAudioControls.has(snapshot)) {
                        layerAudioControls.set(snapshot, null);
                        void (async () => {
                            await this.workspaceService.ready;
                            const root = this.workspaceService.tryGetRoots()[0]?.resource;
                            if (!root) return;
                            const uri = root.resolve('edit.json');
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
                        snapshot, requestWrite, layerAudioControls.get(snapshot), this.generationSectionFields(snapshot)
                    );
                    break;
                case 'caption':
                    sections = CAPTION_SECTIONS(snapshot, requestWrite, {
                        zoneHover: zone => this.dispatchCaptionZoneEvent(CAPTION_ZONE_HOVER_EVENT, zone),
                        zonePreset: zone => this.dispatchCaptionZoneEvent(CAPTION_ZONE_PRESET_EVENT, zone)
                    });
                    break;
                case 'audio':
                    sections = AUDIO_SECTIONS(snapshot as AudioInspectorSnapshot, request => this.commitWrite(request));
                    break;
                case 'overlay':
                    sections = OVERLAY_SECTIONS(snapshot, requestWrite, this.overlayKnobs(snapshot));
                    break;
                case 'item':
                    sections = TREE_ITEM_SECTIONS(snapshot, requestWrite);
                    break;
            }
        }
        const tabs = tabsForKind(sectionKind, {
            src: this.tabSourceHint(rowSnapshot), generationAvailable: !!generationIdentity
        });
        const generationState = generationIdentity ? this.generationStates.get(generationIdentity.key) : undefined;
        const meta = generationIdentity ? this.generationTabMeta.get(generationIdentity.key) : undefined;
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
        const activeTab = initialTabFor({
            kind: sectionKind, tabs, persisted: this.tabState.activeTab(sectionKind, tabs), generationTodo,
            explicitTabId: this.explicitTabId, clipKey, previousClipKey: this.tabSelectionKey, currentTab: this.currentTab
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
        this.appendTabStrip(sectionKind, tabs, activeTab, generationTodo);

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
            ADJUST_SECTIONS(rowSnapshot, requestWrite, {
                projectLutRefs: this.projectLutRefs,
                importLut: () => this.importAdjustLut(rowSnapshot)
            })
                .filter(section => assignSectionToTab(sectionKind, section.id) === activeTab)
                .forEach(section => this.appendSection(section, rowSnapshot, sectionKind));
            if (!this.solo) {
                ADJUST_PREVIEW_SECTIONS.forEach(section => this.appendAdjustPreviewSection(section, sectionKind));
            }
            this.appendSoloBanner();
            return;
        }
        if (activeTab === 'audio' && sectionKind !== 'audio') {
            if (!this.solo) {
                AUDIO_PREVIEW_SECTIONS.forEach(section =>
                    this.appendAdjustPreviewSection(section, sectionKind, 'audio')
                );
            }
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
                    button.textContent = '⇄ 候補を見る';
                    button.onclick = () => this.model.requestMaterialSwap?.();
                    row.append(label, button);
                    this.body.appendChild(row);
                }
                this.appendSection(section, rowSnapshot, sectionKind);
            });
        if (activeTab === 'audio' && sectionKind === 'audio') {
            if (!this.solo) {
                AUDIO_ITEM_PREVIEW_SECTIONS.forEach(section =>
                    this.appendAdjustPreviewSection(section, sectionKind, 'audio-item')
                );
            }
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
            ?.replace(/^[▸▾]\s*/u, '').trim();
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
        Object.assign(list.style, { display: 'grid', gridTemplateColumns: '90px 1fr', gap: '7px', margin: '4px 0 10px' });
        for (const [label, value] of values) {
            const dt = document.createElement('dt'); dt.textContent = label;
            const dd = document.createElement('dd'); dd.textContent = String(value); dd.style.margin = '0';
            list.append(dt, dd);
        }
        this.body.appendChild(list);
        if (active === 'world') {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'theia-button'; button.textContent = 'AI への指示をコピー';
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
        generationTodo = false
    ): void {
        const strip = document.createElement('div');
        strip.className = 'akari-inspector-tab-strip';
        strip.setAttribute('role', 'tablist');
        strip.setAttribute('aria-label', 'インスペクター');
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
            if (!tab.enabled) button.title = tab.disabledTitle ?? '近日';
            if (tab.id === 'generation' && generationTodo) {
                const todo = document.createElement('span');
                todo.setAttribute('data-akari-generation-todo', 'true');
                todo.setAttribute('aria-label', '生成でやることがあります');
                button.appendChild(todo);
            }
            button.addEventListener('click', () => {
                if (!tab.enabled || tab.id === activeTab) return;
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
        const container = document.createElement('section');
        container.className = 'akari-inspector-section akari-inspector-section-soon';
        container.setAttribute('data-akari-ui', `section:inspector-${previewKind}-${section.id}`);
        const header = document.createElement('div');
        header.className = 'akari-inspector-section-header';
        const stateId = `${previewKind}:${section.id}`;
        const collapsed = this.sectionState.isCollapsed(kind, { id: stateId });
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'akari-inspector-section-toggle akari-inspector-section-soon-title';
        toggle.textContent = `${collapsed ? '▸' : '▾'} ${section.label}`;
        toggle.setAttribute('aria-expanded', String(!collapsed));
        const chip = document.createElement('span');
        chip.className = 'akari-inspector-section-soon-chip';
        chip.textContent = '近日';
        const body = document.createElement('div');
        body.className = 'akari-inspector-section-body';
        body.hidden = collapsed;
        body.appendChild(section.build());
        toggle.addEventListener('click', () => {
            const next = !body.hidden;
            body.hidden = next;
            toggle.textContent = `${next ? '▸' : '▾'} ${section.label}`;
            toggle.setAttribute('aria-expanded', String(!next));
            this.sectionState.setCollapsed(kind, stateId, next);
        });
        header.append(toggle, chip);
        container.append(header, body);
        this.body.appendChild(container);
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
            this.knobCache.set(metaPath, []);
        }
        const current = this.model.snapshot;
        if (current?.kind === 'overlay' && current.id === overlayId) this.render();
    }

    protected appendSection(
        section: InspectorSection,
        snapshot: InspectorSnapshot,
        kind: 'cut' | 'layer' | 'caption' | 'audio' | 'overlay' | 'item'
    ): void {
        if (this.solo) {
            const [filteredSection] = filterInspectorSoloSections(kind, [section], this.solo);
            if (!filteredSection) return;
            section = filteredSection;
        }
        const container = document.createElement('section');
        container.className = 'akari-inspector-section';
        container.setAttribute('data-akari-ui', `section:inspector-${section.id}`);
        const header = document.createElement('div');
        header.className = 'akari-inspector-section-header';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'akari-inspector-section-toggle';
        const collapsed = this.sectionState.isCollapsed(kind, section);
        toggle.textContent = `${collapsed ? '▸' : '▾'} ${section.label}`;
        toggle.setAttribute('aria-expanded', String(!collapsed));
        const body = document.createElement('div');
        body.className = 'akari-inspector-section-body';
        body.hidden = collapsed;
        toggle.addEventListener('click', () => {
            const next = !body.hidden;
            body.hidden = next;
            toggle.textContent = `${next ? '▸' : '▾'} ${section.label}`;
            toggle.setAttribute('aria-expanded', String(!next));
            this.sectionState.setCollapsed(kind, section.id, next);
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
                add.textContent = '+';
                add.title = '変形の行を追加';
                add.setAttribute('data-akari-ui', 'menu:inspector-transform-add');
                add.addEventListener('click', event => {
                    const hidden = section.optionalFields!.filter(field => !this.isOptionalFieldVisible(kind, field, snapshot));
                    if (hidden.length === 0) return;
                    const menu = document.createElement('div');
                    menu.className = 'akari-inspector-popover-menu';
                    Object.assign(menu.style, {
                        position: 'fixed', left: `${event.clientX}px`, top: `${event.clientY}px`, zIndex: '10000',
                        display: 'grid', padding: '4px', background: 'var(--theia-menu-background)',
                        border: '1px solid var(--theia-menu-border, #454545)'
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
        this.body.appendChild(container);
    }

    protected isOptionalFieldVisible(
        kind: string,
        field: InspectorFieldDef & { name: string },
        snapshot: InspectorSnapshot
    ): boolean {
        const key = `akari.inspector.optional.v1:${kind}:${field.name}`;
        const saved = window.localStorage.getItem(key);
        if (saved !== null) return saved === 'true';
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
                        projectRootUri: root.toString(), sourcePaths: [row.sourcePath]
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
                        await this.layerAudioService.writeGenerationDraft({ projectRootUri, itemId: request.itemId, ...draft });
                        if (run.stopped) throw new Error('送信前に中止しました');
                        // This RPC resolves on CLI process close, not on submission.
                        return { completion: this.layerAudioService.startGenerateVideo(request) };
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

    protected generationIdentity(snapshot: TimelineSelectionModel['snapshot']): {
        key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string;
    } | undefined {
        if (!snapshot || snapshot.kind === 'multi') return undefined;
        if (snapshot.kind === 'cut') {
            if (!snapshot.itemId || !snapshot.sourcePath || !/\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(snapshot.sourcePath)) return undefined;
            return {
                key: snapshot.itemId, itemId: snapshot.itemId, sourcePath: snapshot.sourcePath,
                duration: Math.max(0, snapshot.outputEnd - snapshot.outputStart), sourceId: snapshot.src
            };
        }
        if (snapshot.kind === 'layer' && snapshot.sourceKind === 'media' && snapshot.src
            && /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/iu.test(snapshot.src)) {
            return { key: snapshot.id, itemId: snapshot.id, sourcePath: snapshot.src, duration: snapshot.duration };
        }
        return undefined;
    }

    protected async loadGeneration(identity: { key: string; itemId: string; sourcePath: string; duration: number; sourceId?: string }): Promise<void> {
        this.generationLoads.add(identity.key);
        try {
            await this.workspaceService.ready;
            const root = this.workspaceService.tryGetRoots()[0]?.resource;
            if (!root) return;
            if (this.generationCatalog.length === 0) {
                const [catalog, defaults] = await Promise.all([
                    this.layerAudioService.readGenerationCatalog(),
                    this.layerAudioService.readGenerationDefaults({ projectRootUri: root.toString() })
                ]);
                this.generationCatalog = catalog.models.filter(row => row.kind === 'video') as unknown as GenerationCatalogRow[];
                this.generationDefaultModel = defaults.video || 'fal:h3-i2v';
            }
            const sidecars = await this.layerAudioService.readGenerationSidecars({
                projectRootUri: root.toString(), sourcePaths: [identity.sourcePath]
            });
            const normalize = (path: string): string => path.trim().replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
            const sourceMeta = sidecars.entries.find(entry => normalize(entry.sourcePath) === normalize(identity.sourcePath))?.meta;
            this.generationTabMeta.set(identity.key, sourceMeta ?? {});
            let draft = generationFields.fromMeta(sourceMeta);
            if (!draft) {
                try {
                    const uri = root.resolve(`.akari/generation/${identity.itemId}.inputs.json`);
                    const parsed = JSON.parse((await this.fileService.read(uri)).value.toString()) as GenerationDraft;
                    if (parsed && typeof parsed === 'object' && typeof parsed.modelId === 'string') draft = parsed;
                } catch { /* A missing legacy draft is the normal first-open state. */ }
            }
            await this.loadGenerationNeighbors(identity);
            const model = this.generationCatalog.find(row => row.id === draft?.modelId)
                ?? this.generationCatalog.find(row => row.id === this.generationDefaultModel)
                ?? this.generationCatalog[0];
            if (!model) throw new Error('動画生成モデルがカタログにありません。');
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
        } catch (error) {
            this.showFieldNotice(error instanceof Error ? error.message : String(error));
        }
        if (this.generationIdentity(this.model.snapshot)?.key === identity.key) this.render();
    }

    protected async loadGenerationNeighbors(identity: { key: string; itemId: string }): Promise<void> {
        const root = this.workspaceService.tryGetRoots()[0]?.resource;
        if (!root) return;
        const edit = JSON.parse((await this.fileService.read(root.resolve('edit.json'))).value.toString()) as {
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

    protected async validateGenerationDraft(key: string): Promise<void> {
        const draft = this.generationDrafts.get(key);
        if (!draft) return;
        const validation = await this.layerAudioService.validateGenerationInputs({
            modelId: draft.modelId, inputs: draft.inputs, output: draft.output
        });
        this.generationValidations.set(key, validation as GenerationValidationResult as GenerationValidation);
    }

    protected generationSectionFields<T extends TimelineCutSelection | TimelineLayerSelection>(snapshot: T): InspectorFieldDef<T>[] | undefined {
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
                ...this.generationNeighbors?.get(identity.key), thumbnail: path => this.generationThumbnail(path),
                state: this.generationStates.get(identity.key)
            },
            actions: {
                update: (path, value) => this.updateGenerationDraft(identity, path, value),
                copyAdjacent: () => this.copyAdjacentGenerationDraft(identity),
                generate: () => this.confirmAndStartGeneration(identity),
                resume: () => this.resumeGeneration(identity),
                retry: () => this.confirmAndStartGeneration(identity)
            }
        });
        if (this.generationFramePickMessage?.key === identity.key) {
            const message = { name: 'generation-message', label: 'エラー',
                className: 'akari-inspector-generation-error', getValue: () => this.generationFramePickMessage!.text };
            const index = fields.findIndex(field => field.name === 'generation-message');
            if (index >= 0) fields[index] = message;
            else fields.push(message);
        }
        // Keep each paired visual unit together in the section model.
        const pairs = [['first-frame', 'last_frame'], ['generation-variety', 'generation-material-note'],
            ['generation-estimate', 'generation-actions']];
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
        const next: GenerationDraft = {
            modelId: current.modelId, inputs: { ...current.inputs }, output: { ...current.output }
        };
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
                projectRootUri: root.toString(), itemId: identity.itemId,
                modelId: draft.modelId, inputs: draft.inputs, output: { ...draft.output, duration_s: identity.duration }
            });
            this.generationTabMeta.set(identity.key, { next: { status: 'planned' } });
        });
        this.generationWrites.set(identity.key, write);
        await write;
        if (this.generationIdentity(this.model.snapshot)?.key === identity.key) this.render();
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
                projectRootUri: root.toString(), itemId: identity.itemId, approved: true
            }).then(result => {
                if (!result.ok) this.showFieldNotice(result.reason ?? '生成に失敗しました。');
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

    protected async commitWrite(
        request: InspectorWriteRequest
    ): Promise<InspectorWriteResult> {
        if (!this.model.requestWrite) {
            return { ok: false, message: '書き込み機能が利用できません。' };
        }
        try {
            return await this.model.requestWrite(request as InspectorWriteRequest);
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    protected dispatchCaptionZoneEvent(type: string, zone: string | null): void {
        const root = this.workspaceService.tryGetRoots()[0];
        if (!root) return;
        window.dispatchEvent(new CustomEvent(type, {
            detail: { editUri: root.resource.resolve('edit.json').toString(), zone }
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
            ? selection.property.substring('transform.'.length) as 'x' | 'y' | 'scale' | 'rotate'
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
        const value = typeof raw === 'number' ? raw : leaf === 'scale' || leaf === 'opacity' ? 1 : 0;
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
                        : fieldName === 'transform-rotate' ? 'transform.rotate'
                            : fieldName === 'opacity' ? 'opacity' : undefined;
        if (!property) return undefined;
        const rowProperty = keyframeRowPropertyOf(property);
        const itemId = snapshot.kind === 'cut' ? `cut:${snapshot.index}` : snapshot.id;
        const selected = this.model.keyframeSelection;
        const keyframeValue = fieldName === 'transform-scale' ? value / 100 : value;
        const hasKeyframes = snapshot.keyframes?.some(point =>
            keyframeValueAt(point, rowProperty) !== undefined) ?? false;
        const request = (action: Exclude<KeyframeControlRequest['action'], 'easing'>): void => {
            void this.model.requestKeyframe?.({ action, itemId, property, value: keyframeValue });
        };
        return {
            active: selected?.itemId === itemId && selected.property === rowProperty,
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
                remove.textContent = '×';
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
                preview.textContent = entry.slot === 'reference_audios' ? '♫' : '読み込み中…';
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
                add.type = 'button'; add.textContent = '＋ 追加';
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
                content.textContent = path ? '読み込み中…' : '＋ 画像を選ぶ';
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
            const footer = document.createElement('div');
            footer.className = 'akari-inspector-generation-footer';
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
                button.addEventListener('click', () => void action.action(snapshot).then(result => {
                    if (!result.ok) this.showFieldNotice(result.message ?? '操作に失敗しました。');
                }));
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
        const labelElement = document.createElement('div');
        labelElement.className = 'akari-inspector-row-label';
        labelElement.textContent = field.label;
        row.appendChild(labelElement);

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
            action.disabled = field.disabled === true;
            if (field.title) action.title = field.title;
            action.setAttribute('data-akari-ui', `action:inspector-${fieldName}`);
            action.addEventListener('click', () => void field.action!(snapshot).then(result => {
                if (!result.ok) this.showFieldNotice(result.message ?? '操作に失敗しました。');
            }));
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
                row.style.color = 'var(--theia-disabledForeground)';
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

        if (field.inputKind === 'scrub-number') {
            let sendLive: ((value: number) => void) | undefined;
            if (field.liveField) {
                const liveField = field.liveField;
                const target: LivePreviewTarget | undefined = snapshot.kind === 'cut'
                    ? { kind: 'cut', index: snapshot.index }
                    : snapshot.kind === 'layer'
                        ? { kind: 'layer', id: snapshot.id }
                        : snapshot.kind === 'item' || snapshot.kind === 'overlay'
                            ? { kind: 'item', id: snapshot.id } : undefined;
                if (target) {
                    sendLive = value => this.model.requestLivePreview?.({
                        target, field: liveField,
                        value: fieldName.endsWith('scale') && field.unit === '%' ? value / 100 : value
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
                    onPreview: sendLive,
                    onCommit: async value => {
                        if (keyframe?.hasKeyframes && /^(crop-|perspective-)/u.test(fieldName)
                            && this.model.requestKeyframe) {
                            const itemId = snapshot.kind === 'cut' ? `cut:${snapshot.index}` : snapshot.id;
                            const result = await this.model.requestKeyframe({
                                action: 'write', itemId,
                                property: fieldName.replace(/-/gu, '.') as KeyframeSeatProperty, value
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
            this.appendColorInput(row, fieldName, editValue, commitValue);
            parent.appendChild(row);
            return;
        }

        if (field.inputKind === 'zone-grid') {
            const grid = document.createElement('div');
            grid.className = 'akari-caption-zone-grid';
            grid.setAttribute('data-akari-ui', `field:inspector-${fieldName}`);
            const glyphs = ['↖', '↑', '↗', '←', '•', '→', '↙', '↓', '↘'];
            (field.options ?? []).forEach((zone, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'akari-caption-zone-cell';
                button.dataset.akariCaptionZone = zone;
                button.textContent = glyphs[index] ?? '•';
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

        let input: HTMLInputElement | HTMLSelectElement;
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
                const key = (event as KeyboardEvent).key;
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
                display: 'grid', padding: '4px', background: 'var(--theia-menu-background)',
                border: '1px solid var(--theia-menu-border, #454545)'
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
        commitValue: (nextValue: string, revert: () => void) => Promise<boolean>
    ): void {
        const container = document.createElement('div');
        container.className = 'akari-inspector-color-field';
        container.setAttribute('data-akari-ui', `field:inspector-${fieldName}`);
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'akari-inspector-color-picker';
        picker.setAttribute('aria-label', 'カラーピッカー');
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.className = 'akari-inspector-row-input';
        textInput.value = editValue;
        const pickerColor = (value: string): string | undefined => {
            const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.exec(value);
            if (!match) {
                return undefined;
            }
            const hex = match[1].length === 3
                ? match[1].split('').map(character => character + character).join('')
                : match[1].slice(0, 6);
            return `#${hex}`;
        };
        picker.value = pickerColor(editValue) ?? '#000000';
        const revert = (): void => {
            textInput.value = editValue;
            picker.value = pickerColor(editValue) ?? '#000000';
        };
        const commitText = async (): Promise<void> => {
            const nextValue = textInput.value;
            const success = await commitValue(nextValue, revert);
            if (success) {
                const nextPicker = pickerColor(nextValue);
                if (nextPicker) {
                    picker.value = nextPicker;
                }
            }
        };
        picker.addEventListener('change', () => {
            textInput.value = picker.value.toUpperCase();
            void commitValue(textInput.value, revert);
        });
        textInput.addEventListener('input', () => {
            const nextPicker = pickerColor(textInput.value);
            if (nextPicker) {
                picker.value = nextPicker;
            }
        });
        textInput.addEventListener('blur', () => {
            void commitText();
        });
        textInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                textInput.blur();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                revert();
                textInput.blur();
            }
        });
        container.append(picker, textInput);
        row.appendChild(container);
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
