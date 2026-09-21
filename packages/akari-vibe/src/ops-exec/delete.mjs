import { targets } from '../ops/_helpers.mjs';
import { geometryTargetFor } from '../edit-store.mjs';
import { partSpec } from '../ops/_knobs.mjs';
import { targetItem } from '../ops/_knobs.mjs';
import { keyOf } from '../edit-store.mjs';
import { materializeItem } from '../ops/_knobs.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
import { rippleRemoveItem } from '../v2/mutations.mjs';
import { knobs } from '../ops/_knobs.mjs';
export default { id: 'delete', apply(env, d) {
        const { cap } = targets(env,d);
        if (cap) { env.captionsSource = env.editStore.removeCaptionLine(env.captionsSource,cap.id); env.log.push(`delete 文字「${cap.text}」`); return; }
        const geometric = geometryTargetFor(env.edit);
        const target = (!d.target || d.target === 'none') && geometric ? geometric : d.target;
        if ((!target || target === 'none') && env.ctx.stroke) {
            env.log.push('delete none: 描線の対象を解決できないため現在カットへフォールバックしない → 未適用');
            return;
        }
        const part = partSpec(env, target);
        if (part) {
            const projectedParent = targetItem(env, keyOf(`item:${part.parentId}`));
            const edit = structuredClone(env.edit), childId = `${part.parentId}#${part.partId}`;
            if (projectedParent) materializeItem(edit, projectedParent);
            if (env.editStore.locate(edit, childId)) env.editStore.removeItem(edit, childId);
            const parent = env.editStore.locate(edit, part.parentId)?.item;
            if (!parent) { env.log.push(`delete ${d.target}: 親の図解が無い → 未適用`); return; }
            const exclude = [...new Set([...(parent.source.exclude ?? []), part.partId])];
            env.editStore.updateItem(edit, parent.id, { source: { ...parent.source, exclude } });
            writeEdit(env, edit);
            if (env.ctx.selection === `item:${childId}`) env.selection = null;
            env.log.push(`delete ${childId} → 親 ${parent.id} の source.exclude に ${part.partId}（取り消しで戻せる）`);
            return;
        }
        const item = targetItem(env,target,{currentCut:!target || target==='none'});
        if (!item || target?.startsWith('person_')) { env.log.push(`delete ${target}: 削除対象が無い → 未適用`); return; }
        const cut = env.segments.find(s=>s.itemId===item.id);
        if (cut) {
            writeEdit(env,rippleRemoveItem(env.edit,item.id));
            if (env.playheadT >= cut.end) env.playheadT -= cut.duration;
            else if (env.playheadT >= cut.at) env.playheadT = cut.at;
        } else knobs(env,item,{remove:true});
        if (env.ctx.selection === `item:${item.id}` || env.ctx.selection === `cut:${(cut?.index ?? -1)+1}`) env.selection = null;
        env.log.push(`delete ${item.id}（取り消しで戻せる）`);
    } };
