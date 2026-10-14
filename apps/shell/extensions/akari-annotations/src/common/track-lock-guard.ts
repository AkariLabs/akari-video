import { t } from '@akari-video/i18n';
/** Track locks are local UI state, independent of edit.json. */
export function isTrackLocked(
    tracks: readonly { id: string; locked?: boolean }[], trackId: string | undefined
): boolean {
    return trackId !== undefined && tracks.some(track => track.id === trackId && track.locked === true);
}

export function lockedTrackMessage(trackName: string): string {
    return t('annotationscommon.trackLockGuard.notice.trackLocked', { trackName });
}
