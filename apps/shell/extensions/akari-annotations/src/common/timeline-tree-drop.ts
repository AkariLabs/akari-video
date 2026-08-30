export type TimelineTreeDropMode = 'line' | 'inside';

export interface TimelineTreeDropHit {
    mode: TimelineTreeDropMode;
    targetId: string;
    index: number;
    edge?: 'before' | 'after';
}

export function hitTestTimelineTreeDrop(options: {
    localY: number;
    rowTop: number;
    rowHeight: number;
    targetId: string;
    targetIndex: number;
    canContain: boolean;
    edgeSize?: number;
}): TimelineTreeDropHit {
    const height = Math.max(1, options.rowHeight);
    const y = Math.min(height, Math.max(0, options.localY - options.rowTop));
    const edge = Math.min(options.edgeSize ?? 8, height / 2);
    if (y <= edge) {
        return { mode: 'line', targetId: options.targetId, index: options.targetIndex, edge: 'before' };
    }
    if (y >= height - edge) {
        return { mode: 'line', targetId: options.targetId, index: options.targetIndex + 1, edge: 'after' };
    }
    if (options.canContain) {
        return { mode: 'inside', targetId: options.targetId, index: Number.MAX_SAFE_INTEGER };
    }
    return y < height / 2
        ? { mode: 'line', targetId: options.targetId, index: options.targetIndex, edge: 'before' }
        : { mode: 'line', targetId: options.targetId, index: options.targetIndex + 1, edge: 'after' };
}
