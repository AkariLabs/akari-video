import { targetItem } from '../ops/_knobs.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
import { splitItem } from '../v2/mutations.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
export default { id: 'split', apply(env, d) {
        const item = targetItem(env,d.target,{currentCut:true});
        if (!item) { env.log.push('split: カットが無い → 未適用'); return; }
        writeEdit(env,splitItem(env.edit,{itemId:item.id,atFrames:secondsToFrames(env.edit,env.playheadT)}));
        env.log.push(`split ${item.id} @ ${env.playheadT}秒`);
    } };
