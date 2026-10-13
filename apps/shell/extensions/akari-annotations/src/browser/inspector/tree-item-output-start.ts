import { absoluteAt, locate, type EditableEditV2 } from '@akari-video/edit-store';

/** タイムライン行がない選択でも、親グループを含む出力上の開始秒を返す。 */
export function treeItemOutputStart(
    edit: Record<string, unknown>, itemId: string, fallbackAt: number, fps: number
): number {
    const location = locate(edit as EditableEditV2, itemId);
    return (location ? absoluteAt(location) : fallbackAt) / fps;
}
