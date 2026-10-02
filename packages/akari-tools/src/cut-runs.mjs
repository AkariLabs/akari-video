// cut-runs.mjs — source 秒 → 出力タイムライン秒の決定論写像。
//
// 核心的設計点（task.md）: この写像は cuts[].in/out/at/speed から解く。**式は自前で作らない** —
// render-cut/src/cut-timeline.mjs がまさにこの写像を作るために存在する（cuts → 合成後タイムライン
// の配置）。ここで独自の式を書くと render-cut の実際の配置ロジック（xfade・track occlusion 等）と
// ズレる二重実装リスクを負うため、read-only 依存として直接 import する（境界裁定: render-cut は
// 編集禁止だが読み取り専用の依存は許容 — task.md 「読み取りのみ: vision-tracks 一式・
// layer-keyframes.mjs」と同じ扱いを cut-timeline.mjs にも適用する）。
//
// 2 経路: cuts が at/track で「隙間つき」を宣言していなければ単純累積（xfade 対応）、
// 宣言していればギャップ対応（track occlusion 対応）— needsGapAwareCutTimeline が既存の
// render-cut と同じ基準で経路を選ぶ。どちらの経路でも 1 カットの中は
// timelineT = outStart + (sourceT - cut.in) / speed の線形写像（cut-timeline.mjs 自身の
// 内部規約と同じ式 — computeVideoRuns の srcIn/srcOut 算出式の逆関数）。
import {
  computeCutTimelineOffsets,
  computeVideoRuns,
  cutSpeed,
  needsGapAwareCutTimeline,
  resolveCutSegments,
} from "../../render-cut/src/cut-timeline.mjs";

const EPSILON = 1e-6;

export function matches(cut, sourceId) {
  // v0（単一 source）edit.json の cuts は `src` を持てない（schema: cutV0 の not.required
  // src）。sourceId が null/undefined のときは「v0 プロジェクト」を意味し、src を持たない
  // カットだけを対象にする。v1（複数 source）では src の一致を見る。
  return sourceId === null || sourceId === undefined ? cut?.src === undefined : cut?.src === sourceId;
}

/**
 * cuts[] から、指定した source（v0 は単一 source なので sourceId 省略、v1 は sourceId 指定）を
 * 実際に画面へ出している出力タイムライン上の区間（runs）を、時系列順に返す。
 *
 * 各 run: { outStart, outEnd, srcIn, srcOut, speed, cut }
 * - [outStart, outEnd) の間、この run の cut が（他トラックに隠されず）表示されている
 * - この区間に対応する source 秒は [srcIn, srcOut]（speed 適用後）
 *
 * ギャップ対応経路では、同じ source 区間が他トラックの高位カットに隠される区間は run から
 * 除かれる（= その時間帯はソース映像上「見えていない」ので目線黒帯も出さない）。
 */
export function sourceCutRuns(cuts, sourceId = null) {
  if (!Array.isArray(cuts) || cuts.length === 0) return [];
  if (!needsGapAwareCutTimeline(cuts)) {
    const offsets = computeCutTimelineOffsets(cuts);
    return cuts.flatMap((cut, index) => {
      if (!matches(cut, sourceId) || !offsets[index]) return [];
      const speed = cutSpeed(cut);
      return [{
        outStart: offsets[index].start,
        outEnd: offsets[index].start + offsets[index].duration,
        srcIn: cut.in,
        srcOut: cut.out,
        speed,
        cut,
      }];
    });
  }
  const segments = resolveCutSegments(cuts);
  const duration = segments.reduce((max, segment) => Math.max(max, segment.end), 0);
  return computeVideoRuns(segments, duration)
    .filter((run) => run.kind === "src" && matches(run.cut, sourceId))
    .map((run) => ({
      outStart: run.outStart,
      outEnd: run.outEnd,
      srcIn: run.srcIn,
      srcOut: run.srcOut,
      speed: cutSpeed(run.cut),
      cut: run.cut,
    }));
}

/** 単一 run の source 秒を出力タイムライン秒に写す。範囲外は null。 */
export function runSourceTimeToTimeline(run, sourceT) {
  if (!run || sourceT < run.srcIn - EPSILON || sourceT > run.srcOut + EPSILON) return null;
  const clamped = Math.min(Math.max(sourceT, run.srcIn), run.srcOut);
  return run.outStart + (clamped - run.srcIn) / run.speed;
}
