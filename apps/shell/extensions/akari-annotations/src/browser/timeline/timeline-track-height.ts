export interface TimelineTrackHeightInput {
    baseHeight: number;
    treeRowCount: number;
    propertyRowCount?: number;
    subrowStride: number;
}

/** 木の行を持つトラックのヘッダ最上段に置く「トラック行」（アイコン/名前/目/スピーカー）の行数。 */
export const TIMELINE_TRACK_LINE_ROWS = 1;

/** 木の行を持つトラックでだけ、木の行・プロパティ行を 1 行ぶん下へずらす量（行数）。 */
export function timelineTreeRowOffset(treeRowCount: number): number {
    return treeRowCount > 0 ? TIMELINE_TRACK_LINE_ROWS : 0;
}

/**
 * 畳んだトラックの既定高と、展開中の木・プロパティ行が要求する高さを合成する。
 * baseHeight 側だけを呼び出し元で clamp し、展開分には上限を掛けない。
 */
export function calculateTimelineTrackHeight(input: TimelineTrackHeightInput): number {
    const requiredRows = Math.max(
        1,
        timelineTreeRowOffset(input.treeRowCount) + input.treeRowCount + (input.propertyRowCount ?? 0)
    );
    return Math.max(input.baseHeight, requiredRows * input.subrowStride);
}
