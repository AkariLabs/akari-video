import { t } from '@akari-video/i18n';
export type InspectorAdjustFxId = 'vignette' | 'blur' | 'grain' | 'sharpen' | 'glow' | 'clarity' | 'dehaze' | 'denoise' | 'motion_blur';
export type InspectorAdjustFx =
    | { id: 'vignette'; amount?: number; midpoint?: number; roundness?: number; feather?: number }
    | { id: 'blur'; px?: number }
    | { id: 'grain'; amount?: number; size?: number }
    | { id: 'sharpen'; amount?: number }
    | { id: 'glow'; intensity?: number; radius?: number; threshold?: number; warmth?: number }
    | { id: 'clarity'; amount?: number; radius?: number }
    | { id: 'dehaze'; amount?: number }
    | { id: 'denoise'; amount?: number }
    | { id: 'motion_blur'; px?: number; angle?: number };

export interface InspectorAdjustFxParam {
    key: string;
    label: string;
    min: number;
    max: number;
    default: number;
    step: number;
    unit: string;
    displayScale: number;
}

export const INSPECTOR_ADJUST_FX_MAX_ITEMS = 8;
export const INSPECTOR_ADJUST_FX: readonly {
    id: InspectorAdjustFxId; label: string; params: readonly InspectorAdjustFxParam[];
}[] = [
    { id: 'vignette', label: t('inspector.adjustFxFields.label.vignette'), params: [
        { key: 'amount', label: t('inspector.adjustFxFields.label.amount'), min: -1, max: 1, default: 0.5, step: 0.05, unit: '%', displayScale: 100 },
        { key: 'midpoint', label: t('inspector.adjustFxFields.label.middlePoint'), min: 0, max: 1, default: 0.5, step: 0.01, unit: '%', displayScale: 100 },
        { key: 'roundness', label: t('inspector.adjustFxFields.label.roundness'), min: -1, max: 1, default: 0, step: 0.01, unit: '%', displayScale: 100 },
        { key: 'feather', label: t('inspector.adjustFxFields.label.feather'), min: 0, max: 1, default: 0.5, step: 0.01, unit: '%', displayScale: 100 }
    ] },
    { id: 'blur', label: t('inspector.adjustFxFields.label.blur'), params: [
        { key: 'px', label: t('inspector.adjustFxFields.label.radius'), min: 0, max: 50, default: 8, step: 1, unit: 'px', displayScale: 1 }
    ] },
    { id: 'grain', label: t('inspector.adjustFxFields.label.filmGrain'), params: [
        { key: 'amount', label: t('inspector.adjustFxFields.label.amount'), min: 0, max: 1, default: 0.3, step: 0.01, unit: '%', displayScale: 100 },
        { key: 'size', label: t('inspector.adjustFxFields.label.size'), min: 0.5, max: 4, default: 1, step: 0.1, unit: t('inspector.adjustFxFields.unit.double'), displayScale: 1 }
    ] },
    { id: 'sharpen', label: t('inspector.adjustFxFields.label.sharp'), params: [
        { key: 'amount', label: t('inspector.adjustFxFields.label.amount'), min: 0, max: 1, default: 0.5, step: 0.01, unit: '%', displayScale: 100 }
    ] },
    { id: 'glow', label: t('inspector.adjustFxFields.label.glow'), params: [
        { key: 'intensity', label: t('inspector.adjustFxFields.label.strength'), min: 0, max: 1, default: 0.5, step: 0.01, unit: '%', displayScale: 100 },
        { key: 'radius', label: t('inspector.adjustFxFields.label.radius'), min: 0, max: 100, default: 20, step: 1, unit: 'px', displayScale: 1 },
        { key: 'threshold', label: t('inspector.adjustFxFields.label.threshold'), min: 0, max: 1, default: 0.7, step: 0.01, unit: '%', displayScale: 100 },
        { key: 'warmth', label: t('inspector.adjustFxFields.label.color'), min: -1, max: 1, default: 0, step: 0.01, unit: '%', displayScale: 100 }
    ] },
    { id: 'clarity', label: t('inspector.adjustFxFields.label.clarity'), params: [
        { key: 'amount', label: t('inspector.adjustFxFields.label.amount'), min: -1, max: 1, default: 0.3, step: 0.01, unit: '%', displayScale: 100 },
        { key: 'radius', label: t('inspector.adjustFxFields.label.radius'), min: 1, max: 50, default: 10, step: 1, unit: 'px', displayScale: 1 }
    ] },
    { id: 'dehaze', label: t('inspector.adjustFxFields.label.removal'), params: [
        { key: 'amount', label: t('inspector.adjustFxFields.label.amount'), min: -1, max: 1, default: 0.3, step: 0.01, unit: '%', displayScale: 100 }
    ] },
    { id: 'denoise', label: t('inspector.adjustFxFields.label.noiseRemoval'), params: [
        { key: 'amount', label: t('inspector.adjustFxFields.label.amount'), min: 0, max: 1, default: 0.3, step: 0.01, unit: '%', displayScale: 100 }
    ] },
    { id: 'motion_blur', label: t('inspector.adjustFxFields.label.motionBra'), params: [
        { key: 'px', label: t('inspector.adjustFxFields.label.length'), min: 0, max: 100, default: 10, step: 1, unit: 'px', displayScale: 1 },
        { key: 'angle', label: t('inspector.adjustFxFields.label.angle'), min: -180, max: 180, default: 0, step: 1, unit: '°', displayScale: 1 }
    ] }
];

function validParam(value: unknown, param: InspectorAdjustFxParam): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= param.min && value <= param.max;
}

/** 不正な要素と重複を捨て、既定値を省略した新しい配列を返す。 */
export function normalizeInspectorAdjustFx(raw: unknown): InspectorAdjustFx[] {
    if (!Array.isArray(raw)) return [];
    const result: InspectorAdjustFx[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const definition = INSPECTOR_ADJUST_FX.find(effect => effect.id === entry.id);
        if (!definition || result.some(effect => effect.id === entry.id)) continue;
        if (Object.keys(entry).some(key => key !== 'id' && !definition.params.some(param => param.key === key))
            || definition.params.some(param => Object.prototype.hasOwnProperty.call(entry, param.key) && !validParam(entry[param.key], param))) continue;
        const normalized: Record<string, unknown> = { id: definition.id };
        for (const param of definition.params) {
            if (Object.prototype.hasOwnProperty.call(entry, param.key) && entry[param.key] !== param.default) normalized[param.key] = entry[param.key];
        }
        result.push(normalized as InspectorAdjustFx);
        if (result.length === INSPECTOR_ADJUST_FX_MAX_ITEMS) break;
    }
    return result;
}

export function addInspectorAdjustFx(list: readonly InspectorAdjustFx[], id: string): InspectorAdjustFx[] {
    if (list.length >= INSPECTOR_ADJUST_FX_MAX_ITEMS) throw new Error(t('inspector.adjustFxFields.error.up8Effects'));
    const definition = INSPECTOR_ADJUST_FX.find(effect => effect.id === id);
    if (!definition) throw new Error(t('inspector.adjustFxFields.error.selectEffectFromList'));
    const next = normalizeInspectorAdjustFx(list);
    if (next.some(effect => effect.id === id)) throw new Error(t('inspector.adjustFxFields.error.sameEffectUpOne'));
    return [...next, { id: definition.id }];
}

function assertIndex(list: readonly InspectorAdjustFx[], index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new Error(t('inspector.adjustFxFields.error.selectEffect'));
}

export function removeInspectorAdjustFx(list: readonly InspectorAdjustFx[], index: number): InspectorAdjustFx[] {
    const next = normalizeInspectorAdjustFx(list);
    assertIndex(next, index);
    next.splice(index, 1);
    return next;
}

export function updateInspectorAdjustFxParam(
    list: readonly InspectorAdjustFx[], index: number, key: string, value: number | null
): InspectorAdjustFx[] {
    const next = normalizeInspectorAdjustFx(list);
    assertIndex(next, index);
    const entry = next[index];
    const param = INSPECTOR_ADJUST_FX.find(effect => effect.id === entry.id)!.params.find(candidate => candidate.key === key);
    if (!param) throw new Error(t('inspector.adjustFxFields.error.parameterNotSupported'));
    if (value !== null && !validParam(value, param)) {
        throw new Error(t('inspector.adjustFxFields.error.shouldBeEnteredRange', { label: param.label, minimum: param.min * param.displayScale, maximum: param.max * param.displayScale, unit: param.unit }));
    }
    const updated = { ...entry } as Record<string, unknown>;
    if (value === null || value === param.default) delete updated[key];
    else updated[key] = value;
    next[index] = updated as InspectorAdjustFx;
    return next;
}

export function moveInspectorAdjustFx(list: readonly InspectorAdjustFx[], index: number, delta: number): InspectorAdjustFx[] {
    const next = normalizeInspectorAdjustFx(list);
    assertIndex(next, index);
    if (delta !== -1 && delta !== 1) throw new Error(t('inspector.adjustFxFields.error.specifyEffectAboveBelow'));
    const destination = index + delta;
    if (destination >= 0 && destination < next.length) {
        [next[index], next[destination]] = [next[destination], next[index]];
    }
    return next;
}

export function isInspectorAdjustFxIdentity(list: readonly InspectorAdjustFx[]): boolean {
    return list.length === 0;
}
