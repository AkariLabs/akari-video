#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo=path.resolve(root,'../../../../../../'),shell=path.join(repo,'apps/shell');
const temp=await mkdtemp(path.join(os.tmpdir(),'gen-compare-narration-after-'));
const project=path.join(temp,'project'),control=path.join(temp,'control.json'),calls=path.join(temp,'calls.jsonl');
const results={phase:'after',status:'running',checks:[],screenshots:[],observations:{}};
const clean=x=>String(x).replaceAll(repo,'<WORKTREE>').replaceAll(temp,'<TMP>').replaceAll(os.homedir(),'<HOME>').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,'<email>');
async function save(){const p=path.join(root,'results-after.json');await writeFile(p+'.tmp',clean(JSON.stringify(results,null,2))+'\n');await rename(p+'.tmp',p)}
function check(name,pass,measured){results.checks.push({name,pass:!!pass,measured});if(!pass)throw new Error(name+': '+JSON.stringify(measured))}
async function wait(c,expr,name,ms=120000){const until=Date.now()+ms;while(Date.now()<until){const v=await evalOn(c,expr).catch(()=>null);if(v)return v;await sleep(180)}throw new Error('timeout '+name)}
async function dismiss(c){await evalOn(c,command('notifications.commands.clearAll')).catch(()=>null);await evalOn(c,`document.querySelector('.akari-update-close')?.click();document.querySelector('.akari-guide-announcement .close')?.click();true`).catch(()=>null)}
async function click(c,selector){await dismiss(c);const found=await wait(c,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.scrollIntoView({block:'center',behavior:'instant'});e.click();return true})()`,'click '+selector);if(!found)throw new Error('missing '+selector)}
async function capture(c,name,selector){
  const clip=await wait(c,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.max(0,r.left),y:Math.max(0,r.top),width:Math.min(r.width,innerWidth-Math.max(0,r.left)),height:Math.min(${JSON.stringify(name)}.endsWith('-timeline.png')&&/^(07|08|10)-/u.test(${JSON.stringify(name)})?Math.max(1,r.height-50):r.height,innerHeight-Math.max(0,r.top)),scale:1}})()`,'capture '+selector);
  const {data}=await c.send('Page.captureScreenshot',{format:'png',clip});
  const b=Buffer.from(data,'base64');await writeFile(path.join(root,name),b);results.screenshots.push({name,bytes:b.length});await save();
}
async function focusInInspector(c,selector,name){
  const until=Date.now()+12000;
  while(Date.now()<until){
    const state=await evalOn(c,`(async()=>{const e=document.querySelector(${JSON.stringify(selector)}),p=document.querySelector('[data-akari-ui="panel:inspector"]');if(!e||!p)return null;e.scrollIntoView({block:'center',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=e.getBoundingClientRect(),v=p.getBoundingClientRect();return {top:r.top,bottom:r.bottom,visible:r.top>=v.top+65&&r.bottom<=v.bottom-20}})()`).catch(()=>null);
    if(state?.visible)return state;
    await sleep(150);
  }
  throw new Error(`cannot focus ${name}`);
}
async function shot(c,name){
  await dismiss(c);
  if(name==='02b-row-estimates.png')await evalOn(c,`document.querySelector('[data-akari-narration-engine=\"fal-qwen3\"]')?.scrollIntoView({block:'center'});true`).catch(()=>null);
  if(name.startsWith('04-'))await evalOn(c,`document.querySelector('.akari-inspector-ai-narration-progress')?.scrollIntoView({block:'center'});true`).catch(()=>null);
  if(name==='05-three-candidates.png')await focusInInspector(c,'[data-akari-narration-candidate]','three candidates');
  if(/^(07|10)-/u.test(name))await focusInInspector(c,'.akari-inspector-ai-narration-placement','placement');
  if(/^(06|08|09)-/u.test(name))await evalOn(c,`(()=>{const e=[...document.querySelectorAll('[data-akari-narration-candidate]')];(name=>name==='09-one-failed.png'?e.at(-1):e[0])(${JSON.stringify(name)})?.scrollIntoView({block:'center'});return true})()`).catch(()=>null);
  await capture(c,name,'[data-akari-ui="panel:inspector"]');
  if (/^(04|07|08|10)-/u.test(name)) await capture(c,name.replace('.png','-timeline.png'),'[data-akari-ui="panel:timeline"]');
  if (name==='07-adopted.png') { await evalOn(c,`document.querySelector('[data-akari-ui=\"inspector-selection-header\"]')?.scrollIntoView({block:'start'});true`).catch(()=>null); await capture(c,'07-adopted-header.png','[data-akari-ui="panel:inspector"]'); }
}
const command=id=>`(async()=>{const c=window.theia.container,d=c._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');await c.get(C).executeCommand(${JSON.stringify(id)});return true})()`;
const frameUi=`(()=>{const timeline=document.querySelector('[data-akari-ui="panel:timeline"] [data-akari-item-id="frame-b"]');const inspector=document.querySelector('[data-akari-ui="panel:inspector"]');const header=inspector?.querySelector('[data-akari-ui="inspector-selection-header"]');const placement=inspector?.querySelector('.akari-inspector-ai-narration-placement');const button=inspector?.querySelector('.akari-inspector-ai-narration-button');return{timeline:[timeline?.title,timeline?.textContent,timeline?.getAttribute('aria-label')].filter(Boolean).join(' | '),inspectorHeader:header?.textContent?.trim()??'',placement:placement?.textContent?.trim()??'',progress:Boolean(inspector?.querySelector('.akari-inspector-ai-narration-progress')),button:button?.textContent?.trim()??'',buttonDisabled:button?.disabled??null,candidates:inspector?.querySelectorAll('[data-akari-narration-candidate]').length??0}})()`;
async function waitFrameUi(c, condition, name, ms=90000){return wait(c,`(()=>{const ui=${frameUi};return ${condition}?ui:null})()`,name,ms)}
const edit=()=>readFile(path.join(project,'edit.json'),'utf8');
const hash=x=>createHash('sha256').update(x).digest('hex');
const received=async()=>{const x=await readFile(calls,'utf8');return x.trim().split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.received).map(row=>({engine:row.received,voice:row.voice,at:row.at}));};
async function openPanel(c,id){
 const p=await wait(c,`(()=>{const e=document.querySelector('[data-akari-ui="panel:timeline"] [data-akari-item-id="${id}"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`,'timeline point');
 await realClick(c,p.x,p.y);
 const active=await evalOn(c,`(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-edit"]');return !t||t.classList.contains('is-active')||t.getAttribute('aria-selected')==='true'})()`);
 if(!active)await click(c,'[data-akari-ui="tab:inspector-edit"]');
 for(let i=0;i<4;i++){
   if(await evalOn(c,`Boolean(document.querySelector('.akari-inspector-ai-narration-panel'))`))return;
   await wait(c,`Boolean(document.querySelector('[data-akari-inspector-ai-tile="narration"]'))`,'narration tile',30000);
   await click(c,'[data-akari-inspector-ai-tile="narration"]');
   try{await wait(c,`Boolean(document.querySelector('.akari-inspector-ai-narration-panel'))`,'panel',4000);return}catch{}
 }
 throw new Error('narration panel did not open');
}
async function script(c,value){await evalOn(c,`(()=>{const e=document.querySelector('.akari-inspector-ai-narration-panel textarea[aria-label="原稿"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)}
async function dialog(c,approve){return wait(c,`(()=>{const dialogs=[...document.querySelectorAll('.dialogOverlay')];const d=dialogs.reverse().find(e=>e.textContent.includes('費用承認'));if(!d)return null;return {text:d.innerText,buttons:[...d.querySelectorAll('button')].map(e=>e.textContent.trim())}})()`,'approval').then(async info=>{await capture(c,++approvalCaptureCount===1?'03-approval-dialog.png':approvalCaptureCount===2?'03b-approval-confirm.png':'09b-approval-confirm.png','.dialogOverlay .dialogBlock');await evalOn(c,`(()=>{const d=[...document.querySelectorAll('.dialogOverlay')].reverse().find(e=>e.textContent.includes('費用承認'));const b=[...d.querySelectorAll('button')].find(e=>e.textContent.includes(${JSON.stringify(approve?'費用承認する':'キャンセル')}));b?.click();return !!b})()`);return info})}
let electron,c,falServer;const falRequests=[];let approvalCaptureCount=0;
try{
 const fixture=spawn(process.execPath,[path.join(root,'scripts/gen-fixture.mjs'),project],{cwd:repo,stdio:['ignore','pipe','pipe']});let out='',err='';fixture.stdout.on('data',x=>out+=x);fixture.stderr.on('data',x=>err+=x);if(await new Promise(r=>fixture.once('close',r)))throw new Error(err);
 for(const n of ['home','akari-home','theia-config','user-data'])await mkdir(path.join(temp,n));
 await writeFile(control,JSON.stringify({delayMs:20000}));await writeFile(calls,'');
 falServer=createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{try{const entry=JSON.parse(body);falRequests.push({engine:entry.engine,at:Date.now()});res.writeHead(200,{'content-type':'application/json'});res.end('{}')}catch{res.writeHead(400);res.end()}})});
 await new Promise(resolve=>falServer.listen(0,'127.0.0.1',resolve));
 const falUrl=`http://127.0.0.1:${falServer.address().port}/`;
 await writeFile(path.join(temp,'akari-home','ai-models.json'),JSON.stringify({version:1,defaults:{voice:'voicevox'},favorites:{voice:['tts:gemini-tts']}}));
 const env={...process.env,HOME:path.join(temp,'home'),AKARI_HOME:path.join(temp,'akari-home'),THEIA_CONFIG_DIR:path.join(temp,'theia-config'),AKARI_GENERATE_CLI:path.join(root,'scripts/fake-akari-cli.mjs'),AKARI_AI_NARRATION_CONTROL_FILE:control,AKARI_AI_NARRATION_CALLS_FILE:calls,AKARI_FAL_STUB_URL:falUrl};
 for(const k of ['ELECTRON_RUN_AS_NODE','FAL_KEY','FAL_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','GROQ_API_KEY'])delete env[k];
 electron=spawn(path.join(shell,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[shell,project,'--remote-debugging-port=9654','--user-data-dir='+path.join(temp,'user-data'),'--window-size=1650,1050','--no-sandbox'],{cwd:repo,env,stdio:'ignore'});
 const target=await(async()=>{for(let i=0;i<2000;i++){const x=await listTargets(9654).then(xs=>xs.find(x=>x.type==='page')).catch(()=>null);if(x)return x;await sleep(300)}throw new Error('CDP absent')})();
 c=new CDP(target.webSocketDebuggerUrl);await c.connect();await c.send('Page.enable');await c.send('Runtime.enable');
 await wait(c,`Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`,'Theia',600000);
 await wait(c,`(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||!r.width||!r.height})()`,'preload hidden',480000);
 if(!await evalOn(c,`Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`))await evalOn(c,command('akari.annotations.open'));
 await wait(c,`Boolean(document.querySelector('[data-akari-item-id="frame-b"]'))`,'timeline',300000);
 await evalOn(c,command('akari.inspector.open')).catch(()=>null);
 await wait(c,`Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`,'inspector');
 await openPanel(c,'frame-b');
 await wait(c,`Boolean(document.querySelector('[data-akari-narration-engine="voicevox"] select option'))`,'voices');
 const defaults=await evalOn(c,`[...document.querySelectorAll('.akari-inspector-ai-narration-engine-checkbox')].map(e=>({id:e.value,checked:e.checked}))`);
 check('usual one checked',defaults.filter(x=>x.checked).length===1&&defaults.find(x=>x.id==='voicevox')?.checked,defaults);
 await shot(c,'01-default-one.png');
 await script(c,'三つの声で聴き比べます');
 await click(c,'[data-akari-narration-engine="gemini-tts"] input[type="checkbox"]');
 await click(c,'[data-akari-narration-engine="fal-qwen3"] input[type="checkbox"]');
 await wait(c,`[...document.querySelectorAll('.akari-inspector-ai-narration-engine-checkbox')].filter(e=>e.checked).length===3`,'three selected');
 await wait(c,`[...document.querySelectorAll('.akari-inspector-ai-narration-engine-checkbox')].filter(e=>e.checked).every(e=>document.querySelector('[data-akari-narration-engine="'+e.value+'"] select option'))`,'three voices');
 await shot(c,'02-three-selected.png');
 const estimates=()=>`[...document.querySelectorAll('[data-akari-narration-engine]')].map(e=>({engine:e.getAttribute('data-akari-narration-engine'),text:e.querySelector('.akari-inspector-ai-narration-engine-estimate')?.textContent}))`;
 const estimateBefore=await evalOn(c,estimates());
 await evalOn(c,`(()=>{const e=document.querySelector('.akari-inspector-ai-narration-panel textarea[aria-label=\"読み\"]');e.value='あ'.repeat(1000);e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
 const estimateAfter=await evalOn(c,estimates());
 check('row estimates update with reading',estimateBefore.find(x=>x.engine==='gemini-tts')?.text!==estimateAfter.find(x=>x.engine==='gemini-tts')?.text
   &&estimateAfter.find(x=>x.engine==='voicevox')?.text==='無料'
   &&estimateAfter.find(x=>x.engine==='gemini-tts')?.text==='見積 $0.040'
   &&estimateAfter.find(x=>x.engine==='fal-qwen3')?.text==='見積 $0.200',{before:estimateBefore,after:estimateAfter});
 await shot(c,'02b-row-estimates.png');
 await evalOn(c,`(()=>{const e=document.querySelector('.akari-inspector-ai-narration-panel textarea[aria-label=\"読み\"]');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
 await click(c,'.akari-inspector-ai-narration-button');
 const denied=await dialog(c,false);await sleep(300);
 check('one aggregate denial without request',(await received()).length===0&&falRequests.length===0&&denied.text.includes('合計'),{buttons:denied.buttons,received:(await received()).length});
 await shot(c,'03-approval-denied.png');
 await click(c,'.akari-inspector-ai-narration-button');
 const accepted=await dialog(c,true);
 check('one aggregate approval',accepted.text.includes('合計')&&accepted.text.includes('Gemini')&&accepted.text.includes('自声'),accepted);
 await wait(c,`Boolean(document.querySelector('.akari-inspector-ai-narration-route-progress'))`,'running');
 await wait(c,`[...document.querySelectorAll('[data-akari-item-id=\"frame-b\"]')].some(e=>e.textContent.includes('案作成中'))`,'timeline running chip',17000);
 const during=await evalOn(c,`({rows:[...document.querySelectorAll('.akari-inspector-ai-narration-route-progress')].map(e=>e.textContent),progress:document.querySelector('.akari-inspector-ai-narration-progress')?.textContent,chip:[...document.querySelectorAll('[data-akari-item-id="frame-b"]')].map(e=>e.textContent).join('|')})`);
 check('three rows and timeline chip',during.rows.length>=2&&during.progress?.includes('3 案作成中')&&during.chip.includes('3 案作成中'),during);
 await shot(c,'04-three-running.png');
 await wait(c,`document.querySelectorAll('[data-akari-narration-candidate]').length>=3`,'three candidates',120000);
 const candidates=await evalOn(c,`[...document.querySelectorAll('[data-akari-narration-candidate]')].map(e=>({engine:e.getAttribute('data-akari-narration-candidate'),text:e.innerText}))`);
 check('three candidates',candidates.length===3,candidates);
 const callsThree=await received();check('three engines received together',new Set(callsThree.map(x=>x.engine)).size===3&&Math.max(...callsThree.map(x=>x.at))-Math.min(...callsThree.map(x=>x.at))<3000,callsThree);
 results.observations.three=candidates;results.observations.received=callsThree;results.observations.falStub={count:falRequests.length,engines:falRequests.map(x=>x.engine),arrivalWindowMs:falRequests.length?Math.max(...falRequests.map(x=>x.at))-Math.min(...falRequests.map(x=>x.at)):0};
 const before=await edit();results.observations.editBefore=hash(before);
 check('candidates leave edit unchanged',hash(await edit())===hash(before),hash(await edit()));
 const settledCandidates=await waitFrameUi(c,`!ui.progress&&ui.button==='3 案を作る'&&ui.buttonDisabled===false&&ui.candidates===3`,'three candidates settled');
 check('three candidates visible after completion',true,settledCandidates);
 await shot(c,'05-three-candidates.png');
 await click(c,'[data-akari-narration-candidate="voicevox"] .akari-inspector-ai-narration-play');
 const playback=await wait(c,`(()=>{const b=document.querySelector('[data-akari-narration-candidate="voicevox"] .akari-inspector-ai-narration-play');return b?.textContent==='■'?{button:b.textContent}:null})()`,'play state');
 check('panel playback active',playback.button==='■',playback);results.observations.playback=playback;
 await shot(c,'06-playing.png');
 let adopted;
 for(let attempt=0;attempt<3&&!adopted;attempt++){
   await click(c,'[data-akari-narration-candidate="gemini-tts"] .akari-inspector-ai-narration-adopt');
   for(let i=0;i<50;i++){const e=await edit();if(e!==before){adopted=e;break}await sleep(200)}
 }
 if(!adopted)throw new Error('adopt edit timeout');
 check('adopt changes edit',adopted.includes('out/narration/n-0001.mp3'),{hash:hash(adopted)});results.observations.editAdopted=hash(adopted);
 const adoptedUi=await waitFrameUi(c,`ui.timeline.includes('n-0001.mp3')&&ui.placement.includes('置きました')`,'adopt visible in timeline');
 check('adopt visible in timeline',true,adoptedUi);
 await shot(c,'07-adopted.png');
 await click(c,'.akari-annotations-widget button[aria-label="元に戻す"]');
 await wait(c,`Boolean(document.querySelector('[data-akari-item-id="frame-b"]'))`,'undo UI');
 const undone=await(async()=>{for(let i=0;i<150;i++){const e=await edit();if(e===before)return e;await sleep(200)}throw new Error('undo timeout')})();
 check('one undo restores edit',hash(undone)===hash(before),hash(undone));
 check('candidates remain after undo',await evalOn(c,`document.querySelectorAll('[data-akari-narration-candidate]').length>=3`),true);
 const undoneUi=await waitFrameUi(c,`!ui.timeline.includes('n-0001.mp3')&&(ui.timeline.includes('frame-audio-b.wav')||ui.timeline.includes('候補'))&&ui.candidates>=3`,'undo visible in timeline');
 check('undo visible in timeline',true,undoneUi);
 await shot(c,'08-undo-candidates.png');
 await writeFile(control,JSON.stringify({failEngine:'gemini-tts'}));
 await click(c,'.akari-inspector-ai-narration-button');await dialog(c,true);
 await wait(c,`[...document.querySelectorAll('[data-akari-narration-candidate]')].some(e=>e.textContent.includes('stub model failure'))`,'failed engine',120000);
 const failed=await evalOn(c,`[...document.querySelectorAll('[data-akari-narration-candidate]')].map(e=>e.innerText)`);
 check('failure keeps other candidates',failed.some(x=>x.includes('stub model failure'))&&failed.filter(x=>!x.includes('stub model failure')).length>=2,failed);
 await shot(c,'09-one-failed.png');
 await wait(c,`!document.querySelector('.akari-inspector-ai-narration-progress')&&!document.querySelector('.akari-inspector-ai-narration-button')?.disabled`,'batch settled');
 await writeFile(control,JSON.stringify({}));
 await click(c,'[data-akari-narration-engine="gemini-tts"] input[type="checkbox"]');
 await click(c,'[data-akari-narration-engine="fal-qwen3"] input[type="checkbox"]');
 await wait(c,`[...document.querySelectorAll('.akari-inspector-ai-narration-engine-checkbox')].filter(e=>e.checked).length===1`,'one selected');
 await script(c,'一案だけの自動採用');
 const singleBefore=await edit();await click(c,'.akari-inspector-ai-narration-button');
 const singleAfter=await(async()=>{for(let i=0;i<150;i++){const e=await edit();if(e!==singleBefore)return e;await sleep(200)}throw new Error('single auto adopt timeout')})();
 check('single candidate automatically adopted',singleAfter.includes('out/narration/n-0002.wav'),{hash:hash(singleAfter)});
 const singleUi=await waitFrameUi(c,`ui.timeline.includes('n-0002.wav')&&ui.placement.includes('置きました')`,'single auto visible in timeline');
 check('single auto visible in timeline',true,singleUi);
 await shot(c,'10-single-auto.png');
 results.status='pass';
}catch(e){results.status='fail';results.error=clean(e?.stack??e);console.error(e);process.exitCode=1;if(c)await shot(c,'zz-after-failure.png').catch(()=>{});}finally{results.observations.calls=await received().catch(()=>[]);results.summary={pass:results.checks.filter(x=>x.pass).length,fail:results.checks.filter(x=>!x.pass).length};await save();try{c?.close()}catch{}if(falServer)await new Promise(resolve=>falServer.close(resolve));if(electron&&electron.exitCode===null){electron.kill('SIGTERM');await sleep(1000);if(electron.exitCode===null&&electron.signalCode===null)electron.kill('SIGKILL')}await rm(temp,{recursive:true,force:true}).catch(()=>{})}
