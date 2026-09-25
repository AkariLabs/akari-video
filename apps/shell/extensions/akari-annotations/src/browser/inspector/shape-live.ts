import { shapeMarkup, type ShapeSourceV2 } from '@akari-video/edit-store';
import { shapeNumber, shapeOptionValue } from './shape-fields';

export interface ShapeLiveSource {
    itemId: string;
    shape?: string;
    params?: Readonly<Record<string, unknown>>;
    outputWidth?: number;
    transform?: { scale?: number; scaleX?: number; scaleY?: number };
}

const NUMBER_KEYS = new Set([
    'strokeWidth', 'cornerRadius', 'count', 'depth', 'jitter',
    'tailAngle', 'tailLength', 'tailWidth', 'tailCurve'
]);
const SELECT_KEYS = new Set(['dash', 'lineCap', 'startCap', 'endCap', 'style', 'tail']);
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u;

export function shapeLiveParams(
    shape: string | undefined,
    params: Readonly<Record<string, unknown>>,
    key: string,
    rawValue: string | number
): Record<string, unknown> | undefined {
    if (!shape) return undefined;
    const next: Record<string, unknown> = { ...params };
    if (key === 'fillMode' || key === 'strokeMode') {
        const paintKey = key === 'fillMode' ? 'fill' : 'stroke';
        if (rawValue === 'なし') {
            next[paintKey] = 'none';
            return next;
        }
        if (rawValue !== '色') return undefined;
        if (paintKey === 'fill') next.fill = shape === 'bubble' ? '#ffffff' : '#a6a6a6';
        else {
            next.stroke = '#000000';
            if (!(Number(next.strokeWidth ?? 0) > 0)) next.strokeWidth = 4;
        }
        return next;
    }
    if (key === 'fill' || key === 'stroke') {
        const value = String(rawValue);
        if (!COLOR_PATTERN.test(value)) return undefined;
        next[key] = value;
        return next;
    }
    if (NUMBER_KEYS.has(key)) {
        const value = shapeNumber(key, String(rawValue));
        if (value === undefined) return undefined;
        next[key] = shape === 'line' && key === 'strokeWidth' ? Math.max(1, value) : value;
        return next;
    }
    if (SELECT_KEYS.has(key)) {
        const value = shapeOptionValue(key, String(rawValue));
        if (value === undefined) return undefined;
        next[key] = value;
        return next;
    }
    return undefined;
}

export function shapeLiveMarkup(
    source: ShapeLiveSource,
    key: string,
    rawValue: string | number
): string | undefined {
    const params = shapeLiveParams(source.shape, source.params ?? {}, key, rawValue);
    if (!params) return undefined;
    try {
        return shapeMarkup({ shape: source.shape, params } as unknown as ShapeSourceV2,
            source.itemId, source.outputWidth, source.transform);
    } catch {
        return undefined;
    }
}
