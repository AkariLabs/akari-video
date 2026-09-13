export type DaihonGearStyle = 'karaoke' | 'plain';
export type DaihonDisplayTiming = 'full' | 'speech-tight';

export interface DaihonGearAnimPreset {
    id: string | null;
    label: string;
}

/** ⚙ ポップの一次表示リスト（47 語彙のフル UI は別票）。 */
export const DAIHON_GEAR_ANIM_PRESETS: readonly DaihonGearAnimPreset[] = [
    { id: null, label: 'なし' },
    { id: 'fade-in-out', label: 'フェード' },
    { id: 'fade-up', label: 'フェード（下から）' },
    { id: 'slide-up', label: 'スライドアップ' },
    { id: 'pop', label: 'ポップ' },
    { id: 'typewriter', label: 'タイプライター' }
];

export function readGearStyle(style: string | null | undefined): DaihonGearStyle {
    return style === 'karaoke' ? 'karaoke' : 'plain';
}

export function readDisplayTiming(value: unknown): DaihonDisplayTiming {
    return value === 'speech-tight' ? 'speech-tight' : 'full';
}

export function readGearAnimationId(textStyle: unknown): string | null {
    if (!textStyle || typeof textStyle !== 'object') return null;
    const animation = (textStyle as Record<string, unknown>).animation;
    if (!animation || typeof animation !== 'object') return null;
    const input = (animation as Record<string, unknown>).in;
    if (!input || typeof input !== 'object') return null;
    const id = (input as Record<string, unknown>).id;
    return typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id) ? id : null;
}

export function gearSpeechWindow(
    words: readonly { start: number; end: number }[] | null | undefined,
    start: number,
    end: number
): { start: number; end: number } | null {
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Array.isArray(words) || words.length === 0) return null;
    const valid = words.filter(word => word && Number.isFinite(word.start) && Number.isFinite(word.end)
        && word.end >= word.start);
    if (valid.length === 0) return null;
    const tightStart = Math.max(start, Math.min(...valid.map(word => word.start)));
    const tightEnd = Math.min(end, Math.max(...valid.map(word => word.end)));
    if (tightEnd - tightStart <= 0 || (tightStart <= start && tightEnd >= end)) return null;
    return { start: tightStart, end: tightEnd };
}

export function gearSpeechTrimSeconds(
    words: readonly { start: number; end: number }[] | null | undefined,
    start: number,
    end: number
): { head: number; tail: number } | null {
    const window = gearSpeechWindow(words, start, end);
    return window ? { head: window.start - start, tail: end - window.end } : null;
}

export function planSpeechTightApply<T extends {
    id: string;
    start?: unknown;
    end?: unknown;
    words?: readonly { start: number; end: number }[] | null;
    displayTiming?: DaihonDisplayTiming;
}>(rows: readonly T[], timing: DaihonDisplayTiming): { targets: string[]; skipped: string[] } {
    const targets: string[] = [];
    const skipped: string[] = [];
    for (const row of rows) {
        const needsChange = timing === 'speech-tight'
            ? typeof row.start === 'number' && typeof row.end === 'number'
                && gearSpeechWindow(row.words, row.start, row.end) !== null
                && row.displayTiming !== 'speech-tight'
            : row.displayTiming === 'speech-tight';
        (needsChange ? targets : skipped).push(row.id);
    }
    return { targets, skipped };
}
