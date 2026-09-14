export interface WorldOverviewHtmlInput {
    runtimeSource: string;
    cameraSource: string;
    worldMapJson: string;
    seconds: number;
    error?: string;
}

const inline = (source: string): string => source.replaceAll('</script', '<\\/script');
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');

export function worldOverviewHtml(input: WorldOverviewHtmlInput): string {
    const error = input.error ? json(input.error) : 'null';
    let map: unknown = null;
    if (!input.error) {
        try { map = JSON.parse(input.worldMapJson); } catch (caught) {
            return worldOverviewHtml({ ...input, error: caught instanceof Error ? caught.message : String(caught) });
        }
    }
    const mapJson = json(map);
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:#10131a;color:#edf2ff}header{height:52px;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid #30384a}h1{font-size:16px;margin:0}.spacer{flex:1}button{padding:6px 10px}main{height:calc(100vh - 52px);padding:14px}canvas{width:100%;height:100%;border:1px solid #30384a;border-radius:8px;background:#181d27}.error{padding:18px;color:#ff9cae;white-space:pre-wrap}</style></head><body>
<header><h1>地図</h1><output id="time"></output><span class="spacer"></span><button id="observe3d" disabled title="spatial の build 票の後">3D 観察</button></header><main><canvas id="overview" width="1280" height="720"></canvas><div id="error" class="error" hidden></div></main>
<script>${inline(input.cameraSource)}</script><script>${inline(input.runtimeSource)}</script><script>(()=>{const rawMap=${mapJson};const initial=${json(input.seconds)};const problem=${error};const canvas=document.getElementById('overview'),out=document.getElementById('time'),box=document.getElementById('error'),observe=document.getElementById('observe3d');if(problem){canvas.hidden=true;box.hidden=false;box.textContent=problem;return}observe.hidden=rawMap.kind!=='spatial';const map=rawMap.kind==='spatial'?(()=>{const zones=rawMap.zones.map(z=>({...z,c:z.c.slice(0,2)}));const cameraStops=rawMap.cameraStops.map(s=>{const z=zones.find(z=>z.id===s.id);return{id:s.id,world:s.world,at:s.at,leave:s.leave,c:[z?.c[0]||0,z?.c[1]||0,1]}});const worlds=rawMap.worlds.map(w=>{const points=zones.filter(z=>z.world===w.id).map(z=>z.c);const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);return{...w,flat:{bounds:[minX-12,minY-12,Math.max(24,maxX-minX+24),Math.max(24,maxY-minY+24)],pattern:'grid'}}});return{...rawMap,kind:'flat',worlds,zones,cameraStops}})():rawMap;const descriptor={schemaVersion:1,kind:'flat',frame:{width:1920,height:1080},worlds:map.worlds,zones:map.zones,cameraStops:map.cameraStops,edges:map.edges,retainedNodes:map.retainedNodes||[],render:{dotStep:90,margin:.25,hazeAlpha:.92}};const bounds=map.worlds.map(w=>w.flat.bounds);const minX=Math.min(...bounds.map(b=>b[0])),minY=Math.min(...bounds.map(b=>b[1])),maxX=Math.max(...bounds.map(b=>b[0]+b[2])),maxY=Math.max(...bounds.map(b=>b[1]+b[3]));const view=()=>{const pad=55,s=Math.min((canvas.width-pad*2)/(maxX-minX),(canvas.height-pad*2)/(maxY-minY));return{scale:s,ox:pad-minX*s,oy:pad-minY*s}};let seconds=Number.isFinite(initial)?initial:0;function draw(){out.value=seconds.toFixed(3)+' s';window.akari.worldRuntime.drawOverview(canvas.getContext('2d'),descriptor,view(),seconds,{frame:true})}window.addEventListener('message',event=>{if(event.data?.type==='akari-world-seek'&&Number.isFinite(event.data.time)){seconds=Math.max(0,event.data.time);draw()}});draw()})();</script></body></html>`;
}
