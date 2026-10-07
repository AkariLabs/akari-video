import { AkariProjectService } from '../../common/akari-project-protocol';
import {
    VOICE_RECORDING_SAMPLE_RATE, bytesToBase64, mixToMono, resampleToPcm16, rmsLevel
} from '../../common/voice-recording';

export interface VoiceRecorderState {
    phase: 'idle' | 'monitoring' | 'recording' | 'saving' | 'error';
    elapsedSec: number;
    level: number;
    deviceId?: string;
    devices: { deviceId: string; label: string }[];
    gainPercent: number;
    lastSaved?: { assetPath: string; durationSec: number };
    error?: string;
}

type MicrophoneWindow = Window & { electronAkariPreview?: { askForMicrophoneAccess?: () => Promise<boolean> } };

export class VoiceRecorder {
    protected current: VoiceRecorderState = { phase: 'idle', elapsedSec: 0, level: 0, devices: [], gainPercent: 100 };
    protected stream?: MediaStream;
    protected context?: AudioContext;
    protected source?: MediaStreamAudioSourceNode;
    protected gain?: GainNode;
    protected processor?: ScriptProcessorNode;
    protected silentGain?: GainNode;
    protected recordingId?: string;
    protected projectUri?: string;
    protected pending: Float32Array[] = [];
    protected pendingCount = 0;
    protected writeTail: Promise<void> = Promise.resolve();
    protected writeError?: unknown;
    protected startedAt = 0;
    protected clock?: ReturnType<typeof setInterval>;
    protected starting = false;
    protected stopping?: Promise<void>;
    protected monitorOpening?: Promise<void>;
    protected startPending?: Promise<void>;
    protected disposed = false;

    constructor(protected readonly service: AkariProjectService, protected readonly onState: (state: VoiceRecorderState) => void) {}

    get state(): VoiceRecorderState { return this.current; }

    protected emit(patch: Partial<VoiceRecorderState>): void {
        this.current = { ...this.current, ...patch };
        this.onState({ ...this.current, devices: [...this.current.devices] });
    }

    async openMonitor(deviceId?: string): Promise<void> {
        if (this.disposed) return;
        const opening = this.openMonitorNow(deviceId);
        this.monitorOpening = opening;
        try { await opening; } finally { if (this.monitorOpening === opening) this.monitorOpening = undefined; }
    }

    protected async openMonitorNow(deviceId?: string): Promise<void> {
        let stream: MediaStream | undefined;
        let context: AudioContext | undefined;
        try {
            const ask = (window as MicrophoneWindow).electronAkariPreview?.askForMicrophoneAccess;
            if (ask && !await ask()) {
                throw new Error('マイクの使用が許可されていません。システム設定 → プライバシーとセキュリティ → マイク で AKARI Video を許可してください');
            }
            if (!navigator.mediaDevices?.getUserMedia) throw new Error('この環境ではマイクを使えません。');
            stream = await navigator.mediaDevices.getUserMedia({ audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: true, noiseSuppression: false, autoGainControl: false
            } });
            try { context = new AudioContext({ sampleRate: VOICE_RECORDING_SAMPLE_RATE }); }
            catch { context = new AudioContext(); }
            await context.resume();
            const source = context.createMediaStreamSource(stream);
            const gain = context.createGain();
            gain.gain.value = this.current.gainPercent / 100;
            const processor = context.createScriptProcessor(4096, 1, 1);
            const silentGain = context.createGain();
            silentGain.gain.value = 0;
            source.connect(gain);
            gain.connect(processor);
            processor.connect(silentGain);
            silentGain.connect(context.destination);
            processor.onaudioprocess = event => this.capture(event);
            this.stream = stream;
            this.context = context;
            this.source = source;
            this.gain = gain;
            this.processor = processor;
            this.silentGain = silentGain;
            const devices = (await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === 'audioinput')
                .map((item, index) => ({ deviceId: item.deviceId, label: item.label || `マイク ${index + 1}` }));
            const selectedDeviceId = deviceId || stream.getAudioTracks?.()[0]?.getSettings?.().deviceId || devices[0]?.deviceId;
            this.emit({ phase: 'monitoring', deviceId: selectedDeviceId, devices, error: undefined, level: 0 });
        } catch (error) {
            stream?.getTracks().forEach(track => track.stop());
            await context?.close().catch(() => undefined);
            this.emit({ phase: 'error', error: error instanceof Error ? error.message : String(error), level: 0 });
        }
    }

    async setDevice(deviceId: string): Promise<void> {
        if (this.current.phase === 'recording' || this.current.phase === 'saving' || this.starting) return;
        await this.closeMonitor();
        if (this.disposed) return;
        await this.openMonitor(deviceId);
    }

    setGain(percent: number): void {
        const gainPercent = Math.min(200, Math.max(0, Number.isFinite(percent) ? percent : 100));
        if (this.gain) this.gain.gain.value = gainPercent / 100;
        this.emit({ gainPercent });
    }

    async start(projectUri: string): Promise<void> {
        if (this.disposed) return;
        const starting = this.startNow(projectUri);
        this.startPending = starting;
        try { await starting; } finally { if (this.startPending === starting) this.startPending = undefined; }
    }

    protected async startNow(projectUri: string): Promise<void> {
        if (this.current.phase !== 'monitoring' || this.starting) return;
        this.starting = true;
        try {
            const started = await this.service.startVoiceRecording(projectUri);
            this.recordingId = started.recordingId;
            this.projectUri = projectUri;
            this.pending = [];
            this.pendingCount = 0;
            this.writeTail = Promise.resolve();
            this.writeError = undefined;
            this.startedAt = performance.now();
            this.emit({ phase: 'recording', elapsedSec: 0, lastSaved: undefined, error: undefined });
            this.clock = setInterval(() => this.emit({ elapsedSec: (performance.now() - this.startedAt) / 1000 }), 250);
        } catch (error) {
            this.emit({ phase: 'error', error: `アフレコを保存できませんでした: ${error instanceof Error ? error.message : String(error)}` });
        } finally {
            this.starting = false;
        }
    }

    protected capture(event: AudioProcessingEvent): void {
        const input = event.inputBuffer;
        const channels = Array.from({ length: input.numberOfChannels }, (_, index) => input.getChannelData(index));
        const samples = mixToMono(channels);
        this.emit({ level: rmsLevel(samples) });
        if (this.current.phase !== 'recording' || !this.recordingId) return;
        this.pending.push(samples);
        this.pendingCount += samples.length;
        if (this.pendingCount >= (this.context?.sampleRate ?? VOICE_RECORDING_SAMPLE_RATE)) this.flush();
    }

    protected flush(): void {
        if (!this.pendingCount || !this.recordingId) return;
        const samples = new Float32Array(this.pendingCount);
        let offset = 0;
        for (const part of this.pending) { samples.set(part, offset); offset += part.length; }
        this.pending = [];
        this.pendingCount = 0;
        const pcmBase64 = bytesToBase64(resampleToPcm16(samples, this.context?.sampleRate ?? VOICE_RECORDING_SAMPLE_RATE,
            VOICE_RECORDING_SAMPLE_RATE));
        const recordingId = this.recordingId;
        this.writeTail = this.writeTail.then(() => this.service.appendVoiceRecording({ recordingId, pcmBase64 }))
            .catch(error => { this.writeError = error; });
    }

    async stop(): Promise<void> {
        if (this.stopping) return this.stopping;
        if (this.current.phase !== 'recording' || !this.recordingId) return;
        this.stopping = this.finishTake();
        try { await this.stopping; } finally { this.stopping = undefined; }
    }

    protected async finishTake(): Promise<void> {
        clearInterval(this.clock);
        this.clock = undefined;
        this.emit({ elapsedSec: (performance.now() - this.startedAt) / 1000, phase: 'saving' });
        this.flush();
        const recordingId = this.recordingId!;
        const projectUri = this.projectUri!;
        try {
            await this.writeTail;
            if (this.writeError) throw this.writeError;
            const result = await this.service.finishVoiceRecording({ recordingId });
            if (result) {
                this.emit({ phase: 'monitoring', lastSaved: { assetPath: result.assetPath, durationSec: result.durationSec }, error: undefined });
                window.dispatchEvent(new CustomEvent('akari.material.added', { detail: { projectUri, assetPath: result.assetPath } }));
            } else {
                this.emit({ phase: 'monitoring', error: '短すぎたので保存しませんでした（0.5 秒以上録ってください）' });
            }
        } catch (error) {
            await this.service.finishVoiceRecording({ recordingId, discard: true }).catch(() => undefined);
            this.emit({ phase: 'monitoring', error: `アフレコを保存できませんでした: ${error instanceof Error ? error.message : String(error)}` });
        } finally {
            this.recordingId = undefined;
            this.pending = [];
            this.pendingCount = 0;
        }
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        await this.monitorOpening;
        await this.startPending;
        await this.stop();
        await this.closeMonitor();
    }

    protected async closeMonitor(): Promise<void> {
        if (this.processor) this.processor.onaudioprocess = null;
        this.source?.disconnect();
        this.gain?.disconnect();
        this.processor?.disconnect();
        this.silentGain?.disconnect();
        this.stream?.getTracks().forEach(track => track.stop());
        await this.context?.close().catch(() => undefined);
        this.stream = undefined;
        this.context = undefined;
        this.source = undefined;
        this.gain = undefined;
        this.processor = undefined;
        this.silentGain = undefined;
        this.emit({ phase: 'idle', level: 0 });
    }
}
