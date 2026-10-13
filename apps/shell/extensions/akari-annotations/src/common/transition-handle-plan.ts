import { planTransitionHandleWindow } from '@akari-video/edit-store';
import { roundTransitionDurationForWrite } from './transition-duration';

export interface TransitionHandleCut {
    speed?: number;
    in?: number;
    out: number;
}

export interface TransitionHandleSegment {
    tlStart: number;
    tlEnd: number;
}

export function cachedTransitionHandleInput(input: {
    earlier: TransitionHandleSegment; later: TransitionHandleSegment;
    outgoing?: TransitionHandleCut; incoming?: TransitionHandleCut;
    outgoingStill: boolean; incomingStill: boolean;
    videoUri?: string; cached?: number | 'unavailable' | 'pending'; declaredSeconds: number;
}): Parameters<typeof planTransitionHandleWindow>[0] {
    const { earlier, later, outgoing, incoming, declaredSeconds } = input;
    const outgoingSpeed = typeof outgoing?.speed === 'number' && outgoing.speed > 0 ? outgoing.speed : 1;
    const incomingSpeed = typeof incoming?.speed === 'number' && incoming.speed > 0 ? incoming.speed : 1;
    let tailSeconds = Number.POSITIVE_INFINITY;
    if (!input.outgoingStill) {
        const videoUri = outgoing ? input.videoUri : undefined;
        const cached = videoUri ? input.cached : undefined;
        tailSeconds = typeof cached === 'number'
            ? Math.max(0, cached - (outgoing?.out ?? 0)) / outgoingSpeed
            : cached === 'unavailable' ? 0 : Number.POSITIVE_INFINITY;
    }
    return {
        declaredSeconds,
        outgoingTailRoomSeconds: tailSeconds,
        incomingHeadRoomSeconds: input.incomingStill
            ? Number.POSITIVE_INFINITY : Math.max(0, incoming?.in ?? 0) / incomingSpeed,
        outgoingDurationSeconds: Math.max(0, earlier.tlEnd - earlier.tlStart),
        incomingDurationSeconds: Math.max(0, later.tlEnd - later.tlStart)
    };
}

export function planCachedTransitionHandle(input: Parameters<typeof cachedTransitionHandleInput>[0]): ReturnType<typeof planTransitionHandleWindow> {
    return planTransitionHandleWindow(cachedTransitionHandleInput(input));
}

export function planNoUriTransitionHandle(input: {
    earlier: TransitionHandleSegment; later: TransitionHandleSegment;
    incoming?: TransitionHandleCut; incomingStill: boolean; declaredSeconds: number;
}): ReturnType<typeof planTransitionHandleWindow> {
    const { earlier, later, incoming, declaredSeconds } = input;
    const incomingSpeed = typeof incoming?.speed === 'number' && incoming.speed > 0 ? incoming.speed : 1;
    return planTransitionHandleWindow({
        declaredSeconds,
        outgoingTailRoomSeconds: 0,
        incomingHeadRoomSeconds: input.incomingStill
            ? Number.POSITIVE_INFINITY : Math.max(0, incoming?.in ?? 0) / incomingSpeed,
        outgoingDurationSeconds: Math.max(0, earlier.tlEnd - earlier.tlStart),
        incomingDurationSeconds: Math.max(0, later.tlEnd - later.tlStart)
    });
}

export function planFetchedTransitionHandle(input: {
    earlier: TransitionHandleSegment; later: TransitionHandleSegment;
    outgoing: TransitionHandleCut; incoming?: TransitionHandleCut;
    incomingStill: boolean; duration?: number | 'unavailable'; declaredSeconds: number;
}): ReturnType<typeof planTransitionHandleWindow> {
    const { earlier, later, outgoing, incoming, duration, declaredSeconds } = input;
    const outgoingSpeed = typeof outgoing.speed === 'number' && outgoing.speed > 0 ? outgoing.speed : 1;
    const incomingSpeed = typeof incoming?.speed === 'number' && incoming.speed > 0 ? incoming.speed : 1;
    return planTransitionHandleWindow({
        declaredSeconds,
        outgoingTailRoomSeconds: typeof duration === 'number'
            ? Math.max(0, duration - outgoing.out) / outgoingSpeed : 0,
        incomingHeadRoomSeconds: input.incomingStill
            ? Number.POSITIVE_INFINITY : Math.max(0, incoming?.in ?? 0) / incomingSpeed,
        outgoingDurationSeconds: Math.max(0, earlier.tlEnd - earlier.tlStart),
        incomingDurationSeconds: Math.max(0, later.tlEnd - later.tlStart)
    });
}

export function clampTransitionHandleForWrite(
    handle: ReturnType<typeof planTransitionHandleWindow>,
    declaredSeconds: number
): { handle: ReturnType<typeof planTransitionHandleWindow>; duration: number } {
    let writtenDuration = declaredSeconds;
    if (handle.outcome === 'clamped') {
        const roundedSeconds = roundTransitionDurationForWrite(handle.effectiveSeconds);
        handle = roundedSeconds > 0
            ? { ...handle, effectiveSeconds: roundedSeconds, halfSeconds: roundedSeconds / 2 }
            : { ...handle, effectiveSeconds: 0, halfSeconds: 0, outcome: 'none' };
        if (handle.outcome === 'clamped') {
            writtenDuration = handle.effectiveSeconds;
        }
    }
    return { handle, duration: writtenDuration };
}
