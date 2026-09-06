/** Audibility belongs to the owning track and item, independently of its speech role. */
export function isAudioItemAudible(
    track: { muted?: unknown } | null | undefined,
    item: { mute?: unknown } | null | undefined
): boolean {
    return track?.muted !== true && item?.mute !== true;
}

/** A detached cut keeps its pixels and timing but never supplies embedded audio. */
export function isCutAudioAudible(
    cut: { audio?: unknown; mute?: unknown },
    track?: { muted?: unknown }
): boolean {
    return cut.audio !== false && isAudioItemAudible(track, cut);
}
