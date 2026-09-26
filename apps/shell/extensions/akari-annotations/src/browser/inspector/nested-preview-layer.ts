import { absoluteAt, locate, relativeTransform, worldTransformOfAncestors,
    type EditableEditV2, type ItemV2, type PreviewItemWriteCommand } from '@akari-video/edit-store';
import { nestedMotionPath } from './nested-motion-path';
import { updateTreeV2Item, writeV2ItemTransformAt, type EditV2Document } from '../../common/edit-v2-mutations';

/** The preview receives a flattened world pose; edit.json stores the child's local pose. */
export function writeNestedPreviewLayer(
    doc: EditV2Document, command: PreviewItemWriteCommand
): EditV2Document | undefined {
    if (command.kind !== 'layer') return undefined;
    const location = locate(doc as unknown as EditableEditV2, command.itemId);
    if (!location || location.ancestors.length === 0) return undefined;
    if (location.item.source.kind !== 'media') throw new Error('キャンバス内の写真を選んでください');
    let next = doc;
    if (command.patch.xyKeyframes) {
        next = updateTreeV2Item(next, command.itemId, {
            keyframes: nestedMotionPath(location.item as unknown as ItemV2,
                location.ancestors as unknown as ItemV2[], command.patch.xyKeyframes)
        });
    }
    if (command.patch.transform) {
        const parent = worldTransformOfAncestors(location.ancestors);
        const local = relativeTransform(parent, command.patch.transform);
        if (!local) throw new Error('写真の変形を計算できません');
        const output = doc.output as { fps?: number };
        const frame = Math.round((command.playheadSeconds ?? NaN) * (output?.fps ?? NaN)) - absoluteAt(location);
        if (Number.isFinite(frame) && Array.isArray(location.item.keyframes)
            && location.item.keyframes.some(point => point.transform)) {
            next = writeV2ItemTransformAt(next, { itemId: command.itemId, t: frame,
                patch: local as Record<string, number> });
        } else {
            next = updateTreeV2Item(next, command.itemId, {
                transform: { ...(location.item.transform ?? {}), ...local }
            });
        }
    }
    if (command.patch.crop || command.patch.perspective !== undefined) {
        next = updateTreeV2Item(next, command.itemId, {
            ...(command.patch.crop ? { crop: command.patch.crop } : {}),
            ...(command.patch.perspective !== undefined ? { perspective: command.patch.perspective } : {})
        });
    }
    return next;
}
