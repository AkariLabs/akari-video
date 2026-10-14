import { captionGraphemes, nextCaptionRunId, roundCaptionPixel, type CaptionRun } from './caption-runs';
import { captionValueHash } from './caption-hash';
import { sanitizeMyStyleLook } from './caption-look-v1';
import { resolveCaptionStylePreset, type TextstyleCatalog } from './caption-style-preset';

type CaptionRow = Record<string, unknown> & { id?: string; start?: number; end?: number; text?: string;
    display_text?: string; src?: string; runs?: CaptionRun[]; style_preset?: string };
type Emphasis = { id: string; src?: string; t_start: number; t_end: number; word: string;
    emotion: string; style_hint?: string; style_preset?: string; [key: string]: unknown };
type CaptionsRoot = { captions: CaptionRow[]; emphasis_words?: Emphasis[]; [key: string]: unknown };
const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const captionRows = (root: CaptionsRoot | CaptionRow[]): CaptionRow[] =>
    Array.isArray(root) ? root : Array.isArray(root?.captions) ? root.captions : [];
const emphasisWords = (root: CaptionsRoot | CaptionRow[]): Emphasis[] =>
    Array.isArray(root) || !Array.isArray(root?.emphasis_words) ? [] : root.emphasis_words;
const unresolvedRuns = (root: CaptionsRoot | CaptionRow[]): CaptionRun[] =>
    Array.isArray(root) || !Array.isArray(root?.unresolved_runs) ? []
        : (root.unresolved_runs as unknown[]).flatMap(item => isRecord(item) && isRecord(item.run)
            ? [item.run as unknown as CaptionRun] : []);

/** 旧い強調の ID は移行済み run に残った出所 ID も予約済みとして扱う。 */
export function nextEmphasisWordId(root: CaptionsRoot | CaptionRow[]): string {
    const used = new Set<string>(emphasisWords(root).flatMap(item => isRecord(item) && typeof item.id === 'string'
        ? [item.id] : []));
    for (const row of captionRows(root)) for (const run of rowRuns(row))
        if (isRecord(run) && typeof run.migrated_from === 'string') used.add(run.migrated_from);
    for (const run of unresolvedRuns(root))
        if (typeof run.migrated_from === 'string') used.add(run.migrated_from);
    let number = 1;
    while (used.has(`e-${String(number).padStart(4, '0')}`)) number++;
    if (number > 9999) throw new Error('強調語の id に空きがありません。');
    return `e-${String(number).padStart(4, '0')}`;
}

function migratedRunMatches(run: CaptionRun, interval: { from: number; to: number },
    item: Emphasis, motion: string): boolean {
    return run.from === interval.from && run.to === interval.to && run.emotion === item.emotion
        && run.motion?.in?.id === motion && Object.keys(run.motion ?? {}).length === 1
        && run.anchor?.start === item.t_start && run.anchor?.end === item.t_end
        && (run.anchor?.src ?? undefined) === (item.src ?? undefined);
}

export const CAPTION_EMPHASIS_MOTION: Readonly<Record<string, string>> = {
    'one-char-bang': 'pop', 'one-char-jumble': 'jitter', 'size-pulse': 'zoom-pulse'
};
const DEFAULT_HINT: Readonly<Record<string, string>> = {
    pain: 'one-char-bang', surprise: 'one-char-bang', anger: 'one-char-bang',
    disgust: 'one-char-jumble', joy: 'size-pulse', emphasis: 'size-pulse'
};

export function captionEmphasisWordIntervals(row: Pick<CaptionRow, 'text' | 'display_text'>,
    wordText: string): Array<{ from: number; to: number }> {
    const chars = captionGraphemes(row.display_text ?? row.text ?? '');
    const word = captionGraphemes(wordText);
    const matches: Array<{ from: number; to: number }> = [];
    if (!word.length) return matches;
    for (let i = 0; i <= chars.length - word.length; i++) {
        if (word.every((char, n) => chars[i + n] === char)) matches.push({ from: i, to: i + word.length });
    }
    return matches;
}

function intervalForEmphasis(row: CaptionRow, emphasis: Emphasis): { from: number; to: number } | undefined {
    if (emphasis.src && emphasis.src !== row.src) return undefined;
    if (typeof row.start !== 'number' || typeof row.end !== 'number'
        || emphasis.t_start < row.start || emphasis.t_end > row.end
        || emphasis.t_start >= emphasis.t_end) return undefined;
    const matches = captionEmphasisWordIntervals(row, emphasis.word);
    return matches.length === 1 ? matches[0] : undefined;
}

function projectEmphasis(rows: CaptionRow[], item: Emphasis):
    { row: CaptionRow; interval: { from: number; to: number }; hint: string; motion: string } | undefined {
    if (item.style_preset) return undefined;
    const hint = item.style_hint ?? DEFAULT_HINT[item.emotion];
    if (!hint) return undefined;
    const motion = CAPTION_EMPHASIS_MOTION[hint];
    if (!motion) return undefined;
    const candidates = rows.flatMap(row => {
        if (!isRecord(row)) return [];
        if (row.runs !== undefined && (!Array.isArray(row.runs)
            || row.runs.some(run => !run || typeof run !== 'object' || Array.isArray(run)))) return [];
        const interval = intervalForEmphasis(row, item);
        return interval ? [{ row, interval, hint, motion }] : [];
    });
    return candidates.length === 1 ? candidates[0] : undefined;
}

function rowRuns(row: CaptionRow): CaptionRun[] {
    return isRecord(row) && Array.isArray(row.runs) ? row.runs : [];
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
    const rows = captionRows(root);
    const emphasis = emphasisWords(root).map(item => isRecord(item) ? { ...item } : item);
    const projected = new Map<string, { id: string | undefined; from: number; to: number; motion: string; index: number }>();
    const allRuns = [...rows.flatMap(rowRuns), ...unresolvedRuns(root)];
    for (const item of emphasis) if (isRecord(item) && allRuns.some(run => run?.migrated_from === item.id))
        item.id = nextEmphasisWordId({ captions: rows, emphasis_words: emphasis,
            unresolved_runs: Array.isArray(root) ? [] : root.unresolved_runs });
    const occupiedIndices = new Set(allRuns.flatMap(run => run && typeof run === 'object'
        && Number.isInteger(run.migrated_emphasis?.index) ? [run.migrated_emphasis!.index] : []));
    let originalIndex = 0;
    for (const item of emphasis) {
        if (!isRecord(item)) continue;
        while (occupiedIndices.has(originalIndex)) originalIndex++;
        const index = originalIndex++;
        const candidate = projectEmphasis(rows, item);
        if (candidate) projected.set(item.id, { id: candidate.row.id,
            ...candidate.interval, motion: candidate.motion, index });
    }
    const notices: string[] = [];
    const captions = rows.map(row => {
        if (!isRecord(row)) return row;
        const resolved = resolveCaptionStylePreset(row, catalog);
        const runs = rowRuns(row).map(run => !run || typeof run !== 'object' || Array.isArray(run)
            || invalidLegacyRun(run, row) ? run : { ...run,
                ...(run.style && !run.look ? { look: { ...run.style } } : {}),
                ...(run.animation && !run.dormant_animation ? { dormant_animation: run.animation } : {}) });
        for (const item of emphasis) {
            if (!isRecord(item)) continue;
            if (runs.some(run => run && typeof run === 'object' && run.migrated_from === item.id)) continue;
            const interval = projected.get(item.id);
            if (!interval || interval.id !== row.id) continue;
            if (runs.some(run => run && typeof run === 'object'
                && migratedRunMatches(run, interval, item, interval.motion))) continue;
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
    const rows = captionRows(source);
    const emphasis = emphasisWords(source);
    const unresolved: Emphasis[] = [];
    const notices: string[] = [];
    const allRuns = [...rows.flatMap(rowRuns), ...unresolvedRuns(source)];
    let invalidLegacyCount = 0;
    for (const row of rows) {
        if (!isRecord(row)) continue;
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
        if (Array.isArray(row.runs)) row.runs = row.runs.map(run => {
            if (!run || typeof run !== 'object' || Array.isArray(run)) return run;
            if (invalidLegacyRun(run, row)) { invalidLegacyCount++; return run; }
            const result = { ...run };
            if (result.style) {
                const scale = typeof result.style.scale === 'number' && result.style.scale > 0
                    ? result.style.scale : 1;
                const look = { ...result.style };
                if (look.stroke?.width_px !== undefined) look.stroke = {
                    ...look.stroke, width_px: look.stroke.width_px / scale };
                result.look = look; delete result.style;
            }
            if (result.animation) { result.dormant_animation = result.animation; delete result.animation; }
            if (!result.id) { result.id = nextCaptionRunId(allRuns); allRuns.push(result); }
            return result;
        });
    }
    if (invalidLegacyCount) notices.push(`範囲の外の古い指定 ${invalidLegacyCount} 件はそのまま残しました`);
    const occupiedIndices = new Set(allRuns.flatMap(run => run && typeof run === 'object'
        && Number.isInteger(run.migrated_emphasis?.index) ? [run.migrated_emphasis!.index] : []));
    const migrated = new Set<string>();
    let originalIndex = 0;
    for (const item of emphasis) {
        if (!isRecord(item)) continue;
        while (occupiedIndices.has(originalIndex)) originalIndex++;
        const index = originalIndex++;
        const candidate = projectEmphasis(rows, item);
        if (candidate && rowRuns(candidate.row).some(run => migratedRunMatches(run, candidate.interval,
            item, candidate.motion))) {
            migrated.add(item.id);
            continue;
        }
        if (allRuns.some(run => run && typeof run === 'object' && run.migrated_from === item.id)) {
            const old = item.id;
            item.id = nextEmphasisWordId(source);
            notices.push(`強調語 ${old} は id が重なっていたので ${item.id} に振り直しました`);
        }
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
    if (!Array.isArray(source) && Array.isArray(source.emphasis_words)) {
        source.emphasis_words = emphasis.filter(item => !isRecord(item) || !migrated.has(item.id));
    }
    const originalRows = captionRows(captions);
    const diff: Array<{ path: string; before: unknown; after: unknown }> = [];
    rows.forEach((row, index) => {
        if (!isRecord(row)) return;
        const before = isRecord(originalRows[index]) ? originalRows[index] : {};
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
        unresolved, notices: [...new Set(notices)] };
}

/** Restore the renderer's legacy input without changing a legacy-only document. */
export function captionRenderInputFromV1<T extends CaptionsRoot | CaptionRow[]>(root: T): T {
    const rows = captionRows(root);
    const legacyIds = emphasisWords(root).flatMap(item => isRecord(item) ? [item.id] : []);
    if (!rows.some(row => rowRuns(row).some(run => run && typeof run === 'object'
        && (run.look || run.dormant_animation || run.migrated_from)))
        && new Set(legacyIds).size === legacyIds.length) return root;
    const copy = structuredClone(root);
    const nextRows = captionRows(copy);
    const emphasis = [...emphasisWords(copy)];
    const nextId = (items: Emphasis[]) => nextEmphasisWordId({ captions: nextRows,
        emphasis_words: items, unresolved_runs: Array.isArray(copy) ? [] : copy.unresolved_runs });
    const migratedIds = new Set<string>();
    for (const row of nextRows) for (const run of rowRuns(row))
        if (typeof run?.migrated_from === 'string') migratedIds.add(run.migrated_from);
    for (const run of unresolvedRuns(copy)) if (typeof run.migrated_from === 'string') migratedIds.add(run.migrated_from);
    const ids = new Set<string>();
    for (const item of emphasis) {
        if (!isRecord(item)) continue;
        if (ids.has(item.id) || migratedIds.has(item.id))
            item.id = nextId(emphasis);
        ids.add(item.id);
    }
    const migrated: Array<{ index: number; item: Emphasis }> = [];
    for (const row of nextRows) {
        if (!isRecord(row)) continue;
        if (!Array.isArray(row.runs)) continue;
        row.runs = row.runs.flatMap((run: CaptionRun) => {
            if (!run || typeof run !== 'object' || Array.isArray(run)) return [run];
            if (run.migrated_from && !run.look && run.anchor) {
                const hint = Object.keys(CAPTION_EMPHASIS_MOTION)
                    .find(key => CAPTION_EMPHASIS_MOTION[key] === run.motion?.in?.id);
                const restored = run.migrated_emphasis?.item as Emphasis | undefined;
                if (restored) {
                    const item = structuredClone(restored);
                    if (ids.has(item.id)) item.id = nextId([...emphasis, ...migrated.map(entry => entry.item)]);
                    ids.add(item.id);
                    migrated.push({ index: run.migrated_emphasis!.index, item });
                } else if (hint) {
                    let id = run.migrated_from;
                    if (ids.has(id)) id = nextId([...emphasis, ...migrated.map(entry => entry.item)]);
                    ids.add(id);
                    emphasis.push({ id,
                    word: captionGraphemes(row.display_text ?? row.text ?? '').slice(run.from, run.to).join(''),
                    t_start: run.anchor.start, t_end: run.anchor.end, emotion: run.emotion ?? 'emphasis',
                    style_hint: hint, ...(run.anchor.src ? { src: run.anchor.src } : {}) });
                }
                return [];
            }
            const next = { ...run };
            if (next.look && !next.style) {
                const style = { ...next.look } as NonNullable<CaptionRun['style']>;
                const scale = typeof style.scale === 'number' && style.scale > 0 ? style.scale : 1;
                if (style.stroke?.width_px !== undefined) style.stroke = {
                    ...style.stroke, width_px: roundCaptionPixel(style.stroke.width_px * scale) };
                next.style = style;
            }
            delete next.dormant_animation;
            return [next];
        });
    }
    if (!Array.isArray(copy) && (Array.isArray(copy.emphasis_words) || migrated.length)) {
        const restored = [...emphasis];
        for (const entry of migrated.sort((left, right) => left.index - right.index)) {
            restored.splice(Math.min(entry.index, restored.length), 0, entry.item);
        }
        copy.emphasis_words = restored;
    }
    return copy;
}
