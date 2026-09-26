export interface PreviewMotionTransform {
    x: number;
    y: number;
    scale: number;
    scaleX?: number;
    scaleY?: number;
    rotate: number;
}

/** Evaluate the current base pose while retaining motion and parent animation. */
export function previewMotionLiveItem<T extends { transform?: PreviewMotionTransform; keyframes?: unknown }>(
    item: T, live: PreviewMotionTransform
): T {
    return { ...item, transform: live, keyframes: undefined };
}

/** The evaluated pose owns hit geometry, including live scale and rotation. */
export function previewMotionGeometryTransform(
    base: PreviewMotionTransform,
    evaluated: PreviewMotionTransform | null | undefined,
    livePosition?: { x: number; y: number } | null
): PreviewMotionTransform {
    if (!evaluated) return base;
    return {
        ...base,
        x: livePosition?.x ?? evaluated.x,
        y: livePosition?.y ?? evaluated.y,
        scale: evaluated.scale,
        scaleX: evaluated.scaleX ?? evaluated.scale,
        scaleY: evaluated.scaleY ?? evaluated.scale,
        rotate: evaluated.rotate
    };
}

/** Stage-local output pixels against a rotated visible box. */
export function previewMotionBoxHitAt(
    box: { centerX: number; centerY: number; width: number; height: number; rotate: number },
    point: { x: number; y: number } | null
): boolean {
    if (!point || !(box.width > 0) || !(box.height > 0)) return false;
    const dx = point.x - box.centerX;
    const dy = point.y - box.centerY;
    const angle = -box.rotate * Math.PI / 180;
    const x = dx * Math.cos(angle) - dy * Math.sin(angle);
    const y = dx * Math.sin(angle) + dy * Math.cos(angle);
    return x >= -box.width / 2 && x < box.width / 2
        && y >= -box.height / 2 && y < box.height / 2;
}
