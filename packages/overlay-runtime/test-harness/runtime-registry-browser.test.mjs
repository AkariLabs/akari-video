import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {launchBrowser} from './fixtures/browser.mjs';
import './fixtures/dummy-entry.mjs';
import {renderOverlaySheet} from '../../render-cut/src/rasterize.mjs';
import {browserManifest,runtimes,runtimeRoot,registryPath} from '../runtimes.mjs';
const base = new URL('../../render-cut/src/rasterize.mjs',import.meta.url);
const dummyHtml = '<div><script type="application/json" data-akari-dummy-scene>{"image":"image.png","color":"blue"}</script></div>';
const md5 = value => createHash('md5').update(value).digest('hex');

test('third runtime paints raster frames and overlay tick seeks/disposes through the registry', {timeout:60000}, async t => {
  const browser = await launchBrowser(); t.after(()=>browser.close());
  const root=mkdtempSync(join(tmpdir(),'akari-registry-browser-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'image.png'),'fixture');
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewport({width:32,height:32});
  const sheet=renderOverlaySheet({projectRoot:root,edit:{output:{width:32,height:32,fps:30}},duration:5,overlays:[{id:'d',html:dummyHtml,htmlPath:'fragment.html',start:2,duration:3}]});
  writeFileSync(join(root,'sheet.html'),sheet);
  await page.goto(pathToFileURL(join(root,'sheet.html')).href);await page.evaluate(()=>window.__akariReady);
  const pixel=()=>page.evaluate(()=>[...document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data]);
  await page.evaluate(()=>window.__akariSeek(2.5));assert.deepEqual(await pixel(),[255,0,0,255]);
  await page.evaluate(()=>window.__akariSeek(3.5));assert.deepEqual(await pixel(),[0,0,255,255]);
  await page.evaluate(()=>window.__akariSeek(2.5));assert.deepEqual(await pixel(),[255,0,0,255]);
  await page.setContent('<div id="overlay-stage" style="position:relative;width:32px;height:32px"></div>');
  await page.addScriptTag({path:fileURLToPath(new URL('../src/overlay-runtime.js',import.meta.url))});
  await page.evaluate(html=>window.akari.runtime.mount({overlays:[{id:'d',html,start:2,duration:3}]}),dummyHtml);
  await page.evaluate(()=>window.akari.runtime.tick(3.5));
  assert.deepEqual(await pixel(),[0,0,255,255]);
  const state=await page.evaluate(()=>window.akari.dummyRuntime.inspect(document.querySelector('[data-overlay-id]')));
  assert.equal(state.seconds,1.5);assert.equal(state.options.syncVideos,true);assert.equal(state.options.maxRenderSize,720);
  await page.evaluate(()=>window.akari.runtime.tick(2.5));assert.deepEqual(await pixel(),[255,0,0,255]);
  await page.evaluate(()=>window.akari.runtime.tick(5));assert.equal(await page.$('canvas'),null);
  await page.evaluate(()=>window.akari.runtime.tick(3.5));assert.deepEqual(await pixel(),[0,0,255,255]);
  await page.evaluate(()=>window.akari.runtime.unmount());assert.equal(await page.$('canvas'),null);
  assert.deepEqual(errors,[]);
});

// Before/after renderer code executes in the same Chrome; drawing sources are unchanged
// apart from optional trailing registration. No tracked evidence is overwritten.
test('three text and glass PNGs match the pre-registry renderer in both orientations', {timeout:240000}, async t => {
  const original=spawnSync('git',['show','eccb87efc659f60605268a491427653b86d80da2:packages/render-cut/src/rasterize.mjs'],{encoding:'utf8',maxBuffer:4e6});
  assert.equal(original.status,0,original.stderr);
  const source=original.stdout.replace(/from "(\.[^"]+)"/g,(_,specifier)=>`from "${new URL(specifier,base).href}"`).replaceAll('import.meta.url',JSON.stringify(base.href));
  const baseline=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const browser=await launchBrowser();t.after(()=>browser.close());
  const root=mkdtempSync(join(tmpdir(),'akari-registry-parity-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const errors=[];
  writeFileSync(join(root,'bg.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#246"/></svg>');
  const pack=process.env.AKARI_GLASS_PACK;
  const cases=[
    ['three','<div style="position:absolute;inset:0"><canvas data-akari-3d style="display:block;width:100%;height:100%"></canvas><script type="application/json" data-akari-3d-scene>{"texts":[{"id":"t","text":"A","mode":"flat","color":"#ffd166"}]}</script></div>',root],
    ['glass',pack ? readFileSync(join(pack,'fragment.html'),'utf8') : '<div><div data-akari-glass style="position:absolute;left:100px;top:100px;width:300px;height:120px;border-radius:30px"></div><script type="application/json" data-akari-glass-scene>{"backdrop":"bg.svg"}</script></div>',pack || root],
  ];
  for (const [id,html,projectRoot] of cases) for (const [width,height] of [[1920,1080],[1080,1920]]) {
    const input={projectRoot,edit:{output:{width,height,fps:30}},duration:6,overlays:[{id,html,htmlPath:'fragment.html',start:0,duration:6}]};
    const images=[];
    for (const renderer of [baseline.renderOverlaySheet,renderOverlaySheet]) {
      const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.setViewport({width,height,deviceScaleFactor:1});
      const file=join(root,'sheet.html');writeFileSync(file,renderer(input));
      await page.goto(pathToFileURL(file).href);await page.evaluate(()=>window.__akariReady);
      const state=await page.evaluate(id=>window.akari[id+'Runtime'].inspect(document.querySelector('.scene-content')),id);
      assert.equal(state.status,'ready',JSON.stringify(state));
      await page.evaluate(()=>window.__akariSeek(1.5));
      images.push(await page.screenshot());
      await page.close();
    }
    assert.equal(md5(images[1]),md5(images[0]),`${id} ${width}x${height} PNG parity`);
    t.diagnostic(`${id} ${width}x${height}: ${md5(images[1])}`);
    if (pack && id === 'glass') assert.equal(md5(images[1]),width===1920?'6d76f6a2b5dd479b5102c80e71942641':'16c2f2bc888f3eaedf1a46ba6815bafb');
  }
  assert.deepEqual(errors,[]);
});

test('preview ensureRuntimes loads only matching scripts and seeks three and glass', {timeout:90000}, async t => {
  const browser=await launchBrowser();t.after(()=>browser.close());
  const page=await browser.newPage();await page.setViewport({width:640,height:360});
  page.on('console',message=>{if(message.type()==='error')console.error(message.text());});
  const requests=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const manifest=browserManifest();
  await page.setRequestInterception(true);
  page.on('request',request=>{
    const path=new URL(request.url()).pathname;requests.push(path);
    if(path==='/runtimes.json')return request.respond({contentType:'application/json',body:JSON.stringify(manifest)});
    if(path===manifest.registry)return request.respond({contentType:'text/javascript',body:readFileSync(registryPath,'utf8')});
    for(const [index,entry]of manifest.runtimes.entries())for(const [n,script]of entry.scripts.entries())if(path===script.url)return request.respond({contentType:'text/javascript',body:readFileSync(resolve(runtimeRoot,runtimes[index].scripts[n].path),'utf8')});
    if(path==='/__akari/fonts/zen-kaku-gothic-new-black.ttf')return request.respond({contentType:'font/ttf',body:readFileSync(new URL('./fonts/ZenKakuGothicNew-Black.ttf',import.meta.url))});
    if(path==='/pack/bg.svg')return request.respond({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#246"/></svg>'});
    return request.respond({contentType:'text/html',body:'<div id="stage" style="position:relative;width:640px;height:360px"></div>'});
  });
  await page.goto('http://registry.test/');
  const app=readFileSync(new URL('../../preview-server/public/app.js',import.meta.url),'utf8');
  const loader=app.slice(app.indexOf('// --- Declarative runtime loading ---'),app.indexOf('let itemKeyframesRuntimeReady'));
  const runtime=app.slice(app.indexOf('function createOverlayRuntime()'),app.indexOf('function updateOverlays()'));
  await page.addScriptTag({content:`window.akari={};const stage=document.querySelector('#stage');const fps=30;const editMode=false;const PREVIEW_3D_MAX_RENDER_SIZE=720;const resolveMediaUrl=x=>x;function updateOverlays(){window.akari.runtime.tick(1.5);}${loader}${runtime}window.akari.runtime=createOverlayRuntime();`});
  for(const [id,html]of [
    ['three','<div style="position:absolute;inset:0"><canvas data-akari-3d style="display:block;width:100%;height:100%"></canvas><script type="application/json" data-akari-3d-scene>{"texts":[{"id":"t","text":"A","mode":"flat","color":"#ffd166"}]}</script></div>'],
    ['glass','<div><style>@keyframes slide{to{transform:translateX(80px)}}.g{position:absolute;left:100px;top:100px;width:300px;height:120px;border-radius:30px;animation:slide 4s linear both}</style><div class="g" data-akari-glass></div><script type="application/json" data-akari-glass-scene>{"backdrop":"bg.svg"}</script></div>'],
  ]){
    await page.evaluate(({id,html})=>window.akari.runtime.mount({overlays:[{id,html,htmlPath:'/pack/fragment.html',start:0,duration:6}]}),{id,html});
    await page.waitForFunction(id=>window.akari?.[id+'Runtime']?.inspect(document.querySelector('[data-overlay-id]')).status==='ready', {timeout:20000},id).catch(async error=>{throw new Error(`${id}: ${error.message}; state=${JSON.stringify(await page.evaluate(id=>window.akari?.[id+'Runtime']?.inspect(document.querySelector('[data-overlay-id]')),id))}; requests=${requests}`);});
    await page.evaluate(()=>window.akari.runtime.tick(1.5));const before=await page.screenshot();
    await page.evaluate(()=>window.akari.runtime.tick(2.5));
    await page.evaluate(()=>window.akari.runtime.tick(1.5));assert.equal(md5(await page.screenshot()),md5(before));
    if(process.env.AKARI_REGISTRY_EVIDENCE)writeFileSync(join(process.env.AKARI_REGISTRY_EVIDENCE,`preview-${id}.png`),before);
    await page.evaluate(()=>window.akari.runtime.tick(7));
    const disposed=await page.evaluate(id=>window.akari[id+'Runtime'].inspect(document.querySelector('[data-overlay-id]')),id);
    assert.equal(disposed.status,'disposed');
  }
  assert.ok(!requests.some(path=>path.includes('/dummy/')));
  assert.deepEqual(errors,[]);
});
