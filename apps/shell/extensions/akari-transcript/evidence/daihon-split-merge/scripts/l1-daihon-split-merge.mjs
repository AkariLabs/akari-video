#!/usr/bin/env node
// Electron + CDP の 6 手順で台本の分割・結合・行/語挿入を観測する。
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(ROOT, 'fixture', 'project');
const RUNS = path.join(ROOT, 'runs');
const ISO = path.join(RUNS, 'l1');
const RESULTS = path.join(ROOT, 'results.json');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22144);
const out = {
  status: 'running', steps: [], screenshots: [], cleanup: null, dismissedNotices: 0,
  knownIssues: ['edit.json v2 の ITEM_KEYS に anchor が無く、行アンカー item を持つ edit.json の読み込みが shell 側で失敗してトーストが出る（schema には anchor がある = main 既存の不整合・本票の境界外）']
};
const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<WORKTREE>').replaceAll(process.env.HOME ?? '~', '<HOME>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/g, '<TMP>')
  .replace(/\/Users\/[^\s)'"\]]+/g, '<HOME>');
const save = async () => {
  const safe = JSON.parse(JSON.stringify(out, (_key, value) => typeof value === 'string' ? sanitize(value) : value));
  const temporary = `${RESULTS}.tmp-${process.pid}`; await writeFile(temporary, `${JSON.stringify(safe, null, 2)}\n`); await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const run = (command, args, { cwd = ROOT, timeoutMs = 180_000 } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, timeoutMs); child.once('error', reject);
  child.once('close', code => { closed = true; clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1400)}`)); });
});
const step = async (name, operation) => { const record = { name, pass: false }; out.steps.push(record); try { record.detail = await operation(); record.pass = true; await save(); return record.detail; } catch (error) { record.error = sanitize(error); await save(); throw error; } };
const waitEval = async (cdp, expression, label, timeoutMs = 60_000) => { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { const value = await evalOn(cdp, expression); if (value) return value; } catch {} await sleep(180); } throw new Error(`${label} not reached`); };
const waitFile = async (file, predicate, label, timeoutMs = 30_000) => { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const source = await readFile(file, 'utf8'); if (predicate(source)) return source; await sleep(150); } throw new Error(`${label} not reached`); };
async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 120_000; let hiddenSince = null;
  while (Date.now() < deadline) {
    const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
    if (!state.exists) return 'removed';
    if (state.hidden) {
      hiddenSince ??= Date.now();
      if (Date.now() - hiddenSince >= 15_000) {
        const neutralized = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');if(!el||!el.classList.contains('theia-hidden'))return false;el.style.pointerEvents='none';return true})()`);
        if (neutralized) return 'neutralized';
      }
    } else hiddenSince = null;
    await sleep(200);
  }
  throw new Error('theia preload overlay did not settle');
}
const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${JSON.stringify(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;
async function dismissNotifications(cdp) {
  try {
    await evalOn(cdp, command('notifications.commands.clearAll'));
    await waitEval(cdp, `document.querySelectorAll('.theia-notification-list-item').length===0`, 'notifications dismissed', 5000);
  } catch {
    // 通知は既知の境界外不整合。消去失敗だけで対象操作の観測を止めない。
  }
  let dismissed = 0;
  try {
    dismissed = await evalOn(cdp, `(()=>{const buttons=[...document.querySelectorAll('[data-akari-notice-close]')];buttons.forEach(button=>button.click());return buttons.length})()`);
    if (Number.isFinite(dismissed)) out.dismissedNotices += dismissed;
    await waitEval(cdp, `document.querySelectorAll('[data-akari-notice-close]').length===0`, 'AKARI notices dismissed', 3000);
  } catch {
    // AKARI notice の消去失敗も対象操作の観測自体は止めない。
  }
  return dismissed;
}
async function domDump(cdp) {
  return evalOn(cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')].slice(0,3).map(r=>({id:r.dataset.captionId,words:r.querySelectorAll('.akari-daihon-word').length,html:r.innerHTML.slice(0,220)}));return JSON.stringify({rows,widgetHidden:document.querySelector('.akari-daihon-widget')?.closest('.p-Widget')?.classList.value||null})})()`).catch(error => String(error));
}
async function ensureDaihonVisible(cdp) {
  const probe = `(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"] .akari-daihon-word[data-word-index="0"]');if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({w:r.width,h:r.height,top:r.top})})()`;
  const deadline = Date.now() + 60_000; let last = null;
  while (Date.now() < deadline) {
    last = await evalOn(cdp, probe).catch(() => null);
    if (last && JSON.parse(last).w > 0 && JSON.parse(last).h > 0) return JSON.parse(last);
    await evalOn(cdp, command('akari.daihon.open')).catch(() => {}); await sleep(600);
  }
  throw new Error(`台本パネルが見えない: ${last} | ${await domDump(cdp)}`);
}
const parseRows = source => { const root = JSON.parse(source); return Array.isArray(root) ? root : root.captions; };
const rectExpression = selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
const rect = async (cdp, selector) => {
  let point = await evalOn(cdp, rectExpression(selector)).catch(() => null);
  if (!point) {
    await ensureDaihonVisible(cdp);
    point = await waitEval(cdp, rectExpression(selector), `${selector} visible after daihon reopen`, 20_000);
  }
  return point;
};
const click = async (cdp, selector) => { const point = await rect(cdp, selector); await realClick(cdp, point.x, point.y); await sleep(180); };
const frontmostPoint = async (cdp, selector) => {
  let lastCover = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    await dismissNotifications(cdp);
    await ensureDaihonVisible(cdp);
    await sleep(600);
    const point = await rect(cdp, selector);
    const state = await evalOn(cdp, `(()=>{const target=document.querySelector(${JSON.stringify(selector)});const cover=document.elementFromPoint(${point.x},${point.y});const r=cover?.getBoundingClientRect();return{frontmost:target===cover,cover:cover?{className:typeof cover.className==='string'?cover.className:String(cover.className?.baseVal??''),rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null}:null}})()`);
    if (state.frontmost) return point;
    lastCover = state.cover;
  }
  assert(false, `${selector} is not frontmost at its center; cover=${JSON.stringify(lastCover)}`);
};
const clickFrontmost = async (cdp, selector) => { const point = await frontmostPoint(cdp, selector); await realClick(cdp, point.x, point.y); await sleep(180); };
const clickGapButton = async (cdp, prevId) => {
  const zone = `.akari-daihon-gapzone[data-prev-row-id="${prevId}"]`;
  const point = await rect(cdp, zone);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await sleep(120);
  await click(cdp, `${zone} button`);
};
const clickText = async (cdp, container, text) => { const point = await waitEval(cdp, `(()=>{const c=document.querySelector(${JSON.stringify(container)});const e=c&&[...c.querySelectorAll('button')].find(n=>n.textContent.includes(${JSON.stringify(text)}));if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, text); await realClick(cdp, point.x, point.y); await sleep(180); };
const typeAndEnter = async (cdp, selector, value) => { await click(cdp, selector); await cdp.send('Input.insertText', { text: value }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); };
const selectRows = async (cdp, ids) => evalOn(cdp, `(()=>{const ids=${JSON.stringify(ids)};ids.forEach((id,index)=>document.querySelector('.akari-daihon-row[data-caption-id="'+id+'"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true,${ids.length > 1 ? 'metaKey:index>0,ctrlKey:index>0' : ''}})));return true})()`);
async function rightClick(cdp, selector) {
  const point = await rect(cdp, selector);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'right', buttons: 2, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(200);
  if (await evalOn(cdp, `Boolean(document.querySelector('.akari-daihon-wordcm'))`)) return 'native';
  await evalOn(cdp, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));return true})()`);
  await sleep(200);
  return 'synthetic';
}
const shot = async (cdp, number, label) => { const name = `${String(number).padStart(2, '0')}-${label}.png`; await screenshot(cdp, path.join(ROOT, name)); out.screenshots.push(name); await save(); };

let session;
let spawnedChild;
async function launch() {
  await rm(ISO, { recursive: true, force: true }); await mkdir(path.join(ISO, 'akari-home'), { recursive: true });
  const child = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${ISO}`, '--no-sandbox'], { cwd: REPO, env: { ...process.env, AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: ISO }, stdio: ['ignore', 'pipe', 'pipe'] });
  spawnedChild = child;
  const log = path.join(RUNS, 'l1.log'); await writeFile(log, ''); const append = chunk => void writeFile(log, chunk, { flag: 'a' }); child.stdout.on('data', append); child.stderr.on('data', append);
  let target; const deadline = Date.now() + 150_000; while (!target && Date.now() < deadline) { try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch {} if (!target) await sleep(300); }
  assert(target, 'CDP page target did not appear'); const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, 'Theia workbench', 150_000); return { child, cdp };
}
async function stop() {
  session?.cdp?.close(); const pid = (session?.child ?? spawnedChild)?.pid;
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} await sleep(2500); try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {} await sleep(600); }
  const survivors = Number((await run('/bin/sh', ['-c', `ps -eo args | grep -F ${JSON.stringify(ISO)} | grep -v grep | wc -l`])).stdout.trim());
  out.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors }; await save(); return survivors;
}

const captionsPath = path.join(PROJECT, 'captions.json'); const editPath = path.join(PROJECT, 'edit.json');
try {
  await rm(path.join(ROOT, 'fixture'), { recursive: true, force: true }); await mkdir(RUNS, { recursive: true });
  out.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')])).stdout.trim()); await save();
  const originalRows = parseRows(await readFile(captionsPath, 'utf8')); const originalFirst = structuredClone(originalRows[0]);
  const originalIds = new Set(originalRows.map(row => row.id));
  const splitIndex = 2;
  let splitNewId;
  session = await launch(); const { cdp } = session; await evalOn(cdp, command('akari.daihon.open'));
  out.preloadOverlay = await settlePreloadOverlay(cdp);
  out.daihonVisible = await ensureDaihonVisible(cdp);
  await dismissNotifications(cdp);
  await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===${originalRows.length}`, 'fixture daihon rows'); await save();

  await step('1. ⧉ 分割・語境界時刻・anchor 追従', async () => {
    await ensureDaihonVisible(cdp);
    await dismissNotifications(cdp);
    await click(cdp, '.akari-daihon-row[data-caption-id="c-0001"] .akari-daihon-split');
    const marks = await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row[data-caption-id="c-0001"] .akari-daihon-splitmark').length`, 'split marks'); assert(marks === originalFirst.words.length - 1, `split marks=${marks}`);
    await clickFrontmost(cdp, `.akari-daihon-row[data-caption-id="c-0001"] .akari-daihon-splitmark[data-split-index="${splitIndex}"]`);
    const source = await waitFile(captionsPath, value => parseRows(value).length === originalRows.length + 1, 'split saved'); await ensureDaihonVisible(cdp); const rows = parseRows(source); const first = rows.find(row => row.id === 'c-0001'); const added = rows.filter(row => !originalIds.has(row.id));
    assert(added.length === 1, `split added rows=${added.length}`); const second = added[0]; splitNewId = second.id;
    assert(JSON.stringify(first.words) === JSON.stringify(originalFirst.words.slice(0, splitIndex)), 'front word bytes changed'); assert(JSON.stringify(second.words) === JSON.stringify(originalFirst.words.slice(splitIndex)), 'back word bytes changed');
    assert(first.end === originalFirst.words[splitIndex - 1].end && second.start === originalFirst.words[splitIndex].start, 'word boundary mismatch'); const anchor = JSON.parse(await readFile(editPath, 'utf8')).tracks[1].items[0]; assert(anchor.duration === Math.round((first.end - first.start) * 30), 'anchor duration stale');
    await shot(cdp, 1, 'split'); return { marks, frontEnd: first.end, backStart: second.start, anchor: { at: anchor.at, duration: anchor.duration } };
  });

  await step('2. 分割直後の 2 行を結合して deepEqual 往復', async () => {
    await ensureDaihonVisible(cdp);
    await dismissNotifications(cdp);
    assert(splitNewId, 'split caption id was not captured');
    await selectRows(cdp, ['c-0001', splitNewId]);
    const selector = '.akari-daihon-selmerge';
    await clickFrontmost(cdp, selector);
    let source;
    try {
      source = await waitFile(captionsPath, value => parseRows(value).length === originalRows.length, 'merge saved first click', 3000);
    } catch {
      await clickFrontmost(cdp, selector);
      try { source = await waitFile(captionsPath, value => parseRows(value).length === originalRows.length, 'merge saved retry'); }
      catch (error) {
        const footer = await evalOn(cdp, `document.querySelector('.akari-daihon-footer')?.textContent??''`);
        throw new Error(`${error.message}; footer=${footer}`);
      }
    }
    await ensureDaihonVisible(cdp);
    assert(JSON.stringify(parseRows(source).find(row => row.id === 'c-0001')) === JSON.stringify(originalFirst), 'split/merge did not deepEqual'); await shot(cdp, 2, 'roundtrip-merge'); return { deepEqual: true };
  });

  await step('3. 行間 ⊕ の空ドラフト破棄と確定', async () => {
    await ensureDaihonVisible(cdp);
    await dismissNotifications(cdp);
    const before = await readFile(captionsPath, 'utf8'); await clickGapButton(cdp, 'c-0002'); await click(cdp, '.akari-daihon-row[data-caption-id="c-0002"] .akari-daihon-tc'); await sleep(500); assert(await readFile(captionsPath, 'utf8') === before, 'empty draft wrote captions');
    await clickGapButton(cdp, 'c-0002'); await typeAndEnter(cdp, '.akari-daihon-gapdraft input', '行間追加'); const source = await waitFile(captionsPath, value => parseRows(value).some(row => row.text === '行間追加'), 'gap insertion'); await ensureDaihonVisible(cdp); const inserted = parseRows(source).find(row => row.text === '行間追加'); assert(!('words' in inserted), 'draft line gained words'); await shot(cdp, 3, 'gap-insert'); return { emptyDiscarded: true, insertedId: inserted.id, wordsAbsent: true };
  });

  await step('4. ＋ 語で既存語の時刻を保つ', async () => {
    await ensureDaihonVisible(cdp);
    await dismissNotifications(cdp);
    const before = parseRows(await readFile(captionsPath, 'utf8')).find(row => row.id === 'c-0005');
    const anchorBefore = JSON.stringify((({ at, duration }) => ({ at, duration }))(JSON.parse(await readFile(editPath, 'utf8')).tracks[1].items[0]));
    const word = '.akari-daihon-row[data-caption-id="c-0005"] .akari-daihon-word[data-word-index="3"]'; const dispatch = await rightClick(cdp, word); await clickText(cdp, '.akari-daihon-wordcm', '＋ 語'); await typeAndEnter(cdp, '.akari-daihon-pop input', '新語');
    const source = await waitFile(captionsPath, value => parseRows(value).find(row => row.id === 'c-0005')?.text.includes('新語'), 'word insertion'); await ensureDaihonVisible(cdp); const after = parseRows(source).find(row => row.id === 'c-0005');
    for (const old of before.words) { const same = after.words.find(candidate => candidate.text === old.text); assert(same && same.start === old.start && same.end === old.end, `timing changed: ${old.text}`); }
    const inserted = after.words.find(candidate => candidate.text === '新語');
    assert(inserted && inserted.start >= before.words[3].end && inserted.end <= before.words[4].start && inserted.end > inserted.start, 'inserted word timing is outside the source gap');
    const anchorAfter = JSON.stringify((({ at, duration }) => ({ at, duration }))(JSON.parse(await readFile(editPath, 'utf8')).tracks[1].items[0]));
    assert(anchorAfter === anchorBefore, 'anchor at/duration changed during word insertion');
    await shot(cdp, 4, 'word-insert'); return { dispatch, unchangedTimedWords: before.words.length, insertedTiming: { start: inserted.start, end: inserted.end }, anchorBytesEqual: true };
  });

  await step('5. 非連続選択は結合 disabled + 理由', async () => { await ensureDaihonVisible(cdp); await dismissNotifications(cdp); await selectRows(cdp, ['c-0001', 'c-0003']); const state = await evalOn(cdp, `(()=>{const b=document.querySelector('.akari-daihon-selmerge');return{disabled:b.disabled,title:b.title}})()`); assert(state.disabled && /離れた/.test(state.title), JSON.stringify(state)); await shot(cdp, 5, 'non-contiguous-disabled'); return state; });
  await step('6. time_domain 不一致は結合 disabled + 理由', async () => { await ensureDaihonVisible(cdp); await dismissNotifications(cdp); await evalOn(cdp, `document.querySelector('.akari-daihon-selclear')?.click()`); await selectRows(cdp, ['c-0003', 'c-0004']); const state = await evalOn(cdp, `(()=>{const b=document.querySelector('.akari-daihon-selmerge');return{disabled:b.disabled,title:b.title}})()`); assert(state.disabled && /タイムドメイン/.test(state.title), JSON.stringify(state)); await shot(cdp, 6, 'domain-disabled'); return state; });

  out.status = 'pass'; await save();
} catch (error) { out.status = 'fail'; out.error = sanitize(error); await save(); process.exitCode = 1; }
finally { const survivors = await stop(); if (survivors !== 0) { out.status = 'fail'; out.cleanupError = `surviving processes: ${survivors}`; await save(); process.exitCode = 1; } }
process.stdout.write(`${JSON.stringify({ status: out.status, steps: out.steps.length, screenshots: out.screenshots.length, cleanup: out.cleanup })}\n`);
