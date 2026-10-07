import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { release } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { injectable } from '@theia/core/shared/inversify';
import {
    AkariEarClient, AkariEarService, EarEngineId, EarPurpose, EarStatus, EarUtterance,
    EarTranscript, RoughCanvasEarEvent
} from '../common/ear-protocol';

interface RawEvent { text: string; final: boolean; t: number; t0?: number; confidence?: number }
interface Engine {
    on(name: string, callback: (value: any) => void): void;
    start(): void | Promise<void>;
    stop(): void | Promise<void>;
    cancel?(): Promise<void>;
    appendAudio?(chunk: Buffer): Promise<void>;
}
interface EarModule {
    getCapabilities(options: object): { engines: Array<{ id: EarEngineId; available: boolean; reason?: string }> };
    pickEngine(requested: EarEngineId | undefined, caps: ReturnType<EarModule['getCapabilities']>): EarEngineId | null;
    createLiveEngine(options: object): Engine;
    createRecordEngine(options: object): Engine;
    createPipeline(options: object): { push(value: RawEvent): EarUtterance };
    loadVoiceDictionary(options: object): object;
    applyVoiceDictionary(text: string, resolved: object, options: { final: boolean }): { text: string; applied: EarUtterance['applied'] };
    recordApplied(applied: EarUtterance['applied'], options: object): void;
    sharedHistory(options: object): { record(value: EarUtterance & { purpose: EarPurpose }): void };
    createSegmenter(): { push(value: RawEvent): { t0: number; t1: number; text: string; confidence?: number } | undefined };
    createPaperSessions(options: object): {
        open(id: string, at: number): string;
        close(id: string, at: number): boolean;
        onSegment(segment: object): void;
        takeTranscript(id: string): EarTranscript | undefined;
        isOpen(): boolean;
        setEngine(engine: EarTranscript['engine']): void;
    };
    classifyUtterance(text: string, options: { paperOpen: boolean }): 'speech' | 'command';
    engineLabel(id: EarEngineId, backend?: string): EarTranscript['engine'];
}
interface EarServiceOptions {
    earModulePath?: string;
    helperPath?: string;
    platform?: string;
    darwinMajor?: number;
    env?: NodeJS.ProcessEnv;
    nowEpochMs?: () => number;
    transcribe?: (wavPath: string, options: { signal: AbortSignal }) => Promise<{ segments: RawEvent[]; backend?: string }>;
}

function upwardFile(relativePath: string): string | undefined {
    let cursor = __dirname;
    while (true) {
        const candidate = join(cursor, relativePath);
        try { if (statSync(candidate).isFile()) return candidate; } catch { /* 探索を続ける */ }
        const parent = dirname(cursor);
        if (parent === cursor) return undefined;
        cursor = parent;
    }
}

function resourceFile(relativePath: string): string | undefined {
    const root = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (!root) return undefined;
    const candidate = join(root, relativePath);
    return existsSync(candidate) ? candidate : undefined;
}

function cliPath(): string | undefined {
    return resourceFile('packages/akari-tools/bin/media.mjs')
        ?? upwardFile('packages/akari-tools/bin/media.mjs');
}

function localTranscriber(): EarServiceOptions['transcribe'] | undefined {
    const cli = cliPath();
    if (!cli) return undefined;
    // 古い配布物にフラグが無い場合は録音後エンジンを無効にする。
    const source = readFileSync(cli, 'utf8');
    if (!source.includes('"--no-record"') || !source.includes('"--no-word-book"')) return undefined;
    return (wavPath, { signal }) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, 'transcribe', wavPath,
            '--no-record', '--no-word-book'], {
            stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal
        });
        let output = '';
        let errorOutput = '';
        child.stdout?.on('data', chunk => { output += chunk.toString(); });
        child.stderr?.on('data', chunk => { errorOutput += chunk.toString(); });
        child.on('error', reject);
        child.on('close', code => {
            if (code !== 0) { reject(new Error(errorOutput.trim() || '録音後の文字起こしに失敗しました')); return; }
            try {
                const lines = output.trim().split('\n');
                const result = JSON.parse(lines[lines.length - 1] ?? '{}');
                resolve({ backend: result.backend, segments: (result.segments ?? []).map((segment: {
                    start: number; end: number; text: string; confidence?: number
                }) => ({ t0: segment.start, t1: segment.end, t: segment.end, final: true, text: segment.text,
                    ...(Number.isFinite(segment.confidence) ? { confidence: segment.confidence } : {}) })) });
            } catch { reject(new Error('文字起こしの結果を読めません')); }
        });
    });
}

@injectable()
export class AkariEarServiceImpl implements AkariEarService {
    protected client: AkariEarClient | undefined;
    protected modulePromise: Promise<EarModule | undefined> | undefined;
    protected active: { purpose: EarPurpose; id: EarEngineId; engine: Engine; sessions: ReturnType<EarModule['createPaperSessions']> } | undefined;
    protected readonly transcripts = new Map<string, EarTranscript>();
    protected status: EarStatus = { state: 'idle', mic: 'unknown' };
    protected readonly nowEpochMs: () => number;
    protected readonly env: NodeJS.ProcessEnv;

    constructor(protected readonly options: EarServiceOptions = {}) {
        this.nowEpochMs = options.nowEpochMs ?? Date.now;
        this.env = options.env ?? process.env;
    }

    protected async earModule(): Promise<EarModule | undefined> {
        this.modulePromise ??= (async () => {
            const path = this.options.earModulePath
                ?? resourceFile('packages/akari-ear/src/index.mjs')
                ?? upwardFile('packages/akari-ear/src/index.mjs');
            if (!path || !existsSync(path)) return undefined;
            try {
                const importEsm = new Function('specifier', 'return import(specifier)') as
                    (specifier: string) => Promise<EarModule>;
                return await importEsm(pathToFileURL(path).href);
            } catch { return undefined; }
        })();
        return this.modulePromise;
    }

    protected helperPath(): string | undefined {
        const candidates = [this.options.helperPath, this.env.AKARI_VIBE_STT_BIN,
            resourceFile('packages/akari-vibe/native/bin/akari-vibe-stt'),
            upwardFile('packages/akari-vibe/native/bin/akari-vibe-stt')];
        return candidates.find(candidate => {
            if (!candidate) return false;
            try { accessSync(candidate, constants.X_OK); return true; } catch { return false; }
        });
    }

    protected transcriber(): EarServiceOptions['transcribe'] | undefined {
        return this.options.transcribe ?? localTranscriber();
    }

    async getCapabilities(): ReturnType<AkariEarService['getCapabilities']> {
        const module = await this.earModule();
        if (!module) return { engines: [
            { id: 'speechanalyzer-live', available: false, reason: '聞き取り部品が見つかりません' },
            { id: 'record-then-transcribe', available: false, reason: '聞き取り部品が見つかりません' }
        ] };
        return module.getCapabilities({
            platform: this.options.platform ?? process.platform,
            darwinMajor: this.options.darwinMajor ?? Number(release().split('.')[0]),
            helperPath: this.helperPath(), env: this.env, transcribe: this.transcriber()
        });
    }

    setClient(client: AkariEarClient | undefined): void { this.client = client; }

    protected publish(status: EarStatus): EarStatus {
        this.status = status;
        this.client?.onStatus(status);
        return status;
    }

    async start(options: { purpose: EarPurpose; engine?: EarEngineId }): Promise<EarStatus> {
        if (this.active) {
            const label = this.active.purpose === 'trial' ? '試し聞き' : 'メモ';
            return { state: 'error', mic: 'unknown', message: `聞き取りは${label}（${this.active.purpose}）で動作中です` };
        }
        if (options.purpose === 'jev') return { state: 'error', mic: 'unknown', message: 'Jev の聞き取りは今後の更新で対応します' };
        const module = await this.earModule();
        const caps = await this.getCapabilities();
        const id = module?.pickEngine(options.engine, caps);
        if (!module || !id) return this.publish({ state: 'error', mic: 'unsupported', message: caps.engines.map(e => e.reason).filter(Boolean).join(' / ') });
        const startedAt = this.nowEpochMs();
        const transcribe = this.transcriber();
        const engine = id === 'speechanalyzer-live'
            ? module.createLiveEngine({ helperPath: this.helperPath() })
            : module.createRecordEngine({ transcribe });
        const sessions = module.createPaperSessions({ nowEpochMs: this.nowEpochMs,
            engineStartedAtEpochMs: startedAt, engine: module.engineLabel(id) });
        engine.on('backend', (backend: string) => sessions.setEngine(module.engineLabel(id, backend)));
        const pipeline = module.createPipeline({
            classify: (text: string) => module.classifyUtterance(text, { paperOpen: sessions.isOpen() }),
            dictionary: (text: string, options: { final: boolean }) => {
                try { return module.applyVoiceDictionary(text, module.loadVoiceDictionary({ env: this.env }), options); }
                catch { return { text, applied: [] }; }
            }
        });
        const segmenter = module.createSegmenter();
        const active = { purpose: options.purpose, id, engine, sessions };
        this.active = active;
        engine.on('status', (value: { state: EarStatus['state']; message?: string }) => {
            if (this.active !== active) return;
            this.publish({ state: value.state, mic: value.state === 'listening' ? 'ok' : 'unknown',
                purpose: options.purpose, engine: id, message: value.message });
        });
        engine.on('level', (rms: number) => { if (this.active === active) this.client?.onLevel(rms); });
        const utter = (value: RawEvent) => {
            if (this.active !== active) return;
            const result = pipeline.push(value);
            this.client?.onUtterance(result);
            if (result.final) {
                try {
                    module.recordApplied(result.applied, { env: this.env });
                    module.sharedHistory({ env: this.env }).record({ ...result, purpose: options.purpose });
                } catch { /* 聞き取りは続ける */ }
                const segment = segmenter.push({ ...value, text: result.text });
                if (segment) sessions.onSegment({ ...segment, kind: result.kind });
            } else segmenter.push({ ...value, text: result.text });
        };
        engine.on('partial', utter);
        engine.on('final', utter);
        engine.on('error', (error: Error) => {
            if (this.active !== active) return;
            this.active = undefined;
            this.publish({ state: 'error', mic: 'unknown', purpose: options.purpose,
                engine: id, message: error.message });
            void engine.stop();
        });
        this.publish({ state: 'starting', mic: 'unknown', purpose: options.purpose, engine: id });
        try {
            await engine.start();
            return this.status;
        } catch (error) {
            this.active = undefined;
            return this.publish({ state: 'error', mic: 'unknown', message: error instanceof Error ? error.message : '聞き取りを開始できません' });
        }
    }

    async stop(): Promise<EarStatus> {
        const active = this.active;
        if (!active) return this.publish({ state: 'idle', mic: 'unknown' });
        this.publish({ state: 'stopping', mic: 'unknown', purpose: active.purpose, engine: active.id });
        await active.engine.stop();
        this.active = undefined;
        return this.publish({ state: 'idle', mic: 'unknown' });
    }

    async notifyRoughCanvas(event: RoughCanvasEarEvent): Promise<void> {
        const sessions = this.active?.sessions;
        if (!sessions) return;
        if (event.type === 'roughCanvas.opened') {
            if (sessions.open(event.canvasId, event.at) !== 'busy') this.transcripts.delete(event.canvasId);
        }
        else {
            if (this.active?.id === 'record-then-transcribe') await this.active.engine.stop();
            sessions.close(event.canvasId, event.at);
            const transcript = sessions.takeTranscript(event.canvasId);
            if (transcript) this.transcripts.set(event.canvasId, transcript);
        }
    }

    async takeTranscript(canvasId: string): Promise<EarTranscript | undefined> {
        const transcript = this.transcripts.get(canvasId);
        this.transcripts.delete(canvasId);
        return transcript;
    }

    async appendAudio(chunk: Uint8Array): Promise<void> {
        if (this.active?.id !== 'record-then-transcribe') return;
        await this.active.engine.appendAudio?.(Buffer.from(chunk));
    }

    dispose(): void { void this.stop(); }
}
