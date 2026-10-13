import { captionGraphemes, nextCaptionRunId, roundCaptionPixel, type CaptionRun } from './caption-runs';
import { captionValueHash } from './caption-hash';
import { sanitizeMyStyleLook } from './caption-look-v1';
import { resolveCaptionStylePreset, type TextstyleCatalog } from './caption-style-preset';
import { captionRichTextShadowValue, captionTextShadowValue, mergeCaptionLineTextStyles, resolveCaptionReferenceScale,
    resolveCaptionStyleForOutput, scaleCaptionPx } from './caption-display';
import { renderableCaptionRuns, validateCaptionsSemantics } from './caption-semantics';

type CaptionRow = Record<string, unknown> & { id?: string; start?: number; end?: number; text?: string;
    display_text?: string; src?: string; runs?: CaptionRun[]; style_preset?: string };
type Emphasis = { id: string; src?: string; t_start: number; t_end: number; word: string;
    emotion: string; style_hint?: string; style_preset?: string; [key: string]: unknown };
type CaptionsRoot = { captions: CaptionRow[]; emphasis_words?: Emphasis[]; [key: string]: unknown };

export const CAPTION_EMPHASIS_MOTION: Readonly<Record<string, string>> = {
    'one-char-bang': 'pop', 'one-char-jumble': 'jitter', 'size-pulse': 'zoom-pulse'
};
const DEFAULT_HINT: Readonly<Record<string, string>> = {
    pain: 'one-char-bang', surprise: 'one-char-bang', anger: 'one-char-bang',
    disgust: 'one-char-jumble', joy: 'size-pulse', emphasis: 'size-pulse'
};

function intervalForEmphasis(row: CaptionRow, emphasis: Emphasis): { from: number; to: number } | undefined {
    if (emphasis.src && emphasis.src !== row.src) return undefined;
    if (typeof row.start !== 'number' || typeof row.end !== 'number'
        || emphasis.t_start < row.start || emphasis.t_end > row.end
        || emphasis.t_start >= emphasis.t_end) return undefined;
    const chars = captionGraphemes(row.display_text ?? row.text ?? '');
    const word = captionGraphemes(emphasis.word);
    const matches: number[] = [];
    for (let i = 0; i <= chars.length - word.length; i++) {
        if (word.every((char, n) => chars[i + n] === char)) matches.push(i);
    }
    return matches.length === 1 ? { from: matches[0], to: matches[0] + word.length } : undefined;
}

function projectEmphasis(rows: CaptionRow[], item: Emphasis):
    { row: CaptionRow; interval: { from: number; to: number }; hint: string; motion: string } | undefined {
    if (item.style_preset) return undefined;
    const hint = item.style_hint ?? DEFAULT_HINT[item.emotion];
    if (!hint) return undefined;
    const motion = CAPTION_EMPHASIS_MOTION[hint];
    if (!motion) return undefined;
    const candidates = rows.flatMap(row => {
        if (row.runs !== undefined && (!Array.isArray(row.runs)
            || row.runs.some(run => !run || typeof run !== 'object' || Array.isArray(run)))) return [];
        const interval = intervalForEmphasis(row, item);
        return interval ? [{ row, interval, hint, motion }] : [];
    });
    return candidates.length === 1 ? candidates[0] : undefined;
}

function rowRuns(row: CaptionRow): CaptionRun[] {
    return Array.isArray(row.runs) ? row.runs : [];
}

function invalidLegacyRun(run: CaptionRun, row: CaptionRow): boolean {
    if (['id', 'look', 'motion', 'anchor', 'fire'].some(key => Object.prototype.hasOwnProperty.call(run, key))) {
        return false;
    }
    const length = captionGraphemes(row.display_text ?? row.text ?? '').length;
    return !Number.isInteger(run.from) || !Number.isInteger(run.to)
        || run.from < 0 || run.to > length || run.from >= run.to;
}

export function readCaptionLookV1(root: CaptionsRoot | CaptionRow[], catalog: TextstyleCatalog):
    { captions: CaptionRow[]; notices: string[] } {
    const rows: CaptionRow[] = Array.isArray(root) ? root : root.captions;
    const emphasis = Array.isArray(root) ? [] : root.emphasis_words ?? [];
    const projected = new Map<string, { id: string | undefined; from: number; to: number; motion: string; index: number }>();
    const allRuns = [...rows.flatMap(rowRuns), ...(Array.isArray(root) ? [] :
        (Array.isArray(root.unresolved_runs) ? (root.unresolved_runs as Array<{ run?: CaptionRun }>).flatMap(item => item.run ? [item.run] : []) : []))];
    const occupiedIndices = new Set(allRuns.flatMap(run => run && typeof run === 'object'
        && Number.isInteger(run.migrated_emphasis?.index) ? [run.migrated_emphasis!.index] : []));
    let originalIndex = 0;
    for (const item of emphasis) {
        while (occupiedIndices.has(originalIndex)) originalIndex++;
        const index = originalIndex++;
        const candidate = projectEmphasis(rows, item);
        if (candidate) projected.set(item.id, { id: candidate.row.id,
            ...candidate.interval, motion: candidate.motion, index });
    }
    const notices: string[] = [];
    const captions = rows.map(row => {
        const resolved = resolveCaptionStylePreset(row, catalog);
        const runs = rowRuns(row).map(run => !run || typeof run !== 'object' || Array.isArray(run)
            || invalidLegacyRun(run, row) ? run : { ...run,
                ...(run.style && !run.look ? { look: { ...run.style } } : {}),
                ...(run.animation && !run.dormant_animation ? { dormant_animation: run.animation } : {}) });
        for (const item of emphasis) {
            if (runs.some(run => run && typeof run === 'object' && run.migrated_from === item.id)) continue;
            const interval = projected.get(item.id);
            if (!interval || interval.id !== row.id) continue;
            const projection: CaptionRun = { id: nextCaptionRunId(allRuns), from: interval.from, to: interval.to,
                role: 'emphasis', emotion: item.emotion, migrated_from: item.id,
                migrated_emphasis: { index: interval.index, item: structuredClone(item) },
                anchor: { ...(item.src ? { src: item.src } : {}), start: item.t_start,
                    end: item.t_end, domain: 'source' }, fire: 'spoken',
                motion: { in: { id: interval.motion } } };
            runs.push(projection); allRuns.push(projection);
        }
        if (row.style_preset && !resolved.resolved) notices.push(`字幕 ${row.id ?? ''} のスタイルが見つかりません。`);
        return { ...resolved.record, ...(runs.length || Array.isArray(row.runs) ? { runs }
            : Object.prototype.hasOwnProperty.call(row, 'runs') ? { runs: row.runs } : {}) };
    });
    return { captions, notices };
}

export function planCaptionLookMigration(captions: CaptionsRoot | CaptionRow[], catalog: TextstyleCatalog,
    _edit?: unknown): { next: CaptionsRoot | CaptionRow[]; diff: Array<{ path: string; before: unknown; after: unknown }>;
        unresolved: Emphasis[]; notices: string[] } {
    const source = structuredClone(captions);
    const rows = Array.isArray(source) ? source : source.captions;
    const emphasis = Array.isArray(source) ? [] : source.emphasis_words ?? [];
    const unresolved: Emphasis[] = [];
    const notices: string[] = [];
    const allRuns = [...rows.flatMap(rowRuns),
        ...(Array.isArray(source) ? [] : (Array.isArray(source.unresolved_runs)
            ? (source.unresolved_runs as Array<{ run?: CaptionRun }>).flatMap(item => item.run ? [item.run] : []) : []))];
    let invalidLegacyCount = 0;
    let unscaledLegacyCount = 0;
    for (const row of rows) {
        if (row.style_preset) {
            const preset = resolveCaptionStylePreset(row, catalog);
            if (preset.resolved) {
                const id = row.style_preset;
                const original = (catalog instanceof Map ? catalog.get(id)
                    : (catalog as Record<string, { style: Record<string, unknown> }>)[id])?.style ?? {};
                const applied = (preset.record.text_style ?? {}) as Record<string, unknown>;
                row.text_style = structuredClone(applied);
                row.style_sources = { ...((row.style_sources ?? {}) as object),
                    look: { kind: 'builtin', id, original_hash: captionValueHash(sanitizeMyStyleLook(original)),
                        applied_hash: captionValueHash(sanitizeMyStyleLook(row.text_style)) },
                    ...(applied.animation ? { motion: { kind: 'builtin', id,
                        original_hash: captionValueHash(original.animation ?? {}), applied_hash: captionValueHash(applied.animation) } } : {}) };
                delete row.style_preset;
            } else notices.push(`字幕 ${row.id ?? ''} のスタイルが見つかりません。`);
        }
        const effectiveStyle = mergeCaptionLineTextStyles(Array.isArray(source) ? null : source.default_text_style,
            row.text_style);
        const keepLegacyPixels = effectiveStyle?.reference_height_px !== undefined || effectiveStyle?.layout !== undefined;
        if (Array.isArray(row.runs)) row.runs = row.runs.map(run => {
            if (!run || typeof run !== 'object' || Array.isArray(run)) return run;
            if (invalidLegacyRun(run, row)) { invalidLegacyCount++; return run; }
            if (keepLegacyPixels && run.style?.stroke?.width_px !== undefined) {
                unscaledLegacyCount++;
                return run;
            }
            const result = { ...run };
            if (result.style) {
                const scale = typeof result.style.scale === 'number' && result.style.scale > 0
                    ? result.style.scale : 1;
                const look = { ...result.style };
                if (look.stroke?.width_px !== undefined) look.stroke = {
                    ...look.stroke, width_px: look.stroke.width_px / scale };
                result.look = look;
                delete result.style;
            }
            if (result.animation) { result.dormant_animation = result.animation; delete result.animation; }
            if (!result.id) { result.id = nextCaptionRunId(allRuns); allRuns.push(result); }
            return result;
        });
    }
    if (invalidLegacyCount) notices.push(`範囲の外の古い指定 ${invalidLegacyCount} 件はそのまま残しました`);
    if (unscaledLegacyCount) notices.push(`基準の高さのある行の範囲の縁 ${unscaledLegacyCount} 件は自動で移せません。そのまま残しました`);
    const occupiedIndices = new Set(allRuns.flatMap(run => run && typeof run === 'object'
        && Number.isInteger(run.migrated_emphasis?.index) ? [run.migrated_emphasis!.index] : []));
    const migrated = new Set<string>();
    let originalIndex = 0;
    for (const item of emphasis) {
        while (occupiedIndices.has(originalIndex)) originalIndex++;
        const index = originalIndex++;
        if (rows.some(row => rowRuns(row).some(run => run && typeof run === 'object'
            && run.migrated_from === item.id))) { migrated.add(item.id); continue; }
        const candidate = projectEmphasis(rows, item);
        if (!candidate) { unresolved.push(item); notices.push(`強調語 ${item.id} は可逆に移行できません`); continue; }
        const { row, interval, motion } = candidate;
        const run: CaptionRun = { id: nextCaptionRunId(allRuns), ...interval, role: 'emphasis',
            emotion: item.emotion, migrated_from: item.id,
            migrated_emphasis: { index, item: structuredClone(item) }, fire: 'spoken',
            anchor: { ...(item.src ? { src: item.src } : {}), start: item.t_start,
                end: item.t_end, domain: 'source' }, motion: { in: { id: motion } } };
        (row.runs ??= []).push(run); allRuns.push(run); migrated.add(item.id);
        occupiedIndices.add(index);
    }
    if (!Array.isArray(source) && Object.prototype.hasOwnProperty.call(source, 'emphasis_words')) {
        source.emphasis_words = emphasis.filter(item => !migrated.has(item.id));
    }
    const originalRows = Array.isArray(captions) ? captions : captions.captions;
    const diff: Array<{ path: string; before: unknown; after: unknown }> = [];
    rows.forEach((row, index) => {
        const before = originalRows[index] ?? {};
        for (const key of new Set([...Object.keys(before), ...Object.keys(row)])) {
            if (JSON.stringify(before[key]) !== JSON.stringify(row[key])) diff.push({
                path: `captions[${index}].${key}`, before: before[key], after: row[key] });
        }
    });
    if (!Array.isArray(source) && !Array.isArray(captions)
        && JSON.stringify(captions.emphasis_words) !== JSON.stringify(source.emphasis_words)) {
        diff.push({ path: 'emphasis_words', before: captions.emphasis_words, after: source.emphasis_words });
    }
    return { next: source, diff,
        unresolved, notices };
}

/** Restore the renderer's legacy input without changing a legacy-only document. */
export function resolveCaptionRunLook(look: Record<string, unknown>, lineStyle: Record<string, unknown> | null,
    output?: { width: number; height: number }): { style: NonNullable<CaptionRun['style']>;
        resolved_look?: CaptionRun['resolved_look'] } {
    const scale = typeof look.scale === 'number' && Number.isFinite(look.scale) && look.scale > 0 ? look.scale : 1;
    const lineScale = !output ? 1 : lineStyle?.layout
        ? resolveCaptionStyleForOutput(lineStyle, output).layout!.scale
        : resolveCaptionReferenceScale(lineStyle, output);
    const pxScale = lineScale * scale;
    const style = { ...look } as NonNullable<CaptionRun['style']>;
    if (style.stroke?.width_px !== undefined) style.stroke = { ...style.stroke,
        width_px: scaleCaptionPx(style.stroke.width_px, pxScale) };
    const background = look.background && typeof look.background === 'object'
        ? look.background as Record<string, unknown> : null;
    const plate = background && typeof background.color === 'string' ? {
        color: background.color,
        opacity: typeof background.opacity === 'number' ? background.opacity : 1,
        padding_px: scaleCaptionPx(typeof background.padding_px === 'number' ? background.padding_px : 0, pxScale),
        radius_px: scaleCaptionPx(typeof background.radius_px === 'number' ? background.radius_px : 0, pxScale)
    } : undefined;
    const hasShadow = Object.prototype.hasOwnProperty.call(look, 'shadow');
    const hasGlow = Object.prototype.hasOwnProperty.call(look, 'glow');
    const lineShadow = lineStyle?.shadow;
    const lineGlow = lineStyle?.glow;
    const shadow = captionTextShadowValue(hasShadow ? look.shadow : lineShadow, undefined,
        hasShadow ? pxScale : lineScale);
    const glow = captionTextShadowValue(undefined, hasGlow ? look.glow : lineGlow,
        hasGlow ? pxScale : lineScale);
    const extras = lineStyle ? captionRichTextShadowValue({ ...lineStyle, shadow: undefined, glow: undefined }, lineScale) : null;
    const shadowValue = (hasShadow ? look.shadow : lineShadow) as Record<string, unknown> | undefined;
    const glowValue = (hasGlow ? look.glow : lineGlow) as Record<string, unknown> | undefined;
    const shadowExtent = shadowValue && typeof shadowValue.color === 'string'
        ? scaleCaptionPx(Math.abs(Number(shadowValue.distance_px) || 0) + (Number(shadowValue.blur_px) || 0),
            hasShadow ? pxScale : lineScale) : 0;
    const glowExtent = glowValue && typeof glowValue.color === 'string'
        ? scaleCaptionPx(Math.abs(Number(glowValue.offset_x) || 0) + Math.abs(Number(glowValue.offset_y) || 0)
            + 2 * (typeof glowValue.spread === 'number' ? glowValue.spread : 40), hasGlow ? pxScale : lineScale) : 0;
    const inner = lineStyle?.stroke_inner as Record<string, unknown> | undefined;
    const extrude = lineStyle?.extrude as Record<string, unknown> | undefined;
    const lineExtent = scaleCaptionPx(Math.max(Number(inner?.width_px) || 0,
        Number(extrude?.depth_px) || 0), lineScale);
    const inkOutset = Math.max(plate?.padding_px ?? 0, shadowExtent, glowExtent, lineExtent);
    return { style, ...(plate || hasShadow || hasGlow ? { resolved_look: {
        ...(plate ? { plate } : {}),
        ink_outset_px: inkOutset,
        rotate_deg: typeof look.rotate_deg === 'number' ? look.rotate_deg : 0,
        ...(hasShadow || hasGlow ? { text_shadow: [extras, shadow, glow].filter(Boolean).join(', ') || 'none' } : {})
    } } : {}) };
}

export function captionRenderInputFromV1<T extends CaptionsRoot | CaptionRow[]>(root: T,
    options: { output?: { width: number; height: number } } = {}): T {
    const rows: CaptionRow[] = Array.isArray(root) ? root : root.captions;
    const diagnostics = validateCaptionsSemantics({ captions: root });
    const validRuns = rows.map((row, index) => Array.isArray(row.runs)
        ? renderableCaptionRuns(row as CaptionRow & { text: string }, root, { diagnostics, index }) : []);
    if (!rows.some((row, index) => validRuns[index].length !== rowRuns(row).length
        || rowRuns(row).some(run => run && typeof run === 'object'
            && (run.look || run.dormant_animation || run.migrated_from)))) return root;
    const copy = structuredClone(root);
    const nextRows: CaptionRow[] = Array.isArray(copy) ? copy : copy.captions;
    const emphasis = Array.isArray(copy) ? [] : [...(copy.emphasis_words ?? [])];
    const migrated: Array<{ index: number; item: Emphasis }> = [];
    for (const [rowIndex, row] of nextRows.entries()) {
        if (!Array.isArray(row.runs)) continue;
        row.runs = validRuns[rowIndex];
        const defaultStyle = Array.isArray(copy) ? null : copy.default_text_style;
        const lineStyle = mergeCaptionLineTextStyles(defaultStyle, row.text_style);
        row.runs = row.runs.flatMap((run: CaptionRun) => {
            if (!run || typeof run !== 'object' || Array.isArray(run)) return [run];
            if (run.migrated_from && !run.look && run.anchor) {
                const hint = Object.keys(CAPTION_EMPHASIS_MOTION)
                    .find(key => CAPTION_EMPHASIS_MOTION[key] === run.motion?.in?.id);
                const restored = run.migrated_emphasis?.item as Emphasis | undefined;
                if (restored) migrated.push({ index: run.migrated_emphasis!.index, item: structuredClone(restored) });
                else if (hint) emphasis.push({ id: run.migrated_from,
                    word: captionGraphemes(row.display_text ?? row.text ?? '').slice(run.from, run.to).join(''),
                    t_start: run.anchor.start, t_end: run.anchor.end, emotion: run.emotion ?? 'emphasis',
                    style_hint: hint, ...(run.anchor.src ? { src: run.anchor.src } : {}) });
                return [];
            }
            const next = { ...run };
            if (next.look) {
                const resolved = resolveCaptionRunLook(next.look, lineStyle, options.output);
                if (!next.style) next.style = resolved.style;
                if (resolved.resolved_look) next.resolved_look = resolved.resolved_look;
            }
            delete next.dormant_animation;
            return [next];
        });
    }
    if (!Array.isArray(copy) && (Object.prototype.hasOwnProperty.call(copy, 'emphasis_words') || migrated.length)) {
        const restored = [...emphasis];
        for (const entry of migrated.sort((left, right) => left.index - right.index)) {
            restored.splice(Math.min(entry.index, restored.length), 0, entry.item);
        }
        copy.emphasis_words = restored;
    }
    return copy;
}
