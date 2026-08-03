"use strict";
/**
 * Caption display policy v1.  This is the single pure implementation used by
 * render-cut, preview-server, and the shell backend.  It deliberately performs
 * no file IO and returns timeline-domain display cues; browser consumers only
 * select a resolved cue by output time.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCssNumber = exports.resolveCaptionStyleForOutput = exports.mergeCaptionDisplayStyles = exports.scheduleCaptionFragments = exports.splitCaptionFragments = exports.validateCaptionTextStyle = exports.resolveCaptionDisplay = exports.validateCaptionDisplayPolicy = exports.measureCaptionUnits = exports.CaptionDisplayError = exports.CAPTION_UNIT_METRIC = exports.CAPTION_DISPLAY_ALGORITHM = exports.CAPTION_DISPLAY_MODE = exports.CAPTION_DISPLAY_SCHEMA = void 0;
exports.CAPTION_DISPLAY_SCHEMA = 'caption-layout/v1';
exports.CAPTION_DISPLAY_MODE = 'single_line_sequential';
exports.CAPTION_DISPLAY_ALGORITHM = 'a4-ja-two-fragment-v1';
exports.CAPTION_UNIT_METRIC = 'ascii-half-other-one-v1';
const CAPTION_STYLE_KEYS = new Set([
    'color', 'size_px', 'font_weight', 'line_height', 'stroke', 'background', 'zone', 'layout'
]);
const CAPTION_STROKE_KEYS = new Set(['method', 'color', 'width_px']);
const CAPTION_BACKGROUND_KEYS = new Set(['color', 'opacity', 'radius_px', 'mode']);
const CAPTION_LAYOUT_KEYS = new Set([
    'mode', 'reference_width_px', 'reference_height_px', 'left_px', 'width_px',
    'bottom_px', 'text_align', 'max_lines'
]);
const CAPTION_LAYOUT_REQUIRED_KEYS = [...CAPTION_LAYOUT_KEYS];
const CAPTION_ZONES = new Set([
    'top-left', 'top', 'top-right', 'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
]);
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u;
class CaptionDisplayError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'CaptionDisplayError';
        this.code = code;
    }
}
exports.CaptionDisplayError = CaptionDisplayError;
function measureCaptionUnits(text) {
    return Array.from(text).reduce((total, character) => total + (/^[\x00-\x7F]$/u.test(character) ? 0.5 : 1), 0);
}
exports.measureCaptionUnits = measureCaptionUnits;
function validateCaptionDisplayPolicy(value) {
    if (!isRecord(value))
        fail('INVALID_POLICY', 'display_policy must be an object');
    const allowed = new Set([
        'mode', 'algorithm', 'unit_metric', 'max_line_units',
        'minimum_fragment_duration_seconds', 'locale', 'break_hints'
    ]);
    rejectUnknown(value, allowed, 'display_policy');
    if (value.mode !== exports.CAPTION_DISPLAY_MODE)
        fail('INVALID_POLICY', `display_policy.mode must be ${exports.CAPTION_DISPLAY_MODE}`);
    if (value.algorithm !== exports.CAPTION_DISPLAY_ALGORITHM)
        fail('INVALID_POLICY', `display_policy.algorithm must be ${exports.CAPTION_DISPLAY_ALGORITHM}`);
    if (value.unit_metric !== exports.CAPTION_UNIT_METRIC)
        fail('INVALID_POLICY', `display_policy.unit_metric must be ${exports.CAPTION_UNIT_METRIC}`);
    if (!finitePositive(value.max_line_units))
        fail('INVALID_POLICY', 'display_policy.max_line_units must be a positive finite number');
    if (!finitePositive(value.minimum_fragment_duration_seconds))
        fail('INVALID_POLICY', 'display_policy.minimum_fragment_duration_seconds must be a positive finite number');
    if (!strictText(value.locale)) {
        fail('INVALID_POLICY', 'display_policy.locale must be a non-empty NFC trimmed string');
    }
    const breakHints = value.break_hints === undefined ? undefined : validateBreakHints(value.break_hints);
    return {
        mode: value.mode,
        algorithm: value.algorithm,
        unit_metric: value.unit_metric,
        max_line_units: value.max_line_units,
        minimum_fragment_duration_seconds: value.minimum_fragment_duration_seconds,
        locale: value.locale,
        ...(breakHints ? { break_hints: breakHints } : {})
    };
}
exports.validateCaptionDisplayPolicy = validateCaptionDisplayPolicy;
function validateBreakHints(value) {
    if (!isRecord(value))
        fail('INVALID_POLICY', 'display_policy.break_hints must be an object');
    rejectUnknown(value, new Set(['preferred_second_starts', 'preferred_first_ends', 'protected_terms']), 'display_policy.break_hints');
    const result = {};
    for (const key of ['preferred_second_starts', 'preferred_first_ends', 'protected_terms']) {
        if (value[key] === undefined)
            continue;
        if (!Array.isArray(value[key]) || value[key].some((entry) => !strictText(entry))) {
            fail('INVALID_POLICY', `display_policy.break_hints.${key} must contain only non-empty NFC trimmed strings`);
        }
        result[key] = [...value[key]];
    }
    return result;
}
function resolveCaptionDisplay(captionsRoot, edit, options = {}) {
    if (Array.isArray(captionsRoot) || !isRecord(captionsRoot) || captionsRoot.display_policy === undefined) {
        return null;
    }
    const policy = validateCaptionDisplayPolicy(captionsRoot.display_policy);
    if (!Array.isArray(captionsRoot.captions))
        fail('INVALID_CAPTIONS', 'captions.json object root must contain captions[]');
    const captions = captionsRoot.captions;
    const defaultStyle = Object.prototype.hasOwnProperty.call(captionsRoot, 'default_text_style')
        ? validateCaptionTextStyle(captionsRoot.default_text_style, 'default_text_style')
        : undefined;
    const captionIds = new Set();
    captions.forEach((caption, index) => {
        validateSourceCaption(caption, index, policy);
        if (Object.prototype.hasOwnProperty.call(caption, 'text_style')) {
            validateCaptionTextStyle(caption.text_style, `captions[${index}].text_style`);
        }
        if (captionIds.has(caption.id))
            fail('DUPLICATE_CAPTION_ID', `captions[].id is duplicated: ${caption.id}`);
        captionIds.add(caption.id);
    });
    validateEmphasisConflicts(captions, edit?.emphasis_words);
    const cuts = Array.isArray(edit?.cuts) ? edit.cuts : [];
    validateLinearCuts(cuts, edit);
    const sourceCount = validateSourceReferences(captions, cuts, edit);
    const occurrences = projectOccurrences(captions, cuts, sourceCount);
    occurrences.sort(compareOccurrence);
    const byCue = new Map();
    for (const occurrence of occurrences) {
        const values = byCue.get(occurrence.source_cue_id) ?? [];
        values.push(occurrence);
        byCue.set(occurrence.source_cue_id, values);
    }
    for (const values of byCue.values()) {
        values.forEach((occurrence, index) => { occurrence.occurrence_index = index + 1; });
    }
    const boundaryProjection = [];
    const fragmentsByCaption = new Map();
    captions.forEach((caption, index) => {
        const text = caption.display_text ?? caption.text;
        let fragments;
        let manual = false;
        if (caption.display_fragments !== undefined) {
            fragments = validateManualFragments(caption, text, policy, index);
            manual = true;
            boundaryProjection.push({ source_cue_id: caption.id, text, boundaries: [] });
        }
        else {
            const split = splitCaptionFragments(text, policy);
            fragments = split.fragments;
            boundaryProjection.push({ source_cue_id: caption.id, text, boundaries: split.boundaries });
        }
        fragmentsByCaption.set(index, { fragments, manual });
    });
    const displayCues = [];
    const splitCueIds = new Set();
    for (const occurrence of occurrences) {
        const resolved = fragmentsByCaption.get(occurrence.caption_input_index);
        if (resolved.fragments.length > 1)
            splitCueIds.add(occurrence.source_cue_id);
        const resolvedStyle = mergeCaptionDisplayStyles(defaultStyle, occurrence.text_style);
        const styleOutput = options.output ?? edit?.output;
        const styleResolution = resolvedStyle
            ? resolveCaptionStyleForOutput(resolvedStyle, styleOutput)
            : undefined;
        const scheduled = scheduleCaptionFragments(occurrence.start, occurrence.end, resolved.fragments, policy.minimum_fragment_duration_seconds);
        scheduled.forEach((fragment, index) => displayCues.push({
            id: `${occurrence.source_cue_id}-occ-${String(occurrence.occurrence_index).padStart(4, '0')}-part-${index + 1}`,
            source_cue_id: occurrence.source_cue_id,
            src: occurrence.src,
            cut_index: occurrence.cut_index,
            occurrence_index: occurrence.occurrence_index,
            fragment_index: index + 1,
            fragment_count: scheduled.length,
            start: fragment.start,
            end: fragment.end,
            text: fragment.text,
            units: measureCaptionUnits(fragment.text),
            line_override: resolved.manual,
            ...(resolvedStyle ? { text_style: resolvedStyle } : {}),
            ...(styleResolution ? { style_vars: styleResolution.vars } : {}),
            ...(styleResolution?.layout ? { layout: styleResolution.layout } : {})
        }));
    }
    displayCues.sort(compareDisplayCue);
    for (let index = 1; index < displayCues.length; index++) {
        if (displayCues[index - 1].end - displayCues[index].start > 0.000001) {
            fail('OVERLAPPING_DISPLAY_CUES', `single_line_sequential display cues overlap: ${displayCues[index - 1].id} and ${displayCues[index].id}`);
        }
    }
    return {
        schema: exports.CAPTION_DISPLAY_SCHEMA,
        policy,
        source_cue_count: captions.length,
        occurrence_count: occurrences.length,
        display_cue_count: displayCues.length,
        split_source_cue_count: splitCueIds.size,
        boundary_projection: boundaryProjection,
        display_cues: displayCues
    };
}
exports.resolveCaptionDisplay = resolveCaptionDisplay;
/**
 * Strict captions.schema textStyle validation for the opt-in display-policy kernel.
 * Validation happens on each source object before merge so a valid override can never
 * conceal an invalid default (or vice versa).
 */
function validateCaptionTextStyle(value, label = 'text_style') {
    if (!isRecord(value))
        fail('INVALID_TEXT_STYLE', `${label} must be an object`);
    rejectStyleUnknown(value, CAPTION_STYLE_KEYS, label);
    if (Object.prototype.hasOwnProperty.call(value, 'color'))
        validateHexColor(value.color, `${label}.color`);
    if (Object.prototype.hasOwnProperty.call(value, 'size_px') && !finitePositive(value.size_px)) {
        fail('INVALID_TEXT_STYLE', `${label}.size_px must be a positive finite number`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'font_weight')
        && (!Number.isInteger(value.font_weight) || value.font_weight < 1 || value.font_weight > 1000)) {
        fail('INVALID_TEXT_STYLE', `${label}.font_weight must be an integer within [1, 1000]`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'line_height') && !finitePositive(value.line_height)) {
        fail('INVALID_TEXT_STYLE', `${label}.line_height must be a positive finite number`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'stroke'))
        validateCaptionStroke(value.stroke, `${label}.stroke`);
    if (Object.prototype.hasOwnProperty.call(value, 'background'))
        validateCaptionBackground(value.background, `${label}.background`);
    if (Object.prototype.hasOwnProperty.call(value, 'zone') && !CAPTION_ZONES.has(value.zone)) {
        fail('INVALID_TEXT_STYLE', `${label}.zone must be one of the nine caption zones`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'layout'))
        validateCaptionLayout(value.layout, `${label}.layout`);
    if (Object.prototype.hasOwnProperty.call(value, 'zone') && Object.prototype.hasOwnProperty.call(value, 'layout')) {
        fail('STYLE_LAYOUT_CONFLICT', `${label} cannot contain both zone and layout`);
    }
    return value;
}
exports.validateCaptionTextStyle = validateCaptionTextStyle;
function validateCaptionStroke(value, label) {
    if (!isRecord(value))
        fail('INVALID_TEXT_STYLE', `${label} must be an object`);
    rejectStyleUnknown(value, CAPTION_STROKE_KEYS, label);
    if (Object.prototype.hasOwnProperty.call(value, 'method') && value.method !== 'webkit-outline') {
        fail('INVALID_TEXT_STYLE', `${label}.method must be webkit-outline`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'color'))
        validateHexColor(value.color, `${label}.color`);
    if (Object.prototype.hasOwnProperty.call(value, 'width_px') && !finiteNonNegative(value.width_px)) {
        fail('INVALID_TEXT_STYLE', `${label}.width_px must be a non-negative finite number`);
    }
}
function validateCaptionBackground(value, label) {
    if (!isRecord(value))
        fail('INVALID_TEXT_STYLE', `${label} must be an object`);
    rejectStyleUnknown(value, CAPTION_BACKGROUND_KEYS, label);
    if (Object.prototype.hasOwnProperty.call(value, 'color'))
        validateHexColor(value.color, `${label}.color`);
    if (Object.prototype.hasOwnProperty.call(value, 'opacity')
        && (!finiteNonNegative(value.opacity) || value.opacity > 1)) {
        fail('INVALID_TEXT_STYLE', `${label}.opacity must be a finite number within [0, 1]`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'radius_px') && !finiteNonNegative(value.radius_px)) {
        fail('INVALID_TEXT_STYLE', `${label}.radius_px must be a non-negative finite number`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'mode')
        && value.mode !== 'per-line' && value.mode !== 'block') {
        fail('INVALID_TEXT_STYLE', `${label}.mode must be per-line or block`);
    }
}
function validateCaptionLayout(value, label) {
    if (!isRecord(value))
        fail('INVALID_TEXT_STYLE', `${label} must be an object`);
    rejectStyleUnknown(value, CAPTION_LAYOUT_KEYS, label);
    for (const key of CAPTION_LAYOUT_REQUIRED_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            fail('INVALID_TEXT_STYLE', `${label}.${key} is required`);
        }
    }
    if (value.mode !== 'reference-pixel'
        || !Number.isInteger(value.reference_width_px) || value.reference_width_px <= 0
        || !Number.isInteger(value.reference_height_px) || value.reference_height_px <= 0
        || !finiteNonNegative(value.left_px) || !finitePositive(value.width_px)
        || value.left_px + value.width_px > value.reference_width_px
        || !finiteNonNegative(value.bottom_px)
        || value.text_align !== 'center' || value.max_lines !== 1) {
        fail('INVALID_TEXT_STYLE', `${label} must be a bounded reference-pixel layout with center/max_lines=1`);
    }
}
function validateHexColor(value, label) {
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
        fail('INVALID_TEXT_STYLE', `${label} must be a #RGB, #RRGGBB, or #RRGGBBAA hex color`);
    }
}
function rejectStyleUnknown(value, allowed, label) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key))
            fail('INVALID_TEXT_STYLE', `${label}.${key} is not defined by the text style contract`);
    }
}
function validateSourceReferences(captions, cuts, edit) {
    if (edit?.version !== 1)
        return 1;
    if (!Array.isArray(edit.sources) || edit.sources.length === 0) {
        fail('INVALID_SOURCES', 'edit.json version 1 requires a non-empty sources[] array');
    }
    const sourceIds = new Set();
    edit.sources.forEach((source, index) => {
        if (!isRecord(source) || !strictText(source.id)) {
            fail('INVALID_SOURCE_ID', `edit.json sources[${index}].id must be a non-empty NFC trimmed string`);
        }
        if (sourceIds.has(source.id))
            fail('DUPLICATE_SOURCE_ID', `edit.json sources[].id is duplicated: ${source.id}`);
        sourceIds.add(source.id);
    });
    cuts.forEach((cut, index) => {
        if (edit.sources.length > 1 && cut.src === undefined) {
            fail('MISSING_CUT_SOURCE', `edit.json cuts[${index}].src is required for a multi-source edit`);
        }
        if (cut.src !== undefined && (!strictText(cut.src) || !sourceIds.has(cut.src))) {
            fail('UNKNOWN_CUT_SOURCE', `edit.json cuts[${index}].src does not reference sources[].id`);
        }
    });
    captions.forEach((caption, index) => {
        if (edit.sources.length > 1 && caption.src === undefined) {
            fail('MISSING_SOURCE', `captions[${index}].src is required for a multi-source edit`);
        }
        if (caption.src !== undefined && !sourceIds.has(caption.src)) {
            fail('UNKNOWN_SOURCE', `captions[${index}].src does not reference edit.json sources[].id`);
        }
    });
    return edit.sources.length;
}
function validateLinearCuts(cuts, edit) {
    cuts.forEach((cut, index) => {
        if (!isRecord(cut) || !finiteNonNegative(cut.in) || !finitePositive(cut.out) || cut.out <= cut.in) {
            fail('INVALID_CUT', `edit.json cuts[${index}] must satisfy 0 <= in < out`);
        }
        if (Object.prototype.hasOwnProperty.call(cut, 'at')
            || Object.prototype.hasOwnProperty.call(cut, 'track')
            || Object.prototype.hasOwnProperty.call(cut, 'transition_out')
            || Object.prototype.hasOwnProperty.call(cut, 'transitionOut')) {
            fail('UNSUPPORTED_TIMELINE', `display_policy does not support cuts[${index}].at/track/transition_out`);
        }
        if (cut.speed !== undefined && !finitePositive(cut.speed))
            fail('INVALID_CUT', `edit.json cuts[${index}].speed must be positive`);
    });
    if (Array.isArray(edit?.timeline?.tracks)
        && edit.timeline.tracks.some((track) => track?.kind === 'cuts')) {
        fail('UNSUPPORTED_TIMELINE', 'display_policy does not support timeline.tracks cuts winner overrides');
    }
}
function projectOccurrences(captions, cuts, sourceCount) {
    const occurrences = [];
    if (cuts.length === 0) {
        captions.forEach((caption, captionInputIndex) => {
            const text = caption?.display_text ?? caption?.text;
            if (isRecord(caption) && finiteNonNegative(caption.start) && finitePositive(caption.end) && caption.end > caption.start && typeof text === 'string') {
                occurrences.push({
                    source_cue_id: caption.id,
                    src: typeof caption.src === 'string' ? caption.src : null,
                    cut_index: 0,
                    caption_input_index: captionInputIndex,
                    source_start: caption.start,
                    source_end: caption.end,
                    start: caption.start,
                    end: caption.end,
                    text,
                    display_fragments: caption.display_fragments,
                    text_style: caption.text_style
                });
            }
        });
        return occurrences;
    }
    let cursor = 0;
    const segments = cuts.map((cut, cutIndex) => {
        const speed = finitePositive(cut.speed) ? cut.speed : 1;
        const duration = (cut.out - cut.in) / speed;
        const segment = { cut, cutIndex, speed, start: cursor, end: cursor + duration };
        cursor += duration;
        return segment;
    });
    captions.forEach((caption, captionInputIndex) => {
        if (!isRecord(caption))
            return;
        const captionSource = strictText(caption.src) ? caption.src : null;
        if (sourceCount > 1 && captionSource === null) {
            fail('MISSING_SOURCE', `captions[${captionInputIndex}].src is required for a multi-source edit`);
        }
        for (const segment of segments) {
            if (captionSource !== null && segment.cut.src !== captionSource)
                continue;
            const sourceStart = Math.max(caption.start, segment.cut.in);
            const sourceEnd = Math.min(caption.end, segment.cut.out);
            if (!(sourceEnd > sourceStart))
                continue;
            occurrences.push({
                source_cue_id: caption.id,
                src: captionSource ?? (typeof segment.cut.src === 'string' ? segment.cut.src : null),
                cut_index: segment.cutIndex,
                caption_input_index: captionInputIndex,
                source_start: sourceStart,
                source_end: sourceEnd,
                start: segment.start + (sourceStart - segment.cut.in) / segment.speed,
                end: segment.start + (sourceEnd - segment.cut.in) / segment.speed,
                text: caption.display_text ?? caption.text,
                display_fragments: caption.display_fragments,
                text_style: caption.text_style
            });
        }
    });
    return occurrences;
}
function validateSourceCaption(caption, index, policy) {
    if (!isRecord(caption) || !strictText(caption.id))
        fail('INVALID_CAPTION', `captions[${index}].id must be a non-empty string`);
    if (!finiteNonNegative(caption.start) || !finitePositive(caption.end) || caption.end <= caption.start) {
        fail('INVALID_CAPTION', `captions[${index}] must satisfy 0 <= start < end`);
    }
    if (caption.src !== undefined && !strictText(caption.src)) {
        fail('INVALID_CAPTION', `captions[${index}].src must be a non-empty NFC trimmed string when present`);
    }
    const text = caption.display_text ?? caption.text;
    if (!strictText(text))
        fail('INVALID_TEXT', `captions[${index}] display text must be non-empty, NFC, and trimmed`);
    if (caption.style === 'karaoke' || caption.style === 'pop' || caption.style === 'reveal') {
        fail('STYLE_CONFLICT', `captions[${index}].style cannot be combined with display_policy`);
    }
    if (measureCaptionUnits(text) > policy.max_line_units * 2 && caption.display_fragments === undefined) {
        fail('NO_WORD_BOUNDARY_SPLIT', `caption ${caption.id} cannot fit in two ${policy.max_line_units}-unit fragments; provide display_fragments`);
    }
}
function validateEmphasisConflicts(captions, emphasisValue) {
    if (!Array.isArray(emphasisValue))
        return;
    captions.forEach((caption, index) => {
        const conflict = emphasisValue.some(value => isRecord(value)
            && (!strictText(value.src) || !strictText(caption.src) || value.src === caption.src)
            && finiteNonNegative(value.t_start) && finitePositive(value.t_end)
            && value.t_end > caption.start && value.t_start < caption.end);
        if (conflict)
            fail('EMPHASIS_CONFLICT', `edit.emphasis_words cannot act on captions[${index}] under display_policy`);
    });
}
function validateManualFragments(caption, text, policy, index) {
    if (!Array.isArray(caption.display_fragments) || caption.display_fragments.length < 1 || caption.display_fragments.length > 2) {
        fail('INVALID_MANUAL_FRAGMENTS', `captions[${index}].display_fragments must contain one or two strings`);
    }
    if (caption.display_fragments.some((fragment) => !strictText(fragment))) {
        fail('INVALID_MANUAL_FRAGMENTS', `captions[${index}].display_fragments must contain non-empty NFC trimmed strings`);
    }
    if (caption.display_fragments.join('') !== text) {
        fail('INVALID_MANUAL_FRAGMENTS', `captions[${index}].display_fragments must preserve display_text ?? text exactly`);
    }
    for (const fragment of caption.display_fragments) {
        if (measureCaptionUnits(fragment) > policy.max_line_units) {
            fail('INVALID_MANUAL_FRAGMENTS', `captions[${index}].display_fragments exceeds max_line_units`);
        }
    }
    return [...caption.display_fragments];
}
function splitCaptionFragments(text, policy) {
    if (measureCaptionUnits(text) <= policy.max_line_units)
        return { fragments: [text], boundaries: [] };
    const Segmenter = Intl.Segmenter;
    if (typeof Segmenter !== 'function')
        fail('SEGMENTER_UNAVAILABLE', 'Intl.Segmenter is required by display_policy');
    const segmenter = new Segmenter(policy.locale, { granularity: 'word' });
    const boundaries = [...segmenter.segment(text)]
        .map(segment => segment.index)
        .filter(index => index > 0 && index < text.length);
    const candidates = [];
    for (const boundary of boundaries) {
        const first = text.slice(0, boundary);
        const second = text.slice(boundary);
        const firstUnits = measureCaptionUnits(first);
        const secondUnits = measureCaptionUnits(second);
        if (firstUnits > policy.max_line_units || secondUnits > policy.max_line_units)
            continue;
        if (splitsProtectedTerm(text, boundary, policy.break_hints?.protected_terms ?? []))
            continue;
        candidates.push({
            fragments: [first, second],
            score: captionBreakScore(first, second, firstUnits, secondUnits, policy.break_hints),
            boundary
        });
    }
    if (candidates.length === 0) {
        fail('NO_WORD_BOUNDARY_SPLIT', `caption cannot fit at an Intl.Segmenter boundary in two ${policy.max_line_units}-unit fragments; provide display_fragments: ${text}`);
    }
    candidates.sort((left, right) => right.score - left.score || left.boundary - right.boundary);
    return { fragments: candidates[0].fragments, boundaries };
}
exports.splitCaptionFragments = splitCaptionFragments;
function captionBreakScore(first, second, firstUnits, secondUnits, hints) {
    let score = 100 - Math.abs(firstUnits - secondUnits) * 4;
    if ((hints?.preferred_second_starts ?? []).some(value => second.startsWith(value)))
        score += 34;
    if ((hints?.preferred_first_ends ?? []).some(value => first.endsWith(value)))
        score += 28;
    if (/[、。！？!?]$/u.test(first))
        score += 50;
    if (/^[、。！？!?）」』】]/u.test(second))
        score -= 100;
    if (/[（「『【]$/u.test(first))
        score -= 100;
    if (/^[はがをにでとのもへや]/u.test(second))
        score -= 28;
    if (/[（「『【]/u.test(first.at(-1) ?? ''))
        score -= 80;
    return score;
}
function splitsProtectedTerm(text, boundary, terms) {
    return terms.some(term => {
        let start = text.indexOf(term);
        while (start !== -1) {
            if (start < boundary && boundary < start + term.length)
                return true;
            start = text.indexOf(term, start + 1);
        }
        return false;
    });
}
function scheduleCaptionFragments(start, end, fragments, minimumSeconds) {
    const duration = end - start;
    if (!(duration > 0))
        fail('INVALID_OCCURRENCE', 'caption occurrence duration must be positive');
    const weights = fragments.map(fragment => Math.max(measureCaptionUnits(fragment), 0.5));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const minimumDuration = Math.min(minimumSeconds, duration / fragments.length);
    const weightedDuration = Math.max(0, duration - minimumDuration * fragments.length);
    let cursor = start;
    return fragments.map((fragment, index) => {
        const fragmentStart = cursor;
        const fragmentEnd = index === fragments.length - 1
            ? end
            : fragmentStart + minimumDuration + weightedDuration * (weights[index] / totalWeight);
        cursor = fragmentEnd;
        return { start: fragmentStart, end: fragmentEnd, text: fragment };
    });
}
exports.scheduleCaptionFragments = scheduleCaptionFragments;
function mergeCaptionDisplayStyles(base, override) {
    const left = isRecord(base) ? base : {};
    const right = isRecord(override) ? override : {};
    const merged = { ...left, ...right };
    for (const key of ['stroke', 'background', 'layout']) {
        if (isRecord(left[key]) || isRecord(right[key]))
            merged[key] = { ...(isRecord(left[key]) ? left[key] : {}), ...(isRecord(right[key]) ? right[key] : {}) };
    }
    if (Object.keys(merged).length === 0)
        return undefined;
    if (merged.zone !== undefined && merged.layout !== undefined)
        fail('STYLE_LAYOUT_CONFLICT', 'merged caption text style cannot contain both zone and layout');
    return merged;
}
exports.mergeCaptionDisplayStyles = mergeCaptionDisplayStyles;
function resolveCaptionStyleForOutput(style, output) {
    const vars = {};
    let layout;
    let scale = 1;
    if (style.layout !== undefined) {
        if (!output || !finitePositive(output.width) || !finitePositive(output.height))
            fail('INVALID_OUTPUT_GEOMETRY', 'output width/height are required for reference-pixel caption layout');
        layout = resolveReferencePixelLayout(style.layout, output);
        scale = layout.scale;
        vars['--caption-left'] = `${formatCssNumber(layout.left_px)}px`;
        vars['--caption-right'] = `${formatCssNumber(layout.right_px)}px`;
        vars['--caption-bottom'] = `${formatCssNumber(layout.bottom_px)}px`;
        vars['--caption-width'] = `${formatCssNumber(layout.width_px)}px`;
        vars['--caption-text-align'] = 'center';
    }
    if (typeof style.color === 'string')
        vars['--caption-color'] = style.color;
    if (finitePositive(style.size_px))
        vars['--caption-font-size'] = `${formatCssNumber(style.size_px * scale)}px`;
    if (Number.isInteger(style.font_weight) && style.font_weight >= 1 && style.font_weight <= 1000)
        vars['--caption-font-weight'] = String(style.font_weight);
    if (finitePositive(style.line_height))
        vars['--caption-line-height'] = formatCssNumber(style.line_height);
    if (isRecord(style.stroke)) {
        const color = typeof style.stroke.color === 'string' ? style.stroke.color : 'rgba(0,0,0,.85)';
        const width = finiteNonNegative(style.stroke.width_px) ? style.stroke.width_px * scale : 1.5;
        if (style.stroke.method === 'webkit-outline') {
            vars['--caption-webkit-text-stroke'] = `${formatCssNumber(width)}px ${color}`;
            vars['--caption-paint-order'] = 'stroke fill';
            vars['--caption-text-shadow'] = 'none';
        }
        else {
            vars['--caption-text-shadow'] = strokeShadow(color, width, layout !== undefined);
        }
    }
    if (isRecord(style.background) && finiteNonNegative(style.background.radius_px)) {
        vars['--plate-radius'] = `${formatCssNumber(style.background.radius_px * scale)}px`;
        vars['--plate-block-radius'] = `${formatCssNumber(style.background.radius_px * scale)}px`;
    }
    return { vars, ...(layout ? { layout } : {}) };
}
exports.resolveCaptionStyleForOutput = resolveCaptionStyleForOutput;
function resolveReferencePixelLayout(value, output) {
    if (!isRecord(value) || value.mode !== 'reference-pixel')
        fail('INVALID_LAYOUT', 'caption layout.mode must be reference-pixel');
    const required = ['reference_width_px', 'reference_height_px', 'left_px', 'width_px', 'bottom_px', 'text_align', 'max_lines'];
    for (const key of required)
        if (!Object.prototype.hasOwnProperty.call(value, key))
            fail('INVALID_LAYOUT', `caption layout.${key} is required`);
    if (!Number.isInteger(value.reference_width_px) || value.reference_width_px <= 0
        || !Number.isInteger(value.reference_height_px) || value.reference_height_px <= 0
        || !finiteNonNegative(value.left_px) || !finitePositive(value.width_px)
        || !finiteNonNegative(value.bottom_px) || value.left_px + value.width_px > value.reference_width_px
        || value.text_align !== 'center' || value.max_lines !== 1) {
        fail('INVALID_LAYOUT', 'caption reference-pixel layout fields are invalid');
    }
    const widthScale = output.width / value.reference_width_px;
    const heightScale = output.height / value.reference_height_px;
    if (Math.abs(widthScale - heightScale) > 0.000001)
        fail('ASPECT_RATIO_MISMATCH', 'caption reference-pixel layout aspect ratio does not match output');
    const left = value.left_px * widthScale;
    const width = value.width_px * widthScale;
    const bottom = value.bottom_px * widthScale;
    return {
        mode: 'reference-pixel',
        reference_width_px: value.reference_width_px,
        reference_height_px: value.reference_height_px,
        left_px: left,
        width_px: width,
        right_px: output.width - left - width,
        center_x_px: left + width / 2,
        bottom_px: bottom,
        text_align: 'center',
        max_lines: 1,
        scale: widthScale
    };
}
function formatCssNumber(value) {
    return Number(value.toFixed(6)).toString();
}
exports.formatCssNumber = formatCssNumber;
function strokeShadow(color, width, rounded) {
    const serialized = rounded ? formatCssNumber(width) : String(width);
    const negative = width === 0 ? '0' : `-${serialized}px`;
    const positive = width === 0 ? '0' : `${serialized}px`;
    return `${negative} ${negative} 0 ${color}, ${positive} ${negative} 0 ${color}, `
        + `${negative} ${positive} 0 ${color}, ${positive} ${positive} 0 ${color}, `
        + '0 0 8px rgba(0,0,0,.6)';
}
function compareOccurrence(left, right) {
    return left.start - right.start
        || left.cut_index - right.cut_index
        || left.source_start - right.source_start
        || left.caption_input_index - right.caption_input_index;
}
function compareDisplayCue(left, right) {
    return left.start - right.start
        || left.end - right.end
        || left.cut_index - right.cut_index
        || left.occurrence_index - right.occurrence_index
        || left.fragment_index - right.fragment_index;
}
function strictText(value) {
    return typeof value === 'string' && value.length > 0 && value.trim() === value && value.normalize('NFC') === value;
}
function finitePositive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function finiteNonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function rejectUnknown(value, allowed, label) {
    for (const key of Object.keys(value))
        if (!allowed.has(key))
            fail('INVALID_POLICY', `${label}.${key} is not defined`);
}
function fail(code, message) {
    throw new CaptionDisplayError(code, message);
}
