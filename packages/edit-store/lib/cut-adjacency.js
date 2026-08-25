"use strict";
/**
 * cuts 配列順で隣り合う同一トラックの 2 クリップが、トランジション UI を持てる境界か判定する。
 * タイムライン UI と edit-lint は必ずこの関数を使い、フレーム量子化の条件式を複製しない。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.effectiveCutFps = effectiveCutFps;
exports.cutOverlapFrames = cutOverlapFrames;
exports.planTransitionHandleExtension = planTransitionHandleExtension;
exports.areCutsAdjacent = areCutsAdjacent;
const DEFAULT_CUT_ADJACENCY_FPS = 30;
function effectiveCutFps(fps) {
    return Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_CUT_ADJACENCY_FPS;
}
/**
 * earlier の終端と later の開始を出力 fps へ量子化し、実重なりをフレーム数で返す。
 * 正数は重なり、0 は突き合わせ、負数はすき間を表す。
 */
function cutOverlapFrames(earlier, later, fps = DEFAULT_CUT_ADJACENCY_FPS) {
    const resolvedFps = effectiveCutFps(fps);
    return Math.round(earlier.tlEnd * resolvedFps) - Math.round(later.tlStart * resolvedFps);
}
/**
 * 突き合わせ境界へ宣言尺ぶんの重なりを作るため、outgoing を何フレーム延ばすか決める。
 * メディア長は知らず、呼び出し側が maxExtendSeconds として渡した上限だけを使う。
 */
function planTransitionHandleExtension(input) {
    const fps = effectiveCutFps(input.fps ?? DEFAULT_CUT_ADJACENCY_FPS);
    const declaredFrames = Number.isFinite(input.declaredSeconds) && input.declaredSeconds > 0
        ? Math.max(1, Math.round(input.declaredSeconds * fps)) : 0;
    const overlapFrames = cutOverlapFrames({ tlEnd: input.earlierEndSeconds }, { tlStart: input.laterStartSeconds }, fps);
    if (overlapFrames > 0) {
        return {
            appliedSeconds: 0,
            effectiveSeconds: Math.min(declaredFrames, overlapFrames) / fps,
            appliedFrames: 0,
            outcome: 'already-overlapping'
        };
    }
    const maximumFrames = input.maxExtendSeconds === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Number.isFinite(input.maxExtendSeconds) && input.maxExtendSeconds > 0
            ? Math.max(0, Math.floor(input.maxExtendSeconds * fps + 1e-9)) : 0;
    // すき間（負の overlapFrames）がある場合は、その穴を埋めたうえで宣言尺ぶん重ねる。
    // UI は非隣接ガードでこの経路へ入れないが、純関数としては安全な値を返す。
    const requiredFrames = Math.max(0, declaredFrames - overlapFrames);
    const appliedFrames = Math.min(requiredFrames, maximumFrames);
    const effectiveFrames = Math.max(0, Math.min(declaredFrames, overlapFrames + appliedFrames));
    return {
        appliedSeconds: appliedFrames / fps,
        effectiveSeconds: effectiveFrames / fps,
        appliedFrames,
        outcome: appliedFrames <= 0 ? 'none'
            : appliedFrames >= requiredFrames ? 'full' : 'partial'
    };
}
/**
 * ギャップ 0、または earlier の宣言済み transitionOut.duration で説明できる重なりだけを
 * 隣接とみなす。秒の誤差ではなく、出力 fps で量子化したフレーム数を比較する。
 */
function areCutsAdjacent(earlier, later, fps = DEFAULT_CUT_ADJACENCY_FPS) {
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
