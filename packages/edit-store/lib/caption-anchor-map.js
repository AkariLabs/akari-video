"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.anchorToOutput = anchorToOutput;
exports.anchorForCaptionRange = anchorForCaptionRange;
exports.inferCaptionDisplayToSource = inferCaptionDisplayToSource;
exports.fitCaptionMotionWindow = fitCaptionMotionWindow;
const timeline_map_1 = require("./timeline-map");
const caption_runs_1 = require("./caption-runs");
function anchorToOutput(anchor, caption, timeline, fire = 'shown', fps) {
    const map = Array.isArray(timeline) ? (0, timeline_map_1.buildTimelineMap)(timeline, { fps }) : timeline;
    const warning = (code, message) => ({ fire: 'shown', diagnostics: [{ code, severity: 'warning', message }] });
    if (!anchor)
        return [{ fire: 'shown', diagnostics: [] }];
    const clip = (start, end, windowStart, windowEnd, placement) => {
        if (start >= windowEnd)
            return { fire: 'none', placement,
                diagnostics: [{ code: 'captions.run.anchor-window', severity: 'warning', message: '発火が表示窓の後にあります。' }] };
        const before = start < windowStart;
        return { start: Math.max(start, windowStart), end: Math.min(Math.max(end, windowStart), windowEnd),
            fire: fire ?? 'shown', placement,
            diagnostics: before ? [{ code: 'captions.run.anchor-window', severity: 'warning', message: '発火を表示窓の始まりへ寄せました。' }] : [] };
    };
    if (anchor.domain === 'output')
        return [clip(anchor.start, anchor.end, caption.start, caption.end)];
    const src = anchor.src ?? caption.src;
    const placements = map.segments.filter(segment => segment.kind === 'src' && segment.src === src
        && segment.in !== undefined && segment.out !== undefined && segment.in < caption.end && segment.out > caption.start);
    if (anchor.end <= caption.start && placements.length)
        return placements.map(segment => ({
            start: segment.outStart + (Math.max(caption.start, segment.in) - segment.in)
                / (segment.speed && segment.speed > 0 ? segment.speed : 1),
            fire: fire ?? 'shown', placement: segment.cutIndex ?? undefined,
            diagnostics: [{ code: 'captions.run.anchor-window', severity: 'warning',
                    message: '発火を表示窓の始まりへ寄せました。' }]
        }));
    if (anchor.start >= caption.end && placements.length)
        return placements.map(segment => ({
            fire: 'none', placement: segment.cutIndex ?? undefined,
            diagnostics: [{ code: 'captions.run.anchor-window', severity: 'warning',
                    message: '発火が表示窓の後にあります。' }]
        }));
    const results = [];
    for (const segment of placements) {
        const speed = segment.speed && segment.speed > 0 ? segment.speed : 1;
        const windowStart = segment.outStart + (Math.max(caption.start, segment.in) - segment.in) / speed;
        const windowEnd = segment.outStart + (Math.min(caption.end, segment.out) - segment.in) / speed;
        const sourceStart = Math.max(anchor.start, segment.in);
        const sourceEnd = Math.min(anchor.end, segment.out);
        if (!(sourceStart < sourceEnd))
            continue;
        const result = clip(segment.outStart + (sourceStart - segment.in) / speed, segment.outStart + (sourceEnd - segment.in) / speed, windowStart, windowEnd, segment.cutIndex ?? undefined);
        if (anchor.start < Math.max(caption.start, segment.in) && !result.diagnostics.length) {
            result.diagnostics.push({ code: 'captions.run.anchor-window', severity: 'warning',
                message: '発火を表示窓の始まりへ寄せました。' });
        }
        results.push(result);
    }
    return results.length ? results : [warning('captions.run.anchor-cut', '発火する素材の区間がカットで消えました。')];
}
function anchorForCaptionRange(caption, from, to, displayToSource) {
    const unmapped = { diagnostics: [{ code: 'captions.run.anchor-unmapped', severity: 'info',
                message: '選んだ文字を実測の単語に対応付けられません。' }] };
    const words = caption.words ?? [];
    if (words.map(word => word.text).join('') !== caption.text)
        return unmapped;
    const display = caption.display_text ?? caption.text;
    const shown = (0, caption_runs_1.captionGraphemes)(display);
    const source = (0, caption_runs_1.captionGraphemes)(caption.text);
    if (from < 0 || to > shown.length || from >= to)
        return unmapped;
    const mapping = displayToSource ?? (display === caption.text ? undefined
        : inferCaptionDisplayToSource(display, caption.text));
    const start = display === caption.text ? from : mapping?.[from];
    const end = display === caption.text ? to : mapping?.[to];
    if (start === undefined || end === undefined || start < 0 || end > source.length || start >= end)
        return unmapped;
    let offset = 0;
    const overlapping = words.filter(word => {
        const wordStart = offset;
        offset += (0, caption_runs_1.captionGraphemes)(word.text).length;
        return wordStart < end && offset > start;
    });
    if (!overlapping.length)
        return unmapped;
    return { anchor: { ...(caption.src ? { src: caption.src } : {}),
            start: overlapping[0].start, end: overlapping[overlapping.length - 1].end,
            domain: caption.time_domain === 'output' ? 'output' : 'source' }, diagnostics: [] };
}
/** 表示と原文の一致箇所から、置換の両端を含む境界対応を作る。 */
function inferCaptionDisplayToSource(display, source) {
    const shown = (0, caption_runs_1.captionGraphemes)(display);
    const original = (0, caption_runs_1.captionGraphemes)(source);
    const dp = Array.from({ length: shown.length + 1 }, () => new Uint32Array(original.length + 1));
    for (let i = shown.length - 1; i >= 0; i--)
        for (let j = original.length - 1; j >= 0; j--) {
            dp[i][j] = shown[i] === original[j] ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    const map = Array(shown.length + 1).fill(undefined);
    map[0] = 0;
    map[shown.length] = original.length;
    let i = 0;
    let j = 0;
    while (i < shown.length && j < original.length) {
        if (shown[i] === original[j]) {
            map[i] = j;
            map[i + 1] = j + 1;
            i++;
            j++;
        }
        else if (dp[i + 1][j] >= dp[i][j + 1])
            i++;
        else
            j++;
    }
    return map;
}
function fitCaptionMotionWindow(fireAt, endAt, inSeconds, outSeconds) {
    const available = Math.max(0, endAt - fireAt);
    if (!available)
        return { inSeconds: 0, outSeconds: 0, loopSeconds: 0, active: false };
    const total = Math.max(0, inSeconds) + Math.max(0, outSeconds);
    const ratio = total > available ? available / total : 1;
    return { inSeconds: inSeconds * ratio, outSeconds: outSeconds * ratio,
        loopSeconds: total > available ? 0 : available - total, active: true };
}
