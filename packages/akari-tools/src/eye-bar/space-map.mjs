// space-map.mjs — face_landmarks の正規化座標（0..1・左上原点・元 source フレーム相対）を
// 出力キャンバス（edit.output.width/height）のピクセル座標へ写す。
//
// render-cut のベース映像パイプラインは、cuts[].transform / opacity が 1 つも宣言されていない
// ときでも常に「contain フィット + 中央パディング」でソースをキャンバスへ合わせている
// （packages/render-cut/src/plan.mjs の scale=W:H:force_original_aspect_ratio=decrease,
// pad=W:H:(ow-iw)/2:(oh-ih)/2 と、cut-transform.mjs の appendCutVisualTransform 内 `fitted` 段が
// 同じ式 — 後者は cuts[].transform 適用時に前段としてもう一度同じ式を通すだけで式自体は変えない）。
// なのでこの contain フィットは常に適用する（cuts[].transform の有無に関係なく）。
//
// cuts[].transform（x/y/scale/rotate）が宣言されているカットは、そのフィット済みフレーム全体に
// 対し「中心基準の scale→rotate→(main_w-w)/2+x, (main_h-h)/2+y のオフセット」を追加で適用する
// （cut-transform.mjs の overlay= 呼び出しと同じ式）。ここでも同じ式を踏襲する。
//
// v0 のスコープ外（既知の制約 — report.md に明記）: cuts[].framing（ズームのキーフレーム区間
// 縮小）。framing が宣言されているカットの区間は、幾何が保証できないため呼び出し側が
// スキップ（欠測扱い＝ホールド）してよい判断材料として framingUnsupported を返す。

const EPSILON = 1e-9;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * ソース映像の「表示上の」寸法（回転メタデータ補正後）から、contain フィット後にキャンバス上へ
 * 置かれる矩形（左上座標・幅・高さ）を返す。vision-tracks.mjs の probeSource と同じ考え方
 * （回転補正後の width/height を渡すのは呼び出し側の責務）。
 */
export function containFitRect(sourceWidth, sourceHeight, canvasWidth, canvasHeight) {
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  return {
    scale,
    x: (canvasWidth - displayWidth) / 2,
    y: (canvasHeight - displayHeight) / 2,
    width: displayWidth,
    height: displayHeight,
  };
}

/**
 * cut.transform（x/y/scale/rotate、すべて既定値あり）を、キャンバス座標上の点 (px, py) と
 * 角度 angleDeg（キャンバス座標系での度数）に適用する。cut-transform.mjs の
 * overlay=x=(main_w-overlay_w)/2+x:y=(main_h-overlay_h)/2+y と同じ「中心基準のスケール→回転→
 * オフセット」の順で解く（点変換なので、フィルタの「フレームを動かす」向きと同じ幾何変換を
 * その点にもそのまま適用すればよい）。
 */
export function applyCutTransformToPoint(px, py, canvasWidth, canvasHeight, transform) {
  const scale = Number(transform?.scale ?? 1) || 1;
  const rotateDeg = Number(transform?.rotate ?? 0) || 0;
  const x = Number(transform?.x ?? 0) || 0;
  const y = Number(transform?.y ?? 0) || 0;

  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  // 中心基準に平行移動
  let dx = px - cx;
  let dy = py - cy;
  // スケール（rotate フィルタの前段）
  dx *= scale;
  dy *= scale;
  // 回転（ffmpeg rotate= と同じ向き — y が下向きの画像座標系で角度 θ 分回す）
  if (rotateDeg !== 0) {
    const theta = toRadians(rotateDeg);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    dx = rx;
    dy = ry;
  }
  // 中心へ戻し、cut.transform のオフセットを足す
  return { x: cx + dx + x, y: cy + dy + y, angleOffsetDeg: rotateDeg, scaleFactor: scale };
}

/**
 * face_landmarks の正規化点 [u, v]（0..1・左上原点・元 source フレーム相対）を、cut の
 * 空間変換込みでキャンバスピクセル座標へ写す。
 *
 * @param {[number, number]} normalizedPoint
 * @param {{width:number, height:number}} sourceDisplaySize 回転補正後のソース表示寸法
 * @param {{width:number, height:number}} canvasSize edit.output の width/height
 * @param {object|null} cutTransform 対象カットの transform（無ければ恒等）
 */
export function mapNormalizedPointToCanvas(normalizedPoint, sourceDisplaySize, canvasSize, cutTransform = null) {
  const fit = containFitRect(sourceDisplaySize.width, sourceDisplaySize.height, canvasSize.width, canvasSize.height);
  const px = fit.x + normalizedPoint[0] * fit.width;
  const py = fit.y + normalizedPoint[1] * fit.height;
  if (!cutTransform) return { x: px, y: py, scaleFactor: fit.scale, cutRotateDeg: 0 };
  const transformed = applyCutTransformToPoint(px, py, canvasSize.width, canvasSize.height, cutTransform);
  return {
    x: transformed.x,
    y: transformed.y,
    scaleFactor: fit.scale * transformed.scaleFactor,
    cutRotateDeg: transformed.angleOffsetDeg,
  };
}

export function cutHasUnsupportedFraming(cut) {
  const framing = cut?.framing;
  if (!framing || typeof framing !== "object") return false;
  const keyframes = framing.keyframes;
  return Array.isArray(keyframes) && keyframes.length >= 2;
}

export { EPSILON as SPACE_MAP_EPSILON };
