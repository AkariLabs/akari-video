export const CAPTION_FONT_SIZE_MAX = 320;

export function clampCaptionFontSize(value: number): number {
    if (!Number.isFinite(value)) throw new Error('字幕サイズは有限数である必要があります');
    return Math.max(1, Math.min(CAPTION_FONT_SIZE_MAX, value));
}
