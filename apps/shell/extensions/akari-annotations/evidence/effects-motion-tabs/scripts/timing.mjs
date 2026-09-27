// 開いてからカードが見える / 出揃うまでの実測（ラッパー作成の検証スクリプト。BEFORE / AFTER 共通）。
// ページ内で rAF ごとに「カードの数・見本が描けた数・読み込み中の書体の数」を見て、変化した時刻を記録する。
// t0 = 押したとき（pointerdown の timeStamp）またはコマンドを打つ直前（startNow）。
// first = 表示範囲に最初のカードが見えた時刻 / all = 見本が描けたカードの数と読み込み中の書体が最後に変化した時刻（以後 8 秒変化なし）。
import { evalOn } from './cdp-lib.mjs';
import { sleep } from './l1-lib.mjs';

const S = JSON.stringify;
/** cardSel: カードのセレクタ。readyBody: カード要素 c を受けて「見本が描けている」を返す式の本体。 */
export const ARM = (cardSel, readyBody, rootSel = null) => `(()=>{
const st={t0:null,changes:[],lt:[],armedAt:performance.now()};window.__tm=st;
const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
const inView=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth};
const ready=c=>{try{${readyBody}}catch{return false}};
let last='';let po=null;
try{po=new PerformanceObserver(l=>{for(const e of l.getEntries())if(st.t0!==null&&e.startTime>=st.t0-50)st.lt.push([Math.round(e.startTime-st.t0),Math.round(e.duration)])});po.observe({type:'longtask'})}catch{}
const loop=()=>{const now=performance.now();const root=${rootSel ? `document.querySelector(${S(rootSel)})` : 'document'};const cards=root?[...root.querySelectorAll(${S(cardSel)})].filter(vis):[];
const sig={n:cards.length,view:cards.filter(inView).length,ready:cards.filter(ready).length,fonts:[...document.fonts].filter(f=>f.status==='loading').length,dom:root&&root!==document?root.getElementsByTagName('*').length:null};
const k=JSON.stringify(sig);if(k!==last){st.changes.push([Math.round(now-st.t0),sig]);last=k}
if(now-st.t0<10000)requestAnimationFrame(loop);else{po?.disconnect();st.done=true}};
const start=t=>{if(st.t0!==null)return;st.t0=t;requestAnimationFrame(loop)};
addEventListener('pointerdown',e=>start(e.timeStamp),{capture:true,once:true});
st.startNow=()=>start(performance.now());
return true})()`;

export function summarize(st) {
    if (!st || st.t0 === null) return { error: 'not started' };
    const changes = st.changes;
    const first = changes.find(([, s]) => s.view > 0);
    const firstReady = changes.find(([, s]) => s.ready > 0 && s.view > 0);
    const final = changes.at(-1)?.[1];
    // all: 最後に ready 数 / 書体の読み込み / カード数が変わった時刻（dom 数の揺れは見ない）
    let all = null, prev = null;
    for (const [t, s] of changes) {
        const k = S([s.n, s.ready, s.fonts]);
        if (k !== prev) { all = t; prev = k; }
    }
    return {
        firstCardVisibleMs: first ? first[0] : null,
        firstSampleVisibleMs: firstReady ? firstReady[0] : null,
        allSettledMs: final && final.n > 0 ? all : null,
        final,
        longTasks: st.lt, longTaskTotalMs: st.lt.reduce((a, [, d]) => a + d, 0),
        changes: changes.slice(0, 40)
    };
}

/** arm → trigger() → 10 秒待って結果。trigger が 'now' を返したら startNow（コマンド起動）。 */
export async function measure(cdp, { cardSel, readyBody, rootSel }, trigger, { profile = false } = {}) {
    await evalOn(cdp, ARM(cardSel, readyBody, rootSel));
    if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
    await trigger(async () => evalOn(cdp, 'window.__tm.startNow(),true'));
    await sleep(10_500);
    let prof = null;
    if (profile) { const { profile: p } = await cdp.send('Profiler.stop'); prof = topSelf(p); }
    const st = await evalOn(cdp, 'window.__tm');
    return { ...summarize(st), ...(prof ? { profileTop: prof } : {}) };
}

/** CPU プロファイルの自己時間の上位（関数名 + ファイル名:行）。 */
export function topSelf(profile, limit = 25) {
    const byId = new Map(profile.nodes.map(n => [n.id, n]));
    const dt = profile.timeDeltas; const self = new Map();
    profile.samples.forEach((id, i) => { self.set(id, (self.get(id) || 0) + (dt[i] || 0)); });
    const agg = new Map();
    for (const [id, us] of self) {
        const f = byId.get(id).callFrame;
        const file = (f.url || '').split('/').pop().split('?')[0];
        const key = `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`;
        agg.set(key, (agg.get(key) || 0) + us);
    }
    const total = [...agg.values()].reduce((a, b) => a + b, 0);
    const idle = agg.get('(idle) :0') || 0;
    return { totalMs: Math.round(total / 1000), busyMs: Math.round((total - idle) / 1000),
        top: [...agg.entries()].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k) || /garbage|program/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, us]) => [k, Math.round(us / 100) / 10]) };
}
