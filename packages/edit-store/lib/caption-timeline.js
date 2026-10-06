"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCaptionTimelineSegments = buildCaptionTimelineSegments;
const timeline_map_1 = require("./timeline-map");
/** Preserve visual projection and add voice ranges that visual cuts do not cover. */
function buildCaptionTimelineSegments(cuts, edit, options = {}) {
    const visual = (0, timeline_map_1.buildTimelineMap)(cuts, options).segments;
    if (!edit)
        return visual;
    const audio = [];
    const fps = options.fps ?? edit.output?.fps ?? 30;
    for (const track of edit.tracks) {
        if (track.lane !== 'audio' || track.muted)
            continue;
        for (const entry of track.items ?? []) {
            const item = entry;
            if (item.source?.kind !== 'media')
                continue;
            const role = item.legacy?.collection ?? item.role ?? item.declaration?.role;
            if (role !== 'speech' && role !== 'narration')
                continue;
            const src = item.source.sourceId ?? item.source.src;
            if (!src)
                continue;
            const at = typeof item.atFrames === 'number' ? item.at ?? 0 : (item.at ?? 0) / fps;
            const duration = typeof item.durationFrames === 'number'
                ? item.duration ?? 0 : (item.duration ?? 0) / fps;
            const sourceIn = item.source.in ?? 0;
            const sourceOut = item.source.out ?? sourceIn + duration;
            const speed = (sourceOut - sourceIn) / duration;
            if (!(duration > 0) || !(speed > 0))
                continue;
            let uncovered = [{ in: sourceIn, out: sourceOut }];
            for (const cut of cuts) {
                if (cut.src !== src)
                    continue;
                uncovered = uncovered.flatMap(part => cut.out <= part.in || cut.in >= part.out
                    ? [part] : [
                    ...(cut.in > part.in ? [{ in: part.in, out: Math.min(cut.in, part.out) }] : []),
                    ...(cut.out < part.out ? [{ in: Math.max(cut.out, part.in), out: part.out }] : [])
                ]);
            }
            for (const part of uncovered) {
                audio.push({ kind: 'src',
                    outStart: at + (part.in - sourceIn) / speed,
                    outEnd: at + (part.out - sourceIn) / speed,
                    cutIndex: null, src, in: part.in, out: part.out, speed });
            }
        }
    }
    return [...visual, ...audio];
}
