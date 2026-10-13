"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTION_EMPHASIS_MOTION = void 0;
exports.readCaptionLookV1 = readCaptionLookV1;
exports.planCaptionLookMigration = planCaptionLookMigration;
exports.captionRenderInputFromV1 = captionRenderInputFromV1;
const caption_runs_1 = require("./caption-runs");
const caption_look_v1_1 = require("./caption-look-v1");
const caption_style_preset_1 = require("./caption-style-preset");
exports.CAPTION_EMPHASIS_MOTION = {
    'one-char-bang': 'pop', 'one-char-jumble': 'jitter', 'size-pulse': 'zoom-pulse'
};
const DEFAULT_HINT = {
    pain: 'one-char-bang', surprise: 'one-char-bang', anger: 'one-char-bang',
    disgust: 'one-char-jumble', joy: 'size-pulse', emphasis: 'size-pulse'
};
function hash(value) {
    const text = JSON.stringify(value);
    let n = 2166136261;
    for (const char of text) {
        n ^= char.charCodeAt(0);
        n = Math.imul(n, 16777619);
    }
    return `fnv1a:${(n >>> 0).toString(16).padStart(8, '0')}`;
}
function intervalForEmphasis(row, emphasis) {
    if (emphasis.src && emphasis.src !== row.src)
        return undefined;
    if (typeof row.start !== 'number' || typeof row.end !== 'number'
        || emphasis.t_start < row.start || emphasis.t_end > row.end
        || emphasis.t_start >= emphasis.t_end)
        return undefined;
    const chars = (0, caption_runs_1.captionGraphemes)(row.display_text ?? row.text ?? '');
    const word = (0, caption_runs_1.captionGraphemes)(emphasis.word);
    const matches = [];
    for (let i = 0; i <= chars.length - word.length; i++) {
        if (word.every((char, n) => chars[i + n] === char))
            matches.push(i);
    }
    return matches.length === 1 ? { from: matches[0], to: matches[0] + word.length } : undefined;
}
function projectEmphasis(rows, item) {
    if (item.style_preset)
        return undefined;
    const hint = item.style_hint ?? DEFAULT_HINT[item.emotion];
    if (!hint)
        return undefined;
    const motion = exports.CAPTION_EMPHASIS_MOTION[hint];
    if (!motion)
        return undefined;
    const candidates = rows.flatMap(row => {
        const interval = intervalForEmphasis(row, item);
        return interval ? [{ row, interval, hint, motion }] : [];
    });
    return candidates.length === 1 ? candidates[0] : undefined;
}
function readCaptionLookV1(root, catalog) {
    const rows = Array.isArray(root) ? root : root.captions;
    const emphasis = Array.isArray(root) ? [] : root.emphasis_words ?? [];
    const projected = new Map();
    const allRuns = rows.flatMap(row => row.runs ?? []);
    for (const item of emphasis) {
        const candidate = projectEmphasis(rows, item);
        if (candidate)
            projected.set(item.id, { id: candidate.row.id,
                ...candidate.interval, motion: candidate.motion });
    }
    const notices = [];
    const captions = rows.map(row => {
        const resolved = (0, caption_style_preset_1.resolveCaptionStylePreset)(row, catalog);
        const runs = (row.runs ?? []).map(run => ({ ...run,
            ...(run.style && !run.look ? { look: { ...run.style } } : {}),
            ...(run.animation && !run.dormant_animation ? { dormant_animation: run.animation } : {}) }));
        for (const item of emphasis) {
            if (runs.some(run => run.migrated_from === item.id))
                continue;
            const interval = projected.get(item.id);
            if (!interval || interval.id !== row.id)
                continue;
            const projection = { id: (0, caption_runs_1.nextCaptionRunId)(allRuns), from: interval.from, to: interval.to,
                role: 'emphasis', emotion: item.emotion, migrated_from: item.id,
                anchor: { ...(item.src ? { src: item.src } : {}), start: item.t_start,
                    end: item.t_end, domain: 'source' }, fire: 'spoken',
                motion: { in: { id: interval.motion } } };
            runs.push(projection);
            allRuns.push(projection);
        }
        if (row.style_preset && !resolved.resolved)
            notices.push(`字幕 ${row.id ?? ''} のスタイルが見つかりません。`);
        return { ...resolved.record, runs };
    });
    return { captions, notices };
}
function planCaptionLookMigration(captions, catalog, _edit) {
    const source = structuredClone(captions);
    const rows = Array.isArray(source) ? source : source.captions;
    const emphasis = Array.isArray(source) ? [] : source.emphasis_words ?? [];
    const unresolved = [];
    const notices = [];
    const allRuns = [...rows.flatMap(row => row.runs ?? []),
        ...(Array.isArray(source) ? [] : (Array.isArray(source.unresolved_runs)
            ? source.unresolved_runs.flatMap(item => item.run ? [item.run] : []) : []))];
    for (const row of rows) {
        if (row.style_preset) {
            const preset = (0, caption_style_preset_1.resolveCaptionStylePreset)(row, catalog);
            if (preset.resolved) {
                const id = row.style_preset;
                const original = (catalog instanceof Map ? catalog.get(id)
                    : catalog[id])?.style ?? {};
                const applied = (preset.record.text_style ?? {});
                row.text_style = structuredClone(applied);
                row.style_sources = { ...(row.style_sources ?? {}),
                    look: { kind: 'builtin', id, original_hash: hash((0, caption_look_v1_1.sanitizeMyStyleLook)(original)),
                        applied_hash: hash((0, caption_look_v1_1.sanitizeMyStyleLook)(row.text_style)) },
                    ...(applied.animation ? { motion: { kind: 'builtin', id,
                            original_hash: hash(original.animation ?? {}), applied_hash: hash(applied.animation) } } : {}) };
                delete row.style_preset;
            }
            else
                notices.push(`字幕 ${row.id ?? ''} のスタイルが見つかりません。`);
        }
        row.runs = (row.runs ?? []).map(run => {
            const result = { ...run };
            if (result.style) {
                const scale = typeof result.style.scale === 'number' && result.style.scale > 0
                    ? result.style.scale : 1;
                const look = { ...result.style };
                if (look.stroke?.width_px !== undefined)
                    look.stroke = {
                        ...look.stroke, width_px: look.stroke.width_px / scale
                    };
                result.look = look;
                delete result.style;
            }
            if (result.animation) {
                result.dormant_animation = result.animation;
                delete result.animation;
            }
            if (!result.id) {
                result.id = (0, caption_runs_1.nextCaptionRunId)(allRuns);
                allRuns.push(result);
            }
            return result;
        });
    }
    const migrated = new Set();
    for (const item of emphasis) {
        if (rows.some(row => row.runs?.some(run => run.migrated_from === item.id))) {
            migrated.add(item.id);
            continue;
        }
        const candidate = projectEmphasis(rows, item);
        if (!candidate) {
            unresolved.push(item);
            notices.push(`強調語 ${item.id} は可逆に移行できません`);
            continue;
        }
        const { row, interval, motion } = candidate;
        const run = { id: (0, caption_runs_1.nextCaptionRunId)(allRuns), ...interval, role: 'emphasis',
            emotion: item.emotion, migrated_from: item.id, fire: 'spoken',
            anchor: { ...(item.src ? { src: item.src } : {}), start: item.t_start,
                end: item.t_end, domain: 'source' }, motion: { in: { id: motion } } };
        row.runs.push(run);
        allRuns.push(run);
        migrated.add(item.id);
    }
    if (!Array.isArray(source))
        source.emphasis_words = emphasis.filter(item => !migrated.has(item.id));
    const originalRows = Array.isArray(captions) ? captions : captions.captions;
    const diff = [];
    rows.forEach((row, index) => {
        const before = originalRows[index] ?? {};
        for (const key of new Set([...Object.keys(before), ...Object.keys(row)])) {
            if (JSON.stringify(before[key]) !== JSON.stringify(row[key]))
                diff.push({
                    path: `captions[${index}].${key}`, before: before[key], after: row[key]
                });
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
function captionRenderInputFromV1(root) {
    const rows = Array.isArray(root) ? root : root.captions;
    if (!rows.some(row => row.runs?.some((run) => run.look || run.dormant_animation || run.migrated_from)))
        return root;
    const copy = structuredClone(root);
    const nextRows = Array.isArray(copy) ? copy : copy.captions;
    const emphasis = Array.isArray(copy) ? [] : [...(copy.emphasis_words ?? [])];
    for (const row of nextRows) {
        row.runs = (row.runs ?? []).flatMap((run) => {
            if (run.migrated_from && !run.look && run.anchor) {
                const hint = Object.keys(exports.CAPTION_EMPHASIS_MOTION)
                    .find(key => exports.CAPTION_EMPHASIS_MOTION[key] === run.motion?.in?.id);
                if (hint)
                    emphasis.push({ id: run.migrated_from,
                        word: (0, caption_runs_1.captionGraphemes)(row.display_text ?? row.text ?? '').slice(run.from, run.to).join(''),
                        t_start: run.anchor.start, t_end: run.anchor.end, emotion: run.emotion ?? 'emphasis',
                        style_hint: hint, ...(run.anchor.src ? { src: run.anchor.src } : {}) });
                return [];
            }
            const next = { ...run };
            if (next.look && !next.style) {
                const style = { ...next.look };
                const scale = typeof style.scale === 'number' && style.scale > 0 ? style.scale : 1;
                if (style.stroke?.width_px !== undefined)
                    style.stroke = {
                        ...style.stroke, width_px: style.stroke.width_px * scale
                    };
                next.style = style;
            }
            delete next.dormant_animation;
            return [next];
        });
    }
    if (!Array.isArray(copy))
        copy.emphasis_words = emphasis.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
    return copy;
}
