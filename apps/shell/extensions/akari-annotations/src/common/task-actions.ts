import { t } from '@akari-video/i18n';
import type { Task } from './akari-tasks-protocol';

export type TaskActionId = 'send' | 'dismiss' | 'markPasted' | 'confirm' | 'retry' | 'approve';
export interface TaskAction { id: TaskActionId; label: string; confirm?: boolean }

export function availableActions(task: Task): TaskAction[] {
    if (task.unknown) return [];
    const dismiss: TaskAction = { id: 'dismiss', label: t('annotationscommon.taskActions.dismiss.label') };
    if (task.state === 'unsent') {
        return task.needsConfirm === true ? task.createdBy === 'ai'
            ? [{ id: 'approve', label: t('annotationscommon.taskActions.approve.label') }, { id: 'dismiss', label: t('annotationscommon.taskActions.discard.label') }] : [dismiss] : [
            { id: 'send', label: t('annotationscommon.taskActions.send.label'), confirm: task.gate === 'ask' || task.risk === 'outbound' }, dismiss
        ];
    }
    if (task.state === 'sent') {
        const sentTo = task.sentTo as { route?: string; pasted?: boolean } | undefined;
        return sentTo?.route === 'clipboard' && sentTo.pasted !== true
            ? [{ id: 'markPasted', label: t('annotationscommon.taskActions.markPasted.label') }, dismiss] : [dismiss];
    }
    if (task.state === 'review') {
        const ref = task.ref as { kind?: string } | undefined;
        return [
            { id: 'confirm', label: t('annotationscommon.taskActions.confirm.label') },
            ...(task.source === 'lint' || !ref || ref.kind !== 'annotation'
                ? [{ id: 'retry' as const, label: t('annotationscommon.taskActions.retry.label') }] : []),
            dismiss
        ];
    }
    return [];
}
