// baked レイヤーの実体（アルファ付き .mov）は ProRes 4444 でブラウザがデコードできない。
// baked は同じ場所へプレビュー用サイドカー（.preview.webm / VP9 + アルファ）を必ず
// 併せて持つ規約なので、そちらを再生する。shell の previewProxyUri と同じ命名規約。
export function layerPlaybackPath(layer) {
  if (layer.kind !== 'baked') return layer.src;
  return /\.mov$/i.test(layer.src)
    ? layer.src.replace(/\.mov$/i, '.preview.webm')
    : `${layer.src}.preview.webm`;
}

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

export function getVideoSource(timelineData, cutIndex) {
  const clip = timelineData.clips.find(c => c.id === `cut-${cutIndex}`);
  return clip ? clip.src : (timelineData.clips[0]?.src || '');
}

// docs/contract-2026-08-12-still-image-cut-source-v0.md: cuts[] の静止画ソース区間はメインの
// <video id="preview-video"> ではなく <img id="preview-image"> で表示する（layers[] の静止画判定
// isImageLayerSrc と同じ拡張子集合 -- /layer-source.js から import している）。
export function isStillImageCutSegment(timelineData, seg) {
  return !!seg && !seg.isGap && seg.index >= 0 && isImageLayerSrc(getVideoSource(timelineData, seg.index));
}
