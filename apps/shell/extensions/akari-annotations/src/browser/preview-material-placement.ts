import { materialOverlapInsertIndex } from '../common/material-drop-overlap';

function acceptsVisualMedia(track: Record<string, unknown>): boolean {
    if (track.lane !== 'visual' || !Array.isArray(track.items) || track.kind === 'captions') return false;
    const content = track.content as { from?: unknown } | undefined;
    if (content?.from === 'captions.json') return false;
    if (track.items.length === 0) return true;
    return track.items.some(item => {
        const source = (item as { source?: { kind?: unknown } } | undefined)?.source;
        return source?.kind !== 'captions' && source?.kind !== 'caption'
            && source?.kind !== 'text' && source?.kind !== 'telop';
    });
}

/** tracks[] runs from back to front. */
export function topVisualTarget(tracks: readonly Record<string, unknown>[], range: { at: number; duration: number }): {
    targetTrackId?: string; insertIndex?: number
} {
    let index = -1;
    for (let i = 0; i < tracks.length; i++) if (acceptsVisualMedia(tracks[i])) index = i;
    if (index < 0) return { insertIndex: tracks.length };
    const targetTrackId = String(tracks[index].id);
    const overlap = materialOverlapInsertIndex(tracks as Record<string, unknown>[], targetTrackId, range);
    return overlap === undefined ? { targetTrackId } : { insertIndex: overlap };
}
