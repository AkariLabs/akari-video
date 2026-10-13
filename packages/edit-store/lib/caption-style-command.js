"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planCaptionStyleEdit = planCaptionStyleEdit;
exports.planCaptionStyleClear = planCaptionStyleClear;
exports.planCaptionStyleReapply = planCaptionStyleReapply;
exports.planCaptionSizeEdit = planCaptionSizeEdit;
const caption_hash_1 = require("./caption-hash");
const caption_anchor_map_1 = require("./caption-anchor-map");
const caption_look_v1_1 = require("./caption-look-v1");
const caption_runs_1 = require("./caption-runs");
const caption_style_preset_1 = require("./caption-style-preset");
const textstyle_catalog_1 = require("./generated/textstyle-catalog");
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const rowsOf = (root) => Array.isArray(root) ? root : root.captions;
const defaultOf = (root) => !Array.isArray(root) && record(root.default_text_style)
    ? root.default_text_style : {};
const projectedLook = (style) => {
    const look = (0, caption_look_v1_1.sanitizeMyStyleLook)(style);
    delete look.size_px;
    delete look.reference_height_px;
    return look;
};
const projectedRunLook = (style) => (0, caption_look_v1_1.sanitizeCaptionRunLook)(style).look;
const sourceRecord = (source, original, applied, at) => ({
    ...source, original_hash: (0, caption_hash_1.captionValueHash)(original), applied_hash: (0, caption_hash_1.captionValueHash)(applied), applied_at: at
});
const catalogRecord = (catalog) => catalog instanceof Map ? Object.fromEntries(catalog) : catalog;
const allRuns = (root) => [...rowsOf(root).flatMap(row => Array.isArray(row.runs) ? row.runs : []),
    ...(!Array.isArray(root) && Array.isArray(root.unresolved_runs)
        ? root.unresolved_runs.flatMap(item => item.run ? [item.run] : []) : [])];
function resolveRange(row, range) {
    const chars = (0, caption_runs_1.captionGraphemes)(row.display_text ?? row.text ?? '');
    if ('from' in range) {
        if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0
            || range.to > chars.length || range.from >= range.to)
            throw new Error('文字範囲が表示文字列の外か空です。');
        return range;
    }
    const normalized = chars.map(char => char.normalize('NFC'));
    const quote = (0, caption_runs_1.captionGraphemes)(range.quote).map(char => char.normalize('NFC'));
    const matches = [];
    if (quote.length)
        for (let index = 0; index <= chars.length - quote.length;) {
            if (quote.every((char, offset) => normalized[index + offset] === char)) {
                matches.push(index);
                index += quote.length;
            }
            else
                index++;
        }
    if (!matches.length)
        throw new Error('引用した文字が見つかりません。');
    if (range.occurrence !== undefined && (!Number.isInteger(range.occurrence)
        || range.occurrence < 1 || range.occurrence > matches.length)) {
        throw new Error(`候補は ${matches.length} 件です（occurrence は 1〜${matches.length}）。`);
    }
    if (matches.length > 1 && range.occurrence === undefined) {
        throw new Error(`引用した文字の候補は ${matches.length} 件です。occurrence で番号を指定してください。`);
    }
    const from = matches[(range.occurrence ?? 1) - 1];
    return { from, to: from + quote.length };
}
function findRow(root, id) {
    const found = rowsOf(root).filter(row => row && row.id === id);
    if (found.length !== 1)
        throw new Error(`字幕 ${id} が一意に見つかりません。`);
    return found[0];
}
function targetRow(root, target) {
    if ('caption_index' in target && target.caption_index !== undefined) {
        if (!Number.isInteger(target.caption_index) || target.caption_index < 0 || target.caption_index >= rowsOf(root).length)
            throw new Error(`字幕 index ${target.caption_index} が範囲外です。`);
        return rowsOf(root)[target.caption_index];
    }
    return findRow(root, target.caption_id);
}
function updateSources(value, parts, source, look, motion, at) {
    const sources = record(value.style_sources) ? { ...value.style_sources } : {};
    if (parts.look) {
        if (source)
            sources.look = sourceRecord(source, look, value instanceof Object && 'text_style' in value
                ? projectedLook(record(value.text_style) ? value.text_style : {}) : value.look ?? {}, at);
        else
            delete sources.look;
    }
    if (parts.motion) {
        if (source)
            sources.motion = sourceRecord(source, motion, 'text_style' in value
                ? (record(value.text_style) ? value.text_style.animation : undefined) ?? {} : value.motion ?? {}, at);
        else
            delete sources.motion;
    }
    if (Object.keys(sources).length)
        value.style_sources = sources;
    else
        delete value.style_sources;
}
function applyRowLook(row, defaultStyle, look, catalog, legacy) {
    const before = record(row.text_style) ? row.text_style : {};
    if (legacy?.merge === 'deep')
        return (0, caption_style_preset_1.mergePresetTextStyle)(before, look);
    if (legacy?.size === 'style') {
        const result = (0, caption_look_v1_1.lookForCaptionRow)(row, defaultStyle, look, { size: 'style', catalog });
        if (result.reason || !result.text_style)
            throw Object.assign(new Error(result.reason ?? '字幕の見た目を当てられません。'), result.reasonCode ? { code: result.reasonCode } : {});
        assertLayoutCompatible(result.text_style, defaultStyle);
        return result.text_style;
    }
    const preset = typeof row.style_preset === 'string' ? catalog[row.style_preset]?.style : undefined;
    const reference = before.reference_height_px ?? preset?.reference_height_px ?? defaultStyle.reference_height_px;
    const normalized = { ...row, text_style: { ...before,
            ...(reference !== undefined && before.layout === undefined ? { reference_height_px: reference } : {}) } };
    const result = (0, caption_look_v1_1.lookForCaptionRow)(normalized, defaultStyle, look, { size: 'keep', catalog });
    if (result.reason || !result.text_style)
        throw Object.assign(new Error(result.reason ?? '字幕の見た目を当てられません。'), result.reasonCode ? { code: result.reasonCode } : {});
    assertLayoutCompatible(result.text_style, defaultStyle);
    return result.text_style;
}
function assertLayoutCompatible(style, defaultStyle) {
    if ((style.layout ?? defaultStyle.layout) !== undefined
        && (style.reference_height_px ?? defaultStyle.reference_height_px) !== undefined) {
        throw Object.assign(new Error('layout と reference_height_px を同時に指定できません'), { code: 'AKARI_CAPTION_LAYOUT_REFERENCE_CONFLICT' });
    }
}
function migratePreset(row, catalog, notices, at, legacy) {
    if (typeof row.style_preset !== 'string')
        return;
    if (legacy?.preset === 'drop')
        return;
    const id = row.style_preset;
    const resolved = (0, caption_style_preset_1.resolveCaptionStylePreset)(row, catalog);
    if (!resolved.resolved) {
        notices.push(`字幕 ${row.id ?? ''} のスタイル ${id} が見つかりません。`);
        return;
    }
    const original = catalog instanceof Map ? catalog.get(id)?.style
        : catalog[id]?.style;
    row.text_style = resolved.record.text_style;
    const sources = record(row.style_sources) ? { ...row.style_sources } : {};
    sources.look = sourceRecord({ kind: 'builtin', id }, projectedLook(original ?? {}), projectedLook(record(row.text_style) ? row.text_style : {}), at);
    row.style_sources = sources;
    delete row.style_preset;
}
function planCaptionStyleEdit(input) {
    if (input.parts.sfx !== undefined || input.parts.effect !== undefined) {
        if (input.targets.some(target => 'range' in target && !!target.range))
            throw new Error('この部品は字幕全体にだけ当てられます。');
        throw new Error('効果音と効果はこの編集コマンドでは扱えません。');
    }
    if (!input.parts.look && !input.parts.motion && !input.targets.some(target => 'parts' in target && !!(target.parts?.look || target.parts?.motion)))
        throw new Error('当てる見た目か動きを指定してください。');
    let captions = structuredClone(input.captions);
    const rowList = rowsOf(captions);
    const rowIndex = new Map();
    rowList.forEach((row, index) => {
        if (typeof row.id !== 'string')
            return;
        const prior = rowIndex.get(row.id);
        rowIndex.set(row.id, { row, index, count: (prior?.count ?? 0) + 1 });
    });
    const usedRunIds = new Set(allRuns(captions).map(run => run.id).filter((id) => typeof id === 'string'));
    let nextRun = allRuns(captions).reduce((max, run) => {
        const match = /^r-(\d{4,})$/.exec(run.id ?? '');
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    const newRunId = () => {
        while (usedRunIds.has(`r-${String(nextRun).padStart(4, '0')}`))
            nextRun++;
        const id = `r-${String(nextRun++).padStart(4, '0')}`;
        usedRunIds.add(id);
        return id;
    };
    const catalog = input.catalog ?? textstyle_catalog_1.TEXTSTYLE_CATALOG;
    const catalogObject = catalogRecord(catalog);
    const changed = [];
    const notices = [];
    const at = input.now instanceof Date ? input.now.toISOString()
        : typeof input.now === 'string' ? new Date(input.now).toISOString() : new Date().toISOString();
    for (const target of input.targets) {
        const parts = 'parts' in target && target.parts ? { ...input.parts, ...target.parts } : input.parts;
        if (parts.sfx !== undefined || parts.effect !== undefined) {
            if ('range' in target && target.range)
                throw new Error('この部品は字幕全体にだけ当てられます。');
            throw new Error('効果音と効果はこの編集コマンドでは扱えません。');
        }
        if ('default' in target) {
            const current = defaultOf(captions);
            const next = { ...current };
            if (input.parts.look) {
                if (input.legacy?.merge === 'deep')
                    Object.assign(next, (0, caption_style_preset_1.mergePresetTextStyle)(next, input.parts.look));
                else {
                    for (const key of Object.keys(caption_look_v1_1.CAPTION_ROW_LOOK_FIELDS))
                        delete next[key];
                    const value = input.legacy?.size === 'style' ? (0, caption_look_v1_1.sanitizeMyStyleLook)(input.parts.look)
                        : applyRowLook({ text_style: current }, current, input.parts.look, catalogObject, input.legacy);
                    Object.assign(next, input.legacy ? value : roundPixels(value));
                }
            }
            if (input.parts.motion) {
                if (Object.keys(input.parts.motion).length)
                    next.animation = structuredClone(input.parts.motion);
                else
                    delete next.animation;
            }
            if (Array.isArray(captions))
                captions = { default_text_style: next, captions };
            else
                captions.default_text_style = next;
            changed.push('default_text_style');
            continue;
        }
        const indexed = 'caption_index' in target && target.caption_index !== undefined
            ? { row: rowList[target.caption_index], index: target.caption_index, count: 1 }
            : rowIndex.get(target.caption_id);
        if (!indexed?.row || indexed.count !== 1)
            throw new Error(`字幕 ${'caption_id' in target ? target.caption_id : target.caption_index} が一意に見つかりません。`);
        const { row } = indexed;
        if (target.range) {
            const { from, to } = resolveRange(row, target.range);
            const runs = Array.isArray(row.runs) ? row.runs : [];
            let run;
            for (const candidate of runs)
                if (candidate.id && candidate.from === from && candidate.to === to)
                    run = candidate;
            if (!run) {
                run = { id: newRunId(), from, to };
                const anchor = (0, caption_anchor_map_1.anchorForCaptionRange)(row, from, to);
                if (anchor.anchor)
                    run.anchor = anchor.anchor;
                else
                    notices.push(...anchor.diagnostics.map(item => item.message));
                runs.push(run);
                row.runs = runs;
            }
            if (parts.look) {
                const result = (0, caption_look_v1_1.lookForCaptionRun)(row, defaultOf(captions), parts.look, catalogObject);
                run.look = input.legacy ? result.look : roundPixels(result.look);
                notices.push(...result.notices);
            }
            if (parts.motion) {
                if (Object.keys(parts.motion).length)
                    run.motion = structuredClone(parts.motion);
                else
                    delete run.motion;
            }
            updateSources(run, parts, input.source, parts.look ? projectedRunLook(parts.look) : {}, parts.motion ?? {}, at);
            changed.push(`captions[${indexed.index}].runs`);
            continue;
        }
        migratePreset(row, catalog, notices, at, input.legacy);
        const before = record(row.text_style) ? row.text_style : {};
        const style = parts.look ? applyRowLook(row, defaultOf(captions), parts.look, catalogObject, input.legacy) : { ...before };
        if (parts.look && !input.legacy)
            Object.assign(style, roundPixels(style));
        if (parts.look && input.legacy?.preset === 'drop')
            delete row.style_preset;
        if (parts.motion) {
            if (Object.keys(parts.motion).length)
                style.animation = structuredClone(parts.motion);
            else
                delete style.animation;
        }
        row.text_style = style;
        updateSources(row, parts, input.source, parts.look ? projectedLook(parts.look) : {}, parts.motion ?? {}, at);
        changed.push(`captions[${indexed.index}].text_style`);
    }
    return { next: { captions, ...(input.edit === undefined ? {} : { edit: input.edit }),
            ...(input.assetReferences === undefined ? {} : { assetReferences: input.assetReferences }) }, changed, notices: [...new Set(notices)] };
}
function planCaptionStyleClear(input) {
    const captions = structuredClone(input.captions);
    const changed = [];
    for (const target of input.targets) {
        const row = findRow(captions, target.caption_id);
        if (!target.range && !target.run_id) {
            if (record(row.text_style)) {
                const style = { ...row.text_style };
                for (const key of Object.keys(caption_look_v1_1.CAPTION_ROW_LOOK_FIELDS))
                    if (key !== 'size_px' && key !== 'reference_height_px')
                        delete style[key];
                delete style.animation;
                if (Object.keys(style).length)
                    row.text_style = style;
                else
                    delete row.text_style;
            }
            delete row.style_sources;
            delete row.style_preset;
            changed.push(`captions[${rowsOf(captions).indexOf(row)}].text_style`);
            continue;
        }
        const runs = Array.isArray(row.runs) ? row.runs : [];
        const range = target.range ? resolveRange(row, target.range) : undefined;
        if (input.mode === 'run') {
            const before = runs.length;
            row.runs = runs.filter(run => target.run_id ? run.id !== target.run_id
                : run.from !== range?.from || run.to !== range?.to);
            if (row.runs.length === before)
                throw new Error('外す文字範囲がありません。');
        }
        else {
            const selected = range ?? runs.find(run => run.id === target.run_id);
            if (!selected)
                throw new Error('戻す文字範囲がありません。');
            row.runs = (0, caption_runs_1.clearCaptionRunRange)(runs, selected.from, selected.to, allRuns(captions));
        }
        changed.push(`captions[${rowsOf(captions).indexOf(row)}].runs`);
    }
    return { next: { captions }, changed, notices: [] };
}
function planCaptionStyleReapply(input) {
    const items = [];
    const notices = [];
    const wanted = input.targets;
    let root = structuredClone(input.captions);
    for (const row of rowsOf(root)) {
        const targets = [
            { target: { caption_id: row.id ?? '' }, value: row, run: false },
            ...(Array.isArray(row.runs) ? row.runs.map(run => ({ target: { caption_id: row.id ?? '',
                    range: { from: run.from, to: run.to } }, value: run, run: true })) : [])
        ];
        for (const entry of targets) {
            if (wanted && !wanted.some(target => JSON.stringify(target) === JSON.stringify(entry.target)))
                continue;
            const sources = record(entry.value.style_sources) ? entry.value.style_sources : {};
            for (const part of ['look', 'motion']) {
                const source = sources[part];
                if (!record(source))
                    continue;
                const found = input.styles.lookup?.(source) ?? (source.kind === 'builtin'
                    ? (() => {
                        const catalog = input.styles.builtin ?? textstyle_catalog_1.TEXTSTYLE_CATALOG;
                        const style = catalog instanceof Map ? catalog.get(String(source.id))?.style
                            : catalog[String(source.id)]?.style;
                        return style ? { look: style, motion: record(style.animation) ? style.animation : undefined } : undefined;
                    })()
                    : undefined);
                const current = entry.run ? (part === 'look' ? entry.value.look : entry.value.motion)
                    : part === 'look' ? projectedLook(record(entry.value.text_style) ? entry.value.text_style : {})
                        : record(entry.value.text_style) ? entry.value.text_style.animation : undefined;
                const modified = (0, caption_hash_1.captionValueHash)(current ?? {}) !== source.applied_hash;
                const original = found?.[part];
                const status = !original ? 'missing'
                    : (0, caption_hash_1.captionValueHash)(part === 'look' ? entry.run ? projectedRunLook(original) : projectedLook(original)
                        : original) === source.original_hash ? 'same' : 'updated';
                if (status === 'missing')
                    notices.push('元のスタイルが見つかりません。');
                items.push({ target: entry.target, part, source, status, modified });
                if (!input.apply?.some(candidate => candidate.part === part
                    && JSON.stringify(candidate.target) === JSON.stringify(entry.target)) || !original)
                    continue;
                const applied = planCaptionStyleEdit({ captions: root, targets: [entry.target],
                    parts: { [part]: original }, source: { kind: source.kind,
                        id: String(source.id), ...(typeof source.uid === 'string' ? { uid: source.uid } : {}),
                        ...('revision' in found && found.revision !== undefined ? { revision: found.revision } : {}) } });
                root = applied.next.captions;
            }
        }
    }
    return { items, ...(input.apply ? { next: { captions: root } } : {}), notices: [...new Set(notices)] };
}
function planCaptionSizeEdit(input) {
    if (!Number.isFinite(input.size_px) || input.size_px <= 0)
        throw new Error('大きさは正の数にしてください。');
    const captions = structuredClone(input.captions);
    const changed = [];
    for (const target of input.targets) {
        const row = findRow(captions, target.caption_id);
        const beforeSize = (0, caption_look_v1_1.captionEffectiveSize)(row, defaultOf(captions));
        if (beforeSize === input.size_px)
            continue;
        const style = record(row.text_style) ? row.text_style : {};
        const oldRunHashes = Array.isArray(row.runs) ? row.runs.map(run => run.look ? (0, caption_hash_1.captionValueHash)(run.look) : undefined) : [];
        const scaled = (0, caption_look_v1_1.scaleCaptionLookPixels)({ ...style, size_px: beforeSize }, input.size_px);
        const nextStyle = roundPixels(scaled);
        nextStyle.size_px = input.size_px;
        row.text_style = nextStyle;
        if (Array.isArray(row.runs))
            row.runs = row.runs.map(run => run.look
                ? { ...run, look: roundPixels((0, caption_look_v1_1.scaleCaptionLookPixels)({ ...run.look, size_px: beforeSize }, input.size_px)) }
                : run).map(run => {
                if (run.look)
                    delete run.look.size_px;
                return run;
            });
        const sources = record(row.style_sources) ? row.style_sources : undefined;
        const lookSource = sources && record(sources.look) ? sources.look : undefined;
        if (lookSource && (0, caption_hash_1.captionValueHash)(projectedLook(style)) === lookSource.applied_hash) {
            lookSource.applied_hash = (0, caption_hash_1.captionValueHash)(projectedLook(nextStyle));
        }
        if (Array.isArray(row.runs))
            for (const [index, run] of row.runs.entries()) {
                const source = record(run.style_sources) && record(run.style_sources.look) ? run.style_sources.look : undefined;
                if (source && run.look && oldRunHashes[index] === source.applied_hash)
                    source.applied_hash = (0, caption_hash_1.captionValueHash)(run.look);
            }
        changed.push(`captions[${rowsOf(captions).indexOf(row)}].text_style`);
    }
    return { next: { captions }, changed, notices: [] };
}
function roundPixels(value) {
    const next = structuredClone(value);
    for (const [key, fields] of Object.entries({ stroke: ['width_px'], background: ['radius_px', 'padding_px'],
        shadow: ['blur_px', 'distance_px'], glow: ['spread', 'offset_x', 'offset_y'] })) {
        const object = next[key];
        if (!record(object))
            continue;
        for (const field of fields)
            if (typeof object[field] === 'number')
                object[field] = (0, caption_runs_1.roundCaptionPixel)(object[field]);
    }
    if (Array.isArray(next.strokes))
        for (const stroke of next.strokes)
            if (record(stroke))
                for (const field of ['width_px', 'offset_x', 'offset_y'])
                    if (typeof stroke[field] === 'number')
                        stroke[field] = (0, caption_runs_1.roundCaptionPixel)(stroke[field]);
    if (record(next.fill) && record(next.fill.pattern) && typeof next.fill.pattern.scale === 'number')
        next.fill.pattern.scale = (0, caption_runs_1.roundCaptionPixel)(next.fill.pattern.scale);
    return next;
}
