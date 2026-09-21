import { targetItem } from '../ops/_knobs.mjs';
import { editStore } from '../edit-store.mjs';
import { view } from '../v2/model.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export const vocabulary = editStore.TRANSITION_VOCABULARY;
export function unapplied(env, op, reason) {
    env.log.push(`${op} → 未適用（${reason}）`);
}
export function guardedApply(env, op, action) {
    try { action(); } catch (error) { unapplied(env, op, error.message); }
}
export function visualTarget(env, d, mediaOnly = false) {
    const item = targetItem(env, d.target);
    if (!item) throw new Error('対象 item が無い');
    const location = editStore.locate(env.edit, item.id);
    if (location.track.lane !== 'visual') throw new Error('音声は対象外');
    if (mediaOnly && item.source.kind !== 'media') throw new Error('映像カット以外は対象外');
    return { item, location };
}
