export interface GuideAnnouncementFacts {
    hasOpenProject: boolean;
    hasProjectHistory: boolean;
    hasCreatorRootPointer: boolean;
    hasWorkspaceDirectory: boolean;
    legacySetupMarkerSeen: boolean;
    guideStateSeen: boolean;
    announcementMarkerSeen: boolean;
}

export interface GuideAnnouncementDecision {
    show: boolean;
    record: boolean;
}

/** A guide already used, a fresh install, and a previously announced install all stay quiet. */
export function guideAnnouncementDecision(facts: GuideAnnouncementFacts): GuideAnnouncementDecision {
    const existingUser = facts.hasOpenProject || facts.hasProjectHistory
        || facts.hasCreatorRootPointer || facts.hasWorkspaceDirectory || facts.legacySetupMarkerSeen;
    const show = existingUser && !facts.guideStateSeen && !facts.announcementMarkerSeen;
    return { show, record: show };
}

export function guideAnnouncementMarker(decision: GuideAnnouncementDecision, shownAt: string):
    { schema: 1; shownAt: string } | undefined {
    return decision.record ? { schema: 1, shownAt } : undefined;
}
