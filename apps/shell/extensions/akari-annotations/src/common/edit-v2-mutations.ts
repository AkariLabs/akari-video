/**
 * edit.json v2 の全文スナップショット用ミューテーション。
 *
 * すべての関数は入力を変更せず、tracks[].items[] の id を鍵にした新しい文書を返す。
 * JSON Schema の検証は保存境界に任せ、この層では操作に必要な形と値だけを検査する。
 */

import {
    attachEditHelpers,
    convertCaptionToTelop,
    createTrackAt,
    detachItem as detachTreeItem,
    groupItems as groupTreeItems,
    materializeProjectedPart,
    moveItem as moveTreeItem,
    moveKeyframe as moveTreeKeyframe,
    normalizeTracks,
    removeKeyframe as removeTreeKeyframe,
    removeItem as removeTreeItem,
    serializeEdit,
    setKeyframe as setTreeKeyframe,
    setSegmentEasing as setTreeSegmentEasing,
    ungroupItem as ungroupTreeItem,
    updateItem as updateTreeItem,
    type EditableEditV2,
    type GroupResult,
    type MoveTarget,
    type ProjectedItemTiming,
    type ProjectItemV2,
    type KeyframeProperty,
} from '@akari-video/edit-store';
import { normalizeAudioKeyframes, type AudioEnvelopeKeyframe } from './audio-envelope-store';

export type EditV2Document = Record<string, unknown>;
export type EditV2Lane = 'visual' | 'audio';
export type EditV2TrackFlag = 'hidden' | 'muted' | 'locked';

type UnknownRecord = Record<string, unknown>;

export interface ItemLocation {
    trackId: string;
    trackIndex: number;
    itemIndex: number;
    parentId?: string;
}

export function moveAudioSfx(
    doc: EditV2Document,
    options: { sfxId: string; t: number; track?: number }
): EditV2Document {
    return updateAudioSfx(doc, {
        sfxId: options.sfxId,
        patch: { t: options.t, ...(options.track === undefined ? {} : { track: options.track }) }
    });
}

export function updateAudioSfx(
    doc: EditV2Document,
    options: { sfxId: string; patch: UnknownRecord }
): EditV2Document {
    const value = cloneDocument(doc);
    const sfx = audioSfxOf(value);
    const index = findAudioSfxIndex(sfx, options.sfxId);
    const patch = normalizeLegacyAudioPatch(options.patch);
    if (Object.prototype.hasOwnProperty.call(patch, 't')) requireSeconds(patch.t, 'audio.sfx[].t');
    for (const field of ['in', 'out', 'fade_in', 'fade_out'] as const) {
        if (Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== null) {
            requireSeconds(patch[field], `audio.sfx[].${field}`);
        }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'track')
        && (!Number.isInteger(patch.track) || (patch.track as number) < 0)) {
        throw new Error('audio.sfx[].track は 0 以上の整数で指定してください。');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'gain_db') && patch.gain_db !== null
        && (typeof patch.gain_db !== 'number' || !Number.isFinite(patch.gain_db))) {
        throw new Error('audio.sfx[].gain_db は有限数で指定してください。');
    }
    sfx[index] = mergeNullable(sfx[index], patch);
    return value;
}

export function removeAudioSfx(doc: EditV2Document, sfxId: string): EditV2Document {
    const value = cloneDocument(doc);
    const sfx = audioSfxOf(value);
    sfx.splice(findAudioSfxIndex(sfx, sfxId), 1);
    return value;
}

export function insertAudioSfx(
    doc: EditV2Document,
    item: UnknownRecord,
    index?: number
): EditV2Document {
    const value = cloneDocument(doc);
    const sfx = audioSfxOf(value, true);
    const id = stringId(item, '音声クリップ');
    if (sfx.some((entry, entryIndex) => audioSfxId(entry, entryIndex) === id)) {
        throw new Error(`音声クリップ id が重複しています: ${id}`);
    }
    requireSeconds(item.t, 'audio.sfx[].t');
    if (typeof item.path !== 'string' || item.path.trim() === '') {
        throw new Error('音声クリップの path がありません。');
    }
    const insertAt = index === undefined ? sfx.length : index;
    if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > sfx.length) {
        throw new Error('音声クリップの挿入位置が範囲外です。');
    }
    sfx.splice(insertAt, 0, cloneValue(item));
    return value;
}

export function stringifyEditV2(value: EditV2Document): string {
    return serializeEdit(value);
}

export interface TreeMutationResult<T> {
    document: EditV2Document;
    value: T;
    createdTrackId?: string;
}

export interface KeyframeMutationOptions {
    itemId: string;
    property: KeyframeProperty;
    /** motion 袋参照を編集するとき、shell が読み戻した inline 点列。 */
    hydratedPoints?: readonly Record<string, unknown>[];
}

export interface KeyframeMotionWrite {
    path: string;
    group: string;
    itemId: string;
    points: readonly Record<string, unknown>[];
}

function editTree(doc: EditV2Document): EditableEditV2 {
    const value = cloneDocument(doc) as unknown as EditableEditV2;
    if (value.version !== 2 || !Array.isArray(value.tracks)) {
        throw new Error('木の操作は edit.json v2 のみ対応しています。');
    }
    attachEditHelpers(value);
    return value;
}

function finishTreeMutation<T>(
    edit: EditableEditV2,
    beforeTrackIds: ReadonlySet<string>,
    value: T
): TreeMutationResult<T> {
    normalizeTracks(edit);
    const createdTrackId = edit.tracks.find(track => !beforeTrackIds.has(String(track.id)))?.id;
    return {
        document: edit as unknown as EditV2Document,
        value,
        ...(createdTrackId === undefined ? {} : { createdTrackId: String(createdTrackId) })
    };
}

export function moveTreeV2Item(
    doc: EditV2Document,
    itemId: string,
    target: MoveTarget,
    patch?: Record<string, unknown>
): TreeMutationResult<ProjectItemV2> {
    const edit = editTree(doc);
    const beforeTrackIds = new Set(edit.tracks.map(track => String(track.id)));
    if (!edit.find(itemId) && itemId.includes('#')) materializeProjectedPart(edit, itemId);
    if (patch) updateTreeItem(edit, itemId, patch);
    return finishTreeMutation(edit, beforeTrackIds, moveTreeItem(edit, itemId, target));
}

export function detachTreeV2Item(
    doc: EditV2Document,
    itemId: string,
    projected?: ProjectedItemTiming
): TreeMutationResult<ProjectItemV2> {
    const edit = editTree(doc);
    const beforeTrackIds = new Set(edit.tracks.map(track => String(track.id)));
    return finishTreeMutation(edit, beforeTrackIds, detachTreeItem(edit, itemId, { track: 'above' }, projected));
}

export function convertCaptionToTelopV2(
    doc: EditV2Document,
    itemId: string,
    options: { preset?: string; text: string; at?: number; duration?: number }
): TreeMutationResult<ProjectItemV2> {
    const edit = editTree(doc);
    const beforeTrackIds = new Set(edit.tracks.map(track => String(track.id)));
    return finishTreeMutation(edit, beforeTrackIds, convertCaptionToTelop(edit, itemId, options));
}

export function groupTreeV2Items(
    doc: EditV2Document,
    itemIds: string[],
    options?: { name?: string }
): TreeMutationResult<GroupResult> {
    const edit = editTree(doc);
    const beforeTrackIds = new Set(edit.tracks.map(track => String(track.id)));
    return finishTreeMutation(edit, beforeTrackIds, groupTreeItems(edit, itemIds, options));
}

export function ungroupTreeV2Item(
    doc: EditV2Document,
    itemId: string
): TreeMutationResult<ProjectItemV2[]> {
    const edit = editTree(doc);
    const beforeTrackIds = new Set(edit.tracks.map(track => String(track.id)));
    return finishTreeMutation(edit, beforeTrackIds, ungroupTreeItem(edit, itemId));
}

export function removeTreeV2Item(doc: EditV2Document, itemId: string): TreeMutationResult<ProjectItemV2> {
    const edit = editTree(doc);
    const beforeTrackIds = new Set(edit.tracks.map(track => String(track.id)));
    return finishTreeMutation(edit, beforeTrackIds, removeTreeItem(edit, itemId));
}

export function updateTreeV2Item(
    doc: EditV2Document,
    itemId: string,
    patch: Record<string, unknown>
): EditV2Document {
    const edit = editTree(doc);
    updateTreeItem(edit, itemId, patch);
    normalizeTracks(edit);
    return edit as unknown as EditV2Document;
}

export function setV2Keyframe(
    doc: EditV2Document,
    options: KeyframeMutationOptions & { t: number; value: unknown }
): EditV2Document {
    const edit = editForKeyframes(doc, options);
    setTreeKeyframe(edit, options.itemId, options.property, options.t, options.value);
    return finishKeyframeMutation(edit);
}

export function removeV2Keyframe(
    doc: EditV2Document,
    options: KeyframeMutationOptions & { t: number }
): EditV2Document {
    const edit = editForKeyframes(doc, options);
    removeTreeKeyframe(edit, options.itemId, options.property, options.t);
    return finishKeyframeMutation(edit);
}

export function moveV2Keyframe(
    doc: EditV2Document,
    options: KeyframeMutationOptions & { fromT: number; toT: number }
): EditV2Document {
    const edit = editForKeyframes(doc, options);
    moveTreeKeyframe(edit, options.itemId, options.property, options.fromT, options.toT);
    return finishKeyframeMutation(edit);
}

export function setV2SegmentEasing(
    doc: EditV2Document,
    options: KeyframeMutationOptions & { toT: number; easing: string }
): EditV2Document {
    const edit = editForKeyframes(doc, options);
    setTreeSegmentEasing(edit, options.itemId, options.property, options.toT, options.easing);
    return finishKeyframeMutation(edit);
}

/** shell の canonical 保存前に 9 点以上を B と同じ group-id 規則で袋候補へ分ける。 */
export function prepareV2KeyframeDistribution(doc: EditV2Document): {
    document: EditV2Document;
    writes: KeyframeMotionWrite[];
} {
    const document = cloneDocument(doc);
    const writes: KeyframeMotionWrite[] = [];
    const visit = (item: UnknownRecord, ancestors: UnknownRecord[], audioLane: boolean): void => {
        const audioItem = audioLane || typeof item.role === 'string';
        if (!audioItem && Array.isArray(item.keyframes) && item.keyframes.length >= 9
            && typeof item.id === 'string') {
            const nearest = ancestors[ancestors.length - 1];
            const group = typeof nearest?.id === 'string' ? nearest.id : item.id;
            const path = `motion/${group}.json`;
            writes.push({ path, group, itemId: item.id, points: cloneValue(item.keyframes) });
            item.keyframes = { path, count: item.keyframes.length };
        }
        if (Array.isArray(item.items)) {
            for (const child of item.items) if (isRecord(child)) visit(child, [...ancestors, item], audioLane);
        }
    };
    for (const track of tracksOf(document)) {
        if (!Array.isArray(track.items)) continue;
        const audioLane = track.lane === 'audio';
        for (const item of track.items) if (isRecord(item)) visit(item, [], audioLane);
    }
    return { document, writes };
}

function editForKeyframes(doc: EditV2Document, options: KeyframeMutationOptions): EditableEditV2 {
    const edit = editTree(doc);
    const item = edit.find(options.itemId);
    if (!item) throw new Error(`item が見つかりません: ${options.itemId}`);
    if (!Array.isArray(item.keyframes) && item.keyframes !== undefined) {
        if (!options.hydratedPoints) throw new Error('motion 袋を読み込んでから編集してください。');
        item.keyframes = cloneValue(options.hydratedPoints) as unknown as typeof item.keyframes;
    }
    return edit;
}

function finishKeyframeMutation(edit: EditableEditV2): EditV2Document {
    normalizeTracks(edit);
    return edit as unknown as EditV2Document;
}

export function indexEditV2Items(doc: EditV2Document): Map<string, ItemLocation> {
    const result = new Map<string, ItemLocation>();
    tracksOf(doc).forEach((track, trackIndex) => {
        if (!Array.isArray(track.items)) return;
        const visit = (items: unknown[], parentId?: string): void => items.forEach((item, itemIndex) => {
            if (!isRecord(item) || typeof item.id !== 'string') return;
            if (result.has(item.id)) throw new Error(`クリップ id が重複しています: ${item.id}`);
            result.set(item.id, {
                trackId: stringId(track, 'トラック'), trackIndex, itemIndex,
                ...(parentId === undefined ? {} : { parentId })
            });
            if (Array.isArray(item.items)) visit(item.items, item.id);
        });
        visit(track.items);
    });
    return result;
}

/**
 * v2 audio の書き込み先を一意に決めるための検索。新形式の tracks[].items[] を常に優先し、
 * そこに対象 id が無い場合だけ legacy audio.sfx[] へフォールバックする。
 */
export function moveAudioSfxPreferV2(
    doc: EditV2Document,
    options: { sfxId: string; t: number; track?: number; toTrackId?: string; atFrames: number }
): EditV2Document {
    const location = indexEditV2Items(doc).get(options.sfxId);
    if (location) {
        const targetExists = options.toTrackId !== undefined
            && tracksOf(doc).some(track => track.id === options.toTrackId);
        return moveItem(doc, {
            itemId: options.sfxId,
            toTrackId: targetExists ? options.toTrackId! : location.trackId,
            atFrames: options.atFrames
        });
    }
    return moveAudioSfx(doc, { sfxId: options.sfxId, t: options.t, track: options.track });
}

export function updateAudioSfxPreferV2(
    doc: EditV2Document,
    options: { sfxId: string; itemPatch: UnknownRecord; legacyPatch: UnknownRecord }
): EditV2Document {
    return indexEditV2Items(doc).has(options.sfxId)
        ? updateAudioItemEnvelope(doc, { itemId: options.sfxId, patch: options.itemPatch })
        : updateAudioSfx(doc, { sfxId: options.sfxId, patch: normalizeLegacyAudioPatch(options.legacyPatch) });
}

export function removeAudioSfxPreferV2(doc: EditV2Document, sfxId: string): EditV2Document {
    return indexEditV2Items(doc).has(sfxId)
        ? removeItem(doc, sfxId)
        : removeAudioSfx(doc, sfxId);
}

export function insertAudioSfxPreferV2(
    doc: EditV2Document,
    options: {
        trackId?: string;
        item: UnknownRecord;
        legacyItem: UnknownRecord;
        index?: number;
    }
): EditV2Document {
    if (options.trackId !== undefined) {
        const track = trackById(doc, options.trackId);
        if (track.lane !== 'audio') {
            throw new Error('映像のレーンには音を置けません。');
        }
        return insertItem(doc, options.trackId, options.item, options.index);
    }
    return insertAudioSfx(doc, options.legacyItem, options.index);
}

/** role は省略時 sfx。BGM は旧表示 id が常に "bgm" のため raw id と異なる場合がある。 */
export function findAudioItemIdByRole(
    doc: EditV2Document,
    role: 'sfx' | 'narration' | 'bgm'
): string | undefined {
    for (const track of tracksOf(doc)) {
        if (track.lane !== 'audio' || !Array.isArray(track.items)) continue;
        for (const item of track.items) {
            if (!isRecord(item) || typeof item.id !== 'string') continue;
            const itemRole = item.role === undefined ? 'sfx' : item.role;
            if (itemRole === role) return item.id;
        }
    }
    return undefined;
}

export function updateAudioNarrationGainPreferV2(
    doc: EditV2Document,
    options: { narrationId: string; gainDb: number | null }
): EditV2Document {
    if (indexEditV2Items(doc).has(options.narrationId)) {
        return updateItem(doc, {
            itemId: options.narrationId,
            patch: { gain_db: options.gainDb }
        });
    }
    const value = cloneDocument(doc);
    if (!isRecord(value.audio) || !Array.isArray(value.audio.narration)
        || !value.audio.narration.every(isRecord)) {
        throw new Error('edit.json.audio.narration が見つかりません。');
    }
    const index = value.audio.narration.findIndex((entry, entryIndex) =>
        (typeof entry.id === 'string' && entry.id.trim() ? entry.id : `narration-${entryIndex}`)
        === options.narrationId);
    if (index < 0) throw new Error(`ナレーションが見つかりません: ${options.narrationId}`);
    value.audio.narration[index] = mergeNullable(
        value.audio.narration[index], { gain_db: options.gainDb }
    );
    return value;
}

export function updateAudioNarrationPreferV2(
    doc: EditV2Document,
    options: { narrationId: string; itemPatch: UnknownRecord; legacyPatch: UnknownRecord }
): EditV2Document {
    if (indexEditV2Items(doc).has(options.narrationId)) {
        return updateAudioItemEnvelope(doc, { itemId: options.narrationId, patch: options.itemPatch });
    }
    const value = cloneDocument(doc);
    if (!isRecord(value.audio) || !Array.isArray(value.audio.narration)
        || !value.audio.narration.every(isRecord)) {
        throw new Error('edit.json.audio.narration が見つかりません。');
    }
    const index = value.audio.narration.findIndex((entry, entryIndex) =>
        (typeof entry.id === 'string' && entry.id.trim() ? entry.id : `narration-${entryIndex}`)
        === options.narrationId);
    if (index < 0) throw new Error(`ナレーションが見つかりません: ${options.narrationId}`);
    value.audio.narration[index] = mergeNullable(
        value.audio.narration[index], normalizeLegacyAudioPatch(options.legacyPatch)
    );
    return value;
}

export function updateAudioItemEnvelope(
    doc: EditV2Document,
    options: { itemId: string; patch: UnknownRecord }
): EditV2Document {
    return updateItem(doc, { itemId: options.itemId, patch: normalizeV2AudioPatch(options.patch) });
}

function normalizeV2AudioPatch(patch: UnknownRecord): UnknownRecord {
    const next = { ...patch };
    if (Object.prototype.hasOwnProperty.call(next, 'keyframes')) {
        const raw = next.keyframes;
        if (raw !== null && !Array.isArray(raw)) throw new Error('keyframes は配列で指定してください。');
        const normalized = normalizeAudioKeyframes(raw as AudioEnvelopeKeyframe[] | null);
        if (normalized?.some(point => !Number.isInteger(point.t))) {
            throw new Error('v2 keyframes[].t は整数フレームで指定してください。');
        }
        next.keyframes = normalized;
    }
    validateAudioEnvelopePatch(next);
    return next;
}

function normalizeLegacyAudioPatch(patch: UnknownRecord): UnknownRecord {
    const next = { ...patch };
    if (Object.prototype.hasOwnProperty.call(next, 'keyframes')) {
        const raw = next.keyframes;
        if (raw !== null && !Array.isArray(raw)) throw new Error('keyframes は配列で指定してください。');
        next.keyframes = normalizeAudioKeyframes(raw as AudioEnvelopeKeyframe[] | null);
    }
    validateAudioEnvelopePatch(next);
    return next;
}

function validateAudioEnvelopePatch(patch: UnknownRecord): void {
    const ranges: Array<[string, number, number]> = [
        ['gain_db', -60, 12], ['duck_db', -40, 0], ['duck_attack', 0, 2], ['duck_release', 0, 5]
    ];
    for (const [key, min, max] of ranges) {
        const value = patch[key];
        if (value !== undefined && value !== null
            && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) {
            throw new Error(`${key} は ${min}〜${max} の範囲で指定してください。`);
        }
    }
    if (patch.ducking !== undefined && patch.ducking !== null && typeof patch.ducking !== 'boolean') {
        throw new Error('ducking は boolean で指定してください。');
    }
}

export function removeAudioNarrationPreferV2(
    doc: EditV2Document,
    narrationId: string
): EditV2Document {
    if (indexEditV2Items(doc).has(narrationId)) return removeItem(doc, narrationId);
    const value = cloneDocument(doc);
    if (!isRecord(value.audio) || !Array.isArray(value.audio.narration)
        || !value.audio.narration.every(isRecord)) {
        throw new Error('edit.json.audio.narration が見つかりません。');
    }
    const index = value.audio.narration.findIndex((entry, entryIndex) =>
        (typeof entry.id === 'string' && entry.id.trim() ? entry.id : `narration-${entryIndex}`)
        === narrationId);
    if (index < 0) throw new Error(`ナレーションが見つかりません: ${narrationId}`);
    value.audio.narration.splice(index, 1);
    return value;
}

export function moveItem(
    doc: EditV2Document,
    options: { itemId: string; toTrackId: string; atFrames: number }
): EditV2Document {
    requireFrame(options.atFrames, '移動先の時刻');
    const itemExists = indexEditV2Items(doc).has(options.itemId);
    const audioIndex = findAudioSfxIndexOptional(doc, options.itemId);
    if (!itemExists && audioIndex >= 0) {
        const match = /^implicit-audio-(\d+)$/.exec(options.toTrackId);
        if (!match) throw new Error('音声クリップの移動先トラックを特定できません。');
        return moveAudioSfx(doc, {
            sfxId: options.itemId,
            t: options.atFrames / fpsOf(doc),
            track: Number(match[1])
        });
    }
    const value = cloneDocument(doc);
    const tracks = tracksOf(value);
    const found = findItem(tracks, options.itemId);
    const targetIndex = tracks.findIndex(track => track.id === options.toTrackId);
    if (targetIndex < 0) throw new Error(`移動先のトラックが見つかりません: ${options.toTrackId}`);
    const target = tracks[targetIndex];
    requireItemsTrack(target, `移動先のトラック ${options.toTrackId}`);
    if (target.lane !== found.track.lane) {
        throw new Error(found.track.lane === 'visual'
            ? '音のレーンには映像を置けません。'
            : '映像のレーンには音を置けません。');
    }
    const [item] = found.track.items.splice(found.itemIndex, 1);
    const moved = { ...item, at: options.atFrames };
    const insertIndex = target === found.track
        ? found.itemIndex
        : atAscendingInsertIndex(target.items, options.atFrames);
    target.items.splice(insertIndex, 0, moved);
    collapseEmptiedVisualSourceTrack(tracks, found.track, target);
    return value;
}

function atAscendingInsertIndex(items: UnknownRecord[], atFrames: number): number {
    let insertIndex = 0;
    items.forEach((entry, index) => {
        if (typeof entry.at === 'number' && Number.isFinite(entry.at) && entry.at <= atFrames) {
            insertIndex = index + 1;
        }
    });
    return insertIndex;
}

export function moveItemToNewTrack(
    doc: EditV2Document,
    options: { itemId: string; insertIndex: number; atFrames: number }
): EditV2Document {
    requireFrame(options.atFrames, '移動先の時刻');
    const edit = editTree(doc);
    const found = indexEditV2Items(edit as unknown as EditV2Document).get(options.itemId);
    if (!found) throw new Error(`クリップが見つかりません: ${options.itemId}`);
    const sourceTrack = edit.tracks[found.trackIndex];
    requireInsertIndex(edit.tracks as unknown as UnknownRecord[], options.insertIndex, sourceTrack.lane as EditV2Lane);
    const created = createTrackAt(edit, String(sourceTrack.lane), options.insertIndex);
    updateTreeItem(edit, options.itemId, { at: options.atFrames });
    moveTreeItem(edit, options.itemId, { track: String(created.id) });
    normalizeTracks(edit);
    return edit as unknown as EditV2Document;
}

/**
 * 「空トラックを残さない」は移動によって今まさに空になった visual items[] 段だけに適用する。
 * captions の content 段と audio 段は別の正本・ミックス契約を持つため自動削除しない。また、
 * 「トラックを追加」で明示作成された未使用の空段を全件 sweep しないことで、追加→配置の途中状態を
 * 壊さない。tracks[] から当該要素だけを splice するため、残る段の相対順（z）は不変。
 */
function collapseEmptiedVisualSourceTrack(
    tracks: UnknownRecord[],
    source: UnknownRecord,
    target?: UnknownRecord
): boolean {
    if (source === target || source.lane !== 'visual' || !Array.isArray(source.items)
        || source.items.length !== 0) {
        return false;
    }
    const index = tracks.indexOf(source);
    if (index < 0) return false;
    tracks.splice(index, 1);
    return true;
}

export function updateItem(
    doc: EditV2Document,
    options: { itemId: string; patch: UnknownRecord }
): EditV2Document {
    const itemExists = indexEditV2Items(doc).has(options.itemId);
    const audioIndex = findAudioSfxIndexOptional(doc, options.itemId);
    if (!itemExists && audioIndex >= 0) {
        const patch: UnknownRecord = {};
        if (Object.prototype.hasOwnProperty.call(options.patch, 'at')) {
            requireFrame(options.patch.at, 'at');
            patch.t = (options.patch.at as number) / fpsOf(doc);
        }
        if (isRecord(options.patch.source)) {
            for (const key of ['in', 'out'] as const) {
                if (Object.prototype.hasOwnProperty.call(options.patch.source, key)) {
                    patch[key] = options.patch.source[key];
                }
            }
        }
        for (const key of [
            'gain_db', 'fade_in', 'fade_out', 'track',
            'ducking', 'duck_db', 'duck_attack', 'duck_release', 'keyframes'
        ] as const) {
            if (Object.prototype.hasOwnProperty.call(options.patch, key)) patch[key] = options.patch[key];
        }
        return updateAudioSfx(doc, { sfxId: options.itemId, patch });
    }
    const value = cloneDocument(doc);
    const found = findItem(tracksOf(value), options.itemId);
    const patch = { ...options.patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'at')) requireFrame(patch.at, 'at');
    if (Object.prototype.hasOwnProperty.call(patch, 'duration')) requireFrame(patch.duration, 'duration');
    const sourcePatch = patch.source;
    delete patch.source;
    const next = mergeNullable(found.item, patch);
    if (sourcePatch !== undefined) {
        if (!isRecord(sourcePatch)) throw new Error('source の更新値は object で指定してください。');
        const source = recordOf(found.item.source, 'クリップの source');
        if (Object.prototype.hasOwnProperty.call(sourcePatch, 'in')) requireSeconds(sourcePatch.in, 'source.in');
        if (Object.prototype.hasOwnProperty.call(sourcePatch, 'out')) requireSeconds(sourcePatch.out, 'source.out');
        next.source = mergeNullable(source, sourcePatch);
    }
    found.track.items[found.itemIndex] = next;
    return value;
}

export function removeItem(doc: EditV2Document, itemId: string): EditV2Document {
    const value = cloneDocument(doc);
    const found = findItem(tracksOf(value), itemId);
    found.track.items.splice(found.itemIndex, 1);
    return value;
}

export function insertItem(
    doc: EditV2Document,
    trackId: string,
    item: UnknownRecord,
    index?: number
): EditV2Document {
    const value = cloneDocument(doc);
    const tracks = tracksOf(value);
    const target = tracks.find(track => track.id === trackId);
    if (!target) throw new Error(`挿入先のトラックが見つかりません: ${trackId}`);
    requireItemsTrack(target, `挿入先のトラック ${trackId}`);
    const itemId = stringId(item, 'クリップ');
    if (indexEditV2Items(value).has(itemId)) throw new Error(`クリップ id が重複しています: ${itemId}`);
    requireFrame(item.at, 'at');
    requireFrame(item.duration, 'duration');
    const insertAt = index === undefined ? target.items.length : index;
    if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > target.items.length) {
        throw new Error('クリップの挿入位置が範囲外です。');
    }
    target.items.splice(insertAt, 0, cloneValue(item));
    return value;
}

export function splitItem(
    doc: EditV2Document,
    options: { itemId: string; atFrames: number }
): EditV2Document {
    requireFrame(options.atFrames, '分割位置');
    const value = cloneDocument(doc);
    const tracks = tracksOf(value);
    const found = findItem(tracks, options.itemId);
    const at = numberOf(found.item.at, 'クリップの at');
    const duration = numberOf(found.item.duration, 'クリップの duration');
    const offset = options.atFrames - at;
    if (offset <= 0 || offset >= duration) throw new Error('分割位置はクリップの内側に置いてください。');

    const first = cloneValue(found.item);
    const second = cloneValue(found.item);
    first.duration = offset;
    second.id = nextItemId(tracks, `${options.itemId}-split`);
    second.at = options.atFrames;
    second.duration = duration - offset;
    if (isRecord(first.source) && isRecord(second.source)
        && first.source.kind === 'media' && second.source.kind === 'media') {
        const sourceIn = numberOf(first.source.in, 'source.in');
        const sourceOut = numberOf(first.source.out, 'source.out');
        const boundary = sourceIn + (sourceOut - sourceIn) * offset / duration;
        first.source = { ...first.source, out: boundary };
        second.source = { ...second.source, in: boundary };
    }
    found.track.items.splice(found.itemIndex, 1, first, second);
    return value;
}

export function reorderTracks(
    doc: EditV2Document,
    options: { fromIndex: number; toIndex: number }
): EditV2Document {
    const value = cloneDocument(doc);
    const tracks = tracksOf(value);
    for (const index of [options.fromIndex, options.toIndex]) {
        if (!Number.isInteger(index) || index < 0 || index >= tracks.length) {
            throw new Error('トラックの並べ替え位置が範囲外です。');
        }
    }
    if (tracks[options.fromIndex].lane !== tracks[options.toIndex].lane) {
        throw new Error('音と映像のレーンをまたいでトラックを並べ替えることはできません。');
    }
    const [moved] = tracks.splice(options.fromIndex, 1);
    tracks.splice(options.toIndex, 0, moved);
    return value;
}

export function insertTrack(
    doc: EditV2Document,
    options: { index: number; lane: EditV2Lane; name?: string }
): EditV2Document {
    const value = cloneDocument(doc);
    const tracks = tracksOf(value);
    requireInsertIndex(tracks, options.index, options.lane);
    const track: UnknownRecord = {
        id: nextTrackId(tracks, options.lane),
        lane: options.lane,
        ...(options.name === undefined || options.name.trim() === '' ? {} : { name: options.name }),
        items: []
    };
    tracks.splice(options.index, 0, track);
    return value;
}

export function removeTrack(doc: EditV2Document, trackId: string): EditV2Document {
    const value = cloneDocument(doc);
    const tracks = tracksOf(value);
    const index = tracks.findIndex(track => track.id === trackId);
    if (index < 0) throw new Error(`トラックが見つかりません: ${trackId}`);
    tracks.splice(index, 1);
    return value;
}

export function renameTrack(
    doc: EditV2Document,
    options: { trackId: string; name: string }
): EditV2Document {
    const value = cloneDocument(doc);
    const track = trackById(value, options.trackId);
    if (options.name.trim() === '') delete track.name;
    else track.name = options.name;
    return value;
}

/**
 * hidden / muted / locked は現行 v2 の exact な track 語彙に含まれない。
 * そのため edit.json を壊すキーは書かず、呼び出し側が StorageService に保持する。
 * schema へ再導入された時点で、この関数を通常のフィールド更新へ切り替える。
 */
export function setTrackFlag(
    doc: EditV2Document,
    options: { trackId: string; field: EditV2TrackFlag; value: boolean }
): EditV2Document {
    const value = cloneDocument(doc);
    trackById(value, options.trackId);
    return value;
}

function cloneDocument(doc: EditV2Document): EditV2Document {
    if (!isRecord(doc)) throw new Error('edit.json は object である必要があります。');
    const value = cloneValue(doc);
    tracksOf(value);
    return value;
}

function cloneValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(entry => cloneValue(entry)) as T;
    if (isRecord(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)])) as T;
    }
    return value;
}

function tracksOf(doc: EditV2Document): UnknownRecord[] {
    if (!Array.isArray(doc.tracks) || !doc.tracks.every(isRecord)) {
        throw new Error('edit.json.tracks は object の配列である必要があります。');
    }
    return doc.tracks;
}

function audioSfxOf(doc: EditV2Document, create = false): UnknownRecord[] {
    let audio: UnknownRecord;
    if (isRecord(doc.audio)) {
        audio = doc.audio;
    } else {
        if (!create) throw new Error('edit.json.audio が見つかりません。');
        audio = {};
        doc.audio = audio;
    }
    if (Array.isArray(audio.sfx)) {
        if (!audio.sfx.every(isRecord)) {
            throw new Error('edit.json.audio.sfx は object の配列である必要があります。');
        }
        return audio.sfx;
    }
    if (!create) throw new Error('edit.json.audio.sfx が見つかりません。');
    const sfx: UnknownRecord[] = [];
    audio.sfx = sfx;
    return sfx;
}

function audioSfxId(entry: UnknownRecord, index: number): string {
    return typeof entry.id === 'string' && entry.id.trim() ? entry.id : `sfx-${index}`;
}

function findAudioSfxIndex(sfx: UnknownRecord[], sfxId: string): number {
    const index = sfx.findIndex((entry, entryIndex) => audioSfxId(entry, entryIndex) === sfxId);
    if (index < 0) throw new Error(`音声クリップが見つかりません: ${sfxId}`);
    return index;
}

function findAudioSfxIndexOptional(doc: EditV2Document, sfxId: string): number {
    if (!isRecord(doc.audio) || !Array.isArray(doc.audio.sfx)) return -1;
    return doc.audio.sfx.findIndex((entry, index) => isRecord(entry) && audioSfxId(entry, index) === sfxId);
}

function fpsOf(doc: EditV2Document): number {
    if (!isRecord(doc.output) || !Number.isInteger(doc.output.fps) || (doc.output.fps as number) <= 0) {
        throw new Error('edit.json.output.fps が不正です。');
    }
    return doc.output.fps as number;
}

function trackById(doc: EditV2Document, trackId: string): UnknownRecord {
    const track = tracksOf(doc).find(candidate => candidate.id === trackId);
    if (!track) throw new Error(`トラックが見つかりません: ${trackId}`);
    return track;
}

function findItem(tracks: UnknownRecord[], itemId: string): {
    track: UnknownRecord & { items: UnknownRecord[] };
    trackIndex: number;
    item: UnknownRecord;
    itemIndex: number;
} {
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
        const track = tracks[trackIndex];
        if (!Array.isArray(track.items)) continue;
        const itemIndex = track.items.findIndex(item => isRecord(item) && item.id === itemId);
        if (itemIndex >= 0) {
            requireItemsTrack(track, `トラック ${String(track.id ?? trackIndex)}`);
            return { track, trackIndex, item: track.items[itemIndex], itemIndex };
        }
    }
    throw new Error(`クリップが見つかりません: ${itemId}`);
}

function requireItemsTrack(
    track: UnknownRecord,
    label: string
): asserts track is UnknownRecord & { items: UnknownRecord[] } {
    if (!Array.isArray(track.items) || !track.items.every(isRecord)) {
        throw new Error(`${label} はクリップを置けるトラックではありません。`);
    }
}

function requireInsertIndex(tracks: UnknownRecord[], index: number, lane: EditV2Lane): void {
    if (!Number.isInteger(index) || index < 0 || index > tracks.length) {
        throw new Error('トラックの挿入位置が範囲外です。');
    }
    const audioCount = tracks.filter(track => track.lane === 'audio').length;
    const valid = lane === 'audio' ? index <= audioCount : index >= audioCount;
    if (!valid) throw new Error('音のレーンは最下段から動かせません。');
}

function nextTrackId(tracks: UnknownRecord[], lane: EditV2Lane): string {
    const ids = new Set(tracks.map(track => typeof track.id === 'string' ? track.id : ''));
    const prefix = lane === 'audio' ? 'a' : 'v';
    let serial = 1;
    while (ids.has(`${prefix}${serial}`)) serial++;
    return `${prefix}${serial}`;
}

function nextItemId(tracks: UnknownRecord[], base: string): string {
    const ids = new Set(indexEditV2Items({ tracks }).keys());
    if (!ids.has(base)) return base;
    let serial = 2;
    while (ids.has(`${base}-${serial}`)) serial++;
    return `${base}-${serial}`;
}

function mergeNullable(base: UnknownRecord, patch: UnknownRecord): UnknownRecord {
    const result = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined) delete result[key];
        else result[key] = cloneValue(value);
    }
    return result;
}

function recordOf(value: unknown, label: string): UnknownRecord {
    if (!isRecord(value)) throw new Error(`${label} は object である必要があります。`);
    return value;
}

function numberOf(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} は有限数である必要があります。`);
    return value;
}

function stringId(value: UnknownRecord, label: string): string {
    if (typeof value.id !== 'string' || value.id.trim() === '') throw new Error(`${label} id がありません。`);
    return value.id;
}

function requireFrame(value: unknown, label: string): asserts value is number {
    if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label}は 0 以上の整数フレームで指定してください。`);
}

function requireSeconds(value: unknown, label: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`${label} は 0 以上の秒で指定してください。`);
    }
}

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
