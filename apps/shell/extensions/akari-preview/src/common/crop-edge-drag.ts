// 選択枠の辺バー（四辺中央の細長い棒）と ⛶ クロップモードの 8 方向ハンドルが共有する、
// 「掴んだ辺だけを動かす」クロップ矩形の更新規則（docs/contract-2026-08-02-preview-parity.md
// §2.4.1 layers[].crop / cuts[].crop は 0..1 正規化・ソースフレーム相対）。
//
// 対辺（動かさない側）をアンカーに固定し、ドラッグ中の点（ソースフレームの正規化座標）で
// 動かした側の辺だけを更新する。dir は 'n' | 'e' | 's' | 'w' の 1 文字か、その組み合わせ
// （'nw' 等の角ハンドル）。含まれる文字の辺だけが動くので、辺バー（1 文字）と角ハンドル
// （2 文字）が同じ式で書ける。
//
// クランプは render-cut/src/layers.mjs のクロップ正規化と同じ意味論をプレビュー側で独立実装
// したもの（パリティ契約が明記する意図的なコード重複の方針に倣う）。`min` は空クロップ化を
// 防ぐ下限（ハンドルが操作不能になる縮退を避ける）。
//
// Serialized into the preview webview via Function.prototype.toString() -- see
// layer-crop-anchor.ts's header for the established pattern. Keep this self-contained: no
// closures over module state, no calls to sibling functions in this file.

export interface CropEdgeRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface CropEdgePoint {
    x: number;
    y: number;
}

/**
 * Returns the crop rect after dragging the edge(s) named by `dir` to `point` (source-frame
 * normalized coordinates). Every edge not named by `dir` keeps its previous position; the
 * result is clamped to 0..1 with `min` as the smallest allowed width/height.
 */
export function cropRectAfterEdgeDrag(
    prev: CropEdgeRect,
    dir: string,
    point: CropEdgePoint,
    min: number
): CropEdgeRect {
    const floor = Number.isFinite(min) && min > 0 ? Math.min(1, min) : 0;
    const prevX = Number.isFinite(prev.x) ? prev.x : 0;
    const prevY = Number.isFinite(prev.y) ? prev.y : 0;
    const prevW = Number.isFinite(prev.w) && prev.w > 0 ? prev.w : 1;
    const prevH = Number.isFinite(prev.h) && prev.h > 0 ? prev.h : 1;
    const anchorRight = prevX + prevW;
    const anchorBottom = prevY + prevH;
    const fx = Number.isFinite(point.x) ? point.x : prevX;
    const fy = Number.isFinite(point.y) ? point.y : prevY;
    const direction = typeof dir === 'string' ? dir : '';
    let nextX = prevX;
    let nextY = prevY;
    let nextRight = anchorRight;
    let nextBottom = anchorBottom;
    if (direction.indexOf('w') >= 0) nextX = Math.min(fx, anchorRight - floor);
    if (direction.indexOf('e') >= 0) nextRight = Math.max(fx, prevX + floor);
    if (direction.indexOf('n') >= 0) nextY = Math.min(fy, anchorBottom - floor);
    if (direction.indexOf('s') >= 0) nextBottom = Math.max(fy, prevY + floor);
    const rawW = nextRight - nextX;
    const rawH = nextBottom - nextY;
    const w = Math.min(1, Math.max(floor, Number.isFinite(rawW) ? rawW : 1));
    const h = Math.min(1, Math.max(floor, Number.isFinite(rawH) ? rawH : 1));
    return {
        x: Math.min(1 - w, Math.max(0, Number.isFinite(nextX) ? nextX : 0)),
        y: Math.min(1 - h, Math.max(0, Number.isFinite(nextY) ? nextY : 0)),
        w,
        h
    };
}
