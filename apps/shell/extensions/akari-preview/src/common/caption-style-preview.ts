/** Small, DOM-free state machine shared by the webview script and node tests. */
export function createCaptionStylePreviewController(
    resolveVars: (style: Record<string, unknown>, output?: { width: number; height: number }) => Record<string, string>,
    loadFont: (family: string) => Promise<unknown>, redraw: () => void,
    output?: { width: number; height: number }
): {
    receive(message: { captionId?: string; textStyle?: Record<string, unknown> | null; committed?: boolean }): Promise<void>;
    selectionChanged(id: string | null): void;
    captionsUpdated(): void;
    resolve<T extends { id?: string; sourceCueId?: string; textStyle?: Record<string, unknown>;
        textStyleVars?: Record<string, string> }>(caption: T, selectedId: string | null): T;
} {
    let active: { captionId: string; textStyle: Record<string, unknown> } | null = null;
    let requestedCaptionId: string | null = null;
    let revision = 0;
    let cachedCaption: object | null = null;
    let cachedResolved: object | null = null;
    const clear = (paint: boolean): void => {
        ++revision;
        requestedCaptionId = null;
        cachedCaption = cachedResolved = null;
        if (!active) return;
        active = null;
        if (paint) redraw();
    };
    const snake = (style: Record<string, unknown>): Record<string, unknown> => {
        const names: Record<string, string> = {
            fontFamily: 'font_family', fontWeight: 'font_weight', sizePx: 'size_px',
            widthPx: 'width_px', radiusPx: 'radius_px', paddingPx: 'padding_px',
            blurPx: 'blur_px', distancePx: 'distance_px', letterSpacingEm: 'letter_spacing_em',
            lineHeight: 'line_height', textTransform: 'text_transform', verticalAlign: 'vertical_align',
            textAnchor: 'text_anchor', wrapWidthPct: 'wrap_width_pct', maxWidthPct: 'max_width_pct',
            offsetX: 'offset_x', offsetY: 'offset_y', widthPct: 'width_pct', heightPct: 'height_pct'
        };
        return Object.fromEntries(Object.entries(style).map(([key, value]) => [names[key] ?? key,
            value && typeof value === 'object' && !Array.isArray(value)
                ? snake(value as Record<string, unknown>) : value]));
    };
    const merge = (base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => {
        const result = { ...base };
        for (const [key, value] of Object.entries(patch)) {
            result[key] = value && typeof value === 'object' && !Array.isArray(value)
                ? merge(base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
                    ? base[key] as Record<string, unknown> : {}, value as Record<string, unknown>) : value;
        }
        return result;
    };
    return {
        async receive(message): Promise<void> {
            if (!message || typeof message.captionId !== 'string') return;
            if (message.textStyle === null) {
                if (!message.committed) clear(true);
                return;
            }
            if (!message.textStyle || typeof message.textStyle !== 'object') return;
            const token = ++revision;
            requestedCaptionId = message.captionId;
            const family = message.textStyle.fontFamily;
            if (typeof family === 'string') {
                try { await loadFont(family); } catch { return; }
                if (token !== revision) return;
            }
            active = { captionId: message.captionId, textStyle: message.textStyle };
            cachedCaption = cachedResolved = null;
            redraw();
        },
        selectionChanged(id): void { if (requestedCaptionId && requestedCaptionId !== id) clear(true); },
        captionsUpdated(): void { clear(false); },
        resolve(caption, selectedId) {
            if (!caption || !active || selectedId !== active.captionId
                || (caption.sourceCueId || caption.id) !== active.captionId) return caption;
            if (caption === cachedCaption) return cachedResolved as typeof caption;
            const textStyle = merge(caption.textStyle ?? {}, snake(active.textStyle));
            const resolved = { ...caption, textStyle,
                textStyleVars: { ...resolveVars(textStyle, output),
                    ...Object.fromEntries(Object.entries(caption.textStyleVars ?? {}).filter(([key]) =>
                        key === '--caption-scale' || key === '--caption-rotate')) } };
            cachedCaption = caption;
            cachedResolved = resolved;
            return resolved;
        }
    };
}
