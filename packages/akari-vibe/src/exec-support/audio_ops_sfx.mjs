import fs from 'node:fs';
import { previousCandidates } from './candidates.mjs';
import { catalogCandidates } from './candidates.mjs';
import { fileURLToPath as nodeFileURLToPath } from 'node:url';
import { editStore } from '../edit-store.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { writeEdit as writeEditBase } from '../ops/_knobs.mjs';
import { targetItem } from '../ops/_knobs.mjs';
const libraryRuntimeFor=(env={})=>{
    const active=globalThis[Symbol.for('akari.vibe.library-insert-runtime')]?.()??{};
    return {assetPaths:env.assetPaths??active.assetPaths};
};
const fileURLToPath=url=>{
    const id=new URL(url).pathname.split('/').filter(Boolean).at(-2);
    return libraryRuntimeFor().assetPaths?.[id]?.files?.find(file=>/\.(?:aac|flac|m4a|mp3|ogg|opus|wav)$/i.test(file))
        ?? nodeFileURLToPath(url);
};
const blockCompanionInsert=(env,op)=>{
    const previous=env.selection,originalPush=env.log.push;
    originalPush.call(env.log,`${op} → 未適用（シェル接続中だが取り込み済み素材の相対パスが無い）`);
    Object.defineProperty(env,'selection',{configurable:true,get:()=>previous,set:()=>{}});
    env.log.push=function(...values){env.log.push=originalPush;
        return values.some(value=>String(value).startsWith(`${op}: `))?this.length:originalPush.apply(this,values);};
};
const writeEdit=(env,edit)=>{
    if(env.companion){
        const active=libraryRuntimeFor(env),ids=Object.keys(active.assetPaths??{}),imported=active.assetPaths?.[ids[0]];
        const audio=imported?.files?.find(file=>/\.(?:aac|flac|m4a|mp3|ogg|opus|wav)$/i.test(file));
        if(ids.length!==1||!audio){blockCompanionInsert(env,edit.tracks.some(track=>track.id.startsWith('w14-sfx'))?'audio_sfx':'audio_bgm_pick');return;}
        const source=edit.sources.find(row=>row.path===audio||row.path===nodeFileURLToPath(new URL(`${ids[0]}/track.wav`,root)))
            ?? edit.sources.find(row=>row.id===ids[0]);
        if(source)source.path=audio;
    }
    writeEditBase(env,edit);
};
export const root = new URL('../../../../assets/audio/', import.meta.url);
let cachedAudioAssets;
function loadAudioAssets() {
    return cachedAudioAssets ??= (fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [])
        .filter(e => e.isDirectory() && fs.existsSync(new URL(`${e.name}/meta.json`, root)))
        .map(e => JSON.parse(fs.readFileSync(new URL(`${e.name}/meta.json`, root), 'utf8')))
        .filter(a => /^(sfx|bgm|jingle)-/.test(a.id)).sort((a,b) => a.id.localeCompare(b.id));
}
export const audioAssets = new Proxy([], { get(_target, key) {
    const rows = loadAudioAssets();
    const value = Reflect.get(rows, key);
    return typeof value === 'function' ? value.bind(rows) : value;
} });
export const norm = value => String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const aliases = [
    ['ぽん|ぽっ|ポップ', 'pop'], ['こるく|栓|瓶', 'cork bottle'],
    ['くりっく|かちっ', 'click'], ['ぴこん|ぴっ|びーぷ', 'blip beep'],
    ['きらきら|きらん', 'sparkle shimmer twinkle'], ['しゅっ|ひゅっ', 'whoosh swoosh'],
    ['どん|どーん', 'impact boom'], ['ちーん|ちりん', 'ding bell chime'],
    ['拍手', 'clap'], ['南国|とろぴかる', 'tropical beach'],
    ['明る|元気|楽しい', 'bright uplifting upbeat optimistic 明るい'],
    ['落ち着|静か|穏やか', 'calm soft chill ambient'], ['悲し|切ない', 'sad emotive piano'],
    ['緊張|不安', 'tension suspense'], ['じんぐる|短い曲', 'jingle intro outro'],
];
export const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
export function terms(text) {
    const words = [...segmenter.segment(norm(text))].filter(x => x.isWordLike && x.segment.length >= 2).map(x => x.segment);
    for (const [pattern, expansion] of aliases) if (new RegExp(norm(pattern)).test(norm(text))) words.push(...norm(expansion).split(' '));
    return [...new Set(words)];
}
export function lastAudioContext(st = {}, context = {}) {
    return st.lastOp ?? st.ctx?.lastOp ?? context.lastOp ?? context.ctx?.lastOp
        ?? st.stateText?.match(/^直前に実行した操作: (.*)$/m)?.[1] ?? '';
}
export function audioCandidates(kind, st = {}, context = {}) {
    const pool = audioAssets.filter(a => kind === 'bgm' ? a.id.startsWith('bgm-') || a.id.startsWith('jingle-') : a.id.startsWith('sfx-'));
    const previous = lastAudioContext(st, context);
    const ids = new Set(previous.match(/(?:bgm|sfx|jingle)-[a-z0-9-]+/g) ?? []);
    const prior = pool.filter(a => ids.has(a.id));
    // A follow-up only chooses among the last actual suggestions, not the whole library.
    const candidates = prior.length ? prior : pool;
    const words = terms(st.text ?? '');
    const structured = previousCandidates(st.ctx ?? context.ctx, kind);
    const actual = structured.length ? structured.map(x => pool.find(a => a.id === x.key)).filter(Boolean) : candidates;
    return catalogCandidates(actual, { text: st.text, limit: 12, score: a => {
        const title = norm(a.title), tags = norm((a.tags ?? []).join(' '));
        const description = norm(`${a.description} ${a.when_to_use ?? ''}`);
        return words.reduce((sum,w) => sum + (title.includes(w) ? 5 : 0) + (tags.includes(w) ? 4 : 0) + (description.includes(w) ? 2 : 0) + (norm(a.id).includes(w) ? 1 : 0), 0);
    } });
}
export const audioSummary = a => `${a.title.trim()} — ${a.description.split('。').slice(0,1).join('。')}（${a.when_to_use ?? (a.tags ?? []).join('・')}）`.slice(0,180);
export function unapplied(env, op, why) { env.log.push(`${op} → 未適用（${why}）`); }
export function audioTarget(env, d) {
    if (d.target && d.target !== 'none') return targetItem(env,d.target);
    const selection = env.selection ?? env.ctx?.selection;
    if (typeof selection === 'string' && selection.startsWith('item:')) return editStore.locate(env.edit,selection.slice(5))?.item;
    if (typeof selection === 'string' && selection.startsWith('cut:')) return targetItem(env,`cut_${selection.slice(4)}`);
    return null;
}
export const isAudioItem = (env, item) => !!item && editStore.locate(env.edit,item.id)?.track.lane === 'audio';
export function insertAudio(env, d, kind) {
    const op = kind === 'bgm' ? 'audio_bgm_pick' : 'audio_sfx';
    const id = d[kind === 'bgm' ? 'audio_bgm_id' : 'audio_sfx_id'];
    if (!audioAssets.length) return unapplied(env,op,'未対応: 音源の台帳がありません');
    const asset = audioAssets.find(a => a.id === id && (kind === 'bgm' ? /^(bgm|jingle)-/.test(a.id) : a.id.startsWith('sfx-')));
    if (!asset) return unapplied(env,op,'台帳にある音源の選択が必要');
    const durationSec = Number(asset.description.match(/尺\s*([\d.]+)\s*秒/)?.[1]);
    if (!(durationSec > 0)) return unapplied(env,op,'音源の実尺が台帳で未確認');
    const edit = structuredClone(env.edit);
    let sourceId = asset.id;
    const path = fileURLToPath(new URL(`${asset.id}/track.wav`,root));
    // The library contract fixes track.wav; this lab writes declarations, not media files.
    let source = edit.sources.find(s => s.path === path);
    if (source) sourceId = source.id;
    else {
        let n=1;
        while (edit.sources.some(s => s.id === sourceId)) sourceId = `${asset.id}-${n++}`;
        edit.sources.push({id:sourceId,path});
    }
    let track = edit.tracks.find(t => t.lane === 'audio' && t.id === `w14-${kind}` && t.items);
    if (!track) {
        let id = `w14-${kind}`, n=1;
        while(edit.tracks.some(t => t.id === id)) id = `w14-${kind}-${n++}`;
        track = {id,lane:'audio',items:[]}; edit.tracks.push(track);
    }
    let n=1, itemId;
    do { itemId=`w14-${kind}-${String(n++).padStart(2,'0')}`; } while(editStore.locate(edit,itemId));
    const at=secondsToFrames(edit,env.playheadT);
    if (!Number.isFinite(at) || at < 0) return unapplied(env,op,'挿入位置が不正');
    const item={id:itemId,name:asset.title.trim(),at,duration:Math.max(1,secondsToFrames(edit,durationSec)),role:kind,
        source:{kind:'media',src:sourceId,in:0,out:durationSec},gain_db:kind === 'bgm' ? -18 : -6};
    editStore.insertItem(edit,track.id,item); writeEdit(env,edit); env.selection=`item:${itemId}`;
    env.log.push(`${op}: ${asset.id} を ${env.playheadT}秒に挿入し選択（${itemId}、at=${at}、duration=${item.duration}）`);
    if (!fs.existsSync(path)) env.log.push(`${op}: 音源ファイル未配置（${asset.id}/track.wav）。v2宣言を作成、再生は未検証`);
}
