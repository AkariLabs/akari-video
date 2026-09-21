#!/usr/bin/env node

// Stage 2 must expose these READ-ONLY properties on the existing interaction API.
// IDs are string|null; activeEdit is boolean or an object|null (only truthiness is
// inspected). BEFORE deliberately does not require this API.
export const EXPECTED_STATE_API = Object.freeze({
  object: 'window.akari.interaction',
  getters: ['selectedId', 'scopeId', 'floorScopeId', 'activeEdit']
});

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { readInternalEdit } from '../../../../../../../packages/edit-store/lib/internal-model.js';
import { expandBagOverlays } from '../../../../../../../packages/overlay-runtime/src/parts.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { isDeepStrictEqual as equal } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CDP, evalOn as rawEvalOn, realClick, realDrag, keyPress, screenshot
} from '../../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceArg, evidenceArg, modeArg] = process.argv;
const mode = modeArg || process.env.L1_MODE || 'after';
if (!workspaceArg || !evidenceArg || !['before', 'after'].includes(mode)) {
  throw new Error('usage: run-l1.mjs <port> <workspace> <evidence> [before|after]');
}
const port = Number(portArg || process.env.AKARI_CDP_PORT || 9737);
const project = path.resolve(workspaceArg, 'project');
const editPath = path.join(project, 'edit.json');
const evidence = path.resolve(evidenceArg);
const logPath = path.join(evidence, mode === 'before' ? 'run-log-before.json' : 'run-log.json');
const run = promisify(execFile);
const S = JSON.stringify;
const READY_MS = 600_000;
const ACTION_MS = 60_000;
const records = [];
const events = [];
const connections = new Set();
const startedAt = new Date().toISOString();
let main, preview, contextId, fatalError;
let attachmentSequence = 0;
let baseline;
let beforeLog = null;
const check = (condition, message, observed) => {
  if (!condition) throw new Error(`${message}${observed === undefined ? '' : `: ${S(observed)}`}`);
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
const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const git = async (...args) => (await run('git', args, { cwd: project, maxBuffer: 10 * 1024 * 1024 })).stdout;
const diff = () => git('diff', '--no-ext-diff', '--no-color', 'HEAD', '--', 'edit.json');
function locate(doc, id) {
  function visit(items) {
    for (const item of items ?? []) {
      if (item.id === id) return item;
      const found = visit(item.items ?? item.children);
      if (found) return found;
    }
  }
  for (const track of doc.tracks ?? []) { const found = visit(track.items); if (found) return found; }
}
async function partAId() {
  return locate(await readEdit(), 's01')?.items?.find(item => item.source?.part === 'A')?.id ?? 's01#A';
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
  return {rootId:w.focusScope.rootId, selectedId:w.selection?.id ?? null,
    selection:w.selection ?? null, selectedRows:[...new Set(selectedRows)].sort(),
    breadcrumbs:w.focusScope.breadcrumbs,
    zoom:document.querySelector('[data-testid="akari-timeline-zoom-percent"]')?.textContent ?? null};
})()`;
const timeline = () => evaluate(main, TIMELINE_STATE);
const timelineInvariant = t => ({ rootId: t.rootId, selectedId: t.selectedId, selectedRows: t.selectedRows });
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
async function shot(name) { await screenshot(main, path.join(evidence, `${mode}-${name}.png`)); }
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
async function insertPreviewText(text) {
  const focus = await requirePreviewFocus('before Input.insertText');
  check(focus.activeElement?.editable, 'text input must target the active contenteditable', focus);
  await preview.send('Input.insertText', { text });
}

// Observational hooks, installed by CDP only; no production source modification.
// The wrapper delegates overlayWrite with the original arguments/this/promise.
// Incoming message payloads are recorded verbatim. Runtime bindings additionally
// retain observations in Node if a webview context is subsequently destroyed.
async function hookPreview() {
  await preview.send('Runtime.addBinding', { name: '__akariL1Observe', executionContextId: contextId });
  await pe(`(() => {
    if(window.__akariDrillInEvidence)return true;
    const journal=window.__akariDrillInEvidence={instance:${++attachmentSequence},responses:[],writes:[]};
    const emit=(kind,data)=>window.__akariL1Observe(JSON.stringify({kind,data,at:Date.now()}));
    window.addEventListener('message',event=>{
      const m=event.data;
      if(m?.type==='akari-preview-overlay-write-response') {
        journal.responses.push(m); emit('response',m);
      }
    },true);
    const engine=window.akari.engine;
    const original=engine.overlayWrite;
    if(typeof original!=='function')throw new Error('overlayWrite unavailable');
    engine.overlayWrite=function(editPath,overlayId,patch) {
      const data={overlayId,patch:JSON.parse(JSON.stringify(patch))};
      journal.writes.push(data); emit('write',data);
      return Reflect.apply(original,this,arguments);
    };
    return true;
  })()`);
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
  await hookPreview();
}
// Use the application's ordinary close -> ensureVisible path. closeWidget
// invokes BaseWidget.onCloseRequest/dispose, so getOrOpenPreview cannot reuse the
// old summary. No disk watcher timeout or private refresh call is involved.
async function rebuildPreview(reason) {
  let previousInstance = null;
  try { previousInstance = await pe('window.__akariDrillInEvidence?.instance ?? null'); } catch {}
  const oldConnection = preview;
  const closed = await evaluate(main, `(async () => {
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
      && typeof k.prototype?.getCurrentWidget==='function' && typeof k.prototype?.addWidget==='function'
      && typeof k.prototype?.activateWidget==='function');
    if(!key)throw new Error('ApplicationShell unavailable');
    const shell=c.get(key);
    const matches=shell.widgets.filter(w=>w.identifier?.id?.startsWith('akari-output-preview-')
      && w.akariPreviewEditUri?.toString()===${S(pathToFileURL(editPath).href)});
    const result=[];
    for(const w of matches) {
      await shell.closeWidget(w.id);
      result.push({id:w.id,disposed:w.isDisposed});
      if(!w.isDisposed)throw new Error('Closing output preview did not dispose it');
    }
    return result;
  })()`);
  if (oldConnection) { try { oldConnection.close(); } catch {} connections.delete(oldConnection); }
  preview = undefined; contextId = undefined;
  await attachPreview();
  await seekSample();
  const instance = await pe('window.__akariDrillInEvidence.instance');
  check(instance !== previousInstance, 'preview reopened with a new observed document', { previousInstance, instance });
  return { reason, path: 'ApplicationShell.closeWidget -> akari.preview.ensureVisible', closed, previousInstance, instance };
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
  const preparation = out.preparation = { timelineBefore: await timeline(), focusExit: [], expansion: [] };
  if (preparation.timelineBefore.rootId !== null) {
    const selector = '[data-akari-ui="timeline-focus-breadcrumbs"] [data-akari-focus-crumb="0"]';
    await retryMainClick(selector, { label: 'timeline root restored', observations: preparation.focusExit,
      observe: timeline, accept: value => value.rootId === null });
  }
  preparation.rebuild = await rebuildPreview(`before step ${step}`);
  preparation.previewReset = await resetPreview();
  if (step === 8 || step === 10) {
    for (const [id, child] of [['outer', 'g1'], ['g1', 'g1.first']]) {
      const selector = `[data-akari-tree-toggle=${S(id)}]`;
      const before = await waitFor(`collapse toggle ${id}`, () => evaluate(main,
        `document.querySelector(${S(selector)})?.textContent ?? null`));
      check(['▸', '▾'].includes(before), 'known tree toggle state', { id, before });
      const expansion = { id, operation: before === '▸' ? 'click-toggle' : 'already-expanded', before, attempts: [] };
      preparation.expansion.push(expansion);
      if (before === '▸') {
        await retryMainClick(selector, { label: `timeline toggle ${id} expanded`, observations: expansion.attempts,
          observe: () => evaluate(main, `document.querySelector(${S(selector)})?.textContent ?? null`),
          accept: value => value === '▾' });
      }
      await waitFor(`expanded timeline child ${child}`, () => evaluate(main,
        `Boolean(document.querySelector(${S(`[data-akari-tree-row-id=${S(child)}]`)}))`));
      expansion.after = await evaluate(main, `document.querySelector(${S(selector)})?.textContent`);
      expansion.visibleChild = child;
    }
  }
  preparation.preview = await state();
  preparation.timelineAfter = await timeline();
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
async function resetPreview() {
  const reset = { before: await state() };
  events.push({ kind: 'preview-reset', at: Date.now(), data: reset });
  check(reset.before.floorScopeId === null, 'reset expects timeline outside focus', reset.before);
  // A reopened preview may echo a nested timeline selection without owning the
  // keyboard focus. Clicking a direct child both focuses it and exits that scope.
  reset.focusBeforeClick = await previewFocus('before reset click');
  reset.point = await clickPreviewPart('plain');
  reset.selected = await expectState({ selectedId: 'plain', scopeId: null, floorScopeId: null, activeEdit: false });
  reset.focusBeforeEscape = await press('Escape');
  reset.after = await expectState({ selectedId: null, scopeId: null, floorScopeId: null, activeEdit: false });
  return reset;
}
const selectedBefore = () => pe(`({selectedIds:[...document.querySelectorAll('[data-akari-interaction-selected="true"]')]
  .map(e=>e.dataset.overlayId),activeEdit:Boolean(document.querySelector('[contenteditable="true"]'))})`);
async function journalSince(index) {
  await sleep(250);
  const slice = events.slice(index);
  return { writes: slice.filter(e => e.kind === 'write').map(e => e.data),
    responses: slice.filter(e => e.kind === 'response').map(e => e.data) };
}
function savedWorldTransform(doc, id) {
  const item = locate(doc, id);
  if (item?.source.kind === 'html' && !item.items?.length) {
    const overlays = expandBagOverlays(readInternalEdit(JSON.stringify(doc)), ref =>
      ref.trimStart().startsWith('<') ? ref : readFileSync(path.resolve(project, ref), 'utf8'));
    return overlays.find(overlay => overlay.id === id)?.transform ?? null;
  }
  // Group/bag nodes have no own overlay record. Only group ancestors compose.
  const compose = (p, c = {}) => {
    const r = (p.rotate ?? 0) * Math.PI / 180, scale = p.scale ?? 1;
    return { x: (p.x ?? 0) + scale * (Math.cos(r) * (c.x ?? 0) - Math.sin(r) * (c.y ?? 0)),
      y: (p.y ?? 0) + scale * (Math.sin(r) * (c.x ?? 0) + Math.cos(r) * (c.y ?? 0)),
      scale: scale * (c.scale ?? 1), rotate: (p.rotate ?? 0) + (c.rotate ?? 0) };
  };
  function visit(items, parent) {
    for (const item of items ?? []) {
      const world = compose(parent, item.transform);
      if (item.id === id) return world;
      const found = visit(item.items ?? item.children, item.source.kind === 'group' ? world : parent);
      if (found) return found;
    }
  }
  for (const track of doc.tracks ?? []) { const found = visit(track.items, {}); if (found) return found; }
  return null;
}
const poseMatches = (actual, expected) => Boolean(actual) && Object.keys(expected)
  .every(k => Number.isFinite(actual[k]) && Math.abs(actual[k] - expected[k]) < 1e-4);
async function mountedPose(id) {
  return pe(`(() => {
    const e=[...document.querySelectorAll('[data-overlay-id]')].find(e=>e.dataset.overlayId===${S(id)});
    if(!e)return null;
    const css=getComputedStyle(e);
    return {x:parseFloat(css.getPropertyValue('--x')),y:parseFloat(css.getPropertyValue('--y')),
      scale:parseFloat(css.getPropertyValue('--scale')),rotate:parseFloat(css.getPropertyValue('--rotate'))};
  })()`);
}
async function drag(id, dx = 24, dy = 18) {
  const before = await readEdit();
  const diffBefore = await diff();
  const eventIndex = events.length;
  const from = await pointFor(id);
  await realDrag(preview, [from, { x: from.x + dx, y: from.y + dy }], { steps: 12 });
  let responseError;
  try {
    await waitFor(`write-response after drag ${id}`, () => events.slice(eventIndex).some(e => e.kind === 'response'));
  } catch (error) { responseError = error.message; }
  // Wait for all actual writes to receive responses and for duplicate writes.
  await sleep(700);
  const journal = await journalSince(eventIndex);
  const after = await readEdit();
  let persistedPose;
  if (mode === 'after' && journal.responses[0]?.ok && journal.writes[0]?.patch.transform) {
    const write = journal.writes[0];
    const persistedId = write.overlayId.includes('#') ? await partAId() : write.overlayId;
    const world = savedWorldTransform(after, persistedId);
    const expected = write.patch.transform;
    persistedPose = { persistedId, world, expected,
      matches: Boolean(world) && Object.keys(expected).every(k => Math.abs(world[k] - expected[k]) < 1e-6) };
    // The host intentionally ignores its own recent writes. Measure the live
    // DOM first, then explicitly reopen from disk and measure the new DOM.
    if (locate(after, persistedId)?.source?.kind === 'html' && !locate(after, persistedId)?.items?.length) {
      try {
        persistedPose.live = await mountedPose(id); // scanned id may still be mounted
        persistedPose.liveMatches = poseMatches(persistedPose.live, expected);
        persistedPose.rebuild = await rebuildPreview(`verify saved pose of ${persistedId}`);
        persistedPose.rendered = await waitFor('saved leaf pose after explicit rebuild', async () => {
          const actual = await mountedPose(persistedId);
          return poseMatches(actual, expected) && actual;
        });
        persistedPose.renderedMatches = poseMatches(persistedPose.rendered, expected);
      } catch (error) { persistedPose.renderError = error.message; }
    }
  }
  return { id, from, delta: { x: dx, y: dy }, before, after,
    diffBefore, diffAfter: await diff(), changed: !equal(before, after), ...journal,
    targetChanged: journal.writes[0] ? !equal(locate(before, journal.writes[0].overlayId)?.transform,
      locate(after, persistedPose?.persistedId ?? journal.writes[0].overlayId)?.transform) : false,
    ...(persistedPose ? { persistedPose } : {}),
    ...(responseError ? { responseError } : {}) };
}
function observedWrite(observation, expectedId, requireSave) {
  check(!observation.responseError, 'write-response was received', observation);
  check(observation.writes.length > 0 && observation.responses.length > 0,
    'write and response observed', observation);
  for (const response of observation.responses) {
    check(typeof response.ok === 'boolean', 'response contains ok/error', observation.responses);
    if (response.ok === false) check(typeof response.error === 'string',
      'failed response contains error', observation.responses);
  }
  if (requireSave) {
    check(observation.writes.length === 1 && observation.responses.length === 1,
      'one write and one response per gesture', observation);
    check(observation.writes[0].overlayId === expectedId, 'write target matches selection', observation.writes);
    check(observation.responses[0].ok === true, 'write succeeded', observation.responses);
    check(observation.persistedPose?.matches && !observation.persistedPose.renderError,
      'saved local transforms reproduce the output-space pose', observation.persistedPose);
    if (observation.persistedPose.liveMatches !== undefined) {
      check(observation.persistedPose.liveMatches && observation.persistedPose.renderedMatches,
        'both live and rebuilt DOM poses match the write', observation.persistedPose);
    }
    check(observation.targetChanged, 'target transform changed on disk (formatting is not a criterion)', observation);
  }
}
async function geometry(ids) {
  return pe(`(() => {
    const rect=r=>r?({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}):null;
    const visible=e=>{for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);
      if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}return true;};
    const leaves=${S(ids)}.map(id=>{
      const e=[...document.querySelectorAll('[data-overlay-id]')].find(e=>e.dataset.overlayId===id);
      return {id,visible:Boolean(e&&visible(e)),bounds:e&&visible(e)?rect(window.akari.interaction.fragmentBounds(e)):null};
    });
    const boxes=leaves.filter(e=>e.visible&&e.bounds?.width>0&&e.bounds?.height>0).map(e=>e.bounds);
    const union=boxes.length?{left:Math.min(...boxes.map(r=>r.left)),top:Math.min(...boxes.map(r=>r.top)),
      right:Math.max(...boxes.map(r=>r.right)),bottom:Math.max(...boxes.map(r=>r.bottom))}:null;
    if(union){union.width=union.right-union.left;union.height=union.bottom-union.top;}
    const frame=[...document.querySelectorAll('.akari-interaction-selection-frame')].find(visible);
    const handles=[...document.querySelectorAll('.akari-interaction-handle,[data-akari-interaction="selection-handle"]')]
      .filter(e=>visible(e)&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);
    return {leaves,union,frame:frame?rect(frame.getBoundingClientRect()):null,
      kind:frame?.getAttribute('data-akari-selection-kind')??null,visibleHandles:handles.length};
  })()`);
}
const nearRect = (a, b) => Boolean(a && b && ['left', 'top', 'right', 'bottom'].every(k => Math.abs(a[k] - b[k]) <= 2));
async function breadcrumb() {
  return pe(`(() => {
    const e=document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]');
    const r=e?.getBoundingClientRect();
    return {text:e?.textContent??'',visible:Boolean(r?.width&&r?.height&&getComputedStyle(e).visibility!=='hidden')};
  })()`);
}
async function beginText(id) {
  await deepSelect(id);
  await clickPreviewPart(id, { clickCount: 2 });
  await expectState({ selectedId: id, activeEdit: true });
  return waitFor('contenteditable on selected leaf', () => pe(`(() => {
    const e=document.querySelector('[contenteditable="true"][data-akari-interaction-editing="true"]');
    return e?.closest('[data-overlay-id]')?.dataset.overlayId===${S(id)}
      ?{text:e.textContent,tag:e.tagName,contenteditable:e.getAttribute('contenteditable')}:null;
  })()`));
}
async function sampleRecord(step, title, action) {
  const record = { step, title, status: 'ng', observations: {}, startedAt: new Date().toISOString() };
  records.push(record);
  try {
    if (mode === 'after') await prepareStep(step, record.observations);
    await action(record.observations); record.status = 'ok';
  }
  catch (error) {
    record.error = error.stack ?? String(error);
    try { record.failureState = mode === 'after' ? await state() : await selectedBefore(); } catch {}
    try { record.failureTimeline = await timeline(); } catch {}
    try { await shot(`failure-${String(step).padStart(2, '0')}`); } catch {}
  }
  console.log(`[${mode} step ${step}] ${record.status}`);
}

async function instructionZero(out) {
  out.cases = [];
  for (const id of ['g1.first', await partAId()]) {
    const sample = { id, status: 'ng' };
    out.cases.push(sample);
    try {
      await seekSample();
      if (mode === 'after') {
        sample.reset = await resetPreview();
        // AFTER must drill to the leaf (deep click) to remeasure the same write
        // target. A plain root click now intentionally selects outer / s01.
        sample.selection = await deepSelect(id);
      } else {
        await clickPreviewPart(id);
        sample.selection = await selectedBefore();
      }
      sample.timeline = await timeline();
      sample.drag = await drag(id);
      observedWrite(sample.drag, id, mode === 'after');
      if (mode === 'before') sample.directLeafObserved = sample.selection.selectedIds.includes(id);
      sample.status = 'ok';
    } catch (error) { sample.error = error.stack ?? String(error); }
  }
  if (mode === 'after') {
    out.beforeAvailable = Boolean(beforeLog);
    out.comparison = out.cases.map(current => ({ id: current.id,
      before: beforeLog?.records?.find(r => r.step === 1)?.observations?.cases?.find(c => c.id === current.id) ?? null,
      after: current }));
  }
  out.gitDiff = await diff();
  check(out.cases.every(c => c.status === 'ok'), 'instruction 0 observations', out.cases);
}

try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes('--startup-failed')) throw new Error('Launcher setup failed, Electron exited, or readiness exceeded 600 seconds; see launcher stderr');
  baseline = { commit: (await git('rev-parse', 'HEAD')).trim(),
    editSha256: createHash('sha256').update(await readFile(editPath)).digest('hex'), edit: await readEdit() };
  check((await diff()) === '', 'fixture must start with a clean edit.json diff');
  if (mode === 'after') {
    try { beforeLog = JSON.parse(await readFile(path.join(evidence, 'run-log-before.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (beforeLog) check(beforeLog.baseline?.editSha256 === baseline.editSha256,
      'BEFORE and AFTER fixture baselines match', { before: beforeLog.baseline?.editSha256, after: baseline.editSha256 });
  }
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
  await sampleRecord(1, 'instruction 0: nested HTML and scanned bag part drag/write observation', instructionZero);

  if (mode === 'after') {
    await sampleRecord(2, 'root click selects group and timeline group row', async out => {
      await resetPreview(); await seekSample();
      out.point = await clickPreviewPart('g1.first');
      out.preview = await expectState({ selectedId: 'outer', scopeId: null, floorScopeId: null, activeEdit: false });
      out.timeline = await waitFor('timeline selects outer', async () => {
        const t = await timeline(); return t.selectedId === 'outer' && t.selectedRows.includes('outer') && t;
      });
      check(out.timeline.rootId === null, 'preview selection leaves timeline unfocused', out.timeline);
    });
    await sampleRecord(3, 'group frame is visible descendant union without handles', async out => {
      await resetPreview(); await clickPreviewPart('g1.first');
      await expectState({ selectedId: 'outer' });
      out.geometry = await geometry(['g1.first', 'g1.second']);
      check(out.geometry.leaves.filter(l => l.visible).length === 2, 'two visible children exercise union', out.geometry);
      check(nearRect(out.geometry.frame, out.geometry.union), 'selection frame matches union within 2 client px', out.geometry);
      check(out.geometry.kind === 'group' && out.geometry.visibleHandles === 0, 'group has no visible resize/rotation handles', out.geometry);
      await shot('03-group-union');
    });
    await sampleRecord(4, 'one group drag changes only group transform.x/y', async out => {
      await resetPreview(); await clickPreviewPart('g1.first');
      await expectState({ selectedId: 'outer' });
      out.drag = await drag('g1.first', 18, 14);
      observedWrite(out.drag, 'outer', true);
      const old = locate(out.drag.before, 'outer');
      const next = locate(out.drag.after, 'outer');
      const normalized = structuredClone(out.drag.after);
      locate(normalized, 'outer').transform = structuredClone(old.transform);
      check(equal(normalized, out.drag.before), 'all other edit.json fields, including child transforms, unchanged', out.drag);
      const oldOther = { ...old.transform }, nextOther = { ...next.transform };
      delete oldOther.x; delete oldOther.y; delete nextOther.x; delete nextOther.y;
      check(equal(oldOther, nextOther), 'group scale/rotation remain unchanged', { oldOther, nextOther });
      check(Number.isFinite(next.transform.x) && Number.isFinite(next.transform.y)
        && (old.transform.x !== next.transform.x || old.transform.y !== next.transform.y), 'group translation saved', { old, next });
      const patch = out.drag.writes[0].patch;
      check(equal(Object.keys(patch), ['transform']) && Object.keys(patch.transform).every(k => ['x', 'y'].includes(k)),
        'group write contains translation only', patch);
    });
    await sampleRecord(5, 'double-click drills one level and shows breadcrumb without timeline focus', async out => {
      await resetPreview(); out.timelineBefore = await timeline();
      await clickPreviewPart('g1.first', { clickCount: 2 });
      out.preview = await expectState({ selectedId: 'g1', scopeId: 'outer', activeEdit: false });
      out.breadcrumb = await breadcrumb(); out.timelineAfter = await timeline();
      check(out.breadcrumb.visible && /全体\s*›\s*outer/u.test(out.breadcrumb.text), 'breadcrumb 全体 › outer', out.breadcrumb);
      check(out.timelineAfter.rootId === out.timelineBefore.rootId && out.timelineAfter.zoom === out.timelineBefore.zoom,
        'preview drill-in does not change timeline focus/zoom', out);
      await shot('05-drill-in');
    });
    await sampleRecord(6, 'double-click bag, drag part, persist explicit part override', async out => {
      await resetPreview();
      const id = await partAId();
      out.id = id;
      await clickPreviewPart(id, { clickCount: 2 });
      out.preview = await expectState({ selectedId: id, scopeId: 's01', activeEdit: false });
      out.drag = await drag(id, 18, 12);
      observedWrite(out.drag, id, true);
      const oldBag = locate(out.drag.before, 's01'), bag = locate(out.drag.after, 's01');
      out.explicitPart = bag.items?.find(item => item.source?.part === 'A');
      check(out.explicitPart && Number.isFinite(out.explicitPart.transform?.x)
        && Number.isFinite(out.explicitPart.transform?.y), 'part A has a saved explicit transform', out.explicitPart);
      check(!equal(oldBag.items?.find(item => item.source?.part === 'A')?.transform, out.explicitPart.transform),
        'saved part transform changed', out);
      check(equal(oldBag.transform, bag.transform), 'bag parent transform remains unchanged', { oldBag, bag });
    });
    await sampleRecord(7, 'leaf double-click text editing, real input, Enter commits to file', async out => {
      await resetPreview(); out.editing = await beginText('g1.first');
      const source = locate(await readEdit(), 'g1.first').source;
      out.sourcePath = source.path;
      const htmlPath = path.resolve(project, source.path);
      check(htmlPath.startsWith(`${project}${path.sep}`), 'fixture HTML is inside disposable project');
      out.htmlBefore = await readFile(htmlPath, 'utf8');
      const index = events.length;
      out.inserted = ' L1-Enter';
      await insertPreviewText(out.inserted);
      await press('Enter');
      out.preview = await expectState({ activeEdit: false });
      await waitFor('text write response', () => events.slice(index).some(e => e.kind === 'response'));
      out.journal = await journalSince(index);
      await waitFor('text persisted to HTML', async () => (await readFile(htmlPath, 'utf8')).includes(out.inserted));
      out.htmlAfter = await readFile(htmlPath, 'utf8');
      check(out.htmlAfter !== out.htmlBefore && out.journal.responses.length === 1
        && out.journal.responses[0].ok === true, 'text commit saved once', out);
      out.gitDiff = await git('diff', '--no-ext-diff', '--no-color', 'HEAD', '--', 'edit.json', source.path);
    });
    await sampleRecord(8, 'editing Esc × 4: cancel, parent, outer, clear; timeline unchanged after every key', async out => {
      await resetPreview(); out.editing = await beginText('g1.first');
      const originalHtml = await readFile(path.join(project, locate(await readEdit(), 'g1.first').source.path), 'utf8');
      await insertPreviewText(' L1-Esc');
      // Let the ordinary leaf selection notification settle BEFORE first Esc.
      await waitFor('timeline selected leaf before Esc', async () => {
        const t = await timeline(); return t.selectedId === 'g1.first' && t.selectedRows.includes('g1.first');
      });
      out.timelineBefore = await timeline(); out.keys = [];
      const expected = [
        { selectedId: 'g1.first', scopeId: 'g1', floorScopeId: null, activeEdit: false },
        { selectedId: 'g1', scopeId: 'outer', floorScopeId: null, activeEdit: false },
        { selectedId: 'outer', scopeId: null, floorScopeId: null, activeEdit: false },
        { selectedId: null, scopeId: null, floorScopeId: null, activeEdit: false }
      ];
      for (let i = 0; i < 4; i++) {
        const index = events.length;
        const timelineBeforeKey = await timeline();
        const focusBeforeKey = await press('Escape');
        // Record all four keys even when one expectation fails.
        let transitionError;
        try {
          await expectState(expected[i]);
          if (i === 0) {
            await sleep(300);
            check(!events.slice(index).some(e => e.kind === 'write' || e.kind === 'response'),
              'first Esc cancels without a write');
          }
        } catch (error) { transitionError = error.message; }
        const p = await state(), t = await timeline();
        const item = { key: i + 1, expected: expected[i], focusBeforeKey, preview: p, timelineBefore: timelineBeforeKey, timeline: t,
          journal: await journalSince(index),
          ...(transitionError ? { transitionError } : {}),
          stateOk: !transitionError && Object.entries(expected[i]).every(([k, v]) => equal(p[k], v)),
          timelineUnchanged: equal(timelineInvariant(t), timelineInvariant(timelineBeforeKey)) };
        out.keys.push(item);
      }
      out.html = await readFile(path.join(project, locate(await readEdit(), 'g1.first').source.path), 'utf8');
      check(out.html === originalHtml, 'first Esc cancelled text; disk unchanged', out);
      check(out.keys.every(k => k.stateOk && k.timelineUnchanged), 'one level per key, no extra timeline focus/selection movement', out.keys);
      await shot('08-escape-cleared');
    });
    await sampleRecord(9, 'Cmd/Ctrl click directly selects leaf at parent scope', async out => {
      await resetPreview();
      out.preview = await deepSelect('g1.first');
      check(out.preview.scopeId === 'g1' && out.preview.floorScopeId === null, 'deep click scope is leaf parent', out.preview);
    });
    await sampleRecord(10, 'timeline group double-click sets floor; idle preview Esc exits one timeline level', async out => {
      await resetPreview();
      // prepareStep expanded outer/g1 through real toggle clicks; production
      // auto-expansion is outside this task's widget editing boundary.
      out.focusEntry = [];
      await retryMainClick('[data-akari-tree-row-id="g1"]', { clickCount: 2, xRatio: .6,
        label: 'timeline g1 focus', observations: out.focusEntry,
        observe: timeline, accept: value => value.rootId === 'g1' });
      out.timelineFocused = await waitFor('timeline g1 focus', async () => {
        const value = await timeline(); return value.rootId === 'g1' && value;
      });
      out.floor = await expectState({ floorScopeId: 'g1', scopeId: 'g1' });
      await clickPreviewPart('g1.first');
      await expectState({ selectedId: 'g1.first', scopeId: 'g1', floorScopeId: 'g1' });
      out.keys = [];
      for (let i = 0; i < 4; i++) {
        const focusBeforeKey = await press('Escape');
        out.keys.push({ key: i + 1, focusBeforeKey, preview: await state(), timeline: await timeline() });
      }
      const expectedRoots = ['g1', 'outer', null, null];
      check(out.keys.every((k, i) => k.preview.floorScopeId === expectedRoots[i]
        && k.preview.scopeId === expectedRoots[i] && k.timeline.rootId === expectedRoots[i]),
        'selection clears first; idle floor Esc exits exactly one timeline level', out.keys);
      await shot('10-timeline-floor');
    });
    await sampleRecord(11, 'masked part A bounds exclude sibling parts and differ from bag union', async out => {
      // prepareStep already exited the old timeline floor through its breadcrumb.
      await resetPreview(); await seekSample();
      const id = await partAId();
      await clickPreviewPart(id);
      await expectState({ selectedId: 's01', scopeId: null });
      out.bag = await geometry([id, 's01.B']);
      check(out.bag.leaves.every(l => l.visible) && nearRect(out.bag.frame, out.bag.union), 'bag frame is visible parts union', out.bag);
      await clickPreviewPart(id, { clickCount: 2 });
      await expectState({ selectedId: id, scopeId: 's01' });
      out.part = await geometry([id]);
      out.mask = await pe(`(() => {
        const e=[...document.querySelectorAll('[data-overlay-id]')].find(e=>e.dataset.overlayId===${S(id)});
        const a=e?.querySelector('[data-akari-part="A"]'),b=e?.querySelector('[data-akari-part="B"]'),c=e?.querySelector('[data-akari-part="C"]');
        const r=a?.getBoundingClientRect();
        return {a:r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom}:null,
          siblings:[b,c].map(e=>e?{part:e.dataset.akariPart,display:getComputedStyle(e).display,
            visibility:getComputedStyle(e).visibility,opacity:getComputedStyle(e).opacity}:null)};
      })()`);
      check(nearRect(out.part.frame, out.part.union) && nearRect(out.part.union, out.mask.a), 'part frame matches only visible A', out);
      check(out.mask.siblings.every(s => s && (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0)),
        'B and C stay masked in the A clone', out.mask);
      check(!nearRect(out.part.frame, out.bag.frame)
        && (out.part.frame.width < out.bag.frame.width - 2 || out.part.frame.height < out.bag.frame.height - 2),
        'part A frame is smaller than whole bag frame', out);
      await shot('11-masked-part');
    });
  }
} catch (error) {
  fatalError = error.stack ?? String(error);
} finally {
  // Always persist a status and observations, including startup / missing API
  // failures. Do not overwrite the BEFORE log during AFTER.
  const count = mode === 'before' ? 1 : 11;
  const status = !fatalError && records.length === count && records.every(r => r.status === 'ok') ? 'PASS' : 'FAIL';
  let finalDiff;
  try { finalDiff = await diff(); } catch (error) { finalDiff = { error: error.message }; }
  try {
    await mkdir(evidence, { recursive: true });
    await writeFile(logPath, `${S({ status, mode, startedAt, finishedAt: new Date().toISOString(),
      expectedStateAPI: EXPECTED_STATE_API, baseline, beforeStatus: beforeLog?.status ?? null,
      records, events, finalDiff, ...(fatalError ? { error: fatalError } : {}) }, null, 2)}\n`);
  } finally {
    for (const cdp of connections) { try { cdp.close(); } catch {} }
  }
  console.log(`${mode}: ${status} (${logPath})`);
  process.exitCode = status === 'PASS' ? 0 : 1;
}
