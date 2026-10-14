import { captionCommandHistory } from './caption-command-history';
import type { CaptionCommandResult, MigrateCaptionLookRequest, WriteEditSnapshotRequest,
    WriteBackResult } from '../common/akari-annotations-protocol';
import type { HistoryEntry } from './akari-edit-history-service';

type Diff = { path: string; before: unknown; after: unknown };
type Choice = 'fix' | 'later' | undefined;

export function changedCaptionLookRows(diff: readonly Diff[], beforeText: string | null): number {
    const changed = new Set<number>();
    for (const item of diff) {
        const match = /^captions\[(\d+)\]\./u.exec(item.path);
        if (match) changed.add(Number(match[1]));
    }
    if (!diff.some(item => item.path === 'emphasis_words') || !beforeText) return changed.size;
    try {
        const root = JSON.parse(beforeText) as { captions?: Array<{ src?: string; start?: number; end?: number;
            text?: string; display_text?: string }>; emphasis_words?: Array<{ id?: string; src?: string;
                t_start?: number; t_end?: number; word?: string }> };
        const change = diff.find(item => item.path === 'emphasis_words');
        const before = Array.isArray(change?.before) ? change.before as typeof root.emphasis_words : [];
        const after = Array.isArray(change?.after) ? change.after as typeof root.emphasis_words : [];
        const remaining = new Set(after?.map(item => item.id));
        for (const word of before ?? []) {
            if (remaining.has(word.id)) continue;
            const matches = (root.captions ?? []).flatMap((row, index) =>
                (!word.src || row.src === word.src) && typeof row.start === 'number'
                && typeof row.end === 'number' && typeof word.t_start === 'number'
                && typeof word.t_end === 'number' && row.start <= word.t_start
                && word.t_end <= row.end && typeof word.word === 'string'
                && (row.display_text ?? row.text ?? '').includes(word.word) ? [index] : []);
            if (matches.length === 1) changed.add(matches[0]);
        }
    } catch { /* A broken source is handled by the dry run. */ }
    return changed.size;
}

export function createCaptionLookMigrationOffer() {
    const shown = new Set<string>();
    return async (deps: {
        projectRootUri: string; editUri: string; captionsUri: string;
        captionsName: string; editName: string;
        getRemembered: (key: string) => Promise<boolean>;
        remember: (key: string) => Promise<void>;
        migrate: (request: MigrateCaptionLookRequest) => Promise<CaptionCommandResult>;
        ask: (count: number) => Promise<Choice>;
        notifySaved: (count: number) => Promise<boolean>;
        notifyConflict: () => void;
        pushHistory: (entry: HistoryEntry) => void;
        undo: (entry: HistoryEntry) => Promise<void>;
        write: (request: WriteEditSnapshotRequest) => Promise<WriteBackResult>;
        reload: () => Promise<void>;
        historyLabel: string;
    }): Promise<void> => {
        const key = `akari.captionLookMigrationOffer:${deps.projectRootUri}:${deps.captionsUri}`;
        if (shown.has(key)) return;
        shown.add(key);
        try {
            if (await deps.getRemembered(key)) return;
            const destination = { projectRootUri: deps.projectRootUri,
                editUri: deps.editUri, captionsUri: deps.captionsUri };
            const dry = await deps.migrate({ ...destination, input: { dryRun: true } });
            if (!dry.ok || !Array.isArray(dry.diff) || !dry.diff.length) return;
            const count = changedCaptionLookRows(dry.diff as Diff[],
                dry.before[deps.captionsName]?.text ?? null);
            if (count === 0) return;
            const choice = await deps.ask(count);
            if (choice === 'later') { await deps.remember(key); return; }
            if (choice !== 'fix') return;
            const result = await deps.migrate({ ...destination, input: {},
                expectedHashes: {
                    captions: dry.before[deps.captionsName]?.hash ?? null,
                    edit: dry.before[deps.editName]?.hash ?? null
                } });
            if (!result.ok) {
                if ('conflict' in result) {
                    await deps.reload();
                    deps.notifyConflict();
                }
                return;
            }
            await deps.remember(key);
            await deps.reload();
            if (!result.written.length) return;
            const entry = captionCommandHistory({ ...result,
                roles: { captions: deps.captionsName, edit: deps.editName } },
            deps.historyLabel, destination, deps.write, deps.reload);
            deps.pushHistory(entry);
            if (await deps.notifySaved(count)) await deps.undo(entry);
        } catch (error) {
            console.warn('[akari-annotations] caption look migration offer failed', error);
        }
    };
}

export const offerCaptionLookMigration = createCaptionLookMigrationOffer();
