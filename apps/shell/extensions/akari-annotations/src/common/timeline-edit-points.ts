export interface EditPointTrack {
    locked?: boolean;
    items?: readonly { at: number; duration: number }[];
}

export function timelineEditPoints(tracks: readonly EditPointTrack[], durationSeconds: number, fps: number): number[] {
    if (!(fps > 0)) return [0];
    const endFrame = Math.max(0, Math.round(durationSeconds * fps));
    const frames = new Set<number>([0, endFrame]);
    for (const track of tracks) {
        if (track.locked) continue;
        for (const item of track.items ?? []) {
            if (!Number.isFinite(item.at) || !Number.isFinite(item.duration)) continue;
            const start = Math.round(item.at);
            const end = Math.round(item.at + item.duration);
            if (start >= 0 && start <= endFrame) frames.add(start);
            if (end >= 0 && end <= endFrame) frames.add(end);
        }
    }
    return [...frames].sort((a, b) => a - b).map(frame => frame / fps);
}

export function adjacentEditPoint(points: readonly number[], time: number, direction: -1 | 1, fps: number): number | undefined {
    const frame = Math.round(time * fps);
    return direction < 0
        ? [...points].reverse().find(point => Math.round(point * fps) < frame)
        : points.find(point => Math.round(point * fps) > frame);
}
