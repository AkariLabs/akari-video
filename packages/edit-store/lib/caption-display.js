"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaptionDisplayError = exports.CAPTION_UNIT_METRIC = exports.CAPTION_DISPLAY_ALGORITHM = exports.CAPTION_DISPLAY_MODE = exports.CAPTION_DISPLAY_SCHEMA = void 0;
exports.measureCaptionUnits = measureCaptionUnits;
exports.captionBreakBoundaryBlocked = captionBreakBoundaryBlocked;
exports.joinCaptionLines = joinCaptionLines;
exports.validateCaptionDisplayPolicy = validateCaptionDisplayPolicy;
exports.resolveCaptionDisplay = resolveCaptionDisplay;
exports.validateCaptionTextStyle = validateCaptionTextStyle;
exports.projectCaptionWords = projectCaptionWords;
exports.dedupeCaptionOccurrences = dedupeCaptionOccurrences;
exports.splitCaptionFragments = splitCaptionFragments;
exports.foldCaptionLines = foldCaptionLines;
exports.scheduleCaptionFragments = scheduleCaptionFragments;
exports.mergeCaptionDisplayStyles = mergeCaptionDisplayStyles;
exports.mergeCaptionLineTextStyles = mergeCaptionLineTextStyles;
exports.usesPercentageBackground = usesPercentageBackground;
exports.usesExtendedPerLineBackground = usesExtendedPerLineBackground;
exports.resolveCaptionReferenceScale = resolveCaptionReferenceScale;
exports.scaleCaptionPx = scaleCaptionPx;
exports.captionAnchorPositionVars = captionAnchorPositionVars;
exports.resolveCaptionLineStyleVars = resolveCaptionLineStyleVars;
exports.resolveCaptionStyleForOutput = resolveCaptionStyleForOutput;
exports.resolveCaptionWordStyleVars = resolveCaptionWordStyleVars;
exports.captionTextShadowValue = captionTextShadowValue;
exports.colorWithOpacity = colorWithOpacity;
exports.formatCssNumber = formatCssNumber;
const caption_style_preset_1 = require("./caption-style-preset");
const textstyle_catalog_1 = require("./generated/textstyle-catalog");
/**
 * Caption display policy v1.  This is the single pure implementation used by
 * render-cut, preview-server, and the shell backend.  It deliberately performs
 * no file IO and returns timeline-domain display cues; browser consumers only
 * select a resolved cue by output time.
 */
exports.CAPTION_DISPLAY_SCHEMA = 'caption-layout/v1';
exports.CAPTION_DISPLAY_MODE = 'single_line_sequential';
exports.CAPTION_DISPLAY_ALGORITHM = 'a4-ja-two-fragment-v1';
exports.CAPTION_UNIT_METRIC = 'ascii-half-other-one-v1';
// textstyle v0（2026-08-03）で render-cut の legacy 字幕レールが実装した語彙を含む。
// この契約は display_policy 経路（reference-pixel）と legacy 経路の**両方**が読む
// captions.json を検証するため、片方の経路でしか効かないキーもここでは受理する
// （legacy 専用キーを display_policy 側が使うと単に無視される — 不正ではない）。
const CAPTION_STYLE_KEYS = new Set([
    'color', 'size_px', 'font_weight', 'line_height', 'stroke', 'background', 'zone', 'layout',
    'font_family', 'weight', 'italic', 'underline', 'letter_spacing_em', 'align',
    'vertical_align', 'vertical', 'text_transform', 'max_width_pct', 'max_characters', 'text_anchor',
    'position', 'scale', 'rotate', 'shadow', 'glow', 'animation', 'reference_height_px'
]);
const CAPTION_STROKE_KEYS = new Set(['method', 'color', 'width_px']);
const CAPTION_BACKGROUND_KEYS = new Set([
    'color', 'opacity', 'radius_px', 'mode',
    'padding_px', 'width_pct', 'height_pct', 'offset_x', 'offset_y'
]);
const CAPTION_ALIGN_VALUES = new Set(['left', 'center', 'right']);
const CAPTION_VERTICAL_ALIGN_VALUES = new Set(['top', 'middle', 'bottom']);
const CAPTION_TEXT_TRANSFORM_VALUES = new Set([
    'upper', 'uppercase', 'lower', 'lowercase', 'title', 'capitalize', 'none'
]);
const CAPTION_TEXT_ANCHOR_VALUES = new Set(['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']);
const CAPTION_POSITION_KEYS = new Set(['x', 'y']);
const CAPTION_SHADOW_KEYS = new Set(['color', 'opacity', 'blur_px', 'distance_px', 'angle_deg']);
const CAPTION_GLOW_KEYS = new Set(['color', 'density', 'spread', 'offset_x', 'offset_y']);
const CAPTION_ANIMATION_SLOTS = new Set(['in', 'loop', 'out']);
const CAPTION_ANIMATION_SLOT_KEYS = new Set(['id', 'duration_sec', 'ease', 'amp']);
const CAPTION_LAYOUT_KEYS = new Set([
    'mode', 'reference_width_px', 'reference_height_px', 'left_px', 'width_px',
    'bottom_px', 'text_align', 'max_lines'
]);
const CAPTION_LAYOUT_REQUIRED_KEYS = [...CAPTION_LAYOUT_KEYS];
const CAPTION_ZONES = new Set([
    'top-left', 'top', 'top-right', 'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
]);
const CAPTION_WORD_STYLES = new Set(['karaoke', 'pop', 'reveal', 'reveal-word']);
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u;
const PROJECTION_EPSILON = 0.000001;
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
/** 自動分割で採用してはいけない、Latin/数字または Segmenter 語の内部境界を判定する。 */
function captionBreakBoundaryBlocked(text, boundary, wordSpans) {
    if (!Number.isInteger(boundary) || boundary <= 0 || boundary >= text.length)
        return false;
    if (/[A-Za-z0-9]/u.test(text[boundary - 1]) && /[A-Za-z0-9]/u.test(text[boundary]))
        return true;
    return wordSpans.some(span => span.wordLike && span.start < boundary && boundary < span.end);
}
function joinCaptionLines(lines, locale) {
    if (/^ja/iu.test(locale)) {
        // ja は語間に空白を入れない。
        return lines.join('');
    }
    // ja 以外も断片は原文の slice なので空白は原文側に含まれ、現状どおり空文字で連結する。
    return lines.join('');
}
function validateCaptionDisplayPolicy(value) {
    if (!isRecord(value))
        fail('INVALID_POLICY', 'display_policy must be an object');
    const allowed = new Set([
        'mode', 'algorithm', 'unit_metric', 'max_line_units',
        'minimum_fragment_duration_seconds', 'locale', 'lines', 'wrap', 'break_hints'
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
    if (value.lines !== undefined && (!Number.isInteger(value.lines) || value.lines < 1 || value.lines > 6)) {
        fail('INVALID_POLICY', 'display_policy.lines must be an integer within [1, 6]');
    }
    if (value.wrap !== undefined && value.wrap !== 'multi' && value.wrap !== 'fold') {
        fail('INVALID_POLICY', 'display_policy.wrap must be multi or fold');
    }
    const breakHints = value.break_hints === undefined ? undefined : validateBreakHints(value.break_hints);
    return {
        mode: value.mode,
        algorithm: value.algorithm,
        unit_metric: value.unit_metric,
        max_line_units: value.max_line_units,
        minimum_fragment_duration_seconds: value.minimum_fragment_duration_seconds,
        locale: value.locale,
        ...(value.lines !== undefined ? { lines: value.lines } : {}),
        ...(value.wrap !== undefined ? { wrap: value.wrap } : {}),
        ...(breakHints ? { break_hints: breakHints } : {})
    };
}
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
    const lines = policy.lines ?? 1;
    const wrap = policy.wrap ?? 'multi';
    const splitPolicy = wrap === 'fold'
        ? { ...policy, max_line_units: policy.max_line_units * lines }
        : policy;
    if (options.extra_protected_terms !== undefined
        && (!Array.isArray(options.extra_protected_terms)
            || options.extra_protected_terms.some(entry => !strictText(entry)))) {
        fail('INVALID_POLICY', 'extra_protected_terms must contain only non-empty NFC trimmed strings');
    }
    const extraProtectedTerms = [...new Set(options.extra_protected_terms ?? [])];
    const policyProtectedTerms = policy.break_hints?.protected_terms ?? [];
    const incrementalProtectedTerms = extraProtectedTerms.filter(term => !policyProtectedTerms.includes(term));
    const policyWithExtraTerms = incrementalProtectedTerms.length === 0
        ? policy
        : {
            ...policy,
            break_hints: {
                ...policy.break_hints,
                protected_terms: [...policyProtectedTerms, ...incrementalProtectedTerms]
            }
        };
    if (!Array.isArray(captionsRoot.captions))
        fail('INVALID_CAPTIONS', 'captions.json object root must contain captions[]');
    const captions = captionsRoot.captions;
    const defaultStyle = Object.prototype.hasOwnProperty.call(captionsRoot, 'default_text_style')
        ? validateCaptionTextStyle(captionsRoot.default_text_style, 'default_text_style')
        : undefined;
    const cuts = Array.isArray(edit?.cuts) ? edit.cuts : [];
    const styleOutput = options.output ?? edit?.output;
    validateProjectionCuts(cuts, edit);
    const projectedCaptions = captions.map(caption => projectCaptionWords(caption, cuts));
    const captionIds = new Set();
    captions.forEach((caption, index) => {
        validateSourceCaption(caption, index);
        if (Object.prototype.hasOwnProperty.call(caption, 'text_style')) {
            validateCaptionTextStyle(caption.text_style, `captions[${index}].text_style`);
        }
        if (captionIds.has(caption.id))
            fail('DUPLICATE_CAPTION_ID', `captions[].id is duplicated: ${caption.id}`);
        captionIds.add(caption.id);
    });
    const wordStylesByCaption = resolveProjectedWordStyles(captions, projectedCaptions, captionsRoot.emphasis_words, styleOutput, policy.locale);
    validateEmphasisConflicts(captions, edit?.emphasis_words);
    const sourceCount = validateSourceReferences(captions, cuts, edit);
    const occurrences = dedupeCaptionOccurrences(projectOccurrences(captions, projectedCaptions, cuts, sourceCount), captionTrackOrder(cuts, edit));
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
    const wordBookFallbacks = [];
    const fragmentsByCaption = new Map();
    captions.forEach((caption, index) => {
        const projected = projectedCaptions[index];
        if (!projected.renderable)
            return;
        const text = projected.displayText;
        let fragments;
        let manual = false;
        let overflow;
        if (!projected.changed && caption.display_fragments !== undefined) {
            const manualResult = validateManualFragments(caption, text, policy);
            fragments = manualResult.fragments;
            overflow = manualResult.overflow;
            manual = true;
            boundaryProjection.push({ source_cue_id: caption.id, text, boundaries: [] });
        }
        else {
            let split = splitCaptionFragments(text, wrap === 'fold'
                ? { ...policyWithExtraTerms, max_line_units: policyWithExtraTerms.max_line_units * lines }
                : policyWithExtraTerms);
            if (split.overflow && incrementalProtectedTerms.length > 0) {
                const fallback = splitCaptionFragments(text, splitPolicy);
                if (!fallback.overflow) {
                    split = fallback;
                    wordBookFallbacks.push({
                        caption_id: caption.id,
                        dropped_terms: incrementalProtectedTerms.filter(term => text.includes(term))
                    });
                }
            }
            if (split.overflow)
                overflow = { ...split.overflow, units: policy.max_line_units };
            fragments = split.fragments;
            boundaryProjection.push({ source_cue_id: caption.id, text, boundaries: split.boundaries });
        }
        fragmentsByCaption.set(index, { fragments, manual, ...(overflow ? { overflow } : {}) });
    });
    const displayCues = [];
    const splitCueIds = new Set();
    for (const occurrence of occurrences) {
        const resolved = fragmentsByCaption.get(occurrence.caption_input_index);
        if (resolved.fragments.length > 1)
            splitCueIds.add(occurrence.source_cue_id);
        const resolvedStyle = mergeCaptionDisplayStyles(defaultStyle, occurrence.text_style);
        const styleResolution = resolvedStyle
            ? resolveCaptionStyleForOutput(resolvedStyle, styleOutput)
            : undefined;
        const scheduled = scheduleCaptionFragments(occurrence.start, occurrence.end, resolved.fragments, policy.minimum_fragment_duration_seconds);
        let scheduledCharacterOffset = 0;
        const scheduledWithOffsets = scheduled.map(fragment => {
            const charStart = scheduledCharacterOffset;
            scheduledCharacterOffset += fragment.text.length;
            return { ...fragment, charStart, charEnd: scheduledCharacterOffset };
        });
        const groups = wrap === 'fold'
            ? scheduledWithOffsets.map(fragment => ({
                start: fragment.start,
                end: fragment.end,
                lines: resolved.manual || resolved.overflow
                    ? [fragment.text]
                    : foldCaptionLines(fragment.text, policy.max_line_units, lines, policy.locale),
                charStart: fragment.charStart,
                charEnd: fragment.charEnd
            }))
            : Array.from({ length: Math.ceil(scheduledWithOffsets.length / lines) }, (_, groupIndex) => {
                const fragments = scheduledWithOffsets.slice(groupIndex * lines, (groupIndex + 1) * lines);
                return {
                    start: fragments[0].start,
                    end: fragments[fragments.length - 1].end,
                    lines: fragments.map(fragment => fragment.text),
                    charStart: fragments[0].charStart,
                    charEnd: fragments[fragments.length - 1].charEnd
                };
            });
        groups.forEach((group, index) => {
            const text = joinCaptionLines(group.lines, policy.locale);
            if (group.charEnd - group.charStart !== text.length) {
                fail('INVALID_WORD_PROJECTION', `caption ${occurrence.source_cue_id} fragment character range is inconsistent`);
            }
            const wordDisplay = buildCueWordDisplay(wordStylesByCaption.get(occurrence.caption_input_index), occurrence, group.charStart, group.charEnd, group.lines, text);
            const cueStyleVars = resolveCueStyleVars(styleResolution?.vars, wordDisplay?.wordStyles);
            displayCues.push({
                id: `${occurrence.source_cue_id}-occ-${String(occurrence.occurrence_index).padStart(4, '0')}-part-${index + 1}`,
                source_cue_id: occurrence.source_cue_id,
                src: occurrence.src,
                cut_index: occurrence.cut_index,
                occurrence_index: occurrence.occurrence_index,
                fragment_index: index + 1,
                fragment_count: groups.length,
                start: group.start,
                end: group.end,
                text,
                ...(group.lines.length >= 2 ? { display_lines: group.lines } : {}),
                units: measureCaptionUnits(text),
                line_override: resolved.manual,
                ...(resolved.overflow ? { overflow: resolved.overflow } : {}),
                ...(resolvedStyle ? { text_style: resolvedStyle } : {}),
                ...(cueStyleVars ? { style_vars: cueStyleVars } : {}),
                ...(styleResolution?.layout ? { layout: styleResolution.layout } : {}),
                ...(wordDisplay ? { words: wordDisplay.words, word_styles: wordDisplay.wordStyles } : {})
            });
        });
    }
    displayCues.sort(compareDisplayCue);
    // Spoken captions retain source-group overlap checks. Placed text may overlap freely.
    const groupByCaption = new Map(captions.map(caption => [caption.id,
        caption.time_domain === 'output' ? undefined : 'source:' + (caption.src ?? '')]));
    const previousByGroup = new Map();
    for (const cue of displayCues) {
        const group = groupByCaption.get(cue.source_cue_id);
        if (group === undefined)
            continue;
        const previous = previousByGroup.get(group);
        if (previous && previous.end - cue.start > 0.000001) {
            fail('OVERLAPPING_DISPLAY_CUES', `single_line_sequential display cues overlap: ${previous.id} and ${cue.id}`);
        }
        if (!previous || cue.end > previous.end)
            previousByGroup.set(group, cue);
    }
    return {
        schema: exports.CAPTION_DISPLAY_SCHEMA,
        policy,
        source_cue_count: captions.length,
        occurrence_count: occurrences.length,
        display_cue_count: displayCues.length,
        split_source_cue_count: splitCueIds.size,
        boundary_projection: boundaryProjection,
        display_cues: displayCues,
        word_book_fallbacks: wordBookFallbacks
    };
}
function resolveProjectedWordStyles(captions, projectedCaptions, emphasisValue, output, locale) {
    if (!Array.isArray(emphasisValue))
        return new Map();
    const emphasisWords = emphasisValue.filter(value => isRecord(value)
        && typeof value.style_preset === 'string' && value.style_preset.length > 0
        && finiteNonNegative(value.t_start) && finitePositive(value.t_end) && value.t_end > value.t_start
        && (value.src === undefined || strictText(value.src)));
    if (emphasisWords.length === 0)
        return new Map();
    const presetCache = new Map();
    const resolvePreset = (presetId) => {
        if (presetCache.has(presetId))
            return presetCache.get(presetId);
        const resolved = (0, caption_style_preset_1.resolveCaptionStylePreset)({ style_preset: presetId }, textstyle_catalog_1.TEXTSTYLE_CATALOG);
        const vars = resolved.resolved && isRecord(resolved.record.text_style)
            ? resolveCaptionWordStyleVars(resolved.record.text_style, output)
            : null;
        presetCache.set(presetId, vars);
        return vars;
    };
    const result = new Map();
    captions.forEach((caption, index) => {
        if (caption.time_domain === 'output')
            return;
        const projected = projectedCaptions[index];
        if (!Array.isArray(projected.words) || projected.words.length === 0)
            return;
        let entries = projected.words.map(word => ({ word, synthetic: false }));
        const visible = (items) => items.map(item => String(item.word.text).replace(/\s/gu, ''));
        if (visible(entries).join('') !== projected.displayText.replace(/\s/gu, '')
            && !projected.changed && Array.isArray(caption.words)) {
            // A legacy zero-duration word was filtered from projected.words. Borrow an
            // adjacent word's timing for its text, but never give it an emphasis preset.
            const rescued = caption.words.flatMap((value, wordIndex) => {
                if (projected.words.includes(value))
                    return [{ word: value, synthetic: false }];
                if (!isRecord(value) || typeof value.text !== 'string' || !value.text
                    || !finiteNonNegative(value.start) || !finiteNonNegative(value.end)
                    || value.start !== value.end)
                    return [];
                const later = caption.words.slice(wordIndex + 1).find(candidate => projected.words.includes(candidate));
                const earlier = caption.words.slice(0, wordIndex).reverse()
                    .find(candidate => projected.words.includes(candidate));
                const anchor = later ?? earlier ?? projected.words[0];
                return [{ word: { text: value.text, start: anchor.start, end: anchor.end }, synthetic: true }];
            });
            if (visible(rescued).join('') === projected.displayText.replace(/\s/gu, ''))
                entries = rescued;
        }
        const visibleWords = visible(entries);
        if (visibleWords.join('') !== projected.displayText.replace(/\s/gu, ''))
            return;
        // Assign whitespace from the display string to the following timed word.
        // The resulting texts and offsets reconstruct the cue exactly, including
        // leading spaces such as " Code", without changing source word timings.
        let displayCursor = 0;
        const alignedTexts = visibleWords.map(visible => {
            const start = displayCursor;
            let matched = '';
            while (displayCursor < projected.displayText.length && matched.length < visible.length) {
                const char = projected.displayText[displayCursor++];
                if (!/\s/u.test(char))
                    matched += char;
            }
            return projected.displayText.slice(start, displayCursor);
        });
        alignedTexts[alignedTexts.length - 1] += projected.displayText.slice(displayCursor);
        let offset = 0;
        const words = entries.map(({ word, synthetic }, wordIndex) => {
            const text = alignedTexts[wordIndex];
            let emphasis;
            let styleVars = null;
            for (const candidate of synthetic ? [] : emphasisWords) {
                const sourceMatches = !(strictText(candidate.src) && strictText(caption.src))
                    || candidate.src === caption.src;
                if (!sourceMatches
                    || Math.min(word.end, candidate.t_end) - Math.max(word.start, candidate.t_start) <= PROJECTION_EPSILON)
                    continue;
                const resolvedVars = resolvePreset(candidate.style_preset);
                if (!resolvedVars)
                    continue;
                emphasis = candidate;
                styleVars = resolvedVars;
                break;
            }
            const value = {
                start: word.start,
                end: word.end,
                text,
                offset,
                ...(emphasis && styleVars ? { preset_id: emphasis.style_preset, style_vars: styleVars } : {})
            };
            offset += text.length;
            return value;
        });
        expandProjectedWordStyles(words, projected.displayText, locale);
        entries.forEach((entry, wordIndex) => {
            if (entry.synthetic) {
                delete words[wordIndex].preset_id;
                delete words[wordIndex].style_vars;
            }
        });
        if (words.some(word => word.preset_id))
            result.set(index, words);
    });
    return result;
}
function expandProjectedWordStyles(words, displayText, locale) {
    try {
        const Segmenter = Intl.Segmenter;
        if (!Segmenter)
            return;
        const segments = new Segmenter(locale || 'ja', { granularity: 'word' }).segment(displayText);
        const finalized = new Set();
        for (const segment of segments) {
            if (segment.isWordLike === false)
                continue;
            const segmentEnd = segment.index + segment.segment.length;
            const overlapping = words.filter(word => Math.min(word.offset + word.text.length, segmentEnd)
                - Math.max(word.offset, segment.index) > 0);
            const winner = overlapping.find(word => word.preset_id && word.style_vars);
            if (!winner?.preset_id || !winner.style_vars)
                continue;
            for (const word of overlapping) {
                if (finalized.has(word))
                    continue;
                word.preset_id = winner.preset_id;
                word.style_vars = winner.style_vars;
            }
            overlapping.forEach(word => finalized.add(word));
        }
    }
    catch {
        // Intl.Segmenter が無い、または locale を扱えない環境では従来のトークン単位表示へ戻す。
    }
}
function resolveCueStyleVars(lineVars, wordStyles) {
    if (!wordStyles)
        return lineVars;
    const tokenSizes = wordStyles.flatMap(style => {
        const value = style.style_vars['--caption-tok-font-size'];
        const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)px$/u.exec(value) : null;
        return match ? [Number(match[1])] : [];
    });
    const maxTokenSize = tokenSizes.length > 0 ? Math.max(...tokenSizes) : 0;
    const baseMatch = /^(\d+(?:\.\d+)?)px$/u.exec(lineVars?.['--caption-font-size'] ?? '38px');
    const baseSize = baseMatch ? Number(baseMatch[1]) : 38;
    if (maxTokenSize <= baseSize)
        return lineVars;
    return { ...(lineVars ?? {}), '--caption-word-line-height': `${formatCssNumber(maxTokenSize)}px` };
}
function buildCueWordDisplay(sourceWords, occurrence, charStart, charEnd, lines, cueText) {
    if (!sourceWords)
        return undefined;
    const lineRanges = [];
    let lineOffset = charStart;
    lines.forEach((line, index) => {
        lineRanges.push({ start: lineOffset, end: lineOffset + line.length, line: index });
        lineOffset += line.length;
    });
    const styledWords = [];
    for (const word of sourceWords) {
        const wordEnd = word.offset + word.text.length;
        if (Math.min(wordEnd, charEnd) - Math.max(word.offset, charStart) <= 0)
            continue;
        for (const line of lineRanges) {
            const start = Math.max(word.offset, charStart, line.start);
            const end = Math.min(wordEnd, charEnd, line.end);
            if (end <= start)
                continue;
            const timeScale = occurrence.time_scale ?? 1;
            const timeOffset = occurrence.time_offset ?? 0;
            styledWords.push({
                start: roundOutputSecond(timeOffset + word.start * timeScale),
                end: roundOutputSecond(timeOffset + word.end * timeScale),
                text: word.text.slice(start - word.offset, end - word.offset),
                line: line.line,
                ...(word.preset_id ? { preset_id: word.preset_id, style_vars: word.style_vars } : {})
            });
        }
    }
    if (styledWords.map(word => word.text).join('') !== cueText) {
        fail('INVALID_WORD_PROJECTION', `caption ${occurrence.source_cue_id} words do not reconstruct display cue text`);
    }
    if (!styledWords.some(word => word.preset_id))
        return undefined;
    const wordStyles = [];
    styledWords.forEach((word, index) => {
        if (!word.preset_id || !word.style_vars)
            return;
        const previous = wordStyles[wordStyles.length - 1];
        if (previous?.preset_id === word.preset_id && previous.to === index)
            previous.to = index + 1;
        else
            wordStyles.push({
                from: index,
                to: index + 1,
                preset_id: word.preset_id,
                style_vars: word.style_vars
            });
    });
    return {
        words: styledWords.map(({ start, end, text, line }) => ({ start, end, text, line })),
        wordStyles
    };
}
function roundOutputSecond(value) {
    return Number(value.toFixed(6));
}
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
    if (Object.prototype.hasOwnProperty.call(value, 'reference_height_px')
        && !positiveInteger(value.reference_height_px)) {
        fail('INVALID_TEXT_STYLE', `${label}.reference_height_px must be an integer >= 1`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'font_weight')
        && (!Number.isInteger(value.font_weight) || value.font_weight < 1 || value.font_weight > 1000)) {
        fail('INVALID_TEXT_STYLE', `${label}.font_weight must be an integer within [1, 1000]`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'line_height') && !finitePositive(value.line_height)) {
        fail('INVALID_TEXT_STYLE', `${label}.line_height must be a positive finite number`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'scale')
        && (!finiteNumber(value.scale) || value.scale < 0.4 || value.scale > 3)) {
        fail('INVALID_TEXT_STYLE', `${label}.scale must be a finite number within [0.4, 3]`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'rotate')
        && (!finiteNumber(value.rotate) || value.rotate < -180 || value.rotate > 180)) {
        fail('INVALID_TEXT_STYLE', `${label}.rotate must be a finite number within [-180, 180]`);
    }
    validateTextStyleV0(value, label);
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
    if (Object.prototype.hasOwnProperty.call(value, 'layout')
        && Object.prototype.hasOwnProperty.call(value, 'reference_height_px')) {
        fail('STYLE_LAYOUT_CONFLICT', `${label} cannot contain both layout and reference_height_px`);
    }
    return value;
}
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
    // textstyle v0 の座布団拡張。padding_px は文字box からの一律余白、width_pct / height_pct は
    // 文字box比での拡張（どちらかを指定すると padding_px より優先される）、offset_* は座布団だけの平行移動。
    for (const key of ['padding_px', 'width_pct', 'height_pct']) {
        if (Object.prototype.hasOwnProperty.call(value, key) && !finiteNonNegative(value[key])) {
            fail('INVALID_TEXT_STYLE', `${label}.${key} must be a non-negative finite number`);
        }
    }
    for (const key of ['offset_x', 'offset_y']) {
        if (Object.prototype.hasOwnProperty.call(value, key) && !finiteNumber(value[key])) {
            fail('INVALID_TEXT_STYLE', `${label}.${key} must be a finite number`);
        }
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
/**
 * textstyle v0（2026-08-03）のフィールド検証。受理条件は render-cut の
 * normalizeTextStyle と 1 対 1 に対応させてある — 契約が受理して消費側が黙って捨てる
 * （あるいはその逆）状態を作らないため。
 */
function validateTextStyleV0(value, label) {
    const has = (key) => Object.prototype.hasOwnProperty.call(value, key);
    const failIf = (condition, message) => {
        if (condition)
            fail('INVALID_TEXT_STYLE', `${label}.${message}`);
    };
    failIf(has('font_family') && (typeof value.font_family !== 'string' || value.font_family === ''), 'font_family must be a non-empty string');
    failIf(has('weight')
        && (!Number.isInteger(value.weight) || value.weight < 100 || value.weight > 900), 'weight must be an integer within [100, 900]');
    failIf(has('italic') && typeof value.italic !== 'boolean', 'italic must be a boolean');
    failIf(has('underline') && typeof value.underline !== 'boolean', 'underline must be a boolean');
    failIf(has('letter_spacing_em') && !finiteNumber(value.letter_spacing_em), 'letter_spacing_em must be a finite number');
    failIf(has('align') && !CAPTION_ALIGN_VALUES.has(value.align), 'align must be one of left, center, right');
    failIf(has('vertical_align') && !CAPTION_VERTICAL_ALIGN_VALUES.has(value.vertical_align), 'vertical_align must be one of top, middle, bottom');
    failIf(has('vertical') && typeof value.vertical !== 'boolean', 'vertical must be a boolean');
    failIf(has('text_transform') && !CAPTION_TEXT_TRANSFORM_VALUES.has(value.text_transform), 'text_transform must be one of upper, uppercase, lower, lowercase, title, capitalize, none');
    failIf(has('max_width_pct')
        && (!finiteNumber(value.max_width_pct)
            || value.max_width_pct <= 0 || value.max_width_pct >= 100), 'max_width_pct must be a finite number within (0, 100)');
    failIf(has('max_characters') && !positiveInteger(value.max_characters), 'max_characters must be an integer greater than zero');
    failIf(has('text_anchor') && !CAPTION_TEXT_ANCHOR_VALUES.has(value.text_anchor), 'text_anchor must be one of the nine anchor codes');
    if (has('position')) {
        if (!isRecord(value.position))
            fail('INVALID_TEXT_STYLE', `${label}.position must be an object`);
        rejectStyleUnknown(value.position, CAPTION_POSITION_KEYS, `${label}.position`);
        for (const axis of ['x', 'y']) {
            if (Object.prototype.hasOwnProperty.call(value.position, axis)
                && !finiteNumber(value.position[axis])) {
                fail('INVALID_TEXT_STYLE', `${label}.position.${axis} must be a finite number`);
            }
        }
    }
    if (has('shadow'))
        validateShadowLike(value.shadow, CAPTION_SHADOW_KEYS, `${label}.shadow`);
    if (has('glow'))
        validateShadowLike(value.glow, CAPTION_GLOW_KEYS, `${label}.glow`);
    if (has('animation')) {
        if (!isRecord(value.animation))
            fail('INVALID_TEXT_STYLE', `${label}.animation must be an object`);
        rejectStyleUnknown(value.animation, CAPTION_ANIMATION_SLOTS, `${label}.animation`);
        for (const slot of CAPTION_ANIMATION_SLOTS) {
            if (!Object.prototype.hasOwnProperty.call(value.animation, slot))
                continue;
            const entry = value.animation[slot];
            const slotLabel = `${label}.animation.${slot}`;
            if (!isRecord(entry))
                fail('INVALID_TEXT_STYLE', `${slotLabel} must be an object`);
            rejectStyleUnknown(entry, CAPTION_ANIMATION_SLOT_KEYS, slotLabel);
            if (typeof entry.id !== 'string' || entry.id === '') {
                fail('INVALID_TEXT_STYLE', `${slotLabel}.id must be a non-empty string`);
            }
            if (Object.prototype.hasOwnProperty.call(entry, 'duration_sec') && !finitePositive(entry.duration_sec)) {
                fail('INVALID_TEXT_STYLE', `${slotLabel}.duration_sec must be a positive finite number`);
            }
            if (Object.prototype.hasOwnProperty.call(entry, 'ease')
                && (typeof entry.ease !== 'string' || entry.ease === '')) {
                fail('INVALID_TEXT_STYLE', `${slotLabel}.ease must be a non-empty string`);
            }
            if (Object.prototype.hasOwnProperty.call(entry, 'amp') && !finitePositive(entry.amp)) {
                fail('INVALID_TEXT_STYLE', `${slotLabel}.amp must be a positive finite number`);
            }
        }
    }
}
// shadow / glow は「color 必須 + 残りは数値」という同じ形なので 1 本にまとめる。
// color を任意にすると消費側が影を組めず無言で落ちるため、両者とも必須で揃えてある。
function validateShadowLike(value, allowed, label) {
    if (!isRecord(value))
        fail('INVALID_TEXT_STYLE', `${label} must be an object`);
    rejectStyleUnknown(value, allowed, label);
    if (!Object.prototype.hasOwnProperty.call(value, 'color')) {
        fail('INVALID_TEXT_STYLE', `${label}.color is required`);
    }
    validateHexColor(value.color, `${label}.color`);
    for (const key of allowed) {
        if (key === 'color' || !Object.prototype.hasOwnProperty.call(value, key))
            continue;
        if (!finiteNumber(value[key]))
            fail('INVALID_TEXT_STYLE', `${label}.${key} must be a finite number`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'opacity')
        && (value.opacity < 0 || value.opacity > 1)) {
        fail('INVALID_TEXT_STYLE', `${label}.opacity must be within [0, 1]`);
    }
    for (const key of ['blur_px', 'distance_px', 'density', 'spread']) {
        if (Object.prototype.hasOwnProperty.call(value, key) && value[key] < 0) {
            fail('INVALID_TEXT_STYLE', `${label}.${key} must be non-negative`);
        }
    }
}
function validateSourceReferences(captions, cuts, edit) {
    // 単一 source 宣言を持つ旧入力は素材表を持たない。正規化後の v1/v2 はどちらも
    // sources[] を持つため、版番号ではなく入力の性質だけで同じ参照検証を行う。
    if (!Object.prototype.hasOwnProperty.call(edit, 'sources'))
        return 1;
    if (!Array.isArray(edit.sources) || edit.sources.length === 0) {
        fail('INVALID_SOURCES', 'edit.json requires a non-empty sources[] array');
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
        if (edit.sources.length > 1 && caption.time_domain !== 'output' && caption.src === undefined) {
            fail('MISSING_SOURCE', `captions[${index}].src is required for a multi-source edit`);
        }
        if (caption.src !== undefined && !sourceIds.has(caption.src)) {
            fail('UNKNOWN_SOURCE', `captions[${index}].src does not reference edit.json sources[].id`);
        }
    });
    return edit.sources.length;
}
function validateProjectionCuts(cuts, edit) {
    cuts.forEach((cut, index) => {
        if (!isRecord(cut) || !finiteNonNegative(cut.in) || !finitePositive(cut.out) || cut.out <= cut.in) {
            fail('INVALID_CUT', `edit.json cuts[${index}] must satisfy 0 <= in < out`);
        }
        if ((cut.at !== undefined && !finiteNonNegative(cut.at))
            || (cut.track !== undefined && (!Number.isInteger(cut.track) || cut.track < 0))) {
            fail('INVALID_CUT', `edit.json cuts[${index}].at/track must be non-negative timeline coordinates`);
        }
        if (Object.prototype.hasOwnProperty.call(cut, 'transition_out')
            || Object.prototype.hasOwnProperty.call(cut, 'transitionOut')) {
            fail('UNSUPPORTED_TIMELINE', `display_policy does not support cuts[${index}].transition_out`);
        }
        if (cut.speed !== undefined && !finitePositive(cut.speed))
            fail('INVALID_CUT', `edit.json cuts[${index}].speed must be positive`);
    });
}
/**
 * `captions.json` は変更せず、keep cut から外れた語だけを描画用の本文と words から除く。
 * どれかの cut と一部でも交差する語は残す（語の途中で切った場合に欠落させない）。
 */
function projectCaptionWords(caption, cuts) {
    const displayText = typeof caption?.display_text === 'string' ? caption.display_text : caption?.text;
    const words = Array.isArray(caption?.words) ? caption.words.filter(isProjectionWord) : undefined;
    if (typeof displayText !== 'string' || !words || words.length === 0
        || caption.time_domain === 'output' || cuts.length === 0) {
        return {
            displayText: typeof displayText === 'string' ? displayText : '',
            words,
            changed: false,
            renderable: typeof displayText === 'string' && displayText.trim().length > 0
        };
    }
    const captionSource = strictText(caption.src) ? caption.src : null;
    const visible = words.map(word => cuts.some(cut => {
        if (!isRecord(cut) || cut.captions === 'off')
            return false;
        if (captionSource !== null && cut.src !== captionSource)
            return false;
        return finiteNonNegative(cut.in) && finitePositive(cut.out)
            && word.end - cut.in > PROJECTION_EPSILON
            && cut.out - word.start > PROJECTION_EPSILON;
    }));
    if (visible.every(Boolean)) {
        return { displayText, words, changed: false, renderable: displayText.trim().length > 0 };
    }
    const keptWords = words.filter((_word, index) => visible[index]);
    const projectedText = removeHiddenWords(displayText, words, visible);
    return {
        displayText: projectedText,
        words: keptWords,
        changed: true,
        renderable: projectedText.trim().length > 0 && keptWords.length > 0
    };
}
function isProjectionWord(value) {
    return isRecord(value) && typeof value.text === 'string' && value.text.length > 0
        && finiteNonNegative(value.start) && finiteNonNegative(value.end) && value.end > value.start;
}
function removeHiddenWords(text, words, visible) {
    let cursor = 0;
    let output = '';
    for (let index = 0; index < words.length; index++) {
        const wordText = String(words[index].text);
        const offset = text.indexOf(wordText, cursor);
        if (offset < 0) {
            return words.filter((_word, wordIndex) => visible[wordIndex]).map(word => String(word.text)).join('');
        }
        if (visible[index])
            output += text.slice(cursor, offset + wordText.length);
        cursor = offset + wordText.length;
    }
    if (visible[visible.length - 1])
        output += text.slice(cursor);
    return output.trim();
}
/**
 * 同じ source cue が同じ出力区間へ複数回射影された場合、下→上の trackOrder で
 * 最後に描かれる occurrence だけを残す。部分重複は境界で分割する。
 */
function dedupeCaptionOccurrences(occurrences, trackOrder) {
    const inputOrder = new Map(occurrences.map((occurrence, index) => [occurrence, index]));
    const trackRank = new Map();
    trackOrder.forEach((track, index) => trackRank.set(track, index));
    const rankOf = (occurrence) => trackRank.get(occurrence.track) ?? occurrence.track;
    const byCue = new Map();
    for (const occurrence of occurrences) {
        const values = byCue.get(occurrence.source_cue_id) ?? [];
        values.push(occurrence);
        byCue.set(occurrence.source_cue_id, values);
    }
    const output = [];
    for (const values of byCue.values()) {
        const boundaries = [...new Set(values.flatMap(value => [value.start, value.end]))]
            .sort((left, right) => left - right);
        const pieces = [];
        for (let index = 0; index + 1 < boundaries.length; index++) {
            const start = boundaries[index];
            const end = boundaries[index + 1];
            if (end - start <= PROJECTION_EPSILON)
                continue;
            const midpoint = (start + end) / 2;
            const active = values.filter(value => value.start <= midpoint && value.end > midpoint);
            if (active.length === 0)
                continue;
            const winner = active.reduce((current, candidate) => {
                const rankDifference = rankOf(candidate) - rankOf(current);
                if (rankDifference !== 0)
                    return rankDifference > 0 ? candidate : current;
                return (inputOrder.get(candidate) ?? 0) > (inputOrder.get(current) ?? 0) ? candidate : current;
            });
            const last = pieces[pieces.length - 1];
            if (last?.winner === winner && Math.abs(last.end - start) <= PROJECTION_EPSILON)
                last.end = end;
            else
                pieces.push({ winner, start, end });
        }
        for (const piece of pieces) {
            const whole = piece.winner;
            if (Math.abs(piece.start - whole.start) <= PROJECTION_EPSILON
                && Math.abs(piece.end - whole.end) <= PROJECTION_EPSILON) {
                output.push(whole);
                continue;
            }
            const duration = whole.end - whole.start;
            const clipped = { ...whole, start: piece.start, end: piece.end };
            if (duration > 0 && finiteNumber(whole.source_start) && finiteNumber(whole.source_end)) {
                const sourceDuration = whole.source_end - whole.source_start;
                clipped.source_start = whole.source_start + sourceDuration * ((piece.start - whole.start) / duration);
                clipped.source_end = whole.source_start + sourceDuration * ((piece.end - whole.start) / duration);
            }
            output.push(clipped);
        }
    }
    return output.sort((left, right) => left.start - right.start
        || (inputOrder.get(left) ?? inputOrder.get(left) ?? 0) - (inputOrder.get(right) ?? 0));
}
function captionTrackOrder(cuts, edit) {
    const declared = Array.isArray(edit?.timeline?.tracks)
        ? edit.timeline.tracks
            .filter((track) => track?.kind === 'cuts' && Number.isInteger(track.ref) && track.ref >= 0)
            .map((track) => track.ref)
        : [];
    const fallback = cuts.map(cut => Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0)
        .sort((left, right) => left - right);
    return [...new Set(declared.length > 0 ? declared : fallback)];
}
function projectOccurrences(captions, projectedCaptions, cuts, sourceCount) {
    const occurrences = [];
    const cursors = new Map();
    const segments = cuts.map((cut, cutIndex) => {
        const speed = finitePositive(cut.speed) ? cut.speed : 1;
        const duration = (cut.out - cut.in) / speed;
        const track = Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0;
        const cursor = cursors.get(track) ?? 0;
        const start = finiteNonNegative(cut.at) ? cut.at : cursor;
        const segment = { cut, cutIndex, speed, track, start, end: start + duration };
        cursors.set(track, segment.end);
        return segment;
    });
    const timelineEnd = segments.reduce((maximum, segment) => Math.max(maximum, segment.end), 0);
    captions.forEach((caption, captionInputIndex) => {
        if (!isRecord(caption) || caption.time_domain !== 'output')
            return;
        const projected = projectedCaptions[captionInputIndex];
        if (!projected.renderable)
            return;
        const clampedEnd = Math.min(caption.end, timelineEnd);
        if (!(clampedEnd > caption.start))
            return;
        occurrences.push({
            source_cue_id: caption.id,
            src: strictText(caption.src) ? caption.src : null,
            cut_index: -1,
            caption_input_index: captionInputIndex,
            source_start: caption.start,
            source_end: clampedEnd,
            start: caption.start,
            end: clampedEnd,
            track: 0,
            text: projected.displayText,
            display_fragments: projected.changed ? undefined : caption.display_fragments,
            text_style: caption.text_style,
            time_offset: 0,
            time_scale: 1
        });
    });
    if (cuts.length === 0) {
        captions.forEach((caption, captionInputIndex) => {
            if (caption?.time_domain === 'output')
                return;
            const projected = projectedCaptions[captionInputIndex];
            const text = projected.displayText;
            if (isRecord(caption) && finiteNonNegative(caption.start) && finitePositive(caption.end) && caption.end > caption.start && typeof text === 'string') {
                if (!projected.renderable)
                    return;
                occurrences.push({
                    source_cue_id: caption.id,
                    src: typeof caption.src === 'string' ? caption.src : null,
                    cut_index: 0,
                    caption_input_index: captionInputIndex,
                    source_start: caption.start,
                    source_end: caption.end,
                    start: caption.start,
                    end: caption.end,
                    track: 0,
                    text,
                    display_fragments: projected.changed ? undefined : caption.display_fragments,
                    text_style: caption.text_style,
                    time_offset: 0,
                    time_scale: 1
                });
            }
        });
        return occurrences;
    }
    captions.forEach((caption, captionInputIndex) => {
        if (!isRecord(caption))
            return;
        if (caption.time_domain === 'output')
            return;
        const projected = projectedCaptions[captionInputIndex];
        if (!projected.renderable)
            return;
        const captionSource = strictText(caption.src) ? caption.src : null;
        if (sourceCount > 1 && captionSource === null) {
            fail('MISSING_SOURCE', `captions[${captionInputIndex}].src is required for a multi-source edit`);
        }
        for (const segment of segments) {
            if (segment.cut.captions === 'off')
                continue;
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
                track: segment.track,
                text: projected.displayText,
                display_fragments: projected.changed ? undefined : caption.display_fragments,
                text_style: caption.text_style,
                time_offset: segment.start - segment.cut.in / segment.speed,
                time_scale: 1 / segment.speed
            });
        }
    });
    return occurrences;
}
function validateSourceCaption(caption, index) {
    if (!isRecord(caption) || !strictText(caption.id))
        fail('INVALID_CAPTION', `captions[${index}].id must be a non-empty string`);
    if (!finiteNonNegative(caption.start) || !finitePositive(caption.end) || caption.end <= caption.start) {
        fail('INVALID_CAPTION', `captions[${index}] must satisfy 0 <= start < end`);
    }
    if (caption.src !== undefined && !strictText(caption.src)) {
        fail('INVALID_CAPTION', `captions[${index}].src must be a non-empty NFC trimmed string when present`);
    }
    if (caption.time_domain !== undefined
        && caption.time_domain !== 'source' && caption.time_domain !== 'output') {
        fail('INVALID_CAPTION', `captions[${index}].time_domain must be source or output when present`);
    }
    const sourceText = caption.display_text ?? caption.text;
    if (!strictText(sourceText))
        fail('INVALID_TEXT', `captions[${index}] display text must be non-empty, NFC, and trimmed`);
    if (caption.style !== undefined) {
        if (CAPTION_WORD_STYLES.has(caption.style)) {
            fail('STYLE_CONFLICT', `captions[${index}].style cannot be combined with display_policy`);
        }
        fail('INVALID_CAPTION', `captions[${index}].style ${JSON.stringify(caption.style)} is not a known caption style `
            + `(expected one of: ${[...CAPTION_WORD_STYLES].join(', ')})`);
    }
}
function validateEmphasisConflicts(captions, emphasisValue) {
    if (!Array.isArray(emphasisValue))
        return;
    captions.forEach((caption, index) => {
        if (caption.time_domain === 'output')
            return;
        const conflict = emphasisValue.some(value => isRecord(value)
            && (!strictText(value.src) || !strictText(caption.src) || value.src === caption.src)
            && finiteNonNegative(value.t_start) && finitePositive(value.t_end)
            && value.t_end > caption.start && value.t_start < caption.end);
        if (conflict)
            fail('EMPHASIS_CONFLICT', `edit.emphasis_words cannot act on captions[${index}] under display_policy`);
    });
}
function validateManualFragments(caption, text, policy) {
    const overflow = () => ({
        fragments: [text],
        overflow: { code: 'INVALID_MANUAL_FRAGMENTS', units: policy.max_line_units }
    });
    if (!Array.isArray(caption.display_fragments) || caption.display_fragments.length < 1 || caption.display_fragments.length > 6) {
        return overflow();
    }
    if (caption.display_fragments.some((fragment) => !strictText(fragment))) {
        return overflow();
    }
    if (caption.display_fragments.join('') !== text) {
        return overflow();
    }
    for (const fragment of caption.display_fragments) {
        if (measureCaptionUnits(fragment) > policy.max_line_units) {
            return overflow();
        }
    }
    return { fragments: [...caption.display_fragments] };
}
function splitCaptionFragments(text, policy) {
    if (measureCaptionUnits(text) <= policy.max_line_units)
        return { fragments: [text], boundaries: [] };
    const Segmenter = Intl.Segmenter;
    if (typeof Segmenter !== 'function') {
        return {
            fragments: [text],
            boundaries: [],
            overflow: { code: 'NO_WORD_BOUNDARY_SPLIT', units: policy.max_line_units }
        };
    }
    const segmenter = new Segmenter(policy.locale, { granularity: 'word' });
    const segments = [...segmenter.segment(text)];
    const wordSpans = segments.map(segment => ({
        start: segment.index,
        end: segment.index + segment.segment.length,
        wordLike: segment.isWordLike === true
    }));
    const boundaries = segments
        .map(segment => segment.index)
        .filter(index => index > 0 && index < text.length);
    const candidates = [];
    let blockedFittingBoundary = false;
    for (const boundary of boundaries) {
        const first = text.slice(0, boundary);
        const second = text.slice(boundary);
        const firstUnits = measureCaptionUnits(first);
        const secondUnits = measureCaptionUnits(second);
        if (firstUnits > policy.max_line_units || secondUnits > policy.max_line_units)
            continue;
        if (splitsProtectedTerm(text, boundary, policy.break_hints?.protected_terms ?? []))
            continue;
        if (captionBreakBoundaryBlocked(text, boundary, wordSpans)) {
            blockedFittingBoundary = true;
            continue;
        }
        candidates.push({
            fragments: [first, second],
            score: captionBreakScore(first, second, firstUnits, secondUnits, policy.break_hints),
            boundary
        });
    }
    if (candidates.length === 0) {
        if (blockedFittingBoundary) {
            const fallbackBoundary = Array.from({ length: text.length - 1 }, (_value, index) => index + 1)
                .filter(boundary => !captionBreakBoundaryBlocked(text, boundary, wordSpans)
                && !splitsProtectedTerm(text, boundary, policy.break_hints?.protected_terms ?? [])
                && measureCaptionUnits(text.slice(0, boundary)) <= policy.max_line_units
                && measureCaptionUnits(text.slice(boundary)) <= policy.max_line_units)
                .sort((left, right) => Math.abs(left - text.length / 2) - Math.abs(right - text.length / 2)
                || left - right)[0];
            if (fallbackBoundary !== undefined) {
                return {
                    fragments: [text.slice(0, fallbackBoundary), text.slice(fallbackBoundary)],
                    boundaries
                };
            }
        }
        const fragments = splitCaptionFragmentsAtBoundaries(text, boundaries, wordSpans, policy, 6);
        if (fragments)
            return { fragments, boundaries };
        return {
            fragments: [text],
            boundaries,
            overflow: { code: 'NO_WORD_BOUNDARY_SPLIT', units: policy.max_line_units }
        };
    }
    candidates.sort((left, right) => right.score - left.score || left.boundary - right.boundary);
    return { fragments: candidates[0].fragments, boundaries };
}
function splitCaptionFragmentsAtBoundaries(text, boundaries, wordSpans, policy, maximumFragments) {
    const ends = [...boundaries, text.length];
    const visit = (start, remaining) => {
        if (start === text.length)
            return [];
        if (remaining === 0)
            return undefined;
        const candidates = ends.filter(end => end > start
            && measureCaptionUnits(text.slice(start, end)) <= policy.max_line_units
            && (end === text.length || !captionBreakBoundaryBlocked(text, end, wordSpans))
            && !splitsProtectedTerm(text, end, policy.break_hints?.protected_terms ?? [])).reverse();
        for (const end of candidates) {
            const rest = visit(end, remaining - 1);
            if (rest)
                return [text.slice(start, end), ...rest];
        }
        return undefined;
    };
    for (let count = 3; count <= maximumFragments; count++) {
        const fragments = visit(0, count);
        if (fragments && fragments.length <= count)
            return fragments;
    }
    return undefined;
}
function foldCaptionLines(text, maxLineUnits, lines, locale = 'ja') {
    if (!finitePositive(maxLineUnits) || !Number.isInteger(lines) || lines < 1) {
        fail('INVALID_POLICY', 'foldCaptionLines requires positive maxLineUnits and lines >= 1');
    }
    if (lines === 1 || measureCaptionUnits(text) <= maxLineUnits)
        return [text];
    const Segmenter = Intl.Segmenter;
    const segments = typeof Segmenter === 'function'
        ? [...new Segmenter(locale, { granularity: 'word' }).segment(text)].map(segment => segment.segment)
        : Array.from(text);
    const tokens = segments.flatMap(segment => splitCaptionUnitChunks(segment, maxLineUnits));
    const result = [];
    let current = '';
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (current === '' || measureCaptionUnits(current + token) <= maxLineUnits) {
            current += token;
            continue;
        }
        result.push(current);
        if (result.length === lines - 1) {
            current = tokens.slice(index).join('');
            break;
        }
        current = token;
    }
    if (current !== '')
        result.push(current);
    return result;
}
function splitCaptionUnitChunks(text, maxLineUnits) {
    if (measureCaptionUnits(text) <= maxLineUnits)
        return [text];
    const chunks = [];
    let current = '';
    for (const character of Array.from(text)) {
        if (current !== '' && measureCaptionUnits(current + character) > maxLineUnits) {
            chunks.push(current);
            current = '';
        }
        current += character;
    }
    if (current !== '')
        chunks.push(current);
    return chunks;
}
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
    // .at() は ES2022。tsconfig の lib は ES2021 なので slice で等価に書く
    // （クリーンな checkout で tsc -b が落ち、preview-server の pretest ごと止まっていた。
    //  既存ツリーでは .tsbuildinfo に隠れて再現しなかった）
    if (/[（「『【]/u.test(first.slice(-1)))
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
    if (merged.reference_height_px !== undefined && merged.layout !== undefined) {
        fail('STYLE_LAYOUT_CONFLICT', 'merged caption text style cannot contain both layout and reference_height_px');
    }
    return merged;
}
function normalizeCaptionAnimationSlot(value) {
    if (!isRecord(value) || typeof value.id !== 'string' || value.id === '')
        return undefined;
    return {
        id: value.id,
        ...(finitePositive(value.duration_sec) ? { duration_sec: value.duration_sec } : {}),
        ...(typeof value.ease === 'string' && value.ease !== '' ? { ease: value.ease } : {}),
        ...(finitePositive(value.amp) ? { amp: value.amp } : {})
    };
}
function normalizeCaptionLineTextStyle(value) {
    if (!isRecord(value))
        return {};
    const animationIn = normalizeCaptionAnimationSlot(value.animation?.in);
    const animationLoop = normalizeCaptionAnimationSlot(value.animation?.loop);
    const animationOut = normalizeCaptionAnimationSlot(value.animation?.out);
    return {
        ...(typeof value.color === 'string' ? { color: value.color } : {}),
        ...(finiteNumber(value.size_px) ? { size_px: value.size_px } : {}),
        ...(finiteNumber(value.scale) && value.scale >= 0.4 && value.scale <= 3 ? { scale: value.scale } : {}),
        ...(finiteNumber(value.rotate) && value.rotate >= -180 && value.rotate <= 180 ? { rotate: value.rotate } : {}),
        ...(positiveInteger(value.reference_height_px) ? { reference_height_px: value.reference_height_px } : {}),
        ...(typeof value.font_family === 'string' && value.font_family !== '' ? { font_family: value.font_family } : {}),
        ...(finiteNumber(value.weight) && value.weight >= 100 && value.weight <= 900
            ? { weight: value.weight }
            : Number.isInteger(value.font_weight) && value.font_weight >= 1 && value.font_weight <= 1000
                ? { weight: value.font_weight } : {}),
        ...(value.italic === true ? { italic: true } : {}),
        ...(value.underline === true ? { underline: true } : {}),
        ...(finiteNumber(value.letter_spacing_em) ? { letter_spacing_em: value.letter_spacing_em } : {}),
        ...(finitePositive(value.line_height) ? { line_height: value.line_height } : {}),
        ...(CAPTION_ALIGN_VALUES.has(value.align) ? { align: value.align } : {}),
        ...(CAPTION_VERTICAL_ALIGN_VALUES.has(value.vertical_align) ? { vertical_align: value.vertical_align } : {}),
        ...(value.vertical === true ? { vertical: true } : {}),
        ...(CAPTION_TEXT_TRANSFORM_MAP[value.text_transform]
            ? { text_transform: CAPTION_TEXT_TRANSFORM_MAP[value.text_transform] } : {}),
        ...(finiteNumber(value.max_width_pct) && value.max_width_pct > 0 && value.max_width_pct < 100
            ? { max_width_pct: value.max_width_pct } : {}),
        ...(positiveInteger(value.max_characters) ? { max_characters: value.max_characters } : {}),
        ...(CAPTION_TEXT_ANCHOR_VALUES.has(value.text_anchor) ? { text_anchor: value.text_anchor } : {}),
        ...(isRecord(value.position) && (finiteNumber(value.position.x) || finiteNumber(value.position.y))
            ? { position: {
                    ...(finiteNumber(value.position.x) ? { x: value.position.x } : {}),
                    ...(finiteNumber(value.position.y) ? { y: value.position.y } : {})
                } } : {}),
        ...(isRecord(value.shadow) && typeof value.shadow.color === 'string'
            ? { shadow: {
                    color: value.shadow.color,
                    ...(finiteNumber(value.shadow.opacity) ? { opacity: value.shadow.opacity } : {}),
                    ...(finiteNumber(value.shadow.blur_px) ? { blur_px: value.shadow.blur_px } : {}),
                    ...(finiteNumber(value.shadow.distance_px) ? { distance_px: value.shadow.distance_px } : {}),
                    ...(finiteNumber(value.shadow.angle_deg) ? { angle_deg: value.shadow.angle_deg } : {})
                } } : {}),
        ...(isRecord(value.glow) && typeof value.glow.color === 'string'
            ? { glow: {
                    color: value.glow.color,
                    ...(finiteNumber(value.glow.density) ? { density: value.glow.density } : {}),
                    ...(finiteNumber(value.glow.spread) ? { spread: value.glow.spread } : {}),
                    ...(finiteNumber(value.glow.offset_x) ? { offset_x: value.glow.offset_x } : {}),
                    ...(finiteNumber(value.glow.offset_y) ? { offset_y: value.glow.offset_y } : {})
                } } : {}),
        ...(animationIn || animationLoop || animationOut ? { animation: {
                ...(animationIn ? { in: animationIn } : {}),
                ...(animationLoop ? { loop: animationLoop } : {}),
                ...(animationOut ? { out: animationOut } : {})
            } } : {}),
        ...(isRecord(value.stroke) ? { stroke: {
                ...(typeof value.stroke.color === 'string' ? { color: value.stroke.color } : {}),
                ...(finiteNumber(value.stroke.width_px) ? { width_px: value.stroke.width_px } : {})
            } } : {}),
        ...(isRecord(value.background) ? { background: {
                ...(typeof value.background.color === 'string' ? { color: value.background.color } : {}),
                ...(finiteNumber(value.background.opacity) ? { opacity: value.background.opacity } : {}),
                ...(finiteNumber(value.background.radius_px) ? { radius_px: value.background.radius_px } : {}),
                ...(finiteNumber(value.background.padding_px) ? { padding_px: value.background.padding_px } : {}),
                ...(finiteNumber(value.background.height_pct) ? { height_pct: value.background.height_pct } : {}),
                ...(finiteNumber(value.background.width_pct) ? { width_pct: value.background.width_pct } : {}),
                ...(finiteNumber(value.background.offset_x) ? { offset_x: value.background.offset_x } : {}),
                ...(finiteNumber(value.background.offset_y) ? { offset_y: value.background.offset_y } : {}),
                ...(value.background.mode === 'per-line' || value.background.mode === 'block'
                    ? { mode: value.background.mode } : {})
            } } : {}),
        ...(typeof value.zone === 'string' ? { zone: value.zone } : {})
    };
}
/** Merge the snake_case captions.json line style vocabulary used by every renderer. */
function mergeCaptionLineTextStyles(base, override) {
    const left = normalizeCaptionLineTextStyle(base);
    const right = normalizeCaptionLineTextStyle(override);
    const merged = { ...left, ...right };
    for (const key of ['stroke', 'background', 'shadow', 'glow', 'position', 'animation']) {
        if (isRecord(left[key]) || isRecord(right[key])) {
            merged[key] = { ...(isRecord(left[key]) ? left[key] : {}), ...(isRecord(right[key]) ? right[key] : {}) };
            if (Object.keys(merged[key]).length === 0)
                delete merged[key];
        }
    }
    return Object.keys(merged).length > 0 ? merged : null;
}
function usesPercentageBackground(background) {
    return isRecord(background) && ((finiteNumber(background.width_pct) && background.width_pct > 0)
        || (finiteNumber(background.height_pct) && background.height_pct > 0));
}
function usesExtendedPerLineBackground(background) {
    if (!isRecord(background) || background.mode === 'block')
        return false;
    return usesPercentageBackground(background)
        || (finiteNumber(background.offset_x) && background.offset_x !== 0)
        || (finiteNumber(background.offset_y) && background.offset_y !== 0);
}
function captionZoneVars(zone) {
    if (typeof zone !== 'string' || zone === '' || zone === 'bottom')
        return {};
    const [vertical, horizontal] = zone.includes('-')
        ? zone.split('-')
        : zone === 'top' || zone === 'center' ? [zone, 'center'] : ['center', zone];
    return {
        '--caption-top': vertical === 'top' ? '7%' : vertical === 'center' ? '0' : 'auto',
        '--caption-bottom': vertical === 'bottom' ? '7%' : vertical === 'center' ? '0' : 'auto',
        '--caption-left': '4%',
        '--caption-right': '4%',
        '--caption-justify-content': vertical === 'center' ? 'center' : 'flex-start',
        '--caption-align-items': horizontal === 'left' ? 'flex-start' : horizontal === 'right' ? 'flex-end' : 'center',
        '--caption-line-margin': '0',
        '--caption-line-max-width': '100%',
        '--caption-text-align': horizontal
    };
}
/**
 * zone 方式の px 系フィールドに掛ける scale（issue #40 §2）。`reference_height_px` が無ければ 1
 * （既存出力はバイト同一）。あれば output.height / reference_height_px — 基準は高さ（文字サイズは
 * 縦方向の量。縦型出力でも自然）。`layout`（reference-pixel）との併用は禁止。output.height が無いと
 * layout 経路の INVALID_OUTPUT_GEOMETRY と同型で fail する。render-cut の captionTextStyleVars と
 * gpu-export page-builder はこの単一定義を使い、GPU / OSR の両経路で同じ実効 px になる。
 */
function resolveCaptionReferenceScale(style, output) {
    if (!isRecord(style) || style.reference_height_px === undefined)
        return 1;
    if (style.layout !== undefined) {
        fail('STYLE_LAYOUT_CONFLICT', 'caption text style cannot contain both layout and reference_height_px');
    }
    if (!positiveInteger(style.reference_height_px)) {
        fail('INVALID_TEXT_STYLE', 'text_style.reference_height_px must be an integer >= 1');
    }
    if (!output || !finitePositive(output.height)) {
        fail('INVALID_OUTPUT_GEOMETRY', 'output height is required for reference_height_px caption text style');
    }
    return output.height / style.reference_height_px;
}
/**
 * 宣言 px × scale。scale === 1 なら値をそのまま返す（`${value}` の文字列が従来とバイト同一）。
 * それ以外は小数 6 桁へ丸めて浮動小数の端数（0.1 × 3 = 0.30000000000000004）を CSS に漏らさない。
 */
function scaleCaptionPx(value, scale) {
    return scale === 1 ? value : Number((value * scale).toFixed(6));
}
/**
 * text_anchor（9 点）+ position（0..1 相対）→ プレート配置の CSS 変数。単一定義
 * （プレビュー = shell captionTextStyleVars / 書き出し = render-cut captions.mjs の両消費者が
 * これを使う — 2026-08-26 akari-reel 実機: プレビュー側だけ text_anchor/position を落として
 * 明示位置付き字幕が既定の下段 7% に出る「出力とプレビューの位置不一致」の再発防止）。
 * position 未指定なら anchor は zone 相当の縁寄せとして効く。position.y 指定時は
 * b は下端、t は上端、m は中心をその座標へ合わせる。
 * 不正な anchor / vertical_align は未宣言として無視する（書き込み時検証済みが前提の防御）。
 */
function captionAnchorPositionVars(anchorValue, positionValue, verticalAlignValue) {
    const anchor = typeof anchorValue === 'string' && CAPTION_TEXT_ANCHOR_VALUES.has(anchorValue)
        ? anchorValue : undefined;
    const position = isRecord(positionValue) ? positionValue : undefined;
    const verticalAlign = typeof verticalAlignValue === 'string'
        && CAPTION_VERTICAL_ALIGN_VALUES.has(verticalAlignValue) ? verticalAlignValue : undefined;
    if (!anchor && !position && !verticalAlign)
        return {};
    const vars = {};
    const vertical = anchor
        ? anchor[0]
        : verticalAlign === 'top' ? 't' : verticalAlign === 'middle' ? 'm' : 'b';
    const horizontal = anchor ? anchor[1] : 'c';
    if (typeof position?.y === 'number' && Number.isFinite(position.y)) {
        // Explicit x is an absolute placement. Keep its y outside the frame as well;
        // legacy captions without x retain the previous clamped rendering exactly.
        const clamped = typeof position?.x === 'number' && Number.isFinite(position.x)
            ? position.y : Math.min(1, Math.max(0, position.y));
        if ((anchor || verticalAlign) && vertical === 'b') {
            vars['--caption-top'] = 'auto';
            vars['--caption-bottom'] = `${Math.round((1 - clamped) * 10000) / 100}%`;
        }
        else {
            vars['--caption-top'] = `${Math.round(clamped * 10000) / 100}%`;
            vars['--caption-bottom'] = 'auto';
            if ((anchor || verticalAlign) && vertical === 'm') {
                vars['--caption-translate'] = '0 -50%';
            }
        }
    }
    else if (anchor || verticalAlign) {
        vars['--caption-top'] = vertical === 't' ? '7%' : vertical === 'm' ? '0' : 'auto';
        vars['--caption-bottom'] = vertical === 'b' ? '7%' : vertical === 'm' ? '0' : 'auto';
        if (vertical === 'm')
            vars['--caption-justify-content'] = 'center';
    }
    if (typeof position?.x === 'number' && Number.isFinite(position.x)) {
        const left = Math.round(position.x * 10000) / 100;
        vars['--caption-left'] = `${left}%`;
        // left + right always leaves 92% of the frame for wrapping, including
        // off-frame x. The renderer's placed-text plate also fixes width at 92%.
        vars['--caption-right'] = `${Math.round((8 - left) * 100) / 100}%`;
        vars['--caption-align-items'] = 'flex-start';
        vars['--caption-line-margin'] = '0';
        vars['--caption-line-max-width'] = '100%';
    }
    else if (anchor) {
        vars['--caption-left'] = '4%';
        vars['--caption-right'] = '4%';
        vars['--caption-align-items'] = horizontal === 'l'
            ? 'flex-start' : horizontal === 'r' ? 'flex-end' : 'center';
        vars['--caption-text-align'] = horizontal === 'l' ? 'left' : horizontal === 'r' ? 'right' : 'center';
        vars['--caption-line-margin'] = '0';
        vars['--caption-line-max-width'] = '100%';
    }
    return vars;
}
function resolveCaptionLineStyleVarsAtScale(style, scale) {
    const vars = {};
    const px = (value) => scaleCaptionPx(value, scale);
    const extendedBackground = usesExtendedPerLineBackground(style.background);
    const percentageBackground = usesPercentageBackground(style.background);
    if (typeof style.color === 'string')
        vars['--caption-color'] = style.color;
    if (finiteNumber(style.size_px))
        vars['--caption-font-size'] = `${px(style.size_px)}px`;
    if (isRecord(style.stroke) && (typeof style.stroke.color === 'string' || finiteNumber(style.stroke.width_px))) {
        const width = finiteNumber(style.stroke.width_px) ? px(style.stroke.width_px) : 1.5;
        const color = typeof style.stroke.color === 'string' ? style.stroke.color : 'rgba(0,0,0,.9)';
        vars['--caption-stroke'] = `${width * 2}px ${color}`;
    }
    if (isRecord(style.background) && (typeof style.background.color === 'string' || finiteNumber(style.background.opacity))) {
        const name = style.background.mode === 'block'
            ? '--plate-block-bg' : extendedBackground ? '--plate-ext-bg' : '--plate-bg';
        vars[name] = colorWithOpacity(typeof style.background.color === 'string' ? style.background.color : '#000000', finiteNumber(style.background.opacity) ? style.background.opacity : undefined);
    }
    if (isRecord(style.background) && finiteNumber(style.background.radius_px)) {
        const name = style.background.mode === 'block'
            ? '--plate-block-radius' : extendedBackground ? '--plate-ext-radius' : '--plate-radius';
        vars[name] = `${px(style.background.radius_px)}px`;
    }
    if (typeof style.font_family === 'string')
        vars['--caption-font-family'] = style.font_family;
    if (finiteNumber(style.weight))
        vars['--caption-font-weight'] = String(style.weight);
    else if (Number.isInteger(style.font_weight))
        vars['--caption-font-weight'] = String(style.font_weight);
    if (style.italic)
        vars['--caption-font-style'] = 'italic';
    if (style.underline)
        vars['--caption-text-decoration'] = 'underline';
    if (finiteNumber(style.letter_spacing_em))
        vars['--caption-letter-spacing'] = `${style.letter_spacing_em}em`;
    if (finiteNumber(style.line_height))
        vars['--caption-line-height'] = String(style.line_height);
    if (typeof style.text_transform === 'string' && CAPTION_TEXT_TRANSFORM_MAP[style.text_transform]) {
        vars['--caption-text-transform'] = CAPTION_TEXT_TRANSFORM_MAP[style.text_transform];
    }
    if (finiteNumber(style.max_width_pct))
        vars['--caption-line-max-width'] = `${style.max_width_pct}%`;
    if (style.vertical)
        vars['--caption-writing-mode'] = 'vertical-rl';
    if (extendedBackground && isRecord(style.background)) {
        vars['--plate-ext-width'] = percentageBackground
            ? `${style.background.width_pct ?? 0}%` : `${px(style.background.padding_px ?? 0)}px`;
        vars['--plate-ext-height'] = percentageBackground
            ? `${style.background.height_pct ?? 0}%` : `${px(style.background.padding_px ?? 0)}px`;
        if (finiteNumber(style.background.offset_x))
            vars['--plate-offset-x'] = `${px(style.background.offset_x)}px`;
        if (finiteNumber(style.background.offset_y))
            vars['--plate-offset-y'] = `${px(style.background.offset_y)}px`;
    }
    else if (isRecord(style.background) && finiteNumber(style.background.padding_px)) {
        vars['--plate-pad-y'] = `${px(style.background.padding_px)}px`;
        vars['--plate-pad-x'] = `${px(style.background.padding_px)}px`;
    }
    const textShadow = captionTextShadowValue(style.shadow, style.glow, scale);
    if (textShadow !== null)
        vars['--caption-text-shadow'] = textShadow;
    Object.assign(vars, captionZoneVars(style.zone));
    Object.assign(vars, captionAnchorPositionVars(style.text_anchor, style.position, style.vertical_align));
    if (style.align) {
        vars['--caption-text-align'] = style.align;
        vars['--caption-align-items'] = style.align === 'left'
            ? 'flex-start' : style.align === 'right' ? 'flex-end' : 'center';
    }
    return vars;
}
/** Resolve the complete snake_case captions.json line style vocabulary to CSS variables. */
function resolveCaptionLineStyleVars(style, output) {
    if (!isRecord(style))
        return {};
    return resolveCaptionLineStyleVarsAtScale(style, resolveCaptionReferenceScale(style, output));
}
function resolveCaptionStyleForOutput(style, output) {
    let layout;
    let scale = 1;
    if (style.layout !== undefined && style.reference_height_px !== undefined) {
        fail('STYLE_LAYOUT_CONFLICT', 'caption text style cannot contain both layout and reference_height_px');
    }
    if (style.layout !== undefined) {
        if (!output || !finitePositive(output.width) || !finitePositive(output.height))
            fail('INVALID_OUTPUT_GEOMETRY', 'output width/height are required for reference-pixel caption layout');
        layout = resolveReferencePixelLayout(style.layout, output);
        scale = layout.scale;
    }
    else if (style.reference_height_px !== undefined) {
        // zone 方式（issue #40 §2）: 高さ基準の scale を layout 経路と同じ px フィールドに掛ける。
        scale = resolveCaptionReferenceScale(style, output);
    }
    const vars = resolveCaptionLineStyleVarsAtScale(style, scale);
    vars['--caption-paint-order'] = 'stroke fill';
    if (!isRecord(style.shadow) && !isRecord(style.glow))
        vars['--caption-text-shadow'] = 'none';
    if (isRecord(style.stroke)) {
        const color = typeof style.stroke.color === 'string' ? style.stroke.color : 'rgba(0,0,0,.85)';
        const width = finiteNonNegative(style.stroke.width_px) ? style.stroke.width_px * scale : 1.5;
        vars['--caption-webkit-text-stroke'] = `${formatCssNumber(width * 2)}px ${color}`;
        vars['--caption-paint-order'] = 'stroke fill';
    }
    if (isRecord(style.background) && finiteNonNegative(style.background.radius_px)) {
        vars['--plate-block-radius'] = `${formatCssNumber(style.background.radius_px * scale)}px`;
    }
    if (isRecord(style.background) && style.background.mode === 'block'
        && finiteNumber(style.background.padding_px)) {
        vars['--plate-block-pad-y'] = `${scaleCaptionPx(style.background.padding_px, scale)}px`;
        vars['--plate-block-pad-x'] = `${scaleCaptionPx(style.background.padding_px, scale)}px`;
        delete vars['--plate-pad-y'];
        delete vars['--plate-pad-x'];
    }
    // layout（reference-pixel）は px 座標で left/right/bottom を確定済みなので anchor と併用しない
    // （zone + layout は mergeCaptionDisplayStyles が既に拒否している）。
    if (layout === undefined) {
        // resolveCaptionLineStyleVarsAtScale already supplied zone / anchor variables.
    }
    else {
        for (const name of Object.keys(captionZoneVars(style.zone)))
            delete vars[name];
        for (const name of Object.keys(captionAnchorPositionVars(style.text_anchor, style.position, style.vertical_align))) {
            delete vars[name];
        }
        vars['--caption-left'] = `${formatCssNumber(layout.left_px)}px`;
        vars['--caption-right'] = `${formatCssNumber(layout.right_px)}px`;
        vars['--caption-bottom'] = `${formatCssNumber(layout.bottom_px)}px`;
        vars['--caption-width'] = `${formatCssNumber(layout.width_px)}px`;
        vars['--caption-line-width'] = '100%';
        vars['--caption-text-align'] = 'center';
    }
    return { vars, ...(layout ? { layout } : {}) };
}
function resolveCaptionWordStyleVars(style, output) {
    const vars = {};
    const scale = resolveCaptionReferenceScale(style, output);
    if (typeof style.color === 'string')
        vars['--caption-tok-color'] = style.color;
    if (finitePositive(style.size_px))
        vars['--caption-tok-font-size'] = `${formatCssNumber(style.size_px * scale)}px`;
    if (typeof style.font_family === 'string' && style.font_family.length > 0) {
        vars['--caption-tok-font-family'] = style.font_family;
    }
    if (Number.isInteger(style.weight) && style.weight >= 100 && style.weight <= 900) {
        vars['--caption-tok-font-weight'] = String(style.weight);
    }
    else if (Number.isInteger(style.font_weight) && style.font_weight >= 1 && style.font_weight <= 1000) {
        vars['--caption-tok-font-weight'] = String(style.font_weight);
    }
    if (style.italic === true)
        vars['--caption-tok-font-style'] = 'italic';
    if (style.underline === true)
        vars['--caption-tok-text-decoration'] = 'underline';
    if (typeof style.letter_spacing_em === 'number' && Number.isFinite(style.letter_spacing_em)) {
        vars['--caption-tok-letter-spacing'] = `${formatCssNumber(style.letter_spacing_em)}em`;
    }
    if (finitePositive(style.line_height))
        vars['--caption-tok-line-height'] = formatCssNumber(style.line_height);
    if (typeof style.text_transform === 'string') {
        const transform = CAPTION_TEXT_TRANSFORM_MAP[style.text_transform];
        if (transform)
            vars['--caption-tok-text-transform'] = transform;
    }
    if (isRecord(style.stroke)) {
        const color = typeof style.stroke.color === 'string' ? style.stroke.color : 'rgba(0,0,0,.85)';
        const width = finiteNonNegative(style.stroke.width_px) ? style.stroke.width_px * scale : 1.5;
        vars['--caption-tok-webkit-text-stroke'] = `${formatCssNumber(width)}px ${color}`;
        vars['--caption-tok-paint-order'] = 'stroke fill';
    }
    const decorPart = captionTextShadowValue(style.shadow, style.glow, scale);
    if (decorPart)
        vars['--caption-tok-text-shadow'] = decorPart;
    else if (isRecord(style.stroke))
        vars['--caption-tok-text-shadow'] = 'none';
    return vars;
}
const CAPTION_TEXT_TRANSFORM_MAP = {
    upper: 'uppercase',
    uppercase: 'uppercase',
    lower: 'lowercase',
    lowercase: 'lowercase',
    title: 'capitalize',
    capitalize: 'capitalize',
    none: 'none'
};
function captionTextShadowValue(shadow, glow, scale = 1) {
    const parts = [];
    if (isRecord(shadow) && typeof shadow.color === 'string') {
        const angle = ((shadow.angle_deg ?? 90) * Math.PI) / 180;
        const distance = scaleCaptionPx(shadow.distance_px ?? 0, scale);
        const dx = Math.round(Math.cos(angle) * distance * 100) / 100;
        const dy = Math.round(Math.sin(angle) * distance * 100) / 100;
        parts.push(`${dx}px ${dy}px ${scaleCaptionPx(shadow.blur_px ?? 0, scale)}px ${colorWithOpacity(shadow.color, shadow.opacity)}`);
    }
    if (isRecord(glow) && typeof glow.color === 'string') {
        const spread = glow.spread === undefined ? 40 : scaleCaptionPx(glow.spread, scale);
        const alpha = Math.min(1, (glow.density ?? 50) / 60);
        const offsetX = scaleCaptionPx(glow.offset_x ?? 0, scale);
        const offsetY = scaleCaptionPx(glow.offset_y ?? 0, scale);
        parts.push(`${offsetX}px ${offsetY}px ${spread}px ${colorWithOpacity(glow.color, alpha)}`, `${offsetX}px ${offsetY}px ${spread * 2}px ${colorWithOpacity(glow.color, Number((alpha * 0.7).toFixed(4)))}`);
    }
    return parts.length > 0 ? parts.join(', ') : null;
}
function colorWithOpacity(color, explicitOpacity) {
    const raw = color.slice(1);
    const expanded = raw.length === 3
        ? raw.split('').map(character => character + character).join('')
        : raw;
    const rgb = expanded.slice(0, 6).padEnd(6, '0');
    const alphaFromColor = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
    const alpha = explicitOpacity ?? alphaFromColor;
    return `rgba(${parseInt(rgb.slice(0, 2), 16)},${parseInt(rgb.slice(2, 4), 16)},`
        + `${parseInt(rgb.slice(4, 6), 16)},${Number(alpha.toFixed(4))})`;
}
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
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function finitePositive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function finiteNonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function positiveInteger(value) {
    return Number.isInteger(value) && value >= 1;
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
