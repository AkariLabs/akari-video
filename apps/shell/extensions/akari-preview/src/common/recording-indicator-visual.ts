// docs/contract-2026-08-11-review-session-ui-events.md #4: recording indicator. The indicator is
// a fixed, full-viewport, pointer-events:none frame that must exclude the review (annotation)
// panel -- this module answers the pure question "what CSS clip-path punches that panel-shaped
// hole out of the full-viewport frame". No DOM access here so it is testable without jsdom (see
// ui-event-target.ts for the same rationale on the click-resolution side).

export interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface Viewport {
    width: number;
    height: number;
}

/**
 * Returns a CSS clip-path value covering the full viewport with a rectangular hole where
 * `excludeRect` sits (clamped to the viewport). Returns undefined when there is nothing to
 * exclude (no rect, or a rect with zero/negative area, or one entirely outside the viewport) --
 * callers should clear clip-path in that case and let the frame cover the whole screen.
 */
export function computeIndicatorClipPath(excludeRect: Rect | undefined, viewport: Viewport): string | undefined {
    if (!excludeRect || viewport.width <= 0 || viewport.height <= 0) {
        return undefined;
    }
    const left = Math.max(0, Math.min(viewport.width, excludeRect.left));
    const top = Math.max(0, Math.min(viewport.height, excludeRect.top));
    const right = Math.max(0, Math.min(viewport.width, excludeRect.right));
    const bottom = Math.max(0, Math.min(viewport.height, excludeRect.bottom));
    if (right - left <= 0 || bottom - top <= 0) {
        return undefined;
    }
    const outer = `0px 0px, ${viewport.width}px 0px, ${viewport.width}px ${viewport.height}px, 0px ${viewport.height}px, 0px 0px`;
    const hole = `${left}px ${top}px, ${left}px ${bottom}px, ${right}px ${bottom}px, ${right}px ${top}px, ${left}px ${top}px`;
    return `polygon(evenodd, ${outer}, ${hole})`;
}
