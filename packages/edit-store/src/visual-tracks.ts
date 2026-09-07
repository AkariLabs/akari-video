import { EditTimelineTrack, EditCut, EditLayer, computeCutTrackSegments, moveCutInSource, moveLayerInSource, parseEdit, writeTimelineTracksInSource } from './edit-store';

export function isVisualMediaTrack(track: EditTimelineTrack): boolean {
    return track.kind === 'video' || track.kind === 'cuts' || track.kind === 'layers';
}

export type VisualItem = { kind: 'cut'; index: number } | { kind: 'layer'; id: string };
export interface VisualInterval {
    item: VisualItem;
    key: string;
    rowId: string;
    start: number;
    end: number;
}
export type VisualMovePlan =
    | { accepted: false; reason: string }
    | { accepted: true; original: VisualInterval; targetId: string; time: number };

const itemKey = (item: VisualItem): string => item.kind === 'cut' ? `cut:${item.index}` : `layer:${item.id}`;
export const visualIntervalsOverlap = (start: number, end: number, other: { start: number; end: number }): boolean =>
    Math.min(end, other.end) - Math.max(start, other.start) > 1e-6;

/** One visual row may contain consecutive media, but never simultaneous media. */
export function visualTrackIntervals(cuts: readonly EditCut[], layers: readonly EditLayer[], tracks: readonly EditTimelineTrack[]): VisualInterval[] {
    const result: VisualInterval[] = [];
    const append = (item: VisualItem, kind: 'cuts' | 'layers', ref: number, start: number, end: number): void => {
        const row = tracks.find(track => (track.kind === kind || track.kind === 'video') && (track.ref ?? 0) === ref);
        if (row) result.push({ item, key: itemKey(item), rowId: row.id, start, end });
    };
    computeCutTrackSegments(cuts).forEach(segment => append({ kind: 'cut', index: segment.index }, 'cuts', segment.track, segment.at, segment.end));
    layers.forEach(layer => append({ kind: 'layer', id: layer.id }, 'layers', layer.track ?? 0, layer.t, layer.t + layer.duration));
    return result;
}

/** Same half-open collision rule as the legacy timeline's free-slot placement. */
export function findVisualFreeSlot(intervals: readonly { start: number; end: number }[], desired: number, duration: number): number {
    let candidate = Math.max(0, desired);
    for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
        if (visualIntervalsOverlap(candidate, candidate + duration, interval)) candidate = interval.end;
    }
    return candidate;
}

/** Shared by the drag ghost and the atomic write so placement cannot turn into stacking. */
export function planVisualMove(
    cuts: readonly EditCut[], layers: readonly EditLayer[], tracks: readonly EditTimelineTrack[],
    item: VisualItem, targetId: string, time: number
): VisualMovePlan {
    if (!Number.isFinite(time) || time < 0) return { accepted: false, reason: '移動先の時刻が不正です。' };
    const intervals = visualTrackIntervals(cuts, layers, tracks);
    const original = intervals.find(interval => interval.key === itemKey(item));
    const target = tracks.find(track => track.id === targetId);
    const origin = original && tracks.find(track => track.id === original.rowId);
    if (!original || !target || !isVisualMediaTrack(target)) return { accepted: false, reason: '移動先の映像トラックが見つかりません。' };
    if (target.locked || origin?.locked) return { accepted: false, reason: 'ロックされたトラックは変更できません。' };
    const duration = original.end - original.start;
    const occupied = intervals.filter(interval => interval.key !== original.key && interval.rowId === targetId);
    return { accepted: true, original, targetId, time: findVisualFreeSlot(occupied, time, duration) };

}

/** Share row references without converting media types or dropping native/unknown properties. */
export function moveVisualItemInSource(
    source: string,
    fallbackTracks: readonly EditTimelineTrack[],
    item: VisualItem,
    targetId: string,
    time: number,
    forceShared = false
): string {
    if (!Number.isFinite(time) || time < 0) throw new Error('移動先の時刻が不正です。');
    const parsed = parseEdit(source);
    const tracks = parsed.timeline?.tracks ?? [...fallbackTracks];
    const target = tracks.find(track => track.id === targetId);
    if (!target || !isVisualMediaTrack(target)) throw new Error('映像トラックを選んでください。');
    const nativeKind = item.kind === 'cut' ? 'cuts' : 'layers';
    const nativeItem = item.kind === 'cut' ? parsed.cuts[item.index] : parsed.layers.find(layer => layer.id === item.id);
    if (!nativeItem) throw new Error('移動する素材が見つかりません。');
    const original = tracks.find(track => (track.kind === nativeKind || track.kind === 'video')
        && (track.ref ?? 0) === (nativeItem.track ?? 0));
    if (!original || original.locked || target.locked) throw new Error('ロックされたトラックは変更できません。');
    const plan = planVisualMove(parsed.cuts, parsed.layers, tracks, item, targetId, time);
    if (!plan.accepted) throw new Error((plan as { reason: string }).reason);
    time = plan.time;
    if (!forceShared && target.kind === nativeKind && original.kind === nativeKind) {
        const moved = item.kind === 'cut'
            ? moveCutInSource(source, item.index, time, target.ref ?? 0)
            : moveLayerInSource(source, item.id, time, (nativeItem as { duration: number }).duration, target.ref ?? 0);
        return pruneEmptyVisualTracksInSource(target.id === original.id ? moved : writeTimelineTracksInSource(moved, tracks));
    }
    const value = JSON.parse(source);
    if ((value.cuts ?? []).some((cut: { freeze?: unknown; transition_out?: unknown }) => cut.freeze || cut.transition_out)) {
        throw new Error('停止フレーム・トランジション付きのカットは、現在トラックの種類をまたいで移動できません。');
    }
    if (value.timeline?.tracks && value.timeline.tracks.length !== tracks.length) throw new Error('不正なトラック宣言があります。');
    if ((value.cuts?.length ?? 0) !== parsed.cuts.length) throw new Error('不正なカットがあるため移動できません。');
    const mappings = new Map<string, number>();
    let nextRef = 0;
    const normalized = tracks.map(track => {
        if (!isVisualMediaTrack(track)) return { ...(value.timeline?.tracks ?? []).find((row: EditTimelineTrack) => row.id === track.id), ...track };
        const ref = nextRef++;
        for (const kind of track.kind === 'video' ? ['cuts', 'layers'] : [track.kind]) {
            const key = `${kind}:${track.ref ?? 0}`;
            if (mappings.has(key)) throw new Error('トラックの参照が重複しています。');
            mappings.set(key, ref);
        }
        return { ...(value.timeline?.tracks ?? []).find((row: EditTimelineTrack) => row.id === track.id), ...track, kind: 'video' as const, ref };
    });
    const segments = computeCutTrackSegments(parsed.cuts);
    for (const kind of ['cuts', 'layers'] as const) {
        for (const [index, entry] of (value[kind] ?? []).entries()) {
            const ref = mappings.get(`${kind}:${entry.track ?? 0}`);
            if (ref === undefined) throw new Error('素材の所属トラックが見つかりません。');
            entry.track = ref;
            // Freeze all implicit starts before changing track membership.
            if (kind === 'cuts') entry.at = segments[index].at;
        }
        if (Array.isArray(value.tracks?.[kind])) {
            const oldStates = value.tracks[kind];
            const states: Record<string, unknown>[] = Array.from({ length: nextRef }, () => ({}));
            for (const [key, ref] of mappings) {
                if (key.startsWith(`${kind}:`)) states[ref] = oldStates[Number(key.split(':')[1])] ?? {};
            }
            value.tracks[kind] = states;
        }
    }
    value.timeline = { ...value.timeline, tracks: normalized };
    const place = (movedItem: VisualItem, rowId: string, start: number): void => {
        const ref = normalized.find(track => track.id === rowId)!.ref!;
        const entry = movedItem.kind === 'cut' ? value.cuts[movedItem.index] : value.layers.find((layer: { id: string }) => layer.id === movedItem.id);
        entry.track = ref;
        entry[movedItem.kind === 'cut' ? 'at' : 't'] = start;
    };
    place(item, targetId, time);
    return pruneEmptyVisualTracksInSource(JSON.stringify(value, null, 2) + '\n');
}

/** Insert an empty shared row using a globally unused visual ref; never shift native streams independently. */
export function createVisualTrackInSource(source: string, fallbackTracks: readonly EditTimelineTrack[], aboveId?: string, belowId?: string): { source: string; track: EditTimelineTrack } {
    const parsed = parseEdit(source);
    const raw = JSON.parse(source);
    const tracks = parsed.timeline?.tracks?.map(track => ({ ...raw.timeline.tracks.find((row: EditTimelineTrack) => row.id === track.id), ...track })) ?? [...fallbackTracks];
    if (Array.isArray(raw.timeline?.tracks) && raw.timeline.tracks.length !== tracks.length) throw new Error('不正なトラック宣言があります。');
    const refs = [
        ...tracks.filter(isVisualMediaTrack).map(track => track.ref ?? 0),
        ...parsed.cuts.map(cut => cut.track ?? 0), ...parsed.layers.map(layer => layer.track ?? 0)
    ];
    let serial = tracks.length + 1;
    while (tracks.some(track => track.id === `t${serial}`)) serial++;
    const track: EditTimelineTrack = { id: `t${serial}`, kind: 'video', ref: Math.max(-1, ...refs) + 1 };
    const next = [...tracks];
    const anchor = aboveId ? next.findIndex(item => item.id === aboveId) : -1;
    const lastVisual = next.reduce((found, item, index) => isVisualMediaTrack(item) ? index : found, -1);
    const below = belowId ? next.findIndex(item => item.id === belowId) : -1;
    next.splice(below >= 0 ? below : (anchor >= 0 ? anchor : lastVisual) + 1, 0, track);
    return { source: writeTimelineTracksInSource(source, next), track };
}

/** Empty visual rows are not persisted after an edit. Other domains keep their own data readers. */
export function pruneEmptyVisualTracksInSource(source: string): string {
    const value = JSON.parse(source);
    if (!Array.isArray(value.timeline?.tracks)) return source;
    const tracks = value.timeline.tracks.filter((row: EditTimelineTrack) => {
        if (!isVisualMediaTrack(row)) return true;
        const kinds = row.kind === 'video' ? ['cuts', 'layers'] : [row.kind];
        return kinds.some(kind => (value[kind] ?? []).some((item: { track?: number }) => (item.track ?? 0) === (row.ref ?? 0)));
    });
    return tracks.length === value.timeline.tracks.length ? source : writeTimelineTracksInSource(source, tracks);
}

export type VisualRowDrop =
    | { kind: 'none' }
    | { kind: 'track'; id: string; top: number; height: number }
    | { kind: 'between'; aboveId?: string; belowId?: string; top: number };

/** Legacy Akari OS model: row interiors are slots; boundaries insert occupied rows. */
export function resolveVisualRowDrop(rows: readonly { id: string; top: number; height: number }[], y: number, sourceId?: string, sourceItemCount = 1): VisualRowDrop {
    if (!rows.length) return { kind: 'between', top: Math.max(0, y) };
    const first = rows[0], last = rows[rows.length - 1];
    if (y < first.top) return first.id === sourceId ? { kind: 'none' } : { kind: 'between', aboveId: first.id, top: first.top };
    if (y >= last.top + last.height) return last.id === sourceId ? { kind: 'none' } : { kind: 'between', belowId: last.id, top: last.top + last.height };
    for (let i = 1; i < rows.length; i++) {
        const gapStart = rows[i - 1].top + rows[i - 1].height;
        if (y >= gapStart - 4 && y <= rows[i].top + 4) {
            if (sourceItemCount === 1 && (rows[i - 1].id === sourceId || rows[i].id === sourceId)) return { kind: 'none' };
            return { kind: 'between', aboveId: rows[i].id, top: rows[i].top };
        }
    }
    const row = rows.find(candidate => y < candidate.top + candidate.height) ?? last;
    return { kind: 'track', id: row.id, top: row.top, height: row.height };
}

/** Moving a row's sole clip reuses that row; it does not create a transient V3. */
export function insertVisualItemInSource(source: string, fallbackTracks: readonly EditTimelineTrack[], item: VisualItem, time: number, aboveId?: string, belowId?: string): string {
    const parsed = parseEdit(source);
    const tracks = parsed.timeline?.tracks ?? [...fallbackTracks];
    const intervals = visualTrackIntervals(parsed.cuts, parsed.layers, tracks);
    const original = intervals.find(interval => interval.key === itemKey(item));
    if (!original) throw new Error('移動する動画が見つかりません。');
    const row = tracks.find(track => track.id === original.rowId)!;
    if (row.locked) throw new Error('ロックされたトラックは変更できません。');
    if (intervals.filter(interval => interval.rowId === row.id).length === 1) {
        if ((aboveId === row.id || belowId === row.id) && Math.abs(time - original.start) < 1e-6) return pruneEmptyVisualTracksInSource(source);
        const moved = moveVisualItemInSource(source, tracks, item, row.id, time, true);
        const live = parseEdit(moved).timeline?.tracks ?? tracks;
        if (aboveId === row.id || belowId === row.id) return pruneEmptyVisualTracksInSource(writeTimelineTracksInSource(moved, live));
        const reordered = live.filter(track => track.id !== row.id);
        const above = reordered.findIndex(track => track.id === aboveId);
        const below = reordered.findIndex(track => track.id === belowId);
        const at = below >= 0 ? below : above >= 0 ? above + 1 : reordered.length;
        reordered.splice(at, 0, live.find(track => track.id === row.id) ?? row);
        return pruneEmptyVisualTracksInSource(writeTimelineTracksInSource(moved, reordered));
    }
    const inserted = createVisualTrackInSource(source, tracks, aboveId, belowId);
    return moveVisualItemInSource(inserted.source, tracks, item, inserted.track.id, time);
}
