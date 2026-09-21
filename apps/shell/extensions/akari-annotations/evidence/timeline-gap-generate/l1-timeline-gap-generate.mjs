#!/usr/bin/env node
// Build the shell bundle first. No provider/paid calls. Node >=22 (native WebSocket).
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, screenshot, realClick } from '../generation-states/scripts/cdp-lib.mjs';
import { createFixture } from './gen-fixture.mjs';
import { validateGenerationMeta } from '../../../../../../packages/generate/src/cli/meta-validate.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ISO = await mkdtemp(path.join(tmpdir(), 'akari-gap-generate-l1-'));
const PROJECT = path.join(ISO, 'project');
const PORT = Number(process.argv.find(x => x.startsWith('--port='))?.slice(7) ?? 22219);
const output = { status: 'running', driver: 'Electron + CDP Input.dispatchMouseEvent', steps: [], screenshots: [], falRequests: [] };
const started = performance.now();
let child, cdp;
let log = '';
const clean = text => String(text).replaceAll(ISO, '<TEMP>').replaceAll(REPO, '<WORKTREE>');
const save = () => writeFile(path.join(ROOT, 'measurements.json'), clean(JSON.stringify(output, null, 2)) + '\n');
async function waitFor(operation, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let error;
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value; } catch (e) { error = e; }
    await sleep(150);
  }
  throw new Error(`Timed out: ${error?.message ?? 'condition'}`);
}
const evaluate = expression => evalOn(cdp, expression);
const waitEval = (expression, timeout) => waitFor(() => evaluate(expression), timeout);
const readEdit = async () => JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
async function step(name, operation, continueOnFailure = false) {
  const result = { name, pass: false }; output.steps.push(result);
  const start = performance.now();
  try { result.measurements = await operation(); result.pass = true; }
  catch (error) { result.error = clean(error.stack ?? error); if (!continueOnFailure) throw error; }
  finally { result.elapsedMs = Math.round(performance.now() - start); await save(); }
}
const LINK_STEP = 'captured last frame link indicator';
function measurementStatus(measurements) {
  if (measurements.steps.some(result => !result.pass)
      || measurements.linkIndicator?.observed !== true
      || measurements.linkIndicator.title !== '次のクリップの絵につながる') return 'fail';
  return 'pass';
}
async function shot(name) {
  await screenshot(cdp, path.join(ROOT, name)); output.screenshots.push(name); await save();
}

const GEOMETRY = `
 const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 const visible=n=>{if(!n?.getClientRects().length)return false;const r=n.getBoundingClientRect();
   if(r.width<=0||r.height<=0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;
   for(let a=n;a instanceof Element;a=a.parentElement){const s=getComputedStyle(a);
     if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)return false;}return true;};
 const painted=n=>{const s=getComputedStyle(n),opaque=c=>c!=='transparent'&&!/rgba\\([^)]*,\\s*0\\)/.test(c);
   return {background:s.backgroundColor,border:s.borderTopColor,borderWidth:s.borderTopWidth,
     painted:opaque(s.backgroundColor)||(parseFloat(s.borderTopWidth)>0&&s.borderTopStyle!=='none'&&opaque(s.borderTopColor))};};
`;
const intersects = (a,b) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>.1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.1;
const overlapPairs = rects => rects.flatMap((a,i)=>rects.slice(i+1).filter(b=>intersects(a,b)).map(b=>({a,b})));
const measureChipLayout = chip => ({
  foregroundOverlaps: overlapPairs(chip.foregroundRects),
  pictureOverlaps: overlapPairs(chip.frames),
  overlapsOnPictures: chip.foregroundRects.flatMap(a => chip.frames.filter(b => intersects(a,b)).map(b => ({a,b})))
});
function assertChipLayout(layout) {
  assert.deepEqual(layout.foregroundOverlaps,[],'chip foreground labels/symbols overlap');
  assert.deepEqual(layout.pictureOverlaps,[],'chip endpoint picture cells overlap');
}
async function clickSelector(selector) {
  const p=await waitEval(`(()=>{${GEOMETRY} const e=document.querySelector(${JSON.stringify(selector)});if(!visible(e))return null;
    const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await realClick(cdp,p.x,p.y);return p;
}
const GAP = `(()=>{${GEOMETRY}
 const p=document.querySelector('.akari-inspector-generation-gap'),b=document.querySelector('.akari-annotations-gap-band');
 if(!visible(p)||!visible(b))return null;
 const images=[...p.querySelectorAll('img')].map(e=>({loaded:e.complete&&e.naturalWidth>0,...rect(e)}));
 if(images.length!==2||!images.every(i=>i.loaded))return null;
 const s=getComputedStyle(b),button=p.querySelector('button');
 return {heading:p.querySelector('h3').textContent,range:p.querySelector('p').textContent,
   band:{...rect(b),border:s.borderTopStyle,background:s.backgroundColor},images,
   button:{text:button.textContent,...rect(button),...painted(button)},
   rects:[...p.querySelectorAll('h3,p,.akari-inspector-generation-gap-end span,img,button')].filter(visible)
     .map(e=>({role:e.tagName,text:e.textContent,...rect(e)}))};})()`;
const GENERATION = `(()=>{${GEOMETRY}
 const p=document.querySelector('[data-akari-ui="panel:inspector"]');if(!visible(p))return null;
 const tab=p.querySelector('[data-akari-ui="tab:inspector-generation"]');
 const frames=[...p.querySelectorAll('.akari-inspector-generation-frame')].filter(visible);
 const images=frames.map(e=>{const img=e.querySelector('img');return {slot:e.dataset.akariGenerationPickSlot,
   loaded:!!img&&img.complete&&img.naturalWidth>0,...rect(e),...painted(e)};});
 if(tab?.getAttribute('aria-selected')!=='true'||images.length!==2||!images.every(i=>i.loaded))return null;
 const variety=p.querySelector('[data-akari-field="generation-variety"]');
 const labels=[...p.querySelectorAll('.akari-inspector-generation-cell > div:first-child')].filter(visible);
 return {tab:tab.textContent,selected:tab.getAttribute('aria-selected'),images,
   variety:variety?.textContent??'',text:p.textContent,
   rects:[...labels,...frames].map(e=>({role:e.className,text:e.getAttribute('aria-label')??e.textContent,...rect(e)})),
   buttons:[...p.querySelectorAll('button,[role="button"]')].filter(visible).map(e=>({text:e.textContent,...rect(e),...painted(e)}))};})()`;
const CHIP = itemId => `(()=>{${GEOMETRY}
 const w=window.__akariGapWidget,index=w.cutItemIds.indexOf(${JSON.stringify(itemId)}),
   e=document.querySelector('[data-akari-item-kind="cut"][data-akari-item-id="'+index+'"]');
 if(!visible(e))return null;
 const frames=[...e.querySelectorAll('[data-akari-generation-frame]')].filter(visible)
   .map(n=>({side:n.dataset.akariGenerationFrame,background:getComputedStyle(n).backgroundImage,...rect(n)}));
 if(frames.length!==2||frames.some(n=>n.background==='none'))return null;
 const link=e.querySelector('.akari-generation-link');
 const pseudo=Object.fromEntries(['before','after'].map(side=>{
   const content=link?getComputedStyle(link,'::'+side).content:null;
   return [side,{content,present:content!==null&&content!==''&&content!=='none'&&content!=='normal'}];
 }));
 return {text:e.textContent,linkIndicator:{observed:visible(link)&&(pseudo.before.present||pseudo.after.present),
   title:link?.title??null,rect:link?rect(link):null,pseudo},frames,
   foregroundRects:[...e.querySelectorAll('.akari-generation-link,[data-akari-generation-badge],.akari-annotations-strip-clip-header-label,.akari-annotations-strip-clip-header-duration,.akari-clip-kind-badge,.akari-generation-frame-label,.akari-generation-prompt')]
     .filter(visible).map(n=>({role:n.className,side:n.dataset.akariGenerationFrame??null,text:n.textContent,...rect(n)}))};})()`;
async function listOwnedProcesses() {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,command='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match || !match[2].includes(ISO) || Number(match[1]) === process.pid) return [];
    return [{ pid: Number(match[1]), command: match[2] }];
  });
}
async function stopElectron() {
  // Helpers may keep these pipes open after their parent exits, even in another process group.
  child?.stdout?.destroy(); child?.stderr?.destroy();
  const cleanup = { pid: child?.pid ?? null, signals: [], survivors: [],
    isolatedAkariHome: true, isolatedUserData: true };
  const signalPid = (pid, signal) => {
    try { process.kill(pid, signal); cleanup.signals.push({ pid, signal }); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  try {
    // Discover before terminating the main process, then rescan for helpers that changed groups.
    cleanup.before = await listOwnedProcesses();
    if (child?.pid && child.exitCode === null && child.signalCode === null) signalPid(child.pid, 'SIGTERM');
    for (const entry of cleanup.before) if (entry.pid !== child?.pid) signalPid(entry.pid, 'SIGTERM');
    await sleep(1500);
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = await listOwnedProcesses();
      if (!remaining.length) break;
      for (const entry of remaining) signalPid(entry.pid, 'SIGKILL');
      await sleep(500);
    }
    cleanup.survivors = await listOwnedProcesses();
    cleanup.exited = (!child?.pid || child.exitCode !== null || child.signalCode !== null) && cleanup.survivors.length === 0;
  } catch (error) {
    cleanup.error = clean(error.stack ?? error); cleanup.exited = false;
  } finally {
    child?.unref();
  }
  output.cleanup = cleanup;
  if (!cleanup.exited) { output.status = 'fail'; process.exitCode = 1; }
  else await rm(ISO, { recursive: true, force: true });
}
async function lint() {
  const result = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(REPO, 'packages/edit-lint/bin/edit-lint.mjs'), PROJECT, '--json'],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', c => { stdout += c; }); proc.stderr.on('data', c => { stderr += c; });
    proc.once('error', reject); proc.once('close', code => resolve({ code, stdout, stderr }));
  });
  output.lint = result; await save();
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout); assert.equal(parsed.verdict, 'pass');
  return parsed;
}
try {
  const { edit: initial, ffmpeg } = await createFixture(PROJECT);
  await mkdir(path.join(ISO,'akari-home'),{recursive:true});
  const fakeCli=path.join(ISO,'fake-generate.mjs'),callsFile=path.join(ISO,'generate-calls.jsonl');
  await writeFile(callsFile,'');
  await writeFile(fakeCli,`import {appendFile} from 'node:fs/promises';\nawait appendFile(${JSON.stringify(callsFile)},JSON.stringify(process.argv.slice(2))+'\\n');\n`);
  const candidates=[SHELL,REPO].map(base=>path.join(base,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
  const electron=process.env.AKARI_L1_ELECTRON||((await stat(candidates[0]).catch(()=>null))?.isFile()?candidates[0]:candidates[1]);
  child=spawn(electron,[SHELL,PROJECT,`--remote-debugging-port=${PORT}`,`--user-data-dir=${path.join(ISO,'userdata')}`,'--no-sandbox'],{
    cwd:REPO,env:{...process.env,AKARI_HOME:path.join(ISO,'akari-home'),THEIA_CONFIG_DIR:path.join(ISO,'config'),
      AKARI_FFMPEG_BIN:ffmpeg,AKARI_GENERATE_CLI:fakeCli,FAL_KEY:'',FAL_API_KEY:''},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'
  });
  let launchError;
  child.once('error', e => { launchError = e; });
  child.stdout.on('data', c => { log += c; }); child.stderr.on('data', c => { log += c; });
  const target = await waitFor(async () => {
    if (launchError || child.exitCode !== null) throw launchError ?? new Error(`Electron exited ${child.exitCode}`);
    return (await listTargets(PORT)).find(t => t.type === 'page');
  }, 600000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*://*.fal.ai/*', '*://fal.ai/*', '*://*.fal.run/*'] });
  cdp.on('Network.requestWillBeSent', e => { if (/https?:\/\/[^/]*fal\.(ai|run)\//.test(e.request.url)) output.falRequests.push(e.request.url); });
  await waitEval(`Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 900000);
  await waitEval(`(()=>{const e=document.querySelector('.theia-preload');return !e||e.classList.contains('theia-hidden');})()`, 900000);
  const dismissDialogs = `(()=>{for(const d of document.querySelectorAll('.dialogBlock')){
    const b=[...d.querySelectorAll('button')].find(b=>/キャンセル|Cancel|閉じる|Close/.test(b.textContent));b?.click();}return true;})()`;
  await evaluate(dismissDialogs);
  if (!await evaluate(`Boolean(document.querySelector('.akari-annotations-widget'))`)) {
    await evaluate(`(()=>{const c=window.theia.container,k=[...c._bindingDictionary._map.keys()]
      .find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
      void c.get(k).executeCommand('akari.annotations.open');return true;})()`);
    await sleep(500); await evaluate(dismissDialogs);
  }
  await waitEval(`Boolean(document.querySelector('.akari-annotations-widget'))`);
  await evaluate(`(()=>{const c=window.theia.container,k=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype?.getCurrentWidget&&k.prototype?.addWidget&&k.prototype?.activateWidget);
    const s=c.get(k),w=s.widgets.find(w=>w.node?.classList.contains('akari-annotations-widget'));
    window.__akariGapWidget=w;w.activate();return true;})()`);
  await waitEval(`window.__akariGapWidget.cutItemIds.length===2`);
  await step('real click in the four second visual gap',async()=>{
    await shot('01-before-gap.png');
    const point=await evaluate(`(()=>{const w=window.__akariGapWidget,r=w.strip.getBoundingClientRect(),l=w.laneLayout.tracks.find(l=>l.id==='video');
      return {x:r.left+(5-w.viewStart)*r.width/w.visibleDuration(),y:r.top+l.top+l.height/2};})()`);
    await realClick(cdp,point.x,point.y);
    const gap=await waitEval(GAP);output.gap=gap;await save();
    assert.equal(gap.heading,'すき間 · 4.0 秒');assert.equal(gap.band.border,'dashed');
    assert.equal(gap.images.length,2);assert.ok(gap.button.painted);
    const overlaps=overlapPairs(gap.rects);output.gapLayout={overlaps};await save();
    assert.deepEqual(overlaps,[],'gap text/labels/thumbnails/button overlap');
    return {point,...gap,overlaps};
  });
  await shot('02-gap-panel.png');
  let inserted, item, meta;
  await step('real click creates exactly one four second video draft',async()=>{
    const point=await clickSelector('.akari-inspector-generation-gap button');
    inserted=await waitFor(async()=>{const edit=await readEdit();return edit.tracks[0].items.length===3&&edit;});
    item=inserted.tracks[0].items.find(i=>!initial.tracks[0].items.some(old=>old.id===i.id));
    assert.equal(item.at,90);assert.equal(item.duration,120);assert.equal(item.source.out,4);
    assert.equal(inserted.sources.length,initial.sources.length+1);
    const source=inserted.sources.find(s=>s.id===item.source.src);
    meta=JSON.parse(await readFile(path.join(PROJECT,source.path+'.meta.json'),'utf8'));
    assert.ok(validateGenerationMeta(meta).ok);
    assert.equal(meta.next.inputs.frames_or_refs,'frames');assert.equal(meta.next.output.duration_s,4);
    assert.equal(meta.next.inputs.first_frame.source_id,initial.tracks[0].items[0].source.src);
    assert.equal(meta.next.inputs.last_frame.source_id,initial.tracks[0].items[1].source.src);
    const captures=(await readdir(path.join(PROJECT,'assets/captures'))).filter(f=>f.endsWith('.png'));
    assert.equal(captures.length,2);
    for(const slot of ['first_frame','last_frame']) {
      assert.match(meta.next.inputs[slot].path,/^assets\/captures\/.*\.png$/);
      const png=await readFile(path.join(PROJECT,meta.next.inputs[slot].path));assert.equal(png.subarray(1,4).toString(),'PNG');
    }
    const badge=await waitEval(`(()=>{const e=[...document.querySelectorAll('[data-akari-generation-badge]')].find(e=>e.textContent==='▶ 動画予定');return e?.textContent;})()`);
    const chip=await waitEval(CHIP(item.id));
    output.chipLayout={screenshot:'03-video-draft.png',chip,...measureChipLayout(chip)};
    output.linkIndicator=chip.linkIndicator;await save();
    await shot('03-video-draft.png');
    assertChipLayout(output.chipLayout);
    return {point,item,source,meta,captures,badge};
  });
  await step('generation tab displays both captured endpoint frames and first-last variety',async()=>{
    const generation=await waitEval(GENERATION);output.generation=generation;await save();
    assert.ok(generation.text.includes('最初→最後'));assert.ok(generation.images.every(i=>i.painted));
    const overlaps=overlapPairs(generation.rects);output.generationLayout={overlaps};await save();
    assert.deepEqual(overlaps,[],'generation labels intersect thumbnails');
    await shot('04-generation-frames.png');return generation;
  });
  await step(LINK_STEP,async()=>{
    assert.equal(output.linkIndicator.observed,true,'動画から抽出した最後の絵の 🔗 が表示されていません。');
    assert.equal(output.linkIndicator.title,'次のクリップの絵につながる');
    return output.linkIndicator;
  },true);
  await step('edit-lint PASS',lint);
  await step('no generation CLI invocation or paid provider request',async()=>{
    const calls=(await readFile(callsFile,'utf8')).trim().split('\n').filter(Boolean);
    output.fakeCliCalls=calls;assert.equal(calls.length,0);assert.equal(output.falRequests.length,0);
    return {calls:0,falRequests:0};
  });
  await step('one real undo click removes both item and source',async()=>{
    await clickSelector('.akari-annotations-widget button[aria-label="元に戻す"]');
    const undone=await waitFor(async()=>{const edit=await readEdit();return edit.tracks[0].items.length===2&&edit;});
    assert.deepEqual(undone.tracks,initial.tracks);assert.deepEqual(undone.sources,initial.sources);
    await shot('05-after-undo.png');return {undoClicks:1,itemCount:2,sourceCount:2};
  });
  assert.ok(output.screenshots.length>=4);
  output.status=measurementStatus(output);
  if(output.status==='fail')process.exitCode=1;
} catch(error) {
  output.status='fail';output.error=clean(error.stack??error);
  if(cdp)await shot('99-failure.png').catch(()=>{});process.exitCode=1;
} finally {
  cdp?.close();await stopElectron();await writeFile(path.join(ROOT,'electron.log'),clean(log));
  output.elapsedMs=Math.round(performance.now()-started);await save();
}
