import { t } from '@akari-video/i18n';
import type { WriteEditSnapshotRequest, WriteBackResult } from '../common/akari-annotations-protocol';
import type { HistoryEntry } from './akari-edit-history-service';

type Version = { hash: string | null; text: string | null };
export type CaptionCommandSnapshot = { written: string[]; roles?: { captions: string; edit?: string }; before: Record<string, Version>;
    after: Record<string, Version> };

/** 保存できた全文と hash から、比較付きの取り消し 1 件を作る。 */
export function captionCommandHistory(snapshot: CaptionCommandSnapshot, label: string,
    destination: Pick<WriteEditSnapshotRequest, 'editUri' | 'projectRootUri' | 'captionsUri'>,
    write: (request: WriteEditSnapshotRequest) => Promise<WriteBackResult>,
    reload: () => Promise<void>): HistoryEntry {
    const captionsName = snapshot.roles?.captions ?? 'captions.json';
    const editName = snapshot.roles?.edit ?? 'edit.json';
    const files = snapshot.written.filter(name => name === editName || name === captionsName);
    const restore = async (kind: 'undo' | 'redo'): Promise<void> => {
        const expected = kind === 'undo' ? snapshot.after : snapshot.before;
        const replacement = kind === 'undo' ? snapshot.before : snapshot.after;
        const request: WriteEditSnapshotRequest = { ...destination,
            expectedHashes: {
                ...(files.includes(editName) ? { edit: expected[editName].hash } : {}),
                ...(files.includes(captionsName) ? { captions: expected[captionsName].hash } : {})
            },
            ...(files.includes(editName) ? { editSource: replacement[editName].text ?? '' } : {}),
            ...(files.includes(captionsName) ? { captionsSource: replacement[captionsName].text ?? '' } : {})
        };
        const result = await write(request);
        if (result?.conflict) {
            await reload().catch(() => undefined);
            throw new Error(t(kind === 'undo'
                ? 'annotations.captionCommandHistory.text.cannotUndoAfterOtherChanges'
                : 'annotations.captionCommandHistory.text.cannotRedoAfterOtherChanges'));
        }
        await reload();
    };
    return { label, undo: () => restore('undo'), redo: () => restore('redo') };
}
