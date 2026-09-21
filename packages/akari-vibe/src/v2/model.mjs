import { editStore, keyOf } from '../edit-store.mjs';
export function view(edit) {
    const internal = editStore.readInternalEdit(edit);
    const legacy = editStore.projectLegacyEdit(internal);
    const segments = editStore.computeCutTrackSegments(legacy.cuts);
    const locations = editStore.allLocations(edit);
    const cutItems = [...editStore.walkItems(internal)].filter(i => i.legacy.collection === 'cuts').sort((a,b) => a.legacy.index - b.legacy.index);
    const cuts = legacy.cuts.map((cut, i) => {
        const location = locations.find(({ item }) => item.id === cutItems[i]?.id);
        if (!location) throw new Error(`Projected cut has no item: ${cut.id}`);
        return { ...segments[i], itemId: location.item.id, raw: location.item, source: cut };
    });
    return { internal, segments: cuts, locations };
}
export const itemForKey = (edit, key) => editStore.allLocations(edit).find(({ item }) => keyOf(`item:${item.id}`) === key)?.item;
