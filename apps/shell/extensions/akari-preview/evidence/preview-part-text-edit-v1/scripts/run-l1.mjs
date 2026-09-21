#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify, isDeepStrictEqual as equal } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CDP, evalOn as rawEvalOn, realClick, keyPress, screenshot
} from '../../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceArg, evidenceArg, mode] = process.argv;
if (!workspaceArg || !evidenceArg || !['before', 'after'].includes(mode)) {
  throw new Error('usage: run-l1.mjs <port> <workspace> <evidence> <before|after>');
}
const port = Number(portArg || process.env.AKARI_CDP_PORT || 9747);
const project = path.resolve(workspaceArg, 'project');
const editPath = path.join(project, 'edit.json');
const editUri = pathToFileURL(editPath).href;
const evidence = path.resolve(evidenceArg);
const logPath = path.join(evidence, mode === 'before' ? 'run-log-before.json' : 'run-log.json');
const run = promisify(execFile);
const S = JSON.stringify;
const SAMPLE = 0.5;
const READY_MS = 600_000;
const ACTION_MS = 60_000;
const cases = [
  { id: 's01.C', part: 'C', text: 'L1-C-new' },
  { id: 's01.B', part: 'B', text: 'L1-B-new' },
  { id: 's01#A', part: 'A', text: 'L1-A-new' },
  { id: 'plain', part: null, text: 'L1-plain-new' }
];
const records = [], events = [], connections = new Set();
const startedAt = new Date().toISOString();
let main, preview, contextId, baseline, fatalError;
let attachmentSequence = 0;
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
  return { card: await fileSnapshot('overlays/card.html', text),
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
      if(m?.type==='akari-preview-overlay-write-response')emit('response',m);
    },true);
    const engine=window.akari.engine, original=engine.overlayWrite;
    if(typeof original!=='function')throw new Error('overlayWrite unavailable');
    engine.overlayWrite=function(editPath,overlayId,patch) {
      const copy=JSON.parse(JSON.stringify(patch));
      emit('write',{type:'akari-preview-overlay-write',editPath,overlayId,patch:copy,
        hasHtml:Object.hasOwn(copy,'html'),hasText:Object.hasOwn(copy,'text'),
        htmlHead200:typeof copy.html==='string'?copy.html.slice(0,200):null});
      return Reflect.apply(original,this,arguments);
    };
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
async function reopen(reason, closed) {
  await attachPreview(); await seekSample();
  return { reason, path: 'ApplicationShell.closeWidget -> akari.preview.ensureVisible', closed,
    instance: await pe('window.__akariPartTextEvidence.instance') };
}
async function resetCase() {
  const closed = await closePreview();
  // Refuse inherited Git locations or a caller-supplied product checkout.
  check(await realpath((await git('rev-parse', '--show-toplevel')).trim()) === await realpath(project),
    'reset is restricted to the disposable project repository');
  check((await git('rev-parse', 'HEAD')).trim() === baseline.commit, 'fixture HEAD unchanged');
  await git('restore', '--source=HEAD', '--staged', '--worktree', '--', '.');
  await git('clean', '-fd');
  const restored = await diskSnapshot();
  check(restored.editSha256 === baseline.editSha256 && restored.card.sha256 === baseline.card.sha256
    && restored.plain.sha256 === baseline.plain.sha256 && restored.gitDiff === '', 'pristine case baseline', restored);
  return { reset: 'git restore --source=HEAD --staged --worktree -- . && git clean -fd',
    rebuild: await reopen('case starts from the initial commit', closed), restored };
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
async function observeDOM(doc, targetId, part) {
  const ids = partIds(doc);
  return pe(`(() => {
    const mounts=[...document.querySelectorAll('#overlay-stage > [data-overlay-id]')];
    const find=id=>mounts.find(e=>e.dataset.overlayId===id);
    const describe=e=>e?{textContent:e.textContent,visibility:getComputedStyle(e).visibility,
      display:getComputedStyle(e).display,opacity:getComputedStyle(e).opacity}:null;
    const ownParts=Object.fromEntries(Object.entries(${S(ids)}).map(([part,id])=>
      [part,{overlayId:id,...describe(find(id)?.querySelector('[data-akari-part="'+part+'"]'))}]));
    const clones=Object.entries(${S(ids)}).map(([part,id])=>({part,overlayId:id,
      elements:[...(find(id)?.querySelectorAll('[data-akari-part]')??[])].map(e=>({part:e.dataset.akariPart,...describe(e)}))}));
    const target=find(${S(targetId)})?.querySelector(${S(part ? `[data-akari-part="${part}"]` : '.plain')});
    return {target:describe(target),ownParts,clones};
  })()`);
}
async function editable(id) {
  return pe(`(() => {
    const e=document.activeElement;
    if(!document.hasFocus()||!e?.isContentEditable||e.closest('[data-overlay-id]')?.dataset.overlayId!==${S(id)})return null;
    return {text:e.textContent,part:e.dataset.akariPart??null,tag:e.tagName,selection:window.getSelection()?.toString()};
  })()`);
}
async function editText(test, out, label) {
  const modifiers = process.platform === 'darwin' ? 4 : 2;
  out.deepClick = await pointFor(test.id, test.part);
  await realClick(preview, out.deepClick.x, out.deepClick.y, { modifiers });
  out.selected = await expectState({ selectedId: test.id, activeEdit: false });
  await sleep(400);
  out.doubleClick = await pointFor(test.id, test.part);
  await realClick(preview, out.doubleClick.x, out.doubleClick.y, { clickCount: 2 });
  await expectState({ selectedId: test.id, activeEdit: true });
  out.editingBefore = await waitFor('focused editable target', () => editable(test.id));
  check(out.editingBefore.part === test.part, 'editing the part element itself', out.editingBefore);
  await keyPress(preview, { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers, commands: ['selectAll'] });
  out.selectedText = await waitFor('all original text selected', async () => {
    const value = await editable(test.id);
    return value && value.selection === out.editingBefore.text && value;
  });
  await preview.send('Input.insertText', { text: test.text });
  out.editingAfter = await waitFor('replacement text in focused editable', async () => {
    const value = await editable(test.id); return value?.text === test.text && value;
  });
  await shot(`${label}-editing`);
  await keyPress(preview, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await expectState({ activeEdit: false });
}
function expectedEdit(test, initial) {
  const expected = structuredClone(initial);
  if (test.id === 's01#A') {
    const bag = locate(expected, 's01');
    // P1 materialization, plus the one intended text override. No other fields
    // or changes elsewhere are allowed, including changes to exclude or B.
    bag.items.push({ id: 's01.A', at: 0, duration: bag.duration,
      source: { kind: 'html', path: bag.source.path, part: 'A', text: test.text } });
  } else if (test.part) locate(expected, test.id).source.text = test.text;
  return expected;
}
async function verdict(test, out) {
  const before = out.before, after = out.after;
  const expected = expectedEdit(test, before.edit);
  const checks = {
    oneWriteAndResponse: out.writes.length === 1 && out.responses.length === 1,
    correctWriteTarget: out.writes.length > 0 && out.writes.every(w => w.overlayId === test.id),
    writeSucceeded: out.responses.length > 0 && out.responses.every(r => r.ok === true),
    cardUnchanged: before.card.sha256 === after.card.sha256
  };
  if (test.part) {
    Object.assign(checks, {
      textPayloadOnly: out.writes.length > 0 && out.writes.every(w => !w.hasHtml && w.hasText && w.patch.text === test.text),
      sourceTextSaved: locate(after.edit, out.persistedId)?.source?.text === test.text,
      noOtherEditChanges: equal(after.edit, expected),
      // resolveV2Write retains its pre-existing JSON.stringify serialization.
      expectedEditBytes: (await readFile(editPath, 'utf8')) === `${JSON.stringify(expected, undefined, 2)}\n`,
      plainUnchanged: before.plain.sha256 === after.plain.sha256,
      rebuiltText: out.rebuiltDOM.target?.textContent === test.text && out.rebuiltDOM.target?.visibility === 'visible',
      allOwnPartsVisible: Object.values(out.rebuiltDOM.ownParts).every(p => p.visibility === 'visible' && p.display !== 'none')
    });
  } else {
    Object.assign(checks, {
      plainSaved: before.plain.sha256 !== after.plain.sha256 && after.plain.containsNewText,
      noEditChanges: equal(after.edit, expected) && after.gitDiff === '',
      rebuiltText: out.rebuiltDOM.target?.textContent === test.text
    });
  }
  return checks;
}
async function runCase(test, index) {
  const label = `${index + 1}-${test.part ?? 'plain'}`;
  const record = { step: index + 1, title: `${test.id}: replace text and Enter`, ...test,
    status: 'ng', startedAt: new Date().toISOString(), observations: {} };
  records.push(record);
  const out = record.observations;
  let eventIndex = events.length;
  try {
    out.preparation = await resetCase();
    out.before = await diskSnapshot(test.text);
    out.beforeDOM = await observeDOM(out.before.edit, test.id, test.part);
    out.hitAreas = [];
    for (const entry of cases) out.hitAreas.push(await pointFor(entry.id, entry.part));
    check(out.hitAreas.every((a, i) => out.hitAreas.slice(i + 1).every(b =>
      a.rect.right <= b.rect.left || b.rect.right <= a.rect.left || a.rect.bottom <= b.rect.top || b.rect.bottom <= a.rect.top)),
    'four text hit boxes do not overlap', out.hitAreas);
    await shot(`${label}-initial`);
    eventIndex = events.length;
    await editText(test, out, label);
    await waitFor('overlay write and response', () => {
      const slice = events.slice(eventIndex);
      return slice.some(e => e.kind === 'write') && slice.some(e => e.kind === 'response');
    });
    await sleep(700);
    out.writes = events.slice(eventIndex).filter(e => e.kind === 'write').map(e => e.data);
    out.responses = events.slice(eventIndex).filter(e => e.kind === 'response').map(e => e.data);
    check(out.writes.length > 0 && out.writes.every(w => w.overlayId === test.id), 'observed intended write', out.writes);
    check(out.responses.every(r => typeof r.ok === 'boolean'), 'well-formed write responses', out.responses);
    out.after = await diskSnapshot(test.text);
    out.persistedId = test.part === 'A' ? partIds(out.after.edit).A : test.id;
    out.liveDOM = await observeDOM(out.after.edit, test.id, test.part);
    out.rebuild = await reopen('observe persisted text and visibility after Enter', await closePreview());
    out.rebuiltDOM = await observeDOM(out.after.edit, out.persistedId, test.part);
    await shot(`${label}-rebuilt`);
    out.checks = await verdict(test, out);
    out.reproduction = {
      cardChanged: out.before.card.sha256 !== out.after.card.sha256,
      maskWrittenToSharedSource: out.writes.some(w => w.hasHtml && w.patch.html.includes('data-akari-part-mask'))
        && out.after.card.head200BytesUtf8.includes('data-akari-part-mask'),
      hiddenOwnParts: Object.entries(out.rebuiltDOM.ownParts).filter(([, p]) => p.visibility === 'hidden').map(([part]) => part)
    };
    out.reproduction.status = test.part
      ? out.reproduction.cardChanged && out.reproduction.maskWrittenToSharedSource ? 'reproduced' : 'not-reproduced'
      : 'regression-observation';
    // BEFORE succeeds when the experiment was performed, regardless of whether
    // corruption, a rejected write, or already-fixed behavior was observed.
    if (mode === 'after') check(Object.values(out.checks).every(Boolean), 'AFTER acceptance checks', out.checks);
    record.status = 'ok';
  } catch (error) {
    record.error = error.stack ?? String(error);
    try { record.failureState = await state(); } catch {}
    try { await shot(`${label}-failure`); } catch {}
  } finally {
    // Retain disk/payload evidence even when input, response, or rebuild fails.
    out.writes ??= events.slice(eventIndex).filter(e => e.kind === 'write').map(e => e.data);
    out.responses ??= events.slice(eventIndex).filter(e => e.kind === 'response').map(e => e.data);
    if (!out.after) {
      try { out.after = await diskSnapshot(test.text); } catch (error) { out.diskError = error.message; }
    }
    record.finishedAt = new Date().toISOString();
  }
  console.log(`[${mode} step ${index + 1}] ${record.status}${out.reproduction ? ` (${out.reproduction.status})` : ''}`);
}

try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes('--startup-failed')) throw new Error('Launcher setup failed, Electron exited, or readiness exceeded 600 seconds; see launcher stderr');
  baseline = { commit: (await git('rev-parse', 'HEAD')).trim(), ...await diskSnapshot() };
  check(baseline.gitDiff === '', 'fixture edit.json initially clean');
  if (mode === 'after') {
    let beforeLog;
    try { beforeLog = JSON.parse(await readFile(path.join(evidence, 'run-log-before.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (beforeLog?.baseline) check(['editSha256'].every(key => beforeLog.baseline[key] === baseline[key])
      && beforeLog.baseline.card.sha256 === baseline.card.sha256 && beforeLog.baseline.plain.sha256 === baseline.plain.sha256,
    'BEFORE and AFTER fixture hashes match');
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
  for (const [index, test] of cases.entries()) await runCase(test, index);
} catch (error) {
  fatalError = error.stack ?? String(error);
} finally {
  const status = !fatalError && records.length === cases.length && records.every(r => r.status === 'ok') ? 'PASS' : 'FAIL';
  let finalDiff;
  try { finalDiff = await diff(); } catch (error) { finalDiff = { error: error.message }; }
  try {
    await mkdir(evidence, { recursive: true });
    await writeFile(logPath, `${JSON.stringify({ status, mode, startedAt, finishedAt: new Date().toISOString(),
      sampleSeconds: SAMPLE, payloadObservation: 'transparent engine.overlayWrite wrapper; raw responses include requestId',
      baseline, records, events, finalDiff, ...(fatalError ? { error: fatalError } : {}) }, null, 2)}\n`);
  } finally {
    for (const cdp of connections) { try { cdp.close(); } catch {} }
  }
  console.log(`${mode}: ${status} (${logPath})`);
  process.exitCode = status === 'PASS' ? 0 : 1;
}
