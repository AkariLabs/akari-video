export const EDITABLE_KEYFRAME_PROPERTIES = [
    'transform.x', 'transform.y', 'transform.scale', 'transform.rotate', 'opacity'
] as const;
export const DISPLAY_ONLY_KEYFRAME_PROPERTIES = ['crop', 'perspective'] as const;

export type EditableKeyframeProperty = typeof EDITABLE_KEYFRAME_PROPERTIES[number];
export type DisplayOnlyKeyframeProperty = typeof DISPLAY_ONLY_KEYFRAME_PROPERTIES[number];
export type KeyframeProperty = EditableKeyframeProperty | DisplayOnlyKeyframeProperty;

export interface TimelinePropertyDiamond {
    t: number;
    endpoint: boolean;
    filled: boolean;
}

export interface TimelineKeyframePropertyRow {
    itemId: string;
    property: KeyframeProperty;
    label: string;
    editable: boolean;
    diamonds: TimelinePropertyDiamond[];
}

export interface AggregateKeyframeDiamond {
    t: number;
    filled: boolean;
    itemIds: string[];
}

export interface KeyframeItemLike {
    id: string;
    duration: number;
    keyframes?: unknown;
    crop?: unknown;
    perspective?: unknown;
}

const LABELS: Record<KeyframeProperty, string> = {
    'transform.x': 'X',
    'transform.y': 'Y',
    'transform.scale': '拡縮',
    'transform.rotate': '回転',
    opacity: '不透明度',
    crop: 'クロップ（表示のみ）',
    perspective: 'パース（表示のみ）'
};

export function deriveTimelineKeyframeRows(
    item: KeyframeItemLike,
    requested: readonly KeyframeProperty[] = EDITABLE_KEYFRAME_PROPERTIES
): TimelineKeyframePropertyRow[] {
    const properties = new Set<KeyframeProperty>(requested);
    for (const point of inlinePoints(item.keyframes)) {
        for (const property of propertiesAt(point)) properties.add(property);
    }
    if (item.crop !== undefined) properties.add('crop');
    if (item.perspective !== undefined) properties.add('perspective');
    return [...properties].map(property => {
        const times = inlinePoints(item.keyframes)
            .filter(point => valueAt(point, property) !== undefined)
            .map(point => point.t)
            .sort((left, right) => left - right);
        return {
            itemId: item.id,
            property,
            label: LABELS[property],
            editable: !DISPLAY_ONLY_KEYFRAME_PROPERTIES.includes(property as DisplayOnlyKeyframeProperty),
            diamonds: times.map((t, index) => ({
                t,
                endpoint: index === 0 || index === times.length - 1,
                filled: index > 0 && index < times.length - 1
            }))
        };
    });
}

export function aggregateKeyframeDiamonds(items: readonly KeyframeItemLike[]): AggregateKeyframeDiamond[] {
    const atTime = new Map<number, Set<string>>();
    for (const item of items) {
        for (const point of inlinePoints(item.keyframes)) {
            const ids = atTime.get(point.t) ?? new Set<string>();
            ids.add(item.id);
            atTime.set(point.t, ids);
        }
    }
    return [...atTime].sort(([left], [right]) => left - right).map(([t, ids]) => ({
        t,
        filled: items.length > 0 && ids.size === items.length,
        itemIds: [...ids]
    }));
}

export function keyframeValueAt(point: unknown, property: KeyframeProperty): unknown {
    return isRecord(point) ? valueAt(point, property) : undefined;
}

function inlinePoints(value: unknown): Array<Record<string, unknown> & { t: number }> {
    return Array.isArray(value) ? value.filter((point): point is Record<string, unknown> & { t: number } =>
        isRecord(point) && Number.isInteger(point.t)) : [];
}

function propertiesAt(point: Record<string, unknown>): KeyframeProperty[] {
    const result: KeyframeProperty[] = [];
    const transform = isRecord(point.transform) ? point.transform : {};
    for (const property of EDITABLE_KEYFRAME_PROPERTIES) {
        const key = property.startsWith('transform.') ? property.slice('transform.'.length) : property;
        if (property.startsWith('transform.') ? key in transform : key in point) result.push(property);
    }
    for (const property of DISPLAY_ONLY_KEYFRAME_PROPERTIES) if (property in point) result.push(property);
    return result;
}

function valueAt(point: Record<string, unknown>, property: KeyframeProperty): unknown {
    if (!property.startsWith('transform.')) return point[property];
    const transform = point.transform;
    return isRecord(transform) ? transform[property.slice('transform.'.length)] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
