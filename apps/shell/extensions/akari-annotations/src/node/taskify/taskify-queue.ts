import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { tmpdir } from 'node:os';
import { basename, relative, sep } from 'node:path';
import { invokeTaskifyCli, type Agent, type CliError } from './taskify-cli';
import { validateResult } from './taskify-schema';

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'blocked' | 'cancelled' | 'interrupted';
export interface TaskifyJob { jobId: string; memoId: string; projectRootUri: string; revision: number; state: JobState;
    waiting?: 'offline'; error?: CliError; attempts: number; resultCount?: number; usage?: unknown;
    agent: Agent; model: string; inputDir: string; jobDir: string; nextAt?: number; createdAt: string }
const atomic = async (path: string, value: unknown): Promise<void> => {
    const temp = `${path}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await fs.rename(temp, path); }
    finally { await fs.rm(temp, { force: true }); }
};
export interface QueuePorts { findBin(agent: Agent): Promise<string | undefined>; online(): Promise<boolean>;
    importResult(job: TaskifyJob, result: ReturnType<typeof validateResult>): Promise<number>;
    edit(job: TaskifyJob): Promise<any>; changed(jobs: TaskifyJob[]): void; rehydrate?(job: TaskifyJob): Promise<void>;
    timeoutMs?: number; retryDelays?: number[]; offlineDelayMs?: number }
export const defaultOnline = async (): Promise<boolean> => {
    try { await lookup('api.anthropic.com'); return true; } catch { return false; }
};
export class TaskifyQueue {
    private jobs = new Map<string, TaskifyJob>();
    private active?: { id: string; abort: AbortController };
    private timer?: ReturnType<typeof setTimeout>;
    constructor(private readonly ports: QueuePorts) { }
    list(root?: string): TaskifyJob[] { return [...this.jobs.values()].filter(j => !root || j.projectRootUri === root); }
    async restore(projectRoot: string): Promise<void> {
        const canvas = join(projectRoot, 'review', 'canvas');
        for (const memo of await fs.readdir(canvas).catch(() => [])) {
            if (!/^c-\d{4,}$/.test(memo)) continue;
            const dir = join(canvas, memo, 'taskify');
            for (const revision of await fs.readdir(dir).catch(() => [])) {
                if (!/^r\d+$/.test(revision)) continue;
                try {
                    const job = JSON.parse(await fs.readFile(join(dir, revision, 'job.json'), 'utf8')) as TaskifyJob;
                    if (job.state === 'running' || job.state === 'interrupted' || job.state === 'queued') await this.ports.rehydrate?.(job);
                    if (job.state === 'running' || job.state === 'interrupted') { job.state = 'queued'; await this.save(job); }
                    this.jobs.set(job.jobId, job);
                } catch { /* A broken entry cannot stop other jobs. */ }
            }
        }
        this.notify(); this.pump();
    }
    async enqueue(job: TaskifyJob): Promise<void> {
        if (this.list().filter(j => j.state === 'queued').length >= 10) throw new Error('混み合っています。あとで試してください。');
        this.jobs.set(job.jobId, job); await this.save(job); this.notify(); this.pump();
    }
    async cancel(id: string): Promise<void> {
        const job = this.jobs.get(id); if (!job || !['queued', 'running'].includes(job.state)) return;
        if (this.active?.id === id) this.active.abort.abort();
        job.state = 'cancelled'; await this.save(job); this.notify(); this.pump();
        if (this.active?.id !== id) await this.cleanup(job);
    }
    async retry(id: string): Promise<void> {
        const job = this.jobs.get(id); if (!job || !['failed', 'blocked'].includes(job.state)) return;
        await this.ports.rehydrate?.(job);
        job.state = 'queued'; job.waiting = undefined; job.error = undefined; job.nextAt = undefined; job.attempts = 0;
        await this.save(job); this.notify(); this.pump();
    }
    private async save(job: TaskifyJob): Promise<void> { await fs.mkdir(job.jobDir, { recursive: true }); await atomic(join(job.jobDir, 'job.json'), job); }
    private async cleanup(job: TaskifyJob): Promise<void> {
        const path = await fs.realpath(job.inputDir).catch(() => undefined);
        if (!path) return;
        const rel = relative(await fs.realpath(tmpdir()), path);
        if (!rel.startsWith('..') && !rel.includes(sep) && basename(path).startsWith('akari-taskify-'))
            await fs.rm(path, { recursive: true, force: true });
    }
    private notify(): void { this.ports.changed(this.list()); }
    private pump(): void {
        if (this.active) return;
        if (this.timer) clearTimeout(this.timer);
        const due = this.list().filter(j => j.state === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const next = due.find(j => !j.nextAt || j.nextAt <= Date.now());
        if (next) { void this.run(next); return; }
        if (due.length) this.timer = setTimeout(() => this.pump(), Math.min(30_000, Math.max(1, Math.min(...due.map(j => j.nextAt ?? Date.now())) - Date.now())));
    }
    private async run(job: TaskifyJob): Promise<void> {
        const abort = new AbortController(); this.active = { id: job.jobId, abort };
        try {
            if (!await this.ports.online()) {
                job.waiting = 'offline'; job.nextAt = Date.now() + (this.ports.offlineDelayMs ?? 30_000); await this.save(job); this.notify();
                return;
            }
            job.waiting = undefined; job.nextAt = undefined;
            const bin = await this.ports.findBin(job.agent);
            if (!bin) { job.state = 'blocked'; job.error = { state: 'blocked', code: 'cli-missing', raw: '' }; await this.save(job); this.notify(); return; }
            job.state = 'running'; job.attempts++; await this.save(job); this.notify();
            const response = await invokeTaskifyCli({ agent: job.agent, bin, inputDir: job.inputDir, model: job.model,
                timeoutMs: this.ports.timeoutMs, correction: job.error?.code === 'bad-json' ? job.error.raw : undefined, signal: abort.signal });
            if ((job.state as JobState) === 'cancelled') return;
            let failure = response.error;
            let validated: ReturnType<typeof validateResult> | undefined;
            if (response.output) try { validated = validateResult(response.output, { edit: await this.ports.edit(job) }); }
                catch (error) { failure = { state: 'retry', code: 'bad-json', raw: String(error).slice(0, 500) }; }
            if (validated) {
                job.resultCount = await this.ports.importResult(job, validated); job.usage = response.usage;
                await atomic(join(job.jobDir, 'result.json'), validated);
                job.state = 'done'; job.error = undefined;
            } else if (failure) {
                job.error = failure;
                if (failure.state === 'queued') { job.state = 'queued'; job.waiting = 'offline'; job.nextAt = Date.now() + 30_000; }
                else if (failure.state === 'blocked' || failure.state === 'failed') job.state = failure.state;
                else if (job.attempts >= (failure.code === 'bad-json' ? 2 : 3)) job.state = 'failed';
                else { job.state = 'queued'; job.nextAt = Date.now() + (this.ports.retryDelays ?? [30_000, 120_000])[job.attempts - 1]; }
            }
            await this.save(job); this.notify();
        } catch (error) {
            job.state = 'failed'; job.error = { state: 'failed', code: 'unknown', raw: String(error).slice(0, 500) };
            await this.save(job); this.notify();
        } finally {
            if (['done', 'failed', 'blocked', 'cancelled'].includes(job.state)) await this.cleanup(job).catch(() => undefined);
            if (this.active?.id === job.jobId) this.active = undefined;
            this.pump();
        }
    }
}
