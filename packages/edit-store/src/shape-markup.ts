import { ShapeSourceV2 } from './edit-v2';

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 340;
const DEFAULT_LINE_HEIGHT = 80;
const DEFAULT_FILL = '#f97316';
const DEFAULT_CORNER_RADIUS = 24;
const DEFAULT_LINE_STROKE_WIDTH = 8;
const SAFE_COLOR = /^[#a-zA-Z0-9(),.%\s-]{1,64}$/u;

function positiveNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function color(value: unknown, fallback: string): string {
    if (typeof value !== 'string' || !SAFE_COLOR.test(value)) return fallback;
    const normalized = value.replace(/\s+/gu, ' ').trim();
    return normalized.length > 0 ? normalized : fallback;
}

function svg(width: number, height: number, body: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function filledShapeAttributes(fill: string, stroke: string | undefined, strokeWidth: number): string {
    return `fill="${fill}" stroke="${stroke ?? 'none'}" stroke-width="${strokeWidth}"`;
}

/** 図形語彙 v0 を、環境に依存しない 1 行のインライン SVG へ降下する。 */
export function shapeMarkup(source: ShapeSourceV2): string {
    const params = source.params ?? {};
    const width = positiveNumber(params.width, DEFAULT_WIDTH);
    const height = positiveNumber(
        params.height,
        source.shape === 'line' || source.shape === 'arrow' ? DEFAULT_LINE_HEIGHT : DEFAULT_HEIGHT
    );
    const fill = color(params.fill, DEFAULT_FILL);
    const lineLike = source.shape === 'line' || source.shape === 'arrow';
    const stroke = params.stroke === undefined ? undefined : color(params.stroke, lineLike ? fill : 'none');
    const strokeWidth = nonNegativeNumber(
        params.strokeWidth,
        lineLike ? DEFAULT_LINE_STROKE_WIDTH : 0
    );
    const attributes = filledShapeAttributes(fill, stroke, strokeWidth);

    switch (source.shape) {
        case 'rect':
            return svg(width, height, `<rect x="0" y="0" width="${width}" height="${height}" ${attributes}/>`);
        case 'rounded-rect': {
            const radius = nonNegativeNumber(params.cornerRadius, DEFAULT_CORNER_RADIUS);
            return svg(width, height, `<rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" ${attributes}/>`);
        }
        case 'ellipse':
            return svg(width, height, `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" ${attributes}/>`);
        case 'line': {
            const lineColor = stroke ?? fill;
            return svg(width, height, `<line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" fill="none" stroke="${lineColor}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`);
        }
        case 'arrow': {
            const lineColor = stroke ?? fill;
            const centerY = height / 2;
            const headStart = width - Math.min(width, centerY);
            return svg(width, height, `<path d="M 0 ${centerY} H ${headStart} M ${headStart} 0 L ${width} ${centerY} L ${headStart} ${height}" fill="none" stroke="${lineColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`);
        }
        case 'speech-bubble': {
            const bodyBottom = height * 0.75;
            const tailStart = width * 0.6;
            const tailTip = width * 0.72;
            const tailEnd = width * 0.82;
            return svg(width, height, `<path d="M 0 0 H ${width} V ${bodyBottom} H ${tailEnd} L ${tailTip} ${height} L ${tailStart} ${bodyBottom} H 0 Z" ${attributes}/>`);
        }
    }
}
