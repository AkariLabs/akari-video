import { t } from '@akari-video/i18n';
/** Shape v1 controls. This module has no DOM or document writes. */
export interface ShapeField {
    key: string;
    label: string;
    kind: 'color' | 'number' | 'select';
    value: string;
    options?: readonly string[];
    min?: number;
    max?: number;
}

export interface ShapeControlGroup { id: 'appearance' | 'bubble'; fields: ShapeField[] }

const capOptions = [t('inspector.shapeFields.label.none'), t('inspector.shapeFields.label.triangle'), t('inspector.shapeFields.label.chevron'), t('inspector.shapeFields.label.bar'), t('inspector.shapeFields.label.square'), t('inspector.shapeFields.label.round'), t('inspector.shapeFields.label.diamond')] as const;
const capValues = ['none', 'triangle', 'chevron', 'bar', 'square', 'circle', 'diamond'] as const;
const dashOptions = [t('inspector.shapeFields.label.solidLine'), t('inspector.shapeFields.label.dashed'), t('inspector.shapeFields.label.dottedLine')] as const;
const dashValues = ['solid', 'dash', 'dot'] as const;
const bubbleOptions = [t('inspector.shapeFields.label.ellipse'), t('inspector.shapeFields.label.cornerRadius'), t('inspector.shapeFields.label.square'), t('inspector.shapeFields.label.zigzag'), t('inspector.shapeFields.label.burst'), t('inspector.shapeFields.label.cloud'), t('inspector.shapeFields.label.shake')] as const;
const bubbleValues = ['ellipse', 'rounded', 'rect', 'jagged', 'burst', 'cloud', 'wobble'] as const;
const tailOptions = [t('inspector.shapeFields.label.pointed'), t('inspector.shapeFields.label.smallRound'), t('inspector.shapeFields.label.none')] as const;
const tailValues = ['point', 'dots', 'none'] as const;

const optionSets: Record<string, readonly [readonly string[], readonly string[]]> = {
    dash: [dashOptions, dashValues], startCap: [capOptions, capValues], endCap: [capOptions, capValues],
    style: [bubbleOptions, bubbleValues], tail: [tailOptions, tailValues],
    lineCap: [[t('inspector.shapeFields.label.none'), t('inspector.shapeFields.label.rounded')], ['butt', 'round']]
};

export function shapeOptionLabel(key: string, raw: unknown): string {
    const [labels, values] = optionSets[key];
    const index = values.indexOf(String(raw));
    return labels[index < 0 ? 0 : index];
}

export function shapeOptionValue(key: string, label: string): string | undefined {
    const [labels, values] = optionSets[key];
    const index = labels.indexOf(label);
    return index < 0 ? undefined : values[index];
}

export function shapeNumber(key: string, value: string): number | undefined {
    const bounds: Record<string, [number, number]> = {
        strokeWidth: [0, 100], cornerRadius: [0, 100], count: [4, 48], depth: [0, 100],
        jitter: [0, 100], tailAngle: [0, 360], tailLength: [0, 100], tailWidth: [0, 100],
        tailCurve: [-100, 100]
    };
    const limits = bounds[key];
    const n = Number(value);
    return limits && Number.isFinite(n) ? Math.min(limits[1], Math.max(limits[0], n)) : undefined;
}

export function shapeHasStraightCorner(path: unknown): boolean {
    if (!path || typeof path !== 'object' || typeof (path as { d?: unknown }).d !== 'string') return false;
    const commands = (path as { d: string }).d.match(/[MLCZ]/giu) ?? [];
    return commands.some((command, index) => command.toUpperCase() === 'L'
        && ['L', 'Z'].includes(commands[index + 1]?.toUpperCase() ?? ''));
}

export function shapeControlGroups(shape: string | undefined, params: Record<string, unknown> = {}): ShapeControlGroup[] {
    if (!shape) return [];
    const field = (key: string, label: string, kind: ShapeField['kind'], fallback: unknown,
        options?: readonly string[], min?: number, max?: number): ShapeField => ({
        key, label, kind, value: kind === 'select' && optionSets[key]
            ? shapeOptionLabel(key, params[key] ?? fallback)
            : kind === 'color' && params[key] && typeof params[key] === 'object'
                ? String((params[key] as { stops?: { color?: string }[] }).stops?.[0]?.color ?? '')
                : String(params[key] ?? fallback),
        ...(options ? { options } : {}), ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max })
    });
    const number = (key: string, label: string, fallback: number, min: number, max: number) =>
        field(key, label, 'number', fallback, undefined, min, max);
    const select = (key: string, label: string, fallback: string, options: readonly string[]) =>
        field(key, label, 'select', fallback, options);
    const paint = (key: 'fill' | 'stroke', label: string, fallback: string): ShapeField[] => [
        { key: `${key}Mode`, label, kind: 'select', value: params[key] === 'none' ? t('inspector.shapeFields.label.none') : t('inspector.shapeFields.label.colorColor'), options: [t('inspector.shapeFields.label.colorColor'), t('inspector.shapeFields.label.none')] },
        ...(params[key] === 'none' ? [] : [field(key, t('inspector.shapeFields.label.colorWithValue', { label: label }), 'color', fallback)])
    ];
    if (shape === 'line' || shape === 'arrow') return [{ id: 'appearance', fields: [
        field('stroke', t('inspector.shapeFields.label.lineColor'), 'color', '#000000'), number('strokeWidth', t('inspector.shapeFields.label.weight'), 4, 1, 100),
        select('dash', t('inspector.shapeFields.label.lineStyle'), 'solid', dashOptions), select('lineCap', t('inspector.shapeFields.label.roundEdge'), 'butt', [t('inspector.shapeFields.label.none'), t('inspector.shapeFields.label.rounded')]),
        select('startCap', t('inspector.shapeFields.cap.start'), 'none', capOptions), select('endCap', t('inspector.shapeFields.label.endPointParts'),
            shape === 'arrow' ? 'triangle' : 'none', capOptions)
    ] }];
    const appearance: ShapeControlGroup = { id: 'appearance', fields: [
        ...paint('fill', t('inspector.shapeFields.label.fill'), shape === 'bubble' ? '#ffffff' : '#a6a6a6'),
        ...paint('stroke', t('inspector.shapeFields.label.frame'), shape === 'bubble' ? '#000000' : '#000000'),
        number('strokeWidth', t('inspector.shapeFields.label.frameThickness'), shape === 'bubble' ? 5 : 0, 0, 100)
    ] };
    if (shape === 'rounded-rect' || shape === 'path' && shapeHasStraightCorner(params.path)) {
        appearance.fields.push(number('cornerRadius', t('inspector.shapeFields.label.cornerRound'), 0, 0, 100));
    }
    if (shape !== 'bubble') return [appearance];
    return [appearance, { id: 'bubble', fields: [
        select('style', t('inspector.shapeFields.label.typesShapes'), 'ellipse', bubbleOptions), number('count', t('inspector.shapeFields.label.mountainsTrekking'), 12, 4, 48),
        number('depth', t('inspector.shapeFields.label.depth'), 20, 0, 100), number('jitter', t('inspector.shapeFields.label.variation'), 0, 0, 100),
        select('dash', t('inspector.shapeFields.label.borderLineStyle'), 'solid', dashOptions), select('tail', t('inspector.shapeFields.label.tail'), 'point', tailOptions),
        number('tailAngle', t('inspector.shapeFields.label.tailDirection'), 0, 0, 360), number('tailLength', t('inspector.shapeFields.label.lengthTail'), 30, 0, 100),
        number('tailWidth', t('inspector.shapeFields.label.tailThickness'), 20, 0, 100), number('tailCurve', t('inspector.shapeFields.label.tailCurve'), 0, -100, 100)
    ] }];
}

export function swapShapeEnds(params: Record<string, unknown>): Record<string, unknown> {
    return { ...params, startCap: params.endCap ?? 'none', endCap: params.startCap ?? 'none',
        startCapFilled: params.endCapFilled ?? true, endCapFilled: params.startCapFilled ?? true };
}

export function enableShapeStroke(params: Record<string, unknown>): Record<string, unknown> {
    return { ...params, stroke: '#000000',
        strokeWidth: typeof params.strokeWidth === 'number' && params.strokeWidth > 0
            ? params.strokeWidth : 4 };
}
