export interface PreviewTrackOrderInput {
    id: string;
    content?: { from?: string };
    items?: { id?: string; source?: { kind?: string }; children?: PreviewTrackOrderInput['items']; items?: PreviewTrackOrderInput['items'] }[];
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

const hasGroupedCaption = (items: PreviewTrackOrderInput['items'], insideGroup = false): boolean =>
    Boolean(items?.some(item => (insideGroup
        && (item.source?.kind === 'caption' || item.source?.kind === 'captions'))
        || hasGroupedCaption(item.children ?? item.items, insideGroup || item.source?.kind === 'group')));

/** group 字幕を含む木だけ、段と子の宣言順を CSS の整数 z へ写す。 */
export function resolvePreviewItemStackOrder(
    tracks: readonly PreviewTrackOrderInput[]
): { itemStackZ: Record<string, number>; trackStackZ: Record<string, number> } | undefined {
    if (!tracks.some(track => hasGroupedCaption(track.items))) return undefined;

    const itemStackZ: Record<string, number> = Object.create(null);
    const trackStackZ: Record<string, number> = Object.create(null);
    let z = 0;
    const visit = (items: PreviewTrackOrderInput['items']): void => {
        for (const item of items ?? []) {
            if (item.id) itemStackZ[item.id] = z;
            z += 1;
            visit(item.children ?? item.items);
        }
    };
    for (const track of tracks) {
        trackStackZ[track.id] = z++;
        visit(track.items);
    }
    return { itemStackZ, trackStackZ };
}

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
    const declaredCaption = tracks.find(track =>
        track.content?.from === 'captions.json'
        || hasKind(track.items, 'captions')
    ) ?? tracks.find(track => hasGroupedCaption(track.items));
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
