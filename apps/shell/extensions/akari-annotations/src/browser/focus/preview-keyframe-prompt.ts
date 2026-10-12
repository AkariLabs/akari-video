import { evaluatedItemTransform, evaluatedItemVar, hasItemKeyframeGroup,
    ROTATION_3D_VARS, type ItemV2 } from '@akari-video/edit-store';

export type PreviewKeyframeGroup = 'position' | 'size' | 'rotation' | 'rotation3d';

export function groupsWithoutKeys(
    item: Pick<ItemV2, 'source' | 'transform' | 'keyframes' | 'duration'>,
    patch: { transform?: { x?: number; y?: number; scale?: number; scaleX?: number;
        scaleY?: number; rotate?: number }; varsAt?: Record<string, number> },
    frame: number
): PreviewKeyframeGroup[] {
    const changed = (value: number | undefined, previous: number): boolean =>
        Number.isFinite(value) && Math.abs(value! - previous) > 1e-6;
    const groups: PreviewKeyframeGroup[] = [];
    const transform = patch.transform;
    if (transform) {
        const previous = evaluatedItemTransform(item, frame);
        if (changed(transform.x, previous.x) || changed(transform.y, previous.y)) groups.push('position');
        if (changed(transform.scale, previous.scale) || changed(transform.scaleX, previous.scaleX)
            || changed(transform.scaleY, previous.scaleY)) groups.push('size');
        if (changed(transform.rotate, previous.rotate)) groups.push('rotation');
    }
    if (patch.varsAt && ROTATION_3D_VARS.some(name =>
        changed(patch.varsAt?.[name], evaluatedItemVar(item, frame, name)))) groups.push('rotation3d');
    return groups.filter(group => !hasItemKeyframeGroup(item, group));
}
