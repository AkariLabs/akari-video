import { previousCandidates } from '../exec-support/candidates.mjs';
import { library } from '../exec-support/insert_from_library_search.mjs';
import nodePath from 'node:path';
import nodeFs from 'node:fs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { writeEdit as writeEditBase } from '../ops/_knobs.mjs';
const libraryRuntimeFor=(env={})=>{
    const active=globalThis[Symbol.for('akari.vibe.library-insert-runtime')]?.()??{};
    return {assetPaths:env.assetPaths??active.assetPaths,placement:env.placement??active.placement,companion:env.companion??active.companion,
        durationSeconds:env.durationSeconds??active.durationSeconds,fragmentPath:env.fragmentPath??active.fragmentPath};
};
const path={...nodePath,join(...parts){
    const active=libraryRuntimeFor(),fragment=parts.at(-1)==='fragment.html'
        ? Object.values(active.assetPaths??{}).map(value=>nodePath.posix.join(value.dir,'fragment.html'))
            .find(file=>Object.values(active.assetPaths??{}).some(value=>(value.files??[]).includes(file))):null;
    return fragment??(active.companion&&parts.some(part=>typeof part!=='string')
        ?nodePath.posix.join('__missing_imported_asset__',String(parts.at(-1)??'')):nodePath.join(...parts));
}};
const fs={...nodeFs,existsSync(file){
    const imported=Object.values(libraryRuntimeFor().assetPaths??{}).some(value=>(value.files??[]).includes(file));
    return imported||nodeFs.existsSync(file);
}};
const blockCompanionInsert=env=>{
    const previous=env.selection,originalPush=env.log.push;
    originalPush.call(env.log,'insert_from_library_add → 未適用（シェル接続中だが取り込み済み素材の相対パスが無い）');
    Object.defineProperty(env,'selection',{configurable:true,get:()=>previous,set:()=>{}});
    env.log.push=function(...values){env.log.push=originalPush;
        return values.some(value=>String(value).startsWith('insert_from_library_add '))?this.length:originalPush.apply(this,values);};
};
const writeEdit=(env,edit)=>{
    if(env.companion){
        const active=libraryRuntimeFor(env),ids=Object.keys(active.assetPaths??{}),imported=active.assetPaths?.[ids[0]];
        const html=imported&&imported.files?.includes(nodePath.posix.join(imported.dir,'fragment.html'))
            ?nodePath.posix.join(imported.dir,'fragment.html'):null;
        if(ids.length!==1||!html){blockCompanionInsert(env);return;}
        const item=edit.tracks.find(track=>track.id==='w11-library')?.items?.at(-1);
        // 置く時刻を書き込んだ写しがあればそれを指す（公開側の検査が data-start の一致を求める）
        if(item?.source?.kind==='html')item.source.path=typeof active.fragmentPath==='string'&&active.fragmentPath?active.fragmentPath:html;
        if(item&&active.placement?.assetId===ids[0]&&active.placement.transform)item.transform=active.placement.transform;
        // 断片が自分の長さ（data-duration）を持つなら、その長さで置く（公開側の検査が一致を求める）
        if(item&&Number.isFinite(active.durationSeconds))item.duration=Math.max(1,secondsToFrames(edit,active.durationSeconds));
    }
    writeEditBase(env,edit);
};
export default { id: 'insert_from_library_add', apply(env,d) {
        const stop = reason => env.log.push(`insert_from_library_add → 未適用（${reason}）`);
        const reference = d.w11_reference ?? 'direct';
        const ordinal = {first:0,second:1,third:2}[reference];
        const id = ordinal === undefined ? d.w11_asset : (previousCandidates(env.ctx, 'library')[ordinal]?.key ?? (env.ctx.lastCandidates ? undefined : env.ctx.libraryCandidates?.[ordinal]));
        if (reference === 'none') return stop('候補の指定なし、または対応外の序数');
        const asset = library.find(a=>a.id===id);
        if (!asset) return stop(ordinal === undefined ? 'ライブラリに該当なし、または候補が曖昧' : '直前の候補が無い、または指定番号に候補が無い');
        if (d.w11_at === 'unsupported') return stop('この位置指定には未対応');
        const at = d.w11_at === 'spoken' ? d.seconds : env.playheadT;
        if (!Number.isFinite(at) || at < 0) return stop('挿入時刻を解決できない');
        const html = path.join(asset.directory,'fragment.html');
        if (!fs.existsSync(html)) return stop(`${id} の fragment.html が無い（scene3d 等のベイク・変換は未接続）`);
        const edit = structuredClone(env.edit);
        let track = edit.tracks.find(t=>t.id==='w11-library' && t.lane==='visual' && Array.isArray(t.items));
        if (!track) {
            if (edit.tracks.some(t=>t.id==='w11-library')) return stop('挿入トラックIDの衝突');
            track={id:'w11-library',lane:'visual',items:[]}; edit.tracks.push(track);
        }
        let n=1; while(env.editStore.locate(edit,`w11-library-${n}`)) n++;
        const item={id:`w11-library-${n}`,at:secondsToFrames(edit,at),duration:Math.max(1,secondsToFrames(edit,3)),source:{kind:'html',path:html}};
        env.editStore.insertItem(edit,track.id,item); writeEdit(env,edit);
        env.selection=`item:${item.id}`;
        env.log.push(`insert_from_library_add ${id} → ${item.id} / ${at}秒から3秒 / html`);
    } };
