// 339a3fe4 の「右方向余白」を残しつつ、全体表示の2倍を10%へ改めた（2026-08-27）。
export const FIT_TAIL_RATIO = 0.1;
export const FIT_TAIL_MIN_SECONDS = 1;
export const ZOOMED_TAIL_RATIO = 0.5;

/** ストリップが表す総尺（出力秒）。contentEnd = コンテンツ終端、viewDuration = ズーム中の表示幅（全体表示なら undefined）。 */
export function resolveTimelineExtentSeconds(
    contentEnd: number,
    viewDuration: number | undefined
): number {
    if (viewDuration === undefined) {
        return contentEnd + Math.max(FIT_TAIL_MIN_SECONDS, contentEnd * FIT_TAIL_RATIO);
    }
    return Math.max(contentEnd * 1.02, contentEnd + ZOOMED_TAIL_RATIO * viewDuration);
}
