import { targetItem } from '../ops/_knobs.mjs';
import { targets } from '../ops/_helpers.mjs';
import { roleKey } from '../v2/telop.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export default { id: 'color', apply(env, d) {
        const hex = env.context.palette[d.color]?.[1], item = targetItem(env,d.target);
        const { cap, rewriteCaption } = targets(env,d);
        if (cap && hex) { rewriteCaption(cap,{textStyle:{color:hex}}); return; }
        const key = item?.source.kind === 'telop' ? roleKey(item,'color') : env.context.colorKnobs?.[`item:${item?.id}`];
        if (!hex || !key || !item || !['telop','html'].includes(item.source.kind)) { env.log.push(`color ${d.target}: 色のツマミ宣言または色が無い → 未適用`); return; }
        patchItem(env,item.id,{source:item.source.kind === 'telop' ? {params:{[key]:hex}} : {vars:{[key]:hex}}});
        env.log.push(`color ${item.id} ${key} → ${hex}（${d.color}）`);
    } };
