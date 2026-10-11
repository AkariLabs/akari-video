import { t } from './vibe-text';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common';
import { VibeDockState } from '../common/vibe-dock-state';

interface Job { jobId: string; memoId: string; state: string; waiting?: string; resultCount?: number; agent?: string;
    error?: { code: string; raw?: string } }
export function taskifyJobReason(job: Job): string | undefined {
    if (job.waiting === 'offline' || job.error?.code === 'offline') return t('vibe.tasks.jobBridge.waitingWhileOfflineMessage');
    switch (job.error?.code) {
        case 'cli-missing': return t('vibe.tasks.jobBridge.notFoundWithValueMessage', { value1: job.agent === 'codex' ? 'Codex' : 'Claude' });
        case 'login': return t('vibe.tasks.jobBridge.loginHasExpiredWithValueMessage', { value1: job.agent === 'codex' ? 'Codex' : 'Claude' });
        case 'rate-limit': return t('vibe.tasks.jobBridge.usageLimitAppearsHaveBeenReachedTryAgainLaterMessage');
        case 'bad-json': return t('vibe.tasks.jobBridge.couldNotReadAiResponseError');
        case 'timeout': return t('vibe.tasks.jobBridge.operationTimedOutMessage');
        case 'schema': return t('vibe.tasks.jobBridge.thereInternalConfigurationProblemMessage');
        case 'unknown': return t('vibe.tasks.jobBridge.couldNotCreateDraftError');
        default: return job.error ? t('vibe.tasks.jobBridge.couldNotCreateDraftError') : undefined;
    }
}
@injectable()
export class TaskifyJobsBridge implements FrontendApplicationContribution {
    @inject(VibeDockState) private readonly dock!: VibeDockState;
    private readonly completed = new Set<string>();
    private readonly dismissed = new Set<string>();
    private latestJobs: Job[] = [];
    private report?: Disposable;
    private selectJob(): void {
        const visible = this.latestJobs.filter(job => !this.dismissed.has(job.jobId)).reverse();
        const selected = visible.find(job => job.state === 'running')
            ?? visible.find(job => job.state === 'queued')
            ?? visible.find(job => job.state === 'blocked' || job.state === 'failed');
        this.report?.dispose(); this.report = undefined;
        if (!selected) return;
        const action = selected.state === 'failed'
            ? { label: t('vibe.tasks.jobBridge.closeLabel'), run: () => { this.dismissed.add(selected.jobId); this.selectJob(); } }
            : selected.state === 'blocked'
                ? { label: selected.error?.code === 'cli-missing' ? t('vibe.tasks.jobBridge.installLabel') : selected.error?.code === 'login' ? t('vibe.tasks.jobBridge.signLabel') : t('vibe.tasks.jobBridge.retryLabel'),
                    run: () => { window.dispatchEvent(new CustomEvent('akari.taskify.retry', { detail: { jobId: selected.jobId } })); } }
                : { label: t('vibe.tasks.jobBridge.cancelLabel'), run: () => {
                    window.dispatchEvent(new CustomEvent('akari.taskify.cancel', { detail: { jobId: selected.jobId } }));
                } };
        this.report = this.dock.jobReporter.report({ id: selected.jobId, label: t('vibe.tasks.jobBridge.noteWithValueLabel', { value1: selected.memoId }),
            state: selected.state as 'queued' | 'running' | 'blocked' | 'failed',
            reason: taskifyJobReason(selected), action });
    }
    onStart(): void {
        window.addEventListener('akari.taskify.jobs', event => {
            const jobs = (event as CustomEvent<{ jobs?: Job[] }>).detail?.jobs ?? [];
            for (const job of jobs) {
                if (job.state === 'done') {
                    if (!this.completed.has(job.jobId)) {
                        this.completed.add(job.jobId);
                        const notice = this.dock.status.set(t('vibe.tasks.jobBridge.createdTaskDraftsWithCountMessage', { value1: job.resultCount ?? 0 }), 'info', 'job');
                        setTimeout(() => notice.dispose(), 5000);
                    }
                }
            }
            this.latestJobs = jobs;
            this.selectJob();
        });
    }
}
