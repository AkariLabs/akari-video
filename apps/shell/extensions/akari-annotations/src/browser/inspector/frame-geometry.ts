export type FrameAspect = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '4:5' | '3:2' | '21:9';

export function frameDimensions(aspect: FrameAspect, canvas: { width: number; height: number }): { width: number; height: number } {
    const [w, h] = aspect.split(':').map(Number);
    const factor = Math.min(canvas.width / w, canvas.height / h);
    return { width: Math.min(canvas.width, Math.round(w * factor)),
        height: Math.min(canvas.height, Math.round(h * factor)) };
}

export function frameAspectTransform(
    oldSize: { width: number; height: number }, newSize: { width: number; height: number },
    previous?: { x?: number; y?: number; scale?: number; [key: string]: unknown }
): typeof previous {
    if (!previous) return undefined;
    const scale = (previous.scale ?? 1) * Math.sqrt(oldSize.width * oldSize.height / (newSize.width * newSize.height));
    return { ...previous, scale };
}

export function emptyFrameTransform(
    tracks: ReadonlyArray<{ id: string; lane: string; items?: ReadonlyArray<{ at: number; duration: number }> }>,
    trackId: string, at: number, duration: number
): { x: number; y: number; scale: number } | undefined {
    const index = tracks.findIndex(track => track.id === trackId);
    if (index < 0 || tracks[index].lane !== 'visual') return undefined;
    const beneath = tracks.slice(0, index).some(track => track.lane === 'visual' && track.items?.some(item =>
        item.at < at + duration && item.at + item.duration > at));
    return beneath ? { x: 0, y: 0, scale: 0.5 } : undefined;
}
