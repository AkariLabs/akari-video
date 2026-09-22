#!/usr/bin/env node
// Real Electron/CDP evidence; state reads never replace the tested gestures.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual as equal } from 'node:util';
import { CDP, evalOn as rawEvalOn, realClick, keyPress, screenshot }
  from '../../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';
const [, , portArg, workspaceArg, evidenceArg] = process.argv;
if (!workspaceArg || !evidenceArg) throw new Error('usage: run-l1.mjs <port> <workspace> <evidence>');
const port = Number(portArg || 9758);
const project = path.resolve(workspaceArg, 'project');
const editPath = path.join(project, 'edit.json');
const evidence = path.resolve(evidenceArg);
const S = JSON.stringify;
const READY_MS = 600_000, ACTION_MS = 60_000;
const connections = new Set(), records = [], events = [];
const startedAt = new Date().toISOString();
const EXPECTED_STATE_API = { object: 'window.akari.interaction', getters: ['selectedId', 'scopeId', 'floorScopeId', 'activeEdit', 'selectedIds', 'selectionKind'] };
let main, preview, contextId, fatalError;
const check = (condition, message, observed) => {
  if (!condition) throw new Error(message + (observed === undefined ? '' : ': ' + S(observed)));
};
async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function connect(target) {
  const cdp = new CDP(target.webSocketDebuggerUrl);
  connections.add(cdp);
  await bounded(cdp.connect(), 20_000, 'CDP connect');
  const send = cdp.send.bind(cdp);
  cdp.send = (method, params) => bounded(send(method, params), 20_000, method);
  return cdp;
}
const evaluate = (cdp, expression, id) => rawEvalOn(cdp, expression, id);
const pe = expression => evaluate(preview, expression, contextId);
async function targets() {
  const result = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  check(result.ok, 'CDP target list HTTP status', result.status);
  return result.json();
}
async function waitFor(label, predicate, timeout = ACTION_MS) {
  const until = Date.now() + timeout;
  let lastError;
  while (Date.now() < until) {
    try { const value = await predicate(); if (value) return value; }
    catch (error) { lastError = error.message; }
    await sleep(150);
  }
  throw new Error(`timeout: ${label}${lastError ? ` (${lastError})` : ''}`);
}

async function command(id, argument) {
  return evaluate(main, `(async () => {
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
      && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
    if(!key)throw new Error('Command registry unavailable');
    await c.get(key).executeCommand(${S(id)}${argument === undefined ? '' : `, ${S(argument)}`}); return true;
  })()`);
}

// Read the real widget, including its protected TS fields, through the same
// Theia DI / ApplicationShell route used by the existing evidence scripts.
const TIMELINE_STATE = `(() => {
  const c=window.theia.container;
  const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
    && typeof k.prototype?.getCurrentWidget==='function'
    && typeof k.prototype?.addWidget==='function' && typeof k.prototype?.activateWidget==='function');
  if(!key)throw new Error('ApplicationShell binding unavailable');
  const w=c.get(key).widgets.find(w=>w.id==='akari-annotations-widget');
  if(!w || !w.focusScope)throw new Error('Timeline widget/focusScope unavailable');
  const selectedRows=[...w.node.querySelectorAll('[data-akari-tree-row-id].akari-annotations-selected')]
    .map(e=>e.dataset.akariTreeRowId);
  return {rootId:w.focusScope.rootId, collapsedIds:[...w.timelineCollapsedIds], selectedId:w.selection?.id ?? null,
    selection:w.selection ?? null, selectedRows:[...new Set(selectedRows)].sort(),
    breadcrumbs:w.focusScope.breadcrumbs,
    zoom:document.querySelector('[data-testid="akari-timeline-zoom-percent"]')?.textContent ?? null};
})()`;
const timeline = () => evaluate(main, TIMELINE_STATE);

async function state() {
  return pe(`(() => {
    const a=${EXPECTED_STATE_API.object};
    const missing=${S(EXPECTED_STATE_API.getters)}.filter(k=>!a || !(k in a));
    if(missing.length)throw new Error('EXPECTED_STATE_API missing: '+missing.join(', '));
    for(const k of ['selectedId','scopeId','floorScopeId']) {
      if(a[k]!==null && typeof a[k]!=='string')throw new Error('Invalid state getter: '+k);
    }
    return {selectedId:a.selectedId,selectedIds:a.selectedIds,selectionKind:a.selectionKind,scopeId:a.scopeId,floorScopeId:a.floorScopeId,activeEdit:Boolean(a.activeEdit)};
  })()`);
}
async function expectState(expected) {
  return waitFor(`preview state ${S(expected)}`, async () => {
    const value = await state();
    return Object.entries(expected).every(([key, entry]) => equal(value[key], entry)) && value;
  });
}

async function previewFocus(label) {
  const observed = await pe(`(() => {
    const e=document.activeElement;
    return {hasFocus:document.hasFocus(),instance:window.__akariDrillInEvidence?.instance??null,
      activeElement:e?{tag:e.tagName,id:e.id,editable:e.isContentEditable===true}:null};
  })()`);
  events.push({ kind: 'preview-focus', at: Date.now(), data: { label, ...observed } });
  return observed;
}
async function requirePreviewFocus(label) {
  const observed = await previewFocus(label);
  check(observed.hasFocus, 'preview document must have focus before keyboard input', { label, ...observed });
  return observed;
}
async function press(key, cdp = preview) {
  // Do not refocus here: another click would alter the Esc ladder being tested.
  // Preparations acquire focus with real pointer input; tested keys only assert it.
  const focusBefore = cdp === preview ? await requirePreviewFocus(`before ${key}`) : null;
  const code = key === 'Escape' ? 27 : 13;
  await keyPress(cdp, { key, code: key, windowsVirtualKeyCode: code });
  // Key events and Theia's forwarded event must both have had a chance to run.
  await sleep(500);
  return focusBefore;
}

async function attachPreview() {
  await command('akari.preview.ensureVisible', { editUri: pathToFileURL(editPath).href });
  // Like focus-mode clickPreviewPart: attach to the webview iframe target, then
  // find active-frame's execution context via Runtime.executionContextCreated.
  const candidates = new Map();
  await waitFor('preview iframe and overlay stage', async () => {
    for (const target of (await targets()).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) {
      if (!candidates.has(target.id)) {
        const cdp = await connect(target);
        const contexts = new Map();
        candidates.set(target.id, { cdp, contexts });
        cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context));
        cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
        cdp.on('Runtime.executionContextsCleared', () => contexts.clear());
        cdp.on('Runtime.bindingCalled', event => {
          if (event.name === '__akariL1Observe') {
            try { events.push({ ...JSON.parse(event.payload), contextId: event.executionContextId }); }
            catch (error) { events.push({ kind: 'hook-error', error: error.message }); }
          }
        });
        await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      }
      const { cdp, contexts } = candidates.get(target.id);
      for (const candidate of contexts.values()) {
        try {
          if (await evaluate(cdp, `Boolean(document.querySelector('#overlay-stage [data-overlay-id]')
            && window.akari?.engine?.overlayWrite && window.akari?.state?.editPath===${S(pathToFileURL(editPath).href)})`, candidate.id)) {
            preview = cdp; contextId = candidate.id; return true;
          }
        } catch { /* other isolated / disposed execution context */ }
      }
    }
    return false;
  }, READY_MS);
  await preview.send('Runtime.addBinding', { name: '__akariL1Observe', executionContextId: contextId });
  await pe(`(() => {
    window.addEventListener('message', event => {
      const message=event.data;
      if(message?.type==='akari-preview-expand-bag') window.__akariL1Observe(JSON.stringify({
        kind:'bag-response',bagId:message.bagId,requestId:message.requestId,
        overlayIds:message.summary?.overlays?.map(o=>o.id),at:Date.now()
      }));
    });
  })()`);
}

async function rebuildPreview() {
  const closed = await evaluate(main, `(async () => {
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
      && typeof k.prototype?.getCurrentWidget==='function' && typeof k.prototype?.addWidget==='function'
      && typeof k.prototype?.activateWidget==='function');
    if(!key)throw new Error('ApplicationShell unavailable');
    const shell=c.get(key),result=[];
    const matches=shell.widgets.filter(w=>w.identifier?.id?.startsWith('akari-output-preview-')
      && w.akariPreviewEditUri?.toString()===${S(pathToFileURL(editPath).href)});
    for(const w of matches) {
      await shell.closeWidget(w.id);
      result.push({id:w.id,disposed:w.isDisposed});
      if(!w.isDisposed)throw new Error('Closing output preview did not dispose it');
    }
    return result;
  })()`);
  if (preview) { preview.close(); connections.delete(preview); }
  preview = undefined; contextId = undefined;
  await attachPreview();
  return { path: 'ApplicationShell.closeWidget -> akari.preview.ensureVisible', closed };
}

async function seekSample() {
  await pe(`(() => {
    const seek=document.getElementById('seek'); if(!seek)throw new Error('seek unavailable');
    seek.value='1.5'; seek.dispatchEvent(new Event('input',{bubbles:true}));
    seek.dispatchEvent(new Event('change',{bubbles:true})); return true;
  })()`);
  await waitFor('sample time 1.5s', () => pe(`Math.abs(Number(document.getElementById('seek')?.value)-1.5)<0.05`));
  await pointFor('a');
}

// Choose a painted, hittable descendant, then verify native elementFromPoint
// resolves back to this overlay. Never dispatch a synthetic DOM click or invoke
// selectOverlay/enterScope. Input.dispatchMouseEvent drives all tested gestures.
async function pointFor(id) {
  return waitFor(`hittable preview leaf ${id}`, () => pe(`(() => {
    const mount=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
      .find(e=>e.dataset.overlayId===${S(id)});
    if(!mount)return null;
    const candidates=[...mount.querySelectorAll('*')].filter(e=>
      !['STYLE','SCRIPT'].includes(e.tagName)&&e.textContent.trim());
    candidates.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
    for(const e of candidates) {
      const style=getComputedStyle(e),r=e.getBoundingClientRect();
      if(style.pointerEvents!=='auto'||style.visibility==='hidden'||style.display==='none'||r.width<2||r.height<2)continue;
      for(const fx of [.5,.25,.75])for(const fy of [.5,.25,.75]) {
        const x=r.left+r.width*fx,y=r.top+r.height*fy;
        if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
        const hit=document.elementFromPoint(x,y);
        if(hit?.closest('[data-overlay-id]')===mount)return {x,y,id:${S(id)},tag:e.tagName,text:e.textContent};
      }
    }
    return null;
  })()`));
}
async function clickPreviewPart(id, options = {}) {
  const point = await pointFor(id);
  await realClick(preview, point.x, point.y, options);
  await sleep(400);
  return point;
}
async function deepSelect(id) {
  const modifiers = process.platform === 'darwin' ? 4 : 2;
  await clickPreviewPart(id, { modifiers });
  return expectState({ selectedId: id, activeEdit: false });
}
async function item(id) {
  const edit = JSON.parse(await readFile(editPath, 'utf8'));
  const find = items => { for (const value of items) { if (value.id === id) return value;
    const nested = find(value.items ?? []); if (nested) return nested; } };
  const value = find(edit.tracks.flatMap(t => t.items));
  check(value, 'saved item exists', id); return value;
}
async function mainClick(selector, { clickCount = 1, xRatio = .5 } = {}) {
  // Resolve a fresh element for EVERY attempt. Widget activation can replace the
  // original node between pointerdown and pointerup; retain it only to observe that.
  const before = await waitFor(`UI ${selector}`, () => evaluate(main, `(() => {
    const e=document.querySelector(${S(selector)}); if(!e)return null;
    e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();
    if(!(r.width>0&&r.height>0))return null;
    const x=r.left+r.width*${xRatio},y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
    if(!hit || !e.contains(hit))return null;
    window.__akariDrillInClickTarget=e;
    return {x,y,connected:e.isConnected,hit:{tag:hit.tagName,text:hit.textContent?.trim().slice(0,80)}};
  })()`));
  await realClick(main, before.x, before.y, { clickCount });
  await sleep(300);
  const after = await evaluate(main, `(() => {
    const original=window.__akariDrillInClickTarget,current=document.querySelector(${S(selector)});
    return {originalConnected:original?.isConnected??false,currentConnected:current?.isConnected??false,
      sameElement:original===current};
  })()`);
  return { selector, clickCount, before, after };
}
async function retryMainClick(selector, { label, observations, observe, accept, ...options }) {
  // Retry only when the observed outcome is still absent. Never blindly repeat a
  // toggle that already succeeded, and never replace a native click with DOM click().
  for (let attempt = 1; attempt <= 2; attempt++) {
    const entry = { attempt, operation: 'click', selector, before: await observe() };
    observations.push(entry);
    if (accept(entry.before)) { entry.operation = 'already-satisfied'; entry.ok = true; return entry.before; }
    entry.click = await mainClick(selector, options);
    try {
      await waitFor(label, async () => accept(await observe()), 2000);
    } catch (error) { entry.waitError = error.message; }
    entry.after = await observe();
    entry.ok = accept(entry.after);
    if (entry.ok) return entry.after;
  }
  throw new Error(`${label}: both real click attempts failed: ${S(observations)}`);
}

async function reset(out = {}) {
  const preparation = out.preparation = {
    timelineBefore: await timeline(), previewBefore: await state(), focusExit: []
  };
  if (preparation.timelineBefore.rootId !== null) {
    await retryMainClick('[data-akari-ui="timeline-focus-breadcrumbs"] [data-akari-focus-crumb="0"]', {
      label: 'timeline root restored', observations: preparation.focusExit,
      observe: timeline, accept: value => value.rootId === null
    });
  }
  preparation.rebuild = await rebuildPreview();
  await seekSample();
  await expectState({ floorScopeId: null, activeEdit: false });
  // Reopening restores the timeline selection. Acquire preview focus and return
  // to the root through a real plain click before clearing with Escape.
  preparation.click = await clickPreviewPart('a');
  await expectState({ selectedId: 'a', scopeId: null, floorScopeId: null, activeEdit: false });
  preparation.focusBeforeClear = await press('Escape');
  preparation.previewAfter = await expectState({ selectedId: null, scopeId: null, floorScopeId: null, activeEdit: false });
  preparation.timelineAfter = await timeline();
  check(preparation.timelineAfter.rootId === null, 'step starts outside timeline focus', preparation);
}
async function sample(step, title, action) {
  const record = { step, title, status: 'ng', observations: {} }; records.push(record);
  try {
    await reset(record.observations); await action(record.observations);
    await screenshot(main, path.join(evidence, `step-${step}.png`)); record.status = 'ok';
  } catch (error) {
    record.error = error.stack ?? String(error);
    try { record.preview = await state(); record.timeline = await timeline(); } catch {}
    try { await screenshot(main, path.join(evidence, `failure-${step}.png`)); } catch {}
  }
  console.log(`[step ${step}] ${record.status}`);
}

async function selectThree() {
  await clickPreviewPart('a'); await clickPreviewPart('b', { modifiers: 8 }); await clickPreviewPart('c', { modifiers: 8 });
  return expectState({ selectedIds: ['a','b','c'], selectedId: 'c', selectionKind: 'multi' });
}
async function geometry() {
  return pe(`(() => {
    const a=window.akari.interaction;
    const members=[...document.querySelectorAll('#overlay-stage > [data-akari-interaction-selected]')];
    const rects=members.map(e=>a.fragmentBounds(e));
    const frame=document.querySelector('[data-akari-selection-kind="multi"]'),r=frame?.getBoundingClientRect();
    return {marked:members.map(e=>e.dataset.overlayId),handles:frame?.querySelectorAll('.akari-interaction-handle').length,
      frame:r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom}:null,
      union:rects.length?{left:Math.min(...rects.map(r=>r.left)),top:Math.min(...rects.map(r=>r.top)),
        right:Math.max(...rects.map(r=>r.right)),bottom:Math.max(...rects.map(r=>r.bottom))}:null};
  })()`);
}
const poses = () => pe(`['a','b','c'].map(id=>{
  const e=[...document.querySelectorAll('[data-overlay-id]')].find(e=>e.dataset.overlayId===id);
  if(!e)throw new Error('Missing mount '+id);
  return {id,x:parseFloat(e.style.getPropertyValue('--x'))||0,y:parseFloat(e.style.getPropertyValue('--y'))||0};
})`);
const savedPoses = async () => Promise.all(['a','b','c'].map(async id => {
  const value = await item(id); return { id, x: value.transform?.x ?? 0, y: value.transform?.y ?? 0 };
}));
// Instrument the real singleton host. Delegate every call; do not substitute a
// fake persistence path. Count actual read/lint/write calls for this edit URI.
async function installHostProbe() {
  const installed = await evaluate(main, `(() => {
    if(window.__multiHost)return window.__multiHost.verify();
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
      && typeof k.prototype?.handleOverlayWriteBatch==='function');
    if(!key)throw new Error('Preview host binding unavailable');
    const host=c.get(key),probe={messages:[],reads:0,lints:0,writes:0,lintResults:[],invalidation:null,invalidateNext:false,armed:false};
    const editUri=${S(pathToFileURL(editPath).href)};
    for(const [method,type] of [['handleOverlayWrite','akari-preview-overlay-write'],['handleOverlayWriteBatch','akari-preview-overlay-write-batch']]) {
      const original=host[method];
      host[method]=async function(widget,request) {
        if(probe.armed)probe.messages.push({type,request});
        return original.call(this,widget,request);
      };
    }
    const read=host.readText;
    host.readText=function(uri,...args) {if(probe.armed&&uri.toString()===editUri)probe.reads++;return read.call(this,uri,...args);};
    // JSON-RPC proxies may ignore a method assignment in their get trap.
    // Replace the service reference with a facade over an ordinary target.
    const service=host.previewService,lint=service.lintEditCandidate;
    const lintCandidate=async function(request) {
      const observed=probe.armed&&request.editUri===editUri;
      if(observed) {
        probe.lints++;
        if(probe.invalidateNext) {
          probe.invalidateNext=false;
          const candidate=JSON.parse(request.candidateText);
          const item=candidate.tracks.flatMap(track=>track.items??[]).find(item=>item.id==='c');
          if(item?.source.kind!=='html')throw new Error('L1 invalid-candidate target c missing');
          // Only the lint request is changed. The real lint service must reject
          // this missing reference; never manufacture a failing service result.
          const missingPath='overlays/__l1_missing_c__.html';
          item.source={...item.source,path:missingPath};
          probe.invalidation={itemId:item.id,path:missingPath};
          request={...request,candidateText:JSON.stringify(candidate)};
        }
      }
      const result=await lint.call(service,request);
      if(observed)probe.lintResults.push({pass:result.pass,errors:result.errors});
      return result;
    };
    const wrappedService=new Proxy({}, {
      get(_target,property) {
        if(property==='lintEditCandidate')return lintCandidate;
        const value=Reflect.get(service,property,service);
        return typeof value==='function'?value.bind(service):value;
      }
    });
    host.previewService=wrappedService;
    probe.verify=()=>{
      const checks={serviceReplaced:host.previewService===wrappedService,
        lintMethodReplaced:host.previewService.lintEditCandidate===lintCandidate};
      if(!checks.serviceReplaced||!checks.lintMethodReplaced)throw new Error('Host lint probe installation failed: '+JSON.stringify(checks));
      return checks;
    };
    const checks=probe.verify();
    const write=host.fileService.writeFile;
    host.fileService.writeFile=function(uri,...args) {if(probe.armed&&uri.toString()===editUri)probe.writes++;return write.call(this,uri,...args);};
    window.__multiHost=probe;
    return checks;
  })()`);
  events.push({kind:'host-probe-installed',checks:installed});
}
async function armProbe(invalidate = false) {
  await evaluate(main, `(() => {
    const probe=window.__multiHost;probe.verify();
    Object.assign(probe,{messages:[],reads:0,lints:0,writes:0,lintResults:[],invalidation:null,invalidateNext:${invalidate},armed:true});
  })()`);
  await pe(`(() => {
    window.__multiResponses=[];
    if(!window.__multiResponseListener) {
      window.__multiResponseListener=event=>{if(event.data?.type==='akari-preview-overlay-write-batch-response')window.__multiResponses.push(event.data);};
      window.addEventListener('message',window.__multiResponseListener);
    }
  })()`);
}
async function probeResult() {
  return evaluate(main, `(() => {const p=window.__multiHost;p.armed=false;return {messages:p.messages,reads:p.reads,lints:p.lints,writes:p.writes,lintResults:p.lintResults,invalidation:p.invalidation,checks:p.verify()};})()`);
}
function checkProbe(value, writes = 1) {
  check(value.messages.length === 1 && value.messages[0].type === 'akari-preview-overlay-write-batch', 'one host batch, zero single writes', value);
  check(value.lints === 1 && value.writes === writes, 'one lint and expected physical edit write count', value);
  check(value.lintResults.length === 1 && value.lintResults[0].pass === (writes === 1), 'real lint result matches the write outcome', value);
  // File watchers may also read after success; the structural host test checks
  // that the batch handler itself performs exactly one read.
  check(value.reads >= 1, 'host read observed', value);
}
async function dragThree() {
  const p=await pointFor('a');
  const scale=await pe(`(() => {const e=document.getElementById('overlay-stage');return e.getBoundingClientRect().width/640;})()`);
  await preview.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});
  await preview.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
  for(let i=1;i<=5;i++)await preview.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+25*scale*i/5,y:p.y+18*scale*i/5,button:'left',buttons:1,modifiers:1});
  await preview.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+25*scale,y:p.y+18*scale,button:'left',clickCount:1,modifiers:1});
}
async function waitResponse(ok) {
  return waitFor('batch response',()=>pe(`window.__multiResponses.find(r=>r.ok===${ok})`));
}
function checkDelta(before, after, dx, dy) {
  check(after.every((v,i)=>v.id===before[i].id&&Math.abs(v.x-before[i].x-dx)<.1&&Math.abs(v.y-before[i].y-dy)<.1), 'all members share displacement', {before,after,dx,dy});
}
try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes('--startup-failed')) throw new Error('Launcher setup/readiness failed; see launcher stderr');
  const target = await waitFor('Theia page target', async () => {
    const list = await targets(); return list.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? list.find(t => t.type === 'page');
  }, READY_MS);
  main = await connect(target); await main.send('Runtime.enable'); await main.send('Page.enable');
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
  await waitFor('Theia frontend ready', () => evaluate(main, `Boolean(window.theia?.container && document.readyState==='complete')`), READY_MS);
  await evaluate(main, `(() => {const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ');b?.click();})()`);
  await waitFor('timeline open command', () => command('akari.annotations.open'), READY_MS);
  await waitFor('timeline row', () => evaluate(main, `Boolean(document.querySelector('[data-akari-tree-row-id="g"]'))`), READY_MS);
  await attachPreview(); await installHostProbe();
  await sample(1,'Shift adds two siblings; union and member marks',async out=>{
    await clickPreviewPart('a'); await clickPreviewPart('b',{modifiers:8});
    out.state=await expectState({selectedIds:['a','b'],selectedId:'b',selectionKind:'multi'});
    out.geometry=await geometry();
    check(equal(out.geometry.marked,['a','b'])&&out.geometry.handles===0,'member marks, no handles',out);
    check(Object.keys(out.geometry.union).every(k=>Math.abs(out.geometry.union[k]-out.geometry.frame[k])<2),'union bounds',out);
  });
  await sample(2,'Third sibling toggles in and out',async out=>{
    out.added=await selectThree(); await clickPreviewPart('c',{modifiers:8});
    out.removed=await expectState({selectedIds:['a','b'],selectedId:'b'});
    out.geometry=await geometry(); check(equal(out.geometry.marked,['a','b']),'removed mark cleared',out);
  });
  await sample(3,'Drag three siblings: one real host batch and one file write',async out=>{
    await selectThree(); out.before=await savedPoses(); await armProbe(); await dragThree();
    out.response=await waitResponse(true); out.after=await savedPoses(); checkDelta(out.before,out.after,25,18);
    await sleep(500); out.host=await probeResult(); checkProbe(out.host);
    check(out.host.messages[0].request.writes.length===3,'three patches',out.host);
  });
  await sample(4,'Nudge x3 and Shift down: all +3/+10, one idle batch',async out=>{
    await selectThree(); out.before=await savedPoses(); await armProbe(); await requirePreviewFocus('nudge');
    for(const key of ['ArrowRight','ArrowRight','ArrowRight','ArrowDown'])await keyPress(preview,{key,code:key,windowsVirtualKeyCode:key==='ArrowRight'?39:40,modifiers:key==='ArrowDown'?8:0});
    out.live=await poses(); checkDelta(out.before,out.live,3,10);
    out.immediateMessages=await evaluate(main,'window.__multiHost.messages.length');
    check(out.immediateMessages===0,'no host write before 400ms idle',out);
    out.response=await waitResponse(true); out.after=await savedPoses(); checkDelta(out.before,out.after,3,10);
    await sleep(500); out.host=await probeResult(); checkProbe(out.host);
  });
  await sample(5,'Shift deep click in another scope replaces the set',async out=>{
    await selectThree(); await clickPreviewPart('nested',{modifiers:8|(process.platform==='darwin'?4:2)});
    out.state=await expectState({selectedIds:['nested'],selectedId:'nested',scopeId:'g'});
    // A plain Shift hit outside the current scope also replaces via the common ancestor.
    await clickPreviewPart('a',{modifiers:8}); out.outside=await expectState({selectedIds:['a'],scopeId:null});
  });
  await sample(6,'Escape collapses to representative, next Escape clears',async out=>{
    await selectThree(); await press('Escape'); out.collapsed=await expectState({selectedIds:['c'],selectedId:'c'});
    await press('Escape'); out.cleared=await expectState({selectedIds:[],selectedId:null});
  });
  await sample(7,'Double click narrows to a leaf for text or a group for drill-in',async out=>{
    await selectThree(); await clickPreviewPart('a',{clickCount:2});
    out.text=await expectState({selectedIds:['a'],selectedId:'a',activeEdit:true}); await press('Escape');
    await selectThree(); await clickPreviewPart('nested',{modifiers:8});
    await expectState({selectedIds:['a','b','c','g']}); await clickPreviewPart('nested',{clickCount:2});
    out.drill=await expectState({selectedIds:['nested'],selectedId:'nested',scopeId:'g',activeEdit:false});
  });
  await sample(8,'Real lint rejects a missing-reference candidate: all live positions and edit bytes roll back',async out=>{
    await selectThree(); const beforeText=await readFile(editPath,'utf8'); out.before=await poses();
    await armProbe(true); await dragThree(); out.response=await waitResponse(false);
    out.after=await waitFor('all positions restored',async()=>{const value=await poses();return equal(value,out.before)&&value;});
    check((await readFile(editPath,'utf8'))===beforeText,'edit.json byte identical');
    out.host=await probeResult(); checkProbe(out.host,0);
    check(equal(out.host.invalidation,{itemId:'c',path:'overlays/__l1_missing_c__.html'}),'only c received the invalid lint reference',out.host);
    check(out.response.error?.includes('[references.files]')
      && out.host.lintResults[0].errors.some(error=>error.includes('[references.files]')),
      'failure came from the real file-reference lint check',out);
    out.editUnchanged=true;
  });
} catch(error) { fatalError=error.stack??String(error); }
finally {
  const status=!fatalError&&records.length===8&&records.every(r=>r.status==='ok')?'PASS':'FAIL';
  await mkdir(evidence,{recursive:true});
  await writeFile(path.join(evidence,'run-log.json'),JSON.stringify({status,expectedStateAPI:EXPECTED_STATE_API,startedAt,
    finishedAt:new Date().toISOString(),records,events,...(fatalError?{error:fatalError}:{})},null,2)+'\n');
  for(const cdp of connections){try{cdp.close();}catch{}}
  process.exitCode=status==='PASS'?0:1;
}
