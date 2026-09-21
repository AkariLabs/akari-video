import { guardedApply } from '../exec-support/cut_look_transition.mjs';
import { visualTarget } from '../exec-support/cut_look_transition.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export default { id: 'cut_look_transition_remove', apply(env, d) {
        guardedApply(env, d.op, () => {
            const { item } = visualTarget(env, d, true);
            if (item.source.transition_out == null) {
                env.log.push(`transition_remove ${item.id} → つなぎ設定なし（変更なし）`);
                return;
            }
            patchItem(env, item.id, { source: { transition_out: null } });
            env.log.push(`transition_remove ${item.id} → つなぎ解除`);
        });
    } };
