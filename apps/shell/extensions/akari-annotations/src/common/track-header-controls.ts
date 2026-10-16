export type TrackHeaderKind = 'video' | 'overlay' | 'layer' | 'audio' | 'caption' | 'beat';

export const TRACK_HEADER_WIDTH_STORAGE_KEY = 'akari.timeline.trackHeaderWidth.v1';
export const TRACK_HEADER_MIN_WIDTH = 136;
export const TRACK_HEADER_MAX_WIDTH = 360;

export interface TrackHeaderStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export function clampTrackHeaderWidth(width: number): number {
    return Number.isFinite(width)
        ? Math.round(Math.min(TRACK_HEADER_MAX_WIDTH, Math.max(TRACK_HEADER_MIN_WIDTH, width)))
        : TRACK_HEADER_MIN_WIDTH;
}

export function readTrackHeaderWidth(storage: TrackHeaderStorage | undefined): number {
    try {
        const stored = storage?.getItem(TRACK_HEADER_WIDTH_STORAGE_KEY);
        return stored === null || stored === undefined || stored.trim() === ''
            ? TRACK_HEADER_MIN_WIDTH : clampTrackHeaderWidth(Number(stored));
    } catch {
        return TRACK_HEADER_MIN_WIDTH;
    }
}

export function writeTrackHeaderWidth(storage: TrackHeaderStorage | undefined, width: number): void {
    try {
        storage?.setItem(TRACK_HEADER_WIDTH_STORAGE_KEY, String(clampTrackHeaderWidth(width)));
    } catch {
        // The column remains usable if browser storage is unavailable.
    }
}

/** Add the largest name's missing space to the column, respecting the drag limits. */
export function widthForLongestTrackHeaderName(
    currentWidth: number, names: readonly { scrollWidth: number; clientWidth: number }[]
): number {
    const missing = Math.max(0, ...names.map(name => Math.max(0, name.scrollWidth - name.clientWidth)));
    return clampTrackHeaderWidth(currentWidth + missing);
}

export type TrackHeaderIconKind = TrackHeaderKind | 'image' | 'sfx' | 'bgm' | 'narration'
    | 'placeholder' | 'script' | 'map';

export function iconKindForTrackHeaderItem(sourceKind: string, role?: string, path?: string): TrackHeaderIconKind {
    if (role === 'bgm' || role === 'sfx' || role === 'narration') return role;
    if (sourceKind === 'group') return 'placeholder';
    if (sourceKind === 'caption' || sourceKind === 'captions' || sourceKind === 'telop') return 'caption';
    if (sourceKind === 'media') {
        if (/\.(png|jpe?g|webp|gif|avif|svg|bmp|tiff?)(?:[?#]|$)/i.test(path ?? '')) return 'image';
        if (/\.(mp3|wav|m4a|aac|flac|ogg|opus)(?:[?#]|$)/i.test(path ?? '')) return 'audio';
        return 'video';
    }
    if (sourceKind === 'audio') return 'audio';
    if (sourceKind === 'html' || sourceKind === 'shape' || sourceKind === 'filter') return 'overlay';
    return 'layer';
}

/** Resolve a v2 media source ID before checking its file extension. */
export function sourcePathForTrackHeader(
    sourceId: string,
    rawSources: readonly { id: string; path?: string }[] | undefined,
    normalizedSources: readonly { id: string; path?: string }[] = []
): string | undefined {
    const rawPath = rawSources?.find(source => source.id === sourceId)?.path;
    if (typeof rawPath === 'string') return rawPath;
    const normalizedPath = normalizedSources.find(source => source.id === sourceId)?.path;
    return typeof normalizedPath === 'string' ? normalizedPath : undefined;
}

/** Tree row IDs can refer to media nested inside a group's items[]. */
export function findNestedTrackHeaderItem(tracks: unknown, itemId: string): Record<string, any> | undefined {
    if (!Array.isArray(tracks)) return undefined;
    const visit = (items: unknown): Record<string, any> | undefined => {
        if (!Array.isArray(items)) return undefined;
        for (const candidate of items) {
            if (!candidate || typeof candidate !== 'object') continue;
            const item = candidate as Record<string, any>;
            if (item.id === itemId) return item;
            const nested = visit(item.items);
            if (nested) return nested;
        }
        return undefined;
    };
    for (const track of tracks) {
        const item = visit(track?.items);
        if (item) return item;
    }
    return undefined;
}

export function iconKindForVisualTrackHeader(
    items: readonly { source: { kind: string; src?: string } }[],
    sourcePath: (sourceId: string) => string | undefined,
    fallback: TrackHeaderKind
): TrackHeaderIconKind {
    if (items.length && items.every(item => item.source.kind === 'group')) return 'placeholder';
    if (items.length && items.every(item => item.source.kind === 'media'
        && iconKindForTrackHeaderItem('media', undefined, sourcePath(item.source.src ?? '')) === 'image')) return 'image';
    return fallback;
}

/** A v2 track's omitted role is ordinary audio; legacy projections are used only without a raw track. */
export function iconKindForAudioTrackHeader(
    rawItems: readonly { role?: string }[] | undefined,
    legacyRoles: readonly string[] = []
): TrackHeaderIconKind {
    const roles = rawItems === undefined ? legacyRoles : rawItems.map(item => item.role);
    if (!roles.length || roles.some(role => role !== roles[0])) return 'audio';
    const role = roles[0];
    return role === 'sfx' || role === 'bgm' || role === 'narration' ? role : 'audio';
}

/** Only expose controls that apply to this track's output. */
export function trackHeaderControls(kind: TrackHeaderKind): {
    visibility: boolean;
    fragmentBreaks: boolean;
    mute: boolean;
    lock: true;
} {
    return {
        visibility: kind !== 'audio',
        fragmentBreaks: kind === 'caption',
        mute: kind === 'video' || kind === 'overlay' || kind === 'layer' || kind === 'audio',
        lock: true
    };
}
