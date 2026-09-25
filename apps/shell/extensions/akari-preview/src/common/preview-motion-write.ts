/** A temporary preview move changes X/Y at the playhead without expanding other keyframe axes. */
export function withPreviewPosition(
    summary: any, target: { kind: 'cut'; index: number } | { kind: 'layer'; id: string },
    position: { x?: number; y?: number }, seconds: number
): any {
    const key = target.kind === 'cut' ? 'cuts' : 'layers';
    const entries = summary?.[key];
    if (!Array.isArray(entries)) return summary;
    const index = target.kind === 'cut' ? target.index
        : entries.findIndex((entry: any) => String(entry.id) === target.id);
    const item = entries[index];
    if (!item) return summary;
    const next = { ...item };
    if (Array.isArray(item.keyframes) && item.keyframes.length >= 2 && Number.isFinite(seconds)) {
        const start = Number(item.motionSource?.at ?? (target.kind === 'cut' ? item.at : item.t)) || 0;
        const local = Math.max(0, seconds - start);
        const tolerance = .5 / (Number(summary.output?.fps) || 30);
        const points = item.keyframes.map((point: any) => ({ ...point,
            ...(point.transform ? { transform: { ...point.transform } } : {}) }));
        let point = points.find((entry: any) => Math.abs(Number(entry.t) - local) <= tolerance);
        if (!point) { point = { t: local }; points.push(point); }
        point.transform = { ...point.transform, ...position };
        points.sort((left: any, right: any) => Number(left.t) - Number(right.t));
        next.keyframes = points;
    } else {
        next.transform = { ...item.transform, ...position };
    }
    const updated = [...entries];
    updated[index] = next;
    return { ...summary, [key]: updated };
}
