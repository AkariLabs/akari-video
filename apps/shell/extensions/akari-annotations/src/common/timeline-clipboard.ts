import {
    EditV2Document, ItemLocation, indexEditV2Items, stringifyEditV2,
    insertTrack as insertV2Track, insertItem as insertV2Item,
    splitItem as splitV2Item, updateItem as updateV2Item, removeItem as removeV2Item,
    removeTreeV2Item, removeAudioSfxPreferV2, insertAudioSfxPreferV2
} from './edit-v2-mutations';
import { CaptionRecord, insertCaptionLine, removeCaptionLine } from './caption-store';

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
// 字幕段の edit item と captions.json の行を区別する。
const isCaptionRecord = (kind: ClipboardKind, payload: Record<string, unknown>): boolean =>
    kind === 'captions' && !('source' in payload);

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

/** 呼び手が before / after を一度に保存・履歴化するための全文。 */
export interface TimelineClipboardSnapshot {
    edit: string;
    captions?: string;
}

function cloneClipboardValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** 選択と表示時刻の解決だけを呼び手に委ね、独立した断片を返す。 */
export function fragmentForSelection<S extends { kind: string }, A extends { id: string; t: number }>(options: {
    selections: readonly S[];
    getTracks: () => readonly PasteTrack[];
    selectionId: (selection: S) => string;
    trackIdOfSelection: (selection: S) => string | undefined;
    captionIdForSelection: (selection: S, id: string, hasRaw: boolean) => string | undefined;
    itemLocations: ReadonlyMap<string, Pick<ItemLocation, 'parentId'>>;
    editDocument: EditV2Document | undefined;
    captions: readonly CaptionRecord[];
    captionRangeToOutputRanges: (id: string, start: number, end: number) => readonly (readonly [number, number])[];
    rows: readonly { id: string; at: number; duration: number }[];
    fps: number;
    audioSfx: readonly A[];
    sfxIntervalEnd: (item: A) => number;
}): TimelineFragment | undefined {
    const { selections, getTracks, selectionId, trackIdOfSelection, captionIdForSelection, itemLocations,
        editDocument, captions, captionRangeToOutputRanges, rows, fps, audioSfx, sfxIntervalEnd } = options;
    const tracks = getTracks();
    const items: TimelineFragmentItem[] = [];
    const selectedIds = new Set(selections.map(item => selectionId(item)));
    const findRaw = (entries: Array<Record<string, any>>, id: string): Record<string, any> | undefined => {
        for (const entry of entries) {
            if (entry.id === id) return entry;
            const child = Array.isArray(entry.items) ? findRaw(entry.items, id) : undefined;
            if (child) return child;
        }
        return undefined;
    };
    for (const selection of selections) {
        const id = selectionId(selection);
        // 親も選択済みなら、子は親の断片に含まれるため二重にコピーしない。
        let parent = itemLocations.get(id)?.parentId;
        let included = false;
        while (parent) {
            if (selectedIds.has(parent)) { included = true; break; }
            parent = itemLocations.get(parent)?.parentId;
        }
        if (included) continue;
        const trackId = trackIdOfSelection(selection);
        const trackIndex = tracks.findIndex(track => track.id === trackId);
        if (trackIndex < 0) continue;
        const track = tracks[trackIndex];
        const raw = findRaw((editDocument?.tracks as Array<Record<string, any>> | undefined) ?? [], id);
        const captionId = captionIdForSelection(selection, id, !!raw);
        if (captionId !== undefined) {
            const caption = captions.find(candidate => candidate.id === captionId);
            if (!caption) continue;
            const ranges = captionRangeToOutputRanges(caption.id, caption.start, caption.end);
            for (const [start, end] of ranges) {
                items.push({ kind: 'captions', trackId: track.id, trackIndex, t: start, duration: end - start,
                    payload: cloneClipboardValue(caption) as unknown as Record<string, unknown> });
            }
        } else if (raw) {
            if (raw.role === 'bgm' || raw.role === 'narration') continue;
            const row = rows.find(candidate => candidate.id === id);
            items.push({ kind: track.kind, trackId: track.id, trackIndex,
                t: row?.at ?? Number(raw.at) / fps, duration: row?.duration ?? Number(raw.duration) / fps,
                payload: cloneClipboardValue(raw) });
        } else if (selection.kind === 'audio') {
            const sfx = audioSfx.find(candidate => candidate.id === id);
            if (!sfx) continue;
            const audio = editDocument?.audio as Record<string, any> | undefined;
            const original = (audio?.sfx as Array<Record<string, unknown>> | undefined)?.find((entry, index) =>
                (entry.id ?? `sfx-${index}`) === id);
            if (!original) continue;
            items.push({ kind: 'sfx', trackId: track.id, trackIndex, t: sfx.t,
                duration: sfxIntervalEnd(sfx) - sfx.t, payload: { ...cloneClipboardValue(original), id } });
        }
    }
    if (!items.length) return undefined;
    return { kind: 'akari-video/timeline-fragment', version: 1,
        anchor: Math.min(...items.map(item => item.t)), items };
}

/** 実体を一括削除し、選択外の分離音声は参照だけを解除する。 */
export function cutTimelineFragment(before: TimelineClipboardSnapshot, options: {
    fragment: TimelineFragment;
    itemLocations: ReadonlyMap<string, Pick<ItemLocation, 'parentId'>>;
    isTrackLocked: (id: string) => boolean;
}): TimelineClipboardSnapshot {
    const { fragment, itemLocations, isTrackLocked } = options;
    let doc = JSON.parse(before.edit) as EditV2Document;
    let captions = before.captions;
    for (const id of new Set(fragment.items.map(item => String(item.payload.id)))) {
        const item = fragment.items.find(candidate => candidate.payload.id === id)!;
        if (isCaptionRecord(item.kind, item.payload)) {
            captions = removeCaptionLine(captions!, id);
        } else if (item.kind === 'sfx') {
            doc = removeAudioSfxPreferV2(doc, id);
        } else {
            doc = itemLocations.get(id)?.parentId ? removeTreeV2Item(doc, id).document : removeV2Item(doc, id);
        }
    }
    // 選択外の分離音声は残し、切り取った映像への参照だけを解除する。
    const remaining = indexEditV2Items(doc);
    const removedIds = new Set(fragment.items.map(item => String(item.payload.id)));
    for (const track of doc.tracks as Array<Record<string, any>>) {
        for (const item of track.items ?? []) {
            if (typeof item.link !== 'string' || !removedIds.has(item.link) || remaining.has(item.link)) continue;
            if (isTrackLocked(String(track.id))) throw new Error('リンク先の音声トラックはロック中です。');
            doc = updateV2Item(doc, { itemId: String(item.id), patch: { link: null } });
        }
    }
    return { edit: stringifyEditV2(doc), captions };
}

/** 計画から全種別の変換までを実行し、拒否時は文書を返さず従来の理由を投げる。 */
export function pasteTimelineFragment(before: TimelineClipboardSnapshot, options: {
    fragment: TimelineFragment;
    playhead: number;
    target: readonly string[];
    getTracks: () => readonly PasteTrack[];
    mode?: 'paste' | 'duplicate';
    insertIndex?: number;
    frameAt: (seconds: number) => number;
    captions: readonly Pick<CaptionRecord, 'id'>[];
    audioSfx: readonly { id: string }[];
    displayTimelineTracks: readonly { id: string; ref?: number }[];
}): TimelineClipboardSnapshot {
    const { fragment, playhead, getTracks, mode = 'paste', insertIndex, frameAt,
        captions: existingCaptions, audioSfx, displayTimelineTracks } = options;
    let { target } = options;
    let doc = JSON.parse(before.edit) as EditV2Document;
    let tracks = getTracks();
    // 段間へのドロップも、同じ貼り付け計画へ空の段として渡す。
    if (insertIndex !== undefined) {
        const kind = fragment.items[0].kind;
        doc = insertV2Track(doc, { index: insertIndex, lane: kind === 'sfx' ? 'audio' : 'visual' });
        const id = String((doc.tracks as Array<Record<string, unknown>>)[insertIndex].id);
        const insertedTracks = [...tracks];
        insertedTracks.splice(insertIndex, 0, { id, kind, items: [] });
        tracks = insertedTracks;
        target = [id];
    }
    const plan = planPaste({ fragment, playhead, tracks, target, mode });
    if (plan.ok === false) throw new Error(plan.reason);
    const trackIds = new Map<string, string>();
    for (const track of plan.newTracks) {
        const rawTracks = doc.tracks as Array<Record<string, unknown>>;
        const above = trackIds.get(track.aboveTrackId) ?? track.aboveTrackId;
        const sourceIndex = rawTracks.findIndex(candidate => candidate.id === above);
        const index = sourceIndex >= 0 ? sourceIndex + 1
            : track.kind === 'sfx' ? rawTracks.filter(candidate => candidate.lane === 'audio').length : rawTracks.length;
        doc = insertV2Track(doc, { index, lane: track.kind === 'sfx' ? 'audio' : 'visual' });
        trackIds.set(track.id, String((doc.tracks as Array<Record<string, unknown>>)[index].id));
    }
    for (const cut of plan.cuts) {
        for (const itemId of cut.splitIds) doc = splitV2Item(doc, { itemId, atFrames: frameAt(cut.at) });
        const track = (doc.tracks as Array<Record<string, any>>).find(candidate => candidate.id === cut.trackId)!;
        for (const item of track.items ?? []) {
            if (Number(item.at) >= frameAt(cut.at)) {
                doc = updateV2Item(doc, { itemId: String(item.id),
                    patch: { at: Number(item.at) + frameAt(cut.duration) } });
            }
        }
    }
    let captions = before.captions;
    const usedIds = [...indexEditV2Items(doc).keys(), ...existingCaptions.map(caption => caption.id),
        ...audioSfx.map(item => item.id)];
    const copiedIds = new Map<string, string>();
    const cloneItem = (original: Record<string, any>, kind: ClipboardKind): Record<string, any> => {
        const item = cloneClipboardValue(original);
        item.id = isCaptionRecord(kind, item) ? nextCaptionId(usedIds) : nextCopyId(`${String(original.id)}-copy`, usedIds);
        usedIds.push(item.id);
        copiedIds.set(String(original.id), item.id);
        if (Array.isArray(item.items)) item.items = item.items.map(child => cloneItem(child, kind));
        return item;
    };
    const copies = plan.placements.map(placement => ({ ...placement,
        payload: cloneItem(placement.item.payload, placement.item.kind) }));
    const relink = (item: Record<string, any>): void => {
        if (typeof item.link === 'string') {
            if (copiedIds.has(item.link)) item.link = copiedIds.get(item.link);
            else delete item.link;
        }
        if (Array.isArray(item.items)) item.items.forEach(relink);
    };
    for (const placement of copies) {
        const item = placement.payload;
        relink(item);
        const trackId = trackIds.get(placement.trackId) ?? placement.trackId;
        if (isCaptionRecord(placement.item.kind, item)) {
            const caption = item as CaptionRecord;
            caption.start = placement.t;
            caption.end = placement.t + placement.item.duration;
            caption.timeDomain = 'output';
            caption.sourceRef = null;
            caption.edited = true;
            // 元素材の単語時刻は出力秒へ線形に写してスタイルとともに保つ。
            const shift = (t: number): number => placement.t + (t - Number(placement.item.payload.start))
                * placement.item.duration / (Number(placement.item.payload.end) - Number(placement.item.payload.start));
            caption.words = caption.words?.map(word => ({ ...word, start: shift(word.start), end: shift(word.end) }));
            caption.unrecognized = caption.unrecognized?.map(range => ({ start: shift(range.start), end: shift(range.end) }));
            captions = insertCaptionLine(captions!, caption);
            continue;
        }
        item.at = frameAt(placement.t);
        if (placement.item.kind === 'sfx') {
            const rawTrack = (doc.tracks as Array<Record<string, unknown>>).find(track => track.id === trackId);
            const legacyItem: Record<string, unknown> = { ...item, t: placement.t,
                track: displayTimelineTracks.find(track => track.id === trackId)?.ref ?? 0 };
            delete legacyItem.at;
            if (!item.source && rawTrack) {
                const sources = (doc.sources ?? []) as Array<Record<string, unknown>>;
                let source = sources.find(candidate => candidate.path === item.path);
                if (!source) {
                    source = { id: nextCopyId('audio-copy-source', sources.map(entry => String(entry.id))), path: item.path };
                    doc = { ...doc, sources: [...sources, source] };
                }
                const { id, gain_db, fade_in, fade_out } = item;
                const input = Number(item.in ?? 0);
                Object.assign(item, { id, gain_db, fade_in, fade_out,
                    duration: frameAt(placement.item.duration),
                    source: { kind: 'media', src: source.id, in: input, out: Number(item.out ?? input + placement.item.duration * Number(item.speed ?? 1)) } });
                if (Array.isArray(item.keyframes)) item.keyframes = item.keyframes.map((point: Record<string, unknown>) =>
                    ({ ...point, t: frameAt(Number(point.t)) }));
                for (const key of ['path', 't', 'track', 'in', 'out']) delete item[key];
            }
            doc = insertAudioSfxPreferV2(doc, { trackId: rawTrack ? trackId : undefined, item, legacyItem });
        } else {
            const destination = (doc.tracks as Array<Record<string, any>>).find(track => track.id === trackId)!;
            const nextIndex = destination.items.findIndex((entry: Record<string, unknown>) => Number(entry.at) > Number(item.at));
            doc = insertV2Item(doc, trackId, item, nextIndex < 0 ? destination.items.length : nextIndex);
        }
    }
    return { edit: stringifyEditV2(doc), captions };
}

/** 字幕は 1 から最小の欠番を使う。9999 を超えたら切り詰めず 5 桁以上へ延ばす。 */
export function nextCaptionId(usedIds: readonly string[]): string {
    const used = new Set(usedIds);
    let sequence = 1;
    while (used.has(`c-${String(sequence).padStart(4, '0')}`)) {
        sequence++;
    }
    return `c-${String(sequence).padStart(4, '0')}`;
}

export function nextCopyId(base: string, ids: readonly string[]): string {
    const used = new Set(ids);
    if (!used.has(base)) {
        return base;
    }
    let sequence = 2;
    while (used.has(`${base}-${sequence}`)) {
        sequence++;
    }
    return `${base}-${sequence}`;
}
