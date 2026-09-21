export interface TimelineGap {
    trackId: string;
    startFrames: number;
    endFrames: number;
    previousItemId: string;
    nextItemId: string;
}
export interface GapTrack {
    id: string;
    lane: string;
    items: readonly { id: string; at: number; duration: number }[];
}

/** Half-open empty interval between occupied unions, in integer output frames. */
export function timelineGapAt(track: GapTrack, frame: number, fps: number): TimelineGap | undefined {
    if (track.lane !== 'visual' || !Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) return undefined;
    const items = [...track.items].filter(item => Number.isInteger(item.at) && Number.isInteger(item.duration)
        && item.at >= 0 && item.duration > 0).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    let previous: typeof items[number] | undefined;
    for (const item of items) {
        if (frame >= item.at && frame < item.at + item.duration) return undefined;
        if (item.at > frame) {
            if (!previous || item.at - (previous.at + previous.duration) < Math.ceil(fps / 2)) return undefined;
            return { trackId: track.id, startFrames: previous.at + previous.duration, endFrames: item.at,
                previousItemId: previous.id, nextItemId: item.id };
        }
        if (!previous || item.at + item.duration > previous.at + previous.duration) previous = item;
    }
    return undefined;
}
