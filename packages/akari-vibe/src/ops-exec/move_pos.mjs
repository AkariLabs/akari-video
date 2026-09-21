import { applyRepeatedTimes } from '../exec-support/repeat.mjs';
import { targets } from '../ops/_helpers.mjs';
import { DIRECTIONS } from '../exec-support/move_pos.mjs';
import { NUDGE_RATIOS } from '../exec-support/move_pos.mjs';
import { targetItem } from '../ops/_knobs.mjs';
import { knobs } from '../ops/_knobs.mjs';
import { DEFAULT_ITEM_BOX } from '../exec-support/move_pos.mjs';
import { clampNudgedTransform } from '../ops/_knobs.mjs';
import { textPosition } from '../ops/_helpers.mjs';
import { positionTransform } from '../ops/_knobs.mjs';
export default { id: 'move_pos', apply(env, d) {
        if (applyRepeatedTimes(env, d)) return;
        const { cap, rewriteCaption } = targets(env,d);
        // Decisions saved before Wave 2f have no kind and keep the old grid behavior.
        const kind = d.move_pos_kind ?? 'place';
        if (kind === 'nudge') {
            const vector = DIRECTIONS[d.move_pos_direction];
            if (!vector) { env.log.push(`move_pos ${d.target ?? 'none'} → 未適用（相対移動の向きが不明）`); return; }
            const level = Math.max(0, Math.min(2, Math.round(d.amount ?? 1)));
            const pixels = d.pixels ?? d.bareNumber;
            const dx = vector[0] * (pixels ?? env.edit.output.width * (d.percent != null ? d.percent / 100 : NUDGE_RATIOS[level]));
            const dy = vector[1] * (pixels ?? env.edit.output.height * (d.percent != null ? d.percent / 100 : NUDGE_RATIOS[level]));
            if (cap) {
                const current = cap.textStyle?.position ?? { x: .5, y: .5 };
                const position = { x: Math.max(0, Math.min(1, current.x + dx / env.edit.output.width)), y: Math.max(0, Math.min(1, current.y + dy / env.edit.output.height)) };
                rewriteCaption(cap, { textStyle: { position } });
                env.log.push(`move_pos ${cap.id} nudge ${d.move_pos_direction} → x ${Math.round(dx)}px, y ${Math.round(dy)}px`);
                return;
            }
            const item = targetItem(env,d.target);
            if (!item) { knobs(env, item, {}); return; }
            const current = { x: item.transform?.x ?? 0, y: item.transform?.y ?? 0 };
            const isCut = env.segments.some(segment => segment.itemId === item.id);
            const box = env.context.layout?.[`item:${item.id}`]?.box ?? (isCut ? [0, 0, 1, 1] : DEFAULT_ITEM_BOX);
            const bounded = clampNudgedTransform(env.edit, item, { x: current.x + dx, y: current.y + dy }, box);
            if (knobs(env,item,{transform:bounded.transform})) {
                env.log.push(`move_pos ${item.id} nudge ${d.move_pos_direction} → x ${bounded.transform.x}px, y ${bounded.transform.y}px${bounded.stopped ? '（画面端で停止）' : ''}`);
            }
            return;
        }
        const { pos, why } = textPosition(d,env.ctx,env.context,env.persons);
        if (cap) { rewriteCaption(cap,{textStyle:{position:{x:pos[0],y:pos[1]}}}); return; }
        const item = targetItem(env,d.target);
        const transform = positionTransform(env.edit,pos,env.context.layout?.[`item:${item?.id}`]?.box);
        if (knobs(env,item,{transform})) env.log.push(`move_pos ${item.id} → ${why}（x ${transform.x}px, y ${transform.y}px）`);
    } };
