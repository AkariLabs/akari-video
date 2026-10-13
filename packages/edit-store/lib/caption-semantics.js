"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCaptionsSemantics = validateCaptionsSemantics;
exports.renderableCaptionRuns = renderableCaptionRuns;
const caption_runs_1 = require("./caption-runs");
const caption_anchor_map_1 = require("./caption-anchor-map");
function validateCaptionsSemantics(ctx) {
    const rows = Array.isArray(ctx.captions) ? ctx.captions : ctx.captions.captions ?? [];
    const diagnostics = [];
    const counts = new Map();
    for (const row of rows)
        for (const run of Array.isArray(row.runs) ? row.runs : []) {
            if (run.id)
                counts.set(run.id, (counts.get(run.id) ?? 0) + 1);
        }
    const unresolved = Array.isArray(ctx.captions) ? [] :
        (Array.isArray(ctx.captions.unresolved_runs) ? ctx.captions.unresolved_runs : []);
    for (const item of unresolved)
        if (item.run?.id) {
            counts.set(item.run.id, (counts.get(item.run.id) ?? 0) + 1);
        }
    const add = (code, severity, path, message, layer) => {
        diagnostics.push({ code, severity, path, message, layer });
    };
    for (const [index, row] of rows.entries()) {
        const sources = [row.style_sources,
            ...(Array.isArray(row.runs) ? row.runs.map(run => run.style_sources) : [])];
        if (ctx.assetHashes)
            for (const source of sources) {
                if (!source || typeof source !== 'object')
                    continue;
                for (const part of Object.values(source)) {
                    if (!part || typeof part !== 'object')
                        continue;
                    const requires = part.requires;
                    if (!Array.isArray(requires))
                        continue;
                    for (const dependency of requires) {
                        if (!dependency || typeof dependency !== 'object')
                            continue;
                        const required = dependency;
                        if (!required.id)
                            continue;
                        const current = ctx.assetHashes[required.id];
                        const path = `captions.json#captions[${index}].style_sources`;
                        if (!current)
                            add('captions.style.dependency-missing', ctx.path === 'render-cut' || ctx.path === 'osr' || ctx.path === 'gpu' ? 'error' : 'warning', path, `依存素材 ${required.id} が見つかりません。`, 'project');
                        else if (current !== required.hash)
                            add('captions.style.dependency-changed', 'warning', path, `依存素材 ${required.id} が当てたときと異なります。`, 'project');
                    }
                }
            }
        const chars = (0, caption_runs_1.captionGraphemes)(typeof row.display_text === 'string' ? row.display_text : String(row.text ?? ''));
        const runs = Array.isArray(row.runs) ? row.runs : [];
        for (const [runIndex, run] of runs.entries()) {
            const path = `captions.json#captions[${index}].runs[${runIndex}]`;
            if (!Number.isInteger(run.from) || !Number.isInteger(run.to)
                || run.from < 0 || run.to > chars.length || run.from >= run.to) {
                add('captions.run.range', 'error', path, '文字範囲が表示文字数の外にあります。', 'document');
            }
            if (run.id) {
                if ((counts.get(run.id) ?? 0) > 1)
                    add('captions.run.id', 'error', path, `範囲 ID ${run.id} が重複しています。`, 'document');
            }
            if (run.fire === 'spoken' && !run.anchor) {
                add('captions.run.anchor', 'error', path, '発話時に動かす範囲には実測時刻が必要です。', 'document');
            }
            if (run.anchor) {
                const domain = row.time_domain === 'output' ? 'output' : 'source';
                if (run.anchor.domain === domain && (run.anchor.start < Number(row.start)
                    || run.anchor.end > Number(row.end) || run.anchor.start >= run.anchor.end)) {
                    add('captions.run.anchor', 'error', path, '範囲の実測時刻が行の時刻の外にあります。', 'document');
                }
                if (ctx.timeline) {
                    const mapped = (0, caption_anchor_map_1.anchorToOutput)(run.anchor, { src: typeof row.src === 'string' ? row.src : undefined,
                        start: Number(row.start), end: Number(row.end), time_domain: domain }, ctx.timeline, run.fire);
                    for (const result of mapped)
                        for (const warning of result.diagnostics) {
                            add(warning.code, warning.severity, path, warning.message, 'project');
                        }
                }
            }
            if (ctx.path === 'gpu' && run.motion) {
                for (const slot of Object.values(run.motion)) {
                    if (slot && ctx.gpuMotionIds && !ctx.gpuMotionIds.has(slot.id)) {
                        add('captions.style.unsupported-path', 'error', path, `GPU 経路で動き ${slot.id} を描けません。`, 'path');
                    }
                }
            }
        }
    }
    for (const [index, item] of unresolved.entries()) {
        if (item.run?.id && (counts.get(item.run.id) ?? 0) > 1) {
            add('captions.run.id', 'error', `captions.json#unresolved_runs[${index}].run`, `範囲 ID ${item.run.id} が重複しています。`, 'document');
        }
    }
    return diagnostics;
}
function renderableCaptionRuns(caption, document) {
    const rows = Array.isArray(document) ? document : document.captions ?? [];
    const index = rows.indexOf(caption);
    const invalid = new Set(validateCaptionsSemantics({ captions: document })
        .filter(item => item.severity === 'error' && item.layer === 'document')
        .flatMap(item => {
        const match = /captions\[(\d+)\]\.runs\[(\d+)\]/.exec(item.path);
        return match && Number(match[1]) === index ? [Number(match[2])] : [];
    }));
    return (caption.runs ?? []).filter((_run, runIndex) => !invalid.has(runIndex));
}
