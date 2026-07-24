import {
    AkariPreviewService,
    ReviewSessionSummary,
    ReviewSessionTransportEvent,
    StartReviewSessionRequest,
    StartReviewSessionResult
} from '../common/akari-preview-protocol';

export type ReviewSessionRecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'error';

export interface ReviewSessionUiState {
    editUri: string;
    projectRootUri: string;
    status: ReviewSessionRecorderStatus;
    active: boolean;
    elapsedSec: number;
    level: number;
    silenceWarning: boolean;
    sessions: ReviewSessionSummary[];
    error?: string;
}

export interface ReviewTransportSnapshot {
    timelineT: number;
    playing: boolean;
    rate: number;
}

export type ReviewTransportChange =
    | { type: 'play'; timelineT: number }
    | { type: 'pause'; timelineT: number }
    | { type: 'seek'; from: number; to: number }
    | { type: 'rate'; value: number; timelineT: number };

interface ActiveReviewSession extends StartReviewSessionResult {
    projectRootUri: string;
    editUri: string;
    monotonicStartedAt: number;
    lastRecT: number;
    transport: ReviewTransportSnapshot;
    stream: MediaStream;
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    silentGain: GainNode;
    pendingSamples: Float32Array[];
    pendingSampleCount: number;
    level: number;
    lastNonSilentAt: number;
    writeTail: Promise<void>;
    writeError?: Error;
}

const TARGET_SAMPLE_RATE = 16_000;
const AUDIO_FLUSH_INTERVAL_MS = 1_000;
const UI_UPDATE_INTERVAL_MS = 250;
const TICK_INTERVAL_MS = 1_000;
const SILENCE_WARNING_AFTER_MS = 5_000;

export class ReviewSessionRecorder {
    protected active: ActiveReviewSession | undefined;
    protected status: ReviewSessionRecorderStatus = 'idle';
    protected sessions: ReviewSessionSummary[] = [];
    protected uiTimer: number | undefined;
    protected tickTimer: number | undefined;
    protected requestedEditUri = '';
    protected requestedProjectRootUri = '';

    constructor(
        protected readonly service: AkariPreviewService,
        protected readonly onState: (state: ReviewSessionUiState) => void
    ) {}

    async refresh(projectRootUri: string, editUri: string): Promise<void> {
        if (!projectRootUri || !editUri) {
            return;
        }
        this.requestedProjectRootUri = projectRootUri;
        this.requestedEditUri = editUri;
        try {
            this.sessions = await this.service.listReviewSessions({ projectRootUri });
            this.emitState();
        } catch (error) {
            console.warn('[akari-preview] failed to list review sessions', error);
            this.emitState(this.message(error));
        }
    }

    async start(request: StartReviewSessionRequest, initial: ReviewTransportSnapshot): Promise<void> {
        if (this.active || this.status === 'starting' || this.status === 'stopping') {
            return;
        }
        this.requestedProjectRootUri = request.projectRootUri;
        this.requestedEditUri = request.editUri;
        this.status = 'starting';
        this.emitState();

        let stream: MediaStream | undefined;
        let context: AudioContext | undefined;
        try {
            const askForMicrophoneAccess = typeof window !== 'undefined'
                ? window.electronAkariPreview?.askForMicrophoneAccess
                : undefined;
            if (askForMicrophoneAccess && !await askForMicrophoneAccess()) {
                throw new DOMException('Microphone access denied', 'NotAllowedError');
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error('この環境ではマイク録音を利用できません。');
            }
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
            await context.resume();
            const source = context.createMediaStreamSource(stream);
            const processor = context.createScriptProcessor(4096, 1, 1);
            const silentGain = context.createGain();
            silentGain.gain.value = 0;
            source.connect(processor);
            processor.connect(silentGain);
            silentGain.connect(context.destination);

            const started = await this.service.startReviewSession(request);
            const monotonicStartedAt = performance.now();
            const active: ActiveReviewSession = {
                ...started,
                projectRootUri: request.projectRootUri,
                editUri: request.editUri,
                monotonicStartedAt,
                lastRecT: 0,
                transport: { ...initial },
                stream,
                context,
                source,
                processor,
                silentGain,
                pendingSamples: [],
                pendingSampleCount: 0,
                level: 0,
                lastNonSilentAt: monotonicStartedAt,
                writeTail: Promise.resolve()
            };
            processor.onaudioprocess = event => this.captureAudio(active, event);
            this.active = active;
            if (initial.rate !== 1) {
                this.enqueue(active, () => this.service.appendReviewSessionEvent({
                    sessionDir: active.sessionDir,
                    event: { recT: this.recT(active), type: 'rate', value: initial.rate }
                }));
            }
            this.status = 'recording';
            this.startTimers();
            this.emitState();
        } catch (error) {
            stream?.getTracks().forEach(track => track.stop());
            if (context) {
                await context.close().catch(() => undefined);
            }
            this.status = 'error';
            this.emitState(this.message(error));
        }
    }

    reportError(projectRootUri: string, editUri: string, error: string): void {
        this.requestedProjectRootUri = projectRootUri;
        this.requestedEditUri = editUri;
        this.status = 'error';
        this.emitState(error);
    }

    async stop(): Promise<void> {
        const active = this.active;
        if (!active || this.status === 'stopping') {
            return;
        }
        this.status = 'stopping';
        this.stopTimers();
        this.emitState();
        active.processor.onaudioprocess = null;
        this.flushAudio(active);
        active.source.disconnect();
        active.processor.disconnect();
        active.silentGain.disconnect();
        active.stream.getTracks().forEach(track => track.stop());
        await active.context.close().catch(() => undefined);

        try {
            await active.writeTail;
            if (active.writeError) {
                throw active.writeError;
            }
            const recT = this.recT(active);
            await this.service.endReviewSession({
                sessionDir: active.sessionDir,
                startedAt: active.startedAt,
                endedAt: new Date().toISOString(),
                editHash: active.editHash,
                recT,
                timelineT: active.transport.timelineT
            });
            this.active = undefined;
            this.status = 'idle';
            await this.refresh(active.projectRootUri, active.editUri);
        } catch (error) {
            this.active = undefined;
            this.status = 'error';
            await this.refresh(active.projectRootUri, active.editUri);
            this.emitState(`録音セッションを完了できませんでした: ${this.message(error)}`);
        }
    }

    handlePlaybackTick(editUri: string, time: number, playing: boolean): void {
        const active = this.active;
        if (!active || active.editUri !== editUri || !Number.isFinite(time)) {
            return;
        }
        active.transport.timelineT = time;
        active.transport.playing = playing;
    }

    handleTransport(editUri: string, change: ReviewTransportChange): void {
        const active = this.active;
        if (!active || active.editUri !== editUri) {
            return;
        }
        let event: ReviewSessionTransportEvent;
        const recT = this.recT(active);
        if (change.type === 'play' || change.type === 'pause') {
            active.transport.timelineT = change.timelineT;
            active.transport.playing = change.type === 'play';
            event = { recT, type: change.type, timelineT: change.timelineT };
        } else if (change.type === 'seek') {
            active.transport.timelineT = change.to;
            event = { recT, type: 'seek', from: change.from, to: change.to };
        } else {
            active.transport.timelineT = change.timelineT;
            active.transport.rate = change.value;
            event = { recT, type: 'rate', value: change.value };
        }
        this.enqueue(active, () => this.service.appendReviewSessionEvent({
            sessionDir: active.sessionDir,
            event
        }));
    }

    async dispose(): Promise<void> {
        if (this.active) {
            await this.stop();
        } else {
            this.stopTimers();
        }
    }

    protected captureAudio(active: ActiveReviewSession, event: AudioProcessingEvent): void {
        if (this.active !== active || this.status !== 'recording') {
            return;
        }
        const input = event.inputBuffer;
        const samples = new Float32Array(input.length);
        const channels = Math.max(1, input.numberOfChannels);
        for (let channel = 0; channel < channels; channel += 1) {
            const data = input.getChannelData(channel);
            for (let index = 0; index < samples.length; index += 1) {
                samples[index] += data[index] / channels;
            }
        }
        let squaredTotal = 0;
        for (const sample of samples) {
            squaredTotal += sample * sample;
        }
        active.level = samples.length > 0
            ? Math.min(1, Math.sqrt(squaredTotal / samples.length))
            : 0;
        if (active.level > 0) {
            active.lastNonSilentAt = performance.now();
        }
        active.pendingSamples.push(samples);
        active.pendingSampleCount += samples.length;
        if (active.pendingSampleCount >= active.context.sampleRate * (AUDIO_FLUSH_INTERVAL_MS / 1000)) {
            this.flushAudio(active);
        }
    }

    protected flushAudio(active: ActiveReviewSession): void {
        if (active.pendingSampleCount === 0) {
            return;
        }
        const samples = new Float32Array(active.pendingSampleCount);
        let offset = 0;
        for (const chunk of active.pendingSamples) {
            samples.set(chunk, offset);
            offset += chunk.length;
        }
        active.pendingSamples = [];
        active.pendingSampleCount = 0;
        const pcm = this.toPcm16(samples, active.context.sampleRate);
        const pcmBase64 = this.base64(pcm);
        this.enqueue(active, () => this.service.appendReviewSessionAudio({
            sessionDir: active.sessionDir,
            pcmBase64
        }));
    }

    protected toPcm16(samples: Float32Array, inputRate: number): Uint8Array {
        const outputLength = Math.max(1, Math.round(samples.length * TARGET_SAMPLE_RATE / inputRate));
        const output = new Uint8Array(outputLength * 2);
        const view = new DataView(output.buffer);
        const ratio = inputRate / TARGET_SAMPLE_RATE;
        for (let index = 0; index < outputLength; index += 1) {
            const start = Math.min(samples.length - 1, Math.floor(index * ratio));
            const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
            let total = 0;
            for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
                total += samples[sourceIndex];
            }
            const sample = Math.max(-1, Math.min(1, total / Math.max(1, end - start)));
            view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        }
        return output;
    }

    protected base64(bytes: Uint8Array): string {
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
        }
        return btoa(binary);
    }

    protected enqueue(active: ActiveReviewSession, operation: () => Promise<void>): void {
        active.writeTail = active.writeTail.then(async () => {
            if (active.writeError) {
                return;
            }
            try {
                await operation();
            } catch (error) {
                active.writeError = error instanceof Error ? error : new Error(String(error));
                this.status = 'error';
                this.emitState(`録音データを書き込めません: ${active.writeError.message}`);
            }
        });
    }

    protected startTimers(): void {
        this.stopTimers();
        this.uiTimer = window.setInterval(() => this.emitState(), UI_UPDATE_INTERVAL_MS);
        this.tickTimer = window.setInterval(() => {
            const active = this.active;
            if (!active || this.status !== 'recording' || !active.transport.playing) {
                return;
            }
            this.enqueue(active, () => this.service.appendReviewSessionEvent({
                sessionDir: active.sessionDir,
                event: {
                    recT: this.recT(active),
                    type: 'tick',
                    timelineT: active.transport.timelineT
                }
            }));
        }, TICK_INTERVAL_MS);
    }

    protected stopTimers(): void {
        if (this.uiTimer !== undefined) {
            window.clearInterval(this.uiTimer);
            this.uiTimer = undefined;
        }
        if (this.tickTimer !== undefined) {
            window.clearInterval(this.tickTimer);
            this.tickTimer = undefined;
        }
    }

    protected recT(active: ActiveReviewSession): number {
        const elapsed = Math.max(0, (performance.now() - active.monotonicStartedAt) / 1000);
        active.lastRecT = Math.max(active.lastRecT, elapsed);
        return active.lastRecT;
    }

    protected emitState(error?: string): void {
        const active = this.active;
        const level = active?.level ?? 0;
        this.onState({
            editUri: active?.editUri ?? this.requestedEditUri,
            projectRootUri: active?.projectRootUri ?? this.requestedProjectRootUri,
            status: this.status,
            active: Boolean(active),
            elapsedSec: active ? this.recT(active) : 0,
            level,
            silenceWarning: Boolean(
                active
                && level === 0
                && performance.now() - active.lastNonSilentAt >= SILENCE_WARNING_AFTER_MS
            ),
            sessions: [...this.sessions],
            ...(error ? { error } : {})
        });
    }

    protected message(error: unknown): string {
        if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
            return 'マイクの使用が許可されませんでした。設定で権限を確認してください。';
        }
        return error instanceof Error ? error.message : String(error);
    }
}
