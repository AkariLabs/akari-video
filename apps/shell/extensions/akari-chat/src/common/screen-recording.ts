import { t } from '@akari-video/i18n';
export interface ScreenRecordingFormat { recorderMime: string; blobMime: string; extension: 'mp4' | 'webm' }

export function screenRecordingFormat(supports: (mime: string) => boolean): ScreenRecordingFormat {
    for (const recorderMime of ['video/mp4;codecs=avc1.640028', 'video/mp4']) {
        if (supports(recorderMime)) return { recorderMime, blobMime: 'video/mp4', extension: 'mp4' };
    }
    if (supports('video/webm')) return { recorderMime: 'video/webm', blobMime: 'video/webm', extension: 'webm' };
    throw new Error(t('chat.screenRecording.ui.screenRecordingFormatCannotUsedEnvironmentError'));
}
