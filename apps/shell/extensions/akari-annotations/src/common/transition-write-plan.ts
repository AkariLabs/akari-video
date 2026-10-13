import { planTrackTransitions, readTransitionAlign, type TransitionAlign, type TransitionPlanClip,
    type TransitionBoundaryPlan } from '@akari-video/edit-store';
import { roundTransitionDurationForWrite } from './transition-duration';

export interface TransitionWritePlan {
    align?: TransitionAlign | null;
    duration: number;
    roomOutcome: 'full' | 'clamped' | 'none';
    roomSeconds: number;
}

export function transitionMaterialDuration(input: {
    videoUri?: string; cached?: number | 'unavailable' | 'pending'; outSeconds: number;
}): number | undefined {
    if (!input.videoUri) return undefined;
    if (typeof input.cached === 'number') return input.cached;
    return input.cached === 'unavailable' ? input.outSeconds : undefined;
}

export function transitionDeclarationPatch(input: {
    type: string; duration: number; align?: TransitionAlign | null;
}): { type: string; duration: number; align?: TransitionAlign | null } {
    return { type: input.type, duration: input.duration,
        ...(input.align === undefined ? {} : { align: input.align }) };
}

/** A pair with long display lengths isolates the material limit from clip length and neighboring windows. */
export function materialLimitedTransition(clips: readonly TransitionPlanClip[], earlierId: string,
    duration: number, align: TransitionAlign, fps: number): TransitionBoundaryPlan | undefined {
    const index = clips.findIndex(clip => clip.id === earlierId);
    if (index < 0 || index + 1 >= clips.length) return undefined;
    const length = Math.max(10, duration * 4);
    const earlier: TransitionPlanClip = { ...clips[index], startSeconds: 0, lengthSeconds: length,
        tailRoomSeconds: clips[index].tailRoomSeconds ?? 0,
        transitionOut: { declaredSeconds: duration, align, fill: false } };
    const later: TransitionPlanClip = { ...clips[index + 1], startSeconds: length, lengthSeconds: length,
        transitionOut: undefined };
    return planTrackTransitions([earlier, later], { fps })[0];
}

export function transitionWritePlan(input: {
    clips: readonly TransitionPlanClip[];
    earlierId: string;
    duration: number;
    fps: number;
    existingAlign?: unknown;
    explicitAlign?: TransitionAlign | null;
}): TransitionWritePlan {
    const align = input.explicitAlign !== undefined ? input.explicitAlign ?? 'center'
        : readTransitionAlign(input.existingAlign);
    const roomPlan = materialLimitedTransition(input.clips, input.earlierId, input.duration, align, input.fps);
    const roomSeconds = roomPlan?.effectiveSeconds ?? 0;
    const rounded = roomSeconds > 0 && roomSeconds < input.duration - 0.000001
        ? roundTransitionDurationForWrite(roomSeconds) : roomSeconds;
    const roomOutcome = rounded <= 0 ? 'none' : roomSeconds < input.duration - 0.000001 ? 'clamped' : 'full';
    return {
        ...(input.explicitAlign !== undefined ? { align: align === 'center' ? null : align } : {}),
        duration: roomOutcome === 'clamped' ? rounded : input.duration,
        roomOutcome, roomSeconds: roomOutcome === 'clamped' ? rounded : roomSeconds
    };
}
