export const AKARI_MATERIAL_SELECTED_EVENT = 'akari.material.selected';

export interface AkariMaterialSelection {
    kind: 'material';
    projectRoot: string;
    relativePath: string;
    mediaKind: 'image' | 'video' | 'audio' | 'other';
    name: string;
}

export function materialSelectionFromDetail(detail: unknown): AkariMaterialSelection | undefined {
    if (!detail || typeof detail !== 'object') return undefined;
    const value = detail as Record<string, unknown>;
    if (typeof value.projectRoot !== 'string' || !value.projectRoot
        || typeof value.relativePath !== 'string' || !value.relativePath
        || typeof value.name !== 'string' || !value.name
        || !['image', 'video', 'audio', 'other'].includes(String(value.kind))) return undefined;
    return { kind: 'material', projectRoot: value.projectRoot, relativePath: value.relativePath,
        mediaKind: value.kind as AkariMaterialSelection['mediaKind'], name: value.name };
}
