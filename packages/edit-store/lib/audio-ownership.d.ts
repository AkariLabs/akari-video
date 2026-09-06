/** Audibility belongs to the owning track and item, independently of its speech role. */
export declare function isAudioItemAudible(track: {
    muted?: unknown;
} | null | undefined, item: {
    mute?: unknown;
} | null | undefined): boolean;
/** A detached cut keeps its pixels and timing but never supplies embedded audio. */
export declare function isCutAudioAudible(cut: {
    audio?: unknown;
    mute?: unknown;
}, track?: {
    muted?: unknown;
}): boolean;
