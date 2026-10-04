// public/app.js から逐語移動。モジュール変数は引数で受ける純関数（F-69）。

// 不具合メモ 第16項（最終フレームの次の終端位置で追加映像だけ消える）。
// 総尺（totalDuration）は「最後の有効フレームの **次**」= 終端位置で、そこに有効なフレームは無い。
// frame-engine の追加映像（layers[]）は `frame >= startFrame && frame < endFrame` の半開区間で
// 可視判定する（packages/frame-engine/src/timeline/plan.ts の isLayerActiveAt）ため、終了位置が
// 総尺と一致するレイヤーは終端位置の描画要求でちょうど外れる。一方ベース映像は最後の画を保持する
// ので「左（ベース）は残って右（追加映像）だけ黒くなる」に見えた（実機: 総尺 158682 フレーム・
// 30fps・bookend-outro-right が 158401 開始 / 281 フレームで終了位置 158682）。
// 半開区間の判定は frame-engine の正本なので触らず、**要求側でフレームを揃える**:
// 描画要求は必ず最後の有効フレームまでに丸める（総尺そのものは要求しない）。
// 総尺の表示・シークバーの上限は従来どおり totalDuration のまま（尺は 1 フレームも変えない）。
export function lastRenderableFrame(totalDuration, fps) {
  // フレーム数は frame-engine の可視判定と同じ切り上げ規律（`ceil(sec * fps - 1e-6)`）で数える。
  return Math.max(0, Math.ceil(totalDuration * fps - 1e-6) - 1);
}
export function engineRenderTime(totalDuration, fps, t) {
  const clamped = Math.max(0, Math.min(Number.isFinite(t) ? t : 0, totalDuration));
  if (!(fps > 0) || !(totalDuration > 0)) return clamped;
  return Math.min(clamped, lastRenderableFrame(totalDuration, fps) / fps);
}

export function transitionAudioBoundaries(timelineMap) {
  return (timelineMap.transitionWindows ?? []).map(window => ({ at: window.end, duration: window.duration }));
}

// カット境界へジャンプ（P2-2: 旧実装は区間内の t をそのまま返す恒等関数だった）
export function snapToCut(segments, t, dir) {
  if (!segments.length) return t;
  const EPS = 0.001;
  const bounds = [...new Set(segments.flatMap(seg => [seg.outStart, seg.outEnd]))]
    .sort((left, right) => left - right);
  if (dir > 0) {
    const next = bounds.find(b => b > t + EPS);
    return next !== undefined ? next : t;
  }
  const prev = bounds.filter(b => b < t - EPS).pop();
  return prev !== undefined ? prev : 0;
}
