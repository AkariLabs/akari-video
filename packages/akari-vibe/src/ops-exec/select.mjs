import { targetItem } from '../ops/_knobs.mjs';
import { knobs } from '../ops/_knobs.mjs';
export default { id: 'select', apply(env, d) {
        const item=targetItem(env,d.target);
        if (item) knobs(env,item,{select:true});
        if (d.target?.startsWith('cut_')) env.selection=`cut:${d.target.slice(4)}`;
        if (d.target?.startsWith('caption_')) env.selection=`caption:${d.target.slice(8).replaceAll('_','-')}`;
        env.log.push(`select ${d.target}`);
    } };
