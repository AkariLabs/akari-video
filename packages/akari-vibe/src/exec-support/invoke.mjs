// Legacy motion apply reads a key set through `this.questions()`. Supply only
// execution-domain keys, with no question text or operation specification.
import { companionCommandByKey } from './companion-commands.mjs';
const motionCriteria = Object.freeze(Object.fromEntries(
    ['zoom_in','zoom_out','enter','exit','pan','fade_in','fade_out','clear'].map(key=>[key,true])));
const motionReceiver = Object.freeze({ questions:()=>({motion_kind:{criteria:motionCriteria}}) });
export function invokeExecutor(op, env, decision) {
    let reviewCount=0;
    if(env.companion&&op.id==='review_note')try{reviewCount=JSON.parse(env.reviewSource)?.annotations?.length??0;}catch{}
    const result=op.apply.call(op.id === 'motion_keyframes' ? motionReceiver : op, env, decision);
    if(env.companion&&op.id==='shell_ui_open'&&env.sendCommand){
        const entry=companionCommandByKey.get(decision.shell_ui_target);
        if(entry?.commandId)void Promise.resolve(env.sendCommand(entry.commandId,entry.args)).then(response=>{
            if(!response?.ok&&['not-allowed','invalid-args','not-supported'].includes(response?.error))env.log.push(`${entry.label} → companion で開けない（${response.error}）`);
        },()=>{env.log.push(`${entry.label} → companion への送信に失敗`);});
    }
    if(env.companion&&op.id==='review_note'&&env.sendAnnotate){
        let annotation;
        try{const annotations=JSON.parse(env.reviewSource).annotations;annotation=annotations.length>reviewCount?annotations.at(-1):null;}catch{}
        if(annotation){
            const pending=Promise.resolve(env.sendAnnotate({text:annotation.text,sourceT:annotation.sourceT,src:annotation.src,
                sourceRange:annotation.sourceRange,target:null})).then(response=>{
                if(response?.ok)env.log.push('review_note → companion の注釈に1件追加');
                else env.log.push(`review_note → companion 注釈は未適用（${response?.error??'unknown'}）`);
            },error=>{env.log.push(`review_note → companion 注釈は未適用（${error?.message??error}）`);});
            (env.pendingEffects??=[]).push(pending);
        }
    }
    return result;
}
