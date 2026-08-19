"use strict";
/**
 * edit.json v2 を tracks-first の内部表現へ読む。
 * トラック配列順が下→上の合成順で、時刻は整数フレーム宣言を正本とする。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readInternalEdit = readInternalEdit;
exports.readInternalSources = readInternalSources;
exports.projectLegacyEdit = projectLegacyEdit;
exports.toLegacyTrack = toLegacyTrack;
exports.derivedLegacyTracks = derivedLegacyTracks;
const edit_v2_1 = require("./edit-v2");
const error_1 = require("./migrate/error");
/**
 * edit.json v2 を内部表現へ読む。v0/v1 は凍結変換ユニットのみが読む。
 * 文字列でもパース済みオブジェクトでも受け取る。
 */
function readInternalEdit(source, options) {
    const text = typeof source === 'string' ? source : JSON.stringify(source);
    if (typeof text !== 'string') {
        throw new Error('編集データの形式を確認できません。');
    }
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('編集データの形式を確認できません。');
    }
    const record = raw;
    if (record.version !== 2) {
        throw new error_1.LegacyEditVersionError(typeof record.version === 'number' ? record.version : -1);
    }
    return readV2Internal(record);
}
/**
 * 素材表だけを読む軽い入口（版を知るのは同じくここだけ）。アイテムまで要らない照合
 * （生素材と edit.json の突き合わせ等）が、全文の読み取りを払わずに済むようにする。
 */
function readInternalSources(source) {
    const raw = toRecord(source);
    if (!raw) {
        return [];
    }
    if (raw.version !== 2) {
        throw new error_1.LegacyEditVersionError(typeof raw.version === 'number' ? raw.version : -1);
    }
    return readV2Internal(raw).sources;
}
function toRecord(source) {
    try {
        const text = typeof source === 'string' ? source : JSON.stringify(source);
        if (typeof text !== 'string') {
            return undefined;
        }
        const parsed = JSON.parse(text);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
// ---------------------------------------------------------------------------
// v2
// ---------------------------------------------------------------------------
function readV2Internal(raw) {
    const edit = (0, edit_v2_1.readEditV2)(raw);
    const fps = edit.output.fps;
    const sources = edit.sources.map(entry => ({
        id: entry.id,
        declaredPath: entry.path,
        path: entry.path,
        declaredProxy: entry.proxy,
        proxy: entry.proxy ?? null,
        ...(entry.chroma_key !== undefined && entry.chroma_key !== null ? { chromaKey: entry.chroma_key } : {}),
        declarationPath: `sources[${entry.id}]`,
        isDefault: false
    }));
    const pathOf = (id) => sources.find(entry => entry.id === id)?.path;
    const warnings = [];
    const refCounters = new Map();
    const mainVisualTrackId = edit.tracks.find(track => track.lane === 'visual' && 'items' in track)?.id;
    const tracks = edit.tracks.map(track => {
        const kind = legacyKindOfV2Track(track, track.id === mainVisualTrackId);
        const ref = kind === 'captions' ? undefined : nextRef(refCounters, kind);
        const items = [];
        if ('items' in track) {
            track.items.forEach((item, index) => {
                const built = buildV2Item(item, index, fps, ref ?? 0, track.lane, track.id === mainVisualTrackId, pathOf);
                if (built.warning) {
                    warnings.push(built.warning);
                }
                items.push(built.item);
            });
        }
        return {
            id: track.id,
            lane: track.lane,
            z: track.z,
            ...(track.name !== undefined ? { name: track.name } : {}),
            origin: 'declared',
            ...('content' in track ? { content: { from: 'captions.json' } } : {}),
            items,
            legacy: { kind, ...(ref === undefined ? {} : { ref }) }
        };
    });
    addV2AudioItems(tracks, edit.audio, fps);
    return {
        output: {
            width: edit.output.width,
            height: edit.output.height,
            fps,
            ...(edit.output.look !== undefined ? { look: edit.output.look } : {})
        },
        sources,
        sourceTableDeclared: true,
        emptyProject: sources.length === 0,
        tracks,
        tracksDeclared: true,
        warnings,
        declaration: {
            ...(edit.audio !== undefined ? { audio: edit.audio } : {}),
            ...(edit.captions !== undefined ? { captions: edit.captions } : {})
        }
    };
}
function legacyKindOfV2Track(track, mainVisualTrack) {
    if (!('items' in track)) {
        return 'captions';
    }
    if (track.lane === 'audio') {
        return 'audio';
    }
    switch (track.items[0]?.source.kind) {
        case 'html': return 'overlays';
        case 'telop':
        case 'filter': return 'layers';
        default: return mainVisualTrack ? 'cuts' : 'layers';
    }
}
function nextRef(counters, kind) {
    const ref = counters.get(kind) ?? 0;
    counters.set(kind, ref + 1);
    return ref;
}
function buildV2Item(item, index, fps, ref, lane, mainVisualTrack, pathOf) {
    const atFrames = item.at;
    const durationFrames = item.duration;
    const at = atFrames / fps;
    const duration = durationFrames / fps;
    const keyframes = item.keyframes?.map(keyframe => ({ ...keyframe, t: keyframe.t / fps }));
    const common = {
        ...(item.transform !== undefined ? { transform: item.transform } : {}),
        ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
        ...(item.blend !== undefined ? { blend: item.blend } : {}),
        ...(item.crop !== undefined ? { crop: item.crop } : {}),
        ...(item.perspective !== undefined ? { perspective: item.perspective } : {}),
        ...(keyframes !== undefined ? { keyframes } : {})
    };
    switch (item.source.kind) {
        case 'media': {
            const path = pathOf(item.source.src);
            const source = {
                kind: 'media',
                sourceId: item.source.src,
                ...(path !== undefined ? { path } : {}),
                in: item.source.in,
                out: item.source.out
            };
            if (lane === 'audio') {
                const value = {
                    id: item.id,
                    t: at,
                    duration,
                    path: path ?? item.source.src,
                    track: ref,
                    in: item.source.in,
                    out: item.source.out
                };
                return {
                    item: {
                        id: item.id, atFrames, durationFrames, at, duration, source,
                        declaration: { id: item.id, t: at, duration, path: value.path, track: ref, in: value.in, out: value.out },
                        legacy: { collection: 'sfx', index, value }
                    }
                };
            }
            // 1 フレーム以内の差は速度変更ではなく尺合わせなので、trim の素材窓を詰める。
            // それを超える差だけを本物の速度変更として旧 cuts[].speed へ写す。
            const span = item.source.out - item.source.in;
            const freezeSeconds = isRecord(item.source.freeze)
                && typeof item.source.freeze.duration_sec === 'number'
                && Number.isFinite(item.source.freeze.duration_sec)
                ? Math.max(0, item.source.freeze.duration_sec) : 0;
            const playbackDuration = Math.max(0, duration - freezeSeconds);
            const alignsDuration = Math.abs(span - playbackDuration) <= 1 / fps + 1e-9;
            const cutOut = alignsDuration ? item.source.in + playbackDuration : item.source.out;
            const speed = !alignsDuration && playbackDuration > 0 ? span / playbackDuration : undefined;
            if (!mainVisualTrack) {
                const declaration = {
                    id: item.id, t: at, duration, kind: 'video', src: path ?? item.source.src,
                    track: ref, ...common, ...copyMediaSourceFields(item.source)
                };
                const value = declaration;
                return {
                    item: {
                        id: item.id, atFrames, durationFrames, at, duration, source,
                        declaration,
                        legacy: { collection: 'layers', index, value }
                    }
                };
            }
            const value = {
                in: item.source.in,
                out: cutOut,
                src: item.source.src,
                at,
                track: ref,
                ...(speed !== undefined ? { speed } : {}),
                ...(item.transform !== undefined ? { transform: item.transform } : {}),
                ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
                ...copyMediaSourceFields(item.source)
            };
            return {
                item: {
                    id: item.id, atFrames, durationFrames, at, duration, source,
                    declaration: {
                        id: item.id, src: item.source.src, in: item.source.in, out: cutOut, at, track: ref,
                        ...common, ...copyMediaSourceFields(item.source), ...(speed !== undefined ? { speed } : {})
                    },
                    legacy: { collection: 'cuts', index, value }
                }
            };
        }
        case 'html': {
            const declaration = {
                id: item.id, html: item.source.path, start: at, duration, track: ref,
                ...(item.source.vars !== undefined ? { vars: item.source.vars } : {}), ...common
            };
            const value = {
                id: item.id,
                start: at,
                duration,
                track: ref,
                payload: declaration
            };
            return {
                item: {
                    id: item.id, atFrames, durationFrames, at, duration,
                    source: { kind: 'html', html: item.source.path },
                    declaration,
                    legacy: { collection: 'overlays', index, value }
                }
            };
        }
        case 'telop': {
            const source = {
                kind: 'telop',
                preset: item.source.preset,
                ...(item.source.params !== undefined ? { params: item.source.params } : {}),
                ...(item.source.baked !== undefined ? { baked: item.source.baked } : {})
            };
            const declaration = {
                id: item.id, t: at, duration, kind: 'baked', src: item.source.baked,
                preset: item.source.preset, params: item.source.params, track: ref, ...common
            };
            if (item.source.baked === undefined) {
                return {
                    item: { id: item.id, atFrames, durationFrames, at, duration, source, declaration, legacy: { collection: 'layers', index } }
                };
            }
            const value = {
                id: item.id,
                t: at,
                duration,
                kind: 'baked',
                src: item.source.baked,
                track: ref,
                ...(item.source.preset !== undefined ? { preset: item.source.preset } : {}),
                ...(item.transform !== undefined ? { transform: item.transform } : {}),
                ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
                ...(item.blend !== undefined ? { blend: item.blend } : {})
            };
            return {
                item: { id: item.id, atFrames, durationFrames, at, duration, source, declaration, legacy: { collection: 'layers', index, value } }
            };
        }
        default: {
            const source = { kind: 'filter', filter: item.source.filter };
            return {
                item: {
                    id: item.id, atFrames, durationFrames, at, duration, source,
                    declaration: {
                        id: item.id, t: at, duration, kind: 'filter',
                        filter: item.source.filter, track: ref, ...common
                    },
                    legacy: { collection: 'layers', index }
                }
            };
        }
    }
}
function copyMediaSourceFields(source) {
    return {
        ...(source.framing !== undefined ? { framing: source.framing } : {}),
        ...(source.transition_out !== undefined ? { transition_out: source.transition_out } : {}),
        ...(source.freeze !== undefined ? { freeze: source.freeze } : {}),
        ...(source.fx !== undefined ? { fx: source.fx } : {}),
        ...(source.speed !== undefined ? { speed: source.speed } : {}),
        ...(source.chroma_key !== undefined ? { chroma_key: source.chroma_key } : {})
    };
}
/** v2 が秒のまま持ち越した audio を、表示用の audio lane へ落とさず射影する。 */
function addV2AudioItems(tracks, audioValue, fps) {
    const audio = isRecord(audioValue) ? audioValue : undefined;
    if (!audio)
        return;
    const ensureTrack = (ref) => {
        let track = tracks.find(candidate => candidate.lane === 'audio' && (candidate.legacy.ref ?? 0) === ref);
        if (!track) {
            track = {
                id: `implicit-audio-${ref}`,
                lane: 'audio', z: tracks.length, origin: 'implicit', items: [], legacy: { kind: 'audio', ref }
            };
            tracks.push(track);
        }
        return track;
    };
    const sfx = Array.isArray(audio.sfx) ? audio.sfx : [];
    sfx.forEach((entry, index) => {
        if (!isRecord(entry) || typeof entry.path !== 'string' || !entry.path.trim() || typeof entry.t !== 'number')
            return;
        const ref = normalizeTrackNumber(entry.track);
        const start = typeof entry.in === 'number' ? entry.in : 0;
        // 実尺がまだ解決できない最小宣言では、タイムライン上で操作できる 1 秒の
        // 仮尺を与える。素材尺を読むレンダー経路は生の audio.sfx を使うため、
        // これは表示専用の従来互換値である。
        const end = typeof entry.out === 'number' && entry.out > start ? entry.out : start + 1;
        const duration = Math.max(0, end - start);
        const value = {
            id: typeof entry.id === 'string' ? entry.id : `sfx-${index}`,
            t: entry.t, duration, path: entry.path, track: ref, in: start,
            ...(end > start ? { out: end } : {}),
            ...(typeof entry.gain_db === 'number' ? { gainDb: entry.gain_db } : {})
        };
        ensureTrack(ref).items.push({
            id: value.id,
            atFrames: Math.round(value.t * fps), durationFrames: Math.round(duration * fps),
            at: value.t, duration,
            source: { kind: 'media', path: value.path, in: start, out: end },
            declaration: entry,
            legacy: { collection: 'sfx', index, value }
        });
    });
    const narration = Array.isArray(audio.narration) ? audio.narration : [];
    narration.forEach((entry, index) => {
        if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.t !== 'number')
            return;
        const value = {
            id: typeof entry.id === 'string' ? entry.id : `n-${String(index + 1).padStart(4, '0')}`,
            t: entry.t, path: entry.path,
            ...(typeof entry.gain_db === 'number' ? { gainDb: entry.gain_db } : {}),
            ...(typeof entry.script === 'string' ? { script: entry.script } : {})
        };
        ensureTrack(0).items.push({
            id: value.id, atFrames: Math.round(value.t * fps), durationFrames: 0,
            at: value.t, duration: 0,
            source: { kind: 'media', path: value.path, in: 0, out: 0 },
            declaration: entry,
            legacy: { collection: 'narration', index, value }
        });
    });
    if (isRecord(audio.bgm) && typeof audio.bgm.path === 'string') {
        const entry = audio.bgm;
        const value = {
            id: 'bgm', path: entry.path,
            ...(typeof entry.fadeIn === 'number' ? { fadeIn: entry.fadeIn } : {}),
            ...(typeof entry.fadeOut === 'number' ? { fadeOut: entry.fadeOut } : {}),
            ...(typeof entry.gain_db === 'number' ? { gainDb: entry.gain_db } : {}),
            ...(typeof entry.ducking === 'boolean' ? { ducking: entry.ducking } : {})
        };
        ensureTrack(0).items.push({
            id: 'bgm', atFrames: 0, durationFrames: 0, at: 0, duration: 0,
            source: { kind: 'media', path: value.path, in: 0, out: 0 },
            declaration: entry,
            legacy: { collection: 'bgm', index: 0, value }
        });
    }
    tracks.forEach((track, index) => { track.z = index; });
}
/**
 * 内部表現 → 旧種別別配列。**`tracks[].items[]` だけを見て組み立てる**（生 JSON も版も見ない）。
 * まだ内部表現へ移せていない描画経路のための橋で、Phase 3 で消える。
 */
function projectLegacyEdit(internal) {
    const cuts = [];
    const overlays = [];
    const layers = [];
    const audioSfx = [];
    const audioNarration = [];
    let audioBgm;
    for (const track of internal.tracks) {
        for (const item of track.items) {
            const value = item.legacy.value;
            if (value === undefined) {
                // 未焼成 telop / filter は旧型 EditLayer に完全には表せないが、
                // 消費者から黙って消すより宣言レコードを運ぶ方が安全。
                if (item.source.kind === 'telop' || item.source.kind === 'filter') {
                    layers.push({ index: item.legacy.index, value: item.declaration });
                }
                continue;
            }
            switch (item.source.kind) {
                case 'media':
                    // 同じ「読んで重ねるだけの素材」でも旧宣言では 4 つの配列に散っていた
                    // （cuts / layers(video) / audio.sfx / audio.narration / audio.bgm）。
                    // 内部表現では 1 種別なので、旧配列への振り分けだけが collection を見る。
                    switch (item.legacy.collection) {
                        case 'sfx':
                            audioSfx.push({ index: item.legacy.index, value: value });
                            break;
                        case 'narration':
                            audioNarration.push({ index: item.legacy.index, value: value });
                            break;
                        case 'bgm':
                            audioBgm = value;
                            break;
                        case 'layers':
                            layers.push({ index: item.legacy.index, value: value });
                            break;
                        default:
                            cuts.push({ index: item.legacy.index, value: value });
                            break;
                    }
                    break;
                case 'html':
                    overlays.push({ index: item.legacy.index, value: value });
                    break;
                case 'telop':
                case 'filter':
                    layers.push({ index: item.legacy.index, value: value });
                    break;
                default:
                    break;
            }
        }
    }
    const declaredTracks = internal.tracks
        .filter(track => track.origin === 'declared')
        .map(toLegacyTrack);
    return {
        cuts: byDeclarationOrder(cuts),
        ...(internal.sourceTableDeclared
            ? {
                sources: internal.sources
                    .filter(entry => entry.path !== undefined)
                    .map(entry => ({ id: entry.id, path: entry.path, proxy: entry.proxy }))
            }
            : {}),
        overlays: byDeclarationOrder(overlays),
        ...(internal.beats !== undefined ? { beats: internal.beats } : {}),
        layers: byDeclarationOrder(layers),
        audioSfx: byDeclarationOrder(audioSfx),
        audioNarration: byDeclarationOrder(audioNarration),
        ...(audioBgm ? { audioBgm } : {}),
        ...(internal.tracksDeclared ? { timeline: { tracks: declaredTracks } } : {}),
        fps: internal.output.fps,
        warnings: internal.warnings
    };
}
/** 内部トラック → 旧 timeline.tracks 要素。 */
function toLegacyTrack(track) {
    return {
        id: track.id,
        kind: track.legacy.kind,
        ...(track.legacy.ref === undefined ? {} : { ref: track.legacy.ref }),
        ...(track.name === undefined ? {} : { label: track.name }),
        ...(track.muted === undefined ? {} : { muted: track.muted }),
        ...(track.hidden === undefined ? {} : { hidden: track.hidden }),
        ...(track.locked === undefined ? {} : { locked: track.locked })
    };
}
/** `timeline.tracks` を宣言していないプロジェクトの既定行（読み込み層が導出した順のまま）。 */
function derivedLegacyTracks(internal) {
    return internal.tracks.filter(track => track.origin === 'derived').map(toLegacyTrack);
}
function byDeclarationOrder(entries) {
    return [...entries].sort((left, right) => left.index - right.index).map(entry => entry.value);
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function normalizeTrackNumber(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
