import { resolveCaptionStylePreset, resolveCaptionWordStyleVars, TEXTSTYLE_CATALOG } from '@akari-video/edit-store';
import type { EditSummaryEmphasisWord } from './preview-host-types';

export function normalizePreviewEmphasisWords(
    value: unknown,
    output?: { width: number; height: number }
): EditSummaryEmphasisWord[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        console.warn('[akari-preview] emphasis_words を無視しました（配列ではありません）');
        return [];
    }
    const seenIds = new Set<string>();
    const normalized: EditSummaryEmphasisWord[] = [];
    for (const [index, item] of value.entries()) {
        const candidate = item && typeof item === 'object' && !Array.isArray(item)
            ? item as Record<string, unknown> : undefined;
        const valid = candidate !== undefined
            && typeof candidate.id === 'string'
            && /^e-\d{4}$/u.test(candidate.id)
            && !seenIds.has(candidate.id)
            && typeof candidate.t_start === 'number' && Number.isFinite(candidate.t_start) && candidate.t_start >= 0
            && typeof candidate.t_end === 'number' && Number.isFinite(candidate.t_end) && candidate.t_end > candidate.t_start
            && typeof candidate.word === 'string' && /\S/u.test(candidate.word)
            && typeof candidate.emotion === 'string' && /\S/u.test(candidate.emotion)
            && (candidate.src === undefined || (typeof candidate.src === 'string' && /\S/u.test(candidate.src)))
            && (candidate.style_hint === undefined || typeof candidate.style_hint === 'string')
            && (candidate.style_preset === undefined || typeof candidate.style_preset === 'string');
        if (!valid || !candidate) {
            console.warn(`[akari-preview] emphasis_words[${index}] を無視しました（要素が不正です）`);
            continue;
        }
        seenIds.add(candidate.id as string);
        const presetId = candidate.style_preset as string | undefined;
        const preset = presetId
            ? resolveCaptionStylePreset({ style_preset: presetId } as Record<string, unknown>, TEXTSTYLE_CATALOG)
            : undefined;
        normalized.push({
            id: candidate.id as string,
            ...(candidate.src !== undefined ? { src: candidate.src as string } : {}),
            t_start: candidate.t_start as number,
            t_end: candidate.t_end as number,
            word: candidate.word as string,
            emotion: candidate.emotion as string,
            ...(candidate.style_hint !== undefined ? { style_hint: candidate.style_hint as string } : {}),
            ...(presetId !== undefined ? { style_preset: presetId } : {}),
            ...(preset?.resolved ? {
                _presetStyleVars: resolveCaptionWordStyleVars(preset.record.text_style as Record<string, unknown>, output)
            } : {})
        });
    }
    return normalized;
}
