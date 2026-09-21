import { entries } from '../exec-support/selective_undo_checkpoint_undo.mjs';
import { ENTRY } from '../exec-support/selective_undo_checkpoint_undo.mjs';
import { record } from '../exec-support/selective_undo_checkpoint_undo.mjs';
import { itemForKey } from '../v2/model.mjs';
import { partialBefore } from '../exec-support/selective_undo_checkpoint_undo.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export default { id: 'selective_undo_checkpoint_undo', apply(env, d) {
        const skip = reason => env.log.push(`selective_undo → 未適用（${reason}）`);
        const matches = entries(env.ctx, 'history').filter(h => `hist_${h.id}` === d[ENTRY]);
        if (matches.length !== 1) return skip('履歴を一意に特定できない');
        const entry = matches[0];
        if (!record(entry.before) || !Object.keys(entry.before).length) return skip('変更前の部分オブジェクト before が無い');
        const item = itemForKey(env.edit, entry.target);
        if (!item) return skip('履歴の対象 item が無い');
        if (['id', 'items'].some(key => Object.hasOwn(entry.before, key))) return skip('対象ID・子要素の復元は未対応');
        try {
            const patch = Object.fromEntries(Object.entries(entry.before).map(([key, value]) => [key, record(value) ? partialBefore(item[key], value) : structuredClone(value)]));
            patchItem(env, item.id, patch); // writeEdit validates readEditV2 before committing env.
            env.log.push(`selective_undo ${entry.id} → ${item.id} の変更前の部分を復元`);
        } catch (error) { skip(`before の適用・v2検証に失敗: ${error.message}`); }
    } };
