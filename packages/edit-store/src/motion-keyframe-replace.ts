import type { KeyframeV2 } from './edit-v2';

/** Replace X/Y only inside the drawn span, retaining every unrelated keyframe channel. */
export function replaceXYKeyframes(existing: readonly KeyframeV2[] | undefined,
    drawn: readonly { t: number; transform: { x: number; y: number } }[], duration: number): KeyframeV2[] {
    if (drawn.length < 2 || !Number.isInteger(duration) || duration < 1) {
        throw new Error('道筋には 2 点以上必要です。');
    }
    const sorted = drawn.slice().sort((a, b) => a.t - b.t);
    if (sorted.some(point => !Number.isInteger(point.t) || point.t < 0 || point.t > duration
        || !Number.isFinite(point.transform.x) || !Number.isFinite(point.transform.y))
        || sorted.some((point, index) => index > 0 && point.t === sorted[index - 1].t)) {
        throw new Error('道筋の時刻または位置が正しくありません。');
    }
    const first = sorted[0].t, last = sorted[sorted.length - 1].t;
    const byTime = new Map<number, KeyframeV2>();
    for (const point of existing ?? []) {
        const copy = structuredClone(point);
        if (point.t >= first && point.t <= last && copy.transform) {
            delete copy.transform.x;
            delete copy.transform.y;
            if (Object.keys(copy.transform).length === 0) delete copy.transform;
        }
        if (copy.transform || copy.opacity !== undefined || copy.crop || copy.perspective || copy.animator) {
            byTime.set(copy.t, copy);
        }
    }
    for (const point of sorted) {
        const current = byTime.get(point.t) ?? { t: point.t };
        current.transform = { ...current.transform, x: point.transform.x, y: point.transform.y };
        byTime.set(point.t, current);
    }
    return [...byTime.values()].sort((a, b) => a.t - b.t);
}
