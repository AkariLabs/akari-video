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
    const edit = version === 2 ? JSON.parse(source) : undefined;
    if (edit && normalized.some(range => syncGroupForRange(edit, range))) {
        let current = source;
        let removedFrames = 0;
        const warnings = [];
        for (const range of ranges) {
            const group = syncGroupForRange(JSON.parse(current), range);
            let result;
            try {
                result = group ? applySyncGroupCut(current, range, group, opts) : applyV2(current, [range], opts);
            }
            catch (error) {
                if (!group)
                    throw error;
                warnings.push(`同期した素材を切れませんでした。配置とカット範囲を確認してください。`);
                continue;
            }
            current = result.source;
            removedFrames += result.removedFrames;
            warnings.push(...result.warnings);
        }
        return { source: current, removedFrames, warnings };
    }
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
function syncGroupForRange(edit, range) {
    return edit.sync_groups?.find(group => group.members.some(member => member.source === range.captionId));
}
function syncOutputRanges(edit, range) {
    const visual = visualTracks(edit).flatMap(track => track.items.filter(media))
        .filter(item => item.source.src === range.captionId);
    const items = visual.length ? visual
        : audioTracks(edit).flatMap(track => track.items.filter(item => !item.link
            && (item.role === 'speech' || item.role === 'narration')
            && item.source.src === range.captionId));
    return items.flatMap(item => {
        const start = Math.max(range.in, item.source.in ?? Infinity);
        const end = Math.min(range.out, item.source.out ?? -Infinity);
        if (!(end > start) || !item.duration)
            return [];
        const span = item.source.out - item.source.in;
        const first = item.at + Math.round((start - item.source.in) / span * item.duration);
        const last = item.at + Math.round((end - item.source.in) / span * item.duration);
        return last > first ? [{ start: first, end: last }] : [];
    });
}
function syncVisualShift(before, after, group, audio) {
    const members = new Set(group.members.map(member => member.source));
    const beforeVisual = visualTracks(before).flatMap(track => track.items.filter(media))
        .filter(item => members.has(item.source.src));
    const afterVisual = visualTracks(after).flatMap(track => track.items.filter(media))
        .filter(item => members.has(item.source.src));
    for (const frame of [audio.at, audio.at + Math.floor(audio.duration / 2), audio.at + audio.duration - 1]) {
        const visual = beforeVisual.find(item => frame >= item.at && frame < item.at + item.duration);
        if (!visual)
            continue;
        const sourceTime = visual.source.in + (frame + 0.5 - visual.at)
            / visual.duration * (visual.source.out - visual.source.in);
        const moved = afterVisual.find(item => item.source.src === visual.source.src
            && sourceTime >= item.source.in - SOURCE_TOLERANCE
            && sourceTime < item.source.out - SOURCE_TOLERANCE);
        if (moved)
            return Math.round(moved.at + (sourceTime - moved.source.in)
                / (moved.source.out - moved.source.in) * moved.duration - frame - 0.5);
    }
    const preceding = [...beforeVisual].filter(item => item.at + item.duration <= audio.at)
        .sort((left, right) => right.at + right.duration - left.at - left.duration)[0];
    const following = [...beforeVisual].filter(item => item.at >= audio.at + audio.duration)
        .sort((left, right) => left.at - right.at)[0];
    const anchor = preceding ?? following;
    if (anchor) {
        const family = afterVisual.filter(item => item.source.src === anchor.source.src
            && splitRootId(item.id) === splitRootId(anchor.id))
            .sort((left, right) => left.at - right.at);
        const moved = preceding ? family.at(-1) : family[0];
        if (moved)
            return preceding
                ? moved.at + moved.duration - anchor.at - anchor.duration
                : moved.at - anchor.at;
    }
    return undefined;
}
function applySyncGroupCut(source, range, group, opts) {
    const original = JSON.parse(source);
    (0, edit_v2_1.readEditV2)(original);
    const gapTrackIds = new Set(visualTracks(original).filter(track => {
        const items = track.items.filter(media);
        return items.some(item => group.members.some(member => member.source === item.source.src))
            && (items[0]?.at > 0 || items.some((item, index) => index > 0
                && item.at > items[index - 1].at + items[index - 1].duration));
    }).map(track => track.id));
    const preserveLeadingGapTrackIds = visualTracks(original).filter(track => gapTrackIds.has(track.id)
        && track.items.filter(media)[0]?.at > 0).map(track => track.id);
    const outputRanges = syncOutputRanges(original, range);
    const members = new Set(group.members.map(member => member.source));
    const targets = outputRanges.flatMap(output => visualTracks(original).flatMap(track => track.items.filter(media).flatMap(item => {
        if (!members.has(item.source.src))
            return [];
        const start = Math.max(output.start, item.at);
        const end = Math.min(output.end, item.at + item.duration);
        if (end <= start)
            return [];
        const span = item.source.out - item.source.in;
        return [{ ...range, captionId: item.source.src,
                in: item.source.in + (start - item.at) / item.duration * span,
                out: item.source.in + (end - item.at) / item.duration * span,
                start, end }];
    })));
    if (!targets.length)
        return { source, removedFrames: 0,
            warnings: ['同期した映像がこの区間にないため、カットしませんでした。'] };
    let current = source;
    let removedFrames = 0;
    let matched = false;
    for (const target of targets) {
        const before = JSON.parse(current);
        if (!visualTracks(before).some(track => track.items.some(item => media(item) && item.source.src === target.captionId && item.source.in < target.out && item.source.out > target.in)))
            continue;
        const preserveGaps = new Map(visualTracks(before).flatMap(track => [...precedingTrackGaps(track, Infinity)]));
        const result = applyV2(current, [target], opts, preserveLeadingGapTrackIds, preserveGaps, true);
        const after = JSON.parse(result.source);
        for (const track of visualTracks(after)) {
            const previous = visualTracks(before).find(candidate => candidate.id === track.id);
            if (!previous)
                continue;
            for (const item of previous.items.filter(media)) {
                const family = track.items.filter((candidate) => media(candidate)
                    && splitRootId(candidate.id) === splitRootId(item.id)
                    && candidate.source.in >= item.source.in - audioFrameTolerance(item)
                    && candidate.source.out <= item.source.out + audioFrameTolerance(item));
                for (const piece of family) {
                    if (near(piece.source.in, item.source.in))
                        piece.source.in = item.source.in;
                    if (near(piece.source.out, item.source.out))
                        piece.source.out = item.source.out;
                }
                const untouched = family.find(piece => piece.id === item.id
                    && piece.duration === item.duration
                    && near(piece.source.in, item.source.in) && near(piece.source.out, item.source.out));
                if (untouched) {
                    const clean = untouched;
                    const prior = item;
                    if (prior.reason === undefined)
                        delete clean.reason;
                    else
                        clean.reason = prior.reason;
                    if (prior.label === undefined)
                        delete clean.label;
                    else
                        clean.label = prior.label;
                    if (prior.cut_edge)
                        clean.cut_edge = { ...prior.cut_edge,
                            at: prior.cut_edge.at + untouched.at - item.at };
                    else
                        delete clean.cut_edge;
                    continue;
                }
                if (item.source.src === target.captionId && item.source.in < target.out && item.source.out > target.in) {
                    for (const piece of family) {
                        if (family.length === 1 || item.cut_edge) {
                            piece.cut_edge = { in: item.cut_edge?.in ?? item.source.in,
                                out: item.cut_edge?.out ?? item.source.out, at: item.cut_edge?.at ?? item.at };
                        }
                    }
                }
                else if (item.cut_edge) {
                    const survivor = family.find(candidate => candidate.id === item.id);
                    if (survivor)
                        survivor.cut_edge = { ...item.cut_edge,
                            at: item.cut_edge.at + survivor.at - item.at };
                }
            }
        }
        current = `${JSON.stringify(after, null, 2)}\n`;
        removedFrames = Math.max(removedFrames, result.removedFrames);
        matched ||= result.removedFrames > 0;
    }
    const edit = JSON.parse(current);
    const cutFrames = targets.map(target => ({ start: target.start, end: target.end }))
        .sort((left, right) => left.start - right.start)
        .reduce((merged, frame) => {
        const last = merged[merged.length - 1];
        if (last && frame.start <= last.end)
            last.end = Math.max(last.end, frame.end);
        else
            merged.push({ ...frame });
        return merged;
    }, []);
    const rippleFrames = cutFrames.reduce((sum, frame) => sum + frame.end - frame.start, 0);
    const audioCutFrames = cutFrames;
    const audioIds = new Set();
    for (const candidateTrack of edit.tracks)
        if ('items' in candidateTrack)
            for (const candidate of candidateTrack.items)
                collectIds(candidate, audioIds);
    for (const target of group.members)
        for (const track of audioTracks(edit)) {
            const next = [];
            const shifts = [];
            const shiftableEdges = [];
            for (const item of track.items) {
                if (item.link || (item.role !== 'speech' && item.role !== 'narration')
                    || item.source.kind !== 'media' || item.source.src !== target.source
                    || item.source.in === undefined || item.source.out === undefined) {
                    next.push(item);
                    shifts.push(undefined);
                    shiftableEdges.push(false);
                    continue;
                }
                let pieces = [item];
                let wasCut = false;
                for (const frame of [...audioCutFrames].reverse()) {
                    pieces = pieces.flatMap(piece => {
                        const start = Math.max(frame.start, piece.at);
                        const end = Math.min(frame.end, piece.at + piece.duration);
                        if (end <= start)
                            return [piece];
                        const sliced = (0, ripple_1.removeTimelineItemRange)(piece, { start, end }, edit.output.fps, audioIds);
                        for (const survivor of sliced) {
                            if (survivor.at === piece.at)
                                survivor.source.in = piece.source.in;
                            if (survivor.at + survivor.duration === piece.at + piece.duration)
                                survivor.source.out = piece.source.out;
                            copyRangeMetadata(survivor, range);
                            if (sliced.length === 1)
                                survivor.cut_edge = {
                                    in: piece.cut_edge?.in ?? piece.source.in,
                                    out: piece.cut_edge?.out ?? piece.source.out,
                                    at: piece.cut_edge?.at ?? piece.at
                                };
                            else if (piece.cut_edge)
                                survivor.cut_edge = { ...piece.cut_edge };
                        }
                        wasCut = true;
                        matched = true;
                        return sliced;
                    });
                }
                for (const piece of pieces) {
                    const shift = syncVisualShift(original, edit, group, piece);
                    if (shift !== undefined) {
                        piece.at += shift;
                        if (piece.cut_edge && !wasCut)
                            piece.cut_edge.at += shift;
                    }
                    else if (cutFrames.some(frame => piece.at >= frame.end)) {
                        piece.at -= rippleFrames;
                        if (piece.cut_edge && !wasCut)
                            piece.cut_edge.at -= rippleFrames;
                    }
                    next.push(piece);
                    shifts.push(shift);
                    shiftableEdges.push(!wasCut);
                }
            }
            if (gapTrackIds.size) {
                for (let index = 0; index < next.length; index++) {
                    if (shifts[index] !== undefined || next[index].link
                        || (next[index].role !== 'speech' && next[index].role !== 'narration')
                        || next[index].source.src !== target.source)
                        continue;
                    const neighbor = [...shifts.slice(0, index)].reverse().find(value => value !== undefined)
                        ?? shifts.slice(index + 1).find(value => value !== undefined);
                    if (neighbor === undefined)
                        continue;
                    const fallback = cutFrames.some(frame => next[index].at >= frame.end) ? -rippleFrames : 0;
                    const additional = Math.max(-next[index].at, neighbor - fallback);
                    next[index].at += additional;
                    if (next[index].cut_edge && shiftableEdges[index])
                        next[index].cut_edge.at += additional;
                }
            }
            track.items = next;
        }
    if (!matched)
        return { source, removedFrames: 0,
            warnings: [`カット対象が見つかりません: ${range.in}–${range.out}`] };
    (0, edit_v2_1.readEditV2)(edit);
    return { source: `${JSON.stringify(edit, null, 2)}\n`, removedFrames, warnings: [] };
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
function applyV2(source, ranges, opts, preserveLeadingGapTrackIds = [], preserveGapBeforeItems, forceSourceEdges = false) {
    const raw = JSON.parse(source);
    const validated = (0, edit_v2_1.readEditV2)(raw);
    requireFps(opts.fps ?? validated.output.fps);
    const edit = JSON.parse(JSON.stringify(raw));
    const warnings = [];
    const affectedTrackIds = new Set();
    const preserveSourceEdges = forceSourceEdges || audioTracks(edit).some(track => track.items.some(item => item.link));
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
                        if (audioPieces.length === 1 && audioPieces[0] !== audio) {
                            setCutEdge(audioPieces[0], audio.cut_edge?.in ?? audio.source.in, audio.cut_edge?.out ?? audio.source.out);
                        }
                        else if (audioPieces.length === 2) {
                            setCutEdge(audioPieces[0], audio.cut_edge?.in ?? audio.source.in, audioPieces[0].source.out);
                            setCutEdge(audioPieces[1], audioPieces[1].source.in, audio.cut_edge?.out ?? audio.source.out);
                        }
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
                    ?? (right.id !== splitRootId(right.id)
                        && !beforeMedia.some(candidate => candidate.id === splitRootId(right.id))
                        ? preserveGapBeforeItems?.get(splitRootId(right.id)) : undefined)
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
    refreshCutEdges(compacted);
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
function setCutEdge(item, originalIn, originalOut) {
    if (near(originalIn, item.source.in ?? NaN) && near(originalOut, item.source.out ?? NaN)) {
        delete item.cut_edge;
        return;
    }
    const secondsPerFrame = ((item.source.out ?? 0) - (item.source.in ?? 0)) / item.duration;
    const at = secondsPerFrame > 0
        ? item.at - Math.round(((item.source.in ?? 0) - originalIn) / secondsPerFrame)
        : item.at;
    item.cut_edge = { in: originalIn, out: originalOut, at };
}
function refreshCutEdges(edit) {
    for (const track of audioTracks(edit))
        for (const item of track.items) {
            if (item.cut_edge)
                setCutEdge(item, item.cut_edge.in, item.cut_edge.out);
        }
}
function audioFrameTolerance(...items) {
    return Math.max(SOURCE_TOLERANCE, ...items.map(item => item.duration > 0 ? ((item.source.out ?? 0) - (item.source.in ?? 0)) / item.duration + SOURCE_TOLERANCE : 0));
}
function nearRangeEdge(edge, boundary, item) {
    return edge !== undefined && Math.abs(edge - boundary) <=
        (item.source.speed !== undefined && item.source.speed !== 1
            ? SOURCE_TOLERANCE : audioFrameTolerance(item));
}
function rangeEdgeIndices(items, boundary, side, captionId, exactOnly = false) {
    const candidates = items.flatMap((item, index) => media(item)
        && (captionId === undefined || item.source.src === captionId) ? [index] : []);
    const exact = candidates.filter(index => near(items[index].source[side], boundary));
    return exact.length || exactOnly ? exact : candidates.filter(index => nearRangeEdge(items[index].source[side], boundary, items[index]));
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
function precedingTrackGaps(track, boundaryAt) {
    const gaps = new Map();
    const items = track.items.filter(media);
    for (let index = 1; index < items.length; index++) {
        const previous = items[index - 1];
        const current = items[index];
        if (current.at > boundaryAt)
            continue;
        const gap = current.at - previous.at - previous.duration;
        if (gap > 0)
            gaps.set(current.id, gap);
    }
    return gaps;
}
function media(item) {
    return item.source.kind === 'media';
}
function sameSplitProperties(left, right, ignoreFades = false) {
    const comparable = (item) => {
        const copy = structuredClone(item);
        for (const key of ['id', 'at', 'duration', 'reason', 'label', 'cut_edge', 'anchor', 'link'])
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
        for (const key of ['id', 'name', 'locked', 'at', 'duration', 'reason', 'label', 'cut_edge', 'anchor'])
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
        for (const key of ['id', 'reason', 'label', 'cut_edge', 'anchor', 'link'])
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
function restoreLinkedAudio(original, restored, visualTrackIndex, leftId, rightId, range, soloFrames) {
    const beforeVisual = original.tracks[visualTrackIndex];
    const afterVisual = restored.tracks[visualTrackIndex];
    const originalLeft = beforeVisual.items.find(item => item.id === leftId);
    const originalRight = beforeVisual.items.find(item => item.id === rightId);
    const mergedVisual = afterVisual.items.find(item => item.id === leftId);
    const restoredFrames = mergedVisual.duration - originalLeft.duration - originalRight.duration;
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
            const tolerance = Math.max(SOURCE_TOLERANCE, audioFrameTolerance(solo, originalLeft, originalRight) / 2);
            const outsideCut = leftIndex < 0
                ? (solo.source.in ?? -Infinity) > range.out + tolerance
                : (solo.source.out ?? Infinity) < range.in - tolerance;
            if (!outsideCut && !solo.cut_edge)
                return RESTORE_PROVENANCE;
            const candidate = candidateTrack.items.find(item => item.id === solo.id);
            if (!candidate)
                return RESTORE_UNAVAILABLE;
            candidate.link = leftId;
            if (leftIndex < 0)
                candidate.at += restoredFrames;
            if (!outsideCut && solo.cut_edge) {
                soloFrames.attempted = true;
                const edge = solo.cut_edge;
                const sourceStep = ((solo.source.out ?? 0) - (solo.source.in ?? 0)) / solo.duration;
                if (!(sourceStep > 0))
                    return RESTORE_UNAVAILABLE;
                if (leftIndex < 0) {
                    // The cut boundary is in seconds; the surviving audio edge lands on a frame.
                    if (Math.abs((solo.source.in ?? NaN) - range.out) > tolerance
                        || edge.in > solo.source.in || edge.in < range.in - tolerance)
                        return RESTORE_UNAVAILABLE;
                    const frames = Math.round((solo.source.in - edge.in) / sourceStep) + soloFrames.offset;
                    if (frames <= 0)
                        return RESTORE_UNAVAILABLE;
                    candidate.source.in = edge.in;
                    candidate.duration += frames;
                    candidate.at -= frames;
                }
                else {
                    if (Math.abs((solo.source.out ?? NaN) - range.in) > tolerance
                        || edge.out < solo.source.out || edge.out > range.out + tolerance)
                        return RESTORE_UNAVAILABLE;
                    const frames = Math.round((edge.out - solo.source.out) / sourceStep) + soloFrames.offset;
                    if (frames <= 0)
                        return RESTORE_UNAVAILABLE;
                    candidate.source.out = edge.out;
                    candidate.duration += frames;
                }
                setCutEdge(candidate, edge.in, edge.out);
                if (!candidate.cut_edge) {
                    if (!candidateTrack.items.some(item => item !== candidate
                        && splitRootId(item.id) === splitRootId(candidate.id))) {
                        candidate.id = splitRootId(candidate.id);
                    }
                }
            }
            continue;
        }
        if (rightIndex <= leftIndex)
            return RESTORE_UNAVAILABLE;
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
        setCutEdge(merged, left.cut_edge?.in ?? merged.source.in, right.cut_edge?.out ?? merged.source.out);
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
        // Other surviving audio pieces can still refer to the right visual piece.
        // The right visual is gone after the merge, so carry those pieces along with it.
        for (const item of candidateTrack.items) {
            if (item.link !== rightId)
                continue;
            item.link = leftId;
            item.at += restoredFrames;
        }
        if (mergedVisual.id === splitRootId(mergedVisual.id)
            && !afterVisual.items.some(item => item !== mergedVisual
                && media(item) && splitRootId(item.id) === mergedVisual.id)
            && !candidateTrack.items.some(item => item !== ordered
                && splitRootId(item.id) === splitRootId(ordered.id))) {
            ordered.id = splitRootId(ordered.id);
        }
    }
    return undefined;
}
function restoreOneTrack(edit, trackIndex, range, exactLeft, exactRight, preserveLeadingGap = false, allowUnlabeled = false) {
    const original = edit.tracks[trackIndex];
    const items = original.items;
    const leftIndices = rangeEdgeIndices(items, range.in, 'out', range.captionId, exactLeft);
    const rightIndices = rangeEdgeIndices(items, range.out, 'in', range.captionId, exactRight);
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
    if (!allowUnlabeled && leftMeta.reason === undefined && leftMeta.label === undefined
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
        if (left.cut_edge || right.cut_edge) {
            const outerIn = left.cut_edge?.in ?? left.source.in;
            const outerOut = right.cut_edge?.out ?? right.source.out;
            if (!near(outerIn, merged.source.in) || !near(outerOut, merged.source.out)) {
                merged.cut_edge = { in: outerIn, out: outerOut, at: left.cut_edge?.at ?? left.at };
            }
            else
                delete merged.cut_edge;
        }
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
        const hasRemainingAudioEdge = audioTracks(edit).some(audioTrack => {
            const leftAudio = audioTrack.items.find(item => item.link === left.id);
            const rightAudio = audioTrack.items.find(item => item.link === right.id);
            return (leftAudio?.cut_edge && leftAudio.cut_edge.in !== leftAudio.source.in)
                || (rightAudio?.cut_edge && rightAudio.cut_edge.out !== rightAudio.source.out);
        });
        if (noRemainingCut && !hasRemainingAudioEdge && !merged.cut_edge) {
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
        const linked = audioTracks(edit).some(audioTrack => audioTrack.items.some(item => item.link));
        let trial;
        if (!linked) {
            trial = applyV2(`${JSON.stringify(candidate, null, 2)}\n`, [{ ...range, kind: 'row' }], {}, preserveLeadingGap ? [original.id] : [], allowUnlabeled ? precedingTrackGaps(original, Infinity) : undefined);
        }
        else {
            const visualOnly = { ...candidate, tracks: candidate.tracks.filter(track => track.lane !== 'audio') };
            const preserveLeadingGap = target.find(media)?.at ? [original.id] : [];
            const preserveGaps = precedingTrackGaps(original, Infinity);
            const originalMedia = original.items.filter(media);
            for (let index = 1; index < originalMedia.length; index++) {
                const previous = originalMedia[index - 1];
                const current = originalMedia[index];
                const gap = Math.max(preserveGaps.get(current.id) ?? 0, linkedAudioGap(edit, previous, current));
                if (gap > 0)
                    preserveGaps.set(current.id, gap);
            }
            trial = applyV2(`${JSON.stringify(visualOnly, null, 2)}\n`, [{ ...range, kind: 'row' }], {}, preserveLeadingGap, preserveGaps);
        }
        const replay = JSON.parse(trial.source).tracks.find(track => track.id === original.id);
        if (sameCutResult(replay, original))
            return { track };
    }
    return {};
}
function restoreSyncAudio(edit, target, rippleFrames) {
    let changed = false;
    const fps = edit.output.fps;
    for (const track of audioTracks(edit)) {
        const items = track.items;
        const matches = (item) => !item.link
            && (item.role === 'speech' || item.role === 'narration')
            && item.source.src === target.captionId;
        const leftIndex = items.findIndex(item => matches(item)
            && Math.abs((item.source.out ?? NaN) - target.in) <= audioFrameTolerance(item));
        const rightIndex = items.findIndex(item => matches(item)
            && Math.abs((item.source.in ?? NaN) - target.out) <= audioFrameTolerance(item));
        if (leftIndex < 0 && rightIndex < 0) {
            for (const item of items)
                if (matches(item)
                    && item.source.in >= target.out - audioFrameTolerance(item)) {
                    item.at += rippleFrames;
                    if (item.cut_edge)
                        item.cut_edge.at += rippleFrames;
                    changed = true;
                }
            continue;
        }
        const left = leftIndex < 0 ? undefined : items[leftIndex];
        const right = rightIndex < 0 ? undefined : items[rightIndex];
        if (left && right && splitRootId(left.id) !== splitRootId(right.id)) {
            if (!left.cut_edge || !right.cut_edge)
                return false;
            const leftStep = (left.source.out - left.source.in) / left.duration;
            const rightStep = (right.source.out - right.source.in) / right.duration;
            if (!(leftStep > 0) || !(rightStep > 0))
                return false;
            const leftFrames = Math.round((left.cut_edge.out - left.source.out) / leftStep);
            const rightFrames = Math.round((right.source.in - right.cut_edge.in) / rightStep);
            if (leftFrames < 0 || rightFrames < 0)
                return false;
            const boundary = right.at;
            left.source.out = left.cut_edge.out;
            left.duration += leftFrames;
            right.source.in = right.cut_edge.in;
            right.duration += rightFrames;
            right.at = right.cut_edge.at;
            for (const item of items)
                if (item !== left && item !== right
                    && matches(item) && item.at >= boundary) {
                    item.at += rippleFrames;
                    if (item.cut_edge)
                        item.cut_edge.at += rippleFrames;
                }
            for (const restored of [left, right]) {
                const family = items.filter(item => matches(item)
                    && splitRootId(item.id) === splitRootId(restored.id))
                    .sort((a, b) => a.source.in - b.source.in);
                if (family.every((item, index) => index === 0
                    || near(family[index - 1].source.out, item.source.in))
                    && family.every(item => !item.cut_edge || (near(item.cut_edge.in, item.source.in)
                        && near(item.cut_edge.out, item.source.out)))) {
                    for (const item of family) {
                        delete item.cut_edge;
                        delete item.reason;
                        delete item.label;
                    }
                    if (family.length === 1)
                        family[0].id = splitRootId(family[0].id);
                }
            }
            changed = true;
            continue;
        }
        let boundary;
        let frames;
        if (left && right) {
            const gap = right.at - left.at - left.duration;
            if (rightIndex <= leftIndex || splitRootId(left.id) !== splitRootId(right.id)
                || !sameSplitProperties(left, right))
                return false;
            const step = (left.source.out - left.source.in) / left.duration;
            frames = rippleFrames ? rippleFrames + gap : Math.round((target.out - target.in) / step);
            const sourceFrames = Math.round((right.source.in - left.source.out) / step);
            if (!(frames > 0) || Math.abs(frames - sourceFrames) > 2)
                return false;
            boundary = right.at;
            const merged = structuredClone(left);
            merged.duration = left.duration + frames + right.duration;
            merged.source.out = right.source.out;
            if (left.cut_edge || right.cut_edge)
                merged.cut_edge = {
                    in: left.cut_edge?.in ?? left.source.in,
                    out: right.cut_edge?.out ?? right.source.out, at: left.cut_edge?.at ?? left.at
                };
            items.splice(rightIndex, 1);
            items.splice(leftIndex, 1, merged);
        }
        else {
            const survivor = left ?? right;
            const edge = survivor.cut_edge;
            if (!edge)
                return false;
            const step = (survivor.source.out - survivor.source.in) / survivor.duration;
            if (!(step > 0))
                return false;
            frames = Math.round(((right ? survivor.source.in - edge.in : edge.out - survivor.source.out)) / step);
            if (!(frames > 0))
                return false;
            boundary = right ? survivor.at : survivor.at + survivor.duration;
            if (right) {
                survivor.source.in = edge.in;
                survivor.at = edge.at;
            }
            else
                survivor.source.out = edge.out;
            survivor.duration += frames;
        }
        for (const item of items) {
            if (item.source.src === target.captionId && item.at >= boundary
                && item !== (left ? items[leftIndex] : right)) {
                const ripple = rippleFrames || Math.round((target.out - target.in) * fps);
                item.at += ripple;
                if (item.cut_edge)
                    item.cut_edge.at += ripple;
            }
        }
        const family = items.filter(item => matches(item) && splitRootId(item.id) === splitRootId((left ?? right).id))
            .sort((a, b) => a.source.in - b.source.in);
        const complete = family.every((item, index) => index === 0
            || near(family[index - 1].source.out, item.source.in))
            && family.every(item => !item.cut_edge || (near(item.cut_edge.in, item.source.in)
                && near(item.cut_edge.out, item.source.out)));
        if (complete)
            for (const item of family) {
                delete item.reason;
                delete item.label;
                delete item.cut_edge;
                if (!items.some(other => other !== item && matches(other)
                    && splitRootId(other.id) === splitRootId(item.id)))
                    item.id = splitRootId(item.id);
            }
        changed = true;
    }
    return changed;
}
function restoreSyncVisualEdges(source, target, preserveLeadingGapTrackIds = []) {
    const original = JSON.parse(source);
    const restored = structuredClone(original);
    let changed = false;
    for (const track of visualTracks(restored)) {
        const edgePieces = track.items.filter((item) => media(item)
            && item.source.src === target.captionId && !!item.cut_edge
            && ((Math.abs(item.source.out - target.in) <= audioFrameTolerance(item)
                && item.cut_edge.out > item.source.out + SOURCE_TOLERANCE)
                || (Math.abs(item.source.in - target.out) <= audioFrameTolerance(item)
                    && item.cut_edge.in < item.source.in - SOURCE_TOLERANCE)));
        if (!edgePieces.length)
            continue;
        const boundary = Math.max(...edgePieces.map(item => item.at + item.duration));
        let addedFrames = 0;
        for (const item of [...edgePieces].sort((left, right) => left.at - right.at)) {
            if (hasTimedAppearance(item) || !item.cut_edge) {
                return { source, restored: false, reason: RESTORE_PROVENANCE };
            }
            const step = (item.source.out - item.source.in) / item.duration;
            if (!(step > 0))
                return { source, restored: false, reason: RESTORE_UNAVAILABLE };
            const edge = item.cut_edge;
            const restoresStart = Math.abs(item.source.in - target.out) <= audioFrameTolerance(item)
                && edge.in < item.source.in - SOURCE_TOLERANCE;
            const restoresEnd = Math.abs(item.source.out - target.in) <= audioFrameTolerance(item)
                && edge.out > item.source.out + SOURCE_TOLERANCE;
            const extra = Math.round(((restoresStart ? item.source.in - edge.in : 0)
                + (restoresEnd ? edge.out - item.source.out : 0)) / step);
            addedFrames += extra;
            if (restoresStart) {
                item.source.in = edge.in;
                item.at = edge.at + addedFrames - extra;
            }
            if (restoresEnd)
                item.source.out = edge.out;
            item.duration += extra;
            const root = splitRootId(item.id);
            if (!track.items.some(other => other !== item && other.id === root))
                item.id = root;
            if (near(edge.in, item.source.in) && near(edge.out, item.source.out))
                delete item.cut_edge;
            const meta = item;
            const family = track.items.filter((candidate) => media(candidate)
                && splitRootId(candidate.id) === root).sort((a, b) => a.source.in - b.source.in);
            if (family.every((piece, index) => index === 0 || near(family[index - 1].source.out, piece.source.in))) {
                delete meta.reason;
                delete meta.label;
            }
        }
        for (const item of track.items) {
            if (!edgePieces.includes(item) && item.at >= boundary) {
                item.at += addedFrames;
                if (media(item) && item.cut_edge)
                    item.cut_edge.at += addedFrames;
            }
        }
        changed = true;
    }
    if (!changed)
        return { source, restored: false, reason: RESTORE_PROVENANCE };
    const preserveGaps = new Map(visualTracks(original).flatMap(track => [...precedingTrackGaps(track, Infinity)]));
    const replay = JSON.parse(applyV2(`${JSON.stringify(restored, null, 2)}\n`, [target], {}, preserveLeadingGapTrackIds, preserveGaps).source);
    for (const originalTrack of visualTracks(original)) {
        if (!originalTrack.items.some(item => media(item) && item.source.src === target.captionId))
            continue;
        const next = visualTracks(replay).find(track => track.id === originalTrack.id);
        if (!next || !sameCutResult(next, originalTrack)) {
            return { source, restored: false, reason: RESTORE_UNAVAILABLE };
        }
    }
    return { source: `${JSON.stringify(restored, null, 2)}\n`, restored: true };
}
function syncRestoreTargets(edit, group, range) {
    const itemsFor = (source) => {
        const visual = visualTracks(edit).flatMap(track => track.items.filter(media))
            .filter(item => item.source.src === source);
        return visual.length ? visual : audioTracks(edit).flatMap(track => track.items.filter(item => !item.link
            && item.source.src === source));
    };
    const originItems = itemsFor(range.captionId ?? '');
    const left = originItems.find(item => Math.abs((item.source.out ?? NaN) - range.in)
        <= audioFrameTolerance(item));
    const right = originItems.find(item => Math.abs((item.source.in ?? NaN) - range.out)
        <= audioFrameTolerance(item));
    const boundary = left ? left.at + left.duration : right?.at;
    if (boundary === undefined)
        return [];
    return group.members.flatMap(member => {
        const items = itemsFor(member.source);
        const before = [...items].sort((left, right) => Math.abs(left.at + left.duration - boundary)
            - Math.abs(right.at + right.duration - boundary))
            .find(item => Math.abs(item.at + item.duration - boundary) <= 1);
        const after = [...items].sort((left, right) => Math.abs(left.at - boundary)
            - Math.abs(right.at - boundary))
            .find(item => Math.abs(item.at - boundary) <= 1);
        let start = before?.source.out;
        let end = after?.source.in;
        if (start === undefined && after?.cut_edge && after.cut_edge.in < after.source.in - SOURCE_TOLERANCE)
            start = after.cut_edge.in;
        if (end === undefined && before?.cut_edge && before.cut_edge.out > before.source.out + SOURCE_TOLERANCE)
            end = before.cut_edge.out;
        if (member.source === range.captionId) {
            start = range.in;
            end = range.out;
        }
        return start !== undefined && end !== undefined && end > start + SOURCE_TOLERANCE
            ? [{ ...range, kind: 'row', captionId: member.source, in: start, out: end }]
            : [];
    });
}
function restoreSyncGroupCut(source, range, group) {
    const original = JSON.parse(source);
    (0, edit_v2_1.readEditV2)(original);
    const preserveLeadingGapTrackIds = visualTracks(original).filter(track => {
        const first = track.items.find(media);
        return first && first.at > 0 && group.members.some(member => member.source === first.source.src);
    }).map(track => track.id);
    const targets = syncRestoreTargets(original, group, range);
    if (!targets.length)
        return { source, restored: false, reason: RESTORE_PROVENANCE };
    let current = structuredClone(original);
    let changed = false;
    let restoredVisualFrames = 0;
    for (const target of targets) {
        if (!visualTracks(original).some(track => track.items.some(item => media(item) && item.source.src === target.captionId)))
            continue;
        const beforeDuration = visualTracks(current).flatMap(track => track.items)
            .filter(item => media(item) && item.source.src === target.captionId)
            .reduce((total, item) => total + item.duration, 0);
        const audioEdges = new Map(audioTracks(current).flatMap(track => track.items
            .filter(item => !item.link && item.cut_edge).map(item => [item.id, structuredClone(item.cut_edge)])));
        const visualSource = `${JSON.stringify(current, null, 2)}\n`;
        let result = restoreCutRangeUnchecked(visualSource, target, { offset: 0, attempted: false }, preserveLeadingGapTrackIds, true);
        if (!result.restored)
            result = restoreSyncVisualEdges(visualSource, target, preserveLeadingGapTrackIds);
        if (!result.restored)
            return { source, restored: false, reason: result.reason };
        current = JSON.parse(result.source);
        const afterDuration = visualTracks(current).flatMap(track => track.items)
            .filter(item => media(item) && item.source.src === target.captionId)
            .reduce((total, item) => total + item.duration, 0);
        restoredVisualFrames = Math.max(restoredVisualFrames, afterDuration - beforeDuration);
        for (const track of audioTracks(current))
            for (const item of track.items) {
                if (!item.link && audioEdges.has(item.id))
                    item.cut_edge = audioEdges.get(item.id);
            }
        changed = true;
    }
    for (const target of targets) {
        if (audioTracks(original).some(track => track.items.some(item => !item.link
            && (item.role === 'speech' || item.role === 'narration') && item.source.src === target.captionId))) {
            if (!restoreSyncAudio(current, target, restoredVisualFrames))
                return { source, restored: false, reason: RESTORE_PROVENANCE };
            changed = true;
        }
    }
    if (!changed)
        return { source, restored: false, reason: RESTORE_PROVENANCE };
    const visualsById = new Map(visualTracks(current).flatMap(track => track.items
        .filter(media).map(item => [item.id, item])));
    for (const track of audioTracks(current))
        for (const item of track.items) {
            const visual = item.link && visualsById.get(item.link);
            if (item.link && !visual)
                return { source, restored: false, reason: RESTORE_UNAVAILABLE };
            if (!visual || !item.cut_edge)
                continue;
            if ((item.cut_edge.in < item.source.in - SOURCE_TOLERANCE
                && visual.source.in <= item.cut_edge.in + SOURCE_TOLERANCE)
                || (item.cut_edge.out > item.source.out + SOURCE_TOLERANCE
                    && visual.source.out >= item.cut_edge.out - SOURCE_TOLERANCE)) {
                return { source, restored: false, reason: RESTORE_UNAVAILABLE };
            }
        }
    for (const track of current.tracks) {
        if (!('items' in track) || !track.items.some(item => item.source.kind === 'media'
            && group.members.some(member => member.source === item.source.src)))
            continue;
        const ordered = [...track.items].sort((left, right) => left.at - right.at);
        if (ordered.some((item, index) => index > 0
            && item.at < ordered[index - 1].at + ordered[index - 1].duration)) {
            return { source, restored: false, reason: RESTORE_UNAVAILABLE };
        }
    }
    const originItems = [...visualTracks(original).flatMap(track => track.items.filter(media)),
        ...audioTracks(original).flatMap(track => track.items.filter(item => !item.link))]
        .filter(item => item.source.src === range.captionId);
    const originLeft = originItems.find(item => Math.abs((item.source.out ?? NaN) - range.in)
        <= audioFrameTolerance(item));
    const originRight = originItems.find(item => Math.abs((item.source.in ?? NaN) - range.out)
        <= audioFrameTolerance(item));
    if (originLeft && originRight && originRight.at > originLeft.at + originLeft.duration + 1
        && audioTracks(current).some(track => track.items.some(item => !item.link
            && group.members.some(member => member.source === item.source.src)
            && item.cut_edge && (item.cut_edge.in < item.source.in - SOURCE_TOLERANCE
            || item.cut_edge.out > item.source.out + SOURCE_TOLERANCE)))) {
        return { source, restored: false, reason: RESTORE_UNAVAILABLE };
    }
    for (const track of visualTracks(current))
        for (const item of track.items) {
            if (!media(item) || item.cut_edge || splitRootId(item.id) === item.id)
                continue;
            const meta = item;
            const root = splitRootId(item.id);
            if (meta.reason !== undefined || meta.label !== undefined
                || track.items.some(other => other !== item && splitRootId(other.id) === root))
                continue;
            const previous = visualTracks(original).find(candidate => candidate.id === track.id);
            if (!previous?.items.some(candidate => media(candidate) && splitRootId(candidate.id) === root
                && (candidate.reason !== undefined
                    || candidate.label !== undefined)))
                continue;
            const oldId = item.id;
            item.id = root;
            for (const audioTrack of audioTracks(current))
                for (const audio of audioTrack.items) {
                    if (audio.link === oldId)
                        audio.link = root;
                }
        }
    const replay = JSON.parse(applySyncGroupCut(`${JSON.stringify(current, null, 2)}\n`, { ...range, kind: 'row' }, group, {}).source);
    const members = new Set(group.members.map(member => member.source));
    for (const track of original.tracks) {
        if (!('items' in track) || !track.items.some(item => item.source.kind === 'media'
            && members.has(item.source.src)))
            continue;
        const trial = replay.tracks.find(candidate => candidate.id === track.id);
        if (!trial || !('items' in trial)
            || !sameCutResult(trial, track)) {
            return { source, restored: false, reason: RESTORE_UNAVAILABLE };
        }
    }
    (0, edit_v2_1.readEditV2)(current);
    return { source: `${JSON.stringify(current, null, 2)}\n`, restored: true };
}
/** Inverts one source-time cut from the surviving media items, without a stored snapshot. */
function restoreCutRange(source, range) {
    if (detectEditVersion(source) === 2) {
        const edit = JSON.parse(source);
        const group = syncGroupForRange(edit, range);
        if (group) {
            try {
                return restoreSyncGroupCut(source, range, group);
            }
            catch {
                return { source, restored: false, reason: RESTORE_UNAVAILABLE };
            }
        }
    }
    let first;
    // Each attempt replays the cut below and accepts only a matching sameCutResult.
    for (const offset of [0, -1, 1, -2, 2]) {
        const soloFrames = { offset, attempted: false };
        let result;
        try {
            result = restoreCutRangeUnchecked(source, range, soloFrames);
        }
        catch {
            result = { source, restored: false, reason: RESTORE_UNAVAILABLE };
        }
        if (offset === 0)
            first = result;
        if (result.restored)
            return result;
        if (!soloFrames.attempted)
            break;
    }
    return first ?? { source, restored: false, reason: RESTORE_UNAVAILABLE };
}
function restoreCutRangeUnchecked(source, range, soloFrames, preserveLeadingGapTrackIds = [], allowUnlabeled = false) {
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
    const allVisualItems = visualTracks(edit).flatMap(track => track.items);
    const exactLeft = rangeEdgeIndices(allVisualItems, range.in, 'out', range.captionId, true).length > 0;
    const exactRight = rangeEdgeIndices(allVisualItems, range.out, 'in', range.captionId, true).length > 0;
    for (let index = 0; index < edit.tracks.length; index++) {
        const track = edit.tracks[index];
        if (track.lane !== 'visual' || !('items' in track))
            continue;
        const leftIndices = rangeEdgeIndices(track.items, range.in, 'out', range.captionId, exactLeft);
        const rightIndices = rangeEdgeIndices(track.items, range.out, 'in', range.captionId, exactRight);
        if (!leftIndices.length && !rightIndices.length)
            continue;
        const leftId = leftIndices.length === 1 ? track.items[leftIndices[0]].id : undefined;
        const rightId = rightIndices.length === 1 ? track.items[rightIndices[0]].id : undefined;
        const next = restoreOneTrack(edit, index, range, exactLeft, exactRight, preserveLeadingGapTrackIds.includes(track.id), allowUnlabeled);
        if (!next.track)
            return { source, restored: false, reason: next.reason ?? RESTORE_UNAVAILABLE };
        restored.tracks[index] = next.track;
        if (leftId && rightId) {
            const audioReason = restoreLinkedAudio(edit, restored, index, leftId, rightId, range, soloFrames);
            if (audioReason)
                return { source, restored: false, reason: audioReason };
        }
        changed = true;
    }
    if (!changed)
        return { source, restored: false, reason: RESTORE_PROVENANCE };
    const beforePositions = new Map(visualTracks(edit).flatMap(track => track.items.map(item => [item.id, item.at])));
    const afterPositions = new Map(visualTracks(restored).flatMap(track => track.items.map(item => [item.id, item.at])));
    for (const track of visualTracks(restored))
        for (const item of track.items) {
            if (!media(item) || !item.cut_edge)
                continue;
            const before = beforePositions.get(item.id);
            if (before !== undefined)
                item.cut_edge.at += item.at - before;
        }
    let hasLinkedAudio = false;
    for (const track of audioTracks(restored))
        for (const item of track.items) {
            if (!item.link)
                continue;
            hasLinkedAudio = true;
            const before = beforePositions.get(item.link);
            const after = afterPositions.get(item.link);
            if (before !== undefined && after !== undefined) {
                item.at += after - before;
            }
        }
    refreshCutEdges(restored);
    (0, edit_v2_1.readEditV2)(restored);
    if (hasLinkedAudio) {
        const preserveGaps = new Map();
        for (const track of visualTracks(edit)) {
            const leftIndices = rangeEdgeIndices(track.items, range.in, 'out', range.captionId, exactLeft);
            if (leftIndices.length !== 1)
                continue;
            const left = track.items[leftIndices[0]];
            for (const [id, gap] of precedingTrackGaps(track, Infinity))
                preserveGaps.set(id, gap);
        }
        const trial = applyV2(`${JSON.stringify(restored, null, 2)}\n`, [{ ...range, kind: 'row' }], {}, [], preserveGaps);
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
