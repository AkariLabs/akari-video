import { view } from '../v2/model.mjs';
import { keyOf } from '../edit-store.mjs';
import { editStore } from '../edit-store.mjs';
export function inventory(edit) {
    const { segments, locations } = view(edit);
    const cutIds = new Set(segments.map(s => s.itemId));
    return [
        ...segments.map(s => ({ key: `cut_${s.index + 1}`, selection: `cut:${s.index + 1}`, kind: 'cut', n: s.index + 1 })),
        ...locations.filter(l => !cutIds.has(l.item.id)).map(({ item, track }) => ({
            key: keyOf(`item:${item.id}`), selection: `item:${item.id}`,
            kind: track.lane === 'audio' ? 'audio' : item.source?.kind === 'telop' ? 'telop' : 'other',
        })),
    ];
}
