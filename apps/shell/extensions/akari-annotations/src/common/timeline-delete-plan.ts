export type TimelineDeleteTarget = 'keyframe' | 'gap' | 'range' | 'selection' | 'none';
export interface TimelineDeletePlan { target: TimelineDeleteTarget; ripple: boolean }

export function timelineDeletePlan(input: {
    keyframe: boolean; gap: boolean; range: boolean; selection: boolean;
    shift: boolean; autoRipple: boolean; oneSide: boolean;
}): TimelineDeletePlan {
    const ripple = !input.oneSide && (input.shift || input.autoRipple);
    if (input.keyframe) return { target: 'keyframe', ripple: false };
    if (input.gap) return { target: 'gap', ripple: true };
    if (input.oneSide && input.selection) return { target: 'selection', ripple: false };
    if (input.range) return { target: 'range', ripple };
    if (input.selection) return { target: 'selection', ripple };
    return { target: 'none', ripple: false };
}
