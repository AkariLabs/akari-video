#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, realClick, screenshot } from '../../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';
import { summarizeCommandResult, matchesSeekObservation } from './runner-support.mjs';

const [, , portArg, workspaceArg, evidenceArg, mode] = process.argv;
if (!workspaceArg || !evidenceArg || !['before', 'after'].includes(mode)) {
  throw new Error('usage: run-l1.mjs <port> <workspace> <evidence> <before|after>');
}
const port = Number(portArg || 9767);
const project = path.resolve(workspaceArg, 'project');
const editUri = pathToFileURL(path.join(project, 'edit.json')).href;
const evidence = path.resolve(evidenceArg);
const logPath = path.join(evidence, mode === 'before' ? 'run-log-before.json' : 'run-log.json');
const S = JSON.stringify;
const connections = new Set(), records = [], seeks = [], commands = [];
const startedAt = new Date().toISOString();
let main, preview, contextId, fatalError;
let previewContextValid = false, attachmentPromise, attachmentNumber = 0;
const titles = [
  '(1) Prepare selected caption and block watcher reloads',
  '(2) Scale c-0001 to 1.25',
  '(3) Rotate c-0001 twice without reload; cumulative 30 degrees',
  '(4) Drag c-0001 immediately after rotation; retain scale and rotate',
  '(5) Scale then drag c-0002 without reload',
  '(6) Drag then rotate c-0003 without reload',
  '(7) Record blocked reloads and release the observation gate'
];
function check(ok, message, value) {
  if (!ok) throw new Error(`${message}${value === undefined ? '' : ': ' + S(value)}`);
}
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
  })]); } finally { clearTimeout(timer); }
}
async function waitFor(label, predicate, ms = 30_000) {
  const until = Date.now() + ms;
  let error;
  do {
    try { const value = await predicate(); if (value) return value; } catch (e) { error = e.message; }
    await sleep(100);
  } while (Date.now() < until);
  throw new Error(`timeout: ${label}${error ? ': ' + error : ''}`);
}
async function connect(target) {
  const cdp = new CDP(target.webSocketDebuggerUrl);
  connections.add(cdp);
  await bounded(cdp.connect(), 20_000, 'CDP connect');
  const send = cdp.send.bind(cdp);
  cdp.ws.addEventListener('close', () => {
    if (cdp === preview) previewContextValid = false;
    for (const pending of cdp.pending.values()) pending.reject(new Error('CDP connection closed'));
    cdp.pending.clear();
  });
  // The host ready-seek handshake itself can wait 30 seconds for the renderer.
  cdp.send = (method, params) => {
    if (cdp.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP connection closed'));
    const requestId = cdp.nextId;
    return bounded(send(method, params), method === 'Runtime.evaluate' ? 60_000 : 20_000, method)
      .finally(() => cdp.pending.delete(requestId));
  };
  return cdp;
}
async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  check(response.ok, 'target list', response.status);
  return response.json();
}
// All callers outside attachment perform read-only observations. Reconnect only
// those reads; never replay a mouse/key gesture after the document is replaced.
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
  const record = { id, startedAt: new Date().toISOString() };
  commands.push(record);
  try {
    const summary = await evalOn(main, `(async () => {
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
      && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
    if(!key)throw new Error('Command registry unavailable');
    const result=await c.get(key).executeCommand(${S(id)}${argument === undefined ? '' : ', ' + S(argument)});
    return (${summarizeCommandResult.toString()})(result);
  })()`);
    record.summary = summary;
    return summary;
  } catch (error) {
    record.error = error.message;
    throw error;
  } finally { record.finishedAt = new Date().toISOString(); }
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
  try { await waitFor('preview inner context', async () => {
    const available = (await targets()).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    for (const [id, candidate] of candidates) {
      if (!available.some(t => t.id === id) || candidate.cdp.ws.readyState !== WebSocket.OPEN) {
        candidate.cdp.close(); connections.delete(candidate.cdp); candidates.delete(id);
      }
    }
    for (const target of available) {
      if (!candidates.has(target.id)) {
        const cdp = await connect(target), contexts = new Map();
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
          if (await evalOn(cdp, `Boolean(document.getElementById('caption-plate')
            && window.akari?.engine?.captionWrite && typeof window.akari?.playbackTick==='function'
            && window.akari?.state?.editPath===${S(editUri)})`, context.id)) {
            preview = cdp; contextId = context.id; previewContextValid = true; return true;
          }
        } catch { /* isolated or disposed context */ }
      }
    }
    return false;
  }, 60_000); }
  finally {
    for (const { cdp } of candidates.values()) if (cdp !== preview) { cdp.close(); connections.delete(cdp); }
  }
  if (previous && previous !== preview) { previous.close(); connections.delete(previous); }
  // Observe the existing host route; never assign the preview selection directly.
  await evalOn(preview, `(() => {
    if(window.__captionHandlesL1)return true;
    // Observe the exact outputTime passed by tick(), preserving arguments,
    // return value and the normal host notification. Never move the clock here.
    const original=window.akari.playbackTick;
    if(typeof original!=='function')throw new Error('playbackTick unavailable');
    const observed=window.__captionHandlesL1={instance:${S(`${startedAt}-${++attachmentNumber}`)},messages:[],sequence:0,playback:null};
    window.akari.playbackTick=function(...args) {
      const result=Reflect.apply(original,this,args);
      observed.playback={time:args[0],playing:args[1],sequence:++observed.sequence};
      return result;
    };
    window.addEventListener('message',event=>{
      const m=event.data;
      if(['akari-preview-set-selected-captions','akari-preview-select-primary','akari-preview-caption-write-response'].includes(m?.type))
        observed.messages.push({type:m.type,
          captionIds:Array.isArray(m.captionIds)?m.captionIds.filter(id=>typeof id==='string'):null,
          selection:m.selection?{kind:String(m.selection.kind),id:String(m.selection.id)}:null,
          requestId:typeof m.requestId==='string'?m.requestId:null,ok:m.ok===true,
          error:typeof m.error==='string'?m.error:null});
    }); return true;
  })()`, contextId);
}
const shot = name => screenshot(main, path.join(evidence, `${mode}-${name}.png`));
const readJson = async name => JSON.parse(await readFile(path.join(project, name), 'utf8'));
const disk = async () => ({ edit: await readJson('edit.json'), captions: await readJson('captions.json') });
const cue = (snapshot, id = 'c-0001') => snapshot.captions.captions.find(c => c.id === id);
async function clockState() {
  return pe(`(() => {
    const clock=window.akari?.frameEngineClock,e=document.getElementById('seek');
    return {engine:clock?'frame-engine':'legacy',fps:Number(window.akari?.state?.summary?.output?.fps),
      ready:clock?document.getElementById('frame-engine-preview')?.dataset.frameEngineReady==='true':Boolean(e&&!e.disabled),
      duration:clock?clock.totalDuration:Number(e?.max),
      slider:{value:e?.value,max:e?.max,step:e?.step,disabled:e?.disabled},
      instance:window.__captionHandlesL1?.instance??null,
      playback:window.__captionHandlesL1?.playback??null};
  })()`);
}
async function seek(time) {
  check(Number.isFinite(time) && time >= 0, 'finite nonnegative seek time', time);
  const record = { requestedTime: time, attempts: [], status: 'ng' };
  seeks.push(record);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const observation = { attempt };
    record.attempts.push(observation);
    try {
      observation.before = await waitFor('seek clock and duration ready', async () => {
        const state = observation.last = await clockState();
        // Never accept a startup/endpoint clamp as the requested position.
        return state.ready && Number.isFinite(state.fps) && state.fps > 0
          && state.duration > time + 2 / state.fps && Number(state.slider.max) > time && state;
      });
      const { fps, engine } = observation.before;
      observation.expectedFrame = engine === 'frame-engine' ? Math.round(time * fps) : null;
      observation.expectedTime = engine === 'frame-engine' ? observation.expectedFrame / fps : time;
      // This existing host route waits for mount/model readiness, cancels initial
      // playback restoration, pauses playback and calls seekTimelineTime + tick.
      observation.command = await command('akari.preview.seekOutput', { editUri, time, waitForReady: true });
      check(observation.command.result === 'seeked', 'host accepted ready seek', observation.command);
      let stable = 0;
      observation.after = await waitFor('actual paused output clock at requested frame', async () => {
        const state = observation.last = await clockState();
        const matches = matchesSeekObservation(state, observation.before, observation.expectedTime);
        stable = matches ? stable + 1 : 0;
        return stable >= 2 && state;
      }, 5000);
      record.status = 'ok';
      return observation.after;
    } catch (error) {
      observation.error = error.stack ?? String(error);
      // A ready seek can replace the iframe during a pending model refresh.
      // Reattach to the live context and retry the same target, never a fallback time.
      if (attempt < 3) await attachPreview();
    }
  }
  throw new Error(`seek failed at ${time}s: ${S(record)}`);
}
async function rows() {
  return pe(`(() => ({
    time:window.__captionHandlesL1?.playback?.time??null,
    sliderTime:Number(document.getElementById('seek').value),
    blue:document.getElementById('caption-select-box').classList.contains('is-active'),
    editing:Boolean(document.querySelector('[data-akari-caption-editing]')),
    rows:[...document.querySelectorAll('.caption-row-plate')].map(p=>{
      const ink=p.querySelector('.akari-caption__plate')||p;
      const r=ink.getBoundingClientRect(),s=getComputedStyle(ink);
      return {key:p.dataset.captionKey,text:ink.textContent,selected:p.hasAttribute('data-selected'),
        handles:[...p.querySelectorAll('.akari-caption-handle')].map(h=>h.getAttribute('data-h')).sort(),
        outline:{color:s.outlineColor,style:s.outlineStyle,width:s.outlineWidth},
        scale:p.style.getPropertyValue('--caption-scale'),rotate:p.style.getPropertyValue('--caption-rotate'),
        visible:r.width>0&&r.height>0&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0};
    })
  }))()`);
}
function rowFor(snapshot, id) {
  return snapshot.rows.find(r => r.key === id || r.key.startsWith(id + ':') || r.text.includes(
    id === 'c-0001' ? 'First caption' : id === 'c-0002' ? 'Overlapping caption' : 'Later caption'));
}
// Resolve cue identity from the actual rendered text, not generated normalized keys.
async function selectorFor(id) {
  const row = await waitFor(`caption row ${id} exists`, async () => rowFor(await rows(), id));
  return `.caption-row-plate[data-caption-key=${S(row.key)}]`;
}
async function rect(selector) {
  return waitFor(`visible ${selector}`, () => pe(`(() => {
    const e=document.querySelector(${S(selector)});if(!e)return null;
    const r=e.getBoundingClientRect();if(r.width<1||r.height<1||getComputedStyle(e).display==='none')return null;
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  })()`));
}
const center = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
async function pointFor(id) {
  const selector = await selectorFor(id);
  return waitFor(`hittable caption ${id}`, () => pe(`(() => {
    const host=document.querySelector(${S(selector)}),ink=host?.querySelector('.akari-caption__plate')||host;
    if(!ink)return null;const r=ink.getBoundingClientRect();
    for(const fx of [.5,.25,.75])for(const fy of [.5,.25,.75]) {
      const x=r.x+r.width*fx,y=r.y+r.height*fy,hit=document.elementFromPoint(x,y);
      if(x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&hit&&host.contains(hit)
        && !hit.closest('.akari-caption-handle'))return {x,y};
    }return null;
  })()`));
}
async function clickCue(id = 'c-0001', clickCount = 1) {
  const p = await pointFor(id);
  const input = preview, inputContext = contextId;
  await realClick(input, p.x, p.y, { clickCount });
  check(previewContextValid && input === preview && inputContext === contextId, 'click context remained live');
  return waitFor(`caption ${id} click applied`, async () => {
    const state = await rows(); return state.blue && rowFor(state, id) && state;
  });
}
function assertSelected(snapshot, ids) {
  check(snapshot.rows.filter(r => r.selected).length === ids.length, 'selected row count', snapshot);
  for (const id of ids) {
    const r = rowFor(snapshot, id);
    check(r?.selected && S(r.handles) === S(['ne', 'nw', 'rot', 'se', 'sw']), `${id} selected with five handles`, r);
    check(r.outline.color === 'rgb(245, 196, 81)' && r.outline.style === 'solid' && parseFloat(r.outline.width) > 0,
      `${id} computed yellow outline`, r.outline);
  }
}
async function selected(ids) {
  return waitFor(`selected ${ids.join(',')}`, async () => {
    const value = await rows(); assertSelected(value, ids); return value;
  });
}
async function drag(start, end, modifiers = 0, live) {
  const input = preview, inputContext = contextId;
  check(previewContextValid, 'drag starts in a live preview context');
  await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start, button: 'none', modifiers });
  await input.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1, modifiers });
  try {
    for (let i = 1; i <= 12; i++) {
      await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved',
        x: start.x + (end.x - start.x) * i / 12, y: start.y + (end.y - start.y) * i / 12,
        button: 'left', buttons: 1, modifiers });
      await sleep(25);
    }
    if (live) await live();
    check(previewContextValid && input === preview && inputContext === contextId, 'drag context remained live');
  } finally {
    await input.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1, modifiers });
  }
}
async function saved(predicate, id = 'c-0001') {
  return waitFor(`caption ${id} persistence on disk`, async () => { const value = await disk(); return predicate(cue(value, id)) && value; });
}
async function hostEvent(type, detail) {
  const before = await pe('({instance:window.__captionHandlesL1.instance,count:window.__captionHandlesL1.messages.length})');
  await evalOn(main, `window.dispatchEvent(new CustomEvent(${S(type)},{detail:${S({ editUri, ...detail })}}))`);
  await waitFor(`preview received ${type}`, async () => {
    const observed = await pe('({instance:window.__captionHandlesL1.instance,messages:window.__captionHandlesL1.messages})');
    check(observed.instance === before.instance, 'host selection context remained live');
    return observed.messages.slice(before.count).some(message => type === 'akari.daihon.selectionChanged'
      ? message.type === 'akari-preview-set-selected-captions' && S(message.captionIds) === S(detail.captionIds)
      : message.type === 'akari-preview-select-primary' && S(message.selection) === S(detail.selection));
  });
}
async function clearSelection() {
  await hostEvent('akari.timeline.primarySelected', { selection: null });
  await hostEvent('akari.daihon.selectionChanged', { captionIds: [] });
  await waitFor('no caption selection', async () => { const s = await rows(); return !s.blue && s.rows.every(r => !r.selected && !r.handles.length); });
}
async function holdCaptionReloads() {
  return pe(`(() => {
    if (window.__captionDragRotateGate) throw new Error('reload gate already installed');
    const gate = { blocked: 0, messages: [], writes: [] };
    gate.handler = event => {
      if (event.data?.type !== 'akari-preview-captions-update') return;
      gate.blocked++;
      const styles = values => (values || []).map(c => ({id:c.id,
        sourceCueId:c.sourceCueId ?? null,
        scale:c.textStyle?.scale ?? 1,rotate:c.textStyle?.rotate ?? 0}));
      gate.messages.push({ at: performance.now(), count: event.data.captions?.length ?? null,
        modelBeforeBlock:styles(window.akari.previewCaptions),
        blockedPayload:styles(event.data.captions) });
      event.stopImmediatePropagation();
    };
    gate.originalWrite = window.akari.engine.captionWrite;
    window.akari.engine.captionWrite = function(captionId, patch) {
      const model = (window.akari.previewCaptions || [])
        .filter(c => (c.sourceCueId || c.id) === captionId)
        .map(c => ({id:c.id,sourceCueId:c.sourceCueId ?? null,
          scale:c.textStyle?.scale ?? 1,rotate:c.textStyle?.rotate ?? 0}));
      gate.writes.push({at:performance.now(),captionId,
        patch:JSON.parse(JSON.stringify(patch)),model});
      return Reflect.apply(gate.originalWrite, this, [captionId, patch]);
    };
    window.addEventListener('message', gate.handler, true);
    window.__captionDragRotateGate = gate;
    return { instance: window.__captionHandlesL1?.instance, blocked: gate.blocked };
  })()`);
}
async function gateState() {
  return pe(`(() => ({instance:window.__captionHandlesL1?.instance,
    active:Boolean(window.__captionDragRotateGate),
    blocked:window.__captionDragRotateGate?.blocked ?? null,
    messages:window.__captionDragRotateGate?.messages ?? [],
    writes:window.__captionDragRotateGate?.writes ?? []}))()`);
}
async function releaseCaptionReloads() {
  return pe(`(() => {
    const gate = window.__captionDragRotateGate;
    if (!gate) return { active: false, blocked: null };
    window.removeEventListener('message', gate.handler, true);
    window.akari.engine.captionWrite = gate.originalWrite;
    delete window.__captionDragRotateGate;
    return { active: false, blocked: gate.blocked, messages: gate.messages, writes: gate.writes };
  })()`);
}
async function modelStyle(id) {
  return pe(`(() => (window.akari.previewCaptions || [])
    .filter(c => (c.sourceCueId || c.id) === ${S(id)})
    .map(c => ({id:c.id,sourceCueId:c.sourceCueId ?? null,
      scale:c.textStyle?.scale ?? 1,rotate:c.textStyle?.rotate ?? 0})))()`);
}
async function observeStyle(id) {
  const snapshot = await disk();
  const style = cue(snapshot, id)?.text_style;
  return { model: await modelStyle(id),
    disk: { scale: style?.scale ?? 1, rotate: style?.rotate ?? 0, position: style?.position },
    displayed: rowFor(await rows(), id), gate: await gateState() };
}
async function ensureStaleModel(id, fields) {
  const natural = await observeStyle(id);
  check(natural.model.length > 0, `model contains ${id}`, natural);
  const stale = observation => fields.every(field =>
    observation.model.every(model => model[field] !== observation.disk[field]));
  if (stale(natural)) return { natural, injected: false, beforeGesture: natural };
  const injected = await pe(`(() => {
    const changed=[];
    for (const caption of window.akari.previewCaptions || []) {
      if ((caption.sourceCueId || caption.id) !== ${S(id)}) continue;
      if (!caption.textStyle) caption.textStyle = {};
      for (const field of ${S(fields)}) delete caption.textStyle[field];
      changed.push(caption.id);
    }
    return changed;
  })()`);
  const beforeGesture = await observeStyle(id);
  check(stale(beforeGesture), `stale model prepared for ${id}`, { fields, natural, injected, beforeGesture });
  return { natural, injected, beforeGesture };
}
async function writeResponses() {
  return pe(`window.__captionHandlesL1.messages.filter(m => m.type === 'akari-preview-caption-write-response').length`);
}
async function awaitWriteResponse(previous) {
  return waitFor('caption write response', async () => {
    const messages = await pe(`window.__captionHandlesL1.messages.filter(m => m.type === 'akari-preview-caption-write-response')`);
    return messages.length > previous && messages.at(-1).ok && messages.at(-1);
  });
}
async function scaleHandle(id, factor) {
  const writes = await writeResponses();
  const selector = await selectorFor(id);
  const pivot = center(await rect(`${selector} .akari-caption-handle-box`));
  const start = center(await rect(`${selector} [data-h="se"]`));
  const end = { x: pivot.x + (start.x - pivot.x) * factor,
    y: pivot.y + (start.y - pivot.y) * factor };
  await drag(start, end);
  return { start, end, response: await awaitWriteResponse(writes), dom: rowFor(await rows(), id) };
}
async function alignModelRotate(id, rotate) {
  const changed = await pe(`(() => {
    const changed=[];
    for (const caption of window.akari.previewCaptions || []) {
      if ((caption.sourceCueId || caption.id) !== ${S(id)}) continue;
      if (!caption.textStyle) caption.textStyle = {};
      caption.textStyle.rotate = ${S(rotate)};
      changed.push(caption.id);
    }
    return changed;
  })()`);
  const model = await modelStyle(id);
  check(changed.length > 0 && model.length === changed.length
    && model.every(caption => caption.rotate === rotate),
  `model rotation aligned to ${rotate}`, { changed, model });
  return { changed, model };
}
async function rotateHandle(id, degrees, modelBaseline) {
  const writes = await writeResponses();
  const selector = await selectorFor(id);
  const pivot = center(await rect(`${selector} .akari-caption-handle-box`));
  const start = center(await rect(`${selector} [data-h="rot"]`));
  const angle = Math.atan2(start.y - pivot.y, start.x - pivot.x) + degrees * Math.PI / 180;
  const radius = Math.hypot(start.x - pivot.x, start.y - pivot.y);
  const end = { x: pivot.x + radius * Math.cos(angle), y: pivot.y + radius * Math.sin(angle) };
  const alignedModel = modelBaseline === undefined ? null : await alignModelRotate(id, modelBaseline);
  await drag(start, end, 8);
  return { start, end, alignedModel, response: await awaitWriteResponse(writes), dom: rowFor(await rows(), id) };
}
async function recoverRotation(id, target = 30) {
  const attempts = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const before = await observeStyle(id);
    const displayedRotate = parseFloat(before.displayed?.rotate);
    check(Number.isFinite(displayedRotate) && Number.isFinite(before.disk.rotate),
      'finite recovery angles', before);
    if (before.disk.rotate === target && displayedRotate === target) {
      return { attempts, final: before };
    }
    // The old handler adds pointer delta to the model baseline, not the DOM angle.
    // Align that baseline to the displayed angle immediately before pointer input.
    const pointerDelta = (target - displayedRotate) * 0.8;
    check(Math.abs(pointerDelta) >= 1, 'recovery needs a movable handle delta', before);
    const gesture = await rotateHandle(id, pointerDelta, displayedRotate);
    const after = await observeStyle(id);
    const request = after.gate.writes.at(-1);
    attempts.push({ attempt, before, pointerDelta, gesture, request, after });
    if (after.disk.rotate === target && parseFloat(after.displayed?.rotate) === target) {
      return { attempts, final: after };
    }
  }
  throw new Error(`rotation recovery did not land at ${target}: ${S(attempts.map(a => ({
    attempt: a.attempt, before: a.before.disk.rotate,
    modelAtWrite: a.request?.model, saved: a.after.disk.rotate,
    displayed: a.after.displayed?.rotate
  })) )}`);
}
async function bodyDrag(id) {
  const writes = await writeResponses();
  const start = await pointFor(id);
  const end = { x: start.x + 35, y: start.y - 25 };
  await drag(start, end);
  return { start, end, response: await awaitWriteResponse(writes), dom: rowFor(await rows(), id) };
}
const isClose = (value, target) => Number.isFinite(value) && Math.abs(value - target) < 0.002;
const actions = [
  async out => {
    await seek(0.5); await clearSelection(); await clickCue('c-0001');
    out.selection = await selected(['c-0001']);
    out.before = await disk();
    out.gate = await holdCaptionReloads();
    check(out.gate.instance, 'caption preview observation instance');
  },
  async out => {
    out.gesture = await scaleHandle('c-0001', 1.25);
    out.saved = await saved(c => isClose(c.text_style?.scale, 1.25));
    check(isClose(parseFloat(out.gesture.dom.scale), 1.25), 'DOM scale 1.25', out.gesture.dom);
    out.gate = await gateState();
    check(out.gate.active, 'watcher reload gate remains active');
  },
  async out => {
    out.first = await rotateHandle('c-0001', 12);
    out.firstSaved = await saved(c => c.text_style?.rotate === 15);
    out.stale = await ensureStaleModel('c-0001', ['rotate']);
    out.second = await rotateHandle('c-0001', 12);
    out.secondSaved = await disk();
    const actual = cue(out.secondSaved).text_style?.rotate;
    out.expected = mode === 'before' ? 15 : 30;
    out.actualSecond = actual;
    out.gate = await gateState();
    out.request = out.gate.writes.at(-1);
    check(out.request?.model?.length > 0
      && out.request.model.every(model => model.rotate === 0),
    'second handle write saw stale model rotation', out.request);
    if (mode === 'after') check(actual === 30, 'consecutive rotation accumulates from displayed 15 degrees', actual);
    else {
      check(actual === 15, 'pre-fix consecutive rotation reused stale zero baseline', actual);
      // Restore the requested 30-degree saved state before the body-drag probe.
      out.recovery = await recoverRotation('c-0001', 30);
      out.recoverySaved = await disk();
      check(cue(out.recoverySaved).text_style?.rotate === 30,
        'recovery persisted 30 degrees', cue(out.recoverySaved).text_style);
    }
  },
  async out => {
    out.before = await disk();
    check(isClose(cue(out.before).text_style?.scale, 1.25)
      && cue(out.before).text_style?.rotate === 30,
    'body drag starts with saved scale 1.25 and rotation 30', cue(out.before).text_style);
    out.stale = await ensureStaleModel('c-0001', ['scale', 'rotate']);
    out.gesture = await bodyDrag('c-0001');
    out.saved = await saved(c => S(c.text_style?.position) !== S(cue(out.before).text_style?.position));
    const style = cue(out.saved).text_style;
    out.actual = { scale: style?.scale ?? 1, rotate: style?.rotate ?? 0, position: style?.position };
    out.gate = await gateState();
    out.request = out.gate.writes.at(-1);
    check(out.request?.model?.length > 0
      && out.request.model.every(model => model.scale === 1 && model.rotate === 0),
    'body drag write saw stale model transform', out.request);
    if (mode === 'after') {
      check(out.request?.patch?.cuePosition && !out.request.patch.plateTransform,
        'after bundle sends position-only patch', out.request);
      check(isClose(out.actual.scale, 1.25) && out.actual.rotate === 30,
        'position-only body drag retains 1.25 scale and 30 rotation', out.actual);
    } else {
      check(out.request?.patch?.plateTransform?.scale === 1
        && out.request?.patch?.plateTransform?.rotate === 0,
      'before bundle sends stale scale/rotate with position', out.request);
      check(out.actual.scale === 1 && out.actual.rotate === 0,
        'pre-fix body drag drops the saved 30-degree rotation and 1.25 scale', out.actual);
    }
  },
  async out => {
    await clearSelection(); await clickCue('c-0002'); await selected(['c-0002']);
    out.before = await disk();
    out.scale = await scaleHandle('c-0002', 1.25);
    out.afterScale = await saved(c => isClose(c.text_style?.scale, 1.25), 'c-0002');
    out.stale = await ensureStaleModel('c-0002', ['scale']);
    out.drag = await bodyDrag('c-0002');
    out.saved = await saved(c => S(c.text_style?.position) !== S(cue(out.afterScale, 'c-0002').text_style?.position), 'c-0002');
    out.actual = cue(out.saved, 'c-0002').text_style;
    out.gate = await gateState();
    out.request = out.gate.writes.at(-1);
    check(out.request?.model?.length > 0
      && out.request.model.every(model => model.scale === 1),
    'scale then drag write saw stale model scale', out.request);
    if (mode === 'after') check(isClose(out.actual?.scale, 1.25), 'immediate drag retains scale', out.actual);
    else check(out.actual?.scale === undefined, 'pre-fix drag drops new scale', out.actual);
  },
  async out => {
    await seek(3); await clearSelection(); await clickCue('c-0003'); await selected(['c-0003']);
    out.before = await disk();
    out.drag = await bodyDrag('c-0003');
    out.afterDrag = await saved(c => S(c.text_style?.position) !== S(cue(out.before, 'c-0003').text_style?.position), 'c-0003');
    out.preRotation = await observeStyle('c-0003');
    out.rotate = await rotateHandle('c-0003', 23);
    out.saved = await saved(c => c.text_style?.rotate === 30, 'c-0003');
    out.actual = cue(out.saved, 'c-0003').text_style;
    out.gate = await gateState();
    check(S(out.actual.position) === S(cue(out.afterDrag, 'c-0003').text_style.position),
      'reverse drag then rotation retains new position', out.actual);
  },
  async out => {
    out.beforeRelease = await gateState();
    check(out.beforeRelease.active, 'gate stayed active throughout back-to-back gestures');
    out.released = await releaseCaptionReloads();
    out.final = await disk();
  }
];

try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes('--startup-failed')) throw new Error('Electron/setup readiness failed; see launcher stderr');
  const target = await waitFor('Theia page', async () => {
    const list = await targets(); return list.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? list.find(t => t.type === 'page');
  }, 600_000);
  main = await connect(target); await main.send('Runtime.enable'); await main.send('Page.enable');
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
  await main.send('Page.bringToFront');
  await waitFor('Theia ready', () => evalOn(main, `Boolean(window.theia?.container&&document.readyState==='complete')`), 600_000);
  await evalOn(main, `(() => {const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ');b?.click();})()`);
  // The launcher already waits for Theia's ready state. Do not enqueue another
  // widget-opening command every time a pending invocation times out.
  await command('akari.annotations.open');
  // Complete the host's initial renderer/model handshake before observing it.
  const initialSeek = await command('akari.preview.seekOutput', { editUri, time: 0.5, waitForReady: true });
  check(initialSeek.result === 'seeked', 'initial ready seek accepted', initialSeek);
  await attachPreview(); await seek(0.5);
  for (const [index, action] of actions.entries()) {
    const record = { step: index + 1, title: titles[index], status: 'ng', observations: {} };
    records.push(record);
    try { await action(record.observations); await shot(`step-${index + 1}`); record.status = 'ok'; }
    catch (error) {
      record.error = error.stack ?? String(error);
      try { record.observations.failure = await rows(); await shot(`failure-${index + 1}`); } catch {}
    }
    console.log(`[${mode} step ${index + 1}] ${record.status}`);
  }
} catch (error) { fatalError = error.stack ?? String(error); }
finally {
  for (let index = records.length; index < titles.length; index++) records.push({ step: index + 1, title: titles[index], status: 'not-run' });
  const status = !fatalError && records.every(r => r.status === 'ok') ? 'PASS' : 'FAIL';
  await mkdir(evidence, { recursive: true });
  await writeFile(logPath, JSON.stringify({ status, mode, startedAt, finishedAt: new Date().toISOString(), records, seeks, commands, error: fatalError,
    persistence: 'Existing captionWrite persists captions.json text_style; edit.json is also recorded, never forced to change.',
    input: 'CDP Input.dispatchMouseEvent; every Shift pointermove has modifiers=8; CDP keyboard input' }, null, 2) + '\n');
  for (const cdp of connections) { try { cdp.close(); } catch {} }
  console.log(`${status}: ${logPath}`); process.exitCode = status === 'PASS' ? 0 : 1;
}
