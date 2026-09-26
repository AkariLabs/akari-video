export interface CaptionEditPoint { x: number; y: number }
export interface CaptionEditRect { left: number; right: number; top: number; bottom: number; pivot?: CaptionEditPoint }

export function captionOrientedFrame(rect: CaptionEditRect, scale: number, rotate: number): {
    center: CaptionEditPoint; width: number; height: number; corners: CaptionEditPoint[]
} {
    const rawCenter = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
    const width = Math.max(0, rect.right - rect.left) * scale;
    const height = Math.max(0, rect.bottom - rect.top) * scale;
    const radians = rotate * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const pivot = rect.pivot ?? rawCenter;
    const offsetX = rawCenter.x - pivot.x, offsetY = rawCenter.y - pivot.y;
    const center = { x: pivot.x + scale * (offsetX * cosine - offsetY * sine),
        y: pivot.y + scale * (offsetX * sine + offsetY * cosine) };
    const corners = [
        [-width / 2, -height / 2], [width / 2, -height / 2],
        [width / 2, height / 2], [-width / 2, height / 2]
    ].map(([x, y]) => ({ x: center.x + x * cosine - y * sine,
        y: center.y + x * sine + y * cosine }));
    return { center, width, height, corners };
}

export function captionSideMidpoint(corners: readonly CaptionEditPoint[], side: 'e' | 'w'): CaptionEditPoint {
    const first = side === 'w' ? corners[0] : corners[1];
    const second = side === 'w' ? corners[3] : corners[2];
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function captionWrapAnchorDelta(
    startCorners: readonly CaptionEditPoint[], movedCorners: readonly CaptionEditPoint[],
    fixedSide: 'e' | 'w'
): CaptionEditPoint {
    const fixedCorner = fixedSide === 'w' ? 0 : 1;
    return { x: startCorners[fixedCorner].x - movedCorners[fixedCorner].x,
        y: startCorners[fixedCorner].y - movedCorners[fixedCorner].y };
}

export function captionWrapResize(
    side: 'e' | 'w', start: { left: number; right: number },
    delta: CaptionEditPoint, rotate: number, scale: number, outputWidth: number
): { widthPct: number; left: number; right: number } {
    const radians = rotate * Math.PI / 180;
    const localDelta = (delta.x * Math.cos(radians) + delta.y * Math.sin(radians))
        / (Number.isFinite(scale) && scale > 0 ? scale : 1);
    const width = Math.min(outputWidth, Math.max(8,
        start.right - start.left + (side === 'e' ? localDelta : -localDelta)));
    const widthPct = Math.round(width / outputWidth * 10000) / 100;
    const roundedWidth = widthPct / 100 * outputWidth;
    return side === 'e' ? { widthPct, left: start.left, right: start.left + roundedWidth }
        : { widthPct, left: start.right - roundedWidth, right: start.right };
}

export function captionEditorLines(text: string): string[] {
    return text.replace(/\r\n?/g, '\n').split('\n');
}

export function captionEditorWrapWidth(widths: readonly number[]): number | undefined {
    const valid = widths.filter(width => Number.isFinite(width) && width > 0);
    return valid.length ? Math.max(...valid) : undefined;
}

export function captionLineCountFromMetrics(
    height: number, lineHeight: number, paddingTop: number, paddingBottom: number
): number {
    if (![height, lineHeight, paddingTop, paddingBottom].every(Number.isFinite) || lineHeight <= 0) return 1;
    return Math.max(1, Math.round((height - paddingTop - paddingBottom) / lineHeight));
}

export function captionEditorFitWidth(
    width: number, targetLines: number, measureLines: (width: number) => number
): number {
    if (!Number.isFinite(width) || width <= 8 || targetLines <= 1 || measureLines(width) >= targetLines) return width;
    let lower = 8, upper = width, fitted = width;
    for (let index = 0; index < 12; index++) {
        const candidate = (lower + upper) / 2;
        if (measureLines(candidate) >= targetLines) { fitted = candidate; lower = candidate; }
        else upper = candidate;
    }
    return Math.floor(fitted * 10) / 10;
}

export function captionEditorValue(innerText: string): string {
    const normalized = innerText.replace(/\r\n?/g, '\n').normalize('NFC');
    return normalized.trim().length === 0 ? '' : normalized.replace(/^[ \t]+|[ \t]+$/g, '');
}

export function captionEditingNavigationKey(editing: boolean, key: string): boolean {
    return editing && (key === 'Home' || key === 'End'
        || key === 'ArrowLeft' || key === 'ArrowRight'
        || key === 'ArrowUp' || key === 'ArrowDown');
}
