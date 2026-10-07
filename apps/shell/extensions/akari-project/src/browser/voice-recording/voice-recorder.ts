import { AkariProjectService } from '../../common/akari-project-protocol';
import { CommandService } from '@theia/core/lib/common';
import {
    VOICE_RECORDING_SAMPLE_RATE, bytesToBase64, canonicalEditUri, mixToMono, resampleToPcm16, rmsLevel
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
    sync: boolean;
    muteProject: boolean;
    denoise: boolean;
    timelineT?: number;
    playing: boolean;
    startT?: number;
    script?: VoiceRecordScript;
    placed?: { itemId: string; t: number };
    placeError?: string;
}

export interface VoiceRecordScript { text: string; captionId?: string; start: number; end?: number }

const OPTIONS_KEY = 'akari.voice.record.options';
function readOptions(): Pick<VoiceRecorderState, 'sync' | 'muteProject' | 'denoise'> {
    try {
        const value = JSON.parse(window.localStorage.getItem(OPTIONS_KEY) || '{}');
        return { sync: typeof value.sync === 'boolean' ? value.sync : true,
            muteProject: typeof value.muteProject === 'boolean' ? value.muteProject : true,
            denoise: typeof value.denoise === 'boolean' ? value.denoise : false };
    } catch { return { sync: true, muteProject: true, denoise: false }; }
}

type MicrophoneWindow = Window & { electronAkariPreview?: { askForMicrophoneAccess?: () => Promise<boolean> } };

export class VoiceRecorder {
    protected current: VoiceRecorderState = { phase: 'idle', elapsedSec: 0, level: 0, devices: [], gainPercent: 100,
        sync: true, muteProject: true, denoise: false, playing: false };
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
    protected editUri?: string;
    protected activeEditUri?: string;
    protected muted = false;
    protected captureStartedAt?: number;
    protected playbackStartedAt?: number;
    protected lastAdvanceTime?: number;
    protected lastAdvanceAt?: number;
    protected readonly playbackTick = (event: Event): void => {
        if (!this.editUri) return;
        const detail = (event as CustomEvent<{ videoUri?: string; time?: number; playing?: boolean }>).detail;
        if (!detail?.videoUri || canonicalEditUri(detail.videoUri) !== canonicalEditUri(this.editUri)) return;
        const playing = detail.playing === true;
        const time = typeof detail.time === 'number' && Number.isFinite(detail.time) ? detail.time : undefined;
        this.emit({ ...(time === undefined ? {} : { timelineT: time }), playing });
        if (this.current.phase !== 'recording' || !this.activeEditUri) return;
        if (!playing && this.playbackStartedAt !== undefined) { void this.stop(); return; }
        if (!playing) return;
        const now = performance.now();
        if (this.playbackStartedAt === undefined) {
            this.playbackStartedAt = now;
            this.lastAdvanceTime = time;
            this.lastAdvanceAt = now;
        } else if (time !== undefined && (this.lastAdvanceTime === undefined || time > this.lastAdvanceTime)) {
            this.lastAdvanceTime = time;
            this.lastAdvanceAt = now;
        } else if (this.lastAdvanceAt !== undefined && now - this.lastAdvanceAt >= 1000) {
            void this.stop();
        }
    };

    constructor(protected readonly service: AkariProjectService, protected readonly onState: (state: VoiceRecorderState) => void,
        protected readonly commands?: CommandService) { this.current = { ...this.current, ...readOptions() }; }

    get state(): VoiceRecorderState { return this.current; }

    protected emit(patch: Partial<VoiceRecorderState>): void {
        this.current = { ...this.current, ...patch };
        this.onState({ ...this.current, devices: [...this.current.devices] });
    }

    setOption(option: 'sync' | 'muteProject' | 'denoise', enabled: boolean): void {
        if (this.current.phase === 'recording' || this.current.phase === 'saving') return;
        this.emit({ [option]: enabled });
        try { window.localStorage.setItem(OPTIONS_KEY, JSON.stringify({ sync: this.current.sync,
            muteProject: this.current.muteProject, denoise: this.current.denoise })); } catch { /* Storage is optional. */ }
    }

    setScript(script?: VoiceRecordScript): void { this.emit({ script }); }

    attachTransport(editUri?: string): void {
        this.detachTransport();
        this.editUri = editUri;
        if (editUri) window.addEventListener('akari.preview.playbackTick', this.playbackTick);
    }

    detachTransport(): void {
        window.removeEventListener('akari.preview.playbackTick', this.playbackTick);
        this.editUri = undefined;
    }

    protected setProjectMuted(muted: boolean, editUri: string): void {
        this.muted = muted;
        window.dispatchEvent(new CustomEvent('akari.timeline.setTrackVisibility',
            { detail: { videoUri: editUri, scope: 'cuts', track: null, muted } }));
        window.dispatchEvent(new CustomEvent('akari.timeline.setAudioMuted', { detail: { editUri, muted } }));
        window.dispatchEvent(new CustomEvent('akari.timeline.setLayersMuted', { detail: { editUri, muted } }));
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

    async start(projectUri: string, editUri?: string): Promise<void> {
        if (this.disposed) return;
        const starting = this.startNow(projectUri, editUri);
        this.startPending = starting;
        try { await starting; } finally { if (this.startPending === starting) this.startPending = undefined; }
    }

    protected async startNow(projectUri: string, editUri?: string): Promise<void> {
        if (this.current.phase !== 'monitoring' || this.starting) return;
        this.starting = true;
        const sync = this.current.sync && !!editUri;
        try {
            this.activeEditUri = sync ? editUri : undefined;
            this.captureStartedAt = undefined;
            this.playbackStartedAt = undefined;
            this.lastAdvanceTime = undefined;
            this.lastAdvanceAt = undefined;
            if (sync && editUri) {
                if (this.current.muteProject) this.setProjectMuted(true, editUri);
                this.emit({ startT: this.current.script?.start ?? this.current.timelineT ?? 0 });
                await this.commands?.executeCommand('akari.preview.seekOutput',
                    { editUri, time: this.current.startT, waitForReady: true });
            }
            const started = await this.service.startVoiceRecording(projectUri);
            this.recordingId = started.recordingId;
            this.projectUri = projectUri;
            this.pending = [];
            this.pendingCount = 0;
            this.writeTail = Promise.resolve();
            this.writeError = undefined;
            this.startedAt = performance.now();
            this.captureStartedAt = this.startedAt;
            this.emit({ phase: 'recording', elapsedSec: 0, lastSaved: undefined, placed: undefined,
                placeError: undefined, error: undefined });
            this.clock = setInterval(() => this.emit({ elapsedSec: (performance.now() - this.startedAt) / 1000 }), 250);
            if (sync && editUri) await this.commands?.executeCommand('akari.preview.play', { editUri });
        } catch (error) {
            if (this.activeEditUri && this.recordingId) await this.stop();
            if (this.muted && editUri) this.setProjectMuted(false, editUri);
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
        const editUri = this.activeEditUri;
        if (editUri) {
            try { await this.commands?.executeCommand('akari.preview.pause', { editUri }); }
            catch { /* WAV の確定と音の復帰を優先する。 */ }
            finally { if (this.muted) this.setProjectMuted(false, editUri); }
        }
        try {
            await this.writeTail;
            if (this.writeError) throw this.writeError;
            const result = await this.service.finishVoiceRecording({ recordingId });
            if (result) {
                let placed: VoiceRecorderState['placed'];
                let placeError: string | undefined;
                if (editUri) {
                    try {
                        const lead = this.playbackStartedAt === undefined || this.captureStartedAt === undefined
                            ? 0 : Math.max(0, (this.playbackStartedAt - this.captureStartedAt) / 1000);
                        const itemId = await this.commands?.executeCommand<string | undefined>(
                            'akari.timeline.addMaterialAtOutputPoint', { editUri, relativePath: result.assetPath,
                                kind: 'audio', t: this.current.startT, voiceTrack: true,
                                audio: { in: lead,
                                    ...(this.current.denoise ? { denoise: { method: 'fft', strength: 0.5 } } : {}),
                                    ...(this.current.script ? { script: this.current.script.text } : {}),
                                    ...(this.current.script?.captionId ? { captionRef: this.current.script.captionId } : {}),
                                    provenance: { provider: 'human', engine: 'microphone' } } });
                        if (!itemId) throw new Error('項目を追加できませんでした');
                        placed = { itemId, t: this.current.startT ?? 0 };
                    } catch (error) {
                        placeError = `素材には保存しました。タイムラインには置けませんでした: ${error instanceof Error ? error.message : String(error)}`;
                    }
                }
                this.emit({ phase: 'monitoring', lastSaved: { assetPath: result.assetPath, durationSec: result.durationSec },
                    placed, placeError, error: undefined });
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
            this.activeEditUri = undefined;
        }
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        await this.monitorOpening;
        await this.startPending;
        await this.stop();
        this.detachTransport();
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
