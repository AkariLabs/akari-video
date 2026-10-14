import { t } from '../browser/transcript-text';
export function captionsButtonLabel(_states: readonly ('none' | 'running' | 'done')[]): string {
    return t('transcript.daihon.captionsButton.ongoingCreateCaptionsLabel');
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
    const protectedPart = preview.protected > 0 ? t('transcript.daihon.captionsButton.leadingManuallyEditedLinesProtectedWithCountLabel', { value1: preview.protected, n: preview.protected }) : '';
    return t('transcript.daihon.captionsButton.newChangedRemovedWithValuesLabel', { value1: preview.added, value2: preview.changed, value3: protectedPart, value4: preview.removed });
}

export function captionsAppliedLine(preview: CaptionsApplyPreview): string {
    return t('transcript.daihon.captionsButton.appliedScriptNewChangedWithValuesLabel', { value1: preview.added, value2: preview.changed });
}

export function captionsRetimeMovedWords(value: unknown): number | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const moved = (value as { moved_words?: unknown }).moved_words;
    return typeof moved === 'number' && Number.isFinite(moved) && moved >= 0 ? moved : undefined;
}

export function captionsRetimeLine(movedWords: number, value?: unknown): string {
    const summary = value && typeof value === 'object' ? value as {
        clamped_pairs?: unknown;
        overlaps_left?: unknown;
    } : {};
    const clampedPairs = typeof summary.clamped_pairs === 'number' && Number.isFinite(summary.clamped_pairs)
        ? summary.clamped_pairs : 0;
    const overlapsLeft = typeof summary.overlaps_left === 'number' && Number.isFinite(summary.overlaps_left)
        ? summary.overlaps_left : 0;
    const clampedPart = clampedPairs >= 1 ? t('transcript.daihon.captionsButton.leadingResolvedOverlapsWithCountLabel', { value1: clampedPairs }) : '';
    const overlapsPart = overlapsLeft >= 1 ? t('transcript.daihon.captionsButton.leadingOverlapsRemainWithCountLabel', { value1: overlapsLeft }) : '';
    return t('transcript.daihon.captionsButton.movedWordsWithValuesLabel', { value1: movedWords, n: movedWords, value2: clampedPart, value3: overlapsPart });
}

export function captionsRetimeHistoryLabel(movedWords: number): string {
    return t('transcript.daihon.captionsButton.alignSpeechWordsWithCountLabel', { value1: movedWords, n: movedWords });
}

export function captionsApplyHistoryLabel(preview: CaptionsApplyPreview): string {
    return t('transcript.daihon.captionsButton.applyToScriptNewChangedLabel', { value1: preview.added, value2: preview.changed });
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
