/** キャンバス内の字幕だけを親段へ上げ、外の字幕は元の字幕段に残す。 */
export function canvasCaptionZPlan(
    captions: readonly { id?: string; canvasTrackId?: string }[],
    captionTrackId: string | undefined,
    zForTrack: (id: string | undefined) => number
): { split: boolean; layerZ: number; plateZ: Map<string, number> } {
    const layerZ = zForTrack(captionTrackId);
    const split = captions.some(caption => !!caption.canvasTrackId);
    const plateZ = new Map<string, number>();
    if (split) for (const caption of captions) {
        if (!caption.id) continue;
        const ownZ = caption.canvasTrackId ? zForTrack(caption.canvasTrackId) : layerZ;
        plateZ.set(caption.id, ownZ >= 0 ? ownZ : layerZ);
    }
    return { split, layerZ, plateZ };
}
