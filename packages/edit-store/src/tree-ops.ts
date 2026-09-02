import type { EditV2, ItemV2, KeyframeV2, TrackV2, TransformV2 } from './edit-v2';
import {
    type AnchorCaption,
    type ItemAnchorV2,
    type ItemAnchorChange,
    type ItemAnchorWarning,
    resolveItemAnchors
} from './item-anchor';

export type JsonRecord = Record<string, unknown>;
export type ProjectItemV2 = Omit<ItemV2, 'items' | 'keyframes'> & {
    items?: ProjectItemV2[];
    keyframes?: KeyframeV2[] | { path: string; count: number };
};
export type ProjectTrackV2 = Omit<TrackV2, 'items'> & { items?: ProjectItemV2[] };
export type MutableItem = ProjectItemV2 & JsonRecord;
export type MutableTrack = ProjectTrackV2 & JsonRecord;

export interface MoveTarget {
    track?: string;
    parent?: string;
    index?: number;
}

export interface GroupResult {
    group: ProjectItemV2;
    changedOrderIds: string[];
}

export interface ProjectedItemTiming {
    at: number;
    duration: number;
}

export type KeyframeProperty =
    | 'transform.x' | 'transform.y' | 'transform.scale' | 'transform.rotate'
    | 'opacity' | 'crop' | 'perspective';

export type SegmentEasing = string;

const SEGMENT_EASINGS = new Set([
    'linear', 'ease-in-out', 'in-quad', 'out-quad', 'in-out-quad',
    'in-cubic', 'out-cubic', 'in-out-cubic', 'in-quart', 'out-quart', 'in-out-quart',
    'in-expo', 'out-expo', 'in-out-expo', 'in-back', 'out-back', 'in-out-back',
    'out-bounce', 'out-elastic', 'hold'
]);

export interface ConvertCaptionToTelopOptions {
    preset?: string;
    text: string;
    at?: number;
    duration?: number;
}

// 助詞ミニマは通常字幕に近く、ワードスナップほど演出を強くしないため変換の既定にする。
export const DEFAULT_CAPTION_TELOP_PRESET = 'ref3_particle_min';

export type EditableEditV2 = Omit<EditV2, 'tracks'> & {
    tracks: ProjectTrackV2[];
    find(id: string): ProjectItemV2 | undefined;
    walk(fn: (item: ProjectItemV2, parent: ProjectItemV2 | undefined, track: ProjectTrackV2) => void): void;
    parentOf(id: string): ProjectItemV2 | undefined;
    update(id: string, patch: Partial<ProjectItemV2> & JsonRecord): ProjectItemV2;
    move(id: string, target: MoveTarget): ProjectItemV2;
    insert(target: string, item: ProjectItemV2, index?: number): ProjectItemV2;
    remove(id: string): ProjectItemV2;
    detach(id: string, target: { track: 'above' | string }): ProjectItemV2;
    group(ids: string[], options?: { name?: string }): GroupResult;
    ungroup(id: string): ProjectItemV2[];
};

export interface ItemLocation {
    item: MutableItem;
    items: MutableItem[];
    index: number;
    parent?: MutableItem;
    ancestors: MutableItem[];
    track: MutableTrack;
    trackIndex: number;
}

export function attachEditHelpers(edit: EditableEditV2): void {
    Object.defineProperties(edit, {
        find: { enumerable: false, value: (id: string) => locate(edit, id)?.item },
        walk: { enumerable: false, value: (fn: (item: ProjectItemV2, parent: ProjectItemV2 | undefined, track: ProjectTrackV2) => void) => {
            for (const location of allLocations(edit)) fn(location.item, location.parent, location.track);
        } },
        parentOf: { enumerable: false, value: (id: string) => locate(edit, id)?.parent },
        update: { enumerable: false, value: (id: string, patch: JsonRecord) => updateItem(edit, id, patch) },
        move: { enumerable: false, value: (id: string, target: MoveTarget) => moveItem(edit, id, target) },
        insert: { enumerable: false, value: (target: string, item: ItemV2, index?: number) =>
            insertItem(edit, target, item as MutableItem, index) },
        remove: { enumerable: false, value: (id: string) => removeItem(edit, id) },
        detach: { enumerable: false, value: (id: string, target: { track: 'above' | string }) =>
            detachItem(edit, id, target) },
        group: { enumerable: false, value: (ids: string[], options?: { name?: string }) =>
            groupItems(edit, ids, options) },
        ungroup: { enumerable: false, value: (id: string) => ungroupItem(edit, id) },
    });
}

export function updateItem(edit: EditableEditV2, id: string, patch: JsonRecord): ProjectItemV2 {
    const location = requireLocation(edit, id);
    for (const [key, value] of Object.entries(patch)) {
        if (key === 'source' && isRecord(value) && isRecord(location.item.source)) {
            location.item.source = mergePatch(location.item.source as unknown as JsonRecord, value) as unknown as ItemV2['source'];
        } else if (value === null || value === undefined) {
            delete location.item[key];
        } else {
            location.item[key] = clone(value);
        }
    }
    return location.item;
}

export function setItemAnchor(
    edit: EditableEditV2,
    id: string,
    anchor: ItemAnchorV2,
    captions: readonly AnchorCaption[]
): { edit: EditableEditV2; item: ProjectItemV2; changes: ItemAnchorChange[]; warnings: ItemAnchorWarning[] } {
    const item = requireLocation(edit, id).item;
    item.anchor = clone(anchor);
    const refreshed = resolveItemAnchors(edit as unknown as EditV2, captions);
    for (const change of refreshed.changes) {
        const changedItem = requireLocation(edit, change.id).item;
        changedItem.at = change.after.at;
        changedItem.duration = change.after.duration;
    }
    return { edit, item, changes: refreshed.changes, warnings: refreshed.warnings };
}

export function clearItemAnchor(edit: EditableEditV2, id: string): ProjectItemV2 {
    const item = requireLocation(edit, id).item;
    delete item.anchor;
    return item;
}

export function refreshItemAnchors(
    edit: EditableEditV2,
    captions: readonly AnchorCaption[]
): { edit: EditableEditV2; changes: ItemAnchorChange[]; warnings: ItemAnchorWarning[] } {
    return resolveItemAnchors(edit as unknown as EditV2, captions) as {
        edit: EditableEditV2;
        changes: ItemAnchorChange[];
        warnings: ItemAnchorWarning[];
    };
}

/** inline 点列へ値を打つ。最初の点では反対側の端にも同じ値を置き minItems:2 を守る。 */
export function setKeyframe(
    edit: EditableEditV2,
    id: string,
    property: KeyframeProperty,
    t: number,
    value: unknown
): ProjectItemV2 {
    const item = requireLocation(edit, id).item;
    const time = requireKeyframeTime(t, item.duration);
    const points = editableKeyframes(item);
    if (points.length === 0) {
        const opposite = time === 0 ? item.duration : 0;
        points.push(pointWithValue(time, property, value), pointWithValue(opposite, property, value));
    } else {
        const point = points.find(candidate => candidate.t === time);
        if (point) assignKeyframeValue(point, property, value);
        else points.push(pointWithValue(time, property, value));
    }
    item.keyframes = normalizeKeyframes(points);
    return item;
}

/** 指定プロパティの点だけを消し、空点を除去する。2 点未満なら点列自体を外す。 */
export function removeKeyframe(
    edit: EditableEditV2,
    id: string,
    property: KeyframeProperty,
    t: number
): ProjectItemV2 {
    const item = requireLocation(edit, id).item;
    const points = editableKeyframes(item);
    const point = points.find(candidate => candidate.t === t);
    if (!point) return item;
    deleteKeyframeValue(point, property);
    const remaining = points.filter(hasKeyframeValue);
    if (remaining.length < 2) delete item.keyframes;
    else item.keyframes = normalizeKeyframes(remaining);
    return item;
}

/** 1 プロパティの点を別時刻へ移す。同時刻の既存点があれば値をマージする。 */
export function moveKeyframe(
    edit: EditableEditV2,
    id: string,
    property: KeyframeProperty,
    fromT: number,
    toT: number
): ProjectItemV2 {
    const item = requireLocation(edit, id).item;
    const targetTime = requireKeyframeTime(toT, item.duration);
    const points = editableKeyframes(item);
    const source = points.find(point => point.t === fromT);
    const value = source ? keyframeValue(source, property) : undefined;
    if (!source || value === undefined) throw new Error(`キーフレームが見つかりません: ${id} ${property} t=${fromT}`);
    const easing = source.easing;
    deleteKeyframeValue(source, property);
    let target = points.find(point => point.t === targetTime);
    if (!target) {
        target = { t: targetTime };
        points.push(target);
    }
    assignKeyframeValue(target, property, value);
    if (easing !== undefined && target.easing === undefined) target.easing = clone(easing);
    const remaining = points.filter(hasKeyframeValue);
    if (remaining.length < 2) throw new Error('キーフレームは 2 点以上必要です。');
    item.keyframes = normalizeKeyframes(remaining);
    return item;
}

/** easing は「その点へ入る区間」に置く。プロパティ別指定は object 形へ正規化する。 */
export function setSegmentEasing(
    edit: EditableEditV2,
    id: string,
    property: KeyframeProperty,
    toT: number,
    easing: SegmentEasing
): ProjectItemV2 {
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
    } else {
        const previous = typeof point.easing === 'string' ? point.easing : 'linear';
        const perProperty = isRecord(point.easing) ? clone(point.easing) : {};
        for (const declaredProperty of declared) {
            if (!(declaredProperty in perProperty)) perProperty[declaredProperty] = previous;
        }
        perProperty[property] = easing;
        point.easing = perProperty as Record<string, string>;
    }
    item.keyframes = normalizeKeyframes(points);
    return item;
}

/** motion 袋を読んだ UI が参照形を inline へ戻すための純関数。 */
export function hydrateKeyframes(
    edit: EditableEditV2,
    id: string,
    points: readonly KeyframeV2[]
): ProjectItemV2 {
    if (points.length > 0 && points.length < 2) throw new Error('キーフレームは 2 点以上必要です。');
    const item = requireLocation(edit, id).item;
    item.keyframes = normalizeKeyframes(points.map(point => clone(point)));
    return item;
}

export function moveItem(edit: EditableEditV2, id: string, target: MoveTarget): ProjectItemV2 {
    if ((target.track === undefined) === (target.parent === undefined)) {
        throw new Error('move の置き先は track または parent のどちらか一方で指定してください。');
    }
    const source = requireLocation(edit, id);
    let destinationItems: MutableItem[];
    let destinationTrack = source.track;
    if (target.parent !== undefined) {
        const parent = requireLocation(edit, target.parent).item;
        if (parent.id === id || containsItem(source.item, parent.id)) throw new Error('自分自身の子へ move できません。');
        destinationItems = ensureChildren(parent);
    } else {
        destinationTrack = requireTrack(edit, target.track as string);
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

export function insertItem(edit: EditableEditV2, target: string, item: MutableItem, index?: number): ProjectItemV2 {
    if (locate(edit, item.id)) throw new Error(`item id が重複しています: ${item.id}`);
    const cloned = clone(item);
    const track = tracksOf(edit).find(candidate => candidate.id === target);
    if (track) {
        let destination = requireTrackItems(track);
        if (overlapsAny(cloned, destination)) destination = requireTrackItems(createTrackAbove(edit, track));
        destination.splice(insertionIndex(index, destination.length), 0, cloned);
        return cloned;
    }
    const parent = requireLocation(edit, target).item;
    const children = ensureChildren(parent);
    children.splice(insertionIndex(index, children.length), 0, cloned);
    return cloned;
}

export function removeItem(edit: EditableEditV2, id: string): ProjectItemV2 {
    const location = requireLocation(edit, id);
    location.items.splice(location.index, 1);
    return location.item;
}

export function detachItem(
    edit: EditableEditV2,
    id: string,
    target: { track: 'above' | string },
    projected?: ProjectedItemTiming
): ProjectItemV2 {
    const source = locate(edit, id) ?? materializeProjectedPart(edit, id, projected);
    if (!source.parent) throw new Error(`段直下の item は detach できません: ${id}`);
    const worldAt = absoluteAt(source);
    const worldTransform = composeTransforms(worldTransformOfAncestors(source.ancestors), source.item.transform);
    const worldOpacity = opacityOfAncestors(source.ancestors) * (source.item.opacity ?? 1);
    if (source.parent.source.kind === 'html' || source.parent.source.kind === 'captions') {
        const excluded = source.parent.source.exclude ?? [];
        const partId = partIdOf(source.item.id, source.item.source);
        if (!excluded.includes(partId)) source.parent.source.exclude = [...excluded, partId];
    }
    source.items.splice(source.index, 1);

    const targetGroup = target.track === 'above' ? undefined : locate(edit, target.track);
    if (targetGroup) {
        const parentWorldTransform = composeTransforms(
            worldTransformOfAncestors(targetGroup.ancestors), targetGroup.item.transform
        );
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
    let destination: MutableTrack;
    if (target.track === 'above') {
        destination = createTrackAbove(edit, source.track);
    } else {
        destination = requireTrack(edit, target.track);
        if (overlapsAny(source.item, requireTrackItems(destination))) destination = createTrackAbove(edit, destination);
    }
    requireTrackItems(destination).push(source.item);
    return source.item;
}

/** 袋 projection の写しを、木操作の直前にだけ明示子へ昇格する。 */
export function materializeProjectedPart(
    edit: EditableEditV2,
    id: string,
    projected?: ProjectedItemTiming
): ItemLocation {
    const separator = id.lastIndexOf('#');
    if (separator <= 0 || separator === id.length - 1) {
        throw new Error(`item が見つかりません: ${id}`);
    }
    const bagId = id.slice(0, separator);
    const part = id.slice(separator + 1);
    const bag = requireLocation(edit, bagId);
    if (bag.item.source.kind === 'captions') {
        const child: MutableItem = {
            id: `cap-${part}`,
            at: projected?.at ?? bag.item.at,
            duration: projected?.duration ?? bag.item.duration,
            source: { kind: 'caption', path: 'captions.json', id: part },
        } as MutableItem;
        ensureChildren(bag.item).push(child);
        return requireLocation(edit, child.id);
    }
    if (bag.item.source.kind !== 'html') throw new Error(`袋ではありません: ${bagId}`);
    const source = { ...bag.item.source, part } as MutableItem['source'] & JsonRecord;
    delete source.exclude;
    const child: MutableItem = {
        id,
        at: 0,
        duration: bag.item.duration,
        source,
    } as MutableItem;
    ensureChildren(bag.item).push(child);
    return requireLocation(edit, id);
}

/** captions.json は不変のまま、参照行を独立した未ベイク telop へ置き換える。 */
export function convertCaptionToTelop(
    edit: EditableEditV2,
    id: string,
    options: ConvertCaptionToTelopOptions
): ProjectItemV2 {
    const projected = options.at !== undefined && options.duration !== undefined
        ? { at: options.at, duration: options.duration } : undefined;
    let location = locate(edit, id) ?? materializeProjectedPart(edit, id, projected);
    if (location.item.source.kind !== 'caption') throw new Error(`字幕行ではありません: ${id}`);
    const captionId = location.item.source.id;
    if (location.parent) {
        const detached = detachItem(edit, location.item.id, { track: 'above' }, projected);
        location = requireLocation(edit, detached.id);
    }
    location.item.source = {
        kind: 'telop',
        preset: options.preset ?? DEFAULT_CAPTION_TELOP_PRESET,
        params: { text: options.text },
        from: `captions.json#${captionId}`,
    };
    return location.item;
}

/** tracks[].items[] / internal children のどちらからでも captions 袋の exclude を集める。 */
export function collectExcludedCaptionIds(edit: unknown): Set<string> {
    const result = new Set<string>();
    const visit = (value: unknown): void => {
        if (!isRecord(value)) return;
        const source = value.source;
        if (isRecord(source) && source.kind === 'captions' && Array.isArray(source.exclude)) {
            for (const id of source.exclude) if (typeof id === 'string') result.add(id);
        }
        for (const key of ['items', 'children'] as const) {
            const children = value[key];
            if (Array.isArray(children)) for (const child of children) visit(child);
        }
    };
    if (isRecord(edit) && Array.isArray(edit.tracks)) {
        for (const track of edit.tracks) {
            if (!isRecord(track)) continue;
            for (const key of ['items', 'children'] as const) {
                const items = track[key];
                if (Array.isArray(items)) for (const item of items) visit(item);
            }
        }
    }
    return result;
}

/** captions.json の array / object root を保ったまま除外行だけを落とす。 */
export function filterCaptionRootByExcludedIds<T>(root: T, excluded: ReadonlySet<string>): T {
    const filter = (captions: unknown[]): unknown[] => captions.filter(caption =>
        !isRecord(caption) || typeof caption.id !== 'string' || !excluded.has(caption.id));
    if (Array.isArray(root)) return filter(root) as T;
    if (isRecord(root) && Array.isArray(root.captions)) {
        return { ...root, captions: filter(root.captions) } as T;
    }
    return root;
}

export function groupItems(edit: EditableEditV2, ids: string[], options: { name?: string } = {}): GroupResult {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length < 2 || uniqueIds.length !== ids.length) {
        throw new Error('group は重複しない 2 個以上の id を必要とします。');
    }
    const locations = uniqueIds.map(id => requireLocation(edit, id));
    const parentIds = new Set(locations.map(location => location.parent?.id));
    if (parentIds.size !== 1) throw new Error('group は同じ場所にある item だけをまとめられます。');
    const inParent = locations[0].parent !== undefined;
    if (inParent && new Set(locations.map(location => location.items)).size !== 1) {
        throw new Error('group は同じグループ内の item だけをまとめられます。');
    }

    const ordered = [...locations].sort((left, right) =>
        left.trackIndex - right.trackIndex || left.index - right.index);
    const minimumAt = Math.min(...ordered.map(location => location.item.at));
    const maximumEnd = Math.max(...ordered.map(location => location.item.at + location.item.duration));
    const group: MutableItem = {
        id: nextGroupId(edit),
        ...(options.name === undefined ? {} : { name: options.name }),
        at: minimumAt,
        duration: maximumEnd - minimumAt,
        source: { kind: 'group' },
        items: ordered.map(location => ({ ...location.item, at: location.item.at - minimumAt }))
    } as MutableItem;
    const changedOrderIds = inParent ? [] : changedZOrderIds(edit, ordered, minimumAt, maximumEnd);
    removeLocations(ordered);

    if (inParent) {
        const items = locations[0].items;
        items.splice(Math.min(...locations.map(location => location.index)), 0, group);
    } else {
        const target = ordered.reduce((front, location) =>
            location.trackIndex > front.trackIndex ? location : front);
        let targetTrack = target.track;
        const targetItems = requireTrackItems(targetTrack);
        if (overlapsAny(group, targetItems)) targetTrack = createTrackAbove(edit, targetTrack);
        requireTrackItems(targetTrack).push(group);
    }
    return { group, changedOrderIds };
}

export function ungroupItem(edit: EditableEditV2, id: string): ProjectItemV2[] {
    const location = requireLocation(edit, id);
    const group = location.item;
    if (group.source.kind === 'html' || group.source.kind === 'captions') {
        throw new Error('袋グループは ungroup できません。');
    }
    if (group.source.kind !== 'group') throw new Error(`純グループではありません: ${id}`);
    if (group.keyframes !== undefined || group.motion !== undefined || group.animator !== undefined) {
        throw new Error('v2.group-bake-blocked: keyframes / motion / animator を持つグループは ungroup できません。');
    }
    const children = ensureChildren(group).map(child => {
        const item = child;
        item.at = group.at + child.at;
        assignTransform(item, composeTransforms(group.transform, child.transform));
        if (group.opacity !== undefined) assignOpacity(item, group.opacity * (child.opacity ?? 1));
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
        if (overlapsAny(child, baseItems)) lastTrack = createTrackAbove(edit, lastTrack);
        else lastTrack = location.track;
        requireTrackItems(lastTrack).push(child);
    }
    return children;
}

export function normalizeTracks(edit: EditableEditV2): void {
    edit.tracks = edit.tracks.filter(track => !('items' in track) || !Array.isArray(track.items) || track.items.length > 0);
}

export function allLocations(edit: EditableEditV2): ItemLocation[] {
    const result: ItemLocation[] = [];
    tracksOf(edit).forEach((track, trackIndex) => {
        if (!Array.isArray(track.items)) return;
        const visit = (items: MutableItem[], parent: MutableItem | undefined, ancestors: MutableItem[]) => {
            items.forEach((item, index) => {
                const location = { item, items, index, parent, ancestors, track, trackIndex };
                result.push(location);
                if (Array.isArray(item.items)) visit(item.items as MutableItem[], item, [...ancestors, item]);
            });
        };
        visit(track.items as MutableItem[], undefined, []);
    });
    const ids = new Set<string>();
    for (const location of result) {
        if (ids.has(location.item.id)) throw new Error(`item id が重複しています: ${location.item.id}`);
        ids.add(location.item.id);
    }
    return result;
}

export function locate(edit: EditableEditV2, id: string): ItemLocation | undefined {
    return allLocations(edit).find(location => location.item.id === id);
}

export function createTrackAbove(edit: EditableEditV2, track: MutableTrack | string): MutableTrack {
    const current = typeof track === 'string' ? requireTrack(edit, track) : track;
    const tracks = tracksOf(edit);
    const index = tracks.indexOf(current);
    const created = { id: nextTrackId(edit, String(current.lane)), lane: current.lane, items: [] } as unknown as MutableTrack;
    tracks.splice(index + 1, 0, created);
    return created;
}

/** 既存の段外 D&D 用。段の生成自体を shell へ漏らさない。 */
export function createTrackAt(edit: EditableEditV2, lane: string, index: number): MutableTrack {
    const tracks = tracksOf(edit);
    if (!Number.isInteger(index) || index < 0 || index > tracks.length) throw new Error('track index が範囲外です。');
    const created = { id: nextTrackId(edit, lane), lane, items: [] } as unknown as MutableTrack;
    tracks.splice(index, 0, created);
    return created;
}

export function nextTrackId(edit: EditableEditV2, lane: string): string {
    const ids = new Set(tracksOf(edit).map(track => String(track.id)));
    const prefix = lane === 'audio' ? 'a' : 'v';
    let serial = 1;
    while (ids.has(`${prefix}${serial}`)) serial++;
    return `${prefix}${serial}`;
}

export function nextGroupId(edit: EditableEditV2): string {
    const ids = new Set(allLocations(edit).map(location => location.item.id));
    let serial = 1;
    while (ids.has(`g-${serial}`)) serial++;
    return `g-${serial}`;
}

export function overlapsAny(item: MutableItem, items: MutableItem[]): boolean {
    return items.some(other => item.at < other.at + other.duration && other.at < item.at + item.duration);
}

export function changedZOrderIds(
    edit: EditableEditV2,
    members: ItemLocation[],
    start: number,
    end: number
): string[] {
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

export function absoluteAt(location: ItemLocation): number {
    return location.ancestors.reduce((sum, item) => sum + item.at, 0) + location.item.at;
}

export function worldTransformOfAncestors(ancestors: MutableItem[]): TransformV2 | undefined {
    return ancestors.reduce<TransformV2 | undefined>((result, item) => composeTransforms(result, item.transform), undefined);
}

export function opacityOfAncestors(ancestors: MutableItem[]): number {
    return ancestors.reduce((result, item) => result * (item.opacity ?? 1), 1);
}

export function composeTransforms(parent?: TransformV2, child?: TransformV2): TransformV2 | undefined {
    if (parent === undefined) return child === undefined ? undefined : { ...child };
    if (child === undefined) return { ...parent };
    const scale = parent.scale ?? 1;
    const radians = (parent.rotate ?? 0) * Math.PI / 180;
    const childX = child.x ?? 0;
    const childY = child.y ?? 0;
    const result: TransformV2 = {};
    if (parent.x !== undefined || child.x !== undefined || child.y !== undefined) {
        result.x = (parent.x ?? 0) + scale * (childX * Math.cos(radians) - childY * Math.sin(radians));
    }
    if (parent.y !== undefined || child.x !== undefined || child.y !== undefined) {
        result.y = (parent.y ?? 0) + scale * (childX * Math.sin(radians) + childY * Math.cos(radians));
    }
    if (parent.scale !== undefined || child.scale !== undefined) result.scale = scale * (child.scale ?? 1);
    if (parent.rotate !== undefined || child.rotate !== undefined) result.rotate = (parent.rotate ?? 0) + (child.rotate ?? 0);
    return Object.keys(result).length === 0 ? undefined : result;
}

export function relativeTransform(parent: TransformV2 | undefined, world: TransformV2 | undefined): TransformV2 | undefined {
    if (parent === undefined) return world === undefined ? undefined : { ...world };
    if (world === undefined) return undefined;
    const scale = parent.scale ?? 1;
    const radians = -(parent.rotate ?? 0) * Math.PI / 180;
    const dx = (world.x ?? 0) - (parent.x ?? 0);
    const dy = (world.y ?? 0) - (parent.y ?? 0);
    const result: TransformV2 = {};
    if (world.x !== undefined || world.y !== undefined || parent.x !== undefined || parent.y !== undefined) {
        result.x = (dx * Math.cos(radians) - dy * Math.sin(radians)) / scale;
        result.y = (dx * Math.sin(radians) + dy * Math.cos(radians)) / scale;
    }
    if (world.scale !== undefined || parent.scale !== undefined) result.scale = (world.scale ?? 1) / scale;
    if (world.rotate !== undefined || parent.rotate !== undefined) result.rotate = (world.rotate ?? 0) - (parent.rotate ?? 0);
    return Object.keys(result).length === 0 ? undefined : result;
}

export function ensureChildren(item: MutableItem, create = true): MutableItem[] {
    if (Array.isArray(item.items)) return item.items as MutableItem[];
    if (!create) return [];
    item.items = [];
    return item.items as MutableItem[];
}

export function clone<T>(value: T): T {
    return structuredClone(value);
}

function editableKeyframes(item: MutableItem): KeyframeV2[] {
    if (item.keyframes === undefined) return [];
    if (!Array.isArray(item.keyframes)) {
        throw new Error('motion 袋を inline に戻してからキーフレームを編集してください。');
    }
    return item.keyframes.map(point => clone(point));
}

function requireSegmentEasing(value: string): void {
    const cubic = /^cubic-bezier\(\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*\)$/u;
    if (!SEGMENT_EASINGS.has(value) && !cubic.test(value)) throw new Error(`未対応の easing です: ${value}`);
}

function requireKeyframeTime(t: number, duration: number): number {
    if (!Number.isInteger(t) || t < 0 || t > duration) {
        throw new Error(`キーフレーム時刻は 0〜${duration} の整数フレームで指定してください。`);
    }
    return t;
}

function normalizeKeyframes(points: readonly KeyframeV2[]): KeyframeV2[] {
    const result = points.map(point => clone(point)).sort((left, right) => left.t - right.t);
    for (let index = 1; index < result.length; index++) {
        if (result[index - 1].t === result[index].t) throw new Error('同じ時刻にキーフレームを重ねられません。');
    }
    return result;
}

function pointWithValue(t: number, property: KeyframeProperty, value: unknown): KeyframeV2 {
    const point: KeyframeV2 = { t };
    assignKeyframeValue(point, property, value);
    return point;
}

function assignKeyframeValue(point: KeyframeV2, property: KeyframeProperty, value: unknown): void {
    if (property.startsWith('transform.')) {
        const key = property.slice('transform.'.length) as keyof TransformV2;
        point.transform = { ...(point.transform ?? {}), [key]: clone(value) } as TransformV2;
    } else {
        (point as JsonRecord)[property] = clone(value);
    }
}

function deleteKeyframeValue(point: KeyframeV2, property: KeyframeProperty): void {
    if (property.startsWith('transform.')) {
        const key = property.slice('transform.'.length);
        if (point.transform) {
            delete (point.transform as JsonRecord)[key];
            if (Object.keys(point.transform).length === 0) delete point.transform;
        }
    } else {
        delete point[property];
    }
    if (isRecord(point.easing)) {
        delete point.easing[property];
        if (Object.keys(point.easing).length === 0) delete point.easing;
    }
}

function keyframeValue(point: KeyframeV2, property: KeyframeProperty): unknown {
    if (!property.startsWith('transform.')) return point[property];
    return point.transform?.[property.slice('transform.'.length) as keyof TransformV2];
}

function keyframeProperties(point: KeyframeV2): KeyframeProperty[] {
    const result: KeyframeProperty[] = [];
    for (const property of ['transform.x', 'transform.y', 'transform.scale', 'transform.rotate'] as const) {
        if (keyframeValue(point, property) !== undefined) result.push(property);
    }
    for (const property of ['opacity', 'crop', 'perspective'] as const) {
        if (keyframeValue(point, property) !== undefined) result.push(property);
    }
    return result;
}

function hasKeyframeValue(point: KeyframeV2): boolean {
    return keyframeProperties(point).length > 0 || point.animator !== undefined;
}

function requireLocation(edit: EditableEditV2, id: string): ItemLocation {
    const location = locate(edit, id);
    if (!location) throw new Error(`item が見つかりません: ${id}`);
    return location;
}

function tracksOf(edit: EditableEditV2): MutableTrack[] {
    return edit.tracks as MutableTrack[];
}

function requireTrack(edit: EditableEditV2, id: string): MutableTrack {
    const track = tracksOf(edit).find(candidate => candidate.id === id);
    if (!track) throw new Error(`track が見つかりません: ${id}`);
    return track;
}

function requireTrackItems(track: MutableTrack): MutableItem[] {
    if (!Array.isArray(track.items)) throw new Error(`item を置けない track です: ${String(track.id)}`);
    return track.items as MutableItem[];
}

function insertionIndex(value: number | undefined, length: number): number {
    const index = value ?? length;
    if (!Number.isInteger(index) || index < 0 || index > length) throw new Error('index が範囲外です。');
    return index;
}

function removeLocations(locations: ItemLocation[]): void {
    const containers = new Map<MutableItem[], ItemLocation[]>();
    for (const location of locations) {
        const entries = containers.get(location.items) ?? [];
        entries.push(location);
        containers.set(location.items, entries);
    }
    for (const [items, entries] of containers) {
        for (const location of entries.sort((left, right) => right.index - left.index)) items.splice(location.index, 1);
    }
}

function containsItem(item: MutableItem, id: string): boolean {
    return ensureChildren(item, false).some(child => child.id === id || containsItem(child, id));
}

function assignTransform(item: MutableItem, transform: TransformV2 | undefined): void {
    if (transform === undefined) delete item.transform;
    else item.transform = transform;
}

function assignOpacity(item: MutableItem, opacity: number): void {
    if (opacity === 1) delete item.opacity;
    else item.opacity = opacity;
}

function mergePatch(base: JsonRecord, patch: JsonRecord): JsonRecord {
    const result = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined) delete result[key];
        else result[key] = clone(value);
    }
    return result;
}

function partIdOf(itemId: string, source: ItemV2['source']): string {
    if (source.kind === 'caption') return source.id;
    if ('part' in source && typeof source.part === 'string') return source.part;
    const hash = itemId.lastIndexOf('#');
    return hash >= 0 ? itemId.slice(hash + 1) : itemId;
}

function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
