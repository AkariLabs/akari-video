// source 秒（face_landmarks トラックの t）→ 出力タイムライン秒。
// layers[].keyframes の絶対時刻から layer-local への変換は build-layer.mjs が行う。
import { runSourceTimeToTimeline } from "../cut-runs.mjs";

export { sourceCutRuns } from "../cut-runs.mjs";

/**
 * ある source 秒が、runs のうちどの出力タイムライン秒（複数あり得る — 同じ source 区間が
 * 複数カットで再利用されている場合）に写るかを返す。1 run 内は
 * timelineT = outStart + (sourceT - srcIn) / speed の線形写像（cut-timeline.mjs の
 * computeVideoRuns が使う式の逆関数と同一）。
 */
export function sourceTimeToTimeline(runs, sourceT) {
  return runs.map((run) => runSourceTimeToTimeline(run, sourceT)).filter((time) => time !== null);
}

/**
 * runs を出力タイムライン開始順に並べ替えたコピーを返す（sourceCutRuns は cuts[] の宣言順を
 * 保つため、gap-aware 経路のときは呼び出し側が必要に応じて並べ替える）。
 */
export function runsInTimelineOrder(runs) {
  return runs.slice().sort((a, b) => a.outStart - b.outStart);
}
