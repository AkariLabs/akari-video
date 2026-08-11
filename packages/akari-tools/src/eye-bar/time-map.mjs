// time-map.mjs — source 秒（face_landmarks トラックの t）→ 出力タイムライン秒
// （layers[].keyframes の t の「絶対」基準。layer-local への変換は build-layer.mjs が
// layer.t を引いて行う）への決定論写像。
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
} from "../../../render-cut/src/cut-timeline.mjs";

const EPSILON = 1e-6;

function cutMatchesSource(cut, sourceId) {
  // v0（単一 source）edit.json の cuts は `src` を持てない（schema: cutV0 の not.required
  // src）。sourceId が null/undefined のときは「v0 プロジェクト」を意味し、src を持たない
  // カットだけを対象にする。v1（複数 source）では src の一致を見る。
  if (sourceId === null || sourceId === undefined) return cut?.src === undefined;
  return cut?.src === sourceId;
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
    const runs = [];
    cuts.forEach((cut, index) => {
      if (!cutMatchesSource(cut, sourceId)) return;
      const offset = offsets[index];
      if (!offset) return;
      const speed = cutSpeed(cut);
      runs.push({
        outStart: offset.start,
        outEnd: offset.start + offset.duration,
        srcIn: cut.in,
        srcOut: cut.out,
        speed,
        cut,
      });
    });
    return runs;
  }

  const segments = resolveCutSegments(cuts);
  const outputDuration = segments.reduce((max, segment) => Math.max(max, segment.end), 0);
  const videoRuns = computeVideoRuns(segments, outputDuration);
  return videoRuns
    .filter((run) => run.kind === "src" && cutMatchesSource(run.cut, sourceId))
    .map((run) => ({
      outStart: run.outStart,
      outEnd: run.outEnd,
      srcIn: run.srcIn,
      srcOut: run.srcOut,
      speed: cutSpeed(run.cut),
      cut: run.cut,
    }));
}

/**
 * ある source 秒が、runs のうちどの出力タイムライン秒（複数あり得る — 同じ source 区間が
 * 複数カットで再利用されている場合）に写るかを返す。1 run 内は
 * timelineT = outStart + (sourceT - srcIn) / speed の線形写像（cut-timeline.mjs の
 * computeVideoRuns が使う式の逆関数と同一）。
 */
export function sourceTimeToTimeline(runs, sourceT) {
  const hits = [];
  for (const run of runs) {
    if (sourceT < run.srcIn - EPSILON || sourceT > run.srcOut + EPSILON) continue;
    const clamped = Math.min(Math.max(sourceT, run.srcIn), run.srcOut);
    hits.push(run.outStart + (clamped - run.srcIn) / run.speed);
  }
  return hits;
}

/**
 * runs を出力タイムライン開始順に並べ替えたコピーを返す（sourceCutRuns は cuts[] の宣言順を
 * 保つため、gap-aware 経路のときは呼び出し側が必要に応じて並べ替える）。
 */
export function runsInTimelineOrder(runs) {
  return runs.slice().sort((a, b) => a.outStart - b.outStart);
}
