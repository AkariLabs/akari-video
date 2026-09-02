"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectLegacyAudioView = projectLegacyAudioView;
/**
 * 内部表現の audio item だけから legacy audio 形を組み立てる純関数。
 * render-cut の互換射影と同じく legacy.index 順で処理し、bgm は単数として後勝ちにする。
 */
function projectLegacyAudioView(internal) {
    const ordered = internal.tracks
        .flatMap(track => track.items)
        .filter(item => item.legacy.collection === 'sfx'
        || item.legacy.collection === 'narration'
        || item.legacy.collection === 'bgm')
        .sort((left, right) => left.legacy.index - right.legacy.index);
    const sfx = [];
    const narration = [];
    let bgm;
    for (const item of ordered) {
        if (item.legacy.value === undefined)
            continue;
        const declaration = projectAudioDeclaration(item, internal.output?.fps ?? 30);
        switch (item.legacy.collection) {
            case 'sfx':
                sfx.push(declaration);
                break;
            case 'narration':
                narration.push(declaration);
                break;
            case 'bgm':
                bgm = declaration;
                break;
            default:
                break;
        }
    }
    return {
        ...(bgm !== undefined ? { bgm } : {}),
        sfx,
        narration
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
