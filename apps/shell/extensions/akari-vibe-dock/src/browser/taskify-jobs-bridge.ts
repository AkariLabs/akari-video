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
    private readonly reports = new Map<string, Disposable>();
    private readonly completed = new Set<string>();
    onStart(): void {
        window.addEventListener('akari.taskify.jobs', event => {
            const jobs = (event as CustomEvent<{ jobs?: Job[] }>).detail?.jobs ?? [];
            const active = new Set<string>();
            for (const job of jobs) {
                if (job.state === 'done') {
                    if (!this.completed.has(job.jobId)) {
                        this.completed.add(job.jobId);
                        const notice = this.dock.status.set(`タスク案が ${job.resultCount ?? 0} 件できました`, 'info', 'job');
                        setTimeout(() => notice.dispose(), 5000);
                    }
                    continue;
                }
                if (!['queued', 'running', 'blocked', 'failed'].includes(job.state)) continue;
                active.add(job.jobId);
                this.reports.get(job.jobId)?.dispose();
                const reason = taskifyJobReason(job);
                const action = job.state === 'blocked' || job.state === 'failed'
                    ? { label: job.error?.code === 'cli-missing' ? '導入' : job.error?.code === 'login' ? 'ログイン' : '再試行',
                        run: () => { window.dispatchEvent(new CustomEvent('akari.taskify.retry', { detail: { jobId: job.jobId } })); } }
                    : { label: 'やめる', run: () => { window.dispatchEvent(new CustomEvent('akari.taskify.cancel', { detail: { jobId: job.jobId } })); } };
                this.reports.set(job.jobId, this.dock.jobReporter.report({ id: job.jobId, label: `メモ ${job.memoId}`,
                    state: job.state as 'queued' | 'running' | 'blocked' | 'failed', reason, action }));
            }
            for (const [id, report] of this.reports) if (!active.has(id)) { report.dispose(); this.reports.delete(id); }
        });
    }
}
