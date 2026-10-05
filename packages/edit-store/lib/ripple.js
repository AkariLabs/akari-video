"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTrackRippleMode = resolveTrackRippleMode;
exports.setTrackRippleMode = setTrackRippleMode;
exports.sliceTimelineItem = sliceTimelineItem;
exports.removeTimelineItemRange = removeTimelineItemRange;
exports.splitAtFrame = splitAtFrame;
exports.liftRange = liftRange;
exports.extractRange = extractRange;
exports.rippleDeleteItems = rippleDeleteItems;
exports.findGapAt = findGapAt;
exports.closeGapAt = closeGapAt;
exports.editPoints = editPoints;
exports.rippleTrimToPlayhead = rippleTrimToPlayhead;
exports.compactTrackGaps = compactTrackGaps;
const envelope_1 = require("./envelope");
const clone = (value) => JSON.parse(JSON.stringify(value));
const itemsTrack = (track) => 'items' in track;
const endOf = (item) => item.at + item.duration;
const unchanged = (edit, reason) => ({ edit: clone(edit), changed: false, reason });
const validFrame = (frame) => Number.isInteger(frame) && frame >= 0;
const validRange = (range) => validFrame(range.start) && validFrame(range.end) && range.end > range.start;
function resolveTrackRippleMode(track) {
    if (track.target === true)
        return 'cut';
    if (track.target === false)
        return track.sync === true ? 'shift' : 'fixed';
    if (track.sync === true)
        return 'shift';
    if (track.sync === false)
        return 'fixed';
    return track.lane === 'audio' && itemsTrack(track) && track.items.length > 0
        && track.items.every(item => 'role' in item && item.role === 'bgm') ? 'fixed' : 'cut';
}
function setTrackRippleMode(edit, trackId, mode) {
    const result = clone(edit);
    const track = result.tracks.find(candidate => candidate.id === trackId);
    if (!track)
        throw new Error(`トラックが見つかりません: ${trackId}`);
    if (!['cut', 'shift', 'fixed'].includes(mode))
        throw new Error(`不明なモード: ${mode}`);
    track.target = mode === 'cut';
    track.sync = mode !== 'fixed';
    return result;
}
function modeOf(track, opts) {
    if (opts.lockedTrackIds?.includes(track.id))
        return 'fixed';
    return opts.modeOverride?.[track.id] ?? resolveTrackRippleMode(track);
}
function idsIn(edit) {
    const ids = new Set();
    const visit = (item) => {
        ids.add(item.id);
        if ('items' in item && item.items)
            item.items.forEach(visit);
    };
    for (const track of edit.tracks)
        if (itemsTrack(track))
            track.items.forEach(visit);
    return ids;
}
function nextId(ids, base) {
    let result = base;
    let serial = 2;
    while (ids.has(result))
        result = `${base}-${serial++}`;
    ids.add(result);
    return result;
}
function interpolateKeyframe(left, right, t) {
    const fraction = (t - left.t) / (right.t - left.t);
    const value = { ...clone(left), t };
    if (right.easing !== undefined)
        value.easing = clone(right.easing);
    else
        delete value.easing;
    const progress = (property, fallback) => {
        const easing = typeof right.easing === 'string' ? right.easing
            : right.easing?.[property] ?? (fallback ? right.easing?.[fallback] : undefined);
        return (0, envelope_1.easingProgress)(easing, fraction);
    };
    for (const [key, next] of Object.entries(right)) {
        if (key === 't' || key === 'easing')
            continue;
        const prev = left[key];
        if (typeof prev === 'number' && typeof next === 'number') {
            value[key] = prev + (next - prev) * progress(key);
        }
        else if (prev && next && typeof prev === 'object' && typeof next === 'object'
            && !Array.isArray(prev) && !Array.isArray(next)) {
            const interpolated = { ...prev };
            for (const [part, end] of Object.entries(next)) {
                const start = prev[part];
                if (typeof start === 'number' && typeof end === 'number') {
                    interpolated[part] = start + (end - start) * progress(`${key}.${part}`, key);
                }
            }
            value[key] = interpolated;
        }
    }
    return value;
}
function keysInWindow(keys, start, end) {
    const ordered = [...keys].sort((a, b) => a.t - b.t);
    const at = (t) => {
        const exact = ordered.find(key => key.t === t);
        if (exact)
            return clone(exact);
        const left = [...ordered].reverse().find(key => key.t < t);
        const right = ordered.find(key => key.t > t);
        if (left && right)
            return interpolateKeyframe(left, right, t);
        const nearest = left ?? right;
        return nearest ? { ...clone(nearest), t } : undefined;
    };
    const selected = [at(start), ...ordered.filter(key => key.t > start && key.t < end).map(clone), at(end)]
        .filter((key) => key !== undefined);
    return selected.map(key => ({ ...key, t: key.t - start }));
}
/** Returns the retained piece of one item. The source clock is seconds; the item clock is frames. */
function sliceTimelineItem(item, start, end, fps, ids) {
    if (!validFrame(start) || !validFrame(end) || start < item.at || end > endOf(item) || end <= start) {
        throw new Error('切り出し範囲が不正です');
    }
    const part = clone(item);
    const offset = start - item.at;
    part.at = start;
    part.duration = end - start;
    if (offset > 0 && ids)
        part.id = nextId(ids, `${item.id}-split`);
    if (item.source.kind === 'media' && part.source.kind === 'media') {
        const sourceIn = item.source.in ?? 0;
        const sourceOut = item.source.out ?? sourceIn + item.duration * (item.source.speed ?? 1) / fps;
        const sourceSpan = sourceOut - sourceIn;
        part.source.in = sourceIn + sourceSpan * offset / item.duration;
        part.source.out = sourceIn + sourceSpan * (offset + part.duration) / item.duration;
    }
    if (item.keyframes)
        part.keyframes = keysInWindow(item.keyframes, offset, offset + part.duration);
    if ('items' in item && item.items && 'items' in part) {
        part.items = item.items.flatMap(child => {
            const childStart = Math.max(child.at, offset);
            const childEnd = Math.min(child.at + child.duration, offset + part.duration);
            if (childEnd <= childStart)
                return [];
            const piece = sliceTimelineItem(child, childStart, childEnd, fps, ids);
            piece.at -= offset;
            return [piece];
        });
    }
    if ('fade_in' in part && offset > 0)
        delete part.fade_in;
    if ('fade_out' in part && end < endOf(item))
        delete part.fade_out;
    return part;
}
function splitOne(track, index, frame, fps, ids) {
    const item = track.items[index];
    const left = sliceTimelineItem(item, item.at, frame, fps, ids);
    const right = sliceTimelineItem(item, frame, endOf(item), fps, ids);
    track.items.splice(index, 1, left, right);
    return right.id;
}
/** Retained pieces after deleting one item's overlap with a frame interval. */
function removeTimelineItemRange(item, range, fps, ids) {
    if (item.at >= range.end || endOf(item) <= range.start)
        return [item];
    const kept = [];
    if (item.at < range.start)
        kept.push(sliceTimelineItem(item, item.at, range.start, fps, ids));
    if (endOf(item) > range.end)
        kept.push(sliceTimelineItem(item, range.end, endOf(item), fps, ids));
    return kept;
}
function splitAtFrame(edit, frame, opts = {}) {
    if (!validFrame(frame))
        return unchanged(edit, '分割位置が不正です');
    const result = clone(edit);
    const selected = new Set();
    for (const track of result.tracks) {
        if (!itemsTrack(track) || opts.lockedTrackIds?.includes(track.id) || (opts.trackIds && !opts.trackIds.includes(track.id)))
            continue;
        if (!opts.itemIds && modeOf(track, opts) !== 'cut')
            continue;
        for (const item of track.items) {
            if (opts.itemIds && !opts.itemIds.includes(item.id))
                continue;
            if (item.at < frame && endOf(item) > frame && ['media', 'html', 'telop', 'filter'].includes(item.source.kind))
                selected.add(item.id);
        }
    }
    for (const track of result.tracks)
        if (itemsTrack(track) && track.lane === 'audio') {
            for (const item of track.items) {
                if (item.link && selected.has(item.link))
                    selected.add(item.id);
                if (item.link && selected.has(item.id))
                    selected.add(item.link);
            }
        }
    if (!selected.size)
        return unchanged(edit, '分割できるアイテムがありません');
    const minimum = Math.ceil(result.output.fps * 0.15);
    const targets = [];
    for (const track of result.tracks)
        if (itemsTrack(track)) {
            track.items.forEach((item, index) => {
                if (selected.has(item.id))
                    targets.push({ track, index, item });
            });
        }
    if (targets.some(({ track, item }) => opts.lockedTrackIds?.includes(track.id) || !(item.at < frame && endOf(item) > frame)
        || Math.min(frame - item.at, endOf(item) - frame) < minimum)) {
        return unchanged(edit, 'リンク相手が固定中か、片側が最小尺未満です');
    }
    const ids = idsIn(result);
    const rightIds = new Map();
    for (const { track, index, item } of targets.sort((a, b) => b.index - a.index)) {
        rightIds.set(item.id, splitOne(track, index, frame, result.output.fps, ids));
    }
    for (const track of result.tracks)
        if (itemsTrack(track) && track.lane === 'audio') {
            for (const item of track.items)
                if (item.link && rightIds.has(item.id)) {
                    const right = track.items.find(candidate => candidate.id === rightIds.get(item.id));
                    if (right)
                        right.link = rightIds.get(item.link) ?? item.link;
                }
        }
    return { edit: result, changed: true };
}
function removeInside(track, range, fps, ids) {
    let changed = false;
    const result = [];
    for (const item of track.items) {
        if (item.at >= range.end || endOf(item) <= range.start) {
            result.push(item);
            continue;
        }
        changed = true;
        result.push(...removeTimelineItemRange(item, range, fps, ids));
    }
    track.items = result;
    return changed;
}
function shiftAfter(track, range, blocked) {
    let changed = false;
    let previousEnd = 0;
    for (const item of [...track.items].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
        if (item.at >= range.end && !item.anchor) {
            const desired = Math.max(0, item.at - (range.end - range.start));
            const next = Math.max(desired, previousEnd);
            if (next !== desired)
                blocked.push(item.id);
            if (next !== item.at) {
                item.at = next;
                changed = true;
            }
        }
        previousEnd = Math.max(previousEnd, endOf(item));
    }
    return changed;
}
function rangeOperation(edit, range, opts, ripple, selectedTrackIds) {
    if (!validRange(range))
        return unchanged(edit, '範囲が不正です');
    const result = clone(edit);
    const ids = idsIn(result);
    const blocked = [];
    let changed = false;
    for (const track of result.tracks) {
        if (!itemsTrack(track))
            continue;
        const mode = modeOf(track, opts);
        const cut = selectedTrackIds ? selectedTrackIds.has(track.id) : mode === 'cut';
        if (mode === 'fixed' && !selectedTrackIds?.has(track.id))
            continue;
        if (cut)
            changed = removeInside(track, range, result.output.fps, ids) || changed;
        if (ripple)
            changed = shiftAfter(track, range, blocked) || changed;
    }
    return { edit: result, changed, ...(ripple ? { removedFrames: range.end - range.start, blocked } : {}) };
}
function liftRange(edit, range, opts = {}) {
    return rangeOperation(edit, range, opts, false);
}
function extractRange(edit, range, opts = {}) {
    return rangeOperation(edit, range, opts, true);
}
function rippleDeleteItems(edit, itemIds, opts = {}) {
    const selected = new Set(itemIds);
    if (!opts.oneSide)
        for (const track of edit.tracks)
            if (itemsTrack(track) && track.lane === 'audio') {
                for (const item of track.items)
                    if (item.link && selected.has(item.link))
                        selected.add(item.id);
                for (const item of track.items)
                    if (selected.has(item.id) && item.link)
                        selected.add(item.link);
            }
    const locations = edit.tracks.flatMap(track => itemsTrack(track)
        ? track.items.filter(item => selected.has(item.id)).map(item => ({ trackId: track.id, item })) : []);
    if (!locations.length)
        return unchanged(edit, '選択アイテムがありません');
    if (locations.some(({ trackId }) => opts.lockedTrackIds?.includes(trackId)))
        return unchanged(edit, '固定中のトラックです');
    const ranges = new Map();
    for (const { item, trackId } of locations) {
        const key = `${item.at}:${endOf(item)}`;
        const entry = ranges.get(key) ?? { range: { start: item.at, end: endOf(item) }, trackIds: new Set() };
        entry.trackIds.add(trackId);
        ranges.set(key, entry);
    }
    const ordered = [...ranges.values()].sort((a, b) => b.range.start - a.range.start || b.range.end - a.range.end);
    let current = clone(edit);
    const blocked = new Set();
    let removedFrames = 0;
    for (const { range, trackIds } of ordered) {
        const step = rangeOperation(current, range, opts, true, trackIds);
        current = step.edit;
        removedFrames += range.end - range.start;
        step.blocked?.forEach(id => blocked.add(id));
    }
    if (opts.oneSide) {
        const remaining = idsIn(current);
        for (const track of current.tracks)
            if (itemsTrack(track) && track.lane === 'audio') {
                for (const item of track.items)
                    if (item.link && !remaining.has(item.link))
                        delete item.link;
            }
    }
    return { edit: current, changed: true, removedFrames, blocked: [...blocked] };
}
function findGapAt(edit, trackId, frame) {
    if (!validFrame(frame))
        return undefined;
    const track = edit.tracks.find(candidate => candidate.id === trackId);
    if (!track || !itemsTrack(track))
        return undefined;
    const ordered = [...track.items].sort((a, b) => a.at - b.at);
    for (let index = 0; index < ordered.length; index++) {
        const start = index === 0 ? 0 : endOf(ordered[index - 1]);
        const end = ordered[index].at;
        if (start <= frame && frame < end)
            return { start, end };
    }
    return undefined;
}
function closeGapAt(edit, trackId, frame, opts = {}) {
    const gap = findGapAt(edit, trackId, frame);
    if (!gap)
        return unchanged(edit, '隙間がありません');
    const track = edit.tracks.find(candidate => candidate.id === trackId);
    if (!track || modeOf(track, opts) === 'fixed')
        return unchanged(edit, '固定中のトラックです');
    return rangeOperation(edit, gap, opts, true, new Set());
}
function editPoints(edit, opts = {}) {
    const points = new Set();
    for (const track of edit.tracks)
        if (itemsTrack(track) && modeOf(track, opts) === 'cut') {
            for (const item of track.items) {
                points.add(item.at);
                points.add(endOf(item));
            }
        }
    return [...points].sort((a, b) => a - b);
}
function rippleTrimToPlayhead(edit, frame, side, opts = {}) {
    if (!validFrame(frame))
        return unchanged(edit, '再生ヘッドが不正です');
    const points = editPoints(edit, opts);
    const point = side === 'prev' ? [...points].reverse().find(value => value < frame) : points.find(value => value > frame);
    if (point === undefined)
        return unchanged(edit, '編集点がありません');
    return extractRange(edit, side === 'prev' ? { start: point, end: frame } : { start: frame, end: point }, opts);
}
function compactTrackGaps(edit, opts = {}) {
    const result = clone(edit);
    let changed = false;
    for (const track of result.tracks)
        if (itemsTrack(track) && track.lane === 'visual' && modeOf(track, opts) === 'cut') {
            let cursor = 0;
            let selectedReached = opts.fromItemId === undefined;
            for (const item of track.items) {
                if (item.source.kind !== 'media')
                    continue;
                if (item.id === opts.fromItemId) {
                    selectedReached = true;
                    cursor = endOf(item);
                    continue;
                }
                if (!selectedReached) {
                    cursor = Math.max(cursor, endOf(item));
                    continue;
                }
                if ((!item.anchor || opts.includeAnchored) && item.at !== cursor) {
                    item.at = cursor;
                    changed = true;
                }
                cursor = endOf(item);
            }
        }
    return { edit: result, changed };
}
