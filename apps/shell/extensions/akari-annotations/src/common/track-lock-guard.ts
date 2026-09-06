/** Track locks are local UI state, independent of edit.json. */
export function isTrackLocked(
    tracks: readonly { id: string; locked?: boolean }[], trackId: string | undefined
): boolean {
    return trackId !== undefined && tracks.some(track => track.id === trackId && track.locked === true);
}

export function lockedTrackMessage(trackName: string): string {
    return `「${trackName}」はロック中です（鍵を外すと編集できます）`;
}
