/** Convert a bottom/zone placed caption to a top-anchored plate without moving its ink. */
export function captionWrapPosition(
    visualLeft: number, plateTop: number, outputWidth: number, outputHeight: number
): { anchor: 'tl'; position: { x: number; y: number } } {
    if (![visualLeft, plateTop, outputWidth, outputHeight].every(Number.isFinite)
        || outputWidth <= 0 || outputHeight <= 0) {
        throw new Error('文字の位置または出力の大きさが不正です');
    }
    const x = visualLeft / outputWidth;
    const y = plateTop / outputHeight;
    if (x < -0.2 || x > 1.2 || y < -0.2 || y > 1.2) {
        throw new RangeError('文字の位置が画面の外です');
    }
    return { anchor: 'tl', position: {
        x: Math.round(x * 10000) / 10000,
        y: Math.round(y * 10000) / 10000
    } };
}
