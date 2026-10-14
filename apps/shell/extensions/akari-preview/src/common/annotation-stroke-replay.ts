/** Return the prefix at a fraction of the polyline's geometric length. */
export function annotationStrokePrefix(
    points: ReadonlyArray<readonly [number, number]>,
    progress: number
): Array<[number, number]> {
    if (points.length === 0) return [];
    const fraction = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    if (fraction === 0) return [[points[0][0], points[0][1]]];
    if (fraction === 1) return points.map(point => [point[0], point[1]] as [number, number]);

    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
        total += Math.hypot(points[index][0] - points[index - 1][0],
            points[index][1] - points[index - 1][1]);
    }
    if (total === 0) return points.map(point => [point[0], point[1]] as [number, number]);

    const result: Array<[number, number]> = [[points[0][0], points[0][1]]];
    const target = total * fraction;
    let traversed = 0;
    for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
        if (traversed + length >= target && length > 0) {
            const share = (target - traversed) / length;
            result.push([from[0] + (to[0] - from[0]) * share,
                from[1] + (to[1] - from[1]) * share]);
            return result;
        }
        result.push([to[0], to[1]]);
        traversed += length;
    }
    return result;
}
