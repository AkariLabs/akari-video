import { t } from './preview-text';
export const CAPTION_FONT_SIZE_MAX = 320;

export function clampCaptionFontSize(value: number): number {
    if (!Number.isFinite(value)) throw new Error(t('preview.captionEditor.validation.captionSizeMustFiniteNumberError'));
    return Math.max(1, Math.min(CAPTION_FONT_SIZE_MAX, value));
}
