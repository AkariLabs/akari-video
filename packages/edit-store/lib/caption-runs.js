"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captionGraphemes = captionGraphemes;
exports.setCaptionRunStyle = setCaptionRunStyle;
exports.setCaptionRunRole = setCaptionRunRole;
exports.removeCaptionRun = removeCaptionRun;
exports.captionRunStyleFromLook = captionRunStyleFromLook;
exports.resolveCaptionRuns = resolveCaptionRuns;
exports.sliceCaptionRuns = sliceCaptionRuns;
exports.roundCaptionPixel = roundCaptionPixel;
exports.rebaseCaptionRuns = rebaseCaptionRuns;
exports.joinAdjacentCaptionRuns = joinAdjacentCaptionRuns;
exports.nextCaptionRunId = nextCaptionRunId;
exports.clearCaptionRunRange = clearCaptionRunRange;
exports.splitCaptionRuns = splitCaptionRuns;
exports.unresolvedRunsForDeletedCaption = unresolvedRunsForDeletedCaption;
exports.moveDeletedCaptionRunsToUnresolved = moveDeletedCaptionRunsToUnresolved;
exports.captionRunsRemovedNotice = captionRunsRemovedNotice;
exports.applyCaptionRunsToHtml = applyCaptionRunsToHtml;
function captionGraphemes(text) {
    const Segmenter = Intl.Segmenter;
    return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
}
function validRunRange(text, from, to) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0
        || to <= from || to > captionGraphemes(text).length) {
        throw new Error('文字範囲が表示文字列の外にあります。');
    }
}
/** The last matching run owns edits to a range, preserving the order of overlapping runs. */
function setCaptionRunStyle(text, runs, from, to, patch) {
    validRunRange(text, from, to);
    const allowed = new Set(['color', 'font_weight', 'scale', 'baseline_shift_em', 'rotate_deg',
        'letter_spacing_em', 'stroke', 'italic', 'underline']);
    if (!patch || typeof patch !== 'object' || !Object.keys(patch).length
        || Object.entries(patch).some(([key, value]) => !allowed.has(key)
            || (key === 'color' && (typeof value !== 'string' || !/^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(value)))
            || (['font_weight', 'scale', 'baseline_shift_em', 'rotate_deg', 'letter_spacing_em'].includes(key)
                && (typeof value !== 'number' || !Number.isFinite(value)))
            || (key === 'font_weight' && (!Number.isInteger(value) || value < 1 || value > 1000))
            || (key === 'scale' && value <= 0)
            || (['italic', 'underline'].includes(key) && typeof value !== 'boolean')
            || (key === 'stroke' && (!value || typeof value !== 'object'
                || Object.keys(value).some(strokeKey => !['method', 'color', 'width_px'].includes(strokeKey))
                || value?.method !== undefined
                    && value?.method !== 'webkit-outline'
                || value?.color !== undefined
                    && !/^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(value.color)
                || value?.width_px !== undefined
                    && (typeof value?.width_px !== 'number'
                        || !Number.isFinite(value?.width_px)
                        || value.width_px < 0))))) {
        throw new Error('文字範囲に使えないスタイル項目があります。');
    }
    const next = [...(runs ?? [])];
    const index = next.map(run => run.from === from && run.to === to).lastIndexOf(true);
    const existing = index >= 0 ? next[index] : { from, to };
    const style = { ...existing.style, ...patch,
        ...(patch.stroke ? { stroke: { ...existing.style?.stroke, ...patch.stroke } } : {}) };
    const updated = { ...existing, style };
    if (index >= 0)
        next[index] = updated;
    else
        next.push(updated);
    return next;
}
function setCaptionRunRole(text, runs, from, to, role) {
    validRunRange(text, from, to);
    if (typeof role !== 'string' || !role.trim())
        throw new Error('文字範囲の役割が空です。');
    const next = [...(runs ?? [])];
    const index = next.map(run => run.from === from && run.to === to).lastIndexOf(true);
    const existing = index >= 0 ? next[index] : { from, to };
    const updated = { ...existing, role };
    if (index >= 0)
        next[index] = updated;
    else
        next.push(updated);
    return next;
}
function removeCaptionRun(runs, index) {
    if (!Number.isInteger(index) || index < 0 || index >= (runs?.length ?? 0)) {
        throw new Error('外す文字範囲がありません。');
    }
    return runs.filter((_run, position) => position !== index);
}
/** Map only the nine v0 fields from a saved look. */
function captionRunStyleFromLook(look, baseSizePx) {
    const aliases = {
        color: 'color', fontWeight: 'font_weight', font_weight: 'font_weight', weight: 'font_weight',
        scale: 'scale', rotate: 'rotate_deg', rotate_deg: 'rotate_deg',
        letterSpacingEm: 'letter_spacing_em', letter_spacing_em: 'letter_spacing_em',
        baseline_shift_em: 'baseline_shift_em',
        italic: 'italic', underline: 'underline', stroke: 'stroke'
    };
    const style = {};
    const omitted = [];
    for (const [key, value] of Object.entries(look)) {
        const field = aliases[key];
        if (key === 'size_px' || key === 'sizePx') {
            if (typeof value === 'number' && Number.isFinite(baseSizePx) && baseSizePx > 0) {
                style.scale = value / baseSizePx;
            }
            else
                omitted.push(key);
            continue;
        }
        if (!field) {
            omitted.push(key);
            continue;
        }
        if (field === 'stroke' && value && typeof value === 'object') {
            const stroke = value;
            const mapped = {};
            if (typeof stroke.color === 'string')
                mapped.color = stroke.color;
            if (typeof stroke.width_px === 'number')
                mapped.width_px = stroke.width_px;
            if (typeof stroke.widthPx === 'number')
                mapped.width_px = stroke.widthPx;
            if (stroke.method === 'webkit-outline')
                mapped.method = 'webkit-outline';
            if (stroke.method !== undefined && stroke.method !== 'webkit-outline')
                omitted.push('stroke.method');
            if (Object.keys(mapped).length)
                style.stroke = mapped;
            for (const strokeKey of Object.keys(stroke)) {
                if (!['color', 'width_px', 'widthPx', 'method'].includes(strokeKey))
                    omitted.push(`stroke.${strokeKey}`);
            }
        }
        else if (field === 'color' && typeof value === 'string')
            style.color = value;
        else if (field === 'font_weight' && typeof value === 'number')
            style.font_weight = value;
        else if (field === 'scale' && typeof value === 'number')
            style.scale = value;
        else if (field === 'rotate_deg' && typeof value === 'number')
            style.rotate_deg = value;
        else if (field === 'baseline_shift_em' && typeof value === 'number')
            style.baseline_shift_em = value;
        else if (field === 'letter_spacing_em' && typeof value === 'number')
            style.letter_spacing_em = value;
        else if (field === 'italic' && typeof value === 'boolean')
            style.italic = value;
        else if (field === 'underline' && typeof value === 'boolean')
            style.underline = value;
        else
            omitted.push(key);
    }
    return { style, omitted };
}
function resolveCaptionRuns(text, runs) {
    const characters = captionGraphemes(text).map((value, index) => ({ text: value, index }));
    for (const run of runs ?? []) {
        if (!Number.isInteger(run?.from) || !Number.isInteger(run?.to)
            || run.from < 0 || run.to > characters.length || run.from >= run.to)
            continue;
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
function sliceCaptionRuns(text, runs, start, end) {
    if (!runs?.length)
        return undefined;
    const from = captionGraphemes(text.slice(0, start)).length;
    const to = captionGraphemes(text.slice(0, end)).length;
    const result = runs.flatMap(run => {
        if (!run || typeof run !== 'object' || Array.isArray(run))
            return [run];
        const left = Math.max(from, run.from);
        const right = Math.min(to, run.to);
        return left < right ? [{ ...run, from: left - from, to: right - from }] : [];
    });
    return result.length ? result : undefined;
}
/** 描画に渡す px 値の浮動小数点誤差をそろえる。 */
function roundCaptionPixel(value) {
    return Math.round(value * 1_000_000) / 1_000_000;
}
/** 複数の差分区間を、書記素 LCS で対応付ける。 */
function rebaseCaptionRuns(oldText, newText, runs, options = {}) {
    const oldChars = captionGraphemes(oldText);
    const newChars = captionGraphemes(newText);
    let prefix = 0;
    while (prefix < Math.min(oldChars.length, newChars.length) && oldChars[prefix] === newChars[prefix])
        prefix++;
    let suffix = 0;
    while (suffix < Math.min(oldChars.length, newChars.length) - prefix
        && oldChars[oldChars.length - 1 - suffix] === newChars[newChars.length - 1 - suffix])
        suffix++;
    const oldMiddle = oldChars.slice(prefix, oldChars.length - suffix);
    const newMiddle = newChars.slice(prefix, newChars.length - suffix);
    const lengths = Array.from({ length: oldMiddle.length + 1 }, () => new Uint32Array(newMiddle.length + 1));
    for (let i = oldMiddle.length - 1; i >= 0; i--)
        for (let j = newMiddle.length - 1; j >= 0; j--) {
            lengths[i][j] = oldMiddle[i] === newMiddle[j] ? 1 + lengths[i + 1][j + 1]
                : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
        }
    const mapped = new Map();
    const ambiguous = new Set();
    for (let n = 0; n < prefix; n++)
        mapped.set(n, n);
    let i = 0;
    let j = 0;
    while (i < oldMiddle.length && j < newMiddle.length) {
        if (oldMiddle[i] === newMiddle[j]) {
            mapped.set(prefix + i, prefix + j);
            i++;
            j++;
        }
        else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
            i++;
        }
        else {
            j++;
        }
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
        const canSkip = Array.from({ length: newMiddle.length + 1 }, (_, newIndex) => prefixes[middleIndex][newIndex] + lengths[middleIndex + 1][newIndex])
            .some(length => length === lengths[0][0]);
        if (choices > 1 || canSkip)
            ambiguous.add(oldIndex);
    }
    for (let n = 0; n < suffix; n++)
        mapped.set(oldChars.length - suffix + n, newChars.length - suffix + n);
    const changes = [];
    let oldBoundary = 0;
    let newBoundary = 0;
    for (const [oldIndex, newIndex] of [...mapped, [oldChars.length, newChars.length]]) {
        if (oldBoundary < oldIndex || newBoundary < newIndex) {
            changes.push({ oldFrom: oldBoundary, oldTo: oldIndex,
                newFrom: newBoundary, newTo: newIndex });
        }
        oldBoundary = oldIndex + 1;
        newBoundary = newIndex + 1;
    }
    const kept = [];
    const removed = [];
    for (const run of runs) {
        const containing = changes.find(change => change.oldFrom <= run.from
            && run.to <= change.oldTo && change.oldFrom < change.oldTo);
        if (containing) {
            if (options.mode === 'project' && containing.newFrom < containing.newTo) {
                kept.push({ ...run, from: containing.newFrom, to: containing.newTo, needs_review: true });
            }
            else
                removed.push(run);
            continue;
        }
        const matches = Array.from({ length: Math.max(0, run.to - run.from) }, (_, n) => run.from + n)
            .filter(index => mapped.has(index));
        if (!matches.length) {
            removed.push(run);
            continue;
        }
        let from = mapped.get(matches[0]);
        let to = mapped.get(matches[matches.length - 1]) + 1;
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
function joinAdjacentCaptionRuns(runs) {
    return [...runs];
}
function nextCaptionRunId(runs) {
    const number = runs.reduce((max, run) => {
        const match = /^r-(\d{4,})$/.exec(run?.id ?? '');
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
    return `r-${String(number).padStart(4, '0')}`;
}
function clearCaptionRunRange(runs, from, to, allRuns = runs) {
    const result = [];
    const used = [...allRuns];
    for (const run of runs) {
        if (run.to <= from || run.from >= to) {
            result.push(run);
            continue;
        }
        const baseId = run.id ?? nextCaptionRunId(used);
        if (!run.id)
            used.push({ ...run, id: baseId });
        if (run.from < from)
            result.push({ ...run, id: baseId, to: from });
        if (run.to > to) {
            const id = run.from < from ? nextCaptionRunId(used) : baseId;
            if (id !== baseId)
                used.push({ ...run, id });
            result.push({ ...run, from: to, id,
                ...(id !== baseId ? { split_from: baseId } : {}) });
        }
    }
    return result;
}
function splitCaptionRuns(text, runs, splitUtf16, leftWindow, rightWindow, allRuns = runs) {
    const boundary = captionGraphemes(text.slice(0, splitUtf16)).length;
    const left = [];
    const right = [];
    const used = [...allRuns];
    const clip = (run, window) => {
        if (!run.anchor)
            return run;
        const start = Math.max(run.anchor.start, window.start);
        const end = Math.min(run.anchor.end, window.end);
        if (start < end)
            return { ...run, anchor: { ...run.anchor, start, end } };
        const { anchor: _anchor, ...rest } = run;
        return run.fire === 'spoken' ? { ...rest, fire: 'shown', fire_was: 'spoken', needs_review: true } : rest;
    };
    for (const run of runs) {
        const baseId = run.id ?? nextCaptionRunId(used);
        if (!run.id)
            used.push({ ...run, id: baseId });
        if (run.from < boundary && run.to > 0)
            left.push(clip({ ...run, id: baseId,
                to: Math.min(run.to, boundary) }, leftWindow));
        if (run.to > boundary) {
            const crosses = run.from < boundary;
            const id = crosses ? nextCaptionRunId(used) : baseId;
            if (crosses && id)
                used.push({ ...run, id });
            right.push(clip({ ...run, from: Math.max(0, run.from - boundary), to: run.to - boundary,
                id, ...(crosses ? { split_from: baseId } : {}) }, rightWindow));
        }
    }
    return { left: left.length ? left : undefined, right: right.length ? right : undefined };
}
function unresolvedRunsForDeletedCaption(caption, reason = '行の対応先がありません。') {
    return (caption.runs ?? []).map(run => ({ run: { ...run }, old_caption_id: caption.id,
        old_text: caption.text, old_src: caption.src ?? null,
        old_start: caption.start, old_end: caption.end, reason }));
}
function moveDeletedCaptionRunsToUnresolved(root, captionId, reason = '行の対応先がありません。') {
    const deleted = root.captions.find(row => row.id === captionId);
    if (!deleted)
        return structuredClone(root);
    return { ...structuredClone(root), captions: root.captions.filter(row => row.id !== captionId).map(row => structuredClone(row)),
        unresolved_runs: [...(root.unresolved_runs ?? []).map(item => structuredClone(item)),
            ...unresolvedRunsForDeletedCaption(deleted, reason)] };
}
/** Text-only notice for a caller that can present caption edit results to a user. */
function captionRunsRemovedNotice(removedRuns, oldDisplayText) {
    if (removedRuns.length === 0)
        return undefined;
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
function applyCaptionRunsToHtml(html, displayText, runs) {
    if (!runs?.length)
        return html;
    const Segmenter = Intl.Segmenter;
    const segment = (value) => Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value), item => item.segment);
    const chars = segment(displayText);
    const defaultStroke = html.includes('akari-caption--single-line') ? '0 transparent' : '0.14em rgba(0,0,0,.9)';
    if (!runs.some(run => Number.isInteger(run?.from) && Number.isInteger(run?.to)
        && run.from >= 0 && run.to <= chars.length && run.from < run.to))
        return html;
    const richRuns = runs.filter(run => run?.resolved_look?.plate || run?.resolved_look?.text_shadow !== undefined);
    const resolved = chars.map((value, index) => ({ text: value, index, style: {},
        role: '', shadow: undefined, plateTransform: false }));
    for (const run of runs) {
        if (!Number.isInteger(run?.from) || !Number.isInteger(run?.to)
            || run.from < 0 || run.to > chars.length || run.from >= run.to)
            continue;
        const style = run.style ?? (run.look ? { ...run.look } : undefined);
        if (run.look && !run.style && style) {
            const scale = typeof style.scale === 'number' && Number.isFinite(style.scale) && style.scale > 0
                ? style.scale : 1;
            const stroke = style.stroke;
            if (stroke && typeof stroke.width_px === 'number')
                style.stroke = {
                    ...stroke, width_px: Math.round(stroke.width_px * scale * 1_000_000) / 1_000_000
                };
        }
        for (let index = run.from; index < run.to; index++) {
            resolved[index] = { ...resolved[index],
                role: run.role ?? resolved[index].role,
                shadow: run.resolved_look?.text_shadow ?? resolved[index].shadow,
                plateTransform: Boolean(run.resolved_look?.plate) || resolved[index].plateTransform,
                style: { ...resolved[index].style, ...style,
                    ...(style?.stroke ? { stroke: { ...(resolved[index].style.stroke ?? {}), ...style.stroke } } : {}) } };
        }
    }
    const escape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const decode = (value) => value.replace(/&(amp|lt|gt|quot|#0?39);/g, (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#039': "'" })[key] ?? _);
    let position = 0;
    const decorate = (encoded) => {
        const value = decode(encoded);
        return segment(value).map(character => {
            const item = resolved[position++];
            if (!item || item.text !== character || (!item.role && !Object.keys(item.style).length)) {
                return escape(character);
            }
            const style = item.style;
            const css = ['display:inline-block', 'vertical-align:baseline', 'line-height:1'];
            const scale = typeof style.scale === 'number' && Number.isFinite(style.scale) && style.scale > 0
                ? style.scale : 1;
            if (scale !== 1)
                css.push(`font-size:${scale}em`);
            // Re-resolve em values on the run: inherited computed lengths stay at the parent's px size.
            if (typeof style.letter_spacing_em === 'number' && Number.isFinite(style.letter_spacing_em)) {
                css.push(`letter-spacing:${style.letter_spacing_em}em`);
            }
            else if (scale !== 1) {
                css.push('letter-spacing:var(--caption-letter-spacing,normal)');
            }
            if (scale !== 1)
                css.push(`-webkit-text-stroke:var(--caption-webkit-text-stroke,var(--caption-stroke,${defaultStroke}))`);
            if (typeof style.color === 'string' && /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(style.color))
                css.push(`color:${style.color}`);
            if (Number.isInteger(style.font_weight) && style.font_weight >= 1 && style.font_weight <= 1000)
                css.push(`font-weight:${style.font_weight}`);
            if (style.italic === true)
                css.push('font-style:italic');
            if (style.underline === true)
                css.push('text-decoration:underline');
            const stroke = style.stroke;
            if (stroke && typeof stroke.width_px === 'number' && Number.isFinite(stroke.width_px)
                && stroke.width_px >= 0 && (!stroke.color || /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(stroke.color))) {
                css.push(`-webkit-text-stroke:${stroke.width_px}px ${stroke.color ?? 'currentColor'}`);
            }
            const shift = typeof style.baseline_shift_em === 'number' && Number.isFinite(style.baseline_shift_em)
                ? style.baseline_shift_em : 0;
            const rotate = typeof style.rotate_deg === 'number' && Number.isFinite(style.rotate_deg)
                ? style.rotate_deg : 0;
            if ((shift || rotate) && !item.plateTransform)
                css.push(scale === 1
                    ? `transform:translateY(${shift}em) rotate(${rotate}deg) scale(1)`
                    : `transform:translateY(${shift / scale}em) rotate(${rotate}deg)`);
            if (item.shadow !== undefined)
                css.push(`text-shadow:none`, `position:relative`, `--akari-run-shadow:${item.shadow}`);
            return `<span class="akari-caption__run"${item.role ? ` data-role="${escape(item.role)}"` : ''}${item.shadow !== undefined
                ? ` data-akari-shadow-text="${escape(character)}"` : ''} style="${css.join(';')}">${escape(character)}</span>`;
        }).join('');
    };
    // Limit parsing to caption line contents, leaving CSS and plate markup untouched.
    const renderedHtml = html.replace(/(<p class="akari-caption__line">)([\s\S]*?)(<\/p>)/g, (_whole, open, content, close) => {
        const rendered = content.replace(/(<span class="akari-caption__char"[^>]*>)([^<]*)(<\/span>)|(<[^>]+>)|([^<]+)/g, (whole, charOpen, charText, charClose, tag, plain) => {
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
    if (!richRuns.length)
        return renderedHtml;
    let lineStart = 0;
    const layered = renderedHtml.replace(/(<p class="akari-caption__line">)([\s\S]*?)(<\/p>)/g, (_whole, open, content, close) => {
        const units = [];
        const containers = [];
        const stack = [];
        let index = lineStart;
        const tokens = /<span class="akari-caption__run"[^>]*>[^<]*<\/span>|<[^>]+>|[^<]+/g;
        for (const match of content.matchAll(tokens)) {
            const token = match[0];
            const start = match.index;
            const end = start + token.length;
            if (/^<span class="akari-caption__run"/.test(token)) {
                const value = decode(token.replace(/^<[^>]+>/, '').replace(/<\/span>$/, ''));
                for (const _char of segment(value))
                    units.push({ index: index++, start, end,
                        containers: [...stack] });
            }
            else if (/^<span\b/.test(token)) {
                const kind = /class="[^"]*\bakari-caption__tok\b/.test(token) ? 'tok'
                    : /class="[^"]*\bakari-caption__char\b/.test(token) ? 'char' : 'span';
                const container = { kind, start, end, from: index, to: index };
                containers.push(container);
                stack.push(container);
            }
            else if (token === '</span>') {
                const container = stack.pop();
                if (container) {
                    container.end = end;
                    container.to = index;
                }
            }
            else if (!token.startsWith('<')) {
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
        const fragments = [];
        for (const run of richRuns) {
            const runIndex = runs.indexOf(run);
            const selected = units.filter(unit => unit.index >= run.from && unit.index < run.to);
            if (!selected.length)
                continue;
            const boundaries = new Set();
            for (const prior of runs.slice(0, runIndex)) {
                if (!prior || prior.from >= run.to || prior.to <= run.from)
                    continue;
                if (prior.from >= run.from && prior.to <= run.to)
                    continue;
                if (run.from >= prior.from && run.to <= prior.to)
                    continue;
                if (prior.from > run.from && prior.from < run.to)
                    boundaries.add(prior.from);
                if (prior.to > run.from && prior.to < run.to)
                    boundaries.add(prior.to);
            }
            const firstTok = (unit) => unit.containers.find(item => item.kind === 'tok');
            const groups = [];
            let group = [];
            for (const unit of selected) {
                const previous = group[group.length - 1];
                const tok = firstTok(unit);
                const priorTok = previous && firstTok(previous);
                const crossing = previous && boundaries.has(unit.index);
                const partialTokCrossing = previous && tok !== priorTok &&
                    ((priorTok && group[0].index > priorTok.from) || (tok && selected[selected.length - 1].index + 1 < tok.to));
                if (previous && (crossing || partialTokCrossing)) {
                    groups.push(group);
                    group = [];
                }
                group.push(unit);
            }
            if (group.length)
                groups.push(group);
            for (const part of groups) {
                const first = part[0];
                const last = part[part.length - 1];
                let start = first.start;
                let end = last.end;
                const firstToken = firstTok(first);
                const lastToken = firstTok(last);
                if (firstToken && firstToken === lastToken) {
                    if (first.index === firstToken.from && last.index + 1 === firstToken.to) {
                        start = firstToken.start;
                        end = firstToken.end;
                    }
                }
                else if (firstToken && lastToken && first.index === firstToken.from
                    && last.index + 1 === lastToken.to) {
                    start = firstToken.start;
                    end = lastToken.end;
                }
                const firstChar = first.containers.find(item => item.kind === 'char');
                const lastChar = last.containers.find(item => item.kind === 'char');
                if (start === first.start && firstChar && first.index === firstChar.from)
                    start = firstChar.start;
                if (end === last.end && lastChar && last.index + 1 === lastChar.to)
                    end = lastChar.end;
                fragments.push({ start, end, runIndex, run, split: groups.length > 1 });
            }
        }
        if (!fragments.length)
            return open + content + close;
        const openings = new Map();
        const closings = new Map();
        for (const fragment of fragments) {
            openings.set(fragment.start, [...(openings.get(fragment.start) ?? []), fragment]);
            closings.set(fragment.end, [...(closings.get(fragment.end) ?? []), fragment]);
        }
        const points = [...new Set([...openings.keys(), ...closings.keys(), 0, content.length])].sort((a, b) => a - b);
        let body = '';
        for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
            const point = points[pointIndex];
            for (const fragment of (closings.get(point) ?? []).sort((a, b) => b.start - a.start || b.runIndex - a.runIndex)) {
                const style = fragment.run.style ?? fragment.run.look ?? {};
                if (fragment.run.resolved_look?.plate && (style.rotate_deg || style.baseline_shift_em))
                    body += '</span>';
                body += '</span>';
            }
            for (const fragment of (openings.get(point) ?? []).sort((a, b) => b.end - a.end || a.runIndex - b.runIndex)) {
                const plate = fragment.run.resolved_look?.plate;
                const style = fragment.run.style ?? fragment.run.look ?? {};
                const rotate = typeof style.rotate_deg === 'number' ? style.rotate_deg : 0;
                const shift = typeof style.baseline_shift_em === 'number' ? style.baseline_shift_em : 0;
                const transform = plate && (rotate || shift)
                    ? `transform:translateY(${shift}em) rotate(${rotate}deg);transform-origin:center` : '';
                body += `<span class="akari-caption__run-frag"${plate ? ` data-akari-plate="true" data-akari-plate-pad="${plate.padding_px}"` : ''}${fragment.run.resolved_look?.ink_outset_px ? ` data-akari-ink-outset="${fragment.run.resolved_look.ink_outset_px}"` : ''}${rotate ? ` data-akari-ink-rotate="${rotate}"` : ''}${fragment.split ? ' data-akari-plate-split="true"' : ''}${plate ? ` style="--akari-plate-pad:${plate.padding_px}px;--akari-plate-radius:${plate.radius_px}px;--akari-plate-color:${escape(plate.color)};--akari-plate-opacity:${plate.opacity};--akari-plate-z:${-1000000 + fragment.runIndex};--akari-plate-transform:${transform ? `translateY(${shift}em) rotate(${rotate}deg)` : 'none'}"` : ''}>`;
                if (transform)
                    body += `<span class="akari-caption__run-body" style="${transform}">`;
            }
            if (pointIndex + 1 < points.length)
                body += content.slice(point, points[pointIndex + 1]);
        }
        return open + body + close;
    });
    const rules = '.akari-caption__line:has(.akari-caption__run-frag,.akari-caption__run[data-akari-shadow-text]){isolation:isolate;position:relative}.akari-caption__line:has(.akari-caption__run-frag,.akari-caption__run[data-akari-shadow-text])::before{z-index:-10000000}.akari-caption__run-frag{display:inline-block;position:relative;line-height:1;vertical-align:baseline}.akari-caption__run-frag[data-akari-plate]::before{content:"";position:absolute;left:calc(-1 * var(--akari-plate-pad));right:calc(-1 * var(--akari-plate-pad));top:calc(-1 * var(--akari-plate-pad));bottom:calc(-1 * var(--akari-plate-pad));border-radius:var(--akari-plate-radius);background:var(--akari-plate-color);opacity:var(--akari-plate-opacity);z-index:var(--akari-plate-z);transform:var(--akari-plate-transform);transform-origin:center;pointer-events:none;user-select:none}.akari-caption__run-body{display:inline-block;line-height:1;vertical-align:baseline}.akari-caption__run[data-akari-shadow-text]::before{content:attr(data-akari-shadow-text);position:absolute;left:0;top:0;z-index:-1;color:transparent;-webkit-text-stroke-color:transparent;text-decoration:none;text-shadow:var(--akari-run-shadow);pointer-events:none;user-select:none;white-space:pre}';
    return layered.includes('</style>') ? layered.replace('</style>', `${rules}</style>`) : `<style>${rules}</style>${layered}`;
}
