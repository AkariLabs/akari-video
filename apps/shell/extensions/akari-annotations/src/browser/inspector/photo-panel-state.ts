export interface PanelRegion { id: string; name?: string; [key: string]: unknown }

export function regionDisplayName(region: PanelRegion, index: number): string {
    return typeof region.name === 'string' && region.name.trim()
        ? region.name.trim() : region.id.startsWith('background-') ? '背景' : `エリア ${index + 1}`;
}

export function appendAdoptedRegion(regions: readonly PanelRegion[], region: PanelRegion): {
    regions: PanelRegion[]; selectedIndex: number;
} {
    return { regions: [...regions, region], selectedIndex: regions.length };
}

export function togglePhotoCandidateSelection(selected: ReadonlySet<string>, id: string): Set<string> {
    const next = new Set(selected);
    if (next.has(id)) { next.delete(id); return next; }
    if (id.endsWith('--all')) next.clear();
    else for (const value of next) if (value.endsWith('--all')) next.delete(value);
    next.add(id);
    return next;
}

/** Region masks preserve the foreground pixels; only the region declaration reverses their scope. */
export function photoAdoptionPolarity(target: 'cutout' | 'region', background: boolean): {
    compositeInvert: boolean; regionInvert: boolean;
} {
    return { compositeInvert: target === 'cutout' && background, regionInvert: target === 'region' && background };
}

/** The patch written by the photo inspector uses the committed foreground mask once. */
export function buildAdoptedPhotoRegion(
    hash: string, maskRef: string, existingRegions: readonly PanelRegion[], background: boolean, name?: string
): PanelRegion & { maskRef: string; enabled: true; invert?: true } {
    const base = `${background ? 'background' : 'region'}-${hash.slice(0, 12)}`;
    let id = base;
    for (let suffix = 2; existingRegions.some(region => region.id === id); suffix += 1) id = `${base}-${suffix}`;
    return { id, name: background ? '背景' : name?.trim() || 'エリア', maskRef,
        ...(photoAdoptionPolarity('region', background).regionInvert ? { invert: true as const } : {}), enabled: true };
}

export function photoPanelPlacement(
    viewport: { width: number; height: number },
    inspector?: { left: number; top: number; width: number }
): { left: number; top: number; width: number } {
    const width = inspector ? Math.max(1, inspector.width - 12) : Math.min(360, viewport.width - 16);
    return { width, left: inspector ? inspector.left + 6 : viewport.width - width - 8,
        top: Math.max(52, Math.min(viewport.height - 100, (inspector?.top ?? 48) + 44)) };
}
