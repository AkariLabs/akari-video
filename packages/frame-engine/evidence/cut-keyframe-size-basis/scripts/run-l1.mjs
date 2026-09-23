#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import canonical from '../../../../../packages/edit-store/lib/canonical.js';
import { CDP, evalOn, realClick } from '../../../../../apps/shell/extensions/akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceArg, evidenceArg, mode] = process.argv;
if (!workspaceArg || !evidenceArg || !['before', 'after'].includes(mode)) {
  throw Error('usage: run-l1.mjs <port> <workspace> <evidence> before|after');
}
const port = Number(portArg || process.env.AKARI_CDP_PORT || 9493);
const editPath = path.resolve(workspaceArg, 'project/edit.json');
const editUri = pathToFileURL(editPath).href;
const evidence = path.resolve(evidenceArg);
const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const records = [], connections = new Set();
let main, preview, contextId, previewTargetId, attachmentPromise, fatal;
let previewContextValid = false;
const S = JSON.stringify;
const close = cdp => { try { cdp?.close(); } catch {} };
const safe = value => String(value).replaceAll(editUri, '<workspace>/project/edit.json')
  .replaceAll(path.resolve(workspaceArg), '<workspace>')
  .replaceAll(evidence, '<evidence>').replaceAll(repo, '<repo>/')
  .replace(/\/(?:Users|home|private\/tmp)\/[^\s"']+/gu, '<local-path>');
const near = (a, b, tolerance = .02) => Number.isFinite(+a) && Number.isFinite(+b) && Math.abs(+a - +b) <= tolerance;
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`timeout ${label}`)), ms);
  })]); } finally { clearTimeout(timer); }
}
async function waitFor(label, fn, ms = 30000) {
  const until = Date.now() + ms;
  let last;
  while (Date.now() < until) {
    try { const value = await fn(); if (value) return value; }
    catch (error) { last = safe(error.message); }
    await sleep(180);
  }
  throw Error(`timeout ${label}${last ? ': ' + last : ''}`);
}
async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error(`CDP target list: ${response.status}`);
  return response.json();
}
async function connect(target, enable = true) {
  const cdp = new CDP(target.webSocketDebuggerUrl);
  connections.add(cdp);
  await bounded(cdp.connect(), 20000, 'CDP connect');
  const original = cdp.send.bind(cdp);
  cdp.ws.addEventListener('close', () => {
    if (cdp === preview) previewContextValid = false;
    for (const pending of cdp.pending.values()) pending.reject(Error('CDP connection closed'));
    cdp.pending.clear();
  });
  cdp.send = (method, params) => {
    if (cdp.ws.readyState !== 1) return Promise.reject(Error('CDP connection closed'));
    const requestId = cdp.nextId;
    return bounded(original(method, params), method === 'Runtime.evaluate' ? 60000 : 20000, method)
      .finally(() => cdp.pending.delete(requestId));
  };
  if (enable) { await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); }
  return cdp;
}
const me = expression => evalOn(main, expression);
async function pe(expression) {
  if (!previewContextValid) await attachPreview();
  try { return await evalOn(preview, expression, contextId); }
  catch (error) {
    if (!/context.*(destroyed|not found)|cannot find context|inspected target|session.*closed|connection closed/i.test(error.message)) throw error;
    previewContextValid = false;
    await attachPreview();
    return evalOn(preview, expression, contextId);
  }
}
async function command(id, argument) {
  return me(`(async()=>{const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
      &&typeof k.prototype?.executeCommand==='function'&&typeof k.prototype?.registerCommand==='function');
    if(!key)throw Error('commands unavailable');
    await c.get(key).executeCommand(${S(id)}${argument === undefined ? '' : ',' + S(argument)});return true;})()`);
}
async function attachPreview() {
  if (attachmentPromise) return attachmentPromise;
  attachmentPromise = discoverPreview();
  try { await attachmentPromise; } finally { attachmentPromise = undefined; }
}
async function discoverPreview() {
  const previous = preview;
  await command('akari.preview.ensureVisible', { editUri });
  const candidates = new Map();
  try { await waitFor('nested preview webview', async () => {
    const available = (await targets()).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    for (const [id, candidate] of candidates) if (!available.some(t => t.id === id)
      || candidate.cdp.ws.readyState !== 1) {
      close(candidate.cdp); connections.delete(candidate.cdp); candidates.delete(id);
    }
    for (const target of available) {
      if (!candidates.has(target.id)) {
        const cdp = await connect(target, false), contexts = new Map();
        candidates.set(target.id, { cdp, contexts });
        cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context));
        cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => {
          contexts.delete(executionContextId);
          if (cdp === preview && contextId === executionContextId) previewContextValid = false;
        });
        cdp.on('Runtime.executionContextsCleared', () => {
          contexts.clear(); if (cdp === preview) previewContextValid = false;
        });
        await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      }
      const { cdp, contexts } = candidates.get(target.id);
      for (const context of contexts.values()) {
        if (context.auxData?.isDefault === false) continue;
        try {
          if (await evalOn(cdp, `Boolean(document.querySelector('#overlay-stage')
            && window.akari?.engine?.overlayWrite && window.akari?.state?.editPath===${S(editUri)})`, context.id)) {
            preview = cdp; contextId = context.id; previewTargetId = target.id;
            previewContextValid = true; return true;
          }
        } catch { /* disposed or isolated context */ }
      }
    }
    return false;
  }, 600000); }
  finally { for (const { cdp } of candidates.values()) if (cdp !== preview) {
    close(cdp); connections.delete(cdp);
  } }
  if (previous && previous !== preview) { close(previous); connections.delete(previous); }
  await evalOn(preview, `(() => {
    if(window.__kfEvidence){window.__kfEvidence.errors ||= [];return true;}
    const journal=window.__kfEvidence=JSON.parse(sessionStorage.getItem('__kfEvidence')||'null')||{writes:[],responses:[],errors:[]};
    journal.errors ||= [];
    const persist=()=>sessionStorage.setItem('__kfEvidence',JSON.stringify(journal));
    for(const kind of ['overlayWrite','layerWrite','cutWrite']){
      const original=window.akari.engine[kind];
      if(typeof original!=='function')continue;
      window.akari.engine[kind]=function(...args){
        const id=kind==='overlayWrite'?args[1]:kind==='cutWrite'?args[1]:args[0];
        const patch=args.at(-1);
        journal.writes.push({kind,id,patch:JSON.parse(JSON.stringify(patch))});persist();
        try {
          return Promise.resolve(Reflect.apply(original,this,args)).catch(error=>{
            journal.errors.push({kind,id,message:String(error?.message||error)});persist();throw error;
          });
        } catch(error) {
          journal.errors.push({kind,id,message:String(error?.message||error)});persist();throw error;
        }
      };
    }
    window.addEventListener('message',event=>{
      if(['akari-preview-overlay-write-response','akari-preview-layer-write-response',
        'akari-preview-cut-write-response'].includes(event.data?.type)){
        journal.responses.push({type:event.data.type,requestId:event.data.requestId,
          ok:event.data.ok,error:event.data.error});persist();
      }
    },true);
    return true;
  })()`, contextId);
}
const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));
function item(doc, id) {
  const visit = items => { for (const value of items ?? []) {
    if (value.id === id) return value;
    const nested = visit(value.items ?? value.children); if (nested) return nested;
  } };
  for (const track of doc.tracks ?? []) { const found = visit(track.items); if (found) return found; }
}
async function seek(seconds) {
  await pe(`(() => {const e=document.getElementById('seek');e.value=${S(String(seconds))};
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await sleep(450);
}
const clipSelector = id => id === 'still-item' ? '[data-akari-item-kind="cut"][data-akari-item-id="0"]'
  : `[data-akari-item-id=${S(id)}]`;
async function select(id) {
  const point = await waitFor(`timeline clip ${id}`, () => me(`(() => {const e=document.querySelector(${S(clipSelector(id))});
    if(!e)return null;const r=e.getBoundingClientRect();
    return r.width&&r.height?{x:r.left+Math.min(r.width/2,40),y:r.top+r.height/2}:null;})()`));
  await realClick(main, point.x, point.y);
  await sleep(300);
}
async function ready(id, seconds) {
  await attachPreview(); await seek(seconds); await select(id);
  const selected = () => pe(id === 'still-item'
    ? `Boolean(document.querySelector('#cut-select-box.is-active'))`
    : `window.akari.interaction?.selectedId===${S(id)}`);
  if (!await waitFor(`initial selection ${id}`, selected, 2500).catch(() => false)) {
    const point = await pe(`(() => {
      const e=${id === 'still-item'
        ? `document.querySelector('#preview-still')||document.querySelector('#preview-video[data-akari-cut-id=${S(id)}]')`
        : `[...document.querySelectorAll('[data-overlay-id=${S(id)}] *')].find(node=>{
            const r=node.getBoundingClientRect();return r.width>10&&r.height>10&&getComputedStyle(node).pointerEvents==='auto';})`};
      if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    if (point) await realClick(preview, point.x, point.y);
  }
  await waitFor(`selection ${id}`, () => pe(id === 'still-item'
    ? `Boolean(document.querySelector('#cut-select-box.is-active'))`
    : `window.akari.interaction?.selectedId===${S(id)}`));
}
async function visual(id) {
  return pe(`(() => {
    const e=[...document.querySelectorAll('[data-overlay-id]')].find(n=>n.dataset.overlayId===${S(id)});
    const frame=document.querySelector('.akari-interaction-selection-frame:not([hidden])');
    const layer=document.querySelector('#preview-video[data-akari-cut-id=${S(id)}]');
    const layerBox=document.querySelector('#cut-select-box.is-active');
    const box=layer?layerBox:frame;
    const vars={};for(const key of ['--x','--y','--scale','--scale-x','--scale-y','--rotate'])
      vars[key]=e?.style.getPropertyValue(key)||null;
    if(layer){const names={'--x':'X','--y':'Y','--scale':'Scale','--scale-x':'ScaleX',
      '--scale-y':'ScaleY','--rotate':'Rotate'};
      for(const [key,name] of Object.entries(names))vars[key]=layer.dataset['akariTransform'+name]??null;}
    const corners={};for(const name of ['nw','ne','se','sw','e','s','rotate']){
      const h=layer?box?.querySelector('[data-akari-handle="'+name+'"]')
        :box?.querySelector('.akari-interaction-handle.is-'+name),r=h?.getBoundingClientRect();
      corners[name]=r&&getComputedStyle(h).display!=='none'?{x:r.left+r.width/2,y:r.top+r.height/2}:null;
    }
    const rect=(e||layer)?.getBoundingClientRect();
    const imageRect=(layer?document.querySelector('#preview-still'):null)?.getBoundingClientRect();
    const boxRotate=Number.parseFloat(box?.style.transform?.replace('rotate(','')??'');
    const datasetRotate=Number.parseFloat(vars['--rotate']);
    return{seek:Number(document.getElementById('seek')?.value),selectedId:window.akari.interaction?.selectedId,
      vars,corners,frameTransform:box?.style.transform||null,
      datasetStale:Boolean(layer&&Number.isFinite(boxRotate)&&Number.isFinite(datasetRotate)
        &&Math.abs(boxRotate-datasetRotate)>.1),
      rect:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,
      imageRect:imageRect?{x:imageRect.x,y:imageRect.y,width:imageRect.width,height:imageRect.height}:null};
  })()`);
}
async function htmlMovePoint(id) {
  return pe(`(() => {
    const mount=document.querySelector('[data-overlay-id=${S(id)}]');if(!mount)return null;
    for(const e of [...mount.querySelectorAll('*')].reverse()){
      const r=e.getBoundingClientRect();if(r.width<4||r.height<4||getComputedStyle(e).pointerEvents!=='auto')continue;
      for(const fy of [.5,.3,.7,.1,.9])for(const fx of [.5,.3,.7,.1,.9]){
        const x=r.left+r.width*fx,y=r.top+r.height*fy;
        if(document.elementFromPoint(x,y)?.closest('[data-overlay-id]')===mount)return{x,y};
      }
    }return null;
  })()`);
}
async function inspector() {
  return me(`(() => Object.fromEntries(['x','y','scale','scaleX','scaleY','rotate'].map(name=>{
    const row=document.querySelector('[data-akari-field="transform-'+name+'"]');
    return[name,{value:row?.querySelector('input')?.value??null,
      keyframe:row?.querySelector('.akari-inspector-kf-seat')?.getAttribute('aria-pressed')??null}];
  })))()`);
}
async function journal() { return pe(`(() => ({writes:window.__kfEvidence.writes.length,
  responses:window.__kfEvidence.responses.length,errors:window.__kfEvidence.errors.length}))()`); }
async function journalSince(cursor) { return pe(`(() => ({
  writes:window.__kfEvidence.writes.slice(${cursor.writes}),
  responses:window.__kfEvidence.responses.slice(${cursor.responses}),
  errors:window.__kfEvidence.errors.slice(${cursor.errors})}))()`); }
async function state(id) {
  return { item: structuredClone(item(await readEdit(), id)), visual: await visual(id), inspector: await inspector(),
    journal: await journal() };
}

async function capture(name) {
  const clip = await me(`(() => {const f=[...document.querySelectorAll('iframe')].find(e=>/webview/u.test(e.src));
    if(!f)return null;const r=f.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:Math.min(r.height,r.width*.75),scale:.6};})()`);
  const { data } = await main.send('Page.captureScreenshot', {format:'png', ...(clip ? {clip} : {})});
  const filename = `${mode}-${name}.png`;
  await writeFile(path.join(evidence, filename), Buffer.from(data, 'base64'));
  return filename;
}
const states = ['zero','one','two-same','two-different','crop-static'];
const point = (t, variant = false) => ({t, transform: {x: variant ? 40 : 0, y: variant ? -25 : 0,
  scale: variant ? 1.3 : 1, rotate: variant ? 20 : 0}});
function change(doc, media, state) {
  const next = structuredClone(doc);
  next.sources[0].path = media === 'video' ? 'assets/video.mp4' : 'assets/still.png';
  const cut = next.tracks[0].items[0];
  delete cut.keyframes;
  delete cut.crop;
  if (state === 'crop-static') {
    cut.crop = { x: 0.1, y: 0.1, w: 0.75, h: 0.75 };
    cut.transform.scale = 2.25; // existing crop-entry write on a 100x160 source in 640x360 output
  }
  if (state === 'one') cut.keyframes = [point(30)];
  if (state === 'two-same') cut.keyframes = [point(30), point(90)];
  if (state === 'two-different') cut.keyframes = [point(30), point(90, true)];
  return next;
}
try {
  if (process.argv.includes('--startup-failed')) throw Error('Electron startup failed');
  const target = await waitFor('Theia page', async () => (await targets()).find(t => t.type === 'page'), 600000);
  main = await connect(target);
  await main.send('Emulation.setDeviceMetricsOverride', {width:1600,height:1400,deviceScaleFactor:1,mobile:false});
  await waitFor('Theia ready', () => me(`Boolean(window.theia?.container&&document.readyState==='complete')`), 600000);
  await me(`(() => { [...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ')?.click();return true;})()`);
  await command('akari.annotations.open'); await command('akari.inspector.open');
  await attachPreview();
  const original = await readEdit();
  for (const media of ['still','video']) for (const name of states) {
    const row = {media, state:name}; records.push(row);
    try {
      await writeFile(editPath, canonical.serializeEdit(change(original, media, name)));
      await sleep(1700); previewContextValid=false;
      await ready('still-item', 1);
      await sleep(2500);
      row.visual = await visual('still-item'); row.inspector = await inspector();
      row.screenshot = await capture(`${media}-${name}`);
      row.ok = ['nw','ne','se','sw'].every(key=>row.visual.corners[key]);
    } catch(error) {row.error=safe(error.stack??error); row.ok=false;}
    console.error(`${media} ${name}: ${row.ok ? 'ok':'ng'} ${row.error?.split('\n')[0]||''}`);
  }
  await writeFile(editPath, canonical.serializeEdit(change(original, 'still', 'zero')));
  await sleep(1700); previewContextValid=false; await ready('still-item',1);
  await sleep(2500);
  const row={media:'still',state:'a-toggle-x'};records.push(row);
  // The edit reload can clear the selection just before the toggle. The zero-state
  // observation is the identical saved edit and supplies its stable pre-toggle corners.
  row.before=records.find(r=>r.media==='still'&&r.state==='zero').visual;
  row.beforeScreenshot=`${mode}-still-zero.png`;
  const button=await waitFor('keyframe button',()=>me(`(() => {const e=document.querySelector('[data-akari-field="transform-x"] .akari-inspector-kf-seat');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`));
  await realClick(main,button.x,button.y);
  await waitFor('keyframe persisted',async()=>((await readEdit()).tracks[0].items[0].keyframes?.length??0)>0,60000);
  await sleep(750);previewContextValid=false;await ready('still-item',1);
  row.after=await waitFor('toggle after corners', async()=>{const v=await visual('still-item');return v.corners.nw?v:null;},30000);row.afterScreenshot=await capture('a-toggle-x-after');row.ok=true;
} catch(error) {fatal=safe(error.stack??error);}
finally {
  await mkdir(evidence,{recursive:true});
  await writeFile(path.join(evidence,`${mode}-shell.json`), `${safe(S({mode,records,error:fatal??null}))}\n`);
  for(const connection of connections) close(connection);
  console.log(fatal?'FAIL':'DONE');process.exitCode=fatal?1:0;
}
