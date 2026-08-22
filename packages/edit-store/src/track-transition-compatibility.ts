/**
 * gap-aware track engine で transition_out を宣言できるかを判定する共有カーネル。
 * edit-lint とタイムライン UI は必ずこの関数を使い、条件式を複製しない。
 */

export interface TrackTransitionCutLike {
    track?: unknown;
    transition_out?: unknown;
}

export interface TrackTransitionTrackLike {
    kind?: unknown;
    ref?: unknown;
}

export interface UnsupportedDeclaredTrackTransition {
    cutIndex: number;
    trackRef: number;
}

const DEFAULT_TRACK_KIND_RANK = new Map<unknown, number>([
    ['cuts', 0],
    ['layers', 1],
    ['overlays', 2],
    ['captions', 3],
    ['audio', 4]
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function usesDefaultCompatibilityTrackOrder(tracks: unknown): boolean {
    if (!Array.isArray(tracks)) return false;
    const keys = tracks.map((track, index) => {
        const candidate = track as TrackTransitionTrackLike | null | undefined;
        return {
            kind: candidate?.kind,
            ref: Number.isInteger(candidate?.ref) ? candidate?.ref as number : -1,
            index
        };
    });
    if (keys.some(key => !DEFAULT_TRACK_KIND_RANK.has(key.kind))) return false;
    const expected = [...keys].sort((left, right) =>
        DEFAULT_TRACK_KIND_RANK.get(left.kind)! - DEFAULT_TRACK_KIND_RANK.get(right.kind)!
        || left.ref - right.ref
        || left.index - right.index);
    return keys.every((key, index) => key.index === expected[index].index);
}

/**
 * cutIndex の transition_out が gap-aware 経路で表現不能なら対象 track ref を返す。
 * transition_out の有無は見ないため、宣言前ガードにも既存宣言の検出にも同じ関数を使える。
 */
export function unsupportedTrackTransitionTarget(
    cuts: unknown,
    tracks: unknown,
    cutIndex: number
): number | undefined {
    if (!Array.isArray(cuts) || !Array.isArray(tracks)) return undefined;
    if (!Number.isInteger(cutIndex) || cutIndex < 0 || cutIndex >= cuts.length) return undefined;
    if (usesDefaultCompatibilityTrackOrder(tracks)) return undefined;

    const cut = cuts[cutIndex];
    if (!isRecord(cut)) return undefined;
    const ref = cut.track ?? 0;
    if (!Number.isInteger(ref) || (ref as number) < 0) return undefined;
    const trackRef = ref as number;
    const declared = tracks.some(track => isRecord(track)
        && track.kind === 'cuts' && Number.isInteger(track.ref) && (track.ref as number) >= 0
        && track.ref === trackRef);
    if (!declared) return undefined;

    const hasFollowingCutOnTrack = cuts.slice(cutIndex + 1).some(candidate =>
        isRecord(candidate) && (candidate.track ?? 0) === trackRef);
    return hasFollowingCutOnTrack ? trackRef : undefined;
}

export function findUnsupportedDeclaredTrackTransitions(
    cuts: unknown,
    tracks: unknown
): UnsupportedDeclaredTrackTransition[] {
    if (!Array.isArray(cuts)) return [];
    const unsupported: UnsupportedDeclaredTrackTransition[] = [];
    cuts.forEach((cut, cutIndex) => {
        if (!isRecord(cut) || !cut.transition_out) return;
        const trackRef = unsupportedTrackTransitionTarget(cuts, tracks, cutIndex);
        if (trackRef !== undefined) unsupported.push({ cutIndex, trackRef });
    });
    return unsupported;
}
