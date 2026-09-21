export interface MaterialFrameRange {
    readonly at: number;
    readonly duration: number;
}

/** フレームの半開区間で判定する。端が接するだけなら同じトラックに置ける。 */
export function materialRangeOverlaps(
    items: readonly MaterialFrameRange[], range: MaterialFrameRange
): boolean {
    return range.duration > 0 && items.some(item => item.duration > 0
        && range.at < item.at + item.duration && item.at < range.at + range.duration);
}

/** tracks[] は画面の下から上の順。映像は対象行の上、音は下へ挿入する。 */
export function materialOverlapInsertIndex(
    tracks: readonly Record<string, unknown>[], targetTrackId: string | undefined,
    range: MaterialFrameRange
): number | undefined {
    if (targetTrackId === undefined) return undefined;
    const index = tracks.findIndex(track => track.id === targetTrackId);
    const track = tracks[index];
    if (!track || (track.lane !== 'visual' && track.lane !== 'audio')
        || !Array.isArray(track.items)
        || !materialRangeOverlaps(track.items, range)) return undefined;
    return track.lane === 'visual' ? index + 1 : index;
}
