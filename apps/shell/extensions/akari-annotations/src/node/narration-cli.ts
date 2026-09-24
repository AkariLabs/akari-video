import { ChildProcess, spawn } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GenerationCliManager } from './generation-cli';
import type { GenerateNarrationRequest, GenerateNarrationResult, NarrationEnginesResult, NarrationVoicesResult, NarrationVerificationBackend, VerifyNarrationRequest, VerifyNarrationResult, VoiceCheckResult, VoiceCopyRequest, VoiceCreateRequest, VoiceScript, VoiceTryRequest, VoiceProfileSummary } from '../common/akari-annotations-protocol';

export class NarrationCliManager {
    protected readonly resolver = new GenerationCliManager();
    protected readonly children = new Map<string, ChildProcess>();

    constructor(protected readonly spawnImpl: typeof spawn = spawn) {}

    async voiceScripts(): Promise<{ scripts: VoiceScript[] }> {
        return this.run(['voice', 'scripts', '--json']) as Promise<{ scripts: VoiceScript[] }>;
    }
    async voiceProfiles(avatar?: string): Promise<{ profiles: VoiceProfileSummary[] }> {
        return this.run(['voice', 'profiles', ...(avatar ? ['--avatar', avatar] : []), '--json']) as Promise<{ profiles: VoiceProfileSummary[] }>;
    }
    async voiceRename(profile: string, label: string): Promise<void> {
        await this.run(['voice', 'rename', '--profile', profile, '--label', label, '--json']);
    }
    async voiceExtend(profile: string, audioPath: string): Promise<{ path: string; warnings?: string[]; score?: number }> {
        return this.run(['voice', 'extend', '--profile', profile, '--audio', audioPath, '--script', 'extended-v1', '--json']) as Promise<{ path: string; warnings?: string[]; score?: number }>;
    }
    async voiceCheck(audioPath: string, script: VoiceScript['id']): Promise<VoiceCheckResult> {
        return this.run(['voice', 'check', '--audio', audioPath, '--script', script, '--json']) as Promise<VoiceCheckResult>;
    }
    async voiceCreate(request: VoiceCreateRequest): Promise<{ status: string; profile: string; path: string }> {
        const args = ['voice', 'create', '--avatar', request.avatar, '--id', request.id, '--label', request.label,
            '--audio', request.audioPath, '--script', request.script, '--json'];
        if (request.consentSelf) args.push('--consent-self');
        if (request.consentCloud) args.push('--consent-cloud');
        return this.run(args) as Promise<{ status: string; profile: string; path: string }>;
    }
    async voiceCopy(request: VoiceCopyRequest): Promise<{ status: string; profile: string; engine: VoiceCopyRequest['engine'] }> {
        if (request.engine === 'fal-qwen3' && request.approved !== true) throw new Error('費用承認が必要です。');
        return this.run(['voice', 'copy', '--profile', request.profile, '--engine', request.engine,
            ...(request.irodoriUrl ? ['--irodori-url', request.irodoriUrl] : []),
            ...(request.engine === 'fal-qwen3' ? ['--yes'] : []), '--json']) as Promise<{ status: string; profile: string; engine: VoiceCopyRequest['engine'] }>;
    }
    async voiceTry(request: VoiceTryRequest): Promise<{ path: string; duration_s: number; engine: VoiceCopyRequest['engine'] }> {
        if (request.engine === 'fal-qwen3' && request.approved !== true) throw new Error('費用承認が必要です。');
        return this.run(['voice', 'try', '--profile', request.profile, '--engine', request.engine, '--text', request.text,
            ...(request.reading ? ['--reading', request.reading] : []),
            ...(request.irodoriUrl ? ['--irodori-url', request.irodoriUrl] : []),
            ...(request.engine === 'fal-qwen3' ? ['--yes'] : []), '--json']) as Promise<{ path: string; duration_s: number; engine: VoiceCopyRequest['engine'] }>;
    }
    async voiceDelete(profile: string, irodoriUrl?: string): Promise<void> {
        await this.run(['voice', 'delete', '--profile', profile, ...(irodoriUrl ? ['--irodori-url', irodoriUrl] : []), '--json']);
    }
    async voiceVerifyCombined(audioPath: string, expected: string): Promise<VerifyNarrationResult | NarrationVerificationBackend> {
        return this.run(['narration', 'verify', '--project', join(tmpdir(), 'akari-voice-verify'), '--audio', audioPath,
            '--text', expected, '--json'], undefined, false, true) as Promise<VerifyNarrationResult | NarrationVerificationBackend>;
    }

    async engines(irodoriUrl?: string): Promise<NarrationEnginesResult> {
        return this.run(['narration', 'engines', '--json', ...(irodoriUrl ? ['--irodori-url', irodoriUrl] : [])]) as Promise<NarrationEnginesResult>;
    }
    async voices(engine: string, irodoriUrl?: string): Promise<NarrationVoicesResult> {
        return this.run(['narration', 'voices', '--engine', engine, '--json', ...(irodoriUrl ? ['--irodori-url', irodoriUrl] : [])]) as Promise<NarrationVoicesResult>;
    }
    async start(engine: string): Promise<{ status: string }> {
        if (engine !== 'voicevox') throw new Error('VOICEVOX だけ起動できます。');
        return this.run(['narration', 'start', '--engine', engine, '--json']) as Promise<{ status: string }>;
    }
    async verificationBackend(root: string): Promise<NarrationVerificationBackend> {
        return this.run(['narration', 'verify', '--project', root, '--check-backend', '--json'], undefined, false, true) as Promise<NarrationVerificationBackend>;
    }
    async verify(request: VerifyNarrationRequest, root: string): Promise<VerifyNarrationResult> {
        return this.run(['narration', 'verify', '--project', root, '--audio', request.audio,
            '--text', request.text, ...(request.reading ? ['--reading', request.reading] : []), '--json'], root) as Promise<VerifyNarrationResult>;
    }
    async generate(request: GenerateNarrationRequest, root: string): Promise<GenerateNarrationResult> {
        if (['gemini-tts', 'fal-qwen3'].includes(request.engine) && request.approved !== true) {
            throw new Error('費用承認が必要です。');
        }
        const directory = await fs.mkdtemp(join(tmpdir(), 'akari-narration-'));
        const readingFile = join(directory, 'reading.txt');
        try {
            await fs.writeFile(readingFile, request.reading, 'utf8');
            // CLI の自動採番は edit.json だけを見る。まとめ生成では配置まで edit.json を
            // 変えないため、未配置の out/narration も含めて ID を予約する。
            const id = await this.nextOutputId(root);
            const args = ['narration', 'generate', '--project', root, '--engine', request.engine,
                '--text', request.script, '--reading-file', readingFile, '--id', id, '--json'];
            if (request.engine === 'voicevox') args.push('--speaker', request.voice);
            else args.push('--voice', request.voice);
            if (request.profile) args.push('--profile', request.profile);
            if (request.speed !== undefined && ['voicevox', 'irodori'].includes(request.engine)) args.push('--speed', String(request.speed));
            if (request.style && ['gemini-tts', 'irodori'].includes(request.engine)) args.push('--style', request.style);
            if (request.irodoriUrl) args.push('--irodori-url', request.irodoriUrl);
            if (request.captionId) args.push('--caption-ref', request.captionId);
            if (['gemini-tts', 'fal-qwen3'].includes(request.engine)) args.push('--yes');
            return await this.run(args, root, true) as GenerateNarrationResult;
        } finally {
            await fs.rm(directory, { recursive: true, force: true });
        }
    }
    protected async nextOutputId(root: string): Promise<string> {
        const names = await fs.readdir(join(root, 'out', 'narration')).catch(() => []);
        let maximum = 0;
        for (const name of names) {
            const match = /^n-(\d{4})\.(?:wav|mp3)$/u.exec(name);
            if (match) maximum = Math.max(maximum, Number(match[1]));
        }
        try {
            const edit = JSON.parse(await fs.readFile(join(root, 'edit.json'), 'utf8')) as {
                audio?: { narration?: Array<{ id?: string }> }; tracks?: Array<{ items?: Array<{ id?: string }> }>;
            };
            const ids = [...(edit.audio?.narration ?? []).map(item => item.id),
                ...(edit.tracks ?? []).flatMap(track => (track.items ?? []).map(item => item.id))];
            for (const id of ids) if (id && /^n-\d{4}$/u.test(id)) maximum = Math.max(maximum, Number(id.slice(2)));
        } catch { /* edit.json がまだ無いときも出力ファイルから採番する。 */ }
        if (maximum >= 9999) throw new Error('ナレーション ID の上限に達しました。');
        return `n-${String(maximum + 1).padStart(4, '0')}`;
    }
    async cancel(root: string): Promise<void> {
        const child = this.children.get(root);
        if (!child) return;
        child.kill('SIGTERM');
        const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 3000);
        child.once('close', () => clearTimeout(timer));
    }
    protected async run(args: string[], key?: string, allowApprovalExit = false, allowUnavailableExit = false): Promise<unknown> {
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
                if (code !== 0 && !(allowApprovalExit && code === 2 && parsed.status === 'needs_approval')
                    && !(allowUnavailableExit && code === 3 && parsed.status === 'unavailable')) {
                    reject(new Error(String(parsed.error ?? stderr.trim() ?? '読み上げ CLI が失敗しました。'))); return;
                }
                resolve(parsed);
            });
        });
    }
}
