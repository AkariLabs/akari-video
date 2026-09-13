export type TrackHeaderKind = 'video' | 'overlay' | 'layer' | 'audio' | 'caption' | 'beat';

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
