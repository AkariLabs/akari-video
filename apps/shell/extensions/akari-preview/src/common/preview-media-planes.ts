/** GPU frames retain their source objects; only their DOM stacking planes are partitioned. */
export function partitionPreviewMediaPlanes(plan: any, summary: any): any[] {
    const tracks = Array.isArray(summary.timelineTracks) ? summary.timelineTracks : [];
    const zOfTrack = (id: unknown): number => tracks.findIndex((track: any) => track.id === id);
    const barriers = [...new Set<number>([
        ...(Array.isArray(summary.overlays) ? summary.overlays : []).map((item: any) => zOfTrack(item.trackId)),
        zOfTrack(summary.captionTrackId)
    ].filter(z => z >= 0))].sort((a, b) => a - b);
    const bands = new Map<number, any>();
    const bandAt = (z: number): any => {
        const key = barriers.filter(barrier => barrier < z).length;
        let band = bands.get(key);
        if (!band) {
            band = { key, zIndex: z, baseIndices: [], entries: [] };
            bands.set(key, band);
        }
        band.zIndex = Math.max(band.zIndex, z);
        return band;
    };
    const cutZ = (id: string): number => {
        const cut = summary.cuts?.[Number(id.slice('cut-'.length))];
        return Number.isInteger(cut?.renderTrack) ? cut.renderTrack : zOfTrack(cut?.trackId);
    };
    if (plan.base.length) {
        // Keep transition pairs together. A normal cut in an upper plane must retain transparency
        // outside its transformed box, so send it through the existing composite-layer path.
        const band = bandAt(Math.max(...plan.base.map((cut: any) => cutZ(cut.id))));
        if (band.key === 0 || plan.base.length > 1) {
            band.baseIndices = plan.base.map((_cut: any, index: number) => index);
        } else {
            plan.base.forEach((cut: any, index: number) => {
                const visual = cut.visual;
                band.entries.push({ baseIndex: index, spec: {
                    ...cut, kind: cut.kind ?? 'video', cutVisual: visual,
                    visual: { crop: visual.layerStyle?.crop ?? { x: 0, y: 0, width: 1, height: 1 },
                        perspective: null, transform: visual.transform },
                    mask: null, blend: 'normal', opacity: visual.opacity,
                    ...(visual.adjustLut ? { adjustLut: visual.adjustLut } : {}),
                    ...(visual.adjustFx ? { adjustFx: visual.adjustFx } : {})
                } });
            });
        }
    }
    plan.layers.forEach((layer: any, index: number) => {
        const declared = summary.layers?.find((item: any) => String(item.id) === layer.id);
        const z = layer.cutVisual ? cutZ(layer.id)
            : Number.isInteger(declared?.renderTrack) ? declared.renderTrack : zOfTrack(declared?.trackId);
        bandAt(z).entries.push({ layerIndex: index, spec: layer });
    });
    // The bottom canvas owns the black output background even in HTML-only frames.
    if (!bands.has(0)) bands.set(0, { key: 0, zIndex: -1, baseIndices: [], entries: [] });
    return [...bands.values()].sort((a, b) => a.key - b.key);
}
