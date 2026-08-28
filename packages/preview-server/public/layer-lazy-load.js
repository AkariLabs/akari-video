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

export function loadLayerMediaMetadata(lv, sourceUrl) {
  if (lv.loaded || lv.unplayable) return false;
  // engine 面の legacy 要素は配置・選択に必要な実寸だけを読む。src より先に metadata を
  // 宣言し、ブラウザが既定の auto として媒体本体まで先読みする競合を避ける。
  lv.el.preload = 'metadata';
  lv.el.src = sourceUrl;
  lv.loaded = true;
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

export function idleLayerMedia(lv) {
  const el = lv.el;
  const hasSrcAttribute = typeof el.hasAttribute === 'function' && el.hasAttribute('src');
  // テスト用の簡易要素は hasAttribute を持たないため、src プロパティも防御的に見る。
  const hasFallbackSrc = typeof el.hasAttribute !== 'function'
    && typeof el.src === 'string' && el.src !== '';
  const shouldRelease = Boolean(lv.loaded || hasSrcAttribute || hasFallbackSrc);
  lv.loaded = false;
  if (shouldRelease && typeof el.removeAttribute === 'function') el.removeAttribute('src');
  el.preload = 'none';
  return shouldRelease;
}

export function markLayerUnplayable(lv) {
  lv.unplayable = true;
  releaseLayerMedia(lv);
}

export function syncLayerLazyLoad(lv, outputTime, sourceUrl, options = {}) {
  if (options.mediaIdle === true) {
    // mediaIdle はデコーダを再生・シークさせない engine 面の契約。配置に要る実寸まで
    // 捨てると選択不能になるため、時間窓内ではメタデータだけを遅延ロードする。
    if (lv.unplayable) {
      idleLayerMedia(lv);
      return false;
    }
    if (isLayerInLoadWindow(lv.layer, outputTime)) {
      if (!lv.loaded) {
        loadLayerMediaMetadata(lv, typeof sourceUrl === 'function' ? sourceUrl() : sourceUrl);
      }
    } else {
      idleLayerMedia(lv);
    }
    return lv.loaded;
  }
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
