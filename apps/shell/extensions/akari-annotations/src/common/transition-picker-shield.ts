export interface PickerFrameRect { left: number; top: number; right: number; bottom: number }
export interface PickerShieldRect { left: number; top: number; width: number; height: number }

/** Keep each shield inside the visible viewport, and omit frames with no visible area. */
export function transitionPickerShieldRects(
    frames: readonly PickerFrameRect[], viewportWidth: number, viewportHeight: number
): PickerShieldRect[] {
    return frames.flatMap(frame => {
        if (![frame.left, frame.top, frame.right, frame.bottom].every(Number.isFinite)) return [];
        const left = Math.max(0, frame.left);
        const top = Math.max(0, frame.top);
        const right = Math.min(viewportWidth, frame.right);
        const bottom = Math.min(viewportHeight, frame.bottom);
        return right > left && bottom > top ? [{ left, top, width: right - left, height: bottom - top }] : [];
    });
}
