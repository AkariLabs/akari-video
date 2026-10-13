import { t } from '@akari-video/i18n';
import { describeNextDraft, type GenerationMetaV1 } from '@akari-video/edit-store';
import type { GenerationDraft, GenerationValidation } from './generation-fields';

export interface GenerationBatchItem {
    itemId: string;
    name: string;
    duration: number;
    start: number;
    track?: number;
    visual: boolean;
    sourcePath?: string;
    meta?: GenerationMetaV1;
    /** Effective video job state; a completed still is not a completed video. */
    state?: string;
    draft?: GenerationDraft;
    validation?: GenerationValidation;
}

export interface GenerationBatchRow extends GenerationBatchItem {
    eligible: boolean;
    badge: string;
    estimate: number | null;
}

export function buildGenerationBatch(items: readonly GenerationBatchItem[]): {
    rows: GenerationBatchRow[]; count: number; total: number; unknown: boolean; asOf: string; summary: string;
} {
    const rows = [...items].sort((a, b) => a.start - b.start || (a.track ?? 0) - (b.track ?? 0)).map(item => {
        let eligible = false;
        let badge: string;
        if (!item.visual) badge = t('inspector.generationBatch.label.notEligible');
        else if (item.state === 'generating') badge = t('inspector.generationBatch.status.generating');
        else if (item.state === 'stale') badge = t('inspector.generationBatch.label.noResponseNotEligible');
        else if (item.state === 'done') badge = t('inspector.generationBatch.label.generated');
        else if (item.state === 'orphan') badge = t('inspector.generationBatch.label.inputErrorAssetMismatch');
        else if (item.meta?.status === 'planned' && !describeNextDraft(item.meta)?.prompt.trim()) badge = t('inspector.generationBatch.label.emptyFrameNoPrompt');
        else if (!describeNextDraft(item.meta)) {
            badge = item.meta?.status === 'planned' ? t('inspector.generationBatch.label.emptyFrameNoPrompt') : t('inspector.generationBatch.label.keepAsImageNotEligible');
        } else if (!item.validation) badge = t('inspector.generationBatch.status.checkingEstimate');
        else if (!item.draft || !item.validation.ok) {
            const reason = item.validation.messages?.find(message => message.level === 'error')?.text
                ?? t('inspector.generationBatch.action.checkVideoGenerationInput');
            badge = t('inspector.generationBatch.label.inputError', { reason: reason.replace(/\s+/gu, ' ') });
        } else {
            eligible = true;
            badge = item.state === 'failed' ? t('inspector.generationBatch.action.tryAgain') : t('inspector.generationBatch.action.createVideo');
        }
        const value = item.validation?.cost?.estimate_usd;
        const estimate = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
        if (eligible) badge += ` · ${estimate === null ? t('inspector.generationBatch.status.estimateUnavailable') : `$${estimate.toFixed(2)}`}`;
        return { ...item, eligible, badge, estimate };
    });
    const targets = rows.filter(row => row.eligible);
    const total = targets.reduce((sum, row) => sum + (row.estimate ?? 0), 0);
    const unknown = targets.some(row => row.estimate === null);
    const asOf = [...new Set(targets.map(row => row.validation?.cost?.as_of ?? t('inspector.generationBatch.label.unknown')))].join(' / ') || t('inspector.generationBatch.label.unknown');
    return { rows, count: targets.length, total, unknown, asOf,
        summary: t('inspector.generationBatch.summary.videosCreate', { count: targets.length, n: targets.length, estimate: unknown ? t('inspector.generationBatch.error.someEstimatesUnavailableKnownCosts', { amount: total.toFixed(2) }) : t('inspector.generationBatch.label.total', { amount: total.toFixed(2) }) }) };
}

export type GenerationBatchProgressCode = 'waiting' | 'generating' | 'done' | 'failed' | 'cancelled';
export type GenerationBatchProgress = '待ち' | '生成中' | '完了' | '失敗' | '中止';

export function generationBatchProgressLabel(code: GenerationBatchProgressCode): string {
    switch (code) {
        case 'waiting': return t('inspector.generationBatch.progress.waiting');
        case 'generating': return t('inspector.generationBatch.progress.generating');
        case 'done': return t('inspector.generationBatch.progress.done');
        case 'failed': return t('inspector.generationBatch.progress.failed');
        case 'cancelled': return t('inspector.generationBatch.progress.cancelled');
    }
}

/** Start may return a job handle immediately; wait must settle only once that job has ended. */
export async function executeGenerationBatch<T>(options: {
    rows: readonly GenerationBatchRow[];
    projectRootUri: string;
    approved: boolean;
    start: (request: { projectRootUri: string; itemId: string; approved: true }) => T | Promise<T>;
    wait: (handle: T) => Promise<{ ok: boolean; reason?: string }>;
    stopped: () => boolean;
    progress: (itemId: string, state: GenerationBatchProgress, reason?: string) => void;
}): Promise<void> {
    if (options.approved !== true) return;
    // Copy the approved queue: selection changes cannot mutate it.
    const targets = [...options.rows].filter(row => row.eligible)
        .sort((a, b) => a.start - b.start || (a.track ?? 0) - (b.track ?? 0));
    for (const row of targets) options.progress(row.itemId, '待ち');
    for (const row of targets) {
        if (options.stopped()) {
            options.progress(row.itemId, '中止');
            continue;
        }
        options.progress(row.itemId, '生成中');
        try {
            const handle = await options.start({ projectRootUri: options.projectRootUri, itemId: row.itemId, approved: true });
            const result = await options.wait(handle);
            options.progress(row.itemId, result.ok ? '完了' : '失敗', result.reason);
        } catch (error) {
            options.progress(row.itemId, '失敗', error instanceof Error ? error.message : String(error));
        }
    }
}
