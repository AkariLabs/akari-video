import fontFaces = require('../../../../../../packages/render-cut/src/caption-font-faces.json');

export interface BundledCaptionFontFace {
    readonly id: string;
    readonly sourceId?: string;
    readonly family: string;
    readonly file: string;
    readonly weight: string;
}

/** The family is the font card title before its parenthesized suffix. */
// Keep the panel's `noto-sans-jp` key reserved for its AKARI alias.
export const BUNDLED_CAPTION_FONT_FACES: readonly BundledCaptionFontFace[] = fontFaces.filter(face =>
    face.id !== 'noto-sans').map(face =>
    face.id === 'noto-sans-jp' ? { ...face, id: 'noto-sans-jp-direct', sourceId: face.id } : face);

export function bundledCaptionFontFaceCss(faces: readonly (BundledCaptionFontFace & { url: string })[]): string {
    return faces.map(face => `@font-face { font-family: ${JSON.stringify(face.family)}; src: url(${JSON.stringify(face.url)}) format("truetype"); font-weight: ${face.weight}; font-style: normal; font-display: block; }`).join('\n');
}

export function latinCaptionFontFaceCss(url: string): string {
    return ['AKARI Noto Sans', 'Noto Sans'].map(family =>
        `@font-face { font-family: ${JSON.stringify(family)}; src: url(${JSON.stringify(url)}) format("truetype-variations"); font-weight: 100 900; font-style: normal; font-display: block; }`).join('\n');
}
