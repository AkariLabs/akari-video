import type { TranscribeArtifacts } from 'akari-project/lib/common/akari-project-protocol';
import { normalizedCaptionPath } from './caption-source-eligibility';

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
    return [timestamp, backend, ...(transcript ? [`${transcript.length} 行`] : [])].filter(Boolean).join(' · ');
}

/** Keep artifact timestamps verbatim so the summary is independent of locale/timezone. */
export function transcribeSummary(artifacts: Pick<TranscribeArtifacts, 'transcripts' | 'diff'>,
    alreadyTranscribed = false, fallback?: string): string[] {
    const lines = artifacts.transcripts.map(transcript =>
        [transcript.generated_at, transcript.backend, `${transcript.segments.length} 行`].filter(Boolean).join(' · '));
    if (!lines.length && alreadyTranscribed) lines.push(fallback ?? '文字起こし済み · 日時・エンジン・行数の記録なし');
    if (lines.length || artifacts.diff) lines.push(`比べる組: ${artifacts.diff?.engines.length ? artifacts.diff.engines.join(' / ') : 'なし'}`);
    return lines;
}

export function initialEngineSelection(backend: string, compareSet: readonly string[]): { backend: string; compareSet: string[] } {
    return { backend: backend || 'auto', compareSet: [...new Set(compareSet)] };
}

/** JSON projections of the status RPCs; no dependency on the surfaces extension. */
export interface TranscribeToolStatus {
    id: string;
    available: boolean;
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
    const ready = (): TranscribeAvailability => ({ state: 'available', label: '使える', needs: [] });
    const needs = (items: string[]): TranscribeAvailability => ({ state: 'needs', label: `準備が要る（${items.join('・')}）`, needs: items });
    if (backend.startsWith('cloud:')) {
        const providerId = backend === 'cloud:scribe' ? 'elevenlabs' : backend.slice(6);
        const connection = connections.find(row => row.id === providerId);
        if (!connection) { return needs(['接続状況を確認できませんでした']); }
        if (!connection.configured || connection.doctor.status === 'unconfigured') {
            return { state: 'unconfigured', label: '鍵が未登録', needs: [] };
        }
        if (connection.doctor.status === 'ok') { return ready(); }
        return needs([connection.doctor.status === 'unauthorized' ? '鍵の接続確認に失敗' : '接続確認が必要']);
    }
    const tool = tools.find(row => row.id === (backend === 'whisper-cpp' ? 'whisper' : backend));
    if (!tool) { return needs(['道具の状態を確認できませんでした']); }
    if (tool.unsupported) { return { state: 'unsupported', label: 'この OS では使えない', needs: tool.needs ?? [] }; }
    if (tool.available) { return ready(); }
    if (tool.needs?.length) { return needs(tool.needs); }
    if (backend === 'whisper-cpp') {
        return needs([...(!tool.executable ? ['本体が無い'] : []), ...(!tool.model?.available ? ['モデルが無い'] : [])]);
    }
    return needs(['利用条件の確認が必要']);
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
    const items: TranscribeEngineItem[] = [{ id: 'auto', label: 'おまかせ（ローカル優先）', place: 'ローカル優先', price: '無料',
        availability: { state: 'available', label: '使える' }, hourlyUsd: 0, ...(!known || preferred === 'auto' ? { default: true as const } : {}) }];
    for (const card of cards) {
        const availability = transcribeEngineAvailability(card.id, tools, connections);
        items.push({ id: card.id, label: card.label, place: card.place,
            price: card.hourlyUsd ? `$${card.hourlyUsd.toFixed(2)} / 時` : '無料',
            availability: { state: availability.state === 'available' ? 'available'
                : availability.state === 'needs' ? 'needs' : 'unavailable', label: availability.label },
            hourlyUsd: card.hourlyUsd, ...(card.id === preferred ? { default: true as const } : {}) });
    }
    return items;
}
