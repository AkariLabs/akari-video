/** Character-range caption styling. Offsets always count displayed graphemes. */
export interface CaptionRun {
    from: number;
    to: number;
    role?: string;
    style?: {
        color?: string;
        font_weight?: number;
        scale?: number;
        baseline_shift_em?: number;
        rotate_deg?: number;
        letter_spacing_em?: number;
        stroke?: { method?: 'webkit-outline'; color?: string; width_px?: number };
        italic?: boolean;
        underline?: boolean;
    };
    animation?: {
        in?: CaptionRunAnimationSlot;
        loop?: CaptionRunAnimationSlot;
        out?: CaptionRunAnimationSlot;
    };
}

export interface CaptionRunAnimationSlot {
    id: string;
    duration_sec?: number;
    ease?: string | null;
    amp?: number | null;
}

export interface ResolvedCaptionRunChar {
    text: string;
    index: number;
    role?: string;
    style?: CaptionRun['style'];
    animation?: CaptionRun['animation'];
}

type GraphemeSegmenter = new (locale: string | undefined, options: { granularity: 'grapheme' }) =>
    { segment(value: string): Iterable<{ segment: string }> };

export function captionGraphemes(text: string): string[] {
    const Segmenter = (Intl as typeof Intl & { Segmenter: GraphemeSegmenter }).Segmenter;
    return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
}

export type CaptionRunStyle = NonNullable<CaptionRun['style']>;
export type CaptionRunStyleField = keyof CaptionRunStyle;

function validRunRange(text: string, from: number, to: number): void {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0
        || to <= from || to > captionGraphemes(text).length) {
        throw new Error('文字範囲が表示文字列の外にあります。');
    }
}

/** The last matching run owns edits to a range, preserving the order of overlapping runs. */
export function setCaptionRunStyle(text: string, runs: readonly CaptionRun[] | undefined,
    from: number, to: number, patch: CaptionRunStyle): CaptionRun[] {
    validRunRange(text, from, to);
    const allowed = new Set(['color', 'font_weight', 'scale', 'baseline_shift_em', 'rotate_deg',
        'letter_spacing_em', 'stroke', 'italic', 'underline']);
    if (!patch || typeof patch !== 'object' || !Object.keys(patch).length
        || Object.entries(patch).some(([key, value]) => !allowed.has(key)
            || (key === 'color' && (typeof value !== 'string' || !/^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(value)))
            || (['font_weight', 'scale', 'baseline_shift_em', 'rotate_deg', 'letter_spacing_em'].includes(key)
                && (typeof value !== 'number' || !Number.isFinite(value)))
            || (key === 'font_weight' && (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1000))
            || (key === 'scale' && (value as number) <= 0)
            || (['italic', 'underline'].includes(key) && typeof value !== 'boolean')
            || (key === 'stroke' && (!value || typeof value !== 'object'
                || Object.keys(value).some(strokeKey => !['method', 'color', 'width_px'].includes(strokeKey))
                || (value as CaptionRunStyle['stroke'])?.method !== undefined
                    && (value as CaptionRunStyle['stroke'])?.method !== 'webkit-outline'
                || (value as CaptionRunStyle['stroke'])?.color !== undefined
                    && !/^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test((value as CaptionRunStyle['stroke'])!.color!)
                || (value as CaptionRunStyle['stroke'])?.width_px !== undefined
                    && (typeof (value as CaptionRunStyle['stroke'])?.width_px !== 'number'
                        || !Number.isFinite((value as CaptionRunStyle['stroke'])?.width_px)
                        || (value as CaptionRunStyle['stroke'])!.width_px! < 0))))) {
        throw new Error('文字範囲に使えないスタイル項目があります。');
    }
    const next = [...(runs ?? [])];
    const index = next.map(run => run.from === from && run.to === to).lastIndexOf(true);
    const existing = index >= 0 ? next[index] : { from, to };
    const style = { ...existing.style, ...patch,
        ...(patch.stroke ? { stroke: { ...existing.style?.stroke, ...patch.stroke } } : {}) };
    const updated = { ...existing, style };
    if (index >= 0) next[index] = updated;
    else next.push(updated);
    return next;
}

export function setCaptionRunRole(text: string, runs: readonly CaptionRun[] | undefined,
    from: number, to: number, role: string): CaptionRun[] {
    validRunRange(text, from, to);
    if (typeof role !== 'string' || !role.trim()) throw new Error('文字範囲の役割が空です。');
    const next = [...(runs ?? [])];
    const index = next.map(run => run.from === from && run.to === to).lastIndexOf(true);
    const existing = index >= 0 ? next[index] : { from, to };
    const updated = { ...existing, role };
    if (index >= 0) next[index] = updated;
    else next.push(updated);
    return next;
}

export function removeCaptionRun(runs: readonly CaptionRun[] | undefined, index: number): CaptionRun[] {
    if (!Number.isInteger(index) || index < 0 || index >= (runs?.length ?? 0)) {
        throw new Error('外す文字範囲がありません。');
    }
    return runs!.filter((_run, position) => position !== index);
}

/** Map only the nine v0 fields from a saved look. */
export function captionRunStyleFromLook(look: Record<string, unknown>, baseSizePx?: number):
    { style: CaptionRunStyle; omitted: string[] } {
    const aliases: Record<string, CaptionRunStyleField> = {
        color: 'color', fontWeight: 'font_weight', font_weight: 'font_weight', weight: 'font_weight',
        scale: 'scale', rotate: 'rotate_deg', rotate_deg: 'rotate_deg',
        letterSpacingEm: 'letter_spacing_em', letter_spacing_em: 'letter_spacing_em',
        baseline_shift_em: 'baseline_shift_em',
        italic: 'italic', underline: 'underline', stroke: 'stroke'
    };
    const style: CaptionRunStyle = {};
    const omitted: string[] = [];
    for (const [key, value] of Object.entries(look)) {
        const field = aliases[key];
        if (key === 'size_px' || key === 'sizePx') {
            if (typeof value === 'number' && Number.isFinite(baseSizePx) && baseSizePx! > 0) {
                style.scale = value / baseSizePx!;
            } else omitted.push(key);
            continue;
        }
        if (!field) { omitted.push(key); continue; }
        if (field === 'stroke' && value && typeof value === 'object') {
            const stroke = value as Record<string, unknown>;
            const mapped: NonNullable<CaptionRunStyle['stroke']> = {};
            if (typeof stroke.color === 'string') mapped.color = stroke.color;
            if (typeof stroke.width_px === 'number') mapped.width_px = stroke.width_px;
            if (typeof stroke.widthPx === 'number') mapped.width_px = stroke.widthPx;
            if (stroke.method === 'webkit-outline') mapped.method = 'webkit-outline';
            if (stroke.method !== undefined && stroke.method !== 'webkit-outline') omitted.push('stroke.method');
            if (Object.keys(mapped).length) style.stroke = mapped;
            for (const strokeKey of Object.keys(stroke)) {
                if (!['color', 'width_px', 'widthPx', 'method'].includes(strokeKey)) omitted.push(`stroke.${strokeKey}`);
            }
        } else if (field === 'color' && typeof value === 'string') style.color = value;
        else if (field === 'font_weight' && typeof value === 'number') style.font_weight = value;
        else if (field === 'scale' && typeof value === 'number') style.scale = value;
        else if (field === 'rotate_deg' && typeof value === 'number') style.rotate_deg = value;
        else if (field === 'baseline_shift_em' && typeof value === 'number') style.baseline_shift_em = value;
        else if (field === 'letter_spacing_em' && typeof value === 'number') style.letter_spacing_em = value;
        else if (field === 'italic' && typeof value === 'boolean') style.italic = value;
        else if (field === 'underline' && typeof value === 'boolean') style.underline = value;
        else omitted.push(key);
    }
    return { style, omitted };
}

export function resolveCaptionRuns(text: string, runs?: readonly CaptionRun[]): ResolvedCaptionRunChar[] {
    const characters = captionGraphemes(text).map((value, index) => ({ text: value, index } as ResolvedCaptionRunChar));
    for (const run of runs ?? []) {
        if (!Number.isInteger(run?.from) || !Number.isInteger(run?.to)
            || run.from < 0 || run.to > characters.length || run.from >= run.to) continue;
        for (let index = run.from; index < run.to; index++) {
            const prior = characters[index];
            characters[index] = {
                ...prior,
                ...(run.role !== undefined ? { role: run.role } : {}),
                ...(run.style ? { style: { ...prior.style, ...run.style,
                    ...(run.style.stroke ? { stroke: { ...prior.style?.stroke, ...run.style.stroke } } : {}) } } : {}),
                ...(run.animation ? { animation: { ...prior.animation, ...run.animation } } : {})
            };
        }
    }
    return characters;
}

/** Project a displayed substring, including one side of a manual line split. */
export function sliceCaptionRuns(text: string, runs: readonly CaptionRun[] | undefined,
    start: number, end: number): CaptionRun[] | undefined {
    if (!runs?.length) return undefined;
    const from = captionGraphemes(text.slice(0, start)).length;
    const to = captionGraphemes(text.slice(0, end)).length;
    const result = runs.flatMap(run => {
        const left = Math.max(from, run.from);
        const right = Math.min(to, run.to);
        return left < right ? [{ ...run, from: left - from, to: right - from }] : [];
    });
    return result.length ? result : undefined;
}

/** Rebase a minimal grapheme diff; a deleted range removes its run. */
export function rebaseCaptionRuns(oldText: string, newText: string, runs: readonly CaptionRun[]):
    { runs: CaptionRun[]; removed: CaptionRun[] } {
    const oldChars = captionGraphemes(oldText);
    const newChars = captionGraphemes(newText);
    let before = 0;
    while (before < oldChars.length && before < newChars.length && oldChars[before] === newChars[before]) before++;
    let after = 0;
    while (after < oldChars.length - before && after < newChars.length - before
        && oldChars[oldChars.length - after - 1] === newChars[newChars.length - after - 1]) after++;
    const oldEnd = oldChars.length - after;
    const newEnd = newChars.length - after;
    const delta = newEnd - oldEnd;
    const kept: CaptionRun[] = [];
    const removed: CaptionRun[] = [];
    for (const run of runs) {
        if (run.to <= before) { kept.push(run); continue; }
        if (run.from >= oldEnd) { kept.push({ ...run, from: run.from + delta, to: run.to + delta }); continue; }
        if (run.from >= before && run.to <= oldEnd && newEnd === before) {
            removed.push(run);
            continue;
        }
        const from = run.from < before ? run.from : before;
        const to = run.to > oldEnd ? run.to + delta : newEnd;
        if (from < to) kept.push({ ...run, from, to });
        else removed.push(run);
    }
    return { runs: kept, removed };
}

export function joinAdjacentCaptionRuns(runs: readonly CaptionRun[]): CaptionRun[] {
    const joined: CaptionRun[] = [];
    for (const run of runs) {
        const previous = joined[joined.length - 1];
        if (previous && previous.to === run.from
            && previous.role === run.role
            && JSON.stringify(previous.style ?? {}) === JSON.stringify(run.style ?? {})
            && JSON.stringify(previous.animation ?? {}) === JSON.stringify(run.animation ?? {})) {
            joined[joined.length - 1] = { ...previous, to: run.to };
        } else joined.push(run);
    }
    return joined;
}

/** Text-only notice for a caller that can present caption edit results to a user. */
export function captionRunsRemovedNotice(removedRuns: readonly CaptionRun[], oldDisplayText: string): string | undefined {
    if (removedRuns.length === 0) return undefined;
    const characters = captionGraphemes(oldDisplayText);
    const first = removedRuns[0];
    const selection = characters.slice(Math.max(0, first.from), Math.max(0, first.to))
        .join('').replace(/\s+/gu, ' ').trim();
    const preview = captionGraphemes(selection).slice(0, 16).join('');
    const suffix = captionGraphemes(selection).length > 16 ? '…' : '';
    const quoted = preview ? `（「${preview}${suffix}」${removedRuns.length > 1 ? 'など' : ''}）` : '';
    return `文字範囲 ${removedRuns.length} 件${quoted}が外れました`;
}

/** Self-contained because preview injects this function into its webview with toString(). */
export function applyCaptionRunsToHtml(html: string, displayText: string, runs?: readonly CaptionRun[]): string {
    if (!runs?.length) return html;
    const Segmenter = (Intl as typeof Intl & { Segmenter: GraphemeSegmenter }).Segmenter;
    const segment = (value: string): string[] => Array.from(
        new Segmenter(undefined, { granularity: 'grapheme' }).segment(value), item => item.segment);
    const chars = segment(displayText);
    const defaultStroke = html.includes('akari-caption--single-line') ? '0 transparent' : '0.14em rgba(0,0,0,.9)';
    if (!runs.some(run => Number.isInteger(run?.from) && Number.isInteger(run?.to)
        && run.from >= 0 && run.to <= chars.length && run.from < run.to)) return html;
    const resolved = chars.map((value, index) => ({ text: value, index, style: {} as Record<string, unknown>, role: '' }));
    for (const run of runs) {
        if (!Number.isInteger(run?.from) || !Number.isInteger(run?.to)
            || run.from < 0 || run.to > chars.length || run.from >= run.to) continue;
        for (let index = run.from; index < run.to; index++) {
            resolved[index] = { ...resolved[index],
                role: run.role ?? resolved[index].role,
                style: { ...resolved[index].style, ...run.style,
                    ...(run.style?.stroke ? { stroke: { ...(resolved[index].style.stroke as object ?? {}), ...run.style.stroke } } : {}) } };
        }
    }
    const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const decode = (value: string): string => value.replace(/&(amp|lt|gt|quot|#0?39);/g, (_, key: string) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#039': "'" })[key] ?? _);
    let position = 0;
    const decorate = (encoded: string): string => {
        const value = decode(encoded);
        return segment(value).map(character => {
            const item = resolved[position++];
            if (!item || item.text !== character || (!item.role && !Object.keys(item.style).length)) {
                return escape(character);
            }
            const style = item.style;
            const css: string[] = ['display:inline-block', 'vertical-align:baseline', 'line-height:1'];
            const scale = typeof style.scale === 'number' && Number.isFinite(style.scale) && style.scale > 0
                ? style.scale : 1;
            if (scale !== 1) css.push(`font-size:${scale}em`);
            // Re-resolve em values on the run: inherited computed lengths stay at the parent's px size.
            if (typeof style.letter_spacing_em === 'number' && Number.isFinite(style.letter_spacing_em)) {
                css.push(`letter-spacing:${style.letter_spacing_em}em`);
            } else if (scale !== 1) {
                css.push('letter-spacing:var(--caption-letter-spacing,normal)');
            }
            if (scale !== 1) css.push(`-webkit-text-stroke:var(--caption-webkit-text-stroke,var(--caption-stroke,${defaultStroke}))`);
            if (typeof style.color === 'string' && /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(style.color)) css.push(`color:${style.color}`);
            if (Number.isInteger(style.font_weight) && (style.font_weight as number) >= 1 && (style.font_weight as number) <= 1000) css.push(`font-weight:${style.font_weight}`);
            if (style.italic === true) css.push('font-style:italic');
            if (style.underline === true) css.push('text-decoration:underline');
            const stroke = style.stroke as { color?: string; width_px?: number } | undefined;
            if (stroke && typeof stroke.width_px === 'number' && Number.isFinite(stroke.width_px)
                && stroke.width_px >= 0 && (!stroke.color || /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(stroke.color))) {
                css.push(`-webkit-text-stroke:${stroke.width_px}px ${stroke.color ?? 'currentColor'}`);
            }
            const shift = typeof style.baseline_shift_em === 'number' && Number.isFinite(style.baseline_shift_em)
                ? style.baseline_shift_em : 0;
            const rotate = typeof style.rotate_deg === 'number' && Number.isFinite(style.rotate_deg)
                ? style.rotate_deg : 0;
            if (shift || rotate) css.push(scale === 1
                ? `transform:translateY(${shift}em) rotate(${rotate}deg) scale(1)`
                : `transform:translateY(${shift / scale}em) rotate(${rotate}deg)`);
            return `<span class="akari-caption__run"${item.role ? ` data-role="${escape(item.role)}"` : ''} style="${css.join(';')}">${escape(character)}</span>`;
        }).join('');
    };
    // Limit parsing to caption line contents, leaving CSS and plate markup untouched.
    return html.replace(/(<p class="akari-caption__line">)([\s\S]*?)(<\/p>)/g,
        (_whole, open: string, content: string, close: string) => {
            const rendered = content.replace(/(<span class="akari-caption__char"[^>]*>)([^<]*)(<\/span>)|(<[^>]+>)|([^<]+)/g,
                (whole, charOpen: string | undefined, charText: string | undefined,
                    charClose: string | undefined, tag: string | undefined, plain: string | undefined) => {
                    if (charOpen) {
                        // Keep the measured char element outermost for GPU tile geometry.
                        return charOpen + decorate(charText ?? '') + charClose;
                    }
                    return tag ?? (plain ? decorate(plain) : whole);
                });
            // GPU's animator normalizer replaces plain line children with word spans.
            // A token wrapper retains run markup through that normalization.
            return open + (/class="[^"]*\bakari-caption__tok\b/.test(rendered)
                ? rendered : `<span class="akari-caption__tok">${rendered}</span>`) + close;
        });
}
