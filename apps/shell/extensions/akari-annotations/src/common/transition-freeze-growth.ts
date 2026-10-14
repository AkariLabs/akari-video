import type { TransitionBoundaryPlan } from '@akari-video/edit-store';

export interface TransitionFreezeSnapshot {
    pair: string;
    incoming: number;
    outgoing: number;
    outgoingKnown: boolean;
}

export interface TransitionFreezeGrowth {
    from: number;
    to: number;
    seconds: string;
}

export function transitionFreezeSnapshot(plans: readonly TransitionBoundaryPlan[], itemIds: readonly string[]):
    TransitionFreezeSnapshot[] {
    return plans.flatMap(plan => {
        const earlier = itemIds[Number(plan.earlierId)];
        const later = itemIds[Number(plan.laterId)];
        if (!earlier || !later || plan.state === 'none' || plan.legacyOverlap) return [];
        return [{ pair: JSON.stringify([earlier, later]), incoming: plan.freezeIncomingSeconds ?? 0,
            outgoing: plan.freezeOutgoingSeconds ?? 0, outgoingKnown: !plan.freezeOutgoingUnknown }];
    });
}

export function transitionFreezeGrowth(before: readonly TransitionFreezeSnapshot[],
    afterPlans: readonly TransitionBoundaryPlan[], itemIds: readonly string[], excludedPair?: readonly [string, string]):
    TransitionFreezeGrowth[] {
    const previous = new Map(before.map(entry => [entry.pair, entry]));
    const excluded = excludedPair ? JSON.stringify(excludedPair) : undefined;
    return afterPlans.flatMap(plan => {
        const from = Number(plan.earlierId) + 1;
        const to = Number(plan.laterId) + 1;
        const earlier = itemIds[from - 1];
        const later = itemIds[to - 1];
        if (!earlier || !later || plan.state === 'none' || plan.legacyOverlap) return [];
        const pair = JSON.stringify([earlier, later]);
        const old = previous.get(pair);
        if (!old || pair === excluded) return [];
        const compareOutgoing = old.outgoingKnown && !plan.freezeOutgoingUnknown;
        const previousTotal = old.incoming + (compareOutgoing ? old.outgoing : 0);
        const total = (plan.freezeIncomingSeconds ?? 0)
            + (compareOutgoing ? plan.freezeOutgoingSeconds ?? 0 : 0);
        if (Number(total.toFixed(2)) <= Number(previousTotal.toFixed(2))) return [];
        const displayTotal = (plan.freezeIncomingSeconds ?? 0)
            + (plan.freezeOutgoingUnknown ? 0 : plan.freezeOutgoingSeconds ?? 0);
        return [{ from, to, seconds: displayTotal.toFixed(2) }];
    });
}
