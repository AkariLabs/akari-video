import { ChildProcess, spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GenerationCliManager } from './generation-cli';
import type { GenerateNarrationRequest, GenerateNarrationResult, NarrationEnginesResult, NarrationVoicesResult } from '../common/akari-annotations-protocol';

export class NarrationCliManager {
    protected readonly resolver = new GenerationCliManager();
    protected readonly children = new Map<string, ChildProcess>();

    constructor(protected readonly spawnImpl: typeof spawn = spawn) {}

    async engines(): Promise<NarrationEnginesResult> { return this.run(['narration', 'engines', '--json']) as Promise<NarrationEnginesResult>; }
    async voices(engine: string): Promise<NarrationVoicesResult> {
        return this.run(['narration', 'voices', '--engine', engine, '--json']) as Promise<NarrationVoicesResult>;
    }
    async generate(request: GenerateNarrationRequest, root: string): Promise<GenerateNarrationResult> {
        if (['gemini-tts', 'fal-qwen3'].includes(request.engine) && request.approved !== true) {
            throw new Error('費用承認が必要です。');
        }
        const directory = await fs.mkdtemp(join(tmpdir(), 'akari-narration-'));
        const readingFile = join(directory, 'reading.txt');
        try {
            await fs.writeFile(readingFile, request.reading, 'utf8');
            const args = ['narration', 'generate', '--project', root, '--engine', request.engine,
                '--text', request.script, '--reading-file', readingFile, '--json'];
            if (request.engine === 'voicevox') args.push('--speaker', request.voice);
            else args.push('--voice', request.voice);
            if (request.speed !== undefined && request.engine === 'voicevox') args.push('--speed', String(request.speed));
            if (request.style && request.engine === 'gemini-tts') args.push('--style', request.style);
            if (request.captionId) args.push('--caption-ref', request.captionId);
            if (['gemini-tts', 'fal-qwen3'].includes(request.engine)) args.push('--yes');
            return await this.run(args, root, true) as GenerateNarrationResult;
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    }
    async cancel(root: string): Promise<void> {
        const child = this.children.get(root);
        if (!child) return;
        child.kill('SIGTERM');
        const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 3000);
        child.once('close', () => clearTimeout(timer));
    }
    protected async run(args: string[], key?: string, allowApprovalExit = false): Promise<unknown> {
        const cli = await this.resolver.resolveCli();
        if (!cli) throw new Error('akari narration CLI が見つかりません。');
        if (key && this.children.has(key)) throw new Error('読み上げを生成中です。');
        return new Promise((resolve, reject) => {
            const child = this.spawnImpl(process.execPath, [cli, ...args], {
                env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe']
            });
            if (key) this.children.set(key, child);
            let stdout = ''; let stderr = '';
            child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
            child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
            child.once('error', reject);
            child.once('close', code => {
                if (key && this.children.get(key) === child) this.children.delete(key);
                let parsed: Record<string, unknown>;
                try { parsed = JSON.parse(stdout.trim()); }
                catch { reject(new Error(stderr.trim() || '読み上げ CLI の応答を読めません。')); return; }
                if (code !== 0 && !(allowApprovalExit && code === 2 && parsed.status === 'needs_approval')) {
                    reject(new Error(String(parsed.error ?? stderr.trim() ?? '読み上げ CLI が失敗しました。'))); return;
                }
                resolve(parsed);
            });
        });
    }
}
