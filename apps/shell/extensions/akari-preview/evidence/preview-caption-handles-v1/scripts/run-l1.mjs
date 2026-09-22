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
const titles = mode === 'before' ? [
  '(1) Before: blue selection box, no selected attribute or handles',
  'Missing-caption reproduction: seeks, overlapping cues and immediate post-edit counts'
] : [
  '(1) Same real preview click used for the before regression',
  '(2) Selected attribute, five handles and yellow outline; redraw retains selection',
  '(3) Corner drag changes live scale and persists',
  '(4) Shift rotation changes live angle and persists a multiple of 15 degrees',
  '(5) Body drag persists cue position',
  '(6) Host selection and two simultaneous selected cues; changing primary preserves the group',
  '(7) Empty click and Escape remove selection and handles',
  'Overlap/presence and caption editing Escape regression'
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
async function key(key, code = key, modifiers = 0, commands) {
  await waitFor('preview keyboard focus', () => pe('document.hasFocus()'), 5000);
  const input = preview, inputContext = contextId;
  const params = { key, code, modifiers, windowsVirtualKeyCode: key === 'Escape' ? 27 : key === 'Enter' ? 13 : 65 };
  if (commands) params.commands = commands;
  await input.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
  await input.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  check(previewContextValid && input === preview && inputContext === contextId, 'keyboard input context remained live');
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
async function saved(predicate) {
  return waitFor('caption persistence on disk', async () => { const value = await disk(); return predicate(cue(value)) && value; });
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
async function hostSelection(ids, primary = ids[0]) {
  await hostEvent('akari.daihon.selectionChanged', { captionIds: ids });
  await selected(ids);
  if (primary) await hostEvent('akari.timeline.primarySelected', { selection: { kind: 'caption', id: primary } });
  return selected(ids);
}
async function clearSelection() {
  await hostEvent('akari.timeline.primarySelected', { selection: null });
  await hostEvent('akari.daihon.selectionChanged', { captionIds: [] });
  await waitFor('no caption selection', async () => { const s = await rows(); return !s.blue && s.rows.every(r => !r.selected && !r.handles.length); });
}
async function editText(text, cancel = false) {
  await clickCue(); await sleep(350); await clickCue('c-0001', 2);
  await waitFor('caption editor', () => pe(`document.hasFocus()&&document.activeElement?.matches('[data-akari-caption-editing]')`));
  await key('a', 'KeyA', process.platform === 'darwin' ? 4 : 2, ['selectAll']);
  await waitFor('selectAll targets caption', () => pe(`document.activeElement?.matches('[data-akari-caption-editing]')
    &&window.getSelection()?.toString()===document.activeElement.textContent`));
  await preview.send('Input.insertText', { text });
  await waitFor('caption text input applied', () => pe(`document.activeElement?.matches('[data-akari-caption-editing]')
    &&document.activeElement.textContent===${S(text)}`));
  await key(cancel ? 'Escape' : 'Enter');
  await waitFor('editor closed', () => pe(`!document.querySelector('[data-akari-caption-editing]')`));
  // Snapshot immediately after the actual editor exits, before waiting for I/O.
  const immediate = await rows();
  if (!cancel) await saved(c => c.text === text);
  return immediate;
}
async function presenceProbe(out, milliseconds) {
  out.durationRequestedMs = milliseconds;
  out.samples = []; out.missing = [];
  const began = Date.now();
  let iteration = 0;
  do {
    for (const [time, expected] of [[0.5, ['c-0001', 'c-0002']], [3, ['c-0003']], [0.5, ['c-0001', 'c-0002']], [2.25, []], [1.5, ['c-0001', 'c-0002']]]) {
      await seek(time);
      const snapshot = await rows();
      const ok = snapshot.rows.length === expected.length && expected.every(id => rowFor(snapshot, id)?.visible);
      const sample = { iteration, operation: 'seek', expected, ok, snapshot };
      out.samples.push(sample);
      if (!ok) out.missing.push(sample);
    }
    await seek(0.5);
    const text = `First caption edit ${iteration}`;
    const snapshot = await editText(text);
    const ok = snapshot.rows.length === 2 && ['c-0001', 'c-0002'].every(id => rowFor(snapshot, id)?.visible);
    const sample = { iteration, operation: 'immediately-after-edit', expected: ['c-0001', 'c-0002'], ok, snapshot };
    out.samples.push(sample);
    if (!ok) out.missing.push(sample);
    if (iteration === 0 || !ok) await shot(`presence-${iteration}`);
    iteration++;
    console.log(`[${mode} presence] cycle ${iteration}; ${Date.now() - began}ms; missing=${out.missing.length}`);
  } while (Date.now() - began < milliseconds);
  out.elapsedMs = Date.now() - began;
  out.reproduced = out.missing.length > 0;
  out.scope = out.reproduced ? 'Missing caption observed; inspect samples' : 'Not reproduced in this run; no rendering change proposed';
  if (mode === 'after') check(!out.reproduced, 'all overlap/presence observations passed', out.missing);
}

const actions = mode === 'before' ? [
  async out => {
    await seek(0.5); await clearSelection();
    out.observed = await clickCue();
    const row = rowFor(out.observed, 'c-0001');
    check(out.observed.blue && !row.selected && out.observed.rows.every(r => !r.selected && r.handles.length === 0),
      'regression must be observed on the pre-fix build', out.observed);
  },
  async out => {
    const ms = Number(process.env.AKARI_CAPTION_PROBE_MS ?? 600_000);
    check(Number.isFinite(ms) && ms >= 0, 'valid AKARI_CAPTION_PROBE_MS');
    await presenceProbe(out, ms);
  }
] : [
  async out => {
    await seek(0.5); await clearSelection();
    out.observed = await clickCue();
    check(out.observed.blue, 'same click activates the blue box', out.observed);
    out.beforeEvidence = '../run-log-before.json (run separately against the pre-fix build)';
  },
  async out => {
    await seek(0.5); await clickCue(); out.selected = await selected(['c-0001']);
    await seek(2.25); out.absent = await rows(); check(out.absent.rows.length === 0, 'rows removed outside cue intervals');
    await seek(0.5); out.rebuilt = await selected(['c-0001']);
  },
  async out => {
    await seek(0.5); await clearSelection(); await clickCue(); await selected(['c-0001']);
    out.before = await disk();
    const selector = await selectorFor('c-0001');
    const pivot = center(await rect(`${selector} .akari-caption-handle-box`));
    const start = center(await rect(`${selector} [data-h="se"]`));
    const end = { x: pivot.x + (start.x - pivot.x) * 1.25, y: pivot.y + (start.y - pivot.y) * 1.25 };
    await drag(start, end, 0, async () => {
      out.live = await rows(); const value = parseFloat(rowFor(out.live, 'c-0001').scale);
      check(Number.isFinite(value) && Math.abs(value - (cue(out.before).text_style?.scale ?? 1)) > 0.01, 'live scale changed', out.live);
    });
    const live = parseFloat(rowFor(out.live, 'c-0001').scale);
    out.saved = await saved(c => Math.abs(c.text_style?.scale - live) < 0.002);
    check(S(cue(out.before, 'c-0002')) === S(cue(out.saved, 'c-0002')), 'other overlapping cue unchanged');
    await seek(2.25); await seek(0.5);
    out.rebuilt = await waitFor('saved scale displayed after redraw', async () => {
      const s = await rows(); assertSelected(s, ['c-0001']);
      return Math.abs(parseFloat(rowFor(s, 'c-0001').scale) - live) < 0.002 && s;
    });
  },
  async out => {
    await seek(0.5); await clearSelection(); await clickCue(); await selected(['c-0001']);
    out.before = await disk(); const selector = await selectorFor('c-0001');
    const pivot = center(await rect(`${selector} .akari-caption-handle-box`));
    const start = center(await rect(`${selector} [data-h="rot"]`));
    const angle = Math.atan2(start.y - pivot.y, start.x - pivot.x) + 23 * Math.PI / 180;
    const radius = Math.hypot(start.x - pivot.x, start.y - pivot.y);
    const end = { x: pivot.x + radius * Math.cos(angle), y: pivot.y + radius * Math.sin(angle) };
    await drag(start, end, 8, async () => {
      out.live = await rows(); const value = parseFloat(rowFor(out.live, 'c-0001').rotate);
      check(Number.isFinite(value) && Math.abs(value) > 1 && Math.abs(value % 15) < 0.001, 'Shift live rotation is a nonzero multiple of 15', value);
    });
    const live = parseFloat(rowFor(out.live, 'c-0001').rotate);
    out.saved = await saved(c => c.text_style?.rotate === live);
    check(Math.abs(cue(out.saved).text_style.rotate % 15) < 0.001, 'saved Shift rotation snaps to 15 degrees');
    check(cue(out.saved).text_style.rotate !== (cue(out.before).text_style.rotate ?? 0), 'rotation changed on disk');
    out.persistedVisual = await waitFor('saved rotation displayed', async () => {
      const state = await rows(); assertSelected(state, ['c-0001']);
      return parseFloat(rowFor(state, 'c-0001').rotate) === live && state;
    });
  },
  async out => {
    await seek(0.5); await clearSelection(); await clickCue();
    out.before = await disk(); const start = await pointFor('c-0001');
    await drag(start, { x: start.x + 35, y: start.y - 25 });
    out.saved = await saved(c => S(c.text_style?.position) !== S(cue(out.before).text_style?.position));
    check(S(cue(out.saved, 'c-0002')) === S(cue(out.before, 'c-0002')), 'body drag only moves its cue');
    out.observed = await rows();
  },
  async out => {
    await seek(0.5); await clearSelection();
    out.single = await hostSelection(['c-0001']);
    out.multiple = await hostSelection(['c-0001', 'c-0002'], 'c-0001');
    out.changedPrimary = await hostSelection(['c-0001', 'c-0002'], 'c-0002');
    // Re-click the same primary without reposting the host set.
    await clickCue('c-0002'); out.reselectedPrimary = await selected(['c-0001', 'c-0002']);
    await seek(2.25); await seek(0.5); out.rebuilt = await selected(['c-0001', 'c-0002']);
    out.messages = await pe('window.__captionHandlesL1.messages');
    check(out.messages.some(m => m.type === 'akari-preview-set-selected-captions' && m.captionIds?.length === 2), 'host multi-selection message received');
    check(out.messages.some(m => m.type === 'akari-preview-select-primary' && m.selection?.id === 'c-0002'), 'host primary message received');
  },
  async out => {
    await seek(0.5); await clearSelection(); await clickCue(); await selected(['c-0001']);
    const empty = await pe(`(() => {
      const pane=document.querySelector('.preview-pane'),r=pane.getBoundingClientRect();
      for(const fx of [.03,.97,.1,.9])for(const fy of [.1,.5,.9]) {
        const x=r.x+r.width*fx,y=r.y+r.height*fy,e=document.elementFromPoint(x,y);
        if(e&&pane.contains(e)&&!e.closest('button,[role="button"],input,textarea,select,a,#preview-stage,#caption-plate,#caption-select-box,#layer-select-box,#cut-select-box'))return {x,y};
      }throw new Error('Empty preview point unavailable');
    })()`);
    await realClick(preview, empty.x, empty.y);
    out.emptyClick = await waitFor('empty click clears caption marks', async () => {
      const s = await rows(); return !s.blue && s.rows.every(r => !r.selected && !r.handles.length) && s;
    });
    await clickCue(); await selected(['c-0001']); await key('Escape');
    out.escape = await waitFor('Escape clears caption marks', async () => {
      const s = await rows(); return !s.blue && s.rows.every(r => !r.selected && !r.handles.length) && s;
    });
  },
  async out => {
    await seek(0.5); await clearSelection(); out.beforeCancel = await disk();
    out.cancel = await editText('Cancelled text', true); out.afterCancel = await disk();
    check(S(out.beforeCancel) === S(out.afterCancel), 'editing Escape leaves disk unchanged');
    assertSelected(out.cancel, ['c-0001']);
    await presenceProbe(out, 0);
    out.afterEdit = await selected(['c-0001']);
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
