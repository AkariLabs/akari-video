"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isVisualMediaTrack = isVisualMediaTrack;
exports.moveVisualItemInSource = moveVisualItemInSource;
exports.createVisualTrackInSource = createVisualTrackInSource;
const edit_store_1 = require("./edit-store");
function isVisualMediaTrack(track) {
    return track.kind === 'video' || track.kind === 'cuts' || track.kind === 'layers';
}
/** Share row references without converting media types or dropping native/unknown properties. */
function moveVisualItemInSource(source, fallbackTracks, item, targetId, time) {
    if (!Number.isFinite(time) || time < 0)
        throw new Error('移動先の時刻が不正です。');
    const parsed = (0, edit_store_1.parseEdit)(source);
    const tracks = parsed.timeline?.tracks ?? [...fallbackTracks];
    const target = tracks.find(track => track.id === targetId);
    if (!target || !isVisualMediaTrack(target))
        throw new Error('映像トラックを選んでください。');
    const nativeKind = item.kind === 'cut' ? 'cuts' : 'layers';
    const nativeItem = item.kind === 'cut' ? parsed.cuts[item.index] : parsed.layers.find(layer => layer.id === item.id);
    if (!nativeItem)
        throw new Error('移動する素材が見つかりません。');
    const original = tracks.find(track => (track.kind === nativeKind || track.kind === 'video')
        && (track.ref ?? 0) === (nativeItem.track ?? 0));
    if (!original || original.locked || target.locked)
        throw new Error('ロックされたトラックは変更できません。');
    if (target.kind === nativeKind && original.kind === nativeKind) {
        const moved = item.kind === 'cut'
            ? (0, edit_store_1.moveCutInSource)(source, item.index, time, target.ref ?? 0)
            : (0, edit_store_1.moveLayerInSource)(source, item.id, time, nativeItem.duration, target.ref ?? 0);
        return target.id === original.id ? moved : (0, edit_store_1.writeTimelineTracksInSource)(moved, tracks);
    }
    const value = JSON.parse(source);
    if ((value.cuts ?? []).some((cut) => cut.freeze || cut.transition_out)) {
        throw new Error('停止フレーム・トランジション付きのカットは、現在トラックの種類をまたいで移動できません。');
    }
    if (value.timeline?.tracks && value.timeline.tracks.length !== tracks.length)
        throw new Error('不正なトラック宣言があります。');
    if ((value.cuts?.length ?? 0) !== parsed.cuts.length)
        throw new Error('不正なカットがあるため移動できません。');
    const mappings = new Map();
    let nextRef = 0;
    const normalized = tracks.map(track => {
        if (!isVisualMediaTrack(track))
            return { ...(value.timeline?.tracks ?? []).find((row) => row.id === track.id), ...track };
        const ref = nextRef++;
        for (const kind of track.kind === 'video' ? ['cuts', 'layers'] : [track.kind]) {
            const key = `${kind}:${track.ref ?? 0}`;
            if (mappings.has(key))
                throw new Error('トラックの参照が重複しています。');
            mappings.set(key, ref);
        }
        return { ...(value.timeline?.tracks ?? []).find((row) => row.id === track.id), ...track, kind: 'video', ref };
    });
    const segments = (0, edit_store_1.computeCutTrackSegments)(parsed.cuts);
    for (const kind of ['cuts', 'layers']) {
        for (const [index, entry] of (value[kind] ?? []).entries()) {
            const ref = mappings.get(`${kind}:${entry.track ?? 0}`);
            if (ref === undefined)
                throw new Error('素材の所属トラックが見つかりません。');
            entry.track = ref;
            // Freeze all implicit starts before changing track membership.
            if (kind === 'cuts')
                entry.at = segments[index].at;
        }
        if (Array.isArray(value.tracks?.[kind])) {
            const oldStates = value.tracks[kind];
            const states = Array.from({ length: nextRef }, () => ({}));
            for (const [key, ref] of mappings) {
                if (key.startsWith(`${kind}:`))
                    states[ref] = oldStates[Number(key.split(':')[1])] ?? {};
            }
            value.tracks[kind] = states;
        }
    }
    value.timeline = { ...value.timeline, tracks: normalized };
    const ref = normalized.find(track => track.id === targetId).ref;
    const normalizedSource = JSON.stringify(value, null, 2) + '\n';
    return item.kind === 'cut'
        ? (0, edit_store_1.moveCutInSource)(normalizedSource, item.index, time, ref)
        : (0, edit_store_1.moveLayerInSource)(normalizedSource, item.id, time, nativeItem.duration, ref);
}
/** Insert an empty shared row using a globally unused visual ref; never shift native streams independently. */
function createVisualTrackInSource(source, fallbackTracks, aboveId) {
    const parsed = (0, edit_store_1.parseEdit)(source);
    const raw = JSON.parse(source);
    const tracks = parsed.timeline?.tracks?.map(track => ({ ...raw.timeline.tracks.find((row) => row.id === track.id), ...track })) ?? [...fallbackTracks];
    if (Array.isArray(raw.timeline?.tracks) && raw.timeline.tracks.length !== tracks.length)
        throw new Error('不正なトラック宣言があります。');
    const refs = [
        ...tracks.filter(isVisualMediaTrack).map(track => track.ref ?? 0),
        ...parsed.cuts.map(cut => cut.track ?? 0), ...parsed.layers.map(layer => layer.track ?? 0)
    ];
    let serial = tracks.length + 1;
    while (tracks.some(track => track.id === `t${serial}`))
        serial++;
    const track = { id: `t${serial}`, kind: 'video', ref: Math.max(-1, ...refs) + 1 };
    const next = [...tracks];
    const anchor = aboveId ? next.findIndex(item => item.id === aboveId) : -1;
    const lastVisual = next.reduce((found, item, index) => isVisualMediaTrack(item) ? index : found, -1);
    next.splice((anchor >= 0 ? anchor : lastVisual) + 1, 0, track);
    return { source: (0, edit_store_1.writeTimelineTracksInSource)(source, next), track };
}
