import { EditV2Document } from '../common/edit-v2-mutations';
import { planSlotDrop, swapPlannedSlot } from '../common/material-replacement';

export async function handlePlannedSlotDrop(options: {
    doc: EditV2Document | undefined; slotId?: string; kind: 'video' | 'image' | 'audio';
    relativePath: string; actualDurationS: number; label: string; mismatch: string; tooShort: string;
    warn(message: string): void;
    commit(label: string, mutate: (doc: EditV2Document) => EditV2Document): Promise<unknown>;
}): Promise<boolean> {
    if (!options.doc || !options.slotId) return false;
    const decision = planSlotDrop(options.doc, options.slotId, options.kind);
    if (decision.action === 'reject') { options.warn(options.mismatch); return true; }
    if (decision.action !== 'swap' || options.kind === 'audio') return false;
    let short = false;
    await options.commit(options.label, doc => {
        const result = swapPlannedSlot(doc, { slotId: options.slotId!, relativePath: options.relativePath,
            kind: options.kind as 'video' | 'image', actualDurationS: options.actualDurationS });
        short = result.short;
        return result.doc;
    });
    if (short) options.warn(options.tooShort);
    return true;
}
