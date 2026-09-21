import { buildState } from '../local-state.mjs';
import { editStore } from '../edit-store.mjs';
import { roleValue } from './telop.mjs';
export function timelineSnapshot({ edit, context, ctx, captions = [] }) {
    const st = buildState({ edit, context, ctx, text:'', captions });
    return {
        duration:st.segments.at(-1)?.end ?? 0,
        cuts:st.allCuts.map(c => { const raw=editStore.locate(edit,c.itemId).item; return {...c,id:`cut:${c.n}`,scale:raw.transform?.scale ?? 1,in:raw.source.in,out:raw.source.out}; }),
        items:st.allItems.map(it => {
            const raw=it.raw ?? {}, telop=raw.source?.kind==='telop';
            const layout=context.layout?.[it.id] ?? (telop ? {box:[.2,.78,.6,.14],kind:'telop'} : null);
            return {id:it.id,key:it.key,label:it.label,start:it.start,end:it.end,audio:!!it.audio,
                source:raw.source,vars:raw.source?.vars ?? null,layout:layout ? {...layout,text:telop ? roleValue(raw,'text') : layout.text} : null,
                color:telop ? roleValue(raw,'color') : null,scale:raw.transform?.scale ?? 1,x:raw.transform?.x ?? 0,y:raw.transform?.y ?? 0,
                rotate:raw.transform?.rotate ?? 0,opacity:raw.opacity ?? 1,blend:raw.blend ?? 'normal'};
        }),
        persons:st.persons.map(p=>({id:p.id,label:p.label,box:p.box})),
        bgmGainDb:editStore.locate(edit,'bgm')?.item.gain_db ?? null,
    };
}
