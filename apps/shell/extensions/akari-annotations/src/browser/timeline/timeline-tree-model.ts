import type { InternalItem, InternalTrack } from '@akari-video/edit-store';
import { projectBagChildren } from 'akari-preview/lib/common/preview-parts';
import { computeCaptionSubrowLayout } from '../../common/caption-subrow-layout';

export type TimelineTreeItemKind =
    | 'group' | 'bag' | 'part' | 'media' | 'caption' | 'captions'
    | 'telop' | 'filter' | 'item';

export interface TimelineTreeTick {
    id: string;
    position: number;
    row: number;
}

export interface TimelineTreeRow {
    id: string;
    label: string;
    itemKind: TimelineTreeItemKind;
    trackId: string;
    parentId?: string;
    depth: number;
    hasChildren: boolean;
    collapsed: boolean;
    at: number;
    duration: number;
    ticks: TimelineTreeTick[];
    sourceKind: string;
}

export interface TimelineTreeModelOptions {
    collapsed?: ReadonlySet<string>;
    partsByHtml?: ReadonlyMap<string, readonly { id: string; order: number }[]>;
    captionsByPath?: ReadonlyMap<string, readonly { id: string; at: number; duration: number }[]>;
}

export function buildTimelineTreeRows(
    tracks: readonly Pick<InternalTrack, 'id' | 'items'>[],
    options: TimelineTreeModelOptions = {}
): TimelineTreeRow[] {
    const rows: TimelineTreeRow[] = [];
    const collapsed = options.collapsed ?? new Set<string>();
    const visit = (item: InternalItem, trackId: string, depth: number, inheritedParentId?: string): void => {
        const children = projectedChildren(item, options);
        const itemKind = kindOf(item, children.length > 0);
        const isCollapsed = children.length > 0 && collapsed.has(item.id);
        rows.push({
            id: item.id,
            label: labelOf(item),
            itemKind,
            trackId,
            ...(item.parentId ?? inheritedParentId
                ? { parentId: item.parentId ?? inheritedParentId } : {}),
            depth,
            hasChildren: children.length > 0,
            collapsed: isCollapsed,
            at: item.at,
            duration: item.duration,
            ticks: isCollapsed ? ticksOf(item, children) : [],
            sourceKind: item.source.kind,
        });
        if (!isCollapsed) {
            for (const child of children) visit(child as InternalItem, trackId, depth + 1, item.id);
        }
    };
    for (const track of tracks) for (const item of track.items) visit(item, track.id, 0);
    return rows;
}

export function rowsByTrack(rows: readonly TimelineTreeRow[]): Map<string, TimelineTreeRow[]> {
    const result = new Map<string, TimelineTreeRow[]>();
    for (const row of rows) result.set(row.trackId, [...(result.get(row.trackId) ?? []), row]);
    return result;
}

/** captions 袋の写しは操作モデルに残すが、タイムラインの表示段としては数えない。 */
export function visibleTimelineTreeRows(rows: readonly TimelineTreeRow[]): TimelineTreeRow[] {
    return rows.filter(row => !(row.itemKind === 'caption' && row.parentId !== undefined));
}

/** 展開済みの深さ優先行列へ折りたたみ集合を適用する。ファイル再読込は不要。 */
export function applyTimelineCollapsedRows(
    expandedRows: readonly TimelineTreeRow[],
    collapsedIds: ReadonlySet<string>
): TimelineTreeRow[] {
    const byId = new Map(expandedRows.map(row => [row.id, row]));
    const hiddenByCollapsedAncestor = (row: TimelineTreeRow): boolean => {
        let parentId = row.parentId;
        while (parentId) {
            if (collapsedIds.has(parentId)) return true;
            parentId = byId.get(parentId)?.parentId;
        }
        return false;
    };
    return expandedRows.flatMap(row => {
        if (hiddenByCollapsedAncestor(row)) return [];
        const collapsed = row.hasChildren && collapsedIds.has(row.id);
        const children = collapsed ? expandedRows.filter(candidate => candidate.parentId === row.id) : [];
        return [{
            ...row,
            collapsed,
            ticks: collapsed ? ticksOfRows(row, children) : []
        }];
    });
}

export function childRow(rows: readonly TimelineTreeRow[], id: string): TimelineTreeRow | undefined {
    return rows.find(row => row.parentId === id);
}

export function parentRow(rows: readonly TimelineTreeRow[], id: string): TimelineTreeRow | undefined {
    const current = rows.find(row => row.id === id);
    return current?.parentId ? rows.find(row => row.id === current.parentId) : undefined;
}

function projectedChildren(
    item: InternalItem,
    options: TimelineTreeModelOptions
): InternalItem[] {
    const explicitChildren = item.children ?? [];
    if (item.source.kind === 'captions') {
        const captions = options.captionsByPath?.get(item.source.path ?? 'captions.json') ?? [];
        const explicitByCaption = new Map(explicitChildren.flatMap(child =>
            child.source.kind === 'caption' ? [[child.source.id, child] as const] : []));
        const excluded = new Set(item.source.exclude ?? []);
        const inserted = new Set<InternalItem>();
        const projected: InternalItem[] = [];
        for (const caption of captions) {
            const explicit = explicitByCaption.get(caption.id);
            if (explicit) {
                if (!inserted.has(explicit)) projected.push(explicit);
                inserted.add(explicit);
                continue;
            }
            if (excluded.has(caption.id)) continue;
            projected.push({
                ...item,
                id: `${item.id}#${caption.id}`,
                at: caption.at,
                duration: caption.duration,
                atFrames: caption.at,
                durationFrames: caption.duration,
                children: [],
                parentId: item.id,
                source: { kind: 'caption', path: 'captions.json', id: caption.id },
                declaration: {},
            });
        }
        for (const child of explicitChildren) if (!inserted.has(child)) projected.push(child);
        return projected;
    }
    if (item.source.kind !== 'html' || typeof item.source.html !== 'string') return explicitChildren;
    if (typeof item.source.part === 'string') return explicitChildren;
    const parts = options.partsByHtml?.get(item.source.html) ?? [];
    const isBag = explicitChildren.length > 0
        || (item.source.exclude?.length ?? 0) > 0
        || parts.length > 0;
    if (!isBag) return explicitChildren;
    return projectBagChildren(item, parts) as InternalItem[];
}

function kindOf(item: InternalItem, hasChildren: boolean): TimelineTreeItemKind {
    if (item.source.kind === 'group') return 'group';
    if (item.source.kind === 'html') {
        if (item.source.part) return 'part';
        return hasChildren ? 'bag' : 'item';
    }
    if (item.source.kind === 'media') return 'media';
    if (item.source.kind === 'caption') return 'caption';
    if (item.source.kind === 'captions') return 'captions';
    if (item.source.kind === 'telop') return 'telop';
    if (item.source.kind === 'filter') return 'filter';
    return 'item';
}

function labelOf(item: InternalItem): string {
    const name = item.declaration.name;
    if (typeof name === 'string' && name.trim()) return name;
    if (item.source.kind === 'html' && item.source.part) return item.source.part;
    return item.id;
}

function ticksOf(item: InternalItem, children: readonly InternalItem[]): TimelineTreeTick[] {
    const duration = Math.max(1e-9, item.duration);
    const rows = item.source.kind === 'captions' ? captionRows(children) : new Map<string, number>();
    return children.map(child => ({
        id: child.id,
        position: Math.min(1, Math.max(0, (child.at - item.at) / duration)),
        row: rows.get(child.id) ?? 0,
    }));
}

function ticksOfRows(parent: TimelineTreeRow, children: readonly TimelineTreeRow[]): TimelineTreeTick[] {
    const duration = Math.max(1e-9, parent.duration);
    const rows = parent.sourceKind === 'captions' ? captionRows(children) : new Map<string, number>();
    return children.map(child => ({
        id: child.id,
        position: Math.min(1, Math.max(0, (child.at - parent.at) / duration)),
        row: rows.get(child.id) ?? 0,
    }));
}

function captionRows(
    children: readonly { id: string; at: number; duration: number }[]
): Map<string, number> {
    const layout = computeCaptionSubrowLayout(
        children.map(child => ({ id: child.id, start: child.at, end: child.at + child.duration, timeDomain: 'output' })),
        0,
        (start, end) => [[start, end]]
    );
    return new Map([...layout].map(([id, value]) => [id, value.row]));
}
