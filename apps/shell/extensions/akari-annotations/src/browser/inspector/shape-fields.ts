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

const capOptions = ['なし', '三角', '山形', '棒', '四角', '丸', 'ひし形'] as const;
const capValues = ['none', 'triangle', 'chevron', 'bar', 'square', 'circle', 'diamond'] as const;
const dashOptions = ['実線', '破線', '点線'] as const;
const dashValues = ['solid', 'dash', 'dot'] as const;
const bubbleOptions = ['楕円', '角丸', '四角', 'ギザギザ', '爆発', 'もくもく', '震え'] as const;
const bubbleValues = ['ellipse', 'rounded', 'rect', 'jagged', 'burst', 'cloud', 'wobble'] as const;
const tailOptions = ['とがった', '小さな丸', 'なし'] as const;
const tailValues = ['point', 'dots', 'none'] as const;

const optionSets: Record<string, readonly [readonly string[], readonly string[]]> = {
    dash: [dashOptions, dashValues], startCap: [capOptions, capValues], endCap: [capOptions, capValues],
    style: [bubbleOptions, bubbleValues], tail: [tailOptions, tailValues],
    lineCap: [['なし', '丸く'], ['butt', 'round']]
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
            ? shapeOptionLabel(key, params[key] ?? fallback) : String(params[key] ?? fallback),
        ...(options ? { options } : {}), ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max })
    });
    const number = (key: string, label: string, fallback: number, min: number, max: number) =>
        field(key, label, 'number', fallback, undefined, min, max);
    const select = (key: string, label: string, fallback: string, options: readonly string[]) =>
        field(key, label, 'select', fallback, options);
    const paint = (key: 'fill' | 'stroke', label: string, fallback: string): ShapeField[] => [
        { key: `${key}Mode`, label, kind: 'select', value: params[key] === 'none' ? 'なし' : '色', options: ['色', 'なし'] },
        ...(params[key] === 'none' ? [] : [field(key, `${label}の色`, 'color', fallback)])
    ];
    if (shape === 'line' || shape === 'arrow') return [{ id: 'appearance', fields: [
        field('stroke', '線の色', 'color', '#000000'), number('strokeWidth', '太さ', 4, 1, 100),
        select('dash', '線種', 'solid', dashOptions), select('lineCap', '端を丸く', 'butt', ['なし', '丸く']),
        select('startCap', '始点のパーツ', 'none', capOptions), select('endCap', '終点のパーツ',
            shape === 'arrow' ? 'triangle' : 'none', capOptions)
    ] }];
    const appearance: ShapeControlGroup = { id: 'appearance', fields: [
        ...paint('fill', '塗り', shape === 'bubble' ? '#ffffff' : '#a6a6a6'),
        ...paint('stroke', '枠', shape === 'bubble' ? '#000000' : '#000000'),
        number('strokeWidth', '枠の太さ', shape === 'bubble' ? 5 : 0, 0, 100)
    ] };
    if (shape === 'rounded-rect' || shape === 'path' && shapeHasStraightCorner(params.path)) {
        appearance.fields.push(number('cornerRadius', '角の丸み', 0, 0, 100));
    }
    if (shape !== 'bubble') return [appearance];
    return [appearance, { id: 'bubble', fields: [
        select('style', '形の種類', 'ellipse', bubbleOptions), number('count', '山やトゲの数', 12, 4, 48),
        number('depth', '深さ', 20, 0, 100), number('jitter', 'ばらつき', 0, 0, 100),
        select('dash', '枠の線種', 'solid', dashOptions), select('tail', 'しっぽ', 'point', tailOptions),
        number('tailAngle', 'しっぽの向き', 0, 0, 360), number('tailLength', 'しっぽの長さ', 30, 0, 100),
        number('tailWidth', 'しっぽの太さ', 20, 0, 100), number('tailCurve', 'しっぽの曲がり', 0, -100, 100)
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
