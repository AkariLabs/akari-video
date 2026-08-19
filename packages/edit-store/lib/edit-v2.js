"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readEditV2 = readEditV2;
const BLEND_MODES = new Set([
    'normal', 'screen', 'multiply', 'add', 'difference',
    'darken', 'lighten', 'overlay', 'hardlight', 'softlight'
]);
const ITEM_KEYS = new Set([
    'id', 'at', 'duration', 'transform', 'opacity', 'blend', 'crop', 'perspective', 'keyframes', 'source'
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
    if (hasOwn(parsed, 'audio'))
        requireRecord(parsed.audio, 'edit.json.audio');
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
                    items: track.items.map(item => ({ ...item, source: { ...item.source } }))
                };
            }
            return { ...track, z, content: { ...track.content } };
        })
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
        value.items.forEach((item, itemIndex) => validateItem(item, `${path}.items[${itemIndex}]`, itemIds, sourceIds));
        return;
    }
    requireRecord(value.content, `${path}.content`);
    requireExactKeys(value.content, new Set(['from']), `${path}.content`);
    if (value.content.from !== 'captions.json') {
        throw invalid(`${path}.content.from`, 'captions.json である必要があります');
    }
}
function validateItem(value, path, ids, sourceIds) {
    requireRecord(value, path);
    requireExactKeys(value, ITEM_KEYS, path);
    requireText(value.id, `${path}.id`);
    if (ids.has(value.id))
        throw invalid(`${path}.id`, `item id が重複しています: ${value.id}`);
    ids.add(value.id);
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
    if (hasOwn(value, 'perspective'))
        requireRecord(value.perspective, `${path}.perspective`);
    if (hasOwn(value, 'keyframes'))
        validateKeyframes(value.keyframes, `${path}.keyframes`);
    validateItemSource(value.source, `${path}.source`, sourceIds);
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
            requireExactKeys(value, new Set(['kind', 'path', 'vars']), path);
            requireText(value.path, `${path}.path`);
            if (hasOwn(value, 'vars'))
                requireRecord(value.vars, `${path}.vars`);
            return;
        case 'telop':
            requireExactKeys(value, new Set(['kind', 'preset', 'params', 'baked']), path);
            requireText(value.preset, `${path}.preset`);
            if (hasOwn(value, 'params'))
                requireRecord(value.params, `${path}.params`);
            if (hasOwn(value, 'baked'))
                requireText(value.baked, `${path}.baked`);
            return;
        case 'filter':
            requireExactKeys(value, new Set(['kind', 'filter']), path);
            validateFilter(value.filter, `${path}.filter`);
            return;
        default:
            throw invalid(`${path}.kind`, 'media/html/telop/filter のいずれかである必要があります');
    }
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
function validateKeyframes(value, path) {
    if (!Array.isArray(value) || value.length < 2)
        throw invalid(path, '2 要素以上の配列である必要があります');
    value.forEach((entry, index) => {
        const itemPath = `${path}[${index}]`;
        requireRecord(entry, itemPath);
        requireInteger(entry.t, 0, `${itemPath}.t`);
        if (hasOwn(entry, 'transform'))
            validateTransform(entry.transform, `${itemPath}.transform`);
        if (hasOwn(entry, 'crop'))
            validateCrop(entry.crop, `${itemPath}.crop`);
        if (hasOwn(entry, 'perspective'))
            requireRecord(entry.perspective, `${itemPath}.perspective`);
        if (hasOwn(entry, 'easing') && entry.easing !== 'linear' && entry.easing !== 'ease-in-out') {
            throw invalid(`${itemPath}.easing`, 'linear または ease-in-out である必要があります');
        }
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
function requireExactKeys(value, allowed, path) {
    const unknown = Object.keys(value).filter(key => !allowed.has(key));
    if (unknown.length > 0)
        throw invalid(path, `未定義キーを使用できません: ${unknown.join(', ')}`);
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
