/**
 * render-cut CLI の `--progress` が吐く `PROGRESS out_time_ms=<n> total_ms=<n>` /
 * `PROGRESS done total_ms=<n>` 行を解釈し、% 進捗・経過/推定残り時間へ変換する純関数群
 * （task 2026-07-25-export-options）。子プロセスの stdout/stderr には他の出力
 * （edit-lint の JSON・ffmpeg の -loglevel error 出力等）も混じるため、この形式に
 * 一致する行だけを拾い、それ以外は無視する。
 */

export interface QuickExportProgressSnapshot {
    readonly percent: number;
    readonly outTimeMs: number;
    readonly totalMs: number;
    readonly done: boolean;
}

const PROGRESS_LINE_PATTERN = /^PROGRESS out_time_ms=(\d+) total_ms=(\d+)$/;
const PROGRESS_DONE_PATTERN = /^PROGRESS done total_ms=(\d+)$/;

/** 1行だけを解釈する。一致しなければ undefined（無視してよい行）。 */
export function parseQuickExportProgressLine(line: string): QuickExportProgressSnapshot | undefined {
    const trimmed = line.trim();
    const doneMatch = PROGRESS_DONE_PATTERN.exec(trimmed);
    if (doneMatch) {
        const totalMs = Number(doneMatch[1]);
        return { percent: 100, outTimeMs: totalMs, totalMs, done: true };
    }
    const match = PROGRESS_LINE_PATTERN.exec(trimmed);
    if (!match) {
        return undefined;
    }
    const outTimeMs = Number(match[1]);
    const totalMs = Number(match[2]);
    const percent = totalMs > 0 ? Math.min(100, Math.max(0, Math.round((outTimeMs / totalMs) * 100))) : 0;
    return { percent, outTimeMs, totalMs, done: false };
}

/**
 * 複数行を含みうるテキスト（ログ tail 全文）から、最後に見つかった PROGRESS
 * スナップショットだけを返す（呼び出し側は直近状態だけ使えばよい）。
 */
export function latestQuickExportProgress(text: string): QuickExportProgressSnapshot | undefined {
    let latest: QuickExportProgressSnapshot | undefined;
    for (const line of text.split(/\r?\n/)) {
        const parsed = parseQuickExportProgressLine(line);
        if (parsed) {
            latest = parsed;
        }
    }
    return latest;
}

export interface QuickExportElapsedRemaining {
    readonly elapsedMs: number;
    /** % の分母が無いうちは外挿できないため undefined（UI は「計算中…」を出す）。 */
    readonly remainingMs: number | undefined;
}

/**
 * 実時間の経過（呼び出し側が計測した elapsedMs）と snapshot の % から残り時間を
 * 単純な線形外挿で見積もる。100% / done なら残り0固定。
 */
export function estimateElapsedAndRemaining(snapshot: QuickExportProgressSnapshot, elapsedMs: number): QuickExportElapsedRemaining {
    if (snapshot.done || snapshot.percent >= 100) {
        return { elapsedMs, remainingMs: 0 };
    }
    if (snapshot.percent <= 0) {
        return { elapsedMs, remainingMs: undefined };
    }
    const estimatedTotalMs = (elapsedMs / snapshot.percent) * 100;
    return { elapsedMs, remainingMs: Math.max(0, Math.round(estimatedTotalMs - elapsedMs)) };
}
