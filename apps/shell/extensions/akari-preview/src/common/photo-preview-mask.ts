export interface PhotoPreviewStroke {
    mode: 'erase' | 'restore';
    points: readonly (readonly [number, number])[];
    size: number;
    hardness: number;
}

/** Source-space alpha ledger for the DOM still-image preview. Mirrors the frame evaluator. */
export function composePhotoPreviewMask(base: Uint8Array | null, width: number, height: number,
    strokes: readonly PhotoPreviewStroke[], originalAlpha: Uint8Array): Uint8Array {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
        || width > 65_536 || height > 65_536 || width * height > 268_435_456) throw new RangeError('invalid mask dimensions');
    const length = width * height;
    if (base && base.length !== length) throw new RangeError('base mask size mismatch');
    if (originalAlpha.length !== length) throw new RangeError('original alpha size mismatch');
    const output = base ? new Uint8Array(base) : new Uint8Array(length).fill(255);
    const unit = 64;
    for (const stroke of strokes) {
        if ((stroke.mode !== 'erase' && stroke.mode !== 'restore') || !Number.isFinite(stroke.size)
            || stroke.size <= 0 || stroke.size > 1 || !Number.isFinite(stroke.hardness)
            || stroke.hardness < 0 || stroke.hardness > 1 || stroke.points.length === 0) throw new RangeError('invalid mask stroke');
        const points = stroke.points.map(([x, y]) => {
            if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
                throw new RangeError('invalid mask point');
            }
            return [Math.round(x * width * unit), Math.round(y * height * unit)];
        });
        const radius = Math.max(1, Math.round(stroke.size * Math.min(width, height) * unit / 2));
        const inner = Math.round(radius * stroke.hardness);
        const outerSq = radius * radius, innerSq = inner * inner;
        const coveragePixels = new Uint8Array(length);
        for (let segment = 0; segment < points.length; segment++) {
            const a = points[Math.max(0, segment - 1)], b = points[segment];
            const lowX = Math.max(0, Math.floor((Math.min(a[0], b[0]) - radius) / unit));
            const highX = Math.min(width - 1, Math.ceil((Math.max(a[0], b[0]) + radius) / unit));
            const lowY = Math.max(0, Math.floor((Math.min(a[1], b[1]) - radius) / unit));
            const highY = Math.min(height - 1, Math.ceil((Math.max(a[1], b[1]) + radius) / unit));
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const segmentSq = dx * dx + dy * dy;
            for (let y = lowY; y <= highY; y++) {
                for (let x = lowX; x <= highX; x++) {
                    const px = (x * 2 + 1) * unit / 2, py = (y * 2 + 1) * unit / 2;
                    const projection = segmentSq === 0 ? 0 : Math.max(0, Math.min(1,
                        ((px - a[0]) * dx + (py - a[1]) * dy) / segmentSq));
                    const distX = px - a[0] - Math.round(dx * projection);
                    const distY = py - a[1] - Math.round(dy * projection);
                    const distanceSq = distX * distX + distY * distY;
                    if (distanceSq >= outerSq) continue;
                    const coverage = distanceSq <= innerSq || outerSq === innerSq ? 255
                        : Math.floor((outerSq - distanceSq) * 255 / (outerSq - innerSq));
                    const index = y * width + x;
                    if (coverage > coveragePixels[index]) coveragePixels[index] = coverage;
                }
            }
        }
        for (let index = 0; index < length; index++) {
            const coverage = coveragePixels[index];
            if (!coverage) continue;
            const old = output[index], cap = originalAlpha[index];
            output[index] = stroke.mode === 'erase'
                ? Math.floor((old * (255 - coverage) + 127) / 255)
                : Math.min(cap, old + Math.floor(((cap - old) * coverage + 127) / 255));
        }
    }
    return output;
}
