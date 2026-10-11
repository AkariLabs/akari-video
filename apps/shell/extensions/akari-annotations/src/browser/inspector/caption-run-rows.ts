import { t } from '@akari-video/i18n';
import { captionGraphemes, type CaptionRun } from '@akari-video/edit-store';

export function captionRunRows(displayText: string, runs: readonly CaptionRun[]): Array<{
    from: number; to: number; text: string; chip: string;
}> {
    const chars = captionGraphemes(displayText);
    const styleLabels: Record<string, string> = {
        color: t('inspector.captionRunRows.label.color'), font_weight: t('inspector.captionRunRows.label.weight'), scale: t('inspector.captionRunRows.label.size'), baseline_shift_em: t('inspector.captionRunRows.label.upDown'),
        rotate_deg: t('inspector.captionRunRows.label.rotation'), letter_spacing_em: t('inspector.captionRunRows.label.letterSpacing'), stroke: t('inspector.captionRunRows.label.outline'),
        italic: t('inspector.captionRunRows.label.italic'), underline: t('inspector.captionRunRows.label.lowerLine')
    };
    return runs.map(run => ({
        from: run.from,
        to: run.to,
        text: chars.slice(run.from, run.to).join(''),
        chip: run.role ? ({ emphasis: t('inspector.captionRunRows.label.emphasis'), keyword: t('inspector.captionRunRows.label.keyword'), aside: t('inspector.captionRunRows.label.note') }[run.role] ?? run.role)
            : Object.keys(run.style ?? {}).map(key => styleLabels[key] ?? t('inspector.captionRunRows.label.appearance')).join(t('inspector.captionRunRows.separator.styles'))
    }));
}
