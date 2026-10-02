// task 2026-08-10-image-layer-parity 司令塔裁定1: layers[].src の拡張子だけで静止画判定する
// （schema の kind は 'video' のまま不変）。render-cut 側の同じ判定
// （packages/render-cut/src/layers.mjs の isImageLayerSource, plan.mjs の画像判定と同一集合）と
// 対象拡張子を完全に揃える。'baked' はここでは常に false 扱い -- layerPlaybackPath() が baked を
// 元の拡張子に関わらず常に .preview.webm サイドカーへ差し替えるため（上の layerPlaybackPath 参照）、
// 実際に配信されるバイト列は常に動画。'video' kind のみ元ファイルをそのまま配信するので、
// layer.src の拡張子判定がそのまま安全に使える。
const IMAGE_LAYER_SRC_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/i;
export function isImageLayerSrc(src) {
  return typeof src === 'string' && IMAGE_LAYER_SRC_PATTERN.test(src);
}
export function isImageLayer(layer) {
  return layer.kind !== 'baked' && isImageLayerSrc(layer.src);
}

