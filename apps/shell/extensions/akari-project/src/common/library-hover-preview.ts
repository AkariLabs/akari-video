export const LIBRARY_HOVER_DELAY_MS = 300;
export const LIBRARY_HOVER_DESCRIPTION_ID = 'akari-library-hover-description';

export type LibraryHoverKind = 'asset' | 'transition';

export interface LibraryHoverSpec {
    src: string;
    kind: LibraryHoverKind;
    width: number;
    height: number;
}

/** The card's full preview remains separate from its small shelf thumbnail. */
export function libraryHoverPreview(category: string, previewUrl?: string, stripUrl?: string): LibraryHoverSpec | undefined {
    if (category === 'transition') {
        return stripUrl ? { src: stripUrl, kind: 'transition', width: 192, height: 108 } : undefined;
    }
    if (!['asset', 'overlay', 'still', 'scene3d'].includes(category)) return undefined;
    if (stripUrl) return { src: stripUrl, kind: 'transition', width: 192, height: 108 };
    if (!previewUrl) return undefined;
    return { src: previewUrl, kind: 'asset', width: 320, height: 180 };
}
