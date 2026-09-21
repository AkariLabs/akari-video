import { insertTemplateText } from '../exec-support/text_style_preset.mjs';
import { textPosition } from '../ops/_helpers.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { TEXT_SECONDS } from '../ops/_helpers.mjs';
import { telopSource } from '../v2/telop.mjs';
import { positionTransform } from '../ops/_knobs.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
export default { id: 'add_text', apply(env, d) {
        if (d.w12_template != null) return insertTemplateText(env, d);
        if (!d.newText) { env.log.push('→ LLM 層へ回す（add_text: 入れる文言が発話に無い）'); return; }
        const edit=structuredClone(env.edit), {pos,why}=textPosition(d,env.ctx,env.context,env.persons);
        let track=edit.tracks.find(t=>t.lane==='visual' && t.items?.some(i=>i.source.kind==='telop'));
        if (!track) { let n=1; while(edit.tracks.some(t=>t.id===`telops-${n}`)) n++; track={id:`telops-${n}`,lane:'visual',items:[]};edit.tracks.push(track); }
        let n=1; while(env.editStore.locate(edit,`text-${n}`)) n++;
        const item={id:`text-${n}`,at:secondsToFrames(edit,env.playheadT),duration:Math.max(1,secondsToFrames(edit,d.seconds ?? TEXT_SECONDS)),source:telopSource(d.newText),transform:positionTransform(edit,pos)};
        env.editStore.insertItem(edit,track.id,item);writeEdit(env,edit);env.selection=`item:${item.id}`;
        env.log.push(`add_text 「${d.newText}」を ${why} に ${env.playheadT}秒から ${d.seconds ?? TEXT_SECONDS}秒（telop / ${item.id}）`);
    } };
