// Public main shell/common/edit-v2-mutations.ts semantics; no corresponding edit-store lib API.
import { editStore } from '../edit-store.mjs';
export function splitItem(doc, { itemId, atFrames }) {
    if (!Number.isInteger(atFrames)) throw new Error('分割位置は整数フレーム');
    const edit = structuredClone(doc), found = editStore.locate(edit, itemId);
    if (!found) throw new Error(`Unknown item: ${itemId}`);
    const offset = atFrames - found.item.at, duration = found.item.duration;
    if (offset <= 0 || offset >= duration) throw new Error('分割位置はクリップの内側に置いてください。');
    const first = structuredClone(found.item), second = structuredClone(found.item);
    first.duration = offset; second.at = atFrames; second.duration = duration - offset;
    let n = 1; while (editStore.locate(edit, `${itemId}-split-${n}`)) n++;
    second.id = `${itemId}-split-${n}`;
    if (first.source.kind === 'media') {
        const boundary = first.source.in + (first.source.out - first.source.in) * offset / duration;
        first.source.out = boundary; second.source.in = boundary;
    }
    found.items.splice(found.index, 1, first, second); return edit;
}
export function rippleRemoveItem(doc, itemId) {
    const edit = structuredClone(doc), found = editStore.locate(edit, itemId);
    if (!found) throw new Error(`Unknown item: ${itemId}`);
    const end = found.item.at + found.item.duration, duration = found.item.duration;
    // Same-track ripple: overlays/telops in other tracks retain absolute time.
    for (const item of found.items) if (item.id !== itemId && item.at >= end) item.at -= duration;
    editStore.removeItem(edit, itemId); return edit;
}
export function reorderTracks(doc, { fromIndex, toIndex }) {
    const edit = structuredClone(doc);
    for (const index of [fromIndex,toIndex]) if (!Number.isInteger(index) || index < 0 || index >= edit.tracks.length) throw new Error('トラックの並べ替え位置が範囲外です。');
    if (edit.tracks[fromIndex].lane !== edit.tracks[toIndex].lane) throw new Error('音と映像のレーンをまたいでトラックを並べ替えることはできません。');
    const [track] = edit.tracks.splice(fromIndex,1); edit.tracks.splice(toIndex,0,track); return edit;
}
