/**
 * render-cut CLI の `--progress` が吐く stage / out_time_ms / done 行と、書き出し
 * エンジン由来の frame 行を解釈し、重み付き % 進捗・経過/推定残り時間へ変換する。
 * 子プロセスの stdout/stderr には他の出力も混じるため、契約した形式に一致する
 * 完成行だけを拾い、それ以外は無視する。
 */

export type QuickExportStage = 'prepare' | 'audio-cut' | 'render' | 'audio-mix' | 'verify';

export interface QuickExportProgressSnapshot {
    readonly percent: number;
    readonly outTimeMs: number;
    readonly totalMs: number;
    readonly done: boolean;
    readonly stage?: QuickExportStage;
    readonly stageFraction?: number;
    readonly frame?: number;
    readonly totalFrames?: number;
    readonly engine?: 'gpu' | 'osr';
}

export interface QuickExportProgressTracker {
    push(chunk: string): void;
    snapshot(): QuickExportProgressSnapshot | undefined;
}

export const QUICK_EXPORT_STAGE_WEIGHTS: Readonly<Record<QuickExportStage, number>> = {
    prepare: 0.03,
    'audio-cut': 0.05,
    render: 0.84,
    'audio-mix': 0.05,
    verify: 0.03
};

const PROGRESS_LINE_PATTERN = /^PROGRESS out_time_ms=(\d+) total_ms=(\d+)$/;
const PROGRESS_DONE_PATTERN = /^PROGRESS done total_ms=(\d+)$/;
const PROGRESS_STAGE_PATTERN = /^PROGRESS stage=(prepare|audio-cut|render|audio-mix|verify) status=(start|end)(?: engine=(gpu|osr))?$/;
const PROGRESS_FRAME_PATTERN = /^PROGRESS frame=(\d+) total=(\d+)$/;

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

export function createQuickExportProgressTracker(): QuickExportProgressTracker {
    let lineBuffer = '';
    let latest: QuickExportProgressSnapshot | undefined;
    let sawStageLine = false;
    let currentStage: QuickExportStage | undefined;
    let stageFraction = 0;
    let frame: number | undefined;
    let totalFrames: number | undefined;
    let engine: 'gpu' | 'osr' | undefined;
    const completedStages = new Set<QuickExportStage>();

    const publish = (next: QuickExportProgressSnapshot, stageWeighted: boolean): void => {
        const cappedPercent = stageWeighted && !next.done ? Math.min(99, next.percent) : next.percent;
        const percent = Math.max(latest?.percent ?? 0, cappedPercent);
        latest = { ...next, percent };
    };

    const stagePercent = (): number => {
        let completedWeight = 0;
        for (const stage of completedStages) {
            if (stage !== currentStage) {
                completedWeight += QUICK_EXPORT_STAGE_WEIGHTS[stage];
            }
        }
        const currentWeight = currentStage === undefined ? 0 : QUICK_EXPORT_STAGE_WEIGHTS[currentStage] * stageFraction;
        return Math.round(100 * (completedWeight + currentWeight));
    };

    const publishStageSnapshot = (): void => {
        publish({
            percent: stagePercent(),
            outTimeMs: latest?.outTimeMs ?? 0,
            totalMs: latest?.totalMs ?? 0,
            done: false,
            stage: currentStage,
            stageFraction,
            frame,
            totalFrames,
            engine
        }, true);
    };

    const interpret = (line: string): void => {
        const trimmed = line.trim();
        const stageMatch = PROGRESS_STAGE_PATTERN.exec(trimmed);
        if (stageMatch) {
            sawStageLine = true;
            const stage = stageMatch[1] as QuickExportStage;
            const status = stageMatch[2];
            currentStage = stage;
            if (status === 'start') {
                stageFraction = 0;
                if (stage === 'render') {
                    frame = 0;
                    totalFrames = undefined;
                    engine = stageMatch[3] as 'gpu' | 'osr' | undefined;
                }
            } else {
                stageFraction = 1;
                completedStages.add(stage);
            }
            publishStageSnapshot();
            return;
        }

        const frameMatch = PROGRESS_FRAME_PATTERN.exec(trimmed);
        if (frameMatch && sawStageLine && currentStage === 'render') {
            frame = Number(frameMatch[1]);
            totalFrames = Number(frameMatch[2]);
            stageFraction = totalFrames > 0 ? Math.min(1, Math.max(0, frame / totalFrames)) : 0;
            publishStageSnapshot();
            return;
        }

        const parsed = parseQuickExportProgressLine(trimmed);
        if (!parsed) {
            return;
        }
        if (parsed.done) {
            publish({
                ...parsed,
                stage: currentStage,
                stageFraction,
                frame,
                totalFrames,
                engine
            }, false);
            return;
        }
        if (!sawStageLine) {
            publish(parsed, false);
            return;
        }
        if (currentStage === 'audio-cut') {
            stageFraction = parsed.totalMs > 0
                ? Math.min(1, Math.max(0, parsed.outTimeMs / parsed.totalMs))
                : 0;
            publish({
                ...parsed,
                percent: stagePercent(),
                stage: currentStage,
                stageFraction,
                frame,
                totalFrames,
                engine
            }, true);
        }
    };

    return {
        push(chunk: string): void {
            lineBuffer += chunk;
            let newlineIndex = lineBuffer.indexOf('\n');
            while (newlineIndex !== -1) {
                const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, '');
                lineBuffer = lineBuffer.slice(newlineIndex + 1);
                interpret(line);
                newlineIndex = lineBuffer.indexOf('\n');
            }
        },
        snapshot(): QuickExportProgressSnapshot | undefined {
            return latest;
        }
    };
}

/**
 * 複数行を含みうるテキストから、最後に解釈した PROGRESS スナップショットを返す。
 * 呼び出しごとに新しいトラッカーへ全文を流す後方互換ラッパー。
 */
export function latestQuickExportProgress(text: string): QuickExportProgressSnapshot | undefined {
    const tracker = createQuickExportProgressTracker();
    tracker.push(`${text}\n`);
    return tracker.snapshot();
}

export interface QuickExportElapsedRemaining {
    readonly elapsedMs: number;
    /** % の分母が無いうちは外挿できないため undefined（UI は「計算中…」を出す）。 */
    readonly remainingMs: number | undefined;
}

export interface QuickExportRenderStageTiming {
    readonly startedAtMs: number;
    readonly nowMs: number;
}

/**
 * 実時間の経過と snapshot の % から残り時間を見積もる。render のコマ実測が
 * 渡された場合は工程重みを含む総時間へ換算し、それ以外は従来の線形外挿を使う。
 */
export function estimateElapsedAndRemaining(
    snapshot: QuickExportProgressSnapshot,
    elapsedMs: number,
    renderStage?: QuickExportRenderStageTiming
): QuickExportElapsedRemaining {
    if (snapshot.done || snapshot.percent >= 100) {
        return { elapsedMs, remainingMs: 0 };
    }
    if (
        renderStage
        && snapshot.stage === 'render'
        && snapshot.frame !== undefined
        && snapshot.frame >= 1
        && snapshot.totalFrames !== undefined
        && snapshot.totalFrames > 0
    ) {
        const perFrameMs = Math.max(0, renderStage.nowMs - renderStage.startedAtMs) / snapshot.frame;
        const estimatedTotalMs = (perFrameMs * snapshot.totalFrames) / QUICK_EXPORT_STAGE_WEIGHTS.render;
        const remainingMs = estimatedTotalMs * (1 - snapshot.percent / 100);
        return { elapsedMs, remainingMs: Math.max(0, Math.round(remainingMs)) };
    }
    if (snapshot.percent <= 0) {
        return { elapsedMs, remainingMs: undefined };
    }
    const estimatedTotalMs = (elapsedMs / snapshot.percent) * 100;
    return { elapsedMs, remainingMs: Math.max(0, Math.round(estimatedTotalMs - elapsedMs)) };
}
