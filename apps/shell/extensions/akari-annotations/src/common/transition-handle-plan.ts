interface HandleInput {
    declaredSeconds: number;
    outgoingTailRoomSeconds: number;
    incomingHeadRoomSeconds: number;
    outgoingDurationSeconds: number;
    incomingDurationSeconds: number;
}

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
}): HandleInput {
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
