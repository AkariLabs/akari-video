export const VOICE_RECORDING_SAMPLE_RATE = 48_000;
export const VOICE_RECORDING_MIN_SEC = 0.5;
export const VOICE_RECORDING_DIRECTORY = 'assets/afreco';
// fft（afftdn・ノイズ床 -30 dB 固定）は声の高域まで削ってこもる。
// nlm は声をほぼ変えず無音部のノイズだけ下げる（実測）。
export const VOICE_RECORDING_DENOISE = { method: 'nlm', strength: 1 } as const;

/** Preview と同じ macOS の固定ルート別名・パス表記へ揃える。 */
export function canonicalEditUri(value: string): string {
    try {
        const uri = new URL(value);
        if (uri.protocol !== 'file:') return value;
        const parts: string[] = [];
        for (const part of decodeURIComponent(uri.pathname).normalize('NFC').split('/')) {
            if (!part || part === '.') continue;
            if (part === '..') parts.pop();
            else parts.push(part);
        }
        if (!uri.host && ['tmp', 'var', 'etc'].includes(parts[0])) parts.unshift('private');
        return `file://${uri.host}/${parts.join('/')}`;
    } catch { return value; }
}

/** 同じ edit.json なら、プレビューを開けるワークスペース表記を優先する。 */
export function preferWorkspaceEditUri(given: string | undefined, candidate: string | undefined): string | undefined {
    if (given === undefined) return undefined;
    return candidate !== undefined && canonicalEditUri(given) === canonicalEditUri(candidate) ? candidate : given;
}

export function voiceRecordingFileName(now: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `afreco-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.wav`;
}

export function formatRecordingClock(sec: number): string {
    const whole = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}`;
}

export function formatTimelineTime(sec: number): string {
    const value = Math.max(0, Number.isFinite(sec) ? sec : 0);
    const pad = (part: number): string => String(part).padStart(2, '0');
    return `${pad(Math.floor(value / 60))}:${pad(Math.floor(value % 60))}.${Math.floor(value * 10) % 10}`;
}

export function mixToMono(channels: Float32Array[]): Float32Array {
    const length = channels[0]?.length ?? 0;
    const mono = new Float32Array(length);
    for (const channel of channels) {
        for (let index = 0; index < length; index += 1) mono[index] += channel[index] / channels.length;
    }
    return mono;
}

export function rmsLevel(samples: Float32Array): number {
    if (!samples.length) return 0;
    let squared = 0;
    for (const sample of samples) squared += sample * sample;
    return Math.min(1, Math.sqrt(squared / samples.length));
}

export function levelToBars(level: number, bars: number): number {
    return Math.round(Math.min(1, Math.max(0, level * 4)) * bars);
}

export function resampleToPcm16(samples: Float32Array, inputRate: number, outputRate: number): Uint8Array {
    if (!samples.length) return new Uint8Array();
    if (!(inputRate > 0) || !(outputRate > 0)) throw new Error('Sample rates must be positive');
    const outputLength = Math.max(1, Math.round(samples.length * outputRate / inputRate));
    const output = new Uint8Array(outputLength * 2);
    const view = new DataView(output.buffer);
    const ratio = inputRate / outputRate;
    for (let index = 0; index < outputLength; index += 1) {
        const start = Math.min(samples.length - 1, Math.floor(index * ratio));
        const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
        let total = 0;
        for (let source = start; source < end; source += 1) total += samples[source];
        const sample = Math.max(-1, Math.min(1, total / (end - start)));
        view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return output;
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
}
