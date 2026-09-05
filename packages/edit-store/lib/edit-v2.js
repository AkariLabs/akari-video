"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readEditV2 = readEditV2;
const BLEND_MODES = new Set([
    'normal', 'screen', 'multiply', 'add', 'difference',
    'darken', 'lighten', 'overlay', 'hardlight', 'softlight'
]);
const SHAPE_KINDS = new Set([
    'rect', 'rounded-rect', 'ellipse', 'line', 'arrow', 'speech-bubble'
]);
const ITEM_KEYS = new Set([
    'id', 'name', 'hidden', 'locked', 'at', 'duration', 'transform', 'opacity', 'blend', 'crop', 'adjust', 'perspective',
    'motion', 'animator', 'keyframes', 'items', 'mask', 'source'
]);
const AUDIO_ITEM_KEYS = new Set([
    'id', 'name', 'hidden', 'locked', 'at', 'duration', 'role', 'source', 'gain_db', 'keyframes',
    'fade_in', 'fade_out', 'ducking', 'duck_db', 'duck_attack', 'duck_release',
    'denoise', 'lowcut_hz', 'script', 'reading', 'provenance'
]);
/**
 * edit.json v2 だけを検証して内部表現へ読む。v0/v1 の変換は意図的に扱わない。
 * tracks の配列順を保持し、各 track に z（0 = 最背面）を付ける。
 */
function readEditV2(json) {
    const parsed = parseInput(json);
    requireRecord(parsed, 'edit.json');
    requireExactKeys(parsed, new Set(['version', 'output', 'sources', 'tracks', 'audio', 'captions', 'thumbnail']), 'edit.json');
    if (parsed.version !== 2) {
        throw invalid('edit.json.version', '2 である必要があります（v0/v1 はこの reader の対象外です）');
    }
    validateOutput(parsed.output);
    if (!Array.isArray(parsed.sources)) {
        throw invalid('edit.json.sources', '配列である必要があります');
    }
    if (!Array.isArray(parsed.tracks)) {
        throw invalid('edit.json.tracks', '配列である必要があります');
    }
    if (hasOwn(parsed, 'audio')) {
        requireRecord(parsed.audio, 'edit.json.audio');
        if (hasOwn(parsed.audio, 'duck_keys')) {
            if (!Array.isArray(parsed.audio.duck_keys))
                throw invalid('edit.json.audio.duck_keys', '配列である必要があります');
            const keys = parsed.audio.duck_keys;
            if (keys.some(key => key !== 'narration' && key !== 'speech')) {
                throw invalid('edit.json.audio.duck_keys', 'narration/speech のみ指定できます');
            }
            if (new Set(keys).size !== keys.length)
                throw invalid('edit.json.audio.duck_keys', '重複できません');
        }
    }
    if (hasOwn(parsed, 'captions') && !Array.isArray(parsed.captions)) {
        throw invalid('edit.json.captions', '配列である必要があります');
    }
    if (hasOwn(parsed, 'thumbnail'))
        requireRecord(parsed.thumbnail, 'edit.json.thumbnail');
    const sourceIds = new Set();
    parsed.sources.forEach((source, index) => validateEditSource(source, index, sourceIds));
    const trackIds = new Set();
    const itemIds = new Set();
    parsed.tracks.forEach((track, index) => validateTrack(track, index, trackIds, itemIds, sourceIds));
    const edit = parsed;
    return {
        version: 2,
        output: { ...edit.output },
        sources: edit.sources.map(source => ({ ...source })),
        ...(edit.audio !== undefined ? { audio: edit.audio } : {}),
        ...(edit.captions !== undefined ? { captions: edit.captions } : {}),
        ...(edit.thumbnail !== undefined ? { thumbnail: { ...edit.thumbnail } } : {}),
        tracks: edit.tracks.map((track, z) => {
            if ('items' in track) {
                return {
                    ...track,
                    z,
                    items: track.items.map(item => cloneItem(item))
                };
            }
            return { ...track, z, content: { ...track.content } };
        })
    };
}
function cloneItem(item) {
    return {
        ...item,
        source: { ...item.source },
        ...('items' in item && Array.isArray(item.items)
            ? { items: item.items.map(child => cloneItem(child)) } : {})
    };
}
function parseInput(json) {
    if (typeof json !== 'string')
        return json;
    try {
        return JSON.parse(json);
    }
    catch (error) {
        throw invalid('edit.json', `JSON として読めません: ${messageOf(error)}`);
    }
}
function validateOutput(value) {
    requireRecord(value, 'edit.json.output');
    requirePositiveNumber(value.width, 'edit.json.output.width');
    requirePositiveNumber(value.height, 'edit.json.output.height');
    requireInteger(value.fps, 1, 'edit.json.output.fps');
}
function validateEditSource(value, index, ids) {
    const path = `edit.json.sources[${index}]`;
    requireRecord(value, path);
    requireExactKeys(value, new Set(['id', 'path', 'proxy', 'chroma_key']), path);
    requireText(value.id, `${path}.id`);
    if (ids.has(value.id))
        throw invalid(`${path}.id`, `source id が重複しています: ${value.id}`);
    ids.add(value.id);
    requireText(value.path, `${path}.path`);
    if (hasOwn(value, 'proxy') && value.proxy !== null)
        requireText(value.proxy, `${path}.proxy`);
    if (hasOwn(value, 'chroma_key') && value.chroma_key !== null) {
        requireRecord(value.chroma_key, `${path}.chroma_key`);
    }
}
function validateTrack(value, index, trackIds, itemIds, sourceIds) {
    const path = `edit.json.tracks[${index}]`;
    requireRecord(value, path);
    requireExactKeys(value, new Set(['id', 'lane', 'name', 'items', 'content']), path);
    requireText(value.id, `${path}.id`);
    if (trackIds.has(value.id))
        throw invalid(`${path}.id`, `track id が重複しています: ${value.id}`);
    trackIds.add(value.id);
    if (value.lane !== 'visual' && value.lane !== 'audio') {
        throw invalid(`${path}.lane`, 'visual または audio である必要があります');
    }
    if (hasOwn(value, 'name') && typeof value.name !== 'string') {
        throw invalid(`${path}.name`, '文字列である必要があります');
    }
    const hasItems = hasOwn(value, 'items');
    const hasContent = hasOwn(value, 'content');
    if (hasItems === hasContent) {
        throw invalid(path, 'items と content のどちらか一方だけが必要です');
    }
    if (hasItems) {
        if (!Array.isArray(value.items))
            throw invalid(`${path}.items`, '配列である必要があります');
        value.items.forEach((item, itemIndex) => {
            const itemPath = `${path}.items[${itemIndex}]`;
            if (value.lane === 'audio')
                validateAudioItem(item, itemPath, itemIds, sourceIds);
            else
                validateItem(item, itemPath, itemIds, sourceIds);
        });
        return;
    }
    requireRecord(value.content, `${path}.content`);
    requireExactKeys(value.content, new Set(['from']), `${path}.content`);
    if (value.content.from !== 'captions.json') {
        throw invalid(`${path}.content.from`, 'captions.json である必要があります');
    }
}
function validateAudioItem(value, path, ids, sourceIds) {
    requireRecord(value, path);
    requireExactKeys(value, AUDIO_ITEM_KEYS, path);
    requireText(value.id, `${path}.id`);
    if (ids.has(value.id))
        throw invalid(`${path}.id`, `item id が重複しています: ${value.id}`);
    ids.add(value.id);
    validateItemMetadata(value, path);
    requireInteger(value.at, 0, `${path}.at`);
    requireInteger(value.duration, 0, `${path}.duration`);
    if (hasOwn(value, 'role') && value.role !== 'sfx' && value.role !== 'narration' && value.role !== 'bgm') {
        throw invalid(`${path}.role`, 'sfx/narration/bgm のいずれかである必要があります');
    }
    if (hasOwn(value, 'gain_db'))
        requireRange(value.gain_db, -60, 12, `${path}.gain_db`);
    if (hasOwn(value, 'denoise'))
        validateAudioClipDenoise(value.denoise, `${path}.denoise`);
    if (hasOwn(value, 'lowcut_hz'))
        requireRange(value.lowcut_hz, 0, 400, `${path}.lowcut_hz`);
    if (hasOwn(value, 'keyframes'))
        validateKeyframes(value.keyframes, `${path}.keyframes`, true);
    if (hasOwn(value, 'fade_in'))
        requireNonNegativeNumber(value.fade_in, `${path}.fade_in`);
    if (hasOwn(value, 'fade_out'))
        requireNonNegativeNumber(value.fade_out, `${path}.fade_out`);
    if (hasOwn(value, 'ducking') && typeof value.ducking !== 'boolean') {
        throw invalid(`${path}.ducking`, 'boolean である必要があります');
    }
    if (hasOwn(value, 'duck_db'))
        requireRange(value.duck_db, -40, 0, `${path}.duck_db`);
    if (hasOwn(value, 'duck_attack'))
        requireRange(value.duck_attack, 0, 2, `${path}.duck_attack`);
    if (hasOwn(value, 'duck_release'))
        requireRange(value.duck_release, 0, 5, `${path}.duck_release`);
    if (hasOwn(value, 'script') && typeof value.script !== 'string') {
        throw invalid(`${path}.script`, 'string である必要があります');
    }
    if (hasOwn(value, 'reading') && typeof value.reading !== 'string') {
        throw invalid(`${path}.reading`, 'string である必要があります');
    }
    if (hasOwn(value, 'provenance'))
        validateNarrationProvenance(value.provenance, `${path}.provenance`);
    validateAudioMediaSource(value.source, `${path}.source`, sourceIds);
}
function validateNarrationProvenance(value, path) {
    requireRecord(value, path);
    requireText(value.provider, `${path}.provider`);
    for (const key of ['engine', 'voice', 'credit', 'generated_at']) {
        if (hasOwn(value, key) && typeof value[key] !== 'string') {
            throw invalid(`${path}.${key}`, 'string である必要があります');
        }
    }
    if (value.provider === 'voicevox' && (!hasOwn(value, 'credit')
        || typeof value.credit !== 'string' || value.credit.trim().length === 0)) {
        throw invalid(`${path}.credit`, 'provider が voicevox のときは空でない文字列が必要です');
    }
}
function validateAudioMediaSource(value, path, sourceIds) {
    requireRecord(value, path);
    requireExactKeys(value, new Set(['kind', 'src', 'in', 'out', 'speed', 'pitch_semitones', 'formant']), path);
    if (value.kind !== 'media')
        throw invalid(`${path}.kind`, 'media である必要があります');
    requireText(value.src, `${path}.src`);
    if (!sourceIds.has(value.src))
        throw invalid(`${path}.src`, `sources[].id に存在しません: ${value.src}`);
    if (hasOwn(value, 'in'))
        requireNonNegativeNumber(value.in, `${path}.in`);
    if (hasOwn(value, 'out')) {
        requireNonNegativeNumber(value.out, `${path}.out`);
        const inSeconds = hasOwn(value, 'in') ? value.in : 0;
        if (value.out <= inSeconds)
            throw invalid(path, 'audio media source は out > in である必要があります');
    }
    if (hasOwn(value, 'speed')) {
        requireRange(value.speed, 0.25, 4, `${path}.speed`);
        if (value.speed === 0.25)
            throw invalid(`${path}.speed`, '0.25 より大きい必要があります');
    }
    if (hasOwn(value, 'pitch_semitones'))
        requireRange(value.pitch_semitones, -24, 24, `${path}.pitch_semitones`);
    if (hasOwn(value, 'formant') && value.formant !== 'preserve' && value.formant !== 'shift') {
        throw invalid(`${path}.formant`, 'preserve/shift のいずれかである必要があります');
    }
}
function validateAudioClipDenoise(value, path) {
    requireRecord(value, path);
    requireExactKeys(value, new Set(['method', 'strength']), path);
    if (value.method !== 'fft' && value.method !== 'nlm') {
        throw invalid(`${path}.method`, 'fft/nlm のいずれかである必要があります');
    }
    requireRange(value.strength, 0, 1, `${path}.strength`);
}
function validateItem(value, path, ids, sourceIds) {
    requireRecord(value, path);
    requireExactKeys(value, ITEM_KEYS, path);
    requireText(value.id, `${path}.id`);
    if (ids.has(value.id))
        throw invalid(`${path}.id`, `item id が重複しています: ${value.id}`);
    ids.add(value.id);
    validateItemMetadata(value, path);
    requireInteger(value.at, 0, `${path}.at`);
    requireInteger(value.duration, 0, `${path}.duration`);
    if (hasOwn(value, 'transform'))
        validateTransform(value.transform, `${path}.transform`);
    if (hasOwn(value, 'opacity'))
        requireRange(value.opacity, 0, 1, `${path}.opacity`);
    if (hasOwn(value, 'blend') && !BLEND_MODES.has(value.blend)) {
        throw invalid(`${path}.blend`, '未対応の blend mode です');
    }
    if (hasOwn(value, 'crop'))
        validateCrop(value.crop, `${path}.crop`);
    if (hasOwn(value, 'adjust'))
        validateAdjust(value.adjust, `${path}.adjust`);
    if (hasOwn(value, 'perspective'))
        requireRecord(value.perspective, `${path}.perspective`);
    if (hasOwn(value, 'motion'))
        validateMotion(value.motion, `${path}.motion`);
    if (hasOwn(value, 'animator'))
        validateAnimators(value.animator, `${path}.animator`);
    if (hasOwn(value, 'keyframes'))
        validateKeyframes(value.keyframes, `${path}.keyframes`);
    validateItemSource(value.source, `${path}.source`, sourceIds);
    if (hasOwn(value, 'mask')) {
        if (value.source.kind !== 'media')
            throw invalid(`${path}.mask`, 'media item だけが指定できます');
        requireText(value.mask, `${path}.mask`);
        if (!sourceIds.has(value.mask))
            throw invalid(`${path}.mask`, `sources[].id に存在しません: ${value.mask}`);
    }
    if (hasOwn(value, 'items')) {
        if (!Array.isArray(value.items))
            throw invalid(`${path}.items`, '配列である必要があります');
        value.items.forEach((child, index) => validateItem(child, `${path}.items[${index}]`, ids, sourceIds));
    }
}
function validateItemMetadata(value, path) {
    if (hasOwn(value, 'name') && typeof value.name !== 'string')
        throw invalid(`${path}.name`, '文字列である必要があります');
    for (const key of ['hidden', 'locked']) {
        if (hasOwn(value, key) && typeof value[key] !== 'boolean')
            throw invalid(`${path}.${key}`, 'boolean である必要があります');
    }
}
function validateItemSource(value, path, sourceIds) {
    requireRecord(value, path);
    switch (value.kind) {
        case 'media':
            requireExactKeys(value, new Set([
                'kind', 'src', 'in', 'out', 'framing', 'transition_out', 'freeze', 'fx', 'speed', 'chroma_key'
            ]), path);
            requireText(value.src, `${path}.src`);
            if (!sourceIds.has(value.src))
                throw invalid(`${path}.src`, `sources[].id に存在しません: ${value.src}`);
            requireNonNegativeNumber(value.in, `${path}.in`);
            requireNonNegativeNumber(value.out, `${path}.out`);
            if (value.out <= value.in)
                throw invalid(path, 'media source は out > in である必要があります');
            for (const key of ['framing', 'transition_out', 'freeze', 'chroma_key']) {
                if (hasOwn(value, key) && value[key] !== null)
                    requireRecord(value[key], `${path}.${key}`);
            }
            if (hasOwn(value, 'fx') && !Array.isArray(value.fx))
                throw invalid(`${path}.fx`, '配列である必要があります');
            if (hasOwn(value, 'speed'))
                requirePositiveNumber(value.speed, `${path}.speed`);
            return;
        case 'html':
            requireExactKeys(value, new Set(['kind', 'path', 'part', 'style', 'text', 'exclude', 'derivedFrom', 'vars', 'params']), path);
            requireText(value.path, `${path}.path`);
            for (const key of ['part', 'derivedFrom'])
                if (hasOwn(value, key))
                    requireText(value[key], `${path}.${key}`);
            if (hasOwn(value, 'text') && typeof value.text !== 'string')
                throw invalid(`${path}.text`, '文字列である必要があります');
            if (hasOwn(value, 'style'))
                validateStringMap(value.style, `${path}.style`);
            if (hasOwn(value, 'exclude'))
                validateStringList(value.exclude, `${path}.exclude`);
            if (hasOwn(value, 'vars'))
                requireRecord(value.vars, `${path}.vars`);
            if (hasOwn(value, 'params')) {
                requireRecord(value.params, `${path}.params`);
                for (const [name, text] of Object.entries(value.params)) {
                    if (typeof text !== 'string')
                        throw invalid(`${path}.params.${name}`, '文字列である必要があります');
                }
            }
            return;
        case 'shape':
            requireExactKeys(value, new Set(['kind', 'shape', 'params']), path);
            if (!SHAPE_KINDS.has(value.shape)) {
                throw invalid(`${path}.shape`, '未対応の shape です');
            }
            if (hasOwn(value, 'params')) {
                requireRecord(value.params, `${path}.params`);
                requireExactKeys(value.params, new Set([
                    'width', 'height', 'fill', 'stroke', 'strokeWidth', 'cornerRadius'
                ]), `${path}.params`);
                for (const key of ['width', 'height']) {
                    if (hasOwn(value.params, key))
                        requirePositiveNumber(value.params[key], `${path}.params.${key}`);
                }
                for (const key of ['fill', 'stroke']) {
                    if (hasOwn(value.params, key) && typeof value.params[key] !== 'string') {
                        throw invalid(`${path}.params.${key}`, '文字列である必要があります');
                    }
                }
                for (const key of ['strokeWidth', 'cornerRadius']) {
                    if (hasOwn(value.params, key))
                        requireNonNegativeNumber(value.params[key], `${path}.params.${key}`);
                }
            }
            return;
        case 'telop':
            requireExactKeys(value, new Set(['kind', 'preset', 'params', 'baked', 'from']), path);
            requireText(value.preset, `${path}.preset`);
            if (hasOwn(value, 'params'))
                requireRecord(value.params, `${path}.params`);
            if (hasOwn(value, 'baked'))
                requireText(value.baked, `${path}.baked`);
            if (hasOwn(value, 'from'))
                requireText(value.from, `${path}.from`);
            return;
        case 'filter':
            requireExactKeys(value, new Set(['kind', 'filter']), path);
            validateFilter(value.filter, `${path}.filter`);
            return;
        case 'group':
            requireExactKeys(value, new Set(['kind']), path);
            return;
        case 'captions':
            requireExactKeys(value, new Set(['kind', 'path', 'exclude']), path);
            if (value.path !== 'captions.json')
                throw invalid(`${path}.path`, 'captions.json である必要があります');
            if (hasOwn(value, 'exclude'))
                validateStringList(value.exclude, `${path}.exclude`);
            return;
        case 'caption':
            requireExactKeys(value, new Set(['kind', 'path', 'id']), path);
            if (value.path !== 'captions.json')
                throw invalid(`${path}.path`, 'captions.json である必要があります');
            requireText(value.id, `${path}.id`);
            return;
        default:
            throw invalid(`${path}.kind`, 'media/html/telop/filter/group/captions/caption のいずれかである必要があります');
    }
}
function validateStringMap(value, path) {
    requireRecord(value, path);
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry !== 'string')
            throw invalid(`${path}.${key}`, '文字列である必要があります');
    }
}
function validateStringList(value, path) {
    if (!Array.isArray(value))
        throw invalid(path, '配列である必要があります');
    const seen = new Set();
    value.forEach((entry, index) => {
        requireText(entry, `${path}[${index}]`);
        if (seen.has(entry))
            throw invalid(path, `値が重複しています: ${entry}`);
        seen.add(entry);
    });
}
function validateFilter(value, path) {
    requireRecord(value, path);
    switch (value.type) {
        case 'invert':
            requireExactKeys(value, new Set(['type']), path);
            return;
        case 'lut':
            requireExactKeys(value, new Set(['type', 'id', 'intensity']), path);
            requireText(value.id, `${path}.id`);
            if (hasOwn(value, 'intensity'))
                requireRange(value.intensity, 0, 1, `${path}.intensity`);
            return;
        case 'saturation':
            requireExactKeys(value, new Set(['type', 'value']), path);
            requireRange(value.value, 0, 3, `${path}.value`);
            return;
        default:
            throw invalid(`${path}.type`, 'invert/lut/saturation のいずれかである必要があります');
    }
}
function validateTransform(value, path) {
    requireRecord(value, path);
    requireExactKeys(value, new Set(['x', 'y', 'scale', 'rotate']), path);
    for (const key of ['x', 'y', 'rotate']) {
        if (hasOwn(value, key))
            requireNumber(value[key], `${path}.${key}`);
    }
    if (hasOwn(value, 'scale'))
        requirePositiveNumber(value.scale, `${path}.scale`);
}
function validateCrop(value, path) {
    requireRecord(value, path);
    for (const key of ['x', 'y'])
        requireRange(value[key], 0, 1, `${path}.${key}`);
    for (const key of ['w', 'h']) {
        requireRange(value[key], 0, 1, `${path}.${key}`);
        if (value[key] === 0)
            throw invalid(`${path}.${key}`, '0 より大きい必要があります');
    }
}
function validateAdjust(value, path) {
    requireRecord(value, path);
    requireExactKeys(value, new Set(['basic', 'lut', 'sections']), path);
    if (hasOwn(value, 'basic')) {
        requireRecord(value.basic, `${path}.basic`);
        const basicKeys = new Set([
            'exposure', 'contrast', 'highlights', 'shadows', 'blacks', 'whites',
            'temperature', 'tint', 'vibrance', 'saturation'
        ]);
        requireExactKeys(value.basic, basicKeys, `${path}.basic`);
        for (const key of basicKeys) {
            if (!hasOwn(value.basic, key))
                continue;
            const [minimum, maximum] = key === 'exposure' ? [-3, 3] : [-1, 1];
            requireRange(value.basic[key], minimum, maximum, `${path}.basic.${key}`);
        }
    }
    if (hasOwn(value, 'lut') && value.lut !== null) {
        requireRecord(value.lut, `${path}.lut`);
        requireExactKeys(value.lut, new Set(['lut', 'intensity']), `${path}.lut`);
        requireText(value.lut.lut, `${path}.lut.lut`);
        if (hasOwn(value.lut, 'intensity'))
            requireRange(value.lut.intensity, 0, 1, `${path}.lut.intensity`);
    }
    if (hasOwn(value, 'sections')) {
        requireRecord(value.sections, `${path}.sections`);
        const sectionKeys = new Set(['basic', 'lut']);
        requireExactKeys(value.sections, sectionKeys, `${path}.sections`);
        for (const key of sectionKeys) {
            if (hasOwn(value.sections, key) && typeof value.sections[key] !== 'boolean') {
                throw invalid(`${path}.sections.${key}`, 'boolean である必要があります');
            }
        }
    }
}
const EASINGS = new Set([
    'linear', 'ease-in-out', 'in-quad', 'out-quad', 'in-out-quad', 'in-cubic', 'out-cubic',
    'in-out-cubic', 'in-quart', 'out-quart', 'in-out-quart', 'in-expo', 'out-expo', 'in-out-expo',
    'in-back', 'out-back', 'in-out-back', 'out-bounce', 'out-elastic', 'hold'
]);
const CUBIC_BEZIER = /^cubic-bezier\(\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*\)$/;
function validateEasing(value, path) {
    const validateOne = (entry, entryPath) => {
        if (typeof entry !== 'string' || (!EASINGS.has(entry) && !CUBIC_BEZIER.test(entry))) {
            throw invalid(entryPath, '未対応の easing です');
        }
    };
    if (typeof value === 'string')
        return validateOne(value, path);
    requireRecord(value, path);
    for (const [key, entry] of Object.entries(value))
        validateOne(entry, `${path}.${key}`);
}
function validateKeyframes(value, path, audio = false) {
    if (!Array.isArray(value)) {
        requireRecord(value, path);
        requireExactKeys(value, new Set(['path', 'count']), path);
        requireText(value.path, `${path}.path`);
        if (!/^motion\/.+\.json$/.test(value.path))
            throw invalid(`${path}.path`, 'motion/ 配下の JSON である必要があります');
        requireInteger(value.count, 2, `${path}.count`);
        return;
    }
    if (!Array.isArray(value) || value.length < 2)
        throw invalid(path, '2 要素以上の配列である必要があります');
    value.forEach((entry, index) => {
        const itemPath = `${path}[${index}]`;
        requireRecord(entry, itemPath);
        requireInteger(entry.t, 0, `${itemPath}.t`);
        if (audio) {
            if (!hasOwn(entry, 'gain_db'))
                throw invalid(`${itemPath}.gain_db`, 'audio keyframe に必要です');
            requireRange(entry.gain_db, -60, 12, `${itemPath}.gain_db`);
        }
        if (hasOwn(entry, 'transform'))
            validateTransform(entry.transform, `${itemPath}.transform`);
        if (hasOwn(entry, 'crop'))
            validateCrop(entry.crop, `${itemPath}.crop`);
        if (hasOwn(entry, 'perspective'))
            requireRecord(entry.perspective, `${itemPath}.perspective`);
        if (hasOwn(entry, 'opacity'))
            requireRange(entry.opacity, 0, 1, `${itemPath}.opacity`);
        if (hasOwn(entry, 'animator')) {
            requireRecord(entry.animator, `${itemPath}.animator`);
            for (const [id, state] of Object.entries(entry.animator)) {
                requireRecord(state, `${itemPath}.animator.${id}`);
                requireExactKeys(state, new Set(['offset', 'start', 'end']), `${itemPath}.animator.${id}`);
                if (hasOwn(state, 'offset'))
                    requireRange(state.offset, -1, 1, `${itemPath}.animator.${id}.offset`);
                for (const key of ['start', 'end'])
                    if (hasOwn(state, key))
                        requireRange(state[key], 0, 1, `${itemPath}.animator.${id}.${key}`);
            }
        }
        if (hasOwn(entry, 'easing'))
            validateEasing(entry.easing, `${itemPath}.easing`);
    });
}
function validateMotion(value, path) {
    requireRecord(value, path);
    requireExactKeys(value, new Set(['in', 'out', 'loop']), path);
    for (const slot of ['in', 'out', 'loop']) {
        if (!hasOwn(value, slot))
            continue;
        const entry = value[slot];
        requireRecord(entry, `${path}.${slot}`);
        requireExactKeys(entry, new Set(['preset', slot === 'loop' ? 'period' : 'duration', 'ease', 'amount']), `${path}.${slot}`);
        requireText(entry.preset, `${path}.${slot}.preset`);
        requireInteger(entry[slot === 'loop' ? 'period' : 'duration'], slot === 'loop' ? 1 : 0, `${path}.${slot}.${slot === 'loop' ? 'period' : 'duration'}`);
        if (hasOwn(entry, 'ease'))
            validateEasing(entry.ease, `${path}.${slot}.ease`);
        if (hasOwn(entry, 'amount'))
            requireNumber(entry.amount, `${path}.${slot}.amount`);
    }
}
function validateAnimators(value, path) {
    if (!Array.isArray(value))
        throw invalid(path, '配列である必要があります');
    value.forEach((entry, index) => {
        const entryPath = `${path}[${index}]`;
        requireRecord(entry, entryPath);
        requireExactKeys(entry, new Set(['id', 'basis', 'shape', 'start', 'end', 'offset', 'randomize', 'amount', 'ease']), entryPath);
        requireText(entry.id, `${entryPath}.id`);
        if (!['chars', 'words', 'lines', 'segments'].includes(String(entry.basis)))
            throw invalid(`${entryPath}.basis`, '未対応の basis です');
        if (!['ramp', 'triangle', 'round', 'smooth', 'square', 'ramp-down'].includes(String(entry.shape)))
            throw invalid(`${entryPath}.shape`, '未対応の shape です');
        requireRange(entry.start, 0, 1, `${entryPath}.start`);
        requireRange(entry.end, 0, 1, `${entryPath}.end`);
        requireRange(entry.offset, -1, 1, `${entryPath}.offset`);
        if (hasOwn(entry, 'randomize')) {
            requireRecord(entry.randomize, `${entryPath}.randomize`);
            requireExactKeys(entry.randomize, new Set(['seed']), `${entryPath}.randomize`);
            if (!Number.isInteger(entry.randomize.seed))
                throw invalid(`${entryPath}.randomize.seed`, '整数である必要があります');
        }
        requireRecord(entry.amount, `${entryPath}.amount`);
        requireExactKeys(entry.amount, new Set(['x', 'y', 'scale', 'rotate', 'opacity', 'letterSpacing', 'blur']), `${entryPath}.amount`);
        for (const [key, amount] of Object.entries(entry.amount)) {
            if (key === 'opacity')
                requireRange(amount, -1, 1, `${entryPath}.amount.opacity`);
            else
                requireNumber(amount, `${entryPath}.amount.${key}`);
        }
        if (hasOwn(entry, 'ease'))
            validateEasing(entry.ease, `${entryPath}.ease`);
    });
}
function requireRecord(value, path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw invalid(path, 'object である必要があります');
    }
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
const UNKNOWN_KEY_GUIDANCE = {
    emphasis_words: '語レベル演出は captions.json のトップレベル emphasis_words[] へ移してください（契約 contract-2026-08-23-captions-emphasis-words-v0.md）',
};
const DEFAULT_UNKNOWN_KEY_GUIDANCE = 'このキーは v2 の語彙にありません。手で編集した場合は取り除くか、.akari/backup/ の原本から復元してください';
function requireExactKeys(value, allowed, path) {
    const unknown = Object.keys(value).filter(key => !allowed.has(key));
    if (unknown.length > 0) {
        const guidance = unknown
            .map(key => `${key}: ${UNKNOWN_KEY_GUIDANCE[key] ?? DEFAULT_UNKNOWN_KEY_GUIDANCE}`)
            .join(' / ');
        throw invalid(path, `未定義キーを使用できません: ${unknown.join(', ')}。案内: ${guidance}`);
    }
}
function requireText(value, path) {
    if (typeof value !== 'string' || value.trim().length === 0)
        throw invalid(path, '空でない文字列である必要があります');
}
function requireNumber(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw invalid(path, '有限数である必要があります');
}
function requirePositiveNumber(value, path) {
    requireNumber(value, path);
    if (value <= 0)
        throw invalid(path, '0 より大きい必要があります');
}
function requireNonNegativeNumber(value, path) {
    requireNumber(value, path);
    if (value < 0)
        throw invalid(path, '0 以上である必要があります');
}
function requireInteger(value, minimum, path) {
    if (!Number.isInteger(value) || value < minimum) {
        throw invalid(path, `${minimum} 以上の整数である必要があります`);
    }
}
function requireRange(value, minimum, maximum, path) {
    requireNumber(value, path);
    if (value < minimum || value > maximum)
        throw invalid(path, `${minimum}..${maximum} の範囲である必要があります`);
}
function invalid(path, message) {
    return new Error(`edit.json v2 が不正です (${path}): ${message}`);
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
