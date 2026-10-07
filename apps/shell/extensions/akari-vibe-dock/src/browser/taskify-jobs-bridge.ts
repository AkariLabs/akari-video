import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common';
import { VibeDockState } from '../common/vibe-dock-state';

interface Job { jobId: string; memoId: string; state: string; waiting?: string; resultCount?: number; agent?: string;
    error?: { code: string; raw?: string } }
export function taskifyJobReason(job: Job): string | undefined {
    if (job.waiting === 'offline' || job.error?.code === 'offline') return 'オフラインのため待っています';
    switch (job.error?.code) {
        case 'cli-missing': return `${job.agent === 'codex' ? 'Codex' : 'Claude'} が見つかりません`;
        case 'login': return `${job.agent === 'codex' ? 'Codex' : 'Claude'} のログインが切れています`;
        case 'rate-limit': return '利用の上限に達しているようです。しばらくして再試行してください';
        case 'bad-json': return 'AI の返事を読み取れませんでした';
        case 'timeout': return '時間内に終わりませんでした';
        case 'schema': return '内部の設定に問題があります';
        case 'unknown': return '案を作れませんでした';
        default: return job.error ? '案を作れませんでした' : undefined;
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
            ? { label: '閉じる', run: () => { this.dismissed.add(selected.jobId); this.selectJob(); } }
            : selected.state === 'blocked'
                ? { label: selected.error?.code === 'cli-missing' ? '導入' : selected.error?.code === 'login' ? 'ログイン' : '再試行',
                    run: () => { window.dispatchEvent(new CustomEvent('akari.taskify.retry', { detail: { jobId: selected.jobId } })); } }
                : { label: 'やめる', run: () => {
                    window.dispatchEvent(new CustomEvent('akari.taskify.cancel', { detail: { jobId: selected.jobId } }));
                } };
        this.report = this.dock.jobReporter.report({ id: selected.jobId, label: `メモ ${selected.memoId}`,
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
                        const notice = this.dock.status.set(`タスク案が ${job.resultCount ?? 0} 件できました`, 'info', 'job');
                        setTimeout(() => notice.dispose(), 5000);
                    }
                }
            }
            this.latestJobs = jobs;
            this.selectJob();
        });
    }
}
