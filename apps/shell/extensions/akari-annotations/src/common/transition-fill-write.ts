import { chooseTransitionAlign, planTrackTransitions, readTransitionAlign,
    type TransitionAlign, type TransitionBoundaryPlan, type TransitionPlanClip } from '@akari-video/edit-store';

export interface TransitionFillRequest {
    type: string;
    duration: number;
    align?: TransitionAlign | null;
    recommendAlign?: true;
    alignOnly?: true;
    fillOnly?: true;
}

export interface TransitionFillFacts {
    align: TransitionAlign;
    declaredSeconds: number;
    effectiveSeconds: number;
    freezeIncomingSeconds: number;
    freezeOutgoingSeconds: number;
    freezeOutgoingUnknown: boolean;
}

export type TransitionWriteDecision =
    | { kind: 'none' }
    | { kind: 'retype' | 'change'; patch: { type: string; duration: number; align?: TransitionAlign | null;
        fill?: 'freeze' | null }; incomingSeconds?: number }
    | { kind: 'attach' | 'fill'; patch: { type: string; duration: number; align?: TransitionAlign | null;
        fill?: 'freeze' | null }; confirmation?: TransitionFillFacts };

function planned(clips: readonly TransitionPlanClip[], earlierId: string, seconds: number,
    align: TransitionAlign, fill: boolean, fps: number): TransitionBoundaryPlan | undefined {
    const next = clips.map(clip => clip.id === earlierId ? { ...clip,
        transitionOut: { declaredSeconds: seconds, align, fill } } : clip);
    return planTrackTransitions(next, { fps, tailRoom: 'ignore' }).find(plan => plan.earlierId === earlierId);
}

export function transitionFillFacts(plan: TransitionBoundaryPlan, seconds: number): TransitionFillFacts {
    return { align: plan.align, declaredSeconds: seconds, effectiveSeconds: plan.effectiveSeconds,
        freezeIncomingSeconds: plan.freezeIncomingSeconds ?? 0,
        freezeOutgoingSeconds: plan.freezeOutgoingSeconds ?? 0,
        freezeOutgoingUnknown: !!plan.freezeOutgoingUnknown };
}

export function canFillTransition(input: { clips: readonly TransitionPlanClip[]; earlierId: string;
    existing?: Record<string, unknown>; fps: number; blocked?: boolean; legacyOverlap?: boolean }):
    TransitionFillFacts | undefined {
    const { existing, fps } = input;
    if (!existing || input.blocked || input.legacyOverlap || existing.fill === 'freeze'
        || typeof existing.duration !== 'number') return undefined;
    const align = readTransitionAlign(existing.align);
    const plain = planned(input.clips, input.earlierId, existing.duration, align, false, fps);
    const filled = planned(input.clips, input.earlierId, existing.duration, align, true, fps);
    return filled && (filled.effectiveSeconds - (plain?.effectiveSeconds ?? 0)) >= 1 / fps - 1e-6
        ? transitionFillFacts(filled, existing.duration) : undefined;
}

export function decideTransitionWrite(input: { clips: readonly TransitionPlanClip[]; earlierId: string;
    existing?: Record<string, unknown>; request: TransitionFillRequest; fps: number;
    blocked?: boolean; legacyOverlap?: boolean }): TransitionWriteDecision {
    const { existing, request, clips, earlierId, fps } = input;
    if (request.fillOnly) {
        const confirmation = canFillTransition(input);
        return confirmation ? { kind: 'fill', patch: { type: String(existing!.type),
            duration: Number(existing!.duration), fill: 'freeze' }, confirmation } : { kind: 'none' };
    }
    if (existing && request.duration === existing.duration && request.align === undefined
        && !request.recommendAlign && !request.alignOnly) {
        return { kind: 'retype', patch: { type: request.type, duration: Number(existing.duration) } };
    }
    if (!existing) {
        const choice = request.align === undefined ? chooseTransitionAlign(clips, earlierId, request.duration,
            { fps, tailRoom: 'ignore', allowFill: true }) : undefined;
        const requestedAlign = request.align ?? 'center';
        const filled = request.align !== undefined
            ? planned(clips, earlierId, request.duration, requestedAlign, true, fps) : undefined;
        const plain = request.align !== undefined ? planTrackTransitions(clips.map(clip => clip.id === earlierId
            ? { ...clip, tailRoomSeconds: clip.tailRoomSeconds ?? 0,
                transitionOut: { declaredSeconds: request.duration, align: requestedAlign, fill: false } }
            : { ...clip, tailRoomSeconds: Number.POSITIVE_INFINITY }),
        { fps, tailRoom: 'limit' }).find(plan => plan.earlierId === earlierId) : undefined;
        if (!choice && !filled) return { kind: 'none' };
        const align = choice?.align ?? requestedAlign;
        const needsFill = choice?.needsFill ?? (!!filled
            && filled.effectiveSeconds - (plain?.effectiveSeconds ?? 0) >= 1 / fps - 1e-6);
        const plan = choice?.plan ?? filled!;
        const patch = { type: request.type, duration: request.duration,
            ...(align === 'center' ? {} : { align }),
            ...(needsFill ? { fill: 'freeze' as const } : {}) };
        return { kind: 'attach', patch,
            ...(needsFill ? { confirmation: transitionFillFacts(plan, request.duration) } : {}) };
    }
    const align = request.align !== undefined ? request.align ?? 'center'
        : request.recommendAlign ? chooseTransitionAlign(clips, earlierId, request.duration,
            { fps, tailRoom: 'ignore', allowFill: false })?.align ?? 'center'
            : readTransitionAlign(existing.align);
    const duration = request.alignOnly ? Number(existing.duration) : request.duration;
    const plan = planned(clips, earlierId, duration, align, true, fps);
    const unknownFill = existing.fill !== undefined && existing.fill !== 'freeze';
    const fill = unknownFill ? undefined : plan && plan.freezeIncomingSeconds > 0 ? 'freeze'
        : plan && !plan.freezeOutgoingUnknown && plan.freezeOutgoingSeconds <= 1e-6 ? null : undefined;
    return { kind: 'change', patch: { type: request.type, duration,
        ...(request.align !== undefined || request.recommendAlign || request.alignOnly
            ? { align: align === 'center' ? null : align } : {}),
        ...(fill !== undefined ? { fill } : {}) },
        ...(fill === 'freeze' && existing.fill !== 'freeze'
            ? { incomingSeconds: plan!.freezeIncomingSeconds } : {}) };
}

export function confirmedTransitionPatch(input: { confirmed: TransitionFillFacts;
    decision: TransitionWriteDecision; after?: TransitionFillFacts; type: string }):
    { type: string; duration: number; align?: TransitionAlign | null; fill?: 'freeze' | null } | undefined {
    const { confirmed, decision, after, type } = input;
    if ((decision.kind !== 'attach' && decision.kind !== 'fill')
        || !after || !compareTransitionConfirmation(confirmed, after)) return undefined;
    const noFreeze = after.freezeIncomingSeconds <= 1e-6 && !after.freezeOutgoingUnknown
        && after.freezeOutgoingSeconds <= 1e-6;
    if (decision.kind === 'fill') return noFreeze ? undefined : { ...decision.patch, fill: 'freeze' };
    return { type, duration: confirmed.declaredSeconds,
        ...(confirmed.align === 'center' ? {} : { align: confirmed.align }),
        ...(noFreeze ? {} : { fill: 'freeze' }) };
}

export function compareTransitionConfirmation(before: TransitionFillFacts, after: TransitionFillFacts): boolean {
    const tolerance = 1e-6;
    return before.align === after.align && Math.abs(before.declaredSeconds - after.declaredSeconds) <= tolerance
        && after.freezeIncomingSeconds <= before.freezeIncomingSeconds + tolerance
        && after.freezeOutgoingSeconds <= before.freezeOutgoingSeconds + tolerance
        && after.effectiveSeconds + tolerance >= before.effectiveSeconds;
}

export function refreshedTransitionConfirmation(clips: readonly TransitionPlanClip[], earlierId: string,
    before: TransitionFillFacts, fps: number): TransitionFillFacts | undefined {
    const plan = planned(clips, earlierId, before.declaredSeconds, before.align, true, fps);
    return plan ? transitionFillFacts(plan, before.declaredSeconds) : undefined;
}

export function transitionFillBodyKey(facts: TransitionFillFacts): string {
    const outgoing = facts.freezeOutgoingSeconds > 0;
    const incoming = facts.freezeIncomingSeconds > 0;
    if (outgoing && incoming) return facts.freezeOutgoingUnknown
        ? 'transition.fill.ask.bodyBothUpTo' : 'transition.fill.ask.bodyBoth';
    if (outgoing) return facts.freezeOutgoingUnknown
        ? 'transition.fill.ask.bodyOutgoingUpTo' : 'transition.fill.ask.bodyOutgoing';
    return 'transition.fill.ask.bodyIncoming';
}
