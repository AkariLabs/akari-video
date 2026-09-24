#!/usr/bin/env node
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import canonical from '../../../../../packages/edit-store/lib/canonical.js';
import { resolveGpuLauncher } from '../../../../../packages/gpu-export/src/runner.mjs';
import { resolveOsrLauncher } from '../../../../../packages/osr-export/src/index.mjs';

const [,, mode, workspace] = process.argv;
if (!['before','after'].includes(mode) || !workspace?.includes('cut-keyframe-size-basis')) throw Error('usage: run-capture.mjs before|after <dedicated workspace>');
const repo=fileURLToPath(new URL('../../../../../',import.meta.url));
const evidence=fileURLToPath(new URL('../',import.meta.url));
const project=path.join(workspace,'project');
const editPath=path.join(project,'edit.json');
const original=JSON.parse(await readFile(editPath,'utf8'));
const point=(t,variant=false)=>({t,transform:{x:variant?40:0,y:variant?-25:0,scale:variant?1.3:1,rotate:variant?20:0}});
const rows=[];
const states=process.env.CKB_CAPTURE_STATES?.split(',')??['zero','one','two-same','two-different','crop-static'];
for(const media of ['still','video']) for(const state of states) for(const engine of ['osr','gpu']) {
  const doc=structuredClone(original);
  doc.sources[0].path=media==='video'?'assets/video.mp4':'assets/still.png';
  const cut=doc.tracks[0].items[0];delete cut.keyframes;delete cut.crop;
  cut.transform={x:0,y:0,scale:1,rotate:0};
  if(state==='crop-static'){cut.crop={x:0.1,y:0.1,w:0.75,h:0.75};cut.transform.scale=2.25;}
  if(state==='one')cut.keyframes=[point(30)];
  if(state==='two-same')cut.keyframes=[point(30),point(90)];
  if(state==='two-different')cut.keyframes=[point(30),point(90,true)];
  await writeFile(editPath,canonical.serializeEdit(doc));
  const out=path.join(workspace,'capture',media,state,engine);
  await mkdir(out,{recursive:true});
  const env={...process.env,AKARI_EXPORT_ALLOW_DESKTOP:'0',AKARI_HOME:path.join(workspace,'cut-keyframe-size-basis-home')};
  const args=['packages/akari-tools/bin/capture.mjs','-p',project,'-t','1','--separate','--full','--engine',engine,'--out',out];
  const result=spawnSync(process.execPath,args,{cwd:repo,env,encoding:'utf8',timeout:180000});
  const launcher=engine==='gpu' ? await resolveGpuLauncher({env}) : await resolveOsrLauncher({env});
  const row={media,state,engine,launcher_tier:launcher?.tier??null,exit:result.status,error:result.error?.message??null};
  if(result.status!==0)row.failure=/2 要素以上/u.test(result.stderr||'')
    ? 'v2 schema requires at least 2 keyframes' : 'capture failed';
  if(result.status===0){
    const manifest=JSON.parse(await readFile(path.join(out,'capture.json'),'utf8'));
    row.receipt={engine:manifest.engine,verify:manifest.verify,edit_sha256:manifest.edit_sha256};
    const png=(await readdir(out)).find(f=>f.endsWith('-full.png'));
    if(png){const data=await readFile(path.join(out,png));row.sha256=createHash('sha256').update(data).digest('hex');row.bytes=data.length;
      if(['zero','two-same','crop-static'].includes(state))await copyFile(path.join(out,png),path.join(evidence,`${mode}-${media}-${state}-${engine}.png`));}
  }
  rows.push(row);
  console.error(`${media} ${state} ${engine}: ${row.exit} ${row.sha256??result.stderr?.slice(-180)??''}`);
  await writeFile(path.join(workspace,`capture-${mode}-progress.json`),JSON.stringify(rows));
}
await writeFile(path.join(evidence,`${mode}-capture.json`),`${JSON.stringify({mode,rows},null,2)}\n`);
