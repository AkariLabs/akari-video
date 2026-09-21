import { applyRepeatedTimes } from '../exec-support/repeat.mjs';
import { targets } from '../ops/_helpers.mjs';
import { SCALE_STEP } from '../ops/_helpers.mjs';
import { targetItem } from '../ops/_knobs.mjs';
import { knobs } from '../ops/_knobs.mjs';
export default { id: 'scale', apply(env, d) {
        if (applyRepeatedTimes(env, d)) return;
        const { cap, level, rewriteCaption } = targets(env,d);
        const explicit = d.percent != null ? d.percent / 100 : d.multiplier;
        if (explicit != null && (!Number.isFinite(explicit) || explicit <= 0)) { env.log.push(`scale ${d.target ?? 'none'} → 未適用（倍率が不正）`); return; }
        const f = explicit ?? (d.direction === 'smaller' ? 1/SCALE_STEP[level] : SCALE_STEP[level]);
        if (cap) {
            const current = (cap.textStyle?.sizePx ?? 72) / 72;
            const scale = explicit != null ? (d.multiplierRelative ? current * explicit : explicit) : current * f;
            if (!Number.isFinite(scale) || scale <= 0 || scale > 20) { env.log.push(`scale ${d.target ?? 'none'} → 未適用（結果の倍率が0以下または20倍超）`); return; }
            const sizePx = Math.round(72 * scale);
            rewriteCaption(cap,{textStyle:{sizePx}}); return;
        }
        const item = targetItem(env,d.target);
        const current = item?.transform?.scale ?? 1;
        const scale = Number((explicit != null ? (d.multiplierRelative ? current * explicit : explicit) : current * f).toFixed(4));
        if (!Number.isFinite(scale) || scale <= 0 || scale > 20) { env.log.push(`scale ${d.target ?? 'none'} → 未適用（結果の倍率が0以下または20倍超）`); return; }
        if (knobs(env,item,{transform:{scale}})) env.log.push(`scale ${item.id} → ${scale}${explicit == null ? `（×${f.toFixed(3)}）` : ''}`);
    } };
