#!/usr/bin/env node
// Run against a disposable Electron workspace. All tested gestures use CDP input.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, realClick, keyPress, screenshot }
  from '../../../../akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceArg, evidenceArg] = process.argv;
if (!workspaceArg || !evidenceArg) throw new Error('usage: run-l1.mjs <port> <workspace> <evidence>');
const port = Number(portArg || 9762), evidence = path.resolve(evidenceArg);
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
const findItem = (document, id) => {
  const visit = items => { for (const item of items) {
    if (item.id === id) return item;
    const nested = visit(item.items ?? []); if (nested) return nested;
  } };
  return visit(allItems(document));
};
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
async function selectTwo(a = 'a', b = 'b') { await click(a); await click(b, 8); }
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
// macOS uses Theia's native popup (titleBarStyle=native): nothing reaches the DOM and the OS menu is modal.
// Capture the exact template Theia hands to electronTheiaCore.popup (visible items only, with their
// execute callbacks = what a native click runs) and suppress the modal popup. Lumino menus are read from the DOM.
const installPopupProbe = () => me(`(()=>{
  window.__pgcPopups=window.__pgcPopups??[];
  const c=window.theia.container;
  const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype
    &&typeof k.prototype.render==='function'&&typeof k.prototype.setCurrent==='function');
  const r=key&&c.get(key);
  if(!r||typeof r.doRender!=='function')throw Error('ContextMenuRenderer missing');
  if(r.useNativeStyle&&!r.__pgcPopupHooked){
    // electronTheiaCore is frozen (contextBridge); wrap the renderer instead and build the same
    // template its native branch passes to electronTheiaCore.popup.
    r.__pgcPopupHooked=true;
    r.doRender=params=>{
      window.__pgcPopups.push(r.electronMenuFactory.createElectronContextMenu(params.menuPath,params.menu,
        params.contextMatcher,params.args,params.context));
      setTimeout(()=>params.onHide?.(),0);
      return {onDispose:()=>({dispose(){}}),dispose(){}};
    };
  }
  return {native:Boolean(r.useNativeStyle),hooked:Boolean(r.__pgcPopupHooked)};
})()`);
async function rightClick(id) {
  await installPopupProbe();
  const count = await me('window.__pgcPopups.length');
  const { x, y } = await pointFor(id);
  const diag = async () => ({ main: await me(`(()=>({hooked:window.__pgcPopupHooked,popups:window.__pgcPopups.length,
      frozen:Object.isFrozen(window.electronTheiaCore),same:String(window.electronTheiaCore?.popup).slice(0,80),
      renders:window.__pgcRenders??null}))()`),
    previewCtx: await pe(`window.__pgcCtx??null`) });
  await me(`(()=>{const c=window.theia.container;window.__pgcRenders=window.__pgcRenders??[];
    const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype
      &&typeof k.prototype.render==='function'&&typeof k.prototype.setCurrent==='function');
    const r=key&&c.get(key); if(r&&!r.__pgc){r.__pgc=true;const o=r.render.bind(r);
      r.render=p=>{window.__pgcRenders.push(String(p?.menuPath));return o(p);};}
    return Boolean(r);})()`);
  await pe(`(()=>{if(!window.__pgcCtxHooked){window.__pgcCtxHooked=true;window.__pgcCtx=0;
    document.addEventListener('contextmenu',()=>{window.__pgcCtx+=1;},true);}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await preview.send('Input.dispatchMouseEvent', { type, x, y, button: 'right',
      buttons: type === 'mousePressed' ? 2 : 0, clickCount: 1 });
    await sleep(60);
  }
  try { return await rightClickWait(count); } catch (error) { throw new Error(`${error.message} ${S(await diag())}`); }
}
async function rightClickWait(count) {
  return waitFor('Theia context menu', () => me(`(()=>{
    if(window.__pgcPopups.length>${count}){
      const flat=items=>items.flatMap(i=>[i,...flat(i.submenu??[])]);
      return flat(window.__pgcPopups.at(-1)).filter(i=>i.label).map(i=>({text:i.label,native:true}));
    }
    const menu=[...document.querySelectorAll('.p-Menu,.lm-Menu')].find(e=>e.getBoundingClientRect().width>0);
    if(!menu)return null;
    return [...menu.querySelectorAll('.p-Menu-item,.lm-Menu-item')]
      .map(e=>({text:e.querySelector('.p-Menu-itemLabel,.lm-Menu-itemLabel')?.textContent?.trim()}));
  })()`));
}
async function menuSelect(text) {
  const native = await me(`(async()=>{
    const template=window.__pgcPopups?.at(-1);
    if(!template)return null;
    const flat=items=>items.flatMap(i=>[i,...flat(i.submenu??[])]);
    const item=flat(template).find(i=>i.label===${S(text)});
    if(!item||typeof item.execute!=='function')return {found:false};
    window.__pgcPopups.length=0;
    await item.execute(); return {found:true};
  })()`);
  if (native) { check(native.found, `native menu ${text}`, native); await sleep(500); return; }
  const items = await me(`(()=>[...document.querySelectorAll('.p-Menu-item,.lm-Menu-item')]
    .filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();
      return {text:e.querySelector('.p-Menu-itemLabel,.lm-Menu-itemLabel')?.textContent?.trim(),
        x:r.x+r.width/2,y:r.y+r.height/2};}))()`);
  const item = items.find(entry => entry.text === text); check(item, `menu ${text}`, items);
  await realClick(main, item.x, item.y); await sleep(500);
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
  await sample(1, 'back leaf context front and one undo', async () => {
    await click('a');
    const before = await edit();
    const menu = await rightClick('a');
    check(S(menu.map(i => i.text).filter(text => ['最前面へ', '前面へ', '背面へ', '最背面へ'].includes(text)))
      === S(['最前面へ', '前面へ', '背面へ', '最背面へ']), 'z menu order', menu);
    check(menu.some(i => i.text === '最前面へ'), 'front item visible', menu);
    await menuSelect('最前面へ');
    const moved = await waitFor('root moved to front', async () => {
      const d = await edit();
      return d.tracks.at(-1)?.items?.some(i => i.id === 'a') && d;
    });
    check(moved.tracks.findIndex(t => t.items?.some(i => i.id === 'a'))
      > moved.tracks.findIndex(t => t.items?.some(i => i.id === 'b')), 'a above b', moved.tracks);
    // The history entry lands after the file write; undo only once the commit reported back.
    await waitFor('commit settled', async () => (await timeline()).footer.includes('重なり順を変更しました。'));
    await command('akari.timeline.undo');
    await waitFor('one undo restores root order', async () =>
      S((await edit()).tracks) === S(before.tracks));
    return { menu, before: before.tracks.map(t => t.id), moved: moved.tracks.map(t => t.id) };
  });
  await sample(2, 'group child context forward exchanges siblings', async () => {
    await click('nested', mod);
    const selected = await state();
    check(selected.id === 'nested' && selected.scope === 'g', 'nested selected in group scope', selected);
    const menu = await rightClick('nested');
    check(menu.some(i => i.text === '前面へ'), 'forward item visible', menu);
    await menuSelect('前面へ');
    const moved = await waitFor('group children exchanged', async () => {
      const children = findItem(await edit(), 'g')?.items?.map(i => i.id);
      return S(children) === S(['nested2', 'nested']) && children;
    });
    // The history entry lands after the file write; undo only once the commit reported back.
    await waitFor('commit settled', async () => (await timeline()).footer.includes('重なり順を変更しました。'));
    await command('akari.timeline.undo');
    await waitFor('group order restored', async () =>
      S(findItem(await edit(), 'g')?.items?.map(i => i.id)) === S(['nested', 'nested2']));
    return { menu, moved };
  });
  await sample(3, 'timeline child bracket moves within the group', async () => {
    const point = await waitFor('nested timeline row', () => me(`(()=>{
      const e=document.querySelector('[data-akari-tree-row-id="nested"]');
      if(!e)return null;const r=e.getBoundingClientRect();
      return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null;})()`));
    await realClick(main, point.x, point.y);
    await waitFor('nested timeline selection', async () => (await timeline()).single === 'nested');
    // Send the physical key Theia's keyboard layout resolves for ']' (JIS Mac: ']' is not BracketRight).
    const bracket = await me(`(()=>{const c=window.theia.container;
      const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'
        && typeof k.prototype?.getKeybindingsForCommand==='function' && typeof k.prototype?.resolveKeybinding==='function');
      const kb=c.get(key);const b=kb.getKeybindingsForCommand('akari.timeline.moveTrackUp')[0];
      const k=kb.resolveKeybinding(b)[0].key;return {code:k.code,keyCode:k.keyCode};})()`);
    for (const type of ['rawKeyDown', 'char', 'keyUp']) {
      await main.send('Input.dispatchKeyEvent', { type, key: ']', code: bracket.code,
        windowsVirtualKeyCode: bracket.keyCode, ...(type === 'char' ? { text: ']', unmodifiedText: ']' } : {}) });
      await sleep(30);
    }
    const moved = await waitFor('bracket exchanged children', async () => {
      const children = findItem(await edit(), 'g')?.items?.map(i => i.id);
      return S(children) === S(['nested2', 'nested']) && children;
    });
    // The history entry lands after the file write; undo only once the commit reported back.
    await waitFor('commit settled', async () => (await timeline()).footer.includes('クリップを前後へ移動しました。'));
    await command('akari.timeline.undo');
    await waitFor('bracket undo', async () =>
      S(findItem(await edit(), 'g')?.items?.map(i => i.id)) === S(['nested', 'nested2']));
    return { moved };
  });
  await sample(4, 'front edge gives a footer reason without editing', async () => {
    await click('nested2', mod);
    const selected = await state();
    check(selected.id === 'nested2' && selected.scope === 'g', 'nested2 selected in group scope', selected);
    const before = await readFile(editPath, 'utf8');
    const menu = await rightClick('nested2');
    check(menu.some(i => i.text === '前面へ'), 'edge item remains visible', menu);
    await menuSelect('前面へ');
    const value = await waitFor('front edge footer', async () => {
      const t = await timeline(); return t.footer.includes('いちばん前面です') && t;
    });
    check(await readFile(editPath, 'utf8') === before, 'edge leaves edit unchanged');
    return { menu, footer: value.footer };
  });
  await sample(5, 'multi selection hides all z items', async () => {
    await click('a', mod);
    check((await state()).scope === null, 'returned to root scope before multi selection', await state());
    await selectTwo();
    const menu = await rightClick('b');
    check(!menu.some(i => ['最前面へ', '前面へ', '背面へ', '最背面へ'].includes(i.text)),
      'z items hidden for multi selection', menu);
    return { menu, preview: await state() };
  });
  await sample(6, 'bag part hides all z items', async () => {
    const parts = await waitFor('bag parts mounted', () => pe(`(()=>{
      const ids=[...new Set([...document.querySelectorAll('[data-overlay-id]')]
        .map(e=>e.dataset.overlayId))].filter(id=>/^s01(#|\\.)/u.test(id)).sort();
      return ids.length>=1?ids:null;
    })()`));
    await click(parts[0], mod);
    const menu = await rightClick(parts[0]);
    check(!menu.some(i => ['最前面へ', '前面へ', '背面へ', '最背面へ'].includes(i.text)),
      'z items hidden for bag part', menu);
    return { parts, menu, preview: await state() };
  });
  status='PASS';
} catch (error) {
  console.error(error.stack ?? error);
} finally {
  await writeFile(path.join(evidence,'run-log.json'), S({ status, at:new Date().toISOString(), records })+'\n');
  for(const connection of connections)try{connection.close();}catch{}
}
if(status!=='PASS')process.exitCode=1;
