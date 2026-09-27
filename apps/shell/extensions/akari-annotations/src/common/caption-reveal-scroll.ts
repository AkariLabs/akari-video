/** Align the requested section below the inspector's top edge, within its scroll range. */
export function captionRevealScrollTop(current: number, panelTop: number, panelHeight: number,
    scrollHeight: number, targetTop: number, margin = 20): number {
    const maximum = Math.max(0, scrollHeight - panelHeight);
    return Math.max(0, Math.min(maximum, current + targetTop - panelTop - margin));
}
