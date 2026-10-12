import { t } from '@akari-video/i18n';
import {
    normalizeInspectorCrop,
    updateInspectorCrop,
    type InspectorCrop,
    type InspectorCropAxis
} from './crop-fields';

export interface CutFramingKeyframe {
    t: number;
    scale: number;
    cx?: number;
    cy?: number;
}

export interface CutFraming {
    crop?: InspectorCrop;
    keyframes?: CutFramingKeyframe[];
}

export type CutFramingCropWriteKind =
    | 'cut-framing-crop-x'
    | 'cut-framing-crop-y'
    | 'cut-framing-crop-w'
    | 'cut-framing-crop-h';

export type CutFramingWriteRequest =
    | { kind: CutFramingCropWriteKind; index: number; value: number | null }
    | { kind: 'cut-framing-keyframes'; index: number; value: CutFramingKeyframe[] | null };

const CUT_FRAMING_CROP_KINDS = new Set<string>([
    'cut-framing-crop-x', 'cut-framing-crop-y',
    'cut-framing-crop-w', 'cut-framing-crop-h'
]);

const finiteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};

export function isCutFramingWriteRequest(value: { kind: string }): value is CutFramingWriteRequest {
    return CUT_FRAMING_CROP_KINDS.has(value.kind) || value.kind === 'cut-framing-keyframes';
}

export function cutFramingCropAxis(kind: CutFramingCropWriteKind): InspectorCropAxis {
    return kind.slice('cut-framing-crop-'.length) as InspectorCropAxis;
}

export function createCutFramingCropWriteRequest(
    index: number,
    axis: InspectorCropAxis,
    value: number | null
): CutFramingWriteRequest {
    return { kind: `cut-framing-crop-${axis}`, index, value } as CutFramingWriteRequest;
}

/** 読み取り表示用。検証済み edit.json を前提にしつつ、部分値でも UI を壊さない。 */
export function readCutFraming(value: unknown): CutFraming {
    const raw = record(value);
    const keyframes = Array.isArray(raw.keyframes)
        ? raw.keyframes.flatMap(point => {
            const candidate = record(point);
            if (!finiteNumber(candidate.t) || !finiteNumber(candidate.scale)) return [];
            return [{
                t: candidate.t,
                scale: candidate.scale,
                ...(finiteNumber(candidate.cx) ? { cx: candidate.cx } : {}),
                ...(finiteNumber(candidate.cy) ? { cy: candidate.cy } : {})
            }];
        }).sort((left, right) => left.t - right.t)
        : undefined;
    return {
        ...(raw.crop && typeof raw.crop === 'object' && !Array.isArray(raw.crop)
            ? { crop: normalizeInspectorCrop(raw.crop) } : {}),
        ...(keyframes && keyframes.length > 0 ? { keyframes } : {})
    };
}

/** mutation 境界の正規化。schema と同じ値域を守り、時刻順へ丸ごと置換する。 */
export function normalizeCutFramingKeyframes(
    value: readonly CutFramingKeyframe[]
): CutFramingKeyframe[] {
    if (value.length < 2) {
        throw new Error(t('inspector.framingFields.error.specifyZoomKfTwoMorePoints'));
    }
    const normalized = value.map((point, index) => {
        if (!point || typeof point !== 'object' || Array.isArray(point)) {
            throw new Error(t('inspector.framingFields.error.specifyZoomKfObject', { index: index + 1 }));
        }
        const candidate = point as unknown as Record<string, unknown>;
        if (!finiteNumber(candidate.t) || candidate.t < 0) {
            throw new Error(t('inspector.framingFields.error.specifyTimeZoomKfLimit0More', { index: index + 1 }));
        }
        if (!finiteNumber(candidate.scale) || candidate.scale <= 0) {
            throw new Error(t('inspector.framingFields.error.specifyZoomKfMagnificationLimit0', { index: index + 1 }));
        }
        for (const [field, label] of [['cx', t('inspector.framingFields.label.coreX')], ['cy', t('inspector.framingFields.label.coreY')]] as const) {
            const coordinate = candidate[field];
            if (coordinate !== undefined && (!finiteNumber(coordinate) || coordinate < 0 || coordinate > 1)) {
                throw new Error(t('inspector.framingFields.error.specifyZoomKfRangeFrom0100', { index: index + 1, label: label }));
            }
        }
        return {
            t: candidate.t,
            scale: candidate.scale,
            ...(candidate.cx !== undefined ? { cx: candidate.cx as number } : {}),
            ...(candidate.cy !== undefined ? { cy: candidate.cy as number } : {})
        };
    }).sort((left, right) => left.t - right.t);
    if (normalized.some((point, index) => index > 0 && point.t === normalized[index - 1].t)) {
        throw new Error(t('inspector.framingFields.error.timeZoomKfCannotBeDuplicated'));
    }
    return normalized;
}

export function updateCutFraming(
    current: unknown,
    request: CutFramingWriteRequest
): CutFraming | null {
    const raw = record(current);
    const next: CutFraming = {
        ...(raw.crop && typeof raw.crop === 'object' && !Array.isArray(raw.crop)
            ? { crop: normalizeInspectorCrop(raw.crop) } : {}),
        ...(Array.isArray(raw.keyframes)
            ? { keyframes: normalizeCutFramingKeyframes(raw.keyframes as unknown as CutFramingKeyframe[]) }
            : {})
    };
    if (request.kind === 'cut-framing-keyframes') {
        if (request.value === null) delete next.keyframes;
        else next.keyframes = normalizeCutFramingKeyframes(request.value);
    } else {
        const axis = cutFramingCropAxis(request.kind);
        const crop = updateInspectorCrop(next.crop, axis, request.value);
        if (crop && (crop.w <= 0 || crop.h <= 0)) {
            throw new Error(t('inspector.framingFields.error.framingWidthHeightMustBeGreaterThan'));
        }
        if (crop) next.crop = crop;
        else delete next.crop;
    }
    return next.crop || next.keyframes ? next : null;
}

export function removeCutFramingKeyframe(
    points: readonly CutFramingKeyframe[],
    index: number
): CutFramingKeyframe[] | null {
    const next = points.filter((_point, candidateIndex) => candidateIndex !== index);
    return next.length < 2 ? null : normalizeCutFramingKeyframes(next);
}

export function replaceCutFramingKeyframe(
    points: readonly CutFramingKeyframe[],
    index: number,
    patch: Partial<CutFramingKeyframe>
): CutFramingKeyframe[] {
    return normalizeCutFramingKeyframes(points.map((point, candidateIndex) =>
        candidateIndex === index ? { ...point, ...patch } : point
    ));
}

const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.min(maximum, Math.max(minimum, value));

export function addCutFramingKeyframe(
    points: readonly CutFramingKeyframe[],
    playheadSeconds: number,
    durationSeconds: number
): CutFramingKeyframe[] {
    const duration = Math.max(0, finiteNumber(durationSeconds) ? durationSeconds : 0);
    const playhead = clamp(finiteNumber(playheadSeconds) ? playheadSeconds : 0, 0, duration);
    if (points.length === 0) {
        const targetT = playhead < 0.1 ? duration : playhead;
        if (targetT <= 0) {
            throw new Error(t('inspector.framingFields.error.canTAddZoomKfBecauseCut'));
        }
        return normalizeCutFramingKeyframes([
            { t: 0, scale: 1 },
            { t: targetT, scale: 1.5 }
        ]);
    }

    const normalized = normalizeCutFramingKeyframes(points);
    const nearest = normalized.reduce((best, point) =>
        Math.abs(point.t - playhead) < Math.abs(best.t - playhead) ? point : best
    );
    let targetT = playhead;
    if (normalized.some(point => point.t === targetT)) {
        targetT = Math.min(duration, targetT + 0.1);
    }
    if (normalized.some(point => point.t === targetT)) {
        throw new Error(t('inspector.framingFields.error.positionHasAlreadyZoomKfCanNot'));
    }
    return normalizeCutFramingKeyframes([...normalized, { t: targetT, scale: nearest.scale }]);
}
