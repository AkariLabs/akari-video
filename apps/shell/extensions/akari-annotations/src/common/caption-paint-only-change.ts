const PAINT_KEYS = new Set(['color', 'weight', 'font_weight', 'italic', 'underline',
    'strikethrough', 'stroke', 'shadow', 'glow']);

/** True when caption layout inputs are unchanged and a cue only changed its paint. */
export function captionPaintOnlyChange(before: string | undefined, after: string): boolean {
    if (!before || before === after) return false;
    try {
        const strip = (source: string): string => {
            const root = JSON.parse(source) as unknown;
            const cues = Array.isArray(root) ? root
                : root && typeof root === 'object' ? (root as { captions?: unknown }).captions : undefined;
            if (!Array.isArray(cues)) return source;
            const copy = JSON.parse(source) as typeof root;
            const rows = Array.isArray(copy) ? copy : (copy as { captions: unknown[] }).captions;
            for (const row of rows) {
                if (!row || typeof row !== 'object') continue;
                const cue = row as { text_style?: Record<string, unknown> };
                if (!cue.text_style || typeof cue.text_style !== 'object') continue;
                const style = cue.text_style;
                for (const key of PAINT_KEYS) delete style[key];
                if (style.background && typeof style.background === 'object') {
                    const background = style.background as Record<string, unknown>;
                    delete background.color;
                    delete background.opacity;
                    if (Object.keys(background).length === 0) delete style.background;
                }
                if (Object.keys(style).length === 0) delete cue.text_style;
            }
            return JSON.stringify(copy);
        };
        return strip(before) === strip(after);
    } catch {
        return false;
    }
}
