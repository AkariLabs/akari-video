import { videoTarget } from '../exec-support/look_fx_brightness_look.mjs';
import { applyAdjust } from '../exec-support/look_fx_brightness_look.mjs';
export default { id: 'look_fx_brightness_brightness', apply(env, d) {
        const item = videoTarget(env, d);
        if (!item) return;
        const action = d.w15_brightness_action;
        if (!['brighter', 'darker', 'reset'].includes(action)) {
            env.log.push('brightness → 未適用（明るさの方向が未指定・未対応）');
            return;
        }
        const adjust = structuredClone(item.adjust ?? {});
        if (action !== 'reset' && adjust.sections?.basic === false) {
            env.log.push('brightness → 未適用（basic が無効。再有効化すると露出以外の色調整も復帰するため）');
            return;
        }
        if (d.amount != null && !Number.isFinite(d.amount)) {
            env.log.push('brightness → 未適用（amount が有限数でない）');
            return;
        }
        const level = Math.max(0, Math.min(2, Math.round(d.amount ?? 1)));
        const old = adjust.basic?.exposure ?? 0;
        const exposure = action === 'reset' ? 0
            : Math.max(-3, Math.min(3, Number((old + [0.15, 0.3, 0.6][level] * (action === 'brighter' ? 1 : -1)).toFixed(6))));
        adjust.basic = { ...adjust.basic, exposure };
        applyAdjust(env, item, adjust, `brightness ${action} exposure=${exposure}`);
    } };
