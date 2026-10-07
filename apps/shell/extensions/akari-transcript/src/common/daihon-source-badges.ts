import type { CaptionSource } from './caption-source-eligibility';

export interface SourceBadgeRow {
    id: string;
    src: string | null;
    start: number;
    outStart: number | null;
    text: string;
}

const VIDEO_COLORS = ['#69b6f8', '#5a9ee6', '#80c8e8'];
const AUDIO_COLORS = ['#bd9af5', '#a884ec', '#cf9fd9'];

export function sourceBadgeColors(sources: readonly CaptionSource[]): Map<string, string> {
    const colors = new Map<string, string>();
    const used = new Set<string>();
    for (const source of sources) {
        const audio = source.kind === 'audio' || /\.(wav|mp3|m4a|aac|flac|ogg|opus|aif|aiff|wma)$/iu.test(source.path);
        const preferred = audio ? AUDIO_COLORS : VIDEO_COLORS;
        const fallback = audio ? VIDEO_COLORS : AUDIO_COLORS;
        const palette = [...preferred, ...fallback];
        const color = palette.find(candidate => !used.has(candidate)) ?? palette[colors.size % palette.length];
        colors.set(source.id, color);
        used.add(color);
    }
    return colors;
}

export function sourceBadgeName(source: CaptionSource): string {
    return source.path.replace(/\\/gu, '/').split('/').pop() || source.path;
}

export function rowSourceIds(sources: readonly CaptionSource[], rows: readonly SourceBadgeRow[]): string[] {
    const present = new Set(rows.map(row => row.src).filter((id): id is string => !!id));
    return sources.filter(source => present.has(source.id)).map(source => source.id);
}

export function rowSourceDotColor(colors: ReadonlyMap<string, string>, rowSourceIds: readonly string[], id: string | undefined): string | null {
    if (rowSourceIds.length < 2 || !id) return null;
    return colors.get(id) ?? null;
}

export function visibleSourceIds(ids: readonly string[], hidden: readonly string[]): string[] {
    const hiddenSet = new Set(hidden);
    const visible = ids.filter(id => !hiddenSet.has(id));
    return visible.length || !ids.length ? visible : [ids[0]];
}

export function toggleSourceId(ids: readonly string[], visible: readonly string[], id: string): string[] {
    if (!ids.includes(id)) return [...visible];
    if (visible.includes(id)) return visible.length > 1 ? visible.filter(candidate => candidate !== id) : [...visible];
    return ids.filter(candidate => visible.includes(candidate) || candidate === id);
}

export function sourceRowVisible(ids: readonly string[], visible: readonly string[], id: string | undefined): boolean {
    return !id || !ids.includes(id) || visible.includes(id);
}

function normalizedSpeech(text: string): string {
    return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function duplicateSpeechPairs(rows: readonly SourceBadgeRow[]): Map<string, string> {
    const pairs = new Map<string, string>();
    const groups = new Map<string, SourceBadgeRow[]>();
    for (const row of rows) {
        if (!row.src || row.outStart === null) continue;
        const text = normalizedSpeech(row.text);
        if (!text) continue;
        const matches = groups.get(text) ?? [];
        let nearest: SourceBadgeRow | undefined;
        for (const candidate of matches) {
            if (candidate.src === row.src || pairs.has(candidate.id)) continue;
            if (Math.abs(candidate.outStart! - row.outStart) <= 0.3 + 1e-9
                && (!nearest || Math.abs(candidate.outStart! - row.outStart) < Math.abs(nearest.outStart! - row.outStart))) {
                nearest = candidate;
            }
        }
        if (nearest) {
            pairs.set(row.id, nearest.id);
            pairs.set(nearest.id, row.id);
        }
        matches.push(row);
        groups.set(text, matches);
    }
    return pairs;
}
