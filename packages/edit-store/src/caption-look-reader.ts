import { captionGraphemes, nextCaptionRunId, type CaptionRun } from './caption-runs';
import { sanitizeMyStyleLook } from './caption-look-v1';
import { resolveCaptionStylePreset, type TextstyleCatalog } from './caption-style-preset';

type CaptionRow = Record<string, unknown> & { id?: string; start?: number; end?: number; text?: string;
    display_text?: string; src?: string; runs?: CaptionRun[]; style_preset?: string };
type Emphasis = { id: string; src?: string; t_start: number; t_end: number; word: string;
    emotion: string; style_hint?: string; style_preset?: string };
type CaptionsRoot = { captions: CaptionRow[]; emphasis_words?: Emphasis[]; [key: string]: unknown };

export const CAPTION_EMPHASIS_MOTION: Readonly<Record<string, string>> = {
    'one-char-bang': 'pop', 'one-char-jumble': 'jitter', 'size-pulse': 'zoom-pulse'
};
const DEFAULT_HINT: Readonly<Record<string, string>> = {
    pain: 'one-char-bang', surprise: 'one-char-bang', anger: 'one-char-bang',
    disgust: 'one-char-jumble', joy: 'size-pulse', emphasis: 'size-pulse'
};

function hash(value: unknown): string {
    const text = JSON.stringify(value);
    let n = 2166136261;
    for (const char of text) { n ^= char.charCodeAt(0); n = Math.imul(n, 16777619); }
    return `fnv1a:${(n >>> 0).toString(16).padStart(8, '0')}`;
}

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
        const interval = intervalForEmphasis(row, item);
        return interval ? [{ row, interval, hint, motion }] : [];
    });
    return candidates.length === 1 ? candidates[0] : undefined;
}

export function readCaptionLookV1(root: CaptionsRoot | CaptionRow[], catalog: TextstyleCatalog):
    { captions: CaptionRow[]; notices: string[] } {
    const rows: CaptionRow[] = Array.isArray(root) ? root : root.captions;
    const emphasis = Array.isArray(root) ? [] : root.emphasis_words ?? [];
    const projected = new Map<string, { id: string | undefined; from: number; to: number; motion: string }>();
    const allRuns = rows.flatMap(row => row.runs ?? []);
    for (const item of emphasis) {
        const candidate = projectEmphasis(rows, item);
        if (candidate) projected.set(item.id, { id: candidate.row.id,
            ...candidate.interval, motion: candidate.motion });
    }
    const notices: string[] = [];
    const captions = rows.map(row => {
        const resolved = resolveCaptionStylePreset(row, catalog);
        const runs = (row.runs ?? []).map(run => ({ ...run,
            ...(run.style && !run.look ? { look: { ...run.style } } : {}),
            ...(run.animation && !run.dormant_animation ? { dormant_animation: run.animation } : {}) }));
        for (const item of emphasis) {
            if (runs.some(run => run.migrated_from === item.id)) continue;
            const interval = projected.get(item.id);
            if (!interval || interval.id !== row.id) continue;
            const projection: CaptionRun = { id: nextCaptionRunId(allRuns), from: interval.from, to: interval.to,
                role: 'emphasis', emotion: item.emotion, migrated_from: item.id,
                anchor: { ...(item.src ? { src: item.src } : {}), start: item.t_start,
                    end: item.t_end, domain: 'source' }, fire: 'spoken',
                motion: { in: { id: interval.motion } } };
            runs.push(projection); allRuns.push(projection);
        }
        if (row.style_preset && !resolved.resolved) notices.push(`字幕 ${row.id ?? ''} のスタイルが見つかりません。`);
        return { ...resolved.record, runs };
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
    const allRuns = [...rows.flatMap(row => row.runs ?? []),
        ...(Array.isArray(source) ? [] : (Array.isArray(source.unresolved_runs)
            ? (source.unresolved_runs as Array<{ run?: CaptionRun }>).flatMap(item => item.run ? [item.run] : []) : []))];
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
                    look: { kind: 'builtin', id, original_hash: hash(sanitizeMyStyleLook(original)),
                        applied_hash: hash(sanitizeMyStyleLook(row.text_style)) },
                    ...(applied.animation ? { motion: { kind: 'builtin', id,
                        original_hash: hash(original.animation ?? {}), applied_hash: hash(applied.animation) } } : {}) };
                delete row.style_preset;
            } else notices.push(`字幕 ${row.id ?? ''} のスタイルが見つかりません。`);
        }
        row.runs = (row.runs ?? []).map(run => {
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
    const migrated = new Set<string>();
    for (const item of emphasis) {
        if (rows.some(row => row.runs?.some(run => run.migrated_from === item.id))) { migrated.add(item.id); continue; }
        const candidate = projectEmphasis(rows, item);
        if (!candidate) { unresolved.push(item); notices.push(`強調語 ${item.id} は可逆に移行できません`); continue; }
        const { row, interval, motion } = candidate;
        const run: CaptionRun = { id: nextCaptionRunId(allRuns), ...interval, role: 'emphasis',
            emotion: item.emotion, migrated_from: item.id, fire: 'spoken',
            anchor: { ...(item.src ? { src: item.src } : {}), start: item.t_start,
                end: item.t_end, domain: 'source' }, motion: { in: { id: motion } } };
        row.runs!.push(run); allRuns.push(run); migrated.add(item.id);
    }
    if (!Array.isArray(source)) source.emphasis_words = emphasis.filter(item => !migrated.has(item.id));
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
export function captionRenderInputFromV1<T extends CaptionsRoot | CaptionRow[]>(root: T): T {
    const rows: CaptionRow[] = Array.isArray(root) ? root : root.captions;
    if (!rows.some(row => row.runs?.some((run: CaptionRun) => run.look || run.dormant_animation || run.migrated_from))) return root;
    const copy = structuredClone(root);
    const nextRows: CaptionRow[] = Array.isArray(copy) ? copy : copy.captions;
    const emphasis = Array.isArray(copy) ? [] : [...(copy.emphasis_words ?? [])];
    for (const row of nextRows) {
        row.runs = (row.runs ?? []).flatMap((run: CaptionRun) => {
            if (run.migrated_from && !run.look && run.anchor) {
                const hint = Object.keys(CAPTION_EMPHASIS_MOTION)
                    .find(key => CAPTION_EMPHASIS_MOTION[key] === run.motion?.in?.id);
                if (hint) emphasis.push({ id: run.migrated_from,
                    word: captionGraphemes(row.display_text ?? row.text ?? '').slice(run.from, run.to).join(''),
                    t_start: run.anchor.start, t_end: run.anchor.end, emotion: run.emotion ?? 'emphasis',
                    style_hint: hint, ...(run.anchor.src ? { src: run.anchor.src } : {}) });
                return [];
            }
            const next = { ...run };
            if (next.look && !next.style) {
                const style = { ...next.look } as NonNullable<CaptionRun['style']>;
                const scale = typeof style.scale === 'number' && style.scale > 0 ? style.scale : 1;
                if (style.stroke?.width_px !== undefined) style.stroke = {
                    ...style.stroke, width_px: style.stroke.width_px * scale };
                next.style = style;
            }
            delete next.dormant_animation;
            return [next];
        });
    }
    if (!Array.isArray(copy)) copy.emphasis_words = emphasis.sort((left, right) =>
        left.id.localeCompare(right.id, undefined, { numeric: true }));
    return copy;
}
