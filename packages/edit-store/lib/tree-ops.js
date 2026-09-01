"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CAPTION_TELOP_PRESET = void 0;
exports.attachEditHelpers = attachEditHelpers;
exports.updateItem = updateItem;
exports.setItemAnchor = setItemAnchor;
exports.clearItemAnchor = clearItemAnchor;
exports.refreshItemAnchors = refreshItemAnchors;
exports.setKeyframe = setKeyframe;
exports.removeKeyframe = removeKeyframe;
exports.moveKeyframe = moveKeyframe;
exports.setSegmentEasing = setSegmentEasing;
exports.hydrateKeyframes = hydrateKeyframes;
exports.moveItem = moveItem;
exports.insertItem = insertItem;
exports.removeItem = removeItem;
exports.detachItem = detachItem;
exports.materializeProjectedPart = materializeProjectedPart;
exports.convertCaptionToTelop = convertCaptionToTelop;
exports.collectExcludedCaptionIds = collectExcludedCaptionIds;
exports.filterCaptionRootByExcludedIds = filterCaptionRootByExcludedIds;
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
const item_anchor_1 = require("./item-anchor");
const SEGMENT_EASINGS = new Set([
    'linear', 'ease-in-out', 'in-quad', 'out-quad', 'in-out-quad',
    'in-cubic', 'out-cubic', 'in-out-cubic', 'in-quart', 'out-quart', 'in-out-quart',
    'in-expo', 'out-expo', 'in-out-expo', 'in-back', 'out-back', 'in-out-back',
    'out-bounce', 'out-elastic', 'hold'
]);
// 助詞ミニマは通常字幕に近く、ワードスナップほど演出を強くしないため変換の既定にする。
exports.DEFAULT_CAPTION_TELOP_PRESET = 'ref3_particle_min';
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
function setItemAnchor(edit, id, anchor, captions) {
    const item = requireLocation(edit, id).item;
    item.anchor = clone(anchor);
    const refreshed = (0, item_anchor_1.resolveItemAnchors)(edit, captions);
    for (const change of refreshed.changes) {
        const changedItem = requireLocation(edit, change.id).item;
        changedItem.at = change.after.at;
        changedItem.duration = change.after.duration;
    }
    return { edit, item, changes: refreshed.changes, warnings: refreshed.warnings };
}
function clearItemAnchor(edit, id) {
    const item = requireLocation(edit, id).item;
    delete item.anchor;
    return item;
}
function refreshItemAnchors(edit, captions) {
    return (0, item_anchor_1.resolveItemAnchors)(edit, captions);
}
/** inline 点列へ値を打つ。最初の点では反対側の端にも同じ値を置き minItems:2 を守る。 */
function setKeyframe(edit, id, property, t, value) {
    const item = requireLocation(edit, id).item;
    const time = requireKeyframeTime(t, item.duration);
    const points = editableKeyframes(item);
    if (points.length === 0) {
        const opposite = time === 0 ? item.duration : 0;
        points.push(pointWithValue(time, property, value), pointWithValue(opposite, property, value));
    }
    else {
        const point = points.find(candidate => candidate.t === time);
        if (point)
            assignKeyframeValue(point, property, value);
        else
            points.push(pointWithValue(time, property, value));
    }
    item.keyframes = normalizeKeyframes(points);
    return item;
}
/** 指定プロパティの点だけを消し、空点を除去する。2 点未満なら点列自体を外す。 */
function removeKeyframe(edit, id, property, t) {
    const item = requireLocation(edit, id).item;
    const points = editableKeyframes(item);
    const point = points.find(candidate => candidate.t === t);
    if (!point)
        return item;
    deleteKeyframeValue(point, property);
    const remaining = points.filter(hasKeyframeValue);
    if (remaining.length < 2)
        delete item.keyframes;
    else
        item.keyframes = normalizeKeyframes(remaining);
    return item;
}
/** 1 プロパティの点を別時刻へ移す。同時刻の既存点があれば値をマージする。 */
function moveKeyframe(edit, id, property, fromT, toT) {
    const item = requireLocation(edit, id).item;
    const targetTime = requireKeyframeTime(toT, item.duration);
    const points = editableKeyframes(item);
    const source = points.find(point => point.t === fromT);
    const value = source ? keyframeValue(source, property) : undefined;
    if (!source || value === undefined)
        throw new Error(`キーフレームが見つかりません: ${id} ${property} t=${fromT}`);
    const easing = source.easing;
    deleteKeyframeValue(source, property);
    let target = points.find(point => point.t === targetTime);
    if (!target) {
        target = { t: targetTime };
        points.push(target);
    }
    assignKeyframeValue(target, property, value);
    if (easing !== undefined && target.easing === undefined)
        target.easing = clone(easing);
    const remaining = points.filter(hasKeyframeValue);
    if (remaining.length < 2)
        throw new Error('キーフレームは 2 点以上必要です。');
    item.keyframes = normalizeKeyframes(remaining);
    return item;
}
/** easing は「その点へ入る区間」に置く。プロパティ別指定は object 形へ正規化する。 */
function setSegmentEasing(edit, id, property, toT, easing) {
    requireSegmentEasing(easing);
    const item = requireLocation(edit, id).item;
    const points = editableKeyframes(item);
    const index = points.findIndex(point => point.t === toT);
    if (index <= 0 || keyframeValue(points[index], property) === undefined) {
        throw new Error('イージングを設定する区間が見つかりません。');
    }
    const point = points[index];
    const declared = keyframeProperties(point);
    if (declared.length <= 1) {
        point.easing = easing;
    }
    else {
        const previous = typeof point.easing === 'string' ? point.easing : 'linear';
        const perProperty = isRecord(point.easing) ? clone(point.easing) : {};
        for (const declaredProperty of declared) {
            if (!(declaredProperty in perProperty))
                perProperty[declaredProperty] = previous;
        }
        perProperty[property] = easing;
        point.easing = perProperty;
    }
    item.keyframes = normalizeKeyframes(points);
    return item;
}
/** motion 袋を読んだ UI が参照形を inline へ戻すための純関数。 */
function hydrateKeyframes(edit, id, points) {
    if (points.length > 0 && points.length < 2)
        throw new Error('キーフレームは 2 点以上必要です。');
    const item = requireLocation(edit, id).item;
    item.keyframes = normalizeKeyframes(points.map(point => clone(point)));
    return item;
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
function detachItem(edit, id, target, projected) {
    const source = locate(edit, id) ?? materializeProjectedPart(edit, id, projected);
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
function materializeProjectedPart(edit, id, projected) {
    const separator = id.lastIndexOf('#');
    if (separator <= 0 || separator === id.length - 1) {
        throw new Error(`item が見つかりません: ${id}`);
    }
    const bagId = id.slice(0, separator);
    const part = id.slice(separator + 1);
    const bag = requireLocation(edit, bagId);
    if (bag.item.source.kind === 'captions') {
        const child = {
            id: `cap-${part}`,
            at: projected?.at ?? bag.item.at,
            duration: projected?.duration ?? bag.item.duration,
            source: { kind: 'caption', path: 'captions.json', id: part },
        };
        ensureChildren(bag.item).push(child);
        return requireLocation(edit, child.id);
    }
    if (bag.item.source.kind !== 'html')
        throw new Error(`袋ではありません: ${bagId}`);
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
/** captions.json は不変のまま、参照行を独立した未ベイク telop へ置き換える。 */
function convertCaptionToTelop(edit, id, options) {
    const projected = options.at !== undefined && options.duration !== undefined
        ? { at: options.at, duration: options.duration } : undefined;
    let location = locate(edit, id) ?? materializeProjectedPart(edit, id, projected);
    if (location.item.source.kind !== 'caption')
        throw new Error(`字幕行ではありません: ${id}`);
    const captionId = location.item.source.id;
    if (location.parent) {
        const detached = detachItem(edit, location.item.id, { track: 'above' }, projected);
        location = requireLocation(edit, detached.id);
    }
    location.item.source = {
        kind: 'telop',
        preset: options.preset ?? exports.DEFAULT_CAPTION_TELOP_PRESET,
        params: { text: options.text },
        from: `captions.json#${captionId}`,
    };
    return location.item;
}
/** tracks[].items[] / internal children のどちらからでも captions 袋の exclude を集める。 */
function collectExcludedCaptionIds(edit) {
    const result = new Set();
    const visit = (value) => {
        if (!isRecord(value))
            return;
        const source = value.source;
        if (isRecord(source) && source.kind === 'captions' && Array.isArray(source.exclude)) {
            for (const id of source.exclude)
                if (typeof id === 'string')
                    result.add(id);
        }
        for (const key of ['items', 'children']) {
            const children = value[key];
            if (Array.isArray(children))
                for (const child of children)
                    visit(child);
        }
    };
    if (isRecord(edit) && Array.isArray(edit.tracks)) {
        for (const track of edit.tracks) {
            if (!isRecord(track))
                continue;
            for (const key of ['items', 'children']) {
                const items = track[key];
                if (Array.isArray(items))
                    for (const item of items)
                        visit(item);
            }
        }
    }
    return result;
}
/** captions.json の array / object root を保ったまま除外行だけを落とす。 */
function filterCaptionRootByExcludedIds(root, excluded) {
    const filter = (captions) => captions.filter(caption => !isRecord(caption) || typeof caption.id !== 'string' || !excluded.has(caption.id));
    if (Array.isArray(root))
        return filter(root);
    if (isRecord(root) && Array.isArray(root.captions)) {
        return { ...root, captions: filter(root.captions) };
    }
    return root;
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
function editableKeyframes(item) {
    if (item.keyframes === undefined)
        return [];
    if (!Array.isArray(item.keyframes)) {
        throw new Error('motion 袋を inline に戻してからキーフレームを編集してください。');
    }
    return item.keyframes.map(point => clone(point));
}
function requireSegmentEasing(value) {
    const cubic = /^cubic-bezier\(\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*\)$/u;
    if (!SEGMENT_EASINGS.has(value) && !cubic.test(value))
        throw new Error(`未対応の easing です: ${value}`);
}
function requireKeyframeTime(t, duration) {
    if (!Number.isInteger(t) || t < 0 || t > duration) {
        throw new Error(`キーフレーム時刻は 0〜${duration} の整数フレームで指定してください。`);
    }
    return t;
}
function normalizeKeyframes(points) {
    const result = points.map(point => clone(point)).sort((left, right) => left.t - right.t);
    for (let index = 1; index < result.length; index++) {
        if (result[index - 1].t === result[index].t)
            throw new Error('同じ時刻にキーフレームを重ねられません。');
    }
    return result;
}
function pointWithValue(t, property, value) {
    const point = { t };
    assignKeyframeValue(point, property, value);
    return point;
}
function assignKeyframeValue(point, property, value) {
    if (property.startsWith('transform.')) {
        const key = property.slice('transform.'.length);
        point.transform = { ...(point.transform ?? {}), [key]: clone(value) };
    }
    else {
        point[property] = clone(value);
    }
}
function deleteKeyframeValue(point, property) {
    if (property.startsWith('transform.')) {
        const key = property.slice('transform.'.length);
        if (point.transform) {
            delete point.transform[key];
            if (Object.keys(point.transform).length === 0)
                delete point.transform;
        }
    }
    else {
        delete point[property];
    }
    if (isRecord(point.easing)) {
        delete point.easing[property];
        if (Object.keys(point.easing).length === 0)
            delete point.easing;
    }
}
function keyframeValue(point, property) {
    if (!property.startsWith('transform.'))
        return point[property];
    return point.transform?.[property.slice('transform.'.length)];
}
function keyframeProperties(point) {
    const result = [];
    for (const property of ['transform.x', 'transform.y', 'transform.scale', 'transform.rotate']) {
        if (keyframeValue(point, property) !== undefined)
            result.push(property);
    }
    for (const property of ['opacity', 'crop', 'perspective']) {
        if (keyframeValue(point, property) !== undefined)
            result.push(property);
    }
    return result;
}
function hasKeyframeValue(point) {
    return keyframeProperties(point).length > 0 || point.animator !== undefined;
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
    if (source.kind === 'caption')
        return source.id;
    if ('part' in source && typeof source.part === 'string')
        return source.part;
    const hash = itemId.lastIndexOf('#');
    return hash >= 0 ? itemId.slice(hash + 1) : itemId;
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
