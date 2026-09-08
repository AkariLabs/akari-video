/** タイムライン断片。時刻は出力秒、trackIndex は下から上へのコピー時の段番号。 */
export type ClipboardKind = 'cuts' | 'layers' | 'overlay' | 'captions' | 'sfx';
export interface TimelineFragmentItem {
    kind: ClipboardKind;
    trackId: string;
    trackIndex: number;
    t: number;
    duration: number;
    payload: Record<string, unknown>;
}
export interface TimelineFragment {
    kind: 'akari-video/timeline-fragment';
    version: 1;
    anchor: number;
    items: TimelineFragmentItem[];
}
export interface PasteTrack {
    id: string;
    kind: ClipboardKind;
    /** 空の映像段は最初に貼る素材の種別を受け入れる。 */
    emptyVisual?: boolean;
    locked?: boolean;
    items: Array<{ id: string; t: number; duration: number }>;
}
export interface PastePlacement {
    item: TimelineFragmentItem;
    trackId: string;
    t: number;
}
export interface PasteNewTrack {
    id: string;
    kind: ClipboardKind;
    aboveTrackId: string;
}
export type PastePlan = { ok: false; reason: string } | {
    ok: true;
    placements: PastePlacement[];
    newTracks: PasteNewTrack[];
    cuts: Array<{ trackId: string; at: number; duration: number; splitIds: string[] }>;
};

const kinds = new Set<unknown>(['cuts', 'layers', 'overlay', 'captions', 'sfx']);
const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** OS の text/plain も扱えるよう、型・有限時刻・基準位置を境界で検証する。 */
export function parseTimelineFragment(source: string): TimelineFragment | undefined {
    try {
        const value: unknown = JSON.parse(source);
        if (!record(value) || value.kind !== 'akari-video/timeline-fragment' || value.version !== 1
            || !time(value.anchor) || !Array.isArray(value.items) || value.items.length === 0) return undefined;
        for (const item of value.items) {
            if (!record(item) || !kinds.has(item.kind) || typeof item.trackId !== 'string' || !item.trackId
                || !Number.isInteger(item.trackIndex) || Number(item.trackIndex) < 0
                || !time(item.t) || !time(item.duration) || item.duration <= 0
                || !record(item.payload) || typeof item.payload.id !== 'string'
                || item.payload.role === 'bgm' || item.payload.role === 'narration') return undefined;
        }
        if (value.anchor !== Math.min(...value.items.map(item => item.t))) return undefined;
        return value as unknown as TimelineFragment;
    } catch { return undefined; }
}

export function serializeTimelineFragment(fragment: TimelineFragment): string {
    const source = JSON.stringify(fragment);
    if (!parseTimelineFragment(source)) throw new Error('コピーする断片の形式が不正です。');
    return source;
}

/** 規則 1〜4。入力は変更せず、衝突時にも時刻と同じ元段の相対オフセットを保つ。 */
export function planPaste(options: {
    fragment: TimelineFragment; playhead: number; tracks: readonly PasteTrack[]; target?: readonly string[]; mode?: 'paste' | 'duplicate';
}): PastePlan {
    const { fragment, playhead, tracks, target } = options;
    if (!time(playhead) || !parseTimelineFragment(JSON.stringify(fragment))) {
        return { ok: false, reason: '貼り付ける時刻または断片が不正です。' };
    }
    const placements: PastePlacement[] = [];
    const newTracks: PasteNewTrack[] = [];
    const cuts: Extract<PastePlan, { ok: true }>['cuts'] = [];
    const working = tracks.map(track => ({ ...track, items: [...track.items] }));
    const selectedTarget = tracks.findIndex(track => target?.includes(track.id));
    const bottom = Math.min(...fragment.items.map(item => item.trackIndex));
    const groups = new Map<string, TimelineFragmentItem[]>();
    for (const item of fragment.items) groups.set(item.trackId, [...(groups.get(item.trackId) ?? []), item]);
    const createAbove = (aboveTrackId: string, kind: ClipboardKind): PasteTrack => {
        let serial = 1;
        while (working.some(track => track.id === `paste-track-${serial}`)) serial++;
        const track: PasteTrack = { id: `paste-track-${serial}`, kind, items: [] };
        working.splice(working.findIndex(candidate => candidate.id === aboveTrackId) + 1, 0, track);
        newTracks.push({ id: track.id, kind, aboveTrackId });
        return track;
    };
    // 元段の上下関係は、新段の追加で動く working の添字ではなく元の配列で写す。
    const destinations = new Map<number, PasteTrack>();
    for (const items of [...groups.values()].sort((a, b) => a[0].trackIndex - b[0].trackIndex)) {
        const first = items[0];
        const index = selectedTarget < 0 ? tracks.findIndex(track => track.id === first.trackId)
            : selectedTarget + first.trackIndex - bottom;
        let destination = tracks[index];
        if (!destination && selectedTarget >= 0 && index >= tracks.length) {
            for (let extra = tracks.length; extra <= index; extra++) {
                if (!destinations.has(extra)) {
                    const previous = destinations.get(extra - 1) ?? tracks[extra - 1];
                    destinations.set(extra, createAbove(previous.id, first.kind));
                }
            }
            destination = destinations.get(index)!;
        }
        if (!destination) return { ok: false, reason: '元のトラックが見つかりません。' };
        if (destination.locked) return { ok: false, reason: '貼り先のトラックはロック中です。' };
        const accepts = (kind: ClipboardKind): boolean => destination.kind === kind
            || (!!destination.emptyVisual && kind !== 'sfx' && kind !== 'captions');
        if (items.some(item => !accepts(item.kind))) {
            return { ok: false, reason: '種別が違うトラックには貼り付けできません。' };
        }
        const starts = items.map(item => playhead + item.t - fragment.anchor);
        if (first.kind === 'cuts' && options.mode !== 'duplicate') {
            const end = Math.max(0, ...destination.items.map(item => item.t + item.duration));
            const at = Math.min(Math.min(...starts), end);
            const earliest = Math.min(...starts);
            const duration = Math.max(...items.map((item, i) => starts[i] + item.duration)) - earliest;
            cuts.push({ trackId: destination.id, at, duration,
                splitIds: destination.items.filter(item => item.t < at && item.t + item.duration > at).map(item => item.id) });
            items.forEach((item, i) => placements.push({ item, trackId: destination.id, t: at + starts[i] - earliest }));
            continue;
        }
        if (first.kind !== 'captions' && items.some((item, i) => destination.items.some(existing =>
            starts[i] < existing.t + existing.duration - 1e-9 && starts[i] + item.duration > existing.t + 1e-9))) {
            destination = createAbove(destination.id, first.kind);
        }
        items.forEach((item, i) => placements.push({ item, trackId: destination.id, t: starts[i] }));
    }
    return { ok: true, placements, newTracks, cuts };
}
