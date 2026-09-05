import URI from '@theia/core/lib/common/uri';
import { BaseWidget } from '@theia/core/lib/browser';
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
    TimelineTreeItemSnapshot
} from './timeline-selection-model';
import { keyframeValueAt } from './timeline/timeline-keyframe-rows';
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
import {
    createInspectorAdjustWriteRequest,
    formatInspectorAdjustValue,
    INSPECTOR_ADJUST_BASIC_FIELDS,
    readInspectorAdjustSnapshot
} from './inspector/adjust-fields';
import {
    composeInspectorSections,
    InspectorSectionDef,
    InspectorSectionState
} from './inspector/section-model';
import {
    ACTIVE_ADJUST_SECTIONS,
    assignSectionToTab,
    type InspectorTabDef,
    InspectorTabState,
    tabsForKind
} from './inspector/tab-model';
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
    inputKind?: 'boolean-select' | 'select' | 'zone-grid' | 'scrub-number' | 'color' | 'text' | 'media';
    options?: readonly string[];
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
    actionLabel?: string;
    action?: (snapshot: TSnapshot) => Promise<InspectorWriteResult>;
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
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
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
                { name: 'duration', label: '尺', getValue: () => formatDurationSeconds(snapshot.outputEnd - snapshot.outputStart) }
            ]
        },
        { id: 'transform', label: '変形', fields: transformFields },
        { id: 'framing', label: 'フレーミング', fields: cutFramingFields(snapshot, requestWrite) },
        { id: 'freeze', label: 'フリーズ', fields: cutFreezeFields(snapshot, requestWrite) },
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
                },
                { name: 'transition-type', label: 'transition_out 種別', getValue: () => orDash(snapshot.transitionOut?.type, value => value) },
                { name: 'transition-duration', label: 'transition_out 尺', getValue: () => orDash(snapshot.transitionOut?.duration, formatDurationSeconds) }
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

function LAYER_SECTIONS(
    snapshot: TimelineLayerSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorSection[] {
    const chromaSimilarity = chromaControlValue(snapshot.chromaKey, 'similarity', 0.1);
    const chromaBlend = chromaControlValue(snapshot.chromaKey, 'blend', 0);
    const cropFields = CROP_FIELDS(snapshot, 'layer', requestWrite);
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
                }
            ]
        },
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
    return composeInspectorSections(tabs);
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

function TREE_ITEM_SECTIONS(
    snapshot: TimelineTreeItemSnapshot,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorSection[] {
    const number = (key: 'x' | 'y' | 'scale' | 'rotate', fallback: number): number =>
        typeof snapshot.transform?.[key] === 'number' ? snapshot.transform[key]! : fallback;
    const cropFields = CROP_FIELDS(snapshot, 'item', requestWrite);
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
        { id: 'appearance', label: '外観', fields: [{
            name: 'opacity', label: '不透明度', unit: '%', displayScale: 100,
            getValue: () => String(opacity), getEditValue: () => String(opacity),
            inputKind: 'scrub-number', scrubStep: 0.01, min: 0, max: 1, liveField: 'opacity',
            write: async (_snapshot, value) => requestWrite({
                kind: 'item-field', id: snapshot.id, path: 'opacity', value: Number(value)
            }), reset: () => requestWrite({ kind: 'item-field', id: snapshot.id, path: 'opacity', value: null })
        }] },
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
    }];
}

/**
 * タイムラインの選択内容を表示し、安全なフィールドを編集できるパネル。
 * 一度開けば常駐し、TimelineSelectionModel の変化に追従して内容を更新する。
 */
@injectable()
export class AkariInspectorWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-inspector-widget';

    @inject(TimelineSelectionModel)
    protected readonly model!: TimelineSelectionModel;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(FileDialogService)
    protected readonly fileDialogService!: FileDialogService;

    protected projectLutRefs: readonly string[] = [];
    protected lutGeneration = 0;
    protected lutRequestedGeneration = -1;
    protected adjustCompare?: AdjustCompareState;

    protected readonly body = document.createElement('div');
    protected readonly fieldNotice = document.createElement('div');
    protected fieldNoticeTimer: number | undefined;
    protected readonly sectionState = new InspectorSectionState(window.localStorage);
    protected readonly tabState = new InspectorTabState(window.localStorage);
    protected readonly knobCache = new Map<string, readonly InspectorKnob[] | null>();
    protected lastEasingPreviewAt = -Infinity;

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
    .akari-inspector-widget .akari-inspector-tab:disabled {
        color: var(--theia-disabledForeground);
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
`;
        this.node.appendChild(style);

        this.toDispose.push(this.model.onChanged(() => {
            this.lutGeneration++;
            this.projectLutRefs = [];
            this.render();
        }));
        this.render();
    }

    protected render(): void {
        this.dispatchCaptionZoneEvent(CAPTION_ZONE_HOVER_EVENT, null);
        this.body.replaceChildren();
        this.hideFieldNotice();
        const snapshot = this.model.snapshot;
        if (!snapshot || snapshot.kind === 'multi') this.syncAdjustCompare(undefined, '');
        if (!snapshot) {
            const empty = document.createElement('div');
            empty.className = 'akari-inspector-empty';
            empty.textContent = 'タイムラインで項目を選択してください。';
            this.body.appendChild(empty);
            return;
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
                    sections = CUT_SECTIONS(snapshot, requestWrite);
                    break;
                case 'layer':
                    sections = LAYER_SECTIONS(snapshot, requestWrite);
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
        const tabs = tabsForKind(sectionKind, { src: this.tabSourceHint(rowSnapshot) });
        const activeTab = this.tabState.activeTab(sectionKind, tabs);
        const compareTarget: LivePreviewTarget | undefined = rowSnapshot.kind === 'caption' || rowSnapshot.kind === 'audio'
            ? undefined : rowSnapshot.kind === 'cut' ? { kind: 'cut', index: rowSnapshot.index }
                : { kind: 'item', id: rowSnapshot.id };
        this.syncAdjustCompare(compareTarget, activeTab);
        this.appendTabStrip(sectionKind, tabs, activeTab);

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
            ADJUST_PREVIEW_SECTIONS.forEach(section => this.appendAdjustPreviewSection(section, sectionKind));
            return;
        }
        if (activeTab === 'audio' && sectionKind !== 'audio') {
            AUDIO_PREVIEW_SECTIONS.forEach(section =>
                this.appendAdjustPreviewSection(section, sectionKind, 'audio')
            );
            this.appendSection(AUDIO_MASTER_SECTION(this.model.audioMaster, requestWrite), rowSnapshot, sectionKind);
            return;
        }
        sections
            .filter(section => assignSectionToTab(sectionKind, section.id) === activeTab)
            .forEach(section => this.appendSection(section, rowSnapshot, sectionKind));
        if (activeTab === 'audio' && sectionKind === 'audio') {
            AUDIO_ITEM_PREVIEW_SECTIONS.forEach(section =>
                this.appendAdjustPreviewSection(section, sectionKind, 'audio-item')
            );
            this.appendSection(AUDIO_MASTER_SECTION(this.model.audioMaster, requestWrite), rowSnapshot, sectionKind);
        }
    }

    protected syncAdjustCompare(target: LivePreviewTarget | undefined, activeTab: string): void {
        const next = nextAdjustCompareState(this.adjustCompare, { target, activeTab });
        this.adjustCompare = next.state;
        if (next.release) this.model.requestAdjustBypass?.({ target: next.release, enabled: false });
    }

    override dispose(): void {
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
        kind: 'cut' | 'layer' | 'caption' | 'audio' | 'overlay' | 'item',
        tabs: readonly InspectorTabDef[],
        activeTab: string
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
            if (!tab.enabled) button.title = '近日';
            button.addEventListener('click', () => {
                if (!tab.enabled || tab.id === activeTab) return;
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
        const property = fieldName === 'transform-x' ? 'transform.x'
            : fieldName === 'transform-y' ? 'transform.y'
                : fieldName === 'transform-scale' ? 'transform.scale'
                    : fieldName === 'transform-rotate' ? 'transform.rotate'
                        : fieldName === 'opacity' ? 'opacity' : undefined;
        if (!property) return undefined;
        const itemId = snapshot.kind === 'cut' ? `cut:${snapshot.index}` : snapshot.id;
        const selected = this.model.keyframeSelection;
        const keyframeValue = fieldName === 'transform-scale' ? value / 100 : value;
        const hasKeyframes = snapshot.keyframes?.some(point =>
            keyframeValueAt(point, property) !== undefined) ?? false;
        const request = (action: Exclude<KeyframeControlRequest['action'], 'easing'>): void => {
            void this.model.requestKeyframe?.({ action, itemId, property, value: keyframeValue });
        };
        return {
            active: selected?.itemId === itemId && selected.property === property,
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
        const row = document.createElement('div');
        row.className = 'akari-inspector-row';
        if (field.title) row.title = field.title;
        const fieldName = field.name ?? field.label.toLowerCase().replace(/[^a-z0-9_-]+/giu, '-');
        const labelElement = document.createElement('div');
        labelElement.className = 'akari-inspector-row-label';
        labelElement.textContent = field.label;
        row.appendChild(labelElement);

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
                    onCommit: value => commitValue(String(value), () => undefined),
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
            textInput.type = 'text';
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
