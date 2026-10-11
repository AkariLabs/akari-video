import defaults = require('../../../../../../packages/content-language/src/caption-defaults.json');
import { CAPTION_FONT_FAMILY } from './caption-visual-contract';

function englishFontLabel(family?: string): string {
    const first = defaults.en.fontStack.split(',')[0].trim().replace(/^['"]|['"]$/gu, '');
    return !family || family === CAPTION_FONT_FAMILY || family === first
        ? first.replace(/^AKARI /u, '') : family;
}

export function captionFontLabel(locale: string | undefined, family?: string): string {
    if (locale?.split('-')[0].toLowerCase() === 'en') return englishFontLabel(family);
    return family === CAPTION_FONT_FAMILY ? 'Noto Sans JP' : family ?? 'Noto Sans JP';
}

export function captionToolbarFontLabel(locale: string | undefined, family?: string): string {
    if (locale?.split('-')[0].toLowerCase() === 'en') return englishFontLabel(family);
    return family || 'Noto Sans JP';
}
