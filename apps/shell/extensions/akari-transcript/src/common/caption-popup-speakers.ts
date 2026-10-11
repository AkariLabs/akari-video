import { t } from '../browser/transcript-text';
import type { TranscribeToolStatus } from './transcribe-steps';

export type SpeakerCount = 'auto' | '1' | '2' | '3' | '4';
export interface SpeakerChoice {
    split: boolean;
    count: SpeakerCount;
    identify: boolean;
    people?: string[];
}
export interface SpeakerSuggestion {
    person?: string;
    name?: string;
    score: number;
    level: 'strong' | 'maybe' | 'none';
}
export interface VoiceSpeaker { seconds: number; suggestion?: SpeakerSuggestion }
export interface VoicesSidecar {
    speakers: Record<string, VoiceSpeaker>;
    decided: Record<string, string>;
    requested?: number | 'auto';
    fallback?: boolean;
    shortSpeakers?: string[];
}
export interface SpeakerReviewRow {
    id: string;
    seconds: number;
    firstLine?: string;
    firstSpan?: { start: number; end: number };
    suggestion?: SpeakerSuggestion;
    decided?: string;
    shortNote?: string;
}

export const VOICE_ENGINE_DOWNLOAD_MB = 160; // 実測（取得する npm 包とモデル 3 つの合計）。
export const SPEAKER_COLORS = ['#3b82f6', '#a855f7', '#14b8a6', '#f59e0b'];

export function voiceInstallFailure(result: { outcome?: string; message?: string } | undefined): string | undefined {
    return result?.outcome === 'installed' ? undefined : result?.message || t('transcript.captionPopup.speakers.prepareFailed.error');
}

export function speakerFallbackMessage(voices: VoicesSidecar | undefined, used: number): string | undefined {
    return voices?.fallback === true && typeof voices.requested === 'number'
        ? t('transcript.captionPopup.speakers.fallback.message', { requested: voices.requested, used }) : undefined;
}

export function speakerShortNote(voices: VoicesSidecar | undefined, id: string): string | undefined {
    return voices?.shortSpeakers?.includes(id) ? t('transcript.captionPopup.speakers.shortVoice.note') : undefined;
}

export function captionPopupStepNames(split: boolean): string[] {
    return [t('transcript.captionPopup.dialog.assetsLabel'), t('transcript.captionPopup.dialog.transcriptionMethodLabel'), t('transcript.captionPopup.dialog.transcribeLabel'), ...(split ? [t('transcript.captionPopup.dialog.reviewSpeakersAction')] : []), t('transcript.captionPopup.dialog.finishLabel')];
}

export function voiceEngineReady(tools: readonly TranscribeToolStatus[]): boolean {
    return tools.some(tool => tool.id === 'voice' && tool.available === true);
}

export function analysisHasSpeakers(analysis: unknown): boolean {
    if (!analysis || typeof analysis !== 'object') return false;
    const tracks = (analysis as { tracks?: unknown }).tracks;
    if (!tracks || typeof tracks !== 'object') return false;
    const speakers = (tracks as { speakers?: unknown }).speakers;
    return Array.isArray(speakers) && speakers.length > 0;
}

export function voiceGateBlocks({ split, needsRun, availabilityLoaded, engineReady }: {
    split: boolean; needsRun: boolean; availabilityLoaded: boolean; engineReady: boolean
}): boolean {
    return split && needsRun && availabilityLoaded && !engineReady;
}

export function speakerTranscribeOptions(choice: SpeakerChoice): {
    diarize?: true; speakers?: SpeakerCount; identify?: boolean; people?: string[]
} {
    if (!choice.split) return {};
    return { diarize: true, speakers: choice.count, identify: choice.identify,
        ...(choice.people === undefined ? {} : { people: choice.people }) };
}

export function channelPersonVoiceSampleCount(source: string, id: string): number {
    try {
        const root = JSON.parse(source) as { entries?: Array<{ id?: string; voice?: { samples?: unknown[] } }> };
        const samples = root.entries?.find(entry => entry.id === id)?.voice?.samples;
        return Array.isArray(samples) ? samples.filter(sample => !!sample && typeof sample === 'object'
            && typeof (sample as { file?: unknown }).file === 'string' && !!(sample as { file: string }).file
            && ['self', 'subject'].includes((sample as { consent?: string }).consent ?? '')).length : 0;
    } catch { return 0; }
}

export function parseVoicesSidecar(source: string): VoicesSidecar | undefined {
    try {
        const root = JSON.parse(source) as Record<string, unknown>;
        if (root.schema !== 'akari.voices/0' || !root.speakers || typeof root.speakers !== 'object') return undefined;
        const speakers: Record<string, VoiceSpeaker> = {};
        for (const [id, raw] of Object.entries(root.speakers)) {
            if (!raw || typeof raw !== 'object') continue;
            const value = raw as Record<string, unknown>;
            const suggestion = value.suggestion as SpeakerSuggestion | undefined;
            speakers[id] = { seconds: typeof value.seconds === 'number' ? value.seconds : 0,
                ...(suggestion && typeof suggestion === 'object' && ['strong', 'maybe', 'none'].includes(suggestion.level)
                    ? { suggestion: { person: suggestion.person, name: suggestion.name,
                        score: suggestion.score, level: suggestion.level } } : {}) };
        }
        const decided = root.decided && typeof root.decided === 'object' ? root.decided as Record<string, string> : {};
        return { speakers, decided,
            ...(typeof root.requested === 'number' || root.requested === 'auto' ? { requested: root.requested as number | 'auto' } : {}),
            ...(typeof root.fallback === 'boolean' ? { fallback: root.fallback } : {}),
            ...(Array.isArray(root.shortSpeakers) && root.shortSpeakers.every(id => typeof id === 'string')
                ? { shortSpeakers: root.shortSpeakers as string[] } : {}) };
    } catch { return undefined; }
}

export function speakerReviewRows(voices: VoicesSidecar | undefined, analysis: unknown): SpeakerReviewRow[] {
    const root = analysis && typeof analysis === 'object' ? analysis as Record<string, unknown> : {};
    const tracks = root.tracks && typeof root.tracks === 'object' ? root.tracks as Record<string, unknown> : {};
    const rows = new Map<string, SpeakerReviewRow>();
    for (const [id, speaker] of Object.entries(voices?.speakers ?? {})) {
        rows.set(id, { id, seconds: speaker.seconds, suggestion: speaker.suggestion, decided: voices?.decided[id],
            shortNote: speakerShortNote(voices, id) });
    }
    for (const track of Array.isArray(tracks.speakers) ? tracks.speakers : []) {
        if (!track || typeof track.id !== 'string' || !Array.isArray(track.spans)) continue;
        const spans = track.spans.flatMap((span: unknown) => {
            const pair = Array.isArray(span) ? { start: span[0], end: span[1] } : span as { start?: unknown; end?: unknown };
            return typeof pair?.start === 'number' && typeof pair?.end === 'number' && pair.end > pair.start
                ? [{ start: pair.start, end: pair.end }] : [];
        });
        const existing: SpeakerReviewRow = rows.get(track.id) ?? { id: track.id,
            seconds: spans.reduce((sum: number, span: { start: number; end: number }) => sum + span.end - span.start, 0) };
        existing.firstSpan = spans[0];
        existing.shortNote = speakerShortNote(voices, track.id);
        rows.set(track.id, existing);
    }
    for (const line of Array.isArray(root.transcript) ? root.transcript : []) {
        if (!line || typeof line.speaker !== 'string') continue;
        const row = rows.get(line.speaker);
        if (row && !row.firstLine && typeof line.text === 'string') {
            row.firstLine = line.text;
            if (!row.firstSpan && typeof line.start === 'number' && typeof line.end === 'number') {
                row.firstSpan = { start: line.start, end: line.end };
            }
        }
    }
    return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function mergeVoicesDecided(source: string, id: string, person: string | undefined): string {
    const root = JSON.parse(source) as Record<string, unknown>;
    if (person) root.decided = { ...(root.decided as Record<string, unknown> ?? {}), [id]: person };
    return `${JSON.stringify(root, null, 2)}\n`;
}

export function clearVoicesDecided(source: string, id: string): string {
    const root = JSON.parse(source) as Record<string, unknown>;
    const decided = { ...(root.decided as Record<string, unknown> ?? {}) };
    delete decided[id];
    root.decided = decided;
    return `${JSON.stringify(root, null, 2)}\n`;
}
