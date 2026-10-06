/** Source-time selection stays local; retained pieces share the ripple kernel's slicing rule. */
import {
    computeCutTrackSegments,
    deleteCutInSource,
    setCutAtValuesInSource,
    splitCutInSource,
    trimCutInSource,
    type EditCut,
} from './edit-store';
import { readEditV2, type EditV2, type ItemV2, type MediaItemV2, type VisualItemsTrackV2 } from './edit-v2';
import { compactTrackGaps, removeTimelineItemRange } from './ripple';

export interface CutRange {
    in: number;
    out: number;
    kind: 'row' | 'filler' | 'silence' | 'unrecognized';
    captionId?: string;
    reason?: 'silence' | 'word';
    label?: string;
}

export interface ApplyCutRangesOptions {
    fps?: number;
}

export interface ApplyCutRangesResult {
    source: string;
    removedFrames: number;
    warnings: string[];
}

export interface RestoreCutRangeResult {
    source: string;
    restored: boolean;
    reason?: string;
}

const LEGACY_EDGE_SECONDS = 0.15;

export function detectEditVersion(source: string): 0 | 1 | 2 {
    const version = (JSON.parse(source) as { version?: unknown }).version;
    if (typeof version !== 'number' || !new Set<number>([0, 1, 2]).has(version)) {
        throw new Error('edit.json.version は 0・1・2 のいずれかである必要があります。');
    }
    return version as 0 | 1 | 2;
}

export function applyCutRanges(
    source: string,
    ranges: readonly CutRange[],
    opts: ApplyCutRangesOptions = {}
): ApplyCutRangesResult {
    const version = detectEditVersion(source);
    const normalized = normalizeRanges(ranges);
    if (normalized.length === 0) return { source, removedFrames: 0, warnings: [] };
    return version === 2
        ? applyV2(source, normalized, opts)
        : applyLegacy(source, normalized, opts);
}

function applyLegacy(
    initialSource: string,
    ranges: readonly CutRange[],
    opts: ApplyCutRangesOptions
): ApplyCutRangesResult {
    let source = initialSource;
    let removedFrames = 0;
    const warnings: string[] = [];
    const affectedTracks = new Set<number>();
    const parsed = JSON.parse(initialSource) as { fps?: number; output?: { fps?: number } };
    const fps = requireFps(opts.fps ?? parsed.output?.fps ?? parsed.fps ?? 30);

    for (const range of ranges) {
        const before = readLegacyCuts(source);
        let matched = false;
        for (let index = before.cuts.length - 1; index >= 0; index--) {
            const cut = before.cuts[index];
            const overlapIn = Math.max(cut.in, range.in);
            const overlapOut = Math.min(cut.out, range.out);
            if (!(overlapOut > overlapIn)) continue;
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
                source = deleteCutInSource(source, index).source;
            } else if (keepBefore < LEGACY_EDGE_SECONDS) {
                source = trimCutInSource(source, index, effectiveOut, cut.out);
            } else if (keepAfter < LEGACY_EDGE_SECONDS) {
                source = trimCutInSource(source, index, cut.in, effectiveIn);
            } else {
                source = splitCutInSource(source, index, effectiveIn);
                source = splitCutInSource(source, index + 1, effectiveOut);
                source = deleteCutInSource(source, index + 1).source;
            }
            if (range.reason !== undefined || range.label !== undefined) {
                source = annotateLegacySegments(source, cut, effectiveIn, effectiveOut, range);
            }
        }
        if (!matched) warnings.push(`カット対象が見つかりません: ${range.in}–${range.out}`);
    }

    // deleteCutInSource は後続の暗黙 at を凍結する。対象トラックだけ暗黙カーソルへ
    // 戻すことで、元から別レーンにある cuts の位置を動かさずリップルさせる。
    if (affectedTracks.size > 0) {
        const after = readLegacyCuts(source);
        source = setCutAtValuesInSource(source, after.cuts.flatMap((cut, cutIndex) =>
            affectedTracks.has(normalizeTrack(cut.track)) ? [{ cutIndex, at: null }] : []));
    }
    return { source, removedFrames, warnings };
}

function applyV2(
    source: string,
    ranges: readonly CutRange[],
    opts: ApplyCutRangesOptions
): ApplyCutRangesResult {
    const raw = JSON.parse(source) as EditV2;
    const validated = readEditV2(raw);
    requireFps(opts.fps ?? validated.output.fps);
    const edit = JSON.parse(JSON.stringify(raw)) as EditV2;
    const warnings: string[] = [];
    const affectedTrackIds = new Set<string>();
    let removedFrames = 0;

    for (const range of ranges) {
        const matchingSourceExists = edit.sources.some(candidate => candidate.id === range.captionId)
            || visualTracks(edit).some(track => track.items.some(item =>
                item.source.kind === 'media' && item.source.src === range.captionId));
        let matched = false;
        for (const track of visualTracks(edit)) {
            for (let index = track.items.length - 1; index >= 0; index--) {
                const item = track.items[index];
                if (item.source.kind !== 'media') continue;
                if (matchingSourceExists && item.source.src !== range.captionId) continue;
                const overlapIn = Math.max(item.source.in, range.in);
                const overlapOut = Math.min(item.source.out, range.out);
                if (!(overlapOut > overlapIn)) continue;
                matched = true;
                affectedTrackIds.add(track.id);
                const replacement = splitAndRemove(item, overlapIn, overlapOut, edit);
                for (const replacementItem of replacement.items) {
                    copyRangeMetadata(replacementItem as ItemV2 & { reason?: 'silence' | 'word'; label?: string }, range);
                }
                removedFrames += replacement.removedFrames;
                track.items.splice(index, 1, ...replacement.items);
            }
        }
        if (!matched) warnings.push(`カット対象が見つかりません: ${range.in}–${range.out}`);
    }

    const modeOverride = Object.fromEntries(edit.tracks.map(track =>
        [track.id, affectedTrackIds.has(track.id) ? 'cut' : 'fixed'] as const));
    const compacted = compactTrackGaps(edit, { modeOverride, includeAnchored: true }).edit;
    readEditV2(compacted);
    return { source: `${JSON.stringify(compacted, null, 2)}\n`, removedFrames, warnings };
}

const RESTORE_UNAVAILABLE = 'この箇所のあとに編集があるため戻せません。⌘Z の履歴から戻せます。';
const RESTORE_LEGACY = '古い形式の編集データのため戻せません。⌘Z の履歴から戻せます。';
const RESTORE_APPEARANCE = '動きや見た目の設定があるため 1 か所だけは戻せません。⌘Z の履歴から戻せます。';
const RESTORE_PROVENANCE = '切った部分の元の設定が編集データに残っていないため 1 か所だけは戻せません。⌘Z の履歴から戻せます。';
const SOURCE_TOLERANCE = 1e-5;

function near(left: number, right: number): boolean {
    return Math.abs(left - right) <= SOURCE_TOLERANCE;
}

function media(item: ItemV2): item is MediaItemV2 {
    return item.source.kind === 'media';
}

function sameSplitProperties(left: MediaItemV2, right: MediaItemV2): boolean {
    const comparable = (item: MediaItemV2): string => {
        const copy = structuredClone(item) as unknown as Record<string, unknown>;
        for (const key of ['id', 'at', 'duration', 'reason', 'label', 'anchor']) delete copy[key];
        const source = copy.source as Record<string, unknown>;
        delete source.in;
        delete source.out;
        return JSON.stringify(copy);
    };
    return comparable(left) === comparable(right);
}

function sameAppearance(left: MediaItemV2, right: MediaItemV2): boolean {
    const appearance = (item: MediaItemV2): string => {
        const copy = structuredClone(item) as unknown as Record<string, unknown>;
        for (const key of ['id', 'name', 'locked', 'at', 'duration', 'reason', 'label', 'anchor']) delete copy[key];
        const source = copy.source as Record<string, unknown>;
        delete source.in;
        delete source.out;
        return JSON.stringify(copy);
    };
    return appearance(left) === appearance(right);
}

function hasTimedAppearance(item: MediaItemV2): boolean {
    return !!(item.keyframes?.length || item.animator?.length || item.motion
        || item.items?.length);
}

function sameCutResult(left: VisualItemsTrackV2, right: VisualItemsTrackV2): boolean {
    const comparable = (track: VisualItemsTrackV2): unknown[] => track.items.map(item => {
        const copy = structuredClone(item) as unknown as Record<string, unknown>;
        for (const key of ['id', 'reason', 'label', 'anchor']) delete copy[key];
        return copy;
    });
    const sameValue = (a: unknown, b: unknown): boolean => {
        if (typeof a === 'number' && typeof b === 'number') return near(a, b);
        if (a === b) return true;
        if (Array.isArray(a) && Array.isArray(b)) {
            return a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
        }
        if (a && b && typeof a === 'object' && typeof b === 'object') {
            const keys = Object.keys(a);
            return keys.length === Object.keys(b).length
                && keys.every(key => Object.prototype.hasOwnProperty.call(b, key)
                    && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
        }
        return false;
    };
    return sameValue(comparable(left), comparable(right));
}

function restoreOneTrack(
    edit: EditV2, trackIndex: number, range: Pick<CutRange, 'in' | 'out' | 'captionId' | 'reason' | 'label'>
): { track?: VisualItemsTrackV2; reason?: string } {
    const original = edit.tracks[trackIndex] as VisualItemsTrackV2;
    const items = original.items;
    const sourceMatches = (item: ItemV2): item is MediaItemV2 => media(item)
        && (range.captionId === undefined || item.source.src === range.captionId);
    const leftIndices = items.flatMap((item, index) => sourceMatches(item) && near(item.source.out, range.in) ? [index] : []);
    const rightIndices = items.flatMap((item, index) => sourceMatches(item) && near(item.source.in, range.out) ? [index] : []);
    if (leftIndices.length > 1 || rightIndices.length > 1) return {};
    const leftIndex = leftIndices[0];
    const rightIndex = rightIndices[0];
    if (leftIndex === undefined && rightIndex === undefined) return {};
    const left = leftIndex === undefined ? undefined : items[leftIndex] as MediaItemV2;
    const right = rightIndex === undefined ? undefined : items[rightIndex] as MediaItemV2;
    if (!left || !right || leftIndex === undefined || rightIndex === undefined
        || !right.id.startsWith(`${left.id}-split`)) return { reason: RESTORE_PROVENANCE };
    if (rightIndex <= leftIndex || right.at !== left.at + left.duration) return {};
    if (hasTimedAppearance(left) || hasTimedAppearance(right)) {
        return { reason: RESTORE_APPEARANCE };
    }
    if (!sameSplitProperties(left, right)) {
        return { reason: sameAppearance(left, right) ? RESTORE_UNAVAILABLE : RESTORE_APPEARANCE };
    }
    const template = left;
    const sourceSpan = template.source.out - template.source.in;
    if (!(sourceSpan > 0)) return {};
    const estimated = Math.round((range.out - range.in) * template.duration / sourceSpan);
    const candidates = [estimated, estimated - 1, estimated + 1, estimated - 2, estimated + 2]
        .filter((frames, index, all) => frames > 0 && all.indexOf(frames) === index);
    for (const frames of candidates) {
        const candidate = structuredClone(edit);
        const track = candidate.tracks[trackIndex] as VisualItemsTrackV2;
        const target = track.items;
        const boundary = left.at + left.duration;
        const merged = structuredClone(left);
        merged.duration = left.duration + frames + right.duration;
        merged.source.out = right.source.out;
        const leftMeta = left as MediaItemV2 & { reason?: string; label?: string };
        const rightMeta = right as MediaItemV2 & { reason?: string; label?: string };
        const mergedMeta = merged as MediaItemV2 & { reason?: string; label?: string };
        if (leftMeta.reason === rightMeta.reason
            || range.reason !== undefined && leftMeta.reason === range.reason) delete mergedMeta.reason;
        if (leftMeta.label === rightMeta.label
            || range.label !== undefined && leftMeta.label === range.label) delete mergedMeta.label;
        target.splice(leftIndex, 1, merged);
        target.splice(rightIndex, 1);
        for (let index = 0; index < target.length; index++) {
            if (index === leftIndex) continue;
            const item = target[index];
            if (media(item) && item.at >= boundary) item.at += frames;
        }
        const trial = applyV2(`${JSON.stringify(candidate, null, 2)}\n`,
            [{ ...range, kind: 'row' }], {});
        const replay = (JSON.parse(trial.source) as EditV2).tracks[trackIndex] as VisualItemsTrackV2;
        if (sameCutResult(replay, original)) return { track };
    }
    return {};
}

/** Inverts one source-time cut from the surviving media items, without a stored snapshot. */
export function restoreCutRange(
    source: string, range: Pick<CutRange, 'in' | 'out' | 'captionId' | 'reason' | 'label'>
): RestoreCutRangeResult {
    if (detectEditVersion(source) !== 2) {
        return { source, restored: false, reason: RESTORE_LEGACY };
    }
    if (!(range.out > range.in)) {
        return { source, restored: false, reason: RESTORE_UNAVAILABLE };
    }
    const edit = JSON.parse(source) as EditV2;
    readEditV2(edit);
    const restored = structuredClone(edit);
    let changed = false;
    for (let index = 0; index < edit.tracks.length; index++) {
        const track = edit.tracks[index];
        if (track.lane !== 'visual' || !('items' in track)) continue;
        const hasEdge = track.items.some(item => media(item) && (!range.captionId || item.source.src === range.captionId)
            && (near(item.source.out, range.in) || near(item.source.in, range.out)));
        if (!hasEdge) continue;
        const next = restoreOneTrack(edit, index, range);
        if (!next.track) return { source, restored: false, reason: next.reason ?? RESTORE_UNAVAILABLE };
        restored.tracks[index] = next.track;
        changed = true;
    }
    if (!changed) return { source, restored: false, reason: RESTORE_UNAVAILABLE };
    readEditV2(restored);
    return { source: `${JSON.stringify(restored, null, 2)}\n`, restored: true };
}

export function canRestoreCutRange(
    source: string, range: Pick<CutRange, 'in' | 'out' | 'captionId' | 'reason' | 'label'>
): string | undefined {
    const result = restoreCutRange(source, range);
    return result.restored ? undefined : result.reason;
}

function copyRangeMetadata(target: { reason?: 'silence' | 'word'; label?: string }, range: CutRange): void {
    if (range.reason !== undefined) target.reason = range.reason;
    if (range.label !== undefined) target.label = range.label;
}

function annotateLegacySegments(source: string, original: EditCut, removedIn: number, removedOut: number, range: CutRange): string {
    const edit = JSON.parse(source) as { cuts?: Array<EditCut & { reason?: 'silence' | 'word'; label?: string }> };
    if (!Array.isArray(edit.cuts)) return source;
    const originalTrack = normalizeTrack(original.track);
    for (const cut of edit.cuts) {
        if (normalizeTrack(cut.track) !== originalTrack || cut.src !== original.src) continue;
        if (cut.in < original.in || cut.out > original.out) continue;
        if (cut.out <= removedIn || cut.in >= removedOut) copyRangeMetadata(cut, range);
    }
    return `${JSON.stringify(edit, null, 2)}\n`;
}

function splitAndRemove(
    item: ItemV2,
    overlapIn: number,
    overlapOut: number,
    edit: EditV2
): { items: ItemV2[]; removedFrames: number } {
    if (item.source.kind !== 'media') return { items: [item], removedFrames: 0 };
    const mediaItem = item as MediaItemV2;
    const sourceDuration = mediaItem.source.out - mediaItem.source.in;
    if (!(sourceDuration > 0) || !(item.duration > 0)) {
        return { items: [item], removedFrames: 0 };
    }
    const startOffset = clampFrame(Math.round((overlapIn - mediaItem.source.in) / sourceDuration * mediaItem.duration), mediaItem.duration);
    const endOffset = clampFrame(Math.round((overlapOut - mediaItem.source.in) / sourceDuration * mediaItem.duration), mediaItem.duration);
    if (endOffset <= startOffset) return { items: [item], removedFrames: 0 };

    const ids = new Set<string>();
    for (const track of edit.tracks) if ('items' in track) for (const candidate of track.items) collectIds(candidate as ItemV2, ids);
    const items = removeTimelineItemRange(mediaItem,
        { start: mediaItem.at + startOffset, end: mediaItem.at + endOffset }, edit.output.fps, ids);
    return { items, removedFrames: endOffset - startOffset };
}

function collectIds(item: ItemV2, ids: Set<string>): void {
    ids.add(item.id);
    for (const child of item.items ?? []) collectIds(child, ids);
}

function visualTracks(edit: EditV2): VisualItemsTrackV2[] {
    return edit.tracks.filter((track): track is VisualItemsTrackV2 => track.lane === 'visual' && 'items' in track);
}

function readLegacyCuts(source: string): { cuts: EditCut[]; segments: ReturnType<typeof computeCutTrackSegments> } {
    const parsed = JSON.parse(source) as { cuts?: EditCut[] };
    const cuts = Array.isArray(parsed.cuts) ? parsed.cuts : [];
    return { cuts, segments: computeCutTrackSegments(cuts) };
}

function normalizeRanges(ranges: readonly CutRange[]): CutRange[] {
    return ranges.map(range => {
        if (!Number.isFinite(range.in) || !Number.isFinite(range.out) || range.in < 0 || range.out <= range.in) {
            throw new Error('カット範囲が不正です。');
        }
        return { ...range };
    }).sort((left, right) => right.in - left.in || right.out - left.out);
}

function normalizeTrack(track: number | undefined): number {
    return Number.isInteger(track) && (track as number) >= 0 ? track as number : 0;
}

function validSpeed(speed: number | undefined): number {
    return typeof speed === 'number' && Number.isFinite(speed) && speed > 0 ? speed : 1;
}

function requireFps(value: number): number {
    if (!Number.isFinite(value) || value <= 0) throw new Error('fps が不正です。');
    return value;
}

function clampFrame(value: number, duration: number): number {
    return Math.max(0, Math.min(duration, value));
}
