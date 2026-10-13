import { captionGraphemes, type CaptionRun } from './caption-runs';
import { anchorToOutput } from './caption-anchor-map';
import type { TimelineMapResult } from './timeline-map';
import type { EditCut } from './edit-store';

export interface CaptionSemanticDiagnostic { code: string; severity: 'error' | 'warning' | 'info';
    path: string; message: string; layer: 'document' | 'project' | 'path' }
export interface CaptionSemanticsContext {
    captions: { captions?: Array<Record<string, unknown>>; unresolved_runs?: Array<{ run?: CaptionRun }>;
        emphasis_words?: Array<Record<string, unknown>>; default_text_style?: unknown }
        | Array<Record<string, unknown>> | null;
    edit?: { cuts?: EditCut[]; sources?: Array<{ id: string }> };
    timeline?: TimelineMapResult | readonly EditCut[];
    path?: 'preview' | 'render-cut' | 'osr' | 'gpu';
    gpuMotionIds?: ReadonlySet<string>;
    assetHashes?: Readonly<Record<string, string | undefined>>;
}

export function validateCaptionsSemantics(ctx: CaptionSemanticsContext): CaptionSemanticDiagnostic[] {
    const root = ctx.captions;
    const rows = Array.isArray(root) ? root : root && Array.isArray(root.captions) ? root.captions : [];
    const diagnostics: CaptionSemanticDiagnostic[] = [];
    const counts = new Map<string, number>();
    for (const row of rows) for (const run of row && typeof row === 'object' && Array.isArray(row.runs) ? row.runs as CaptionRun[] : []) {
        if (run && typeof run === 'object' && run.id) counts.set(run.id, (counts.get(run.id) ?? 0) + 1);
    }
    const unresolved = !root || Array.isArray(root) ? [] :
        (Array.isArray(root.unresolved_runs) ? root.unresolved_runs as Array<{ run?: CaptionRun }> : []);
    const emphasisWords = !root || Array.isArray(root) || !Array.isArray(root.emphasis_words) ? []
        : (root.emphasis_words as Array<Record<string, unknown>>).filter(item => item
            && typeof item.id === 'string' && /^e-\d{4}$/.test(item.id)
            && typeof item.word === 'string' && /\S/.test(item.word)
            && typeof item.emotion === 'string' && /\S/.test(item.emotion)
            && typeof item.t_start === 'number' && Number.isFinite(item.t_start) && item.t_start >= 0
            && typeof item.t_end === 'number' && Number.isFinite(item.t_end) && item.t_end > item.t_start
            && (item.src === undefined || typeof item.src === 'string' && /\S/.test(item.src))
            && (item.style_hint === undefined || typeof item.style_hint === 'string'));
    for (const item of unresolved) if (item && typeof item === 'object' && item.run?.id) {
        counts.set(item.run.id, (counts.get(item.run.id) ?? 0) + 1);
    }
    const add = (code: string, severity: CaptionSemanticDiagnostic['severity'], path: string,
        message: string, layer: CaptionSemanticDiagnostic['layer']): void => {
        diagnostics.push({ code, severity, path, message, layer });
    };
    for (const [index, row] of rows.entries()) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const sources = [row.style_sources,
            ...(Array.isArray(row.runs) ? (row.runs as CaptionRun[]).map(run => run && typeof run === 'object' ? run.style_sources : undefined) : [])];
        if (ctx.assetHashes) for (const source of sources) {
            if (!source || typeof source !== 'object') continue;
            for (const part of Object.values(source as Record<string, unknown>)) {
                if (!part || typeof part !== 'object') continue;
                const requires = (part as { requires?: unknown }).requires;
                if (!Array.isArray(requires)) continue;
                for (const dependency of requires) {
                    if (!dependency || typeof dependency !== 'object') continue;
                    const required = dependency as { id?: string; hash?: string };
                    if (!required.id) continue;
                    const current = ctx.assetHashes[required.id];
                    const path = `captions.json#captions[${index}].style_sources`;
                    if (!current) add('captions.style.dependency-missing',
                        ctx.path === 'render-cut' || ctx.path === 'osr' || ctx.path === 'gpu' ? 'error' : 'warning',
                        path, `依存素材 ${required.id} が見つかりません。`, 'project');
                    else if (current !== required.hash) add('captions.style.dependency-changed', 'warning', path,
                        `依存素材 ${required.id} が当てたときと異なります。`, 'project');
                }
            }
        }
        const chars = captionGraphemes(typeof row.display_text === 'string' ? row.display_text : String(row.text ?? ''));
        const runs = Array.isArray(row.runs) ? row.runs as CaptionRun[] : [];
        const words = Array.isArray(row.words) ? row.words as Array<{ text?: string }> : [];
        const hasEmphasisDisplay = words.some(word => word && typeof word === 'object' && emphasisWords.some(item => {
            if (item.src !== undefined && item.src !== row.src) return false;
            const timedWord = word as { text?: string; sourceText?: string; start?: number; end?: number };
            const text = String(timedWord.sourceText ?? timedWord.text ?? '').normalize('NFKC').toLowerCase();
            const emphasisText = typeof item.word === 'string' ? item.word.normalize('NFKC').toLowerCase() : '';
            return text.length > 0 && emphasisText.length > 0
                && (text === emphasisText || emphasisText.includes(text))
                && Number(item.t_end) > Number(timedWord.start) && Number(item.t_start) < Number(timedWord.end)
                && Number(item.t_end) > Number(row.start) && Number(item.t_start) < Number(row.end);
        }));
        const tokenRanges: Array<{ from: number; to: number }> = [];
        if (words.length && words.every(word => typeof word?.text === 'string')
            && words.map(word => word.text).join('') === chars.join('')) {
            let offset = 0;
            for (const word of words) {
                const next = offset + captionGraphemes(word.text!).length;
                tokenRanges.push({ from: offset, to: next });
                offset = next;
            }
        }
        for (const [runIndex, run] of runs.entries()) {
            if (!run || typeof run !== 'object' || Array.isArray(run)) continue;
            const path = `captions.json#captions[${index}].runs[${runIndex}]`;
            const v1 = ['id', 'look', 'motion', 'anchor', 'fire']
                .some(key => Object.prototype.hasOwnProperty.call(run, key));
            if (v1 && (!Number.isInteger(run.from) || !Number.isInteger(run.to)
                || run.from < 0 || run.to > chars.length || run.from >= run.to)) {
                add('captions.run.range', 'error', path, '文字範囲が表示文字数の外にあります。', 'document');
            }
            if (run.id) {
                if ((counts.get(run.id) ?? 0) > 1) add('captions.run.id', 'error', path,
                    `範囲 ID ${run.id} が重複しています。`, 'document');
            }
            if (run.fire === 'spoken' && !run.anchor) {
                add('captions.run.anchor', 'error', path, '発話時に動かす範囲には実測時刻が必要です。', 'document');
            }
            const background = run.look && typeof run.look.background === 'object'
                ? run.look.background as Record<string, unknown> : null;
            const richRun = Boolean(background || run.resolved_look?.plate
                || run.resolved_look?.text_shadow !== undefined
                || run.look && (Object.prototype.hasOwnProperty.call(run.look, 'shadow')
                    || Object.prototype.hasOwnProperty.call(run.look, 'glow')));
            const rowStyle = row.text_style && typeof row.text_style === 'object'
                ? row.text_style as Record<string, unknown> : {};
            const defaultStyle = !Array.isArray(root) && root?.default_text_style
                && typeof root.default_text_style === 'object'
                ? root.default_text_style as Record<string, unknown> : {};
            const effective = { ...defaultStyle, ...rowStyle };
            const runStyle = run.look ?? run.style ?? {};
            if ((effective.underline === true || effective.strikethrough === true)
                && ['scale', 'letter_spacing_em', 'baseline_shift_em', 'rotate_deg', 'font_weight', 'italic']
                    .some(key => Object.prototype.hasOwnProperty.call(runStyle, key))) {
                add('captions.run.decoration-shape', 'warning', path,
                    '下線・打ち消しの行では範囲の字形を変える指定を描きません。', 'document');
            }
            const gradientEffects = Boolean(effective.fill_gradient && !effective.fill
                && (effective.stroke || effective.stroke_inner || effective.extrude
                    || effective.shadow || effective.glow));
            const hasEffects = Boolean(background || run.resolved_look?.plate
                || run.resolved_look?.text_shadow !== undefined
                || run.look && (Object.prototype.hasOwnProperty.call(run.look, 'shadow')
                    || Object.prototype.hasOwnProperty.call(run.look, 'glow')));
            if (richRun && typeof run.look?.rotate_deg === 'number' && run.look.rotate_deg !== 0
                && (effective.wrap_width_pct || effective.vertical)) {
                add('captions.run.rotation-wrap', 'warning', path,
                    '折り返す行の範囲は回転せずに描きます。', 'document');
            }
            if (hasEffects && gradientEffects) {
                add('captions.run.gradient-filter', 'warning', path,
                    '行にグラデーションと縁・影があるため、範囲の台紙・影・グローを描きません。', 'document');
            }
            if (richRun && effective.fill_gradient && !effective.fill && run.look?.color) {
                add('captions.run.gradient-color', 'warning', path,
                    'グラデーションの行では範囲の色を描けません。', 'document');
            }
            if (ctx.path === 'gpu' && !gradientEffects && hasEffects
                && [effective.animation && (effective.animation as { in?: { id?: string }; out?: { id?: string } }).in?.id,
                    effective.animation && (effective.animation as { in?: { id?: string }; out?: { id?: string } }).out?.id]
                    .includes('typewriter')) {
                add('captions.style.unsupported-path', 'error', path,
                    '文字送りと範囲の台紙・影・グローは GPU 経路で一緒に描けません。', 'path');
            }
            if (ctx.path === 'gpu' && words.length && richRun && !gradientEffects
                && (['karaoke', 'pop', 'reveal', 'reveal-word'].includes(String(row.style)) || hasEmphasisDisplay)) {
                add('captions.style.unsupported-path', 'error', path,
                    '語ごとの表示と範囲の台紙・影は GPU 経路で一緒に描けません。', 'path');
            }
            if (background) {
                const touched = tokenRanges.filter(token => token.from < run.to && token.to > run.from);
                const tokenSplit = touched.length > 1 && (run.from > touched[0].from
                    || run.to < touched[touched.length - 1].to);
                const emphasisSplit = emphasisWords.some(item => {
                    if (item.src !== undefined && item.src !== row.src) return false;
                    const value = captionGraphemes(item.word as string);
                    const positions: number[] = [];
                    for (let at = 0; at <= chars.length - value.length; at++) {
                        if (value.every((char, offset) => chars[at + offset] === char)) positions.push(at);
                    }
                    if (positions.length !== 1) return false;
                    const from = positions[0]; const to = from + value.length;
                    return (run.from < from && run.to > from && run.to < to)
                        || (run.from > from && run.from < to && run.to > to);
                });
                const crossing = runs.slice(0, runIndex).some(prior => prior && prior.from < run.to
                    && prior.to > run.from && !(prior.from >= run.from && prior.to <= run.to)
                    && !(run.from >= prior.from && run.to <= prior.to));
                if (tokenSplit || emphasisSplit || crossing) {
                    add('captions.run.plate-split', 'warning', path,
                        '語の境界または範囲の交差により、台紙を分けて描きます。', 'document');
                }
            }
            if (background && ['width_pct', 'height_pct', 'fit', 'offset_x', 'offset_y', 'mode']
                .some(key => Object.prototype.hasOwnProperty.call(background, key))) {
                add('captions.run.background-unused', 'warning', path,
                    '範囲の台紙では幅・高さ・合わせ方・位置・モードの指定を使いません。', 'document');
            }
            if (run.anchor) {
                const domain = row.time_domain === 'output' ? 'output' : 'source';
                const outsideWindow = run.anchor.domain === domain && (run.anchor.start < Number(row.start)
                    || run.anchor.end > Number(row.end) || run.anchor.start >= run.anchor.end);
                const mappedCodes = new Set<string>();
                if (ctx.timeline) {
                    const mapped = anchorToOutput(run.anchor,
                        { src: typeof row.src === 'string' ? row.src : undefined,
                            start: Number(row.start), end: Number(row.end), time_domain: domain }, ctx.timeline, run.fire);
                    for (const result of mapped) for (const warning of result.diagnostics) {
                        if (mappedCodes.has(warning.code)) continue;
                        mappedCodes.add(warning.code);
                        add(warning.code, warning.severity, path, warning.message, 'project');
                    }
                }
                if (outsideWindow && !mappedCodes.has('captions.run.anchor-window')) {
                    add('captions.run.anchor-window', 'warning', path, '範囲の実測時刻を行の表示窓へ切り詰めます。', 'project');
                }
            }
            if (ctx.path === 'gpu' && run.motion) {
                for (const slot of Object.values(run.motion)) {
                    if (slot && ctx.gpuMotionIds && !ctx.gpuMotionIds.has(slot.id)) {
                        add('captions.style.unsupported-path', 'error', path,
                            `GPU 経路で動き ${slot.id} を描けません。`, 'path');
                    }
                }
            }
        }
    }
    for (const [index, item] of unresolved.entries()) {
        if (item && typeof item === 'object' && item.run?.id && (counts.get(item.run.id) ?? 0) > 1) {
            add('captions.run.id', 'error', `captions.json#unresolved_runs[${index}].run`,
                `範囲 ID ${item.run.id} が重複しています。`, 'document');
        }
    }
    return diagnostics;
}

export function renderableCaptionRuns(caption: { text: string; display_text?: string; runs?: CaptionRun[] },
    document: CaptionSemanticsContext['captions'],
    options: { diagnostics?: readonly CaptionSemanticDiagnostic[]; index?: number } = {}): CaptionRun[] {
    const rows = Array.isArray(document) ? document : Array.isArray(document?.captions) ? document.captions : [];
    const index = options.index ?? rows.indexOf(caption as Record<string, unknown>);
    const invalid = new Set((options.diagnostics ?? validateCaptionsSemantics({ captions: document }))
        .filter(item => item.severity === 'error' && item.layer === 'document')
        .flatMap(item => {
            const match = /captions\[(\d+)\]\.runs\[(\d+)\]/.exec(item.path);
            return match && Number(match[1]) === index ? [Number(match[2])] : [];
        }));
    if (!Array.isArray(caption?.runs)) return caption?.runs ?? [];
    return caption.runs.filter((_run, runIndex) => !invalid.has(runIndex));
}
