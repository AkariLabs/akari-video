import { t } from '@akari-video/i18n';

export function formatRecordingName(id: string): string {
    const match = /^s-(\d+)$/.exec(id);
    return t('annotationscommon.recording.text.name', { number: match ? Number(match[1]) : id });
}
