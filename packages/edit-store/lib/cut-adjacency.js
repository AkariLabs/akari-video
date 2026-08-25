"use strict";
/**
 * cuts 配列順で隣り合う同一トラックの 2 クリップが、トランジション UI を持てる境界か判定する。
 * タイムライン UI と edit-lint は必ずこの関数を使い、フレーム量子化の条件式を複製しない。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STILL_IMAGE_SOURCE_PATTERN = exports.DEFAULT_CUT_ADJACENCY_FPS = void 0;
exports.effectiveCutFps = effectiveCutFps;
exports.cutOverlapFrames = cutOverlapFrames;
exports.planTransitionHandleWindow = planTransitionHandleWindow;
exports.isStillImageSourcePath = isStillImageSourcePath;
exports.areCutsAdjacent = areCutsAdjacent;
exports.DEFAULT_CUT_ADJACENCY_FPS = 30;
function effectiveCutFps(fps) {
    return Number.isFinite(fps) && fps > 0 ? fps : exports.DEFAULT_CUT_ADJACENCY_FPS;
}
/**
 * earlier の終端と later の開始を出力 fps へ量子化し、実重なりをフレーム数で返す。
 * 正数は重なり、0 は突き合わせ、負数はすき間を表す。
 */
function cutOverlapFrames(earlier, later, fps = exports.DEFAULT_CUT_ADJACENCY_FPS) {
    const resolvedFps = effectiveCutFps(fps);
    return Math.round(earlier.tlEnd * resolvedFps) - Math.round(later.tlStart * resolvedFps);
}
const nonNegativeRoom = (value) => value === Number.POSITIVE_INFINITY
    ? value
    : Number.isFinite(value) && value > 0 ? value : 0;
/** 隠れのりしろ窓の実効尺を秒の連続量で決める単一定義。 */
function planTransitionHandleWindow(input) {
    const declaredSeconds = Number.isFinite(input.declaredSeconds) && input.declaredSeconds > 0
        ? input.declaredSeconds : 0;
    const effectiveSeconds = Math.max(0, Math.min(declaredSeconds, 2 * nonNegativeRoom(input.outgoingTailRoomSeconds), 2 * nonNegativeRoom(input.incomingHeadRoomSeconds), 2 * nonNegativeRoom(input.outgoingDurationSeconds), 2 * nonNegativeRoom(input.incomingDurationSeconds)));
    return {
        effectiveSeconds,
        halfSeconds: effectiveSeconds / 2,
        outcome: effectiveSeconds <= 0 ? 'none'
            : effectiveSeconds < declaredSeconds ? 'clamped' : 'full'
    };
}
exports.STILL_IMAGE_SOURCE_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/iu;
function isStillImageSourcePath(path) {
    return typeof path === 'string' && exports.STILL_IMAGE_SOURCE_PATTERN.test(path);
}
/**
 * ギャップ 0、または earlier の宣言済み transitionOut.duration で説明できる重なりだけを
 * 隣接とみなす。秒の誤差ではなく、出力 fps で量子化したフレーム数を比較する。
 */
function areCutsAdjacent(earlier, later, fps = exports.DEFAULT_CUT_ADJACENCY_FPS) {
    const resolvedFps = effectiveCutFps(fps);
    const overlapFrames = cutOverlapFrames(earlier, later, resolvedFps);
    const declaredDuration = earlier.transitionOut?.duration;
    const declaredOverlapFrames = typeof declaredDuration === 'number'
        && Number.isFinite(declaredDuration) && declaredDuration > 0
        ? Math.round(declaredDuration * resolvedFps)
        : 0;
    return overlapFrames === 0
        || (overlapFrames > 0 && overlapFrames <= declaredOverlapFrames);
}
