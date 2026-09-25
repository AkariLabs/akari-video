export function nextPhotoBrushItem(activeId: string | null, clickedId: string): string | null {
    return activeId === clickedId ? null : clickedId;
}
