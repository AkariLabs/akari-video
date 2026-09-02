#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, keyPress, listTargets, realClick, realDrag, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE = path.join(ROOT, 'fixture');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 21962);
const S = value => JSON.stringify(value);
const out = { status: 'running', steps: [], screenshots: [] };

const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<worktree>')
  .replace(/\/Users\/[^\s)]+/g, '<machine-path>');
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(out, null, 2)}\n`);
  await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const run = (command, args, { cwd = ROOT, timeoutMs = 120_000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, timeoutMs);
  child.once('error', reject);
  child.once('close', code => {
    closed = true; clearTimeout(timer);
    code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`));
  });
});

async function step(name, operation) {
  const record = { name, pass: false };
  out.steps.push(record);
  try {
    record.detail = await operation();
    record.pass = true;
    await save();
    return record.detail;
  } catch (error) {
    record.error = sanitize(error);
    await save();
    throw error;
  }
}

async function waitEval(cdp, expression, { timeoutMs = 120_000, intervalMs = 200, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await evalOn(cdp, expression);
      if (value) return value;
    } catch (error) { last = error; }
    await sleep(intervalMs);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}

async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 120_000;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
    if (!state.exists) return 'removed';
    if (state.hidden) {
      hiddenSince ??= Date.now();
      if (Date.now() - hiddenSince >= 20_000) {
        const neutralized = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(!el||!el.classList.contains('theia-hidden'))return false;el.style.pointerEvents='none';return true})()`);
        if (neutralized) return 'neutralized';
      }
    } else {
      hiddenSince = null;
    }
    await sleep(200);
  }
  throw new Error('theia preload overlay did not settle');
}

async function launch(project, port, runName) {
  const iso = path.join(ROOT, 'runs', runName);
  const log = path.join(ROOT, 'runs', `${runName}.log`);
  const launched = await run('/bin/zsh', [
    path.join(ROOT, 'scripts', 'launch-shell.sh'), project, String(port), iso, log
  ], { timeoutMs: 20_000 });
  const pid = Number(launched.stdout.trim().split(/\s+/).at(-1));
  assert(Number.isInteger(pid) && pid > 0, 'Electron PID was not reported');
  let target;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline && !target) {
    try { target = (await listTargets(port)).find(item => item.type === 'page'); } catch {}
    if (!target) await sleep(300);
  }
  assert(target, 'CDP page target did not appear');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, {
    label: 'Theia workbench'
  });
  return { pid, cdp };
}

async function stop(session) {
  session?.cdp?.close();
  if (session?.pid) {
    try { process.kill(session.pid, 'SIGTERM'); } catch {}
    await sleep(1800);
  }
}

const command = id => `(async()=>{
  const d=window.theia.container._bindingDictionary;
  const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
  if(!C)throw new Error('CommandService binding unavailable');
  const r=await window.theia.container.get(C).executeCommand(${S(id)});
  return r!==null&&typeof r==='object'?'[object]':r??null;
})()`;
const commandWith = (id, request) => `(async()=>{
  const d=window.theia.container._bindingDictionary;
  const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
  if(!C)throw new Error('CommandService binding unavailable');
  const r=await window.theia.container.get(C).executeCommand(${S(id)},${S(request)});
  return r!==null&&typeof r==='object'?'[object]':r??null;
})()`;

async function shot(cdp, file) {
  await screenshot(cdp, path.join(ROOT, file));
  out.screenshots.push(file);
  await save();
}

async function rowPoint(cdp, id, selector = '') {
  await evalOn(cdp, `(()=>{const rows=document.querySelector('.akari-daihon-rows');rows.style.scrollBehavior='auto';const row=document.querySelector('[data-caption-id=${S(id)}]');row.scrollIntoView({block:'center'});return true})()`);
  await sleep(180);
  const point = await evalOn(cdp, `(()=>{const row=document.querySelector('[data-caption-id=${S(id)}]');const e=${selector ? `row.querySelector(${S(selector)})` : 'row'};const r=e.getBoundingClientRect();return{x:${selector ? 'r.left+r.width/2' : 'r.left+5'},y:r.top+r.height/2}})()`);
  await waitEval(cdp, `(()=>{const e=document.elementFromPoint(${point.x},${point.y});return e&&e.closest&&e.closest('[data-caption-id=${S(id)}]')?true:null})()`, {
    label: `${id} hit test`
  });
  return point;
}

async function rowRangePoints(cdp, firstId, lastId, centerId) {
  await evalOn(cdp, `(()=>{const rows=document.querySelector('.akari-daihon-rows');rows.style.scrollBehavior='auto';document.querySelector('[data-caption-id=${S(centerId)}]').scrollIntoView({block:'center'});return true})()`);
  await sleep(180);
  return evalOn(cdp, `(()=>{const point=id=>{const r=document.querySelector('[data-caption-id="'+id+'"]').getBoundingClientRect();return{x:r.left+5,y:r.top+r.height/2}};return{first:point(${S(firstId)}),last:point(${S(lastId)})}})()`);
}

async function clickRow(cdp, id, modifiers = 0) {
  const point = await rowPoint(cdp, id);
  await realClick(cdp, point.x, point.y, { modifiers });
}

async function selectionState(cdp) {
  return evalOn(cdp, `(()=>{const bar=document.querySelector('.akari-daihon-selbar');return{
    ids:[...document.querySelectorAll('.akari-daihon-row.selected')].map(row=>row.dataset.captionId),
    hidden:bar.hidden,
    text:document.querySelector('.akari-daihon-selcount')?.textContent??''
  }})()`);
}

await mkdir(path.join(ROOT, 'runs'), { recursive: true });
await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')], { timeoutMs: 180_000 });
const editUri = pathToFileURL(path.join(FIXTURE, 'edit.json')).href;
let session;

try {
  session = await launch(FIXTURE, PORT, 'main');
  await evalOn(session.cdp, command('akari.daihon.open'));
  await waitEval(session.cdp, `document.querySelectorAll('.akari-daihon-row').length===200`, { label: '200 daihon rows' });

  await step('1. initial selection and QC state', async () => {
    const state = await evalOn(session.cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];const badges=Object.fromEntries(rows.filter(row=>row.querySelector('.akari-daihon-badge-qc')).map(row=>[row.dataset.captionId,[...row.querySelectorAll('.akari-daihon-badge-qc')].map(badge=>badge.textContent)]));return{
      selectionBarHidden:document.querySelector('.akari-daihon-selbar').hidden,
      qc:document.querySelector('.akari-daihon-qc').textContent,
      badges,
      badgeRowCount:Object.keys(badges).length
    }})()`);
    const expected = {
      'c-0010': ['⚡ 速い 30.0 字/秒'],
      'c-0020': ['表示 0.6 秒未満'],
      'c-0030': ['カラオケ不整合'],
      'c-0040': ['カラオケなし']
    };
    assert(state.selectionBarHidden, 'selection bar was visible on startup');
    assert(state.qc === 'QC ⚠ 4', `unexpected QC summary: ${state.qc}`);
    assert(state.badgeRowCount === 4 && JSON.stringify(state.badges) === JSON.stringify(expected), `unexpected QC badges: ${JSON.stringify(state.badges)}`);
    return state;
  });
  await shot(session.cdp, '01-initial-qc.png');

  await step('2. click, Shift, Command toggle, and Escape selection', async () => {
    const preloadOverlay = await settlePreloadOverlay(session.cdp);
    const transitions = [];
    await clickRow(session.cdp, 'c-0005');
    transitions.push(await selectionState(session.cdp));
    assert(transitions.at(-1).ids.length === 1 && transitions.at(-1).hidden === false, 'single click did not select one row');
    assert(transitions.at(-1).text === '1 行選択（Shift=範囲 / ⌘=追加 / ドラッグ=まとめて）', 'selection bar copy differed');

    await clickRow(session.cdp, 'c-0012', 8);
    transitions.push(await selectionState(session.cdp));
    assert(transitions.at(-1).ids.length === 8, 'Shift click did not select rows 5 through 12');

    await clickRow(session.cdp, 'c-0020', 4);
    transitions.push(await selectionState(session.cdp));
    assert(transitions.at(-1).ids.length === 9 && transitions.at(-1).ids.includes('c-0020'), 'Command click did not add row 20');

    await clickRow(session.cdp, 'c-0020', 4);
    transitions.push(await selectionState(session.cdp));
    assert(transitions.at(-1).ids.length === 8 && !transitions.at(-1).ids.includes('c-0020'), 'second Command click did not remove row 20');

    await keyPress(session.cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    transitions.push(await selectionState(session.cdp));
    assert(transitions.at(-1).ids.length === 0 && transitions.at(-1).hidden, 'Escape did not clear selection');
    return { preloadOverlay, transitions };
  });
  await shot(session.cdp, '02-click-selection.png');

  await step('3. vertical drag selects a range and consumes the click', async () => {
    await evalOn(session.cdp, `(()=>{
      window.__daihonClicksAfterDrag=0;
      window.__daihonDragClickAbort?.abort();
      window.__daihonDragClickAbort=new AbortController();
      document.querySelector('.akari-daihon-rows').addEventListener('click',()=>window.__daihonClicksAfterDrag++,{
        capture:true,signal:window.__daihonDragClickAbort.signal
      });
      return true;
    })()`);
    const points = await rowRangePoints(session.cdp, 'c-0030', 'c-0036', 'c-0033');
    await realDrag(session.cdp, [points.first, points.last], { steps: 12, stepDelayMs: 18 });
    const state = await selectionState(session.cdp);
    const clickEventsDispatched = await evalOn(session.cdp, `(()=>{const count=window.__daihonClicksAfterDrag;window.__daihonDragClickAbort.abort();return count})()`);
    const expected = Array.from({ length: 7 }, (_, index) => `c-${String(index + 30).padStart(4, '0')}`);
    assert(clickEventsDispatched >= 1, 'drag did not dispatch a click event');
    assert(JSON.stringify(state.ids) === JSON.stringify(expected), `drag selection differed: ${state.ids.join(',')}`);
    assert(state.text.startsWith('7 行選択'), 'drag selection count differed');
    return { ...state, clickEventsDispatched, clickConsumed: clickEventsDispatched >= 1 && state.ids.length === 7 };
  });
  await shot(session.cdp, '03-drag-selection.png');

  await step('4. QC chip filters to four issue rows and restores all rows', async () => {
    const chip = await evalOn(session.cdp, `(()=>{const r=document.querySelector('.akari-daihon-qc').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await realClick(session.cdp, chip.x, chip.y);
    const filtered = await waitEval(session.cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];const visible=rows.filter(row=>!row.classList.contains('qc-hidden'));return visible.length===4?{
      visibleIds:visible.map(row=>row.dataset.captionId),hidden:rows.filter(row=>row.classList.contains('qc-hidden')).length,count:document.querySelector('.akari-daihon-count').textContent
    }:null})()`, { label: 'four QC rows' });
    assert(filtered.count === '4 / 200 行' && filtered.hidden === 196, 'QC filtered count differed');
    assert(JSON.stringify(filtered.visibleIds) === JSON.stringify(['c-0010', 'c-0020', 'c-0030', 'c-0040']), 'QC filter showed unexpected rows');
    await realClick(session.cdp, chip.x, chip.y);
    const restored = await waitEval(session.cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];return rows.every(row=>!row.classList.contains('qc-hidden'))?{visible:rows.length,count:document.querySelector('.akari-daihon-count').textContent}:null})()`, { label: 'all rows restored' });
    assert(restored.visible === 200 && restored.count === '200 行', 'QC filter did not restore all rows');
    return { filtered, restored };
  });
  await shot(session.cdp, '04-qc-filter.png');

  await step('5. playback keeps DOM references and selection through 100 ticks', async () => {
    await clickRow(session.cdp, 'c-0005');
    await clickRow(session.cdp, 'c-0012', 8);
    await evalOn(session.cdp, `(()=>{
      window.__daihonEvents=[];
      window.__daihonAbort?.abort();
      window.__daihonAbort=new AbortController();
      window.addEventListener('akari.preview.playbackTick',event=>window.__daihonEvents.push(event.detail),{signal:window.__daihonAbort.signal});
      return true;
    })()`);
    await evalOn(session.cdp, commandWith('akari.preview.ensureVisible', { editUri }));
    await waitEval(session.cdp, `window.__daihonEvents.length>=1`, { timeoutMs: 60_000, label: 'preview alive' });
    await evalOn(session.cdp, `(()=>{
      window.__daihonEvents=[];
      window.__akariDaihonTickMetrics={count:0,totalMs:0,maxMs:0,averageMs:0};
      window.__daihonRefs=new Map([...document.querySelectorAll('.akari-daihon-row')].map(row=>[row.dataset.captionId,row]));
      return true;
    })()`);
    let playbackAttempts = 0;
    let playbackStarted = false;
    while (playbackAttempts < 3 && !playbackStarted) {
      playbackAttempts++;
      const beforeAttempt = await evalOn(session.cdp, `window.__daihonEvents.length`);
      await evalOn(session.cdp, commandWith('akari.preview.togglePlayback', { editUri }));
      try {
        await waitEval(session.cdp, `window.__daihonEvents.length>=${beforeAttempt + 10}`, {
          timeoutMs: 8_000, label: `playback attempt ${playbackAttempts}`
        });
        playbackStarted = true;
      } catch (error) {
        if (playbackAttempts === 3) throw error;
      }
    }
    await waitEval(session.cdp, `window.__daihonEvents.length>=100`, { timeoutMs: 60_000, label: '100 playback ticks' });
    await evalOn(session.cdp, commandWith('akari.preview.togglePlayback', { editUri }));
    const measured = await evalOn(session.cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];const selected=rows.filter(row=>row.classList.contains('selected')).map(row=>row.dataset.captionId);return{
      ticks:window.__daihonEvents.length,
      metrics:window.__akariDaihonTickMetrics,
      referencesStable:rows.length===200&&rows.every(row=>window.__daihonRefs.get(row.dataset.captionId)===row),
      selected
    }})()`);
    assert(measured.referencesStable, 'row references changed during playback ticks');
    assert(measured.selected.length === 8 && measured.selected[0] === 'c-0005' && measured.selected.at(-1) === 'c-0012', 'selection changed during playback');
    assert(measured.metrics.averageMs < 2, `tick handler average was ${measured.metrics.averageMs}ms`);
    return { playbackAttempts, ...measured };
  });
  await shot(session.cdp, '05-playback-selection.png');

  await step('6. editing row 10 clears its QC issue without replacing other rows', async () => {
    await evalOn(session.cdp, `(()=>{window.__editRefs=new Map([...document.querySelectorAll('.akari-daihon-row')].map(row=>[row.dataset.captionId,row]));return true})()`);
    const point = await rowPoint(session.cdp, 'c-0010', '.akari-daihon-row-text');
    await realClick(session.cdp, point.x, point.y, { clickCount: 2 });
    await waitEval(session.cdp, `document.querySelector('[data-caption-id="c-0010"] input')`, { label: 'row 10 edit input' });
    await evalOn(session.cdp, `(()=>{const input=document.querySelector('[data-caption-id="c-0010"] input');input.value='台本短字幕';input.focus();return true})()`);
    await keyPress(session.cdp, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    const dom = await waitEval(session.cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];const target=document.querySelector('[data-caption-id="c-0010"]');const selected=rows.filter(row=>row.classList.contains('selected')).map(row=>row.dataset.captionId);const unchanged=rows.filter(row=>row.dataset.captionId!=='c-0010'&&window.__editRefs.get(row.dataset.captionId)===row).length;return document.querySelector('.akari-daihon-qc').textContent==='QC ⚠ 3'&&!target.querySelector('.akari-daihon-badge-qc')?{
      qc:document.querySelector('.akari-daihon-qc').textContent,
      selected,
      row10Selected:target.classList.contains('selected'),
      row10Replaced:window.__editRefs.get('c-0010')!==target,
      unchanged
    }:null})()`, { timeoutMs: 30_000, label: 'row 10 QC removal' });
    const captions = JSON.parse(await readFile(path.join(FIXTURE, 'captions.json'), 'utf8'));
    const edited = captions.find(caption => caption.id === 'c-0010');
    assert(edited?.text === '台本短字幕' && edited.edited === true, 'row 10 edit was not saved');
    assert(dom.selected.length === 8 && dom.row10Selected, 'selection was not preserved after edit');
    assert(dom.row10Replaced && dom.unchanged === 199, 'DOM reconciliation replaced unaffected rows');
    return { ...dom, edited: { id: edited.id, text: edited.text, edited: edited.edited } };
  });
  await shot(session.cdp, '06-edit-clears-qc.png');
  out.status = 'pass';
} catch (error) {
  out.status = 'fail';
  out.error = sanitize(error);
  process.exitCode = 1;
} finally {
  await stop(session);
  out.pass = out.status === 'pass' && out.steps.length === 6 && out.steps.every(item => item.pass);
  await save();
}
