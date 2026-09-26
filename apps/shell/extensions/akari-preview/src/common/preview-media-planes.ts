/** GPU frames retain their source objects; only their DOM stacking planes are partitioned. */
export function partitionPreviewMediaPlanes(plan: any, summary: any): any[] {
    const tracks = Array.isArray(summary.timelineTracks) ? summary.timelineTracks : [];
    const zOfTrack = (id: unknown): number => tracks.findIndex((track: any) => track.id === id);
    const zOfItem = (id: unknown, trackId: unknown, renderTrack?: number): number =>
        Number.isInteger(summary.itemStackZ?.[String(id)]) ? summary.itemStackZ[String(id)]
            : Number.isInteger(summary.trackStackZ?.[String(trackId)]) ? summary.trackStackZ[String(trackId)]
                : Number.isInteger(renderTrack) ? renderTrack! : zOfTrack(trackId);
    const barriers = [...new Set<number>([
        ...(Array.isArray(summary.overlays) ? summary.overlays : []).map((item: any) => zOfItem(item.id, item.trackId)),
        zOfItem(undefined, summary.captionTrackId),
        ...Object.values(summary.itemStackZ ?? {}) as number[]
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
        return zOfItem(cut?.id, cut?.trackId, cut?.renderTrack);
    };
    if (plan.base.length) {
        const baseByBand = new Map<number, { band: any; indices: number[] }>();
        plan.base.forEach((cut: any, index: number) => {
            const band = bandAt(cutZ(cut.id));
            const group = baseByBand.get(band.key) ?? { band, indices: [] };
            group.indices.push(index);
            baseByBand.set(band.key, group);
        });
        for (const { band, indices } of baseByBand.values()) {
            // Keep transition pairs within one stacking band. A single upper cut uses the
            // transparent composite-layer path so its transformed exterior stays clear.
            if (band.key === 0 || indices.length > 1) {
                band.baseIndices.push(...indices);
            } else {
                const index = indices[0];
                const cut = plan.base[index];
                const visual = cut.visual;
                band.entries.push({ baseIndex: index, spec: {
                    ...cut, kind: cut.kind ?? 'video', cutVisual: visual,
                    visual: { crop: visual.layerStyle?.crop ?? { x: 0, y: 0, width: 1, height: 1 },
                        perspective: null, transform: visual.transform },
                    mask: null, blend: 'normal', opacity: visual.opacity,
                    ...(visual.adjustLut ? { adjustLut: visual.adjustLut } : {}),
                    ...(visual.adjustFx ? { adjustFx: visual.adjustFx } : {})
                } });
            }
        }
    }
    plan.layers.forEach((layer: any, index: number) => {
        const declared = summary.layers?.find((item: any) => String(item.id) === layer.id);
        const z = layer.cutVisual ? cutZ(layer.id)
            : zOfItem(declared?.id ?? layer.id, declared?.trackId, declared?.renderTrack);
        bandAt(z).entries.push({ layerIndex: index, spec: layer });
    });
    // The bottom canvas owns the black output background even in HTML-only frames.
    if (!bands.has(0)) bands.set(0, { key: 0, zIndex: -1, baseIndices: [], entries: [] });
    return [...bands.values()].sort((a, b) => a.key - b.key);
}
