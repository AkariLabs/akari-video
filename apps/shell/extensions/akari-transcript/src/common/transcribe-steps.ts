import type { EngineTranscript, MaterialTranscriptEvent, TranscribeArtifacts, TranscribeOptions } from 'akari-project/lib/common/akari-project-protocol';

export interface TranscribeDialogResult extends TranscribeOptions { transcribeFirst: boolean }
export type TranscribeExit = 'reuse' | 'redo' | 'compare';
export type TranscribeMode = 'simple' | 'advanced';

/** Selection affects actions, but never exposes comparison controls in simple mode. */
export function transcribeModeView(mode: unknown, alreadyTranscribed: boolean, _selection: TranscribeOptions): {
    steps: boolean; compareToggle: boolean; radar: boolean; buttons: string[]; switchLink: string;
} {
    const advanced = mode === 'advanced';
    return {
        steps: advanced, compareToggle: advanced, radar: advanced,
        buttons: advanced ? (alreadyTranscribed ? ['このまま字幕へ', '起こし直す', '比べる'] : ['起こす ▸'])
            : (alreadyTranscribed ? ['台本へ', '起こし直す'] : ['起こす']),
        switchLink: advanced ? '簡単モードに戻す' : 'アドバンス（比較・差分）に切り替える'
    };
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
    return `${timestamp ?? '日時不明'} · ${backend ?? 'エンジン不明'} · ${transcript?.length ?? 0} 行`;
}

/** Keep artifact timestamps verbatim so the summary is independent of locale/timezone. */
export function transcribeSummary(artifacts: Pick<TranscribeArtifacts, 'transcripts' | 'diff'>,
    alreadyTranscribed = false, fallback?: string): string[] {
    const lines = artifacts.transcripts.map(transcript =>
        `${transcript.generated_at || '日時不明'} · ${transcript.backend || 'エンジン不明'} · ${transcript.segments.length} 行`);
    if (!lines.length && alreadyTranscribed) lines.push(fallback ?? '文字起こし済み · 日時・エンジン・行数の記録なし');
    if (lines.length || artifacts.diff) lines.push(`比べる組: ${artifacts.diff?.engines.length ? artifacts.diff.engines.join(' / ') : 'なし'}`);
    return lines;
}

/** A completed in-dialog run uses reuse; redo/compare delegate execution to buildCaptions. */
export function transcribeExitOptions(exit: TranscribeExit, selection: TranscribeOptions): TranscribeDialogResult | undefined {
    if (exit === 'reuse') return { transcribeFirst: false };
    const { compareSet: selected, ...options } = selection;
    if (exit === 'redo') return { ...options, backend: selection.backend || 'auto', compareSet: [], transcribeFirst: true };
    const compareSet = [...new Set(selected ?? [])];
    return compareSet.length >= 2 ? { ...options, compareSet, transcribeFirst: true } : undefined;
}

export const backendKey = (backend: string): string => backend.replace(/:/g, '-');
export interface TranscribeStepState {
    step: 1 | 2 | 3;
    engines: Record<string, 'waiting' | 'transcribing' | 'completed' | 'failed'>;
    completedOrder: string[];
    finished: boolean;
}
export function startTranscribeSteps(backends: readonly string[]): TranscribeStepState {
    return { step: 2, engines: Object.fromEntries(backends.map(backend => [backendKey(backend), 'waiting'])), completedOrder: [], finished: false };
}
export function advanceTranscribeSteps(state: TranscribeStepState, event: MaterialTranscriptEvent): TranscribeStepState {
    const next = { ...state, engines: { ...state.engines }, completedOrder: [...state.completedOrder] };
    const key = event.backend && backendKey(event.backend);
    if (key && key in next.engines) {
        if (event.status === 'cancelled') next.engines[key] = 'waiting';
        else if (event.status === 'completed') {
            next.engines[key] = 'completed';
            if (!next.completedOrder.includes(key)) next.completedOrder.push(key);
        } else if (event.status === 'failed') next.engines[key] = 'failed';
        else if (next.engines[key] === 'waiting') next.engines[key] = 'transcribing';
    }
    if (!key && event.status === 'cancelled') {
        for (const backend of Object.keys(next.engines)) {
            if (next.engines[backend] === 'transcribing') next.engines[backend] = 'waiting';
        }
    }
    if (event.stage === 'diffing' && event.status === 'completed') next.step = 3;
    if (!event.backend && event.stage === 'completed') next.finished = true;
    return next;
}
export function completedColumns(state: TranscribeStepState, transcripts: readonly EngineTranscript[]): EngineTranscript[] {
    return state.completedOrder.flatMap(key => transcripts.filter(transcript => backendKey(transcript.backend) === key));
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
