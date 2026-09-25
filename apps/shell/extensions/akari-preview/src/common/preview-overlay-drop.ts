export function previewOverlayKind(payload: { kind?: string; category?: string; key?: string } | undefined):
    'overlay' | 'scene3d' | undefined {
    if (!payload?.key) return undefined;
    if (payload.kind === 'overlay' && payload.category === 'overlay') return 'overlay';
    if (payload.kind === 'scene3d' && payload.category === 'scene3d') return 'scene3d';
    return undefined;
}

const claimedScene3dSessions = new WeakSet<object>();

/** Output preview widgets share the same drag-start detail object for one gesture. */
export function claimScene3dDrop(session: object | undefined): boolean {
    if (!session) return true;
    if (claimedScene3dSessions.has(session)) return false;
    claimedScene3dSessions.add(session);
    return true;
}
