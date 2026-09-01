"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectEditVersion = detectEditVersion;
exports.applyCutRanges = applyCutRanges;
/**
 * v2 の分割・削除は akari-annotations の edit-v2-mutations.ts にある
 * splitItem :597-626 / removeItem :567-572 を出所とし、同じ按分規則を使う。
 * edit-store から Theia 拡張へ逆依存できないため、この最小部分だけを複製している。
 */
const edit_store_1 = require("./edit-store");
const edit_v2_1 = require("./edit-v2");
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
    const fps = requireFps(opts.fps ?? validated.output.fps);
    const edit = JSON.parse(JSON.stringify(raw));
    const warnings = [];
    const affectedTrackIds = new Set();
    let removedFrames = 0;
    for (const range of ranges) {
        const matchingSourceExists = visualTracks(edit).some(track => track.items.some(item => item.source.kind === 'media' && item.source.src === range.captionId));
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
                removedFrames += replacement.removedFrames;
                track.items.splice(index, 1, ...replacement.items);
            }
        }
        if (!matched)
            warnings.push(`カット対象が見つかりません: ${range.in}–${range.out}`);
    }
    // performCompactCuts と同じく、対象となった visual track の media items だけを
    // 配列順に整数フレームのカーソルへ詰める。他 visual track / audio lane は不変。
    for (const track of visualTracks(edit)) {
        if (!affectedTrackIds.has(track.id))
            continue;
        let cursor = 0;
        for (const item of track.items) {
            if (item.source.kind !== 'media')
                continue;
            item.at = cursor;
            cursor += item.duration;
        }
    }
    (0, edit_v2_1.readEditV2)(edit);
    return { source: `${JSON.stringify(edit, null, 2)}\n`, removedFrames, warnings };
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
    const items = [];
    if (startOffset > 0) {
        const first = cloneItem(mediaItem);
        first.duration = startOffset;
        first.source.out = mediaItem.source.in + sourceDuration * startOffset / mediaItem.duration;
        items.push(first);
    }
    if (endOffset < mediaItem.duration) {
        const second = cloneItem(mediaItem);
        second.id = nextItemId(edit, `${mediaItem.id}-split`);
        second.at = mediaItem.at + endOffset;
        second.duration = mediaItem.duration - endOffset;
        second.source.in = mediaItem.source.in + sourceDuration * endOffset / mediaItem.duration;
        items.push(second);
    }
    return { items, removedFrames: endOffset - startOffset };
}
function cloneItem(item) {
    return JSON.parse(JSON.stringify(item));
}
function nextItemId(edit, base) {
    const ids = new Set();
    for (const track of visualTracks(edit))
        for (const item of track.items)
            collectIds(item, ids);
    if (!ids.has(base))
        return base;
    let serial = 2;
    while (ids.has(`${base}-${serial}`))
        serial++;
    return `${base}-${serial}`;
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
