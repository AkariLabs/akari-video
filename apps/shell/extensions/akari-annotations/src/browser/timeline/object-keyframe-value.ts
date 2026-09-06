import { keyframeRowPropertyOf, type KeyframeSeatProperty } from './timeline-keyframe-rows';

const CROP_AXES = ['x', 'y', 'w', 'h'] as const;
const IDENTITY = [[0, 0], [1, 0], [0, 1], [1, 1]];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Resolve a complete object, then overwrite only the seat's scalar coordinate. */
export function objectKeyframeValue(
    raw: Record<string, unknown> | undefined, property: KeyframeSeatProperty, t: number,
    value?: number, keyframes: unknown = raw?.keyframes
): Record<string, unknown> {
    const row = keyframeRowPropertyOf(property);
    const coordinates = (input: unknown): number[] | undefined => {
        const object = record(input);
        if (row === 'crop') {
            const values = CROP_AXES.map(axis => object[axis]);
            return values.every(finite) && values[2] > 0 && values[3] > 0 ? values as number[] : undefined;
        }
        const corners = object.corners;
        return Array.isArray(corners) && corners.length === 4
            && corners.every(corner => Array.isArray(corner) && corner.length === 2 && finite(corner[0]) && finite(corner[1]))
            ? corners.flat() : undefined;
    };
    const defaults = row === 'crop' ? [0, 0, 1, 1] : IDENTITY.flat();
    const staticObject = record(raw?.[row]);
    const staticValues = row === 'crop' ? CROP_AXES.map(axis => staticObject[axis])
        : IDENTITY.flatMap((corner, index) => corner.map((_, axis) =>
            Array.isArray(staticObject.corners) ? staticObject.corners[index]?.[axis] : undefined));
    let resolved = defaults.map((fallback, index) => finite(staticValues[index]) ? staticValues[index] as number : fallback);
    const points = (Array.isArray(keyframes) ? keyframes : []).map(record)
        .filter(point => finite(point.t) && point.t >= 0)
        .map(point => ({ t: point.t as number, values: coordinates(point[row]) }))
        .filter(point => point.values !== undefined).sort((a, b) => a.t - b.t);
    if (points.length) {
        const endIndex = points.findIndex(point => point.t >= t);
        const end = points[endIndex < 0 ? points.length - 1 : endIndex];
        const start = points[Math.max(0, endIndex < 0 ? points.length - 1 : endIndex - 1)];
        // Seat insertion deliberately uses linear interpolation without segment easing.
        const u = start.t === end.t ? 0 : Math.max(0, Math.min(1, (t - start.t) / (end.t - start.t)));
        resolved = start.values!.map((left, index) => left + (end.values![index] - left) * u);
    }
    const parts = property.split('.');
    const index = row === 'crop' ? CROP_AXES.indexOf(parts[1] as typeof CROP_AXES[number])
        : ['tl', 'tr', 'bl', 'br'].indexOf(parts[1]) * 2 + (parts[2] === 'y' ? 1 : 0);
    if (parts.length > 1 && index >= 0 && finite(value)) resolved[index] = value;
    return row === 'crop'
        ? Object.fromEntries(CROP_AXES.map((axis, index) => [axis, resolved[index]]))
        : { corners: IDENTITY.map((_, index) => resolved.slice(index * 2, index * 2 + 2)) };
}
