"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachEditHelpers = attachEditHelpers;
exports.updateItem = updateItem;
exports.moveItem = moveItem;
exports.insertItem = insertItem;
exports.removeItem = removeItem;
exports.detachItem = detachItem;
exports.materializeProjectedPart = materializeProjectedPart;
exports.groupItems = groupItems;
exports.ungroupItem = ungroupItem;
exports.normalizeTracks = normalizeTracks;
exports.allLocations = allLocations;
exports.locate = locate;
exports.createTrackAbove = createTrackAbove;
exports.createTrackAt = createTrackAt;
exports.nextTrackId = nextTrackId;
exports.nextGroupId = nextGroupId;
exports.overlapsAny = overlapsAny;
exports.changedZOrderIds = changedZOrderIds;
exports.absoluteAt = absoluteAt;
exports.worldTransformOfAncestors = worldTransformOfAncestors;
exports.opacityOfAncestors = opacityOfAncestors;
exports.composeTransforms = composeTransforms;
exports.relativeTransform = relativeTransform;
exports.ensureChildren = ensureChildren;
exports.clone = clone;
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
    const source = locate(edit, id) ?? materializeProjectedPart(edit, id);
    if (!source.parent)
        throw new Error(`段直下の item は detach できません: ${id}`);
    const worldAt = absoluteAt(source);
    const worldTransform = composeTransforms(worldTransformOfAncestors(source.ancestors), source.item.transform);
    const worldOpacity = opacityOfAncestors(source.ancestors) * (source.item.opacity ?? 1);
    if (source.parent.source.kind === 'html' || source.parent.source.kind === 'captions') {
        const excluded = source.parent.source.exclude ?? [];
        const partId = partIdOf(source.item.id, source.item.source);
        if (!excluded.includes(partId))
            source.parent.source.exclude = [...excluded, partId];
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
/** 袋 projection の写しを、木操作の直前にだけ明示子へ昇格する。 */
function materializeProjectedPart(edit, id) {
    const separator = id.lastIndexOf('#');
    if (separator <= 0 || separator === id.length - 1) {
        throw new Error(`item が見つかりません: ${id}`);
    }
    const bagId = id.slice(0, separator);
    const part = id.slice(separator + 1);
    const bag = requireLocation(edit, bagId);
    if (bag.item.source.kind !== 'html')
        throw new Error(`HTML 袋ではありません: ${bagId}`);
    const source = { ...bag.item.source, part };
    delete source.exclude;
    const child = {
        id,
        at: 0,
        duration: bag.item.duration,
        source,
    };
    ensureChildren(bag.item).push(child);
    return requireLocation(edit, id);
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
function normalizeTracks(edit) {
    edit.tracks = edit.tracks.filter(track => !('items' in track) || !Array.isArray(track.items) || track.items.length > 0);
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
function createTrackAbove(edit, track) {
    const current = typeof track === 'string' ? requireTrack(edit, track) : track;
    const tracks = tracksOf(edit);
    const index = tracks.indexOf(current);
    const created = { id: nextTrackId(edit, String(current.lane)), lane: current.lane, items: [] };
    tracks.splice(index + 1, 0, created);
    return created;
}
/** 既存の段外 D&D 用。段の生成自体を shell へ漏らさない。 */
function createTrackAt(edit, lane, index) {
    const tracks = tracksOf(edit);
    if (!Number.isInteger(index) || index < 0 || index > tracks.length)
        throw new Error('track index が範囲外です。');
    const created = { id: nextTrackId(edit, lane), lane, items: [] };
    tracks.splice(index, 0, created);
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
function ensureChildren(item, create = true) {
    if (Array.isArray(item.items))
        return item.items;
    if (!create)
        return [];
    item.items = [];
    return item.items;
}
function clone(value) {
    return structuredClone(value);
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
function containsItem(item, id) {
    return ensureChildren(item, false).some(child => child.id === id || containsItem(child, id));
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
function partIdOf(itemId, source) {
    if ('part' in source && typeof source.part === 'string')
        return source.part;
    const hash = itemId.lastIndexOf('#');
    return hash >= 0 ? itemId.slice(hash + 1) : itemId;
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
