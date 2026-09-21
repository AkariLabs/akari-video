#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify, isDeepStrictEqual as equal } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CDP, evalOn as rawEvalOn, realClick, screenshot
} from '../../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceArg, evidenceArg, mode] = process.argv;
if (!workspaceArg || !evidenceArg || mode !== 'after') {
  throw new Error('usage: run-l1.mjs <port> <workspace> <evidence> <after>');
}
const port = Number(portArg || process.env.AKARI_CDP_PORT || 9757);
const project = path.resolve(workspaceArg, 'project');
const editPath = path.join(project, 'edit.json');
const editUri = pathToFileURL(editPath).href;
const evidence = path.resolve(evidenceArg);
const logPath = path.join(evidence, 'run-log.json');
const run = promisify(execFile);
const S = JSON.stringify;
const SAMPLE = 0.5;
const READY_MS = 600_000;
const ACTION_MS = 60_000;
const records = [], events = [], connections = new Set();
const startedAt = new Date().toISOString();
let main, preview, contextId, baseline, fatalError;
let attachmentSequence = 0;
let expectedEditor = null;
const check = (condition, message, observed) => {
  if (!condition) throw new Error(`${message}${observed === undefined ? '' : `: ${S(observed)}`}`);
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
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
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  check(response.ok, 'CDP target list HTTP status', response.status);
  return response.json();
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
const git = async (...args) => (await run('git', ['-c', 'core.hooksPath=/dev/null', ...args],
  { cwd: project, maxBuffer: 10 * 1024 * 1024 })).stdout;
const diff = () => git('diff', '--no-ext-diff', '--no-color', 'HEAD', '--', 'edit.json');
const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));
function locate(doc, id) {
  function visit(items) {
    for (const item of items ?? []) {
      if (item.id === id) return item;
      const found = visit(item.items);
      if (found) return found;
    }
  }
  for (const track of doc.tracks ?? []) { const found = visit(track.items); if (found) return found; }
}
function partIds(doc) {
  return { A: locate(doc, 's01')?.items?.find(item => item.source?.part === 'A')?.id ?? 's01#A',
    B: 's01.B', C: 's01.C' };
}
async function fileSnapshot(relative, newText) {
  const bytes = await readFile(path.join(project, relative));
  const head = bytes.subarray(0, 200);
  return { path: relative, bytes: bytes.length, sha256: hash(bytes),
    head200BytesUtf8: head.toString('utf8'), head200Bytes: [...head],
    containsNewText: newText === undefined ? null : bytes.toString('utf8').includes(newText) };
}
async function diskSnapshot(text) {
  return { captions: await fileSnapshot('captions.json', text), card: await fileSnapshot('overlays/card.html', text),
    plain: await fileSnapshot('overlays/plain.html', text),
    edit: await readEdit(), editSha256: hash(await readFile(editPath)), gitDiff: await diff() };
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
async function state() {
  return pe(`(() => {
    const a=window.akari.interaction;
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

// Same transparent boundary observer as P1: arguments and original promise are
// untouched. The engine sends {type, overlayId, patch} plus its own requestId.
// Responses below retain the actual requestId. No messages are manufactured or
// posted by the harness, and no selection/edit state is assigned through an API.
async function hookPreview() {
  await preview.send('Runtime.addBinding', { name: '__akariL1Observe', executionContextId: contextId });
  await pe(`(() => {
    if(window.__akariPartTextEvidence)return true;
    window.__akariPartTextEvidence={instance:${++attachmentSequence}};
    const emit=(kind,data)=>window.__akariL1Observe(JSON.stringify({kind,data,at:Date.now()}));
    window.addEventListener('message',event=>{
      const m=event.data;
      if(/^akari-preview-(overlay|layer|caption|cut)-write-response$/.test(m?.type))emit('response',m);
    if(m?.type==='akari-preview-set-selected-captions') {
      window.__akariPartTextEvidence.selectedCaptionIds = m.captionIds;
      emit('caption-selection',m);
    }
    },true);
    const engine=window.akari.engine;
    for(const method of ['overlayWrite','layerWrite','captionWrite','cutWrite']) {
      const original=engine[method];
      if(typeof original!=='function')throw new Error(method+' unavailable');
      engine[method]=function(...args) {
        emit('write',{method,args:JSON.parse(JSON.stringify(args))});
        return Reflect.apply(original,this,args);
      };
    }
    return true;
  })()`);
}
async function attachPreview() {
  await command('akari.preview.ensureVisible', { editUri });
  const candidates = new Map();
  await waitFor('preview iframe and overlay stage', async () => {
    for (const target of (await targets()).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) {
      if (!candidates.has(target.id)) {
        const cdp = await connect(target), contexts = new Map();
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
            && window.akari?.engine?.overlayWrite && window.akari?.state?.editPath===${S(editUri)})`, candidate.id)) {
            preview = cdp; contextId = candidate.id; return true;
          }
        } catch { /* Another isolated or disposed execution context. */ }
      }
    }
    return false;
  }, READY_MS);
  for (const { cdp } of candidates.values()) {
    if (cdp !== preview) { cdp.close(); connections.delete(cdp); }
  }
  await hookPreview();
}
async function closePreview() {
  // BaseWidget disposal invalidates the cached summary; the next open rereads
  // files. This deliberately does not rely on the suppressed own-write watcher.
  const closed = await evaluate(main, `(async () => {
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
      && typeof k.prototype?.getCurrentWidget==='function' && typeof k.prototype?.addWidget==='function'
      && typeof k.prototype?.activateWidget==='function');
    if(!key)throw new Error('ApplicationShell unavailable');
    const shell=c.get(key), result=[];
    const matches=shell.widgets.filter(w=>w.identifier?.id?.startsWith('akari-output-preview-')
      && w.akariPreviewEditUri?.toString()===${S(editUri)});
    for(const w of matches) {
      await shell.closeWidget(w.id); result.push({id:w.id,disposed:w.isDisposed});
      if(!w.isDisposed)throw new Error('Closing output preview did not dispose it');
    }
    return result;
  })()`);
  if (preview) { try { preview.close(); } catch {} connections.delete(preview); }
  preview = undefined; contextId = undefined;
  return closed;
}
async function seekSample() {
  // P1's ordinary seek input path is setup only; tested edits use CDP Input.
  await pe(`(() => {
    const seek=document.getElementById('seek'); if(!seek)throw new Error('seek unavailable');
    seek.value=${S(String(SAMPLE))}; seek.dispatchEvent(new Event('input',{bubbles:true}));
    seek.dispatchEvent(new Event('change',{bubbles:true})); return true;
  })()`);
  await waitFor('sample time', () => pe(`Math.abs(Number(document.getElementById('seek')?.value)-${SAMPLE})<0.01`));
  const ids = [...Object.values(partIds(await readEdit())), 'plain'];
  await waitFor('all four mounted sample leaves', () => pe(`(() => {
    const ids=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')].map(e=>e.dataset.overlayId);
    return ${S(ids)}.every(id=>ids.includes(id));
  })()`));
  await pe('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
}
async function activatePreviewWidget() {
  return evaluate(main, `(async () => {
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
      && typeof k.prototype?.getCurrentWidget==='function' && typeof k.prototype?.addWidget==='function'
      && typeof k.prototype?.activateWidget==='function');
    if(!key)throw new Error('ApplicationShell unavailable');
    const shell=c.get(key);
    const widget=shell.widgets.find(w=>w.identifier?.id?.startsWith('akari-output-preview-')
      && w.akariPreviewEditUri?.toString()===${S(editUri)});
    if(!widget || widget.isDisposed)throw new Error('Live output preview widget unavailable');
    await shell.activateWidget(widget.id);
    return {widgetId:widget.id,activeWidgetId:shell.activeWidget?.id??null};
  })()`);
}
async function reopen(reason, closed) {
  await attachPreview(); await seekSample();
  const activation = await activatePreviewWidget();
  return { reason, path: 'ApplicationShell.closeWidget -> akari.preview.ensureVisible -> ApplicationShell.activateWidget', closed, activation,
    instance: await pe('window.__akariPartTextEvidence.instance') };
}
async function resetCase(observations) {
  const focusAttempts = observations.focusAttempts ??= [];
  expectedEditor = null;
  const closed = await closePreview();
  await evaluate(main, `window.getSelection()?.removeAllRanges()`);
  // Refuse inherited Git locations or a caller-supplied product checkout.
  check(await realpath((await git('rev-parse', '--show-toplevel')).trim()) === await realpath(project),
    'reset is restricted to the disposable project repository');
  check((await git('rev-parse', 'HEAD')).trim() === baseline.commit, 'fixture HEAD unchanged');
  await git('restore', '--source=HEAD', '--staged', '--worktree', '--', '.');
  await git('clean', '-fd');
  const restored = await diskSnapshot();
  check(restored.editSha256 === baseline.editSha256 && restored.card.sha256 === baseline.card.sha256
    && restored.plain.sha256 === baseline.plain.sha256 && restored.captions.sha256 === baseline.captions.sha256 && restored.gitDiff === '', 'pristine case baseline', restored);
  const rebuild = await reopen('case starts from the initial commit', closed);
  // Reopening can restore selection before focus reaches the inner document.
  // Re-resolve the live widget and hit point on each attempt; do not send keys
  // until both selection and focus have settled after a real pointer click.
  let focusPoint, focus, focused = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const observation = { attempt, instance: rebuild.instance, startedAt: new Date().toISOString() };
    focusAttempts.push(observation);
    try {
      observation.activation = await activatePreviewWidget();
      focusPoint = observation.point = await pointFor('plain', null);
      await realClick(preview, focusPoint.x, focusPoint.y);
      await sleep(400);
      observation.preview = await state();
      focus = observation.focus = await previewFocus(`resetCase: real preview click attempt ${attempt}`);
      focused = observation.ok = observation.preview.selectedId === 'plain'
        && observation.preview.activeEdit === false && focus.hasFocus;
    } catch (error) {
      observation.ok = false;
      observation.error = error.stack ?? String(error);
      // Errors can happen before the post-click delay (e.g. a replaced target).
      await sleep(400);
    }
    if (focused) break;
  }
  check(focused, 'preview plain selection and keyboard focus after at most five clicks', focusAttempts);
  focus = await requirePreviewFocus('resetCase: focus acquired');
  await key('Escape');
  await expectState({ selectedId: null, activeEdit: false });
  await evaluate(main, `window.getSelection()?.removeAllRanges()`);
  return { reset: 'git restore --source=HEAD --staged --worktree -- . && git clean -fd',
    rebuild, restored, focusPoint, focus };
}

async function pointFor(id, part) {
  return waitFor(`hittable preview text ${id}`, () => pe(`(() => {
    const mount=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')]
      .find(e=>e.dataset.overlayId===${S(id)});
    const e=mount?.querySelector(${S(part ? `[data-akari-part="${part}"]` : '.plain')});
    if(!e)return null;
    const style=getComputedStyle(e),r=e.getBoundingClientRect();
    if(style.visibility!=='visible'||style.display==='none'||r.width<2||r.height<2)return null;
    for(const fx of [.25,.5,.75])for(const fy of [.5,.25,.75]) {
      const x=r.left+r.width*fx,y=r.top+r.height*fy;
      if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
      const hit=document.elementFromPoint(x,y);
      if(hit && (hit===e||e.contains(hit)) && hit.closest('[data-overlay-id]')===mount)
        return {x,y,id:${S(id)},text:e.textContent,tag:e.tagName,
          rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom}};
    }
    return null;
  })()`));
}

const titles = [
  'Overlay text Escape restores text, leaves selection and writes no bytes',
  'Overlay text Enter persists HTML and part text',
  'Caption text Escape cancels and Enter persists',
  'Overlay drag: snap / Alt bypass / Shift snap / release Alt',
  'Layer drag: snap / Alt bypass / Shift snap / release Alt',
  'Layer rotation: Shift rounds live and saved angle to 15 degrees',
  'Caption Alt at pointerdown retains all-caption positioning',
  'Alt drag over a direct manipulation surface retains zoomed pan'
];
async function previewFocus(label) {
  const observed = await pe(`(() => {
    const e=document.activeElement;
    return {hasFocus:document.hasFocus(),instance:window.__akariPartTextEvidence?.instance??null,
      activeElement:e?{tag:e.tagName,id:e.id,editable:e.isContentEditable===true,
        overlayId:e.closest('[data-overlay-id]')?.dataset.overlayId??null,
        overlayEditing:e.hasAttribute('data-akari-interaction-editing'),
        captionEditing:e.hasAttribute('data-akari-caption-editing'),text:e.isContentEditable?e.textContent:null}:null,
      selection:window.getSelection()?.toString()??''};
  })()`);
  events.push({ kind: 'preview-focus', at: Date.now(), data: { label, expectedEditor, ...observed } });
  return observed;
}
async function requirePreviewFocus(label, editing = false) {
  const observed = await previewFocus(label);
  check(observed.hasFocus && observed.activeElement, 'preview document must have focus before keyboard input', { label, ...observed });
  if (editing) {
    const e = observed.activeElement;
    check(expectedEditor && e.editable && (expectedEditor.kind === 'caption'
      ? e.captionEditing : e.overlayEditing && e.overlayId === expectedEditor.id),
    'keyboard input must target the intended active editor', { label, expectedEditor, ...observed });
  }
  return observed;
}
async function previewKey(options, { editing = false } = {}) {
  await requirePreviewFocus(`before ${options.key} keyDown`, editing);
  await preview.send('Input.dispatchKeyEvent', { type: 'keyDown', ...options });
  await sleep(20);
  await requirePreviewFocus(`before ${options.key} keyUp`);
  await preview.send('Input.dispatchKeyEvent', { type: 'keyUp', ...options });
}
async function key(value) {
  await previewKey({ key: value, code: value, windowsVirtualKeyCode: value === 'Escape' ? 27 : 13 },
    { editing: expectedEditor !== null });
  expectedEditor = null;
  await sleep(500);
}
const writesSince = index => events.slice(index).filter(e => e.kind === 'write').map(e => e.data);
async function replaceFocused(text) {
  const modifiers = process.platform === 'darwin' ? 4 : 2;
  await previewKey({ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers, commands: ['selectAll'] }, { editing: true });
  const selected = await requirePreviewFocus('before Input.insertText', true);
  check(selected.selection === selected.activeElement.text, 'selectAll selected exactly the active editor text', selected);
  await preview.send('Input.insertText', { text });
  await waitFor('typed content in focused editor', () => pe(`document.hasFocus() && document.activeElement?.isContentEditable && document.activeElement.textContent===${S(text)}`));
}
async function beginOverlay(id, part) {
  const point = await pointFor(id, part);
  await realClick(preview, point.x, point.y, { modifiers: process.platform === 'darwin' ? 4 : 2 });
  await expectState({ selectedId: id, activeEdit: false });
  await sleep(400);
  await realClick(preview, point.x, point.y, { clickCount: 2 });
  await expectState({ selectedId: id, activeEdit: true });
  expectedEditor = { kind: 'overlay', id };
  const focus = await requirePreviewFocus('beginOverlay: real double-click', true);
  return focus.activeElement.text;
}
async function rect(selector) {
  return waitFor(`visible ${selector}`, () => pe(`(() => {
    const e=document.querySelector(${S(selector)}); if(!e)return null;
    const r=e.getBoundingClientRect();
    if(getComputedStyle(e).display==='none'||r.width<1||r.height<1)return null;
    return {x:r.x,y:r.y,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
  })()`));
}
const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
async function captionPoint() {
  const selector = await pe(`document.querySelector('#caption-plate .akari-caption__plate') ? '#caption-plate .akari-caption__plate' : '#caption-plate'`);
  return center(await rect(selector));
}
async function beginCaption() {
  const p = await captionPoint();
  await realClick(preview, p.x, p.y);
  await requirePreviewFocus('beginCaption: real preview click');
  await sleep(400);
  await realClick(preview, p.x, p.y, { clickCount: 2 });
  await waitFor('caption editor focus', () => pe(`document.hasFocus() && document.activeElement?.matches('[data-akari-caption-editing]')`));
  expectedEditor = { kind: 'caption', id: 'c-0001' };
  const focus = await requirePreviewFocus('beginCaption: real double-click', true);
  return focus.activeElement.text;
}
async function captionSelection() {
  return pe(`(() => {
    const box=document.getElementById('caption-select-box'), plate=document.getElementById('caption-plate');
    const r=box.getBoundingClientRect();
    return {editing:Boolean(document.querySelector('[data-akari-caption-editing]')),
      localSelected:box.classList.contains('is-active') && r.width>0 && r.height>0,
      timelineSelected:plate.hasAttribute('data-selected'),
      receivedCaptionIds:window.__akariPartTextEvidence?.selectedCaptionIds??null};
  })()`);
}
async function assertUnchanged(before, after) {
  for (const field of ['card', 'plain', 'captions']) check(before[field].sha256 === after[field].sha256, `${field} bytes unchanged`);
  check(before.editSha256 === after.editSha256, 'edit.json bytes unchanged');
}
async function mouse(type, point, modifiers = 0) {
  await preview.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y,
    button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers });
}
async function moveTo(start, end, modifiers = 0) {
  for (let i = 1; i <= 8; i++) {
    await mouse('mouseMoved', { x: start.x + (end.x - start.x) * i / 8, y: start.y + (end.y - start.y) * i / 8 }, modifiers);
    await sleep(25);
  }
}
async function settleWrite(index, method) {
  await waitFor(`${method} successful response`, () => {
    const slice = events.slice(index);
    return slice.some(e => e.kind === 'write' && e.data.method === method)
      && slice.some(e => e.kind === 'response' && e.data.ok === true);
  });
  await sleep(400);
  const writes = writesSince(index);
  check(writes.length === 1 && writes[0].method === method, 'one intended write', writes);
  check(!events.slice(index).some(e => e.kind === 'response' && e.data.ok === false), 'no rejected write');
  return writes;
}
async function selectLayer() {
  // Native image is centered at output (480,180), with 160x100 intrinsic size.
  const p = await pe(`(() => { const r=document.getElementById('preview-stage').getBoundingClientRect();
    return {x:r.left+r.width*0.75,y:r.top+r.height*0.5}; })()`);
  await realClick(preview, p.x, p.y);
  await waitFor('layer selected', () => pe(`document.getElementById('layer-select-box').classList.contains('is-active')`));
  return rect('#layer-select-box');
}
async function snapDrag(kind, observations) {
  const before = await diskSnapshot();
  if (kind === 'overlay') {
    const p = await pointFor('plain', null); await realClick(preview, p.x, p.y);
    await expectState({ selectedId: 'plain', activeEdit: false });
  } else await selectLayer();
  const selector = kind === 'overlay' ? '[data-overlay-id="plain"] .plain' : '#layer-select-box';
  const bounds = await rect(selector), start = center(bounds);
  const frame = await pe(`(() => {const r=document.getElementById('preview-stage').getBoundingClientRect();return {left:r.left,width:r.width};})()`);
  const scale = frame.width / 640;
  const end = { x: start.x + frame.left + 3 * scale - bounds.left, y: start.y };
  const rawLeftOutput = (bounds.left + end.x - start.x - frame.left) / scale;
  const index = events.length;
  const samples = observations.samples = [];
  observations.dragGeometry = { start, end, bounds, frame, scale, rawLeftOutput };
  await mouse('mousePressed', start); // No Alt at pointerdown: do not initiate pan.
  try {
    await moveTo(start, end);
    for (const modifiers of [0, 1, 8, 1, 0]) {
      await mouse('mouseMoved', end, modifiers);
      await sleep(100);
      const observed = await rect(selector);
      const sample = { modifiers, leftOutput: (observed.left - frame.left) / scale, bounds: observed };
      if (kind === 'overlay') {
        // Runtime creates these two guides under #overlay-stage and toggles
        // their hidden attributes in showSnapGuides/hideSnapGuides.
        Object.assign(sample, await pe(`(() => {
          const runtime=window.akari.interaction;
          const guides=[...document.querySelectorAll('#overlay-stage > [data-akari-interaction="snap-guide-vertical"], #overlay-stage > [data-akari-interaction="snap-guide-horizontal"]')].map(e=>{
            const r=e.getBoundingClientRect(),style=getComputedStyle(e);
            return {axis:e.getAttribute('data-akari-interaction'),hidden:e.hidden,
              display:style.display,visibility:style.visibility,
              visible:!e.hidden && style.display!=='none' && style.visibility!=='hidden'
                && Number(style.opacity)>0 && r.width>0 && r.height>0};
          });
          const container=document.querySelector('[data-overlay-id="plain"]');
          const fragment=container && runtime.fragmentBounds(container);
          const selection=document.querySelector('[data-akari-interaction="selection-frame"]');
          const selectionRect=selection && !selection.hidden ? selection.getBoundingClientRect() : null;
          const outputLeft=r=>r ? runtime.stageLocalPoint(r.left,r.top)?.x??null : null;
          const fragmentLeftOutput=outputLeft(fragment),selectionFrameLeftOutput=outputLeft(selectionRect);
          return {guides,guidesVisible:guides.some(g=>g.visible),fragmentLeftOutput,selectionFrameLeftOutput,
            fragmentAtFrameEdge:fragmentLeftOutput!==null && Math.abs(fragmentLeftOutput)<=1,
            selectionFrameAtEdge:selectionFrameLeftOutput!==null && Math.abs(selectionFrameLeftOutput)<=1};
        })()`));
      }
      samples.push(sample);
    }
    if (kind === 'overlay') {
      for (const i of [1, 3]) {
        check(Math.abs(samples[i].leftOutput - rawLeftOutput) <= 0.5,
          'Alt matches the raw pointer target within 0.5 output px', samples);
        check(samples[i].guides.length === 2 && !samples[i].guidesVisible,
          'Alt hides both snap guides', samples);
      }
      for (const i of [0, 2, 4]) {
        check(Math.abs(samples[i].leftOutput - samples[0].leftOutput) <= 0.2,
          'unmodified and Shift moves share the snapped position', samples);
        check(Math.abs(samples[i].leftOutput - rawLeftOutput) >= 1,
          'snapped text position differs from the raw target by at least 1 output px', samples);
        check(samples[i].guides.length === 2 && samples[i].guidesVisible,
          'unmodified and Shift moves display snap guides', samples);
      }
    } else {
      // Keep the passing native-layer acceptance criteria unchanged.
      check(Math.abs(samples[0].leftOutput) < 2, 'snaps to frame edge', samples);
      check(Math.abs(samples[1].leftOutput - samples[0].leftOutput) > 1, 'Alt bypasses snapping', samples);
      for (const i of [2, 4]) check(Math.abs(samples[i].leftOutput - samples[0].leftOutput) < 0.2,
        'Shift does not bypass; releasing Alt restores snap', samples);
      check(Math.abs(samples[3].leftOutput - samples[1].leftOutput) < 0.2, 'Alt can be pressed again during the same drag', samples);
    }
  } finally {
    await key('Escape'); await mouse('mouseReleased', end);
  }
  await sleep(300);
  check(writesSince(index).length === 0, 'cancelled drag did not write');
  const after = await diskSnapshot(); await assertUnchanged(before, after);
  return { samples, before, after };
}
const actions = [
  async out => {
    out.cases = [];
    for (const [id, part] of [['plain', null], ['s01.C', 'C']]) {
      await resetCase(out);
      const before = await diskSnapshot(), original = await beginOverlay(id, part), index = events.length;
      await replaceFocused('Cancelled overlay'); await key('Escape');
      await expectState({ selectedId: id, activeEdit: false }); await sleep(400);
      const displayed = (await pointFor(id, part)).text, after = await diskSnapshot();
      check(displayed === original, 'original overlay text restored', { original, displayed });
      check(writesSince(index).length === 0, 'Escape sends no overlay write');
      await assertUnchanged(before, after);
      check(await pe(`Boolean(document.querySelector('.akari-interaction-selection-frame'))`), 'selection frame remains');
      out.cases.push({ id, original, displayed, before, after, writes: writesSince(index), state: await state() });
    }
  },
  async out => {
    out.cases = [];
    for (const [id, part] of [['plain', null], ['s01.C', 'C']]) {
      await resetCase(out);
      const before = await diskSnapshot(), index = events.length, text = `Saved ${id}`;
      await beginOverlay(id, part); await replaceFocused(text); await key('Enter');
      const writes = await settleWrite(index, 'overlayWrite'), after = await diskSnapshot(text);
      if (part) {
        check(locate(after.edit, id).source.text === text, 'source.text saved');
        check(after.card.sha256 === before.card.sha256, 'part shared HTML unchanged');
      } else {
        check(after.plain.containsNewText && after.plain.sha256 !== before.plain.sha256, 'fragment saved');
        check(after.editSha256 === before.editSha256, 'plain Enter leaves edit.json unchanged');
      }
      await reopen('verify Enter on disk after rebuild', await closePreview());
      check((await pointFor(id, part)).text === text, 'persisted overlay displayed');
      out.cases.push({ id, before, after, writes });
    }
  },
  async out => {
    const before = await diskSnapshot(), original = await beginCaption(), index = events.length;
    await replaceFocused('Cancelled caption');
    out.selectionBeforeEscape = await captionSelection();
    check(out.selectionBeforeEscape.localSelected, 'caption selected before Escape', out.selectionBeforeEscape);
    await key('Escape'); await sleep(400);
    out.selectionAfterEscape = await captionSelection();
    check(!out.selectionAfterEscape.editing && out.selectionAfterEscape.localSelected,
      'caption editor closed; local caption selection frame remains', out.selectionAfterEscape);
    check(await pe(`document.getElementById('caption-plate').textContent.includes(${S(original)})`), 'caption text restored');
    out.cancel = { before, after: await diskSnapshot(), writes: writesSince(index) };
    await assertUnchanged(before, out.cancel.after); check(out.cancel.writes.length === 0, 'caption Escape writes zero');
    await beginCaption(); await replaceFocused('Saved caption'); const enterIndex = events.length; await key('Enter');
    out.enterWrites = await settleWrite(enterIndex, 'captionWrite');
    out.selectionAfterEnter = await captionSelection();
    check(!out.selectionAfterEnter.editing && out.selectionAfterEnter.localSelected,
      'caption Enter also retains local selection', out.selectionAfterEnter);
    out.saved = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8'));
    check(out.saved.captions.find(c => c.id === 'c-0001').text === 'Saved caption', 'caption Enter saved');
    check(out.saved.captions.find(c => c.id === 'c-0002').text === 'Second caption', 'other caption text unchanged');
    await reopen('caption Enter persisted', await closePreview());
    check(await pe(`document.getElementById('caption-plate').textContent.includes('Saved caption')`), 'saved caption displayed after rebuild');
  },
  async out => { Object.assign(out, await snapDrag('overlay', out)); },
  async out => { Object.assign(out, await snapDrag('layer', out)); },
  async out => {
    const box = await selectLayer(), pivot = center(box);
    const start = center(await rect('#layer-select-box [data-akari-handle="rotate"]'));
    const angle = Math.atan2(start.y - pivot.y, start.x - pivot.x) + 23 * Math.PI / 180;
    const radius = Math.hypot(start.x - pivot.x, start.y - pivot.y);
    const end = { x: pivot.x + radius * Math.cos(angle), y: pivot.y + radius * Math.sin(angle) };
    const index = events.length;
    await mouse('mousePressed', start); await moveTo(start, end);
    out.live = [];
    for (const modifiers of [8, 0, 8]) {
      await mouse('mouseMoved', end, modifiers); await sleep(100);
      const rotate = await pe(`Number(document.querySelector('[data-akari-layer-id="layer"]').dataset.akariTransformRotate)`);
      out.live.push({ modifiers, rotate });
      if (modifiers === 8) check(Math.abs(rotate % 15) < 0.001 && Math.abs(rotate) > 1, 'Shift live angle is a nonzero multiple of 15', rotate);
      else check(Math.abs(rotate - 23) < 1, 'releasing Shift restores raw angle', rotate);
    }
    await mouse('mouseReleased', end, 8); out.writes = await settleWrite(index, 'layerWrite');
    out.saved = locate(await readEdit(), 'layer').transform;
    check(Math.abs(out.saved.rotate % 15) < 0.001 && Math.abs(out.saved.rotate) > 1, 'saved rotate multiple of 15', out.saved);
  },
  async out => {
    out.before = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8'));
    const start = await captionPoint(), end = { x: start.x + 30, y: start.y - 25 }, index = events.length;
    await mouse('mousePressed', start, 1); await moveTo(start, end, 1);
    out.groupMode = await pe(`document.querySelector('.akari-caption-group-badge').textContent==='全字幕が動く'`);
    check(out.groupMode, 'Alt pointerdown enters all-caption mode');
    await mouse('mouseReleased', end, 1); out.writes = await settleWrite(index, 'captionWrite');
    check(Boolean(out.writes[0].args[1].groupPosition), 'existing groupPosition route retained', out.writes);
    out.after = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8'));
    check(!equal(out.before.default_text_style, out.after.default_text_style), 'group defaults changed');
    check(equal(out.before.captions, out.after.captions), 'individual cue overrides/text remain unchanged');
    await reopen('all-caption position after rebuild', await closePreview());
    out.first = await captionPoint();
    await pe(`(() => {const e=document.getElementById('seek');e.value='2.5';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await waitFor('second caption', () => pe(`document.getElementById('caption-plate').textContent.includes('Second caption')`));
    out.second = await captionPoint();
    check(Math.abs(out.first.y - out.second.y) < 2, 'both cues share moved vertical position', out);
  },
  async out => {
    // Setup through the ordinary zoom slider. The tested gesture uses real CDP input.
    await selectLayer();
    await pe(`(() => {const e=document.getElementById('zoom-slider');e.value=String(Math.log2(6)/5);e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(300);
    const start = center(await rect('#layer-select-box')), end = { x: start.x + 30, y: start.y + 20 };
    check(await pe(`Boolean(document.elementFromPoint(${start.x},${start.y})?.closest('#layer-select-box'))`), 'pan begins over the selected layer manipulation surface');
    out.diskBefore = await diskSnapshot();
    out.before = await pe(`document.getElementById('zoom-layer').style.transform`);
    const index = events.length;
    await mouse('mousePressed', start, 1); await moveTo(start, end, 1);
    out.dragging = await pe(`document.querySelector('.preview-pane').classList.contains('is-dragging')`);
    out.after = await pe(`document.getElementById('zoom-layer').style.transform`);
    await mouse('mouseReleased', end, 1); await sleep(300);
    check(out.dragging && out.before !== out.after, 'Alt over selected layer pans zoom layer', out);
    check(writesSince(index).length === 0, 'pan sends no object write');
    out.diskAfter = await diskSnapshot(); await assertUnchanged(out.diskBefore, out.diskAfter);
  }
];

try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes('--startup-failed')) throw new Error('Electron/setup readiness failed; see launcher stderr');
  baseline = { commit: (await git('rev-parse', 'HEAD')).trim(), ...await diskSnapshot() };
  const target = await waitFor('Theia page', async () => {
    const list = await targets();
    // Match P1/P0: packaged Electron may load Theia from file://.
    return list.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? list.find(t => t.type === 'page');
  }, READY_MS);
  main = await connect(target); await main.send('Runtime.enable'); await main.send('Page.enable');
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
  await waitFor('Theia ready', () => evaluate(main, `Boolean(window.theia?.container && document.readyState==='complete')`), READY_MS);
  await evaluate(main, `(() => {const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ');b?.click();})()`);
  await waitFor('timeline open', () => command('akari.annotations.open'), READY_MS);
  for (const [index, action] of actions.entries()) {
    const record = { step: index + 1, title: titles[index], status: 'ng', observations: {} };
    records.push(record);
    const stepEventIndex = events.length;
    try {
      record.observations.preparation = await resetCase(record.observations);
      await action(record.observations); await shot(`step-${index + 1}`); record.status = 'ok';
    } catch (error) {
      record.error = error.stack ?? String(error);
      try { await previewFocus(`step ${index + 1} failure`); } catch {}
      try { await shot(`failure-${index + 1}`); } catch {}
    } finally {
      record.observations.events = events.slice(stepEventIndex);
    }
    console.log(`[step ${index + 1}] ${record.status}`);
  }
} catch (error) { fatalError = error.stack ?? String(error); }
finally {
  // Always enumerate all eight steps, including startup failure/unreached steps.
  for (let index = records.length; index < titles.length; index++) records.push({ step: index + 1,
    title: titles[index], status: 'not-run', error: fatalError ?? 'unreached' });
  const status = !fatalError && records.every(r => r.status === 'ok') ? 'PASS' : 'FAIL';
  await mkdir(evidence, { recursive: true });
  await writeFile(logPath, JSON.stringify({ status, startedAt, finishedAt: new Date().toISOString(),
    sampleSeconds: SAMPLE, baseline, records, events, error: fatalError,
    input: 'CDP Input.dispatchMouseEvent modifiers: Alt=1, Shift=8; real dispatchKeyEvent/insertText' }, null, 2) + '\n');
  for (const cdp of connections) { try { cdp.close(); } catch {} }
  console.log(`${status}: ${logPath}`); process.exitCode = status === 'PASS' ? 0 : 1;
}
