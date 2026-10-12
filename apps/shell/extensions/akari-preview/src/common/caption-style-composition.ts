/** Keep cue paint below a run, and a timed emphasis above both, in the preview HTML. */
export function prioritizeCaptionStyleMarkup(html: string, vars: Record<string, string> | undefined): string {
    const cueCss: string[] = [];
    const color = vars?.['--caption-color'];
    const weight = vars?.['--caption-font-weight'];
    const italic = vars?.['--caption-font-style'];
    if (color && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/iu.test(color)) {
        cueCss.push(`color:${color}!important`, '-webkit-text-fill-color:currentColor!important');
    }
    if (weight && /^\d{1,4}$/u.test(weight)) cueCss.push(`font-weight:${weight}!important`);
    if (italic === 'italic' || italic === 'normal') cueCss.push(`font-style:${italic}!important`);
    let result = cueCss.length
        ? html.replace(/(<div class="akari-caption[^"]*")>/u, `$1 style="${cueCss.join(';')}">`)
        : html;
    result = result.replace(/(<span class="akari-caption__run"[^>]*style=")([^"]*)(")/gu,
        (_whole, open: string, style: string, close: string) => {
            const paint: string[] = [];
            const runColor = /(?:^|;)color:(#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?)(?:;|$)/iu.exec(style)?.[1];
            const runWeight = /(?:^|;)font-weight:(\d{1,4})(?:;|$)/u.exec(style)?.[1];
            const runItalic = /(?:^|;)font-style:(italic|normal)(?:;|$)/u.exec(style)?.[1];
            if (runColor) paint.push(`color:${runColor}!important`,
                `-webkit-text-fill-color:${runColor}!important`);
            if (runWeight) paint.push(`font-weight:${runWeight}!important`);
            if (runItalic) paint.push(`font-style:${runItalic}!important`);
            return open + style + (paint.length ? `;${paint.join(';')}` : '') + close;
        });
    return result;
}
