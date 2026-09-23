import { resolveSnapTime, type SnapCandidate } from './timeline-snap';

export interface FrameDrawRange { at: number; duration: number }
export type FrameDrawDestination =
    | { lane: 'visual' | 'audio'; trackId: string }
    | { lane: 'visual' | 'audio'; insertIndex: number };

/** Name the provisional outer track using the same V/A groups as the rendered headers. */
export function nextFrameTrackNumber(names: Iterable<string>, lane: 'visual' | 'audio'): number {
    const pattern = lane === 'audio' ? /^A\d+$/u : /^V\d+$/u;
    let count = 0;
    for (const name of names) if (pattern.test(name)) count++;
    return count + 1;
}

/** Layout coordinates are strip-local; tracks are stored bottom-to-top. */
export function frameDrawDestination(options: {
    y: number;
    layouts: readonly { id?: string; top: number; height: number }[];
    tracks: readonly { id: string; lane: 'visual' | 'audio'; locked?: boolean }[];
    isLocked?: (id: string) => boolean;
}): FrameDrawDestination | null {
    const { y, layouts, tracks, isLocked } = options;
    if (!Number.isFinite(y) || layouts.length === 0) return null;
    const rows = [...layouts].sort((a, b) => a.top - b.top);
    const hit = rows.find(row => y >= row.top && y < row.top + row.height);
    if (hit) {
        const track = tracks.find(candidate => candidate.id === hit.id);
        return track && !track.locked && !isLocked?.(track.id)
            ? { lane: track.lane, trackId: track.id } : null;
    }
    if (y < rows[0].top) return { lane: 'visual', insertIndex: tracks.length };
    const last = rows[rows.length - 1];
    if (y >= last.top + last.height) return { lane: 'audio', insertIndex: 0 };
    return null;
}
export interface FrameDrawOptions {
    start: number;
    end: number;
    fps: number;
    distancePx: number;
    thresholdSeconds: number;
    candidates: readonly SnapCandidate[];
    occupied: readonly { at: number; duration: number }[];
}

/** Frame-tool-only half-second grid. All occupied ranges and results use integer frames. */
export function calculateFrameDraw(options: FrameDrawOptions): FrameDrawRange | null {
    const { start, end, fps, distancePx, candidates, thresholdSeconds, occupied } = options;
    if (![start, end, fps, distancePx].every(Number.isFinite) || fps <= 0 || distancePx < 3
        || Math.abs(end - start) < 0.5) return null;
    const origin = start * fps;
    if (origin < 0 || occupied.some(item => origin >= item.at && origin < item.at + item.duration)) return null;
    const lower = Math.max(0, ...occupied.filter(item => item.at + item.duration <= origin)
        .map(item => item.at + item.duration));
    const upper = Math.min(Infinity, ...occupied.filter(item => item.at >= origin).map(item => item.at));
    const snap = (seconds: number): number => {
        const edge = resolveSnapTime(seconds, candidates, thresholdSeconds);
        const time = edge.snapped ? edge.time : Math.round(seconds * 2) / 2;
        return Math.min(upper, Math.max(lower, Math.round(time * fps)));
    };
    const a = snap(start), b = snap(end);
    const at = Math.min(a, b), duration = Math.abs(b - a);
    return duration >= Math.ceil(fps * 0.5) ? { at, duration } : null;
}
