import { targetItem } from '../ops/_knobs.mjs';
import { editStore } from '../edit-store.mjs';
import { framesToSeconds } from '../ops/_knobs.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
export default { id: 'z_order_duplicate_copy', apply(env, d) {
        const skip = reason => env.log.push(`copy ${d.target} → 未適用（${reason}）`);
        const item = targetItem(env, d.target);
        if (!item || d.target?.startsWith('person_')) return skip('複製対象 item が無い');
        const location = editStore.locate(env.edit, item.id);
        if (location.parent || item.items || item.source?.kind === 'group') return skip('入れ子・グループの複製は未対応');
        if (item.anchor) return skip('アンカー付き item の複製先の再関連付けは未対応');
        const dest = d.move_dest ?? 'none';
        const duration = framesToSeconds(env.edit, item.duration);
        const n = Number(dest.match(/^cut_(\d+)$/)?.[1]);
        // Same absolute-time rules as move_time; none explicitly keeps the source at.
        const at = dest === 'none' ? framesToSeconds(env.edit, item.at)
            : dest === 'here' ? env.playheadT : dest === 'start' ? 0
            : dest === 'end' ? (env.segments.at(-1)?.end ?? 0) - duration
            : dest === 'time_spoken' ? d.seconds
            : n ? env.segments.find(s => s.index + 1 === n)?.at : undefined;
        if (!Number.isFinite(at)) return skip('複製先の時刻・カットを解決できない');
        const edit = structuredClone(env.edit), copy = structuredClone(item);
        const ids = new Set([...edit.tracks.map(t => t.id), ...editStore.allLocations(edit).map(l => l.item.id)]);
        let serial = 1;
        while (ids.has(`${item.id}-copy-${serial}`)) serial++;
        copy.id = `${item.id}-copy-${serial}`;
        copy.at = dest === 'none' ? item.at : secondsToFrames(edit, Math.max(0, at));
        // insertItem creates an adjacent track on overlap; retain the source track's mute/name.
        editStore.insertItem(edit, location.track.id, copy);
        const insertedTrack = editStore.locate(edit, copy.id).track;
        if (insertedTrack.id !== location.track.id) {
            for (const key of ['name', 'muted']) if (location.track[key] !== undefined) insertedTrack[key] = location.track[key];
        }
        writeEdit(env, edit);
        env.selection = `item:${copy.id}`;
        env.log.push(`copy ${item.id} → ${copy.id} (${framesToSeconds(edit, copy.at)}秒)`);
    } };
