import { visualTarget } from '../exec-support/item_duration_rotate_duration.mjs';
import { unapplied } from '../exec-support/item_duration_rotate_duration.mjs';
import { levelOf } from '../exec-support/item_duration_rotate_duration.mjs';
import { knobs } from '../ops/_knobs.mjs';
export default { id: 'item_opacity', apply(env, d) {
        const item = visualTarget(env, d);
        if (!item) return;
        const percent = d.percent ?? d.bareNumber;
        if (!['decrease', 'increase', 'set'].includes(d.item_opacity_direction)) { unapplied(env, d, '不透明度の変更方法が不明'); return; }
        if (d.item_opacity_direction === 'set' && !Number.isFinite(percent)) { unapplied(env, d, '百分率を抽出できない'); return; }
        if (percent != null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) { unapplied(env, d, '百分率が0〜100の範囲外'); return; }
        const delta = percent == null ? [0.1, 0.25, 0.5][levelOf(d)] : percent / 100;
        const opacity = Number(Math.max(0, Math.min(1, d.item_opacity_direction === 'set' ? delta
            : (item.opacity ?? 1) + delta * (d.item_opacity_direction === 'decrease' ? -1 : 1))).toFixed(6));
        if (knobs(env, item, { opacity })) env.log.push(`item_opacity ${item.id} → ${opacity}`);
    } };
