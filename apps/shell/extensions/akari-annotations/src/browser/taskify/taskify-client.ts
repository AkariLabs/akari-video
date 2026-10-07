import { CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariTaskifyService, type AkariTaskifyClient, type AkariTaskifyService as Service,
    type TaskifyEnqueue, type TaskifyJobView } from '../../common/taskify-protocol';
import { TaskService } from '../tasks/task-service';

let currentService: Service | undefined;
let jobReceiver: ((jobs: TaskifyJobView[]) => void) | undefined;
const polling = new Map<string, ReturnType<typeof setTimeout>>();
const memoRoots = new Map<string, string>();
const memoAgents = new Map<string, 'claude' | 'codex'>();
export function taskifyService(): Service | undefined { return currentService; }
export const taskifyRpcClient: AkariTaskifyClient = { onJobsChanged: jobs => jobReceiver?.(jobs) };
const terminal = (state: string): boolean => ['done', 'failed', 'blocked', 'cancelled'].includes(state);
function watchJob(root: string, jobId: string): void {
    if (polling.has(jobId)) return;
    const poll = async (): Promise<void> => {
        try {
            const jobs = await currentService?.list(root);
            if (jobs) {
                jobReceiver?.(jobs);
                if (jobs.some(job => job.jobId === jobId && terminal(job.state))) { polling.delete(jobId); return; }
            }
        } catch { /* RPC notification may still arrive; retry the read. */ }
        polling.set(jobId, setTimeout(() => { void poll(); }, 1000));
    };
    polling.set(jobId, setTimeout(() => { void poll(); }, 1000));
}
async function announceJob(result: { jobId: string }, root: string, memoId: string,
    agent: 'claude' | 'codex'): Promise<void> {
    memoRoots.set(memoId, root); memoAgents.set(memoId, agent);
    jobReceiver?.([{ jobId: result.jobId, memoId, state: 'queued',
        revision: Number(/-r(\d+)$/.exec(result.jobId)?.[1] ?? 1), projectRootUri: root, agent }]);
    try { jobReceiver?.(await currentService?.list(root) ?? []); }
    catch { /* The immediate queued event stays visible until the next read. */ }
    watchJob(root, result.jobId);
}
export async function enqueueTaskify(request: TaskifyEnqueue, agent: 'claude' | 'codex'): Promise<{ jobId: string }> {
    if (!currentService) throw new Error('取り込み係につながっていません。');
    const result = await currentService.enqueue(request);
    await announceJob(result, request.projectRootUri, request.memoId, agent);
    return result;
}
@injectable()
export class TaskifyClient implements AkariTaskifyClient, FrontendApplicationContribution, CommandContribution {
    @inject(AkariTaskifyService) private readonly service!: Service;
    @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
    @inject(TaskService) private readonly tasks!: TaskService;
    private previous = new Set<string>();
    onStart(): void {
        try { if (window.localStorage.getItem('akari.vibePreview.enabled') !== '1') return; }
        catch { return; }
        currentService = this.service;
        jobReceiver = jobs => this.onJobsChanged(jobs);
        window.addEventListener('akari.taskify.retry', event => {
            const id = (event as CustomEvent<{ jobId: string }>).detail?.jobId;
            if (id) void this.service.retry(id);
        });
        window.addEventListener('akari.taskify.cancel', event => {
            const id = (event as CustomEvent<{ jobId: string }>).detail?.jobId;
            if (id) void this.service.cancel(id);
        });
        window.addEventListener('akari.taskify.rerun', event => {
            const detail = (event as CustomEvent<{ memoId?: string; careful?: boolean }>).detail;
            if (!detail || !/^c-\d{4,}$/.test(detail.memoId ?? '')) return;
            const root = memoRoots.get(detail.memoId!) ?? this.workspace.tryGetRoots()[0]?.resource.toString();
            if (!root) return;
            void this.service.rerun(root, detail.memoId!, { careful: detail.careful === true })
                .then(result => announceJob(result, root, detail.memoId!, memoAgents.get(detail.memoId!) ?? 'claude'));
        });
        const root = this.workspace.tryGetRoots()[0]?.resource.toString();
        if (root) void this.service.list(root).then(jobs => {
            this.onJobsChanged(jobs);
            for (const job of jobs) if (job.state === 'queued' || job.state === 'running') watchJob(root, job.jobId);
        });
    }
    onJobsChanged(jobs: TaskifyJobView[]): void {
        for (const job of jobs) { memoRoots.set(job.memoId, job.projectRootUri); memoAgents.set(job.memoId, job.agent); }
        window.dispatchEvent(new CustomEvent('akari.taskify.jobs', { detail: { jobs } }));
        for (const job of jobs) if (terminal(job.state)) {
            const timer = polling.get(job.jobId);
            if (timer) clearTimeout(timer);
            polling.delete(job.jobId);
        }
        for (const job of jobs) if (job.state === 'done' && !this.previous.has(job.jobId)) {
            this.previous.add(job.jobId);
            window.dispatchEvent(new CustomEvent('akari.tasks.changed'));
        }
    }
    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({ id: 'akari.tasks.approve' }, { execute: (request: { id: string }) =>
            this.tasks.update(request.id, { needsConfirm: false, confirmedAt: new Date().toISOString() }, 'human') });
    }
}
