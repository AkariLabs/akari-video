// geometry.mjs — 両瞳のキャンバス座標 → 目線黒帯レイヤーの transform（x/y/rotate/scale）。
//
// 角度の符号規約（実測で確定・2026-08-11）: ffmpeg の `rotate=` フィルタは角度（ラジアン）が
// 正のとき、画面上で見て時計回りにコンテンツを回す（200x200 キャンバス・中心真上のマーカーに
// rotate=+45*PI/180 を掛けると重心が (156.2, 42.8) へ移動 = 中心から見て右上・時計回り 45°。
// 点の回転行列 rx = dx*cosθ - dy*sinθ, ry = dx*sinθ + dy*cosθ（画像座標系・y 下向き）と正確に
// 一致した — 詳細は report.md の実測ログ）。したがって「基準姿勢（rotate=0）で水平な帯」を
// 両瞳を結ぶベクトルへ向けるための角度は単純に atan2(dy, dx) でよい（回転行列で単位ベクトル
// (1,0) を角度 θ だけ回すと (cosθ, sinθ) になり、これを (dx, dy) の向きへ揃える θ が
// atan2(dy, dx) と一致するため）。space-map.mjs の applyCutTransformToPoint も同じ回転行列を
// 使っており、双方が同じ「正 = 時計回り」規約で一貫している。

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 両瞳のキャンバス座標（cuts[].transform 適用前・contain フィットのみ）から、帯の中心・角度・
 * 長さを求める。left/right は「向かって左/右」ではなく landmarks の `left_pupil`/`right_pupil`
 * キー（Vision 基準の解剖学的左右）をそのまま渡せばよい — 対称な帯なのでどちらを始点に取っても
 * 見た目は同じだが、角度の符号を一貫させるため常に left→right のベクトルを使う。
 */
export function eyeGeometryFromCanvasPoints(leftPx, rightPx) {
  const dx = rightPx.x - leftPx.x;
  const dy = rightPx.y - leftPx.y;
  return {
    centerX: (leftPx.x + rightPx.x) / 2,
    centerY: (leftPx.y + rightPx.y) / 2,
    angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    lengthPx: Math.hypot(dx, dy),
  };
}

/**
 * cut.transform（相似変換: 一様スケール＋回転＋平行移動）を、既に contain フィット済みの
 * 幾何（center/angle/length）へ合成する。相似変換は「中心点にだけ点変換を掛け、角度は加算、
 * 長さはスケール倍する」だけで両瞳へ個別に適用したのと数学的に同値（cut.transform は
 * カット全体で一定値であり、位置に依存しない一様な相似変換のため）。
 */
export function applyCutTransformToGeometry(geometry, transformCanvasPoint, cutTransform) {
  if (!cutTransform) return geometry;
  const scale = Number(cutTransform.scale ?? 1) || 1;
  const rotateDeg = Number(cutTransform.rotate ?? 0) || 0;
  const center = transformCanvasPoint(geometry.centerX, geometry.centerY, cutTransform);
  return {
    centerX: center.x,
    centerY: center.y,
    angleDeg: geometry.angleDeg + rotateDeg,
    lengthPx: geometry.lengthPx * scale,
  };
}

/**
 * 帯素材（ネイティブ幅 nativeBarWidthPx・scale=1 のとき画面上の長さがこの幅そのもの）を、
 * 求めた幾何へ合わせるための layers[].keyframes[].transform を返す。
 * - x/y はキャンバス中心からの px オフセット（layers.mjs の overlay=(main_w-overlay_w)/2+x と
 *   同じ規約）
 * - scale は「瞳間距離 × marginMultiplier」を nativeBarWidthPx で割った値（帯は瞳間距離ぴったり
 *   ではなく左右へ少しはみ出させるのが通例なので marginMultiplier で伸ばす）
 */
export function barLayerTransform(geometry, { nativeBarWidthPx, marginMultiplier, canvasWidth, canvasHeight }) {
  const desiredLengthPx = geometry.lengthPx * marginMultiplier;
  const scale = nativeBarWidthPx > 0 ? desiredLengthPx / nativeBarWidthPx : 1;
  return {
    x: geometry.centerX - canvasWidth / 2,
    y: geometry.centerY - canvasHeight / 2,
    rotate: geometry.angleDeg,
    scale: scale > 0 && isFiniteNumber(scale) ? scale : 0.0001,
  };
}
