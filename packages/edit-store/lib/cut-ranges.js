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
    // A linked J/L overhang must see each preceding cut's ripple before its next split.
    if (version === 2 && ranges.length > 1 && hasLinkedAudioOverhang(source)
        && ranges.every((range, index) => ranges.slice(index + 1).every(other => range.captionId !== other.captionId || range.out <= other.in || other.out <= range.in))) {
        let current = source;
        let removedFrames = 0;
        const warnings = [];
        for (const range of ranges) {
            const result = applyV2(current, [range], opts);
            current = result.source;
            removedFrames += result.removedFrames;
            warnings.push(...result.warnings);
        }
        return { source: current, removedFrames, warnings };
    }
    return version === 2
        ? applyV2(source, normalized, opts)
        : applyLegacy(source, normalized, opts);
}
function hasLinkedAudioOverhang(source) {
    const edit = JSON.parse(source);
    const visuals = new Map(visualTracks(edit).flatMap(track => track.items.map(item => [item.id, item])));
    return audioTracks(edit).some(track => track.items.some(audio => {
        const visual = audio.link && visuals.get(audio.link);
        return visual && (audio.at < visual.at || audio.at + audio.duration > visual.at + visual.duration);
    }));
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
function applyV2(source, ranges, opts, preserveLeadingGapTrackIds = [], preserveGapBeforeItems) {
    const raw = JSON.parse(source);
    const validated = (0, edit_v2_1.readEditV2)(raw);
    requireFps(opts.fps ?? validated.output.fps);
    const edit = JSON.parse(JSON.stringify(raw));
    const warnings = [];
    const affectedTrackIds = new Set();
    const preserveSourceEdges = audioTracks(edit).some(track => track.items.some(item => item.link));
    const originalLinkedGaps = new Map();
    for (const track of visualTracks(edit)) {
        const items = track.items.filter(media);
        for (let index = 1; index < items.length; index++) {
            const gap = linkedAudioGap(edit, items[index - 1], items[index]);
            if (gap > 0)
                originalLinkedGaps.set(gapKey(track.id, items[index - 1], items[index]), gap);
        }
    }
    const leadingLinkedAudio = new Map();
    for (const track of visualTracks(edit)) {
        const first = track.items.find(media);
        if (!first || first.at === 0)
            continue;
        if (preserveLeadingGapTrackIds.includes(track.id) || audioTracks(edit).some(audioTrack => audioTrack.items.some(audio => audio.link === first.id && audio.at < first.at)))
            leadingLinkedAudio.set(track.id, first.at);
    }
    const audioBeforeCutWithNoVisual = new Map();
    const removedVisualFrames = new Map();
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
                const replacement = splitAndRemove(item, overlapIn, overlapOut, edit, preserveSourceEdges);
                if (replacement.removedFrames > 0) {
                    let byTrack = removedVisualFrames.get(range);
                    if (!byTrack)
                        removedVisualFrames.set(range, byTrack = new Map());
                    let removals = byTrack.get(track.id);
                    if (!removals)
                        byTrack.set(track.id, removals = []);
                    const startFrame = Math.round((overlapIn - item.source.in)
                        / (item.source.out - item.source.in) * item.duration);
                    removals.push({ at: item.at + Math.max(0, Math.min(item.duration, startFrame)),
                        frames: replacement.removedFrames });
                }
                for (const replacementItem of replacement.items) {
                    copyRangeMetadata(replacementItem, range);
                }
                for (const audioTrack of audioTracks(edit)) {
                    for (let audioIndex = audioTrack.items.length - 1; audioIndex >= 0; audioIndex--) {
                        const audio = audioTrack.items[audioIndex];
                        if (audio.link !== item.id || audio.source.src !== item.source.src)
                            continue;
                        const audioOverlapIn = Math.max(audio.source.in ?? overlapIn, range.in);
                        const audioOverlapOut = Math.min(audio.source.out ?? overlapOut, range.out);
                        const audioPieces = splitAndRemove(audio, audioOverlapIn, audioOverlapOut, edit, preserveSourceEdges).items;
                        const hasRightVisual = replacement.items.some(candidate => media(candidate)
                            && candidate.source.in >= overlapOut - audioFrameTolerance(candidate));
                        for (const piece of audioPieces) {
                            // A one-sided trim changes the source seconds per frame on only one lane.
                            // Compare the surviving source edges instead of requiring exact seconds.
                            const visual = replacement.items.filter(media).reduce((best, candidate) => {
                                const score = candidate.source.in <= overlapIn
                                    ? Math.abs((piece.source.out ?? NaN) - candidate.source.out)
                                    : Math.abs((piece.source.in ?? NaN) - candidate.source.in);
                                if (!best)
                                    return candidate;
                                const bestScore = best.source.in <= overlapIn
                                    ? Math.abs((piece.source.out ?? NaN) - best.source.out)
                                    : Math.abs((piece.source.in ?? NaN) - best.source.in);
                                return score < bestScore ? candidate : best;
                            }, undefined);
                            if (visual)
                                piece.link = visual.id;
                            if ((piece.source.out ?? Infinity) <= overlapIn + audioFrameTolerance(piece)
                                && !replacement.items.some(candidate => media(candidate)
                                    && candidate.source.out <= overlapIn + audioFrameTolerance(candidate))) {
                                audioBeforeCutWithNoVisual.set(piece.id, { range, trackId: track.id });
                            }
                        }
                        if (audioPieces.length === 2 && !hasRightVisual) {
                            audioPieces[1].at = audioPieces[0].at + audioPieces[0].duration;
                        }
                        audioTrack.items.splice(audioIndex, 1, ...audioPieces);
                    }
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
    for (const track of visualTracks(compacted)) {
        if (!affectedTrackIds.has(track.id))
            continue;
        const before = visualTracks(edit).find(candidate => candidate.id === track.id);
        const beforeMedia = before.items.filter(media);
        const compactedMedia = track.items.filter(media);
        let retainedGap = 0;
        for (let index = 0; index < beforeMedia.length; index++) {
            const right = beforeMedia[index];
            if (index > 0) {
                const left = beforeMedia[index - 1];
                retainedGap += preserveGapBeforeItems?.get(right.id)
                    ?? originalLinkedGaps.get(gapKey(track.id, left, right)) ?? 0;
            }
            compactedMedia[index].at += retainedGap;
        }
        const offset = leadingLinkedAudio.get(track.id);
        if (offset !== undefined)
            for (const item of track.items)
                if (media(item))
                    item.at += offset;
    }
    const previousVisual = new Map(visualTracks(edit).flatMap(track => track.items.map(item => [item.id, item.at])));
    const compactedVisual = new Map(visualTracks(compacted).flatMap(track => track.items.map(item => [item.id, item])));
    for (const track of audioTracks(compacted))
        for (const item of track.items) {
            if (!item.link || !previousVisual.has(item.link))
                continue;
            const beforeCut = audioBeforeCutWithNoVisual.get(item.id);
            if (beforeCut) {
                const visual = compactedVisual.get(item.link);
                const before = previousVisual.get(item.link);
                if (visual) {
                    const ownRemoved = removedVisualFrames.get(beforeCut.range)?.get(beforeCut.trackId)
                        ?.filter(removal => removal.at <= before)
                        .reduce((total, removal) => total + removal.frames, 0) ?? 0;
                    item.at = Math.max(0, item.at + visual.at - before + ownRemoved);
                }
                continue;
            }
            const visual = compactedVisual.get(item.link);
            if (visual)
                item.at = Math.max(0, item.at + visual.at - previousVisual.get(item.link));
        }
    (0, edit_v2_1.readEditV2)(compacted);
    return { source: `${JSON.stringify(compacted, null, 2)}\n`, removedFrames, warnings };
}
const RESTORE_UNAVAILABLE = 'この箇所のあとに編集があるため戻せません。⌘Z の履歴から戻せます。';
const RESTORE_LEGACY = '古い形式の編集データのため戻せません。⌘Z の履歴から戻せます。';
const RESTORE_APPEARANCE = '動きや見た目の設定があるため 1 か所だけは戻せません。⌘Z の履歴から戻せます。';
const RESTORE_PROVENANCE = '切った部分の元の設定が編集データに残っていないため 1 か所だけは戻せません。⌘Z の履歴から戻せます。';
const SOURCE_TOLERANCE = 1e-5;
function near(left, right) {
    return Math.abs(left - right) <= SOURCE_TOLERANCE;
}
function audioFrameTolerance(...items) {
    return Math.max(SOURCE_TOLERANCE, ...items.map(item => item.duration > 0 ? ((item.source.out ?? 0) - (item.source.in ?? 0)) / item.duration + SOURCE_TOLERANCE : 0));
}
function nearRangeEdge(edge, boundary, item) {
    return edge !== undefined && Math.abs(edge - boundary) <=
        (item.source.speed !== undefined && item.source.speed !== 1
            ? SOURCE_TOLERANCE : audioFrameTolerance(item));
}
function splitRootId(id) {
    return id.replace(/(?:-split(?:-\d+)*)+$/, '');
}
function gapKey(trackId, left, right) {
    return `${trackId}\0${splitRootId(left.id)}\0${splitRootId(right.id)}`;
}
function linkedAudioGap(edit, left, right) {
    const gap = right.at - left.at - left.duration;
    if (gap <= 0 || splitRootId(left.id) === splitRootId(right.id))
        return 0;
    let overhang = 0;
    for (const track of audioTracks(edit))
        for (const audio of track.items) {
            if (audio.link === left.id) {
                overhang = Math.max(overhang, audio.at + audio.duration - left.at - left.duration);
            }
            else if (audio.link === right.id) {
                overhang = Math.max(overhang, right.at - audio.at);
            }
        }
    return Math.min(gap, overhang);
}
function media(item) {
    return item.source.kind === 'media';
}
function sameSplitProperties(left, right, ignoreFades = false) {
    const comparable = (item) => {
        const copy = structuredClone(item);
        for (const key of ['id', 'at', 'duration', 'reason', 'label', 'anchor', 'link'])
            delete copy[key];
        if (ignoreFades)
            for (const key of ['fade_in', 'fade_out', 'fade_in_shape', 'fade_out_shape'])
                delete copy[key];
        const source = copy.source;
        delete source.in;
        delete source.out;
        return JSON.stringify(copy);
    };
    return comparable(left) === comparable(right);
}
function sameAppearance(left, right) {
    const appearance = (item) => {
        const copy = structuredClone(item);
        for (const key of ['id', 'name', 'locked', 'at', 'duration', 'reason', 'label', 'anchor'])
            delete copy[key];
        const source = copy.source;
        delete source.in;
        delete source.out;
        return JSON.stringify(copy);
    };
    return appearance(left) === appearance(right);
}
function hasTimedAppearance(item) {
    return !!(item.keyframes?.length || item.animator?.length || item.motion
        || item.items?.length);
}
function sameCutResult(left, right, sourceTolerance = SOURCE_TOLERANCE, frameTolerance = 0) {
    const comparable = (track) => track.items.map(item => {
        const copy = structuredClone(item);
        for (const key of ['id', 'reason', 'label', 'anchor', 'link'])
            delete copy[key];
        return copy;
    });
    const sameValue = (a, b, sourceEdge = false, frameField = false) => {
        if (typeof a === 'number' && typeof b === 'number') {
            return Math.abs(a - b) <= (sourceEdge ? sourceTolerance : frameField ? frameTolerance : SOURCE_TOLERANCE);
        }
        if (a === b)
            return true;
        if (Array.isArray(a) && Array.isArray(b)) {
            return a.length === b.length && a.every((value, index) => sameValue(value, b[index], sourceEdge, frameField));
        }
        if (a && b && typeof a === 'object' && typeof b === 'object') {
            const keys = Object.keys(a);
            return keys.length === Object.keys(b).length
                && keys.every(key => Object.prototype.hasOwnProperty.call(b, key)
                    && sameValue(a[key], b[key], key === 'source' || (sourceEdge && (key === 'in' || key === 'out')), key === 'at' || key === 'duration'));
        }
        return false;
    };
    return sameValue(comparable(left), comparable(right));
}
function restoreLinkedAudio(original, restored, visualTrackIndex, leftId, rightId, range) {
    const beforeVisual = original.tracks[visualTrackIndex];
    const afterVisual = restored.tracks[visualTrackIndex];
    const originalLeft = beforeVisual.items.find(item => item.id === leftId);
    const originalRight = beforeVisual.items.find(item => item.id === rightId);
    const mergedVisual = afterVisual.items.find(item => item.id === leftId);
    const restoredFrames = mergedVisual.duration - originalLeft.duration - originalRight.duration;
    let foundPair = false;
    for (let trackIndex = 0; trackIndex < original.tracks.length; trackIndex++) {
        const originalTrack = original.tracks[trackIndex];
        if (originalTrack.lane !== 'audio' || !('items' in originalTrack))
            continue;
        const leftIndex = originalTrack.items.findIndex(item => item.link === leftId);
        const rightIndex = originalTrack.items.findIndex(item => item.link === rightId);
        if (leftIndex < 0 && rightIndex < 0)
            continue;
        const candidateTrack = restored.tracks[trackIndex];
        if (leftIndex < 0 || rightIndex < 0) {
            const solo = originalTrack.items[leftIndex < 0 ? rightIndex : leftIndex];
            if (solo.keyframes?.length)
                return RESTORE_APPEARANCE;
            if (solo.source.src !== originalLeft.source.src)
                return RESTORE_UNAVAILABLE;
            const tolerance = audioFrameTolerance(solo, originalLeft, originalRight);
            const outsideCut = leftIndex < 0
                ? (solo.source.in ?? -Infinity) > range.out + tolerance
                : (solo.source.out ?? Infinity) < range.in - tolerance;
            if (!outsideCut)
                return RESTORE_PROVENANCE;
            const candidate = candidateTrack.items.find(item => item.id === solo.id);
            if (!candidate)
                return RESTORE_UNAVAILABLE;
            candidate.link = leftId;
            if (leftIndex < 0)
                candidate.at += restoredFrames;
            foundPair = true;
            continue;
        }
        if (rightIndex <= leftIndex)
            return RESTORE_UNAVAILABLE;
        foundPair = true;
        const left = originalTrack.items[leftIndex];
        const right = originalTrack.items[rightIndex];
        if (left.keyframes?.length || right.keyframes?.length)
            return RESTORE_APPEARANCE;
        const tolerance = audioFrameTolerance(left, right, originalLeft, originalRight);
        const audioAtGap = right.at - left.at - left.duration;
        const audioSourceStep = ((right.source.out ?? 0) - (right.source.in ?? 0)) / right.duration;
        const leftSourceStep = ((left.source.out ?? 0) - (left.source.in ?? 0)) / left.duration;
        const leftOffset = leftSourceStep > 0 ? left.at - originalLeft.at
            - Math.round(((left.source.in ?? 0) - originalLeft.source.in) / leftSourceStep) : NaN;
        const rightOffset = audioSourceStep > 0 ? right.at - originalRight.at
            - Math.round(((right.source.in ?? 0) - originalRight.source.in) / audioSourceStep) : NaN;
        if (left.source.src !== right.source.src || left.source.src !== originalLeft.source.src
            || Math.abs((left.source.out ?? NaN) - range.in) > tolerance
            || Math.abs((right.source.in ?? NaN) - range.out) > tolerance
            || Math.abs(audioAtGap) > 1
            || leftOffset !== rightOffset
            || !sameSplitProperties(left, right, true)
            || left.fade_out !== undefined || left.fade_out_shape !== undefined
            || right.fade_in !== undefined || right.fade_in_shape !== undefined)
            return RESTORE_UNAVAILABLE;
        const candidateLeftIndex = candidateTrack.items.findIndex(item => item.id === left.id);
        const candidateRightIndex = candidateTrack.items.findIndex(item => item.id === right.id);
        if (candidateLeftIndex < 0 || candidateRightIndex <= candidateLeftIndex)
            return RESTORE_UNAVAILABLE;
        const merged = structuredClone(left);
        const audioSecondsPerFrame = ((left.source.out ?? 0) - (left.source.in ?? 0)) / left.duration;
        const audioGapFrames = audioSecondsPerFrame > 0
            ? Math.round(((right.source.in ?? 0) - (left.source.out ?? 0)) / audioSecondsPerFrame)
            : restoredFrames;
        merged.duration = left.duration + audioGapFrames + right.duration;
        merged.source.out = right.source.out;
        if (right.fade_out !== undefined)
            merged.fade_out = right.fade_out;
        if (right.fade_out_shape !== undefined)
            merged.fade_out_shape = right.fade_out_shape;
        const fadeKeys = ['fade_in', 'fade_out', 'fade_in_shape', 'fade_out_shape'];
        const mergedKeys = Object.keys(merged);
        const firstFadeIndex = mergedKeys.findIndex(key => fadeKeys.includes(key));
        const orderedKeys = firstFadeIndex < 0 ? mergedKeys : [
            ...mergedKeys.slice(0, firstFadeIndex),
            ...fadeKeys.filter(key => Object.prototype.hasOwnProperty.call(merged, key)),
            ...mergedKeys.slice(firstFadeIndex).filter(key => !fadeKeys.includes(key)),
        ];
        const ordered = Object.fromEntries(orderedKeys.map(key => [key, merged[key]]));
        candidateTrack.items.splice(candidateLeftIndex, 1, ordered);
        candidateTrack.items.splice(candidateRightIndex, 1);
    }
    return !foundPair && originalLeft.audio === false ? RESTORE_PROVENANCE : undefined;
}
function restoreOneTrack(edit, trackIndex, range) {
    const original = edit.tracks[trackIndex];
    const items = original.items;
    const sourceMatches = (item) => media(item)
        && (range.captionId === undefined || item.source.src === range.captionId);
    const leftIndices = items.flatMap((item, index) => sourceMatches(item) && nearRangeEdge(item.source.out, range.in, item) ? [index] : []);
    const rightIndices = items.flatMap((item, index) => sourceMatches(item) && nearRangeEdge(item.source.in, range.out, item) ? [index] : []);
    if (leftIndices.length > 1 || rightIndices.length > 1)
        return {};
    const leftIndex = leftIndices[0];
    const rightIndex = rightIndices[0];
    if (leftIndex === undefined && rightIndex === undefined)
        return {};
    const left = leftIndex === undefined ? undefined : items[leftIndex];
    const right = rightIndex === undefined ? undefined : items[rightIndex];
    if (!left || !right || leftIndex === undefined || rightIndex === undefined
        || left.id === right.id || splitRootId(left.id) !== splitRootId(right.id)
        || left.source.src !== right.source.src
        || left.source.out > range.in + audioFrameTolerance(left)
        || right.source.in < range.out - audioFrameTolerance(right))
        return { reason: RESTORE_PROVENANCE };
    const leftMeta = left;
    const rightMeta = right;
    if (leftMeta.reason === undefined && leftMeta.label === undefined
        && rightMeta.reason === undefined && rightMeta.label === undefined) {
        return { reason: RESTORE_PROVENANCE };
    }
    if (rightIndex <= leftIndex || right.at !== left.at + left.duration)
        return {};
    if (hasTimedAppearance(left) || hasTimedAppearance(right)) {
        return { reason: RESTORE_APPEARANCE };
    }
    if (!sameSplitProperties(left, right)) {
        return { reason: sameAppearance(left, right) ? RESTORE_UNAVAILABLE : RESTORE_APPEARANCE };
    }
    const template = left;
    const sourceSpan = template.source.out - template.source.in;
    if (!(sourceSpan > 0))
        return {};
    const estimated = Math.round((range.out - range.in) * template.duration / sourceSpan);
    const candidates = [estimated, estimated - 1, estimated + 1, estimated - 2, estimated + 2]
        .filter((frames, index, all) => frames > 0 && all.indexOf(frames) === index);
    for (const frames of candidates) {
        const candidate = structuredClone(edit);
        const track = candidate.tracks[trackIndex];
        const target = track.items;
        const boundary = left.at + left.duration;
        const merged = structuredClone(left);
        merged.duration = left.duration + frames + right.duration;
        merged.source.out = right.source.out;
        const mergedMeta = merged;
        if (leftMeta.reason !== undefined || rightMeta.reason !== undefined) {
            mergedMeta.reason = leftMeta.reason ?? rightMeta.reason;
        }
        if (leftMeta.label !== undefined || rightMeta.label !== undefined) {
            mergedMeta.label = leftMeta.label ?? rightMeta.label;
        }
        target.splice(leftIndex, 1, merged);
        target.splice(rightIndex, 1);
        const family = target.filter((item) => media(item)
            && splitRootId(item.id) === splitRootId(merged.id))
            .sort((a, b) => a.source.in - b.source.in);
        const noRemainingCut = family.every((item, index) => index === 0
            || item.source.in - family[index - 1].source.out <= SOURCE_TOLERANCE);
        if (noRemainingCut) {
            delete mergedMeta.reason;
            delete mergedMeta.label;
        }
        for (let index = 0; index < target.length; index++) {
            if (index === leftIndex)
                continue;
            const item = target[index];
            if (media(item) && item.at >= boundary)
                item.at += frames;
        }
        const visualOnly = { ...candidate, tracks: candidate.tracks.filter(track => track.lane !== 'audio') };
        const preserveLeadingGap = target.find(media)?.at ? [original.id] : [];
        const preserveGaps = new Map();
        const originalMedia = original.items.filter(media);
        for (let index = 1; index < originalMedia.length; index++) {
            const previous = originalMedia[index - 1];
            const current = originalMedia[index];
            const gap = linkedAudioGap(edit, previous, current);
            if (gap > 0)
                preserveGaps.set(current.id, gap);
        }
        const trial = applyV2(`${JSON.stringify(visualOnly, null, 2)}\n`, [{ ...range, kind: 'row' }], {}, preserveLeadingGap, preserveGaps);
        const replay = JSON.parse(trial.source).tracks.find(track => track.id === original.id);
        if (sameCutResult(replay, original))
            return { track };
    }
    return {};
}
/** Inverts one source-time cut from the surviving media items, without a stored snapshot. */
function restoreCutRange(source, range) {
    try {
        return restoreCutRangeUnchecked(source, range);
    }
    catch {
        return { source, restored: false, reason: RESTORE_UNAVAILABLE };
    }
}
function restoreCutRangeUnchecked(source, range) {
    if (detectEditVersion(source) !== 2) {
        return { source, restored: false, reason: RESTORE_LEGACY };
    }
    if (!(range.out > range.in)) {
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
            && (nearRangeEdge(item.source.out, range.in, item) || nearRangeEdge(item.source.in, range.out, item)));
        if (!hasEdge)
            continue;
        const leftId = track.items.find(item => media(item) && (!range.captionId || item.source.src === range.captionId)
            && nearRangeEdge(item.source.out, range.in, item))?.id;
        const rightId = track.items.find(item => media(item) && (!range.captionId || item.source.src === range.captionId)
            && nearRangeEdge(item.source.in, range.out, item))?.id;
        const next = restoreOneTrack(edit, index, range);
        if (!next.track)
            return { source, restored: false, reason: next.reason ?? RESTORE_UNAVAILABLE };
        restored.tracks[index] = next.track;
        if (leftId && rightId) {
            const audioReason = restoreLinkedAudio(edit, restored, index, leftId, rightId, range);
            if (audioReason)
                return { source, restored: false, reason: audioReason };
        }
        changed = true;
    }
    if (!changed)
        return { source, restored: false, reason: RESTORE_PROVENANCE };
    const beforePositions = new Map(visualTracks(edit).flatMap(track => track.items.map(item => [item.id, item.at])));
    const afterPositions = new Map(visualTracks(restored).flatMap(track => track.items.map(item => [item.id, item.at])));
    let hasLinkedAudio = false;
    for (const track of audioTracks(restored))
        for (const item of track.items) {
            if (!item.link)
                continue;
            hasLinkedAudio = true;
            const before = beforePositions.get(item.link);
            const after = afterPositions.get(item.link);
            if (before !== undefined && after !== undefined)
                item.at += after - before;
        }
    (0, edit_v2_1.readEditV2)(restored);
    if (hasLinkedAudio) {
        const trial = applyV2(`${JSON.stringify(restored, null, 2)}\n`, [{ ...range, kind: 'row' }], {});
        const replay = JSON.parse(trial.source);
        const visualById = new Map(visualTracks(edit).flatMap(track => track.items
            .filter(media).map(item => [item.id, item])));
        for (const original of audioTracks(edit)) {
            const next = replay.tracks.find(track => track.id === original.id);
            const splitSkew = original.items.some((right, index) => {
                if (index === 0 || !right.link)
                    return false;
                const left = original.items[index - 1];
                if (!left.link || splitRootId(left.link) !== splitRootId(right.link))
                    return false;
                const skew = right.at - left.at - left.duration;
                if (Math.abs(skew) !== 1)
                    return false;
                const leftVisual = visualById.get(left.link);
                const rightVisual = visualById.get(right.link);
                return !!leftVisual && !!rightVisual && (Math.abs((left.source.in ?? 0) - leftVisual.source.in) > audioFrameTolerance(left, leftVisual)
                    || Math.abs((right.source.out ?? 0) - rightVisual.source.out) > audioFrameTolerance(right, rightVisual));
            });
            if (!next || next.lane !== 'audio' || !('items' in next)
                || !sameCutResult(next, original, audioFrameTolerance(...original.items, ...next.items), splitSkew ? 1 : 0)) {
                return { source, restored: false, reason: RESTORE_UNAVAILABLE };
            }
        }
    }
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
function splitAndRemove(item, overlapIn, overlapOut, edit, preserveSourceEdges = false) {
    if (item.source.kind !== 'media')
        return { items: [item], removedFrames: 0 };
    const mediaItem = item;
    const sourceDuration = (mediaItem.source.out ?? 0) - (mediaItem.source.in ?? 0);
    if (!(sourceDuration > 0) || !(item.duration > 0)) {
        return { items: [item], removedFrames: 0 };
    }
    const startOffset = clampFrame(Math.round((overlapIn - (mediaItem.source.in ?? 0)) / sourceDuration * mediaItem.duration), mediaItem.duration);
    const endOffset = clampFrame(Math.round((overlapOut - (mediaItem.source.in ?? 0)) / sourceDuration * mediaItem.duration), mediaItem.duration);
    if (endOffset <= startOffset)
        return { items: [item], removedFrames: 0 };
    const ids = new Set();
    for (const track of edit.tracks)
        if ('items' in track)
            for (const candidate of track.items)
                collectIds(candidate, ids);
    const items = (0, ripple_1.removeTimelineItemRange)(item, { start: item.at + startOffset, end: item.at + endOffset }, edit.output.fps, ids);
    if (preserveSourceEdges && items.length) {
        const first = items[0];
        const last = items[items.length - 1];
        if (first.at === item.at && mediaItem.source.in !== undefined)
            first.source.in = mediaItem.source.in;
        if (last.at + last.duration === item.at + item.duration && mediaItem.source.out !== undefined) {
            last.source.out = mediaItem.source.out;
        }
    }
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
function audioTracks(edit) {
    return edit.tracks.filter((track) => track.lane === 'audio' && 'items' in track);
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
