import { captionGraphemes, type CaptionRun } from '@akari-video/edit-store';

export function captionRunRows(displayText: string, runs: readonly CaptionRun[]): Array<{
    from: number; to: number; text: string; chip: string;
}> {
    const chars = captionGraphemes(displayText);
    const styleLabels: Record<string, string> = {
        color: '色', font_weight: '太さ', scale: '大きさ', baseline_shift_em: '上下',
        rotate_deg: '回転', letter_spacing_em: '字間', stroke: '縁取り',
        italic: '斜体', underline: '下線'
    };
    return runs.map(run => ({
        from: run.from,
        to: run.to,
        text: chars.slice(run.from, run.to).join(''),
        chip: run.role ? ({ emphasis: '強調', keyword: 'キーワード', aside: '補足' }[run.role] ?? run.role)
            : Object.keys(run.style ?? {}).map(key => styleLabels[key] ?? '見た目').join('・')
    }));
}
