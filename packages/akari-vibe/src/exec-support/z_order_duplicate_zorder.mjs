import { targetItem } from '../ops/_knobs.mjs';
import { editStore } from '../edit-store.mjs';
import { reorderTracks } from '../v2/mutations.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
export function separateTrack(edit, track) {
    const items = [...track.items];
    let previous = track;
    for (const item of items.slice(1)) {
        const next = editStore.createTrackAbove(edit, previous);
        for (const key of ['name', 'muted']) if (track[key] !== undefined) next[key] = track[key];
        editStore.moveItem(edit, item.id, { track: next.id });
        previous = next;
    }
}
