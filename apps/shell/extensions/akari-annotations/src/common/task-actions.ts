import type { Task } from './akari-tasks-protocol';

export type TaskActionId = 'send' | 'dismiss' | 'markPasted' | 'confirm' | 'retry' | 'approve';
export interface TaskAction { id: TaskActionId; label: string; confirm?: boolean }

export function availableActions(task: Task): TaskAction[] {
    if (task.unknown) return [];
    const dismiss: TaskAction = { id: 'dismiss', label: '無視' };
    if (task.state === 'unsent') {
        return task.needsConfirm === true ? task.createdBy === 'ai'
            ? [{ id: 'approve', label: '承認する' }, { id: 'dismiss', label: '捨てる' }] : [dismiss] : [
            { id: 'send', label: '頼む', confirm: task.gate === 'ask' || task.risk === 'outbound' }, dismiss
        ];
    }
    if (task.state === 'sent') {
        const sentTo = task.sentTo as { route?: string; pasted?: boolean } | undefined;
        return sentTo?.route === 'clipboard' && sentTo.pasted !== true
            ? [{ id: 'markPasted', label: '貼り付けた' }, dismiss] : [dismiss];
    }
    if (task.state === 'review') {
        const ref = task.ref as { kind?: string } | undefined;
        return [
            { id: 'confirm', label: '確認した' },
            ...(task.source === 'lint' || !ref || ref.kind !== 'annotation'
                ? [{ id: 'retry' as const, label: 'もう一度' }] : []),
            dismiss
        ];
    }
    return [];
}
