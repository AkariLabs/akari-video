import { AkariEarFrontend } from '../common/ear-frontend';

interface RecorderApis {
    askForMicrophoneAccess?: () => Promise<boolean>;
    getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
    createAudioContext: () => AudioContext;
}

export class EarRecorder {
    protected stream: MediaStream | undefined;
    protected context: AudioContext | undefined;
    protected processor: ScriptProcessorNode | undefined;
    protected source: MediaStreamAudioSourceNode | undefined;
    protected silentGain: GainNode | undefined;
    protected pending: Promise<void> = Promise.resolve();

    constructor(protected readonly frontend: AkariEarFrontend, protected readonly apis: RecorderApis = {
        askForMicrophoneAccess: () => (window as Window & {
            electronAkariPreview?: { askForMicrophoneAccess?: () => Promise<boolean> }
        }).electronAkariPreview?.askForMicrophoneAccess?.() ?? Promise.resolve(true),
        getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
        createAudioContext: () => new AudioContext({ sampleRate: 16000 })
    }) {}

    async start(): Promise<void> {
        if (this.context) return;
        if (this.apis.askForMicrophoneAccess && !await this.apis.askForMicrophoneAccess()) {
            throw new DOMException('マイクの使用が許可されていません', 'NotAllowedError');
        }
        this.stream = await this.apis.getUserMedia({ audio: true });
        try {
            this.context = this.apis.createAudioContext();
            await this.context.resume();
            this.source = this.context.createMediaStreamSource(this.stream);
            this.processor = this.context.createScriptProcessor(4096, 1, 1);
            this.silentGain = this.context.createGain();
            this.silentGain.gain.value = 0;
            this.source.connect(this.processor);
            this.processor.connect(this.silentGain);
            this.silentGain.connect(this.context.destination);
            this.processor.onaudioprocess = event => {
                const input = event.inputBuffer;
                const samples = new Float32Array(input.length);
                for (let channel = 0; channel < input.numberOfChannels; channel++) {
                    const data = input.getChannelData(channel);
                    for (let i = 0; i < samples.length; i++) samples[i] += data[i] / input.numberOfChannels;
                }
                const pcm = EarRecorder.toPcm16(samples, input.sampleRate);
                this.pending = this.pending.then(() => this.frontend.appendAudio(pcm));
            };
        } catch (error) {
            await this.stop();
            throw error;
        }
    }

    async stop(): Promise<void> {
        if (this.processor) this.processor.onaudioprocess = null;
        this.source?.disconnect();
        this.processor?.disconnect();
        this.silentGain?.disconnect();
        this.stream?.getTracks().forEach(track => track.stop());
        await this.context?.close();
        this.context = undefined;
        this.stream = undefined;
        this.processor = undefined;
        await this.pending;
    }

    static toPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
        const count = Math.max(1, Math.round(samples.length * 16000 / sampleRate));
        const output = new Uint8Array(count * 2);
        const view = new DataView(output.buffer);
        for (let i = 0; i < count; i++) {
            const start = Math.min(samples.length - 1, Math.floor(i * sampleRate / 16000));
            const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * sampleRate / 16000)));
            let sum = 0;
            for (let j = start; j < end; j++) sum += samples[j];
            const value = Math.max(-1, Math.min(1, sum / (end - start)));
            view.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
        }
        return output;
    }
}
