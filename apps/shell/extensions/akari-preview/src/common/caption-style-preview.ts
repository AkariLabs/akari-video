/** Small, DOM-free state machine shared by the webview script and node tests. */
export function createCaptionStylePreviewController(
    resolveVars: (style: Record<string, unknown>, output?: { width: number; height: number }) => Record<string, string>,
    loadFont: (family: string) => Promise<unknown>, redraw: () => void,
    output?: { width: number; height: number }, commitTimeoutMs = 1500
): {
    receive(message: { captionId?: string; captionIds?: readonly string[];
        textStyle?: Record<string, unknown> | null; committed?: boolean;
        failed?: boolean; force?: boolean }): Promise<void>;
    selectionChanged(ids: string | null | ReadonlySet<string>): void;
    captionsUpdated(captions?: readonly { id?: string; sourceCueId?: string;
        textStyle?: Record<string, unknown> }[]): void;
    resolve<T extends { id?: string; sourceCueId?: string; textStyle?: Record<string, unknown>;
        textStyleVars?: Record<string, string> }>(caption: T, selectedIds: string | null | ReadonlySet<string>): T;
} {
    let active: { captionIds: ReadonlySet<string>; textStyle: Record<string, unknown> } | null = null;
    let committed = false;
    let requestedCaptionIds: ReadonlySet<string> | null = null;
    let revision = 0;
    let cachedResolved = new WeakMap<object, object>();
    let commitTimer: ReturnType<typeof setTimeout> | undefined;
    let selectionTimer: ReturnType<typeof setTimeout> | undefined;
    let unmatchedUpdates = 0;
    const cancelTimers = (): void => {
        if (commitTimer !== undefined) clearTimeout(commitTimer);
        if (selectionTimer !== undefined) clearTimeout(selectionTimer);
        commitTimer = selectionTimer = undefined;
    };
    const clear = (paint: boolean): void => {
        ++revision;
        requestedCaptionIds = null;
        committed = false;
        unmatchedUpdates = 0;
        cancelTimers();
        cachedResolved = new WeakMap<object, object>();
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
            offsetX: 'offset_x', offsetY: 'offset_y', widthPct: 'width_pct', heightPct: 'height_pct',
            fillGradient: 'fill_gradient', strokeInner: 'stroke_inner', angleDeg: 'angle_deg',
            depthPx: 'depth_px', colorEnd: 'color_end'
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
    const matches = (actual: unknown, expected: unknown): boolean => {
        if (expected === null) return actual === null || actual === undefined;
        if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length
            && expected.every((value, index) => matches(actual[index], value));
        if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
            if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
            return Object.entries(expected).every(([key, value]) =>
                matches((actual as Record<string, unknown>)[key], value));
        }
        return Object.is(actual, expected);
    };
    return {
        async receive(message): Promise<void> {
            if (!message || typeof message.captionId !== 'string') return;
            if (message.failed || message.force) { clear(true); return; }
            if (message.textStyle === null) {
                if (message.committed) {
                    committed = true;
                    unmatchedUpdates = 0;
                    cancelTimers();
                    commitTimer = setTimeout(() => clear(true), commitTimeoutMs);
                }
                else if (!committed) clear(true);
                return;
            }
            if (!message.textStyle || typeof message.textStyle !== 'object') return;
            const ids = new Set(message.captionIds?.length ? message.captionIds : [message.captionId]);
            if (committed && active && ids.size === active.captionIds.size
                && [...ids].every(id => active!.captionIds.has(id))
                && matches(active.textStyle, message.textStyle)
                && matches(message.textStyle, active.textStyle)) return;
            const token = ++revision;
            requestedCaptionIds = ids;
            committed = false;
            unmatchedUpdates = 0;
            cancelTimers();
            const family = message.textStyle.fontFamily;
            if (typeof family === 'string') {
                try { await loadFont(family); } catch { return; }
                if (token !== revision) return;
            }
            active = { captionIds: ids, textStyle: message.textStyle };
            cachedResolved = new WeakMap<object, object>();
            redraw();
        },
        selectionChanged(ids): void {
            if (!requestedCaptionIds) return;
            if (ids === null) { clear(true); return; }
            const selected = typeof ids === 'string' ? new Set([ids]) : ids ?? new Set<string>();
            if ([...requestedCaptionIds].every(id => selected.has(id))) {
                if (selectionTimer !== undefined) clearTimeout(selectionTimer);
                selectionTimer = undefined;
                return;
            }
            if (!committed || selected.size > 0) { clear(true); return; }
            if (selectionTimer === undefined) selectionTimer = setTimeout(() => clear(true), 50);
        },
        captionsUpdated(captions): void {
            if (!active || !captions) { clear(false); return; }
            const expected = snake(active.textStyle);
            if ([...active.captionIds].every(id => captions.some(caption =>
                (caption.sourceCueId || caption.id) === id && matches(caption.textStyle, expected)))) {
                clear(false);
            } else if (committed && ++unmatchedUpdates >= 2) clear(false);
        },
        resolve(caption, selectedIds) {
            const id = caption?.sourceCueId || caption?.id;
            const selected = typeof selectedIds === 'string' ? selectedIds === id : selectedIds?.has(id ?? '') ?? false;
            if (!caption || !active || !active.captionIds.has(id ?? '') || !committed && !selected) return caption;
            const cached = cachedResolved.get(caption);
            if (cached) return cached as typeof caption;
            const textStyle = merge(caption.textStyle ?? {}, snake(active.textStyle));
            const resolved = { ...caption, textStyle,
                textStyleVars: { ...resolveVars(textStyle, output),
                    ...Object.fromEntries(Object.entries(caption.textStyleVars ?? {}).filter(([key]) =>
                        key === '--caption-scale' || key === '--caption-rotate')) } };
            cachedResolved.set(caption, resolved);
            return resolved;
        }
    };
}
