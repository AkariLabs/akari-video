import { applyRepeatedTimes } from '../exec-support/repeat.mjs';
import { visualTarget } from '../exec-support/item_duration_rotate_duration.mjs';
import { unapplied } from '../exec-support/item_duration_rotate_duration.mjs';
import { levelOf } from '../exec-support/item_duration_rotate_duration.mjs';
import { knobs } from '../ops/_knobs.mjs';
export default { id: 'item_rotate', apply(env, d) {
        if (applyRepeatedTimes(env, d)) return;
        const item = visualTarget(env, d);
        if (!item) return;
        if (!['none', 'clockwise', 'counterclockwise'].includes(d.item_rotate_direction)) { unapplied(env, d, '回転の向きが不明'); return; }
        const degrees = d.degrees ?? d.bareNumber ?? [5, 15, 30][levelOf(d)];
        if (!Number.isFinite(degrees)) { unapplied(env, d, '角度が不正'); return; }
        const rotate = (item.transform?.rotate ?? 0) + degrees * (d.item_rotate_direction === 'counterclockwise' ? -1 : 1);
        if (knobs(env, item, { transform: { rotate } })) env.log.push(`item_rotate ${item.id} → ${rotate}度（向き未指定は時計回り）`);
    } };
