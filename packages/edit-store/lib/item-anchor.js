"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveItemAnchor = resolveItemAnchor;
exports.withoutItemAnchors = withoutItemAnchors;
exports.resolveItemAnchors = resolveItemAnchors;
const internal_model_1 = require("./internal-model");
const timeline_map_1 = require("./timeline-map");
function resolveItemAnchor(item, context) {
    const start = item.anchor.range?.start ?? context.caption.start;
    const end = item.anchor.range?.end ?? context.caption.end;
    const startOut = context.caption.timeDomain === 'output'
        ? start : (0, timeline_map_1.sourceToOutput)(context.segments, start);
    const endOut = context.caption.timeDomain === 'output'
        ? end : (0, timeline_map_1.sourceToOutput)(context.segments, end);
    if (startOut === null || endOut === null) {
        return { unresolvable: 'no-source-segments' };
    }
    if (startOut === endOut) {
        return { unresolvable: 'removed-range' };
    }
    const startFrames = Math.round(startOut * context.fps);
    const endFrames = Math.round(endOut * context.fps);
    return {
        at: startFrames + (item.anchor.offset ?? 0) - context.parentAtFrames,
        duration: (item.anchor.duration ?? 'caption') === 'caption'
            ? Math.max(1, endFrames - startFrames)
            : item.duration
    };
}
/**
 * anchor を理解しない既存の v2 reader へ、解決キャッシュだけを渡すための射影。
 * anchor が無い入力は同じ参照を返す。
 */
function withoutItemAnchors(edit) {
    if (!isRecord(edit) || !Array.isArray(edit.tracks))
        return edit;
    let tracksChanged = false;
    const tracks = edit.tracks.map(track => {
        if (!isRecord(track) || !Array.isArray(track.items))
            return track;
        const items = stripItems(track.items);
        if (items === track.items)
            return track;
        tracksChanged = true;
        return { ...track, items };
    });
    return tracksChanged ? { ...edit, tracks } : edit;
}
function resolveItemAnchors(edit, captions, options) {
    if (!hasItemAnchor(edit))
        return { edit, changes: [], warnings: [] };
    const fps = validFps(options?.fps) ?? validFps(edit.output?.fps) ?? 30;
    const anchorFreeEdit = withoutItemAnchors(edit);
    const internal = (0, internal_model_1.readInternalEdit)(anchorFreeEdit);
    const legacy = (0, internal_model_1.projectLegacyEdit)(internal);
    const segments = (0, timeline_map_1.buildTimelineMap)(legacy.cuts, { fps: legacy.fps }).segments;
    const captionById = new Map(captions.map(caption => [caption.id, caption]));
    const changes = [];
    const warnings = [];
    let tracksChanged = false;
    const tracks = edit.tracks.map(track => {
        if (!('items' in track) || !Array.isArray(track.items) || track.lane !== 'visual')
            return track;
        const items = resolveItems(track.items, 0, captionById, segments, fps, changes, warnings);
        if (items === track.items)
            return track;
        tracksChanged = true;
        return { ...track, items };
    });
    return {
        edit: tracksChanged ? { ...edit, tracks } : edit,
        changes,
        warnings
    };
}
function resolveItems(items, parentAtFrames, captionById, segments, fps, changes, warnings) {
    let changed = false;
    const result = items.map(item => {
        let next = item;
        if (item.anchor) {
            if (item.source.kind === 'captions' || item.source.kind === 'caption') {
                warnings.push({ id: item.id, reason: 'unsupported-kind' });
            }
            else {
                const caption = captionById.get(item.anchor.caption);
                if (!caption) {
                    warnings.push({ id: item.id, reason: 'caption-not-found' });
                }
                else {
                    const resolution = resolveItemAnchor(item, {
                        caption,
                        segments,
                        fps,
                        parentAtFrames
                    });
                    if ('unresolvable' in resolution) {
                        warnings.push({ id: item.id, reason: resolution.unresolvable });
                    }
                    else if (item.at !== resolution.at || item.duration !== resolution.duration) {
                        changes.push({
                            id: item.id,
                            before: { at: item.at, duration: item.duration },
                            after: resolution
                        });
                        next = { ...item, ...resolution };
                        changed = true;
                    }
                }
            }
        }
        const absoluteAtFrames = parentAtFrames + next.at;
        if (Array.isArray(next.items)) {
            const children = resolveItems(next.items, absoluteAtFrames, captionById, segments, fps, changes, warnings);
            if (children !== next.items) {
                next = { ...next, items: children };
                changed = true;
            }
        }
        return next;
    });
    return changed ? result : items;
}
function stripItems(items) {
    let changed = false;
    const result = items.map(item => {
        if (!isRecord(item))
            return item;
        let next = item;
        if (Object.prototype.hasOwnProperty.call(item, 'anchor')) {
            const { anchor: _anchor, ...rest } = item;
            next = rest;
            changed = true;
        }
        if (Array.isArray(next.items)) {
            const children = stripItems(next.items);
            if (children !== next.items) {
                next = { ...next, items: children };
                changed = true;
            }
        }
        return next;
    });
    return changed ? result : items;
}
function hasItemAnchor(edit) {
    const visit = (items) => items.some(item => item.anchor !== undefined || (Array.isArray(item.items) && visit(item.items)));
    return edit.tracks.some(track => 'items' in track && track.lane === 'visual' && visit(track.items));
}
function validFps(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
