/** Move full-size side grips outside short boxes without displacing the corner grips. */
export function captionEdgeHandleLayout(height: number): { edgeOutset: number } {
    const boxHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
    return { edgeOutset: boxHeight < 31 ? 18 : 0 };
}
