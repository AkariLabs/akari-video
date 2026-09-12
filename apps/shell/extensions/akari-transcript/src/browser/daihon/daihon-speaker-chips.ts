import type { DaihonRow } from '../../common/daihon-row-model';

export const SPEAKER_COLORS = [
    '#62d6c5', '#78a9ff', '#d59cff', '#ff9f8a', '#f2c45e', '#8bd17c'
] as const;

export type SpeakerDictionary = Record<string, unknown>;

export function speakerColorMap(rows: readonly Pick<DaihonRow, 'speaker'>[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const row of rows) {
        const speaker = row.speaker;
        if (!speaker || result.has(speaker)) continue;
        result.set(speaker, SPEAKER_COLORS[result.size % SPEAKER_COLORS.length]);
    }
    return result;
}

export function speakerLabel(speakerId: string, dictionary: SpeakerDictionary): string {
    const value = dictionary[speakerId];
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && !Array.isArray(value)
        && typeof (value as { name?: unknown }).name === 'string') {
        return (value as { name: string }).name;
    }
    return speakerId;
}

export function parseSpeakerDictionary(source: string): SpeakerDictionary {
    try {
        const value = JSON.parse(source) as { speakers?: unknown };
        return value && typeof value === 'object' && value.speakers && typeof value.speakers === 'object'
            && !Array.isArray(value.speakers) ? value.speakers as SpeakerDictionary : {};
    } catch {
        return {};
    }
}
