/** Character-range caption styling. Offsets always count displayed graphemes. */
export interface CaptionRun {
    id?: string;
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
    look?: Record<string, unknown>;
    resolved_look?: {
        plate?: { color: string; opacity: number; padding_px: number; radius_px: number };
        text_shadow?: string;
        ink_outset_px?: number;
        rotate_deg?: number;
        wrappable?: boolean;
        gradient?: string;
        replace_stroke?: boolean;
        replace_shadow?: boolean;
    };
    motion?: { in?: CaptionRunAnimationSlot; loop?: CaptionRunAnimationSlot; out?: CaptionRunAnimationSlot };
    dormant_animation?: CaptionRun['animation'];
    emotion?: string;
    anchor?: { src?: string; start: number; end: number; domain: 'source' | 'output' };
    fire?: 'shown' | 'spoken' | 'whole';
    fire_was?: 'shown' | 'spoken' | 'whole';
    style_sources?: Record<string, unknown>;
    needs_review?: boolean;
    split_from?: string;
    migrated_from?: string;
    migrated_emphasis?: { index: number; item: Record<string, unknown> };
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
        const runStyle = run.style ?? (run.look ? captionRunStyleFromLook(run.look).style : undefined);
        if (run.look && !run.style && runStyle?.stroke?.width_px !== undefined) {
            const scale = typeof run.look.scale === 'number' && run.look.scale > 0 ? run.look.scale : 1;
            runStyle.stroke = { ...runStyle.stroke, width_px: roundCaptionPixel(runStyle.stroke.width_px * scale) };
        }
        for (let index = run.from; index < run.to; index++) {
            const prior = characters[index];
            characters[index] = {
                ...prior,
                ...(run.role !== undefined ? { role: run.role } : {}),
                ...(runStyle ? { style: { ...prior.style, ...runStyle,
                    ...(runStyle.stroke ? { stroke: { ...prior.style?.stroke, ...runStyle.stroke } } : {}) } } : {}),
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
        if (!run || typeof run !== 'object' || Array.isArray(run)) return [run];
        const left = Math.max(from, run.from);
        const right = Math.min(to, run.to);
        return left < right ? [{ ...run, from: left - from, to: right - from }] : [];
    });
    return result.length ? result : undefined;
}

/** 描画に渡す px 値の浮動小数点誤差をそろえる。 */
export function roundCaptionPixel(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}

/** 複数の差分区間を、書記素 LCS で対応付ける。 */
export function rebaseCaptionRuns(oldText: string, newText: string, runs: readonly CaptionRun[],
    options: { mode?: 'edit' | 'project' } = {}):
    { runs: CaptionRun[]; removed: CaptionRun[] } {
    const oldChars = captionGraphemes(oldText);
    const newChars = captionGraphemes(newText);
    let prefix = 0;
    while (prefix < Math.min(oldChars.length, newChars.length) && oldChars[prefix] === newChars[prefix]) prefix++;
    let suffix = 0;
    while (suffix < Math.min(oldChars.length, newChars.length) - prefix
        && oldChars[oldChars.length - 1 - suffix] === newChars[newChars.length - 1 - suffix]) suffix++;
    const oldMiddle = oldChars.slice(prefix, oldChars.length - suffix);
    const newMiddle = newChars.slice(prefix, newChars.length - suffix);
    const lengths = Array.from({ length: oldMiddle.length + 1 }, () => new Uint32Array(newMiddle.length + 1));
    for (let i = oldMiddle.length - 1; i >= 0; i--) for (let j = newMiddle.length - 1; j >= 0; j--) {
        lengths[i][j] = oldMiddle[i] === newMiddle[j] ? 1 + lengths[i + 1][j + 1]
            : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
    const mapped = new Map<number, number>();
    const ambiguous = new Set<number>();
    for (let n = 0; n < prefix; n++) mapped.set(n, n);
    let i = 0; let j = 0;
    while (i < oldMiddle.length && j < newMiddle.length) {
        if (oldMiddle[i] === newMiddle[j]) {
            mapped.set(prefix + i, prefix + j);
            i++; j++;
        } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
            i++;
        } else { j++; }
    }
    const prefixes = Array.from({ length: oldMiddle.length + 1 }, () => new Uint32Array(newMiddle.length + 1));
    for (let oldIndex = 0; oldIndex < oldMiddle.length; oldIndex++) {
        for (let newIndex = 0; newIndex < newMiddle.length; newIndex++) {
            prefixes[oldIndex + 1][newIndex + 1] = oldMiddle[oldIndex] === newMiddle[newIndex]
                ? prefixes[oldIndex][newIndex] + 1
                : Math.max(prefixes[oldIndex][newIndex + 1], prefixes[oldIndex + 1][newIndex]);
        }
    }
    for (const oldIndex of [...mapped.keys()].filter(index => index >= prefix)) {
        const middleIndex = oldIndex - prefix;
        let choices = 0;
        for (let newIndex = 0; newIndex < newMiddle.length; newIndex++) {
            if (oldMiddle[middleIndex] === newMiddle[newIndex]
                && prefixes[middleIndex][newIndex] + 1 + lengths[middleIndex + 1][newIndex + 1] === lengths[0][0]) {
                choices++;
            }
        }
        const canSkip = Array.from({ length: newMiddle.length + 1 }, (_, newIndex) =>
            prefixes[middleIndex][newIndex] + lengths[middleIndex + 1][newIndex])
            .some(length => length === lengths[0][0]);
        if (choices > 1 || canSkip) ambiguous.add(oldIndex);
    }
    for (let n = 0; n < suffix; n++) mapped.set(oldChars.length - suffix + n, newChars.length - suffix + n);
    const changes: Array<{ oldFrom: number; oldTo: number; newFrom: number; newTo: number }> = [];
    let oldBoundary = 0; let newBoundary = 0;
    for (const [oldIndex, newIndex] of [...mapped, [oldChars.length, newChars.length] as [number, number]]) {
        if (oldBoundary < oldIndex || newBoundary < newIndex) {
            changes.push({ oldFrom: oldBoundary, oldTo: oldIndex,
                newFrom: newBoundary, newTo: newIndex });
        }
        oldBoundary = oldIndex + 1; newBoundary = newIndex + 1;
    }
    const kept: CaptionRun[] = [];
    const removed: CaptionRun[] = [];
    for (const run of runs) {
        const containing = changes.find(change => change.oldFrom <= run.from
            && run.to <= change.oldTo && change.oldFrom < change.oldTo);
        if (containing) {
            if (options.mode === 'project' && containing.newFrom < containing.newTo) {
                kept.push({ ...run, from: containing.newFrom, to: containing.newTo, needs_review: true });
            } else removed.push(run);
            continue;
        }
        const matches = Array.from({ length: Math.max(0, run.to - run.from) }, (_, n) => run.from + n)
            .filter(index => mapped.has(index));
        if (!matches.length) { removed.push(run); continue; }
        let from = mapped.get(matches[0])!;
        let to = mapped.get(matches[matches.length - 1])! + 1;
        const crossing = changes.filter(change => change.oldFrom < run.to
            && change.oldTo > run.from && change.oldFrom < change.oldTo);
        for (const change of crossing) {
            from = Math.min(from, change.newFrom);
            to = Math.max(to, change.newTo);
        }
        kept.push({ ...run, from, to,
            ...(crossing.length || matches.length < run.to - run.from || to - from !== run.to - run.from
                || matches.some(index => ambiguous.has(index))
                ? { needs_review: true } : {}) });
    }
    return { runs: kept, removed };
}

/** @deprecated 結合は明示操作だけで行う。 */
export function joinAdjacentCaptionRuns(runs: readonly CaptionRun[]): CaptionRun[] {
    return [...runs];
}

export function nextCaptionRunId(runs: readonly CaptionRun[]): string {
    const number = runs.reduce((max, run) => {
        const match = /^r-(\d{4,})$/.exec(run?.id ?? '');
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    return `r-${String(number).padStart(4, '0')}`;
}

export function clearCaptionRunRange(runs: readonly CaptionRun[], from: number, to: number,
    allRuns: readonly CaptionRun[] = runs): CaptionRun[] {
    const result: CaptionRun[] = [];
    const used = [...allRuns];
    for (const run of runs) {
        if (run.to <= from || run.from >= to) { result.push(run); continue; }
        const baseId = run.id ?? nextCaptionRunId(used);
        if (!run.id) used.push({ ...run, id: baseId });
        if (run.from < from) result.push({ ...run, id: baseId, to: from });
        if (run.to > to) {
            const id = run.from < from ? nextCaptionRunId(used) : baseId;
            if (id !== baseId) used.push({ ...run, id });
            result.push({ ...run, from: to, id,
                ...(id !== baseId ? { split_from: baseId } : {}) });
        }
    }
    return result;
}

export function splitCaptionRuns(text: string, runs: readonly CaptionRun[], splitUtf16: number,
    leftWindow: { start: number; end: number }, rightWindow: { start: number; end: number },
    allRuns: readonly CaptionRun[] = runs): { left?: CaptionRun[]; right?: CaptionRun[] } {
    const boundary = captionGraphemes(text.slice(0, splitUtf16)).length;
    const left: CaptionRun[] = [];
    const right: CaptionRun[] = [];
    const used = [...allRuns];
    const clip = (run: CaptionRun, window: { start: number; end: number }): CaptionRun => {
        if (!run.anchor) return run;
        const start = Math.max(run.anchor.start, window.start);
        const end = Math.min(run.anchor.end, window.end);
        if (start < end) return { ...run, anchor: { ...run.anchor, start, end } };
        const { anchor: _anchor, ...rest } = run;
        return run.fire === 'spoken' ? { ...rest, fire: 'shown', fire_was: 'spoken', needs_review: true } : rest;
    };
    for (const run of runs) {
        const baseId = run.id ?? nextCaptionRunId(used);
        if (!run.id) used.push({ ...run, id: baseId });
        if (run.from < boundary && run.to > 0) left.push(clip({ ...run, id: baseId,
            to: Math.min(run.to, boundary) }, leftWindow));
        if (run.to > boundary) {
            const crosses = run.from < boundary;
            const id = crosses ? nextCaptionRunId(used) : baseId;
            if (crosses && id) used.push({ ...run, id });
            right.push(clip({ ...run, from: Math.max(0, run.from - boundary), to: run.to - boundary,
                id, ...(crosses ? { split_from: baseId } : {}) }, rightWindow));
        }
    }
    return { left: left.length ? left : undefined, right: right.length ? right : undefined };
}

export interface UnresolvedCaptionRun {
    run: CaptionRun;
    old_caption_id: string;
    old_text: string;
    old_src: string | null;
    old_start: number;
    old_end: number;
    reason: string;
}

export function unresolvedRunsForDeletedCaption(caption: { id: string; text: string; src?: string;
    start: number; end: number; runs?: CaptionRun[] }, reason = '行の対応先がありません。'): UnresolvedCaptionRun[] {
    return (caption.runs ?? []).map(run => ({ run: { ...run }, old_caption_id: caption.id,
        old_text: caption.text, old_src: caption.src ?? null,
        old_start: caption.start, old_end: caption.end, reason }));
}

export function moveDeletedCaptionRunsToUnresolved<T extends { captions: Array<{ id: string; text: string;
    src?: string; start: number; end: number; runs?: CaptionRun[] }>;
    unresolved_runs?: UnresolvedCaptionRun[] }>(root: T, captionId: string,
    reason = '行の対応先がありません。'): T {
    const deleted = root.captions.find(row => row.id === captionId);
    if (!deleted) return structuredClone(root);
    return { ...structuredClone(root), captions: root.captions.filter(row => row.id !== captionId).map(row => structuredClone(row)),
        unresolved_runs: [...(root.unresolved_runs ?? []).map(item => structuredClone(item)),
            ...unresolvedRunsForDeletedCaption(deleted, reason)] } as T;
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
export function applyCaptionRunsToHtml(html: string, displayText: string, runs?: readonly CaptionRun[],
    preserveLineRoot = false, richLayers = false): string {
    if (!runs?.length) return html;
    const validColor = (value: unknown): value is string => typeof value === 'string'
        && /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(value);
    const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    const safeShadow = (value: unknown): value is string => typeof value === 'string'
        && (value === 'none' || /^[\d\s.,()%#a-fA-Fprgbx-]+$/.test(value));
    const safeGradient = (value: unknown): value is string => typeof value === 'string'
        && /^linear-gradient\(-?\d+(?:\.\d+)?deg, (?:#[\da-fA-F]{3,8})(?:, #[\da-fA-F]{3,8}){1,2}\)$/.test(value);
    runs = runs.map(run => {
        const value = run?.resolved_look;
        if (!value || typeof value !== 'object' || Array.isArray(value)) return run;
        const plate = value.plate;
        const safePlate = plate && validColor(plate.color) && finite(plate.opacity)
            && plate.opacity >= 0 && plate.opacity <= 1 && finite(plate.padding_px)
            && plate.padding_px >= 0 && finite(plate.radius_px) && plate.radius_px >= 0
            ? { plate } : {};
        return { ...run, resolved_look: {
            ...safePlate,
            ...(safeShadow(value.text_shadow) ? { text_shadow: value.text_shadow } : {}),
            ...(finite(value.ink_outset_px) && value.ink_outset_px >= 0
                ? { ink_outset_px: value.ink_outset_px } : {}),
            ...(finite(value.rotate_deg) ? { rotate_deg: value.rotate_deg } : {}),
            ...(value.wrappable === true ? { wrappable: true } : {}),
            ...(safeGradient(value.gradient) ? { gradient: value.gradient } : {}),
            ...(value.replace_stroke === true ? { replace_stroke: true } : {}),
            ...(value.replace_shadow === true ? { replace_shadow: true } : {}),
        } };
    });
    const Segmenter = (Intl as typeof Intl & { Segmenter: GraphemeSegmenter }).Segmenter;
    const segment = (value: string): string[] => Array.from(
        new Segmenter(undefined, { granularity: 'grapheme' }).segment(value), item => item.segment);
    const chars = segment(displayText);
    const defaultStroke = html.includes('akari-caption--single-line') ? '0 transparent' : '0.14em rgba(0,0,0,.9)';
    if (!runs.some(run => Number.isInteger(run?.from) && Number.isInteger(run?.to)
        && run.from >= 0 && run.to <= chars.length && run.from < run.to)) return html;
    const richRuns = runs.filter(run => run?.resolved_look?.plate || run?.resolved_look?.text_shadow !== undefined);
    const flow = richRuns.length > 0 && !richRuns.some(run => run.resolved_look?.gradient)
        && !richLayers && !html.includes('akari-caption--rich') && !html.includes('akari-caption__rich-');
    const productLineRoot = html.includes('isolation: isolate;') || preserveLineRoot;
    const resolved = chars.map((value, index) => ({ text: value, index, style: {} as Record<string, unknown>,
        role: '', shadow: undefined as string | undefined, plate: false, plateTransform: false,
        replaceStroke: false }));
    for (const run of runs) {
        if (!Number.isInteger(run?.from) || !Number.isInteger(run?.to)
            || run.from < 0 || run.to > chars.length || run.from >= run.to) continue;
        const style = run.style ?? (run.look ? { ...run.look } : undefined);
        if (run.look && !run.style && style) {
            const scale = typeof style.scale === 'number' && Number.isFinite(style.scale) && style.scale > 0
                ? style.scale : 1;
            const stroke = style.stroke as { width_px?: number } | undefined;
            if (stroke && typeof stroke.width_px === 'number') style.stroke = {
                ...stroke, width_px: Math.round(stroke.width_px * scale * 1_000_000) / 1_000_000 };
        }
        for (let index = run.from; index < run.to; index++) {
            resolved[index] = { ...resolved[index],
                role: run.role ?? resolved[index].role,
                shadow: run.resolved_look?.text_shadow ?? resolved[index].shadow,
                plate: Boolean(run.resolved_look?.plate) || resolved[index].plate,
                plateTransform: Boolean(run.resolved_look?.plate || run.resolved_look?.text_shadow !== undefined)
                    || resolved[index].plateTransform,
                replaceStroke: Boolean(run.resolved_look?.replace_stroke) || resolved[index].replaceStroke,
                style: { ...resolved[index].style, ...style,
                    ...(style?.stroke ? { stroke: { ...(resolved[index].style.stroke as object ?? {}), ...(style.stroke as object) } } : {}) } };
        }
    }
    const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const decode = (value: string): string => value.replace(/&(amp|lt|gt|quot|#0?39);/g, (_, key: string) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#039': "'" })[key] ?? _);
    let position = 0;
    let decorationLine = false;
    const decorate = (encoded: string): string => {
        const value = decode(encoded);
        const decorated = segment(value).map(character => {
            const item = resolved[position++];
            if (!item || item.text !== character || (!item.role && !Object.keys(item.style).length)) {
                return flow ? `<span class="akari-caption__run-lift" style="position:relative">${escape(character)}</span>`
                    : escape(character);
            }
            const style = decorationLine ? { ...item.style } : item.style;
            if (decorationLine) for (const key of ['scale', 'letter_spacing_em', 'baseline_shift_em',
                'rotate_deg', 'font_weight', 'italic']) delete style[key];
            const css: string[] = ['display:inline-block', 'vertical-align:baseline', 'line-height:1'];
            const scale = typeof style.scale === 'number' && Number.isFinite(style.scale) && style.scale > 0
                ? style.scale : 1;
            if (scale !== 1 && !item.plateTransform) css.push(`font-size:${scale}em`);
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
            } else if (item.replaceStroke) css.push('-webkit-text-stroke:0 transparent');
            const shift = typeof style.baseline_shift_em === 'number' && Number.isFinite(style.baseline_shift_em)
                ? style.baseline_shift_em : 0;
            const rotate = typeof style.rotate_deg === 'number' && Number.isFinite(style.rotate_deg)
                ? style.rotate_deg : 0;
            if ((shift || rotate) && !item.plateTransform) css.push(scale === 1
                ? `transform:translateY(${shift}em) rotate(${rotate}deg) scale(1)`
                : `transform:translateY(${shift / scale}em) rotate(${rotate}deg)`);
            if (item.shadow !== undefined) {
                if (flow || !item.plate) css.push('text-shadow:none',
                    ...(!flow ? ['position:relative'] : []), `--akari-run-shadow:${item.shadow}`);
                else css.push(`text-shadow:${item.shadow}`);
            }
            if (flow && item.shadow === undefined) css.push('position:relative');
            if (/^\s$/u.test(character)) css.push('white-space:pre');
            const copiedShadow = item.shadow !== undefined && (flow || !item.plate);
            return `<span class="akari-caption__run"${item.role ? ` data-role="${escape(item.role)}"` : ''}${copiedShadow
                ? ` data-akari-shadow-text="${escape(character)}"${flow ? ' data-akari-shadow-flow="true"' : ''}` : ''} style="${css.join(';')}">${escape(character)}</span>`;
        }).join('');
        return flow ? decorated.replace(/(?:<span class="akari-caption__run-lift" style="position:relative">[^<]*<\/span>){2,}/g,
            group => group.replace(/<\/span><span class="akari-caption__run-lift" style="position:relative">/g, ''))
            : decorated;
    };
    // Limit parsing to caption line contents, leaving CSS and plate markup untouched.
    const renderedHtml = html.replace(/(<p class="akari-caption__line"[^>]*>)([\s\S]*?)(<\/p>)/g,
        (_whole, open: string, content: string, close: string) => {
            decorationLine = open.includes('data-decoration-text=');
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
    if (!richRuns.length) return renderedHtml;
    let lineStart = 0;
    const layered = renderedHtml.replace(/(<p class="akari-caption__line"[^>]*>)([\s\S]*?)(<\/p>)/g,
        (_whole, open: string, content: string, close: string) => {
            decorationLine = open.includes('data-decoration-text=');
            const lineOpen = flow && productLineRoot
                ? open.replace(/>$/, ' data-akari-flow-preserve-line-root="true">')
                : flow && decorationLine
                    ? open.replace(/>$/, ' data-akari-flow-decorated-line="true">')
                    : flow && html.includes('<div class="akari-caption__plate"')
                        ? open.replace(/>$/, ' data-akari-flow-plain-line="true">') : open;
            type Container = { kind: string; start: number; end: number; from: number; to: number };
            type Unit = { index: number; start: number; end: number; containers: Container[] };
            const units: Unit[] = [];
            const containers: Container[] = [];
            const stack: Container[] = [];
            let index = lineStart;
            const tokens = /<span class="akari-caption__run"[^>]*>[^<]*<\/span>|<[^>]+>|[^<]+/g;
            for (const match of content.matchAll(tokens)) {
                const token = match[0];
                const start = match.index;
                const end = start + token.length;
                if (/^<span class="akari-caption__run"/.test(token)) {
                    const value = decode(token.replace(/^<[^>]+>/, '').replace(/<\/span>$/, ''));
                    for (const _char of segment(value)) units.push({ index: index++, start, end,
                        containers: [...stack] });
                } else if (/^<span\b/.test(token)) {
                    const kind = /class="[^"]*\bakari-caption__tok\b/.test(token) ? 'tok'
                        : /class="[^"]*\bakari-caption__char\b/.test(token) ? 'char' : 'span';
                    const container = { kind, start, end, from: index, to: index };
                    containers.push(container); stack.push(container);
                } else if (token === '</span>') {
                    const container = stack.pop();
                    if (container) { container.end = end; container.to = index; }
                } else if (!token.startsWith('<')) {
                    let offset = start;
                    for (const char of segment(decode(token))) {
                        const encoded = escape(char);
                        units.push({ index: index++, start: offset, end: offset + encoded.length,
                            containers: [...stack] });
                        offset += encoded.length;
                    }
                }
            }
            const lineEnd = index;
            lineStart = lineEnd;
            type Fragment = { start: number; end: number; from: number; to: number;
                runIndex: number; run: CaptionRun; split: boolean };
            const fragments: Fragment[] = [];
            for (const run of richRuns) {
                const runIndex = runs.indexOf(run);
                const selected = units.filter(unit => unit.index >= run.from && unit.index < run.to);
                if (!selected.length) continue;
                const boundaries = new Set<number>();
                for (const prior of runs.slice(0, runIndex)) {
                    if (!prior || prior.from >= run.to || prior.to <= run.from) continue;
                    if (prior.from >= run.from && prior.to <= run.to) continue;
                    if (run.from >= prior.from && run.to <= prior.to) continue;
                    if (prior.from > run.from && prior.from < run.to) boundaries.add(prior.from);
                    if (prior.to > run.from && prior.to < run.to) boundaries.add(prior.to);
                }
                const groups: Unit[][] = [];
                let group: Unit[] = [];
                for (const unit of selected) {
                    const previous = group[group.length - 1];
                    const crossing = previous && boundaries.has(unit.index);
                    const changed = previous && [...previous.containers, ...unit.containers]
                        .filter(container => !previous.containers.includes(container)
                            || !unit.containers.includes(container));
                    const partialCrossing = changed && changed.some(container =>
                        container.from < selected[0].index || container.to > selected[selected.length - 1].index + 1);
                    if (previous && (crossing || partialCrossing)) {
                        groups.push(group); group = [];
                    }
                    group.push(unit);
                }
                if (group.length) groups.push(group);
                // A run boundary may split a group inside a wrapper that was whole before that split.
                // Refine each group until it is nested with every wrapper and earlier fragment.
                for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
                    const part = groups[groupIndex];
                    const from = part[0].index;
                    const to = part[part.length - 1].index + 1;
                    const crossing = [...containers, ...fragments].find(item =>
                        item.from < to && item.to > from
                        && ((item.from < from && item.to > from && item.to < to)
                            || (item.from > from && item.from < to && item.to > to)));
                    if (!crossing) continue;
                    const boundary = crossing.from > from ? crossing.from : crossing.to;
                    const offset = boundary - from;
                    groups.splice(groupIndex, 1, part.slice(0, offset), part.slice(offset));
                    groupIndex--;
                }
                for (const part of groups) {
                    const first = part[0]; const last = part[part.length - 1];
                    let start = first.start; let end = last.end;
                    for (const container of first.containers) {
                        if (container.from === first.index && container.to <= last.index + 1) {
                            start = Math.min(start, container.start);
                        }
                    }
                    for (const container of last.containers) {
                        if (container.to === last.index + 1 && container.from >= first.index) {
                            end = Math.max(end, container.end);
                        }
                    }
                    fragments.push({ start, end, from: first.index, to: last.index + 1,
                        runIndex, run, split: groups.length > 1 });
                }
            }
            if (!fragments.length) return lineOpen + content + close;
            const openings = new Map<number, Fragment[]>();
            const closings = new Map<number, Fragment[]>();
            for (const fragment of fragments) {
                openings.set(fragment.start, [...(openings.get(fragment.start) ?? []), fragment]);
                closings.set(fragment.end, [...(closings.get(fragment.end) ?? []), fragment]);
            }
            const points = [...new Set([...openings.keys(), ...closings.keys(), 0, content.length])].sort((a, b) => a - b);
            let body = '';
            const activeFragments: Fragment[] = [];
            const plateRgba = (value: NonNullable<NonNullable<CaptionRun['resolved_look']>['plate']>): string => {
                const hex = value.color.slice(1);
                const pairs = hex.length === 3 ? [...hex].map(digit => digit + digit)
                    : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)];
                const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
                return `rgba(${pairs.map(pair => parseInt(pair, 16)).join(',')},${Math.round(alpha * value.opacity * 10000) / 10000})`;
            };
            for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
                const point = points[pointIndex];
                for (const fragment of (closings.get(point) ?? []).sort((a, b) => b.start - a.start || b.runIndex - a.runIndex)) {
                    body += '</span>';
                    activeFragments.splice(activeFragments.lastIndexOf(fragment), 1);
                }
                for (const fragment of (openings.get(point) ?? []).sort((a, b) => b.end - a.end || a.runIndex - b.runIndex)) {
                    const resolvedLook = fragment.run.resolved_look;
                    const plate = resolvedLook?.plate;
                    const style: Record<string, unknown> = decorationLine ? { ...(fragment.run.style ?? fragment.run.look ?? {}) }
                        : fragment.run.style ?? fragment.run.look ?? {};
                    if (decorationLine) for (const key of ['scale', 'letter_spacing_em', 'baseline_shift_em',
                        'rotate_deg', 'font_weight', 'italic']) delete style[key];
                    const rotate = finite(style.rotate_deg) ? style.rotate_deg : 0;
                    const shift = finite(style.baseline_shift_em) ? style.baseline_shift_em : 0;
                    const scale = finite(style.scale) && style.scale > 0 ? style.scale : 1;
                    const rgba = plate ? plateRgba(plate) : undefined;
                    const coveringPlates = plate ? runs.slice(fragment.runIndex + 1)
                        .filter(later => Number.isInteger(later?.from) && Number.isInteger(later?.to)
                            && later.from >= 0 && later.to <= chars.length && later.from < later.to
                            && later.resolved_look?.plate && later.from <= fragment.run.from
                            && later.to >= fragment.run.to && (later.from < fragment.run.from
                                || later.to > fragment.run.to) && later.from <= fragment.from
                            && later.to >= fragment.to)
                        .reverse().map(later => {
                            const color = plateRgba(later.resolved_look!.plate!);
                            return `linear-gradient(${color},${color})`;
                        }) : [];
                    const fragCss = [resolvedLook?.wrappable || !rotate ? 'display:inline' : 'display:inline-block',
                        ...(flow ? [] : activeFragments.length ? []
                            : ['position:relative', `z-index:${-1000000 + fragment.runIndex}`]), 'line-height:1',
                        ...(scale !== 1 ? [`font-size:${scale}em`] : []),
                        ...(shift ? [flow || activeFragments.length ? 'position:relative' : '', `top:${shift}em`].filter(Boolean) : []),
                        ...(!resolvedLook?.wrappable && rotate ? [`transform:rotate(${rotate}deg)`, 'transform-origin:center'] : []),
                        ...(plate ? [`background:${rgba}`, ...(coveringPlates.length
                            ? [`background-image:${coveringPlates.join(',')}`] : []), `border-radius:${plate.radius_px}px`,
                            `padding:${plate.padding_px}px`, `margin:-${plate.padding_px}px`,
                            '-webkit-box-decoration-break:clone', 'box-decoration-break:clone',
                            ...(flow ? ['pointer-events:none'] : [])] : []),
                        ];
                    const attrs = [flow ? 'data-akari-run-flow="true"' : '',
                        plate ? `data-akari-plate="true" data-akari-plate-pad="${plate.padding_px}"` : '',
                        resolvedLook?.ink_outset_px ? `data-akari-ink-outset="${resolvedLook.ink_outset_px}"` : '',
                        rotate && !resolvedLook?.wrappable ? `data-akari-ink-rotate="${rotate}"` : '',
                        fragment.split ? 'data-akari-plate-split="true"' : '',
                        resolvedLook?.replace_stroke ? 'data-akari-no-stroke="true"' : '',
                        resolvedLook?.replace_shadow ? 'data-akari-no-shadow="true"' : '',
                        resolvedLook?.text_shadow !== undefined ? 'data-akari-shadow-override="true"' : '',
                        ];
                    body += `<span class="akari-caption__run-frag" ${attrs.filter(Boolean).join(' ')} style="${fragCss.join(';')}">`;
                    activeFragments.push(fragment);
                }
                if (pointIndex + 1 < points.length) body += content.slice(point, points[pointIndex + 1]);
            }
            const gradient = fragments.some(fragment => fragment.run.resolved_look?.gradient);
            return (gradient ? lineOpen.replace(/>$/, ' data-akari-gradient-run="true">') : lineOpen) + body + close;
        });
    const legacyRules = [
        '.akari-caption__line:has(.akari-caption__run-frag,.akari-caption__run[data-akari-shadow-text]):not([data-akari-gradient-run]){isolation:isolate;position:relative}',
        '.akari-caption__plate:has(.akari-caption__line[data-akari-gradient-run]){isolation:isolate}',
        '.akari-caption__line:has(.akari-caption__run-frag,.akari-caption__run[data-akari-shadow-text])::before{z-index:-10000000}',
        '.akari-caption__run-frag[data-akari-no-stroke] .akari-caption__rich-stroke{display:none}',
        '.akari-caption__run-frag[data-akari-shadow-override] .akari-caption__rich-shadow{display:none}',
        '.akari-caption__run-frag[data-akari-no-stroke] .akari-caption__run:not([style*="-webkit-text-stroke:"]){-webkit-text-stroke:0 transparent}',
        '.akari-caption__run-frag[data-akari-gradient-filter] .akari-caption__run{background-image:var(--akari-run-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent}',
        '.akari-caption__run[data-akari-shadow-text]::before{content:attr(data-akari-shadow-text);position:absolute;left:0;top:0;z-index:-1;color:transparent;-webkit-text-stroke-color:transparent;text-decoration:none;text-shadow:var(--akari-run-shadow);pointer-events:none;user-select:none;white-space:pre}'
    ];
    const flowRules = [
        '.akari-caption__plate:has(.akari-caption__run-frag[data-akari-run-flow]){isolation:isolate}',
        '.akari-caption__plate .akari-caption__line.akari-caption__line[data-akari-flow-plain-line][data-akari-flow-plain-line]{isolation:initial;position:static}',
        '.akari-caption__plate .akari-caption__line.akari-caption__line[data-akari-flow-decorated-line][data-akari-flow-decorated-line]{isolation:initial}',
        '.akari-caption__run-frag[data-akari-no-stroke] .akari-caption__rich-stroke{display:none}',
        '.akari-caption__run-frag[data-akari-shadow-override] .akari-caption__rich-shadow{display:none}',
        '.akari-caption__run-frag[data-akari-no-stroke] .akari-caption__run:not([style*="-webkit-text-stroke:"]){-webkit-text-stroke:0 transparent}',
        '.akari-caption__run[data-akari-shadow-flow][data-akari-shadow-text]::before{all:revert;content:attr(data-akari-shadow-text);display:inline-block;inline-size:0;white-space:pre;color:transparent;-webkit-text-stroke-color:transparent;text-decoration:none;text-shadow:var(--akari-run-shadow);pointer-events:none;user-select:none}',
        '.akari-caption__run[data-akari-shadow-flow][data-akari-shadow-step="in"]::before{animation:akari-typewriter-char-in .01s var(--akari-shadow-in-delay) linear both paused}',
        '.akari-caption__run[data-akari-shadow-flow][data-akari-shadow-step="out"]::before{animation:akari-shadow-out .01s var(--akari-shadow-out-delay) linear forwards paused}',
        '.akari-caption__run[data-akari-shadow-flow][data-akari-shadow-step="both"]::before{animation:akari-typewriter-char-in .01s var(--akari-shadow-in-delay) linear both paused,akari-shadow-out .01s var(--akari-shadow-out-delay) linear forwards paused}'
    ];
    const rules = '/*akari-run-rules:start*/' + (flow ? flowRules : legacyRules).join('')
        + '/*akari-run-rules:end*/';
    const inked = flow ? layered.replace(/(<span class="akari-caption__run"[^>]*data-akari-shadow-flow="true"[^>]*>)([^<]*)(<\/span>)/g,
        (_whole, open: string, value: string, close: string) => `${open}<span class="akari-caption__run-ink" style="position:relative">${value}</span>${close}`)
        : layered;
    return inked.includes('</style>') ? inked.replace('</style>', `${rules}</style>`) : `<style>${rules}</style>${inked}`;
}
