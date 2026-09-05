/** Linear amplitudes are retained on the wire; dBFS is only a display unit.
 * Keep these functions self-contained: the webview injects them with toString(). */
export interface AudioMeterFrame {
    type: 'akari-preview-audio-meter';
    peak: [number, number];
    rms: [number, number];
    clip: boolean;
    playing: boolean;
    channels: 1 | 2;
    engine: 'frame-engine' | 'legacy';
    t: number;
}

export function measureBlock(samples: Float32Array): { peak: number; rms: number } {
    let peak = 0;
    let squares = 0;
    for (const sample of samples) {
        const value = Number.isFinite(sample) ? Math.abs(sample) : 0;
        peak = Math.max(peak, value);
        squares += value * value;
    }
    return { peak, rms: samples.length ? Math.sqrt(squares / samples.length) : 0 };
}

export function linearToDbfs(v: number): number {
    return v > 0 ? 20 * Math.log10(v) : -Infinity;
}

/** value is linear. After the hold expires, heldAt tracks the decay cursor minus
 * holdMs, so repeated calls decay by elapsed time without restarting the hold. */
export function holdPeak(
    prev: { value: number; heldAt: number } | null,
    next: number,
    now: number,
    holdMs = 1500,
    decayDbPerSec = 20
): { value: number; heldAt: number } {
    if (!prev || next >= prev.value) return { value: next, heldAt: now };
    const elapsed = Math.max(0, now - prev.heldAt - holdMs);
    if (!elapsed) return { ...prev };
    const value = prev.value * Math.pow(10, -decayDbPerSec * elapsed / 20000);
    return next >= value
        ? { value: next, heldAt: now }
        : { value, heldAt: now - holdMs };
}

export function latchClip(prev: boolean, peakDb: number, threshold = -0.1): boolean {
    return prev || peakDb >= threshold;
}

export function meterFraction(db: number, floorDb = -60): number {
    if (Number.isNaN(db) || db <= floorDb) return 0;
    return Math.max(0, Math.min(1, (db - floorDb) / -floorDb));
}

export function isAudioMeterFrame(value: unknown): value is AudioMeterFrame {
    if (!value || typeof value !== 'object') return false;
    const frame = value as AudioMeterFrame;
    const pair = (v: unknown): boolean => Array.isArray(v) && v.length === 2
        && [v[0], v[1]].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0);
    return frame.type === 'akari-preview-audio-meter'
        && pair(frame.peak) && pair(frame.rms)
        && typeof frame.clip === 'boolean' && typeof frame.playing === 'boolean'
        && (frame.channels === 1 || frame.channels === 2)
        && (frame.engine === 'frame-engine' || frame.engine === 'legacy')
        && Number.isFinite(frame.t) && frame.t >= 0;
}
