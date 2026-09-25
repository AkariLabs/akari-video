import type { ProjectItemV2 } from '@akari-video/edit-store';
import type { EditV2Document } from '../common/edit-v2-mutations';
import { insertTreeV2ItemIntoCanvas } from '../common/edit-v2-mutations';
import { canvasAtFrame, canvasDropDuration, canvasDropTargets } from './canvas-drop-target';

/** プレビューから落とした図形だけ、時刻の合うキャンバスの子として置く。 */
export function placePreviewShapeInCanvas(doc: EditV2Document, item: Record<string, unknown>,
    canvasAware: boolean, outsideCanvas: boolean): EditV2Document | undefined {
    if (!canvasAware || outsideCanvas) return undefined;
    const tracks = Array.isArray(doc.tracks) ? doc.tracks as Record<string, unknown>[] : [];
    const canvas = canvasAtFrame(canvasDropTargets(tracks), item.at as number);
    if (!canvas) return undefined;
    const child = { ...item, duration: canvasDropDuration(item.at as number, item.duration as number, canvas) };
    return insertTreeV2ItemIntoCanvas(doc, child as unknown as ProjectItemV2, canvas.id).document;
}
