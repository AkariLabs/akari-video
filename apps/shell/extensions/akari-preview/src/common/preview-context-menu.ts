export interface PreviewContextMenuRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export function previewGroupMenuVisible(
    context: { source?: string; selectedIds?: readonly string[]; selectionKind?: string;
        selectedNodeKind?: string; scopeNodeKind?: string } | undefined,
    kind: 'group' | 'ungroup'
): boolean {
    if (context?.source !== 'akari-output-preview' || !Array.isArray(context.selectedIds)) return false;
    return kind === 'group'
        ? context.selectionKind === 'multi' && context.selectedIds.length >= 2
            && context.scopeNodeKind !== 'bag' && !context.selectedIds.some(id => id.includes('#'))
        : context.selectionKind === 'group' && context.selectedNodeKind === 'group'
            && context.selectedIds.length === 1;
}

export interface PreviewContextMenuMessage {
    type: 'akari-preview-context-menu';
    x: number;
    y: number;
    timelineT: number;
    selectedPrimary?: string;
    selectedIds?: string[];
    selectionKind?: 'leaf' | 'group' | 'multi';
    selectedNodeKind?: 'leaf' | 'group' | 'bag';
    scopeNodeKind?: 'leaf' | 'group' | 'bag';
    scopeId?: string | null;
}

export function buildPreviewContextMenuMessage(
    clientX: number,
    clientY: number,
    rect: PreviewContextMenuRect,
    timelineT: number,
    selectedPrimary?: string,
    selection?: { selectedIds: readonly string[]; selectionKind: 'leaf' | 'group' | 'multi';
        selectedNodeKind?: 'leaf' | 'group' | 'bag'; scopeNodeKind?: 'leaf' | 'group' | 'bag';
        scopeId: string | null }
): PreviewContextMenuMessage {
    const normalize = (value: number, origin: number, size: number): number => {
        if (!Number.isFinite(value) || !Number.isFinite(origin) || !Number.isFinite(size) || size <= 0) {
            return 0;
        }
        return Math.max(0, Math.min(1, (value - origin) / size));
    };
    return {
        type: 'akari-preview-context-menu',
        x: normalize(clientX, rect.left, rect.width),
        y: normalize(clientY, rect.top, rect.height),
        timelineT: Number.isFinite(timelineT) ? Math.max(0, timelineT) : 0,
        ...(selection ? { selectedIds: [...selection.selectedIds], selectionKind: selection.selectionKind,
            ...(selection.selectedNodeKind ? { selectedNodeKind: selection.selectedNodeKind } : {}),
            ...(selection.scopeNodeKind ? { scopeNodeKind: selection.scopeNodeKind } : {}),
            scopeId: selection.scopeId } : {}),
        ...(typeof selectedPrimary === 'string' && selectedPrimary
            ? { selectedPrimary }
            : {})
    };
}
