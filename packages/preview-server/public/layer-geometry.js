// public/app.js から逐語移動。DOM とモジュール変数に依存しない純関数（F-69）。

export function outputSizePx(summary) {
  const os = summary?.output || {};
  return {
    width: Number(os.width) > 0 ? Number(os.width) : 1280,
    height: Number(os.height) > 0 ? Number(os.height) : 720
  };
}

// ㉔ layers[].crop（0..1 正規化・ソースフレーム相対・静的。contract-2026-08-02-preview-parity.md）。
// crop 未指定は既定 {x:0,y:0,w:1,h:1} = 全面（従来と完全に見た目が同じになる境界値）。
export function cropOf(el) {
  const cw = Number(el.dataset.layerCropW);
  const ch = Number(el.dataset.layerCropH);
  return {
    x: Number(el.dataset.layerCropX) || 0,
    y: Number(el.dataset.layerCropY) || 0,
    w: Number.isFinite(cw) && cw > 0 ? cw : 1,
    h: Number.isFinite(ch) && ch > 0 ? ch : 1,
  };
}

export function layerIntrinsicSize(el) {
  // 配置の正本は媒体メタデータの実寸。person-matte 等の intake 出力寸法はプロジェクトの
  // output 寸法と一致する保証がないため、frame-engine の成否から寸法を推定しない。
  //
  // これは frame-engine の構図の基準（原本の論理寸法 = NativeFrameSource.logicalSize。
  // 不具合メモ 第10項）と一致している: この要素が読むのは `summary.layers[].src`
  // （= 原本。setupLayers → layerPlaybackPath → syncLayerLazyLoad）で、再生用コピーの
  // proxy 差し替え（preview-layer-proxies.mjs）は frame-engine へ渡す edit にだけ効き、
  // サーバも素材要求を横取りして proxy を返したりしない（server.mjs は常に原本を返す）。
  // ハンドル位置・crop 窓・perspective 箱をキャンバスと一致させるため、**この要素へ proxy を
  // 読ませないこと**（読ませるなら、ここも原本の宣言寸法を引くように直す必要がある）。
  return { width: Number(el.videoWidth) || 0, height: Number(el.videoHeight) || 0 };
}

// ㉖ layers[].perspective（0..1 正規化・corner-pin・静的。contract-2026-08-02-preview-parity.md
// §2.4.4）。perspective 未指定 or 不正値は null（既存の見た目を一切変えない = 回帰なし）。
export function perspectiveOf(el) {
  const raw = el.dataset.layerPerspectiveCorners;
  if (!raw) return null;
  try {
    const corners = JSON.parse(raw);
    return Array.isArray(corners) && corners.length === 4 ? { corners } : null;
  } catch {
    return null;
  }
}

// ソース px（ネイティブ px。videoWidth/videoHeight）の矩形を、layerContainer ローカル座標
// （frameScale/zoom 適用前の「出力論理 px」空間 -- video 要素自身と同じ単位。frameScale/zoom は
// 親コンテナの scale() が別途処理する）へ正写像する。shell の layerScreenRectForVideoRect と
// 同型の幾何（画面 px への変換〔frameRect/frameScale 乗算〕だけ、Web はこの空間のまま
// layerContainer の子として置くため省く）。2026-08-06 web-layer-placement-parity: 中心基準統一
// に伴い el.offsetLeft 依存の旧実装を置き換えた -- 旧実装は「el 自身の静的位置に transform.x を
// 加算する」慣習だったが、新基準では transform.x は既に el.style.left（= outputWidth/2+x）へ
// 焼き込まれているため、el.offsetLeft から独立に「ネイティブ px 空間 → transform による配置」を
// 導出する必要がある（shell と同じ formula: P' = outputSize/2 + T + s·R(θ)·(P-pivot)）。
export function layerRectForVideoRect(summary, transform, videoRect, pivotPx) {
  const os = outputSizePx(summary);
  const outputW = videoRect.w * (transform.scaleX ?? transform.scale);
  const outputH = videoRect.h * (transform.scaleY ?? transform.scale);
  const offX = (videoRect.x + videoRect.w / 2 - pivotPx.x) * (transform.scaleX ?? transform.scale);
  const offY = (videoRect.y + videoRect.h / 2 - pivotPx.y) * (transform.scaleY ?? transform.scale);
  const rad = transform.rotate * Math.PI / 180;
  const rotOffX = offX * Math.cos(rad) - offY * Math.sin(rad);
  const rotOffY = offX * Math.sin(rad) + offY * Math.cos(rad);
  const centerX = os.width / 2 + transform.x + rotOffX;
  const centerY = os.height / 2 + transform.y + rotOffY;
  return { left: centerX - outputW / 2, top: centerY - outputH / 2, width: outputW, height: outputH, rotOffX, rotOffY };
}

export const CROP_MIN = 0.02;
export function clampCrop(x, y, w, h) {
  const cw = Math.min(1, Math.max(CROP_MIN, Number.isFinite(w) ? w : 1));
  const ch = Math.min(1, Math.max(CROP_MIN, Number.isFinite(h) ? h : 1));
  const cx = Math.min(1 - cw, Math.max(0, Number.isFinite(x) ? x : 0));
  const cy = Math.min(1 - ch, Math.max(0, Number.isFinite(y) ? y : 0));
  return { x: cx, y: cy, w: cw, h: ch };
}
export function layerTransformOf(el) {
  return {
    x: Number(el.dataset.layerX) || 0,
    y: Number(el.dataset.layerY) || 0,
    scale: Number(el.dataset.layerScale) || 1,
    ...(el.dataset.layerScaleX !== undefined ? { scaleX: Number(el.dataset.layerScaleX) } : {}),
    ...(el.dataset.layerScaleY !== undefined ? { scaleY: Number(el.dataset.layerScaleY) } : {}),
    rotate: Number(el.dataset.layerRotate) || 0,
  };
}

export function layerPerspectiveNow(el) {
  const raw = el.dataset.layerPerspectiveCorners;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length === 4 ? parsed : null;
  } catch {
    return null;
  }
}

// プリセット→4隅の展開（v0）。SSOT は保存される4隅のみ — このツマミはオーサリング側の便宜であり、
// schema には「プリセット」「角度」という概念自体は存在しない（shell 側と同一の式・
// contract-2026-08-02-preview-parity.md §2.4.4。意図的なコード重複）。
export function perspectivePresetCorners(preset, angleDeg) {
  const compression = Math.max(0, Math.min(0.9, Math.sin((Number(angleDeg) || 0) * Math.PI / 180)));
  const half = compression / 2;
  if (preset === 'right') return [[0, 0], [1, half], [0, 1], [1, 1 - half]];
  if (preset === 'left') return [[0, half], [1, 0], [0, 1 - half], [1, 1]];
  if (preset === 'top') return [[half, 0], [1 - half, 0], [0, 1], [1, 1]];
  if (preset === 'bottom') return [[0, 0], [1, 0], [half, 1], [1 - half, 1]];
  return null;
}
