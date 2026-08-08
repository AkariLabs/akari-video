// VP9 alpha レイヤーはロード完了まで時間がかかるため、preview-engine のカット事前
// ウォームアップ先例（0.5〜1秒）の上限である 1 秒前から読む。終了後も 1 秒だけ保持し、
// 境界付近の小さな往復シークでは再ロードを避けつつ、通常は現在区間と隣接区間だけに
// デコーダ常駐を抑える。
export const LAYER_LOAD_AHEAD_SEC = 1;
export const LAYER_RELEASE_BEHIND_SEC = 1;

export function isLayerInLoadWindow(
  layer,
  outputTime,
  aheadSec = LAYER_LOAD_AHEAD_SEC,
  behindSec = LAYER_RELEASE_BEHIND_SEC,
) {
  const start = Number(layer?.t ?? 0);
  const duration = Number(layer?.duration ?? 0);
  if (![start, duration, outputTime, aheadSec, behindSec].every(Number.isFinite)) return false;
  if (duration <= 0 || aheadSec < 0 || behindSec < 0) return false;
  return outputTime >= start - aheadSec && outputTime < start + duration + behindSec;
}

export function loadLayerMedia(lv, sourceUrl) {
  if (lv.loaded || lv.unplayable) return false;
  lv.loaded = true;
  lv.el.preload = 'auto';
  lv.el.src = sourceUrl;
  return true;
}

export function releaseLayerMedia(lv) {
  if (!lv.loaded) return false;
  // loaded を先に落とす。removeAttribute + load が中断中リクエスト由来のイベントを
  // 発生させても、呼び出し側の error ハンドラが解放を 404 と誤認しないため。
  lv.loaded = false;
  lv.el.pause();
  lv.el.removeAttribute('src');
  lv.el.load();
  lv.el.preload = 'none';
  return true;
}

export function markLayerUnplayable(lv) {
  lv.unplayable = true;
  releaseLayerMedia(lv);
}

export function syncLayerLazyLoad(lv, outputTime, sourceUrl) {
  if (lv.unplayable) {
    releaseLayerMedia(lv);
    return false;
  }
  if (isLayerInLoadWindow(lv.layer, outputTime)) {
    if (!lv.loaded) loadLayerMedia(lv, typeof sourceUrl === 'function' ? sourceUrl() : sourceUrl);
  } else {
    releaseLayerMedia(lv);
  }
  return lv.loaded;
}
