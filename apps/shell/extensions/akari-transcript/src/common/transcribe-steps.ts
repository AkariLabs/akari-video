import { t } from '../browser/transcript-text';
import type { TranscribeArtifacts } from 'akari-project/lib/common/akari-project-protocol';
import { normalizedCaptionPath } from './caption-source-eligibility';
export { channelPeopleLocation, mergeSpeakerDictionary, orderChannelPeople, parseChannelPeople } from './channel-people-reader';
export type { ChannelPerson } from './channel-people-reader';
export { analysisHasSpeakers, captionPopupStepNames, channelPersonVoiceSampleCount, clearVoicesDecided, mergeVoicesDecided,
    parseVoicesSidecar, speakerReviewRows, speakerTranscribeOptions, voiceEngineReady, voiceGateBlocks, voiceInstallFailure,
    speakerFallbackMessage,
    VOICE_ENGINE_DOWNLOAD_MB, SPEAKER_COLORS } from './caption-popup-speakers';
export type { SpeakerCount, SpeakerReviewRow } from './caption-popup-speakers';

export function popupInitialSourceIds(sources: readonly { id: string; path: string; status: string }[],
    initialPath: string | undefined, captionSourceIds: readonly string[]): string[] {
    if (initialPath) {
        const selected = sources.find(source => normalizedCaptionPath(source.path) === normalizedCaptionPath(initialPath)
            && source.status !== 'excluded');
        return selected ? [selected.id] : [];
    }
    const existing = sources.filter(source => source.status === 'voice' && captionSourceIds.includes(source.id));
    if (existing.length) return existing.map(source => source.id);
    const first = sources.find(source => source.status === 'voice');
    return first ? [first.id] : [];
}

export function popupCanNavigate(target: number, reached: number, running: boolean): boolean {
    return target >= 0 && target <= reached && (!running || target >= 2);
}

export function analysisTranscriptSummary(analysis: unknown): string | undefined {
    if (!analysis || typeof analysis !== 'object') return undefined;
    const value = analysis as Record<string, unknown>;
    const observations = Array.isArray(value.observations) ? value.observations : [];
    const observation = [...observations].reverse().find(item => !!item && typeof item === 'object'
        && (item as Record<string, unknown>).kind === 'transcribe') as Record<string, unknown> | undefined;
    const args = observation?.args && typeof observation.args === 'object'
        ? observation.args as Record<string, unknown> : undefined;
    const timestamp = [value.transcript_generated_at, value.generated_at, observation?.at]
        .find(item => typeof item === 'string' && item.length > 0) as string | undefined;
    const backend = [value.transcript_backend, args?.backend]
        .find(item => typeof item === 'string' && item.length > 0) as string | undefined;
    const transcript = Array.isArray(value.transcript) ? value.transcript : undefined;
    const hasTranscript = !!transcript;
    if (!timestamp && !backend && !hasTranscript) return undefined;
    return [timestamp, backend, ...(transcript ? [t('transcript.transcript.steps.linesWithCountLabel', { value1: transcript.length, n: transcript.length })] : [])].filter(Boolean).join(' · ');
}

/** Keep artifact timestamps verbatim so the summary is independent of locale/timezone. */
export function transcribeSummary(artifacts: Pick<TranscribeArtifacts, 'transcripts' | 'diff'>,
    alreadyTranscribed = false, fallback?: string): string[] {
    const lines = artifacts.transcripts.map(transcript =>
        [transcript.generated_at, transcript.backend, t('transcript.transcript.steps.linesWithCountLabel', { value1: transcript.segments.length, n: transcript.segments.length })].filter(Boolean).join(' · '));
    if (!lines.length && alreadyTranscribed) lines.push(fallback ?? t('transcript.transcript.steps.transcribedNoDateEngineLineCountRecordedLabel'));
    if (lines.length || artifacts.diff) lines.push(t('transcript.transcript.steps.comparisonPairsWithValueDescription', { value1: artifacts.diff?.engines.length ? artifacts.diff.engines.join(' / ') : t('transcript.transcript.steps.compareNone') }));
    return lines;
}

export function initialEngineSelection(backend: string, compareSet: readonly string[]): { backend: string; compareSet: string[] } {
    return { backend: backend || 'auto', compareSet: [...new Set(compareSet)] };
}

/** JSON projections of the status RPCs; no dependency on the surfaces extension. */
export interface TranscribeToolStatus {
    id: string;
    available: boolean;
    canIdentify?: boolean;
    unsupported?: boolean;
    needs?: string[];
    executable?: string;
    model?: { available: boolean; path?: string };
}
export interface TranscribeConnectionStatus {
    id: string;
    configured: boolean;
    doctor: { status: string; detail: string };
}
export interface TranscribeAvailability {
    state: 'available' | 'needs' | 'unconfigured' | 'unsupported';
    label: string;
    needs: string[];
}
export function transcribeEngineAvailability(backend: string, tools: readonly TranscribeToolStatus[],
    connections: readonly TranscribeConnectionStatus[]): TranscribeAvailability {
    const ready = (): TranscribeAvailability => ({ state: 'available', label: t('transcript.transcript.steps.availableLabel'), needs: [] });
    const needs = (items: string[]): TranscribeAvailability => ({ state: 'needs', label: t('transcript.transcript.steps.setupRequiredWithValueLabel', { value1: items.join(t('transcript.shared.list.separator')) }), needs: items });
    if (backend.startsWith('cloud:')) {
        const providerId = backend === 'cloud:scribe' ? 'elevenlabs' : backend.slice(6);
        const connection = connections.find(row => row.id === providerId);
        if (!connection) { return needs([t('transcript.transcript.steps.couldNotCheckConnectionStatusError')]); }
        if (!connection.configured || connection.doctor.status === 'unconfigured') {
            return { state: 'unconfigured', label: t('transcript.transcript.steps.keyNotRegisteredLabel'), needs: [] };
        }
        if (connection.doctor.status === 'ok') { return ready(); }
        return needs([connection.doctor.status === 'unauthorized' ? t('transcript.transcript.steps.keyConnectionCheckFailedLabel') : t('transcript.transcript.steps.connectionCheckRequiredLabel')]);
    }
    const tool = tools.find(row => row.id === (backend === 'whisper-cpp' ? 'whisper' : backend));
    if (!tool) { return needs([t('transcript.transcript.steps.couldNotCheckToolStatusError')]); }
    if (tool.unsupported) { return { state: 'unsupported', label: t('transcript.transcript.steps.unavailableOsLabel'), needs: tool.needs ?? [] }; }
    if (tool.available) { return ready(); }
    if (tool.needs?.length) { return needs(tool.needs); }
    if (backend === 'whisper-cpp') {
        return needs([...(!tool.executable ? [t('transcript.transcript.steps.executableMissingLabel')] : []), ...(!tool.model?.available ? [t('transcript.transcript.steps.modelMissingLabel')] : [])]);
    }
    return needs([t('transcript.transcript.steps.licenseReviewRequiredLabel')]);
}

export interface TranscribeEngineItem {
    id: string;
    label: string;
    place: string;
    price: string;
    availability: { state: 'available' | 'needs' | 'unavailable'; label: string };
    hourlyUsd: number;
    default?: true;
}

export function transcribeEngineList(cards: readonly { id: string; label: string; place: string; hourlyUsd: number }[],
    tools: readonly TranscribeToolStatus[], connections: readonly TranscribeConnectionStatus[],
    preferredBackend: string): TranscribeEngineItem[] {
    const preferred = initialEngineSelection(preferredBackend, []).backend;
    const known = preferred === 'auto' || cards.some(card => card.id === preferred);
    const items: TranscribeEngineItem[] = [{ id: 'auto', label: t('transcript.transcript.steps.autoPreferLocalLabel'), place: t('transcript.transcript.steps.preferLocalLabel'), price: t('transcript.transcript.steps.freeLabel'),
        availability: { state: 'available', label: t('transcript.transcript.steps.availableLabel') }, hourlyUsd: 0, ...(!known || preferred === 'auto' ? { default: true as const } : {}) }];
    for (const card of cards) {
        const availability = transcribeEngineAvailability(card.id, tools, connections);
        items.push({ id: card.id, label: card.label, place: card.place,
            price: card.hourlyUsd ? t('transcript.transcript.steps.hrWithRateLabel', { value1: card.hourlyUsd.toFixed(2) }) : t('transcript.transcript.steps.freeLabel'),
            availability: { state: availability.state === 'available' ? 'available'
                : availability.state === 'needs' ? 'needs' : 'unavailable', label: availability.label },
            hourlyUsd: card.hourlyUsd, ...(card.id === preferred ? { default: true as const } : {}) });
    }
    return items;
}
