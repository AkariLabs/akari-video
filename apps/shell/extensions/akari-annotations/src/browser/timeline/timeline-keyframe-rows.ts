import { t } from '@akari-video/i18n';
export const DEFAULT_KEYFRAME_PROPERTIES = [
    'transform.x', 'transform.scale', 'transform.rotate', 'opacity'
] as const;
export const EDITABLE_KEYFRAME_PROPERTIES = [
    'transform.x', 'transform.y', 'transform.scale', 'transform.scaleX', 'transform.scaleY',
    'transform.rotate', 'opacity', 'crop', 'perspective', 'rotation3d'
] as const;

export type EditableKeyframeProperty = typeof EDITABLE_KEYFRAME_PROPERTIES[number];
export type KeyframeProperty = EditableKeyframeProperty;
export type KeyframeSeatProperty = KeyframeProperty | `rotation3d.${'x' | 'y' | 'z'}` | `crop.${'x' | 'y' | 'w' | 'h'}`
    | `perspective.${'tl' | 'tr' | 'bl' | 'br'}.${'x' | 'y'}`;

export function keyframeRowPropertyOf(property: KeyframeSeatProperty): KeyframeProperty {
    if (property.startsWith('crop.')) return 'crop';
    if (property.startsWith('perspective.')) return 'perspective';
    if (property.startsWith('rotation3d.')) return 'rotation3d';
    return property as KeyframeProperty;
}

export function keyframeDiamondSeekTime(itemAt: number, frame: number, fps: number): number {
    return itemAt + frame / fps;
}

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
    source?: unknown;
}

const LABELS: Record<KeyframeProperty, string> = {
    'transform.x': t('annotationscommon.timelineKeyframeRows.label.position'),
    'transform.y': 'Y',
    'transform.scale': t('annotationscommon.timelineKeyframeRows.label.size'),
    'transform.scaleX': t('annotationscommon.timelineKeyframeRows.label.width'),
    'transform.scaleY': t('annotationscommon.timelineKeyframeRows.label.height'),
    'transform.rotate': t('annotationscommon.timelineKeyframeRows.label.rotation'),
    opacity: t('annotationscommon.timelineKeyframeRows.label.opacity'),
    crop: t('annotationscommon.timelineKeyframeRows.label.crop'),
    perspective: t('annotationscommon.timelineKeyframeRows.label.parse'),
    rotation3d: t('annotationscommon.timelineKeyframeRows.label.rotation3d')
};

export function deriveTimelineKeyframeRows(
    item: KeyframeItemLike,
    requested: readonly KeyframeProperty[] = DEFAULT_KEYFRAME_PROPERTIES
): TimelineKeyframePropertyRow[] {
    const properties = new Set<KeyframeProperty>(requested);
    for (const point of inlinePoints(item.keyframes)) {
        for (const property of propertiesAt(point)) properties.add(property);
    }
    if (item.crop !== undefined) properties.add('crop');
    if (item.perspective !== undefined) properties.add('perspective');
    const source = isRecord(item.source) ? item.source : {};
    if (source.kind === 'html' && (/(^|\/)scene3d\//u.test(String(source.path ?? source.html ?? ''))
        || (isRecord(source.vars) && ['--akari-3d-rot-x', '--akari-3d-rot-y', '--akari-3d-rot-z']
            .some(name => name in (source.vars as Record<string, unknown>))))) properties.add('rotation3d');
    return [...properties].map(property => {
        const times = inlinePoints(item.keyframes)
            .filter(point => valueAt(point, property) !== undefined)
            .map(point => point.t)
            .sort((left, right) => left - right);
        return {
            itemId: item.id,
            property,
            label: LABELS[property],
            editable: true,
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
            if (!Object.entries(point).some(([key, value]) => key !== 't' && key !== 'easing' && value !== undefined)) continue;
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
    if (isRecord(point.vars) && ['--akari-3d-rot-x', '--akari-3d-rot-y', '--akari-3d-rot-z']
        .some(name => name in (point.vars as Record<string, unknown>))) result.push('rotation3d');
    for (const property of EDITABLE_KEYFRAME_PROPERTIES) {
        const key = property.startsWith('transform.') ? property.slice('transform.'.length) : property;
        if (property.startsWith('transform.') ? key in transform : key in point) {
            const grouped = property === 'transform.y' ? 'transform.x'
                : property === 'transform.scaleX' || property === 'transform.scaleY' ? 'transform.scale'
                    : property;
            if (!result.includes(grouped)) result.push(grouped);
        }
    }
    return result;
}

function valueAt(point: Record<string, unknown>, property: KeyframeProperty): unknown {
    if (property === 'rotation3d') {
        const vars = isRecord(point.vars) ? point.vars : {};
        return ['--akari-3d-rot-x', '--akari-3d-rot-y', '--akari-3d-rot-z'].some(name => name in vars) ? vars : undefined;
    }
    if (!property.startsWith('transform.')) return point[property];
    const transform = point.transform;
    if (!isRecord(transform)) return undefined;
    if (property === 'transform.x' || property === 'transform.y') return transform.x ?? transform.y;
    if (property === 'transform.scale' || property === 'transform.scaleX' || property === 'transform.scaleY') {
        return transform.scale ?? transform.scaleX ?? transform.scaleY;
    }
    return transform[property.slice('transform.'.length)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
