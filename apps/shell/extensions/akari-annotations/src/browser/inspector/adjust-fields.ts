import {
    AdjustCurvePointV1, AdjustHuePointV1, AdjustWheelKey,
    IDENTITY_CURVE_POINTS, DEFAULT_HUE_POINTS, INSPECTOR_CURVE_CHANNELS,
    INSPECTOR_HUE_CHANNELS, INSPECTOR_ADJUST_WHEELS, sortCurvePoints, sortHuePoints,
    clampCurvePoint, clampHuePoint, isCurveChannelIdentity, isHueChannelIdentity, wheelRange
} from './adjust-editor-model';

export type InspectorCurveChannel = typeof INSPECTOR_CURVE_CHANNELS[number]['key'];
export type InspectorHueChannel = typeof INSPECTOR_HUE_CHANNELS[number]['key'];
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

export type InspectorAdjustSectionKey = 'basic' | 'lut' | 'curves' | 'wheels' | 'hue';

export type InspectorAdjustPath =
    | 'adjust'
    | `adjust.basic.${InspectorAdjustBasicKey}`
    | 'adjust.lut.lut'
    | 'adjust.lut.intensity'
    | `adjust.curves.${InspectorCurveChannel}`
    | `adjust.hue.${InspectorHueChannel}`
    | `adjust.wheels.${AdjustWheelKey}`
    | `adjust.wheels.${AdjustWheelKey}.${'r' | 'g' | 'b'}`
    | `adjust.sections.${InspectorAdjustSectionKey}`;

export type InspectorAdjustValue = number | string | boolean | null
    | { basic?: Record<string, number>; wheels?: Record<string, { r?: number; g?: number; b?: number }> }
    | AdjustCurvePointV1[] | AdjustHuePointV1[] | { r?: number; g?: number; b?: number };

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
    curves: Record<InspectorCurveChannel, AdjustCurvePointV1[]>;
    wheels: Record<AdjustWheelKey, { r: number; g: number; b: number }>;
    hue: Record<InspectorHueChannel, AdjustHuePointV1[]>;
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
        curves: Object.fromEntries(INSPECTOR_CURVE_CHANNELS.map(({ key }) => [key,
            sortCurvePoints((record(adjust.curves)[key] as AdjustCurvePointV1[] | undefined) ?? IDENTITY_CURVE_POINTS)
        ])) as InspectorAdjustSnapshot['curves'],
        hue: Object.fromEntries(INSPECTOR_HUE_CHANNELS.map(({ key }) => [key,
            sortHuePoints((record(adjust.hue)[key] as AdjustHuePointV1[] | undefined) ?? DEFAULT_HUE_POINTS)
        ])) as InspectorAdjustSnapshot['hue'],
        wheels: Object.fromEntries(INSPECTOR_ADJUST_WHEELS.map(({ key }) => {
            const wheel = record(record(adjust.wheels)[key]);
            return [key, { r: finiteNumber(wheel.r, 0), g: finiteNumber(wheel.g, 0), b: finiteNumber(wheel.b, 0) }];
        })) as InspectorAdjustSnapshot['wheels'],
        ...(lutId ? {
            lut: { lut: lutId, intensity: finiteNumber(lut.intensity, 1) }
        } : {}),
        sections: {
            basic: sections.basic !== false,
            lut: sections.lut !== false,
            curves: sections.curves !== false,
            wheels: sections.wheels !== false,
            hue: sections.hue !== false
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
    if (Object.keys(adjust).some(key => !['basic', 'lut', 'sections', 'curves', 'wheels', 'hue'].includes(key))) {
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
    if (Object.keys(sections).some(key => !['basic', 'lut', 'curves', 'wheels', 'hue'].includes(key))) return false;
    for (const [key, points] of Object.entries(record(adjust.curves))) {
        if (!INSPECTOR_CURVE_CHANNELS.some(ch => ch.key === key) || !validPointKeys(points, 'in', 'out')
            || !isCurveChannelIdentity(points)) return false;
    }
    for (const [key, points] of Object.entries(record(adjust.hue))) {
        if (!INSPECTOR_HUE_CHANNELS.some(ch => ch.key === key) || !validPointKeys(points, 'hue', 'value')
            || !isHueChannelIdentity(points)) return false;
    }
    for (const [key, wheel] of Object.entries(record(adjust.wheels))) {
        if (!INSPECTOR_ADJUST_WHEELS.some(w => w.key === key)) return false;
        if (Object.entries(record(wheel)).some(([ch, v]) => !['r', 'g', 'b'].includes(ch) || v !== 0)) return false;
    }
    return true;
}

function validPointKeys<X extends string, Y extends string>(value: unknown, x: X, y: Y): value is Record<X | Y, number>[] {
    return Array.isArray(value) && value.every(p => {
        const v = record(p);
        return Object.keys(v).length === 2 && typeof v[x] === 'number' && Number.isFinite(v[x])
            && typeof v[y] === 'number' && Number.isFinite(v[y]);
    });
}

function updatePointChannel(next: Record<string, unknown>, section: 'curves' | 'hue', key: string, value: InspectorAdjustValue): void {
    const channels = section === 'curves' ? INSPECTOR_CURVE_CHANNELS : INSPECTOR_HUE_CHANNELS;
    if (!channels.some(ch => ch.key === key)) throw new Error(`未対応のカーブです: ${key}`);
    const values = { ...record(next[section]) };
    if (value === null) delete values[key];
    else {
        const x = section === 'curves' ? 'in' : 'hue';
        const y = section === 'curves' ? 'out' : 'value';
        if (!validPointKeys(value, x, y) || value.length < (section === 'curves' ? 2 : 1) || value.length > 16) {
            throw new Error('カーブの点数・キー・数値が不正です。');
        }
        const points = section === 'curves'
            ? sortCurvePoints((value as unknown as AdjustCurvePointV1[]).map(clampCurvePoint))
            : sortHuePoints((value as unknown as AdjustHuePointV1[]).map(clampHuePoint));
        const axes = points.map(p => 'in' in p ? p.in : p.hue);
        if (axes.some((v, i) => i > 0 && v <= axes[i - 1])) throw new Error('カーブの横軸は狭義単調増加にしてください。');
        const identity = section === 'curves'
            ? isCurveChannelIdentity(points as AdjustCurvePointV1[])
            : isHueChannelIdentity(points as AdjustHuePointV1[]);
        if (identity) delete values[key];
        else values[key] = points;
    }
    if (hasOwnKeys(values)) next[section] = values;
    else delete next[section];
}

function updateWheel(next: Record<string, unknown>, key: string, channel: string | undefined, value: InspectorAdjustValue): void {
    if (!INSPECTOR_ADJUST_WHEELS.some(w => w.key === key)) throw new Error(`未対応のホイールです: ${key}`);
    const wheels = { ...record(next.wheels) };
    const wheel = { ...record(wheels[key]) };
    if (!channel && value === null) delete wheels[key];
    else {
        if (!channel && (value === null || typeof value !== 'object' || Array.isArray(value))) {
            throw new Error('ホイールは RGB オブジェクトで指定してください。');
        }
        const updates = channel ? { [channel]: value } : record(value);
        const range = wheelRange(key as AdjustWheelKey);
        for (const [ch, v] of Object.entries(updates)) {
            if (!['r', 'g', 'b'].includes(ch)) throw new Error(`未対応のホイールチャンネルです: ${ch}`);
            if (v === null || v === 0) delete wheel[ch];
            else {
                if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > range) {
                    throw new Error(`ホイールは ${-range}〜${range} の範囲で入力してください。`);
                }
                wheel[ch] = v;
            }
        }
        for (const ch of ['r', 'g', 'b']) if (wheel[ch] === 0) delete wheel[ch];
        if (hasOwnKeys(wheel)) wheels[key] = wheel;
        else delete wheels[key];
    }
    if (hasOwnKeys(wheels)) next.wheels = wheels;
    else delete next.wheels;
}

/** adjust の指定 path だけを更新し、未知キーを保持しながら identity を null へ正規化する。 */
export function updateInspectorAdjust(
    current: unknown,
    path: InspectorAdjustPath,
    value: InspectorAdjustValue
): Record<string, unknown> | null {
    const next = { ...record(current) };
    if (path === 'adjust') {
        const assertObject = (v: unknown): void => {
            if (v === null || typeof v !== 'object' || Array.isArray(v)) {
                throw new Error('ルックは基本補正とホイールのオブジェクトで指定してください。');
            }
        };
        if (value !== null) assertObject(value);
        const replacement = record(value);
        if (Object.keys(replacement).some(key => !['basic', 'wheels'].includes(key))) {
            throw new Error('ルックに未対応のキーがあります。');
        }
        delete next.basic;
        delete next.wheels;
        if (replacement.basic !== undefined) {
            assertObject(replacement.basic);
            const basic: Record<string, number> = {};
            for (const [key, v] of Object.entries(record(replacement.basic))) {
                if (!BASIC_FIELD_BY_KEY.has(key as InspectorAdjustBasicKey)) throw new Error(`未対応の基本補正です: ${key}`);
                assertBasicValue(key as InspectorAdjustBasicKey, v);
                if (v !== 0) basic[key] = v;
            }
            if (hasOwnKeys(basic)) next.basic = basic;
        }
        if (replacement.wheels !== undefined) {
            assertObject(replacement.wheels);
            for (const [key, wheel] of Object.entries(record(replacement.wheels))) {
                assertObject(wheel);
                if (Object.values(record(wheel)).some(v => typeof v !== 'number' || !Number.isFinite(v))) {
                    throw new Error('ホイールの RGB は有限数で指定してください。');
                }
                updateWheel(next, key, undefined, wheel as InspectorAdjustValue);
            }
        }
    } else if (path.startsWith('adjust.curves.') || path.startsWith('adjust.hue.')) {
        const [, section, key] = path.split('.');
        updatePointChannel(next, section as 'curves' | 'hue', key, value);
    } else if (path.startsWith('adjust.wheels.')) {
        const [, , key, channel] = path.split('.');
        updateWheel(next, key, channel, value);
    } else if (path.startsWith('adjust.basic.')) {
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
        if (!['basic', 'lut', 'curves', 'wheels', 'hue'].includes(key)) throw new Error(`未対応の調整セクションです: ${key}`);
        const sections = { ...record(next.sections) };
        if (value === null || value === true) delete sections[key];
        else if (value === false) sections[key] = false;
        else throw new Error('調整セクションは boolean で指定してください。');
        if (hasOwnKeys(sections)) next.sections = sections;
        else delete next.sections;
    }
    return isInspectorAdjustIdentity(next) ? null : next;
}
