"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaptionsInvalidError = exports.CAPTION_LOOK_SHAPE_KEYS = exports.CAPTION_LOOK_SHAPE_ANIMATION_IDS = void 0;
exports.validateCaptionLookV1Shape = validateCaptionLookV1Shape;
exports.assertCaptionsWritable = assertCaptionsWritable;
const caption_semantics_1 = require("./caption-semantics");
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const number = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => number(value) && value > 0;
const nonnegative = (value) => number(value) && value >= 0;
const integer = (value) => Number.isInteger(value);
const nonempty = (value) => typeof value === 'string' && value.length > 0;
const hex = (value) => typeof value === 'string' && /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(value);
const runId = (value) => typeof value === 'string' && /^r-\d{4,}$/.test(value);
const fire = (value) => ['shown', 'spoken', 'whole'].includes(String(value));
const enumOf = (...values) => (value) => typeof value === 'string' && values.includes(value);
function objectRule(fields, required = [], minProperties = 0) {
    return value => isObject(value) && Object.keys(value).length >= minProperties
        && required.every(key => has(value, key))
        && Object.entries(value).every(([key, entry]) => fields[key] !== undefined && fields[key](entry));
}
const stroke = objectRule({ method: enumOf('webkit-outline'), color: hex, width_px: nonnegative });
const shadow = objectRule({ color: hex, opacity: value => number(value) && value >= 0 && value <= 1,
    blur_px: nonnegative, distance_px: nonnegative, angle_deg: number }, ['color']);
const glow = objectRule({ color: hex, density: nonnegative, spread: nonnegative, offset_x: number, offset_y: number }, ['color']);
const background = objectRule({ color: hex, opacity: value => number(value) && value >= 0 && value <= 1,
    radius_px: nonnegative, padding_px: nonnegative, width_pct: nonnegative, height_pct: nonnegative,
    fit: enumOf('text', 'frame'), offset_x: number, offset_y: number, mode: enumOf('per-line', 'block') });
const lookFields = { color: hex, font_weight: value => integer(value) && value >= 1 && value <= 1000,
    italic: value => typeof value === 'boolean', underline: value => typeof value === 'boolean', letter_spacing_em: number,
    scale: positive, baseline_shift_em: number, rotate_deg: value => number(value) && Math.abs(value) <= 180,
    stroke, shadow, glow, background };
const look = objectRule(lookFields);
exports.CAPTION_LOOK_SHAPE_ANIMATION_IDS = ['fade-in-out', 'soft-fade', 'fade-up', 'fade-down', 'cinematic-fade',
    'slide-left', 'slide-right', 'slide-up', 'slide-down', 'push-left', 'push-right', 'push-up', 'push-down',
    'rise-soft', 'drop-in', 'zoom-in-out', 'zoom-pop', 'zoom-pulse', 'pop', 'bounce', 'squash-pop',
    'stretch-in', 'stomp', 'snap', 'rotate-in', 'spin-in', 'roll-in', 'spiral-in', 'swing', 'shake',
    'jitter', 'glitch', 'flash', 'heartbeat', 'typewriter', 'wipe-left', 'wipe-right', 'wobble',
    'float', 'breath', 'neon-flicker', 'hologram', 'retro-flicker', 'caption-rise', 'news-ticker',
    'marquee-left', 'crawl-up'];
const animationIds = new Set(exports.CAPTION_LOOK_SHAPE_ANIMATION_IDS);
const slot = objectRule({ id: value => typeof value === 'string' && animationIds.has(value), duration_sec: positive,
    ease: value => value === null || typeof value === 'string' && /\S/.test(value),
    amp: value => value === null || positive(value) }, ['id']);
const motion = objectRule({ in: slot, loop: slot, out: slot }, [], 1);
const anchorFields = { src: nonempty, start: nonnegative, end: nonnegative,
    domain: enumOf('source', 'output') };
const anchor = objectRule(anchorFields, ['start', 'end', 'domain']);
const sourceFields = { kind: enumOf('builtin', 'library', 'my'), id: nonempty, uid: nonempty,
    revision: value => integer(value) && value >= 0, original_hash: nonempty,
    applied_hash: nonempty, applied_at: nonempty,
    requires: value => Array.isArray(value) && value.every(objectRule({ id: nonempty,
        version: value => typeof value === 'string', hash: nonempty }, ['id', 'version', 'hash'])) };
const source = objectRule(sourceFields, ['kind', 'id', 'original_hash', 'applied_hash']);
const styleSourcesFields = { look: source, motion: source };
const styleSources = objectRule(styleSourcesFields);
const migratedEmphasis = objectRule({ index: nonnegative, item: value => isObject(value) }, ['index', 'item']);
const v1Fields = {
    id: runId, from: integer, to: integer, role: nonempty, look, motion, emotion: nonempty, anchor,
    fire, fire_was: fire, style_sources: styleSources, needs_review: value => typeof value === 'boolean',
    split_from: runId, migrated_from: value => typeof value === 'string' && /^e-\d{4,}$/.test(value),
    dormant_animation: motion, migrated_emphasis: migratedEmphasis
};
const unresolvedFields = ['run', 'old_caption_id', 'old_text', 'old_src', 'old_start', 'old_end', 'reason'];
exports.CAPTION_LOOK_SHAPE_KEYS = {
    run: [...Object.keys(v1Fields), 'style', 'animation'], look: Object.keys(lookFields), anchor: Object.keys(anchorFields),
    styleSources: Object.keys(styleSourcesFields), source: Object.keys(sourceFields), unresolvedRun: unresolvedFields
};
const idRequired = ['look', 'motion', 'anchor', 'fire', 'style_sources', 'migrated_from'];
/** v1 の追加項目だけを検査する。旧い行の他の項目と runs v0 の形は許す。 */
function validateCaptionLookV1Shape(captionsRoot) {
    const diagnostics = [];
    const add = (path, field) => diagnostics.push({ code: 'captions.look.shape', severity: 'error',
        path, message: `${field} の形が字幕の規則に合いません。`, layer: 'document' });
    const rows = Array.isArray(captionsRoot) ? captionsRoot : isObject(captionsRoot) ? captionsRoot.captions : undefined;
    const checkRun = (run, path) => {
        if (!isObject(run)) {
            add(path, 'run');
            return;
        }
        const v1 = Object.keys(v1Fields).some(key => has(run, key));
        if (v1)
            for (const key of ['from', 'to'])
                if (!has(run, key))
                    add(path, key);
        if (idRequired.some(key => has(run, key)) && !has(run, 'id'))
            add(path, 'id');
        for (const [key, rule] of Object.entries(v1Fields))
            if (has(run, key) && !rule(run[key]))
                add(`${path}.${key}`, key);
        for (const key of Object.keys(run))
            if (!has(v1Fields, key) && !['style', 'animation'].includes(key))
                add(`${path}.${key}`, key);
    };
    if (Array.isArray(rows))
        rows.forEach((row, index) => {
            if (!isObject(row))
                return;
            if (has(row, 'style_sources') && !styleSources(row.style_sources))
                add(`captions.json#captions[${index}].style_sources`, 'style_sources');
            if (Array.isArray(row.runs))
                row.runs.forEach((run, runIndex) => checkRun(run, `captions.json#captions[${index}].runs[${runIndex}]`));
        });
    if (isObject(captionsRoot) && has(captionsRoot, 'unresolved_runs')) {
        const value = captionsRoot.unresolved_runs;
        const valid = Array.isArray(value) && value.every((item, index) => {
            if (!isObject(item))
                return false;
            checkRun(item.run, `captions.json#unresolved_runs[${index}].run`);
            return unresolvedFields.every(key => has(item, key)) && Object.keys(item).every(key => unresolvedFields.includes(key))
                && isObject(item.run) && typeof item.old_caption_id === 'string'
                && typeof item.old_text === 'string' && (item.old_src === null || typeof item.old_src === 'string')
                && number(item.old_start) && number(item.old_end) && nonempty(item.reason);
        });
        if (!valid)
            add('captions.json#unresolved_runs', 'unresolved_runs');
    }
    return diagnostics;
}
class CaptionsInvalidError extends Error {
    constructor(diagnostics) {
        super(`字幕の内容を保存できません: ${diagnostics.map(item => item.message).join('、')}`);
        this.diagnostics = diagnostics;
        this.code = 'AKARI_CAPTIONS_INVALID';
        this.name = 'CaptionsInvalidError';
    }
}
exports.CaptionsInvalidError = CaptionsInvalidError;
function assertCaptionsWritable(captionsRoot, ctx = {}) {
    const diagnostics = [...validateCaptionLookV1Shape(captionsRoot), ...(0, caption_semantics_1.validateCaptionsSemantics)({ ...ctx, captions: captionsRoot })];
    if (diagnostics.some(item => item.severity === 'error'))
        throw new CaptionsInvalidError(diagnostics);
}
