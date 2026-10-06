/** A background webview has no rAF; keep short caption entrances observable there. */
export function captionPlaybackStallMs(visibilityState: string): number {
    return visibilityState === 'hidden' ? 120 : 400;
}
