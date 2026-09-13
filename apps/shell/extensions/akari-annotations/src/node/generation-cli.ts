import { ChildProcess, spawn } from 'child_process';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';

export interface GenerationCliResult {
    ok: boolean;
    reason?: string;
    stdout: string;
    stderr?: string;
    exitCode?: number | null;
}

export type SpawnGenerationProcess = typeof spawn;

export interface GenerationCliOptions {
    spawnImpl?: SpawnGenerationProcess;
    env?: NodeJS.ProcessEnv;
    dirnameValue?: string;
}

const safeItemId = (itemId: string): string => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(itemId)) throw new Error('itemId が不正です。');
    return itemId;
};

export function generationDraftPath(projectRoot: string, itemId: string): string {
    return join(resolve(projectRoot), '.akari', 'generation', `${safeItemId(itemId)}.inputs.json`);
}

export class GenerationCliManager {
    protected readonly spawnImpl: SpawnGenerationProcess;
    protected readonly env: NodeJS.ProcessEnv;
    protected readonly dirnameValue: string;
    protected readonly children = new Map<string, ChildProcess>();

    constructor(options: GenerationCliOptions = {}) {
        this.spawnImpl = options.spawnImpl ?? spawn;
        this.env = options.env ?? process.env;
        this.dirnameValue = options.dirnameValue ?? __dirname;
    }

    async start(projectRoot: string, itemId: string): Promise<GenerationCliResult> {
        const draftPath = generationDraftPath(projectRoot, itemId);
        const draft = JSON.parse(await fs.readFile(draftPath, 'utf8')) as { modelId?: string };
        if (!draft.modelId) return { ok: false, reason: '生成モデルが下書きにありません。', stdout: '' };
        return this.run(itemId, ['generate', 'video', projectRoot, '--item', itemId,
            '--inputs', draftPath, '--model', draft.modelId, '--yes', '--json']);
    }

    async resume(projectRoot: string, itemId: string): Promise<GenerationCliResult> {
        return this.run(itemId, ['generate', 'resume', projectRoot, '--item', itemId, '--json']);
    }

    async cancel(itemId: string): Promise<GenerationCliResult> {
        const child = this.children.get(itemId);
        if (!child) return { ok: false, reason: 'この item の生成プロセスは動いていません。', stdout: '' };
        child.kill('SIGTERM');
        const timer = setTimeout(() => {
            if (child.exitCode === null) child.kill('SIGKILL');
        }, 3000);
        return new Promise(resolvePromise => child.once('close', code => {
            clearTimeout(timer);
            resolvePromise({ ok: code === 0, ...(code === 0 ? {} : { reason: `生成を中止しました（exit ${code ?? '不明'}）` }), stdout: '', exitCode: code });
        }));
    }

    protected async resolveCli(): Promise<string | undefined> {
        if (this.env.AKARI_GENERATE_CLI) return this.env.AKARI_GENERATE_CLI;
        const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        const candidates: string[] = [];
        if (resourcesPath) candidates.push(join(resourcesPath, 'packages', 'akari-launcher', 'bin', 'akari.mjs'));
        let current = resolve(this.dirnameValue);
        for (let depth = 0; depth < 10; depth++) {
            candidates.push(join(current, 'packages', 'akari-launcher', 'bin', 'akari.mjs'));
            const parent = dirname(current);
            if (parent === current) break;
            current = parent;
        }
        for (const candidate of [...new Set(candidates)]) {
            if (await fs.stat(candidate).then(stat => stat.isFile()).catch(() => false)) return candidate;
        }
        return undefined;
    }

    protected async run(itemId: string, args: string[]): Promise<GenerationCliResult> {
        if (this.children.has(itemId)) return { ok: false, reason: 'この item は生成中です。', stdout: '' };
        const cli = await this.resolveCli();
        if (!cli) return { ok: false, reason: 'akari generate CLI が見つかりません。', stdout: '' };
        return new Promise(resolvePromise => {
            let stdout = '';
            let stderr = '';
            let child: ChildProcess;
            try {
                child = this.spawnImpl(process.execPath, [cli, ...args], {
                    env: { ...this.env, ELECTRON_RUN_AS_NODE: '1' },
                    stdio: ['ignore', 'pipe', 'pipe'], detached: false
                });
            } catch (error) {
                resolvePromise({ ok: false, reason: String(error), stdout });
                return;
            }
            this.children.set(itemId, child);
            child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
            child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
            const finish = (code: number | null, reason?: string): void => {
                if (this.children.get(itemId) === child) this.children.delete(itemId);
                const failure = reason ?? (stderr.trim() || `exit ${code ?? '不明'}`);
                resolvePromise({ ok: code === 0, ...(code === 0 ? {} : { reason: failure }), stdout, stderr, exitCode: code });
            };
            child.once('error', error => finish(2, error.message));
            child.once('close', code => finish(code));
        });
    }
}
