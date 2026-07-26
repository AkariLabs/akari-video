// 「文アンカー方式」の絶対秒解決。
//
// script.json 側では段階表示・表情切替のタイミングを絶対秒で直書きしない。
// `{"sentence": n, "offset": 0.1}` のように「ビート内の第 n 文の t0 + offset」で宣言し、
// generate-timeline がここで narration 実測（sentences[].t0, 絶対秒）から絶対秒へ解決する。
//
// 実データ検証済み: v3 の composition-v3/index.html にハードコードされていた B2〜B8 の
// 段階表示定数（s0〜s4）は、全 27 個・1 個の例外なく「そのビートの sentences[k].t0」と
// 完全一致（offset=0）していた（k は定数の添字と同じ）。つまり v3 の演出タイミングは
// 実質的にすべて「第 k 文の発話開始と同時に表示」という文アンカーで表現できる。

export function round3(x) {
  return Math.round(x * 1000) / 1000;
}

/**
 * @param {{sentence:number, offset?:number}|number|null|undefined} anchor
 * @param {Array<{t0:number,t1:number}>} sentences 絶対秒で解決済みの文配列
 * @returns {number|null}
 */
export function resolveAnchor(anchor, sentences) {
  if (anchor == null) return null;
  if (typeof anchor === "number") return round3(anchor); // 生の絶対秒（エスケープハッチ・非推奨）
  const { sentence, offset = 0 } = anchor;
  const s = sentences[sentence];
  if (!s) {
    throw new Error(`sentence anchor index ${sentence} が範囲外（文数=${sentences.length}）`);
  }
  return round3(s.t0 + offset);
}

const DEFAULT_HOLD_CAP = 2.5; // 発話中の反応表情（surprised/happy/laugh 等）の既定キャップ秒数

/**
 * expression_plan（配列: {expr, at?, holdCap?}）を絶対秒の区間列へ解決する。
 *
 * 既定規則（v3 実データから確認済み）:
 *   - plan[0] は常にビート開始（beat.start）から
 *   - plan[i] (i>0) に `at` が明示されていればそれを使う（文脈依存の演出・要手動指定）
 *   - `at` が無く、直前の表情が非 neutral（反応バースト）なら:
 *       開始 = min(sentences[i].t0, 直前開始 + holdCap)
 *       holdCap は直前エントリの `holdCap`（既定 2.5s）
 *     （v3 の b1 は holdCap:1.2 の明示上書きとして表現される）
 *   - `at` が無く、直前の表情が neutral なら: 開始 = 最終文の t0（ビート終盤の演出転換の既定値）
 *
 * @param {Array<{expr:string, at?:object, holdCap?:number}>} plan
 * @param {Array<{t0:number,t1:number}>} sentences
 * @param {number} beatStart
 * @param {number} beatEnd
 */
export function resolveExpressions(plan, sentences, beatStart, beatEnd) {
  const starts = [];
  for (let i = 0; i < plan.length; i += 1) {
    const entry = plan[i];
    let start;
    if (i === 0) {
      start = beatStart;
    } else if (entry.at != null) {
      start = resolveAnchor(entry.at, sentences);
    } else {
      const prevEntry = plan[i - 1];
      const prevIsReaction = prevEntry.expr !== "neutral";
      if (prevIsReaction) {
        const cap = prevEntry.holdCap != null ? prevEntry.holdCap : DEFAULT_HOLD_CAP;
        const natBoundary = sentences[i] ? sentences[i].t0 : Infinity;
        start = Math.min(natBoundary, starts[i - 1] + cap);
      } else {
        start = sentences[sentences.length - 1].t0;
      }
    }
    starts.push(round3(start));
  }
  const out = [];
  for (let i = 0; i < plan.length; i += 1) {
    const t1 = i < plan.length - 1 ? starts[i + 1] : round3(beatEnd);
    out.push({ expr: plan[i].expr, t0: starts[i], t1 });
  }
  return out;
}
