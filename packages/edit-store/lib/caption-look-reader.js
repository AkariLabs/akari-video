"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTION_EMPHASIS_MOTION = void 0;
exports.nextEmphasisWordId = nextEmphasisWordId;
exports.captionEmphasisWordIntervals = captionEmphasisWordIntervals;
exports.readCaptionLookV1 = readCaptionLookV1;
exports.planCaptionLookMigration = planCaptionLookMigration;
exports.captionRenderInputFromV1 = captionRenderInputFromV1;
const caption_runs_1 = require("./caption-runs");
const caption_hash_1 = require("./caption-hash");
const caption_look_v1_1 = require("./caption-look-v1");
const caption_style_preset_1 = require("./caption-style-preset");
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const captionRows = (root) => Array.isArray(root) ? root : Array.isArray(root?.captions) ? root.captions : [];
const emphasisWords = (root) => Array.isArray(root) || !Array.isArray(root?.emphasis_words) ? [] : root.emphasis_words;
const unresolvedRuns = (root) => Array.isArray(root) || !Array.isArray(root?.unresolved_runs) ? []
    : root.unresolved_runs.flatMap(item => isRecord(item) && isRecord(item.run)
        ? [item.run] : []);
/** 旧い強調の ID は移行済み run に残った出所 ID も予約済みとして扱う。 */
function nextEmphasisWordId(root) {
    const used = new Set(emphasisWords(root).flatMap(item => isRecord(item) && typeof item.id === 'string'
        ? [item.id] : []));
    for (const row of captionRows(root))
        for (const run of rowRuns(row))
            if (isRecord(run) && typeof run.migrated_from === 'string')
                used.add(run.migrated_from);
    for (const run of unresolvedRuns(root))
        if (typeof run.migrated_from === 'string')
            used.add(run.migrated_from);
    let number = 1;
    while (used.has(`e-${String(number).padStart(4, '0')}`))
        number++;
    if (number > 9999)
        throw new Error('強調語の id に空きがありません。');
    return `e-${String(number).padStart(4, '0')}`;
}
function migratedRunMatches(run, interval, item, motion) {
    return run.from === interval.from && run.to === interval.to && run.emotion === item.emotion
        && run.motion?.in?.id === motion && Object.keys(run.motion ?? {}).length === 1
        && run.anchor?.start === item.t_start && run.anchor?.end === item.t_end
        && (run.anchor?.src ?? undefined) === (item.src ?? undefined);
}
exports.CAPTION_EMPHASIS_MOTION = {
    'one-char-bang': 'pop', 'one-char-jumble': 'jitter', 'size-pulse': 'zoom-pulse'
};
const DEFAULT_HINT = {
    pain: 'one-char-bang', surprise: 'one-char-bang', anger: 'one-char-bang',
    disgust: 'one-char-jumble', joy: 'size-pulse', emphasis: 'size-pulse'
};
function captionEmphasisWordIntervals(row, wordText) {
    const chars = (0, caption_runs_1.captionGraphemes)(row.display_text ?? row.text ?? '');
    const word = (0, caption_runs_1.captionGraphemes)(wordText);
    const matches = [];
    if (!word.length)
        return matches;
    for (let i = 0; i <= chars.length - word.length; i++) {
        if (word.every((char, n) => chars[i + n] === char))
            matches.push({ from: i, to: i + word.length });
    }
    return matches;
}
function intervalForEmphasis(row, emphasis) {
    if (emphasis.src && emphasis.src !== row.src)
        return undefined;
    if (typeof row.start !== 'number' || typeof row.end !== 'number'
        || emphasis.t_start < row.start || emphasis.t_end > row.end
        || emphasis.t_start >= emphasis.t_end)
        return undefined;
    const matches = captionEmphasisWordIntervals(row, emphasis.word);
    return matches.length === 1 ? matches[0] : undefined;
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
        if (!isRecord(row))
            return [];
        if (row.runs !== undefined && (!Array.isArray(row.runs)
            || row.runs.some(run => !run || typeof run !== 'object' || Array.isArray(run))))
            return [];
        const interval = intervalForEmphasis(row, item);
        return interval ? [{ row, interval, hint, motion }] : [];
    });
    return candidates.length === 1 ? candidates[0] : undefined;
}
function rowRuns(row) {
    return isRecord(row) && Array.isArray(row.runs) ? row.runs : [];
}
function invalidLegacyRun(run, row) {
    if (['id', 'look', 'motion', 'anchor', 'fire'].some(key => Object.prototype.hasOwnProperty.call(run, key))) {
        return false;
    }
    const length = (0, caption_runs_1.captionGraphemes)(row.display_text ?? row.text ?? '').length;
    return !Number.isInteger(run.from) || !Number.isInteger(run.to)
        || run.from < 0 || run.to > length || run.from >= run.to;
}
function readCaptionLookV1(root, catalog) {
    const rows = captionRows(root);
    const emphasis = emphasisWords(root).map(item => isRecord(item) ? { ...item } : item);
    const projected = new Map();
    const allRuns = [...rows.flatMap(rowRuns), ...unresolvedRuns(root)];
    for (const item of emphasis)
        if (isRecord(item) && allRuns.some(run => run?.migrated_from === item.id))
            item.id = nextEmphasisWordId({ captions: rows, emphasis_words: emphasis,
                unresolved_runs: Array.isArray(root) ? [] : root.unresolved_runs });
    const occupiedIndices = new Set(allRuns.flatMap(run => run && typeof run === 'object'
        && Number.isInteger(run.migrated_emphasis?.index) ? [run.migrated_emphasis.index] : []));
    let originalIndex = 0;
    for (const item of emphasis) {
        if (!isRecord(item))
            continue;
        while (occupiedIndices.has(originalIndex))
            originalIndex++;
        const index = originalIndex++;
        const candidate = projectEmphasis(rows, item);
        if (candidate)
            projected.set(item.id, { id: candidate.row.id,
                ...candidate.interval, motion: candidate.motion, index });
    }
    const notices = [];
    const captions = rows.map(row => {
        if (!isRecord(row))
            return row;
        const resolved = (0, caption_style_preset_1.resolveCaptionStylePreset)(row, catalog);
        const runs = rowRuns(row).map(run => !run || typeof run !== 'object' || Array.isArray(run)
            || invalidLegacyRun(run, row) ? run : { ...run,
            ...(run.style && !run.look ? { look: { ...run.style } } : {}),
            ...(run.animation && !run.dormant_animation ? { dormant_animation: run.animation } : {}) });
        for (const item of emphasis) {
            if (!isRecord(item))
                continue;
            if (runs.some(run => run && typeof run === 'object' && run.migrated_from === item.id))
                continue;
            const interval = projected.get(item.id);
            if (!interval || interval.id !== row.id)
                continue;
            if (runs.some(run => run && typeof run === 'object'
                && migratedRunMatches(run, interval, item, interval.motion)))
                continue;
            const projection = { id: (0, caption_runs_1.nextCaptionRunId)(allRuns), from: interval.from, to: interval.to,
                role: 'emphasis', emotion: item.emotion, migrated_from: item.id,
                migrated_emphasis: { index: interval.index, item: structuredClone(item) },
                anchor: { ...(item.src ? { src: item.src } : {}), start: item.t_start,
                    end: item.t_end, domain: 'source' }, fire: 'spoken',
                motion: { in: { id: interval.motion } } };
            runs.push(projection);
            allRuns.push(projection);
        }
        if (row.style_preset && !resolved.resolved)
            notices.push(`字幕 ${row.id ?? ''} のスタイルが見つかりません。`);
        return { ...resolved.record, ...(runs.length || Array.isArray(row.runs) ? { runs }
                : Object.prototype.hasOwnProperty.call(row, 'runs') ? { runs: row.runs } : {}) };
    });
    return { captions, notices };
}
function planCaptionLookMigration(captions, catalog, _edit) {
    const source = structuredClone(captions);
    const rows = captionRows(source);
    const emphasis = emphasisWords(source);
    const unresolved = [];
    const notices = [];
    const allRuns = [...rows.flatMap(rowRuns), ...unresolvedRuns(source)];
    let invalidLegacyCount = 0;
    for (const row of rows) {
        if (!isRecord(row))
            continue;
        if (row.style_preset) {
            const preset = (0, caption_style_preset_1.resolveCaptionStylePreset)(row, catalog);
            if (preset.resolved) {
                const id = row.style_preset;
                const original = (catalog instanceof Map ? catalog.get(id)
                    : catalog[id])?.style ?? {};
                const applied = (preset.record.text_style ?? {});
                row.text_style = structuredClone(applied);
                row.style_sources = { ...(row.style_sources ?? {}),
                    look: { kind: 'builtin', id, original_hash: (0, caption_hash_1.captionValueHash)((0, caption_look_v1_1.sanitizeMyStyleLook)(original)),
                        applied_hash: (0, caption_hash_1.captionValueHash)((0, caption_look_v1_1.sanitizeMyStyleLook)(row.text_style)) },
                    ...(applied.animation ? { motion: { kind: 'builtin', id,
                            original_hash: (0, caption_hash_1.captionValueHash)(original.animation ?? {}), applied_hash: (0, caption_hash_1.captionValueHash)(applied.animation) } } : {}) };
                delete row.style_preset;
            }
            else
                notices.push(`字幕 ${row.id ?? ''} のスタイルが見つかりません。`);
        }
        if (Array.isArray(row.runs))
            row.runs = row.runs.map(run => {
                if (!run || typeof run !== 'object' || Array.isArray(run))
                    return run;
                if (invalidLegacyRun(run, row)) {
                    invalidLegacyCount++;
                    return run;
                }
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
    if (invalidLegacyCount)
        notices.push(`範囲の外の古い指定 ${invalidLegacyCount} 件はそのまま残しました`);
    const occupiedIndices = new Set(allRuns.flatMap(run => run && typeof run === 'object'
        && Number.isInteger(run.migrated_emphasis?.index) ? [run.migrated_emphasis.index] : []));
    const migrated = new Set();
    let originalIndex = 0;
    for (const item of emphasis) {
        if (!isRecord(item))
            continue;
        while (occupiedIndices.has(originalIndex))
            originalIndex++;
        const index = originalIndex++;
        const candidate = projectEmphasis(rows, item);
        if (candidate && rowRuns(candidate.row).some(run => migratedRunMatches(run, candidate.interval, item, candidate.motion))) {
            migrated.add(item.id);
            continue;
        }
        if (allRuns.some(run => run && typeof run === 'object' && run.migrated_from === item.id)) {
            const old = item.id;
            item.id = nextEmphasisWordId(source);
            notices.push(`強調語 ${old} は id が重なっていたので ${item.id} に振り直しました`);
        }
        if (!candidate) {
            unresolved.push(item);
            notices.push(`強調語 ${item.id} は可逆に移行できません`);
            continue;
        }
        const { row, interval, motion } = candidate;
        const run = { id: (0, caption_runs_1.nextCaptionRunId)(allRuns), ...interval, role: 'emphasis',
            emotion: item.emotion, migrated_from: item.id,
            migrated_emphasis: { index, item: structuredClone(item) }, fire: 'spoken',
            anchor: { ...(item.src ? { src: item.src } : {}), start: item.t_start,
                end: item.t_end, domain: 'source' }, motion: { in: { id: motion } } };
        (row.runs ??= []).push(run);
        allRuns.push(run);
        migrated.add(item.id);
        occupiedIndices.add(index);
    }
    if (!Array.isArray(source) && Array.isArray(source.emphasis_words)) {
        source.emphasis_words = emphasis.filter(item => !isRecord(item) || !migrated.has(item.id));
    }
    const originalRows = captionRows(captions);
    const diff = [];
    rows.forEach((row, index) => {
        if (!isRecord(row))
            return;
        const before = isRecord(originalRows[index]) ? originalRows[index] : {};
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
        unresolved, notices: [...new Set(notices)] };
}
/** Restore the renderer's legacy input without changing a legacy-only document. */
function captionRenderInputFromV1(root) {
    const rows = captionRows(root);
    const legacyIds = emphasisWords(root).flatMap(item => isRecord(item) ? [item.id] : []);
    if (!rows.some(row => rowRuns(row).some(run => run && typeof run === 'object'
        && (run.look || run.dormant_animation || run.migrated_from)))
        && new Set(legacyIds).size === legacyIds.length)
        return root;
    const copy = structuredClone(root);
    const nextRows = captionRows(copy);
    const emphasis = [...emphasisWords(copy)];
    const nextId = (items) => nextEmphasisWordId({ captions: nextRows,
        emphasis_words: items, unresolved_runs: Array.isArray(copy) ? [] : copy.unresolved_runs });
    const migratedIds = new Set();
    for (const row of nextRows)
        for (const run of rowRuns(row))
            if (typeof run?.migrated_from === 'string')
                migratedIds.add(run.migrated_from);
    for (const run of unresolvedRuns(copy))
        if (typeof run.migrated_from === 'string')
            migratedIds.add(run.migrated_from);
    const ids = new Set();
    for (const item of emphasis) {
        if (!isRecord(item))
            continue;
        if (ids.has(item.id) || migratedIds.has(item.id))
            item.id = nextId(emphasis);
        ids.add(item.id);
    }
    const migrated = [];
    for (const row of nextRows) {
        if (!isRecord(row))
            continue;
        if (!Array.isArray(row.runs))
            continue;
        row.runs = row.runs.flatMap((run) => {
            if (!run || typeof run !== 'object' || Array.isArray(run))
                return [run];
            if (run.migrated_from && !run.look && run.anchor) {
                const hint = Object.keys(exports.CAPTION_EMPHASIS_MOTION)
                    .find(key => exports.CAPTION_EMPHASIS_MOTION[key] === run.motion?.in?.id);
                const restored = run.migrated_emphasis?.item;
                if (restored) {
                    const item = structuredClone(restored);
                    if (ids.has(item.id))
                        item.id = nextId([...emphasis, ...migrated.map(entry => entry.item)]);
                    ids.add(item.id);
                    migrated.push({ index: run.migrated_emphasis.index, item });
                }
                else if (hint) {
                    let id = run.migrated_from;
                    if (ids.has(id))
                        id = nextId([...emphasis, ...migrated.map(entry => entry.item)]);
                    ids.add(id);
                    emphasis.push({ id,
                        word: (0, caption_runs_1.captionGraphemes)(row.display_text ?? row.text ?? '').slice(run.from, run.to).join(''),
                        t_start: run.anchor.start, t_end: run.anchor.end, emotion: run.emotion ?? 'emphasis',
                        style_hint: hint, ...(run.anchor.src ? { src: run.anchor.src } : {}) });
                }
                return [];
            }
            const next = { ...run };
            if (next.look && !next.style) {
                const style = { ...next.look };
                const scale = typeof style.scale === 'number' && style.scale > 0 ? style.scale : 1;
                if (style.stroke?.width_px !== undefined)
                    style.stroke = {
                        ...style.stroke, width_px: (0, caption_runs_1.roundCaptionPixel)(style.stroke.width_px * scale)
                    };
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
