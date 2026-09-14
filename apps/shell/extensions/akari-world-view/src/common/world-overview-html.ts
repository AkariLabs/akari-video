import { WORLD_OVERVIEW_GEOMETRY_SOURCE } from './world-overview-geometry';

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
<style>:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:#10131a;color:#edf2ff}header{height:52px;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid #30384a}h1{font-size:16px;margin:0}.spacer{flex:1}#edithint{color:#aeb8cf;font-size:12px}button{padding:6px 10px}main{height:calc(100vh - 52px);padding:14px;position:relative}canvas{width:100%;height:100%;border:1px solid #30384a;border-radius:8px;background:#181d27;touch-action:none}.error{padding:18px;color:#ff9cae;white-space:pre-wrap}#toast{position:absolute;right:28px;bottom:28px;max-width:min(520px,calc(100% - 56px));padding:10px 14px;border:1px solid #8f4c59;border-radius:7px;background:#351d25;color:#ffd5dc;box-shadow:0 8px 28px #0008}</style></head><body>
<header><h1>地図</h1><output id="time"></output><span id="edithint"></span><span class="spacer"></span><button id="observe3d" disabled title="spatial の build 票の後">3D 観察</button></header><main><canvas id="overview" width="1280" height="720"></canvas><div id="error" class="error" hidden></div><div id="toast" data-count="0" hidden></div></main>
<script>${inline(input.cameraSource)}</script><script>${inline(input.runtimeSource)}</script><script>${inline(WORLD_OVERVIEW_GEOMETRY_SOURCE)}</script><script>(()=>{
const initialMap=${mapJson},initial=${json(input.seconds)},problem=${error};
const canvas=document.getElementById('overview'),out=document.getElementById('time'),box=document.getElementById('error'),observe=document.getElementById('observe3d'),hint=document.getElementById('edithint'),toast=document.getElementById('toast');
if(problem){canvas.hidden=true;box.hidden=false;box.textContent=problem;return}
let rawMap=initialMap;const editable=rawMap.kind!=='spatial';hint.textContent=editable?'⌥ ドラッグで停留所を移動':'spatial は移動できません';observe.hidden=editable;
const flatten=raw=>raw.kind==='spatial'?(()=>{const zones=raw.zones.map(z=>({...z,c:z.c.slice(0,2)}));const cameraStops=raw.cameraStops.map(s=>{const z=zones.find(z=>z.id===s.id);return{id:s.id,world:s.world,at:s.at,leave:s.leave,c:[z?.c[0]||0,z?.c[1]||0,1]}});const worlds=raw.worlds.map(w=>{const points=zones.filter(z=>z.world===w.id).map(z=>z.c),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);return{...w,flat:{bounds:[minX-12,minY-12,Math.max(24,maxX-minX+24),Math.max(24,maxY-minY+24)],pattern:'grid'}}});return{...raw,kind:'flat',worlds,zones,cameraStops}})():raw;
const clone=value=>JSON.parse(JSON.stringify(value));
let officialMap=flatten(rawMap),workingMap=null,seconds=Number.isFinite(initial)?initial:0,drag=null,pendingRequest=null,requestSerial=0,toastTimer=0,lastDrawError=null,lastDrawToast=null;
const activeMap=()=>workingMap||officialMap;
const overviewView=()=>akariOverviewView(activeMap().worlds.map(w=>w.flat.bounds),{width:canvas.width,height:canvas.height},55);
const descriptor=map=>({schemaVersion:1,kind:'flat',frame:{width:1920,height:1080},worlds:map.worlds,zones:map.zones,cameraStops:map.cameraStops,edges:map.edges,retainedNodes:map.retainedNodes||[],render:{dotStep:90,margin:.25,hazeAlpha:.92}});
function drawStops(ctx,map,view){for(const stop of map.cameraStops){const p=akariScreenPoint(view,{x:stop.c[0],y:stop.c[1]}),active=drag?.id===stop.id||pendingRequest?.stopId===stop.id;ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,active?11:9,0,Math.PI*2);ctx.fillStyle=active?'#f7d774':'#f4f7ff';ctx.fill();ctx.lineWidth=active?3:1.5;ctx.strokeStyle=active?'#fff4b7':'#273044';if(pendingRequest?.stopId===stop.id)ctx.setLineDash([4,3]);ctx.stroke();ctx.restore()}}
function drawOverview(){out.value=seconds.toFixed(3)+' s';const map=activeMap(),view=overviewView(),ctx=canvas.getContext('2d');try{window.akari.worldRuntime.drawOverview(ctx,descriptor(map),view,seconds,{frame:true});lastDrawError=null;lastDrawToast=null}catch(error){const message=error instanceof Error?error.message:String(error);lastDrawError=message;ctx.clearRect(0,0,canvas.width,canvas.height);if(lastDrawToast!==message){lastDrawToast=message;showToast(message)}}drawStops(ctx,map,view)}
function canvasPoint(event){const rect=canvas.getBoundingClientRect();return akariCanvasPoint({width:canvas.width,height:canvas.height},rect,{x:event.clientX,y:event.clientY})}
function cancelDrag(){if(!drag)return;try{canvas.releasePointerCapture(drag.pointerId)}catch{}drag=null;workingMap=null;drawOverview()}
function showToast(reason){clearTimeout(toastTimer);toast.dataset.count=String(Number(toast.dataset.count||0)+1);toast.textContent=String(reason||'停留所を移動できませんでした');toast.hidden=false;toastTimer=setTimeout(()=>{toast.hidden=true},4000)}
let hostApi=null;try{hostApi=typeof acquireVsCodeApi==='function'?acquireVsCodeApi():typeof acquireTheiaApi==='function'?acquireTheiaApi():null}catch{}
canvas.addEventListener('pointerdown',event=>{if(!editable||!event.altKey||pendingRequest)return;const point=canvasPoint(event),view=overviewView(),id=akariHitTestStop(officialMap.cameraStops,view,point,13);if(!id)return;const stop=officialMap.cameraStops.find(candidate=>candidate.id===id),worldPoint=akariWorldPoint(view,point);workingMap=clone(officialMap);drag={id,pointerId:event.pointerId,offset:[stop.c[0]-worldPoint.x,stop.c[1]-worldPoint.y]};canvas.setPointerCapture(event.pointerId);event.preventDefault();drawOverview()});
canvas.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;const point=akariWorldPoint(overviewView(),canvasPoint(event)),stop=workingMap.cameraStops.find(candidate=>candidate.id===drag.id);stop.c[0]=point.x+drag.offset[0];stop.c[1]=point.y+drag.offset[1];drawOverview()});
canvas.addEventListener('pointerup',event=>{if(!drag||event.pointerId!==drag.pointerId)return;const stop=workingMap.cameraStops.find(candidate=>candidate.id===drag.id),requestId='world-stop-'+(++requestSerial),stopId=drag.id,c=stop.c.length>=3?[stop.c[0],stop.c[1],stop.c[2]]:[stop.c[0],stop.c[1]];try{canvas.releasePointerCapture(drag.pointerId)}catch{}drag=null;if(!hostApi?.postMessage){workingMap=null;drawOverview();return}pendingRequest={requestId,stopId};hostApi.postMessage({type:'akari-world-move-stop',stopId,c,requestId});drawOverview()});
canvas.addEventListener('pointercancel',cancelDrag);window.addEventListener('keydown',event=>{if(event.key==='Escape')cancelDrag()});
window.addEventListener('message',event=>{const message=event.data;if(message?.type==='akari-world-seek'&&Number.isFinite(message.time)){seconds=Math.max(0,message.time);drawOverview();return}if(!pendingRequest||message?.requestId!==pendingRequest.requestId)return;if(message.type==='akari-world-map'){try{rawMap=JSON.parse(message.worldMapJson);officialMap=flatten(rawMap);workingMap=null;pendingRequest=null;drawOverview()}catch(error){workingMap=null;pendingRequest=null;showToast(error instanceof Error?error.message:String(error));drawOverview()}}else if(message.type==='akari-world-move-failed'){workingMap=null;pendingRequest=null;showToast(message.reason);drawOverview()}});
window.__akariWorldOverview={editable,get seconds(){return seconds},stops:()=>activeMap().cameraStops.map(stop=>({id:stop.id,c:[...stop.c]})),view:()=>({...overviewView()}),screenOf:id=>{const stop=activeMap().cameraStops.find(candidate=>candidate.id===id);return stop?akariScreenPoint(overviewView(),{x:stop.c[0],y:stop.c[1]}):null},toastCount:()=>Number(toast.dataset.count||0),pending:()=>pendingRequest?{...pendingRequest}:null,map:()=>clone(activeMap()),lastDrawError:()=>lastDrawError};
drawOverview()})();</script></body></html>`;
}
