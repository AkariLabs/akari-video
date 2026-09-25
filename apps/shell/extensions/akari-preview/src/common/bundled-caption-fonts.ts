export interface BundledCaptionFontFace {
    readonly id: string;
    readonly family: string;
    readonly file: string;
    readonly weight: string;
}

/** The family is the font card title before its parenthesized suffix. */
export const BUNDLED_CAPTION_FONT_FACES: readonly BundledCaptionFontFace[] = [
    { id: 'dela-gothic-one', family: 'Dela Gothic One', file: 'DelaGothicOne-Regular.ttf', weight: '400' },
    { id: 'biz-udgothic', family: 'BIZ UDGothic', file: 'BIZUDGothic-Regular.ttf', weight: '400' },
    { id: 'biz-udgothic', family: 'BIZ UDGothic', file: 'BIZUDGothic-Bold.ttf', weight: '700' },
    { id: 'dotgothic16', family: 'DotGothic16', file: 'DotGothic16-Regular.ttf', weight: '400' },
    { id: 'klee-one', family: 'Klee One', file: 'KleeOne-Regular.ttf', weight: '400' },
    { id: 'mplus-rounded-1c', family: 'M PLUS Rounded 1c', file: 'MPLUSRounded1c-Medium.ttf', weight: '500' },
    { id: 'mplus-rounded-1c', family: 'M PLUS Rounded 1c', file: 'MPLUSRounded1c-ExtraBold.ttf', weight: '800' },
    { id: 'mplus-rounded-1c', family: 'M PLUS Rounded 1c', file: 'MPLUSRounded1c-Black.ttf', weight: '900' },
    { id: 'noto-serif-jp', family: 'Noto Serif JP', file: 'NotoSerifJP-Variable.ttf', weight: '100 900' },
    { id: 'shippori-mincho', family: 'Shippori Mincho', file: 'ShipporiMincho-Regular.ttf', weight: '400' },
    { id: 'zen-maru-gothic', family: 'Zen Maru Gothic', file: 'ZenMaruGothic-Regular.ttf', weight: '400' },
    { id: 'zen-maru-gothic', family: 'Zen Maru Gothic', file: 'ZenMaruGothic-Bold.ttf', weight: '700' }
];

export function bundledCaptionFontFaceCss(faces: readonly (BundledCaptionFontFace & { url: string })[]): string {
    return faces.map(face => `@font-face { font-family: ${JSON.stringify(face.family)}; src: url(${JSON.stringify(face.url)}) format("truetype"); font-weight: ${face.weight}; font-style: normal; font-display: block; }`).join('\n');
}
