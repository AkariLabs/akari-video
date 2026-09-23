#!/usr/bin/env node
// Run against a disposable Electron workspace. Tested gestures use CDP input.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, realClick, keyPress, screenshot }
  from '../../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceArg, evidenceArg] = process.argv;
if (!workspaceArg || !evidenceArg) throw new Error('usage: run-l1.mjs <port> <workspace> <evidence>');
const port = Number(portArg || 9774), evidence = path.resolve(evidenceArg);
const editPath = path.resolve(workspaceArg, 'project/edit.json');
const editUri = pathToFileURL(editPath).href;
const S = JSON.stringify, records = [], connections = [];
let main, preview, contextId;
const check = (ok, label, actual) => { if (!ok) throw new Error(`${label}: ${S(actual)}`); };
const seen = new Map();
const SEEK = `(()=>{const e=document.getElementById('seek');e.value='1.5';
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`;
const pe = async expression => {
  try { return await evalOn(preview, expression, contextId); }
  catch (error) {
    if (!/Cannot find context|context was destroyed|Inspected target navigated/u.test(String(error?.message))) throw error;
    await findPreview(); await evalOn(preview, SEEK, contextId); await sleep(500);
    return evalOn(preview, expression, contextId);
  }
};
const me = expression => evalOn(main, expression);
const edit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const allItems = document => document.tracks.flatMap(track => track.items ?? []);
async function waitFor(label, predicate, timeout = 60000) {
  const until = Date.now() + timeout; let last;
  while (Date.now() < until) {
    try { const value = await predicate(); if (value) return value; }
    catch (error) { last = error.message; }
    await sleep(150);
  }
  throw new Error(`timeout ${label}: ${last ?? ''}`);
}
async function connect(target, enable = true) {
  const cdp = new CDP(target.webSocketDebuggerUrl); connections.push(cdp);
  await cdp.connect();
  if (enable) { await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); }
  return cdp;
}
async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  check(response.ok, 'CDP target list', response.status); return response.json();
}
async function command(id, arg) {
  return me(`(async()=>{
    const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
      && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
    if(!key)throw Error('CommandRegistry missing');
    await c.get(key).executeCommand(${S(id)}${arg === undefined ? '' : `,${S(arg)}`});
    return true;
  })()`);
}
const timeline = () => me(`(()=>{
  const c=window.theia.container;
  const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
    && typeof k.prototype?.getCurrentWidget==='function' && typeof k.prototype?.addWidget==='function'
    && typeof k.prototype?.activateWidget==='function');
  const w=c.get(key).widgets.find(w=>w.id==='akari-annotations-widget');
  if(!w)throw Error('timeline missing');
  return {selected:w.multiSelection.map(i=>i.id??i.index),single:w.selection?.id??null,
    selectedRows:[...new Set([...w.node.querySelectorAll('[data-akari-tree-row-id].akari-annotations-selected')]
      .map(e=>e.dataset.akariTreeRowId).concat([...w.node.querySelectorAll('[data-akari-item-id].akari-annotations-selected')]
      .map(e=>e.dataset.akariItemId)))],footer:w.footer?.textContent??'',
    scmOpen:[...c.get(key).widgets].some(v=>String(v.id).includes('scm-view-container')&&v.isVisible)};
})()`);
async function setFooterSentinel(label) {
  return me(`(()=>{const c=window.theia.container;
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
      && typeof k.prototype?.getCurrentWidget==='function' && typeof k.prototype?.addWidget==='function');
    const w=c.get(key).widgets.find(w=>w.id==='akari-annotations-widget');
    if(!w?.footer)throw Error('timeline footer missing');
    w.footer.textContent=${S(label)};return true;
  })()`);
}
const state = () => pe(`(()=>{const i=window.akari.interaction;
  return {ids:i.selectedIds,id:i.selectedId,kind:i.selectionKind,scope:i.scopeId,editing:i.activeEdit};})()`);
async function findPreview() {
  await waitFor('output preview webview', async () => {
    for (const target of (await targets()).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) {
      if (!seen.has(target.id)) {
        const cdp = await connect(target, false), contexts = new Map();
        cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context));
        cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
        cdp.on('Runtime.executionContextsCleared', () => contexts.clear());
        seen.set(target.id, { cdp, contexts });
        await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      }
      const { cdp, contexts } = seen.get(target.id);
      for (const context of contexts.values()) {
        try {
          if (await evalOn(cdp, `Boolean(window.akari?.interaction && window.akari?.state?.editPath===${S(editUri)})`, context.id)) {
            preview = cdp; contextId = context.id; return true;
          }
        } catch { /* disposed context */ }
      }
    }
    return false;
  }, 600000);
}
async function attachPreview() {
  await command('akari.preview.ensureVisible', { editUri });
  await findPreview();
  await pe(SEEK);
  await waitFor('root overlays mounted', () => pe(`['a','b','c'].every(id =>
    [...document.querySelectorAll('[data-overlay-id]')].some(e => e.dataset.overlayId === id))`));
}
async function pointFor(id) {
  return waitFor(`hittable ${id}`, () => pe(`(()=>{
    const e=[...document.querySelectorAll('[data-overlay-id]')].find(e=>e.dataset.overlayId===${S(id)});
    if(!e)return null;
    for(const child of [...e.querySelectorAll('*'),e]){
      const r=child.getBoundingClientRect(),s=getComputedStyle(child);
      if(r.width<2||r.height<2||s.pointerEvents==='none'||s.visibility==='hidden')continue;
      for(const fx of [.5,.25,.75])for(const fy of [.5,.25,.75]){
        const x=r.left+r.width*fx,y=r.top+r.height*fy,h=document.elementFromPoint(x,y);
        if(h?.closest('[data-overlay-id]')===e)return {x,y};
      }
    }
    return null;
  })()`));
}
async function click(id, modifiers = 0, count = 1) {
  const point = await pointFor(id); await realClick(preview, point.x, point.y, { modifiers, clickCount: count });
  await sleep(350); return point;
}
async function press(key, modifiers = 0) {
  check(await pe('document.hasFocus()'), `preview focus before ${key}`);
  const vk = key === 'g' ? 71 : key === 'Delete' ? 46 : key === 'Enter' ? 13 : 27;
  await keyPress(preview, { key, code: key === 'g' ? 'KeyG' : key, windowsVirtualKeyCode: vk, modifiers });
  await sleep(500);
}
async function sample(number, label, run) {
  const record = { number, label, status: 'ng' }; records.push(record);
  try { record.observed = await run(); await screenshot(main, path.join(evidence, `step-${number}.png`)); record.status = 'ok'; }
  catch (error) { record.error = error.stack ?? String(error);
    try { record.timeline = await timeline(); record.preview = await state();
      await screenshot(main, path.join(evidence, `failure-${number}.png`)); } catch {}
  }
  console.log(`[${number}] ${record.status} ${label}`);
  if (record.status !== 'ok') throw new Error(record.error);
}

const item = (document, id) => allItems(document).find(entry => entry.id === id);
const point = (x, y) => ({ x, y });
async function bounds(id) {
  return waitFor(`hittable bounds ${id}`, () => pe(`(()=>{const e=[...document.querySelectorAll('[data-overlay-id]')]
    .find(e=>e.dataset.overlayId===${S(id)});
    if(!e)return null;
    const r=window.akari.interaction.fragmentBounds(e);
    if(!r || !(r.width > 0 && r.height > 0))return null;
    return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};})()`));
}
async function stageGeometry() {
  return pe(`(()=>{const stage=document.getElementById('preview-stage').getBoundingClientRect();
    const pane=document.querySelector('.preview-pane').getBoundingClientRect();
    return {stage:{left:stage.left,top:stage.top,right:stage.right,bottom:stage.bottom},
      pane:{left:pane.left,top:pane.top,right:pane.right,bottom:pane.bottom}};})()`);
}
async function gutter() {
  const { stage, pane } = await stageGeometry();
  const x = stage.left - 5;
  check(x > pane.left && x < pane.right, 'preview pasteboard gutter available', { stage, pane });
  return x;
}
async function marqueePath(memberIds) {
  const boxes = await Promise.all(memberIds.map(bounds));
  return [point(await gutter(), Math.min(...boxes.map(r => r.top)) - 7),
    point(Math.max(...boxes.map(r => r.right)) + 7, Math.max(...boxes.map(r => r.bottom)) + 7)];
}
async function mediaPoint() {
  return pe(`(()=>{const r=document.getElementById('preview-stage').getBoundingClientRect();
    const x=r.left+r.width*.5,y=r.top+r.height*.5;
    const target=document.elementFromPoint(x,y);
    if(target?.closest('[data-overlay-id], button, [data-akari-interaction]'))
      throw Error('media point covered by overlay or control');
    return {x,y};})()`);
}
async function nativeDrag(from, to, { modifiers = 0, escape = false } = {}) {
  await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from, button: 'none', modifiers });
  await preview.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1, modifiers });
  await sleep(30);
  for (let i = 1; i <= 8; i++) {
    await preview.send('Input.dispatchMouseEvent', { type: 'mouseMoved',
      x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8,
      button: 'left', buttons: 1, modifiers });
    await sleep(20);
  }
  const marqueeVisible = await pe(`Boolean(document.querySelector('[data-akari-ui="preview-marquee"]'))`);
  if (escape) await keyPress(preview, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers });
  await preview.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', modifiers });
  await sleep(350);
  return { marqueeVisible, preview: await state() };
}
async function cutReady() {
  return waitFor('cut ready for direct manipulation', () => pe(`(()=>{
    const v=document.getElementById('preview-video');
    return Boolean(v && v.dataset.akariCutIndex !== undefined && v.dataset.akariCutIndex !== '');})()`));
}
// Inside the frame but outside the half-size cut and the overlays: a real blank.
// Media clicks are not used here because selecting the cut clears overlays itself.
async function blankPoint(fx = 0.1, fy = 0.2) {
  const at = await pe(`(()=>{const r=document.getElementById('preview-stage').getBoundingClientRect();
    return {x:r.left+r.width*${fx},y:r.top+r.height*${fy}};})()`);
  const hit = await pe(`(()=>{const e=document.elementFromPoint(${at.x},${at.y});
    return {id:e?.id||e?.tagName,covered:Boolean(e?.closest('[data-overlay-id], button, [data-akari-interaction]'))};})()`);
  check(!hit.covered, 'blank point is not an overlay or control', { at, hit });
  return at;
}
async function clickBlankInStage() {
  const at = await blankPoint();
  await realClick(preview, at.x, at.y);
  await sleep(350);
  return at;
}
async function clickAtGutter() {
  const x = await gutter();
  const { stage } = await stageGeometry();
  await realClick(preview, x, Math.max(stage.top + 20, 40));
  await sleep(350);
}
async function setZoom(scale) {
  await pe(`(()=>{const e=document.querySelector('.zoom-preset[data-zoom="${scale}"]');
    if(!e)throw Error('zoom preset missing');e.click();})()`);
  await waitFor(`zoom ${scale}`, () => pe(`document.getElementById('zoom-value').textContent===${S(`${scale * 100}%`)}`));
}

let status = 'FAIL';
try {
  await mkdir(evidence, { recursive: true });
  if (process.argv.includes('--startup-failed')) throw new Error('Electron startup failed');
  const target = await waitFor('Theia target', async () => (await targets()).find(t => t.type === 'page'), 600000);
  main = await connect(target);
  await waitFor('Theia ready', () => me(`Boolean(window.theia?.container && document.readyState==='complete')`), 600000);
  await me(`(()=>{[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ')?.click();})()`);
  await command('akari.annotations.open');
  await waitFor('timeline row', () => me(`Boolean(document.querySelector('[data-akari-tree-row-id="g"]'))`), 600000);
  await attachPreview();
  const mod = process.platform === 'darwin' ? 4 : 2;

  await sample(1, 'pasteboard marquee selects two and mirrors two timeline rows', async () => {
    const [from, to] = await marqueePath(['a', 'b']);
    const gesture = await nativeDrag(from, to);
    check(gesture.marqueeVisible, 'marquee visible during drag', gesture);
    check(gesture.preview.ids.length === 2 && gesture.preview.ids.includes('a') && gesture.preview.ids.includes('b'),
      'two preview siblings selected', gesture);
    const t = await waitFor('two timeline rows', async () => {
      const value = await timeline();
      return value.selected.includes('a') && value.selected.includes('b') && value.selectedRows.includes('a')
        && value.selectedRows.includes('b') && value;
    });
    return { gesture, timeline: t };
  });
  await sample(2, 'Meta G groups the marquee selection', async () => {
    await press('g', mod);
    const group = await waitFor('group saved', async () => allItems(await edit())
      .find(entry => entry.source?.kind === 'group' && entry.items?.some(child => child.id === 'a')
        && entry.items?.some(child => child.id === 'b')));
    check(group.items.length === 2, 'group contains a and b', group);
    await command('akari.timeline.undo');
    await waitFor('group undo', async () => !allItems(await edit()).some(entry => entry.id === group.id));
    await findPreview(); await pe(SEEK);
    return { groupId: group.id };
  });
  await sample(3, 'plain drag over media moves the cut', async () => {
    // Right after the undo the preview re-renders; a drag that lands during it can be
    // dropped by the host. Retry the same gesture and record how many were needed.
    const before = item(await edit(), 'marquee-cut').transform;
    const attempts = [];
    let after = null;
    for (let attempt = 1; attempt <= 3 && !after; attempt++) {
      await cutReady(); await sleep(500);
      const from = await mediaPoint(), to = point(from.x + 24, from.y + 17);
      const gesture = await nativeDrag(from, to);
      check(!gesture.marqueeVisible, 'plain media drag did not open marquee', gesture);
      after = await waitFor('cut transform saved', async () => {
        const transform = item(await edit(), 'marquee-cut')?.transform;
        return transform && (transform.x !== before.x || transform.y !== before.y) && transform;
      }, 8000).catch(() => null);
      attempts.push({ attempt, from, to, marqueeVisible: gesture.marqueeVisible, moved: Boolean(after) });
    }
    check(after, 'cut transform saved', attempts);
    return { before, after, attempts };
  });
  await sample(4, 'Shift drag over media starts marquee without moving cut', async () => {
    const before = item(await edit(), 'marquee-cut').transform;
    const from = await mediaPoint(), a = await bounds('a');
    const gesture = await nativeDrag(from, point(a.left - 7, a.top - 7), { modifiers: 8 });
    check(gesture.marqueeVisible, 'Shift media marquee visible', gesture);
    check(gesture.preview.ids.includes('a'), 'Shift media marquee selected a', gesture);
    check(S(item(await edit(), 'marquee-cut').transform) === S(before), 'Shift drag left cut unchanged');
    return gesture;
  });
  await sample(5, 'at 200 percent plain drag pans and Shift drag marquees', async () => {
    await click('a'); await setZoom(2);
    const zoomTransform = () => pe(`document.getElementById('zoom-layer').style.transform`);
    // Preparation: Alt forces a pan to the top-left clamp so the frame's media-free
    // border (the cut is half size) is on screen.
    const zoomed = await zoomTransform(), g0 = await stageGeometry();
    const center = point((g0.pane.left + g0.pane.right) / 2, (g0.pane.top + g0.pane.bottom) / 2);
    await nativeDrag(center, point(center.x + 600, center.y + 400), { modifiers: 1 });
    const exposed = await zoomTransform(), g1 = await stageGeometry();
    check(exposed !== zoomed && g1.stage.left >= g1.pane.left - 1 && g1.stage.top >= g1.pane.top - 1,
      'Alt preparation panned to the top-left corner', { zoomed, exposed, g1 });
    const from = await blankPoint();
    const cutBefore = item(await edit(), 'marquee-cut').transform;
    const plain = await nativeDrag(from, point(from.x - 30, from.y - 16));
    const transformAfter = await zoomTransform();
    check(!plain.marqueeVisible && transformAfter !== exposed, 'plain blank drag panned', { plain, exposed, transformAfter });
    check(S(plain.preview.ids) === S(['a']), 'panning kept the overlay selection', plain);
    check(S(item(await edit(), 'marquee-cut').transform) === S(cutBefore), 'pan left the cut unchanged');
    const shiftFrom = await mediaPoint();
    const shifted = await nativeDrag(shiftFrom, point(shiftFrom.x - 60, shiftFrom.y - 40), { modifiers: 8 });
    const panUnchanged = await zoomTransform();
    check(shifted.marqueeVisible && panUnchanged === transformAfter, 'Shift drag started marquee at 200 percent without panning',
      { shifted, transformAfter, panUnchanged });
    await setZoom(1);
    return { zoomed, exposed, from, transformAfter, plain, shifted };
  });
  await sample(6, 'Shift marquee adds to an existing sibling', async () => {
    await click('a');
    const b = await bounds('b');
    const gesture = await nativeDrag(point(b.left - 7, b.top - 7), point(b.right + 7, b.bottom + 7), { modifiers: 8 });
    check(gesture.marqueeVisible, 'additive marquee visible', gesture);
    check(S(gesture.preview.ids) === S(['a', 'b']), 'selection order a then b', gesture);
    return gesture;
  });
  await sample(7, 'Escape cancels active marquee', async () => {
    const before = (await state()).ids;
    const [from, to] = await marqueePath(['c']);
    const gesture = await nativeDrag(from, to, { escape: true });
    check(gesture.marqueeVisible && S(gesture.preview.ids) === S(before), 'Escape preserved selection', gesture);
    return gesture;
  });
  await sample(8, 'marquee inside group selects only its direct children', async () => {
    await click('nested', mod);
    check((await state()).scope === 'g', 'entered group scope', await state());
    const [from, to] = await marqueePath(['nested', 'nested2']);
    const gesture = await nativeDrag(from, to);
    check(gesture.marqueeVisible && S(gesture.preview.ids) === S(['nested', 'nested2'])
      && gesture.preview.scope === 'g', 'only group children selected', gesture);
    return gesture;
  });
  await sample(9, 'stationary blank click clears the selection', async () => {
    const before = await state();
    check(before.ids.length > 0, 'selection exists before the blank click', before);
    // The pasteboard outside the stage never released overlays; it still keeps them.
    await clickAtGutter();
    const afterGutter = await state();
    check(S(afterGutter.ids) === S(before.ids), 'pasteboard click kept the selection', { before, afterGutter });
    const at = await clickBlankInStage();
    const previewState = await state();
    check(previewState.ids.length === 0, 'blank click cleared selection', previewState);
    return { before, afterGutter, at, preview: previewState };
  });
  status = 'PASS';
} catch (error) {
  console.error(error.stack ?? error);
} finally {
  await writeFile(path.join(evidence, 'run-log.json'), S({ status, at: new Date().toISOString(), records }) + '\n');
  for (const connection of connections) try { connection.close(); } catch {}
}
if (status !== 'PASS') process.exitCode = 1;
