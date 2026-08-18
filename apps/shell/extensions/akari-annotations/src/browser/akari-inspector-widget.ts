import { BaseWidget } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    InspectorWriteRequest,
    InspectorWriteResult,
    LivePreviewRequest,
    LivePreviewTarget,
    TimelineAudioSelection,
    TimelineCaptionSelection,
    TimelineCutSelection,
    TimelineLayerSelection,
    TimelineItemSelectionSnapshot,
    TimelineOverlaySelection,
    TimelineSelectionModel,
    TimelineSelectionTarget
} from './timeline-selection-model';
import { CAPTION_ZONES, type CaptionBackgroundMode, type CaptionTextStyle } from '../common/caption-store';

// appendScrubNumber の pointermove 中にライブプレビューを送出する最短間隔（ms）。
// 契約の目安「16〜50ms」の中間値で throttle する。
const LIVE_PREVIEW_THROTTLE_MS = 30;

type InspectorSnapshot = TimelineItemSelectionSnapshot;

interface InspectorFieldDef<TSnapshot = InspectorSnapshot> {
    label: string;
    getValue: (snapshot: TSnapshot) => string;
    /** 編集用入力欄の初期値。省略時は getValue の戻り値を使う。 */
    getEditValue?: (snapshot: TSnapshot) => string;
    /** フィールドの値型に対応した入力 UI。 */
    inputKind?: 'boolean-select' | 'select' | 'scrub-number' | 'color';
    options?: readonly string[];
    scrubStep?: number;
    min?: number;
    max?: number;
    /** 文字列の型変換と検証を行い、妥当な値だけを書き込みブリッジへ渡す。 */
    write?: (snapshot: TSnapshot, nextValue: string) => Promise<InspectorWriteResult>;
    /**
     * scrub-number ドラッグ中に書き込みなしでプレビューへ即時反映する対象フィールド。
     * cuts/layers の transform/opacity のみ設定する。
     */
    liveField?: LivePreviewRequest['field'];
}

interface InspectorTabDef<TSnapshot = InspectorSnapshot> {
    label: string;
    fields: ReadonlyArray<InspectorFieldDef<TSnapshot>>;
}

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

function CUT_TABS(
    snapshot: TimelineCutSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorTabDef[] {
    return [
        {
            label: '基本',
            fields: [
                {
                    label: 'X',
                    getValue: () => String(snapshot.transform?.x ?? 0),
                    getEditValue: () => String(snapshot.transform?.x ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 1,
                    liveField: 'x',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed)) {
                            return { ok: false, message: 'X は有限数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'cut-transform-x', index: snapshot.index, value: parsed });
                    }
                },
                {
                    label: 'Y',
                    getValue: () => String(snapshot.transform?.y ?? 0),
                    getEditValue: () => String(snapshot.transform?.y ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 1,
                    liveField: 'y',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed)) {
                            return { ok: false, message: 'Y は有限数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'cut-transform-y', index: snapshot.index, value: parsed });
                    }
                },
                {
                    label: '拡大率',
                    getValue: () => String(snapshot.transform?.scale ?? 1),
                    getEditValue: () => String(snapshot.transform?.scale ?? 1),
                    inputKind: 'scrub-number',
                    scrubStep: 0.01,
                    min: 0.01,
                    liveField: 'scale',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            return { ok: false, message: '拡大率は正の数で入力してください。' };
                        }
                        return requestWrite({ kind: 'cut-scale', index: snapshot.index, value: parsed });
                    }
                },
                {
                    label: '回転',
                    getValue: () => String(snapshot.transform?.rotate ?? 0),
                    getEditValue: () => String(snapshot.transform?.rotate ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.1,
                    liveField: 'rotate',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed)) {
                            return { ok: false, message: '回転は有限数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'cut-rotate', index: snapshot.index, value: parsed });
                    }
                },
                {
                    label: '不透明度',
                    getValue: () => String(snapshot.opacity ?? 1),
                    getEditValue: () => String(snapshot.opacity ?? 1),
                    inputKind: 'scrub-number',
                    scrubStep: 0.01,
                    min: 0,
                    max: 1,
                    liveField: 'opacity',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
                            return { ok: false, message: '不透明度は 0〜1 の範囲で入力してください。' };
                        }
                        return requestWrite({ kind: 'cut-opacity', index: snapshot.index, value: parsed });
                    }
                },
                {
                    label: 'speed',
                    getValue: () => withDefaultNumber(snapshot.speed, 1, formatDecimal1),
                    getEditValue: () => String(snapshot.speed ?? 1),
                    inputKind: 'scrub-number',
                    scrubStep: 0.01,
                    min: 0.01,
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            return { ok: false, message: 'speed は正の数で入力してください。' };
                        }
                        return requestWrite({ kind: 'cut-speed', index: snapshot.index, value: parsed });
                    }
                },
                {
                    label: 'transition_out 種別',
                    getValue: () => orDash(snapshot.transitionOut?.type, value => value)
                },
                {
                    label: 'transition_out 尺',
                    getValue: () => orDash(snapshot.transitionOut?.duration, formatDurationSeconds)
                }
            ]
        },
        {
            label: '情報',
            fields: [
                { label: 'track', getValue: () => withDefaultNumber(snapshot.track, 0, value => String(value)) },
                { label: 'インデックス', getValue: () => String(snapshot.index + 1) }
            ]
        }
    ];
}

const LAYER_BLEND_OPTIONS = [
    'normal', 'screen', 'multiply', 'add', 'difference',
    'darken', 'lighten', 'overlay', 'hardlight', 'softlight'
] as const;

function LAYER_TABS(
    snapshot: TimelineLayerSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorTabDef[] {
    return [
        {
            label: '基本',
            fields: [
                {
                    label: 'X',
                    getValue: () => String(snapshot.transform?.x ?? 0),
                    getEditValue: () => String(snapshot.transform?.x ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 1,
                    liveField: 'x',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed)) {
                            return { ok: false, message: 'X は有限数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'layer-transform-x', id: snapshot.id, value: parsed });
                    }
                },
                {
                    label: 'Y',
                    getValue: () => String(snapshot.transform?.y ?? 0),
                    getEditValue: () => String(snapshot.transform?.y ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 1,
                    liveField: 'y',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed)) {
                            return { ok: false, message: 'Y は有限数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'layer-transform-y', id: snapshot.id, value: parsed });
                    }
                },
                {
                    label: '拡大率',
                    getValue: () => String(snapshot.transform?.scale ?? 1),
                    getEditValue: () => String(snapshot.transform?.scale ?? 1),
                    inputKind: 'scrub-number',
                    scrubStep: 0.01,
                    min: 0.01,
                    liveField: 'scale',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            return { ok: false, message: '拡大率は正の数で入力してください。' };
                        }
                        return requestWrite({ kind: 'layer-scale', id: snapshot.id, value: parsed });
                    }
                },
                {
                    label: '回転',
                    getValue: () => String(snapshot.transform?.rotate ?? 0),
                    getEditValue: () => String(snapshot.transform?.rotate ?? 0),
                    inputKind: 'scrub-number',
                    scrubStep: 0.1,
                    liveField: 'rotate',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed)) {
                            return { ok: false, message: '回転は有限数値で入力してください。' };
                        }
                        return requestWrite({ kind: 'layer-rotate', id: snapshot.id, value: parsed });
                    }
                },
                {
                    label: '不透明度',
                    getValue: () => String(snapshot.opacity ?? 1),
                    getEditValue: () => String(snapshot.opacity ?? 1),
                    inputKind: 'scrub-number',
                    scrubStep: 0.01,
                    min: 0,
                    max: 1,
                    liveField: 'opacity',
                    write: async (_snapshot, nextValue) => {
                        const parsed = Number(nextValue);
                        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
                            return { ok: false, message: '不透明度は 0〜1 の範囲で入力してください。' };
                        }
                        return requestWrite({ kind: 'layer-opacity', id: snapshot.id, value: parsed });
                    }
                }
            ]
        },
        {
            label: '合成',
            fields: [
                {
                    label: 'ブレンドモード',
                    getValue: () => snapshot.blend ?? 'normal',
                    getEditValue: () => snapshot.blend ?? 'normal',
                    inputKind: 'select',
                    options: LAYER_BLEND_OPTIONS,
                    write: async (_snapshot, nextValue) =>
                        requestWrite({ kind: 'layer-blend', id: snapshot.id, value: nextValue })
                },
                { label: 'クロマキー色', getValue: () => orDash(snapshot.chromaKey?.color, value => value) },
                {
                    label: '類似度',
                    getValue: () => snapshot.chromaKey
                        ? withDefaultNumber(snapshot.chromaKey.similarity, 0.1, formatDecimal1) : '—'
                },
                {
                    label: '境界ぼかし',
                    getValue: () => snapshot.chromaKey
                        ? withDefaultNumber(snapshot.chromaKey.blend, 0, formatDecimal1) : '—'
                }
            ]
        },
        {
            label: '情報',
            fields: [
                { label: 'id', getValue: () => snapshot.id },
                { label: 'track', getValue: () => withDefaultNumber(snapshot.track, 0, value => String(value)) }
            ]
        }
    ];
}

function CAPTION_TABS(
    snapshot: TimelineCaptionSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>,
    options: {
        mixedFields?: ReadonlySet<CaptionStyleFieldKey>;
        targets?: readonly TimelineSelectionTarget[];
    } = {}
): InspectorTabDef[] {
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
        label,
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
        label,
        getValue: () => options.mixedFields?.has(fieldKey)
            ? '—' : captionStyleDisplayValue(rawValue, effectiveValue, fallback),
        getEditValue: () => options.mixedFields?.has(fieldKey) ? '—' : String(effectiveValue ?? fallback),
        inputKind: 'scrub-number',
        scrubStep: step,
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
    return [
        {
            label: '内容',
            fields: [
                {
                    label: 'テキスト',
                    getValue: () => snapshot.text,
                    write: async (_snapshot, nextValue) => {
                        if (!nextValue.trim()) {
                            return { ok: false, message: '字幕のテキストは空にできません。' };
                        }
                        return requestWrite({ kind: 'caption-text', id: snapshot.id, value: nextValue });
                    }
                },
                {
                    label: '話者',
                    getValue: () => orDash(snapshot.speaker, value => value),
                    getEditValue: () => snapshot.speaker ?? '',
                    write: async (_snapshot, nextValue) => requestWrite({
                        kind: 'caption-speaker',
                        id: snapshot.id,
                        value: nextValue.trim().length > 0 ? nextValue : null
                    })
                },
                { label: '編集済み', getValue: () => snapshot.edited ? 'はい' : 'いいえ' }
            ]
        },
        {
            label: 'スタイル',
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
                    label: '座布団の形',
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
                    label: '位置',
                    getValue: () => options.mixedFields?.has('zone')
                        ? '—'
                        : captionStyleDisplayValue(
                            raw?.zone,
                            effective?.zone,
                            CAPTION_STYLE_DEFAULTS.zone
                        ),
                    getEditValue: () => options.mixedFields?.has('zone')
                        ? '—' : effective?.zone ?? CAPTION_STYLE_DEFAULTS.zone,
                    inputKind: 'select',
                    options: CAPTION_ZONES,
                    write: async (_snapshot, nextValue) => {
                        if (!CAPTION_ZONES.includes(nextValue as typeof CAPTION_ZONES[number])) {
                            return { ok: false, message: '位置を9つの候補から選んでください。' };
                        }
                        return requestWrite({
                            kind: 'caption-style-zone',
                            id: snapshot.id,
                            value: nextValue as typeof CAPTION_ZONES[number],
                            ...requestOptions
                        });
                    }
                }
            ]
        },
        {
            label: 'タイミング',
            fields: [
                { label: 'start', getValue: () => formatTimestamp(snapshot.sourceStart) },
                { label: 'end', getValue: () => formatTimestamp(snapshot.sourceEnd) },
                {
                    label: '尺',
                    getValue: () => formatDurationSeconds(snapshot.sourceEnd - snapshot.sourceStart)
                },
                {
                    label: 'sourceRef.segment',
                    getValue: () => orDash(snapshot.sourceRef?.segment, value => String(value))
                }
            ]
        }
    ];
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

function MULTI_CAPTION_TABS(
    snapshots: readonly TimelineCaptionSelection[],
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorTabDef[] {
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
    const styleTab = CAPTION_TABS(aggregate, requestWrite, { mixedFields, targets })
        .find(tab => tab.label === 'スタイル')!;
    const commonDisplay = <T>(
        getValue: (snapshot: TimelineCaptionSelection) => T,
        format: (value: T) => string
    ): string => {
        const result = commonCaptionValue(snapshots, getValue);
        return result.mixed ? '—' : format(result.value);
    };
    return [
        styleTab,
        {
            label: 'タイミング',
            fields: [
                {
                    label: 'start',
                    getValue: () => commonDisplay(snapshot => snapshot.sourceStart, formatTimestamp)
                },
                {
                    label: 'end',
                    getValue: () => commonDisplay(snapshot => snapshot.sourceEnd, formatTimestamp)
                },
                {
                    label: '尺',
                    getValue: () => commonDisplay(
                        snapshot => snapshot.sourceEnd - snapshot.sourceStart,
                        formatDurationSeconds
                    )
                },
                {
                    label: 'sourceRef.segment',
                    getValue: () => commonDisplay(
                        snapshot => snapshot.sourceRef?.segment ?? null,
                        value => value === null ? '—' : String(value)
                    )
                }
            ]
        }
    ];
}

function AUDIO_TABS(
    snapshot: TimelineAudioSelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorTabDef[] {
    const basicFields: InspectorFieldDef[] = [
        { label: '種別', getValue: () => formatAudioKindLabel(snapshot.audioKind) },
        { label: 'path', getValue: () => snapshot.label },
        { label: 't', getValue: () => formatTimestamp(snapshot.outputStart) },
        {
            label: 'gain_db',
            getValue: () => withDefaultNumber(snapshot.gainDb, 0, formatDecimal1),
            getEditValue: () => String(snapshot.gainDb ?? 0),
            inputKind: 'scrub-number',
            scrubStep: 0.1,
            min: -60,
            max: 12,
            write: async (_snapshot, nextValue) => {
                if (snapshot.audioKind === 'narration') {
                    return { ok: false, message: 'narration の書き込みは未対応です。' };
                }
                const parsed = Number(nextValue);
                if (!Number.isFinite(parsed) || parsed < -60 || parsed > 12) {
                    return { ok: false, message: 'gain_db は -60〜12 の範囲で入力してください。' };
                }
                return snapshot.audioKind === 'bgm'
                    ? requestWrite({ kind: 'bgm-gain', value: parsed })
                    : requestWrite({ kind: 'sfx-gain', id: snapshot.id, value: parsed });
            }
        }
    ];
    if (snapshot.audioKind === 'narration') {
        basicFields.push({ label: 'script', getValue: () => orDash(snapshot.script, value => value) });
    }
    const tabs: InspectorTabDef[] = [{ label: '基本', fields: basicFields }];
    if (snapshot.audioKind === 'bgm') {
        tabs.push({
            label: 'フェード・ダッキング',
            fields: [
                {
                    label: 'fadeIn',
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
                    label: 'fadeOut',
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
                {
                    label: 'ducking',
                    getValue: () => withDefaultBoolean(snapshot.ducking, false),
                    getEditValue: () => String(snapshot.ducking ?? false),
                    inputKind: 'boolean-select',
                    write: async (_snapshot, nextValue) =>
                        requestWrite({ kind: 'bgm-ducking', value: nextValue === 'true' })
                }
            ]
        });
    } else if (snapshot.audioKind === 'sfx') {
        // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum (audio-clip-fades,
        // 2026-08-18): same fadeIn/fadeOut knob shape as bgm's above, minus ducking (sfx-only;
        // ducking is a bgm concept), writing sfx-fade-in/sfx-fade-out scoped to this item's id.
        tabs.push({
            label: 'フェード',
            fields: [
                {
                    label: 'fadeIn',
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
                    label: 'fadeOut',
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
                }
            ]
        });
    }
    return tabs;
}

function OVERLAY_TABS(
    snapshot: TimelineOverlaySelection,
    requestWrite: (request: InspectorWriteRequest) => Promise<InspectorWriteResult>
): InspectorTabDef[] {
    const excludedKeys = new Set(['id', 'start', 'duration', 'track', 'vars']);
    const parameterFields: InspectorFieldDef[] = Object.entries(snapshot.payload)
        .filter(([key]) => !excludedKeys.has(key))
        .map(([key, value]) => ({
            label: key,
            getValue: () => formatPayloadValue(value)
        }));

    const rawVars = snapshot.payload.vars;
    if (rawVars && typeof rawVars === 'object' && !Array.isArray(rawVars)) {
        for (const [name, value] of Object.entries(rawVars as Record<string, unknown>)) {
            const isPrimitive = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
            parameterFields.push({
                label: `vars.${name}`,
                getValue: () => formatPayloadValue(value),
                ...(isPrimitive ? {
                    write: async (_snapshot: TimelineOverlaySelection, nextValue: string) => requestWrite({
                        kind: 'overlay-var',
                        id: snapshot.id,
                        name,
                        value: nextValue
                    })
                } : {})
            });
        }
    }
    return [
        {
            label: '基本',
            fields: [
                { label: 'id', getValue: () => snapshot.id },
                { label: '種別', getValue: () => deriveOverlayType(snapshot.payload) },
                { label: 'track', getValue: () => withDefaultNumber(snapshot.track, 0, value => String(value)) },
                { label: '出力位置', getValue: () => formatTimestamp(snapshot.outputStart) },
                { label: '尺', getValue: () => formatDurationSeconds(snapshot.duration) }
            ]
        },
        { label: 'パラメータ', fields: parameterFields }
    ];
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

    protected readonly body = document.createElement('div');
    protected readonly fieldNotice = document.createElement('div');
    protected fieldNoticeTimer: number | undefined;
    protected selectedTabLabelByKind: Partial<Record<
        'cut' | 'layer' | 'caption' | 'audio' | 'overlay',
        string
    >> = {};

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
    .akari-inspector-widget .akari-inspector-row-scrub {
        color: var(--theia-textLink-foreground);
        cursor: ew-resize;
        font-variant-numeric: tabular-nums;
        user-select: none;
    }
    .akari-inspector-widget .akari-inspector-row-scrub:focus {
        outline: 1px solid var(--theia-focusBorder);
        outline-offset: 1px;
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
    .akari-inspector-widget .akari-inspector-heading {
        font-weight: 600;
        margin-bottom: 4px;
    }
    .akari-inspector-widget .akari-inspector-tabbar {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid var(--theia-panel-border);
    }
    .akari-inspector-widget .akari-inspector-tab {
        appearance: none;
        border: 0;
        border-bottom: 2px solid transparent;
        padding: 4px 8px;
        color: var(--theia-descriptionForeground);
        background: transparent;
        font: inherit;
        cursor: pointer;
    }
    .akari-inspector-widget .akari-inspector-tab:hover {
        color: var(--theia-foreground);
        background: var(--theia-toolbar-hoverBackground);
    }
    .akari-inspector-widget .akari-inspector-tab-active {
        color: var(--theia-foreground);
        border-bottom-color: var(--theia-focusBorder);
    }
    .akari-inspector-widget .akari-inspector-empty {
        color: var(--theia-descriptionForeground);
        padding: 4px 0;
    }
`;
        this.node.appendChild(style);

        this.toDispose.push(this.model.onChanged(() => this.render()));
        this.render();
    }

    protected render(): void {
        this.body.replaceChildren();
        this.hideFieldNotice();
        const snapshot = this.model.snapshot;
        if (!snapshot) {
            const empty = document.createElement('div');
            empty.className = 'akari-inspector-empty';
            empty.textContent = 'タイムラインで項目を選択してください。';
            this.body.appendChild(empty);
            return;
        }

        const requestWrite = (request: InspectorWriteRequest): Promise<InspectorWriteResult> =>
            this.commitWrite(request);

        let tabs: InspectorTabDef[];
        let rowSnapshot: InspectorSnapshot;
        let tabKind: keyof typeof this.selectedTabLabelByKind;
        if (snapshot.kind === 'multi') {
            const summary = document.createElement('div');
            summary.className = 'akari-inspector-heading';
            summary.textContent = `${snapshot.count}件選択`;
            this.body.appendChild(summary);
            const captions = snapshot.items.filter(
                (item): item is TimelineCaptionSelection => item.kind === 'caption'
            );
            if (captions.length !== snapshot.items.length || captions.length === 0) {
                return;
            }
            tabs = MULTI_CAPTION_TABS(captions, requestWrite);
            rowSnapshot = captions[0];
            tabKind = 'caption';
        } else {
            rowSnapshot = snapshot;
            tabKind = snapshot.kind;
            switch (snapshot.kind) {
                case 'cut':
                    tabs = CUT_TABS(snapshot, requestWrite);
                    break;
                case 'layer':
                    tabs = LAYER_TABS(snapshot, requestWrite);
                    break;
                case 'caption':
                    tabs = CAPTION_TABS(snapshot, requestWrite);
                    break;
                case 'audio':
                    tabs = AUDIO_TABS(snapshot, requestWrite);
                    break;
                case 'overlay':
                    tabs = OVERLAY_TABS(snapshot, requestWrite);
                    break;
            }
        }
        const selectedTabLabel = this.selectedTabLabelByKind[tabKind];
        const activeTab = tabs.find(tab => tab.label === selectedTabLabel) ?? tabs[0];
        const tabbar = document.createElement('div');
        tabbar.className = 'akari-inspector-tabbar';
        tabs.forEach((tab, tabPosition) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'akari-inspector-tab';
            button.classList.toggle('akari-inspector-tab-active', tab === activeTab);
            button.textContent = tab.label;
            // docs/contract-2026-08-11-review-session-ui-events.md #2: tab:<id> opt-in target
            // (the only literal tab-switcher UI this shell owns -- topView switches elsewhere
            // are explicitly "widget 内遷移、タブではない" per U6, see akari-role-buckets-widget.tsx).
            button.setAttribute('data-akari-ui', `tab:inspector-${tabKind}-${tabPosition}`);
            button.setAttribute('data-akari-ui-label', tab.label);
            button.addEventListener('click', () => {
                this.selectedTabLabelByKind[tabKind] = tab.label;
                this.render();
            });
            tabbar.appendChild(button);
        });
        this.body.appendChild(tabbar);

        activeTab.fields.forEach(field => this.appendRow(field, rowSnapshot));
    }

    protected async commitWrite(request: InspectorWriteRequest): Promise<InspectorWriteResult> {
        if (!this.model.requestWrite) {
            return { ok: false, message: '書き込み機能が利用できません。' };
        }
        try {
            return await this.model.requestWrite(request);
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    protected appendRow(field: InspectorFieldDef, snapshot: InspectorSnapshot): void {
        const row = document.createElement('div');
        row.className = 'akari-inspector-row';
        const labelElement = document.createElement('div');
        labelElement.className = 'akari-inspector-row-label';
        labelElement.textContent = field.label;
        row.appendChild(labelElement);

        if (!field.write) {
            const valueElement = document.createElement('div');
            valueElement.className = 'akari-inspector-row-value';
            valueElement.textContent = field.getValue(snapshot);
            row.appendChild(valueElement);
            this.body.appendChild(row);
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
                        : undefined;
                if (target) {
                    sendLive = value => this.model.requestLivePreview?.({ target, field: liveField, value });
                }
            }
            this.appendScrubNumber(row, field, editValue, commitValue, sendLive);
            this.body.appendChild(row);
            return;
        }

        if (field.inputKind === 'color') {
            this.appendColorInput(row, editValue, commitValue);
            this.body.appendChild(row);
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
        this.body.appendChild(row);
    }

    protected appendColorInput(
        row: HTMLDivElement,
        editValue: string,
        commitValue: (nextValue: string, revert: () => void) => Promise<boolean>
    ): void {
        const container = document.createElement('div');
        container.className = 'akari-inspector-color-field';
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

    protected appendScrubNumber(
        row: HTMLDivElement,
        field: InspectorFieldDef,
        editValue: string,
        commitValue: (nextValue: string, revert: () => void) => Promise<boolean>,
        sendLive?: (value: number) => void
    ): void {
        const scrub = document.createElement('div');
        scrub.className = 'akari-inspector-row-scrub';
        scrub.tabIndex = 0;
        scrub.textContent = editValue;
        scrub.setAttribute('role', 'spinbutton');
        scrub.setAttribute('aria-label', field.label);
        const step = field.scrubStep ?? 0.1;
        const startValue = Number(editValue);
        const dragThreshold = 3;

        const showDirectInput = (): void => {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'akari-inspector-row-input';
            input.value = editValue === '—' ? '' : editValue;
            let cancelled = false;
            let finished = false;
            const finish = async (): Promise<void> => {
                if (finished) {
                    return;
                }
                finished = true;
                const nextValue = input.value;
                const ok = cancelled || await commitValue(nextValue, () => {
                    input.value = editValue;
                });
                scrub.textContent = ok && !cancelled ? nextValue : editValue;
                if (input.isConnected) {
                    input.replaceWith(scrub);
                }
            };
            input.addEventListener('blur', () => {
                void finish();
            });
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    input.blur();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelled = true;
                    input.value = editValue;
                    input.blur();
                }
            });
            scrub.replaceWith(input);
            input.focus();
            input.select();
        };

        scrub.addEventListener('pointerdown', downEvent => {
            if (downEvent.button !== 0) {
                return;
            }
            if (!Number.isFinite(startValue)) {
                downEvent.preventDefault();
                showDirectInput();
                return;
            }
            downEvent.preventDefault();
            scrub.focus();
            const pointerId = downEvent.pointerId;
            const startX = downEvent.clientX;
            let dragged = false;
            let currentValue = startValue;
            let finished = false;
            let lastLiveSentAt = -Infinity;
            scrub.setPointerCapture(pointerId);

            const cleanup = (): void => {
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerCancel);
                window.removeEventListener('keydown', onKeyDown, true);
                if (scrub.hasPointerCapture(pointerId)) {
                    scrub.releasePointerCapture(pointerId);
                }
            };
            const cancel = (): void => {
                if (finished) {
                    return;
                }
                finished = true;
                cleanup();
                scrub.textContent = editValue;
                // Esc 破棄: ドラッグ中に送出したライブプレビューを元値へ戻す。
                if (dragged) {
                    sendLive?.(startValue);
                }
            };
            const onPointerMove = (event: PointerEvent): void => {
                if (event.pointerId !== pointerId || finished) {
                    return;
                }
                const deltaX = event.clientX - startX;
                if (!dragged && Math.abs(deltaX) < dragThreshold) {
                    return;
                }
                dragged = true;
                currentValue = startValue + deltaX * step;
                if (field.min !== undefined) {
                    currentValue = Math.max(field.min, currentValue);
                }
                if (field.max !== undefined) {
                    currentValue = Math.min(field.max, currentValue);
                }
                scrub.textContent = this.formatScrubNumber(currentValue, step);
                if (sendLive) {
                    const now = Date.now();
                    if (now - lastLiveSentAt >= LIVE_PREVIEW_THROTTLE_MS) {
                        lastLiveSentAt = now;
                        sendLive(currentValue);
                    }
                }
                event.preventDefault();
            };
            const onPointerUp = (event: PointerEvent): void => {
                if (event.pointerId !== pointerId || finished) {
                    return;
                }
                finished = true;
                cleanup();
                if (!dragged) {
                    showDirectInput();
                    return;
                }
                const nextValue = this.formatScrubNumber(currentValue, step);
                if (currentValue !== startValue) {
                    void commitValue(nextValue, () => {
                        scrub.textContent = editValue;
                        // 書き込み失敗（稀・スクラブは既に min/max でクランプ済み）: ライブプレビューも巻き戻す。
                        sendLive?.(startValue);
                    });
                }
            };
            const onPointerCancel = (event: PointerEvent): void => {
                if (event.pointerId === pointerId) {
                    cancel();
                }
            };
            const onKeyDown = (event: KeyboardEvent): void => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cancel();
                }
            };
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerCancel);
            window.addEventListener('keydown', onKeyDown, true);
        });

        row.appendChild(scrub);
    }

    protected formatScrubNumber(value: number, step: number): string {
        const fraction = String(step).split('.')[1];
        const precision = Math.min(fraction?.length ?? 0, 6);
        return String(Number(value.toFixed(precision)));
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
