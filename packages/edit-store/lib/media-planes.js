"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partitionPreviewMediaPlanes = partitionPreviewMediaPlanes;
/** Partition decoded media around DOM stacking barriers. Browser safe: the preview embeds this function. */
function partitionPreviewMediaPlanes(plan, summary) {
    const tracks = Array.isArray(summary.timelineTracks) ? summary.timelineTracks : [];
    const zOfTrack = (id) => tracks.findIndex((track) => track.id === id);
    const zOfItem = (id, trackId, renderTrack) => Number.isInteger(summary.itemStackZ?.[String(id)]) ? summary.itemStackZ[String(id)]
        : Number.isInteger(summary.trackStackZ?.[String(trackId)]) ? summary.trackStackZ[String(trackId)]
            : Number.isInteger(renderTrack) ? renderTrack : zOfTrack(trackId);
    const barriers = [...new Set([
            ...(Array.isArray(summary.overlays) ? summary.overlays : [])
                .map((item) => zOfItem(item.id, item.trackId, item.renderTrack)),
            zOfItem(undefined, summary.captionTrackId),
            ...Object.values(summary.itemStackZ ?? {}),
            ...(Array.isArray(summary.barrierZ) ? summary.barrierZ : []),
        ].filter(z => z >= 0))].sort((a, b) => a - b);
    const bands = new Map();
    const bandAt = (z) => {
        const key = barriers.filter(barrier => barrier < z).length;
        let band = bands.get(key);
        if (!band) {
            band = { key, zIndex: z, baseIndices: [], entries: [] };
            bands.set(key, band);
        }
        band.zIndex = Math.max(band.zIndex, z);
        return band;
    };
    const cutZ = (id) => {
        const cut = summary.cutsById?.[id] ?? summary.cuts?.[Number(id.slice('cut-'.length))];
        return zOfItem(cut?.id, cut?.trackId, cut?.renderTrack);
    };
    if (plan.base.length) {
        const baseByBand = new Map();
        plan.base.forEach((cut, index) => {
            const band = bandAt(cutZ(cut.id));
            const group = baseByBand.get(band.key) ?? { band, indices: [] };
            group.indices.push(index);
            baseByBand.set(band.key, group);
        });
        for (const { band, indices } of baseByBand.values()) {
            // Transition pairs stay together. A lone upper cut needs a transparent layer.
            if (band.key === 0 || indices.length > 1) {
                band.baseIndices.push(...indices);
            }
            else {
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
    plan.layers.forEach((layer, index) => {
        const declared = summary.layers?.find((item) => String(item.id) === layer.id);
        const z = layer.cutVisual ? cutZ(layer.id)
            : zOfItem(declared?.id ?? layer.id, declared?.trackId, declared?.renderTrack);
        bandAt(z).entries.push({ layerIndex: index, spec: layer });
    });
    if (!bands.has(0))
        bands.set(0, { key: 0, zIndex: -1, baseIndices: [], entries: [] });
    return [...bands.values()].sort((a, b) => a.key - b.key);
}
