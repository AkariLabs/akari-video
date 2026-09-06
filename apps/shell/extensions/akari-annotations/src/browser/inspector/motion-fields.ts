import type { InspectorWriteRequest } from '../timeline-selection-model';

export const MOTION_IN_OUT_PRESETS = ['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'scale', 'wipe'] as const;
export const MOTION_LOOP_PRESETS = ['pulse', 'float', 'spin'] as const;
export const MOTION_EASES = [
    'linear', 'ease-in-out', 'in-quad', 'out-quad', 'in-out-quad',
    'in-cubic', 'out-cubic', 'in-out-cubic', 'in-quart', 'out-quart', 'in-out-quart',
    'in-expo', 'out-expo', 'in-out-expo', 'in-back', 'out-back', 'in-out-back',
    'out-bounce', 'out-elastic', 'hold'
] as const;
export type InspectorMotionSlot = 'in' | 'out' | 'loop';
export type InspectorMotionField = 'preset' | 'duration' | 'ease' | 'amount';
type MotionPreset = typeof MOTION_IN_OUT_PRESETS[number] | typeof MOTION_LOOP_PRESETS[number];
export const MOTION_PRESET_LABELS: Record<MotionPreset, string> = {
    fade: 'フェード', 'slide-up': 'スライド（上へ）', 'slide-down': 'スライド（下へ）',
    'slide-left': 'スライド（左へ）', 'slide-right': 'スライド（右へ）',
    scale: '拡縮', wipe: 'ワイプ', pulse: '脈動', float: '浮遊', spin: '回転'
};
export const MOTION_DURATION_DEFAULTS = { in: 12, out: 8, loop: 90 } as const;
export const MOTION_AMOUNT_DEFAULTS: Partial<Record<MotionPreset, { value: number; unit: string }>> = {
    'slide-up': { value: 40, unit: 'px' }, 'slide-down': { value: 40, unit: 'px' },
    'slide-left': { value: 40, unit: 'px' }, 'slide-right': { value: 40, unit: 'px' },
    scale: { value: 0.2, unit: '倍' }, pulse: { value: 0.05, unit: '倍' },
    float: { value: 6, unit: 'px' }, spin: { value: 1, unit: '方向' }
};
type MotionSeat = { preset: MotionPreset; ease?: string; amount?: number };
export type InspectorMotion = {
    in?: MotionSeat & { duration: number };
    out?: MotionSeat & { duration: number };
    loop?: MotionSeat & { period: number };
};
export interface InspectorMotionSnapshot {
    id: string;
    motion?: Record<string, unknown>;
    durationFrames: number;
    sourceKind?: string;
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function presets(slot: InspectorMotionSlot): readonly MotionPreset[] {
    return slot === 'loop' ? MOTION_LOOP_PRESETS : MOTION_IN_OUT_PRESETS;
}

function validEase(value: unknown): value is string {
    return typeof value === 'string' && ((MOTION_EASES as readonly string[]).includes(value)
        || /^cubic-bezier\(\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*\)$/.test(value));
}

/** 不正な席は欠け扱いにし、省略された任意値は補完しない。 */
export function normalizeInspectorMotion(raw: unknown): InspectorMotion {
    const motion: InspectorMotion = {};
    if (!record(raw)) return motion;
    for (const slot of ['in', 'out', 'loop'] as const) {
        const seat = raw[slot];
        const key = slot === 'loop' ? 'period' : 'duration';
        if (!record(seat) || !presets(slot).includes(seat.preset as MotionPreset)
            || !Number.isInteger(seat[key]) || Number(seat[key]) < 1) continue;
        const normalized = {
            preset: seat.preset as MotionPreset,
            ...(validEase(seat.ease) ? { ease: seat.ease } : {}),
            ...(typeof seat.amount === 'number' && Number.isFinite(seat.amount) ? { amount: seat.amount } : {})
        };
        if (slot === 'loop') motion.loop = { ...normalized, period: seat.period as number };
        else motion[slot] = { ...normalized, duration: seat.duration as number };
    }
    return motion;
}

export function updateInspectorMotion(
    raw: unknown, slot: InspectorMotionSlot, field: InspectorMotionField, value: string | number | null
): InspectorMotion | null {
    const motion = normalizeInspectorMotion(raw);
    if (field === 'preset') {
        if (value === null || value === 'なし') delete motion[slot];
        else {
            const preset = presets(slot).find(id => id === value || MOTION_PRESET_LABELS[id] === value);
            if (!preset) throw new Error('一覧から動きのプリセットを選択してください。');
            const previous = motion[slot];
            const seat = previous ? { ...previous, preset } : slot === 'loop'
                ? { preset, period: MOTION_DURATION_DEFAULTS.loop }
                : { preset, duration: MOTION_DURATION_DEFAULTS[slot] };
            if (!MOTION_AMOUNT_DEFAULTS[preset]) delete seat.amount;
            if (slot === 'loop') motion.loop = seat as InspectorMotion['loop'];
            else motion[slot] = seat as InspectorMotion['in'];
        }
    } else {
        const seat = motion[slot];
        if (!seat) throw new Error('プリセットを選ぶと変更できます。');
        if (field === 'duration') {
            const frames = value === null ? MOTION_DURATION_DEFAULTS[slot] : Number(value);
            if (!Number.isInteger(frames) || frames < 1) throw new Error('尺・周期は 1 以上の整数フレームで入力してください。');
            if (slot === 'loop') motion.loop!.period = frames;
            else motion[slot]!.duration = frames;
        } else if (field === 'ease') {
            if (value === null) delete seat.ease;
            else {
                if (!validEase(value)) throw new Error('一覧からイージングを選択してください。');
                seat.ease = value;
            }
        } else if (value === null) delete seat.amount;
        else {
            if (!MOTION_AMOUNT_DEFAULTS[seat.preset]) throw new Error('このプリセットに量はありません');
            if ((typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) {
                throw new Error('量は有限数で入力してください。');
            }
            seat.amount = Number(value);
        }
    }
    return Object.keys(motion).length ? motion : null;
}

export function validateInspectorMotion(motion: unknown, itemDurationFrames: number): void {
    if (motion === null) return;
    if (!record(motion)) throw new Error('動きはオブジェクトで指定してください。');
    for (const slot of ['in', 'out', 'loop'] as const) {
        const seat = motion[slot];
        if (seat === undefined) continue;
        const key = slot === 'loop' ? 'period' : 'duration';
        if (!record(seat) || !Number.isInteger(seat[key]) || Number(seat[key]) < 1) {
            throw new Error('尺・周期は 1 以上の整数フレームで入力してください。');
        }
    }
    if (!Number.isInteger(itemDurationFrames) || itemDurationFrames < 1) {
        throw new Error('クリップの尺は 1 以上の整数フレームである必要があります。');
    }
    const total = Number((motion.in as Record<string, unknown> | undefined)?.duration ?? 0)
        + Number((motion.out as Record<string, unknown> | undefined)?.duration ?? 0);
    if (total > itemDurationFrames) {
        throw new Error(`motion の入り・抜きの合計 ${total} フレームがクリップの尺 ${itemDurationFrames} フレームを超えています。`);
    }
}

export function createMotionWriteRequest(
    snapshot: InspectorMotionSnapshot, slot: InspectorMotionSlot, field: InspectorMotionField, input: string | number | null
): Extract<InspectorWriteRequest, { kind: 'item-field' }> {
    if (snapshot.sourceKind === 'html') throw new Error('HTML 部品の動きはパラメータから変更してください。');
    const value = updateInspectorMotion(snapshot.motion, slot, field, input);
    validateInspectorMotion(value, snapshot.durationFrames);
    return { kind: 'item-field', id: snapshot.id, path: 'motion', value };
}
