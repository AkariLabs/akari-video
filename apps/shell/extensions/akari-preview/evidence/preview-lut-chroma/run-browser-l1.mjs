#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const chrome = process.env.AKARI_REAL_CHROME;
if (!chrome) throw new Error('AKARI_REAL_CHROME is required');
const harness = pathToFileURL(path.join(repo, 'apps/shell/extensions/akari-preview/evidence/preview-lut-chroma/browser-harness.html')).href;
const browserProfile = path.join(process.env.TMPDIR || '/tmp', `akari-video-fx-browser-${process.pid}`);
const fnv=bytes=>{let h=0x811c9dc5;for(const b of bytes){h^=b;h=Math.imul(h,0x01000193);}return(h>>>0).toString(16).padStart(8,'0');};
const expected=(project,kind)=>{const p=path.join(repo,'dev-fixtures/preview-lut-chroma',project,'exports/reference.mp4');const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-ss',kind==='transition'?'1.5':'1','-i',p,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','pipe:1'],{encoding:null,maxBuffer:4e6});if(r.status!==0)throw new Error(String(r.stderr));return r.stdout;};
const unescapeHtml=value=>value.replace(/&quot;/gu,'"').replace(/&lt;/gu,'<').replace(/&gt;/gu,'>').replace(/&amp;/gu,'&');
const allCases=[['source','a-source-chroma'],['lut100','b-lut-100'],['lut050','b-lut-050'],['lut100-webgl1','b-lut-100'],['lut050-webgl1','b-lut-050'],['layer','d-layer-chroma'],['transition',null],['inert',null],['failure',null]];
const selectedKinds=new Set((process.env.AKARI_KIND||'').split(',').filter(Boolean));
const cases=selectedKinds.size?allCases.filter(([kind])=>selectedKinds.has(kind)):allCases;
const results=[];
for(const [kind,project] of cases){
  let run,match;
  for(let attempt=1;attempt<=3&&!match;attempt+=1){run=spawnSync(chrome,['--single-process','--headless=new','--no-sandbox','--disable-gpu','--disable-gpu-vsync','--disable-frame-rate-limit','--enable-unsafe-swiftshader','--use-angle=swiftshader','--allow-file-access-from-files','--disable-web-security','--run-all-compositor-stages-before-draw','--virtual-time-budget=12000',`--user-data-dir=${browserProfile}-${attempt}`,'--dump-dom',`${harness}?kind=${kind}`],{encoding:'utf8',maxBuffer:4e6,timeout:30000});match=/<pre id="result">([\s\S]*?)<\/pre>/u.exec(run.stdout||'');}
  if(!match){results.push({kind,status:'FAIL',error:(run.stderr||run.stdout||'no DOM result').slice(-1000)});continue;}
  const measured=JSON.parse(unescapeHtml(match[1]));const actual=Buffer.from(measured.rgba,'base64');let mad=null,exportFnv=null;
  const whiteBounds=bytes=>{let minX=320,minY=180,maxX=-1,maxY=-1,count=0;for(let i=0;i<bytes.length;i+=4){if(bytes[i]>240&&bytes[i+1]>240&&bytes[i+2]>240){const p=i/4,x=p%320,y=Math.floor(p/320);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);count+=1;}}return{minX,minY,maxX,maxY,count};};
  let exportSamples=null,regions=null,white={preview:whiteBounds(actual),export:null};
  if(project){const exp=expected(project,kind);white.export=whiteBounds(exp);exportFnv=fnv(exp);let sum=0,inside=0,outside=0,insideN=0,outsideN=0;for(let i=0;i<actual.length;i+=4){const pixel=i/4,x=pixel%320,y=Math.floor(pixel/320),delta=Math.abs(actual[i]-exp[i])+Math.abs(actual[i+1]-exp[i+1])+Math.abs(actual[i+2]-exp[i+2]);sum+=delta;if(x>=110&&x<210&&y>=40&&y<140){inside+=delta;insideN+=3;}else{outside+=delta;outsideN+=3;}}mad=sum/((actual.length/4)*3*255);regions={inside:inside/(insideN*255),outside:outside/(outsideN*255)};const at=(x,y)=>Array.from(exp.subarray((y*320+x)*4,(y*320+x)*4+4));exportSamples={corner:at(10,10),center:at(160,90),orange:at(40,40),green:at(250,130),layerGreen:at(120,50),layerBase:at(130,120)};}
  const webGl1Ok=!kind.endsWith('-webgl1')||measured.inspect.every(rail=>rail.webglVersion===1);
  const pass=project?mad<=.01&&measured.fnv===measured.repeatFnv&&webGl1Ok:kind==='transition'?measured.railCount===2&&measured.fnv===measured.repeatFnv:kind==='inert'?measured.railCount===0:measured.status==='failed'&&measured.railCount===0&&measured.badge==='LUT';
  results.push({kind,status:pass?'PASS':'FAIL',mad,regions,white,previewFnv:measured.fnv,repeatFnv:measured.repeatFnv,exportFnv,railCount:measured.railCount,badge:measured.badge,inspect:measured.inspect,samples:measured.samples,mediaSamples:measured.mediaSamples,exportSamples});
}
const report={status:results.every(x=>x.status==='PASS')?'PASS':'FAIL',results};
if(process.env.AKARI_NO_WRITE!=='1')await writeFile(new URL('run-log.json',import.meta.url),`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify(report,null,2));
if(report.status!=='PASS')process.exitCode=1;
