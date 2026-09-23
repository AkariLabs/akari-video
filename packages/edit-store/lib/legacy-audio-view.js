"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectLegacyAudioView = projectLegacyAudioView;
const audio_ownership_1 = require("./audio-ownership");
/**
 * 内部表現の audio item だけから legacy audio 形を組み立てる純関数。
 * render-cut の互換射影と同じく legacy.index 順で処理し、BGM は開始時刻順に並べる。
 * 単数 bgm は最初の 1 本を返す互換値。
 */
function projectLegacyAudioView(internal) {
    const ordered = internal.tracks
        .filter(track => track.lane !== 'audio' || (0, audio_ownership_1.isAudioItemAudible)(track, undefined))
        .flatMap(track => track.items)
        .filter(item => item.legacy.collection === 'sfx'
        || item.legacy.collection === 'narration'
        || item.legacy.collection === 'bgm'
        || item.legacy.collection === 'speech')
        .sort((left, right) => left.legacy.index - right.legacy.index);
    const sfx = [];
    const narration = [];
    const speech = [];
    const bgms = [];
    const bgmItemIds = [];
    for (const item of ordered) {
        if (item.legacy.value === undefined)
            continue;
        const declaration = projectAudioDeclaration(item, internal.output?.fps ?? 30);
        if (declaration.role === 'speech') {
            speech.push(declaration);
            continue;
        }
        switch (item.legacy.collection) {
            case 'sfx':
                sfx.push(declaration);
                break;
            case 'narration':
                narration.push(declaration);
                break;
            case 'bgm':
                bgms.push(declaration);
                bgmItemIds.push(item.id);
                break;
            default:
                break;
        }
    }
    if (bgms.length > 1)
        bgms.forEach((bgm, index) => { bgm.id = bgmItemIds[index]; });
    return {
        ...(bgms.length > 1 ? { bgms: bgms.sort((a, b) => Number(a.t ?? 0) - Number(b.t ?? 0)) } : {}),
        ...(bgms.length ? { bgm: bgms[0] } : {}),
        sfx,
        narration,
        ...(speech.length ? { speech } : {})
    };
}
// Internal legacy values use camelCase display fields. Legacy audio consumers retain the
// historical JSON spelling for gain_db while declaration-only compatibility fields stay intact.
function projectAudioDeclaration(item, fps) {
    const value = item.legacy.value;
    const projectedKeyframes = item.source.kind === 'media' && item.source.sourceId !== undefined
        ? projectKeyframes(value.keyframes ?? (isRecord(item.declaration) ? item.declaration.keyframes : undefined), fps)
        : undefined;
    if (item.source.kind === 'media' && item.source.sourceId === undefined && isRecord(item.declaration)) {
        return {
            ...item.declaration,
            ...(value.gainDb !== undefined ? { gain_db: value.gainDb } : {}),
            ...(projectedKeyframes ? { keyframes: projectedKeyframes } : {})
        };
    }
    return {
        ...(isRecord(item.declaration) ? item.declaration : {}),
        ...value,
        ...(value.gainDb !== undefined ? { gain_db: value.gainDb } : {}),
        ...(projectedKeyframes ? { keyframes: projectedKeyframes } : {})
    };
}
function projectKeyframes(value, fps) {
    if (!Array.isArray(value) || !(fps > 0))
        return undefined;
    return value.map(entry => isRecord(entry) && typeof entry.t === 'number'
        ? { ...entry, t: entry.t / fps }
        : entry);
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
