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
export function enableWindowExpr(start, end) {
  return `gte(t,${formatSeconds(start)})*lt(t,${formatSeconds(end)})`;
}

function formatSeconds(value) {
  return Number(value).toString();
}
