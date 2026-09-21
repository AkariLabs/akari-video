import { guardedApply } from '../exec-support/cut_look_transition.mjs';
import { visualTarget } from '../exec-support/cut_look_transition.mjs';
import { knobs } from '../ops/_knobs.mjs';
export default { id: 'cut_look_opacity', apply(env, d) {
        guardedApply(env, d.op, () => {
            const { item } = visualTarget(env, d);
            const opacity = d.cutLookOpacity;
            if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('不透明度は0〜100%か半透明で指定が必要');
            knobs(env, item, { opacity });
            env.log.push(`opacity ${item.id} → ${opacity}`);
        });
    } };
