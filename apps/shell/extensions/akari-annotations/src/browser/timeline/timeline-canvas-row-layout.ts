import type { TimelineTreeRow } from './timeline-tree-model';

export type TimelineItemRenderRoute = 'legacy' | 'tree' | 'hidden';

/** 入れ子の子は互換 cut/layer/overlay 投影に含まれても、所属する木の行だけに描く。 */
export function timelineItemRenderRoute(
    id: string,
    locations: ReadonlyMap<string, { parentId?: string }>,
    visibleRows: readonly Pick<TimelineTreeRow, 'id'>[]
): TimelineItemRenderRoute {
    if (!id) return 'hidden';
    if (!locations.get(id)?.parentId) return 'legacy';
    return visibleRows.some(row => row.id === id) ? 'tree' : 'hidden';
}

export interface TimelineCanvasRowGeometry {
    top: number;
    height: number;
    propertyTops: number[];
}

/** 木の行が増えても通常 cut の帯はトラック本来の高さに留める。 */
export function cutMediaRowHeight(
    layoutHeight: number,
    ordinaryTrackHeight: number | undefined,
    hasTreeRows: boolean
): number {
    return hasTreeRows && ordinaryTrackHeight !== undefined ? ordinaryTrackHeight : layoutHeight;
}

/** 固定尺の外にある子は帯の可視区間へ切り詰める。 */
export function canvasChildChipSpan(
    parent: Pick<TimelineTreeRow, 'at' | 'duration'>,
    child: Pick<TimelineTreeRow, 'at' | 'duration'>
): { left: number; width: number } | undefined {
    if (!(parent.duration > 0)) return undefined;
    const start = Math.max(parent.at, child.at);
    const end = Math.min(parent.at + parent.duration, child.at + child.duration);
    if (end <= start) return undefined;
    return { left: (start - parent.at) / parent.duration, width: (end - start) / parent.duration };
}

/** トラック名の行の下へ、キャンバス見出しだけ字幕高で積む。子は通常の行高。 */
export function timelineCanvasRowGeometry(
    rows: readonly Pick<TimelineTreeRow, 'id' | 'sourceKind'>[],
    normalStride: number,
    captionStride: number,
    gap: number,
    propertyCount: (id: string) => number,
    trackLineStride = normalStride
): { rows: Map<string, TimelineCanvasRowGeometry>; requiredHeight: number } {
    const result = new Map<string, TimelineCanvasRowGeometry>();
    let top = rows.length > 0 ? trackLineStride : 0;
    for (const row of rows) {
        const stride = row.sourceKind === 'group' ? captionStride : normalStride;
        const propertyTops = Array.from({ length: propertyCount(row.id) }, (_, index) =>
            top + stride + index * normalStride);
        result.set(row.id, { top, height: stride - gap, propertyTops });
        top += stride + propertyTops.length * normalStride;
    }
    return { rows: result, requiredHeight: top };
}

/** トラック本来の高さを守り、木の行とプロパティ行の必要分は上限なしで足す。 */
export function timelineTrackHeight(
    baseHeight: number,
    geometry: ReturnType<typeof timelineCanvasRowGeometry>
): number {
    return Math.max(baseHeight, geometry.requiredHeight);
}
