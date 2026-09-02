import type { EditV2, ItemV2 } from './edit-v2';
import { projectLegacyEdit, readInternalEdit } from './internal-model';
import { buildTimelineMap, sourceToOutput, type TimelineSegment } from './timeline-map';

export type AnchorCaption = {
    id: string;
    start: number;
    end: number;
    timeDomain?: 'source' | 'output';
};

/** captions.json / CaptionRecord[] をアンカー解決用の最小形へ正規化する。 */
export function toAnchorCaptions(raw: unknown): AnchorCaption[] {
    const rows = Array.isArray(raw)
        ? raw
        : isRecord(raw) && Array.isArray(raw.captions)
            ? raw.captions
            : [];
    return rows.filter((row): row is Record<string, unknown> => isRecord(row)
        && typeof row.id === 'string'
        && row.id.trim().length > 0
        && typeof row.start === 'number'
        && Number.isFinite(row.start)
        && typeof row.end === 'number'
        && Number.isFinite(row.end))
        .map(row => ({
            id: row.id as string,
            start: row.start as number,
            end: row.end as number,
            ...((row.timeDomain === 'output'
                || (row.timeDomain === undefined && row.time_domain === 'output'))
                ? { timeDomain: 'output' as const }
                : {})
        }));
}

export type ItemAnchorV2 = NonNullable<ItemV2['anchor']>;

export type ItemAnchorWarningReason =
    | 'caption-not-found'
    | 'removed-range'
    | 'no-source-segments'
    | 'unsupported-kind';

export type ItemAnchorResolution =
    | { at: number; duration: number }
    | { unresolvable: ItemAnchorWarningReason };

export interface ItemAnchorChange {
    id: string;
    before: { at: number; duration: number };
    after: { at: number; duration: number };
}

export interface ItemAnchorWarning {
    id: string;
    reason: ItemAnchorWarningReason;
}

type AnchoredItem = Pick<ItemV2, 'at' | 'duration'> & { anchor: ItemAnchorV2 };

export function resolveItemAnchor(
    item: AnchoredItem,
    context: {
        caption: AnchorCaption;
        segments: readonly TimelineSegment[];
        fps: number;
        parentAtFrames: number;
    }
): ItemAnchorResolution {
    const start = item.anchor.range?.start ?? context.caption.start;
    const end = item.anchor.range?.end ?? context.caption.end;
    const startOut = context.caption.timeDomain === 'output'
        ? start : sourceToOutput(context.segments, start);
    const endOut = context.caption.timeDomain === 'output'
        ? end : sourceToOutput(context.segments, end);
    if (startOut === null || endOut === null) {
        return { unresolvable: 'no-source-segments' };
    }
    if (startOut === endOut) {
        return { unresolvable: 'removed-range' };
    }
    const startFrames = Math.round(startOut * context.fps);
    const endFrames = Math.round(endOut * context.fps);
    return {
        at: startFrames + (item.anchor.offset ?? 0) - context.parentAtFrames,
        duration: (item.anchor.duration ?? 'caption') === 'caption'
            ? Math.max(1, endFrames - startFrames)
            : item.duration
    };
}

/**
 * anchor を理解しない既存の v2 reader へ、解決キャッシュだけを渡すための射影。
 * anchor が無い入力は同じ参照を返す。
 */
export function withoutItemAnchors<T>(edit: T): T {
    if (!isRecord(edit) || !Array.isArray(edit.tracks)) return edit;
    let tracksChanged = false;
    const tracks = edit.tracks.map(track => {
        if (!isRecord(track) || !Array.isArray(track.items)) return track;
        const items = stripItems(track.items);
        if (items === track.items) return track;
        tracksChanged = true;
        return { ...track, items };
    });
    return tracksChanged ? { ...edit, tracks } as T : edit;
}

export function resolveItemAnchors(
    edit: EditV2,
    captions: readonly AnchorCaption[],
    options?: { fps?: number }
): { edit: EditV2; changes: ItemAnchorChange[]; warnings: ItemAnchorWarning[] } {
    if (!hasItemAnchor(edit)) return { edit, changes: [], warnings: [] };
    const fps = validFps(options?.fps) ?? validFps(edit.output?.fps) ?? 30;
    const anchorFreeEdit = withoutItemAnchors(edit);
    const internal = readInternalEdit(anchorFreeEdit);
    const legacy = projectLegacyEdit(internal);
    const segments = buildTimelineMap(legacy.cuts, { fps: legacy.fps }).segments;
    const captionById = new Map(captions.map(caption => [caption.id, caption]));
    const changes: ItemAnchorChange[] = [];
    const warnings: ItemAnchorWarning[] = [];
    let tracksChanged = false;
    const tracks = edit.tracks.map(track => {
        if (!('items' in track) || !Array.isArray(track.items) || track.lane !== 'visual') return track;
        const items = resolveItems(track.items, 0, captionById, segments, fps, changes, warnings);
        if (items === track.items) return track;
        tracksChanged = true;
        return { ...track, items };
    });
    return {
        edit: tracksChanged ? { ...edit, tracks } as EditV2 : edit,
        changes,
        warnings
    };
}

function resolveItems(
    items: readonly ItemV2[],
    parentAtFrames: number,
    captionById: ReadonlyMap<string, AnchorCaption>,
    segments: readonly TimelineSegment[],
    fps: number,
    changes: ItemAnchorChange[],
    warnings: ItemAnchorWarning[]
): ItemV2[] | readonly ItemV2[] {
    let changed = false;
    const result = items.map(item => {
        let next = item;
        if (item.anchor) {
            if (item.source.kind === 'captions' || item.source.kind === 'caption') {
                warnings.push({ id: item.id, reason: 'unsupported-kind' });
            } else {
                const caption = captionById.get(item.anchor.caption);
                if (!caption) {
                    warnings.push({ id: item.id, reason: 'caption-not-found' });
                } else {
                    const resolution = resolveItemAnchor(item as AnchoredItem, {
                        caption,
                        segments,
                        fps,
                        parentAtFrames
                    });
                    if ('unresolvable' in resolution) {
                        warnings.push({ id: item.id, reason: resolution.unresolvable });
                    } else if (item.at !== resolution.at || item.duration !== resolution.duration) {
                        changes.push({
                            id: item.id,
                            before: { at: item.at, duration: item.duration },
                            after: resolution
                        });
                        next = { ...item, ...resolution } as ItemV2;
                        changed = true;
                    }
                }
            }
        }
        const absoluteAtFrames = parentAtFrames + next.at;
        if (Array.isArray(next.items)) {
            const children = resolveItems(
                next.items,
                absoluteAtFrames,
                captionById,
                segments,
                fps,
                changes,
                warnings
            );
            if (children !== next.items) {
                next = { ...next, items: children as ItemV2[] } as ItemV2;
                changed = true;
            }
        }
        return next;
    });
    return changed ? result : items;
}

function stripItems(items: readonly unknown[]): readonly unknown[] {
    let changed = false;
    const result = items.map(item => {
        if (!isRecord(item)) return item;
        let next = item;
        if (Object.prototype.hasOwnProperty.call(item, 'anchor')) {
            const { anchor: _anchor, ...rest } = item;
            next = rest;
            changed = true;
        }
        if (Array.isArray(next.items)) {
            const children = stripItems(next.items);
            if (children !== next.items) {
                next = { ...next, items: children };
                changed = true;
            }
        }
        return next;
    });
    return changed ? result : items;
}

function hasItemAnchor(edit: EditV2): boolean {
    const visit = (items: readonly ItemV2[]): boolean => items.some(item =>
        item.anchor !== undefined || (Array.isArray(item.items) && visit(item.items))
    );
    return edit.tracks.some(track => 'items' in track && track.lane === 'visual' && visit(track.items));
}

function validFps(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
