import type { BoundaryBlock, BoundaryRef } from './transition-boundary-model';
import { computeCutBoundaryCandidates, type CutBoundaryCandidate, type CutBoundaryInput } from './cut-boundaries';

/** Rebuild the candidate from current clips immediately before a transition write. */
export function validateTransitionBoundaryWrite(
    ref: BoundaryRef,
    segments: readonly CutBoundaryInput[],
    fps: number,
    videoTrackCount: number
): { candidate?: CutBoundaryCandidate; blocks: BoundaryBlock[] } {
    const earlier = segments.find(segment => segment.itemId === ref.earlierItemId);
    const later = segments.find(segment => segment.itemId === ref.laterItemId);
    if (!earlier || !later || earlier.track !== later.track) return { blocks: ['gap'] };
    const candidate = computeCutBoundaryCandidates(segments, fps, videoTrackCount).find(value =>
        value.ref.earlierItemId === ref.earlierItemId && value.ref.laterItemId === ref.laterItemId);
    return candidate ? { candidate, blocks: candidate.blocks } : { blocks: ['gap'] };
}
