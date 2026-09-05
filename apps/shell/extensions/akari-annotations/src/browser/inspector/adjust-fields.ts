export type InspectorAdjustBasicKey =
    | 'exposure'
    | 'contrast'
    | 'highlights'
    | 'shadows'
    | 'blacks'
    | 'whites'
    | 'temperature'
    | 'tint'
    | 'vibrance'
    | 'saturation';

export type InspectorAdjustSectionKey = 'basic' | 'lut';

export type InspectorAdjustPath =
    | `adjust.basic.${InspectorAdjustBasicKey}`
    | 'adjust.lut.lut'
    | 'adjust.lut.intensity'
    | `adjust.sections.${InspectorAdjustSectionKey}`;

export type InspectorAdjustValue = number | string | boolean | null;

export interface InspectorAdjustBasicField {
    key: InspectorAdjustBasicKey;
    label: string;
    minimum: number;
    maximum: number;
    scrubStep: number;
    unit?: string;
    displayScale?: number;
    displayOffset?: number;
    displayPrecision?: number;
}

export interface InspectorAdjustSnapshot {
    basic: Record<InspectorAdjustBasicKey, number>;
    lut?: { lut: string; intensity: number };
    sections: Record<InspectorAdjustSectionKey, boolean>;
}

export const INSPECTOR_ADJUST_BASIC_FIELDS: readonly InspectorAdjustBasicField[] = [
    {
        key: 'exposure', label: '露出', minimum: -3, maximum: 3,
        scrubStep: 0.01, unit: 'EV', displayPrecision: 2
    },
    { key: 'contrast', label: 'コントラスト', minimum: -1, maximum: 1, scrubStep: 0.01, displayScale: 100 },
    { key: 'highlights', label: 'ハイライト', minimum: -1, maximum: 1, scrubStep: 0.01, displayScale: 100 },
    { key: 'shadows', label: 'シャドウ', minimum: -1, maximum: 1, scrubStep: 0.01, displayScale: 100 },
    { key: 'blacks', label: '黒レベル', minimum: -1, maximum: 1, scrubStep: 0.01, displayScale: 100 },
    { key: 'whites', label: '白レベル', minimum: -1, maximum: 1, scrubStep: 0.01, displayScale: 100 },
    {
        key: 'temperature', label: '色温度', minimum: -1, maximum: 1,
        scrubStep: 0.01, unit: 'K', displayScale: 3500, displayOffset: 6500,
        displayPrecision: 0
    },
    { key: 'tint', label: 'ティント', minimum: -1, maximum: 1, scrubStep: 0.01, displayScale: 100 },
    { key: 'vibrance', label: 'バイブランス', minimum: -1, maximum: 1, scrubStep: 0.01, displayScale: 100 },
    { key: 'saturation', label: '彩度', minimum: -1, maximum: 1, scrubStep: 0.01, displayScale: 100 }
];

export const INSPECTOR_LUT_PRESET_IDS = [
    'natural',
    'cinematic',
    'film-warm',
    'mono',
    'silver-retain',
    'vintage-fade',
    'cool-clear',
    'night-neon',
    'forest-soft',
    'sunset-gold'
] as const;

const BASIC_FIELD_BY_KEY = new Map(
    INSPECTOR_ADJUST_BASIC_FIELDS.map(field => [field.key, field] as const)
);

const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};

const finiteNumber = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function inspectorAdjustDisplayValue(
    key: InspectorAdjustBasicKey,
    value: number
): number {
    const field = BASIC_FIELD_BY_KEY.get(key)!;
    return value * (field.displayScale ?? 1) + (field.displayOffset ?? 0);
}

export function inspectorAdjustInternalValue(
    key: InspectorAdjustBasicKey,
    displayValue: number
): number {
    const field = BASIC_FIELD_BY_KEY.get(key)!;
    return (displayValue - (field.displayOffset ?? 0)) / (field.displayScale ?? 1);
}

export function formatInspectorAdjustValue(
    key: InspectorAdjustBasicKey,
    value: number
): string {
    const field = BASIC_FIELD_BY_KEY.get(key)!;
    const display = inspectorAdjustDisplayValue(key, value);
    const formatted = field.displayPrecision === undefined
        ? String(Math.round(display))
        : display.toFixed(field.displayPrecision);
    return field.unit ? `${formatted} ${field.unit}` : formatted;
}

export function readInspectorAdjustSnapshot(value: unknown): InspectorAdjustSnapshot {
    const adjust = record(value);
    const basic = record(adjust.basic);
    const lut = record(adjust.lut);
    const sections = record(adjust.sections);
    const basicValues = Object.fromEntries(INSPECTOR_ADJUST_BASIC_FIELDS.map(field => [
        field.key,
        finiteNumber(basic[field.key], 0)
    ])) as unknown as Record<InspectorAdjustBasicKey, number>;
    const lutId = typeof lut.lut === 'string' && lut.lut.length > 0 ? lut.lut : undefined;
    return {
        basic: basicValues,
        ...(lutId ? {
            lut: { lut: lutId, intensity: finiteNumber(lut.intensity, 1) }
        } : {}),
        sections: {
            basic: sections.basic !== false,
            lut: sections.lut !== false
        }
    };
}

export function createInspectorAdjustWriteRequest(
    id: string,
    path: InspectorAdjustPath,
    value: InspectorAdjustValue
): { kind: 'item-field'; id: string; path: InspectorAdjustPath; value: InspectorAdjustValue } {
    return { kind: 'item-field', id, path, value };
}

function assertBasicValue(key: InspectorAdjustBasicKey, value: unknown): asserts value is number {
    const field = BASIC_FIELD_BY_KEY.get(key)!;
    if (typeof value !== 'number' || !Number.isFinite(value)
        || value < field.minimum || value > field.maximum) {
        throw new Error(`${field.label}は ${field.minimum}〜${field.maximum} の範囲で入力してください。`);
    }
}

function hasOwnKeys(value: Record<string, unknown>): boolean {
    return Object.keys(value).length > 0;
}

/** sections だけでは映像へ効果が無いため、既知の効果値が無い正規形は field 省略にする。 */
export function isInspectorAdjustIdentity(value: unknown): boolean {
    const adjust = record(value);
    if (Object.keys(adjust).some(key => key !== 'basic' && key !== 'lut' && key !== 'sections')) {
        return false;
    }
    const basic = record(adjust.basic);
    for (const [key, raw] of Object.entries(basic)) {
        if (!BASIC_FIELD_BY_KEY.has(key as InspectorAdjustBasicKey) || finiteNumber(raw, 0) !== 0) {
            return false;
        }
    }
    const lut = record(adjust.lut);
    if (typeof lut.lut === 'string' && lut.lut.length > 0) return false;
    if (Object.keys(lut).some(key => key !== 'lut' && key !== 'intensity')) return false;
    const sections = record(adjust.sections);
    if (Object.keys(sections).some(key => key !== 'basic' && key !== 'lut')) return false;
    return true;
}

/** adjust の指定 path だけを更新し、未知キーを保持しながら identity を null へ正規化する。 */
export function updateInspectorAdjust(
    current: unknown,
    path: InspectorAdjustPath,
    value: InspectorAdjustValue
): Record<string, unknown> | null {
    const next = { ...record(current) };
    if (path.startsWith('adjust.basic.')) {
        const key = path.slice('adjust.basic.'.length) as InspectorAdjustBasicKey;
        if (!BASIC_FIELD_BY_KEY.has(key)) throw new Error(`未対応の基本補正です: ${key}`);
        const basic = { ...record(next.basic) };
        if (value === null || value === 0) {
            delete basic[key];
        } else {
            assertBasicValue(key, value);
            basic[key] = value;
        }
        if (hasOwnKeys(basic)) next.basic = basic;
        else delete next.basic;
    } else if (path === 'adjust.lut.lut') {
        if (value === null || value === '') {
            delete next.lut;
        } else {
            if (typeof value !== 'string') throw new Error('LUT はプリセット id で指定してください。');
            next.lut = { ...record(next.lut), lut: value };
        }
    } else if (path === 'adjust.lut.intensity') {
        const lut = { ...record(next.lut) };
        if (typeof lut.lut !== 'string' || lut.lut.length === 0) {
            throw new Error('LUT を選択してから強度を変更してください。');
        }
        if (value === null || value === 1) {
            delete lut.intensity;
        } else {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
                throw new Error('LUT 強度は 0〜100% の範囲で入力してください。');
            }
            lut.intensity = value;
        }
        next.lut = lut;
    } else {
        const key = path.slice('adjust.sections.'.length) as InspectorAdjustSectionKey;
        if (key !== 'basic' && key !== 'lut') throw new Error(`未対応の調整セクションです: ${key}`);
        const sections = { ...record(next.sections) };
        if (value === null || value === true) delete sections[key];
        else if (value === false) sections[key] = false;
        else throw new Error('調整セクションは boolean で指定してください。');
        if (hasOwnKeys(sections)) next.sections = sections;
        else delete next.sections;
    }
    return isInspectorAdjustIdentity(next) ? null : next;
}
