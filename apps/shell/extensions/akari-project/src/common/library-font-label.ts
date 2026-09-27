/** Display aliases mirrored from the caption font panel catalog; card IDs and titles come from the library catalog. */
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

export function libraryFontLabel(id: string, title: string): { display: string; english?: string } {
    const display = DISPLAY_NAMES[id] ?? title;
    const family = title.replace(/（.*$/, '').trim();
    return {
        display,
        english: display !== title ? title : /[A-Za-z]/u.test(family) && family !== display ? family : undefined
    };
}
