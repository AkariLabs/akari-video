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
        const matchingSourceExists = visualTracks(edit).some(track => track.items.some(item =>
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
