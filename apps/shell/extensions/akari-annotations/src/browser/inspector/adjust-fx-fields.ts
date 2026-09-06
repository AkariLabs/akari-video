export type InspectorAdjustFxId = 'vignette' | 'blur' | 'grain' | 'sharpen';
export type InspectorAdjustFx =
    | { id: 'vignette'; amount?: number; midpoint?: number; roundness?: number; feather?: number }
    | { id: 'blur'; px?: number }
    | { id: 'grain'; amount?: number; size?: number }
    | { id: 'sharpen'; amount?: number };

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
    { id: 'vignette', label: 'ビネット', params: [
        { key: 'amount', label: '量', min: -1, max: 1, default: 0.5, step: 0.05, unit: '%', displayScale: 100 },
        { key: 'midpoint', label: '中間点', min: 0, max: 1, default: 0.5, step: 0.01, unit: '%', displayScale: 100 },
        { key: 'roundness', label: '丸み', min: -1, max: 1, default: 0, step: 0.01, unit: '%', displayScale: 100 },
        { key: 'feather', label: '境界ぼかし', min: 0, max: 1, default: 0.5, step: 0.01, unit: '%', displayScale: 100 }
    ] },
    { id: 'blur', label: 'ぼかし', params: [
        { key: 'px', label: '半径', min: 0, max: 50, default: 8, step: 1, unit: 'px', displayScale: 1 }
    ] },
    { id: 'grain', label: 'フィルムグレイン', params: [
        { key: 'amount', label: '量', min: 0, max: 1, default: 0.3, step: 0.01, unit: '%', displayScale: 100 },
        { key: 'size', label: 'サイズ', min: 0.5, max: 4, default: 1, step: 0.1, unit: '倍', displayScale: 1 }
    ] },
    { id: 'sharpen', label: 'シャープ', params: [
        { key: 'amount', label: '量', min: 0, max: 1, default: 0.5, step: 0.01, unit: '%', displayScale: 100 }
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
    if (list.length >= INSPECTOR_ADJUST_FX_MAX_ITEMS) throw new Error('効果は 8 個までです。');
    const definition = INSPECTOR_ADJUST_FX.find(effect => effect.id === id);
    if (!definition) throw new Error('一覧から効果を選択してください。');
    const next = normalizeInspectorAdjustFx(list);
    if (next.some(effect => effect.id === id)) throw new Error('同じ効果は 1 つまでです');
    return [...next, { id: definition.id }];
}

function assertIndex(list: readonly InspectorAdjustFx[], index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new Error('効果を選択してください。');
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
    if (!param) throw new Error('この効果に未対応のパラメータです。');
    if (value !== null && !validParam(value, param)) {
        throw new Error(`${param.label}は ${param.min * param.displayScale}〜${param.max * param.displayScale} ${param.unit} の範囲で入力してください。`);
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
    if (delta !== -1 && delta !== 1) throw new Error('効果は上か下へ移動してください。');
    const destination = index + delta;
    if (destination >= 0 && destination < next.length) {
        [next[index], next[destination]] = [next[destination], next[index]];
    }
    return next;
}

export function isInspectorAdjustFxIdentity(list: readonly InspectorAdjustFx[]): boolean {
    return list.length === 0;
}
