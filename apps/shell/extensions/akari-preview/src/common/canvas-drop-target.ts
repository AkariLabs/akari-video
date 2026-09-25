export interface CanvasDropTarget {
    id: string; name: string; at: number; duration: number; trackIndex: number; itemIndex: number; depth: number;
}

export function canvasDropTargets(tracks: readonly Record<string, unknown>[]): CanvasDropTarget[] {
    const result: CanvasDropTarget[] = [];
    tracks.forEach((track, trackIndex) => {
        if (track.lane !== 'visual' || !Array.isArray(track.items)) return;
        const visit = (items: readonly Record<string, unknown>[], parentAt: number, depth: number): void => {
            items.forEach((item, itemIndex) => {
                const at = parentAt + Number(item.at);
                const source = item.source as { kind?: string; canvas?: unknown } | undefined;
                if (source?.kind === 'group' && source.canvas && Number.isFinite(at)
                    && Number.isFinite(item.duration) && Number(item.duration) > 0) {
                    result.push({ id: String(item.id), name: typeof item.name === 'string' ? item.name : '',
                        at, duration: Number(item.duration), trackIndex, itemIndex, depth });
                }
                if (Array.isArray(item.items)) visit(item.items as Record<string, unknown>[], at, depth + 1);
            });
        };
        visit(track.items as Record<string, unknown>[], 0, 0);
    });
    return result;
}

export function canvasAtFrame(targets: readonly CanvasDropTarget[], at: number, outside = false): CanvasDropTarget | undefined {
    if (outside) return undefined;
    return targets.filter(target => at >= target.at && at < target.at + target.duration)
        .sort((a, b) => b.trackIndex - a.trackIndex || b.depth - a.depth || b.itemIndex - a.itemIndex)[0];
}

export function canvasDropLabel(targets: readonly CanvasDropTarget[], target: CanvasDropTarget): string {
    if (target.name.trim()) return target.name;
    return `キャンバス ${[...targets].sort((a, b) => a.at - b.at || a.trackIndex - b.trackIndex)
        .findIndex(candidate => candidate.id === target.id) + 1}`;
}

export function canvasDropHint(targets: readonly CanvasDropTarget[], seconds: number, fps: number,
    outside = false): string {
    const target = canvasAtFrame(targets, Math.round(seconds * fps), outside);
    return target ? `${canvasDropLabel(targets, target)} に入ります` : '';
}
