// クリップ系の書き戻しは送信前に現在の状態を取り直す。取り直した cuts[] では対象の位置が
// 変わりうるため、どの要素を指し直すかの判定だけをここに純関数として置く（app.js と
// node のテストが同じ実装を使う）。
//
// 背景: 以前はタブが持つ summary のキャッシュをそのまま送っていたため、その間に他の書き手
// （アプリのタイムライン・CLI）が足した item が射影から抜け落ち、書き戻し側の「射影に無い
// 既存 item は消す」規則で無言の削除になりえた（issue #69 の調査で判明）。

/**
 * 取り直した cuts[] の中で、もとの index が指していたクリップを指し直す。
 * id があれば id で追い、無ければ件数が一致することを条件に index をそのまま使う。
 * 指し直せないときは -1（呼び出し側は中断して表示を作り直す）。
 */
export function relocateCutIndex(previousCuts, previousIndex, freshCuts) {
  const previous = Array.isArray(previousCuts) ? previousCuts[previousIndex] : undefined;
  const cuts = Array.isArray(freshCuts) ? freshCuts : [];
  if (!previous || !Number.isInteger(previousIndex) || previousIndex < 0) return -1;
  if (typeof previous.id === 'string' && previous.id) {
    return cuts.findIndex(cut => String(cut?.id) === previous.id);
  }
  return cuts.length === previousCuts.length ? previousIndex : -1;
}
