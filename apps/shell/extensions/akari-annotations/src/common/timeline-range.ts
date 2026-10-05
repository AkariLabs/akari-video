export interface TimelineRangeState { inFrame?: number; outFrame?: number }
export interface TimelineFrameRange { start: number; end: number }

export function setTimelineRangeEdge(state: TimelineRangeState, edge: 'in' | 'out', frame: number): TimelineRangeState {
    if (!Number.isInteger(frame) || frame < 0) return state;
    if (edge === 'in') return { inFrame: frame, ...(state.outFrame !== undefined && frame < state.outFrame
        ? { outFrame: state.outFrame } : {}) };
    return { ...(state.inFrame !== undefined && state.inFrame < frame ? { inFrame: state.inFrame } : {}), outFrame: frame };
}

export function timelineRangeFromClip(at: number, duration: number): TimelineRangeState {
    return Number.isInteger(at) && Number.isInteger(duration) && at >= 0 && duration > 0
        ? { inFrame: at, outFrame: at + duration } : {};
}

export function timelineRangeFromDrag(start: number, end: number): TimelineRangeState {
    return Number.isInteger(start) && Number.isInteger(end) && start !== end
        ? { inFrame: Math.min(start, end), outFrame: Math.max(start, end) } : {};
}

export function completeTimelineRange(state: TimelineRangeState): TimelineFrameRange | undefined {
    return state.inFrame !== undefined && state.outFrame !== undefined && state.inFrame < state.outFrame
        ? { start: state.inFrame, end: state.outFrame } : undefined;
}
