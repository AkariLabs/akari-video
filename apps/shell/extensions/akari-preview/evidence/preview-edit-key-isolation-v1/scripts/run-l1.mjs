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
const port = Number(portArg || 9777);
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
  return {rootId:w.focusScope.rootId, collapsedIds:[...w.timelineCollapsedIds], selectedId:w.selection?.id ?? null,
    selection:w.selection ?? null,
    breadcrumbs:w.focusScope.breadcrumbs,
    toolMode:w.toolMode,
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
  await pointFor('part');
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

const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const findItem = (edit, id) => edit.tracks.flatMap(track => track.items).find(item => item.id === id);
const playing = () => pe(`document.getElementById('play-toggle').getAttribute('aria-label')`);
const editingText = () => pe(`document.querySelector('[data-akari-interaction-editing="true"]')?.textContent`);
async function begin(id) {
  await clickPreviewPart(id);
  await expectState({ selectedId: id, activeEdit: false });
  await waitFor(`timeline ${id} selected before editing`, async () => (await timeline()).selectedId === id);
  const point = await pointFor(id);
  await realClick(preview, point.x, point.y, { clickCount: 2 });
  await expectState({ selectedId: id, activeEdit: true });
  check(await editingText() === 'あいう', 'fixture text and caret start', await editingText());
}
async function startProbe() {
  await evaluate(main, `(() => {
    const old=window.__akariEditKeyProbe;
    if(old)for(const type of ['keydown','keyup','keypress'])window.removeEventListener(type,old.listener,true);
    const probe={events:[]};
    probe.listener=e=>probe.events.push({type:e.type,key:e.key,code:e.code,isTrusted:e.isTrusted});
    for(const type of ['keydown','keyup','keypress'])window.addEventListener(type,probe.listener,true);
    window.__akariEditKeyProbe=probe;
  })()`);
}
const probe = () => evaluate(main, 'window.__akariEditKeyProbe.events');
async function sendKey(key, code, windowsVirtualKeyCode, text) {
  await requirePreviewFocus(`before ${key}`);
  await keyPress(preview, { key, code, windowsVirtualKeyCode, ...(text ? { text } : {}) });
  await sleep(300);
}
async function sample(step, title, action) {
  const record = { step, title, status: 'ng', observations: {} }; records.push(record);
  try {
    await action(record.observations);
    await screenshot(main, path.join(evidence, `step-${step}.png`)); record.status = 'ok';
  } catch (error) {
    record.error = error.stack ?? String(error);
    try { await screenshot(main, path.join(evidence, `failure-${step}.png`)); } catch {}
    throw error;
  } finally { console.log(`[step ${step}] ${record.status}`); }
}
try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes('--startup-failed')) throw new Error('Launcher setup/readiness failed');
  main = await connect(await waitFor('Theia page', async () => {
    const list = await targets(); return list.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? list.find(t => t.type === 'page');
  }, READY_MS));
  await main.send('Runtime.enable'); await main.send('Page.enable');
  await main.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false });
  await waitFor('Theia ready', () => evaluate(main, `Boolean(window.theia?.container && document.readyState==='complete')`), READY_MS);
  await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); b?.click(); })()`);
  await waitFor('timeline open', () => command('akari.annotations.open'), READY_MS);
  // Root leaves have strip items even when no tree rows are rendered.
  await waitFor('part timeline item', () => evaluate(main, `Boolean(document.querySelector('[data-akari-item-id="part"]'))`), READY_MS);
  await attachPreview(); await seekSample();
  await sample(1, 'Backspace edits one character; item survives, zero host events', async out => {
    out.before = await readEdit(); await begin('part');
    check((await timeline()).selectedId === 'part', 'timeline also selects the edited leaf', await timeline());
    await startProbe(); await sendKey('Backspace', 'Backspace', 8);
    out.text = await editingText(); check(out.text === 'あい', 'native Backspace', out);
    out.after = await readEdit(); check(equal(out.after, out.before), 'no item deletion or write during editing', out);
    out.events = await probe(); check(out.events.length === 0, 'no host key events', out.events);
  });
  await sample(2, 'Space/c/f insert text without playback or tool changes', async out => {
    out.before = { playing: await playing(), tool: (await timeline()).toolMode };
    check(typeof out.before.tool === 'string', 'tool mode available', out.before);
    await startProbe();
    await sendKey(' ', 'Space', 32, ' '); await sendKey('c', 'KeyC', 67, 'c'); await sendKey('f', 'KeyF', 70, 'f');
    out.text = await editingText(); check(out.text === 'あい cf', 'native typed text', out);
    out.after = { playing: await playing(), tool: (await timeline()).toolMode };
    check(equal(out.before, out.after), 'playback and tool unchanged', out);
    out.events = await probe(); check(out.events.length === 0, 'no host key events', out.events);
    check(findItem(await readEdit(), 'part'), 'part survives');
  });
  // Persistence is checked before the destructive positive control.
  await sample(4, 'Enter saves source.text and ordinary HTML', async out => {
    await press('Enter'); await expectState({ activeEdit: false });
    out.part = await waitFor('source.text saved', async () => {
      const item = findItem(await readEdit(), 'part'); return item?.source.text === 'あい cf' && item;
    });
    await begin('plain'); await sendKey('Backspace', 'Backspace', 8);
    await press('Enter'); await expectState({ activeEdit: false });
    out.html = await waitFor('plain HTML saved', async () => {
      const item = findItem(await readEdit(), 'plain');
      check(item, 'plain item survives');
      const html = item.source.html ?? await readFile(path.join(project, item.source.path), 'utf8');
      return html.includes('あい</div>') && !html.includes('あいう') && html;
    });
  });
  await sample(3, 'unedited Backspace reaches host once and deletes disposable leaf', async out => {
    // Reattach after writeback so no stale execution context can invalidate the control.
    await rebuildPreview(); await seekSample();
    await clickPreviewPart('plain'); await expectState({ selectedId: 'plain', activeEdit: false });
    await waitFor('timeline plain selected', async () => (await timeline()).selectedId === 'plain');
    out.before = await readEdit(); check(findItem(out.before, 'plain'), 'control leaf exists');
    await startProbe(); await sendKey('Backspace', 'Backspace', 8);
    await waitFor('control leaf deleted', async () => !findItem(await readEdit(), 'plain'));
    out.events = await probe();
    const down = out.events.filter(e => e.type === 'keydown');
    check(down.length === 1 && down[0].key === 'Backspace', 'exactly one forwarded Backspace keydown', out.events);
    out.after = await readEdit(); check(findItem(out.after, 'part'), 'other leaf survives');
  });
} catch (error) {
  fatalError = error.stack ?? String(error);
} finally {
  const status = !fatalError && records.length === 4 && records.every(r => r.status === 'ok') ? 'PASS' : 'FAIL';
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'run-log.json'), JSON.stringify({ status, startedAt,
    finishedAt: new Date().toISOString(), records, events, ...(fatalError ? { error: fatalError } : {}) }, null, 2) + '\n');
  for (const cdp of connections) { try { cdp.close(); } catch {} }
  process.exitCode = status === 'PASS' ? 0 : 1;
}
