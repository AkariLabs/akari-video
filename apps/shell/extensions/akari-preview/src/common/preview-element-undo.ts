export function previewElementUndoKind(style: Record<string, unknown> | undefined): 'move' | 'size' | 'rotate' {
    if (style && ('width' in style || 'height' in style)) return 'size';
    if (style && 'rotate' in style) return 'rotate';
    return 'move';
}
