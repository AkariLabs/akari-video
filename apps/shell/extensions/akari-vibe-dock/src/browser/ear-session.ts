import { DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariEarFrontend } from '../common/ear-frontend';
import { EarEngineId, EarPurpose, EarStatus, EarUtterance } from '../common/ear-protocol';
import { resolveEarEngine } from '../common/vibe-mode';
import { EarRecorder } from './ear-recorder';

@injectable()
export class EarSession {
    protected readonly changeEmitter = new Emitter<EarStatus>();
    protected readonly utteranceEmitter = new Emitter<EarUtterance>();
    protected readonly levelEmitter = new Emitter<number>();
    readonly onDidChange: Event<EarStatus> = this.changeEmitter.event;
    readonly onUtterance: Event<EarUtterance> = this.utteranceEmitter.event;
    readonly onLevel: Event<number> = this.levelEmitter.event;
    protected readonly subscriptions = new DisposableCollection();
    protected recorder: EarRecorder | undefined;
    protected busy = false;
    protected starting: Promise<EarStatus> | undefined;
    protected stopping: Promise<EarStatus> | undefined;
    protected cleanup: Promise<void> | undefined;
    protected current: EarStatus = { state: 'idle', mic: 'unknown' };

    constructor(
        @inject(AkariEarFrontend) protected readonly ear: AkariEarFrontend,
        @inject(PreferenceService) protected readonly preferences: PreferenceService
    ) {
        this.subscriptions.push(ear.onStatus(status => {
            if (!this.busy) return;
            this.setStatus(status);
            if (status.state === 'error') {
                this.busy = false;
                this.cleanup = (async () => {
                    try { await this.releaseRecorder(); }
                    finally { await this.ear.stop(); }
                })().catch(() => undefined).finally(() => { this.cleanup = undefined; });
            }
        }));
        this.subscriptions.push(ear.onUtterance(value => { if (this.busy) this.utteranceEmitter.fire(value); }));
        this.subscriptions.push(ear.onLevel(value => { if (this.busy) this.levelEmitter.fire(value); }));
    }

    get state(): EarStatus { return this.current; }

    protected setStatus(value: EarStatus): EarStatus {
        this.current = value;
        this.changeEmitter.fire(value);
        return value;
    }

    async start(options: { purpose: EarPurpose; engine?: EarEngineId }): Promise<EarStatus> {
        if (this.cleanup) await this.cleanup;
        if (this.busy) return this.current;
        this.busy = true;
        this.starting = this.begin(options).finally(() => { this.starting = undefined; });
        return this.starting;
    }

    protected async begin(options: { purpose: EarPurpose; engine?: EarEngineId }): Promise<EarStatus> {
        this.setStatus({ state: 'starting', mic: 'unknown', purpose: options.purpose });
        try {
            const capabilities = await this.ear.capabilities();
            const engine = options.engine ?? resolveEarEngine(this.preferences, capabilities);
            if (!engine || !capabilities.engines.some(value => value.id === engine && value.available)) {
                throw new Error(capabilities.engines.map(value => value.reason).filter(Boolean).join(' / ')
                    || '使える聞き取りエンジンがありません');
            }
            const status = await this.ear.start({ purpose: options.purpose, engine });
            this.setStatus(status);
            if (status.state === 'error' || status.mic === 'denied') {
                throw new Error(status.message ?? 'マイクの使用が許可されていません');
            }
            if (engine === 'record-then-transcribe' && !capabilities.testInput) {
                this.recorder = this.createRecorder();
                await this.recorder.start();
            }
            return this.current;
        } catch (error) {
            const denied = this.current.mic === 'denied'
                || error instanceof DOMException && error.name === 'NotAllowedError';
            await this.releaseRecorder();
            try { await this.ear.stop(); } catch { /* 元の理由を優先する。 */ }
            this.busy = false;
            return this.setStatus({ state: 'error', mic: denied ? 'denied' : 'unknown',
                purpose: options.purpose, message: error instanceof Error ? error.message : '聞き取りを始められませんでした' });
        }
    }

    async stop(): Promise<EarStatus> {
        if (this.starting) await this.starting;
        if (this.stopping) return this.stopping;
        if (!this.busy) { if (this.cleanup) await this.cleanup; return this.current; }
        this.stopping = (async () => {
            this.setStatus({ ...this.current, state: 'stopping' });
            try {
                await this.releaseRecorder();
                const status = await this.ear.stop();
                this.busy = false;
                return this.setStatus(status);
            } catch (error) {
                this.busy = false;
                return this.setStatus({ state: 'error', mic: 'unknown',
                    message: error instanceof Error ? error.message : '聞き取りを止められませんでした' });
            } finally { this.stopping = undefined; }
        })();
        return this.stopping;
    }

    protected async releaseRecorder(): Promise<void> {
        const recorder = this.recorder;
        this.recorder = undefined;
        await recorder?.stop();
    }

    protected createRecorder(): EarRecorder { return new EarRecorder(this.ear); }

    dispose(): void {
        void this.stop();
        this.subscriptions.dispose();
        this.changeEmitter.dispose();
        this.utteranceEmitter.dispose();
        this.levelEmitter.dispose();
    }
}
