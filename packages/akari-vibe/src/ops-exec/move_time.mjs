import captionShift from './caption_shift_emphasis_shift.mjs';
import { targets } from '../ops/_helpers.mjs';
import { targetItem } from '../ops/_knobs.mjs';
import { framesToSeconds } from '../ops/_knobs.mjs';
import { MOVE_STEP } from '../ops/_helpers.mjs';
import { knobs } from '../ops/_knobs.mjs';
export default { id: 'move_time', apply(env, d) {
        if (d.target?.startsWith('caption_') && (!d.move_dest || d.move_dest === 'none')) return captionShift.apply(env, d);
        const { level, cap, rewriteCaption } = targets(env,d);
        const item = targetItem(env,d.target);
        if (!item && !cap) { env.log.push(`move_time: 対象 ${d.target} は時間移動できない → 未適用`); return; }
        const start = cap?.start ?? framesToSeconds(env.edit,item.at), duration = cap ? cap.end-cap.start : framesToSeconds(env.edit,item.duration);
        const n = Number(d.move_dest?.match(/^cut_(\d+)$/)?.[1]);
        const dest = d.move_dest === 'here' ? (env.ctx.playheadT ?? env.playheadT) : d.move_dest === 'start' ? 0 : d.move_dest === 'end' ? (env.segments.at(-1)?.end ?? 0)-duration : d.move_dest === 'time_spoken' ? d.seconds : n ? env.segments.find(s=>s.index+1===n)?.at : null;
        const next = Math.max(0,dest ?? start+(d.seconds ?? MOVE_STEP[level])*(d.direction === 'earlier' ? -1 : 1));
        if (cap) rewriteCaption(cap,{start:next,end:next+duration}); else knobs(env,item,{at:next});
        env.log.push(`move ${item?.id ?? cap.id} → ${next}秒`);
    } };
