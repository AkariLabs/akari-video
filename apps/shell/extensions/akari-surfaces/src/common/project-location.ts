/** Location relative to a creator root. Scenes are exactly one level deep. */
export interface ProjectLocation { channel: string; project: string; scene?: string }

export function projectLocation(relative: string | undefined): ProjectLocation | undefined {
    const parts = relative?.split('/');
    if (!parts || (parts.length !== 4 && parts.length !== 6)
        || parts[0] !== 'channels' || parts[2] !== 'videos'
        || !parts[1] || !parts[3]) return undefined;
    if (parts.length === 6 && (parts[4] !== 'scenes' || !parts[5])) return undefined;
    return { channel: parts[1], project: parts[3], ...(parts.length === 6 ? { scene: parts[5] } : {}) };
}
