export const AUDIO_KEYFRAME_MIN_DB = -30;
export const AUDIO_KEYFRAME_MAX_DB = 9;
export const AUDIO_KEYFRAME_MIN_POINTS = 2;
export const AUDIO_KEYFRAME_MIN_POINTS_NOTICE =
    'キーフレームは 2 点以上必要です。点を追加するか、この 1 点を削除してください。';

export type AudioKeyframeWriteGuard = 'ok' | 'too-few';

export interface AudioKeyframeTimePoint {
    readonly t: number;
}

export interface AudioKeyframeGainPoint extends AudioKeyframeTimePoint {
    readonly gainDb: number;
    readonly easing?: 'linear' | 'hold' | 'ease-in-out';
}

export interface AudioKeyframeViewWindow {
    readonly startSeconds: number;
    readonly endSeconds: number;
}

export type AudioKeyframeTimeValidation =
    | { readonly ok: true }
    | { readonly ok: false; readonly message: string };

function finiteOr(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

/** 空の envelope は削除として許可し、変化を表せない 1 点だけを拒否する。 */
export function audioKeyframeWriteGuard(
    keyframes: readonly unknown[] | null
): AudioKeyframeWriteGuard {
    const pointCount = keyframes?.length ?? 0;
    return pointCount > 0 && pointCount < AUDIO_KEYFRAME_MIN_POINTS ? 'too-few' : 'ok';
}

/** 全体ゲイン入力をエディタの表示範囲へ収め、未設定・不正値は 0 dB にする。 */
export function normalizeAudioKeyframeGainDb(value: number | undefined): number {
    return clamp(finiteOr(value ?? 0, 0), AUDIO_KEYFRAME_MIN_DB, AUDIO_KEYFRAME_MAX_DB);
}

/**
 * 指定時刻のキーフレーム dB を補間する。範囲外は端値保持、hold は始点保持、
 * ease-in-out は smoothstep とし、点の無い envelope は 0 dB とする。
 */
export function audioKeyframeInterpolatedGainDb(
    points: readonly AudioKeyframeGainPoint[], atSeconds: number
): number {
    const sorted = points
        .filter(point => Number.isFinite(point.t))
        .map(point => ({
            t: point.t,
            gainDb: normalizeAudioKeyframeGainDb(point.gainDb),
            easing: point.easing
        }))
        .sort((left, right) => left.t - right.t);
    if (sorted.length === 0) return 0;
    const at = finiteOr(atSeconds, 0);
    if (at <= sorted[0].t) return sorted[0].gainDb;
    const last = sorted[sorted.length - 1];
    if (at >= last.t) return last.gainDb;
    for (let index = 1; index < sorted.length; index += 1) {
        const end = sorted[index];
        if (at >= end.t) continue;
        const start = sorted[index - 1];
        if (start.easing === 'hold') return start.gainDb;
        const span = end.t - start.t;
        if (!(span > 0)) return end.gainDb;
        const linearProgress = clamp((at - start.t) / span, 0, 1);
        const progress = start.easing === 'ease-in-out'
            ? linearProgress * linearProgress * (3 - 2 * linearProgress)
            : linearProgress;
        return start.gainDb + (end.gainDb - start.gainDb) * progress;
    }
    return last.gainDb;
}

/** 全体ゲインとキーフレーム補間値を合算した、再生時刻の実効 dB。 */
export function audioKeyframeEffectiveGainDb(
    points: readonly AudioKeyframeGainPoint[], atSeconds: number, overallGainDb: number | undefined
): number {
    return normalizeAudioKeyframeGainDb(overallGainDb)
        + audioKeyframeInterpolatedGainDb(points, atSeconds);
}

/** WebAudio GainNode に渡すため dB を線形 gain へ変換する。 */
export function audioKeyframeDbToLinearGain(gainDb: number): number {
    return 10 ** (finiteOr(gainDb, 0) / 20);
}

/** クリップの実効再生窓 [0, durationSeconds] を fit-to-width の px へ写す。 */
export function audioKeyframeTimeToPx(t: number, durationSeconds: number, widthPx: number): number {
    if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)
        || !(widthPx > 0) || !Number.isFinite(widthPx)) {
        return 0;
    }
    return clamp(finiteOr(t, 0), 0, durationSeconds) / durationSeconds * widthPx;
}

/** fit-to-width の px をクリップのローカル秒へ戻す。範囲外 px は両端へクランプする。 */
export function audioKeyframePxToTime(px: number, durationSeconds: number, widthPx: number): number {
    if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)
        || !(widthPx > 0) || !Number.isFinite(widthPx)) {
        return 0;
    }
    return clamp(finiteOr(px, 0), 0, widthPx) / widthPx * durationSeconds;
}

/** ズーム済み表示窓のローカル秒を canvas px へ写す。 */
export function audioKeyframeTimeToViewPx(
    t: number, viewStartSeconds: number, viewEndSeconds: number, widthPx: number
): number {
    const span = viewEndSeconds - viewStartSeconds;
    if (!(span > 0) || !Number.isFinite(span) || !(widthPx > 0) || !Number.isFinite(widthPx)) return 0;
    return (clamp(finiteOr(t, viewStartSeconds), viewStartSeconds, viewEndSeconds) - viewStartSeconds)
        / span * widthPx;
}

/** canvas px をズーム済み表示窓のローカル秒へ戻し、窓端へクランプする。 */
export function audioKeyframeViewPxToTime(
    px: number, viewStartSeconds: number, viewEndSeconds: number, widthPx: number
): number {
    const span = viewEndSeconds - viewStartSeconds;
    if (!(span > 0) || !Number.isFinite(span) || !(widthPx > 0) || !Number.isFinite(widthPx)) {
        return Math.max(0, finiteOr(viewStartSeconds, 0));
    }
    return viewStartSeconds + clamp(finiteOr(px, 0), 0, widthPx) / widthPx * span;
}

/** 使用可能な精細バケットを 3px 幅まで拡大できる倍率（上限 100x）。 */
export function audioKeyframeMaximumZoom(detailBucketCount: number, widthPx: number): number {
    if (!(widthPx > 0) || !Number.isFinite(widthPx)
        || !(detailBucketCount > 0) || !Number.isFinite(detailBucketCount)) return 1;
    return Math.max(1, Math.min(100, detailBucketCount * 3 / widthPx));
}

/** Ctrl+wheel の倍率を、カーソル直下の時刻を固定したまま表示窓へ反映する。 */
export function audioKeyframeZoomWindow(
    window: AudioKeyframeViewWindow,
    durationSeconds: number,
    cursorPx: number,
    widthPx: number,
    zoomFactor: number,
    maximumZoom: number
): AudioKeyframeViewWindow {
    const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
    if (!(duration > 0) || !(widthPx > 0) || !Number.isFinite(widthPx)) {
        return { startSeconds: 0, endSeconds: duration };
    }
    const currentStart = clamp(finiteOr(window.startSeconds, 0), 0, duration);
    const currentEnd = clamp(finiteOr(window.endSeconds, duration), currentStart, duration);
    const currentSpan = currentEnd > currentStart ? currentEnd - currentStart : duration;
    const currentZoom = duration / currentSpan;
    const maxZoom = Math.max(1, Math.min(100, finiteOr(maximumZoom, 1)));
    const nextZoom = clamp(currentZoom * finiteOr(zoomFactor, 1), 1, maxZoom);
    const nextSpan = duration / nextZoom;
    const cursorRatio = clamp(finiteOr(cursorPx, 0), 0, widthPx) / widthPx;
    const anchorTime = currentStart + cursorRatio * currentSpan;
    const unclampedStart = anchorTime - cursorRatio * nextSpan;
    const startSeconds = clamp(unclampedStart, 0, Math.max(0, duration - nextSpan));
    return { startSeconds, endSeconds: startSeconds + nextSpan };
}

/** Shift+wheel の移動量を表示窓へ反映し、全尺の端で止める。 */
export function audioKeyframeScrollWindow(
    window: AudioKeyframeViewWindow, durationSeconds: number, deltaSeconds: number
): AudioKeyframeViewWindow {
    const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
    const start = clamp(finiteOr(window.startSeconds, 0), 0, duration);
    const end = clamp(finiteOr(window.endSeconds, duration), start, duration);
    const span = end > start ? end - start : duration;
    const nextStart = clamp(start + finiteOr(deltaSeconds, 0), 0, Math.max(0, duration - span));
    return { startSeconds: nextStart, endSeconds: nextStart + span };
}

/** 波形上端に設けるシーク専用帯のヒットテスト。 */
export function audioKeyframeSeekBarHitTest(yPx: number, seekBarHeightPx = 14): boolean {
    return Number.isFinite(yPx) && Number.isFinite(seekBarHeightPx)
        && seekBarHeightPx > 0 && yPx >= 0 && yPx <= seekBarHeightPx;
}

/** 表示範囲 [-30,+9] dB を上端 = +9 dB、下端 = -30 dB の px へ線形写像する。 */
export function audioKeyframeDbToPx(gainDb: number, heightPx: number): number {
    if (!(heightPx > 0) || !Number.isFinite(heightPx)) {
        return 0;
    }
    const db = clamp(finiteOr(gainDb, 0), AUDIO_KEYFRAME_MIN_DB, AUDIO_KEYFRAME_MAX_DB);
    return (AUDIO_KEYFRAME_MAX_DB - db)
        / (AUDIO_KEYFRAME_MAX_DB - AUDIO_KEYFRAME_MIN_DB) * heightPx;
}

/** dB 軸の px を [-30,+9] dB へ戻す。範囲外 px は表示範囲へクランプする。 */
export function audioKeyframePxToDb(px: number, heightPx: number): number {
    if (!(heightPx > 0) || !Number.isFinite(heightPx)) {
        return 0;
    }
    const ratio = clamp(finiteOr(px, 0), 0, heightPx) / heightPx;
    return AUDIO_KEYFRAME_MAX_DB - ratio * (AUDIO_KEYFRAME_MAX_DB - AUDIO_KEYFRAME_MIN_DB);
}

/** ローカル秒を最寄りのフレームへスナップし、クリップの実効再生窓へクランプする。 */
export function snapAudioKeyframeTime(t: number, fps: number, durationSeconds: number): number {
    if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)) {
        return 0;
    }
    const clamped = clamp(finiteOr(t, 0), 0, durationSeconds);
    if (!(fps > 0) || !Number.isFinite(fps)) {
        return clamped;
    }
    return clamp(Math.round(clamped * fps) / fps, 0, durationSeconds);
}

/** 追加・移動先の t が既存点と一致する場合、操作を拒否する結果を返す。 */
export function validateAudioKeyframeTime(
    points: readonly AudioKeyframeTimePoint[],
    candidateT: number,
    ignoredIndex?: number
): AudioKeyframeTimeValidation {
    const collision = points.some((point, index) => index !== ignoredIndex
        && Number.isFinite(point.t) && Math.abs(point.t - candidateT) < 1e-9);
    return collision
        ? { ok: false, message: '同じ時刻には複数のキーフレームを置けません。' }
        : { ok: true };
}
