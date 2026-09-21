import { targetItem } from '../ops/_knobs.mjs';
import { view } from '../v2/model.mjs';
import trimCut from '../ops-exec/trim_cut.mjs';
import { framesToSeconds } from '../ops/_knobs.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { knobs } from '../ops/_knobs.mjs';
export const levelOf = d => Math.max(0, Math.min(2, Math.round(d.amount ?? 1)));
export const unapplied = (env, d, reason) => env.log.push(`${d.op} ${d.target ?? 'none'} → 未適用（${reason}）`);
export function visualTarget(env, d) {
    const item = targetItem(env, d.target);
    if (!item) { unapplied(env, d, '対象itemがない'); return null; }
    const location = view(env.edit).locations.find(l => l.item.id === item.id);
    if (location?.track?.lane !== 'visual') { unapplied(env, d, '画面素材ではない'); return null; }
    return item;
}
