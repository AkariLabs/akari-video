export interface CanvasDropRow {
    id: string;
    trackId: string;
    parentId?: string;
}

export interface CanvasDropTrackLayout {
    id?: string;
    top: number;
    height: number;
}

export interface CanvasDropRowRect {
    id: string;
    top: number;
    bottom: number;
}

/** 画面上の行矩形と clientY を直接比べる。スクロール量の再加算は不要。 */
export function timelineRowAtClientY(
    clientY: number,
    rows: readonly CanvasDropRow[],
    rowRects: readonly CanvasDropRowRect[]
): CanvasDropRow | undefined {
    const hit = rowRects.find(rect => clientY >= rect.top && clientY < rect.bottom);
    return hit ? rows.find(row => row.id === hit.id) : undefined;
}

/** タイムラインの保存済み行配置を使い、ストリップ上の y から行を得る。 */
export function timelineRowAtY(
    localY: number,
    rows: readonly CanvasDropRow[],
    layouts: readonly CanvasDropTrackLayout[],
    rowIndices: ReadonlyMap<string, number>,
    strideOf: (trackId: string) => number,
    rowGap: number
): CanvasDropRow | undefined {
    for (const row of rows) {
        const layout = layouts.find(candidate => candidate.id === row.trackId);
        const index = rowIndices.get(row.id);
        if (!layout || index === undefined) continue;
        const stride = strideOf(row.trackId);
        const top = layout.top + index * stride;
        if (localY >= top && localY < Math.min(top + stride - rowGap, layout.top + layout.height)) return row;
    }
    return undefined;
}

export function canvasForTimelineRow(
    row: CanvasDropRow | undefined,
    rows: readonly CanvasDropRow[],
    isCanvas: (id: string) => boolean
): string | undefined {
    const byId = new Map(rows.map(candidate => [candidate.id, candidate]));
    let current = row;
    while (current) {
        if (isCanvas(current.id)) return current.id;
        current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return undefined;
}
