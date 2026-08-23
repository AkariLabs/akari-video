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
const node_fs_1 = require("node:fs");
const path_1 = require("path");
const write_gate_1 = require("../write-gate");
const edit_v2_1 = require("../edit-v2");
var error_1 = require("./error");
Object.defineProperty(exports, "LegacyEditVersionError", { enumerable: true, get: function () { return error_1.LegacyEditVersionError; } });
var legacy_parse_1 = require("./legacy-parse");
Object.defineProperty(exports, "parseEdit", { enumerable: true, get: function () { return legacy_parse_1.parseEdit; } });
const TOP_KEYS = new Set([
    'version', 'output', 'source', 'sources', 'cuts', 'overlays', 'layers', 'audio', 'captions', 'timeline',
    'thumbnail', 'emphasis_words'
]);
const CUT_KEYS = new Set([
    'id', 'src', 'in', 'out', 'at', 'track', 'crop', 'transform', 'opacity', 'framing',
    'transition_out', 'freeze', 'fx', 'speed', 'chroma_key'
]);
const OVERLAY_KEYS = new Set(['id', 'html', 'start', 'duration', 'vars', 'transform', 'track']);
const LAYER_KEYS = new Set([
    'id', 't', 'duration', 'kind', 'src', 'transform', 'crop', 'perspective', 'opacity',
    'keyframes', 'preset', 'params', 'track', 'blend', 'chroma_key', 'filter'
]);
const SFX_KEYS = new Set(['id', 't', 'path', 'track', 'gain_db', 'in', 'out', 'fade_in', 'fade_out']);
const NARRATION_KEYS = new Set(['id', 't', 'path', 'gain_db', 'script', 'reading', 'provenance']);
const BGM_KEYS = new Set(['id', 'path', 'in', 'fadeIn', 'fadeOut', 'gain_db', 'ducking']);
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
            blockers.push(`edit.json.layers[${index}] が object ではありません。`);
            return;
        }
        rejectUnknownKeys(value, LAYER_KEYS, `edit.json.layers[${index}]`, blockers);
        if (!['video', 'image', 'baked', 'filter'].includes(String(value.kind))) {
            blockers.push(`edit.json.layers[${index}].kind は video / image / baked / filter のいずれかである必要があります。`);
            return;
        }
        if (value.kind !== 'filter' && hasOwn(value, 'filter')) {
            blockers.push(`edit.json.layers[${index}].filter（映像レイヤー直付きの filter）は v2 に等価表現が無いため変換できません。`);
            return;
        }
        if (!nonNegative(value.t) || !positive(value.duration)) {
            blockers.push(`edit.json.layers[${index}] の t / duration が不正です。`);
            return;
        }
        let source;
        if (value.kind === 'filter') {
            const forbidden = ['src', 'chroma_key', 'blend', 'crop', 'transform'].filter(key => hasOwn(value, key));
            if (forbidden.length > 0) {
                blockers.push(`edit.json.layers[${index}] の kind filter は ${forbidden.join(' / ')} を持てません。`);
                return;
            }
            source = { kind: 'filter', filter: clone(value.filter) };
        }
        else if (!nonEmpty(value.src)) {
            blockers.push(`edit.json.layers[${index}].src が不正です。`);
            return;
        }
        else if (value.kind === 'baked' && nonEmpty(value.preset)) {
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
    const audio = isRecord(raw.audio) ? raw.audio : undefined;
    if (raw.audio !== undefined && !audio) {
        blockers.push('edit.json.audio が object ではありません。');
    }
    const audioTrackRefs = legacyAudioTrackRefs(audio);
    let audioSourceSerial = 1;
    const audioSourceId = (path) => {
        const existing = sourceIdByPath.get(path);
        if (existing)
            return existing;
        let id;
        do
            id = `a-${audioSourceSerial++}`;
        while (sourceIds.has(id));
        sourceIds.add(id);
        sourceIdByPath.set(path, id);
        sources.push({ id, path, proxy: null });
        return id;
    };
    const sfx = arrayOrEmpty(audio?.sfx ?? undefined, 'edit.json.audio.sfx', blockers);
    sfx.forEach((value, index) => {
        const itemPath = `edit.json.audio.sfx[${index}]`;
        if (!isRecord(value)) {
            blockers.push(`${itemPath} が object ではありません。`);
            return;
        }
        rejectUnknownKeys(value, SFX_KEYS, itemPath, blockers);
        const inSeconds = value.in === undefined ? 0 : value.in;
        if (!nonEmpty(value.path) || !nonNegative(value.t) || !nonNegative(inSeconds)
            || (value.out !== undefined && (!positive(value.out) || value.out <= inSeconds))
            || (value.gain_db !== undefined && !gainDb(value.gain_db))
            || (value.fade_in !== undefined && !nonNegative(value.fade_in))
            || (value.fade_out !== undefined && !nonNegative(value.fade_out))) {
            blockers.push(`${itemPath} の path / t / in / out / gain_db / fade_in / fade_out が不正です。`);
            return;
        }
        const source = {
            kind: 'media', src: audioSourceId(value.path), in: inSeconds,
            ...(value.out !== undefined ? { out: value.out } : {})
        };
        const item = {
            id: uniqueId(nonEmpty(value.id) ? value.id : `sfx-${index}`, usedItemIds),
            at: Math.round(value.t * frameRate),
            duration: value.out !== undefined
                ? Math.round((value.out - inSeconds) * frameRate)
                : 0,
            source,
            ...(value.gain_db !== undefined ? { gain_db: value.gain_db } : {}),
            ...(value.fade_in !== undefined ? { fade_in: value.fade_in } : {}),
            ...(value.fade_out !== undefined ? { fade_out: value.fade_out } : {})
        };
        pending.push({ kind: 'audio', ref: trackOf(value.track), item });
    });
    const narration = arrayOrEmpty(audio?.narration, 'edit.json.audio.narration', blockers);
    narration.forEach((value, index) => {
        const itemPath = `edit.json.audio.narration[${index}]`;
        if (!isRecord(value)) {
            blockers.push(`${itemPath} が object ではありません。`);
            return;
        }
        rejectUnknownKeys(value, NARRATION_KEYS, itemPath, blockers);
        if (!nonEmpty(value.path) || !nonNegative(value.t)
            || (value.gain_db !== undefined && !gainDb(value.gain_db))
            || (value.script !== undefined && typeof value.script !== 'string')
            || (value.reading !== undefined && typeof value.reading !== 'string')
            || !validNarrationProvenance(value.provenance)) {
            blockers.push(`${itemPath} の path / t / gain_db / script / reading / provenance が不正です。`);
            return;
        }
        const item = {
            id: uniqueId(nonEmpty(value.id) ? value.id : `narration-${index + 1}`, usedItemIds),
            at: Math.round(value.t * frameRate),
            duration: 0,
            role: 'narration',
            source: { kind: 'media', src: audioSourceId(value.path), in: 0 },
            ...(value.gain_db !== undefined ? { gain_db: value.gain_db } : {}),
            ...(value.script !== undefined ? { script: value.script } : {}),
            ...(value.reading !== undefined ? { reading: value.reading } : {}),
            provenance: clone(value.provenance)
        };
        pending.push({ kind: 'audio', ref: audioTrackRefs.narration, item });
    });
    if (audio?.bgm !== undefined && audio.bgm !== null) {
        const value = audio.bgm;
        if (!isRecord(value)) {
            blockers.push('edit.json.audio.bgm が object ではありません。');
        }
        else {
            rejectUnknownKeys(value, BGM_KEYS, 'edit.json.audio.bgm', blockers);
            if (!nonEmpty(value.path)
                || (value.in !== undefined && !nonNegative(value.in))
                || (value.fadeIn !== undefined && !nonNegative(value.fadeIn))
                || (value.fadeOut !== undefined && !nonNegative(value.fadeOut))
                || (value.gain_db !== undefined && !gainDb(value.gain_db))
                || (value.ducking !== undefined && typeof value.ducking !== 'boolean')) {
                blockers.push('edit.json.audio.bgm の path / in / fadeIn / fadeOut / gain_db / ducking が不正です。');
            }
            else if (usedItemIds.has('bgm')) {
                blockers.push('audio.bgm の固定 item id "bgm" が他の item id と重複します。');
            }
            else {
                usedItemIds.add('bgm');
                pending.push({
                    kind: 'audio', ref: audioTrackRefs.bgm,
                    item: {
                        id: 'bgm', at: 0, duration: 0, role: 'bgm',
                        source: { kind: 'media', src: audioSourceId(value.path), in: value.in ?? 0 },
                        ...(value.fadeIn !== undefined ? { fade_in: value.fadeIn } : {}),
                        ...(value.fadeOut !== undefined ? { fade_out: value.fadeOut } : {}),
                        ...(value.gain_db !== undefined ? { gain_db: value.gain_db } : {}),
                        ...(value.ducking !== undefined ? { ducking: value.ducking } : {})
                    }
                });
            }
        }
    }
    if (blockers.length > 0)
        return { ok: false, version, blockers };
    const hasCaptions = options.hasCaptions === true || Array.isArray(raw.captions);
    const trackDefs = readTrackDefs(raw.timeline, pending, audioTrackRefs.all, hasCaptions, blockers);
    if (blockers.length > 0)
        return { ok: false, version, blockers };
    const tracks = trackDefs.map(def => {
        if (def.kind === 'captions') {
            return { id: def.id, lane: 'visual', ...(def.label !== undefined ? { name: def.label } : {}), content: { from: 'captions.json' } };
        }
        const lane = def.kind === 'audio' ? 'audio' : 'visual';
        return {
            id: def.id, lane, ...(def.label !== undefined ? { name: def.label } : {}),
            items: pending.filter(entry => entry.kind === def.kind && entry.ref === (def.ref ?? 0))
                .map(entry => entry.item)
        };
    });
    // timeline が壊れていてアイテムに対応する行が無い場合は黙って落とさない。
    for (const entry of pending) {
        if (!trackDefs.some(def => def.kind === entry.kind && (def.ref ?? 0) === entry.ref)) {
            blockers.push(`timeline.tracks に ${entry.kind} ref=${entry.ref} の行がありません。`);
        }
    }
    // captions は pending に乗らないため上のループでは検出できない。cuts/overlays/layers と
    // 同じ「黙って落とさない」安全網を captions にも適用する（P0 2026-08-21
    // track-z-undeclared-kind: timeline.tracks を部分宣言し captions 行だけ書き忘れると、
    // captions トラックが変換後の tracks[] から跡形もなく消え、字幕が無警告で失われていた）。
    if (hasCaptions && raw.timeline !== undefined && !trackDefs.some(def => def.kind === 'captions')) {
        blockers.push('timeline.tracks に captions 行がありません。captions.json / captions[] が存在するため、このまま変換すると字幕が失われます。');
    }
    if (blockers.length > 0)
        return { ok: false, version, blockers };
    const doc = {
        version: 2,
        output: clone(output),
        sources: sources,
        tracks,
        ...(audio?.master !== undefined ? { audio: { master: clone(audio.master) } } : {}),
        ...(raw.captions !== undefined ? { captions: clone(raw.captions) } : {}),
        ...(raw.thumbnail !== undefined ? { thumbnail: clone(raw.thumbnail) } : {})
    };
    const changes = [
        { path: 'version', note: 'edit.json version 0/1 を version 2 へ更新' },
        { path: 'cuts/overlays/layers', note: 'tracks[].items[] と source.kind へ移し、出力時刻を整数フレームに確定' },
        { path: 'timeline.tracks', note: '(種別, ref) の visual 行の相対順を保ち、audio 行を用途別の ref へ分離して先頭へ移行' }
    ];
    if (raw.audio !== undefined)
        changes.push({
            path: 'audio',
            note: 'BGM・ナレーション・SE を tracks[].items[] へ移し、出力側 at/duration は整数フレーム、素材側 in/out/fade/bgm.in は秒のまま維持'
        });
    if (raw.emphasis_words !== undefined)
        changes.push({
            path: 'emphasis_words',
            note: 'edit.json v2 から除外し、captions.json のトップレベル emphasis_words[] へ移送'
        });
    if (raw.thumbnail !== undefined)
        changes.push({ path: 'thumbnail', note: 'サムネイル参照を変更せず持ち越し' });
    if (pending.reduce((sum, entry) => sum + tracks.filter(track => 'items' in track
        && track.items.some(item => item === entry.item)).length, 0) !== pending.length) {
        return { ok: false, version, blockers: ['変換後の tracks[] が pending item を一意に保持していません。'] };
    }
    try {
        (0, edit_v2_1.readEditV2)(doc);
    }
    catch (error) {
        return {
            ok: false,
            version,
            blockers: [`変換後の v2 が自己検証に失敗しました（変換器のバグの可能性があります。不正な v2 は書き出しません）: ${messageOf(error)}`]
        };
    }
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
    // 呼び出し元（akari-preview-service.ts の prepareLegacyEdit / resolveCaptionDisplay）は
    // hasCaptions を渡さない。captions.json は常に edit.json と同じディレクトリに置かれる規約
    // (akari-preview-captions.ts の locatePreviewCaptions) なので、ここで実在チェックして
    // 補う。呼び出し元が明示的に hasCaptions を渡した場合はそちらを優先する
    // （P0 2026-08-21 track-z-undeclared-kind 追補: これが無いと migrateEditToV2 側の
    // captions 安全網が実プレビュー経路では一度も発火せず、字幕消失バグが直らないまま残っていた）。
    const resolvedProjectRoot = (0, path_1.resolve)(projectRoot);
    const captionsPath = (0, path_1.join)(resolvedProjectRoot, 'captions.json');
    const hasCaptions = options.hasCaptions ?? (0, node_fs_1.existsSync)(captionsPath);
    const migrated = migrateEditToV2(raw, { hasCaptions });
    if ('blockers' in migrated) {
        return { ok: false, version: migrated.version, blockers: migrated.blockers };
    }
    const iso = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
    let captions;
    if (isRecord(raw) && hasOwn(raw, 'emphasis_words')) {
        if (!Array.isArray(raw.emphasis_words)) {
            return {
                ok: false, version: migrated.version,
                blockers: ['edit.json.emphasis_words が配列ではないため captions.json へ移送できません。']
            };
        }
        if (!(0, node_fs_1.existsSync)(captionsPath)) {
            return {
                ok: false, version: migrated.version,
                blockers: ['emphasis_words の移送先 captions.json がありません。既存の captions.json を object ルートで用意してから再実行してください。']
            };
        }
        let captionsPreviousText;
        let captionsRoot;
        try {
            captionsPreviousText = (0, node_fs_1.readFileSync)(captionsPath, 'utf8');
            captionsRoot = JSON.parse(captionsPreviousText);
        }
        catch (error) {
            return {
                ok: false, version: migrated.version,
                blockers: [`emphasis_words の移送先 captions.json を読めません: ${messageOf(error)}`]
            };
        }
        if (Array.isArray(captionsRoot)) {
            return {
                ok: false, version: migrated.version,
                blockers: ['emphasis_words の移送先 captions.json が配列ルートです。トップレベル emphasis_words[] を持てる object ルートへ移してから再実行してください。']
            };
        }
        if (!isRecord(captionsRoot)) {
            return {
                ok: false, version: migrated.version,
                blockers: ['emphasis_words の移送先 captions.json のルートが object ではありません。']
            };
        }
        if (hasOwn(captionsRoot, 'emphasis_words')) {
            return {
                ok: false, version: migrated.version,
                blockers: ['captions.json に emphasis_words が既に存在するため、二重移送を防ぐため変換を中止します。']
            };
        }
        captions = {
            filePath: captionsPath,
            nextText: `${JSON.stringify({ ...captionsRoot, emphasis_words: clone(raw.emphasis_words) }, null, 2)}\n`,
            previousText: captionsPreviousText,
            backupPath: (0, path_1.join)(resolvedProjectRoot, '.akari', 'backup', `captions-${iso}.json`)
        };
    }
    return {
        filePath: (0, path_1.resolve)(editPath), version: migrated.version, changes: migrated.changes,
        warnings: migrated.warnings, nextText: `${JSON.stringify(migrated.doc, null, 2)}\n`, previousText: text,
        backupPath: (0, path_1.join)(resolvedProjectRoot, '.akari', 'backup', `edit-${iso}.json`),
        ...(captions ? { captions } : {})
    };
}
/** 承認後のみ実行する。先に全原文を .akari/backup/ へ退避し、次に atomic rename する。 */
async function applyMigration(proposal) {
    await (0, write_gate_1.writeAtomic)(proposal.backupPath, proposal.previousText);
    if (proposal.captions)
        await (0, write_gate_1.writeAtomic)(proposal.captions.backupPath, proposal.captions.previousText);
    await (0, write_gate_1.writeAtomic)(proposal.filePath, proposal.nextText);
    if (proposal.captions)
        await (0, write_gate_1.writeAtomic)(proposal.captions.filePath, proposal.captions.nextText);
}
/** 退避した原文を 1 手で edit.json / captions.json へ戻す。backup 自体は監査記録として残す。 */
async function revertMigration(proposal) {
    const original = await fs_1.promises.readFile(proposal.backupPath, 'utf8');
    const captionsOriginal = proposal.captions
        ? await fs_1.promises.readFile(proposal.captions.backupPath, 'utf8') : undefined;
    await (0, write_gate_1.writeAtomic)(proposal.filePath, original);
    if (proposal.captions && captionsOriginal !== undefined) {
        await (0, write_gate_1.writeAtomic)(proposal.captions.filePath, captionsOriginal);
    }
}
function readTrackDefs(timeline, pending, audioRefs, hasCaptions, blockers) {
    if (timeline !== undefined) {
        if (!isRecord(timeline) || !Array.isArray(timeline.tracks)) {
            blockers.push('edit.json.timeline.tracks が配列ではありません。');
            return [];
        }
        const ids = new Set();
        const declared = timeline.tracks.flatMap((value, index) => {
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
        return orderedTrackDefs(declared, audioRefs, hasCaptions, blockers);
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
    return orderedTrackDefs(defs, audioRefs, hasCaptions, blockers);
}
function orderedTrackDefs(declared, audioRefs, hasCaptions, blockers) {
    const usedIds = new Set(declared.map(def => def.id));
    const newId = (candidate) => uniqueId(candidate, usedIds);
    const audio = [];
    for (const ref of audioRefs) {
        const legacy = declared.find(def => def.kind === 'audio' && (def.ref ?? 0) === ref);
        audio.push({ ...(legacy ?? { id: newId(`audio-${ref}`), kind: 'audio' }), ref });
    }
    for (const legacy of declared.filter(def => def.kind === 'audio')) {
        if (!audio.some(def => (def.ref ?? 0) === (legacy.ref ?? 0)))
            audio.push(legacy);
    }
    const visual = declared.filter(def => def.kind !== 'audio');
    if (hasCaptions && declared.length === 0 && !visual.some(def => def.kind === 'captions')) {
        blockers.push('内部エラー: captions track を導出できませんでした。');
    }
    return [...audio, ...visual];
}
function legacyAudioTrackRefs(value) {
    const audio = isRecord(value) ? value : undefined;
    if (!audio)
        return { sfx: [], all: [] };
    const sfx = new Set();
    if (Array.isArray(audio.sfx)) {
        for (const entry of audio.sfx)
            if (isRecord(entry))
                sfx.add(trackOf(entry.track));
    }
    const sfxRefs = [...sfx].sort((a, b) => a - b);
    let nextRef = sfxRefs.length > 0 ? Math.max(...sfxRefs) + 1 : 0;
    const narration = Array.isArray(audio.narration) && audio.narration.length > 0
        ? nextRef++ : undefined;
    const bgm = isRecord(audio.bgm) ? nextRef++ : undefined;
    return {
        sfx: sfxRefs,
        ...(narration !== undefined ? { narration } : {}),
        ...(bgm !== undefined ? { bgm } : {}),
        all: [
            ...sfxRefs,
            ...(narration !== undefined ? [narration] : []),
            ...(bgm !== undefined ? [bgm] : [])
        ]
    };
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
/**
 * v0/v1 は「未設定」を明示 `null`（例: `crop: null`）で書くことがあるが、v2 の対応する
 * 任意フィールド（`transform` / `opacity` / `crop` / `perspective` / `blend`）は「未設定」を
 * キー自体の省略で表す（v2 スキーマはこれらに `null` を許容しない — `edit-v2.ts` の
 * `validateCrop` 等は `requireRecord` で `null` を拒否する）。`source[key] !== undefined` だけの
 * 判定だと明示 `null` がそのまま v2 へ複写され、`crop: null` のような不正な v2 を生む
 * （task/2026-08-20-migrate-crop-schema で実測: `crop: null` を持つ v0 プロジェクトの変換が
 * `ok: true` を返しつつ `readEditV2` に通すと必ず失敗する）。既知の語彙（この 5 フィールド）の
 * 転写ミスの是正であり、新しい変換規則の追加ではない。
 *
 * ※ `proxy` / `chroma_key`（v2 側が `null` を許容する数少ないフィールド）はこの関数を通らず、
 * 呼び出し元が別途 `hasOwn` で明示的に `null` ごと転写している（このファイル内 2 箇所）。
 */
function copyPresent(source, keys) {
    return Object.fromEntries(keys.filter(key => source[key] !== undefined && source[key] !== null).map(key => [key, clone(source[key])]));
}
function rejectUnknownKeys(value, allowed, path, blockers) {
    for (const key of Object.keys(value)) {
        if (allowed.has(key))
            continue;
        if (key === 'transitionOut') {
            blockers.push(`${path}.transitionOut は Web UI 旧版が書いた綴りです。正しい transition_out へ直すか、Web UI で開き直して保存してください。`);
        }
        else {
            blockers.push(`${path}.${key} は凍結変換器が対応しない未知フィールドです。`);
        }
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
function gainDb(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= -60 && value <= 12;
}
function validNarrationProvenance(value) {
    if (!isRecord(value) || !nonEmpty(value.provider))
        return false;
    for (const key of ['engine', 'voice', 'credit', 'generated_at']) {
        if (value[key] !== undefined && typeof value[key] !== 'string')
            return false;
    }
    return value.provider !== 'voicevox' || nonEmpty(value.credit);
}
function trackOf(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
