import { t } from '@akari-video/i18n';
/** edit-replace.mjs の planReplacement / applyReplacement と同じ item 更新を、保存前に計算する。 */
export function replaceVideoCandidateItem<T extends { id: string; source: { kind: string; src: string; in: number; out: number; [key: string]: unknown }; [key: string]: unknown }>(
    item: T, actualDurationSeconds: number
): T {
    const cutsDurationSeconds = item.source.out - item.source.in;
    if (!Number.isFinite(actualDurationSeconds) || actualDurationSeconds < 0
        || !Number.isFinite(cutsDurationSeconds) || cutsDurationSeconds <= 0 || item.source.kind !== 'media') {
        throw new Error(t('annotationscommon.videoCandidateReplace.error.replacementDurationMustBeFinitePositiveNumber'));
    }
    const round = (value: number): number => Number(value.toFixed(6));
    const shorter = actualDurationSeconds < cutsDurationSeconds;
    return { ...item, source: { ...item.source,
        src: `gen-${item.id}-video`, in: 0,
        out: round(shorter ? actualDurationSeconds : cutsDurationSeconds),
        freeze: shorter ? { at_sec: round(actualDurationSeconds), duration_sec: round(cutsDurationSeconds - actualDurationSeconds) } : null,
        mute: false } };
}
