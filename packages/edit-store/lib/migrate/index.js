"use strict";
/**
 * v0/v1 -> v2 凍結変換ユニット。
 *
 * 変換器は機能追加禁止・バグ修正のみ。未知ケースは「このプロジェクトは
 * 変換できません」と正直に止まる。将来 `akari-migrate` へそのまま切り出すため、
 * ファイル変換の意味論はこの 1 ファイルに閉じる。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEdit = exports.LegacyEditVersionError = void 0;
exports.detectEditVersion = detectEditVersion;
exports.migrateEditToV2 = migrateEditToV2;
exports.planMigration = planMigration;
exports.applyMigration = applyMigration;
exports.revertMigration = revertMigration;
const fs_1 = require("fs");
const path_1 = require("path");
const write_gate_1 = require("../write-gate");
var error_1 = require("./error");
Object.defineProperty(exports, "LegacyEditVersionError", { enumerable: true, get: function () { return error_1.LegacyEditVersionError; } });
var legacy_parse_1 = require("./legacy-parse");
Object.defineProperty(exports, "parseEdit", { enumerable: true, get: function () { return legacy_parse_1.parseEdit; } });
const TOP_KEYS = new Set([
    'version', 'output', 'source', 'sources', 'cuts', 'overlays', 'layers', 'audio', 'captions', 'timeline',
    'thumbnail'
]);
const CUT_KEYS = new Set([
    'id', 'src', 'in', 'out', 'at', 'track', 'crop', 'transform', 'opacity', 'framing',
    'transition_out', 'freeze', 'fx', 'speed', 'chroma_key'
]);
const OVERLAY_KEYS = new Set(['id', 'html', 'start', 'duration', 'vars', 'transform', 'track']);
const LAYER_KEYS = new Set([
    'id', 't', 'duration', 'kind', 'src', 'transform', 'crop', 'perspective', 'opacity',
    'keyframes', 'preset', 'params', 'track', 'blend', 'chroma_key'
]);
function detectEditVersion(raw) {
    return isRecord(raw) && typeof raw.version === 'number' && Number.isFinite(raw.version)
        ? raw.version : undefined;
}
function migrateEditToV2(raw, options = {}) {
    const version = detectEditVersion(raw);
    if (version === 2) {
        return { ok: false, version, blockers: ['edit.json はすでに version 2 です。再変換は行いません。'] };
    }
    if (version !== 0 && version !== 1) {
        return { ok: false, version: version ?? -1, blockers: ['edit.json.version が 0 または 1 ではありません。'] };
    }
    if (!isRecord(raw)) {
        return { ok: false, version, blockers: ['edit.json のルートが object ではありません。'] };
    }
    const blockers = [];
    rejectUnknownKeys(raw, TOP_KEYS, 'edit.json', blockers);
    if (hasOwn(raw, 'tracks')) {
        blockers.push('edit.json.tracks（旧 trackState）は v2 へ一意に変換できません。');
    }
    const output = isRecord(raw.output) ? raw.output : undefined;
    const fps = output?.fps;
    if (!output || !positive(output.width) || !positive(output.height)) {
        blockers.push('edit.json.output.width / height に 0 より大きい数が必要です。');
    }
    if (!Number.isInteger(fps) || fps <= 0) {
        blockers.push('edit.json.output.fps は 1 以上の整数でなければ v2 へ変換できません。');
    }
    if (blockers.length > 0)
        return { ok: false, version, blockers };
    const frameRate = fps;
    const sources = [];
    if (version === 0) {
        if (!isRecord(raw.source) || !nonEmpty(raw.source.path)) {
            blockers.push('version 0 の edit.json.source.path がありません。');
        }
        else {
            sources.push({
                id: 'main', path: raw.source.path,
                ...(hasOwn(raw.source, 'proxy') ? { proxy: raw.source.proxy } : {}),
                ...(hasOwn(raw.source, 'chroma_key') ? { chroma_key: clone(raw.source.chroma_key) } : {})
            });
        }
    }
    else if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
        blockers.push('version 1 の edit.json.sources[] がありません。');
    }
    else {
        const ids = new Set();
        raw.sources.forEach((source, index) => {
            if (!isRecord(source) || !nonEmpty(source.id) || !nonEmpty(source.path)) {
                blockers.push(`edit.json.sources[${index}] の id / path が不正です。`);
                return;
            }
            if (ids.has(source.id))
                blockers.push(`edit.json.sources[].id が重複しています: ${source.id}`);
            ids.add(source.id);
            sources.push({
                id: source.id, path: source.path,
                ...(hasOwn(source, 'proxy') ? { proxy: source.proxy } : {}),
                ...(hasOwn(source, 'chroma_key') ? { chroma_key: clone(source.chroma_key) } : {})
            });
        });
    }
    if (blockers.length > 0)
        return { ok: false, version, blockers };
    const sourceIds = new Set(sources.map(source => String(source.id)));
    const sourceIdByPath = new Map(sources.map(source => [String(source.path), String(source.id)]));
    const pending = [];
    const usedItemIds = new Set();
    const cuts = arrayOrEmpty(raw.cuts, 'edit.json.cuts', blockers);
    const cursorByTrack = new Map();
    const previousCutByTrack = new Map();
    cuts.forEach((value, index) => {
        if (!isRecord(value)) {
            blockers.push(`edit.json.cuts[${index}] が object ではありません。`);
            return;
        }
        rejectUnknownKeys(value, CUT_KEYS, `edit.json.cuts[${index}]`, blockers);
        const src = version === 0 ? 'main' : value.src;
        if (!nonEmpty(src) || !sourceIds.has(src)) {
            blockers.push(`edit.json.cuts[${index}].src が sources[] を参照していません。`);
            return;
        }
        if (!nonNegative(value.in) || !positive(value.out) || value.out <= value.in) {
            blockers.push(`edit.json.cuts[${index}] は 0 <= in < out を満たしません。`);
            return;
        }
        const track = trackOf(value.track);
        const speed = positive(value.speed) ? value.speed : 1;
        const baseDuration = (value.out - value.in) / speed;
        const freezeDuration = isRecord(value.freeze) && positive(value.freeze.duration_sec)
            ? value.freeze.duration_sec : 0;
        const previous = previousCutByTrack.get(track);
        const transitionOverlap = value.at === undefined && previous && isRecord(previous.transition_out)
            && positive(previous.transition_out.duration) ? previous.transition_out.duration : 0;
        const atSeconds = nonNegative(value.at)
            ? value.at : (cursorByTrack.get(track) ?? 0) - transitionOverlap;
        const durationSeconds = baseDuration + freezeDuration;
        cursorByTrack.set(track, atSeconds + durationSeconds);
        previousCutByTrack.set(track, value);
        const source = {
            kind: 'media', src, in: value.in, out: value.out,
            ...copyPresent(value, ['framing', 'transition_out', 'freeze', 'fx', 'speed', 'chroma_key'])
        };
        pending.push({
            kind: 'cuts', ref: track,
            item: {
                id: uniqueId(nonEmpty(value.id) ? value.id : `cut-${index + 1}`, usedItemIds),
                ...frameRange(atSeconds, durationSeconds, frameRate),
                ...copyPresent(value, ['transform', 'opacity', 'crop']),
                source
            }
        });
    });
    const overlays = arrayOrEmpty(raw.overlays, 'edit.json.overlays', blockers);
    overlays.forEach((value, index) => {
        if (!isRecord(value)) {
            blockers.push(`edit.json.overlays[${index}] が object ではありません。`);
            return;
        }
        rejectUnknownKeys(value, OVERLAY_KEYS, `edit.json.overlays[${index}]`, blockers);
        if (!nonEmpty(value.html) || !nonNegative(value.start) || !positive(value.duration)) {
            blockers.push(`edit.json.overlays[${index}] の html / start / duration が不正です。`);
            return;
        }
        pending.push({
            kind: 'overlays', ref: trackOf(value.track),
            item: {
                id: uniqueId(nonEmpty(value.id) ? value.id : `overlay-${index + 1}`, usedItemIds),
                ...frameRange(value.start, value.duration, frameRate),
                ...copyPresent(value, ['transform']),
                source: { kind: 'html', path: value.html, ...copyPresent(value, ['vars']) }
            }
        });
    });
    const layers = arrayOrEmpty(raw.layers, 'edit.json.layers', blockers);
    let layerSourceSerial = 1;
    layers.forEach((value, index) => {
        if (!isRecord(value)) {
            blockers.push(`edit.json.layers[${index}] が object ではあません。`);
            return;
        }
        rejectUnknownKeys(value, LAYER_KEYS, `edit.json.layers[${index}]`, blockers);
        if (!['video', 'image', 'baked'].includes(String(value.kind))) {
            blockers.push(`edit.json.layers[${index}].kind は video / image / baked のいずれかである必要があります。`);
            return;
        }
        if (!nonEmpty(value.src) || !nonNegative(value.t) || !positive(value.duration)) {
            blockers.push(`edit.json.layers[${index}] の src / t / duration が不正です。`);
            return;
        }
        let source;
        if (value.kind === 'baked' && nonEmpty(value.preset)) {
            source = {
                kind: 'telop', preset: value.preset,
                ...copyPresent(value, ['params']), baked: value.src
            };
        }
        else {
            let src = sourceIdByPath.get(value.src);
            if (!src) {
                do
                    src = `l-${layerSourceSerial++}`;
                while (sourceIds.has(src));
                sourceIds.add(src);
                sourceIdByPath.set(value.src, src);
                sources.push({ id: src, path: value.src, proxy: null });
            }
            source = { kind: 'media', src, in: 0, out: value.duration, ...copyPresent(value, ['chroma_key']) };
        }
        const keyframes = Array.isArray(value.keyframes)
            ? value.keyframes.map((entry, keyframeIndex) => {
                if (!isRecord(entry) || !nonNegative(entry.t)) {
                    blockers.push(`edit.json.layers[${index}].keyframes[${keyframeIndex}].t が不正です。`);
                    return { t: 0 };
                }
                return { ...clone(entry), t: Math.round(entry.t * frameRate) };
            }) : undefined;
        pending.push({
            kind: 'layers', ref: trackOf(value.track),
            item: {
                id: uniqueId(nonEmpty(value.id) ? value.id : `layer-${index + 1}`, usedItemIds),
                ...frameRange(value.t, value.duration, frameRate),
                ...copyPresent(value, ['transform', 'crop', 'perspective', 'opacity', 'blend']),
                ...(keyframes ? { keyframes } : {}), source
            }
        });
    });
    if (blockers.length > 0)
        return { ok: false, version, blockers };
    const trackDefs = readTrackDefs(raw.timeline, pending, legacyAudioTrackRefs(raw.audio), options.hasCaptions === true || Array.isArray(raw.captions), blockers);
    if (blockers.length > 0)
        return { ok: false, version, blockers };
    const tracks = trackDefs.map(def => {
        if (def.kind === 'captions') {
            return { id: def.id, lane: 'visual', ...(def.label !== undefined ? { name: def.label } : {}), content: { from: 'captions.json' } };
        }
        const lane = def.kind === 'audio' ? 'audio' : 'visual';
        return {
            id: def.id, lane, ...(def.label !== undefined ? { name: def.label } : {}),
            items: pending.filter(entry => entry.kind === def.kind && entry.ref === (def.ref ?? 0)).map(entry => entry.item)
        };
    });
    // timeline が壊れていてアイテムに対応する行が無い場合は黙って落とさない。
    for (const entry of pending) {
        if (!trackDefs.some(def => def.kind === entry.kind && (def.ref ?? 0) === entry.ref)) {
            blockers.push(`timeline.tracks に ${entry.kind} ref=${entry.ref} の行がありません。`);
        }
    }
    if (blockers.length > 0)
        return { ok: false, version, blockers };
    const doc = {
        version: 2,
        output: clone(output),
        sources: sources,
        tracks,
        ...(raw.audio !== undefined ? { audio: clone(raw.audio) } : {}),
        ...(raw.captions !== undefined ? { captions: clone(raw.captions) } : {}),
        ...(raw.thumbnail !== undefined ? { thumbnail: clone(raw.thumbnail) } : {})
    };
    const changes = [
        { path: 'version', note: 'edit.json version 0/1 を version 2 へ更新' },
        { path: 'cuts/overlays/layers', note: 'tracks[].items[] と source.kind へ移し、出力時刻を整数フレームに確定' },
        { path: 'timeline.tracks', note: '(種別, ref) の行を tracks[] へ縦順のまま移行' }
    ];
    if (raw.audio !== undefined)
        changes.push({ path: 'audio', note: '音声の秒宣言は変更せず持ち越し' });
    if (raw.thumbnail !== undefined)
        changes.push({ path: 'thumbnail', note: 'サムネイル参照を変更せず持ち越し' });
    return { ok: true, version, doc, changes, warnings: [] };
}
function planMigration(projectRoot, editPath, text, options = {}) {
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (error) {
        return { ok: false, version: -1, blockers: [`edit.json を JSON として読めません: ${messageOf(error)}`] };
    }
    const migrated = migrateEditToV2(raw, options);
    if ('blockers' in migrated) {
        return { ok: false, version: migrated.version, blockers: migrated.blockers };
    }
    const iso = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
    return {
        filePath: (0, path_1.resolve)(editPath), version: migrated.version, changes: migrated.changes,
        warnings: migrated.warnings, nextText: `${JSON.stringify(migrated.doc, null, 2)}\n`, previousText: text,
        backupPath: (0, path_1.join)((0, path_1.resolve)(projectRoot), '.akari', 'backup', `edit-${iso}.json`)
    };
}
/** 承認後のみ実行する。先に .akari/backup/ へ原文を退避し、次に atomic rename する。 */
async function applyMigration(proposal) {
    await (0, write_gate_1.writeAtomic)(proposal.backupPath, proposal.previousText);
    await (0, write_gate_1.writeAtomic)(proposal.filePath, proposal.nextText);
}
/** 退避した原文を 1 手で edit.json へ戻す。backup 自体は監査記録として残す。 */
async function revertMigration(proposal) {
    const original = await fs_1.promises.readFile(proposal.backupPath, 'utf8');
    await (0, write_gate_1.writeAtomic)(proposal.filePath, original);
}
function readTrackDefs(timeline, pending, audioRefs, hasCaptions, blockers) {
    if (timeline !== undefined) {
        if (!isRecord(timeline) || !Array.isArray(timeline.tracks)) {
            blockers.push('edit.json.timeline.tracks が配列ではありません。');
            return [];
        }
        const ids = new Set();
        return timeline.tracks.flatMap((value, index) => {
            if (!isRecord(value) || !nonEmpty(value.id)
                || !['cuts', 'layers', 'overlays', 'captions', 'audio'].includes(String(value.kind))) {
                blockers.push(`edit.json.timeline.tracks[${index}] の id / kind が不正です。`);
                return [];
            }
            if (ids.has(value.id))
                blockers.push(`timeline.tracks[].id が重複しています: ${value.id}`);
            ids.add(value.id);
            return [{
                    id: value.id,
                    kind: value.kind,
                    ...(value.kind === 'captions' ? {} : { ref: trackOf(value.ref) }),
                    ...(typeof value.label === 'string' ? { label: value.label } : {})
                }];
        });
    }
    const defs = [];
    const append = (kind, ref) => {
        defs.push({ id: `t${defs.length + 1}`, kind, ...(ref === undefined ? {} : { ref }) });
    };
    for (const kind of ['cuts', 'layers', 'overlays']) {
        const refs = [...new Set(pending.filter(entry => entry.kind === kind).map(entry => entry.ref))].sort((a, b) => a - b);
        refs.forEach(ref => append(kind, ref));
    }
    if (hasCaptions)
        append('captions');
    audioRefs.forEach(ref => append('audio', ref));
    return defs;
}
function legacyAudioTrackRefs(value) {
    const audio = isRecord(value) ? value : undefined;
    if (!audio)
        return [];
    const refs = new Set();
    if (Array.isArray(audio.sfx)) {
        for (const entry of audio.sfx)
            if (isRecord(entry))
                refs.add(trackOf(entry.track));
    }
    if (Array.isArray(audio.narration) && audio.narration.length > 0)
        refs.add(0);
    if (isRecord(audio.bgm))
        refs.add(0);
    return [...refs].sort((a, b) => a - b);
}
function arrayOrEmpty(value, path, blockers) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value)) {
        blockers.push(`${path} が配列ではありません。`);
        return [];
    }
    return value;
}
function frameRange(atSeconds, durationSeconds, fps) {
    const at = Math.round(atSeconds * fps);
    const end = Math.round((atSeconds + durationSeconds) * fps);
    return { at, duration: Math.max(1, end - at) };
}
function uniqueId(candidate, used) {
    let id = candidate;
    let suffix = 2;
    while (used.has(id))
        id = `${candidate}-${suffix++}`;
    used.add(id);
    return id;
}
function copyPresent(source, keys) {
    return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, clone(source[key])]));
}
function rejectUnknownKeys(value, allowed, path, blockers) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key))
            blockers.push(`${path}.${key} は凍結変換器が対応しない未知フィールドです。`);
    }
}
function clone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function positive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function nonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function trackOf(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
