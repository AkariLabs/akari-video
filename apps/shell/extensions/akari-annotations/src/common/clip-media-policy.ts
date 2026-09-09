/** サイズによる表示ティアを設けず、正の領域と動画 URI があれば描画する。 */
export function canRenderClipMedia(clipWidth: number, trackHeightPx: number, videoUri: string): boolean {
    return clipWidth > 0 && trackHeightPx > 0 && !!videoUri;
}

/** 端数セルも残し、極小幅でも最低 1 コマを確保する。 */
export function filmstripCellCount(fullClipWidthPx: number, cellWidthPx: number): number {
    const width = Number.isFinite(fullClipWidthPx) ? Math.max(0, fullClipWidthPx) : 0;
    const cellWidth = Number.isFinite(cellWidthPx) ? Math.max(1, cellWidthPx) : 1;
    return Math.max(1, Math.ceil(width / cellWidth));
}

/** 固定高の波形 canvas を極小トラック内へ縮めるための CSS 幾何。 */
export function clipWaveformBand(trackHeightPx: number, bandHeightPx: number): { top: number; height: number } {
    const trackHeight = Number.isFinite(trackHeightPx) ? Math.max(1, trackHeightPx) : 1;
    const bandHeight = Number.isFinite(bandHeightPx) ? Math.max(1, bandHeightPx) : 1;
    const height = Math.min(trackHeight, bandHeight);
    return { top: Math.max(0, trackHeight - height), height };
}

export interface MediaCacheFailure {
    readonly status: 'unavailable';
    readonly failedAt: number;
    /** 初回は 0、唯一の再試行は 1。pending への置換前に取得処理へ引き継ぐ。 */
    readonly attempt: 0 | 1;
}

export function isMediaCacheFailure(entry: unknown): entry is MediaCacheFailure {
    return typeof entry === 'object' && entry !== null && 'status' in entry
        && entry.status === 'unavailable';
}

/** 未取得か、初回失敗から 5 秒経過した要求だけを許可する。時刻は呼び出し側から渡す。 */
export function mediaCacheRequestAttempt(entry: unknown, now: number): 0 | 1 | undefined {
    if (entry === undefined) return 0;
    if (isMediaCacheFailure(entry) && entry.attempt === 0 && now - entry.failedAt >= 5000) return 1;
    return undefined;
}
