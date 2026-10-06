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
    const subtract = (parts, start, end) => parts.flatMap(part => end <= part.start || start >= part.end ? [part] : [
        ...(start > part.start ? [{ start: part.start, end: Math.min(start, part.end) }] : []),
        ...(end < part.end ? [{ start: Math.max(end, part.start), end: part.end }] : [])
    ]);
    const visualFamilies = new Map();
    for (const track of edit.tracks) {
        if (track.lane !== 'visual')
            continue;
        for (const item of track.items ?? []) {
            const src = item.source?.sourceId
                ?? item.source?.src;
            if (item.source?.kind !== 'media' || !item.id || !src
                || item.source.in === undefined || item.source.out === undefined)
                continue;
            const root = item.id.replace(/(?:-split(?:-\d+)*)+$/, '');
            const key = `${src}\0${root}`;
            const family = visualFamilies.get(key) ?? [];
            family.push({ id: item.id, in: item.source.in, out: item.source.out });
            visualFamilies.set(key, family);
        }
    }
    for (const track of edit.tracks) {
        if (track.lane !== 'audio' || track.muted)
            continue;
        for (const entry of track.items ?? []) {
            const item = entry;
            if (item.source?.kind !== 'media')
                continue;
            if (item.link || item.declaration?.link || item.mute || item.declaration?.mute)
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
            const sourceOut = item.source.out ?? sourceIn;
            const speed = (sourceOut - sourceIn) / duration;
            if (!(duration > 0) || !(speed > 0))
                continue;
            let uncovered = [{ start: at, end: at + duration }];
            const root = item.id?.match(/^(.*)-audio(?:-split(?:-\d+)*)*$/)?.[1];
            const family = root && visualFamilies.get(`${src}\0${root}`);
            if (family && (family.length > 1 || family[0].id !== root
                || item.id === `${root}-audio`)) {
                uncovered = family.flatMap(visualItem => {
                    const start = Math.max(sourceIn, visualItem.in);
                    const end = Math.min(sourceOut, visualItem.out);
                    return end > start ? [{ start: at + (start - sourceIn) / speed,
                            end: at + (end - sourceIn) / speed }] : [];
                });
            }
            for (const segment of visual) {
                if (segment.kind !== 'src' || segment.src !== src)
                    continue;
                uncovered = subtract(uncovered, segment.outStart, segment.outEnd);
                if (segment.in !== undefined && segment.out !== undefined) {
                    uncovered = subtract(uncovered, at + (segment.in - sourceIn) / speed, at + (segment.out - sourceIn) / speed);
                }
            }
            for (const part of uncovered) {
                audio.push({ kind: 'src',
                    outStart: part.start,
                    outEnd: part.end,
                    cutIndex: null, src,
                    in: sourceIn + (part.start - at) * speed,
                    out: sourceIn + (part.end - at) * speed, speed });
            }
        }
    }
    return [...visual, ...audio];
}
