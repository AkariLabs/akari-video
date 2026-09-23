#!/usr/bin/env node

// Electron/CDP acceptance for task instructions 8(1)–(9). Each record contains
// measured values and a verdict; a failed assertion always makes the run FAIL.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, realClick } from '../../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceArg, evidenceArg] = process.argv;
if (!workspaceArg || !evidenceArg) throw new Error('usage: run-l1.mjs <port> <workspace> <evidence>');
const port = Number(portArg || process.env.AKARI_CDP_PORT || 9771);
const editPath = path.resolve(workspaceArg, 'project/edit.json');
const evidence = path.resolve(evidenceArg);
const records = [];
const retries = [];
const connections = new Set();
let main, preview, contextId, previewTargetId, fatal;
let previewContextValid = false, attachmentPromise;
const S = JSON.stringify;
const CDP_SOCKET_OPEN = 1; // readyState OPEN
const check = (condition, label, value) => {
  if (!condition) throw new Error(`${label}: ${S(value)}`);
};
const close = value => { try { value?.close(); } catch {} };
async function bounded(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${label}`)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
async function waitFor(label, fn, limit = 60000) {
  const until = Date.now() + limit;
  let error;
  while (Date.now() < until) {
    try { const value = await fn(); if (value) return value; }
    catch (caught) { error = caught.message; }
    await sleep(150);
  }
  throw new Error(`timeout ${label}${error ? ': ' + error : ''}`);
}
async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  check(response.ok, 'CDP target list', response.status);
  return response.json();
}
async function connect(target, enable = true) {
  const cdp = new CDP(target.webSocketDebuggerUrl);
  connections.add(cdp);
  await bounded(cdp.connect(), 20000, 'CDP connect');
  const send = cdp.send.bind(cdp);
  cdp.ws.addEventListener('close', () => {
    if (cdp === preview) previewContextValid = false;
    for (const pending of cdp.pending.values()) pending.reject(new Error('CDP connection closed'));
    cdp.pending.clear();
  });
  cdp.send = (method, params) => {
    if (cdp.ws.readyState !== CDP_SOCKET_OPEN) return Promise.reject(new Error('CDP connection closed'));
    const requestId = cdp.nextId;
    return bounded(send(method, params), method === 'Runtime.evaluate' ? 60000 : 20000, method)
      .finally(() => cdp.pending.delete(requestId));
  };
  if (enable) { await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); }
  return cdp;
}
const me = expression => evalOn(main, expression);
// Read-only observations may be retried after a host model update replaces the iframe.
// Input.dispatchMouseEvent and Input.dispatchKeyEvent are never replayed here.
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
const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const effectiveScale = (transform, axis) => transform?.[axis] ?? transform?.scale ?? 1;
function item(document, id) {
  const visit = items => {
    for (const current of items ?? []) {
      if (current.id === id) return current;
      const found = visit(current.items ?? current.children);
      if (found) return found;
    }
  };
  for (const track of document.tracks) {
    const found = visit(track.items);
    if (found) return found;
  }
}
async function command(id, argument) {
  return me(`(async()=>{const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
      &&typeof k.prototype?.executeCommand==='function'&&typeof k.prototype?.registerCommand==='function');
    if(!key)throw Error('commands unavailable');
    await c.get(key).executeCommand(${S(id)}${argument === undefined ? '' : ',' + S(argument)}); return true;})()`);
}
async function attachPreview() {
  if (attachmentPromise) return attachmentPromise;
  attachmentPromise = discoverPreview();
  try { await attachmentPromise; } finally { attachmentPromise = undefined; }
}
async function discoverPreview() {
  const previous = preview;
  await command('akari.preview.ensureVisible', { editUri: pathToFileURL(editPath).href });
  const candidates = new Map();
  try { await waitFor('preview iframe', async () => {
    const available = (await targets()).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    for (const [id, candidate] of candidates) {
      if (!available.some(target => target.id === id) || candidate.cdp.ws.readyState !== CDP_SOCKET_OPEN) {
        close(candidate.cdp); connections.delete(candidate.cdp); candidates.delete(id);
      }
    }
    for (const target of available) {
      if (!candidates.has(target.id)) {
        const cdp = await connect(target, false);
        const contexts = new Map();
        candidates.set(target.id, { cdp, contexts });
        cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context));
        cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => {
          contexts.delete(executionContextId);
          if (cdp === preview && contextId === executionContextId) previewContextValid = false;
        });
        cdp.on('Runtime.executionContextsCleared', () => {
          contexts.clear(); if (cdp === preview) previewContextValid = false;
        });
        cdp.on('Page.frameNavigated', ({ frame }) => {
          if (cdp === preview && /webview\/fake\.html/u.test(frame?.url ?? '')) previewContextValid = false;
        });
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
      }
      const { cdp, contexts } = candidates.get(target.id);
      for (const context of contexts.values()) {
        if (context.auxData?.isDefault === false) continue;
        try {
          if (await evalOn(cdp, `Boolean(document.querySelector('#overlay-stage [data-overlay-id]')
              && window.akari?.engine?.overlayWrite
              && window.akari?.state?.editPath===${S(pathToFileURL(editPath).href)})`, context.id)) {
            preview = cdp; contextId = context.id; previewTargetId = target.id;
            previewContextValid = true; return true;
          }
        } catch { /* isolated or disposed context */ }
      }
    }
    return false;
  }, 600000); }
  finally {
    for (const { cdp } of candidates.values()) if (cdp !== preview) {
      close(cdp); connections.delete(cdp);
    }
  }
  if (previous && previous !== preview) { close(previous); connections.delete(previous); }
  try { await evalOn(preview, `(() => {
    if(window.__edgeEvidence)return true;
    const journal=window.__edgeEvidence=JSON.parse(sessionStorage.getItem('__edgeEvidence')||'null')||{writes:[],responses:[]};
    const persist=()=>sessionStorage.setItem('__edgeEvidence',JSON.stringify(journal));
    const original=window.akari.engine.overlayWrite;
    window.akari.engine.overlayWrite=function(edit,id,patch){
      journal.writes.push({id,patch:JSON.parse(JSON.stringify(patch))});persist();
      return Reflect.apply(original,this,arguments);
    };
    window.addEventListener('message',event=>{
      if(event.data?.type==='akari-preview-overlay-write-response'){journal.responses.push(event.data);persist();}
    },true);
    return true;
  })()`, contextId); }
  catch (error) { previewContextValid = false; throw error; }
}
async function seek() {
  await pe(`(() => {const e=document.getElementById('seek');e.value='1.5';
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await waitFor('sample overlays', () => pe(`Boolean(document.querySelector('[data-overlay-id="g1.first"]'))`));
}
async function pointFor(id) {
  return waitFor(`hittable ${id}`, () => pe(`(() => {
    const mount=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
      .find(e=>e.dataset.overlayId===${S(id)}); if(!mount)return null;
    for(const e of [...mount.querySelectorAll('*')].reverse()) {
      const r=e.getBoundingClientRect(),s=getComputedStyle(e);
      if(r.width<3||r.height<3||s.pointerEvents!=='auto')continue;
      for(const fy of [.5,.3,.7,.1,.9])for(const fx of [.5,.3,.7,.1,.9]){
        const x=r.left+r.width*fx,y=r.top+r.height*fy;
        if(document.elementFromPoint(x,y)?.closest('[data-overlay-id]')===mount)return{x,y};
      }
    } return null;
  })()`));
}
async function choose(id, deep = true) {
  if (!deep) await clearPreviewSelection();
  const point = await pointFor(id);
  await realClick(preview, point.x, point.y, { modifiers: deep ? process.platform === 'darwin' ? 4 : 2 : 0 });
  await waitFor(`selection ${deep ? id : 'outer'}`, () => pe(`window.akari.interaction?.selectedId===${S(deep ? id : 'outer')}`));
}
async function clearPreviewSelection() {
  const cleared = `(() => {const a=window.akari.interaction;
    return a?.selectedId == null && a?.scopeId === a?.floorScopeId;})()`;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await pe(cleared)) return;
    const input = preview;
    const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
    await input.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
    await input.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    await sleep(100);
  }
  await waitFor('preview selection and scope cleared by Escape', () => pe(cleared));
}
async function measure() {
  return pe(`(() => {
    const frame=document.querySelector('.akari-interaction-selection-frame:not([hidden])');
    const names=['nw','ne','se','sw','n','e','s','w','rotate'];
    const points=Object.fromEntries(names.map(name=>{
      const node=frame?.querySelector('.akari-interaction-handle.is-'+name);
      const r=node?.getBoundingClientRect();
      return[name,node&&getComputedStyle(node).display!=='none'?{x:r.left+r.width/2,y:r.top+r.height/2}:null];
    }));
    return {kind:window.akari.interaction.selectionKind,points,rotate:frame?.style.transform};
  })()`);
}
async function dragHandle(name, dx, dy, shift = false) {
  const from = (await measure()).points[name];
  check(from, `visible ${name} handle`);
  const input = preview, inputContext = contextId;
  const start = await evalOn(input, 'window.__edgeEvidence.writes.length', inputContext);
  const diskBefore = await readFile(editPath, 'utf8');
  const modifiers = shift ? 8 : 0;
  await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from, button: 'none' });
  await input.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1, modifiers });
  for (let index = 1; index <= 8; index++) await input.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: from.x + dx * index / 8, y: from.y + dy * index / 8,
    button: 'left', buttons: 1, modifiers
  });
  await input.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x + dx,
    y: from.y + dy, button: 'left', modifiers });
  return waitFor(`${name} write`, async () => {
    const journal = await pe('window.__edgeEvidence');
    if (journal.writes.length <= start) return null;
    const reloaded = contextId !== inputContext;
    if (journal.responses.length >= journal.writes.length) return { count: journal.writes.length - start,
      write: journal.writes.at(-1), response: journal.responses.at(-1), reloaded };
    const disk = await readFile(editPath, 'utf8');
    return reloaded && disk !== diskBefore ? { count: journal.writes.length - start, write: journal.writes.at(-1),
      response: { ok: true, source: 'disk (response lost with replaced iframe)' }, reloaded } : null;
  });
}
async function ensureLeafReady() {
  await attachPreview();
  await seek();
  try { await choose('g1.first'); }
  catch (error) {
    const row = await waitFor('timeline row g1.first', () => me(`(() => {
      const e=document.querySelector('[data-akari-tree-row-id="g1.first"]'); if(!e)return null;
      const r=e.getBoundingClientRect(); return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null;
    })()`));
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...row });
    await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...row, button: 'left', buttons: 1, clickCount: 1 });
    await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...row, button: 'left' });
    retries.push({ reselect: 'timeline row', reason: error.message, at: new Date().toISOString() });
  }
}
async function settleInspectorCommit(previous) {
  await waitFor('inspector commit replaced preview iframe', async () => {
    if (!previewContextValid || contextId !== previous.contextId || previewTargetId !== previous.targetId) return true;
    const target = (await targets()).find(candidate => candidate.id === previous.targetId);
    return !target || /webview\/fake\.html/u.test(target.url);
  }, 60000);
  previewContextValid = false;
  await ensureLeafReady();
}
async function inspectorField(name, recover = true) {
  const read = () => me(`(() => {
    const e=document.querySelector('[data-akari-field="transform-${name}"] .akari-inspector-number-handle');
    if(!e)return null; const r=e.getBoundingClientRect();
    return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2,
      value:e.closest('[data-akari-field]')?.querySelector('input')?.value}:null;
  })()`);
  try { return await waitFor(`inspector ${name}`, read, recover ? 2500 : 30000); }
  catch (error) {
    if (!recover) throw error;
    await ensureLeafReady();
    return waitFor(`inspector ${name} after selection`, read, 30000);
  }
}
async function scrubOnce(name, delta, cancel) {
  await inspectorField(name);
  const beforeWorld = await pe(`(() => document.querySelector('[data-overlay-id="g1.first"]')
    ?.style.getPropertyValue('--scale-x'))()`);
  const before = await inspectorField(name);
  const beforeVars = await pe(`(() => {const e=document.querySelector('[data-overlay-id="g1.first"]'),v=k=>e?.style.getPropertyValue(k);
      return {x:parseFloat(v('--x')),y:parseFloat(v('--y')),scaleY:Number(v('--scale-y')||v('--scale')||1)};})()`);
  const previous = { contextId, targetId: previewTargetId };
  await me('(() => { document.activeElement?.blur?.(); window.focus(); return document.activeElement === document.body; })()');
  await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x, y: before.y });
  await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: before.x, y: before.y,
    button: 'left', buttons: 1, clickCount: 1 });
  let live;
  try {
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x + delta, y: before.y,
      button: 'left', buttons: 1 });
    live = await waitFor('HTML live width', async () => {
      const value = await pe(`(() => {const e=document.querySelector('[data-overlay-id="g1.first"]');
        return {x:e?.style.getPropertyValue('--scale-x'),y:e?.style.getPropertyValue('--scale-y')};})()`);
      return Math.abs(Number(value.x) - Number(beforeWorld)) > .005 ? value : null;
    });
    live.vars = await pe(`(() => {const e=document.querySelector('[data-overlay-id="g1.first"]'),v=k=>e?.style.getPropertyValue(k);
      return {x:parseFloat(v('--x')),y:parseFloat(v('--y')),scaleY:Number(v('--scale-y')||v('--scale')||1)};})()`);
    check(previewContextValid && contextId === previous.contextId && previewTargetId === previous.targetId,
      'preview context remained live during scrub', previous);
    if (cancel) {
      const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
      await main.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
      await main.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    }
  } finally {
    await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: before.x + delta,
      y: before.y, button: 'left' });
  }
  const restored = cancel ? await waitFor('HTML width restored', async () => {
    const value = await pe(`(() => document.querySelector('[data-overlay-id="g1.first"]')
      ?.style.getPropertyValue('--scale-x'))()`);
    return Math.abs(Number(value) - Number(beforeWorld)) < .005 ? value : null;
  }) : null;
  return { before, beforeWorld, beforeVars, live, restored, previous,
    ...(cancel ? { after: await inspectorField(name) } : {}) };
}
async function scrub(name, delta, cancel = false) {
  let retry = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const editBefore = await readFile(editPath, 'utf8');
    const beforeContext = contextId;
    try { return { ...await scrubOnce(name, delta, cancel), retry }; }
    catch (error) {
      if (attempt === 2 || (previewContextValid && contextId === beforeContext)) throw error;
      await sleep(700);
      const editAfter = await readFile(editPath, 'utf8');
      check(editAfter === editBefore, 'interrupted scrub did not commit before retry',
        { attempt, error: error.message });
      retry = { attempted: true, reason: error.message, editUnchanged: true };
      retries.push({ ...retry, field: name, cancel, at: new Date().toISOString() });
      await ensureLeafReady();
    }
  }
  throw new Error('scrub retry exhausted');
}
async function setField(name, value) {
  await inspectorField(name);
  const previous = { contextId, targetId: previewTargetId };
  await me(`(() => {const e=document.querySelector('[data-akari-field="transform-${name}"] input');
    if(!e)throw Error('field missing');e.value=${S(String(value))};
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));return true;})()`);
  await sleep(600);
  return previous;
}
async function record(number, label, action) {
  const result = { number, label, status: 'ng', values: {} };
  records.push(result);
  try { result.values = await action(); result.status = 'ok'; }
  catch (error) { result.error = error.stack ?? String(error); throw error; }
}
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;

try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes('--startup-failed')) throw Error('Electron startup failed');
  const target = await waitFor('Theia target', async () => (await targets()).find(t => t.type === 'page'), 600000);
  main = await connect(target);
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
  await waitFor('Theia ready', () => me(`Boolean(window.theia?.container&&document.readyState==='complete')`), 600000);
  await me(`(() => { [...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ')?.click();return true;})()`);
  await command('akari.annotations.open');
  await command('akari.inspector.open');
  await attachPreview(); await seek();

  await record(1, 'leaf has four corners, four edges and rotation', async () => {
    await choose('g1.first'); const frame = await measure();
    check(Object.values(frame.points).filter(Boolean).length === 9, 'nine handles', frame);
    return frame;
  });
  await record(2, 'right edge scales X, anchors left, writes once', async () => {
    const before = await measure(), old = item(await readEdit(), 'g1.first')?.transform;
    const gesture = await dragHandle('e', 34, 0), after = await measure();
    const saved = item(await readEdit(), 'g1.first')?.transform;
    check(gesture.count === 1 && gesture.response.ok === true, 'single persisted write', gesture);
    check(effectiveScale(saved, 'scaleX') > effectiveScale(old, 'scaleX')
      && near(effectiveScale(saved, 'scaleY'), effectiveScale(old, 'scaleY'), .001),
    'X effective scale increases while Y stays fixed', { old, saved });
    check(near(before.points.w.x, after.points.w.x) && near(before.points.w.y, after.points.w.y), 'left anchor', { before, after });
    return { gesture, old, saved, anchorBefore: before.points.w, anchorAfter: after.points.w };
  });
  await record(3, 'bottom edge scales Y only', async () => {
    const old = item(await readEdit(), 'g1.first').transform;
    const gesture = await dragHandle('s', 0, 26), saved = item(await readEdit(), 'g1.first').transform;
    check(gesture.count === 1 && effectiveScale(saved, 'scaleY') > effectiveScale(old, 'scaleY')
      && near(effectiveScale(saved, 'scaleX'), effectiveScale(old, 'scaleX'), .001),
    'Y effective scale increases while X stays fixed', { old, saved, gesture });
    return { old, saved, gesture };
  });
  await record(4, 'rotated edge keeps rectangular corners', async () => {
    await choose('g1.second'); const before = await measure();
    const gesture = await dragHandle('e', 30, 17), after = await measure();
    const p = after.points, u = { x: p.ne.x - p.nw.x, y: p.ne.y - p.nw.y };
    const v = { x: p.se.x - p.ne.x, y: p.se.y - p.ne.y };
    const cosine = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
    check(gesture.count === 1 && Math.abs(cosine) < .015 && near(before.points.w.x, p.w.x)
      && near(before.points.w.y, p.w.y), 'rotated right angle and anchor', { before, after, cosine });
    return { gesture, cosine, corners: p, rotation: after.rotate };
  });
  await record(5, 'Shift corner is free, plain corner proportional', async () => {
    await choose('g1.first');
    const free = await dragHandle('se', 32, 4, true);
    const freePose = item(await readEdit(), 'g1.first').transform;
    check(Math.abs(freePose.scaleX - freePose.scaleY) > .05, 'free axes differ', freePose);
    const plain = await dragHandle('se', 20, 12);
    const plainPose = item(await readEdit(), 'g1.first').transform;
    check(plain.count === 1 && near(plainPose.scaleX / freePose.scaleX,
      plainPose.scaleY / freePose.scaleY, .02), 'plain corner preserves ratio', { freePose, plainPose });
    return { free, plain, freePose, plainPose };
  });
  await record(6, 'group has no edge handles', async () => {
    await choose('g1.first', false); const frame = await measure();
    check(frame.kind === 'group' && ['n', 'e', 's', 'w'].every(key => frame.points[key] === null), 'group edges absent', frame);
    return frame;
  });
  await record(7, 'width scrub is live and commits to edit.json', async () => {
    await choose('g1.first');
    const edit = await readEdit();
    const before = item(edit, 'g1.first').transform;
    const parentScale = (item(edit, 'outer')?.transform?.scale ?? 1)
      * (item(edit, 'g1')?.transform?.scale ?? 1);
    const observed = await scrub('scaleX', 20);
    const saved = await waitFor('width committed', async () => {
      const transform = item(await readEdit(), 'g1.first').transform;
      return transform.scaleX !== before.scaleX ? transform : null;
    });
    check(Number(observed.live.x) > before.scaleX * parentScale, 'HTML live world CSS X', observed);
    check(near(observed.live.vars.x, observed.beforeVars.x, .5) && near(observed.live.vars.y, observed.beforeVars.y, .5)
      && near(observed.live.vars.scaleY, observed.beforeVars.scaleY, .005),
      'width scrub keeps world position and height', { beforeVars: observed.beforeVars, liveVars: observed.live.vars });
    await settleInspectorCommit(observed.previous);
    const cancelled = await scrub('scaleX', 12, true);
    check(near(Number(cancelled.restored), saved.scaleX * parentScale, .01),
      'cancel restores HTML world CSS', cancelled);
    check(near(item(await readEdit(), 'g1.first').transform.scaleX, saved.scaleX, .001),
      'cancel does not write', cancelled);
    return { before, parentScale, observed, saved, cancelled };
  });
  await record(8, 'preview edge updates inspector width', async () => {
    const before = await inspectorField('scaleX');
    const gesture = await dragHandle('e', 24, 0);
    const after = await waitFor('inspector width update', async () => {
      const value = await inspectorField('scaleX');
      return value.value !== before.value ? value : null;
    }, 30000);
    check(gesture.count === 1, 'edge persisted once', gesture);
    return { before, gesture, after };
  });
  await record(9, 'overall scale 50 to 100 preserves axis ratio', async () => {
    const initial = item(await readEdit(), 'g1.first').transform;
    const before50 = await setField('scale', 50);
    const at50 = await waitFor('scale 50 saved', async () => {
      const t = item(await readEdit(), 'g1.first').transform;
      return Math.abs(Math.sqrt(t.scaleX * t.scaleY) - .5) < .02 ? t : null;
    });
    await settleInspectorCommit(before50);
    const before100 = await setField('scale', 100);
    const at100 = await waitFor('scale 100 saved', async () => {
      const t = item(await readEdit(), 'g1.first').transform;
      return Math.abs(Math.sqrt(t.scaleX * t.scaleY) - 1) < .02 ? t : null;
    });
    await settleInspectorCommit(before100);
    check(near(at50.scaleX / at50.scaleY, at100.scaleX / at100.scaleY, .01)
      && at100.scaleX > at50.scaleX && at100.scaleY > at50.scaleY,
    'ratio maintained and both axes changed', { initial, at50, at100 });
    return { initial, at50, at100 };
  });
} catch (error) { fatal = error.stack ?? String(error); }
finally {
  const status = !fatal && records.length === 9 && records.every(record => record.status === 'ok') ? 'PASS' : 'FAIL';
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'run-log.json'), `${S({ status, port, records, retries, error: fatal ?? null }, null, 2)}\n`);
  for (const connection of connections) close(connection);
  console.log(`${status}: ${path.join(evidence, 'run-log.json')}`);
  process.exitCode = status === 'PASS' ? 0 : 1;
}
