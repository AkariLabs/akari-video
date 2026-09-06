export interface TimelineHeaderWheelInput {
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    ctrlKey: boolean;
    shiftKey: boolean;
}

export type TimelineHeaderWheelPlan =
    | { kind: 'zoom'; deltaY: number }
    | { kind: 'pan'; delta: number }
    | { kind: 'scroll'; deltaY: number }
    | { kind: 'none' };

/** Normalize wheel units before routing a gesture over the non-scrolling header. */
export function planTimelineHeaderWheel(input: TimelineHeaderWheelInput): TimelineHeaderWheelPlan {
    const scale = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? 400 : 1;
    const deltaX = input.deltaX * scale;
    const deltaY = input.deltaY * scale;
    if (input.ctrlKey) {
        return { kind: 'zoom', deltaY };
    }
    const horizontalDelta = Math.abs(deltaX) >= Math.abs(deltaY)
        ? deltaX : input.shiftKey ? deltaY : 0;
    if (horizontalDelta !== 0) {
        return { kind: 'pan', delta: horizontalDelta };
    }
    return deltaY !== 0 ? { kind: 'scroll', deltaY } : { kind: 'none' };
}
