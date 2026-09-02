// 本編 cut が「出力キャンバスへの contain fit 基準」から「ソース実寸基準の layer-style」へ
// 移る瞬間の等価変換（docs/contract-2026-08-02-preview-parity.md §2.3 / §5.3）。
//
// crop を持たない cut は出力キャンバスへ contain fit されてから transform が掛かる
// （frame-engine の compositor と shell の #preview-video は同じ既定）。crop を持つ cut は
// layers[] と同じ layer-style（ソース実寸 × scale・crop 矩形の中心を錨に出力中心 + (x, y) へ
// 置く）で描かれる。よって「初めて crop を書く」瞬間に scale へ fit 係数を焼き込まないと、
// 保存した途端に本編の大きさが変わってしまう。
//
// `geometry` は幾何統一後の edit.json が持つ出力座標系マーカー。'source'（= ソース実寸基準へ
// 移行済み）の文書では contain fit がそもそも掛かっていないので、この変換は恒等になる。
// 現行 schema にこのキーはまだ無く、未宣言（undefined）は従来どおりの fit 焼き込みを意味する。
//
// Serialized into the preview webview via Function.prototype.toString() -- see
// layer-crop-anchor.ts's header for the established pattern. Keep these self-contained: no
// closures over module state, no calls to sibling functions in this file.

export interface CutLayerStyleTransform {
    x: number;
    y: number;
    scale: number;
    rotate: number;
}

export interface CutLayerStyleSize {
    width: number;
    height: number;
}

export interface CutLayerStyleCrop {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Returns the transform to write alongside the first `crop` of a cut that is still drawn on the
 * canvas-fit path: `scale` picks up the contain-fit factor so the picture keeps its on-screen
 * size, while `x` / `y` / `rotate` are carried over untouched. Identity when the document
 * already declares `output.geometry: "source"`, or when the sizes are unusable.
 */
export function cutLayerStyleEntryTransform(
    transform: CutLayerStyleTransform,
    naturalW: number,
    naturalH: number,
    outputW: number,
    outputH: number,
    geometry?: string
): CutLayerStyleTransform {
    const x = Number.isFinite(transform.x) ? transform.x : 0;
    const y = Number.isFinite(transform.y) ? transform.y : 0;
    const rotate = Number.isFinite(transform.rotate) ? transform.rotate : 0;
    const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
    const identity = { x, y, scale, rotate };
    if (geometry === 'source') return identity;
    if (!(naturalW > 0) || !(naturalH > 0) || !(outputW > 0) || !(outputH > 0)) return identity;
    const fit = Math.min(outputW / naturalW, outputH / naturalH);
    if (!(fit > 0) || !Number.isFinite(fit)) return identity;
    return { x, y, scale: scale * fit, rotate };
}

/**
 * Returns the on-canvas (output px) size of a layer-style media box: the cropped source window
 * at its natural pixel size, scaled by `transform.scale`. The box centre is always
 * `output centre + (transform.x, transform.y)`, so callers only need the size from here.
 */
export function cutLayerStyleBoxPx(
    natural: CutLayerStyleSize,
    crop: CutLayerStyleCrop,
    scale: number
): CutLayerStyleSize {
    const width = Number.isFinite(natural.width) && natural.width > 0 ? natural.width : 0;
    const height = Number.isFinite(natural.height) && natural.height > 0 ? natural.height : 0;
    const cropW = Number.isFinite(crop.w) && crop.w > 0 ? Math.min(1, crop.w) : 1;
    const cropH = Number.isFinite(crop.h) && crop.h > 0 ? Math.min(1, crop.h) : 1;
    const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return { width: width * cropW * factor, height: height * cropH * factor };
}
