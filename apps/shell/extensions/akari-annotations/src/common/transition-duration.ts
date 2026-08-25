const TRANSITION_DURATION_WRITE_PRECISION = 1_000_000;

/** UI が edit.json へ書く実効尺だけを安定した小数へ丸める。カーネルの連続量は丸めない。 */
export function roundTransitionDurationForWrite(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.round(seconds * TRANSITION_DURATION_WRITE_PRECISION) / TRANSITION_DURATION_WRITE_PRECISION;
}

/** 書き込み値と通知値が同じ数を表すための共通表示。 */
export function formatTransitionSeconds(seconds: number): string {
    return seconds.toFixed(2).replace(/\.0+$/u, '').replace(/(\.\d*[1-9])0+$/u, '$1');
}
