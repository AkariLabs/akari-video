export const LIBRARY_HOVER_DELAY_MS = 400;
export const LIBRARY_HOVER_DESCRIPTION_ID = 'akari-library-hover-description';

export type LibraryHoverKind = 'asset' | 'transition' | 'font';

export interface LibraryHoverSpec {
    src?: string;
    source?: string;
    kind: LibraryHoverKind;
    width: number;
    height: number;
}

/** The card's full preview remains separate from its small shelf thumbnail. */
export function libraryHoverPreview(category: string, previewUrl?: string, stripUrl?: string, sourceUrl?: string): LibraryHoverSpec | undefined {
    if (category === 'font') return { src: previewUrl, source: sourceUrl, kind: 'font', width: 320, height: 200 };
    if (category === 'transition') {
        return stripUrl ? { src: stripUrl, kind: 'transition', width: 192, height: 108 } : undefined;
    }
    if (!['asset', 'overlay', 'still', 'scene3d'].includes(category)) return undefined;
    if (stripUrl) return { src: stripUrl, kind: 'transition', width: 192, height: 108 };
    if (!previewUrl) return undefined;
    return { src: previewUrl, kind: 'asset', width: 320, height: 180 };
}
