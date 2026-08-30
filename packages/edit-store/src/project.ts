import { promises as fs } from 'fs';
import { join } from 'path';
import { parseCaptions, type CaptionRecord, type CaptionTextStyle } from './caption-store';
import { serializeCaptions, serializeEdit, serializeMotion } from './canonical';
import type {
    EditV2,
    ItemV2,
    KeyframeV2,
    MotionV0 as ItemMotionV0,
    TrackV2,
    TransformV2,
} from './edit-v2';
import {
    lintProjectCandidatesOnDisk,
    writeProjectFilesGuarded,
    type EditLintFinding,
    type LintCandidates,
} from './write-gate';

export type {
    AnimatorV0,
    AudioMediaItemV2,
    CaptionSourceV2,
    CaptionsSourceV2,
    EditV2,
    GroupSourceV2,
    ItemV2,
    ItemV2Base,
    KeyframeV2,
    KeyframesReferenceV2,
    MotionV0,
    SourceV2,
    TrackV2,
    TransformV2,
} from './edit-v2';

type JsonRecord = Record<string, unknown>;
const EDIT_FILE_VERSION = 2;
const MOTION_FILE_VERSION = 0;
export type ProjectItemV2 = Omit<ItemV2, 'items' | 'keyframes'> & {
    items?: ProjectItemV2[];
    keyframes?: KeyframeV2[] | { path: string; count: number };
};
export type ProjectTrackV2 = Omit<TrackV2, 'items'> & { items?: ProjectItemV2[] };
type MutableItem = ProjectItemV2 & JsonRecord;
type MutableTrack = ProjectTrackV2 & JsonRecord;

export interface MotionFileV0 {
    version: 0;
    group: string;
    items: Record<string, KeyframeV2[]>;
    [key: string]: unknown;
}

export interface MoveTarget {
    track?: string;
    parent?: string;
    index?: number;
}

export interface GroupResult {
    group: ProjectItemV2;
    changedOrderIds: string[];
}

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

export interface ProjectCaptions {
    rows: CaptionRecord[];
    defaultTextStyle?: CaptionTextStyle;
}

export interface ProjectSaveResult {
    written: string[];
    findings: EditLintFinding[];
}

export interface Project {
    edit: EditableEditV2;
    captions: ProjectCaptions;
    motion(groupId: string): Promise<MotionFileV0>;
    save(): Promise<ProjectSaveResult>;
}

export interface OpenProjectOptions {
    editFile?: string;
}

interface ItemLocation {
    item: MutableItem;
    items: MutableItem[];
    index: number;
    parent?: MutableItem;
    ancestors: MutableItem[];
    track: MutableTrack;
    trackIndex: number;
}

interface MotionState {
    path: string;
    doc: MotionFileV0;
    originalText?: string;
    originalState: string;
}

export async function openProject(dir: string, opts: OpenProjectOptions = {}): Promise<Project> {
    const editName = opts.editFile ?? 'edit.json';
    const editPath = join(dir, editName);
    let editText = await fs.readFile(editPath, 'utf8');
    const parsedEdit = JSON.parse(editText) as unknown;
    if (!isRecord(parsedEdit) || parsedEdit.version !== EDIT_FILE_VERSION || !Array.isArray(parsedEdit.tracks)) {
        throw new Error('openProject は version: 2 の edit.json を必要とします。');
    }
    const edit = parsedEdit as unknown as EditableEditV2;
    attachEditHelpers(edit);

    const captionsPath = join(dir, 'captions.json');
    let captionsText = await readOptional(captionsPath);
    const captionsRoot = captionsText === undefined ? undefined : JSON.parse(captionsText) as unknown;
    const parsedCaptions = captionsText === undefined
        ? { captions: [] as CaptionRecord[], warnings: [] as string[] }
        : parseCaptions(captionsText);
    const captions: ProjectCaptions = {
        rows: parsedCaptions.captions,
        ...(parsedCaptions.defaultTextStyle !== undefined
            ? { defaultTextStyle: parsedCaptions.defaultTextStyle } : {})
    };
    const motionStates = new Map<string, MotionState>();

    const loadMotionPath = async (relativePath: string, groupId: string): Promise<MotionState> => {
        const safePath = requireMotionPath(relativePath);
        const existing = motionStates.get(safePath);
        if (existing) return existing;
        const text = await readOptional(join(dir, ...safePath.split('/')));
        const doc = text === undefined
            ? { version: 0 as const, group: groupId, items: {} }
            : JSON.parse(text) as MotionFileV0;
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

    const project: Project = {
        edit,
        captions,
        async motion(groupId: string): Promise<MotionFileV0> {
            requireGroupId(groupId);
            return (await loadMotionPath(`motion/${groupId}.json`, groupId)).doc;
        },
        async save(): Promise<ProjectSaveResult> {
            normalizeTracks(edit);
            await distributeKeyframes(edit, loadMotionPath);

            const candidates: LintCandidates = {};
            const serializedEdit = serializeEdit(edit);
            if (serializedEdit !== editText) candidates[editName] = serializedEdit;

            if (captionsText !== undefined || captions.rows.length > 0) {
                const serializedCaptions = serializeCaptions(buildCaptionsDocument(captionsRoot, captions));
                if (serializedCaptions !== (captionsText ?? '')) candidates['captions.json'] = serializedCaptions;
            }
            for (const state of motionStates.values()) {
                const changed = stableJson(state.doc) !== state.originalState;
                if (state.originalText === undefined && !changed) continue;
                const serialized = serializeMotion(state.doc);
                if (serialized !== (state.originalText ?? '')) candidates[state.path] = serialized;
            }

            const written = Object.keys(candidates);
            if (written.length === 0) return { written: [], findings: [] };

            const lint = await lintProjectCandidatesOnDisk(dir, candidates);
            if (!lint.pass) {
                const error = new Error(lint.errors[0] ?? 'edit-lint が変更を拒否しました') as Error & {
                    findings?: EditLintFinding[];
                };
                error.findings = lint.findings;
                throw error;
            }
            await writeProjectFilesGuarded(dir, candidates);
            for (const key of written) {
                if (key === editName) editText = candidates[key] as string;
                else if (key === 'captions.json') captionsText = candidates[key] as string;
            }
            for (const state of motionStates.values()) {
                if (state.path in candidates) state.originalText = candidates[state.path] as string;
                state.originalState = stableJson(state.doc);
            }
            return { written, findings: lint.findings };
        }
    };
    return project;
}

function attachEditHelpers(edit: EditableEditV2): void {
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

function updateItem(edit: EditableEditV2, id: string, patch: JsonRecord): ProjectItemV2 {
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

function moveItem(edit: EditableEditV2, id: string, target: MoveTarget): ProjectItemV2 {
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

function insertItem(edit: EditableEditV2, target: string, item: MutableItem, index?: number): ProjectItemV2 {
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

function removeItem(edit: EditableEditV2, id: string): ProjectItemV2 {
    const location = requireLocation(edit, id);
    location.items.splice(location.index, 1);
    return location.item;
}

function detachItem(edit: EditableEditV2, id: string, target: { track: 'above' | string }): ProjectItemV2 {
    const source = requireLocation(edit, id);
    if (!source.parent) throw new Error(`段直下の item は detach できません: ${id}`);
    const worldAt = absoluteAt(source);
    const worldTransform = composeTransforms(worldTransformOfAncestors(source.ancestors), source.item.transform);
    const worldOpacity = opacityOfAncestors(source.ancestors) * (source.item.opacity ?? 1);
    if (source.parent.source.kind === 'html' || source.parent.source.kind === 'captions') {
        const excluded = source.parent.source.exclude ?? [];
        if (!excluded.includes(id)) source.parent.source.exclude = [...excluded, id];
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

function groupItems(edit: EditableEditV2, ids: string[], options: { name?: string } = {}): GroupResult {
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

function ungroupItem(edit: EditableEditV2, id: string): ProjectItemV2[] {
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

async function distributeKeyframes(
    edit: EditableEditV2,
    loadMotion: (path: string, groupId: string) => Promise<MotionState>
): Promise<void> {
    const visit = async (item: MutableItem, ancestors: MutableItem[]): Promise<void> => {
        if (Array.isArray(item.keyframes) && item.keyframes.length >= 9) {
            const groupId = ancestors.length > 0 ? ancestors[ancestors.length - 1].id : item.id;
            const path = `motion/${groupId}.json`;
            const state = await loadMotion(path, groupId);
            state.doc.group = groupId;
            state.doc.items[item.id] = clone(item.keyframes);
            item.keyframes = { path, count: item.keyframes.length };
        } else if (isRecord(item.keyframes)) {
            const path = requireMotionPath(String(item.keyframes.path));
            const groupId = path.slice('motion/'.length, -'.json'.length);
            const state = await loadMotion(path, groupId);
            const points = state.doc.items[item.id];
            if (Array.isArray(points)) item.keyframes.count = points.length;
        }
        for (const child of ensureChildren(item, false)) await visit(child, [...ancestors, item]);
    };
    for (const track of tracksOf(edit)) {
        if (!Array.isArray(track.items)) continue;
        for (const item of track.items as MutableItem[]) await visit(item, []);
    }
}

function normalizeTracks(edit: EditableEditV2): void {
    edit.tracks = edit.tracks.filter(track => !('items' in track) || !Array.isArray(track.items) || track.items.length > 0);
}

function buildCaptionsDocument(root: unknown, captions: ProjectCaptions): unknown {
    const originalRows = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions) ? root.captions : [];
    const byId = new Map(captions.rows.map(row => [row.id, row]));
    const used = new Set<string>();
    const rows = originalRows.map(raw => {
        if (!isRecord(raw) || typeof raw.id !== 'string') return clone(raw);
        const row = byId.get(raw.id);
        if (!row) return clone(raw);
        used.add(row.id);
        return captionRecordToJson(row, raw);
    });
    for (const row of captions.rows) if (!used.has(row.id)) rows.push(captionRecordToJson(row));
    if (Array.isArray(root) || root === undefined) return rows;
    const result: JsonRecord = { ...(root as JsonRecord), captions: rows };
    if (captions.defaultTextStyle === undefined) delete result.default_text_style;
    else result.default_text_style = textStyleToJson(captions.defaultTextStyle);
    return result;
}

function captionRecordToJson(row: CaptionRecord, original: JsonRecord = {}): JsonRecord {
    const result: JsonRecord = {
        ...original,
        id: row.id,
        start: row.start,
        end: row.end,
        text: row.text,
        speaker: row.speaker,
        sourceRef: clone(row.sourceRef),
        edited: row.edited,
    };
    if (row.timeDomain === undefined) delete result.time_domain;
    else result.time_domain = row.timeDomain;
    if (row.textStyle === undefined) delete result.text_style;
    else result.text_style = textStyleToJson(row.textStyle);
    return result;
}

function textStyleToJson(style: CaptionTextStyle): JsonRecord {
    const rename = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(rename);
        if (!isRecord(value)) return value;
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [camelToSnake(key), rename(entry)]));
    };
    return rename(style) as JsonRecord;
}

const CAPTION_STYLE_NAMES: Record<string, string> = {
    sizePx: 'size_px', fontFamily: 'font_family', fontWeight: 'font_weight', letterSpacingEm: 'letter_spacing_em',
    lineHeight: 'line_height', verticalAlign: 'vertical_align', textTransform: 'text_transform',
    maxWidthPct: 'max_width_pct', textAnchor: 'text_anchor', widthPx: 'width_px', blurPx: 'blur_px',
    distancePx: 'distance_px', angleDeg: 'angle_deg', offsetX: 'offset_x', offsetY: 'offset_y',
    durationSec: 'duration_sec', radiusPx: 'radius_px', paddingPx: 'padding_px', widthPct: 'width_pct',
    heightPct: 'height_pct', referenceWidthPx: 'reference_width_px', referenceHeightPx: 'reference_height_px',
    leftPx: 'left_px', bottomPx: 'bottom_px', textAlign: 'text_align', maxLines: 'max_lines'
};

function camelToSnake(key: string): string {
    return CAPTION_STYLE_NAMES[key] ?? key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function allLocations(edit: EditableEditV2): ItemLocation[] {
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

function locate(edit: EditableEditV2, id: string): ItemLocation | undefined {
    return allLocations(edit).find(location => location.item.id === id);
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

function ensureChildren(item: MutableItem, create = true): MutableItem[] {
    if (Array.isArray(item.items)) return item.items as MutableItem[];
    if (!create) return [];
    item.items = [];
    return item.items as MutableItem[];
}

function createTrackAbove(edit: EditableEditV2, track: MutableTrack): MutableTrack {
    const tracks = tracksOf(edit);
    const index = tracks.indexOf(track);
    const created = { id: nextTrackId(edit, String(track.lane)), lane: track.lane, items: [] } as unknown as MutableTrack;
    tracks.splice(index + 1, 0, created);
    return created;
}

function nextTrackId(edit: EditableEditV2, lane: string): string {
    const ids = new Set(tracksOf(edit).map(track => String(track.id)));
    const prefix = lane === 'audio' ? 'a' : 'v';
    let serial = 1;
    while (ids.has(`${prefix}${serial}`)) serial++;
    return `${prefix}${serial}`;
}

function nextGroupId(edit: EditableEditV2): string {
    const ids = new Set(allLocations(edit).map(location => location.item.id));
    let serial = 1;
    while (ids.has(`g-${serial}`)) serial++;
    return `g-${serial}`;
}

function overlapsAny(item: MutableItem, items: MutableItem[]): boolean {
    return items.some(other => item.at < other.at + other.duration && other.at < item.at + item.duration);
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

function changedZOrderIds(
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

function containsItem(item: MutableItem, id: string): boolean {
    return ensureChildren(item, false).some(child => child.id === id || containsItem(child, id));
}

function absoluteAt(location: ItemLocation): number {
    return location.ancestors.reduce((sum, item) => sum + item.at, 0) + location.item.at;
}

function worldTransformOfAncestors(ancestors: MutableItem[]): TransformV2 | undefined {
    return ancestors.reduce<TransformV2 | undefined>((result, item) => composeTransforms(result, item.transform), undefined);
}

function opacityOfAncestors(ancestors: MutableItem[]): number {
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

function relativeTransform(parent: TransformV2 | undefined, world: TransformV2 | undefined): TransformV2 | undefined {
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

function snapshotCaptions(captions: ProjectCaptions): string {
    return stableJson({ rows: captions.rows, defaultTextStyle: captions.defaultTextStyle });
}

function stableJson(value: unknown): string {
    return JSON.stringify(value);
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function requireMotionPath(value: string): string {
    if (!/^motion\/[^/\\]+\.json$/u.test(value)) throw new Error(`motion 袋のパスが不正です: ${value}`);
    return value;
}

function requireGroupId(value: string): void {
    if (value.length === 0 || value.includes('/') || value.includes('\\')) throw new Error(`group id が不正です: ${value}`);
}

async function readOptional(path: string): Promise<string | undefined> {
    try {
        return await fs.readFile(path, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
