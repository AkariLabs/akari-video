#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.resolve(root, '../../../../../../');
const shell = process.env.L1_SHELL ? path.resolve(process.env.L1_SHELL) : path.join(repo, 'apps/shell');
const temp = await mkdtemp(path.join(os.tmpdir(), 'gen-compare-narration-before-'));
const project = path.join(temp, 'project');
const port = 9654;
const result = { phase: 'before', baseBuild: process.env.L1_SHELL ? 'a86274be5' : 'current', status: 'running', checks: [], screenshots: [] };
const redact = value => String(value).replaceAll(repo, '<WORKTREE>').replaceAll(temp, '<TMP>').replaceAll(os.homedir(), '<HOME>').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '<email>');
const save = async () => { const p=path.join(root,'results-before.json'); await writeFile(p+'.tmp',redact(JSON.stringify(result,null,2))+'\n'); await rename(p+'.tmp',p); };
const check = (name, pass, measured) => { result.checks.push({name,pass:!!pass,measured}); if(!pass) throw new Error(name+': '+JSON.stringify(measured)); };
async function wait(cdp,expr,name,ms=120000){const until=Date.now()+ms;while(Date.now()<until){const v=await evalOn(cdp,expr).catch(()=>null);if(v)return v;await sleep(200)}throw new Error('timeout '+name)}
const run = (cmd,args) => new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.once('error',reject);p.once('close',code=>code?reject(new Error(err)):resolve(out));});
async function shot(cdp,name){const selector=name==='00-before-placed-timeline.png'?'[data-akari-ui=\"panel:timeline\"]':'[data-akari-ui=\"panel:inspector\"]';const clip=await evalOn(cdp,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height,scale:1}})()`);const {data}=await cdp.send('Page.captureScreenshot',{format:'png',clip});const b=Buffer.from(data,'base64');await writeFile(path.join(root,name),b);result.screenshots.push({name,bytes:b.length});await save()}
const command=id=>`(async()=>{const c=window.theia.container,d=c._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');await c.get(C).executeCommand(${JSON.stringify(id)});return true})()`;
let electron,cdp;
try{
 await run(process.execPath,[path.join(root,'scripts/gen-fixture.mjs'),project]);
 for(const name of ['home','akari-home','theia-config','user-data'])await mkdir(path.join(temp,name));
 const control=path.join(temp,'control.json'),calls=path.join(temp,'calls.jsonl');
 await writeFile(control,JSON.stringify({mode:'slow',seconds:1.7,delaySeconds:12}));await writeFile(calls,'');
 const env={...process.env,HOME:path.join(temp,'home'),AKARI_HOME:path.join(temp,'akari-home'),THEIA_CONFIG_DIR:path.join(temp,'theia-config'),AKARI_GENERATE_CLI:path.join(root,'scripts/fake-before-cli.mjs'),AKARI_AI_NARRATION_CONTROL_FILE:control,AKARI_AI_NARRATION_CALLS_FILE:calls};
 for(const k of ['ELECTRON_RUN_AS_NODE','FAL_KEY','FAL_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','GROQ_API_KEY'])delete env[k];
 electron=spawn(path.join(shell,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[shell,project,'--remote-debugging-port='+port,'--user-data-dir='+path.join(temp,'user-data'),'--window-size=1600,1000','--no-sandbox'],{cwd:repo,env,stdio:'ignore'});
 const target=await(async()=>{for(let i=0;i<2000;i++){const x=await listTargets(port).then(xs=>xs.find(x=>x.type==='page')).catch(()=>null);if(x)return x;await sleep(300)}throw new Error('CDP absent')})();
 cdp=new CDP(target.webSocketDebuggerUrl);await cdp.connect();await cdp.send('Page.enable');await cdp.send('Runtime.enable');
 await wait(cdp,`Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`,'Theia',600000);
 await wait(cdp,`(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||!r.width||!r.height})()`,'preload hidden',480000);
 if(!await evalOn(cdp,`Boolean(document.querySelector('[data-akari-ui="timeline:cut:0"]'))`))await evalOn(cdp,command('akari.annotations.open'));
 await wait(cdp,`Boolean(document.querySelector('[data-akari-item-id="frame-b"]'))`,'timeline',300000);
 await evalOn(cdp,command('akari.inspector.open')).catch(()=>null);
 await wait(cdp,`Boolean(document.querySelector('[data-akari-ui="panel:inspector"]'))`,'inspector');
 let selected=false;
 for(let attempt=0;attempt<4&&!selected;attempt++){
   const p=await evalOn(cdp,`(()=>{const e=document.querySelector('[data-akari-ui="panel:timeline"] [data-akari-item-id="frame-b"]');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
   if(p)await realClick(cdp,p.x,p.y);
   selected=!!await wait(cdp,`Boolean(document.querySelector('[data-akari-inspector-ai-tile="narration"]')||document.querySelector('.akari-inspector-ai-narration-panel'))`,'tile',8000).catch(()=>false);
 }
 if(!selected)throw new Error('narration tile did not appear');
 await evalOn(cdp,`document.querySelector('[data-akari-inspector-ai-tile="narration"]')?.click()`);
 await wait(cdp,`Boolean(document.querySelector('.akari-inspector-ai-narration-panel'))`,'panel');
 const radios=await evalOn(cdp,`[...document.querySelectorAll('.akari-inspector-ai-narration-engine-radio')].map(e=>({id:e.value,checked:e.checked,type:e.type}))`);
 check('single engine radio',radios.length>0&&radios.every(x=>x.type==='radio')&&radios.filter(x=>x.checked).length===1,radios);
 await shot(cdp,'00-before-radio.png');
 await evalOn(cdp,`(()=>{const e=document.querySelector('.akari-inspector-ai-narration-panel textarea[aria-label="原稿"]');e.value='BEFORE 用の短い原稿です';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
 await wait(cdp,`!document.querySelector('.akari-inspector-ai-narration-button')?.disabled`,'ready');
 await evalOn(cdp,`document.querySelector('.akari-inspector-ai-narration-button')?.click()`);
 await wait(cdp,`Boolean(document.querySelector('.akari-inspector-ai-narration-progress'))`,'running');
 const beforeEdit=await readFile(path.join(project,'edit.json'),'utf8');
 const sourceFor=e=>{const d=JSON.parse(e),item=d.tracks.flatMap(t=>t.items??[]).find(x=>x.id==='frame-b');return d.sources.find(x=>x.id===item?.source?.src)?.path??null};
 const state=await evalOn(cdp,`(()=>({progress:document.querySelector('.akari-inspector-ai-narration-progress')?.textContent,buttons:[...document.querySelectorAll('.akari-inspector-ai-narration-button')].map(e=>({text:e.textContent,disabled:e.disabled})),radios:[...document.querySelectorAll('.akari-inspector-ai-narration-engine-radio')].map(e=>({id:e.value,checked:e.checked}))}))()`);
 check('running UI has no second start',state.buttons.some(x=>x.text.includes('生成中')&&x.disabled),state);
 await shot(cdp,'00-before-running.png');
 result.secondStart={uiDisabled:true,engineChoices:'radio',attempted:false};
 const until=Date.now()+90000;let afterEdit;while(Date.now()<until){const current=await readFile(path.join(project,'edit.json'),'utf8');if(sourceFor(current)?.startsWith('out/narration/')){afterEdit=current;break}await sleep(200)}
 check('generation immediately places narration',!!afterEdit,{beforeSource:sourceFor(beforeEdit),afterSource:afterEdit?sourceFor(afterEdit):null});
 result.placement={beforeSha256:createHash('sha256').update(beforeEdit).digest('hex'),afterSha256:createHash('sha256').update(afterEdit).digest('hex'),beforeSource:sourceFor(beforeEdit),afterSource:sourceFor(afterEdit)};
 await wait(cdp,`Boolean(document.querySelector('[data-akari-item-id=\"frame-b\"]'))`,'placed timeline');
 const placedInspector=await wait(cdp,`document.querySelector('[data-akari-ui=\"panel:inspector\"]')?.textContent.includes('n-0001.wav')`,'placed inspector',30000);
 check('placed narration visible in inspector',placedInspector,true);
 await shot(cdp,'00-before-placed.png');result.status='pass';
}catch(e){result.status='fail';result.error=redact(e?.stack??e);console.error(e);process.exitCode=1;if(cdp)await shot(cdp,'00-before-failure.png').catch(()=>{});}finally{await save();try{cdp?.close()}catch{}if(electron&&electron.exitCode===null){electron.kill('SIGTERM');await sleep(1000);if(electron.exitCode===null&&electron.signalCode===null)electron.kill('SIGKILL')}await rm(temp,{recursive:true,force:true}).catch(()=>{})}
