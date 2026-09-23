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
  await sample(1, 'Shift selection mirrors two timeline rows', async () => {
    await selectTwo();
    const t = await waitFor('two selected rows', async () => {
      const value = await timeline(); return value.selected.includes('a') && value.selected.includes('b') && value;
    });
    check(t.selectedRows.includes('a') && t.selectedRows.includes('b'), 'selected row classes', t);
    return { timeline: t, preview: await state() };
  });
  await sample(2, 'Meta G creates one group and one undo restores both leaves', async () => {
    const before = await edit(); await press('g', mod);
    const grouped = await waitFor('group saved', async () => {
      const d = await edit(); return allItems(d).find(i=>i.source?.kind==='group'&&i.items?.some(c=>c.id==='a')
        &&i.items?.some(c=>c.id==='b')) ? d : null;
    });
    const created = allItems(grouped).find(i=>i.source?.kind==='group'&&i.items?.some(c=>c.id==='a'));
    check(created.items.length === 2, 'group has two children', created);
    await command('akari.timeline.undo');
    await waitFor('single undo restores leaves', async () => {
      const d = await edit(); return findItem(d,'a') && findItem(d,'b')
        && !allItems(d).some(i=>i.id===created.id) && d;
    });
    check(allItems(before).length === allItems(await edit()).length, 'one undo restores root count');
    return { groupId: created.id };
  });
  await sample(3, 'Meta Shift G ungroups without opening SCM', async () => {
    await selectTwo(); await press('g', mod);
    const grouped = await waitFor('group re-created', async () => {
      const d=await edit(); return allItems(d).find(i=>i.source?.kind==='group'&&i.items?.some(c=>c.id==='a'));
    });
    // Record how the competing ⌘⇧G bindings are ordered (Theia resolves the first enabled match in keymap order).
    const scmProbe = await me(`(()=>{const c=window.theia.container;
      const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype
        &&typeof k.prototype.getKeybindingsForCommand==='function'&&typeof k.prototype.registerKeybinding==='function');
      const r=c.get(key);const map=r.keymaps[0];
      const at=id=>map.findIndex(b=>b.command===id);
      return {akariUngroupIndex:at('akari.timeline.ungroup'),scmToggleIndex:at('scmView:toggle'),
        akari:r.getKeybindingsForCommand('akari.timeline.ungroup').map(b=>b.keybinding),
        scm:r.getKeybindingsForCommand('scmView:toggle').map(b=>b.keybinding)};})()`);
    check(scmProbe.akariUngroupIndex >= 0 && scmProbe.scmToggleIndex > scmProbe.akariUngroupIndex,
      'akari ungroup binding precedes the SCM toggle binding', scmProbe);
    check(!(await timeline()).scmOpen, 'SCM closed before shortcut', scmProbe);
    await click('a');
    // The preview keeps the drill-in scope inside the new group, so a plain click selects leaf a.
    // Shift+Enter climbs to the group and notifies the timeline (Escape climbs silently by design).
    if ((await state()).id !== grouped.id) await press('Enter', 8);
    await waitFor('group selected in timeline', async () => (await timeline()).single===grouped.id);
    const scmBefore=(await timeline()).scmOpen;
    await press('g', mod | 8);
    await waitFor('ungroup saved', async () => !allItems(await edit()).some(i=>i.id===grouped.id));
    check((await timeline()).scmOpen===scmBefore, 'SCM stayed closed');
    return { groupId: grouped.id, scmProbe, scmBefore, scmAfter:(await timeline()).scmOpen };
  });
  await sample(4, 'nested sibling Delete removes both and one undo restores them', async () => {
    await click('nested', mod); await click('nested2', 8 | mod);
    await waitFor('nested rows selected', async () => (await timeline()).selected.length===2);
    await press('Delete');
    await waitFor('nested children deleted', async () => {
      const d=await edit(); return !findItem(d,'nested')&&!findItem(d,'nested2');
    });
    await command('akari.timeline.undo');
    await waitFor('nested undo', async () => findItem(await edit(),'nested')&&findItem(await edit(),'nested2'));
    return { children:findItem(await edit(),'g').items.map(i=>i.id) };
  });
  await sample(5, 'context menu groups two, and hides group for one', async () => {
    await selectTwo(); const menu = await rightClick('b');
    check(menu.some(i=>i.text==='まとめる'), 'group menu visible', menu);
    await menuSelect('まとめる');
    const grouped=await waitFor('context group saved', async () =>
      allItems(await edit()).find(i=>i.source?.kind==='group'&&i.items?.some(c=>c.id==='a')));
    await command('akari.timeline.undo'); await waitFor('context group undo', async () => !allItems(await edit()).some(i=>i.id===grouped.id));
    await click('a'); const singleMenu=await rightClick('a');
    check(!singleMenu.some(i=>i.text==='まとめる'), 'single hides group', singleMenu);
    return { menu, singleMenu };
  });
  await sample(6, 'bag parts refuse grouping without changing edit', async () => {
    // The scanned bag s01 is mounted as its parts (s01#A and the explicit s01.B); select them with deep (⌘) clicks.
    const parts=await waitFor('bag parts mounted', () => pe(`(()=>{
      const ids=[...new Set([...document.querySelectorAll('[data-overlay-id]')]
        .map(e=>e.dataset.overlayId))].filter(id=>/^s01(#|\\.)/u.test(id)).sort();
      return ids.length>=2?ids:null;
    })()`));
    await click(parts[0], mod); await click(parts[1], 8 | mod);
    const partState=await state();
    check(partState.scope==='s01' && partState.ids.length===2, 'two bag parts selected in bag scope', partState);
    const bagTimeline=await timeline();
    check(bagTimeline.selected.length<2, 'bag-scope set is not mirrored as a timeline multi-selection', bagTimeline);
    const before=await readFile(editPath,'utf8'); await press('g',mod);
    const t=await timeline(); check(t.footer.includes('袋の中の部品はまとめられません'), 'bag notice', t);
    check(await readFile(editPath,'utf8')===before, 'bag edit unchanged');
    await setFooterSentinel('__l1_right_click_pending__');
    const menu=await rightClick(parts[1]);
    check(!menu.some(item=>item.text==='まとめる'), 'bag hides group menu', menu);
    const rightClickTimeline=await waitFor('bag right-click notice', async()=>{
      const value=await timeline(); return value.footer.includes('袋の中の部品はまとめられません')&&value;
    });
    check(await readFile(editPath,'utf8')===before, 'bag right-click edit unchanged');
    return { parts, timeline:t, menu, rightClickTimeline };
  });
  await sample(7, 'one selected item reports the group minimum', async () => {
    await click('a',mod); await press('g',mod);
    const t=await timeline(); check(t.footer.includes('まとめるには 2 つ以上選んでください'), 'one item notice', t);
    return t;
  });
  await sample(8, 'editing text isolates Meta G from the timeline', async () => {
    await click('a',0,2);
    check((await state()).editing, 'preview entered text edit');
    const before=await readFile(editPath,'utf8');
    const sentinel='__l1_editing_shortcut_pending__';
    await setFooterSentinel(sentinel);
    await press('g',mod);
    check((await timeline()).footer===sentinel, 'editing shortcut did not reach timeline');
    check(await readFile(editPath,'utf8')===before, 'editing shortcut did not mutate edit');
    await press('Escape'); return { timeline:await timeline(), preview:await state() };
  });
  status='PASS';
} catch (error) {
  console.error(error.stack ?? error);
} finally {
  await writeFile(path.join(evidence,'run-log.json'), S({ status, at:new Date().toISOString(), records })+'\n');
  for(const connection of connections)try{connection.close();}catch{}
}
if(status!=='PASS')process.exitCode=1;
