export function previewOverlayKind(payload: { kind?: string; category?: string; key?: string } | undefined):
    'overlay' | 'scene3d' | undefined {
    if (!payload?.key) return undefined;
    if (payload.kind === 'overlay' && payload.category === 'overlay') return 'overlay';
    if (payload.kind === 'scene3d' && payload.category === 'scene3d') return 'scene3d';
    return undefined;
}
