#!/usr/bin/env node
// L1（ラッパーが書いた検証スクリプト。製品ソースではない）。先に apps/shell で npm run build。
// 有償 API は叩かない（fal への要求は CDP でブロックし件数を記録）。Node >= 22。
//   node l1-timeline-edge-length.mjs            … 修正後の全手順 → measurements.json
//   AKARI_L1_REPO=<起点 worktree> node l1-timeline-edge-length.mjs --before
//                                              … 修正前コードで静止画の右端ドラッグだけ → before-measurements.json
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, screenshot, realClick } from '../generation-states/scripts/cdp-lib.mjs';
import { createFixture } from './gen-fixture.mjs';

const BEFORE = process.argv.includes('--before');
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.AKARI_L1_REPO ? path.resolve(process.env.AKARI_L1_REPO) : path.resolve(ROOT, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ISO = await mkdtemp(path.join(tmpdir(), 'akari-edge-length-l1-'));
const PROJECT = path.join(ISO, 'project');
const PORT = Number(process.argv.find(x => x.startsWith('--port='))?.slice(7) ?? (BEFORE ? 22231 : 22232));
const OUT = BEFORE ? 'before-measurements.json' : 'measurements.json';
const output = { status: 'running', phase: BEFORE ? 'before-fix' : 'after-fix', driver: 'Electron + CDP Input.dispatchMouseEvent',
  steps: [], screenshots: [], falRequests: [] };
const started = performance.now();
let child, cdp, log = '';
const clean = text => String(text).replaceAll(ISO, '<TEMP>').replaceAll(REPO, '<REPO>');
const save = () => writeFile(path.join(ROOT, OUT), clean(JSON.stringify(output, null, 2)) + '\n');
async function waitFor(operation, timeout = 60000) {
  const deadline = Date.now() + timeout; let error;
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value; } catch (e) { error = e; }
    await sleep(150);
  }
  throw new Error(`Timed out: ${error?.message ?? 'condition'}`);
}
const evaluate = expression => evalOn(cdp, expression);
const waitEval = (expression, timeout) => waitFor(() => evaluate(expression), timeout);
const readEdit = async () => JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
const item = (edit, id) => edit.tracks[0].items.find(i => i.id === id);
async function step(name, operation) {
  const result = { name, pass: false }; output.steps.push(result);
  const start = performance.now();
  try { result.measurements = await operation(); result.pass = true; }
  catch (error) { result.error = clean(error.stack ?? error); throw error; }
  finally { result.elapsedMs = Math.round(performance.now() - start); await save(); }
}
async function shot(name) { await screenshot(cdp, path.join(ROOT, name)); output.screenshots.push(name); await save(); }
const W = 'window.__akariEdgeWidget';
// タイムラインの cut 要素は data-akari-item-kind="cut" + data-akari-item-id=<cut の添字>。
const CUT_INDEX = { still: 0, n1: 1, plan: 2, n2: 3 };
const SEL = id => `[data-akari-item-kind="cut"][data-akari-item-id="${CUT_INDEX[id]}"]`;
const clipRect = id => evaluate(`(()=>{const e=[...${W}.node.querySelectorAll('${SEL(id)}')]
  .find(e=>e.getClientRects().length&&!e.closest('.akari-annotations-strip-ghost'));if(!e)return null;
  const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};})()`);
const pxPerSecond = () => evaluate(`(()=>{const r=${W}.strip.getBoundingClientRect();return r.width/${W}.visibleDuration();})()`);
const GEOMETRY = `
 const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
 const visible=n=>{if(!n||!n.getClientRects().length)return false;const r=n.getBoundingClientRect();
   if(r.width<=0||r.height<=0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;
   for(let a=n;a instanceof Element;a=a.parentElement){const s=getComputedStyle(a);
     if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)return false;}return true;};
 const measure=n=>({role:n.className,text:n.textContent,...rect(n)});
 const opaque=c=>c!=='transparent'&&!/rgba\\([^)]*,\\s*0\\)/.test(c);
 const painted=n=>{const s=getComputedStyle(n);return opaque(s.backgroundColor)||(parseFloat(s.borderTopWidth)>0&&s.borderTopStyle!=='none'&&opaque(s.borderTopColor))
   ||(parseFloat(s.borderBottomWidth)>0&&s.borderBottomStyle!=='none'&&opaque(s.borderBottomColor));};
`;
const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .1
  && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .1;
const overlapPairs = rects => rects.flatMap((a, i) => rects.slice(i + 1).filter(b => intersects(a, b)).map(b => ({ a, b })));
const CHIP_TEXT = id => `(()=>{${GEOMETRY}
 const e=[...${W}.node.querySelectorAll('${SEL(id)}')].find(e=>visible(e)&&!e.closest('.akari-annotations-strip-ghost'));if(!e)return null;
 return [...e.querySelectorAll('[data-akari-generation-badge],.akari-annotations-strip-clip-header-label,.akari-annotations-strip-clip-header-duration,.akari-clip-kind-badge')]
   .filter(visible).map(measure);})()`;
async function listOwnedProcesses() {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,command='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match || !match[2].includes(ISO) || Number(match[1]) === process.pid) return [];
    return [{ pid: Number(match[1]), command: match[2] }];
  });
}
async function stopElectron() {
  child?.stdout?.destroy(); child?.stderr?.destroy();
  const cleanup = { pid: child?.pid ?? null, signals: [], survivors: [], isolatedAkariHome: true, isolatedUserData: true };
  const signalPid = (pid, signal) => { try { process.kill(pid, signal); cleanup.signals.push({ pid, signal }); }
    catch (error) { if (error.code !== 'ESRCH') throw error; } };
  try {
    cleanup.before = (await listOwnedProcesses()).length;
    if (child?.pid && child.exitCode === null && child.signalCode === null) signalPid(child.pid, 'SIGTERM');
    for (const entry of await listOwnedProcesses()) if (entry.pid !== child?.pid) signalPid(entry.pid, 'SIGTERM');
    await sleep(1500);
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = await listOwnedProcesses(); if (!remaining.length) break;
      for (const entry of remaining) signalPid(entry.pid, 'SIGKILL'); await sleep(500);
    }
    cleanup.survivors = await listOwnedProcesses();
    cleanup.exited = cleanup.survivors.length === 0;
  } catch (error) { cleanup.error = clean(error.stack ?? error); cleanup.exited = false; }
  finally { child?.unref(); }
  output.cleanup = { ...cleanup, signals: cleanup.signals.length };
  if (!cleanup.exited) { output.status = 'fail'; process.exitCode = 1; }
  else await rm(ISO, { recursive: true, force: true });
}
async function lint() {
  const result = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(REPO, 'packages/edit-lint/bin/edit-lint.mjs'), PROJECT, '--json'],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', c => { stdout += c; }); proc.stderr.on('data', c => { stderr += c; });
    proc.once('error', reject); proc.once('close', code => resolve({ code, stdout, stderr }));
  });
  const parsed = JSON.parse(result.stdout);
  assert.equal(result.code, 0, result.stderr || result.stdout); assert.equal(parsed.verdict, 'pass');
  return { code: result.code, verdict: parsed.verdict };
}
// 実尺取得（getAudioDuration）と実尺不明通知を数える計測フック。製品の挙動は変えない（呼び出しを素通しする）。
const INSTRUMENT = `(()=>{const w=${W};const m=window.__akariEdgeMetrics={fetches:[],ensureCalls:[],notices:0,noticeTexts:[]};
 const e=w.ensureVideoDurationFetch.bind(w);w.ensureVideoDurationFetch=(uri)=>{m.ensureCalls.push(String(uri).split('/').pop());return e(uri);};
 const svc=w.annotationsService,orig=svc.getAudioDuration.bind(svc);
 svc.getAudioDuration=(req)=>{m.fetches.push(String(req.audioUri).split('/').pop());return orig(req);};
 const n=w.showVideoDurationUnavailableNotice.bind(w);w.showVideoDurationUnavailableNotice=()=>{m.notices++;return n();};
 return true;})()`;
const NOTICE_TEXT = `(()=>{const e=${W}.node.querySelector('[data-akari-timeline-notice]')||document.querySelector('[data-akari-timeline-notice]');return e?e.textContent:'';})()`;
async function dragRightEdge(id, seconds) {
  const rect = await clipRect(id), pps = await pxPerSecond();
  const x0 = rect.right - 2, y = rect.top + rect.height / 2, footers = [];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + seconds * pps * i / 12, y, button: 'left', buttons: 1 });
    await sleep(40);
    footers.push(await evaluate(`${W}.dragFeedback.style.display==='none'?'':${W}.dragFeedback.textContent`));
  }
  await sleep(400);
  footers.push(await evaluate(`${W}.dragFeedback.style.display==='none'?'':${W}.dragFeedback.textContent`));
  const noticeDuringDrag = await evaluate(NOTICE_TEXT);
  return { rect, pxPerSecond: pps, x0, x1: x0 + seconds * pps, y, footers, noticeDuringDrag };
}
async function release(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}
try {
  const initial = await createFixture(PROJECT);
  await mkdir(path.join(ISO, 'akari-home'), { recursive: true });
  const candidates = [SHELL, REPO].map(base => path.join(base, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
  const electron = process.env.AKARI_L1_ELECTRON || (await stat(candidates[0]).catch(() => null))?.isFile() && candidates[0] || candidates[1];
  child = spawn(electron, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(ISO, 'userdata')}`, '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, AKARI_HOME: path.join(ISO, 'akari-home'), THEIA_CONFIG_DIR: path.join(ISO, 'config'),
      FAL_KEY: '', FAL_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'
  });
  let launchError; child.once('error', e => { launchError = e; });
  child.stdout.on('data', c => { log += c; }); child.stderr.on('data', c => { log += c; });
  const target = await waitFor(async () => {
    if (launchError || child.exitCode !== null) throw launchError ?? new Error(`Electron exited ${child.exitCode}`);
    return (await listTargets(PORT)).find(t => t.type === 'page');
  }, 600000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*://*.fal.ai/*', '*://fal.ai/*', '*://*.fal.run/*'] });
  cdp.on('Network.requestWillBeSent', e => { if (/https?:\/\/[^/]*fal\.(ai|run)\//.test(e.request.url)) output.falRequests.push(e.request.url); });
  await waitEval(`Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 900000);
  await waitEval(`(()=>{const e=document.querySelector('.theia-preload');return !e||e.classList.contains('theia-hidden');})()`, 900000);
  const dismissDialogs = `(()=>{for(const d of document.querySelectorAll('.dialogBlock')){
    const b=[...d.querySelectorAll('button')].find(b=>/キャンセル|Cancel|閉じる|Close/.test(b.textContent));b?.click();}return true;})()`;
  await evaluate(dismissDialogs);
  if (!await evaluate(`Boolean(document.querySelector('.akari-annotations-widget'))`)) {
    await evaluate(`(()=>{const c=window.theia.container,k=[...c._bindingDictionary._map.keys()]
      .find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
      void c.get(k).executeCommand('akari.annotations.open');return true;})()`);
    await sleep(500); await evaluate(dismissDialogs);
  }
  await waitEval(`Boolean(document.querySelector('.akari-annotations-widget'))`);
  await evaluate(`(()=>{const c=window.theia.container,k=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype?.getCurrentWidget&&k.prototype?.addWidget&&k.prototype?.activateWidget);
    const s=c.get(k),w=s.widgets.find(w=>w.node?.classList.contains('akari-annotations-widget'));
    window.__akariEdgeShell=s;window.__akariEdgeWidget=w;s.toggleMaximized(w);w.activate();
    document.querySelector('[data-testid="akari-timeline-zoom-percent"]')?.click();return true;})()`);
  await waitEval(`${W}.cutItemIds.length===4`);
  await waitFor(() => clipRect('still'));
  await sleep(1500); // 初期描画時のサムネ・波形取得が落ち着くのを待ってから計測フックを入れる
  await evaluate(INSTRUMENT);
  output.initialStillCache = await evaluate(`(()=>{const w=${W};return [...w.videoDurationCache.entries()].map(([k,v])=>[String(k).split('/').pop(),v]);})()`);

  let drag;
  await step('real right-edge drag of the still clip by 1.2 s', async () => {
    drag = await dragRightEdge('still', 1.2);
    const metrics = await evaluate(`window.__akariEdgeMetrics`);
    drag.fetchesDuringDrag = metrics.fetches.filter(f => f === 'still.png').length;
    drag.ensureVideoDurationFetchCallsDuringDrag = metrics.ensureCalls.filter(f => f === 'still.png').length;
    drag.stillDurationCacheAfterDrag = await evaluate(`[...${W}.videoDurationCache.entries()].filter(([k])=>String(k).endsWith('still.png')).map(([,v])=>v)`);
    drag.noticeCallsDuringDrag = metrics.notices;
    output.drag = drag; await save();
    return drag;
  });
  await shot(BEFORE ? 'before-01-still-drag-warning.png' : '01-still-right-edge-drag.png');
  await release(drag.x1, drag.y);
  await step('release commits the new duration', async () => {
    const edit = await waitFor(async () => { const e = await readEdit(); return item(e, 'still').duration !== 60 && e; });
    await sleep(800);
    const metrics = await evaluate(`window.__akariEdgeMetrics`);
    const still = item(edit, 'still');
    const result = { item: still, fetches: metrics.fetches.filter(f => f === 'still.png').length,
      ensureVideoDurationFetchCalls: metrics.ensureCalls.filter(f => f === 'still.png').length,
      stillDurationCache: await evaluate(`[...${W}.videoDurationCache.entries()].filter(([k])=>String(k).endsWith('still.png')).map(([,v])=>v)`), noticeCalls: metrics.notices,
      noticeText: await evaluate(NOTICE_TEXT), warningFooters: drag.footers.filter(f => /実尺/.test(f)) };
    output.commit = result; await save();
    if (!BEFORE) {
      assert.equal(still.at, 0); assert.equal(still.duration, 96);
      assert.equal(still.source.in, 0); assert.equal(still.source.out, 3.2);
      assert.equal(result.fetches, 0, 'still clip must not fetch source duration');
      assert.equal(result.ensureVideoDurationFetchCalls, 0); assert.equal(result.stillDurationCache.length, 0);
      assert.equal(result.noticeCalls, 0); assert.ok(!/実尺/.test(result.noticeText), 'notice shown');
      assert.equal(result.warningFooters.length, 0, 'footer shows duration warning');
      assert.ok(drag.footers.some(f => /3\.2/.test(f)), 'footer shows the new length');
    }
    return result;
  });
  if (BEFORE) {
    output.status = 'observed';
  } else {
    await step('edit lint passes after the drag', lint);
    await step('undo once restores the still clip', async () => {
      const p = await evaluate(`(()=>{const b=${W}.node.querySelector('button[aria-label="元に戻す"]'),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await realClick(cdp, p.x, p.y);
      const edit = await waitFor(async () => { const e = await readEdit(); return item(e, 'still').duration === 60 && e; });
      assert.deepEqual(item(edit, 'still'), item(initial, 'still'));
      return { still: item(edit, 'still'), undoClicks: 1 };
    });
    // 0 秒の静止画の左端は再生ヘッド（0 秒）と重なり押せないため、10 秒にある静止画 n1 で測る。
    await step('dragging a still clip (n1, 10 s) left edge 3 s right stops at 0.5 s', async () => {
      const rect = await clipRect('n1'), pps = await pxPerSecond();
      const x0 = rect.left + 2, y = rect.top + rect.height / 2, x1 = x0 + 3 * pps;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / 12, y, button: 'left', buttons: 1 }); await sleep(30); }
      await release(x1, y);
      const edit = await waitFor(async () => { const e = await readEdit(); return item(e, 'n1').duration !== 60 && e; });
      const still = item(edit, 'n1');
      assert.equal(still.duration, 15); assert.equal(still.at, 345); assert.equal(still.source.in, 0); assert.equal(still.source.out, 0.5);
      const p = await evaluate(`(()=>{const b=${W}.node.querySelector('button[aria-label="元に戻す"]'),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await realClick(cdp, p.x, p.y);
      await waitFor(async () => item(await readEdit(), 'n1').duration === 60);
      return { still, restoredByOneUndo: true };
    });
    // 右パネル: 通常分割へ戻し、動画予定クリップを実クリックで選択する。
    await evaluate(`window.__akariEdgeShell.toggleMaximized(${W});${W}.activate();true`);
    await sleep(800);
    const planBefore = await waitFor(() => clipRect('plan'));
    await realClick(cdp, planBefore.left + planBefore.width / 2, planBefore.top + planBefore.height * 0.75);
    // 右パネルが「パートナーを追加」のときは既存コマンドで検査パネルを開く（選択は上の実クリックのまま）。
    await evaluate(`(()=>{const c=window.theia.container,k=[...c._bindingDictionary._map.keys()]
      .find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');
      void c.get(k).executeCommand('akari.inspector.open');return true;})()`);
    await sleep(800);
    const PANEL = `document.querySelector('[data-akari-ui="panel:inspector"]')`;
    const GEN = `(()=>{const p=${PANEL};if(!p)return null;const f=n=>{const e=p.querySelector('[data-akari-field="'+n+'"]');return e?e.textContent.trim():null;};
      return {duration:f('generation-duration'),estimate:f('generation-estimate'),
        fields:[...p.querySelectorAll('[data-akari-field^="generation"]')].map(e=>e.getAttribute('data-akari-field')+'='+e.textContent.trim().slice(0,120))};})()`;
    const clickTab = async label => {
      const p = await waitEval(`(()=>{const e=[...${PANEL}.querySelectorAll('[role="tab"]')].find(e=>e.textContent.trim()==='${label}');if(!e)return null;
        const r=e.getBoundingClientRect();return r.width>0?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
      await realClick(cdp, p.x, p.y); await sleep(400);
    };
    let genBefore;
    await step('generation tab shows 5 s and an estimate before the change', async () => {
      await clickTab('生成');
      genBefore = await waitEval(`(()=>{const g=${GEN};return g&&g.duration&&g.estimate?g:null;})()`);
      assert.match(genBefore.duration, /5/);
      await shot('02-generation-tab-before.png');
      return genBefore;
    });
    const tabs = await evaluate(`[...${PANEL}.querySelectorAll('[role="tab"]')].map(e=>e.textContent.trim())`);
    output.inspectorTabs = tabs;
    const FIELD = `(()=>{${GEOMETRY}const p=${PANEL};const rows=[...p.querySelectorAll('[data-akari-field]')].filter(r=>visible(r)&&/^\\s*長さ/.test(r.textContent)&&r.querySelector('input'));
      const r=rows.find(r=>!String(r.getAttribute('data-akari-field')).startsWith('generation'));if(!r)return null;const i=r.querySelector('input');
      const label=[...r.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='長さ');
      return {field:r.getAttribute('data-akari-field'),value:i.value,input:{...rect(i),painted:painted(i),background:getComputedStyle(i).backgroundColor,
        border:getComputedStyle(i).borderBottomColor+' '+getComputedStyle(i).borderBottomWidth+' '+getComputedStyle(i).borderBottomStyle},
        label:label?measure(label):null,texts:[...r.querySelectorAll('*')].filter(e=>e.children.length===0&&visible(e)&&e.textContent.trim()&&e!==label).map(measure)};})()`;
    let lengthField;
    await step('cut section shows an editable 長さ field for the planned video clip', async () => {
      for (const tab of tabs) {
        if (tab === '生成') continue;
        lengthField = await evaluate(FIELD); if (lengthField) break;
        await clickTab(tab); lengthField = await evaluate(FIELD); if (lengthField) break;
      }
      assert.ok(lengthField, '長さ field not found');
      assert.ok(lengthField.input.painted, 'length input has neither background nor border');
      assert.ok(lengthField.label && !intersects(lengthField.label, lengthField.input), 'label intersects input');
      output.lengthField = lengthField; await save();
      return lengthField;
    });
    await shot('03-length-field-before.png');
    let typed;
    await step('typing 3.5 into 長さ writes duration and source.out together', async () => {
      const i = lengthField.input;
      await realClick(cdp, i.left + i.width / 2, i.top + i.height / 2);
      await sleep(200);
      const focused = await evaluate(`document.activeElement?.tagName`);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 });
      await cdp.send('Input.insertText', { text: '3.5' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      const edit = await waitFor(async () => { const e = await readEdit(); return item(e, 'plan').duration !== 150 && e; });
      const plan = item(edit, 'plan');
      assert.equal(plan.duration, 105); assert.equal(plan.source.in, 0); assert.equal(plan.source.out, 3.5); assert.equal(plan.at, 450);
      await sleep(600);
      const planAfter = await clipRect('plan');
      assert.ok(Math.abs(planAfter.width / planBefore.width - 3.5 / 5) < 0.03, `clip width ${planBefore.width} -> ${planAfter.width}`);
      typed = { focused, item: plan, widthBefore: planBefore.width, widthAfter: planAfter.width, field: await evaluate(FIELD) };
      return typed;
    });
    await shot('04-length-3.5.png');
    await step('generation tab length and estimate follow', async () => {
      await clickTab('生成');
      let gen;
      try {
        gen = await waitEval(`(()=>{const g=${GEN};return g&&/3\\.5/.test(g.duration)&&g.estimate!==${JSON.stringify(genBefore.estimate)}?g:null;})()`, 15000);
      } catch (error) { output.generationAfterTimeout = await evaluate(GEN); await save(); throw error; }
      await shot('05-generation-tab-after.png');
      return { before: genBefore, after: gen };
    });
    await step('edit lint passes after the length change', lint);
    await step('timeline clip labels and badges do not intersect', async () => {
      const rects = await waitEval(CHIP_TEXT('plan'));
      const still = await evaluate(CHIP_TEXT('still'));
      const overlaps = [...overlapPairs(rects), ...overlapPairs(still ?? [])];
      output.chipText = { plan: rects, still, overlaps }; await save();
      assert.equal(overlaps.length, 0);
      return { planRects: rects.length, stillRects: still?.length ?? 0, overlaps: overlaps.length };
    });
    await step('one undo restores duration 150 / source.out 5', async () => {
      await evaluate(`${W}.activate();true`);
      const p = await evaluate(`(()=>{const b=${W}.node.querySelector('button[aria-label="元に戻す"]'),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await realClick(cdp, p.x, p.y);
      const edit = await waitFor(async () => { const e = await readEdit(); return item(e, 'plan').duration === 150 && e; });
      assert.deepEqual(item(edit, 'plan'), item(initial, 'plan'));
      await sleep(600);
      await shot('06-after-undo.png');
      return { plan: item(edit, 'plan'), undoClicks: 1, width: (await clipRect('plan')).width };
    });
    await step('typing 9 into 長さ next to a neighbor rounds to the largest fit (8 s)', async () => {
      await clickTab(tabs.find(t => t !== '生成') ?? tabs[0]);
      let field; for (const tab of tabs) { if (tab === '生成') continue; field = await evaluate(FIELD); if (field) break; await clickTab(tab); field = await evaluate(FIELD); if (field) break; }
      assert.ok(field);
      await realClick(cdp, field.input.left + field.input.width / 2, field.input.top + field.input.height / 2);
      await sleep(200);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65, commands: ['selectAll'] });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4, windowsVirtualKeyCode: 65 });
      await cdp.send('Input.insertText', { text: '9' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      const edit = await waitFor(async () => { const e = await readEdit(); return item(e, 'plan').duration !== 150 && e; });
      const plan = item(edit, 'plan');
      assert.equal(plan.duration, 240); assert.equal(plan.source.out, 8); assert.equal(plan.at + plan.duration, item(edit, 'n2').at);
      return { plan, neighborAt: item(edit, 'n2').at };
    });
  }
  assert.equal(output.falRequests.length, 0);
  if (!BEFORE) {
    assert.ok(output.screenshots.length >= 3);
    output.status = output.steps.every(s => s.pass) ? 'pass' : 'fail';
    if (output.status === 'fail') process.exitCode = 1;
  }
} catch (error) {
  output.status = 'fail'; output.error = clean(error.stack ?? error);
  if (cdp) await shot(BEFORE ? 'before-99-failure.png' : '99-failure.png').catch(() => {});
  process.exitCode = 1;
} finally {
  cdp?.close();
  await stopElectron();
  output.elapsedMs = Math.round(performance.now() - started); await save();
}
