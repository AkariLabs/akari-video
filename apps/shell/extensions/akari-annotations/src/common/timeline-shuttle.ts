export type ShuttleRate = -8 | -4 | -2 | -1 | 0 | 1 | 2 | 4 | 8;
export type ShuttleDirection = -1 | 1;
export type ShuttleCancelReason = 'space' | 'stop' | 'pointer' | 'drag' | 'edit' | 'dispose' | 'edge';

const RATES: readonly ShuttleRate[] = [-8, -4, -2, -1, 0, 1, 2, 4, 8];

export function nextShuttleRate(rate: ShuttleRate, direction: ShuttleDirection): ShuttleRate {
    const index = RATES.indexOf(rate);
    return RATES[Math.max(0, Math.min(RATES.length - 1, index + direction))];
}

export function advanceShuttle(time: number, rate: ShuttleRate, elapsedSeconds: number, duration: number):
    { time: number; rate: ShuttleRate } {
    const end = Math.max(0, duration);
    const next = Math.min(end, Math.max(0, time + rate * Math.max(0, elapsedSeconds)));
    return { time: next, rate: rate < 0 && next <= 0 || rate > 0 && next >= end ? 0 : rate };
}

export function shuttleCancelEffect(rate: ShuttleRate, reason: ShuttleCancelReason, previewPlaying = false):
    { pausePlayback: boolean; nextRate: 0 } {
    const stopPlayback = reason === 'space' || reason === 'stop';
    return { pausePlayback: stopPlayback && (rate === 1 || previewPlaying), nextRate: 0 };
}
