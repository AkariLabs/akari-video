/** 置いた文字の移動計画。縦のポインタ位置は着地先に使わず、元の段を保つ。 */
export function planPlacedTextMove(input: {
    originalStart: number;
    originalEnd: number;
    proposedStart: number;
    originalTop: string;
    clientY: number;
}): { start: number; end: number; top: string } {
    const start = Math.max(0, input.proposedStart);
    return {
        start,
        end: input.originalEnd + start - input.originalStart,
        top: input.originalTop
    };
}
