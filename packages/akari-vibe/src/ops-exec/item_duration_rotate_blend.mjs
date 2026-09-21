import { visualTarget } from '../exec-support/item_duration_rotate_duration.mjs';
import { unapplied } from '../exec-support/item_duration_rotate_duration.mjs';
import { knobs } from '../ops/_knobs.mjs';
export default { id: 'item_blend', apply(env, d) {
        const item = visualTarget(env, d);
        if (!item) return;
        if (!['normal', 'screen', 'multiply'].includes(d.item_blend_mode)) { unapplied(env, d, '合成モードが未対応'); return; }
        if (knobs(env, item, { blend: d.item_blend_mode })) env.log.push(`item_blend ${item.id} → ${d.item_blend_mode}`);
    } };
