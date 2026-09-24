import { ShapeCapV1, ShapePaintV1, ShapeParamsV0, ShapeSourceV2 } from './edit-v2';
import {
    fitShapePath,
    parseShapePath,
    roundShapePath,
    scaleShapePath,
    serializeShapePath,
} from './shape-geometry';
import { bubblePath } from './shape-bubble';

const validColor = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u;
const num = (v: number): string => String(+v.toFixed(3));
const clamp = (v: unknown, fallback: number, min: number, max: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
const fallbackId = (id: string): string => {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(36);
};
const itemKey = (itemId: string | undefined, source: ShapeSourceV2): string => {
    if (itemId === undefined) return fallbackId(JSON.stringify(source));
    let result = '';
    for (let i = 0; i < itemId.length; i++) result += itemId.charCodeAt(i).toString(16).padStart(4, '0');
    return result || '0';
};
const isGradient = (v: ShapePaintV1 | undefined): v is Exclude<ShapePaintV1, string> =>
    typeof v === 'object' && v !== null;
const validPaint = (v: ShapePaintV1 | undefined, fallback: string): ShapePaintV1 => {
    if (typeof v === 'string') return v === 'none' || validColor.test(v) ? v : fallback;
    if (
        !v || !['linear', 'radial'].includes(v.type) || !Array.isArray(v.stops) || v.stops.length < 2 ||
        v.stops.length > 5
    ) return fallback;
    if (
        v.type === 'linear' &&
        (typeof v.angle !== 'number' || !Number.isFinite(v.angle) || v.angle < 0 || v.angle > 360)
    ) return fallback;
    if (
        !v.stops.every((s) =>
            validColor.test(s.color) && Number.isFinite(s.offset) && s.offset >= 0 && s.offset <= 1
        )
    ) return fallback;
    if (v.stops.some((s, i) => i > 0 && s.offset < v.stops[i - 1].offset)) return fallback;
    return v;
};
function paint(
    value: ShapePaintV1,
    id: string,
    width: number,
    height: number,
): { value: string; def: string } {
    if (!isGradient(value)) return { value, def: '' };
    const stops = value.stops.map((s) =>
        `<stop offset="${num(s.offset)}" stop-color="${s.color.slice(0, 7)}" stop-opacity="${
            s.color.length === 9 ? num(parseInt(s.color.slice(7), 16) / 255) : 1
        }"/>`
    ).join('');
    if (value.type === 'radial') {
        return {
            value: `url(#${id})`,
            def: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(width / 2)}" cy="${
                num(height / 2)
            }" r="${num(Math.max(width, height) / 2)}">${stops}</radialGradient>`,
        };
    }
    const a = ((value.angle ?? 90) - 90) * Math.PI / 180;
    const dx = Math.cos(a) / 2;
    const dy = Math.sin(a) / 2;
    return {
        value: `url(#${id})`,
        def: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(width * (.5 - dx))}" y1="${
            num(height * (.5 - dy))
        }" x2="${num(width * (.5 + dx))}" y2="${num(height * (.5 + dy))}">${stops}</linearGradient>`,
    };
}

function cap(
    kind: ShapeCapV1,
    filled: boolean,
    x: number,
    y: number,
    direction: number,
    size: number,
    color: string,
    sw: number,
    minimumOutline: number,
): string {
    if (kind === 'none') return '';
    const h = size / 2;
    const center = x - direction * h;
    const ow = Math.max(minimumOutline, sw * .7);
    const outline = `fill="${filled ? color : 'none'}" stroke="${color}" stroke-width="${num(ow)}"`;
    const tip = x - direction * (filled ? 0 : ow / 2);
    if (kind === 'triangle') {
        return `<polygon points="${num(tip)},${num(y)} ${num(x - direction * size)},${num(y - h)} ${
            num(x - direction * size)
        },${num(y + h)}" ${filled ? `fill="${color}"` : outline}/>`;
    }
    if (kind === 'chevron') {
        return `<polyline points="${num(x - direction * size * .75)},${num(y - h)} ${
            num(x - direction * sw / 2)
        },${num(y)} ${num(x - direction * size * .75)},${
            num(y + h)
        }" fill="none" stroke="${color}" stroke-width="${num(sw)}" stroke-linejoin="round"/>`;
    }
    if (kind === 'bar') {
        return `<line x1="${num(x - direction * sw / 2)}" y1="${num(y - h)}" x2="${
            num(x - direction * sw / 2)
        }" y2="${num(y + h)}" stroke="${color}" stroke-width="${num(sw)}"/>`;
    }
    if (kind === 'square') {
        return `<rect x="${num(center - h + ow / 2)}" y="${num(y - h + ow / 2)}" width="${
            num(size - ow)
        }" height="${num(size - ow)}" ${outline}/>`;
    }
    if (kind === 'circle') {
        return `<circle cx="${num(center)}" cy="${num(y)}" r="${num(h - ow / 2)}" ${outline}/>`;
    }
    return `<polygon points="${num(center - h + ow / 2)},${num(y)} ${num(center)},${num(y - h + ow / 2)} ${
        num(center + h - ow / 2)
    },${num(y)} ${num(center)},${num(y + h - ow / 2)}" ${outline}/>`;
}
function capInset(kind: ShapeCapV1, size: number): number {
    return kind === 'triangle' ? size * .6 : ['square', 'circle', 'diamond'].includes(kind) ? size * .5 : 0;
}
interface StrokeMetrics {
    width: number;
    gap: number;
    capSize: number;
    minimumOutline: number;
}

function strokeMetrics(visibleWidth: number, scaleX: number, scaleY: number): StrokeMetrics {
    const correction = Math.sqrt(scaleX * scaleY);
    return {
        width: visibleWidth / correction,
        gap: Math.max(visibleWidth * 2, 3) / correction,
        capSize: Math.max(visibleWidth * 3.2, 8) / correction,
        minimumOutline: 1 / correction,
    };
}

function dashAttribute(dash: ShapeParamsV0['dash'], metrics: StrokeMetrics, roundCaps = false): string {
    if (dash === 'dot') return ` stroke-dasharray="${num(metrics.width)} ${num(metrics.gap)}"`;
    if (dash === 'dash') {
        const gap = metrics.gap + (roundCaps ? metrics.width : 0);
        return ` stroke-dasharray="${num(metrics.width * 3)} ${num(gap)}"`;
    }
    return '';
}

function lineBody(
    p: ShapeParamsV0,
    width: number,
    height: number,
    metrics: StrokeMetrics,
    color: string,
): string {
    const sw = metrics.width;
    const y = height / 2;
    const size = metrics.capSize;
    const start = p.startCap ?? 'none';
    const end = p.endCap ?? 'none';
    const dash = p.dash ?? 'solid';
    const rounded = p.lineCap === 'round' && dash !== 'dot';
    const dashAttr = dashAttribute(dash, metrics, rounded);
    const x1 = capInset(start, size) + (rounded && start === 'none' ? sw / 2 : 0);
    const x2 = Math.max(x1, width - capInset(end, size) - (rounded && end === 'none' ? sw / 2 : 0));
    return `<line x1="${num(x1)}" y1="${num(y)}" x2="${num(x2)}" y2="${
        num(y)
    }" fill="none" stroke="${color}" stroke-width="${num(sw)}" stroke-linecap="${
        rounded ? 'round' : 'butt'
    }"${dashAttr}/>` +
        cap(start, p.startCapFilled ?? true, 0, y, -1, size, color, sw, metrics.minimumOutline) +
        cap(end, p.endCapFilled ?? true, width, y, 1, size, color, sw, metrics.minimumOutline);
}

function primitivePath(shape: ShapeSourceV2['shape'], width: number, height: number): string {
    if (shape === 'ellipse') {
        return `M${width / 2} 0C${width * .776} 0 ${width} ${height * .224} ${width} ${height / 2}C${width} ${
            height * .776
        } ${width * .776} ${height} ${width / 2} ${height}C${width * .224} ${height} 0 ${height * .776} 0 ${
            height / 2
        }C0 ${height * .224} ${width * .224} 0 ${width / 2} 0Z`;
    }
    if (shape === 'speech-bubble') {
        const bottom = height * .75;
        return `M0 0L${width} 0L${width} ${bottom}L${width * .82} ${bottom}L${width * .72} ${height}L${
            width * .6
        } ${bottom}L0 ${bottom}Z`;
    }
    return `M0 0L${width} 0L${width} ${height}L0 ${height}Z`;
}

export function shapeMarkupV1(
    source: ShapeSourceV2,
    itemId?: string,
    outputWidth = 1920,
    transform?: { scale?: number; scaleX?: number; scaleY?: number },
): string {
    const p = source.params ?? {};
    const width = clamp(p.width, 600, 1, 100000);
    const height = clamp(p.height, source.shape === 'line' || source.shape === 'arrow' ? 80 : 340, 1, 100000);
    const scaleX = clamp(transform?.scaleX ?? transform?.scale, 1, Number.MIN_VALUE, 100000);
    const scaleY = clamp(transform?.scaleY ?? transform?.scale, 1, Number.MIN_VALUE, 100000);
    const key = itemKey(itemId, source);
    const svg = (defs: string, body: string): string =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${
            num(width)
        } ${num(height)}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
    const line = source.shape === 'line' || source.shape === 'arrow';
    const fill = paint(
        validPaint(p.fill, line ? 'none' : source.shape === 'bubble' ? '#ffffff' : '#a6a6a6'),
        `sh-${key}-fill`,
        width,
        height,
    );
    const stroke = paint(
        validPaint(p.stroke, line ? '#000000' : source.shape === 'bubble' ? '#000000' : 'none'),
        `sh-${key}-stroke`,
        width,
        height,
    );
    const visibleStrokeWidth = clamp(p.strokeWidth, line ? 4 : source.shape === 'bubble' ? 5 : 0, 0, 100) *
        outputWidth / 1920;
    const metrics = strokeMetrics(visibleStrokeWidth, scaleX, scaleY);
    const sw = metrics.width;
    if (line) {
        const color = stroke.value === 'none' ? fill.value : stroke.value;
        const q = source.shape === 'arrow' ? { ...p, endCap: p.endCap ?? 'triangle' as const } : p;
        return svg(stroke.def + fill.def, lineBody(q, width, height, metrics, color));
    }
    let d: string;
    let rule = 'nonzero';
    let closed = true;
    if (source.shape === 'bubble') {
        const placed = bubblePath(width * scaleX, height * scaleY, {
            style: p.style ?? 'ellipse',
            count: clamp(p.count, 16, 4, 48),
            depth: clamp(p.depth, 40, 0, 100),
            jitter: clamp(p.jitter, 25, 0, 100),
            seed: clamp(p.seed, 1, -2147483648, 2147483647),
            tail: p.tail ?? 'point',
            tailAngle: clamp(p.tailAngle, 210, 0, 360),
            tailLength: clamp(p.tailLength, 45, 0, 100),
            tailWidth: clamp(p.tailWidth, 30, 0, 100),
            tailCurve: clamp(p.tailCurve, 0, -100, 100),
        });
        d = scaleX === 1 && scaleY === 1
            ? placed
            : serializeShapePath(scaleShapePath(parseShapePath(placed), 1 / scaleX, 1 / scaleY));
    } else {
        const original = source.shape === 'path' ? p.path?.d : primitivePath(source.shape, width, height);
        if (!original) throw new Error('path shape requires params.path');
        rule = p.path?.rule ?? 'nonzero';
        const fitted = fitShapePath(original, width * scaleX, height * scaleY);
        closed = fitted.every((s) => s.closed);
        const radius = source.shape === 'path'
            ? clamp(p.cornerRadius, 0, 0, 100) / 100 * Math.min(width * scaleX, height * scaleY) / 2
            : source.shape === 'rounded-rect'
            ? clamp(p.cornerRadius, 24, 0, Infinity) * Math.sqrt(scaleX * scaleY)
            : 0;
        d = serializeShapePath(scaleShapePath(roundShapePath(fitted, radius), 1 / scaleX, 1 / scaleY));
    }
    const clipId = `sh-${key}-clip`;
    const dash = dashAttribute(p.dash, metrics);
    const defs = fill.def + stroke.def +
        (closed && sw > 0 && stroke.value !== 'none'
            ? `<clipPath id="${clipId}"><path d="${d}" fill-rule="${rule}" clip-rule="${rule}"/></clipPath>`
            : '');
    const interior = closed ? `<path d="${d}" fill-rule="${rule}" fill="${fill.value}"/>` : '';
    const border = sw > 0 && stroke.value !== 'none'
        ? `<path d="${d}" fill="none" stroke="${stroke.value}" stroke-width="${
            num(sw * (closed ? 2 : 1))
        }" stroke-linejoin="round" stroke-linecap="butt"${dash}${
            closed ? ` clip-path="url(#${clipId})"` : ''
        }/>`
        : '';
    return svg(defs, interior + border);
}
