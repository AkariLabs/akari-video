import { injectable } from '@theia/core/shared/inversify';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { AkariNarrationEnginesService, NarrationEngineRow, SettingsVoiceAvatar, SettingsVoiceProfile } from '../common/narration-engines-protocol';
import { voiceMigrationAvatar } from '../common/voice-settings-model';

export interface NarrationCliOptions {
    spawnImpl?: typeof spawn;
    env?: NodeJS.ProcessEnv;
    dirnameValue?: string;
    tempRoot?: string;
    resolveHome?: (env: NodeJS.ProcessEnv) => string;
}

/** generation-cli.ts の探索順を写す。並走レーンへの import は置かない。 */
export class NarrationCli implements AkariNarrationEnginesService {
    protected readonly spawnImpl: typeof spawn;
    protected readonly env: NodeJS.ProcessEnv;
    protected readonly dirnameValue: string;
    protected readonly tempRoot: string;
    protected readonly resolveHome?: (env: NodeJS.ProcessEnv) => string;

    constructor(options: NarrationCliOptions = {}) {
        this.spawnImpl = options.spawnImpl ?? spawn;
        this.env = options.env ?? process.env;
        this.dirnameValue = options.dirnameValue ?? __dirname;
        this.tempRoot = options.tempRoot ?? tmpdir();
        this.resolveHome = options.resolveHome;
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

    protected async run(args: string[], command = 'narration'): Promise<Record<string, unknown>> {
        const cli = await this.resolveCli();
        if (!cli) throw new Error('akari narration CLI が見つかりません。');
        return new Promise((resolvePromise, reject) => {
            let stdout = '';
            let stderr = '';
            const child = this.spawnImpl(process.execPath, [cli, command, ...args, '--json'], {
                env: { ...this.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: false
            });
            child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
            child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
            child.on('error', reject);
            child.on('close', code => {
                let parsed: Record<string, unknown>;
                try { const lines = stdout.trim().split(/\r?\n/); parsed = JSON.parse(lines[lines.length - 1] ?? '{}'); }
                catch { reject(new Error(code === 0 ? 'narration CLI の応答を読み取れませんでした。'
                    : stderr.trim() || 'narration CLI に失敗しました。')); return; }
                if (code !== 0) { reject(new Error(String(parsed.error || stderr.trim() || 'narration CLI に失敗しました。'))); return; }
                resolvePromise(parsed);
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
    async voiceProfiles(): Promise<{ profiles: SettingsVoiceProfile[] }> {
        return this.run(['profiles'], 'voice') as Promise<{ profiles: SettingsVoiceProfile[] }>;
    }
    protected async akariHome(): Promise<string> {
        if (this.resolveHome) return resolve(this.resolveHome(this.env));
        const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        const candidates: string[] = [];
        if (resourcesPath) candidates.push(join(resourcesPath, 'packages/creator-root/src/index.mjs'));
        let current = resolve(this.dirnameValue);
        for (let depth = 0; depth < 10; depth++) {
            candidates.push(join(current, 'packages/creator-root/src/index.mjs'));
            const parent = dirname(current); if (parent === current) break; current = parent;
        }
        for (const file of candidates) if (await fs.stat(file).then(stat => stat.isFile()).catch(() => false)) {
            const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{ resolveAkariHome(env: NodeJS.ProcessEnv): string }>;
            const creatorRoot = await importEsm(pathToFileURL(file).toString());
            return resolve(creatorRoot.resolveAkariHome(this.env));
        }
        throw new Error('AKARI_HOME の解決器が見つかりません。');
    }
    async voiceAvatars(): Promise<{ avatars: SettingsVoiceAvatar[] }> {
        const root = join(await this.akariHome(), 'avatars');
        const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
        const avatars: SettingsVoiceAvatar[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.name)) continue;
            try {
                const meta = JSON.parse(await fs.readFile(join(root, entry.name, 'avatar.json'), 'utf8')) as { id?: string; display_name?: string };
                if (meta.id !== entry.name) continue;
                avatars.push({ id: entry.name, ...(meta.display_name ? { displayName: meta.display_name } : {}) });
            } catch { /* 不正なアバターは候補から除く。 */ }
        }
        return { avatars: avatars.sort((a, b) => a.id.localeCompare(b.id, 'en')) };
    }
    async voiceRename(profile: string, label: string): Promise<void> {
        await this.run(['rename', '--profile', profile, '--label', label], 'voice');
    }
    async voiceCopy(request: { profile: string; engine: 'irodori' | 'fal-qwen3'; irodoriUrl?: string; approved?: boolean }): Promise<void> {
        if (request.engine === 'fal-qwen3' && request.approved !== true) throw new Error('費用承認が必要です。');
        await this.run(['copy', '--profile', request.profile, '--engine', request.engine,
            ...(request.irodoriUrl ? ['--irodori-url', request.irodoriUrl] : []),
            ...(request.engine === 'fal-qwen3' ? ['--yes'] : [])], 'voice');
    }
    async voiceDelete(profile: string, irodoriUrl?: string): Promise<void> {
        await this.run(['delete', '--profile', profile, ...(irodoriUrl ? ['--irodori-url', irodoriUrl] : [])], 'voice');
    }
    async voiceMigrateLegacy(profile: string): Promise<void> {
        const [profiles, { avatars }] = await Promise.all([this.voiceProfiles(), this.voiceAvatars()]);
        const legacy = profiles.profiles.find(item => item.id === profile && item.legacy);
        if (!legacy) throw new Error('移行する旧い声が見つかりません。');
        const selected = voiceMigrationAvatar(legacy.avatar, avatars);
        await this.run(['migrate-legacy', '--profile', profile, '--avatar', selected], 'voice');
    }
}

@injectable()
export class AkariNarrationEnginesServiceImpl extends NarrationCli { }
