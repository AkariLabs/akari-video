import { view } from '../v2/model.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
export function applyReorder(env, d) {
    const skip = reason => env.log.push(`${d.op} → 未適用（${reason}）`);
    const segments = view(env.edit).segments;
    const find = key => segments.find(s => key === `cut_${s.index + 1}`);
    const subject = find(d.reorder_subject), anchor = find(d.reorder_anchor);
    if (!subject || !anchor) return skip('動かすカットまたは基準カットを解決できない');
    if (subject.itemId === anchor.itemId) return skip('動かすカットと基準が同じ');
    const swap = d.op === 'reorder_cuts_swap';
    if (!swap && !['before', 'after'].includes(d.reorder_side)) return skip('前後を解決できない');

    const edit = structuredClone(env.edit);
    const locations = segments.map(s => env.editStore.locate(edit, s.itemId));
    const track = locations[0]?.track;
    if (!track || locations.some(l => !l || l.parent || l.track !== track) ||
        track.items.length !== locations.length) return skip('単一本編トラックの直下カットのみ対応');
    const ordered = locations.map(l => l.item).sort((a, b) => a.at - b.at);
    const from = ordered.findIndex(i => i.id === subject.itemId);
    const to = ordered.findIndex(i => i.id === anchor.itemId);
    if (swap) [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    else {
        const [item] = ordered.splice(from, 1);
        const position = ordered.findIndex(i => i.id === anchor.itemId) + (d.reorder_side === 'after' ? 1 : 0);
        ordered.splice(position, 0, item);
    }
    // Frame-native repacking. Preserve item identity, source seconds and all other fields.
    let at = 0;
    for (const item of ordered) { item.at = at; at += item.duration; }
    // Legacy projection assigns cut numbers in item-array order.
    track.items = ordered;
    writeEdit(env, edit);
    env.log.push(`${d.op} ${subject.itemId} / ${anchor.itemId} → ${ordered.map(i => i.id).join(', ')}（本編を0フレームから詰め直し）`);
}
