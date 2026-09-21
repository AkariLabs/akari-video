import { targets } from '../ops/_helpers.mjs';
import { partSpec } from '../ops/_knobs.mjs';
import { patchItem } from '../ops/_knobs.mjs';
import { targetItem } from '../ops/_knobs.mjs';
import { roleKey } from '../v2/telop.mjs';
export default { id: 'edit_text', apply(env, d) {
        const { cap, rewriteCaption } = targets(env,d);
        if (cap && d.newText) { rewriteCaption(cap,{text:d.newText,edited:true}); return; }
        const part = partSpec(env, d.target);
        if (part) {
            if (!d.newText) { env.log.push('edit_text: 文言が無い → 未適用'); return; }
            if (!part.slot) {
                env.log.push(`edit_text ${part.parentId}#${part.partId} → タスク（HTML 本体の書き換えは AI の仕事）・未適用`);
                return;
            }
            patchItem(env, part.parentId, { source: { params: { [part.slot]: d.newText } } });
            env.log.push(`edit_text ${part.parentId}#${part.partId} → source.params.${part.slot}=「${d.newText}」`);
            return;
        }
        const item = targetItem(env,d.target), key = item?.source.kind === 'telop' ? roleKey(item,'text') : null;
        if (!key || !d.newText) { env.log.push('edit_text: 文言または text role が無い → 未適用'); return; }
        patchItem(env,item.id,{source:{params:{[key]:d.newText}}}); env.log.push(`edit_text ${item.id} →「${d.newText}」`);
    } };
