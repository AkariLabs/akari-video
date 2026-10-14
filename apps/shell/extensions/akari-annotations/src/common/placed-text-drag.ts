import { t } from '@akari-video/i18n';
export type PlacedTextDestination =
    | { kind: 'track'; trackId: string }
    | { kind: 'new-track'; insertIndex: number }
    | { kind: 'placed-text' }
    | { kind: 'rejected' };

export function startsPlacedTextVerticalDrag(input: {
    kind: string; mode?: string; timeDomain?: string;
    startClientY: number; clientY: number; threshold: number;
}): boolean {
    return input.kind === 'caption' && input.mode === 'move' && input.timeDomain === 'output'
        && Math.abs(input.clientY - input.startClientY) > input.threshold;
}

/** 置いた文字の時刻と縦の着地先を同時に計画する。 */
export function planPlacedTextMove(input: {
    originalStart: number;
    originalEnd: number;
    proposedStart: number;
    originalTop: string;
    clientY: number;
    stripTop?: number;
    rows?: readonly { id: string; lane: 'visual' | 'audio' | 'placed-text' | 'caption-bag' | 'other';
        top: number; height: number }[];
    visualHit?: { top: number; targetTrackId?: string; insertIndex?: number; rejected: boolean };
    fps?: number;
    trackItems?: readonly { trackId: string; id: string; at: number; duration: number }[];
    movingItemId?: string;
}): { start: number; end: number; top: string; destination: PlacedTextDestination; reason?: string } {
    const start = Math.max(0, input.proposedStart);
    const end = input.originalEnd + start - input.originalStart;
    const y = input.clientY - (input.stripTop ?? 0);
    const row = input.rows?.find(candidate => y >= candidate.top && y < candidate.top + candidate.height);
    const hit = input.visualHit;
    const atBoundary = hit?.insertIndex !== undefined && !hit.rejected && Math.abs(y - hit.top) <= 4;
    const target: PlacedTextDestination = row?.lane === 'placed-text'
        ? { kind: 'placed-text' }
        : atBoundary && (!row || row.lane === 'visual')
            ? { kind: 'new-track', insertIndex: hit.insertIndex }
            : row?.lane === 'visual'
                ? { kind: 'track', trackId: row.id }
                : { kind: 'rejected' };
    const at = Math.max(0, Math.round(start * (input.fps ?? 1)));
    const duration = Math.max(1, Math.round((end - start) * (input.fps ?? 1)));
    const overlap = target.kind === 'track' && input.trackItems?.some(item =>
        item.trackId === target.trackId && item.id !== input.movingItemId
        && at < item.at + item.duration && item.at < at + duration);
    const destination: PlacedTextDestination = overlap ? { kind: 'rejected' } : target;
    return {
        start,
        end,
        top: destination.kind === 'new-track' ? `${hit!.top}px`
            : destination.kind === 'track' || destination.kind === 'placed-text' || overlap
                ? `${row!.top}px` : input.originalTop,
        destination,
        ...(destination.kind === 'rejected' ? { reason: overlap ? t('annotationscommon.placedTextDrag.reason.trackOverlap')
            : row?.lane === 'audio'
            ? t('annotationscommon.placedTextDrag.reason.audioTrack') : row?.lane === 'caption-bag'
                ? t('annotationscommon.placedTextDrag.reason.captionTrack') : t('annotationscommon.placedTextDrag.reason.cannotPlace') } : {})
    };
}
