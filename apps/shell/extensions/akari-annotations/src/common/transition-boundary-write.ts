import type { BoundaryBlock, BoundaryRef } from './transition-boundary-model';
import { computeCutBoundaryCandidates, type CutBoundaryCandidate, type CutBoundaryInput } from './cut-boundaries';
import type { EditV2Document } from './edit-v2-mutations';

export interface DocumentBoundary {
    pairExists: boolean;
    blocks: BoundaryBlock[];
    overlapFrames: number;
    earlierTransition?: unknown;
}

/** Resolve the named pair against the document being written, including its current track lock. */
export function resolveBoundaryInDocument(
    doc: EditV2Document, ref: BoundaryRef, lockedTrackIds: ReadonlySet<string> = new Set()
): DocumentBoundary {
    const tracks = Array.isArray(doc.tracks) ? doc.tracks : [];
    const visual = tracks.filter((value): value is Record<string, unknown> =>
        !!value && typeof value === 'object' && (value as Record<string, unknown>).lane === 'visual');
    const cuts = visual.map(track => ({ track, items: Array.isArray(track.items)
        ? track.items.filter((value): value is Record<string, unknown> =>
            !!value && typeof value === 'object' && (value as Record<string, unknown>).source !== null
            && typeof (value as Record<string, unknown>).source === 'object'
            && ((value as Record<string, unknown>).source as Record<string, unknown>).kind === 'media')
            .sort((a, b) => Number(a.at) - Number(b.at)) : [] }));
    const earlierTrack = cuts.find(entry => entry.items.some(item => item.id === ref.earlierItemId));
    const earlier = earlierTrack?.items.find(item => item.id === ref.earlierItemId);
    const laterTrack = cuts.find(entry => entry.items.some(item => item.id === ref.laterItemId));
    const locked = !!earlierTrack && (earlierTrack.track.locked === true
        || lockedTrackIds.has(String(earlierTrack.track.id)) || earlier?.locked === true);
    const missing = { pairExists: false, blocks: [
        ...(locked ? ['locked' as const] : []), 'gap' as const
    ], overlapFrames: 0 };
    if (!earlier || !laterTrack || earlierTrack !== laterTrack) return missing;
    const index = earlierTrack.items.indexOf(earlier);
    const later = earlierTrack.items[index + 1];
    if (!later || later.id !== ref.laterItemId) return missing;
    const overlapFrames = Number(earlier.at) + Number(earlier.duration) - Number(later.at);
    const source = earlier.source as Record<string, unknown>;
    const declaration = source.transition_out as Record<string, unknown> | undefined;
    const declaredFrames = typeof declaration?.duration === 'number'
        ? Math.round(declaration.duration * Number((doc.output as Record<string, unknown> | undefined)?.fps ?? 30)) : 0;
    // Track-count and track-order rules stay with the caller's candidate check: a visual track that only
    // carries overlapping picture-in-picture clips is not a cuts track, and this document walk cannot tell.
    const blocks: BoundaryBlock[] = [];
    if (!Number.isFinite(overlapFrames) || overlapFrames < 0 || overlapFrames > declaredFrames) blocks.push('gap');
    if (locked || laterTrack.track.locked === true || later.locked === true) blocks.push('locked');
    return { pairExists: true, blocks, overlapFrames, earlierTransition: declaration };
}

/** Rebuild the candidate from current clips immediately before a transition write. */
export function validateTransitionBoundaryWrite(
    ref: BoundaryRef,
    segments: readonly CutBoundaryInput[],
    fps: number,
    videoTrackCount: number
): { candidate?: CutBoundaryCandidate; blocks: BoundaryBlock[]; pairExists: boolean } {
    const earlier = segments.find(segment => segment.itemId === ref.earlierItemId);
    const later = segments.find(segment => segment.itemId === ref.laterItemId);
    if (!earlier || !later || earlier.track !== later.track) return { blocks: earlier?.locked ? ['locked', 'gap'] : ['gap'], pairExists: false };
    const candidate = computeCutBoundaryCandidates(segments, fps, videoTrackCount).find(value =>
        value.ref.earlierItemId === ref.earlierItemId && value.ref.laterItemId === ref.laterItemId);
    return candidate ? { candidate, blocks: candidate.blocks, pairExists: true }
        : { blocks: earlier.locked ? ['locked', 'gap'] : ['gap'], pairExists: false };
}
