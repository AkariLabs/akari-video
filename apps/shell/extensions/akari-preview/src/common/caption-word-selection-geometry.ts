export interface CaptionSelectionRect { left: number; right: number; top: number; bottom: number; width: number; height: number }

export function captionWordSelectionBoxes(rects: readonly CaptionSelectionRect[], vertical = false): CaptionSelectionRect[] {
    const valid = rects.filter(rect => Number.isFinite(rect.left) && Number.isFinite(rect.right)
        && Number.isFinite(rect.top) && Number.isFinite(rect.bottom)
        && rect.width > 0 && rect.height > 0).sort((a, b) => vertical
        ? a.left - b.left || a.top - b.top : a.top - b.top || a.left - b.left);
    const boxes: CaptionSelectionRect[] = [];
    for (const rect of valid) {
        const sameLine = (box: CaptionSelectionRect): boolean => vertical
            ? Math.min(box.right, rect.right) - Math.max(box.left, rect.left)
                >= Math.min(box.width, rect.width) * 0.5
            : Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top)
                >= Math.min(box.height, rect.height) * 0.5;
        const box = boxes.find(sameLine);
        if (!box) {
            boxes.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                width: rect.width, height: rect.height });
        } else {
            box.left = Math.min(box.left, rect.left);
            box.right = Math.max(box.right, rect.right);
            box.top = Math.min(box.top, rect.top);
            box.bottom = Math.max(box.bottom, rect.bottom);
            box.width = box.right - box.left;
            box.height = box.bottom - box.top;
        }
    }
    return boxes;
}
