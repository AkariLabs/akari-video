import { formatDate, getLanguage } from '@akari-video/i18n';

/** Display file modification times in the same format as the home screen. */
export function formatOutputTimestamp(mtime: number): string {
    const date = new Date(mtime);
    if (getLanguage() === 'en') {
        return formatDate(date);
    }
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
