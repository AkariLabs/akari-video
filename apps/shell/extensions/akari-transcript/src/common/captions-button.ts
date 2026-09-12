export function captionsButtonLabel(states: readonly ('none' | 'running' | 'done')[]): string {
    return states.some(state => state === 'done') ? '字幕を作る' : '文字起こしして字幕を作る';
}

export interface CaptionsApplyPreview {
    added: number;
    changed: number;
    protected: number;
    removed: number;
    total: number;
}

export function parseCaptionsApplyPreview(value: unknown): CaptionsApplyPreview | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Record<keyof CaptionsApplyPreview, unknown>;
    const keys: (keyof CaptionsApplyPreview)[] = ['added', 'changed', 'protected', 'removed', 'total'];
    if (!keys.every(key => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]))) return undefined;
    return { added: candidate.added as number, changed: candidate.changed as number,
        protected: candidate.protected as number, removed: candidate.removed as number, total: candidate.total as number };
}

export function captionsApplyPreviewLine(preview: CaptionsApplyPreview): string {
    const protectedPart = preview.protected > 0 ? ` · 手直し済み ${preview.protected} 行は保護` : '';
    return `新規 ${preview.added} · 変更 ${preview.changed}${protectedPart} · 消える ${preview.removed}`;
}

export function captionsAppliedLine(preview: CaptionsApplyPreview): string {
    return `台本に反映した（新規 ${preview.added} · 変更 ${preview.changed}）`;
}

export function captionsApplyHistoryLabel(preview: CaptionsApplyPreview): string {
    return `台本へ反映（新規 ${preview.added} · 変更 ${preview.changed}）`;
}

export interface DaihonHistoryService {
    push(entry: { label: string; undo(): Promise<void>; redo(): Promise<void> }): unknown;
}

let historyService: DaihonHistoryService | undefined;

export function setDaihonHistoryService(service: DaihonHistoryService | undefined): void {
    historyService = service;
}

export function daihonHistoryService(): DaihonHistoryService | undefined {
    return historyService;
}
