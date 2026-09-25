import { EditV2, HtmlSourceV2, ItemV2, readEditV2 } from './edit-v2';
import { effectiveScale, normalizeTransform } from './transform';
import { writeItemTransformAt } from './transform-keyframe-edit';
import { invertItemMotionPosition } from '../../overlay-runtime/src/item-motion.js';
import { replaceXYKeyframes } from './motion-keyframe-replace';
import { writeItemPositionAt } from './motion-position-write';

type UnknownRecord = Record<string, unknown>;

export interface PreviewItemTransformPatch {
    x?: number;
    y?: number;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    rotate?: number;
}

export interface PreviewItemCropPatch {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface PreviewItemPerspectivePatch {
    corners: [number, number][];
}

export type PreviewItemWriteCommand = (
    | {
        kind: 'overlay';
        itemId: string;
        patch: {
            vars?: UnknownRecord;
            transform?: PreviewItemTransformPatch;
            html?: string;
            text?: string;
            params?: Record<string, string>;
            xyKeyframes?: { t: number; transform: { x: number; y: number } }[];
        };
    }
    | {
        kind: 'layer';
        itemId: string;
        patch: {
            transform?: PreviewItemTransformPatch;
            crop?: PreviewItemCropPatch;
            perspective?: PreviewItemPerspectivePatch | null;
            xyKeyframes?: { t: number; transform: { x: number; y: number } }[];
        };
    }
    | {
        kind: 'cut';
        /** v2 の安定 identity。legacy では legacyIndex だけを使う。 */
        itemId?: string;
        legacyIndex: number;
        patch: {
            transform?: PreviewItemTransformPatch;
            /** 出力プレビューの辺バークロップ。cuts[] に crop の席があるのは v2 だけ。 */
            crop?: PreviewItemCropPatch;
            xyKeyframes?: { t: number; transform: { x: number; y: number } }[];
        };
    }) & { playheadSeconds?: number };

export interface PreviewItemWriteResolution {
    /** edit.json を更新する patch があるときだけ返す。 */
    candidateText?: string;
    /** html patch の書き込み先。本文自体は edit.json へ入れない。 */
    htmlPath?: string;
}

const isRecord = (value: unknown): value is UnknownRecord =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const recordOf = (value: unknown): UnknownRecord => isRecord(value) ? value : {};

const stringifyEdit = (value: unknown): string => `${JSON.stringify(value, undefined, 2)}\n`;

const transformKeys = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'] as const;

function mergeTransform(original: unknown, patch: PreviewItemTransformPatch): PreviewItemTransformPatch {
    const merged = normalizeTransform({ ...recordOf(original), ...patch });
    if (merged.scaleX !== undefined || merged.scaleY !== undefined) {
        const axes = effectiveScale(merged);
        merged.scaleX = axes.x;
        merged.scaleY = axes.y;
    }
    const ordered: PreviewItemTransformPatch = {};
    for (const key of transformKeys) {
        if (merged[key] !== undefined) ordered[key] = merged[key];
    }
    for (const [key, value] of Object.entries(merged)) {
        if (!transformKeys.includes(key as typeof transformKeys[number])) (ordered as UnknownRecord)[key] = value;
    }
    return ordered;
}

/**
 * 出力プレビューの item 書き戻しを、版判定を含む読み込み層 1 箇所へ閉じ込める。
 * 呼び出し側は v2 / legacy を知らず、返された edit.json 候補と HTML 参照先だけを扱う。
 */
export function resolvePreviewItemWrite(
    editText: string,
    command: PreviewItemWriteCommand
): PreviewItemWriteResolution {
    const parsed: unknown = JSON.parse(editText);
    if (!isRecord(parsed)) {
        throw new Error('edit.json が object ではありません');
    }
    return parsed.version === 2
        ? resolveV2Write(parsed, command)
        : resolveLegacyWrite(parsed, command);
}

/** Resolve all commands in memory. The caller lints and persists the final document once.
 * External HTML writes cannot participate in this single-document transaction.
 */
export function resolvePreviewItemWriteBatch(
    editText: string,
    commands: PreviewItemWriteCommand[]
): PreviewItemWriteResolution {
    if (!Array.isArray(commands) || commands.length === 0) {
        throw new Error('書き込みバッチが空です');
    }
    let candidateText = editText;
    for (const command of commands) {
        if (command.kind === 'overlay' && 'html' in command.patch) {
            throw new Error('バッチでは外部 HTML 本文を書き込めません');
        }
        const resolved = resolvePreviewItemWrite(candidateText, command);
        candidateText = resolved.candidateText ?? candidateText;
    }
    return { candidateText };
}

function resolveV2Write(
    parsed: UnknownRecord,
    command: PreviewItemWriteCommand
): PreviewItemWriteResolution {
    // strict reader を front door にして、legacy 文書や壊れた v2 を更新対象へ入れない。
    readEditV2(parsed);
    const edit = parsed as unknown as EditV2;
    const itemId = command.itemId;
    if (!itemId) {
        throw new Error('v2 アイテムの id を特定できません');
    }
    type Located = { item: ItemV2; ancestors: ItemV2[] };
    const children = (item: ItemV2): ItemV2[] => item.items
        ?? (Array.isArray((item as unknown as UnknownRecord).children)
            ? (item as unknown as { children: ItemV2[] }).children : []);
    const find = (items: ItemV2[], id: string, ancestors: ItemV2[] = []): Located | undefined => {
        for (const candidate of items) {
            if (candidate.id === id) return { item: candidate, ancestors };
            const nested = find(children(candidate), id, [...ancestors, candidate]);
            if (nested) return nested;
        }
        return undefined;
    };
    const roots = edit.tracks.flatMap(track => track.lane === 'visual' && 'items' in track ? track.items : []);
    // Only overlay writes gain recursive addressing. Other preview systems keep
    // their existing addressing/coordinate contract.
    let target = command.kind === 'overlay' ? find(roots, itemId)
        : roots.filter(candidate => candidate.id === itemId).map(item => ({ item, ancestors: [] as ItemV2[] }))[0];
    let materialized = false;
    if (!target && command.kind === 'overlay' && itemId.includes('#')) {
        const separator = itemId.lastIndexOf('#');
        const bag = find(roots, itemId.slice(0, separator));
        const part = itemId.slice(separator + 1);
        if (bag?.item.source.kind === 'html' && !bag.item.source.part && part
            && !bag.item.source.exclude?.includes(part)) {
            const existing = children(bag.item).find(child => child.source.kind === 'html' && child.source.part === part);
            if (existing) target = { item: existing, ancestors: [...bag.ancestors, bag.item] };
            else {
                // Object-tree contract §1.3: touched projections become explicit
                // children; §3.1: materialize the projection. Do not exclude it.
                const ids = new Set<string>();
                const collect = (items: ItemV2[]): void => {
                    for (const entry of items) { ids.add(entry.id); collect(children(entry)); }
                };
                for (const track of edit.tracks) if ('items' in track) collect(track.items as ItemV2[]);
                const base = `${bag.item.id}.${part}`;
                let id = base;
                for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
                const child: ItemV2 = {
                    id, at: 0, duration: bag.item.duration,
                    source: { kind: 'html', path: bag.item.source.path, part }
                };
                (bag.item.items ??= []).push(child);
                target = { item: child, ancestors: [...bag.ancestors, bag.item] };
                materialized = true;
            }
        }
    }
    if (!target) throw new Error(`アイテムが見つかりません: ${itemId}`);
    const item = target.item;
    const writeTransform = (patch: PreviewItemTransformPatch): void => {
        const seconds = command.playheadSeconds;
        const positionOnly = Object.keys(patch).length > 0
            && Object.keys(patch).every(key => key === 'x' || key === 'y');
        if (positionOnly) {
            const start = [...target!.ancestors, item].reduce((sum, entry) => sum + entry.at, 0);
            const frame = Number.isFinite(seconds)
                ? Math.max(0, Math.min(item.duration, Math.round((seconds as number) * edit.output.fps) - start)) : 0;
            const updated = writeItemPositionAt(item, frame, patch);
            item.transform = updated.transform;
            item.keyframes = updated.keyframes;
            return;
        }
        if (Number.isFinite(seconds) && Array.isArray(item.keyframes)
            && item.keyframes.some(point => point.transform)) {
            const start = [...target!.ancestors, item].reduce((sum, entry) => sum + entry.at, 0);
            const frame = Math.round((seconds as number) * edit.output.fps) - start;
            const updated = writeItemTransformAt(item, frame, patch);
            item.transform = updated.transform;
            item.keyframes = updated.keyframes;
        } else {
            item.transform = mergeTransform(item.transform, patch);
        }
    };
    if (command.kind === 'overlay') {
        if ('text' in command.patch) {
            if (typeof command.patch.text !== 'string') {
                throw new Error('部品の text は文字列である必要があります');
            }
            if (item.source.kind !== 'html' || !item.source.part) {
                throw new Error(`部品でないアイテムには text を書き戻せません: ${itemId}`);
            }
        }
        if (item.source.kind === 'html' && item.source.part && 'html' in command.patch) {
            throw new Error(`部品の文字は source.text に保存します: ${itemId}`);
        }
        // parts.mjs composes groups, but a bag supplies per-key defaults that
        // its part overrides. Only group ancestors form an invertible parent.
        // Preserve the original top-level merge/serialization byte for byte.
        if (command.patch.transform && (target.ancestors.length || item.motion || item.keyframes?.length)) {
            const compose = (parent: Required<Pick<PreviewItemTransformPatch, 'x' | 'y' | 'scale' | 'rotate'>>, child: PreviewItemTransformPatch = {}): Required<Pick<PreviewItemTransformPatch, 'x' | 'y' | 'scale' | 'rotate'>> => {
                const angle = parent.rotate * Math.PI / 180;
                const x = child.x ?? 0, y = child.y ?? 0;
                return {
                    x: parent.x + parent.scale * (Math.cos(angle) * x - Math.sin(angle) * y),
                    y: parent.y + parent.scale * (Math.sin(angle) * x + Math.cos(angle) * y),
                    scale: parent.scale * (child.scale ?? 1), rotate: parent.rotate + (child.rotate ?? 0)
                };
            };
            const parent = target.ancestors.filter(ancestor => ancestor.source.kind === 'group')
                .reduce((world, ancestor) => compose(world, ancestor.transform), { x: 0, y: 0, scale: 1, rotate: 0 });
            if (!Number.isFinite(parent.scale) || parent.scale === 0) {
                throw new Error(`親の変形を逆変換できません: ${itemId}`);
            }
            const patch = command.patch.transform;
            const bag = target.ancestors[target.ancestors.length - 1];
            const bagDefaults = item.source.kind === 'html' && item.source.part && bag?.source.kind === 'html'
                ? bag.transform : undefined;
            const world = { ...compose(parent, { ...bagDefaults, ...item.transform }), ...patch };
            const local: PreviewItemTransformPatch = {};
            if (patch.x !== undefined || patch.y !== undefined) {
                const fps = edit.output.fps;
                let at = 0;
                const ancestors = target.ancestors.filter(ancestor => ancestor.source.kind === 'group');
                const parentChain = ancestors.map(ancestor => {
                    at += ancestor.at;
                    return { at: at / fps, duration: ancestor.duration / fps, fps,
                        transform: ancestor.transform, opacity: ancestor.opacity,
                        keyframes: ancestor.keyframes, motion: ancestor.motion };
                }).reverse();
                const currentAt = [...target!.ancestors, item].reduce((sum, entry) => sum + entry.at, 0);
                const base = invertItemMotionPosition({ at: currentAt / fps,
                    duration: item.duration / fps, fps, transform: item.transform,
                    opacity: item.opacity, keyframes: item.keyframes, motion: item.motion },
                command.playheadSeconds ?? currentAt / fps, parentChain, world.x, world.y);
                local.x = base.x;
                local.y = base.y;
            }
            if (patch.scale !== undefined) local.scale = world.scale / parent.scale;
            if (patch.scaleX !== undefined) local.scaleX = patch.scaleX / parent.scale;
            if (patch.scaleY !== undefined) local.scaleY = patch.scaleY / parent.scale;
            if (patch.rotate !== undefined) local.rotate = world.rotate - parent.rotate;
            command = { ...command, patch: { ...command.patch, transform: local } };
        }
        if (item.source.kind === 'group') {
            if (command.patch.html !== undefined || command.patch.vars !== undefined || command.patch.params !== undefined) {
                throw new Error(`グループアイテムには HTML 本文・vars・HTML params を書き戻せません: ${itemId}`);
            }
            if (command.patch.xyKeyframes) item.keyframes = replaceXYKeyframes(item.keyframes,
                command.patch.xyKeyframes, item.duration);
            if (command.patch.transform) writeTransform(command.patch.transform);
            if (!command.patch.transform && !command.patch.xyKeyframes) return {};
            return { candidateText: stringifyEdit(edit) };
        }
    }

    let htmlPath: string | undefined;
    let editChanged = materialized;
    if (command.kind === 'overlay') {
        if (item.source.kind !== 'html' && item.source.kind !== 'shape') {
            throw new Error(`HTML/図形アイテムではありません: ${itemId}`);
        }
        if (item.source.kind === 'html') {
            const source = item.source as HtmlSourceV2;
            if (typeof command.patch.text === 'string') {
                source.text = command.patch.text;
                editChanged = true;
            }
            if (typeof command.patch.html === 'string') {
                htmlPath = source.path;
            }
            if (command.patch.params) {
                for (const [name, value] of Object.entries(command.patch.params)) {
                    if (!name || typeof value !== 'string') {
                        throw new Error('HTML params は空でないキーと文字列値である必要があります');
                    }
                }
                source.params = { ...source.params, ...command.patch.params };
                editChanged = true;
            }
            if (command.patch.vars) {
                source.vars = { ...recordOf(source.vars), ...command.patch.vars };
                editChanged = true;
            }
        } else if (command.patch.html !== undefined || command.patch.params !== undefined || command.patch.vars !== undefined) {
            throw new Error(`図形アイテムには HTML 本文・vars・HTML params を書き戻せません: ${itemId}`);
        }
        if (command.patch.transform) {
            writeTransform(command.patch.transform);
            editChanged = true;
        }
        if (command.patch.xyKeyframes) {
            item.keyframes = replaceXYKeyframes(item.keyframes, command.patch.xyKeyframes, item.duration);
            editChanged = true;
        }
    } else if (command.kind === 'layer') {
        if (command.patch.xyKeyframes) {
            item.keyframes = replaceXYKeyframes(item.keyframes, command.patch.xyKeyframes, item.duration);
            editChanged = true;
        }
        if (command.patch.transform) {
            writeTransform(command.patch.transform);
            editChanged = true;
        }
        if (command.patch.crop) {
            item.crop = { ...command.patch.crop };
            editChanged = true;
        }
        if (command.patch.perspective !== undefined) {
            if (command.patch.perspective === null) {
                delete item.perspective;
            } else {
                item.perspective = {
                    corners: command.patch.perspective.corners.map(([x, y]) => [x, y])
                };
            }
            editChanged = true;
        }
    } else {
        if (item.source.kind !== 'media') {
            throw new Error(`映像アイテムではありません: ${itemId}`);
        }
        if (command.patch.xyKeyframes) {
            item.keyframes = replaceXYKeyframes(item.keyframes, command.patch.xyKeyframes, item.duration);
            editChanged = true;
        }
        if (command.patch.transform) {
            writeTransform(command.patch.transform);
            editChanged = true;
        }
        if (command.patch.crop) {
            item.crop = { ...command.patch.crop };
            editChanged = true;
        }
    }
    return {
        ...(editChanged ? { candidateText: stringifyEdit(edit) } : {}),
        ...(htmlPath !== undefined ? { htmlPath } : {})
    };
}

function resolveLegacyWrite(
    edit: UnknownRecord,
    command: PreviewItemWriteCommand
): PreviewItemWriteResolution {
    if (command.kind === 'overlay') {
        if (!Array.isArray(edit.overlays)) {
            throw new Error('edit.json の overlays が配列ではありません');
        }
        const overlay = edit.overlays.find(value =>
            isRecord(value) && String(value.id) === command.itemId);
        if (!isRecord(overlay)) {
            throw new Error(`オーバーレイが見つかりません: ${command.itemId}`);
        }
        const htmlPath = typeof command.patch.html === 'string'
            ? (typeof overlay.html === 'string' ? overlay.html : undefined)
            : undefined;
        if (typeof command.patch.html === 'string' && !htmlPath) {
            throw new Error(`overlays[].html がファイル参照ではありません: ${command.itemId}`);
        }
        let editChanged = false;
        if (command.patch.params) {
            throw new Error('HTML params の書き戻しには edit.json version 2 が必要です');
        }
        if (command.patch.vars) {
            overlay.vars = { ...recordOf(overlay.vars), ...command.patch.vars };
            editChanged = true;
        }
        if (command.patch.transform) {
            overlay.transform = mergeTransform(overlay.transform, command.patch.transform);
            editChanged = true;
        }
        return {
            ...(editChanged ? { candidateText: stringifyEdit(edit) } : {}),
            ...(htmlPath !== undefined ? { htmlPath } : {})
        };
    }

    if (command.kind === 'layer') {
        if (!Array.isArray(edit.layers)) {
            throw new Error('edit.json の layers が配列ではありません');
        }
        const layer = edit.layers.find(value =>
            isRecord(value) && String(value.id) === command.itemId);
        if (!isRecord(layer)) {
            throw new Error(`素材が見つかりません: ${command.itemId}`);
        }
        if (command.patch.transform) {
            layer.transform = mergeTransform(layer.transform, command.patch.transform);
        }
        if (command.patch.crop) {
            layer.crop = { ...command.patch.crop };
        }
        if (command.patch.perspective !== undefined) {
            if (command.patch.perspective === null) {
                delete layer.perspective;
            } else {
                layer.perspective = {
                    corners: command.patch.perspective.corners.map(([x, y]) => [x, y])
                };
            }
        }
        return { candidateText: stringifyEdit(edit) };
    }

    if (!Array.isArray(edit.cuts)) {
        throw new Error('edit.json の cuts が配列ではありません');
    }
    const cut = edit.cuts[command.legacyIndex];
    if (!isRecord(cut)) {
        throw new Error(`カットが見つかりません: index ${command.legacyIndex}`);
    }
    // cutV0 / cutV1 schema に crop の席が無いので、legacy 文書へは書けない（黙って捨てない）。
    if (command.patch.crop) {
        throw new Error('カットの crop 書き戻しには edit.json version 2 が必要です');
    }
    if (command.patch.transform) {
        cut.transform = mergeTransform(cut.transform, command.patch.transform);
    }
    return { candidateText: stringifyEdit(edit) };
}
