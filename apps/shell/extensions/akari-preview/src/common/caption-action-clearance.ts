import type { PreviewLayerActionPlacement, PreviewActionRect } from './preview-layer-action-placement';

/** Leave a finger-width gap between side actions and the edge-width/resize handles. */
export function clearCaptionSideActions(
    actions: PreviewLayerActionPlacement | null,
    pane: PreviewActionRect,
    gapPx = 20
): PreviewLayerActionPlacement | null {
    if (!actions || !Number.isFinite(gapPx) || gapPx <= 0) return actions;
    const right = pane.left + pane.width;
    const offset = actions.placement === 'side-right'
        && actions.move.left + actions.move.width + gapPx <= right - 2 ? gapPx
        : actions.placement === 'side-left'
            && actions.rotate.left - gapPx >= pane.left + 2 ? -gapPx : 0;
    if (!offset) return actions;
    const shift = (rect: PreviewActionRect): PreviewActionRect => ({ ...rect, left: rect.left + offset });
    return { ...actions, offsetX: actions.offsetX + offset,
        rotate: shift(actions.rotate), move: shift(actions.move) };
}
