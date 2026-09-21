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
const port = Number(portArg || 9757);
const project = path.resolve(workspaceArg, 'project');
const editPath = path.join(project, 'edit.json');
const evidence = path.resolve(evidenceArg);
const S = JSON.stringify;
const READY_MS = 600_000, ACTION_MS = 60_000;
const connections = new Set(), records = [], events = [];
const startedAt = new Date().toISOString();
const EXPECTED_STATE_API = { object: 'window.akari.interaction', getters: ['selectedId', 'scopeId', 'floorScopeId', 'activeEdit'] };
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
    return {selectedId:a.selectedId,scopeId:a.scopeId,floorScopeId:a.floorScopeId,activeEdit:Boolean(a.activeEdit)};
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
  await pointFor('g1.first');
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
  preparation.click = await clickPreviewPart('plain');
  await expectState({ selectedId: 'plain', scopeId: null, floorScopeId: null, activeEdit: false });
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
async function nudgeKeys() {
  await requirePreviewFocus('before nudge');
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown']) {
    await keyPress(preview, { key, code: key, windowsVirtualKeyCode: key === 'ArrowRight' ? 39 : 40,
      modifiers: key === 'ArrowDown' ? 8 : 0 });
  }
}
// Observe the real main-window event path without consuming or synthesizing keys.
async function startMainArrowProbe() {
  await evaluate(main, `(() => {
    const previous=window.__akariNudgeArrowProbe;
    if(previous)for(const type of ['keydown','keyup'])window.removeEventListener(type,previous.listener,true);
    const probe={events:[]};
    probe.listener=event=>{
      if(!event.key.startsWith('Arrow'))return;
      probe.events.push({type:event.type,key:event.key,code:event.code,isTrusted:event.isTrusted,
        repeat:event.repeat,shiftKey:event.shiftKey,altKey:event.altKey,
        ctrlKey:event.ctrlKey,metaKey:event.metaKey,at:performance.now()});
    };
    for(const type of ['keydown','keyup'])window.addEventListener(type,probe.listener,true);
    window.__akariNudgeArrowProbe=probe;
  })()`);
  return readMainArrowProbe();
}
async function readMainArrowProbe() {
  return evaluate(main, `(() => {
    const probe=window.__akariNudgeArrowProbe;
    if(!probe)throw new Error('Main Arrow probe missing');
    return {count:probe.events.length,
      keydown:probe.events.filter(e=>e.type==='keydown').length,
      keyup:probe.events.filter(e=>e.type==='keyup').length,events:probe.events};
  })()`);
}
async function checkUnselectedArrowControl(out) {
  const control=out.unselectedArrowControl={};
  await press('Escape');
  control.previewBefore=await expectState({selectedId:null,scopeId:null,activeEdit:false});
  control.plainBefore=await item('plain');
  control.before=await startMainArrowProbe();
  control.focusBefore=await requirePreviewFocus('before unselected Arrow control');
  await keyPress(preview,{key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  // Allow Theia's forwarded events and any timeline write to settle. Do not send
  // a key directly to main: the control must traverse the preview forwarding path.
  await sleep(1000);
  control.after=await readMainArrowProbe();
  control.forwardingObserved=control.after.count>control.before.count;
  if(control.forwardingObserved) {
    check(control.after.count>0 && control.after.events.every(event=>event.key==='ArrowRight'),
      'unselected preview Arrow reaches the main capture probe',control);
    control.validation='forwarding-positive-control';
  } else {
    control.validation='zero-events-only';
    control.note='No main Arrow event observed for the unselected control within 1000ms; forwarding path unconfirmed.';
    check(control.after.count===0,'no forwarding observed for unselected control',control);
  }
  control.plainAfter=await item('plain');
  // Subsequent reset and playback scenarios locate plain from its current DOM
  // bounds. Group/bag nudge baselines are read afresh; none assumes plain's x/y.
  control.plainHitAfter=await pointFor('plain');
}
async function checkNudge(id, hitId, out) {
  out.before = await item(id);
  await clickPreviewPart(hitId);
  await expectState({ selectedId: id });
  await pe(`(() => {
    window.__nudgeWrites=[];
    const original=window.akari.engine.overlayWrite;
    window.akari.engine.overlayWrite=function(...args) {
      window.__nudgeWrites.push({id:args[1],patch:args[2],at:performance.now()});
      return original.apply(this,args);
    };
  })()`);
  const pose = () => pe(`(() => {
    const e=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')].find(e=>e.dataset.overlayId===${S(hitId)});
    if(!e)throw new Error('Nudge mount missing');
    return {x:parseFloat(e.style.getPropertyValue('--x'))||0,y:parseFloat(e.style.getPropertyValue('--y'))||0};
  })()`);
  out.mainArrowProbe={before:await startMainArrowProbe()};
  check(out.mainArrowProbe.before.count===0,'main Arrow probe starts empty',out.mainArrowProbe);
  try {
    out.liveBefore = await pose();
    await nudgeKeys();
    out.liveAfter = await pose();
    check(out.liveAfter.x === out.liveBefore.x + 3 && out.liveAfter.y === out.liveBefore.y + 10,
      'immediate output-pixel movement', out);
    out.immediateWrites = await pe('window.__nudgeWrites');
    check(out.immediateWrites.length === 0, 'no write before idle', out.immediateWrites);
    out.after = await waitFor('exact persisted nudge', async () => {
      const value = await item(id);
      return value.transform?.x === (out.before.transform?.x ?? 0) + 3
        && value.transform?.y === (out.before.transform?.y ?? 0) + 10 && value;
    });
    await sleep(500);
    out.writes = await pe('window.__nudgeWrites');
    check(out.writes.length === 1 && out.writes[0].id === id, 'one preview write', out.writes);
    out.final = await item(id);
    check(equal(out.final.transform, out.after.transform), 'saved transform stays stable after settling', out);
  } finally {
    out.mainArrowProbe.after=await readMainArrowProbe();
  }
  check(out.mainArrowProbe.after.count===0,
    'handled preview nudge forwards no Arrow keydown or keyup to main',out.mainArrowProbe);
}
async function hoverAt(point) {
  await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await sleep(80);
  return pe(`(() => {
    const e=document.querySelector('[data-akari-ui="preview-hover-frame"]');
    if(!e || e.hidden)return null;
    const r=e.getBoundingClientRect();
    return {id:e.dataset.overlayId,left:r.left,top:r.top,width:r.width,height:r.height,
      pointerEvents:getComputedStyle(e).pointerEvents};
  })()`);
}
const playing = () => pe(`document.getElementById('play-toggle').getAttribute('aria-label')`);
async function transportClick() {
  const p = await pe(`(() => { const r=document.getElementById('play-toggle').getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await realClick(preview, p.x, p.y);
}
try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes('--startup-failed')) throw new Error('Launcher setup/readiness failed; see launcher stderr');
  const target = await waitFor('Theia page target', async () => {
    const list = await targets(); return list.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? list.find(t => t.type === 'page');
  }, READY_MS);
  main = await connect(target);
  await main.send('Runtime.enable'); await main.send('Page.enable');
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
  await waitFor('Theia frontend ready', () => evaluate(main, `Boolean(window.theia?.container && document.readyState==='complete')`), READY_MS);
  await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); b?.click(); })()`);
  await waitFor('timeline open command', () => command('akari.annotations.open'), READY_MS);
  await waitFor('outer timeline row', () => evaluate(main, `Boolean(document.querySelector('[data-akari-tree-row-id="outer"]'))`), READY_MS);
  await attachPreview();
  await sample(1, 'leaf: right x3 / Shift down x1, exact +3/+10 and one write', async out => {
    await checkNudge('plain', 'plain', out);
    await checkUnselectedArrowControl(out);
  });
  await sample(2, 'group and bag: same output-pixel nudge and one write each', async out => {
    out.group = {}; await checkNudge('outer', 'g1.first', out.group);
    out.bag = {}; await reset(out.bag); await checkNudge('lazy', 'lazy', out.bag);
  });
  await sample(3, 'three single clicks cycle front, back, front in current scope', async out => {
    const p = await pointFor('cycle-front.child'); out.states = [];
    for (const selectedId of ['cycle-front', 'cycle-back', 'cycle-front']) {
      await realClick(preview, p.x, p.y);
      out.states.push(await expectState({ selectedId, scopeId: null }));
      await sleep(100);
    }
  });
  await sample(4, 'double click enters the front group without cycling to back', async out => {
    await clickPreviewPart('cycle-front.child', { clickCount: 2 });
    out.state = await expectState({ selectedId: 'cycle-front.child', scopeId: 'cycle-front' });
  });
  await sample(5, 'hover resolves group union outside scope and leaf inside', async out => {
    const p = await pointFor('g1.first'); out.group = await hoverAt(p);
    check(out.group?.id === 'outer' && out.group.pointerEvents === 'none', 'outer hover', out.group);
    out.union = await pe(`(() => {
      const ids=['g1.first','g1.second'];
      const boxes=ids.map(id=>window.akari.interaction.fragmentBounds([...document.querySelectorAll('#overlay-stage > [data-overlay-id]')].find(e=>e.dataset.overlayId===id)));
      const left=Math.min(...boxes.map(r=>r.left)),top=Math.min(...boxes.map(r=>r.top));
      return {left,top,width:Math.max(...boxes.map(r=>r.right))-left,height:Math.max(...boxes.map(r=>r.bottom))-top};
    })()`);
    check(Object.keys(out.union).every(k => Math.abs(out.group[k] - out.union[k]) < 2), 'hover union geometry', out);
    await clickPreviewPart('g1.first');
    check(await hoverAt(p) === null, 'selected group has no hover');
    await press('Enter'); await press('Enter');
    const second = await pointFor('g1.second'); out.leaf = await hoverAt(second);
    check(out.leaf?.id === 'g1.second', 'inside-scope leaf hover', out.leaf);
  });
  await sample(6, 'playing pointerdown pauses; selection stays paused, miss resumes', async out => {
    await transportClick(); await waitFor('playing', async () => (await playing()) === '一時停止');
    const p = await pointFor('plain');
    await preview.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    out.onDown = await playing(); check(out.onDown === '再生', 'paused on pointerdown', out);
    await preview.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    out.selected = await expectState({ selectedId: 'plain' });
    await sleep(150); check((await playing()) === '再生', 'selected stays paused');
    await transportClick(); await waitFor('playing again', async () => (await playing()) === '一時停止');
    const empty = await pe(`(() => {
      const r=document.getElementById('overlay-stage').getBoundingClientRect();
      for(const fx of [.95,.8,.5,.2])for(const fy of [.95,.85,.65]) {
        const x=r.left+r.width*fx,y=r.top+r.height*fy,e=document.elementFromPoint(x,y);
        if(e&&!e.closest('[data-overlay-id],#caption-plate,[data-akari-layer-id]'))return {x,y};
      }
      throw new Error('No blank preview point');
    })()`);
    await preview.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...empty, button: 'left', clickCount: 1 });
    check((await playing()) === '再生', 'blank pointerdown also pauses');
    await preview.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...empty, button: 'left', clickCount: 1 });
    out.empty = await expectState({ selectedId: null });
    await waitFor('miss resumes', async () => (await playing()) === '一時停止');
    out.resumed = await playing(); await transportClick();
  });
} catch (error) {
  fatalError = error.stack ?? String(error);
} finally {
  const status = !fatalError && records.length === 6 && records.every(r => r.status === 'ok') ? 'PASS' : 'FAIL';
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'run-log.json'), JSON.stringify({ status, startedAt,
    finishedAt: new Date().toISOString(), records, events, ...(fatalError ? { error: fatalError } : {}) }, null, 2) + '\n');
  for (const cdp of connections) { try { cdp.close(); } catch {} }
  process.exitCode = status === 'PASS' ? 0 : 1;
}
