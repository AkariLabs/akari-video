// overlay フィルタの表示区間（enable 式）を作る唯一の場所。
//
// 2026-08-14 まで、layers / plan / rasterize / track-compose の 4 箇所が
// `enable='between(t,start,end)'` を各自で組み立てていた。ffmpeg の between は
// **閉区間**（min <= t <= max）なので、`end` がフレーム格子にちょうど乗る尺
// （3.4s = 102 フレーム @30fps のような丸い値。実運用ではむしろ普通）だと、
// **次のクリップの先頭フレームにも 1 フレームだけ重なって出る**。
// 実測（30fps・t=1.0・duration=3.4・窓の後ろに実コンテンツを続けた構成）で
// 102 フレームであるべきところが 103 フレーム描画され、t=4.4（次カットの最初の
// フレーム）にまで漏れることを確認した。h264 の不透明マスクでも ProRes 4444 の
// 実アルファでも同じで、再実行しても決定論的に再現する。
//
// 表示区間は半開区間 [start, end) と定める。境界フレームの帰属が常に一意に決まり、
// `duration` を足していくクリップ列が重ならない。
//
// 4 箇所が同じ式を各自で持っていたこと自体が、この穴を長く生かしていた原因なので、
// 新しい表示区間を書くときもここを経由すること。
//
// 2026-08-20: 秒の境界値をそのまましきい値にすると、JS の `n / fps` と ffmpeg の
// `n * av_q2d(time_base)` が double で一致しないため、境界フレームが窓から抜ける。
// 30fps・n=77 の実測では、JS の `77 / 30` は 2.566666666666667、ffmpeg と同じ
// `77 * (1.0 / 30.0)` は 2.5666666666666664 となり、`gte(t,2.566666666666667)` が
// フレーム 77 を除外した。そこで対象フレームを先に決め、しきい値を隣接フレーム間の
// 中点へ置く。1ulp のずれでは境界を越えないため、半開区間の帰属を保ったまま頑健になる。
const EPSILON = 1e-6;

export function enableWindowExpr(start, end, fps) {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new TypeError(`enableWindowExpr: fps は正の有限数である必要があります: ${fps}`);
  }
  // 表示するフレーム番号の半開区間 [startFrame, endFrame)。
  // 連続時間の半開区間 [start, end) が含むフレーム n（= n/fps >= start かつ n/fps < end）と
  // 完全に同じ集合になるよう ceil で量子化する（EPSILON は double 誤差の吸収のみ）。
  const startFrame = Math.max(0, Math.ceil(start * fps - EPSILON));
  const endFrame = Math.max(startFrame, Math.ceil(end * fps - EPSILON));
  // しきい値をフレームの中点（n - 0.5）に置く。t がどちら向きに 1ulp ずれても
  // 帰属が変わらない = 上記の double 不一致に対して構造的に頑健になる。
  const lower = Math.max(0, (startFrame - 0.5) / fps);
  const upper = (endFrame - 0.5) / fps;
  return `gte(t,${formatSeconds(lower)})*lt(t,${formatSeconds(upper)})`;
}

function formatSeconds(value) {
  return Number(value).toString();
}
