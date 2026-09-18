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
    /** GPU 直結の書き出しが最後に書いた実フレーム JPEG のコマ番号。 */
    readonly previewFrame?: number;
    /** 同 JPEG の絶対パス。 */
    readonly previewPath?: string;
    /**
     * verify 段で今走っている検査工程（不具合メモ 第22項）。88 分 4K では黒画面検査だけで
     * 約 57 分かかり、従来は stage=verify の start と end の 2 行しか来ないため「止まった」
     * ように見えていた。工程名と、数えられる工程の進捗フレーム数を出す。
     */
    readonly verifyCheck?: QuickExportVerifyCheck;
    readonly verifyCheckFrames?: number;
    readonly verifyCheckTotalFrames?: number;
}

/** packages/render-cut/src/progress.mjs の VERIFY_CHECKS と同一の並び（重み付けにも使う）。 */
export type QuickExportVerifyCheck =
    | 'probe'
    | 'video-identity'
    | 'decode'
    | 'audio-decode'
    | 'audio-level'
    | 'motion'
    | 'blank-frames';

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
const PROGRESS_PREVIEW_PATTERN = /^PROGRESS preview=(\d+) path=(.+)$/;
const VERIFY_CHECK_NAMES = 'probe|video-identity|decode|audio-decode|audio-level|motion|blank-frames';
// render-cut は verify 段の各検査工程について status 行（start / end / reused / skipped）と、
// 数えられる工程については frames 行を出す（不具合メモ 第22項）。
const PROGRESS_VERIFY_CHECK_PATTERN =
    new RegExp(`^PROGRESS stage=verify check=(${VERIFY_CHECK_NAMES}) status=(start|end|reused|skipped)$`);
const PROGRESS_VERIFY_FRAMES_PATTERN =
    new RegExp(`^PROGRESS stage=verify check=(${VERIFY_CHECK_NAMES}) frames=(\\d+)(?: total_frames=(\\d+))?$`);
// verify 段の中での重み。実測（88 分 4K・2026-09-18）で黒画面検査 3,432,032 ms /
// 全編デコード 336,378 ms / その他は合計約 1,162 ms だったので、この 2 つで段のほぼ全部になる。
const VERIFY_CHECK_WEIGHTS: Readonly<Record<QuickExportVerifyCheck, number>> = {
    probe: 0.002,
    'video-identity': 0.06,
    decode: 0.08,
    'audio-decode': 0.02,
    'audio-level': 0.02,
    motion: 0.008,
    'blank-frames': 0.81
};

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
    let previewFrame: number | undefined;
    let previewPath: string | undefined;
    let verifyCheck: QuickExportVerifyCheck | undefined;
    let verifyCheckFrames: number | undefined;
    let verifyCheckTotalFrames: number | undefined;
    // 終わった検査工程の重みの合計。start しか来ない工程でも、終わるたびに verify 段の
    // 進捗が前へ進むようにする。
    let verifyCompletedWeight = 0;
    const completedStages = new Set<QuickExportStage>();

    const publish = (next: QuickExportProgressSnapshot, stageWeighted: boolean): void => {
        const cappedPercent = stageWeighted && !next.done ? Math.min(99, next.percent) : next.percent;
        const percent = Math.max(latest?.percent ?? 0, cappedPercent);
        latest = {
            ...next,
            percent,
            ...(previewFrame !== undefined ? { previewFrame } : {}),
            ...(previewPath !== undefined ? { previewPath } : {})
        };
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
            engine,
            verifyCheck,
            verifyCheckFrames,
            verifyCheckTotalFrames
        }, true);
    };

    const interpret = (line: string): void => {
        const trimmed = line.trim();
        const previewMatch = PROGRESS_PREVIEW_PATTERN.exec(trimmed);
        if (previewMatch) {
            previewFrame = Number(previewMatch[1]);
            previewPath = previewMatch[2];
            latest = latest
                ? { ...latest, previewFrame, previewPath }
                : { percent: 0, outTimeMs: 0, totalMs: 0, done: false, previewFrame, previewPath };
            return;
        }
        // verify 段の検査工程行は stage 行より先に見る（どちらも `PROGRESS stage=verify` で
        // 始まるが、PROGRESS_STAGE_PATTERN は行末まで厳格照合なので取り違えはしない。
        // 意図を読み取りやすくするために順序で示しておく）。
        const verifyCheckMatch = PROGRESS_VERIFY_CHECK_PATTERN.exec(trimmed);
        if (verifyCheckMatch) {
            const check = verifyCheckMatch[1] as QuickExportVerifyCheck;
            const status = verifyCheckMatch[2];
            if (status === 'start') {
                verifyCheck = check;
                verifyCheckFrames = undefined;
                verifyCheckTotalFrames = undefined;
            } else {
                // end / reused / skipped はいずれも「この工程は終わった」。reused は省略ではなく
                // 同じ証拠をより少ない走査で得たという意味なので、進捗上は完了として扱う。
                verifyCompletedWeight = Math.min(1, verifyCompletedWeight + VERIFY_CHECK_WEIGHTS[check]);
                if (verifyCheck === check) {
                    verifyCheck = undefined;
                    verifyCheckFrames = undefined;
                    verifyCheckTotalFrames = undefined;
                }
            }
            if (currentStage === 'verify') {
                stageFraction = Math.min(1, verifyCompletedWeight);
            }
            publishStageSnapshot();
            return;
        }

        const verifyFramesMatch = PROGRESS_VERIFY_FRAMES_PATTERN.exec(trimmed);
        if (verifyFramesMatch) {
            const check = verifyFramesMatch[1] as QuickExportVerifyCheck;
            verifyCheck = check;
            verifyCheckFrames = Number(verifyFramesMatch[2]);
            verifyCheckTotalFrames = verifyFramesMatch[3] === undefined
                ? undefined
                : Number(verifyFramesMatch[3]);
            if (currentStage === 'verify') {
                const within = verifyCheckTotalFrames && verifyCheckTotalFrames > 0
                    ? Math.min(1, Math.max(0, verifyCheckFrames / verifyCheckTotalFrames))
                    : 0;
                stageFraction = Math.min(1, verifyCompletedWeight + VERIFY_CHECK_WEIGHTS[check] * within);
            }
            publishStageSnapshot();
            return;
        }

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
                if (stage === 'verify') {
                    verifyCheck = undefined;
                    verifyCheckFrames = undefined;
                    verifyCheckTotalFrames = undefined;
                    verifyCompletedWeight = 0;
                }
            } else {
                stageFraction = 1;
                completedStages.add(stage);
                if (stage === 'verify') {
                    verifyCheck = undefined;
                    verifyCheckFrames = undefined;
                    verifyCheckTotalFrames = undefined;
                }
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
