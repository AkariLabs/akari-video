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
        if (!item.visual) badge = '対象外';
        else if (item.state === 'generating') badge = '生成中';
        else if (item.state === 'stale') badge = '応答なし（対象外）';
        else if (item.state === 'done') badge = '生成済み';
        else if (item.state === 'orphan') badge = '入力エラー（素材が一致しません）';
        else if (item.meta?.status === 'planned' && !describeNextDraft(item.meta)?.prompt.trim()) badge = '空の枠（prompt なし）';
        else if (!describeNextDraft(item.meta)) {
            badge = item.meta?.status === 'planned' ? '空の枠（prompt なし）' : '画像のまま（対象外）';
        } else if (!item.validation) badge = '見積を確認中';
        else if (!item.draft || !item.validation.ok) {
            const reason = item.validation.messages?.find(message => message.level === 'error')?.text
                ?? '動画生成の入力を確認してください';
            badge = `入力エラー（${reason.replace(/\s+/gu, ' ')}）`;
        } else {
            eligible = true;
            badge = item.state === 'failed' ? 'もう一度' : '動画にする';
        }
        const value = item.validation?.cost?.estimate_usd;
        const estimate = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
        if (eligible) badge += ` · ${estimate === null ? '見積不可' : `$${estimate.toFixed(2)}`}`;
        return { ...item, eligible, badge, estimate };
    });
    const targets = rows.filter(row => row.eligible);
    const total = targets.reduce((sum, row) => sum + (row.estimate ?? 0), 0);
    const unknown = targets.some(row => row.estimate === null);
    const asOf = [...new Set(targets.map(row => row.validation?.cost?.as_of ?? '不明'))].join(' / ') || '不明';
    return { rows, count: targets.length, total, unknown, asOf,
        summary: `動画にするもの: ${targets.length} 本 · ${unknown ? `一部見積不可（見積可能分 $${total.toFixed(2)}）` : `合計 $${total.toFixed(2)}`}` };
}

export type GenerationBatchProgress = '待ち' | '生成中' | '完了' | '失敗' | '中止';

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
