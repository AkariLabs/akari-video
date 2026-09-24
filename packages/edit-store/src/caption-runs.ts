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
            if (typeof style.color === 'string' && /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(style.color)) css.push(`color:${style.color}`);
            if (Number.isInteger(style.font_weight) && (style.font_weight as number) >= 1 && (style.font_weight as number) <= 1000) css.push(`font-weight:${style.font_weight}`);
            if (typeof style.letter_spacing_em === 'number' && Number.isFinite(style.letter_spacing_em)) css.push(`letter-spacing:${style.letter_spacing_em}em`);
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
            const scale = typeof style.scale === 'number' && Number.isFinite(style.scale) && style.scale > 0
                ? style.scale : 1;
            if (shift || rotate || scale !== 1) css.push(`transform:translateY(${shift}em) rotate(${rotate}deg) scale(${scale})`);
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
