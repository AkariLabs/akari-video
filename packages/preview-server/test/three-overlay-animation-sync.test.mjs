// 回帰（2026-09-04 実機報告「3D モデルがずっと画面に残る」）:
// tick() の 3D 分岐が CSS アニメ同期の**手前**で continue していたため、3D 宣言を含む断片の
// CSS アニメが 1 本も pause / currentTime されず、壁時計で走り切って animation-fill-mode の
// 最終姿勢へ張り付いていた。実測した S4 断片は 3D ステージの出入りを 45 秒の CSS アニメだけで
// 持っているので、最終姿勢 = 画面中央に居座る絵になっていた。
//
// 書き出し（render-cut の rasterize.mjs）は __akariSyncAnimations を 3D コンテナにも等しく
// 掛けている。飛ばすとプレビューと書き出しで絵が食い違うため、ここは両者のパリティ条件。
// shell 側（packages/overlay-runtime）の同じ不具合は
// overlay-runtime/test-harness/overlay-runtime-tick.test.mjs が挙動で押さえている。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {existsSync, readFileSync} from 'node:fs';
import {browserManifest,runtimes} from '../../overlay-runtime/runtimes.mjs';
import {launchBrowser} from '../../overlay-runtime/test-harness/fixtures/browser.mjs';

const rasterize = await readFile(path.resolve(import.meta.dirname, '../../render-cut/src/rasterize.mjs'), 'utf8');
const probeOverlay = {
  id:'probe', start:2, duration:3,
  html:'<div style="position:absolute;inset:0"><style>@keyframes probeMove{to{transform:translateX(100px)}}.probe{animation:probeMove 5s linear both}</style><div class="probe">probe</div><canvas style="width:100%;height:100%"></canvas><script type="application/json" data-akari-3d-scene>{"texts":[{"id":"t","text":"A","mode":"flat"}]}</script></div>',
};

test('tick: CSS アニメ同期を 3D 分岐より先に通す（3D 断片を同期から外さない）', {timeout:30000}, async t => {
  // 意図: 壁時計で進めた CSS も各 tick の局所時刻へ戻り、登録済み three の render 時点で pause/currentTime が確定している。
  const browser=await launchBrowser(); t.after(()=>browser.close());
  const page=await browser.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request',async request=>request.respond(await previewResponse(new URL(request.url()).pathname) ?? {status:404,body:''}));
  await openPreview(page);
  await page.evaluate(overlay=>window.akari.runtime.mount({overlays:[overlay]}),probeOverlay);
  await page.waitForFunction(()=>{
    window.akari.runtime.tick(3.5);
    return window.akari.threeRuntime?.inspect(document.querySelector('[data-overlay-id="probe"]')).status==='ready';
  });
  const calls=await page.evaluate(()=>{
    const container=document.querySelector('[data-overlay-id="probe"]');
    const entry=window.akari.runtimes.forContainer(container).find(entry=>entry.id==='three');
    const observed=[];
    window.akari.runtimes.register({...entry,render(el,seconds,options){
      observed.push({seconds,animations:el.getAnimations({subtree:true}).map(animation=>({time:animation.currentTime,state:animation.playState}))});
      entry.render(el,seconds,options);
    }});
    for (const time of [3.5,2.25,4.5]) {
      for (const animation of container.getAnimations({subtree:true})) {animation.play();animation.currentTime=4321;}
      window.akari.runtime.tick(time);
    }
    return observed;
  });
  assert.deepEqual(calls,[
    {seconds:1.5,animations:[{time:1500,state:'paused'}]},
    {seconds:0.25,animations:[{time:250,state:'paused'}]},
    {seconds:2.5,animations:[{time:2500,state:'paused'}]},
  ]);
  assert.deepEqual(errors,[]);
});

// Serve the unmodified editor and manifest over intercepted browser requests; no source extraction or TCP listener.
async function previewResponse(urlPath) {
  const publicRoot = new URL('../../preview-server/public/', import.meta.url);
  const packageRoot = new URL('../../overlay-runtime/', import.meta.url);
  const manifest = browserManifest();
  if (urlPath === '/runtimes.json') return {contentType:'application/json',body:JSON.stringify(manifest)};
  if (urlPath === '/api/output/summary') return {contentType:'application/json',body:JSON.stringify({version:1,output:{width:1920,height:1080,fps:30},sources:[],cuts:[],overlays:[],layers:[],audio:{}})};
  if (urlPath === '/api/output/timeline') return {contentType:'application/json',body:JSON.stringify({fps:30,clips:[]})};
  if (urlPath === '/api/output/captions.json') return {contentType:'application/json',body:'[]'};
  let file;
  if (urlPath === '/') file = new URL('index.html', publicRoot);
  else if (urlPath === manifest.registry) file = new URL('src/runtime-registry.js', packageRoot);
  else if (urlPath === '/__akari/fonts/zen-kaku-gothic-new-black.ttf') file = new URL('test-harness/fonts/ZenKakuGothicNew-Black.ttf', packageRoot);
  else if (urlPath === '/assets/fonts/akari-noto-sans-jp.ttf') file = new URL('../../../assets/font/noto-sans-jp/NotoSansJP-Variable.ttf', import.meta.url);
  for (const [i, entry] of manifest.runtimes.entries()) for (const [j, script] of entry.scripts.entries()) {
    if (urlPath === script.url) file = new URL(runtimes[i].scripts[j].path, packageRoot);
  }
  if (!file && /^\/[\w.-]+$/.test(urlPath)) {
    const name = urlPath.substring(1);
    file = [new URL(name, publicRoot),new URL('src/'+name,packageRoot),new URL('src/vendor/'+name,packageRoot)].find(candidate=>existsSync(candidate));
  }
  if (!file) return null;
  const type = file.pathname.endsWith('.html') ? 'text/html' : file.pathname.endsWith('.css') ? 'text/css' : file.pathname.endsWith('.ttf') ? 'font/ttf' : 'text/javascript';
  return {contentType:type,body:readFileSync(file)};
}
async function openPreview(page) {
  await page.goto('http://localhost/?mode=output&frameEngine=0');
  await page.waitForFunction(()=>Boolean(window.akari?.runtime && window.akari?.state));
  await page.evaluate(()=>window.__akariCaptionFontReady);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

test('tick: CSS 同期を通したうえで three の描画も従来どおり呼ぶ', async t => {
  // 意図: 実際の共通 tick が CSS を同期してから、登録済み three へ局所秒とプレビュー options を渡す。
  const browser = await launchBrowser(); t.after(()=>browser.close());
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request',async request=>request.respond(await previewResponse(new URL(request.url()).pathname) ?? {status:404,body:''}));
  await openPreview(page);
  await page.evaluate(()=>window.akari.runtime.mount({overlays:[{id:'probe',start:2,duration:3,html:'<div style="position:absolute;inset:0"><style>@keyframes probeMove{to{transform:translateX(100px)}}.probe{animation:probeMove 5s linear both}</style><div class="probe">probe</div><canvas style="width:100%;height:100%"></canvas><script type="application/json" data-akari-3d-scene>{"texts":[{"id":"t","text":"A","mode":"flat"}]}</script></div>'}]}));
  await page.waitForFunction(()=>{window.akari.runtime.tick(3.5);return window.akari.threeRuntime?.inspect(document.querySelector('[data-overlay-id="probe"]')).status==='ready';});
  const observations=await page.evaluate(()=>{
    const entry=window.akari.runtimes.list().find(entry=>entry.id==='three');
    const calls=[];
    window.akari.runtimes.register({...entry,render(el,seconds,options){
      calls.push({id:el.dataset.overlayId,seconds,options,cssTimes:el.getAnimations({subtree:true}).map(animation=>animation.currentTime)});
      entry.render(el,seconds,options);
    }});
    window.akari.threeRuntime.render=()=>{throw new Error('tick bypassed the registry');};
    window.akari.runtime.tick(3.5);
    window.akari.runtime.tick(2.5);
    return calls;
  });
  assert.deepEqual(observations,[
    {id:'probe',seconds:1.5,options:{syncVideos:true,maxRenderSize:720,previewScale:0.5,fps:30},cssTimes:[1500]},
    {id:'probe',seconds:0.5,options:{syncVideos:true,maxRenderSize:720,previewScale:0.5,fps:30},cssTimes:[500]},
  ]);
  assert.deepEqual(errors,[]);
});

test('tick: three ランタイム読み込み待ちでも CSS 同期は止めない', {timeout:30000}, async t => {
  // 意図: three の取得を保留して未登録を保証した状態でも、tick は CSS を pause し局所時刻へ同期する。
  const browser=await launchBrowser(); t.after(()=>browser.close());
  const page=await browser.newPage();
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const scriptUrls=new Set(browserManifest().runtimes.find(entry=>entry.id==='three').scripts.map(script=>script.url));
  const heldRequests=[];
  let markBlocked;
  const blocked=new Promise(resolve=>{markBlocked=resolve;});
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    if (scriptUrls.has(new URL(request.url()).pathname)) {
      heldRequests.push(request); markBlocked(); return; // Keep the script pending until browser cleanup.
    }
    return request.respond(await previewResponse(new URL(request.url()).pathname) ?? {status:404,body:''});
  });
  await openPreview(page);
  await page.evaluate(overlay=>window.akari.runtime.mount({overlays:[overlay]}),probeOverlay);
  await blocked;
  assert.equal(heldRequests.length,1,'the first dependency must still be pending');
  const observations=await page.evaluate(async ()=>{
    const container=document.querySelector('[data-overlay-id="probe"]');
    const result=[];
    for (const time of [3.5,2.25]) {
      for (const animation of container.getAnimations({subtree:true})) {animation.play();animation.currentTime=4321;}
      window.akari.runtime.tick(time);
      const snapshot=()=>({
        globalPresent:Boolean(window.akari.threeRuntime),
        registryIds:window.akari.runtimes.forContainer(container).map(entry=>entry.id),
        animations:container.getAnimations({subtree:true}).map(animation=>({time:animation.currentTime,state:animation.playState})),
      });
      const atTick=snapshot();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      result.push({atTick,afterFrames:snapshot()});
    }
    return result;
  });
  assert.deepEqual(observations,[1500,250].map(time=>{
    const snapshot={globalPresent:false,registryIds:[],animations:[{time,state:'paused'}]};
    return {atTick:snapshot,afterFrames:snapshot};
  }));
  assert.deepEqual(errors,[]);
});

test('書き出し側は 3D コンテナも同じ __akariSyncAnimations に掛ける（パリティの根拠）', () => {
  const seek = rasterize.slice(rasterize.indexOf('window.__akariSeek = async function(seconds)'));
  const loopEnd = seek.indexOf('window.__akariSyncAnimations(seconds);');
  assert.ok(loopEnd > 0, '__akariSeek が __akariSyncAnimations を呼んでいない');
  // 3D コンテナは pendingThreeDraws へ積むだけで、continue も除外もしない
  assert.doesNotMatch(seek.slice(0, loopEnd), /continue;/u);
});
