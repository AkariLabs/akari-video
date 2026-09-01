#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE = path.join(ROOT, 'fixture');
const EMPTY = path.join(ROOT, 'empty-workspace');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 21961);
const S = value => JSON.stringify(value);
const EXPECTED_TAIL = [
  'akari-partner-onboarding',
  'akari-review-panel-widget',
  'akari-daihon-widget',
  'akari-inspector-widget'
];
const EXPECTED_AUTOMATIC_TAIL = EXPECTED_TAIL.slice(0, 3);
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

async function clickAt(cdp, x, y, clicks = 1) {
  for (let index = 1; index <= clicks; index++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: index
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: index
    });
    if (index < clicks) await sleep(40);
  }
}

async function launch(project, port, runName, keep = false) {
  const iso = path.join(ROOT, 'runs', runName);
  const log = path.join(ROOT, 'runs', `${runName}.log`);
  const launched = await run('/bin/zsh', [
    path.join(ROOT, 'scripts', 'launch-shell.sh'), project, String(port), iso, log, ...(keep ? ['keep'] : [])
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

const tabOrderExpression = `(()=>{
  const d=window.theia.container._bindingDictionary;
  for(const arr of d._map.values())for(const binding of arr){const value=binding.cache;
    if(value&&typeof value==='object'&&value.rightPanelHandler&&value.rightPanelHandler.tabBar){
      return{source:'tabBar.titles',ids:[...value.rightPanelHandler.tabBar.titles].map(t=>t.owner.id)};
    }
  }
  return null;
})()`;

async function fixedOrder(cdp) {
  return waitEval(cdp, `(()=>{const value=${tabOrderExpression};return value&&${S(EXPECTED_TAIL)}.every(id=>value.ids.includes(id))?value:null})()`, {
    timeoutMs: 60_000, label: 'fixed right-panel tabs'
  });
}

async function automaticOrder(cdp) {
  return waitEval(cdp, `(()=>{const value=${tabOrderExpression};return value&&${S(EXPECTED_AUTOMATIC_TAIL)}.every(id=>value.ids.includes(id))?value:null})()`, {
    timeoutMs: 60_000, label: 'automatic right-panel tabs'
  });
}

async function shot(cdp, file) {
  await screenshot(cdp, path.join(ROOT, file));
  out.screenshots.push(file);
  await save();
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(Math.floor(rest)).padStart(2, '0')}.${String(Math.floor((rest % 1) * 100)).padStart(2, '0')}`;
}

function captionRecords(value) { return Array.isArray(value) ? value : value.captions; }

await mkdir(path.join(ROOT, 'runs'), { recursive: true });
await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')]);
const captionsBefore = captionRecords(JSON.parse(await readFile(path.join(FIXTURE, 'captions.json'), 'utf8')));
const editUri = pathToFileURL(path.join(FIXTURE, 'edit.json')).href;
let session;

try {
  session = await launch(FIXTURE, PORT, 'main');
  await evalOn(session.cdp, commandWith('akari.inspector.open', { attachOnly: true }));
  const firstOrder = await fixedOrder(session.cdp);
  await stop(session);
  session = await launch(FIXTURE, PORT, 'main', true);

  await step('1. right dock order survives restart', async () => {
    const automatic = await automaticOrder(session.cdp);
    const automaticTail = automatic.ids.slice(-EXPECTED_AUTOMATIC_TAIL.length);
    assert(JSON.stringify(automaticTail) === JSON.stringify(EXPECTED_AUTOMATIC_TAIL), `unexpected automatic tail: ${automaticTail.join(',')}`);
    await evalOn(session.cdp, commandWith('akari.inspector.open', { attachOnly: true }));
    const secondOrder = await fixedOrder(session.cdp);
    const tail = secondOrder.ids.slice(-EXPECTED_TAIL.length);
    assert(JSON.stringify(tail) === JSON.stringify(EXPECTED_TAIL), `unexpected fixed tail: ${tail.join(',')}`);
    assert(JSON.stringify(firstOrder.ids.slice(-EXPECTED_TAIL.length)) === JSON.stringify(EXPECTED_TAIL), 'first boot fixed tail differed');
    return { first: firstOrder, automatic, second: secondOrder };
  });
  await shot(session.cdp, '01-right-dock-order.png');

  await step('2. 500 rows render with fixture text and cut styling', async () => {
    await evalOn(session.cdp, command('akari.daihon.open'));
    const state = await waitEval(session.cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];if(rows.length!==500)return null;return{
      count:rows.length,
      first:rows.slice(0,3).map(row=>({id:row.dataset.captionId,time:row.querySelector('.akari-daihon-tc')?.textContent,text:row.querySelector('.akari-daihon-row-text')?.textContent?.replace('/','')})),
      cutIds:rows.filter(row=>row.classList.contains('iscut')).map(row=>row.dataset.captionId)
    }})()`, { label: '500 daihon rows' });
    const expected = captionsBefore.slice(0, 3).map(caption => ({
      id: caption.id, time: `${formatTime(caption.start)} – ${formatTime(caption.end)}`, text: caption.text
    }));
    assert(JSON.stringify(state.first) === JSON.stringify(expected), 'first rows did not match fixture');
    assert(state.cutIds.includes('c-0100') && state.cutIds.includes('c-0110'), 'cut rows were not styled');
    return state;
  });
  await shot(session.cdp, '02-five-hundred-rows.png');

  await step('3. playback follows rows without replacing DOM', async () => {
    await evalOn(session.cdp, commandWith('akari.preview.ensureVisible', { editUri }));
    await evalOn(session.cdp, `(()=>{
      window.__daihonEvents=[];
      window.__akariDaihonTickMetrics={count:0,totalMs:0,maxMs:0,averageMs:0};
      window.__daihonRefs=new Map([...document.querySelectorAll('.akari-daihon-row')].map((row,index)=>{row.dataset.evidenceRef=String(index);return[row.dataset.captionId,row]}));
      window.addEventListener('akari.preview.playbackTick',event=>window.__daihonEvents.push(event.detail),{signal:(window.__daihonAbort=new AbortController()).signal});
      return true;
    })()`);
    const before = await evalOn(session.cdp, `document.querySelector('.akari-daihon-row.active')?.dataset.captionId??null`);
    await evalOn(session.cdp, commandWith('akari.preview.togglePlayback', { editUri }));
    await sleep(3200);
    const afterThreeSeconds = await evalOn(session.cdp, `({row:document.querySelector('.akari-daihon-row.active')?.dataset.captionId??null,word:document.querySelector('.akari-daihon-word.now')?.dataset.wordIndex??null,ticks:window.__daihonEvents.length})`);
    assert(afterThreeSeconds.row && afterThreeSeconds.row !== before, 'current row did not advance after playback');
    await waitEval(session.cdp, `window.__daihonEvents.length>=100`, { timeoutMs: 60_000, label: '100 playback ticks' });
    await evalOn(session.cdp, commandWith('akari.preview.togglePlayback', { editUri }));
    const measured = await evalOn(session.cdp, `(()=>{
      const rows=[...document.querySelectorAll('.akari-daihon-row')];
      return{ticks:window.__daihonEvents.length,metrics:window.__akariDaihonTickMetrics,
        referencesStable:rows.length===500&&rows.every(row=>window.__daihonRefs.get(row.dataset.captionId)===row&&row.dataset.evidenceRef!==undefined),
        currentRow:document.querySelector('.akari-daihon-row.active')?.dataset.captionId??null,
        currentWord:document.querySelector('.akari-daihon-word.now')?.dataset.wordIndex??null};
    })()`);
    assert(measured.referencesStable, 'row references changed during playback ticks');
    assert(measured.metrics.averageMs < 2, `tick handler average was ${measured.metrics.averageMs}ms`);
    return { before, afterThreeSeconds, ...measured };
  });
  await shot(session.cdp, '03-playback-follow.png');

  await step('4. row 300 seeks to its output position', async () => {
    await waitEval(session.cdp, `!document.querySelector('.theia-preload')`, { label: 'theia preload overlay' });
    await evalOn(session.cdp, `(()=>{document.querySelector('.akari-daihon-rows').style.scrollBehavior='auto';document.querySelector('[data-caption-id="c-0300"]').scrollIntoView({block:'center'});return true})()`);
    await sleep(300);
    const point = await evalOn(session.cdp, `(()=>{const e=document.querySelector('[data-caption-id="c-0300"] .akari-daihon-tc');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await waitEval(session.cdp, `(()=>{const e=document.elementFromPoint(${point.x},${point.y});return e&&e.closest&&e.closest('[data-caption-id="c-0300"]')?true:null})()`, { label: 'row 300 hit test' });
    const priorCount = await evalOn(session.cdp, 'window.__daihonEvents.length');
    await clickAt(session.cdp, point.x, point.y);
    await waitEval(session.cdp, `window.__daihonEvents.length>${priorCount}`, { timeoutMs: 20_000, label: 'seek playback tick' });
    await sleep(1000);
    const tick = await evalOn(session.cdp, 'window.__daihonEvents.at(-1)');
    const sourceStart = captionsBefore[299].start;
    const cutStart = captionsBefore[99].start;
    const cutEnd = captionsBefore[109].end;
    const expected = cutStart / 0.1 + (sourceStart - cutEnd) / 0.1;
    const delta = Math.abs(tick.time - expected);
    assert(delta <= 0.1, `seek delta ${delta}s exceeded tolerance`);
    return { targetId: 'c-0300', expected, observed: tick.time, delta };
  });
  await shot(session.cdp, '04-seek-row-300.png');

  await step('5. edit preserves other word times and 499 DOM nodes', async () => {
    const before = captionsBefore[4];
    await waitEval(session.cdp, `!document.querySelector('.theia-preload')`, { label: 'theia preload overlay' });
    await evalOn(session.cdp, `(()=>{window.__editRefs=new Map([...document.querySelectorAll('.akari-daihon-row')].map(row=>[row.dataset.captionId,row]));document.querySelector('.akari-daihon-rows').style.scrollBehavior='auto';document.querySelector('[data-caption-id="c-0005"]').scrollIntoView({block:'center'});return true})()`);
    await sleep(300);
    const point = await evalOn(session.cdp, `(()=>{const e=document.querySelector('[data-caption-id="c-0005"] .akari-daihon-row-text');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await waitEval(session.cdp, `(()=>{const e=document.elementFromPoint(${point.x},${point.y});return e&&e.closest&&e.closest('[data-caption-id="c-0005"]')?true:null})()`, { label: 'row 5 hit test' });
    await clickAt(session.cdp, point.x, point.y, 2);
    await waitEval(session.cdp, `document.querySelector('[data-caption-id="c-0005"] input')`, { label: 'row edit input' });
    await evalOn(session.cdp, `(()=>{const input=document.querySelector('[data-caption-id="c-0005"] input');input.value='台本変更字幕';input.focus();return true})()`);
    await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await session.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    let updated;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      updated = captionRecords(JSON.parse(await readFile(path.join(FIXTURE, 'captions.json'), 'utf8')))[4];
      if (updated.edited === true && updated.text === '台本変更字幕') break;
      await sleep(200);
    }
    assert(updated?.edited === true && updated.text === '台本変更字幕', 'caption edit was not saved');
    assert(JSON.stringify(updated.words[0]) === JSON.stringify(before.words[0]), 'first word timing changed');
    assert(JSON.stringify(updated.words.at(-1)) === JSON.stringify(before.words.at(-1)), 'last word timing changed');
    const dom = await waitEval(session.cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];const target=rows.find(row=>row.dataset.captionId==='c-0005');const unchanged=rows.filter(row=>row.dataset.captionId!=='c-0005').filter(row=>window.__editRefs.get(row.dataset.captionId)===row).length;const footer=document.querySelector('.akari-daihon-footer')?.textContent;return target.textContent.includes('変更')&&footer==='字幕を更新しました。'?{unchanged,targetReplaced:window.__editRefs.get('c-0005')!==target,footer}:null})()`, { label: 'edited row refresh' });
    assert(dom.unchanged === 499 && dom.targetReplaced, 'DOM reconciliation replaced unaffected rows');
    return {
      captionId: updated.id,
      edited: updated.edited,
      beforeWords: before.words,
      afterWords: updated.words,
      preservedWords: [0, updated.words.length - 1],
      ...dom
    };
  });
  await shot(session.cdp, '05-inline-edit.png');

  await stop(session);
  session = await launch(EMPTY, PORT + 1, 'empty');
  await step('6. workspace without edit.json shows the empty state', async () => {
    await evalOn(session.cdp, command('akari.daihon.open'));
    const text = await waitEval(session.cdp, `document.querySelector('.akari-daihon-empty')?.textContent`, { label: 'empty state' });
    assert(text === 'edit.json のあるプロジェクトを開くと字幕がここに並びます', 'empty-state copy differed');
    return { text };
  });
  await shot(session.cdp, '06-empty-state.png');
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
