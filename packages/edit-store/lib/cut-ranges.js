"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectEditVersion = detectEditVersion;
exports.applyCutRanges = applyCutRanges;
exports.restoreCutRange = restoreCutRange;
exports.canRestoreCutRange = canRestoreCutRange;
/** Source-time selection stays local; retained pieces share the ripple kernel's slicing rule. */
const edit_store_1 = require("./edit-store");
const edit_v2_1 = require("./edit-v2");
const ripple_1 = require("./ripple");
const LEGACY_EDGE_SECONDS = 0.15;
function detectEditVersion(source) {
    const version = JSON.parse(source).version;
    if (typeof version !== 'number' || !new Set([0, 1, 2]).has(version)) {
        throw new Error('edit.json.version は 0・1・2 のいずれかである必要があります。');
    }
    return version;
}
function applyCutRanges(source, ranges, opts = {}) {
    const version = detectEditVersion(source);
    const normalized = normalizeRanges(ranges);
    if (normalized.length === 0)
        return { source, removedFrames: 0, warnings: [] };
    return version === 2
        ? applyV2(source, normalized, opts)
        : applyLegacy(source, normalized, opts);
}
function applyLegacy(initialSource, ranges, opts) {
    let source = initialSource;
    let removedFrames = 0;
    const warnings = [];
    const affectedTracks = new Set();
    const parsed = JSON.parse(initialSource);
    const fps = requireFps(opts.fps ?? parsed.output?.fps ?? parsed.fps ?? 30);
    for (const range of ranges) {
        const before = readLegacyCuts(source);
        let matched = false;
        for (let index = before.cuts.length - 1; index >= 0; index--) {
            const cut = before.cuts[index];
            const overlapIn = Math.max(cut.in, range.in);
            const overlapOut = Math.min(cut.out, range.out);
            if (!(overlapOut > overlapIn))
                continue;
            matched = true;
            const track = normalizeTrack(cut.track);
            affectedTracks.add(track);
            const speed = validSpeed(cut.speed);
            removedFrames += Math.round((overlapOut - overlapIn) / speed * fps);
            const effectiveIn = overlapIn <= cut.in + LEGACY_EDGE_SECONDS ? cut.in : overlapIn;
            const effectiveOut = overlapOut >= cut.out - LEGACY_EDGE_SECONDS ? cut.out : overlapOut;
            const keepBefore = effectiveIn - cut.in;
            const keepAfter = cut.out - effectiveOut;
            if (keepBefore < LEGACY_EDGE_SECONDS && keepAfter < LEGACY_EDGE_SECONDS) {
                source = (0, edit_store_1.deleteCutInSource)(source, index).source;
            }
            else if (keepBefore < LEGACY_EDGE_SECONDS) {
                source = (0, edit_store_1.trimCutInSource)(source, index, effectiveOut, cut.out);
            }
            else if (keepAfter < LEGACY_EDGE_SECONDS) {
                source = (0, edit_store_1.trimCutInSource)(source, index, cut.in, effectiveIn);
            }
            else {
                source = (0, edit_store_1.splitCutInSource)(source, index, effectiveIn);
                source = (0, edit_store_1.splitCutInSource)(source, index + 1, effectiveOut);
                source = (0, edit_store_1.deleteCutInSource)(source, index + 1).source;
            }
            if (range.reason !== undefined || range.label !== undefined) {
                source = annotateLegacySegments(source, cut, effectiveIn, effectiveOut, range);
            }
        }
        if (!matched)
            warnings.push(`カット対象が見つかりません: ${range.in}–${range.out}`);
    }
    // deleteCutInSource は後続の暗黙 at を凍結する。対象トラックだけ暗黙カーソルへ
    // 戻すことで、元から別レーンにある cuts の位置を動かさずリップルさせる。
    if (affectedTracks.size > 0) {
        const after = readLegacyCuts(source);
        source = (0, edit_store_1.setCutAtValuesInSource)(source, after.cuts.flatMap((cut, cutIndex) => affectedTracks.has(normalizeTrack(cut.track)) ? [{ cutIndex, at: null }] : []));
    }
    return { source, removedFrames, warnings };
}
function applyV2(source, ranges, opts) {
    const raw = JSON.parse(source);
    const validated = (0, edit_v2_1.readEditV2)(raw);
    requireFps(opts.fps ?? validated.output.fps);
    const edit = JSON.parse(JSON.stringify(raw));
    const warnings = [];
    const affectedTrackIds = new Set();
    let removedFrames = 0;
    for (const range of ranges) {
        const matchingSourceExists = edit.sources.some(candidate => candidate.id === range.captionId)
            || visualTracks(edit).some(track => track.items.some(item => item.source.kind === 'media' && item.source.src === range.captionId));
        let matched = false;
        for (const track of visualTracks(edit)) {
            for (let index = track.items.length - 1; index >= 0; index--) {
                const item = track.items[index];
                if (item.source.kind !== 'media')
                    continue;
                if (matchingSourceExists && item.source.src !== range.captionId)
                    continue;
                const overlapIn = Math.max(item.source.in, range.in);
                const overlapOut = Math.min(item.source.out, range.out);
                if (!(overlapOut > overlapIn))
                    continue;
                matched = true;
                affectedTrackIds.add(track.id);
                const replacement = splitAndRemove(item, overlapIn, overlapOut, edit);
                for (const replacementItem of replacement.items) {
                    copyRangeMetadata(replacementItem, range);
                }
                removedFrames += replacement.removedFrames;
                track.items.splice(index, 1, ...replacement.items);
            }
        }
        if (!matched)
            warnings.push(`カット対象が見つかりません: ${range.in}–${range.out}`);
    }
    const modeOverride = Object.fromEntries(edit.tracks.map(track => [track.id, affectedTrackIds.has(track.id) ? 'cut' : 'fixed']));
    const compacted = (0, ripple_1.compactTrackGaps)(edit, { modeOverride, includeAnchored: true }).edit;
    (0, edit_v2_1.readEditV2)(compacted);
    return { source: `${JSON.stringify(compacted, null, 2)}\n`, removedFrames, warnings };
}
const RESTORE_UNAVAILABLE = 'この箇所のあとに編集があるため戻せません。⌘Z の履歴から戻せます。';
const SOURCE_TOLERANCE = 1e-5;
function near(left, right) {
    return Math.abs(left - right) <= SOURCE_TOLERANCE;
}
function media(item) {
    return item.source.kind === 'media';
}
function sameSplitProperties(left, right) {
    const comparable = (item) => {
        const copy = structuredClone(item);
        for (const key of ['id', 'at', 'duration', 'reason', 'label', 'anchor'])
            delete copy[key];
        const source = copy.source;
        delete source.in;
        delete source.out;
        return JSON.stringify(copy);
    };
    return comparable(left) === comparable(right);
}
function sameCutResult(left, right) {
    const comparable = (track) => track.items.map(item => {
        const copy = structuredClone(item);
        for (const key of ['id', 'reason', 'label', 'anchor'])
            delete copy[key];
        return copy;
    });
    const sameValue = (a, b) => {
        if (typeof a === 'number' && typeof b === 'number')
            return near(a, b);
        if (a === b)
            return true;
        if (Array.isArray(a) && Array.isArray(b)) {
            return a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
        }
        if (a && b && typeof a === 'object' && typeof b === 'object') {
            const keys = Object.keys(a);
            return keys.length === Object.keys(b).length
                && keys.every(key => Object.prototype.hasOwnProperty.call(b, key)
                    && sameValue(a[key], b[key]));
        }
        return false;
    };
    return sameValue(comparable(left), comparable(right));
}
function uniqueRestoreId(edit, src) {
    const ids = new Set(edit.tracks.flatMap(track => 'items' in track ? track.items.map(item => item.id) : []));
    let id = `${src}-restored`;
    for (let index = 2; ids.has(id); index++)
        id = `${src}-restored-${index}`;
    return id;
}
function restoreOneTrack(edit, trackIndex, range) {
    const original = edit.tracks[trackIndex];
    const items = original.items;
    const sourceMatches = (item) => media(item)
        && (range.captionId === undefined || item.source.src === range.captionId);
    const leftIndices = items.flatMap((item, index) => sourceMatches(item) && near(item.source.out, range.in) ? [index] : []);
    const rightIndices = items.flatMap((item, index) => sourceMatches(item) && near(item.source.in, range.out) ? [index] : []);
    if (leftIndices.length > 1 || rightIndices.length > 1)
        return undefined;
    const leftIndex = leftIndices[0];
    const rightIndex = rightIndices[0];
    if (leftIndex === undefined && rightIndex === undefined)
        return undefined;
    const left = leftIndex === undefined ? undefined : items[leftIndex];
    const right = rightIndex === undefined ? undefined : items[rightIndex];
    if (left && right && (rightIndex <= leftIndex || right.at !== left.at + left.duration))
        return undefined;
    if (left && !right && items.slice(leftIndex + 1).some(item => sourceMatches(item)
        && item.at === left.at + left.duration))
        return undefined;
    if (right && !left && items.slice(0, rightIndex).some(item => sourceMatches(item)
        && item.at + item.duration === right.at))
        return undefined;
    const lineage = !!left && !!right && right.id.startsWith(`${left.id}-split`);
    if (lineage && !sameSplitProperties(left, right))
        return undefined;
    const template = left ?? right;
    const sourceSpan = template.source.out - template.source.in;
    if (!(sourceSpan > 0))
        return undefined;
    const estimated = Math.round((range.out - range.in) * template.duration / sourceSpan);
    const candidates = [estimated, estimated - 1, estimated + 1, estimated - 2, estimated + 2]
        .filter((frames, index, all) => frames > 0 && all.indexOf(frames) === index);
    for (const frames of candidates) {
        const candidate = structuredClone(edit);
        const track = candidate.tracks[trackIndex];
        const target = track.items;
        const boundary = left ? left.at + left.duration : right.at;
        if (lineage) {
            const merged = structuredClone(left);
            merged.duration = left.duration + frames + right.duration;
            merged.source.out = right.source.out;
            const leftMeta = left;
            const rightMeta = right;
            const mergedMeta = merged;
            if (leftMeta.reason === rightMeta.reason
                || range.reason !== undefined && leftMeta.reason === range.reason)
                delete mergedMeta.reason;
            if (leftMeta.label === rightMeta.label
                || range.label !== undefined && leftMeta.label === range.label)
                delete mergedMeta.label;
            target.splice(leftIndex, 1, merged);
            target.splice(rightIndex, 1);
        }
        else if (left && right) {
            const restored = structuredClone(left);
            restored.id = uniqueRestoreId(edit, left.source.src);
            restored.at = boundary;
            restored.duration = frames;
            restored.source.in = range.in;
            restored.source.out = range.out;
            delete restored.anchor;
            target.splice(rightIndex, 0, restored);
        }
        else if (left) {
            const grown = target[leftIndex];
            grown.duration += frames;
            grown.source.out = range.out;
        }
        else {
            const grown = target[rightIndex];
            grown.duration += frames;
            grown.source.in = range.in;
            const parentId = grown.id.replace(/-split(?:-\d+)?$/, '');
            if (parentId !== grown.id && !target.some(item => item.id === parentId))
                grown.id = parentId;
        }
        const restoredIndex = lineage || left && !right ? leftIndex : rightIndex;
        for (let index = 0; index < target.length; index++) {
            if (index === restoredIndex)
                continue;
            const item = target[index];
            if (media(item) && item.at >= boundary)
                item.at += frames;
        }
        const trial = applyV2(`${JSON.stringify(candidate, null, 2)}\n`, [{ ...range, kind: 'row' }], {});
        const replay = JSON.parse(trial.source).tracks[trackIndex];
        if (sameCutResult(replay, original))
            return track;
    }
    return undefined;
}
/** Inverts one source-time cut from the surviving media items, without a stored snapshot. */
function restoreCutRange(source, range) {
    if (detectEditVersion(source) !== 2 || !(range.out > range.in)) {
        return { source, restored: false, reason: RESTORE_UNAVAILABLE };
    }
    const edit = JSON.parse(source);
    (0, edit_v2_1.readEditV2)(edit);
    const restored = structuredClone(edit);
    let changed = false;
    for (let index = 0; index < edit.tracks.length; index++) {
        const track = edit.tracks[index];
        if (track.lane !== 'visual' || !('items' in track))
            continue;
        const hasEdge = track.items.some(item => media(item) && (!range.captionId || item.source.src === range.captionId)
            && (near(item.source.out, range.in) || near(item.source.in, range.out)));
        if (!hasEdge)
            continue;
        const next = restoreOneTrack(edit, index, range);
        if (!next)
            return { source, restored: false, reason: RESTORE_UNAVAILABLE };
        restored.tracks[index] = next;
        changed = true;
    }
    if (!changed)
        return { source, restored: false, reason: RESTORE_UNAVAILABLE };
    (0, edit_v2_1.readEditV2)(restored);
    return { source: `${JSON.stringify(restored, null, 2)}\n`, restored: true };
}
function canRestoreCutRange(source, range) {
    const result = restoreCutRange(source, range);
    return result.restored ? undefined : result.reason;
}
function copyRangeMetadata(target, range) {
    if (range.reason !== undefined)
        target.reason = range.reason;
    if (range.label !== undefined)
        target.label = range.label;
}
function annotateLegacySegments(source, original, removedIn, removedOut, range) {
    const edit = JSON.parse(source);
    if (!Array.isArray(edit.cuts))
        return source;
    const originalTrack = normalizeTrack(original.track);
    for (const cut of edit.cuts) {
        if (normalizeTrack(cut.track) !== originalTrack || cut.src !== original.src)
            continue;
        if (cut.in < original.in || cut.out > original.out)
            continue;
        if (cut.out <= removedIn || cut.in >= removedOut)
            copyRangeMetadata(cut, range);
    }
    return `${JSON.stringify(edit, null, 2)}\n`;
}
function splitAndRemove(item, overlapIn, overlapOut, edit) {
    if (item.source.kind !== 'media')
        return { items: [item], removedFrames: 0 };
    const mediaItem = item;
    const sourceDuration = mediaItem.source.out - mediaItem.source.in;
    if (!(sourceDuration > 0) || !(item.duration > 0)) {
        return { items: [item], removedFrames: 0 };
    }
    const startOffset = clampFrame(Math.round((overlapIn - mediaItem.source.in) / sourceDuration * mediaItem.duration), mediaItem.duration);
    const endOffset = clampFrame(Math.round((overlapOut - mediaItem.source.in) / sourceDuration * mediaItem.duration), mediaItem.duration);
    if (endOffset <= startOffset)
        return { items: [item], removedFrames: 0 };
    const ids = new Set();
    for (const track of edit.tracks)
        if ('items' in track)
            for (const candidate of track.items)
                collectIds(candidate, ids);
    const items = (0, ripple_1.removeTimelineItemRange)(mediaItem, { start: mediaItem.at + startOffset, end: mediaItem.at + endOffset }, edit.output.fps, ids);
    return { items, removedFrames: endOffset - startOffset };
}
function collectIds(item, ids) {
    ids.add(item.id);
    for (const child of item.items ?? [])
        collectIds(child, ids);
}
function visualTracks(edit) {
    return edit.tracks.filter((track) => track.lane === 'visual' && 'items' in track);
}
function readLegacyCuts(source) {
    const parsed = JSON.parse(source);
    const cuts = Array.isArray(parsed.cuts) ? parsed.cuts : [];
    return { cuts, segments: (0, edit_store_1.computeCutTrackSegments)(cuts) };
}
function normalizeRanges(ranges) {
    return ranges.map(range => {
        if (!Number.isFinite(range.in) || !Number.isFinite(range.out) || range.in < 0 || range.out <= range.in) {
            throw new Error('カット範囲が不正です。');
        }
        return { ...range };
    }).sort((left, right) => right.in - left.in || right.out - left.out);
}
function normalizeTrack(track) {
    return Number.isInteger(track) && track >= 0 ? track : 0;
}
function validSpeed(speed) {
    return typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : 1;
}
function requireFps(value) {
    if (!Number.isFinite(value) || value <= 0)
        throw new Error('fps が不正です。');
    return value;
}
function clampFrame(value, duration) {
    return Math.max(0, Math.min(duration, value));
}
