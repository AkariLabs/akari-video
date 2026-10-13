"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTION_EMPHASIS_MOTION = void 0;
exports.readCaptionLookV1 = readCaptionLookV1;
exports.planCaptionLookMigration = planCaptionLookMigration;
exports.resolveCaptionRunLook = resolveCaptionRunLook;
exports.captionRenderInputFromV1 = captionRenderInputFromV1;
const caption_runs_1 = require("./caption-runs");
const caption_hash_1 = require("./caption-hash");
const caption_look_v1_1 = require("./caption-look-v1");
const caption_style_preset_1 = require("./caption-style-preset");
const caption_display_1 = require("./caption-display");
const caption_semantics_1 = require("./caption-semantics");
exports.CAPTION_EMPHASIS_MOTION = {
    'one-char-bang': 'pop', 'one-char-jumble': 'jitter', 'size-pulse': 'zoom-pulse'
};
const DEFAULT_HINT = {
    pain: 'one-char-bang', surprise: 'one-char-bang', anger: 'one-char-bang',
    disgust: 'one-char-jumble', joy: 'size-pulse', emphasis: 'size-pulse'
};
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
        if (row.runs !== undefined && (!Array.isArray(row.runs)
            || row.runs.some(run => !run || typeof run !== 'object' || Array.isArray(run))))
            return [];
        const interval = intervalForEmphasis(row, item);
        return interval ? [{ row, interval, hint, motion }] : [];
    });
    return candidates.length === 1 ? candidates[0] : undefined;
}
function rowRuns(row) {
    return Array.isArray(row.runs) ? row.runs : [];
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
    const rows = Array.isArray(root) ? root : root.captions;
    const emphasis = Array.isArray(root) ? [] : root.emphasis_words ?? [];
    const projected = new Map();
    const allRuns = [...rows.flatMap(rowRuns), ...(Array.isArray(root) ? [] :
            (Array.isArray(root.unresolved_runs) ? root.unresolved_runs.flatMap(item => item.run ? [item.run] : []) : []))];
    const occupiedIndices = new Set(allRuns.flatMap(run => run && typeof run === 'object'
        && Number.isInteger(run.migrated_emphasis?.index) ? [run.migrated_emphasis.index] : []));
    let originalIndex = 0;
    for (const item of emphasis) {
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
        const resolved = (0, caption_style_preset_1.resolveCaptionStylePreset)(row, catalog);
        const runs = rowRuns(row).map(run => !run || typeof run !== 'object' || Array.isArray(run)
            || invalidLegacyRun(run, row) ? run : { ...run,
            ...(run.style && !run.look ? { look: { ...run.style } } : {}),
            ...(run.animation && !run.dormant_animation ? { dormant_animation: run.animation } : {}) });
        for (const item of emphasis) {
            if (runs.some(run => run && typeof run === 'object' && run.migrated_from === item.id))
                continue;
            const interval = projected.get(item.id);
            if (!interval || interval.id !== row.id)
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
    const rows = Array.isArray(source) ? source : source.captions;
    const emphasis = Array.isArray(source) ? [] : source.emphasis_words ?? [];
    const unresolved = [];
    const notices = [];
    const allRuns = [...rows.flatMap(rowRuns),
        ...(Array.isArray(source) ? [] : (Array.isArray(source.unresolved_runs)
            ? source.unresolved_runs.flatMap(item => item.run ? [item.run] : []) : []))];
    let invalidLegacyCount = 0;
    let unscaledLegacyCount = 0;
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
                    look: { kind: 'builtin', id, original_hash: (0, caption_hash_1.captionValueHash)((0, caption_look_v1_1.sanitizeMyStyleLook)(original)),
                        applied_hash: (0, caption_hash_1.captionValueHash)((0, caption_look_v1_1.sanitizeMyStyleLook)(row.text_style)) },
                    ...(applied.animation ? { motion: { kind: 'builtin', id,
                            original_hash: (0, caption_hash_1.captionValueHash)(original.animation ?? {}), applied_hash: (0, caption_hash_1.captionValueHash)(applied.animation) } } : {}) };
                delete row.style_preset;
            }
            else
                notices.push(`字幕 ${row.id ?? ''} のスタイルが見つかりません。`);
        }
        const effectiveStyle = (0, caption_display_1.mergeCaptionLineTextStyles)(Array.isArray(source) ? null : source.default_text_style, row.text_style);
        const keepLegacyPixels = effectiveStyle?.reference_height_px !== undefined || effectiveStyle?.layout !== undefined;
        if (Array.isArray(row.runs))
            row.runs = row.runs.map(run => {
                if (!run || typeof run !== 'object' || Array.isArray(run))
                    return run;
                if (invalidLegacyRun(run, row)) {
                    invalidLegacyCount++;
                    return run;
                }
                if (keepLegacyPixels && run.style?.stroke?.width_px !== undefined) {
                    unscaledLegacyCount++;
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
    if (unscaledLegacyCount)
        notices.push(`基準の高さのある行の範囲の縁 ${unscaledLegacyCount} 件は自動で移せません。そのまま残しました`);
    const occupiedIndices = new Set(allRuns.flatMap(run => run && typeof run === 'object'
        && Number.isInteger(run.migrated_emphasis?.index) ? [run.migrated_emphasis.index] : []));
    const migrated = new Set();
    let originalIndex = 0;
    for (const item of emphasis) {
        while (occupiedIndices.has(originalIndex))
            originalIndex++;
        const index = originalIndex++;
        if (rows.some(row => rowRuns(row).some(run => run && typeof run === 'object'
            && run.migrated_from === item.id))) {
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
            emotion: item.emotion, migrated_from: item.id,
            migrated_emphasis: { index, item: structuredClone(item) }, fire: 'spoken',
            anchor: { ...(item.src ? { src: item.src } : {}), start: item.t_start,
                end: item.t_end, domain: 'source' }, motion: { in: { id: motion } } };
        (row.runs ??= []).push(run);
        allRuns.push(run);
        migrated.add(item.id);
        occupiedIndices.add(index);
    }
    if (!Array.isArray(source) && Object.prototype.hasOwnProperty.call(source, 'emphasis_words')) {
        source.emphasis_words = emphasis.filter(item => !migrated.has(item.id));
    }
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
function resolveCaptionRunLook(look, lineStyle, output) {
    const scale = typeof look.scale === 'number' && Number.isFinite(look.scale) && look.scale > 0 ? look.scale : 1;
    const lineScale = !output ? 1 : lineStyle?.layout
        ? (0, caption_display_1.resolveCaptionStyleForOutput)(lineStyle, output).layout.scale
        : (0, caption_display_1.resolveCaptionReferenceScale)(lineStyle, output);
    const pxScale = lineScale * scale;
    const style = { ...look };
    if (style.stroke?.width_px !== undefined)
        style.stroke = { ...style.stroke,
            width_px: (0, caption_display_1.scaleCaptionPx)(style.stroke.width_px, pxScale) };
    const background = look.background && typeof look.background === 'object'
        ? look.background : null;
    const plate = background && typeof background.color === 'string' ? {
        color: background.color,
        opacity: typeof background.opacity === 'number' ? background.opacity : 1,
        padding_px: (0, caption_display_1.scaleCaptionPx)(typeof background.padding_px === 'number' ? background.padding_px : 0, pxScale),
        radius_px: (0, caption_display_1.scaleCaptionPx)(typeof background.radius_px === 'number' ? background.radius_px : 0, pxScale)
    } : undefined;
    const hasShadow = Object.prototype.hasOwnProperty.call(look, 'shadow');
    const hasGlow = Object.prototype.hasOwnProperty.call(look, 'glow');
    const lineShadow = lineStyle?.shadow;
    const lineGlow = lineStyle?.glow;
    const shadow = (0, caption_display_1.captionTextShadowValue)(hasShadow ? look.shadow : lineShadow, undefined, hasShadow ? pxScale : lineScale);
    const glow = (0, caption_display_1.captionTextShadowValue)(undefined, hasGlow ? look.glow : lineGlow, hasGlow ? pxScale : lineScale);
    const extras = lineStyle ? (0, caption_display_1.captionRichTextShadowValue)({ ...lineStyle, shadow: undefined, glow: undefined }, lineScale) : null;
    const shadowValue = (hasShadow ? look.shadow : lineShadow);
    const glowValue = (hasGlow ? look.glow : lineGlow);
    const shadowExtent = shadowValue && typeof shadowValue.color === 'string'
        ? (0, caption_display_1.scaleCaptionPx)(Math.abs(Number(shadowValue.distance_px) || 0) + (Number(shadowValue.blur_px) || 0), hasShadow ? pxScale : lineScale) : 0;
    const glowExtent = glowValue && typeof glowValue.color === 'string'
        ? (0, caption_display_1.scaleCaptionPx)(Math.abs(Number(glowValue.offset_x) || 0) + Math.abs(Number(glowValue.offset_y) || 0)
            + 2 * (typeof glowValue.spread === 'number' ? glowValue.spread : 40), hasGlow ? pxScale : lineScale) : 0;
    const inner = lineStyle?.stroke_inner;
    const extrude = lineStyle?.extrude;
    const lineExtent = (0, caption_display_1.scaleCaptionPx)(Math.max(Number(inner?.width_px) || 0, Number(extrude?.depth_px) || 0), lineScale);
    const inkOutset = Math.max(plate?.padding_px ?? 0, shadowExtent, glowExtent, lineExtent);
    return { style, ...(plate || hasShadow || hasGlow ? { resolved_look: {
                ...(plate ? { plate } : {}),
                ink_outset_px: inkOutset,
                rotate_deg: typeof look.rotate_deg === 'number' ? look.rotate_deg : 0,
                ...(hasShadow || hasGlow ? { text_shadow: [extras, shadow, glow].filter(Boolean).join(', ') || 'none' } : {})
            } } : {}) };
}
function captionRenderInputFromV1(root, options = {}) {
    const rows = Array.isArray(root) ? root : root.captions;
    const diagnostics = (0, caption_semantics_1.validateCaptionsSemantics)({ captions: root });
    const validRuns = rows.map((row, index) => Array.isArray(row.runs)
        ? (0, caption_semantics_1.renderableCaptionRuns)(row, root, { diagnostics, index }) : []);
    if (!rows.some((row, index) => validRuns[index].length !== rowRuns(row).length
        || rowRuns(row).some(run => run && typeof run === 'object'
            && (run.look || run.dormant_animation || run.migrated_from))))
        return root;
    const copy = structuredClone(root);
    const nextRows = Array.isArray(copy) ? copy : copy.captions;
    const emphasis = Array.isArray(copy) ? [] : [...(copy.emphasis_words ?? [])];
    const migrated = [];
    for (const [rowIndex, row] of nextRows.entries()) {
        if (!Array.isArray(row.runs))
            continue;
        row.runs = validRuns[rowIndex];
        const defaultStyle = Array.isArray(copy) ? null : copy.default_text_style;
        const lineStyle = (0, caption_display_1.mergeCaptionLineTextStyles)(defaultStyle, row.text_style);
        row.runs = row.runs.flatMap((run) => {
            if (!run || typeof run !== 'object' || Array.isArray(run))
                return [run];
            if (run.migrated_from && !run.look && run.anchor) {
                const hint = Object.keys(exports.CAPTION_EMPHASIS_MOTION)
                    .find(key => exports.CAPTION_EMPHASIS_MOTION[key] === run.motion?.in?.id);
                const restored = run.migrated_emphasis?.item;
                if (restored)
                    migrated.push({ index: run.migrated_emphasis.index, item: structuredClone(restored) });
                else if (hint)
                    emphasis.push({ id: run.migrated_from,
                        word: (0, caption_runs_1.captionGraphemes)(row.display_text ?? row.text ?? '').slice(run.from, run.to).join(''),
                        t_start: run.anchor.start, t_end: run.anchor.end, emotion: run.emotion ?? 'emphasis',
                        style_hint: hint, ...(run.anchor.src ? { src: run.anchor.src } : {}) });
                return [];
            }
            const next = { ...run };
            if (next.look) {
                const resolved = resolveCaptionRunLook(next.look, lineStyle, options.output);
                if (!next.style)
                    next.style = resolved.style;
                if (resolved.resolved_look)
                    next.resolved_look = resolved.resolved_look;
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
