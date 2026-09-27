import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join, sep } from 'path';

export interface CandidateResult { route: string; ok: boolean; reason?: string; relativePath?: string; elapsedSeconds?: number; }
export interface CandidateBatch<T extends CandidateResult> {
    routes: string[]; completed: number; candidates: T[]; results: T[]; running: boolean;
}
export interface CandidatePreparation {
    sidecarPath: string; original: Record<string, any>; previousCandidates: number;
}
interface Context<T extends CandidateResult> {
    state: CandidateBatch<T>; pending: number; write(running: boolean): Promise<void>;
}

/** 枠 × 手段の予約、手段ごとの待ち行列、枠 meta の進捗を共有する。 */
export class GenerationCandidates<T extends CandidateResult> {
    private readonly reserved = new Set<string>();
    private readonly queues = new Map<string, Promise<unknown>>();
    private readonly batchRoutes = new Map<string, Set<string>>();
    private readonly contexts = new Map<string, Promise<Context<T>>>();
    private readonly states = new Map<string, CandidateBatch<T>>();
    private readonly cancelled = new Set<string>();

    state(itemId: string): CandidateBatch<T> | undefined { return this.states.get(itemId); }
    isCancelled(itemId: string): boolean { return this.cancelled.has(itemId); }
    cancel(itemId: string): void { if (this.contexts.has(itemId) || this.states.has(itemId)) this.cancelled.add(itemId); }

    async runRoute(itemId: string, route: string, run: () => Promise<Omit<T, 'route'>>): Promise<Omit<T, 'route'>> {
        const key = `${itemId}:${route}`;
        if (this.reserved.has(key)) return { ok: false, reason: 'この枠と手段は生成中です。' } as Omit<T, 'route'>;
        this.reserved.add(key);
        const previous = this.queues.get(route);
        const work = (async () => {
            if (previous) await previous.catch(() => undefined);
            if (this.cancelled.has(itemId)) return { ok: false, reason: '中止しました。', cancelled: true } as unknown as Omit<T, 'route'>;
            return run();
        })();
        this.queues.set(route, work);
        try { return await work; }
        finally {
            this.reserved.delete(key);
            if (this.queues.get(route) === work) this.queues.delete(route);
        }
    }

    async batch(itemId: string, routes: string[], prepare: () => Promise<CandidatePreparation>,
                run: (route: string) => Promise<Omit<T, 'route'>>): Promise<CandidateBatch<T>> {
        const reserved = this.batchRoutes.get(itemId) ?? new Set<string>();
        if (routes.some(route => reserved.has(route))) throw new Error('この枠と手段は生成中です。');
        routes.forEach(route => reserved.add(route));
        this.batchRoutes.set(itemId, reserved);
        let contextPromise = this.contexts.get(itemId);
        if (!contextPromise) {
            contextPromise = this.prepareContext(itemId, prepare);
            this.contexts.set(itemId, contextPromise);
        }
        let context: Context<T> | undefined;
        try {
            context = await contextPromise;
            context.pending++;
            context.state.routes.push(...routes);
            await context.write(true);
            const results = await Promise.all(routes.map(async route => {
                let result: Omit<T, 'route'>;
                try { result = await run(route); }
                catch (error) { result = { ok: false, reason: error instanceof Error ? error.message : String(error) } as Omit<T, 'route'>; }
                const candidate = { ...result, route } as T;
                context!.state.candidates.push(candidate);
                context!.state.completed++;
                await context!.write(true);
                return candidate;
            }));
            return { routes, completed: results.length, candidates: results, results, running: false };
        } finally {
            routes.forEach(route => reserved.delete(route));
            if (!reserved.size) this.batchRoutes.delete(itemId);
            if (context && --context.pending === 0 || !context) {
                if (context) { context.state.running = false; await context.write(false); }
                this.contexts.delete(itemId);
                this.states.delete(itemId);
                this.cancelled.delete(itemId);
            }
        }
    }

    private async prepareContext(itemId: string, prepare: () => Promise<CandidatePreparation>): Promise<Context<T>> {
        const { sidecarPath, original, previousCandidates } = await prepare();
        const at = new Date().toISOString();
        const state: CandidateBatch<T> = { routes: [], completed: 0, candidates: [], results: [], running: true };
        let writing: Promise<void> = Promise.resolve();
        const write = (running: boolean): Promise<void> => {
            const snapshot = { routes: [...state.routes], completed: state.completed,
                candidates: previousCandidates + state.candidates.filter(row => row.ok).length,
                failed: state.candidates.filter(row => !row.ok).map(row => ({ route: row.route, reason: row.reason ?? '生成できませんでした。' })),
                results: state.candidates.map(row => ({ route: row.route, ok: row.ok,
                    ...(row.relativePath ? { path: row.relativePath } : {}),
                    ...(row.reason ? { reason: row.reason } : {}),
                    ...(row.elapsedSeconds === undefined ? {} : { elapsed_s: row.elapsedSeconds }) })) };
            writing = writing.then(async () => {
                const status = running ? 'generating' : snapshot.candidates > 0 ? original.status : 'failed';
                const meta = { ...original, status,
                    job: { ...original.job, provider: 'compare', started_at: at, stale_after_s: 900, ...snapshot },
                    history: [...(Array.isArray(original.history) ? original.history : []),
                        { at, status: 'generating', reason: null },
                        ...(!running ? [{ at: new Date().toISOString(), status, reason: null }] : [])] };
                const temporary = `${sidecarPath}.compare-${process.pid}-${randomUUID()}`;
                try {
                    await fs.writeFile(temporary, `${JSON.stringify(meta, null, 2)}\n`);
                    await fs.rename(temporary, sidecarPath);
                } catch (error) {
                    await fs.rm(temporary, { force: true });
                    throw error;
                }
            });
            return writing;
        };
        this.states.set(itemId, state);
        return { state, pending: 0, write };
    }
}

export async function readCandidateMeta(root: string, itemId: string, extension: '.png' | '.mp4' | '.wav' | '.mp3'):
    Promise<Array<{ name: string; meta: Record<string, any>; relativePath: string; absolutePath: string }>> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(itemId)) throw new Error('itemId が不正です。');
    const directory = join(root, 'assets', 'generated', 'candidates', itemId);
    const realDirectory = await fs.realpath(directory).catch(() => undefined);
    if (realDirectory && !realDirectory.startsWith(`${root}${sep}`)) throw new Error('候補がプロジェクト外です。');
    const entries = await fs.readdir(directory).catch(() => [] as string[]);
    const loaded = await Promise.all(entries.filter(name => name.endsWith(`${extension}.meta.json`)).map(async name => {
        try {
            const metaPath = await fs.realpath(join(directory, name));
            if (!metaPath.startsWith(`${root}${sep}`)) return undefined;
            const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
            if (meta.candidate_of !== itemId) return undefined;
            const filename = name.slice(0, -'.meta.json'.length);
            const absolutePath = await fs.realpath(join(directory, filename)).catch(() =>
                extension === '.mp4' ? join(directory, filename) : undefined);
            if (!absolutePath || !absolutePath.startsWith(`${root}${sep}`)) return undefined;
            return { name, meta, absolutePath, relativePath: `assets/generated/candidates/${itemId}/${filename}` };
        } catch { return undefined; }
    }));
    return loaded.filter((row): row is NonNullable<typeof row> => !!row);
}

export async function readPreferredModelIds(projectRoot: string, kind: 'image' | 'video' | 'voice', env: NodeJS.ProcessEnv = process.env):
    Promise<{ projectDefault?: string; appDefault?: string; favorites: string[] }> {
    const read = async (file: string): Promise<any> => fs.readFile(file, 'utf8').then(JSON.parse).catch(() => ({}));
    const [app, project] = await Promise.all([
        read(join(env.AKARI_HOME || join(homedir(), '.akari'), 'ai-models.json')),
        read(join(projectRoot, '.akari', 'ai-models.json'))
    ]);
    return { projectDefault: project?.defaults?.[kind], appDefault: app?.defaults?.[kind],
        favorites: Array.isArray(app?.favorites?.[kind]) ? app.favorites[kind].filter((id: unknown) => typeof id === 'string') : [] };
}
