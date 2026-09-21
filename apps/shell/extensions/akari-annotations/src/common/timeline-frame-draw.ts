import { resolveSnapTime, type SnapCandidate } from './timeline-snap';

export interface FrameDrawRange { at: number; duration: number }
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
