import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AkariTaskifyService, type AkariTaskifyClient, type TaskifyEnqueue, type TaskifyJobView, type TaskifyPreview } from '../common/taskify-protocol';
import { AkariTasksServiceImpl } from './akari-tasks-service';
import { buildBundle, writeBundle } from './taskify/taskify-bundle';
import { defaultOnline, TaskifyQueue, type TaskifyJob } from './taskify/taskify-queue';
import { findTaskifyCli } from './taskify/taskify-cli';
import type { Agent } from './taskify/taskify-cli';
import { importTaskifyResult } from './taskify/taskify-import';
import type { InkDocument } from '../common/ink-model';
import type { RoughCanvasManifest } from '../common/rough-canvas-protocol';

const rootPath = (uri: string): string => {
    const value = new URI(uri); if (value.scheme !== 'file') throw new Error('プロジェクトの場所が不正です。');
    return resolve(value.path.fsPath());
};
const readOptional = async (path: string): Promise<string | undefined> => fs.readFile(path, 'utf8').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error;
});
const dataPng = (value: string): Buffer => {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 32_000_000) throw new Error('画像の形式が不正です。');
    const bytes = Buffer.from(value.split(',')[1], 'base64');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('画像の形式が不正です。');
    return bytes;
};
const taskifyAgent = async (): Promise<Agent> => {
    if (process.env.AKARI_TASKIFY_CLAUDE_BIN !== undefined) return 'claude';
    if (process.env.AKARI_TASKIFY_CODEX_BIN !== undefined) return 'codex';
    return await findTaskifyCli('claude') ? 'claude' : 'codex';
};
@injectable()
export class AkariTaskifyServiceImpl implements AkariTaskifyService {
    @inject(AkariTasksServiceImpl) private readonly tasks!: AkariTasksServiceImpl;
    private client?: AkariTaskifyClient;
    private readonly restored = new Set<string>();
    private readonly queue = new TaskifyQueue({
        findBin: findTaskifyCli, online: defaultOnline,
        rehydrate: async job => {
            const external = await fs.mkdtemp(join(tmpdir(), 'akari-taskify-'));
            for (const name of ['context.md', 'paper.png', 'backdrop.png']) {
                const content = await fs.readFile(join(job.jobDir, 'input', name)).catch(error => {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error;
                });
                if (content) await fs.writeFile(join(external, name), content);
            }
            job.inputDir = external;
        },
        edit: async job => {
            try { return JSON.parse((await readOptional(join(rootPath(job.projectRootUri), 'edit.json'))) ?? '{}'); }
            catch { return {}; }
        },
        importResult: (job, result) => importTaskifyResult(this.tasks, { projectRootUri: job.projectRootUri,
            memoId: job.memoId, jobId: job.jobId,
            paperPath: `review/canvas/${job.memoId}/taskify/r${job.revision}/input/paper.png`, result }),
        changed: jobs => this.client?.onJobsChanged(jobs.map(job => this.view(job)))
    });
    setClient(client: AkariTaskifyClient | undefined): void { this.client = client; }
    private view(job: TaskifyJob): TaskifyJobView { return { jobId: job.jobId, memoId: job.memoId, state: job.state,
        waiting: job.waiting, error: job.error, resultCount: job.resultCount, revision: job.revision,
        projectRootUri: job.projectRootUri, agent: job.agent }; }
    private async restore(root: string): Promise<void> {
        if (this.restored.has(root)) return;
        this.restored.add(root); await this.queue.restore(root);
    }
    private async enabled(root: string): Promise<boolean> {
        try { return JSON.parse((await fs.readFile(join(root, '.akari', 'taskify.json'), 'utf8'))).enabled !== false; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
    }
    async preview(projectRootUri: string, memoId?: string): Promise<TaskifyPreview> {
        const root = rootPath(projectRootUri);
        const agent = await taskifyAgent();
        const bin = await findTaskifyCli(agent);
        const enabled = await this.enabled(root);
        let canvas: RoughCanvasManifest | undefined; let ink: InkDocument | undefined;
        if (memoId && /^c-\d{4,}$/.test(memoId)) try {
            const dir = join(root, 'review', 'canvas', memoId);
            canvas = JSON.parse(await fs.readFile(join(dir, 'canvas.json'), 'utf8'));
            ink = JSON.parse(await fs.readFile(join(dir, 'ink.json'), 'utf8'));
        } catch { /* Draft may not have been saved yet. */ }
        return { images: canvas ? 1 : 0, lines: ink?.objects.length ?? 0, textChars: canvas?.memo?.length ?? 0,
            backdrop: !!canvas?.backdrop, provider: agent === 'claude' ? 'Anthropic' : 'OpenAI', agent,
            available: enabled && !!bin, reason: !enabled ? 'disabled' : !bin ? 'cli-missing' : undefined };
    }
    async enqueue(request: TaskifyEnqueue): Promise<{ jobId: string }> {
        const root = rootPath(request.projectRootUri);
        if (!await this.enabled(root)) throw new Error('このプロジェクトでは使えません。');
        if (!/^c-\d{4,}$/.test(request.memoId)) throw new Error('メモの番号が不正です。');
        await this.restore(root);
        const memoDir = join(root, 'review', 'canvas', request.memoId);
        const canvas = JSON.parse(await fs.readFile(join(memoDir, 'canvas.json'), 'utf8')) as RoughCanvasManifest;
        const ink = JSON.parse(await fs.readFile(join(memoDir, 'ink.json'), 'utf8')) as InkDocument;
        const revisions = await fs.readdir(join(memoDir, 'taskify')).catch(() => []);
        const revision = Math.max(0, ...revisions.map(v => /^r(\d+)$/.exec(v)?.[1]).filter(Boolean).map(Number)) + 1;
        const jobId = `${request.memoId}-r${revision}`;
        const jobDir = join(memoDir, 'taskify', `r${revision}`);
        const paper = request.includeBackdrop ? await fs.readFile(join(memoDir, 'paper.png'))
            : request.paperPng ? dataPng(request.paperPng) : undefined;
        if (!paper) throw new Error('線だけの画像が必要です。');
        const editText = await readOptional(join(root, 'edit.json'));
        const scriptText = await readOptional(join(root, 'planning', 'script.md'))
            ?? await readOptional(join(root, 'SCRIPT.md'));
        const bundle = buildBundle({ canvas, ink, paper, includeBackdrop: request.includeBackdrop,
            backdrop: request.includeBackdrop && canvas.backdrop ? await fs.readFile(join(memoDir, 'backdrop.png')) : undefined,
            transcript: JSON.parse((await readOptional(join(memoDir, 'transcript.json'))) ?? '{}'), editText, scriptText });
        await writeBundle(join(jobDir, 'input'), bundle);
        const external = await fs.mkdtemp(join(tmpdir(), 'akari-taskify-'));
        await writeBundle(external, bundle);
        const agent = await taskifyAgent();
        const job: TaskifyJob = { jobId, memoId: request.memoId, projectRootUri: request.projectRootUri,
            revision, state: 'queued', attempts: 0, agent, model: request.model ?? (agent === 'claude' ? 'sonnet' : 'gpt-6-sol'),
            inputDir: external, jobDir, createdAt: new Date().toISOString() };
        await this.queue.enqueue(job);
        return { jobId };
    }
    async cancel(jobId: string): Promise<void> { await this.queue.cancel(jobId); }
    async retry(jobId: string): Promise<void> { await this.queue.retry(jobId); }
    async rerun(projectRootUri: string, memoId: string, options?: { careful?: boolean }): Promise<{ jobId: string }> {
        await this.restore(rootPath(projectRootUri));
        const latest = this.queue.list(projectRootUri).filter(job => job.memoId === memoId)
            .sort((a, b) => b.revision - a.revision)[0];
        const previous = latest && join(latest.jobDir, 'input');
        const includeBackdrop = previous ? !!await fs.stat(join(previous, 'backdrop.png')).catch(() => undefined) : true;
        const paperPng = !includeBackdrop && previous
            ? `data:image/png;base64,${(await fs.readFile(join(previous, 'paper.png'))).toString('base64')}` : undefined;
        return this.enqueue({ projectRootUri, memoId, includeBackdrop, paperPng,
            model: options?.careful ? 'opus' : undefined });
    }
    async list(projectRootUri: string): Promise<TaskifyJobView[]> {
        await this.restore(rootPath(projectRootUri)); return this.queue.list(projectRootUri).map(job => this.view(job));
    }
}
