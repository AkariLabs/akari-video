export interface TimelineTrackHeightInput {
    baseHeight: number;
    treeRowCount: number;
    propertyRowCount?: number;
    subrowStride: number;
}

/**
 * 畳んだトラックの既定高と、展開中の木・プロパティ行が要求する高さを合成する。
 * baseHeight 側だけを呼び出し元で clamp し、展開分には上限を掛けない。
 */
export function calculateTimelineTrackHeight(input: TimelineTrackHeightInput): number {
    const requiredRows = Math.max(1, input.treeRowCount + (input.propertyRowCount ?? 0));
    return Math.max(input.baseHeight, requiredRows * input.subrowStride);
}
