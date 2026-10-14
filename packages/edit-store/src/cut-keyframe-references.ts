import type { KeyframeV2 } from './edit-v2';

type JsonItem = { id?: unknown; at?: unknown; duration?: unknown; source?: unknown;
    keyframes?: unknown; items?: unknown };
type JsonEdit = { tracks?: unknown };
type Reference = { path: string; count: number };
const MOTION_FILE_VERSION = 0;

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reference(value: unknown): value is Reference {
    return record(value) && typeof value.path === 'string' && /^motion\/[^/\\]+\.json$/u.test(value.path)
        && Number.isInteger(value.count) && (value.count as number) >= 2;
}

function visit(edit: JsonEdit, callback: (item: JsonItem) => void): void {
    const items = (value: unknown): void => {
        if (!Array.isArray(value)) return;
        for (const item of value) {
            if (!record(item)) continue;
            callback(item);
            items(item.items);
        }
    };
    if (Array.isArray(edit.tracks)) for (const track of edit.tracks) {
        if (record(track)) items(track.items);
    }
}

export function cutMotionReferencePaths(edit: JsonEdit): string[] {
    const paths = new Set<string>();
    visit(edit, item => {
        if (reference(item.keyframes)) paths.add(item.keyframes.path);
    });
    return [...paths];
}

function pointsFor(item: JsonItem, bags: ReadonlyMap<string, unknown>): KeyframeV2[] | undefined {
    if (!reference(item.keyframes) || typeof item.id !== 'string' || !Number.isInteger(item.duration)) return undefined;
    const bag = bags.get(item.keyframes.path);
    const group = item.keyframes.path.slice('motion/'.length, -'.json'.length);
    if (!record(bag) || bag.version !== MOTION_FILE_VERSION || bag.group !== group || !record(bag.items)) return undefined;
    const points = bag.items[item.id];
    if (!Array.isArray(points) || points.length !== item.keyframes.count) return undefined;
    let previous = -1;
    for (const point of points) {
        if (!record(point) || !Number.isInteger(point.t) || (point.t as number) <= previous
            || (point.t as number) < 0 || (point.t as number) > (item.duration as number)) return undefined;
        previous = point.t as number;
    }
    return structuredClone(points) as KeyframeV2[];
}

/** Hydrate valid bags for a synchronous cut. Unreadable unrelated references stay untouched. */
export function hydrateCutMotionReferences<T extends JsonEdit>(edit: T, bags: ReadonlyMap<string, unknown>): T {
    const result = structuredClone(edit);
    visit(result, item => {
        const points = pointsFor(item, bags);
        if (points) item.keyframes = points;
    });
    return result;
}

/** A ripple may move an item without cutting it. Keep that item's original reference spelling. */
export function restoreUncutMotionReferences<T extends JsonEdit>(before: T, after: T,
    bags: ReadonlyMap<string, unknown>): T {
    const originals = new Map<string, JsonItem>();
    visit(before, item => {
        if (typeof item.id === 'string' && reference(item.keyframes)) originals.set(item.id, item);
    });
    const result = structuredClone(after);
    visit(result, item => {
        if (typeof item.id !== 'string' || !Array.isArray(item.keyframes)) return;
        const original = originals.get(item.id);
        if (!original || item.duration !== original.duration
            || JSON.stringify(item.source) !== JSON.stringify(original.source)) return;
        const points = pointsFor(original, bags);
        if (points && JSON.stringify(item.keyframes) === JSON.stringify(points)) {
            item.keyframes = structuredClone(original.keyframes);
        }
    });
    return result;
}
