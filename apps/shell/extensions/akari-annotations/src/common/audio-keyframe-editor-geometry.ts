export const AUDIO_KEYFRAME_MIN_DB = -30;
export const AUDIO_KEYFRAME_MAX_DB = 9;

export interface AudioKeyframeTimePoint {
    readonly t: number;
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
