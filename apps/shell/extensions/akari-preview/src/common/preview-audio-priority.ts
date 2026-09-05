export interface PromotePreviewAudioSidecarsRequest {
    projectRootUri: string;
    keys?: string[];
    sourcePaths?: string[];
    workspaceRoots?: string[];
}

export interface PromotePreviewAudioSidecarsResult {
    promoted: string[];
}

export interface PreviewAudioPriorityItem {
    kind: 'speech' | 'bgm' | 'sfx' | 'narration';
    state: string;
    at?: number;
    durationSec?: number;
}

// Mirrored from preview-server; the parity test exercises both implementations.
export function selectPreviewAudioItemsAt<T extends PreviewAudioPriorityItem>(items: readonly T[], t: number): T[] {
    if (!Number.isFinite(t)) return [];
    return items.filter(item => {
        if (item.state !== 'queued' && item.state !== 'generating') return false;
        if (item.kind === 'bgm' || item.at == null) return true;
        const at = item.at ?? 0;
        return at <= t && (!(Number.isFinite(item.durationSec) && item.durationSec! > 0)
            || t < at + item.durationSec!);
    }).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)
        || Number(a.kind === 'speech') - Number(b.kind === 'speech'));
}
