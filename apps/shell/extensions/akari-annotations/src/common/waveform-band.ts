export interface WaveformBandLayout {
    topPx: number;
    heightPx: number;
}

export const WAVEFORM_BAND_MIN_HEIGHT_PX = 12;

/** ラベル後の残り高さを使う。狭いクリップでは下端へ寄せ、最低高を優先する。 */
export function waveformBandLayout(clipHeightPx: number, headerHeightPx: number): WaveformBandLayout {
    const clipHeight = Number.isFinite(clipHeightPx) ? Math.max(0, clipHeightPx) : 0;
    const headerHeight = Number.isFinite(headerHeightPx) ? Math.max(0, headerHeightPx) : 0;
    const heightPx = Math.max(WAVEFORM_BAND_MIN_HEIGHT_PX, clipHeight - headerHeight);
    return { topPx: Math.max(0, Math.min(headerHeight, clipHeight - heightPx)), heightPx };
}

/** 既定波形は 40 バケット/秒。短尺と長尺のメモリ使用量を制限する。 */
export function waveformBucketsForDuration(durationSeconds: number): number {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 256;
    return Math.max(256, Math.min(16384, Math.round(durationSeconds * 40)));
}
