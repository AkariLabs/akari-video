#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PROJECT = path.join(ROOT, 'fixture', 'project');
const CAPTIONS = path.join(PROJECT, 'captions.json');
const EDIT = path.join(PROJECT, 'edit.json');
const RUN = path.join(ROOT, 'runs', 'l1');
const RESULTS = path.join(ROOT, 'results.json');
const LOG = path.join(ROOT, 'runs', 'l1.log');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22208);
const S = value => JSON.stringify(value);
const output = { status: 'running', steps: [], screenshots: [], cleanup: null };
const sanitize = value => String(value?.stack || value?.message || value)
  .replaceAll(REPO, '<WORKTREE>').replaceAll(process.env.HOME ?? '~', '<HOME>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"`]+/gu, '<TMP>')
  .replace(/\/Users\/[^\s)'"`]+/gu, '<HOME>');
const save = async () => { const temporary = `${RESULTS}.tmp-${process.pid}`; await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`); await rename(temporary, RESULTS); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const run = (command, args, cwd = ROOT) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject); child.once('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1200)}`)));
});
async function step(name, operation) {
  const record = { name, pass: false }; output.steps.push(record);
  try { record.detail = await operation(); record.pass = true; await save(); return record.detail; }
  catch (error) { record.error = sanitize(error); await save(); throw error; }
}
async function waitEval(cdp, expression, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) { try { const value = await evalOn(cdp, expression); if (value) return value; } catch (error) { last = error; } await sleep(180); }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}
async function waitCaptions(predicate, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { const root = JSON.parse(await readFile(CAPTIONS, 'utf8')); if (predicate(root)) return root; await sleep(150); }
  throw new Error(`${label} not reached`);
}
async function settlePreloadOverlay(cdp) {
  const deadline = Date.now() + 120_000;
  let hiddenSince = null;
  while (Date.now() < deadline) {
    const state = await evalOn(cdp, `(()=>{const el=document.querySelector('.theia-preload');return{exists:Boolean(el),hidden:Boolean(el?.classList.contains('theia-hidden'))}})()`);
    if (!state.exists) return 'removed';
    const neutralizedAlready = await evalOn(cdp, `(()=>document.querySelector('.theia-preload')?.style.pointerEvents==='none')()`);
    if (neutralizedAlready) return 'neutralized';
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
async function ensureDaihonVisible(cdp) {
  const probe = `(()=>{const e=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"]');if(!e)return null;const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await evalOn(cdp, probe).catch(() => false)) return true;
    await evalOn(cdp, command('akari.daihon.open')).catch(() => undefined);
    await sleep(600);
  }
  throw new Error('台本パネルが見えない');
}
async function prepareForRealClick(cdp) {
  await settlePreloadOverlay(cdp);
  await ensureDaihonVisible(cdp);
}
const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');const r=await window.theia.container.get(C).executeCommand(${S(id)});return r!==null&&typeof r==='object'?'[object]':r??null})()`;
const commandWith = (id, request) => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService binding unavailable');return await window.theia.container.get(C).executeCommand(${S(id)},${S(request)})})()`;
async function click(cdp, selector) {
  await prepareForRealClick(cdp);
  const at = await waitEval(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, `${selector} visible`);
  await realClick(cdp, at.x, at.y); await sleep(180);
}
async function setSelect(cdp, index, value) {
  return evalOn(cdp, `(()=>{const e=document.querySelectorAll('.akari-daihon-pop select')[${index}];if(!e)return false;e.value=${S(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}
async function shot(cdp, number, name) { const file = `${String(number).padStart(2, '0')}-${name}.png`; await screenshot(cdp, path.join(ROOT, file)); output.screenshots.push(file); await save(); }
async function openGear(cdp, id) {
  // 直前のポップは次の行の ⚙ に重なってクリックを奪う（実測: c-0001 のポップが c-0004 の行を覆った）。
  await evalOn(cdp, `(()=>{document.querySelectorAll('.akari-daihon-pop').forEach(node=>node.remove());return true})()`);
  await sleep(120);
  await click(cdp, `.akari-daihon-row[data-caption-id="${id}"] .akari-daihon-gear`);
  await waitEval(cdp, `Boolean(document.querySelector('.akari-daihon-pop select'))`, `${id} の字幕設定ポップ`, 10_000);
}
async function connectWebview(target) {
  const cdp = new CDP(target.webSocketDebuggerUrl); const contexts = [];
  cdp.on('Runtime.executionContextCreated', params => contexts.push(params.context)); await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await sleep(600);
  const tree = await cdp.send('Page.getFrameTree'); const top = tree.frameTree.frame.id;
  const context = contexts.find(candidate => candidate.auxData?.frameId !== top); if (!context) { cdp.close(); return null; }
  return { cdp, context };
}
async function previewText(cdp, time, expectedText, visible) {
  const editUri = pathToFileURL(EDIT).toString(); await evalOn(cdp, commandWith('akari.preview.ensureVisible', { editUri })).catch(() => undefined);
  const deadline = Date.now() + 90_000;
  let lastSeen = null;
  while (Date.now() < deadline) {
    await evalOn(cdp, commandWith('akari.preview.seekOutput', { editUri, time })).catch(() => undefined);
    const targets = (await listTargets(PORT)).filter(item => item.type === 'iframe' && /webview\/index\.html/u.test(String(item.url)));
    for (const target of targets) {
      const connection = await connectWebview(target).catch(() => null); if (!connection) continue;
      try {
        const value = await evalOn(connection.cdp, `(()=>{const p=document.getElementById('caption-plate');if(!p||!window.__akariPreview?.captions)return null;const lines=[...p.querySelectorAll('.akari-caption__line')].map(e=>e.textContent).join('');const text=lines||[...p.childNodes].filter(n=>n.nodeName!=='STYLE').map(n=>n.textContent).join('');return{text,count:window.__akariPreview.captions.length}})()`, connection.context.id);
        if (value) lastSeen = value;
        if (value && String(value.text).includes(expectedText) === visible) return value;
      } finally { connection.cdp.close(); }
    }
    await sleep(350);
  }
  throw new Error(`preview t=${time} を観測できない（最後の観測: ${JSON.stringify(lastSeen)}）`);
}

let child; let cdp;
try {
  await rm(path.join(ROOT, 'fixture'), { recursive: true, force: true });
  output.fixture = JSON.parse((await run(process.execPath, [path.join(ROOT, 'scripts', 'gen-fixture.mjs')])).stdout.trim());
  await rm(RUN, { recursive: true, force: true }); await mkdir(path.join(RUN, 'akari-home'), { recursive: true }); await writeFile(LOG, '');
  child = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${RUN}`, '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, AKARI_HOME: path.join(RUN, 'akari-home'), THEIA_CONFIG_DIR: RUN }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const append = chunk => void writeFile(LOG, sanitize(chunk), { flag: 'a' }); child.stdout.on('data', append); child.stderr.on('data', append);
  let target; for (let attempt = 0; attempt < 600 && !target; attempt++) { target = await listTargets(PORT).then(items => items.find(item => item.type === 'page')).catch(() => undefined); if (!target) await sleep(300); }
  assert(target, 'CDP page target did not appear'); cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, 'Theia workbench', 180_000);
  await evalOn(cdp, command('akari.daihon.open')); await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length===4`, '4 caption rows');

  await step('1. 行の字幕設定ポップは 3 フィールドの初期値を表示', async () => {
    await openGear(cdp, 'c-0001'); const values = await evalOn(cdp, `(()=>{const p=document.querySelector('.akari-daihon-pop');return p?{count:p.querySelectorAll('select').length,values:[...p.querySelectorAll('select')].map(e=>e.value)}:null})()`);
    assert(values?.count === 3, `select count=${values?.count}`); assert(JSON.stringify(values.values) === JSON.stringify(['plain', 'full', '']), `values=${JSON.stringify(values.values)}`); return values;
  }); await shot(cdp, 1, 'gear-fields');

  await step('2. カラオケ切替は style 以外を保全', async () => {
    const before = JSON.parse(await readFile(CAPTIONS, 'utf8')).captions.find(row => row.id === 'c-0001'); await setSelect(cdp, 0, 'karaoke');
    const root = await waitCaptions(value => value.captions.find(row => row.id === 'c-0001')?.style === 'karaoke', 'karaoke save'); const after = root.captions.find(row => row.id === 'c-0001');
    const without = value => { const copy = structuredClone(value); delete copy.style; return JSON.stringify(copy); }; assert(without(before) === without(after), 'style 以外が変化'); return { style: after.style, preserved: true };
  }); await shot(cdp, 2, 'karaoke');

  await step('3. アニメ設定と解除は animation 以外を保全', async () => {
    await openGear(cdp, 'c-0001'); await setSelect(cdp, 2, 'fade-in-out');
    await waitCaptions(value => value.captions.find(row => row.id === 'c-0001')?.text_style?.animation?.out?.id === 'fade-in-out', 'animation save');
    await openGear(cdp, 'c-0001'); await setSelect(cdp, 2, '');
    const root = await waitCaptions(value => !Object.hasOwn(value.captions.find(row => row.id === 'c-0001')?.text_style ?? {}, 'animation'), 'animation remove'); return { removed: true, textStyle: root.captions.find(row => row.id === 'c-0001').text_style ?? null };
  }); await shot(cdp, 3, 'animation');

  await step('4. speech-tight は start/end とアンカーを変えず preview の padding だけ隠す', async () => {
    const before = JSON.parse(await readFile(CAPTIONS, 'utf8')).captions.find(row => row.id === 'c-0001'); const editBefore = await readFile(EDIT, 'utf8'); const anchorBefore = JSON.parse(editBefore).tracks.flatMap(track => track.items ?? []).find(item => item.id === 'anchored-note').at;
    await openGear(cdp, 'c-0004'); await setSelect(cdp, 1, 'speech-tight'); await waitCaptions(value => value.captions.find(row => row.id === 'c-0004')?.display_timing === 'speech-tight', 'anchored speech-tight save');
    await openGear(cdp, 'c-0001'); await setSelect(cdp, 1, 'speech-tight');
    const root = await waitCaptions(value => value.captions.find(row => row.id === 'c-0001')?.display_timing === 'speech-tight', 'speech-tight save'); const after = root.captions.find(row => row.id === 'c-0001');
    assert(before.start === after.start && before.end === after.end, 'start/end changed'); const editAfter = await readFile(EDIT, 'utf8'); const anchorAfter = JSON.parse(editAfter).tracks.flatMap(track => track.items ?? []).find(item => item.id === 'anchored-note').at; assert(anchorBefore === anchorAfter, 'anchor at changed'); assert(editBefore === editAfter, 'edit.json が書き換わった');
    const padding = await previewText(cdp, 0.3, before.text, false); const speech = await previewText(cdp, 1.5, before.text, true);
    await openGear(cdp, 'c-0001'); await setSelect(cdp, 1, 'full'); await waitCaptions(value => !Object.hasOwn(value.captions.find(row => row.id === 'c-0001'), 'display_timing'), 'full restore'); const restored = await previewText(cdp, 0.3, before.text, true); return { padding, speech, restored, anchorAt: anchorAfter };
  }); await shot(cdp, 4, 'speech-tight-preview');

  await step('5. words 無し行では表示タイミングを無効化', async () => { await openGear(cdp, 'c-0003'); const disabled = await evalOn(cdp, `document.querySelectorAll('.akari-daihon-pop select')[1]?.disabled===true`); assert(disabled, 'timing select enabled'); return { disabled }; }); await shot(cdp, 5, 'no-words-disabled');

  await step('6. 選択行への一括適用は words 無しをスキップ', async () => {
    await evalOn(cdp, `(()=>{document.querySelectorAll('.akari-daihon-pop').forEach(e=>e.remove());for(const id of ['c-0001','c-0003'])document.querySelector('.akari-daihon-row[data-caption-id="'+id+'"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:true}));return true})()`);
    await click(cdp, 'button.akari-daihon-selgear'); const root = await waitCaptions(value => value.captions.find(row => row.id === 'c-0001')?.display_timing === 'speech-tight', 'selection speech-tight');
    assert(!Object.hasOwn(root.captions.find(row => row.id === 'c-0003'), 'display_timing'), 'words 無し行に適用された'); const toast = await evalOn(cdp, `document.querySelector('.akari-daihon-footer')?.textContent??''`); assert(String(toast).includes('スキップ'), 'スキップ通知が無い'); return { skipped: 1 };
  }); await shot(cdp, 6, 'selection-tight');

  await step('7. インスペクターへ対象字幕をフォーカス', async () => {
    const timelineAttachedBefore = Boolean(await evalOn(cdp, `document.querySelector('.akari-annotations-widget')`)); await openGear(cdp, 'c-0002');
    const at = await waitEval(cdp, `(()=>{const b=[...document.querySelectorAll('.akari-daihon-pop button')].find(e=>e.textContent.includes('インスペクターで開く'));if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`, 'inspector jump'); await prepareForRealClick(cdp); await realClick(cdp, at.x, at.y);
    const state = await waitEval(cdp, `(()=>{const root=document.querySelector('.akari-inspector-widget');if(!root)return null;const values=[...root.querySelectorAll('input,textarea')].map(e=>e.value);return values.includes('二番目の字幕です')?{visible:true,text:'二番目の字幕です'}:null})()`, 'inspector caption', 30_000); return { timelineAttachedBefore, ...state };
  }); await shot(cdp, 7, 'inspector-focus');
  assert(output.steps.length === 7, `steps=${output.steps.length}`);
  output.status = 'pass'; await save();
} catch (error) { output.status = 'fail'; output.error = sanitize(error); process.exitCode = 1; await save(); }
finally {
  cdp?.close(); const pid = child?.pid; if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} await sleep(2500); try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {} }
  const sanitizedLog = await readFile(LOG, 'utf8').then(value => sanitize(value)).catch(() => ''); await writeFile(LOG, sanitizedLog);
  const ps = await run('/bin/ps', ['-eo', 'pid,args']).catch(() => ({ stdout: '' })); const survivors = ps.stdout.split('\n').filter(line => line.includes(RUN)).length;
  output.cleanup = { killedPid: pid ?? null, survivingProcesses: survivors }; if (survivors !== 0) { output.status = 'fail'; process.exitCode = 1; } await save();
}
process.stdout.write(`${JSON.stringify({ status: output.status, steps: output.steps.length, screenshots: output.screenshots.length, cleanup: output.cleanup })}\n`);
