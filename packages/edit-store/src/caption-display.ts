import { resolveCaptionStylePreset } from './caption-style-preset';
import { TEXTSTYLE_CATALOG } from './generated/textstyle-catalog';

/**
 * Caption display policy v1.  This is the single pure implementation used by
 * render-cut, preview-server, and the shell backend.  It deliberately performs
 * no file IO and returns timeline-domain display cues; browser consumers only
 * select a resolved cue by output time.
 */

export const CAPTION_DISPLAY_SCHEMA = 'caption-layout/v1' as const;
export const CAPTION_DISPLAY_MODE = 'single_line_sequential' as const;
export const CAPTION_DISPLAY_ALGORITHM = 'a4-ja-two-fragment-v1' as const;
export const CAPTION_UNIT_METRIC = 'ascii-half-other-one-v1' as const;

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

export interface CaptionBreakHints {
    preferred_second_starts?: string[];
    preferred_first_ends?: string[];
    protected_terms?: string[];
}

export interface CaptionDisplayPolicy {
    mode: typeof CAPTION_DISPLAY_MODE;
    algorithm: typeof CAPTION_DISPLAY_ALGORITHM;
    unit_metric: typeof CAPTION_UNIT_METRIC;
    max_line_units: number;
    minimum_fragment_duration_seconds: number;
    locale: string;
    lines?: number;
    wrap?: 'multi' | 'fold';
    break_hints?: CaptionBreakHints;
}

export interface CaptionDisplayCue {
    id: string;
    source_cue_id: string;
    src: string | null;
    cut_index: number;
    occurrence_index: number;
    fragment_index: number;
    fragment_count: number;
    start: number;
    end: number;
    text: string;
    display_lines?: string[];
    units: number;
    line_override: boolean;
    text_style?: Record<string, unknown>;
    style_vars?: Record<string, string>;
    layout?: ResolvedCaptionLayout;
    words?: CaptionDisplayWord[];
    word_styles?: CaptionDisplayWordStyle[];
}

export interface CaptionDisplayWord {
    start: number;
    end: number;
    text: string;
    line: number;
}

export interface CaptionDisplayWordStyle {
    from: number;
    to: number;
    preset_id: string;
    style_vars: Record<string, string>;
}

export interface CaptionBoundaryProjection {
    source_cue_id: string;
    text: string;
    boundaries: number[];
}

export interface CaptionDisplayResult {
    schema: typeof CAPTION_DISPLAY_SCHEMA;
    policy: CaptionDisplayPolicy;
    source_cue_count: number;
    occurrence_count: number;
    display_cue_count: number;
    split_source_cue_count: number;
    boundary_projection: CaptionBoundaryProjection[];
    display_cues: CaptionDisplayCue[];
    word_book_fallbacks: Array<{ caption_id: string; dropped_terms: string[] }>;
}

export interface ResolvedCaptionLayout {
    mode: 'reference-pixel';
    reference_width_px: number;
    reference_height_px: number;
    left_px: number;
    width_px: number;
    right_px: number;
    center_x_px: number;
    bottom_px: number;
    text_align: 'center';
    max_lines: 1;
    scale: number;
}

type UnknownRecord = Record<string, any>;

export interface CaptionOccurrence {
    source_cue_id: string;
    src: string | null;
    cut_index: number;
    caption_input_index: number;
    source_start: number;
    source_end: number;
    start: number;
    end: number;
    track: number;
    text: string;
    display_fragments?: string[];
    occurrence_index?: number;
    text_style?: UnknownRecord;
    time_offset?: number;
    time_scale?: number;
}

interface ProjectedWordStyle {
    start: number;
    end: number;
    text: string;
    offset: number;
    preset_id?: string;
    style_vars?: Record<string, string>;
}

export interface ProjectedCaptionWords {
    displayText: string;
    words: UnknownRecord[] | undefined;
    changed: boolean;
    renderable: boolean;
}

const PROJECTION_EPSILON = 0.000001;

export class CaptionDisplayError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'CaptionDisplayError';
        this.code = code;
    }
}

export function measureCaptionUnits(text: string): number {
    return Array.from(text).reduce(
        (total, character) => total + (/^[\x00-\x7F]$/u.test(character) ? 0.5 : 1),
        0
    );
}

export function joinCaptionLines(lines: string[], locale: string): string {
    if (/^ja/iu.test(locale)) {
        // ja は語間に空白を入れない。
        return lines.join('');
    }
    // ja 以外も断片は原文の slice なので空白は原文側に含まれ、現状どおり空文字で連結する。
    return lines.join('');
}

export function validateCaptionDisplayPolicy(value: unknown): CaptionDisplayPolicy {
    if (!isRecord(value)) fail('INVALID_POLICY', 'display_policy must be an object');
    const allowed = new Set([
        'mode', 'algorithm', 'unit_metric', 'max_line_units',
        'minimum_fragment_duration_seconds', 'locale', 'lines', 'wrap', 'break_hints'
    ]);
    rejectUnknown(value, allowed, 'display_policy');
    if (value.mode !== CAPTION_DISPLAY_MODE) fail('INVALID_POLICY', `display_policy.mode must be ${CAPTION_DISPLAY_MODE}`);
    if (value.algorithm !== CAPTION_DISPLAY_ALGORITHM) fail('INVALID_POLICY', `display_policy.algorithm must be ${CAPTION_DISPLAY_ALGORITHM}`);
    if (value.unit_metric !== CAPTION_UNIT_METRIC) fail('INVALID_POLICY', `display_policy.unit_metric must be ${CAPTION_UNIT_METRIC}`);
    if (!finitePositive(value.max_line_units)) fail('INVALID_POLICY', 'display_policy.max_line_units must be a positive finite number');
    if (!finitePositive(value.minimum_fragment_duration_seconds)) fail('INVALID_POLICY', 'display_policy.minimum_fragment_duration_seconds must be a positive finite number');
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

function validateBreakHints(value: unknown): CaptionBreakHints {
    if (!isRecord(value)) fail('INVALID_POLICY', 'display_policy.break_hints must be an object');
    rejectUnknown(value, new Set(['preferred_second_starts', 'preferred_first_ends', 'protected_terms']), 'display_policy.break_hints');
    const result: CaptionBreakHints = {};
    for (const key of ['preferred_second_starts', 'preferred_first_ends', 'protected_terms'] as const) {
        if (value[key] === undefined) continue;
        if (!Array.isArray(value[key]) || value[key].some((entry: unknown) => !strictText(entry))) {
            fail('INVALID_POLICY', `display_policy.break_hints.${key} must contain only non-empty NFC trimmed strings`);
        }
        result[key] = [...value[key]];
    }
    return result;
}

export function resolveCaptionDisplay(
    captionsRoot: unknown,
    edit: UnknownRecord,
    options: { output?: { width: number; height: number }; extra_protected_terms?: string[] } = {}
): CaptionDisplayResult | null {
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
    const policyWithExtraTerms: CaptionDisplayPolicy = incrementalProtectedTerms.length === 0
        ? policy
        : {
            ...policy,
            break_hints: {
                ...policy.break_hints,
                protected_terms: [...policyProtectedTerms, ...incrementalProtectedTerms]
            }
        };
    if (!Array.isArray(captionsRoot.captions)) fail('INVALID_CAPTIONS', 'captions.json object root must contain captions[]');
    const captions = captionsRoot.captions as UnknownRecord[];
    const defaultStyle = Object.prototype.hasOwnProperty.call(captionsRoot, 'default_text_style')
        ? validateCaptionTextStyle(captionsRoot.default_text_style, 'default_text_style')
        : undefined;
    const cuts = Array.isArray(edit?.cuts) ? edit.cuts as UnknownRecord[] : [];
    const styleOutput = options.output ?? edit?.output;
    validateProjectionCuts(cuts, edit);
    const projectedCaptions = captions.map(caption => projectCaptionWords(caption, cuts));
    const captionIds = new Set<string>();
    captions.forEach((caption, index) => {
        validateSourceCaption(caption, index, policy, projectedCaptions[index]);
        if (Object.prototype.hasOwnProperty.call(caption, 'text_style')) {
            validateCaptionTextStyle(caption.text_style, `captions[${index}].text_style`);
        }
        if (captionIds.has(caption.id)) fail('DUPLICATE_CAPTION_ID', `captions[].id is duplicated: ${caption.id}`);
        captionIds.add(caption.id);
    });
    const wordStylesByCaption = resolveProjectedWordStyles(
        captions,
        projectedCaptions,
        captionsRoot.emphasis_words,
        styleOutput
    );
    validateEmphasisConflicts(captions, edit?.emphasis_words);
    const sourceCount = validateSourceReferences(captions, cuts, edit);
    const occurrences = dedupeCaptionOccurrences(
        projectOccurrences(captions, projectedCaptions, cuts, sourceCount),
        captionTrackOrder(cuts, edit)
    );
    occurrences.sort(compareOccurrence);
    const byCue = new Map<string, CaptionOccurrence[]>();
    for (const occurrence of occurrences) {
        const values = byCue.get(occurrence.source_cue_id) ?? [];
        values.push(occurrence);
        byCue.set(occurrence.source_cue_id, values);
    }
    for (const values of byCue.values()) {
        values.forEach((occurrence, index) => { occurrence.occurrence_index = index + 1; });
    }

    const boundaryProjection: CaptionBoundaryProjection[] = [];
    const wordBookFallbacks: Array<{ caption_id: string; dropped_terms: string[] }> = [];
    const fragmentsByCaption = new Map<number, { fragments: string[]; manual: boolean }>();
    captions.forEach((caption, index) => {
        const projected = projectedCaptions[index];
        if (!projected.renderable) return;
        const text = projected.displayText;
        let fragments: string[];
        let manual = false;
        if (!projected.changed && caption.display_fragments !== undefined) {
            fragments = validateManualFragments(caption, text, policy, index);
            manual = true;
            boundaryProjection.push({ source_cue_id: caption.id, text, boundaries: [] });
        } else {
            let split;
            try {
                split = splitCaptionFragments(text, wrap === 'fold'
                    ? { ...policyWithExtraTerms, max_line_units: policyWithExtraTerms.max_line_units * lines }
                    : policyWithExtraTerms);
            } catch (error) {
                if (!(error instanceof CaptionDisplayError)
                    || error.code !== 'NO_WORD_BOUNDARY_SPLIT'
                    || incrementalProtectedTerms.length === 0) {
                    throw error;
                }
                split = splitCaptionFragments(text, splitPolicy);
                wordBookFallbacks.push({
                    caption_id: caption.id,
                    dropped_terms: incrementalProtectedTerms.filter(term => text.includes(term))
                });
            }
            fragments = split.fragments;
            boundaryProjection.push({ source_cue_id: caption.id, text, boundaries: split.boundaries });
        }
        fragmentsByCaption.set(index, { fragments, manual });
    });

    const displayCues: CaptionDisplayCue[] = [];
    const splitCueIds = new Set<string>();
    for (const occurrence of occurrences) {
        const resolved = fragmentsByCaption.get(occurrence.caption_input_index)!;
        if (resolved.fragments.length > 1) splitCueIds.add(occurrence.source_cue_id);
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
                lines: resolved.manual
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
            const wordDisplay = buildCueWordDisplay(
                wordStylesByCaption.get(occurrence.caption_input_index),
                occurrence,
                group.charStart,
                group.charEnd,
                group.lines,
                text
            );
            displayCues.push({
                id: `${occurrence.source_cue_id}-occ-${String(occurrence.occurrence_index).padStart(4, '0')}-part-${index + 1}`,
                source_cue_id: occurrence.source_cue_id,
                src: occurrence.src,
                cut_index: occurrence.cut_index,
                occurrence_index: occurrence.occurrence_index!,
                fragment_index: index + 1,
                fragment_count: groups.length,
                start: group.start,
                end: group.end,
                text,
                ...(group.lines.length >= 2 ? { display_lines: group.lines } : {}),
                units: measureCaptionUnits(text),
                line_override: resolved.manual,
                ...(resolvedStyle ? { text_style: resolvedStyle } : {}),
                ...(styleResolution ? { style_vars: styleResolution.vars } : {}),
                ...(styleResolution?.layout ? { layout: styleResolution.layout } : {}),
                ...(wordDisplay ? { words: wordDisplay.words, word_styles: wordDisplay.wordStyles } : {})
            });
        });
    }
    displayCues.sort(compareDisplayCue);
    for (let index = 1; index < displayCues.length; index++) {
        if (displayCues[index - 1].end - displayCues[index].start > 0.000001) {
            fail('OVERLAPPING_DISPLAY_CUES', `single_line_sequential display cues overlap: ${displayCues[index - 1].id} and ${displayCues[index].id}`);
        }
    }
    return {
        schema: CAPTION_DISPLAY_SCHEMA,
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

function resolveProjectedWordStyles(
    captions: UnknownRecord[],
    projectedCaptions: ProjectedCaptionWords[],
    emphasisValue: unknown,
    output: { width: number; height: number } | undefined
): Map<number, ProjectedWordStyle[]> {
    if (!Array.isArray(emphasisValue)) return new Map();
    const emphasisWords = emphasisValue.filter(value => isRecord(value)
        && typeof value.style_preset === 'string' && value.style_preset.length > 0
        && finiteNonNegative(value.t_start) && finitePositive(value.t_end) && value.t_end > value.t_start
        && (value.src === undefined || strictText(value.src)));
    if (emphasisWords.length === 0) return new Map();

    const presetCache = new Map<string, Record<string, string> | null>();
    const resolvePreset = (presetId: string): Record<string, string> | null => {
        if (presetCache.has(presetId)) return presetCache.get(presetId)!;
        const resolved = resolveCaptionStylePreset({ style_preset: presetId } as UnknownRecord, TEXTSTYLE_CATALOG);
        const vars = resolved.resolved && isRecord(resolved.record.text_style)
            ? resolveCaptionStyleForOutput(resolved.record.text_style, output).vars
            : null;
        presetCache.set(presetId, vars);
        return vars;
    };

    const result = new Map<number, ProjectedWordStyle[]>();
    captions.forEach((caption, index) => {
        if (caption.time_domain === 'output') return;
        const projected = projectedCaptions[index];
        if (!Array.isArray(projected.words) || projected.words.length === 0
            || projected.words.map(word => String(word.text)).join('') !== projected.displayText) return;
        let offset = 0;
        const words = projected.words.map(word => {
            const text = String(word.text);
            let emphasis: UnknownRecord | undefined;
            let styleVars: Record<string, string> | null = null;
            for (const candidate of emphasisWords) {
                const sourceMatches = !(strictText(candidate.src) && strictText(caption.src))
                    || candidate.src === caption.src;
                if (!sourceMatches
                    || Math.min(word.end, candidate.t_end) - Math.max(word.start, candidate.t_start) <= PROJECTION_EPSILON) continue;
                const resolvedVars = resolvePreset(candidate.style_preset);
                if (!resolvedVars) continue;
                emphasis = candidate;
                styleVars = resolvedVars;
                break;
            }
            const value: ProjectedWordStyle = {
                start: word.start,
                end: word.end,
                text,
                offset,
                ...(emphasis && styleVars ? { preset_id: emphasis.style_preset, style_vars: styleVars } : {})
            };
            offset += text.length;
            return value;
        });
        if (words.some(word => word.preset_id)) result.set(index, words);
    });
    return result;
}

function buildCueWordDisplay(
    sourceWords: ProjectedWordStyle[] | undefined,
    occurrence: CaptionOccurrence,
    charStart: number,
    charEnd: number,
    lines: string[],
    cueText: string
): { words: CaptionDisplayWord[]; wordStyles: CaptionDisplayWordStyle[] } | undefined {
    if (!sourceWords) return undefined;
    const lineRanges: Array<{ start: number; end: number; line: number }> = [];
    let lineOffset = charStart;
    lines.forEach((line, index) => {
        lineRanges.push({ start: lineOffset, end: lineOffset + line.length, line: index });
        lineOffset += line.length;
    });
    const styledWords: Array<CaptionDisplayWord & { preset_id?: string; style_vars?: Record<string, string> }> = [];
    for (const word of sourceWords) {
        const wordEnd = word.offset + word.text.length;
        if (Math.min(wordEnd, charEnd) - Math.max(word.offset, charStart) <= 0) continue;
        for (const line of lineRanges) {
            const start = Math.max(word.offset, charStart, line.start);
            const end = Math.min(wordEnd, charEnd, line.end);
            if (end <= start) continue;
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
    if (!styledWords.some(word => word.preset_id)) return undefined;
    const wordStyles: CaptionDisplayWordStyle[] = [];
    styledWords.forEach((word, index) => {
        if (!word.preset_id || !word.style_vars) return;
        const previous = wordStyles[wordStyles.length - 1];
        if (previous?.preset_id === word.preset_id && previous.to === index) previous.to = index + 1;
        else wordStyles.push({
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

function roundOutputSecond(value: number): number {
    return Number(value.toFixed(6));
}

/**
 * Strict captions.schema textStyle validation for the opt-in display-policy kernel.
 * Validation happens on each source object before merge so a valid override can never
 * conceal an invalid default (or vice versa).
 */
export function validateCaptionTextStyle(value: unknown, label = 'text_style'): UnknownRecord {
    if (!isRecord(value)) fail('INVALID_TEXT_STYLE', `${label} must be an object`);
    rejectStyleUnknown(value, CAPTION_STYLE_KEYS, label);
    if (Object.prototype.hasOwnProperty.call(value, 'color')) validateHexColor(value.color, `${label}.color`);
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
    if (Object.prototype.hasOwnProperty.call(value, 'stroke')) validateCaptionStroke(value.stroke, `${label}.stroke`);
    if (Object.prototype.hasOwnProperty.call(value, 'background')) validateCaptionBackground(value.background, `${label}.background`);
    if (Object.prototype.hasOwnProperty.call(value, 'zone') && !CAPTION_ZONES.has(value.zone)) {
        fail('INVALID_TEXT_STYLE', `${label}.zone must be one of the nine caption zones`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'layout')) validateCaptionLayout(value.layout, `${label}.layout`);
    if (Object.prototype.hasOwnProperty.call(value, 'zone') && Object.prototype.hasOwnProperty.call(value, 'layout')) {
        fail('STYLE_LAYOUT_CONFLICT', `${label} cannot contain both zone and layout`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'layout')
        && Object.prototype.hasOwnProperty.call(value, 'reference_height_px')) {
        fail('STYLE_LAYOUT_CONFLICT', `${label} cannot contain both layout and reference_height_px`);
    }
    return value;
}

function validateCaptionStroke(value: unknown, label: string): void {
    if (!isRecord(value)) fail('INVALID_TEXT_STYLE', `${label} must be an object`);
    rejectStyleUnknown(value, CAPTION_STROKE_KEYS, label);
    if (Object.prototype.hasOwnProperty.call(value, 'method') && value.method !== 'webkit-outline') {
        fail('INVALID_TEXT_STYLE', `${label}.method must be webkit-outline`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'color')) validateHexColor(value.color, `${label}.color`);
    if (Object.prototype.hasOwnProperty.call(value, 'width_px') && !finiteNonNegative(value.width_px)) {
        fail('INVALID_TEXT_STYLE', `${label}.width_px must be a non-negative finite number`);
    }
}

function validateCaptionBackground(value: unknown, label: string): void {
    if (!isRecord(value)) fail('INVALID_TEXT_STYLE', `${label} must be an object`);
    rejectStyleUnknown(value, CAPTION_BACKGROUND_KEYS, label);
    if (Object.prototype.hasOwnProperty.call(value, 'color')) validateHexColor(value.color, `${label}.color`);
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

function validateCaptionLayout(value: unknown, label: string): void {
    if (!isRecord(value)) fail('INVALID_TEXT_STYLE', `${label} must be an object`);
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

function validateHexColor(value: unknown, label: string): void {
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
        fail('INVALID_TEXT_STYLE', `${label} must be a #RGB, #RRGGBB, or #RRGGBBAA hex color`);
    }
}

function rejectStyleUnknown(value: UnknownRecord, allowed: Set<string>, label: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) fail('INVALID_TEXT_STYLE', `${label}.${key} is not defined by the text style contract`);
    }
}

/**
 * textstyle v0（2026-08-03）のフィールド検証。受理条件は render-cut の
 * normalizeTextStyle と 1 対 1 に対応させてある — 契約が受理して消費側が黙って捨てる
 * （あるいはその逆）状態を作らないため。
 */
function validateTextStyleV0(value: UnknownRecord, label: string): void {
    const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
    const failIf = (condition: boolean, message: string): void => {
        if (condition) fail('INVALID_TEXT_STYLE', `${label}.${message}`);
    };
    failIf(has('font_family') && (typeof value.font_family !== 'string' || value.font_family === ''),
        'font_family must be a non-empty string');
    failIf(has('weight')
        && (!Number.isInteger(value.weight) || (value.weight as number) < 100 || (value.weight as number) > 900),
        'weight must be an integer within [100, 900]');
    failIf(has('italic') && typeof value.italic !== 'boolean', 'italic must be a boolean');
    failIf(has('underline') && typeof value.underline !== 'boolean', 'underline must be a boolean');
    failIf(has('letter_spacing_em') && !finiteNumber(value.letter_spacing_em),
        'letter_spacing_em must be a finite number');
    failIf(has('align') && !CAPTION_ALIGN_VALUES.has(value.align as string),
        'align must be one of left, center, right');
    failIf(has('vertical_align') && !CAPTION_VERTICAL_ALIGN_VALUES.has(value.vertical_align as string),
        'vertical_align must be one of top, middle, bottom');
    failIf(has('vertical') && typeof value.vertical !== 'boolean', 'vertical must be a boolean');
    failIf(has('text_transform') && !CAPTION_TEXT_TRANSFORM_VALUES.has(value.text_transform as string),
        'text_transform must be one of upper, uppercase, lower, lowercase, title, capitalize, none');
    failIf(has('max_width_pct')
        && (!finiteNumber(value.max_width_pct)
            || (value.max_width_pct as number) <= 0 || (value.max_width_pct as number) >= 100),
        'max_width_pct must be a finite number within (0, 100)');
    failIf(has('max_characters') && !positiveInteger(value.max_characters),
        'max_characters must be an integer greater than zero');
    failIf(has('text_anchor') && !CAPTION_TEXT_ANCHOR_VALUES.has(value.text_anchor as string),
        'text_anchor must be one of the nine anchor codes');
    if (has('position')) {
        if (!isRecord(value.position)) fail('INVALID_TEXT_STYLE', `${label}.position must be an object`);
        rejectStyleUnknown(value.position, CAPTION_POSITION_KEYS, `${label}.position`);
        for (const axis of ['x', 'y']) {
            if (Object.prototype.hasOwnProperty.call(value.position, axis)
                && !finiteNumber((value.position as UnknownRecord)[axis])) {
                fail('INVALID_TEXT_STYLE', `${label}.position.${axis} must be a finite number`);
            }
        }
    }
    if (has('shadow')) validateShadowLike(value.shadow, CAPTION_SHADOW_KEYS, `${label}.shadow`);
    if (has('glow')) validateShadowLike(value.glow, CAPTION_GLOW_KEYS, `${label}.glow`);
    if (has('animation')) {
        if (!isRecord(value.animation)) fail('INVALID_TEXT_STYLE', `${label}.animation must be an object`);
        rejectStyleUnknown(value.animation, CAPTION_ANIMATION_SLOTS, `${label}.animation`);
        for (const slot of CAPTION_ANIMATION_SLOTS) {
            if (!Object.prototype.hasOwnProperty.call(value.animation, slot)) continue;
            const entry = (value.animation as UnknownRecord)[slot];
            const slotLabel = `${label}.animation.${slot}`;
            if (!isRecord(entry)) fail('INVALID_TEXT_STYLE', `${slotLabel} must be an object`);
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
function validateShadowLike(value: unknown, allowed: Set<string>, label: string): void {
    if (!isRecord(value)) fail('INVALID_TEXT_STYLE', `${label} must be an object`);
    rejectStyleUnknown(value, allowed, label);
    if (!Object.prototype.hasOwnProperty.call(value, 'color')) {
        fail('INVALID_TEXT_STYLE', `${label}.color is required`);
    }
    validateHexColor(value.color, `${label}.color`);
    for (const key of allowed) {
        if (key === 'color' || !Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (!finiteNumber(value[key])) fail('INVALID_TEXT_STYLE', `${label}.${key} must be a finite number`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'opacity')
        && ((value.opacity as number) < 0 || (value.opacity as number) > 1)) {
        fail('INVALID_TEXT_STYLE', `${label}.opacity must be within [0, 1]`);
    }
    for (const key of ['blur_px', 'distance_px', 'density', 'spread']) {
        if (Object.prototype.hasOwnProperty.call(value, key) && (value[key] as number) < 0) {
            fail('INVALID_TEXT_STYLE', `${label}.${key} must be non-negative`);
        }
    }
}

function validateSourceReferences(captions: UnknownRecord[], cuts: UnknownRecord[], edit: UnknownRecord): number {
    // 単一 source 宣言を持つ旧入力は素材表を持たない。正規化後の v1/v2 はどちらも
    // sources[] を持つため、版番号ではなく入力の性質だけで同じ参照検証を行う。
    if (!Object.prototype.hasOwnProperty.call(edit, 'sources')) return 1;
    if (!Array.isArray(edit.sources) || edit.sources.length === 0) {
        fail('INVALID_SOURCES', 'edit.json requires a non-empty sources[] array');
    }
    const sourceIds = new Set<string>();
    edit.sources.forEach((source: unknown, index: number) => {
        if (!isRecord(source) || !strictText(source.id)) {
            fail('INVALID_SOURCE_ID', `edit.json sources[${index}].id must be a non-empty NFC trimmed string`);
        }
        if (sourceIds.has(source.id)) fail('DUPLICATE_SOURCE_ID', `edit.json sources[].id is duplicated: ${source.id}`);
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

function validateProjectionCuts(cuts: UnknownRecord[], edit: UnknownRecord): void {
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
        if (cut.speed !== undefined && !finitePositive(cut.speed)) fail('INVALID_CUT', `edit.json cuts[${index}].speed must be positive`);
    });
}

/**
 * `captions.json` は変更せず、keep cut から外れた語だけを描画用の本文と words から除く。
 * どれかの cut と一部でも交差する語は残す（語の途中で切った場合に欠落させない）。
 */
export function projectCaptionWords(caption: UnknownRecord, cuts: UnknownRecord[]): ProjectedCaptionWords {
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
        if (!isRecord(cut) || cut.captions === 'off') return false;
        if (captionSource !== null && cut.src !== captionSource) return false;
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

function isProjectionWord(value: unknown): value is UnknownRecord & { start: number; end: number; text: string } {
    return isRecord(value) && typeof value.text === 'string' && value.text.length > 0
        && finiteNonNegative(value.start) && finiteNonNegative(value.end) && value.end > value.start;
}

function removeHiddenWords(text: string, words: UnknownRecord[], visible: boolean[]): string {
    let cursor = 0;
    let output = '';
    for (let index = 0; index < words.length; index++) {
        const wordText = String(words[index].text);
        const offset = text.indexOf(wordText, cursor);
        if (offset < 0) {
            return words.filter((_word, wordIndex) => visible[wordIndex]).map(word => String(word.text)).join('');
        }
        if (visible[index]) output += text.slice(cursor, offset + wordText.length);
        cursor = offset + wordText.length;
    }
    if (visible[visible.length - 1]) output += text.slice(cursor);
    return output.trim();
}

/**
 * 同じ source cue が同じ出力区間へ複数回射影された場合、下→上の trackOrder で
 * 最後に描かれる occurrence だけを残す。部分重複は境界で分割する。
 */
export function dedupeCaptionOccurrences<T extends {
    source_cue_id: string;
    start: number;
    end: number;
    track: number;
    source_start?: number;
    source_end?: number;
}>(occurrences: readonly T[], trackOrder: readonly number[]): T[] {
    const inputOrder = new Map<T, number>(occurrences.map((occurrence, index) => [occurrence, index]));
    const trackRank = new Map<number, number>();
    trackOrder.forEach((track, index) => trackRank.set(track, index));
    const rankOf = (occurrence: T): number => trackRank.get(occurrence.track) ?? occurrence.track;
    const byCue = new Map<string, T[]>();
    for (const occurrence of occurrences) {
        const values = byCue.get(occurrence.source_cue_id) ?? [];
        values.push(occurrence);
        byCue.set(occurrence.source_cue_id, values);
    }
    const output: T[] = [];
    for (const values of byCue.values()) {
        const boundaries = [...new Set(values.flatMap(value => [value.start, value.end]))]
            .sort((left, right) => left - right);
        const pieces: Array<{ winner: T; start: number; end: number }> = [];
        for (let index = 0; index + 1 < boundaries.length; index++) {
            const start = boundaries[index];
            const end = boundaries[index + 1];
            if (end - start <= PROJECTION_EPSILON) continue;
            const midpoint = (start + end) / 2;
            const active = values.filter(value => value.start <= midpoint && value.end > midpoint);
            if (active.length === 0) continue;
            const winner = active.reduce((current, candidate) => {
                const rankDifference = rankOf(candidate) - rankOf(current);
                if (rankDifference !== 0) return rankDifference > 0 ? candidate : current;
                return (inputOrder.get(candidate) ?? 0) > (inputOrder.get(current) ?? 0) ? candidate : current;
            });
            const last = pieces[pieces.length - 1];
            if (last?.winner === winner && Math.abs(last.end - start) <= PROJECTION_EPSILON) last.end = end;
            else pieces.push({ winner, start, end });
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
        || (inputOrder.get(left) ?? inputOrder.get(left as T) ?? 0) - (inputOrder.get(right) ?? 0));
}

function captionTrackOrder(cuts: UnknownRecord[], edit: UnknownRecord): number[] {
    const declared = Array.isArray(edit?.timeline?.tracks)
        ? edit.timeline.tracks
            .filter((track: UnknownRecord) => track?.kind === 'cuts' && Number.isInteger(track.ref) && track.ref >= 0)
            .map((track: UnknownRecord) => track.ref as number) as number[]
        : [];
    const fallback = cuts.map(cut => Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0)
        .sort((left, right) => left - right);
    return [...new Set(declared.length > 0 ? declared : fallback)];
}

function projectOccurrences(
    captions: UnknownRecord[],
    projectedCaptions: ProjectedCaptionWords[],
    cuts: UnknownRecord[],
    sourceCount: number
): CaptionOccurrence[] {
    const occurrences: CaptionOccurrence[] = [];
    const cursors = new Map<number, number>();
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
        if (!isRecord(caption) || caption.time_domain !== 'output') return;
        const projected = projectedCaptions[captionInputIndex];
        if (!projected.renderable) return;
        const clampedEnd = Math.min(caption.end, timelineEnd);
        if (!(clampedEnd > caption.start)) return;
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
            if (caption?.time_domain === 'output') return;
            const projected = projectedCaptions[captionInputIndex];
            const text = projected.displayText;
            if (isRecord(caption) && finiteNonNegative(caption.start) && finitePositive(caption.end) && caption.end > caption.start && typeof text === 'string') {
                if (!projected.renderable) return;
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
        if (!isRecord(caption)) return;
        if (caption.time_domain === 'output') return;
        const projected = projectedCaptions[captionInputIndex];
        if (!projected.renderable) return;
        const captionSource = strictText(caption.src) ? caption.src : null;
        if (sourceCount > 1 && captionSource === null) {
            fail('MISSING_SOURCE', `captions[${captionInputIndex}].src is required for a multi-source edit`);
        }
        for (const segment of segments) {
            if (segment.cut.captions === 'off') continue;
            if (captionSource !== null && segment.cut.src !== captionSource) continue;
            const sourceStart = Math.max(caption.start, segment.cut.in);
            const sourceEnd = Math.min(caption.end, segment.cut.out);
            if (!(sourceEnd > sourceStart)) continue;
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

function validateSourceCaption(
    caption: UnknownRecord,
    index: number,
    policy: CaptionDisplayPolicy,
    projected?: ProjectedCaptionWords
): void {
    if (!isRecord(caption) || !strictText(caption.id)) fail('INVALID_CAPTION', `captions[${index}].id must be a non-empty string`);
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
    if (!strictText(sourceText)) fail('INVALID_TEXT', `captions[${index}] display text must be non-empty, NFC, and trimmed`);
    const text = projected?.renderable ? projected.displayText : sourceText;
    if (caption.style !== undefined) {
        if (CAPTION_WORD_STYLES.has(caption.style)) {
            fail('STYLE_CONFLICT', `captions[${index}].style cannot be combined with display_policy`);
        }
        fail(
            'INVALID_CAPTION',
            `captions[${index}].style ${JSON.stringify(caption.style)} is not a known caption style `
                + `(expected one of: ${[...CAPTION_WORD_STYLES].join(', ')})`
        );
    }
    if (projected?.renderable !== false
        && measureCaptionUnits(text) > policy.max_line_units * (policy.wrap === 'fold' ? (policy.lines ?? 1) : 1) * 2
        && (caption.display_fragments === undefined || projected?.changed === true)) {
        fail('NO_WORD_BOUNDARY_SPLIT', `caption ${caption.id} cannot fit in two ${policy.max_line_units}-unit fragments; provide display_fragments`);
    }
}

function validateEmphasisConflicts(captions: UnknownRecord[], emphasisValue: unknown): void {
    if (!Array.isArray(emphasisValue)) return;
    captions.forEach((caption, index) => {
        if (caption.time_domain === 'output') return;
        const conflict = emphasisValue.some(value => isRecord(value)
            && (!strictText(value.src) || !strictText(caption.src) || value.src === caption.src)
            && finiteNonNegative(value.t_start) && finitePositive(value.t_end)
            && value.t_end > caption.start && value.t_start < caption.end);
        if (conflict) fail('EMPHASIS_CONFLICT', `edit.emphasis_words cannot act on captions[${index}] under display_policy`);
    });
}

function validateManualFragments(caption: UnknownRecord, text: string, policy: CaptionDisplayPolicy, index: number): string[] {
    if (!Array.isArray(caption.display_fragments) || caption.display_fragments.length < 1 || caption.display_fragments.length > 2) {
        fail('INVALID_MANUAL_FRAGMENTS', `captions[${index}].display_fragments must contain one or two strings`);
    }
    if (caption.display_fragments.some((fragment: unknown) => !strictText(fragment))) {
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

export function splitCaptionFragments(text: string, policy: CaptionDisplayPolicy): { fragments: string[]; boundaries: number[] } {
    if (measureCaptionUnits(text) <= policy.max_line_units) return { fragments: [text], boundaries: [] };
    const Segmenter = (Intl as any).Segmenter;
    if (typeof Segmenter !== 'function') fail('SEGMENTER_UNAVAILABLE', 'Intl.Segmenter is required by display_policy');
    const segmenter = new Segmenter(policy.locale, { granularity: 'word' });
    const boundaries = [...segmenter.segment(text)]
        .map(segment => segment.index)
        .filter(index => index > 0 && index < text.length);
    const candidates: Array<{ fragments: [string, string]; score: number; boundary: number }> = [];
    for (const boundary of boundaries) {
        const first = text.slice(0, boundary);
        const second = text.slice(boundary);
        const firstUnits = measureCaptionUnits(first);
        const secondUnits = measureCaptionUnits(second);
        if (firstUnits > policy.max_line_units || secondUnits > policy.max_line_units) continue;
        if (splitsProtectedTerm(text, boundary, policy.break_hints?.protected_terms ?? [])) continue;
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

export function foldCaptionLines(
    text: string,
    maxLineUnits: number,
    lines: number,
    locale = 'ja'
): string[] {
    if (!finitePositive(maxLineUnits) || !Number.isInteger(lines) || lines < 1) {
        fail('INVALID_POLICY', 'foldCaptionLines requires positive maxLineUnits and lines >= 1');
    }
    if (lines === 1 || measureCaptionUnits(text) <= maxLineUnits) return [text];
    const Segmenter = (Intl as any).Segmenter;
    const segments: string[] = typeof Segmenter === 'function'
        ? [...new Segmenter(locale, { granularity: 'word' }).segment(text)].map(segment => segment.segment)
        : Array.from(text);
    const tokens = segments.flatMap(segment => splitCaptionUnitChunks(segment, maxLineUnits));
    const result: string[] = [];
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
    if (current !== '') result.push(current);
    return result;
}

function splitCaptionUnitChunks(text: string, maxLineUnits: number): string[] {
    if (measureCaptionUnits(text) <= maxLineUnits) return [text];
    const chunks: string[] = [];
    let current = '';
    for (const character of Array.from(text)) {
        if (current !== '' && measureCaptionUnits(current + character) > maxLineUnits) {
            chunks.push(current);
            current = '';
        }
        current += character;
    }
    if (current !== '') chunks.push(current);
    return chunks;
}

function captionBreakScore(first: string, second: string, firstUnits: number, secondUnits: number, hints?: CaptionBreakHints): number {
    let score = 100 - Math.abs(firstUnits - secondUnits) * 4;
    if ((hints?.preferred_second_starts ?? []).some(value => second.startsWith(value))) score += 34;
    if ((hints?.preferred_first_ends ?? []).some(value => first.endsWith(value))) score += 28;
    if (/[、。！？!?]$/u.test(first)) score += 50;
    if (/^[、。！？!?）」』】]/u.test(second)) score -= 100;
    if (/[（「『【]$/u.test(first)) score -= 100;
    if (/^[はがをにでとのもへや]/u.test(second)) score -= 28;
    // .at() は ES2022。tsconfig の lib は ES2021 なので slice で等価に書く
    // （クリーンな checkout で tsc -b が落ち、preview-server の pretest ごと止まっていた。
    //  既存ツリーでは .tsbuildinfo に隠れて再現しなかった）
    if (/[（「『【]/u.test(first.slice(-1))) score -= 80;
    return score;
}

function splitsProtectedTerm(text: string, boundary: number, terms: string[]): boolean {
    return terms.some(term => {
        let start = text.indexOf(term);
        while (start !== -1) {
            if (start < boundary && boundary < start + term.length) return true;
            start = text.indexOf(term, start + 1);
        }
        return false;
    });
}

export function scheduleCaptionFragments(start: number, end: number, fragments: string[], minimumSeconds: number): Array<{ start: number; end: number; text: string }> {
    const duration = end - start;
    if (!(duration > 0)) fail('INVALID_OCCURRENCE', 'caption occurrence duration must be positive');
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

export function mergeCaptionDisplayStyles(base: unknown, override: unknown): UnknownRecord | undefined {
    const left = isRecord(base) ? base : {};
    const right = isRecord(override) ? override : {};
    const merged: UnknownRecord = { ...left, ...right };
    for (const key of ['stroke', 'background', 'layout']) {
        if (isRecord(left[key]) || isRecord(right[key])) merged[key] = { ...(isRecord(left[key]) ? left[key] : {}), ...(isRecord(right[key]) ? right[key] : {}) };
    }
    if (Object.keys(merged).length === 0) return undefined;
    if (merged.zone !== undefined && merged.layout !== undefined) fail('STYLE_LAYOUT_CONFLICT', 'merged caption text style cannot contain both zone and layout');
    if (merged.reference_height_px !== undefined && merged.layout !== undefined) {
        fail('STYLE_LAYOUT_CONFLICT', 'merged caption text style cannot contain both layout and reference_height_px');
    }
    return merged;
}

/**
 * zone 方式の px 系フィールドに掛ける scale（issue #40 §2）。`reference_height_px` が無ければ 1
 * （既存出力はバイト同一）。あれば output.height / reference_height_px — 基準は高さ（文字サイズは
 * 縦方向の量。縦型出力でも自然）。`layout`（reference-pixel）との併用は禁止。output.height が無いと
 * layout 経路の INVALID_OUTPUT_GEOMETRY と同型で fail する。render-cut の captionTextStyleVars と
 * gpu-export page-builder はこの単一定義を使い、GPU / OSR の両経路で同じ実効 px になる。
 */
export function resolveCaptionReferenceScale(style: unknown, output: { width?: number; height?: number } | undefined): number {
    if (!isRecord(style) || style.reference_height_px === undefined) return 1;
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
export function scaleCaptionPx(value: number, scale: number): number {
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
export function captionAnchorPositionVars(
    anchorValue: unknown,
    positionValue: unknown,
    verticalAlignValue: unknown
): Record<string, string> {
    const anchor = typeof anchorValue === 'string' && CAPTION_TEXT_ANCHOR_VALUES.has(anchorValue)
        ? anchorValue : undefined;
    const position = isRecord(positionValue) ? positionValue : undefined;
    const verticalAlign = typeof verticalAlignValue === 'string'
        && CAPTION_VERTICAL_ALIGN_VALUES.has(verticalAlignValue) ? verticalAlignValue : undefined;
    if (!anchor && !position && !verticalAlign) return {};
    const vars: Record<string, string> = {};
    const vertical = anchor
        ? anchor[0]
        : verticalAlign === 'top' ? 't' : verticalAlign === 'middle' ? 'm' : 'b';
    const horizontal = anchor ? anchor[1] : 'c';
    if (typeof position?.y === 'number' && Number.isFinite(position.y)) {
        const clamped = Math.min(1, Math.max(0, position.y));
        if ((anchor || verticalAlign) && vertical === 'b') {
            vars['--caption-top'] = 'auto';
            vars['--caption-bottom'] = `${Math.round((1 - clamped) * 10000) / 100}%`;
        } else {
            vars['--caption-top'] = `${Math.round(clamped * 10000) / 100}%`;
            vars['--caption-bottom'] = 'auto';
            if ((anchor || verticalAlign) && vertical === 'm') {
                vars['--caption-translate'] = '0 -50%';
            }
        }
    } else if (anchor || verticalAlign) {
        vars['--caption-top'] = vertical === 't' ? '7%' : vertical === 'm' ? '0' : 'auto';
        vars['--caption-bottom'] = vertical === 'b' ? '7%' : vertical === 'm' ? '0' : 'auto';
        if (vertical === 'm') vars['--caption-justify-content'] = 'center';
    }
    if (typeof position?.x === 'number' && Number.isFinite(position.x)) {
        const clamped = Math.min(1, Math.max(0, position.x));
        vars['--caption-left'] = `${Math.round(clamped * 10000) / 100}%`;
        vars['--caption-right'] = '4%';
        vars['--caption-align-items'] = 'flex-start';
        vars['--caption-line-margin'] = '0';
    } else if (anchor) {
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

export function resolveCaptionStyleForOutput(style: UnknownRecord, output: { width: number; height: number } | undefined): { vars: Record<string, string>; layout?: ResolvedCaptionLayout } {
    const vars: Record<string, string> = {};
    let layout: ResolvedCaptionLayout | undefined;
    let scale = 1;
    if (style.layout !== undefined && style.reference_height_px !== undefined) {
        fail('STYLE_LAYOUT_CONFLICT', 'caption text style cannot contain both layout and reference_height_px');
    }
    if (style.layout !== undefined) {
        if (!output || !finitePositive(output.width) || !finitePositive(output.height)) fail('INVALID_OUTPUT_GEOMETRY', 'output width/height are required for reference-pixel caption layout');
        layout = resolveReferencePixelLayout(style.layout, output);
        scale = layout.scale;
        vars['--caption-left'] = `${formatCssNumber(layout.left_px)}px`;
        vars['--caption-right'] = `${formatCssNumber(layout.right_px)}px`;
        vars['--caption-bottom'] = `${formatCssNumber(layout.bottom_px)}px`;
        vars['--caption-width'] = `${formatCssNumber(layout.width_px)}px`;
        vars['--caption-text-align'] = 'center';
    } else if (style.reference_height_px !== undefined) {
        // zone 方式（issue #40 §2）: 高さ基準の scale を layout 経路と同じ px フィールドに掛ける。
        scale = resolveCaptionReferenceScale(style, output);
    }
    if (typeof style.color === 'string') vars['--caption-color'] = style.color;
    if (finitePositive(style.size_px)) vars['--caption-font-size'] = `${formatCssNumber(style.size_px * scale)}px`;
    // weight（textstyle v0 の正式名）と font_weight（display_policy 経路からの既存名）は同じ
    // CSS font-weight を指す。両方あるときは weight を採る — 契約 $comment と同じ優先順位。
    if (Number.isInteger(style.weight) && (style.weight as number) >= 100 && (style.weight as number) <= 900) {
        vars['--caption-font-weight'] = String(style.weight);
    } else if (Number.isInteger(style.font_weight) && style.font_weight >= 1 && style.font_weight <= 1000) {
        vars['--caption-font-weight'] = String(style.font_weight);
    }
    if (finitePositive(style.line_height)) vars['--caption-line-height'] = formatCssNumber(style.line_height);
    if (isRecord(style.stroke)) {
        const color = typeof style.stroke.color === 'string' ? style.stroke.color : 'rgba(0,0,0,.85)';
        const width = finiteNonNegative(style.stroke.width_px) ? style.stroke.width_px * scale : 1.5;
        if (style.stroke.method === 'webkit-outline') {
            vars['--caption-webkit-text-stroke'] = `${formatCssNumber(width)}px ${color}`;
            vars['--caption-paint-order'] = 'stroke fill';
            vars['--caption-text-shadow'] = 'none';
        } else {
            vars['--caption-text-shadow'] = strokeShadow(color, width, layout !== undefined || scale !== 1);
        }
    }
    if (isRecord(style.background) && finiteNonNegative(style.background.radius_px)) {
        vars['--plate-radius'] = `${formatCssNumber(style.background.radius_px * scale)}px`;
        vars['--plate-block-radius'] = `${formatCssNumber(style.background.radius_px * scale)}px`;
    }
    // layout（reference-pixel）は px 座標で left/right/bottom を確定済みなので anchor と併用しない
    // （zone + layout は mergeCaptionDisplayStyles が既に拒否している）。
    if (layout === undefined) {
        Object.assign(vars, captionAnchorPositionVars(style.text_anchor, style.position, style.vertical_align));
    }
    return { vars, ...(layout ? { layout } : {}) };
}

function resolveReferencePixelLayout(value: UnknownRecord, output: { width: number; height: number }): ResolvedCaptionLayout {
    if (!isRecord(value) || value.mode !== 'reference-pixel') fail('INVALID_LAYOUT', 'caption layout.mode must be reference-pixel');
    const required = ['reference_width_px', 'reference_height_px', 'left_px', 'width_px', 'bottom_px', 'text_align', 'max_lines'];
    for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) fail('INVALID_LAYOUT', `caption layout.${key} is required`);
    if (!Number.isInteger(value.reference_width_px) || value.reference_width_px <= 0
        || !Number.isInteger(value.reference_height_px) || value.reference_height_px <= 0
        || !finiteNonNegative(value.left_px) || !finitePositive(value.width_px)
        || !finiteNonNegative(value.bottom_px) || value.left_px + value.width_px > value.reference_width_px
        || value.text_align !== 'center' || value.max_lines !== 1) {
        fail('INVALID_LAYOUT', 'caption reference-pixel layout fields are invalid');
    }
    const widthScale = output.width / value.reference_width_px;
    const heightScale = output.height / value.reference_height_px;
    if (Math.abs(widthScale - heightScale) > 0.000001) fail('ASPECT_RATIO_MISMATCH', 'caption reference-pixel layout aspect ratio does not match output');
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

export function formatCssNumber(value: number): string {
    return Number(value.toFixed(6)).toString();
}

function strokeShadow(color: string, width: number, rounded: boolean): string {
    const serialized = rounded ? formatCssNumber(width) : String(width);
    const negative = width === 0 ? '0' : `-${serialized}px`;
    const positive = width === 0 ? '0' : `${serialized}px`;
    return `${negative} ${negative} 0 ${color}, ${positive} ${negative} 0 ${color}, `
        + `${negative} ${positive} 0 ${color}, ${positive} ${positive} 0 ${color}, `
        + '0 0 8px rgba(0,0,0,.6)';
}

function compareOccurrence(left: CaptionOccurrence, right: CaptionOccurrence): number {
    return left.start - right.start
        || left.cut_index - right.cut_index
        || left.source_start - right.source_start
        || left.caption_input_index - right.caption_input_index;
}

function compareDisplayCue(left: CaptionDisplayCue, right: CaptionDisplayCue): number {
    return left.start - right.start
        || left.end - right.end
        || left.cut_index - right.cut_index
        || left.occurrence_index - right.occurrence_index
        || left.fragment_index - right.fragment_index;
}

function strictText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.trim() === value && value.normalize('NFC') === value;
}

function finiteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function finitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 1;
}

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknown(value: UnknownRecord, allowed: Set<string>, label: string): void {
    for (const key of Object.keys(value)) if (!allowed.has(key)) fail('INVALID_POLICY', `${label}.${key} is not defined`);
}

function fail(code: string, message: string): never {
    throw new CaptionDisplayError(code, message);
}
