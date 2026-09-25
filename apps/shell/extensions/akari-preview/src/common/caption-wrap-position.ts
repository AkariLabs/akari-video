/** Convert a bottom/zone placed caption to a top-anchored plate without moving its ink. */
export function captionWrapPosition(
    visualLeft: number, plateTop: number, outputWidth: number, outputHeight: number
): { anchor: 'tl'; position: { x: number; y: number } } {
    if (![visualLeft, plateTop, outputWidth, outputHeight].every(Number.isFinite)
        || outputWidth <= 0 || outputHeight <= 0) {
        throw new Error('文字の位置または出力の大きさが不正です');
    }
    return { anchor: 'tl', position: {
        x: Math.round(visualLeft / outputWidth * 10000) / 10000,
        y: Math.round(plateTop / outputHeight * 10000) / 10000
    } };
}
