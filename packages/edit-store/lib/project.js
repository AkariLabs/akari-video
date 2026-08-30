"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openProject = openProject;
exports.composeTransforms = composeTransforms;
const fs_1 = require("fs");
const path_1 = require("path");
const caption_store_1 = require("./caption-store");
const canonical_1 = require("./canonical");
const write_gate_1 = require("./write-gate");
const EDIT_FILE_VERSION = 2;
const MOTION_FILE_VERSION = 0;
async function openProject(dir, opts = {}) {
    const editName = opts.editFile ?? 'edit.json';
    const editPath = (0, path_1.join)(dir, editName);
    let editText = await fs_1.promises.readFile(editPath, 'utf8');
    const parsedEdit = JSON.parse(editText);
    if (!isRecord(parsedEdit) || parsedEdit.version !== EDIT_FILE_VERSION || !Array.isArray(parsedEdit.tracks)) {
        throw new Error('openProject は version: 2 の edit.json を必要とします。');
    }
    const edit = parsedEdit;
    attachEditHelpers(edit);
    const captionsPath = (0, path_1.join)(dir, 'captions.json');
    let captionsText = await readOptional(captionsPath);
    const captionsRoot = captionsText === undefined ? undefined : JSON.parse(captionsText);
    const parsedCaptions = captionsText === undefined
        ? { captions: [], warnings: [] }
        : (0, caption_store_1.parseCaptions)(captionsText);
    const captions = {
        rows: parsedCaptions.captions,
        ...(parsedCaptions.defaultTextStyle !== undefined
            ? { defaultTextStyle: parsedCaptions.defaultTextStyle } : {})
    };
    const motionStates = new Map();
    const loadMotionPath = async (relativePath, groupId) => {
        const safePath = requireMotionPath(relativePath);
        const existing = motionStates.get(safePath);
        if (existing)
            return existing;
        const text = await readOptional((0, path_1.join)(dir, ...safePath.split('/')));
        const doc = text === undefined
            ? { version: 0, group: groupId, items: {} }
            : JSON.parse(text);
        if (!isRecord(doc) || doc.version !== MOTION_FILE_VERSION || !isRecord(doc.items)) {
            throw new Error(`motion 袋の形式を確認できません: ${safePath}`);
        }
        const state = {
            path: safePath,
            doc,
            originalText: text,
            originalState: stableJson(doc),
        };
        motionStates.set(safePath, state);
        return state;
    };
    const project = {
        edit,
        captions,
        async motion(groupId) {
            requireGroupId(groupId);
            return (await loadMotionPath(`motion/${groupId}.json`, groupId)).doc;
        },
        async save(options = {}) {
            normalizeTracks(edit);
            await distributeKeyframes(edit, loadMotionPath);
            const candidates = {};
            const serializedEdit = (0, canonical_1.serializeEdit)(edit);
            if (serializedEdit !== editText)
                candidates[editName] = serializedEdit;
            if (captionsText !== undefined || captions.rows.length > 0) {
                const serializedCaptions = (0, canonical_1.serializeCaptions)(buildCaptionsDocument(captionsRoot, captions));
                if (serializedCaptions !== (captionsText ?? ''))
                    candidates['captions.json'] = serializedCaptions;
            }
            for (const state of motionStates.values()) {
                const changed = stableJson(state.doc) !== state.originalState;
                if (state.originalText === undefined && !changed)
                    continue;
                const serialized = (0, canonical_1.serializeMotion)(state.doc);
                if (serialized !== (state.originalText ?? ''))
                    candidates[state.path] = serialized;
            }
            const written = Object.keys(candidates);
            if (written.length === 0)
                return { written: [], findings: [] };
            let findings = [];
            if (options.lint !== false) {
                const lint = await (0, write_gate_1.lintProjectCandidatesOnDisk)(dir, candidates);
                if (!lint.pass) {
                    const error = new Error(lint.errors[0] ?? 'edit-lint が変更を拒否しました');
                    error.findings = lint.findings;
                    throw error;
                }
                findings = lint.findings;
            }
            await (0, write_gate_1.writeProjectFilesGuarded)(dir, candidates);
            for (const key of written) {
                if (key === editName)
                    editText = candidates[key];
                else if (key === 'captions.json')
                    captionsText = candidates[key];
            }
            for (const state of motionStates.values()) {
                if (state.path in candidates)
                    state.originalText = candidates[state.path];
                state.originalState = stableJson(state.doc);
            }
            return { written, findings };
        }
    };
    return project;
}
function attachEditHelpers(edit) {
    Object.defineProperties(edit, {
        find: { enumerable: false, value: (id) => locate(edit, id)?.item },
        walk: { enumerable: false, value: (fn) => {
                for (const location of allLocations(edit))
                    fn(location.item, location.parent, location.track);
            } },
        parentOf: { enumerable: false, value: (id) => locate(edit, id)?.parent },
        update: { enumerable: false, value: (id, patch) => updateItem(edit, id, patch) },
        move: { enumerable: false, value: (id, target) => moveItem(edit, id, target) },
        insert: { enumerable: false, value: (target, item, index) => insertItem(edit, target, item, index) },
        remove: { enumerable: false, value: (id) => removeItem(edit, id) },
        detach: { enumerable: false, value: (id, target) => detachItem(edit, id, target) },
        group: { enumerable: false, value: (ids, options) => groupItems(edit, ids, options) },
        ungroup: { enumerable: false, value: (id) => ungroupItem(edit, id) },
    });
}
function updateItem(edit, id, patch) {
    const location = requireLocation(edit, id);
    for (const [key, value] of Object.entries(patch)) {
        if (key === 'source' && isRecord(value) && isRecord(location.item.source)) {
            location.item.source = mergePatch(location.item.source, value);
        }
        else if (value === null || value === undefined) {
            delete location.item[key];
        }
        else {
            location.item[key] = clone(value);
        }
    }
    return location.item;
}
function moveItem(edit, id, target) {
    if ((target.track === undefined) === (target.parent === undefined)) {
        throw new Error('move の置き先は track または parent のどちらか一方で指定してください。');
    }
    const source = requireLocation(edit, id);
    let destinationItems;
    let destinationTrack = source.track;
    if (target.parent !== undefined) {
        const parent = requireLocation(edit, target.parent).item;
        if (parent.id === id || containsItem(source.item, parent.id))
            throw new Error('自分自身の子へ move できません。');
        destinationItems = ensureChildren(parent);
    }
    else {
        destinationTrack = requireTrack(edit, target.track);
        destinationItems = requireTrackItems(destinationTrack);
    }
    source.items.splice(source.index, 1);
    if (target.track !== undefined && overlapsAny(source.item, destinationItems)) {
        destinationTrack = createTrackAbove(edit, destinationTrack);
        destinationItems = requireTrackItems(destinationTrack);
    }
    const index = insertionIndex(target.index, destinationItems.length);
    destinationItems.splice(index, 0, source.item);
    return source.item;
}
function insertItem(edit, target, item, index) {
    if (locate(edit, item.id))
        throw new Error(`item id が重複しています: ${item.id}`);
    const cloned = clone(item);
    const track = tracksOf(edit).find(candidate => candidate.id === target);
    if (track) {
        let destination = requireTrackItems(track);
        if (overlapsAny(cloned, destination))
            destination = requireTrackItems(createTrackAbove(edit, track));
        destination.splice(insertionIndex(index, destination.length), 0, cloned);
        return cloned;
    }
    const parent = requireLocation(edit, target).item;
    const children = ensureChildren(parent);
    children.splice(insertionIndex(index, children.length), 0, cloned);
    return cloned;
}
function removeItem(edit, id) {
    const location = requireLocation(edit, id);
    location.items.splice(location.index, 1);
    return location.item;
}
function detachItem(edit, id, target) {
    const source = requireLocation(edit, id);
    if (!source.parent)
        throw new Error(`段直下の item は detach できません: ${id}`);
    const worldAt = absoluteAt(source);
    const worldTransform = composeTransforms(worldTransformOfAncestors(source.ancestors), source.item.transform);
    const worldOpacity = opacityOfAncestors(source.ancestors) * (source.item.opacity ?? 1);
    if (source.parent.source.kind === 'html' || source.parent.source.kind === 'captions') {
        const excluded = source.parent.source.exclude ?? [];
        if (!excluded.includes(id))
            source.parent.source.exclude = [...excluded, id];
    }
    source.items.splice(source.index, 1);
    const targetGroup = target.track === 'above' ? undefined : locate(edit, target.track);
    if (targetGroup) {
        const parentWorldTransform = composeTransforms(worldTransformOfAncestors(targetGroup.ancestors), targetGroup.item.transform);
        const parentOpacity = opacityOfAncestors([...targetGroup.ancestors, targetGroup.item]);
        source.item.at = worldAt - absoluteAt(targetGroup);
        assignTransform(source.item, relativeTransform(parentWorldTransform, worldTransform));
        assignOpacity(source.item, parentOpacity === 0 ? worldOpacity : worldOpacity / parentOpacity);
        ensureChildren(targetGroup.item).push(source.item);
        return source.item;
    }
    source.item.at = worldAt;
    assignTransform(source.item, worldTransform);
    assignOpacity(source.item, worldOpacity);
    let destination;
    if (target.track === 'above') {
        destination = createTrackAbove(edit, source.track);
    }
    else {
        destination = requireTrack(edit, target.track);
        if (overlapsAny(source.item, requireTrackItems(destination)))
            destination = createTrackAbove(edit, destination);
    }
    requireTrackItems(destination).push(source.item);
    return source.item;
}
function groupItems(edit, ids, options = {}) {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length < 2 || uniqueIds.length !== ids.length) {
        throw new Error('group は重複しない 2 個以上の id を必要とします。');
    }
    const locations = uniqueIds.map(id => requireLocation(edit, id));
    const parentIds = new Set(locations.map(location => location.parent?.id));
    if (parentIds.size !== 1)
        throw new Error('group は同じ場所にある item だけをまとめられます。');
    const inParent = locations[0].parent !== undefined;
    if (inParent && new Set(locations.map(location => location.items)).size !== 1) {
        throw new Error('group は同じグループ内の item だけをまとめられます。');
    }
    const ordered = [...locations].sort((left, right) => left.trackIndex - right.trackIndex || left.index - right.index);
    const minimumAt = Math.min(...ordered.map(location => location.item.at));
    const maximumEnd = Math.max(...ordered.map(location => location.item.at + location.item.duration));
    const group = {
        id: nextGroupId(edit),
        ...(options.name === undefined ? {} : { name: options.name }),
        at: minimumAt,
        duration: maximumEnd - minimumAt,
        source: { kind: 'group' },
        items: ordered.map(location => ({ ...location.item, at: location.item.at - minimumAt }))
    };
    const changedOrderIds = inParent ? [] : changedZOrderIds(edit, ordered, minimumAt, maximumEnd);
    removeLocations(ordered);
    if (inParent) {
        const items = locations[0].items;
        items.splice(Math.min(...locations.map(location => location.index)), 0, group);
    }
    else {
        const target = ordered.reduce((front, location) => location.trackIndex > front.trackIndex ? location : front);
        let targetTrack = target.track;
        const targetItems = requireTrackItems(targetTrack);
        if (overlapsAny(group, targetItems))
            targetTrack = createTrackAbove(edit, targetTrack);
        requireTrackItems(targetTrack).push(group);
    }
    return { group, changedOrderIds };
}
function ungroupItem(edit, id) {
    const location = requireLocation(edit, id);
    const group = location.item;
    if (group.source.kind === 'html' || group.source.kind === 'captions') {
        throw new Error('袋グループは ungroup できません。');
    }
    if (group.source.kind !== 'group')
        throw new Error(`純グループではありません: ${id}`);
    if (group.keyframes !== undefined || group.motion !== undefined || group.animator !== undefined) {
        throw new Error('v2.group-bake-blocked: keyframes / motion / animator を持つグループは ungroup できません。');
    }
    const children = ensureChildren(group).map(child => {
        const item = child;
        item.at = group.at + child.at;
        assignTransform(item, composeTransforms(group.transform, child.transform));
        if (group.opacity !== undefined)
            assignOpacity(item, group.opacity * (child.opacity ?? 1));
        return item;
    });
    location.items.splice(location.index, 1);
    if (location.parent) {
        location.items.splice(location.index, 0, ...children);
        return children;
    }
    let lastTrack = location.track;
    for (const child of children) {
        const baseItems = requireTrackItems(location.track);
        if (overlapsAny(child, baseItems))
            lastTrack = createTrackAbove(edit, lastTrack);
        else
            lastTrack = location.track;
        requireTrackItems(lastTrack).push(child);
    }
    return children;
}
async function distributeKeyframes(edit, loadMotion) {
    const visit = async (item, ancestors) => {
        if (Array.isArray(item.keyframes) && item.keyframes.length >= 9) {
            const groupId = ancestors.length > 0 ? ancestors[ancestors.length - 1].id : item.id;
            const path = `motion/${groupId}.json`;
            const state = await loadMotion(path, groupId);
            state.doc.group = groupId;
            state.doc.items[item.id] = clone(item.keyframes);
            item.keyframes = { path, count: item.keyframes.length };
        }
        else if (isRecord(item.keyframes)) {
            const path = requireMotionPath(String(item.keyframes.path));
            const groupId = path.slice('motion/'.length, -'.json'.length);
            const state = await loadMotion(path, groupId);
            const points = state.doc.items[item.id];
            if (Array.isArray(points))
                item.keyframes.count = points.length;
        }
        for (const child of ensureChildren(item, false))
            await visit(child, [...ancestors, item]);
    };
    for (const track of tracksOf(edit)) {
        if (!Array.isArray(track.items))
            continue;
        for (const item of track.items)
            await visit(item, []);
    }
}
function normalizeTracks(edit) {
    edit.tracks = edit.tracks.filter(track => !('items' in track) || !Array.isArray(track.items) || track.items.length > 0);
}
function buildCaptionsDocument(root, captions) {
    const originalRows = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions) ? root.captions : [];
    const byId = new Map(captions.rows.map(row => [row.id, row]));
    const used = new Set();
    const rows = originalRows.map(raw => {
        if (!isRecord(raw) || typeof raw.id !== 'string')
            return clone(raw);
        const row = byId.get(raw.id);
        if (!row)
            return clone(raw);
        used.add(row.id);
        return captionRecordToJson(row, raw);
    });
    for (const row of captions.rows)
        if (!used.has(row.id))
            rows.push(captionRecordToJson(row));
    if (Array.isArray(root) || root === undefined)
        return rows;
    const result = { ...root, captions: rows };
    if (captions.defaultTextStyle === undefined)
        delete result.default_text_style;
    else
        result.default_text_style = textStyleToJson(captions.defaultTextStyle);
    return result;
}
function captionRecordToJson(row, original = {}) {
    const result = {
        ...original,
        id: row.id,
        start: row.start,
        end: row.end,
        text: row.text,
        speaker: row.speaker,
        sourceRef: clone(row.sourceRef),
        edited: row.edited,
    };
    if (row.timeDomain === undefined)
        delete result.time_domain;
    else
        result.time_domain = row.timeDomain;
    if (row.textStyle === undefined)
        delete result.text_style;
    else
        result.text_style = textStyleToJson(row.textStyle);
    return result;
}
function textStyleToJson(style) {
    const rename = (value) => {
        if (Array.isArray(value))
            return value.map(rename);
        if (!isRecord(value))
            return value;
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [camelToSnake(key), rename(entry)]));
    };
    return rename(style);
}
const CAPTION_STYLE_NAMES = {
    sizePx: 'size_px', fontFamily: 'font_family', fontWeight: 'font_weight', letterSpacingEm: 'letter_spacing_em',
    lineHeight: 'line_height', verticalAlign: 'vertical_align', textTransform: 'text_transform',
    maxWidthPct: 'max_width_pct', textAnchor: 'text_anchor', widthPx: 'width_px', blurPx: 'blur_px',
    distancePx: 'distance_px', angleDeg: 'angle_deg', offsetX: 'offset_x', offsetY: 'offset_y',
    durationSec: 'duration_sec', radiusPx: 'radius_px', paddingPx: 'padding_px', widthPct: 'width_pct',
    heightPct: 'height_pct', referenceWidthPx: 'reference_width_px', referenceHeightPx: 'reference_height_px',
    leftPx: 'left_px', bottomPx: 'bottom_px', textAlign: 'text_align', maxLines: 'max_lines'
};
function camelToSnake(key) {
    return CAPTION_STYLE_NAMES[key] ?? key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}
function allLocations(edit) {
    const result = [];
    tracksOf(edit).forEach((track, trackIndex) => {
        if (!Array.isArray(track.items))
            return;
        const visit = (items, parent, ancestors) => {
            items.forEach((item, index) => {
                const location = { item, items, index, parent, ancestors, track, trackIndex };
                result.push(location);
                if (Array.isArray(item.items))
                    visit(item.items, item, [...ancestors, item]);
            });
        };
        visit(track.items, undefined, []);
    });
    const ids = new Set();
    for (const location of result) {
        if (ids.has(location.item.id))
            throw new Error(`item id が重複しています: ${location.item.id}`);
        ids.add(location.item.id);
    }
    return result;
}
function locate(edit, id) {
    return allLocations(edit).find(location => location.item.id === id);
}
function requireLocation(edit, id) {
    const location = locate(edit, id);
    if (!location)
        throw new Error(`item が見つかりません: ${id}`);
    return location;
}
function tracksOf(edit) {
    return edit.tracks;
}
function requireTrack(edit, id) {
    const track = tracksOf(edit).find(candidate => candidate.id === id);
    if (!track)
        throw new Error(`track が見つかりません: ${id}`);
    return track;
}
function requireTrackItems(track) {
    if (!Array.isArray(track.items))
        throw new Error(`item を置けない track です: ${String(track.id)}`);
    return track.items;
}
function ensureChildren(item, create = true) {
    if (Array.isArray(item.items))
        return item.items;
    if (!create)
        return [];
    item.items = [];
    return item.items;
}
function createTrackAbove(edit, track) {
    const tracks = tracksOf(edit);
    const index = tracks.indexOf(track);
    const created = { id: nextTrackId(edit, String(track.lane)), lane: track.lane, items: [] };
    tracks.splice(index + 1, 0, created);
    return created;
}
function nextTrackId(edit, lane) {
    const ids = new Set(tracksOf(edit).map(track => String(track.id)));
    const prefix = lane === 'audio' ? 'a' : 'v';
    let serial = 1;
    while (ids.has(`${prefix}${serial}`))
        serial++;
    return `${prefix}${serial}`;
}
function nextGroupId(edit) {
    const ids = new Set(allLocations(edit).map(location => location.item.id));
    let serial = 1;
    while (ids.has(`g-${serial}`))
        serial++;
    return `g-${serial}`;
}
function overlapsAny(item, items) {
    return items.some(other => item.at < other.at + other.duration && other.at < item.at + item.duration);
}
function insertionIndex(value, length) {
    const index = value ?? length;
    if (!Number.isInteger(index) || index < 0 || index > length)
        throw new Error('index が範囲外です。');
    return index;
}
function removeLocations(locations) {
    const containers = new Map();
    for (const location of locations) {
        const entries = containers.get(location.items) ?? [];
        entries.push(location);
        containers.set(location.items, entries);
    }
    for (const [items, entries] of containers) {
        for (const location of entries.sort((left, right) => right.index - left.index))
            items.splice(location.index, 1);
    }
}
function changedZOrderIds(edit, members, start, end) {
    const memberIds = new Set(members.map(location => location.item.id));
    const minTrack = Math.min(...members.map(location => location.trackIndex));
    const maxTrack = Math.max(...members.map(location => location.trackIndex));
    return allLocations(edit)
        .filter(location => location.parent === undefined
        && location.trackIndex >= minTrack && location.trackIndex <= maxTrack
        && !memberIds.has(location.item.id)
        && location.item.at < end && start < location.item.at + location.item.duration)
        .map(location => location.item.id);
}
function containsItem(item, id) {
    return ensureChildren(item, false).some(child => child.id === id || containsItem(child, id));
}
function absoluteAt(location) {
    return location.ancestors.reduce((sum, item) => sum + item.at, 0) + location.item.at;
}
function worldTransformOfAncestors(ancestors) {
    return ancestors.reduce((result, item) => composeTransforms(result, item.transform), undefined);
}
function opacityOfAncestors(ancestors) {
    return ancestors.reduce((result, item) => result * (item.opacity ?? 1), 1);
}
function composeTransforms(parent, child) {
    if (parent === undefined)
        return child === undefined ? undefined : { ...child };
    if (child === undefined)
        return { ...parent };
    const scale = parent.scale ?? 1;
    const radians = (parent.rotate ?? 0) * Math.PI / 180;
    const childX = child.x ?? 0;
    const childY = child.y ?? 0;
    const result = {};
    if (parent.x !== undefined || child.x !== undefined || child.y !== undefined) {
        result.x = (parent.x ?? 0) + scale * (childX * Math.cos(radians) - childY * Math.sin(radians));
    }
    if (parent.y !== undefined || child.x !== undefined || child.y !== undefined) {
        result.y = (parent.y ?? 0) + scale * (childX * Math.sin(radians) + childY * Math.cos(radians));
    }
    if (parent.scale !== undefined || child.scale !== undefined)
        result.scale = scale * (child.scale ?? 1);
    if (parent.rotate !== undefined || child.rotate !== undefined)
        result.rotate = (parent.rotate ?? 0) + (child.rotate ?? 0);
    return Object.keys(result).length === 0 ? undefined : result;
}
function relativeTransform(parent, world) {
    if (parent === undefined)
        return world === undefined ? undefined : { ...world };
    if (world === undefined)
        return undefined;
    const scale = parent.scale ?? 1;
    const radians = -(parent.rotate ?? 0) * Math.PI / 180;
    const dx = (world.x ?? 0) - (parent.x ?? 0);
    const dy = (world.y ?? 0) - (parent.y ?? 0);
    const result = {};
    if (world.x !== undefined || world.y !== undefined || parent.x !== undefined || parent.y !== undefined) {
        result.x = (dx * Math.cos(radians) - dy * Math.sin(radians)) / scale;
        result.y = (dx * Math.sin(radians) + dy * Math.cos(radians)) / scale;
    }
    if (world.scale !== undefined || parent.scale !== undefined)
        result.scale = (world.scale ?? 1) / scale;
    if (world.rotate !== undefined || parent.rotate !== undefined)
        result.rotate = (world.rotate ?? 0) - (parent.rotate ?? 0);
    return Object.keys(result).length === 0 ? undefined : result;
}
function assignTransform(item, transform) {
    if (transform === undefined)
        delete item.transform;
    else
        item.transform = transform;
}
function assignOpacity(item, opacity) {
    if (opacity === 1)
        delete item.opacity;
    else
        item.opacity = opacity;
}
function mergePatch(base, patch) {
    const result = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined)
            delete result[key];
        else
            result[key] = clone(value);
    }
    return result;
}
function snapshotCaptions(captions) {
    return stableJson({ rows: captions.rows, defaultTextStyle: captions.defaultTextStyle });
}
function stableJson(value) {
    return JSON.stringify(value);
}
function clone(value) {
    return structuredClone(value);
}
function requireMotionPath(value) {
    if (!/^motion\/[^/\\]+\.json$/u.test(value))
        throw new Error(`motion 袋のパスが不正です: ${value}`);
    return value;
}
function requireGroupId(value) {
    if (value.length === 0 || value.includes('/') || value.includes('\\'))
        throw new Error(`group id が不正です: ${value}`);
}
async function readOptional(path) {
    try {
        return await fs_1.promises.readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
