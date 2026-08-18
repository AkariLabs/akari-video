/**
 * 音声クリップのソーストリマー（task 2026-08-18-audio-clip-trimmer-dblclick）— 純関数部分。
 *
 * docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §3（ソーストリマー）を動画クリップの
 * cut-slip（akari-annotations-widget.ts の updateDragPreview 内・kind: 'cut-slip'）と同型で
 * 音声クリップ（audio.sfx[]）へ適用する。DOM 依存のないここの関数だけを widget.ts から
 * import して使い、pointerdown/pointermove などの配線側は widget.ts に留める
 * （既存の cut-slip は widget.ts にインライン実装のままだが、音声側は新規追加のため
 * 最初からテスト可能な純関数として common/ に置く）。
 */

/**
 * slip: out−in（尺）と t（タイムライン位置）を固定したまま in/out（素材秒）を同量シフトする。
 * 素材の [0, sourceDurationSeconds) をはみ出す場合は、尺を保ったまま境界へクランプする
 * （cut-slip の updateDragPreview 分岐と同じクランプ規則）。
 */
export function slipAudioWindow(
    originalIn: number,
    originalOut: number,
    deltaSeconds: number,
    sourceDurationSeconds: number
): { in: number; out: number } {
    const windowDuration = originalOut - originalIn;
    let nextIn = originalIn + deltaSeconds;
    let nextOut = originalOut + deltaSeconds;
    if (nextIn < 0) {
        nextIn = 0;
        nextOut = windowDuration;
    }
    if (nextOut > sourceDurationSeconds) {
        nextOut = sourceDurationSeconds;
        nextIn = Math.max(0, sourceDurationSeconds - windowDuration);
    }
    return { in: nextIn, out: nextOut };
}

/**
 * R6 契約 §5（sfx フェード追記）と同じクランプ規則: fade_in/fade_out はそれぞれ独立に
 * 実効尺（トリム後の out−in、または in/out 省略時は素材尺）の半分までクランプする。
 * トリム（edge drag / slip）で実効尺が縮んだとき、この関数の戻り値がタイムライン表示
 * （ドラッグフィードバック等）の「今効いているフェード」を実尺の変化に追随させる。
 * 未設定（undefined）・0 以下・非有限値は 0（フェードなし）として扱う。
 */
export function clampSfxFadeToEffectiveDuration(
    fadeIn: number | undefined,
    fadeOut: number | undefined,
    effectiveDurationSeconds: number
): { fadeIn: number; fadeOut: number } {
    const half = Math.max(0, effectiveDurationSeconds) / 2;
    const clamp = (value: number | undefined): number => {
        if (value === undefined || !Number.isFinite(value) || value <= 0) {
            return 0;
        }
        return Math.min(value, half);
    };
    return { fadeIn: clamp(fadeIn), fadeOut: clamp(fadeOut) };
}
