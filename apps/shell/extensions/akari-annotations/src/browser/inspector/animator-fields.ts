import { t } from '@akari-video/i18n';
import { MOTION_EASES } from './motion-fields';

export const INSPECTOR_ANIMATOR_BASES = [
    { id: 'chars', label: t('inspector.animatorFields.label.textOverlay') }, { id: 'words', label: t('inspector.animatorFields.label.words') }, { id: 'lines', label: t('inspector.animatorFields.label.line') },
    { id: 'segments', label: t('inspector.animatorFields.label.phrase'), title: t('inspector.animatorFields.title.v1SameAsWords') }
] as const;
export const INSPECTOR_ANIMATOR_SHAPES = [
    { id: 'ramp', label: t('inspector.animatorFields.label.rise') }, { id: 'ramp-down', label: t('inspector.animatorFields.label.fall') },
    { id: 'triangle', label: t('inspector.animatorFields.label.triangle') }, { id: 'round', label: t('inspector.animatorFields.label.round') },
    { id: 'smooth', label: t('inspector.animatorFields.label.smooth') }, { id: 'square', label: t('inspector.animatorFields.label.rectangle') }
] as const;
export const INSPECTOR_ANIMATOR_MAX_ITEMS = 8;
export const expandedAnimatorFields = new Set<string>();
export const INSPECTOR_ANIMATOR_TEMPLATES = [
    { id: 'sequential', label: t('inspector.animatorFields.label.contactUs'), shape: 'ramp', fields: ['end', 'offset'] },
    { id: 'wave', label: t('inspector.animatorFields.label.wavePunching'), shape: 'round', fields: ['amount.y', 'offset'] },
    { id: 'random', label: t('inspector.animatorFields.label.randomlyKing'), shape: 'square', fields: ['amount.rotate', 'offset', 'randomize.seed'] }
] as const;
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
    { key: 'start', label: t('inspector.animatorFields.label.rangeFirst'), min: 0, max: 1, default: 0, step: 0.01, unit: '%', displayScale: 100 },
    { key: 'end', label: t('inspector.animatorFields.label.rangeEnd'), min: 0, max: 1, default: 0.3, step: 0.01, unit: '%', displayScale: 100 },
    { key: 'offset', label: t('inspector.animatorFields.label.offset'), min: -1, max: 1, default: 0, step: 0.01, unit: '%', displayScale: 100 },
    { key: 'amount.x', label: t('inspector.animatorFields.label.quantityX'), default: 0, step: 1, unit: 'px', displayScale: 1 },
    { key: 'amount.y', label: t('inspector.animatorFields.label.yAmount'), default: 0, step: 1, unit: 'px', displayScale: 1 },
    { key: 'amount.scale', label: t('inspector.animatorFields.label.volumeExpansion'), default: 0, step: 0.01, unit: '%', displayScale: 100 },
    { key: 'amount.rotate', label: t('inspector.animatorFields.label.quantityRotation'), default: 0, step: 1, unit: '°', displayScale: 1 },
    { key: 'amount.opacity', label: t('inspector.animatorFields.label.quantityOpacity'), min: -1, max: 1, default: 0, step: 0.01, unit: '%', displayScale: 100 },
    { key: 'amount.letterSpacing', label: t('inspector.animatorFields.label.letterSpacingAmount'), default: 0, step: 1, unit: 'px', displayScale: 1, title: t('inspector.animatorFields.title.gpuV1UnsupportedExit') },
    { key: 'amount.blur', label: t('inspector.animatorFields.label.blurAmount'), default: 0, step: 1, unit: 'px', displayScale: 1, title: t('inspector.animatorFields.title.gpuV1UnsupportedExit') },
    { key: 'randomize.seed', label: t('inspector.animatorFields.label.randomSeed'), default: null, step: 1, unit: '', displayScale: 1, integer: true }
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
    if (list.length >= INSPECTOR_ANIMATOR_MAX_ITEMS) throw new Error(t('inspector.animatorFields.error.up8Animators'));
    const next = normalizeInspectorAnimators(list);
    return [...next, { id: nextAnimatorId(list), basis: 'chars', shape: 'ramp', start: 0, end: 0.3, offset: 0, amount: {} }];
}

export function addInspectorAnimatorTemplate(list: readonly InspectorAnimator[],
    templateId: typeof INSPECTOR_ANIMATOR_TEMPLATES[number]['id']): InspectorAnimator[] {
    const template = INSPECTOR_ANIMATOR_TEMPLATES.find(item => item.id === templateId);
    if (!template) throw new Error(t('inspector.animatorFields.error.selectTemplate'));
    const result = addInspectorAnimator(list);
    const last = result[result.length - 1];
    if (template.id === 'sequential') {
        result[result.length - 1] = { ...last, offset: .04 };
        return result;
    }
    result[result.length - 1] = template.id === 'wave'
        ? { ...last, shape: 'round', offset: .05, amount: { y: 14 } }
        : { ...last, shape: 'square', offset: .03, amount: { rotate: 8 }, randomize: { seed: 7 } };
    return result;
}

export function inspectorAnimatorTemplateFor(animator: InspectorAnimator): typeof INSPECTOR_ANIMATOR_TEMPLATES[number] | undefined {
    return INSPECTOR_ANIMATOR_TEMPLATES.find(item => item.shape === animator.shape
        && animator.basis === 'chars' && animator.offset > 0);
}

function assertIndex(list: readonly InspectorAnimator[], index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new Error(t('inspector.animatorFields.error.selectAnimator'));
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
    if (delta !== -1 && delta !== 1) throw new Error(t('inspector.animatorFields.error.placeAnimatorTopBottom'));
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
        if (!option) throw new Error(t('inspector.animatorFields.error.selectUnitFromList'));
        entry.basis = option.id;
    } else if (key === 'shape') {
        const option = INSPECTOR_ANIMATOR_SHAPES.find(candidate => candidate.id === (value ?? 'ramp'));
        if (!option) throw new Error(t('inspector.animatorFields.error.selectFormFromList'));
        entry.shape = option.id;
    } else if (key === 'ease') {
        const ease = MOTION_EASES.find(candidate => candidate === (value ?? 'linear'));
        if (!ease) throw new Error(t('inspector.animatorFields.error.selectEasing'));
        if (ease === 'linear') delete entry.ease;
        else entry.ease = ease;
    } else {
        const field = INSPECTOR_ANIMATOR_NUMBER_FIELDS.find(candidate => candidate.key === key);
        if (!field) throw new Error(t('inspector.animatorFields.error.parameterNotSupportedAnimator'));
        if (value !== null && !validNumber(value, field)) {
            const range = field.min === undefined || field.max === undefined ? t('inspector.animatorFields.label.number')
                : `${field.min * field.displayScale}〜${field.max * field.displayScale}`;
            throw new Error(t('inspector.animatorFields.error.enterWithin', { label: field.label, range: range, unit: field.unit, integerNote: field.integer ? t('inspector.animatorFields.unit.integerSuffix') : '' }));
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
