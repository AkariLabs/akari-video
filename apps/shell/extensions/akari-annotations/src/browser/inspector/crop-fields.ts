export type InspectorCropAxis = 'x' | 'y' | 'w' | 'h';

export interface InspectorCrop {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type InspectorCropWriteRequest =
    | { kind: 'layer-crop-x'; id: string; value: number | null }
    | { kind: 'layer-crop-y'; id: string; value: number | null }
    | { kind: 'layer-crop-w'; id: string; value: number | null }
    | { kind: 'layer-crop-h'; id: string; value: number | null }
    | { kind: 'item-field'; id: string; path: `crop.${InspectorCropAxis}`; value: number | null };

export const INSPECTOR_CROP_DEFAULT: Readonly<InspectorCrop> = {
    x: 0,
    y: 0,
    w: 1,
    h: 1
};

export const INSPECTOR_CROP_DISPLAY_SCALE = 100;
export const INSPECTOR_CROP_SCRUB_STEP = 0.005;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const finiteOr = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * UI が読む crop を完全な 0..1 値へ正規化する。schema 上は 4 軸必須だが、
 * 古い/編集中の部分値でもインスペクターを壊さないよう既定値を補う。
 */
export function normalizeInspectorCrop(value: unknown): InspectorCrop {
    const raw = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
    const x = clamp01(finiteOr(raw.x, INSPECTOR_CROP_DEFAULT.x));
    const y = clamp01(finiteOr(raw.y, INSPECTOR_CROP_DEFAULT.y));
    return {
        x,
        y,
        w: Math.min(1 - x, clamp01(finiteOr(raw.w, INSPECTOR_CROP_DEFAULT.w))),
        h: Math.min(1 - y, clamp01(finiteOr(raw.h, INSPECTOR_CROP_DEFAULT.h)))
    };
}

export function inspectorCropAxisMaximum(crop: unknown, axis: InspectorCropAxis): number {
    const normalized = normalizeInspectorCrop(crop);
    if (axis === 'x') return 1 - normalized.w;
    if (axis === 'y') return 1 - normalized.h;
    if (axis === 'w') return 1 - normalized.x;
    return 1 - normalized.y;
}

export function isDefaultInspectorCrop(crop: InspectorCrop): boolean {
    return crop.x === INSPECTOR_CROP_DEFAULT.x
        && crop.y === INSPECTOR_CROP_DEFAULT.y
        && crop.w === INSPECTOR_CROP_DEFAULT.w
        && crop.h === INSPECTOR_CROP_DEFAULT.h;
}

/**
 * 1 軸だけを書き換え、入力した軸を相手側の端まで clamp する。
 * null はその軸の既定値を意味し、4 軸が既定なら crop 自体を消すため null を返す。
 */
export function updateInspectorCrop(
    current: unknown,
    axis: InspectorCropAxis,
    value: number | null
): InspectorCrop | null {
    if (value !== null && !Number.isFinite(value)) {
        throw new Error('クロップ値は有限数で指定してください。');
    }
    const next = normalizeInspectorCrop(current);
    const requested = value ?? INSPECTOR_CROP_DEFAULT[axis];
    next[axis] = Math.min(inspectorCropAxisMaximum(next, axis), clamp01(requested));
    return isDefaultInspectorCrop(next) ? null : next;
}

export function createInspectorCropWriteRequest(
    target: { kind: 'layer' | 'item'; id: string },
    axis: InspectorCropAxis,
    value: number | null
): InspectorCropWriteRequest {
    if (target.kind === 'item') {
        return { kind: 'item-field', id: target.id, path: `crop.${axis}`, value };
    }
    switch (axis) {
        case 'x': return { kind: 'layer-crop-x', id: target.id, value };
        case 'y': return { kind: 'layer-crop-y', id: target.id, value };
        case 'w': return { kind: 'layer-crop-w', id: target.id, value };
        case 'h': return { kind: 'layer-crop-h', id: target.id, value };
    }
}
