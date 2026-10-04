import { CAPTION_RICH_LAYER_CSS, resolveCaptionRichStrokes,
    resolveCaptionStyleForOutput } from '@akari-video/edit-store/lib/caption-display';
import { RESOLVED_SINGLE_LINE_CAPTION_CSS } from './caption-visual-contract';

export const TEXTSTYLE_SHOWCASE_COMMAND_ID = 'akari.library.listTextstyleShowcase';
export const CAPTION_DEFAULT_SIZE_PX = 38;

export interface LibraryTextStyleSample {
    vars: Record<string, string>;
    strokes: Record<string, string>[];
    rich: boolean;
    frameFit: boolean;
    // Read-only compatibility fields for callers that inspect the old sample shape.
    backgroundImage?: string;
    WebkitTextStroke?: string;
    fontWeight: number;
    fontSize: number;
    textShadow?: string;
    textTransform?: string;
}

/** Same caption CSS and layer order as preview/export, with only card geometry overridden. */
export const LIBRARY_TEXTSTYLE_SAMPLE_CSS = RESOLVED_SINGLE_LINE_CAPTION_CSS + CAPTION_RICH_LAYER_CSS
    + '.akari-caption--sample{position:relative;inset:auto;display:inline-block;max-width:none;pointer-events:none;line-height:1.2;white-space:pre;text-align:center;}'
    + '.akari-caption--sample .akari-caption__plate{position:relative;top:auto;bottom:auto;left:auto;right:auto;translate:none;display:inline-flex;width:auto;max-width:none;transform:none;}'
    + '.akari-caption--sample .akari-caption__line{position:relative;isolation:isolate;box-sizing:border-box;display:block;max-width:none;white-space:pre;}'
    + '.akari-caption--sample .akari-caption__line::before{content:"";position:absolute;inset:calc(0px - var(--plate-ext-height,0px)) calc(0px - var(--plate-ext-width,0px));z-index:-1;border-radius:var(--plate-ext-radius,0);background:var(--plate-ext-bg,transparent);transform:translate(var(--plate-offset-x,0px),var(--plate-offset-y,0px));}'
    + '.akari-caption--sample.akari-caption--sample-frame{display:block;width:100%;}.akari-caption--sample-frame .akari-caption__plate,.akari-caption--sample-frame .akari-caption__line{box-sizing:border-box;width:100%;}'
    + '.akari-caption--sample .akari-caption__tok{display:inline-block;vertical-align:baseline;line-height:1;white-space:pre;}'
    + '.akari-caption--sample.akari-caption--rich{background-image:none!important;}';

export function applyLibraryTextStyleSample(style: CSSStyleDeclaration, sample: LibraryTextStyleSample): void {
    for (const [name, value] of Object.entries(sample.vars)) style.setProperty(name, value);
    // Older inspector consumers inspect these properties. Rich text paints in child layers.
    style.fontSize = `${sample.fontSize}px`;
    style.fontWeight = String(sample.fontWeight);
    if (sample.WebkitTextStroke) (style as unknown as Record<string, string>).WebkitTextStroke = sample.WebkitTextStroke;
    if (sample.textShadow) style.textShadow = sample.textShadow;
    if (sample.backgroundImage) style.backgroundImage = sample.backgroundImage;
    if (sample.textTransform) style.textTransform = sample.textTransform;
}

export function libraryTextStyleSample(raw: Record<string, unknown>): LibraryTextStyleSample {
    const sourceSize = typeof raw.size_px === 'number' && Number.isFinite(raw.size_px) && raw.size_px > 0
        ? raw.size_px : CAPTION_DEFAULT_SIZE_PX;
    const referenceHeight = typeof raw.reference_height_px === 'number' && Number.isFinite(raw.reference_height_px)
        && raw.reference_height_px > 0 ? raw.reference_height_px : sourceSize;
    const height = referenceHeight * 20 / sourceSize;
    const output = { width: height * 16 / 9, height };
    const style = raw.reference_height_px === undefined ? { ...raw, reference_height_px: referenceHeight } : raw;
    const vars = resolveCaptionStyleForOutput(style, output).vars;
    const strokes = resolveCaptionRichStrokes(style, output);
    const firstStroke = strokes[0];
    const rich = raw.fill !== undefined || raw.strokes !== undefined;
    return {
        vars, strokes, rich,
        frameFit: vars['--caption-plate-fit'] === 'frame',
        backgroundImage: vars['--caption-rich-fill-image'],
        WebkitTextStroke: rich && firstStroke ? `${firstStroke['--caption-rich-stroke-width']} ${firstStroke['--caption-rich-stroke-color']}`
            : vars['--caption-webkit-text-stroke'] ?? vars['--caption-stroke'],
        fontWeight: Number(vars['--caption-font-weight'] ?? 700),
        fontSize: 20,
        textShadow: rich ? [vars['--caption-text-shadow'], ...strokes.map(layer =>
            `0px 0px 0px ${layer['--caption-rich-stroke-color']}`),
            typeof (raw.glow as { color?: unknown } | undefined)?.color === 'string'
                ? `0px 0px 0px ${(raw.glow as { color: string }).color}` : undefined].filter(Boolean).join(', ')
            : vars['--caption-text-shadow'],
        textTransform: vars['--caption-text-transform']
    };
}
