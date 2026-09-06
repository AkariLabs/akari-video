import { MOTION_EASES } from './motion-fields';

export const INSPECTOR_ANIMATOR_BASES = [
    { id: 'chars', label: '文字' }, { id: 'words', label: '単語' }, { id: 'lines', label: '行' },
    { id: 'segments', label: '文節', title: 'v1 では words と同じ扱いです' }
] as const;
export const INSPECTOR_ANIMATOR_SHAPES = [
    { id: 'ramp', label: '上り' }, { id: 'ramp-down', label: '下り' },
    { id: 'triangle', label: '三角' }, { id: 'round', label: '丸' },
    { id: 'smooth', label: 'なめらか' }, { id: 'square', label: '矩形' }
] as const;
export const INSPECTOR_ANIMATOR_MAX_ITEMS = 8;
export type InspectorAnimatorBasis = typeof INSPECTOR_ANIMATOR_BASES[number]['id'];
export type InspectorAnimatorShape = typeof INSPECTOR_ANIMATOR_SHAPES[number]['id'];
export type InspectorAnimatorAmountKey = 'x' | 'y' | 'scale' | 'rotate' | 'opacity' | 'letterSpacing' | 'blur';
export type InspectorAnimatorNumberKey = 'start' | 'end' | 'offset' | `amount.${InspectorAnimatorAmountKey}` | 'randomize.seed';
export type InspectorAnimatorKey = InspectorAnimatorNumberKey | 'basis' | 'shape' | 'ease';
export interface InspectorAnimator {
    id: string;
    basis: InspectorAnimatorBasis;
    shape: InspectorAnimatorShape;
    start: number;
    end: number;
    offset: number;
    amount: Partial<Record<InspectorAnimatorAmountKey, number>>;
    ease?: typeof MOTION_EASES[number];
    randomize?: { seed: number };
}
export interface InspectorAnimatorNumberField {
    key: InspectorAnimatorNumberKey;
    label: string;
    min?: number;
    max?: number;
    default: number | null;
    step: number;
    unit: string;
    displayScale: number;
    integer?: boolean;
    title?: string;
}
export const INSPECTOR_ANIMATOR_NUMBER_FIELDS: readonly InspectorAnimatorNumberField[] = [
    { key: 'start', label: '範囲 始', min: 0, max: 1, default: 0, step: 0.01, unit: '%', displayScale: 100 },
    { key: 'end', label: '範囲 終', min: 0, max: 1, default: 0.3, step: 0.01, unit: '%', displayScale: 100 },
    { key: 'offset', label: 'オフセット', min: -1, max: 1, default: 0, step: 0.01, unit: '%', displayScale: 100 },
    { key: 'amount.x', label: '量 X', default: 0, step: 1, unit: 'px', displayScale: 1 },
    { key: 'amount.y', label: '量 Y', default: 0, step: 1, unit: 'px', displayScale: 1 },
    { key: 'amount.scale', label: '量 拡縮', default: 0, step: 0.01, unit: '%', displayScale: 100 },
    { key: 'amount.rotate', label: '量 回転', default: 0, step: 1, unit: '°', displayScale: 1 },
    { key: 'amount.opacity', label: '量 不透明度', min: -1, max: 1, default: 0, step: 0.01, unit: '%', displayScale: 100 },
    { key: 'amount.letterSpacing', label: '量 字間', default: 0, step: 1, unit: 'px', displayScale: 1, title: 'gpu 出口では v1 未対応' },
    { key: 'amount.blur', label: '量 ぼかし', default: 0, step: 1, unit: 'px', displayScale: 1, title: 'gpu 出口では v1 未対応' },
    { key: 'randomize.seed', label: 'ランダム seed', default: null, step: 1, unit: '', displayScale: 1, integer: true }
];

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validNumber(value: unknown, field: InspectorAnimatorNumberField): value is number {
    return typeof value === 'number' && Number.isFinite(value)
        && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max)
        && (!field.integer || Number.isInteger(value));
}

/** 必須の 7 キーは残し、不正要素・重複 id と任意の既定値を捨てて深くコピーする。 */
export function normalizeInspectorAnimators(raw: unknown): InspectorAnimator[] {
    if (!Array.isArray(raw)) return [];
    const result: InspectorAnimator[] = [];
    for (const entry of raw) {
        if (!record(entry) || typeof entry.id !== 'string' || !entry.id.trim()
            || result.some(animator => animator.id === entry.id)
            || Object.keys(entry).some(key => !['id', 'basis', 'shape', 'start', 'end', 'offset', 'amount', 'ease', 'randomize'].includes(key))) continue;
        const basis = INSPECTOR_ANIMATOR_BASES.find(candidate => candidate.id === entry.basis);
        const shape = INSPECTOR_ANIMATOR_SHAPES.find(candidate => candidate.id === entry.shape);
        if (!basis || !shape || !record(entry.amount)) continue;
        const amount = entry.amount;
        if (Object.keys(amount).some(key => !INSPECTOR_ANIMATOR_NUMBER_FIELDS.some(field => field.key === `amount.${key}`))
            || INSPECTOR_ANIMATOR_NUMBER_FIELDS.some(field => {
                if (field.key === 'randomize.seed') return false;
                if (field.key.startsWith('amount.')) {
                    const key = field.key.slice(7);
                    return Object.prototype.hasOwnProperty.call(amount, key) && !validNumber(amount[key], field);
                }
                return !validNumber(entry[field.key], field);
            })) continue;
        const ease = MOTION_EASES.find(candidate => candidate === entry.ease);
        if (Object.prototype.hasOwnProperty.call(entry, 'ease') && !ease) continue;
        let randomize: { seed: number } | undefined;
        if (Object.prototype.hasOwnProperty.call(entry, 'randomize')) {
            if (!record(entry.randomize) || Object.keys(entry.randomize).some(key => key !== 'seed')) continue;
            if (Object.prototype.hasOwnProperty.call(entry.randomize, 'seed')) {
                const seed = entry.randomize.seed;
                if (typeof seed !== 'number' || !Number.isInteger(seed)) continue;
                randomize = { seed };
            }
        }
        result.push({
            id: entry.id, basis: basis.id, shape: shape.id,
            start: entry.start as number, end: entry.end as number, offset: entry.offset as number,
            amount: Object.fromEntries(Object.entries(amount).filter(([, value]) => value !== 0)),
            ...(ease && ease !== 'linear' ? { ease } : {}), ...(randomize ? { randomize } : {})
        });
        if (result.length === INSPECTOR_ANIMATOR_MAX_ITEMS) break;
    }
    return result;
}

export function nextAnimatorId(list: readonly InspectorAnimator[]): string {
    const ids = new Set(list.map(entry => entry.id));
    let number = 1;
    while (ids.has(`a${number}`)) number++;
    return `a${number}`;
}

export function addInspectorAnimator(list: readonly InspectorAnimator[]): InspectorAnimator[] {
    if (list.length >= INSPECTOR_ANIMATOR_MAX_ITEMS) throw new Error('アニメーターは 8 本までです。');
    const next = normalizeInspectorAnimators(list);
    return [...next, { id: nextAnimatorId(list), basis: 'chars', shape: 'ramp', start: 0, end: 0.3, offset: 0, amount: {} }];
}

function assertIndex(list: readonly InspectorAnimator[], index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new Error('アニメーターを選択してください。');
}

export function removeInspectorAnimator(list: readonly InspectorAnimator[], index: number): InspectorAnimator[] {
    const next = normalizeInspectorAnimators(list);
    assertIndex(next, index);
    next.splice(index, 1);
    return next;
}

export function moveInspectorAnimator(list: readonly InspectorAnimator[], index: number, delta: number): InspectorAnimator[] {
    const next = normalizeInspectorAnimators(list);
    assertIndex(next, index);
    if (delta !== -1 && delta !== 1) throw new Error('アニメーターは上か下へ移動してください。');
    const destination = index + delta;
    if (destination >= 0 && destination < next.length) [next[index], next[destination]] = [next[destination], next[index]];
    return next;
}

export function updateInspectorAnimator(
    list: readonly InspectorAnimator[], index: number, key: InspectorAnimatorKey, value: string | number | null
): InspectorAnimator[] {
    const next = normalizeInspectorAnimators(list);
    assertIndex(next, index);
    const entry = next[index];
    if (key === 'basis') {
        const option = INSPECTOR_ANIMATOR_BASES.find(candidate => candidate.id === (value ?? 'chars'));
        if (!option) throw new Error('一覧から単位を選択してください。');
        entry.basis = option.id;
    } else if (key === 'shape') {
        const option = INSPECTOR_ANIMATOR_SHAPES.find(candidate => candidate.id === (value ?? 'ramp'));
        if (!option) throw new Error('一覧から形を選択してください。');
        entry.shape = option.id;
    } else if (key === 'ease') {
        const ease = MOTION_EASES.find(candidate => candidate === (value ?? 'linear'));
        if (!ease) throw new Error('一覧からイージングを選択してください。');
        if (ease === 'linear') delete entry.ease;
        else entry.ease = ease;
    } else {
        const field = INSPECTOR_ANIMATOR_NUMBER_FIELDS.find(candidate => candidate.key === key);
        if (!field) throw new Error('このアニメーターに未対応のパラメータです。');
        if (value !== null && !validNumber(value, field)) {
            const range = field.min === undefined || field.max === undefined ? '有限数'
                : `${field.min * field.displayScale}〜${field.max * field.displayScale}`;
            throw new Error(`${field.label}は ${range} ${field.unit} の範囲${field.integer ? 'の整数' : ''}で入力してください。`);
        }
        const number = value === null ? field.default : value as number;
        if (key === 'randomize.seed') {
            if (number === null) delete entry.randomize;
            else entry.randomize = { seed: number };
        } else if (key === 'start' || key === 'end' || key === 'offset') entry[key] = number!;
        else {
            const amountKey = key.slice(7) as InspectorAnimatorAmountKey;
            if (number === null || number === 0) delete entry.amount[amountKey];
            else entry.amount[amountKey] = number;
        }
    }
    return next;
}
