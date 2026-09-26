import { composeTransforms, evaluatedItemTransform, normalizeItemKeyframeGroup,
    relativeTransform, type ItemV2 } from '@akari-video/edit-store';
import { replaceXYKeyframes } from '@akari-video/edit-store/lib/motion-keyframe-replace';

/** Convert a world-space stroke at item-local frame times through every ancestor. */
export function nestedMotionPath(item: ItemV2, ancestors: ItemV2[],
    points: { t: number; transform: { x: number; y: number } }[]): ItemV2['keyframes'] {
    const itemStart = ancestors.reduce((sum, ancestor) => sum + ancestor.at, item.at);
    const local = points.map(point => {
        let parent: ReturnType<typeof composeTransforms>;
        let ancestorStart = 0;
        for (const ancestor of ancestors) {
            ancestorStart += ancestor.at;
            parent = composeTransforms(parent,
                evaluatedItemTransform(ancestor, itemStart + point.t - ancestorStart));
        }
        const result = relativeTransform(parent, point.transform);
        if (!result || !Number.isFinite(result.x) || !Number.isFinite(result.y)) {
            throw new Error('親の変形を逆算できません');
        }
        return { t: point.t, transform: { x: result.x, y: result.y } };
    });
    return normalizeItemKeyframeGroup({ ...item,
        keyframes: replaceXYKeyframes(item.keyframes, local, item.duration) }, 'position').keyframes;
}
