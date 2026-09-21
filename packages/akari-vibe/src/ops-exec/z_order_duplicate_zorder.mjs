import { targetItem } from '../ops/_knobs.mjs';
import { editStore } from '../edit-store.mjs';
import { separateTrack } from '../exec-support/z_order_duplicate_zorder.mjs';
import { reorderTracks } from '../v2/mutations.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
export default { id: 'z_order_duplicate_zorder', apply(env, d) {
        const skip = reason => env.log.push(`z_order ${d.target} → 未適用（${reason}）`);
        const item = targetItem(env, d.target);
        if (!item || d.target?.startsWith('person_')) return skip('対象 item が無い');
        const location = editStore.locate(env.edit, item.id);
        if (location.track.lane !== 'visual' || item.role === 'bgm') return skip('音声 item に重なり順は無い');
        if (location.parent) return skip('入れ子 item の親からの分離は未対応');
        const dir = d.z_order_duplicate_dir;
        if (!['front', 'back', 'forward', 'backward', 'above_item', 'below_item'].includes(dir)) return skip('重なり順の指定が無い');
        const relative = ['above_item', 'below_item'].includes(dir);
        const ref = relative ? targetItem(env, d.z_order_duplicate_ref) : null;
        if (relative) {
            if (!ref || !d.z_order_duplicate_ref?.startsWith('item_')) return skip('基準素材が無い');
            const loc = editStore.locate(env.edit, ref.id);
            if (loc.track.lane !== 'visual' || ref.role === 'bgm') return skip('音声素材は基準にできない');
            if (loc.parent) return skip('入れ子の基準素材は未対応');
            if (ref.id === item.id) return skip('対象と基準が同じ');
        }
        let edit = structuredClone(env.edit);
        separateTrack(edit, editStore.locate(edit, item.id).track);
        if (ref) separateTrack(edit, editStore.locate(edit, ref.id).track);
        const track = editStore.locate(edit, item.id).track;
        const visual = edit.tracks.filter(t => t.lane === 'visual');
        const from = visual.indexOf(track);
        const rest = visual.filter(t => t !== track);
        const refIndex = ref ? rest.indexOf(editStore.locate(edit, ref.id).track) : -1;
        const to = dir === 'front' ? rest.length : dir === 'back' ? 0
            : dir === 'forward' ? Math.min(from + 1, rest.length)
            : dir === 'backward' ? Math.max(from - 1, 0)
            : refIndex + (dir === 'above_item' ? 1 : 0);
        if (to !== from) edit = reorderTracks(edit, { fromIndex: edit.tracks.indexOf(track), toIndex: edit.tracks.indexOf(visual[to]) });
        writeEdit(env, edit);
        env.log.push(`z_order ${item.id} → ${dir}${ref ? ` (${ref.id})` : ''}（時刻を維持）`);
    } };
