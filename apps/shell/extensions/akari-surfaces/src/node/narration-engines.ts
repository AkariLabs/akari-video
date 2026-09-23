import { injectable } from '@theia/core/shared/inversify';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { AkariNarrationEnginesService, NarrationEngineRow } from '../common/narration-engines-protocol';

export interface NarrationCliOptions {
    spawnImpl?: typeof spawn;
    env?: NodeJS.ProcessEnv;
    dirnameValue?: string;
    tempRoot?: string;
}

/** generation-cli.ts の探索順を写す。並走レーンへの import は置かない。 */
export class NarrationCli implements AkariNarrationEnginesService {
    protected readonly spawnImpl: typeof spawn;
    protected readonly env: NodeJS.ProcessEnv;
    protected readonly dirnameValue: string;
    protected readonly tempRoot: string;

    constructor(options: NarrationCliOptions = {}) {
        this.spawnImpl = options.spawnImpl ?? spawn;
        this.env = options.env ?? process.env;
        this.dirnameValue = options.dirnameValue ?? __dirname;
        this.tempRoot = options.tempRoot ?? tmpdir();
    }

    async resolveCli(): Promise<string | undefined> {
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

    protected async run(args: string[]): Promise<Record<string, unknown>> {
        const cli = await this.resolveCli();
        if (!cli) throw new Error('akari narration CLI が見つかりません。');
        return new Promise((resolvePromise, reject) => {
            let stdout = '';
            let stderr = '';
            const child = this.spawnImpl(process.execPath, [cli, 'narration', ...args, '--json'], {
                env: { ...this.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: false
            });
            child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
            child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
            child.on('error', reject);
            child.on('close', code => {
                if (code !== 0) { reject(new Error(stderr.trim() || 'narration CLI に失敗しました。')); return; }
                try { const lines = stdout.trim().split(/\r?\n/); resolvePromise(JSON.parse(lines[lines.length - 1] ?? '{}')); }
                catch { reject(new Error('narration CLI の応答を読み取れませんでした。')); }
            });
        });
    }

    protected async voicevoxCaskAvailable(): Promise<boolean> {
        if (process.platform !== 'darwin') return false;
        for (const brew of ['brew', '/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
            const result = await new Promise<{ found: boolean; available: boolean }>(resolvePromise => {
                const child = this.spawnImpl(brew, ['info', '--cask', 'voicevox'], { env: this.env, stdio: 'ignore' });
                child.on('error', () => resolvePromise({ found: false, available: false }));
                child.on('close', code => resolvePromise({ found: true, available: code === 0 }));
            });
            if (result.found) return result.available;
        }
        return false;
    }

    async narrationEngines(irodoriUrl?: string): Promise<{ engines: NarrationEngineRow[]; voicevoxCaskAvailable: boolean }> {
        const [result, voicevoxCaskAvailable] = await Promise.all([this.run(['engines', ...(irodoriUrl ? ['--irodori-url', irodoriUrl] : [])]), this.voicevoxCaskAvailable()]);
        return { engines: result.engines as NarrationEngineRow[], voicevoxCaskAvailable };
    }

    async startNarrationEngine(engine: 'voicevox'): Promise<void> { await this.run(['start', '--engine', engine]); }
    async stopNarrationEngine(engine: 'voicevox'): Promise<void> { await this.run(['stop', '--engine', engine]); }

    async previewVoicevox(): Promise<string> {
        const directory = await fs.mkdtemp(join(this.tempRoot, 'akari-voicevox-preview-'));
        try {
            const result = await this.run(['generate', '--project', directory, '--engine', 'voicevox', '--speaker', '3', '--text', 'こんにちは']);
            const relative = result.path;
            if (typeof relative !== 'string' || !/^out\/narration\/n-\d{4}\.wav$/.test(relative)) throw new Error('試聴音声の保存先が不正です。');
            return `data:audio/wav;base64,${(await fs.readFile(join(directory, relative))).toString('base64')}`;
        } finally { await fs.rm(directory, { recursive: true, force: true }); }
    }
}

@injectable()
export class AkariNarrationEnginesServiceImpl extends NarrationCli { }
