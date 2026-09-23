#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import canonical from '../../../../../../../packages/edit-store/lib/canonical.js';
import { CDP, evalOn, realClick } from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceArg, evidenceArg, mode] = process.argv;
if (!workspaceArg || !evidenceArg || !['before', 'after'].includes(mode)) {
  throw Error('usage: run-l1.mjs <port> <workspace> <evidence> before|after');
}
const port = Number(portArg || process.env.AKARI_CDP_PORT || 9493);
const editPath = path.resolve(workspaceArg, 'project/edit.json');
const editUri = pathToFileURL(editPath).href;
const evidence = path.resolve(evidenceArg);
const repo = fileURLToPath(new URL('../../../../../../../', import.meta.url));
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
function diff(before, after) {
  const a = before?.item ?? {}, b = after?.item ?? {};
  const keys = new Set([...Object.keys(a.transform ?? {}), ...Object.keys(b.transform ?? {})]);
  const base = Object.fromEntries([...keys].filter(key => S(a.transform?.[key]) !== S(b.transform?.[key]))
    .map(key => [key, { before: a.transform?.[key] ?? null, after: b.transform?.[key] ?? null }]));
  const byT = new Map([...a.keyframes ?? [], ...b.keyframes ?? []].map(point => [point.t, point.t]));
  const keyframes = [...byT.keys()].sort((x, y) => x - y).flatMap(t => {
    const old = a.keyframes?.find(point => point.t === t), next = b.keyframes?.find(point => point.t === t);
    return S(old) === S(next) ? [] : [{ t, before: old ?? null, after: next ?? null }];
  });
  return { base, keyframes, itemChanged: S(a) !== S(b) };
}
function changedVisual(a, b, field) {
  if (a.item?.source?.kind === 'media') {
    const left = a.visual.corners, right = b.visual.corners;
    return ['nw', 'ne', 'se', 'sw'].some(key => left[key] && right[key]
      && (!near(left[key].x, right[key].x, .5) || !near(left[key].y, right[key].y, .5)));
  }
  const av = a.visual.vars, bv = b.visual.vars;
  const key = field === 'scaleX' ? '--scale-x' : field === 'scaleY' ? '--scale-y'
    : field === 'scale' ? '--scale' : field === 'rotate' ? '--rotate' : `--${field}`;
  if (av[key] != null && bv[key] != null) return !near(parseFloat(av[key]), parseFloat(bv[key]), field === 'rotate' ? .2 : .02);
  const v1 = a.inspector[field]?.value, v2 = b.inspector[field]?.value;
  return v1 != null && v2 != null && !near(parseFloat(v1), parseFloat(v2), field === 'rotate' ? .2 : .02);
}
function sameAppearance(a, b) {
  const fields = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'];
  const controls = fields.every(field => {
    const left = a.inspector[field]?.value, right = b.inspector[field]?.value;
    return left == null && right == null || near(parseFloat(left), parseFloat(right), .1);
  });
  const effective = (state, key) => {
    const raw = state.visual.vars[key];
    if (raw != null) return parseFloat(raw);
    if (key === '--scale-x' || key === '--scale-y') return effective(state, '--scale');
    return key === '--scale' ? 1 : 0;
  };
  const vars = a.item?.source?.kind === 'media' && b.item?.source?.kind === 'media'
    || ['--x', '--y', '--scale-x', '--scale-y', '--rotate']
      .every(key => near(effective(a, key), effective(b, key), .02));
  const corners = ['nw', 'ne', 'se', 'sw'].every(key => {
    const left = a.visual.corners[key], right = b.visual.corners[key];
    return !left && !right || Boolean(left && right && near(left.x, right.x, .5)
      && near(left.y, right.y, .5));
  });
  return { ok: controls && vars && corners, controls, vars, corners };
}
// Screenshots come from the top-level page (iframe targets cannot capture), clipped to the
// preview webview. Only the cases named in captureCases are captured to keep evidence small.
const captureCases = /^(a-|b-|d-|e-)/u;
let currentCase = '';
async function capture(label) {
  if (!captureCases.test(currentCase)) return null;
  const name = `${mode}-${String(records.length).padStart(3, '0')}-${label.replace(/[^a-z0-9-]/gi, '-')}.png`;
  const clip = await me(`(() => {const f=[...document.querySelectorAll('iframe')].find(e=>/webview/u.test(e.src));
    if(!f)return null;const r=f.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:Math.min(r.height,r.width*.75),scale:.6};})()`);
  const { data } = await main.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  await writeFile(path.join(evidence, name), Buffer.from(data, 'base64'));
  return name;
}
async function record(caseName, id, expected, action) {
  const row = { case: caseName, itemId: id, expected, status: 'ng' };
  currentCase = caseName;
  records.push(row);
  console.error(`[${new Date().toISOString()}] ${id} ${caseName}`);
  try {
    row.observed = await action();
    row.status = row.observed.ok === true ? 'ok' : 'ng';
  } catch (error) { row.error = safe(error.stack ?? error); }
  console.error(`  -> ${row.status}${row.error ? ' ' + row.error.split('\n')[0] : ''}`);
  return row;
}
async function toggle(field) {
  const before = await readFile(editPath, 'utf8');
  const target = item(JSON.parse(before), currentId);
  const alreadyPresent = target?.keyframes?.some(point => point.t === 30
    && point.transform?.[field] !== undefined);
  if (mode === 'after' && alreadyPresent) return { skippedExistingPoint: true };
  const point = await waitFor(`keyframe toggle ${field}`, () => me(`(() => {
    const e=document.querySelector('[data-akari-field="transform-${field}"] .akari-inspector-kf-seat');
    if(!e||e.disabled)return null;const r=e.getBoundingClientRect();
    return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null;})()`));
  await realClick(main, point.x, point.y);
  if (!alreadyPresent) await waitFor(`keyframe ${field} persisted`, async () =>
    (await readFile(editPath, 'utf8')) !== before, 60000);
  else await sleep(650);
  previewContextValid = false;
  await attachPreview();
  return { skippedExistingPoint: false };
}
async function setField(field, value) {
  await waitFor(`inspector input ${field}`, () => me(`Boolean(document.querySelector('[data-akari-field="transform-${field}"] input'))`));
  const before = await readFile(editPath, 'utf8');
  const previous = { contextId, targetId: previewTargetId };
  await me(`(() => {const e=document.querySelector('[data-akari-field="transform-${field}"] input');
    e.value=${S(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));
    e.dispatchEvent(new Event('blur',{bubbles:true}));return true;})()`);
  await waitFor(`inspector ${field} persisted`, async () => (await readFile(editPath, 'utf8')) !== before, 60000);
  await waitFor(`inspector ${field} model refreshed`, async () => {
    const target = (await targets()).find(t => t.id === previous.targetId);
    return !target || !previewContextValid || contextId !== previous.contextId
      || /webview\/fake\.html/u.test(target.url);
  }, 5000).catch(() => undefined);
  previewContextValid = false;
  await attachPreview();
  await waitFor(`inspector ${field} input restored`, () => me(`Boolean(document.querySelector('[data-akari-field="transform-${field}"] input'))`));
}
async function drag(kind, attempt = 0) {
  const diskBefore = await readFile(editPath, 'utf8');
  const journalBefore = await journal();
  let before = await visual(currentId);
  if (currentId === 'html-item' && before.selectedId !== currentId) {
    await ready(currentId, before.seek); before = await visual(currentId);
  }
  if (currentId === 'still-item' && !before.corners.se) {
    await ready(currentId, before.seek); before = await visual(currentId);
  }
  let start = before.corners[kind === 'resize' ? 'se' : 'rotate'];
  if (kind === 'move') {
    const c = before.corners, a = c.nw, b = c.se;
    start = currentId === 'html-item' && mode === 'after' ? await htmlMovePoint(currentId)
      : a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  }
  if (!start && attempt === 0) {
    await ready(currentId, before.seek);
    return drag(kind, 1);
  }
  if (!start) throw Error(`No visible ${kind} handle (selected=${before.selectedId})`);
  const delta = kind === 'resize' ? { x: 36, y: 0 }
    : kind === 'rotate' ? { x: 28, y: 30 } : { x: 24, y: 16 };
  const target = preview;
  await target.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start, button: 'none' });
  await target.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start,
    button: 'left', buttons: 1, clickCount: 1 });
  if (currentId === 'html-item' && await pe('window.akari.interaction?.selectedId') !== currentId) {
    await target.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...start, button: 'left' });
    if (attempt === 0) { await ready(currentId, before.seek); return drag(kind, 1); }
    throw Error('Preview selection was lost at pointerdown');
  }
  let live;
  for (let step = 1; step <= 8; step++) {
    await target.send('Input.dispatchMouseEvent', { type: 'mouseMoved',
      x: start.x + delta.x * step / 8, y: start.y + delta.y * step / 8,
      button: 'left', buttons: 1 });
    if (step === 8) live = await visual(currentId);
  }
  await target.send('Input.dispatchMouseEvent', { type: 'mouseReleased',
    x: start.x + delta.x, y: start.y + delta.y, button: 'left' });
  try {
    await waitFor(`${kind} persisted`, async () => (await readFile(editPath, 'utf8')) !== diskBefore, 60000);
  } catch (error) {
    const writes = await journalSince(journalBefore);
    const banner = await pe(`(() => {const e=document.getElementById('write-error-banner');
      return e&&!e.hidden?document.getElementById('write-error-message')?.textContent:null;})()`);
    throw Error(`${error.message}; webview=${S({ errors: writes.errors, responses: writes.responses, banner })}`);
  }
  await sleep(600);
  return { start, delta, live };
}
let currentId;
const hasField = (id, field) => id !== 'still-item' || !/^scale[XY]$/u.test(field);
const resizeField = id => id === 'still-item' ? 'scale' : 'scaleX';
async function operation(id, label, kind, field, value, time) {
  currentId = id;
  return record(label, id, { field, time, retained: true, writesPlayheadKeyframe: true }, async () => {
    await ready(id, time);
    const before = await state(id), shotBefore = await capture('before');
    const gesture = kind === 'field' ? (await setField(field, value), { field, value }) : await drag(kind);
    await ready(id, time);
    const after = await state(id);
    await sleep(2200);
    const held = await state(id), shotAfter = await capture('after');
    await seek(time === 4 ? 3.5 : time + .5);
    await ready(id, time);
    const returned = await state(id);
    const changed = diff(before, after), t = Math.round(time * 30);
    const point = held.item?.keyframes?.find(k => k.t === t);
    const key = kind === 'move' ? 'x' : kind === 'resize' ? resizeField(id) : kind === 'rotate' ? 'rotate' : field;
    const expectedValue = kind === 'field' ? (field.startsWith('scale') ? value / 100 : value) : undefined;
    const changedAt = changed.keyframes.find(entry => entry.t === t);
    const axes = kind === 'move' ? ['x', 'y'] : kind === 'resize' || field.startsWith('scale')
      ? ['scale', 'scaleX', 'scaleY'] : [key];
    const edited = Boolean(changedAt && axes.some(axis =>
      S(changedAt.before?.transform?.[axis]) !== S(changedAt.after?.transform?.[axis])));
    const heldValue = kind === 'resize' || field.startsWith('scale')
      ? point?.transform?.[key] ?? point?.transform?.scale
      : point?.transform?.[key];
    const valuesMatch = expectedValue === undefined || near(heldValue, expectedValue, .05);
    const retained = S(after.item) === S(held.item) && S(held.item) === S(returned.item)
      && sameAppearance(held, returned).ok;
    const ok = Boolean(changed.itemChanged && edited && valuesMatch && retained
      && (kind === 'field' || changedVisual(before, after, field)));
    return { ok, before, after, returned, gesture, diff: changed, screenshotBefore: shotBefore,
      screenshotAfter: shotAfter, journalDelta: await journalSince(before.journal),
      diagnosis: { writeObserved: changed.itemChanged || after.journal.writes > before.journal.writes,
        wroteBase: Object.keys(changed.base).length > 0, wrotePointAtPlayhead: Boolean(edited),
        evaluationOverridesWrite: changed.itemChanged && !changedVisual(before, after, field),
        heldValue, expectedValue, retained } };
  });
}
async function seedTwoPoints(id) {
  const doc = await readEdit(), target = item(doc, id);
  target.keyframes = [
    { t: 30, transform: { x: -45, y: -18, scale: .8, scaleX: .8, scaleY: .8, rotate: -12 } },
    { t: 90, transform: { x: 62, y: 33, scale: 1.25, scaleX: 1.25, scaleY: 1.25, rotate: 28 } }
  ];
  await writeFile(editPath, canonical.serializeEdit(doc));
  await sleep(1300);
  previewContextValid = false;
}
try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes('--startup-failed')) throw Error('Electron startup failed');
  const target = await waitFor('Theia page', async () => (await targets()).find(t => t.type === 'page'), 600000);
  main = await connect(target);
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
  await waitFor('Theia ready', () => me(`Boolean(window.theia?.container&&document.readyState==='complete')`), 600000);
  await me(`(() => { [...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ')?.click();return true;})()`);
  await command('akari.annotations.open'); await command('akari.inspector.open');
  await attachPreview();
  for (const id of ['html-item', 'still-item']) {
    currentId = id;
    for (const [field, kind, value] of [
      ['x', 'field', -58], ['y', 'field', 23], ['scale', 'field', 112],
      ['rotate', 'field', 17], ['scaleX', 'field', 118], ['scaleY', 'field', 108]
    ].filter(([field]) => hasField(id, field))) await record(`a-prepare-${field}`, id, { baselineEdit: true }, async () => {
      await ready(id, 1); const before = await state(id);
      await setField(field, value); await ready(id, 1); const after = await state(id);
      return { ok: diff(before, after).itemChanged, before, after, diff: diff(before, after) };
    });
    for (const kind of ['resize', 'move', 'rotate']) await record(`a-prepare-handle-${kind}`, id,
      { baselineEdit: true }, async () => {
        await ready(id, 1); const before = await state(id);
        const gesture = await drag(kind); await ready(id, 1); const after = await state(id);
        return { ok: diff(before, after).itemChanged, before, after, gesture, diff: diff(before, after),
          screenshot: await capture('baseline-handle') };
      });
    for (const field of ['x', 'y', 'scale', 'rotate', 'scaleX', 'scaleY'].filter(field => hasField(id, field))) {
      await record(`a-toggle-${field}`, id, { visibleUnchanged: true, keyframeAt: 30 }, async () => {
        await ready(id, 1); const before = await state(id), shotBefore = await capture('toggle-before');
        const action = await toggle(field); await ready(id, 1); const after = await state(id);
        const shotAfter = await capture('toggle-after');
        const key = field, point = after.item?.keyframes?.find(p => p.t === 30);
        const beforeValue = parseFloat(before.inspector[field]?.value);
        const variable = field === 'scaleX' ? '--scale-x' : field === 'scaleY' ? '--scale-y'
          : `--${field}`;
        const evaluated = parseFloat(before.visual.vars[variable]);
        const expectedValue = Number.isFinite(evaluated) ? evaluated
          : field.startsWith('scale') ? beforeValue / 100 : beforeValue;
        const pointValue = point?.transform?.[key];
        const appearance = sameAppearance(before, after);
        return { ok: appearance.ok && near(pointValue, expectedValue, .05), before, after,
          screenshotBefore: shotBefore, screenshotAfter: shotAfter,
          diff: diff(before, after), pointValue, expectedValue, appearance, action,
          journalDelta: await journalSince(before.journal),
          diagnosis: { writeObserved: diff(before, after).itemChanged,
            wroteBase: Object.keys(diff(before, after).base).length > 0,
            evaluationOverridesWrite: diff(before, after).itemChanged && !appearance.ok } };
      });
    }
    for (const kind of ['resize', 'move', 'rotate']) await operation(id, `b-handle-${kind}`,
      kind, kind === 'resize' ? resizeField(id) : kind === 'move' ? 'x' : 'rotate', undefined, 1);
    for (const [field, value] of [['x', -27], ['y', 48], ['scale', 126], ['rotate', 37],
      ['scaleX', 132], ['scaleY', 116]].filter(([field]) => hasField(id, field))) await operation(id, `b-inspector-${field}`, 'field', field, value, 1);
    await record('c-seed-two-points', id, { times: [30, 90], distinct: true }, async () => {
      await seedTwoPoints(id); await ready(id, 1);
      const seeded = await state(id);
      return { ok: seeded.item.keyframes?.length >= 2, seeded };
    });
    for (const [place, time] of [['on', 1], ['between', 2], ['outside', 4]]) {
      for (const kind of ['resize', 'move', 'rotate']) await operation(id, `c-${place}-handle-${kind}`,
        kind, kind === 'resize' ? resizeField(id) : kind === 'move' ? 'x' : 'rotate', undefined, time);
      for (const [field, value] of [['x', -19], ['y', 53], ['scale', 137], ['rotate', 43],
        ['scaleX', 141], ['scaleY', 123]].filter(([field]) => hasField(id, field))) await operation(id, `c-${place}-inspector-${field}`,
          'field', field, value, time);
    }
    await record('d-single-undo', id, { itemRestoredByOneUndo: true }, async () => {
      await ready(id, 2); const before = await state(id), screenshotBefore = await capture('undo-before');
      const gesture = await drag('move'); await sleep(600);
      const changed = await state(id);
      const modifier = process.platform === 'darwin' ? 4 : 2;
      await main.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: modifier });
      await main.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: modifier });
      await waitFor('one undo restored the item', async () => S(item(await readEdit(), id)) === S(before.item), 30000)
        .catch(() => undefined);
      await ready(id, 2);
      const undone = await state(id), screenshotAfter = await capture('undo-after');
      return { ok: S(before.item) !== S(changed.item) && S(before.item) === S(undone.item),
        before, changed, undone, gesture, screenshotBefore, screenshotAfter,
        operationDiff: diff(before, changed), undoDiff: diff(changed, undone),
        journalDelta: await journalSince(before.journal),
        diagnosis: { operationChanged: S(before.item) !== S(changed.item),
          restoredByOneUndo: S(before.item) === S(undone.item) } };
    });
    await record('e-seek-away-return', id, { sameDisplayedValues: true }, async () => {
      await ready(id, 2); const before = await state(id), screenshotBefore = await capture('seek-before');
      await seek(3.5); const away = await state(id);
      await ready(id, 2); const returned = await state(id), screenshotAfter = await capture('seek-return');
      const same = sameAppearance(before, returned).ok;
      return { ok: same, before, away, returned, screenshotBefore, screenshotAfter, same,
        awayMediaDatasetStale: away.visual.datasetStale };
    });
  }
} catch (error) { fatal = safe(error.stack ?? error); }
finally {
  const status = !fatal && records.length > 0 && records.every(row => row.status === 'ok') ? 'PASS' : 'FAIL';
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, `run-log-${mode}.json`),
    `${safe(S({ mode, status, records, error: fatal ?? null }))}\n`);
  for (const connection of connections) close(connection);
  console.log(`${status}: run-log-${mode}.json`);
  process.exitCode = mode === 'after' && status !== 'PASS' || fatal ? 1 : 0;
}
