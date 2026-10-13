/** Display aliases mirrored from the caption font panel catalog; card IDs and titles come from the library catalog. */
import { getLanguage } from '@akari-video/i18n';
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
    'biz-udgothic': 'BIZ UDゴシック',
    'dela-gothic-one': 'Dela Gothic One あ字',
    dotgothic16: 'ドットゴシック16',
    'klee-one': 'クレー One',
    'mplus-rounded-1c': 'M PLUS Rounded 1c あ字',
    'noto-sans-jp': 'Noto Sans JP あ字',
    'noto-serif-jp': 'Noto Serif JP あ字',
    'shippori-mincho': 'しっぽり明朝',
    'zen-maru-gothic': 'Zen丸ゴシック'
};

export function libraryFontLabel(id: string, title: string, baseTitle?: string, language = getLanguage()): { display: string; english?: string } {
    if (language !== 'ja') return { display: title };
    const familyTitle = baseTitle ?? title;
    if (baseTitle !== undefined && title !== baseTitle) return { display: title, english: title };
    const display = DISPLAY_NAMES[id] ?? title;
    const family = familyTitle.replace(/（.*$/, '').trim();
    return {
        display,
        english: display !== title ? title : /[A-Za-z]/u.test(family) && family !== display ? family : undefined
    };
}
