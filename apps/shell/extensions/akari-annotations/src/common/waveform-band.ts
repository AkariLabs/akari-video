export interface WaveformBandLayout {
    topPx: number;
    heightPx: number;
}

export const WAVEFORM_BAND_MIN_HEIGHT_PX = 12;

/**
 * 上下 1px の余白でアイテム中央に上下対称の帯を置き、最低高 12px を優先する。
 * 第 2 引数は後方互換のために残す。ヘッダーは帯に重ねるため、レイアウトには使わない。
 */
export function waveformBandLayout(clipHeightPx: number, _headerHeightPx: number): WaveformBandLayout {
    const clipHeight = Number.isFinite(clipHeightPx) ? Math.max(0, clipHeightPx) : 0;
    const heightPx = Math.max(WAVEFORM_BAND_MIN_HEIGHT_PX, clipHeight - 2);
    const topPx = Math.max(0, (clipHeight - heightPx) / 2);
    return { topPx, heightPx };
}

/** 既定波形は 40 バケット/秒。短尺と長尺のメモリ使用量を制限する。 */
export function waveformBucketsForDuration(durationSeconds: number): number {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 256;
    return Math.max(256, Math.min(16384, Math.round(durationSeconds * 40)));
}
