export interface PreviewTransform {
    x?: number; y?: number; scale?: number; scaleX?: number; scaleY?: number; rotate?: number;
}

/** Parent groups are uniform. Keep in sync with tree-ops and overlay-runtime/parts. */
export function composePreviewTransforms(parent: PreviewTransform, child: PreviewTransform = {}): PreviewTransform {
    const angle = (parent.rotate ?? 0) * Math.PI / 180;
    const scale = parent.scale ?? 1, x = child.x ?? 0, y = child.y ?? 0;
    const sx = scale * (child.scaleX ?? child.scale ?? 1);
    const sy = scale * (child.scaleY ?? child.scale ?? 1);
    return { x: (parent.x ?? 0) + scale * (Math.cos(angle) * x - Math.sin(angle) * y),
        y: (parent.y ?? 0) + scale * (Math.sin(angle) * x + Math.cos(angle) * y),
        ...(sx === sy ? { scale: sx } : { scale: scale * (child.scale ?? 1), scaleX: sx, scaleY: sy }),
        rotate: (parent.rotate ?? 0) + (child.rotate ?? 0) };
}

/** Optional axis overrides only: invalid/missing axes must not change legacy summary keys. */
export function previewTransformAxes(value: { scaleX?: unknown; scaleY?: unknown } | null | undefined): Pick<PreviewTransform, 'scaleX' | 'scaleY'> {
    return {
        ...(typeof value?.scaleX === 'number' && Number.isFinite(value.scaleX) && value.scaleX > 0 ? { scaleX: value.scaleX } : {}),
        ...(typeof value?.scaleY === 'number' && Number.isFinite(value.scaleY) && value.scaleY > 0 ? { scaleY: value.scaleY } : {})
    };
}
