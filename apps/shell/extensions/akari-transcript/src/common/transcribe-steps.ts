import type { EngineTranscript, MaterialTranscriptEvent } from 'akari-project/lib/common/akari-project-protocol';

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
        if (event.status === 'completed') {
            next.engines[key] = 'completed';
            if (!next.completedOrder.includes(key)) next.completedOrder.push(key);
        } else if (event.status === 'failed') next.engines[key] = 'failed';
        else if (next.engines[key] === 'waiting') next.engines[key] = 'transcribing';
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
