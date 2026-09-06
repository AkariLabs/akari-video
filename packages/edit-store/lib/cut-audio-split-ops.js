"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canSplitCutAudio = canSplitCutAudio;
exports.splitCutAudio = splitCutAudio;
exports.linkedAudioItemIdOf = linkedAudioItemIdOf;
exports.linkedCutIdOf = linkedCutIdOf;
exports.unlinkCutAudio = unlinkCutAudio;
exports.moveLinkedCutAudio = moveLinkedCutAudio;
exports.removeCutAudioLinked = removeCutAudioLinked;
const tree_ops_1 = require("./tree-ops");
const BLOCKER_MESSAGES = {
    'not-found': 'カットが見つかりません',
    'not-visual-media': '映像トラックの素材カットだけ音声を分離できます',
    nested: '入れ子のカットはまだ音声を分離できません',
    anchored: '字幕に固定したカットはまだ音声を分離できません',
    speed: '速度を変えたカットはまだ音声を分離できません',
    freeze: '静止区間を持つカットはまだ音声を分離できません',
    'transition-crossfade': 'トランジションを持つカットはまだ音声を分離できません',
    'already-split': 'このカットの音声はすでに分離されています',
    'no-audio': 'この素材には音声がありません',
};
// These tree helpers only access tracks/items; no Project methods are needed.
function tree(doc) {
    return doc;
}
function canSplitCutAudio(doc, cutId, options = {}) {
    const location = (0, tree_ops_1.locate)(tree(doc), cutId);
    let blocker;
    if (!location)
        blocker = 'not-found';
    else if (location.parent || location.item.items !== undefined)
        blocker = 'nested';
    else if (location.track.lane !== 'visual' || location.item.source.kind !== 'media')
        blocker = 'not-visual-media';
    else if (location.item.anchor !== undefined)
        blocker = 'anchored';
    else if (location.item.source.speed !== undefined && location.item.source.speed !== 1)
        blocker = 'speed';
    else if (location.item.source.freeze != null)
        blocker = 'freeze';
    else if (location.item.source.transition_out != null)
        blocker = 'transition-crossfade';
    else if (location.item.audio === false)
        blocker = 'already-split';
    else if (options.hasAudio === false)
        blocker = 'no-audio';
    return blocker ? { ok: false, blocker, message: BLOCKER_MESSAGES[blocker] } : { ok: true };
}
function splitCutAudio(doc, options) {
    const eligible = canSplitCutAudio(doc, options.cutId, options);
    if (eligible.ok === false)
        throw new Error(eligible.message);
    const document = structuredClone(doc);
    const location = (0, tree_ops_1.locate)(tree(document), options.cutId);
    const cut = location.item;
    const visualIds = new Set(location.track.items.map(item => item.id));
    let audioTrack = document.tracks.find((track) => track.lane === 'audio' && 'items' in track
        && (track.muted === true) === (location.track.muted === true)
        && track.items.every(item => item.role === 'speech' && visualIds.has(item.link)));
    const createdTrack = audioTrack === undefined;
    if (!audioTrack) {
        // Audio tracks are inserted at the end of their lane, preserving all existing order.
        let index = 0;
        document.tracks.forEach((track, i) => { if (track.lane === 'audio')
            index = i + 1; });
        audioTrack = (0, tree_ops_1.createTrackAt)(tree(document), 'audio', index);
        const visualNumber = document.tracks.filter(track => track.lane === 'visual').findIndex(track => track.id === location.track.id) + 1;
        audioTrack.name = `${location.track.name ?? `V${visualNumber}`}の音声`;
        if (location.track.muted === true)
            audioTrack.muted = true;
    }
    const ids = new Set((0, tree_ops_1.allLocations)(tree(document)).map(entry => entry.item.id));
    const base = `${cut.id}-audio`;
    let audioItemId = base;
    for (let serial = 2; ids.has(audioItemId); serial++)
        audioItemId = `${base}-${serial}`;
    const audio = {
        id: audioItemId, role: 'speech', link: cut.id, at: cut.at, duration: cut.duration,
        source: { kind: 'media', src: cut.source.src, in: cut.source.in, out: cut.source.out },
    };
    if (cut.source.gain_db !== undefined) {
        audio.gain_db = cut.source.gain_db;
        delete cut.source.gain_db;
    }
    if (cut.source.mute === true) {
        audio.mute = true;
        delete cut.source.mute;
    }
    if (Array.isArray(cut.keyframes)) {
        const visualPoints = [];
        const audioPoints = [];
        for (const point of cut.keyframes) {
            if (point.gain_db === undefined) {
                visualPoints.push(point);
                continue;
            }
            audioPoints.push({ t: point.t, gain_db: point.gain_db,
                ...(point.easing === undefined ? {} : { easing: structuredClone(point.easing) }) });
            delete point.gain_db;
            if (Object.keys(point).some(key => key !== 't' && key !== 'easing'))
                visualPoints.push(point);
        }
        if (audioPoints.length) {
            if (audioPoints.length === 1) {
                // A singleton envelope is a constant offset to the base gain; clamp sums outside the schema range.
                audio.gain_db = Math.max(-60, Math.min(12, (audio.gain_db ?? 0) + audioPoints[0].gain_db));
            }
            else
                audio.keyframes = audioPoints;
            // Keep the original, gain-stripped array for a singleton visual: inert points preserve
            // the two-point minimum without changing any property's filtered interpolation.
            if (visualPoints.length >= 2)
                cut.keyframes = visualPoints;
            else if (visualPoints.length === 0)
                delete cut.keyframes;
        }
    }
    cut.audio = false;
    audioTrack.items.push(audio);
    return { document, audioItemId, audioTrackId: audioTrack.id, createdTrack };
}
function linkedAudioItemIdOf(doc, cutId) {
    return (0, tree_ops_1.allLocations)(tree(doc)).find(location => location.track.lane === 'audio'
        && location.item.link === cutId)?.item.id;
}
function linkedCutIdOf(doc, audioItemId) {
    const location = (0, tree_ops_1.locate)(tree(doc), audioItemId);
    return location?.track.lane === 'audio' && typeof location.item.link === 'string'
        ? location.item.link : undefined;
}
function unlinkCutAudio(doc, options) {
    const document = structuredClone(doc);
    const audio = requireAudio(document, options.audioItemId);
    delete audio.item.link;
    return document;
}
function moveLinkedCutAudio(doc, options) {
    if (!Number.isInteger(options.deltaFrames))
        throw new Error('移動量は整数フレームで指定してください');
    const document = structuredClone(doc);
    const cut = requireCut(document, options.cutId);
    const audioId = linkedAudioItemIdOf(document, options.cutId);
    const locations = [cut, ...(audioId === undefined ? [] : [requireAudio(document, audioId)])];
    if (locations.some(location => location.item.at + options.deltaFrames < 0)) {
        throw new Error('カットまたは音声がタイムラインの先頭より前になるため移動できません');
    }
    for (const location of locations)
        location.item.at += options.deltaFrames;
    return document;
}
function removeCutAudioLinked(doc, options) {
    const document = structuredClone(doc);
    if (!['pair', 'audio-only', 'cut-only'].includes(options.target))
        throw new Error('削除対象が不正です');
    if (options.cutId === undefined && options.audioItemId === undefined)
        throw new Error('削除対象を指定してください');
    let cut = options.cutId === undefined ? undefined : requireCut(document, options.cutId);
    let audio = options.audioItemId === undefined ? undefined : requireAudio(document, options.audioItemId);
    if (cut && audio && audio.item.link !== cut.item.id)
        throw new Error('指定された映像と音声はリンクしていません');
    if (!cut && typeof audio?.item.link === 'string')
        cut = requireCut(document, audio.item.link);
    if (!audio && cut) {
        const audioId = linkedAudioItemIdOf(document, cut.item.id);
        if (audioId !== undefined)
            audio = requireAudio(document, audioId);
    }
    if (options.target === 'audio-only' && !audio)
        throw new Error('リンクされた音声が見つかりません');
    if (options.target === 'cut-only' && !cut)
        throw new Error('リンクされたカットが見つかりません');
    if (options.target !== 'audio-only' && cut)
        removeLocation(cut);
    if (options.target !== 'cut-only' && audio)
        removeLocation(audio);
    if (options.target === 'cut-only' && audio)
        delete audio.item.link;
    return document;
}
function requireCut(doc, id) {
    const location = (0, tree_ops_1.locate)(tree(doc), id);
    if (!location || location.track.lane !== 'visual' || location.item.source.kind !== 'media') {
        throw new Error('映像の素材カットが見つかりません');
    }
    return location;
}
function requireAudio(doc, id) {
    const location = (0, tree_ops_1.locate)(tree(doc), id);
    if (!location || location.track.lane !== 'audio')
        throw new Error('音声が見つかりません');
    return location;
}
function removeLocation(location) {
    location.items.splice(location.index, 1);
}
