#!/usr/bin/env node
// Real Electron/CDP evidence; state reads never replace the tested gestures.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual as equal } from 'node:util';
import { CDP, evalOn as rawEvalOn, realClick, keyPress, screenshot }
  from '../../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';
const [, , portArg, workspaceArg, evidenceArg] = process.argv;
if (!workspaceArg || !evidenceArg) throw new Error('usage: run-l1.mjs <port> <workspace> <evidence>');
const port = Number(portArg || 9747);
const project = path.resolve(workspaceArg, 'project');
const editPath = path.join(project, 'edit.json');
const evidence = path.resolve(evidenceArg);
const S = JSON.stringify;
const READY_MS = 600_000, ACTION_MS = 60_000;
const connections = new Set(), records = [], events = [];
const startedAt = new Date().toISOString();
const EXPECTED_STATE_API = { object: 'window.akari.interaction', getters: ['selectedId', 'scopeId', 'floorScopeId', 'activeEdit'] };
let main, preview, contextId, fatalError, baseline;
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

async function keyboardFocus(label) {
  const [previewState, mainState] = await Promise.all([
    previewFocus(label),
    evaluate(main, `(() => {
      const c=window.theia.container;
      const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
        && typeof k.prototype?.getCurrentWidget==='function'
        && typeof k.prototype?.addWidget==='function' && typeof k.prototype?.activateWidget==='function');
      if(!key)throw new Error('ApplicationShell binding unavailable');
      const shell=c.get(key),e=document.activeElement;
      const widget=w=>w?{id:w.id,title:w.title?.label??null}:null;
      return {hasFocus:document.hasFocus(),
        activeElement:e?{tag:e.tagName,id:e.id,editable:e.isContentEditable===true,
          input:e.matches('input,textarea,select'),widgetId:e.closest('.theia-widget')?.id??null}:null,
        activeWidget:widget(shell.activeWidget),currentWidget:widget(shell.currentWidget)};
    })()`)
  ]);
  const observed = { label, preview: previewState, main: mainState };
  events.push({ kind: 'keyboard-focus', at: Date.now(), data: observed });
  return observed;
}
async function pressFocusedEscape(observation) {
  // A floor Escape is forwarded to the main window's timeline capture handler.
  // Subsequent focus may be in the main document: observe it, never refocus or
  // click between tested Escapes. Fail if neither document actually has focus.
  observation.focusBefore = await keyboardFocus('before tested Escape');
  const focus = observation.focusBefore;
  observation.target = focus.preview.hasFocus ? 'preview' : 'main';
  check(focus.preview.hasFocus || focus.main.hasFocus, 'Escape has no focused application document', focus);
  if (observation.target === 'main') {
    check(!focus.main.activeElement?.editable && !focus.main.activeElement?.input,
      'Escape moved to an editable main-window control', focus);
  }
  await keyPress(observation.target === 'preview' ? preview : main,
    { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(500);
  observation.focusAfter = await keyboardFocus('after tested Escape');
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

async function prepareStep(step, out) {
  const preparation = out.preparation = {
    step, timelineBefore: await timeline(), previewBefore: await state(), focusExit: []
  };
  // Match P1's root-breadcrumb reset. Retries tolerate widget activation replacing
  // the button between down/up, and never repeat a click that already succeeded.
  if (preparation.timelineBefore.rootId !== null) {
    await retryMainClick('[data-akari-ui="timeline-focus-breadcrumbs"] [data-akari-focus-crumb="0"]', {
      label: 'timeline root restored', observations: preparation.focusExit,
      observe: timeline, accept: value => value.rootId === null
    });
  }
  preparation.rebuild = await rebuildPreview();
  await seekSample();
  await expectState({ floorScopeId: null, activeEdit: false });
  preparation.click = await clickPreviewPart('plain');
  await expectState({ selectedId: 'plain', scopeId: null, floorScopeId: null, activeEdit: false });
  preparation.focusBeforeClear = await press('Escape');
  preparation.previewAfter = await expectState({ selectedId: null, scopeId: null, floorScopeId: null, activeEdit: false });
  preparation.timelineAfter = await timeline();
  check(preparation.timelineAfter.rootId === null, 'step starts outside timeline focus', preparation);
  await expectMounts('lazy', 1);
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
async function bagState(id) {
  return pe(`(() => {
    const summary=window.akari.state.summary;
    const nodes=summary.tree.filter(n=>n.id===${S(id)}||n.parentId===${S(id)});
    const ids=new Set(nodes.map(n=>n.id));
    const mounts=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
      .filter(e=>ids.has(e.dataset.overlayId)).map(e=>e.dataset.overlayId);
    return {nodes,mounts,overlays:summary.overlays.filter(o=>ids.has(o.id)).map(o=>({id:o.id,part:o.part,parentId:o.parentId}))};
  })()`);
}
async function expectMounts(id, count) {
  return waitFor(`${id}: ${count} mounts`, async () => {
    const observed = await bagState(id); return observed.mounts.length === count && observed;
  });
}
async function sample(step, title, action) {
  const record = { step, title, status: 'ng', observations: {} };
  records.push(record);
  try {
    await prepareStep(step, record.observations);
    await action(record.observations);
    await screenshot(main, path.join(evidence, `step-${step}.png`));
    record.status = 'ok';
  } catch (error) {
    record.error = error.stack ?? String(error);
    try { record.preview = await state(); record.timeline = await timeline(); } catch {}
    try { await screenshot(main, path.join(evidence, `failure-${step}.png`)); } catch {}
  }
  console.log(`[step ${step}] ${record.status}`);
}
async function fingerprint() {
  const result = {};
  for (const file of ['edit.json', 'overlays/plain.html', 'overlays/card.html', 'overlays/lazy.html']) {
    result[file] = createHash('sha256').update(await readFile(path.join(project, file))).digest('hex');
  }
  return result;
}
try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes('--startup-failed')) throw new Error('Launcher setup/readiness failed; see launcher stderr');
  baseline = await fingerprint();
  const target = await waitFor('Theia page target', async () => {
    const list = await targets();
    return list.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? list.find(t => t.type === 'page');
  }, READY_MS);
  main = await connect(target);
  await main.send('Runtime.enable'); await main.send('Page.enable');
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
  await waitFor('Theia frontend ready', () => evaluate(main, `Boolean(window.theia?.container && document.readyState==='complete')`), READY_MS);
  await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); b?.click(); })()`);
  await waitFor('timeline open command', () => command('akari.annotations.open'), READY_MS);
  await waitFor('outer timeline row', () => evaluate(main, `Boolean(document.querySelector('[data-akari-tree-row-id="outer"]'))`), READY_MS);
  await attachPreview();
  await seekSample();
  await sample(1, 'deep preview selection expands default collapsed ancestors', async out => {
    out.before = await timeline();
    check(out.before.rootId === null && ['outer', 'g1'].every(id => out.before.collapsedIds.includes(id)),
      'start at default collapsed state (no preparatory toggle clicks)', out.before);
    out.preview = await deepSelect('g1.first');
    out.after = await waitFor('timeline selects revealed g1.first', async () => {
      const value = await timeline();
      return value.selectedId === 'g1.first' && value.selectedRows.includes('g1.first') && value;
    });
    check(['outer', 'g1'].every(id => !out.after.collapsedIds.includes(id)), 'both ancestors expanded', out.after);
    check(out.after.rootId === null, 'preview selection leaves focus scope unchanged', out.after);
  });
  await sample(2, 'idle floor Esc exits g1 then outer, one key per timeline step', async out => {
    // Reveal g1 through the product gesture even if step 1 failed before doing so.
    out.revealForFocus = await deepSelect('g1.first');
    out.focusEntry = [];
    await retryMainClick('[data-akari-tree-row-id="g1"]', { clickCount: 2, xRatio: .6,
      label: 'timeline g1 focus', observations: out.focusEntry,
      observe: timeline, accept: value => value.rootId === 'g1' });
    await expectState({ floorScopeId: 'g1', scopeId: 'g1' });
    await clickPreviewPart('g1.first');
    await expectState({ selectedId: 'g1.first', scopeId: 'g1', floorScopeId: 'g1' });
    out.keys = [];
    for (const rootId of ['g1', 'outer', null]) {
      const observation = { expectedRootId: rootId, timelineBefore: await timeline() };
      out.keys.push(observation); // Keep focus/target evidence even if this key fails.
      await pressFocusedEscape(observation);
      observation.preview = await expectState({ selectedId: null, floorScopeId: rootId, scopeId: rootId });
      observation.timeline = await timeline();
      check(observation.timeline.rootId === rootId,
        'one key clears selection or exits exactly one focus level', out.keys);
    }
  });
  await sample(3, 'all-scanned bag mounts only while inside it', async out => {
    await clickPreviewPart('plain');
    out.before = await expectMounts('lazy', 1);
    check(out.before.mounts[0] === 'lazy', 'collapsed mount is the bag itself', out.before);
    check(out.before.nodes.length === 4 && out.before.nodes.every(n => n.lazy === true), 'lazy bag and three child nodes', out.before);
    out.transitions = [];
    for (const gesture of ['double-click', 'Enter', 'deep-click']) {
      if (gesture === 'Enter') {
        await clickPreviewPart('lazy'); await expectState({ selectedId: 'lazy', scopeId: null });
        await press('Enter');
      } else await clickPreviewPart('lazy', gesture === 'double-click'
        ? { clickCount: 2 } : { modifiers: process.platform === 'darwin' ? 4 : 2 });
      const entered = await expectMounts('lazy', 3), selected = await state();
      check(selected.scopeId === 'lazy' && entered.mounts.includes(selected.selectedId), 'entered and selected a part', { entered, selected });
      await clickPreviewPart('plain');
      const exited = await expectMounts('lazy', 1);
      await expectState({ selectedId: 'plain', scopeId: null });
      out.transitions.push({ gesture, entered, selected, exited });
      check(exited.mounts[0] === 'lazy', 'outside click restores single mount', exited);
    }
  });
  await sample(4, 'explicit/excluded bag s01 remains expanded in and out of scope', async out => {
    out.before = await expectMounts('s01', 2);
    check(equal(out.before.mounts, ['s01#A', 's01.B']), 'scanned A and explicit B remain, excluded C is separate', out.before);
    check(out.before.nodes.every(n => !n.lazy), 'explicit bag is not lazy', out.before);
    await clickPreviewPart('s01#A', { clickCount: 2 });
    out.entered = await expectState({ selectedId: 's01#A', scopeId: 's01' });
    out.inside = await expectMounts('s01', 2);
    await clickPreviewPart('plain');
    out.after = await expectMounts('s01', 2);
    check(equal(out.before.overlays, out.after.overlays), 'explicit bag renderer records unchanged', out);
    out.finalFingerprint = await fingerprint();
    check(equal(baseline, out.finalFingerprint), 'selection-only scenarios never write project content', out.finalFingerprint);
  });
} catch (error) {
  fatalError = error.stack ?? String(error);
} finally {
  const status = !fatalError && records.length === 4 && records.every(r => r.status === 'ok') ? 'PASS' : 'FAIL';
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'run-log.json'), JSON.stringify({ status, startedAt,
    finishedAt: new Date().toISOString(), baseline, records, events, ...(fatalError ? { error: fatalError } : {}) }, null, 2) + '\n');
  for (const cdp of connections) { try { cdp.close(); } catch {} }
  process.exitCode = status === 'PASS' ? 0 : 1;
}
