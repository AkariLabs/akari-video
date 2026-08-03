import contract = require('@akari-video/edit-store/src/caption-visual-contract.json');

if (contract.version !== 1) {
    throw new Error('Unsupported AKARI caption visual contract');
}

export const CAPTION_FONT_FAMILY = contract.font_family;
export const CAPTION_FONT_LOAD_DESCRIPTOR = contract.font_load_descriptor;

export function captionFontFaceCss(source: string): string {
    return `@font-face { font-family: "${CAPTION_FONT_FAMILY}"; src: url("${source}") format("truetype-variations"); font-weight: 100 900; font-style: normal; font-display: block; }`;
}

// This exact string is embedded into the shell webview bootstrap and is also
// imported by the real-browser parity harness. Keeping it outside the Theia
// frontend module makes the generated consumer surface directly testable.
export const RESOLVED_SINGLE_LINE_CAPTION_CSS = contract.resolved_single_line_caption_css;
export const RESOLVED_SINGLE_LINE_FRAGMENT_OPEN = contract.resolved_single_line_fragment_open;
export const RESOLVED_SINGLE_LINE_FRAGMENT_MIDDLE = contract.resolved_single_line_fragment_middle;
export const RESOLVED_SINGLE_LINE_FRAGMENT_CLOSE = contract.resolved_single_line_fragment_close;
export const RESOLVED_CAPTION_STYLE_VARIABLE_NAMES = contract.resolved_caption_style_variable_names;
