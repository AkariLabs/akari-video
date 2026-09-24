export interface PreviewTrackOrderInput {
    id: string;
    content?: { from?: string };
    items?: { source?: { kind?: string }; children?: PreviewTrackOrderInput['items']; items?: PreviewTrackOrderInput['items'] }[];
}

export interface PreviewTrackOrderEntry {
    id: string;
    z: number;
}

export interface PreviewCaptionTrackOrder {
    tracks: PreviewTrackOrderEntry[];
    captionTrackId?: string;
}

const IMPLIED_CAPTION_TRACK_ID = 't-captions-implied';

/**
 * Builds the preview stacking order from the declared tracks and adds the same display-only
 * top caption lane that the timeline uses when captions.json has cues but no caption track.
 */
export function resolvePreviewCaptionTrackOrder(
    tracks: readonly PreviewTrackOrderInput[],
    hasCaptions: boolean
): PreviewCaptionTrackOrder {
    const resolved = tracks.map((track, z) => ({ id: track.id, z }));
    const hasKind = (items: PreviewTrackOrderInput['items'], kind: string): boolean => Boolean(items?.some(item =>
        item.source?.kind === kind || hasKind(item.children ?? item.items, kind)));
    const hasGroupCaption = (items: PreviewTrackOrderInput['items'], insideGroup = false): boolean =>
        Boolean(items?.some(item => (insideGroup && item.source?.kind === 'caption')
            || hasGroupCaption(item.children ?? item.items, insideGroup || item.source?.kind === 'group')));
    const declaredCaption = tracks.find(track =>
        track.content?.from === 'captions.json'
        || hasKind(track.items, 'captions')
    ) ?? tracks.find(track => hasGroupCaption(track.items));
    if (declaredCaption) {
        return { tracks: resolved, captionTrackId: declaredCaption.id };
    }
    if (!hasCaptions) {
        return { tracks: resolved };
    }
    return {
        tracks: [...resolved, { id: IMPLIED_CAPTION_TRACK_ID, z: resolved.length }],
        captionTrackId: IMPLIED_CAPTION_TRACK_ID
    };
}
