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
    | { accepted: true; mode: 'move' | 'swap'; original: VisualInterval; targetId: string; time: number;
        swap?: { interval: VisualInterval; rowId: string; time: number } };

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

/** Shared by the drag ghost and the atomic write so swapping cannot turn into stacking. */
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
    const remaining = intervals.filter(interval => interval.key !== original.key);
    const collisions = remaining.filter(interval => interval.rowId === targetId && visualIntervalsOverlap(time, time + duration, interval));
    if (!collisions.length) return { accepted: true, mode: 'move', original, targetId, time };
    if (collisions.length !== 1) return { accepted: false, reason: '複数の動画と重なります。空いている時間へ移動してください。' };
    const displaced = collisions[0];
    // Across rows, only the row changes for the displaced clip. Within a row, swap time slots.
    const swapTime = original.rowId === targetId ? original.start : displaced.start;
    const swapEnd = swapTime + displaced.end - displaced.start;
    const others = remaining.filter(interval => interval.key !== displaced.key);
    const blocked = others.some(interval => interval.rowId === original.rowId && visualIntervalsOverlap(swapTime, swapEnd, interval))
        || (original.rowId === targetId && visualIntervalsOverlap(time, time + duration, { start: swapTime, end: swapEnd }));
    if (blocked) return { accepted: false, reason: '入れ替え先で別の動画と重なるため移動できません。' };
    return { accepted: true, mode: 'swap', original, targetId, time,
        swap: { interval: displaced, rowId: original.rowId, time: swapTime } };
}

/** Share row references without converting media types or dropping native/unknown properties. */
export function moveVisualItemInSource(
    source: string,
    fallbackTracks: readonly EditTimelineTrack[],
    item: VisualItem,
    targetId: string,
    time: number
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
    if (plan.mode === 'move' && target.kind === nativeKind && original.kind === nativeKind) {
        const moved = item.kind === 'cut'
            ? moveCutInSource(source, item.index, time, target.ref ?? 0)
            : moveLayerInSource(source, item.id, time, (nativeItem as { duration: number }).duration, target.ref ?? 0);
        return target.id === original.id ? moved : writeTimelineTracksInSource(moved, tracks);
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
    if (plan.swap) place(plan.swap.interval.item, plan.swap.rowId, plan.swap.time);
    return JSON.stringify(value, null, 2) + '\n';
}

/** Insert an empty shared row using a globally unused visual ref; never shift native streams independently. */
export function createVisualTrackInSource(source: string, fallbackTracks: readonly EditTimelineTrack[], aboveId?: string): { source: string; track: EditTimelineTrack } {
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
    next.splice((anchor >= 0 ? anchor : lastVisual) + 1, 0, track);
    return { source: writeTimelineTracksInSource(source, next), track };
}
