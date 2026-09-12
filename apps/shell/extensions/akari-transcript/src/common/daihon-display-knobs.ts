import {
    CAPTION_DISPLAY_ALGORITHM,
    CAPTION_DISPLAY_MODE,
    CAPTION_UNIT_METRIC,
    type CaptionDisplayPolicy
} from '@akari-video/edit-store';

export const DAIHON_MAX_LINE_UNITS_MIN = 10;
export const DAIHON_MAX_LINE_UNITS_MAX = 28;
export const DAIHON_CUSTOM_LINES_MIN = 4;
export const DAIHON_CUSTOM_LINES_MAX = 6;

export interface DaihonDisplayKnobs {
    maxLineUnits: number;
    lines: number;
    wrap: 'multi' | 'fold';
}

const DEFAULT_KNOBS: DaihonDisplayKnobs = {
    maxLineUnits: 18,
    lines: 1,
    wrap: 'multi'
};

const DEFAULT_POLICY: CaptionDisplayPolicy = {
    mode: CAPTION_DISPLAY_MODE,
    algorithm: CAPTION_DISPLAY_ALGORITHM,
    unit_metric: CAPTION_UNIT_METRIC,
    max_line_units: DEFAULT_KNOBS.maxLineUnits,
    minimum_fragment_duration_seconds: 0.72,
    locale: 'ja',
    lines: DEFAULT_KNOBS.lines,
    wrap: DEFAULT_KNOBS.wrap
};

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
}

export function clampDaihonMaxLineUnits(value: number): number {
    const finite = Number.isFinite(value) ? value : DEFAULT_KNOBS.maxLineUnits;
    return Math.min(DAIHON_MAX_LINE_UNITS_MAX, Math.max(DAIHON_MAX_LINE_UNITS_MIN, Math.round(finite)));
}

export function validateDaihonCustomLines(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value
        : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    return Number.isInteger(parsed) && parsed >= DAIHON_CUSTOM_LINES_MIN && parsed <= DAIHON_CUSTOM_LINES_MAX
        ? parsed : null;
}

export function readDaihonDisplayKnobs(captionsRoot: unknown): DaihonDisplayKnobs {
    const policy = record(record(captionsRoot)?.display_policy);
    const lines = typeof policy?.lines === 'number' && Number.isInteger(policy.lines)
        && policy.lines >= 1 && policy.lines <= DAIHON_CUSTOM_LINES_MAX ? policy.lines : DEFAULT_KNOBS.lines;
    return {
        maxLineUnits: clampDaihonMaxLineUnits(typeof policy?.max_line_units === 'number'
            ? policy.max_line_units : DEFAULT_KNOBS.maxLineUnits),
        lines,
        wrap: policy?.wrap === 'fold' ? 'fold' : 'multi'
    };
}

export function daihonDisplayPolicyForWrite(
    captionsRoot: unknown,
    values: DaihonDisplayKnobs
): CaptionDisplayPolicy {
    const current = record(record(captionsRoot)?.display_policy);
    const minimumDuration = typeof current?.minimum_fragment_duration_seconds === 'number'
        && Number.isFinite(current.minimum_fragment_duration_seconds) && current.minimum_fragment_duration_seconds > 0
        ? current.minimum_fragment_duration_seconds : DEFAULT_POLICY.minimum_fragment_duration_seconds;
    const locale = typeof current?.locale === 'string' && current.locale.trim() === current.locale
        && current.locale.length > 0 && current.locale.normalize() === current.locale
        ? current.locale : DEFAULT_POLICY.locale;
    const breakHints = record(current?.break_hints) as CaptionDisplayPolicy['break_hints'] | undefined;
    return {
        ...DEFAULT_POLICY,
        max_line_units: clampDaihonMaxLineUnits(values.maxLineUnits),
        minimum_fragment_duration_seconds: minimumDuration,
        locale,
        lines: Number.isInteger(values.lines) && values.lines >= 1 && values.lines <= DAIHON_CUSTOM_LINES_MAX
            ? values.lines : DEFAULT_KNOBS.lines,
        wrap: values.wrap === 'fold' ? 'fold' : 'multi',
        ...(breakHints ? { break_hints: breakHints } : {})
    };
}

export function writeDaihonDisplayKnobs(captionsRoot: unknown, values: DaihonDisplayKnobs): Record<string, unknown> {
    const policy = daihonDisplayPolicyForWrite(captionsRoot, values);
    return Array.isArray(captionsRoot)
        ? { display_policy: policy, captions: captionsRoot }
        : { ...(record(captionsRoot) ?? {}), display_policy: policy };
}

export function daihonDisplayLabel(values: Pick<DaihonDisplayKnobs, 'maxLineUnits' | 'lines'>): string {
    return `${clampDaihonMaxLineUnits(values.maxLineUnits)}字 · ${values.lines}行`;
}
